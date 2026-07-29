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

/**
 * Dimensione **reale in byte UTF-8**. Il limite Firestore sugli id documento è
 * espresso in byte, non in caratteri: `'é'` occupa 2 byte e un'emoji ne occupa
 * 4, quindi contare i caratteri (o le UTF-16 code unit) sottostima il limite e
 * lascerebbe passare id che Firestore rifiuta.
 */
export function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (const codePoint of value) {
    const cp = codePoint.codePointAt(0)!;
    if (cp < 0x80) bytes += 1;
    else if (cp < 0x800) bytes += 2;
    else if (cp < 0x10000) bytes += 3;
    else bytes += 4;
  }
  return bytes;
}

/** Limite Firestore per un id documento, in byte UTF-8. */
export const MAX_DOCUMENT_ID_BYTES = 1500;

/**
 * Un id documento Firestore valido: non vuoto, senza '/', diverso da '.'/'..',
 * non nella forma riservata `__…__`, senza caratteri di controllo, e — verificato
 * sui **byte UTF-8** — entro il limite di 1500 byte.
 */
export function isValidDocumentId(value: string): boolean {
  if (value.length === 0) return false;
  if (utf8ByteLength(value) > MAX_DOCUMENT_ID_BYTES) return false;
  if (value.includes('/')) return false;
  if (value === '.' || value === '..') return false;
  if (value.startsWith('__') && value.endsWith('__')) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(value)) return false;
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
  if (typeof verificationId !== 'string' || !isValidDocumentId(verificationId)) {
    throw new ForceSubmitError('invalid_input', 'verificationId non valido.');
  }
  if (typeof studentUid !== 'string' || !isValidDocumentId(studentUid)) {
    throw new ForceSubmitError('invalid_input', 'studentUid non valido.');
  }
  // L'id concatenato è a sua volta un id documento e ha lo stesso limite: due
  // segmenti singolarmente validi possono comporre un id troppo lungo. Va
  // verificato **prima** di costruire qualunque DocumentReference.
  if (!isValidDocumentId(submissionIdFor(verificationId, studentUid))) {
    throw new ForceSubmitError('invalid_input', 'Identificatore consegna non valido.');
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
  verificationTitle: unknown;
  className: unknown;
  submittedAt: unknown;
}

export interface ReceiptSnapshot {
  submissionId: unknown;
  verificationId: unknown;
  studentUid: unknown;
  ownerUid: unknown;
  deliveryCode: unknown;
  forcedByTeacher: unknown;
  verificationTitle: unknown;
  className: unknown;
  submittedAt: unknown;
}

// ── Validazione fail-closed dei metadati ───────────────────────────────────────

/**
 * Confronto **deterministico** di due timestamp Firestore. Restituisce una
 * chiave canonica `"<secondi>.<nanosecondi>"` oppure `null` se il valore non è
 * un timestamp riconoscibile. Non usa `Date.now()` né l'identità degli oggetti:
 * due `Timestamp` distinti che rappresentano lo stesso istante danno la stessa
 * chiave, e un valore assente/malformato non è mai «uguale» a nulla.
 */
export function timestampKey(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  const rawSeconds = typeof v.seconds === 'number' ? v.seconds : v._seconds;
  const rawNanos = typeof v.nanoseconds === 'number' ? v.nanoseconds : v._nanoseconds;
  if (typeof rawSeconds !== 'number' || !Number.isSafeInteger(rawSeconds)) return null;
  const nanos = rawNanos === undefined ? 0 : rawNanos;
  if (typeof nanos !== 'number' || !Number.isInteger(nanos) || nanos < 0 || nanos >= 1e9) {
    return null;
  }
  return `${rawSeconds}.${String(nanos).padStart(9, '0')}`;
}

/** Due timestamp coerenti: entrambi riconoscibili e riferiti allo stesso istante. */
export function sameTimestamp(a: unknown, b: unknown): boolean {
  const keyA = timestampKey(a);
  return keyA !== null && keyA === timestampKey(b);
}

/** Limite prudenziale della lunghezza dei metadati testuali copiati sulla ricevuta. */
export const MAX_METADATA_LENGTH = 1000;

/**
 * Stringa canonica: non vuota anche dopo il trim, entro il limite e priva di
 * caratteri di controllo. Non normalizza nulla — o il dato è valido, o è un
 * errore.
 */
export function isCanonicalMetadataString(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (value.trim().length === 0) return false;
  if (value.length > MAX_METADATA_LENGTH) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(value)) return false;
  return true;
}

/** `className` ammette esplicitamente `null` (verifica senza classe assegnata). */
export function isValidClassName(value: unknown): value is string | null {
  return value === null || isCanonicalMetadataString(value);
}

