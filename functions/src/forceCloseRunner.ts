/**
 * FORCE-SUBMIT-02 — logica eseguibile della programmazione e della chiusura
 * schedulata, separata dal wiring Functions (`forceCloseGateway.ts`).
 *
 * Qui vivono solo le porte Firestore (Admin SDK) e l'orchestrazione; ogni
 * decisione è presa dai core puri `forceCloseCore.ts` e `forceSubmitCore.ts`.
 * Il modulo non importa `firebase-functions` e non inizializza alcuna app,
 * quindi è direttamente esercitabile dai test con una Firestore finta.
 *
 * **Limite dichiarato:** Firestore e Cloud Tasks **non** condividono una
 * transazione. Scrivere i marcatori e accodare la task sono due operazioni
 * distinte, e nulla può renderle atomiche. Il disegno lo affronta invece di
 * fingere il contrario:
 *  - la scrittura viene **prima**, così non può esistere una task senza il suo
 *    marcatore (che è ciò che rende la chiusura riconoscibile e idempotente);
 *  - se l'accodamento fallisce si esegue una **compensazione transazionale
 *    condizionata allo stesso `requestId`**, che non tocca mai una
 *    programmazione diversa;
 *  - se anche la compensazione fallisce, l'esito è `failed_cleanup`: uno stato
 *    esplicito e azionabile, mai un successo apparente;
 *  - il nome della task è derivato dal `requestId`, quindi un retry
 *    dell'accodamento non può creare un duplicato.
 */
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import type { DocumentData, Firestore, Transaction } from 'firebase-admin/firestore';
import { secureRandomIntBelow } from './verificationVariantCore.js';
import {
  decideForceSubmit,
  ForceSubmitError,
  forceSubmitWrites,
  generateDeliveryCode,
  submissionIdFor,
  type ReceiptSnapshot,
  type SubmissionSnapshot,
} from './forceSubmitCore.js';
import {
  decideForceCloseTask,
  decideScheduleFor,
  FORCE_CLOSE_GRACE_SECONDS,
  FORCE_CLOSE_MARKER_FIELDS,
  ForceCloseError,
  forceSubmitInputForTask,
  generateRequestId,
  parseForceCloseTaskPayload,
  parseScheduleForceCloseInput,
  readMarkerState,
  scheduleResult,
  scheduleWrite,
  taskNameFor,
  type ForceCloseTaskPayload,
  type ScheduleForceCloseResult,
  type ScheduleStudentResult,
  type ScheduleSubmissionSnapshot,
} from './forceCloseCore.js';

// ── Mapping istantanee ─────────────────────────────────────────────────────────

function toScheduleSnapshot(data: DocumentData): ScheduleSubmissionSnapshot {
  return {
    submissionId: data.submissionId,
    verificationId: data.verificationId,
    studentUid: data.studentUid,
    ownerUid: data.ownerUid,
    status: data.status,
    forcedByTeacher: data.forcedByTeacher,
    forceCloseRequestId: data.forceCloseRequestId,
    forceCloseDeadline: data.forceCloseDeadline,
    forceCloseRequestedAt: data.forceCloseRequestedAt,
  };
}

function toSubmissionSnapshot(data: DocumentData): SubmissionSnapshot {
  return {
    submissionId: data.submissionId,
    verificationId: data.verificationId,
    studentUid: data.studentUid,
    ownerUid: data.ownerUid,
    status: data.status,
    deliveryCode: data.deliveryCode,
    forcedByTeacher: data.forcedByTeacher,
    verificationTitle: data.verificationTitle,
    className: data.className,
    submittedAt: data.submittedAt,
  };
}

function toReceiptSnapshot(data: DocumentData): ReceiptSnapshot {
  return {
    submissionId: data.submissionId,
    verificationId: data.verificationId,
    studentUid: data.studentUid,
    ownerUid: data.ownerUid,
    deliveryCode: data.deliveryCode,
    forcedByTeacher: data.forcedByTeacher,
    verificationTitle: data.verificationTitle,
    className: data.className,
    submittedAt: data.submittedAt,
  };
}

/** Update che rimuove i tre marcatori in un colpo solo. */
function clearMarkersUpdate(): Record<string, unknown> {
  return Object.fromEntries(FORCE_CLOSE_MARKER_FIELDS.map((f) => [f, FieldValue.delete()]));
}

// ── Porte iniettabili ──────────────────────────────────────────────────────────

export interface ForceCloseEnqueueOptions {
  scheduleTime: Date;
  /** Nome deterministico: rende l'accodamento idempotente lato Cloud Tasks. */
  id: string;
}

export interface ForceCloseTaskEnqueue {
  (payload: ForceCloseTaskPayload, options: ForceCloseEnqueueOptions): Promise<void>;
}

/**
 * Un accodamento rifiutato perché la task esiste **già** non è un errore: è la
 * prova che l'operazione era già stata fatta. Cloud Tasks risponde
 * `ALREADY_EXISTS` (gRPC 6, HTTP 409).
 */
