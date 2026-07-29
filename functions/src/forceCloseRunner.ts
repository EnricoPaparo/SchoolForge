/**
 * FORCE-SUBMIT-02 — logica eseguibile della programmazione e della chiusura
 * schedulata, separata dal wiring Functions (`forceCloseGateway.ts`).
 *
 * Qui vivono solo le porte Firestore (Admin SDK) e l'orchestrazione; ogni
 * decisione è presa dai core puri `forceCloseCore.ts` e `forceSubmitCore.ts`.
 * Il modulo non importa `firebase-functions` e non inizializza alcuna app,
 * quindi è direttamente esercitabile dai test con una Firestore finta.
 */
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import type { DocumentData, Firestore, Transaction } from 'firebase-admin/firestore';
import { secureRandomIntBelow } from './verificationVariantCore.js';
import {
  decideForceSubmit,
  forceSubmitWrites,
  generateDeliveryCode,
  resultForDecision,
  submissionIdFor,
  type ReceiptSnapshot,
  type SubmissionSnapshot,
} from './forceSubmitCore.js';
import {
  decideForceCloseTask,
  decideScheduleFor,
  FORCE_CLOSE_GRACE_SECONDS,
  ForceCloseError,
  forceSubmitInputForTask,
  generateRequestId,
  parseForceCloseTaskPayload,
  parseScheduleForceCloseInput,
  scheduleResult,
  scheduleWrite,
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

// ── Porte iniettabili (rende il gateway testabile senza rete) ──────────────────

export interface ForceCloseTaskEnqueue {
  (payload: ForceCloseTaskPayload, scheduleTime: Date): Promise<void>;
}

// ── Programmazione ─────────────────────────────────────────────────────────────

/**
 * Programma la chiusura per gli studenti indicati.
 *
 * Ordine deliberato: input → auth → verifica (una lettura) → poi, **per
 * studente**, una transazione puntuale che rilegge la sua submission e scrive
 * solo se è ancora una bozza non già programmata. Un fallimento individuale non
 * interrompe gli altri: viene riportato come `failed` e basta.
 *
 * La task è accodata **dopo** il commit del marcatore: se l'accodamento
 * fallisce, il marcatore viene rimosso e lo studente non resta con un banner
 * che non porta da nessuna parte.
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
  const results: ScheduleStudentResult[] = [];

  for (const studentUid of input.studentUids) {
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

      if (outcome === 'scheduled' && requestId !== null) {
        try {
          await enqueue(
            {
              verificationId: input.verificationId,
              studentUid,
              ownerUid: callerUid,
              requestId,
            },
            deadlineAt,
          );
        } catch (err) {
          // Compensazione: senza task il marcatore sarebbe una promessa vuota.
          await submissionRef
            .update({
              forceCloseRequestId: FieldValue.delete(),
              forceCloseDeadline: FieldValue.delete(),
              forceCloseRequestedAt: FieldValue.delete(),
            })
            .catch(() => undefined);
          throw err;
        }
      }
      results.push({ studentUid, outcome });
    } catch {
      results.push({ studentUid, outcome: 'failed' });
    }
  }

  return scheduleResult(results);
}

// ── Esecuzione della task ──────────────────────────────────────────────────────

export type ForceCloseTaskOutcome = 'closed' | 'noop';

/**
 * Esegue la chiusura programmata. Transazione unica: submission + ricevuta (e
 * la verifica, per riusare integralmente la decisione FORCE-SUBMIT-01).
 *
 * Idempotente per costruzione: un retry ritrova la submission già `submitted`
 * e senza marcatori, quindi `decideForceCloseTask` risponde `noop_superseded` e
 * non si scrive nulla. Lo stesso vale per una consegna normale avvenuta durante
 * il preavviso e per una task consegnata due volte o in ritardo.
 */
export async function runForceCloseTask(
  db: Firestore,
  rawPayload: unknown,
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

    const scheduleDecision = decideForceCloseTask({
      payload,
      submission: submissionSnap.exists
        ? toScheduleSnapshot(submissionSnap.data() as DocumentData)
        : null,
    });
    if (scheduleDecision === 'noop_superseded') return 'noop';

    // La verifica deve esistere ed essere ancora del docente che ha programmato.
    if (
      !verificationSnap.exists ||
      (verificationSnap.data() as DocumentData).ownerUid !== payload.ownerUid
    ) {
      return 'noop';
    }

    const decision = decideForceSubmit(
      {
        callerUid: payload.ownerUid,
        input: forceSubmitInputForTask(payload),
        verification: { ownerUid: payload.ownerUid },
        submission: toSubmissionSnapshot(submissionSnap.data() as DocumentData),
        receipt: receiptSnap.exists ? toReceiptSnapshot(receiptSnap.data() as DocumentData) : null,
      },
      () => generateDeliveryCode(new Date().getUTCFullYear(), secureRandomIntBelow),
    );
    if (decision.kind !== 'apply') return 'noop';

    // Stesse due scritture atomiche di FORCE-SUBMIT-01, più la rimozione dei
    // marcatori nello **stesso** update: nessuna terza scrittura.
    const writes = forceSubmitWrites(
      decision,
      forceSubmitInputForTask(payload),
      FieldValue.serverTimestamp(),
      { clearScheduleMarkers: FieldValue.delete() },
    );
    tx.update(submissionRef, writes.submissionUpdate);
    tx.set(receiptRef, writes.receipt);
    void resultForDecision(decision);
    return 'closed';
  });
}