/** Un uid canonico: stringa non vuota, entro il limite, senza caratteri di controllo. */
function isCanonicalUid(value: unknown): value is string {
  return isCanonicalMetadataString(value) && !(value as string).includes('/');
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
  | {
      kind: 'apply';
      submissionId: string;
      deliveryCode: string;
      /** Metadati **già validati**: la ricevuta non ne normalizza né inventa alcuno. */
      ownerUid: string;
      verificationTitle: string;
      className: string | null;
    }
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

  /*
   * Coerenza della ricevuta rispetto alla submission, valutata sui **campi
   * completi**: identità, codice consegna, istante di consegna e metadati
   * copiati. Una ricevuta assente, malformata o divergente in un solo campo
   * rende lo stato incoerente — non la si «ripara» mai.
   */
  function receiptMatchesSubmission(): boolean {
    return (
      receipt !== null &&
      receipt.submissionId === expectedId &&
      receipt.verificationId === input.verificationId &&
      receipt.studentUid === input.studentUid &&
      receipt.ownerUid === callerUid &&
      isCanonicalDeliveryCode(receipt.deliveryCode) &&
      receipt.deliveryCode === submission!.deliveryCode &&
      sameTimestamp(receipt.submittedAt, submission!.submittedAt) &&
      isCanonicalMetadataString(receipt.verificationTitle) &&
      receipt.verificationTitle === submission!.verificationTitle &&
      isValidClassName(receipt.className) &&
      receipt.className === submission!.className
    );
  }

  if (submission.status === 'submitted') {
    if (submission.forcedByTeacher === true) {
      // Replay di una chiusura forzata: la ricevuta deve esistere, combaciare in
      // ogni campo e portare a sua volta il marcatore.
      if (!receiptMatchesSubmission() || receipt!.forcedByTeacher !== true) {
        throw new ForceSubmitError(
          'failed_precondition',
          'Consegna già chiusa ma ricevuta mancante o incoerente.',
        );
      }
      return { kind: 'already_forced' };
    }

    if (submission.forcedByTeacher !== undefined) {
      // `false`, `null` o qualunque altro valore: il marcatore è per contratto
      // presente-e-`true` oppure completamente assente.
      throw new ForceSubmitError('failed_precondition', 'Consegna in stato incoerente.');
    }

    /*
     * Consegna **normale** dello studente: non viene mai sovrascritta, ma
     * confermarla richiede comunque che la ricevuta esista e sia coerente. Su
     * entrambi i documenti il marcatore deve essere completamente assente:
     * una consegna normale con marcatore è uno stato che non può esistere.
     */
    if (!receiptMatchesSubmission() || receipt!.forcedByTeacher !== undefined) {
      throw new ForceSubmitError(
        'failed_precondition',
        'Consegna già effettuata ma ricevuta mancante o incoerente.',
      );
    }
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
  // …né può avere una ricevuta: la ricevuta nasce solo con la consegna. Se
  // esiste, lo stato è incoerente e non va né sovrascritto né «riparato».
  if (receipt !== null) {
    throw new ForceSubmitError(
      'failed_precondition',
      'Consegna in bozza con ricevuta già esistente.',
    );
  }

  /*
   * Metadati che finiranno sulla ricevuta: validati **prima** di qualunque
   * scrittura. Nessun fallback, nessuna normalizzazione silenziosa — un titolo
   * mancante o una classe malformata sono un errore, non un valore da inventare.
   */
  if (!isCanonicalUid(submission.ownerUid)) {
    throw new ForceSubmitError('failed_precondition', 'Consegna con proprietario non valido.');
  }
  if (!isCanonicalMetadataString(submission.verificationTitle)) {
    throw new ForceSubmitError('failed_precondition', 'Consegna senza titolo verifica valido.');
  }
  if (!isValidClassName(submission.className)) {
    throw new ForceSubmitError('failed_precondition', 'Consegna con classe non valida.');
  }

  return {
    kind: 'apply',
    submissionId: expectedId,
    deliveryCode: deliveryCodeFor(),
    ownerUid: submission.ownerUid,
    verificationTitle: submission.verificationTitle,
    className: submission.className,
  };
}

// ── Payload delle due (sole) scritture ─────────────────────────────────────────

export interface ForceSubmitWrites {
  /** Update **mirato** della submission: esattamente questi quattro campi. */
  submissionUpdate: Record<string, unknown>;
  /** Ricevuta deterministica, composta solo da dati server-side già validati. */
  receipt: Record<string, unknown>;
}

/**
 * Compone le due scritture atomiche della chiusura forzata. Funzione pura: il
 * timestamp del server è iniettato, così il contenuto esatto (e soprattutto ciò
 * che **non** contiene) è verificabile senza Admin SDK.
 *
 * Tutti i valori arrivano dalla decisione, dove sono già stati validati
 * fail-closed: qui non esistono fallback né normalizzazioni.
 *
 * `lastSavedAt`, `answers`, `flagged`, `attentionEvents`,
 * `assignedQuestionOrders`, `assignedAnswerKeys` e `startedAt` non compaiono di
 * proposito: la chiusura non tocca né i contenuti né la traccia dell'ultimo
 * salvataggio reale dello studente.
 */
export function forceSubmitWrites(
  decision: Extract<ForceSubmitDecision, { kind: 'apply' }>,
  input: ForceSubmitInput,
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
      ownerUid: decision.ownerUid,
      verificationTitle: decision.verificationTitle,
      className: decision.className,
      deliveryCode: decision.deliveryCode,
      submittedAt: now,
      forcedByTeacher: true,
    },
  };
}
