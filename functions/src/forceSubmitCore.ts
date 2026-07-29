/**
 * FORCE-SUBMIT-01 — nucleo **puro** e testabile della callable
 * `forceSubmitSubmission` (nessun import Firebase/Admin/rete).
 *
 * Scopo: il docente acquisisce e chiude una verifica online che lo studente ha
 * iniziato ma non ha consegnato — l'ultima versione **già salvata**. Nulla di
 * ciò che lo studente non ha mai autosalvato può essere recuperato: questo
 * modulo non inventa risposte e non tocca `answers`, `flagged`,
 * `attentionEvents`, `assignedQuestionOrders`, `assignedAnswerKeys`,
 * `startedAt` né `lastSavedAt`.
 *
 * `lastSavedAt` in particolare resta **invariato**: continua a rappresentare
 * l'ultimo salvataggio reale dello studente. Sovrascriverlo con l'istante della
 * chiusura docente cancellerebbe l'unica traccia di quanto era vecchia la
 * versione acquisita.
 */

export type ForceSubmitErrorCode =
  | 'unauthenticated'
  | 'invalid_input'
  | 'not_found'
  | 'permission_denied'
  | 'failed_precondition';

export class ForceSubmitError extends Error {
  readonly code: ForceSubmitErrorCode;
  constructor(code: ForceSubmitErrorCode, message: string) {
    super(message);
    this.name = 'ForceSubmitError';
    this.code = code;
  }
}

// ── Input chiuso ───────────────────────────────────────────────────────────────

export interface ForceSubmitInput {
  verificationId: string;
  studentUid: string;
}

/** Un segmento Firestore valido: non vuoto, no '/', no '.'/'..', ≤ 1500 byte. */
function isValidFirestoreSegment(value: string): boolean {
  if (value.length === 0 || value.length > 1500) return false;
  if (value.includes('/')) return false;
  if (value === '.' || value === '..') return false;
  if (value.startsWith('__') && value.endsWith('__')) return false;
  return true;
}

/**
 * Parsing **chiuso**: plain-object con esattamente `verificationId` e
 * `studentUid`. Ogni altra chiave è rifiutata — in particolare `ownerUid`,
 * `submissionId`, `deliveryCode`, `status`, `submittedAt`, `answers` e
 * `forcedByTeacher`, che sono derivati server-side e non accettati dal client.
 */
export function parseForceSubmitInput(raw: unknown): ForceSubmitInput {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new ForceSubmitError('invalid_input', 'Input non valido.');
  }
  const keys = Object.keys(raw).sort();
  if (keys.length !== 2 || keys[0] !== 'studentUid' || keys[1] !== 'verificationId') {
    throw new ForceSubmitError('invalid_input', 'Input non valido: chiavi non ammesse.');
  }
  const { verificationId, studentUid } = raw as Record<string, unknown>;
  if (typeof verificationId !== 'string' || !isValidFirestoreSegment(verificationId)) {
    throw new ForceSubmitError('invalid_input', 'verificationId non valido.');
  }
  if (typeof studentUid !== 'string' || !isValidFirestoreSegment(studentUid)) {
    throw new ForceSubmitError('invalid_input', 'studentUid non valido.');
  }
  return { verificationId, studentUid };
}

/** Id deterministico della consegna: unica forma ammessa, mai fornita dal client. */
export function submissionIdFor(verificationId: string, studentUid: string): string {
  return `${verificationId}_${studentUid}`;
}

// ── Codice consegna ────────────────────────────────────────────────────────────

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Sorgente di casualità iniettabile: `[0, max)`. */
export type RandomIntBelow = (max: number) => number;

/**
 * Stesso formato canonico della consegna normale (`SF-YYYY-XXXX`, alfabeto
 * senza caratteri ambigui). Generato **server-side**: il client non può
 * proporre né influenzare il codice.
 */
export function generateDeliveryCode(year: number, randomIntBelow: RandomIntBelow): string {
  let suffix = '';
  for (let i = 0; i < 4; i += 1) suffix += CODE_ALPHABET[randomIntBelow(CODE_ALPHABET.length)];
  return `SF-${year}-${suffix}`;
}

/**
 * Riconosce un codice nel formato canonico (usato per validare un replay).
 * La generazione usa l'alfabeto ridotto senza caratteri ambigui; la *convalida*
 * accetta l'intero insieme alfanumerico maiuscolo, così un codice legittimo
 * prodotto da una versione precedente non viene mai giudicato incoerente.
 */
export function isCanonicalDeliveryCode(value: unknown): value is string {
  return typeof value === 'string' && /^SF-\d{4}-[A-Z0-9]{4}$/.test(value);
}

// ── Istantanee lette in transazione ────────────────────────────────────────────

export interface VerificationSnapshot {
  ownerUid: string;
}

export interface SubmissionSnapshot {
  submissionId: unknown;
  verificationId: unknown;
  studentUid: unknown;
  ownerUid: unknown;
  status: unknown;
  deliveryCode: unknown;
  forcedByTeacher: unknown;
}

export interface ReceiptSnapshot {
  submissionId: unknown;
  verificationId: unknown;
  studentUid: unknown;
  ownerUid: unknown;
  deliveryCode: unknown;
  forcedByTeacher: unknown;
}

export interface ForceSubmitContext {
  callerUid: string | null;
  input: ForceSubmitInput;
  verification: VerificationSnapshot | null;
  submission: SubmissionSnapshot | null;
  receipt: ReceiptSnapshot | null;
}

/**
 * Esito della decisione pura.
 * - `apply`: la submission è `draft` e va chiusa (2 scritture atomiche);
 * - `already_forced`: replay idempotente di una chiusura già completata da
 *   questo stesso flusso — **zero** scritture, nessun nuovo codice;
 * - `already_submitted`: lo studente ha consegnato normalmente nel frattempo —
 *   la consegna non viene toccata.
 */