export function isAlreadyExistsError(err: unknown): boolean {
  const code = (err as { code?: unknown })?.code;
  if (code === 6 || code === 409) return true;
  const message = String((err as { message?: unknown })?.message ?? '');
  return /already[\s_-]?exists/i.test(message);
}

// ── Programmazione ─────────────────────────────────────────────────────────────

/** Esegue `worker` su tutti gli elementi con concorrenza limitata, in ordine. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index]!);
    }
  });
  await Promise.all(runners);
  return results;
}

/** Concorrenza della programmazione: abbastanza per una classe, senza raffiche. */
export const FORCE_CLOSE_SCHEDULE_CONCURRENCY = 5;

/**
 * Programma la chiusura per gli studenti indicati.
 *
 * Ordine deliberato: input → auth → verifica (una lettura) → poi, **per
 * studente**, una transazione puntuale che rilegge la sua submission e scrive
 * solo se è ancora una bozza non già programmata.
 *
 * Le righe sono elaborate con **concorrenza limitata** — non 60 operazioni
 * strettamente sequenziali, che con un batch pieno rischierebbero il timeout
 * della callable — preservando l'esito individuale nell'ordine richiesto. Un
 * fallimento individuale non interrompe mai gli altri studenti.
 */
export async function runScheduleForceClose(
  db: Firestore,
  callerUid: string | null,
  rawInput: unknown,
  enqueue: ForceCloseTaskEnqueue,
  now: () => Date = () => new Date(),
): Promise<ScheduleForceCloseResult> {
  const input = parseScheduleForceCloseInput(rawInput);
  if (!callerUid) throw new ForceCloseError('unauthenticated', 'Autenticazione richiesta.');

  const verificationSnap = await db.doc(`verifications/${input.verificationId}`).get();
  if (!verificationSnap.exists) {
    throw new ForceCloseError('not_found', 'Verifica non trovata.');
  }
  if ((verificationSnap.data() as DocumentData).ownerUid !== callerUid) {
    throw new ForceCloseError('permission_denied', 'Verifica non di questo docente.');
  }

  const deadlineAt = new Date(now().getTime() + FORCE_CLOSE_GRACE_SECONDS * 1000);
  const deadline = Timestamp.fromDate(deadlineAt);

  const results = await mapWithConcurrency(
    input.studentUids,
    FORCE_CLOSE_SCHEDULE_CONCURRENCY,
    async (studentUid): Promise<ScheduleStudentResult> => {
      const submissionRef = db.doc(
        `submissions/${submissionIdFor(input.verificationId, studentUid)}`,
      );
      let requestId: string | null = null;
      try {
        const outcome = await db.runTransaction(async (tx: Transaction) => {
          const snap = await tx.get(submissionRef);
          const decision = decideScheduleFor({
            callerUid,
            verificationId: input.verificationId,
            studentUid,
            submission: snap.exists ? toScheduleSnapshot(snap.data() as DocumentData) : null,
          });
          if (decision !== 'scheduled') return decision;
          requestId = generateRequestId(secureRandomIntBelow);
          // Unica scrittura della programmazione: tre marcatori server-only.
          tx.update(
            submissionRef,
            scheduleWrite(requestId, deadline, FieldValue.serverTimestamp()).submissionUpdate,
          );
          return decision;
        });

        if (outcome !== 'scheduled' || requestId === null) return { studentUid, outcome };
        const scheduledRequestId: string = requestId;

        try {
          await enqueue(
            {
              verificationId: input.verificationId,
              studentUid,
              ownerUid: callerUid,
              requestId: scheduledRequestId,
              deadlineMs: deadlineAt.getTime(),
            },
            { scheduleTime: deadlineAt, id: taskNameFor(scheduledRequestId) },
          );
        } catch (enqueueError) {
          if (isAlreadyExistsError(enqueueError)) {
            // Task già presente con lo stesso nome: l'accodamento era riuscito.
            return { studentUid, outcome: 'scheduled' };
          }
          const cleaned = await clearOwnMarkers(db, submissionRef, scheduledRequestId);
          // Senza task il marcatore sarebbe una promessa vuota: se non si è
          // potuto rimuovere, lo si dichiara invece di fingere un successo.
          return { studentUid, outcome: cleaned ? 'failed' : 'failed_cleanup' };
        }
        return { studentUid, outcome: 'scheduled' };
      } catch {
        return { studentUid, outcome: 'failed' };
      }
    },
  );

  return scheduleResult(results);
}

/**
 * Compensazione **transazionale e condizionata**: rimuove i marcatori solo se
 * appartengono ancora a `requestId`. Una programmazione diversa — arrivata nel
 * frattempo — non viene mai cancellata. Restituisce `false` se la pulizia non è
 * riuscita, così il chiamante può dichiararlo.
 */
async function clearOwnMarkers(
  db: Firestore,
  submissionRef: ReturnType<Firestore['doc']>,
  requestId: string,
): Promise<boolean> {
  try {
    await db.runTransaction(async (tx: Transaction) => {
      const snap = await tx.get(submissionRef);
      if (!snap.exists) return;
      const markers = readMarkerState(toScheduleSnapshot(snap.data() as DocumentData));
      if (markers.kind !== 'present' || markers.requestId !== requestId) return;
      tx.update(submissionRef, clearMarkersUpdate());
    });
    return true;
  } catch {
    return false;
  }
}