export type ForceSubmitDecision =
  | { kind: 'apply'; submissionId: string; deliveryCode: string }
  | { kind: 'already_forced' }
  | { kind: 'already_submitted' };

/** Risposta sanitizzata: nessun contenuto, nessun uid, nessun codice. */
export interface ForceSubmitResult {
  status: 'submitted' | 'already_submitted';
}

export function resultForDecision(decision: ForceSubmitDecision): ForceSubmitResult {
  // Un replay idempotente riporta lo stesso esito della chiusura riuscita: per
  // il chiamante l'operazione è stata effettuata, e ripeterla non cambia nulla.
  return decision.kind === 'already_submitted'
    ? { status: 'already_submitted' }
    : { status: 'submitted' };
}

/**
 * Decisione **autorevole**, valutata sulle letture della transazione. Ogni
 * incoerenza è fail-closed: non si "ripara" mai un documento inatteso.
 */
export function decideForceSubmit(
  context: ForceSubmitContext,
  deliveryCodeFor: () => string,
): ForceSubmitDecision {
  const { callerUid, input, verification, submission, receipt } = context;
  if (!callerUid) {
    throw new ForceSubmitError('unauthenticated', 'Autenticazione richiesta.');
  }
  if (!verification) {
    throw new ForceSubmitError('not_found', 'Verifica non trovata.');
  }
  if (verification.ownerUid !== callerUid) {
    throw new ForceSubmitError('permission_denied', 'Verifica non di questo docente.');
  }
  // Nessuna consegna viene mai creata: se lo studente non ha iniziato, non c'è
  // nulla da acquisire e l'operazione si ferma qui.
  if (!submission) {
    throw new ForceSubmitError('not_found', 'Lo studente non ha ancora iniziato la verifica.');
  }

  const expectedId = submissionIdFor(input.verificationId, input.studentUid);
  const coherent =
    submission.submissionId === expectedId &&
    submission.verificationId === input.verificationId &&
    submission.studentUid === input.studentUid &&
    submission.ownerUid === callerUid;
  if (!coherent) {
    throw new ForceSubmitError('failed_precondition', 'Consegna incoerente con la verifica.');
  }

  if (submission.status === 'submitted') {
    if (submission.forcedByTeacher === true) {
      // Replay: la receipt deve esistere e combaciare, altrimenti lo stato è
      // incoerente e non va confermato come riuscito.
      const receiptOk =
        receipt !== null &&
        receipt.submissionId === expectedId &&
        receipt.verificationId === input.verificationId &&
        receipt.studentUid === input.studentUid &&
        receipt.ownerUid === callerUid &&
        receipt.forcedByTeacher === true &&
        isCanonicalDeliveryCode(receipt.deliveryCode) &&
        receipt.deliveryCode === submission.deliveryCode;
      if (!receiptOk) {
        throw new ForceSubmitError(
          'failed_precondition',
          'Consegna già chiusa ma ricevuta mancante o incoerente.',
        );
      }
      return { kind: 'already_forced' };
    }
    // Consegna normale dello studente: non viene mai sovrascritta.
    return { kind: 'already_submitted' };
  }

  if (submission.status !== 'draft') {
    throw new ForceSubmitError('failed_precondition', 'La consegna non è in bozza.');
  }
  // Una submission ancora `draft` non può avere il marcatore: se ce l'ha, il
  // documento è stato manomesso o è incoerente.
  if (submission.forcedByTeacher !== undefined) {
    throw new ForceSubmitError('failed_precondition', 'Consegna in bozza in stato incoerente.');
  }

  return {
    kind: 'apply',
    submissionId: expectedId,
    deliveryCode: deliveryCodeFor(),
  };
}

// ── Payload delle due (sole) scritture ─────────────────────────────────────────

/** Dati canonici già presenti sulla submission, usati per comporre la ricevuta. */
export interface SubmissionMetadata {
  ownerUid: unknown;
  verificationTitle?: unknown;
  className?: unknown;
}

export interface ForceSubmitWrites {
  /** Update **mirato** della submission: esattamente questi quattro campi. */
  submissionUpdate: Record<string, unknown>;
  /** Ricevuta deterministica, composta solo da dati server-side. */
  receipt: Record<string, unknown>;
}

/**
 * Compone le due scritture atomiche della chiusura forzata. Funzione pura: il
 * timestamp del server è iniettato, così il contenuto esatto (e soprattutto ciò
 * che **non** contiene) è verificabile senza Admin SDK.
 *
 * `lastSavedAt`, `answers`, `flagged`, `attentionEvents`,
 * `assignedQuestionOrders`, `assignedAnswerKeys` e `startedAt` non compaiono di
 * proposito: la chiusura non tocca né i contenuti né la traccia dell'ultimo
 * salvataggio reale dello studente.
 */
export function forceSubmitWrites(
  decision: Extract<ForceSubmitDecision, { kind: 'apply' }>,
  input: ForceSubmitInput,
  submission: SubmissionMetadata,
  now: unknown,
): ForceSubmitWrites {
  return {
    submissionUpdate: {
      status: 'submitted',
      deliveryCode: decision.deliveryCode,
      submittedAt: now,
      forcedByTeacher: true,
    },
    receipt: {
      submissionId: decision.submissionId,
      verificationId: input.verificationId,
      studentUid: input.studentUid,
      ownerUid: submission.ownerUid,
      verificationTitle: submission.verificationTitle ?? '',
      className: submission.className ?? null,
      deliveryCode: decision.deliveryCode,
      submittedAt: now,
      forcedByTeacher: true,
    },
  };
}