// ── Esecuzione della task ──────────────────────────────────────────────────────

/**
 * Esiti **terminali** della task. Nessuno di essi lascia una scadenza superata
 * con i marcatori ancora presenti e nessuna ricevuta.
 */
export type ForceCloseTaskOutcome =
  | 'closed'
  | 'cleaned'
  | 'noop'
  /** Metadati della consegna irrecuperabili: marcatori rimossi, niente chiusura. */
  | 'failed_permanent';

/** La coda ha consegnato prima della scadenza: si deve ritentare, non chiudere. */
export class ForceCloseTooEarlyError extends Error {
  readonly remainingMs: number;
  constructor(remainingMs: number) {
    super(`Task consegnata ${remainingMs} ms prima della scadenza.`);
    this.name = 'ForceCloseTooEarlyError';
    this.remainingMs = remainingMs;
  }
}

/**
 * Esegue la chiusura programmata in **una** transazione (submission, ricevuta e
 * verifica), con esiti terminali espliciti.
 *
 * Idempotente per costruzione: un retry ritrova la submission già `submitted` e
 * senza marcatori, quindi la decisione è `noop` e non si scrive nulla. Lo stesso
 * vale per una consegna doppia della task, una consegna tardiva, una consegna
 * normale avvenuta durante il preavviso e una riprogrammazione successiva.
 *
 * Gli errori **infrastrutturali** vengono propagati, così Cloud Tasks ritenta.
 * Gli errori **permanenti** di validazione dei metadati non vengono inghiottiti
 * lasciando il documento bloccato: i marcatori vengono rimossi e l'esito è
 * `failed_permanent`.
 */
export async function runForceCloseTask(
  db: Firestore,
  rawPayload: unknown,
  now: () => number = () => Date.now(),
): Promise<ForceCloseTaskOutcome> {
  const payload = parseForceCloseTaskPayload(rawPayload);
  const submissionId = submissionIdFor(payload.verificationId, payload.studentUid);
  const verificationRef = db.doc(`verifications/${payload.verificationId}`);
  const submissionRef = db.doc(`submissions/${submissionId}`);
  const receiptRef = db.doc(`submissionReceipts/${submissionId}`);

  return db.runTransaction(async (tx: Transaction): Promise<ForceCloseTaskOutcome> => {
    const [verificationSnap, submissionSnap, receiptSnap] = await Promise.all([
      tx.get(verificationRef),
      tx.get(submissionRef),
      tx.get(receiptRef),
    ]);

    const decision = decideForceCloseTask({
      payload,
      submission: submissionSnap.exists
        ? toScheduleSnapshot(submissionSnap.data() as DocumentData)
        : null,
      nowMs: now(),
    });

    if (decision.kind === 'noop') return 'noop';
    if (decision.kind === 'too_early') throw new ForceCloseTooEarlyError(decision.remainingMs);
    if (decision.kind === 'cleanup') {
      tx.update(submissionRef, clearMarkersUpdate());
      return 'cleaned';
    }

    // La verifica deve esistere ed essere ancora del docente che ha programmato.
    // Se non lo è, la chiusura non si fa — ma i marcatori vanno comunque tolti.
    if (
      !verificationSnap.exists ||
      (verificationSnap.data() as DocumentData).ownerUid !== payload.ownerUid
    ) {
      tx.update(submissionRef, clearMarkersUpdate());
      return 'cleaned';
    }

    let applyDecision;
    try {
      applyDecision = decideForceSubmit(
        {
          callerUid: payload.ownerUid,
          input: forceSubmitInputForTask(payload),
          verification: { ownerUid: payload.ownerUid },
          submission: toSubmissionSnapshot(submissionSnap.data() as DocumentData),
          receipt: receiptSnap.exists
            ? toReceiptSnapshot(receiptSnap.data() as DocumentData)
            : null,
        },
        () => generateDeliveryCode(new Date().getUTCFullYear(), secureRandomIntBelow),
      );
    } catch (err) {
      if (err instanceof ForceSubmitError) {
        // Errore **permanente**: metadati incoerenti o irrecuperabili. Ritentare
        // non cambierebbe nulla, e lasciare i marcatori bloccherebbe lo studente
        // su un banner scaduto per sempre.
        tx.update(submissionRef, clearMarkersUpdate());
        return 'failed_permanent';
      }
      throw err;
    }

    if (applyDecision.kind !== 'apply') {
      tx.update(submissionRef, clearMarkersUpdate());
      return 'cleaned';
    }

    // Stesse due scritture atomiche di FORCE-SUBMIT-01, più la rimozione dei
    // marcatori nello **stesso** update: nessuna terza scrittura.
    const writes = forceSubmitWrites(
      applyDecision,
      forceSubmitInputForTask(payload),
      FieldValue.serverTimestamp(),
      { clearScheduleMarkers: FieldValue.delete() },
    );
    tx.update(submissionRef, writes.submissionUpdate);
    tx.set(receiptRef, writes.receipt);
    return 'closed';
  });
}
