/**
 * FORCE-SUBMIT-02 — nucleo **puro** e testabile della chiusura multipla con
 * preavviso (nessun import Firebase/Admin/rete).
 *
 * Il docente seleziona più consegne e ne programma la chiusura: gli studenti
 * interessati hanno una finestra fissa di 60 secondi per salvare o consegnare,
 * poi una task server-side acquisisce l'ultima versione **già salvata**.
 *
 * Due momenti distinti, entrambi decisi qui:
 *  1. **programmazione** (callable batch): per ogni studente si decide se c'è
 *     qualcosa da programmare e si compone il marcatore server-only;
 *  2. **esecuzione** (task queue, +60s): si rilegge lo stato autorevole, si
 *     valida la richiesta e si delega la transizione al core FORCE-SUBMIT-01.
 *
 * Nessuna Function resta in attesa per 60 secondi e nessun timer del browser
 * partecipa alla decisione: la scadenza vive su Cloud Tasks e sul documento.
 */

import {
  isCanonicalMetadataString,
  isValidDocumentId,
  submissionIdFor,
  timestampKey,
  type ForceSubmitInput,
} from './forceSubmitCore.js';

export type ForceCloseErrorCode =
  | 'unauthenticated'
  | 'invalid_input'
  | 'not_found'
  | 'permission_denied'
  | 'failed_precondition';

export class ForceCloseError extends Error {
  readonly code: ForceCloseErrorCode;
  constructor(code: ForceCloseErrorCode, message: string) {
    super(message);
    this.name = 'ForceCloseError';
    this.code = code;
  }
}

// ── Costanti di contratto ──────────────────────────────────────────────────────

/**
 * Finestra di preavviso, in secondi. **Fissa**: non è configurabile dal client
 * né dal docente, così la promessa fatta allo studente è sempre la stessa.
 */
export const FORCE_CLOSE_GRACE_SECONDS = 60;

/**
 * Tetto esplicito di una programmazione batch. Dimensionato su una classe
 * abbondante: oltre questo numero la richiesta è rifiutata invece di generare
 * silenziosamente centinaia di task.
 */
export const MAX_FORCE_CLOSE_BATCH = 60;

/** Lunghezza del `requestId` opaco. */
const REQUEST_ID_LENGTH = 24;
const REQUEST_ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** Sorgente di casualità iniettabile: `[0, max)`. */
export type RandomIntBelow = (max: number) => number;

/**
 * Identificatore **opaco** della programmazione: non contiene uid, id verifica
 * né istanti, e serve solo a legare la task alla richiesta che l'ha creata.
 */
export function generateRequestId(randomIntBelow: RandomIntBelow): string {
  let out = '';
  for (let i = 0; i < REQUEST_ID_LENGTH; i += 1) {
    out += REQUEST_ID_ALPHABET[randomIntBelow(REQUEST_ID_ALPHABET.length)];
  }
  return out;
}

/** Riconosce un `requestId` nella forma canonica (usato per validare una task). */
export function isCanonicalRequestId(value: unknown): value is string {
  return typeof value === 'string' && new RegExp(`^[a-z0-9]{${REQUEST_ID_LENGTH}}$`).test(value);
}

// ── Input chiuso della callable batch ──────────────────────────────────────────

export interface ScheduleForceCloseInput {
  verificationId: string;
  studentUids: string[];
}

/**
 * Parsing **chiuso**: esattamente `verificationId` e `studentUids`. Ogni altra
 * chiave è rifiutata — in particolare `ownerUid`, `submissionId`, `deadline`,
 * `requestId`, `status` e `forcedByTeacher`, che sono derivati server-side.
 *
 * Gli uid devono essere unici e ciascuno, insieme all'id consegna concatenato,
 * un document id Firestore valido **in byte UTF-8**: la validazione avviene
 * prima che il gateway costruisca qualunque `DocumentReference`.
 */
export function parseScheduleForceCloseInput(raw: unknown): ScheduleForceCloseInput {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new ForceCloseError('invalid_input', 'Input non valido.');
  }
  const keys = Object.keys(raw).sort();
  if (keys.length !== 2 || keys[0] !== 'studentUids' || keys[1] !== 'verificationId') {
    throw new ForceCloseError('invalid_input', 'Input non valido: chiavi non ammesse.');
  }
  const { verificationId, studentUids } = raw as Record<string, unknown>;
  if (typeof verificationId !== 'string' || !isValidDocumentId(verificationId)) {
    throw new ForceCloseError('invalid_input', 'verificationId non valido.');
  }
  if (!Array.isArray(studentUids) || studentUids.length === 0) {
    throw new ForceCloseError('invalid_input', 'Nessuno studente indicato.');
  }
  if (studentUids.length > MAX_FORCE_CLOSE_BATCH) {
    throw new ForceCloseError(
      'invalid_input',
      `Troppe consegne in una sola richiesta (massimo ${MAX_FORCE_CLOSE_BATCH}).`,
    );
  }
  const seen = new Set<string>();
  for (const uid of studentUids) {
    if (typeof uid !== 'string' || !isValidDocumentId(uid)) {
      throw new ForceCloseError('invalid_input', 'studentUid non valido.');
    }
    if (seen.has(uid)) {
      throw new ForceCloseError('invalid_input', 'studentUid duplicato.');
    }
    if (!isValidDocumentId(submissionIdFor(verificationId, uid))) {
      throw new ForceCloseError('invalid_input', 'Identificatore consegna non valido.');
    }
    seen.add(uid);
  }
  return { verificationId, studentUids: [...studentUids] as string[] };
}

// ── Programmazione: eleggibilità per studente ──────────────────────────────────

/**
 * Istantanea della submission usata in programmazione. È un sottoinsieme di ciò
 * che legge FORCE-SUBMIT-01: qui interessa solo se c'è una bozza da chiudere e
 * se una chiusura è già programmata.
 */
export interface ScheduleSubmissionSnapshot {
  submissionId: unknown;
  verificationId: unknown;
  studentUid: unknown;
  ownerUid: unknown;
  status: unknown;
  forcedByTeacher: unknown;
  forceCloseRequestId: unknown;
  forceCloseDeadline: unknown;
  forceCloseRequestedAt: unknown;
}

/**
 * I tre marcatori sono un **unico** fatto: o ci sono tutti e sono ben formati,
 * o non c'è nessuno. Uno stato parziale non viene mai «riparato» in silenzio.
 */
export type MarkerState =
  | { kind: 'absent' }
  | { kind: 'present'; requestId: string; deadlineKey: string }
  | { kind: 'malformed' };

export function readMarkerState(submission: {
  forceCloseRequestId: unknown;
  forceCloseDeadline: unknown;
  forceCloseRequestedAt: unknown;
}): MarkerState {
  const present = [
    submission.forceCloseRequestId,
    submission.forceCloseDeadline,
    submission.forceCloseRequestedAt,
  ].filter((v) => v !== undefined).length;
  if (present === 0) return { kind: 'absent' };
  if (present !== 3) return { kind: 'malformed' };
  const deadlineKey = timestampKey(submission.forceCloseDeadline);
  if (
    !isCanonicalRequestId(submission.forceCloseRequestId) ||
    deadlineKey === null ||
    timestampKey(submission.forceCloseRequestedAt) === null
  ) {
    return { kind: 'malformed' };
  }
  return { kind: 'present', requestId: submission.forceCloseRequestId, deadlineKey };
}

/**
 * Esito **per studente** della programmazione. `scheduled` è l'unico caso che
 * produce una scrittura e una task.
 *
 * `already_scheduled` è deliberatamente un **no-op riuscito** e non un errore:
 * un doppio click o un retry non devono generare una seconda task.
 */
export type ScheduleOutcome =
  | 'scheduled'
  | 'already_scheduled'
  | 'not_started'
  | 'already_submitted'
  | 'incoherent';

export interface ScheduleDecisionContext {
  callerUid: string;
  verificationId: string;
  studentUid: string;
  submission: ScheduleSubmissionSnapshot | null;
}

/**
 * Decide cosa fare per **un** singolo studente. Nessun caso crea una consegna:
 * se la submission non esiste l'esito è `not_started` e non si scrive nulla.
 *
 * Una correzione non è mai possibile su una bozza (le correzioni esistono solo
 * su consegne `submitted`), quindi non serve leggerla: lo stato `draft` è già
 * la garanzia. L'esclusione «correzione avviata» resta un concetto della UI,
 * che dispone del progresso già in memoria.
 */
export function decideScheduleFor(context: ScheduleDecisionContext): ScheduleOutcome {
  const { callerUid, verificationId, studentUid, submission } = context;
  if (!submission) return 'not_started';

  const expectedId = submissionIdFor(verificationId, studentUid);
  const coherent =
    submission.submissionId === expectedId &&
    submission.verificationId === verificationId &&
    submission.studentUid === studentUid &&
    submission.ownerUid === callerUid;
  if (!coherent) return 'incoherent';

  if (submission.status === 'submitted') return 'already_submitted';
  if (submission.status !== 'draft') return 'incoherent';
  // Una bozza non può portare il marcatore di chiusura effettuata.
  if (submission.forcedByTeacher !== undefined) return 'incoherent';

  // I tre marcatori vivono e muoiono insieme: uno stato parziale o malformato è
  // incoerente e non viene sovrascritto.
  const markers = readMarkerState(submission);
  if (markers.kind === 'malformed') return 'incoherent';
  if (markers.kind === 'present') return 'already_scheduled';
  return 'scheduled';
}

// ── Payload della (sola) scrittura di programmazione ───────────────────────────

export interface ScheduleWrite {
  /** Update **mirato** della submission: soltanto i tre marcatori server-only. */
  submissionUpdate: Record<string, unknown>;
}

/**
 * Marcatori server-only della chiusura programmata. Funzione pura: i timestamp
 * sono iniettati, così il contenuto esatto è verificabile senza Admin SDK.
 *
 * Non compaiono — di proposito — `status`, `answers`, `flagged`,
 * `attentionEvents`, `lastSavedAt`, `submittedAt`, `deliveryCode`: programmare
 * una chiusura **non** consegna nulla e non tocca il lavoro dello studente, che
 * fino alla scadenza può ancora salvare e consegnare normalmente.
 */
export function scheduleWrite(
  requestId: string,
  deadline: unknown,
  requestedAt: unknown,
): ScheduleWrite {
  return {
    submissionUpdate: {
      forceCloseRequestId: requestId,
      forceCloseDeadline: deadline,
      forceCloseRequestedAt: requestedAt,
    },
  };
}

/** Campi da azzerare quando la chiusura viene eseguita (o diventa obsoleta). */
export const FORCE_CLOSE_MARKER_FIELDS = [
  'forceCloseRequestId',
  'forceCloseDeadline',
  'forceCloseRequestedAt',
] as const;

// ── Esito sanitizzato restituito al docente ────────────────────────────────────

export interface ScheduleStudentResult {
  studentUid: string;
  /**
   * `failed` — l'operazione non è riuscita ma non ha lasciato traccia.
   * `failed_cleanup` — la programmazione è stata scritta, l'accodamento è
   * fallito **e** la compensazione non è riuscita: lo studente potrebbe vedere
   * un banner senza chiusura. È uno stato esplicito e azionabile, mai
   * confuso con un successo.
   */
  outcome: ScheduleOutcome | 'failed' | 'failed_cleanup';
}

export interface ScheduleForceCloseResult {
  /** Secondi di preavviso concessi: sempre la costante di contratto. */
  graceSeconds: number;
  /** Un esito per studente richiesto, senza contenuti, codici o timestamp. */
  results: ScheduleStudentResult[];
}

/**
 * Risposta sanitizzata: nessuna risposta, nessun flag, nessun `attentionEvent`,
 * nessun codice consegna, nessun `requestId`, nessuna deadline. Solo l'esito.
 */
export function scheduleResult(results: ScheduleStudentResult[]): ScheduleForceCloseResult {
  return {
    graceSeconds: FORCE_CLOSE_GRACE_SECONDS,
    results: results.map((r) => ({ studentUid: r.studentUid, outcome: r.outcome })),
  };
}

// ── Esecuzione: payload della task ─────────────────────────────────────────────

export interface ForceCloseTaskPayload {
  verificationId: string;
  studentUid: string;
  ownerUid: string;
  requestId: string;
  /**
   * Scadenza **canonica** della programmazione, in millisecondi epoch. Viaggia
   * nel payload perché la task deve poter riconoscere una programmazione
   * *sostituita* anche quando il `requestId` coincidesse per errore, e perché
   * deve sapere se sta girando **prima** del tempo (consegna anticipata della
   * coda) senza fidarsi del solo documento.
   */
  deadlineMs: number;
}

/**
 * Il payload della task è prodotto da noi, ma viene comunque validato in modo
 * **chiuso** all'arrivo: una coda è un canale, e un canale non è mai una fonte
 * di verità. Chiavi extra, id malformati, `requestId` non canonico o deadline
 * non finita ⇒ errore.
 */
export function parseForceCloseTaskPayload(raw: unknown): ForceCloseTaskPayload {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new ForceCloseError('invalid_input', 'Payload task non valido.');
  }
  const keys = Object.keys(raw).sort();
  const expected = ['deadlineMs', 'ownerUid', 'requestId', 'studentUid', 'verificationId'];
  if (keys.length !== expected.length || expected.some((k, i) => keys[i] !== k)) {
    throw new ForceCloseError('invalid_input', 'Payload task non valido: chiavi non ammesse.');
  }
  const { verificationId, studentUid, ownerUid, requestId, deadlineMs } = raw as Record<
    string,
    unknown
  >;
  if (typeof verificationId !== 'string' || !isValidDocumentId(verificationId)) {
    throw new ForceCloseError('invalid_input', 'verificationId non valido.');
  }
  if (typeof studentUid !== 'string' || !isValidDocumentId(studentUid)) {
    throw new ForceCloseError('invalid_input', 'studentUid non valido.');
  }
  if (!isCanonicalMetadataString(ownerUid) || ownerUid.includes('/')) {
    throw new ForceCloseError('invalid_input', 'ownerUid non valido.');
  }
  if (!isCanonicalRequestId(requestId)) {
    throw new ForceCloseError('invalid_input', 'requestId non valido.');
  }
  if (typeof deadlineMs !== 'number' || !Number.isSafeInteger(deadlineMs) || deadlineMs <= 0) {
    throw new ForceCloseError('invalid_input', 'deadlineMs non valido.');
  }
  if (!isValidDocumentId(submissionIdFor(verificationId, studentUid))) {
    throw new ForceCloseError('invalid_input', 'Identificatore consegna non valido.');
  }
  return { verificationId, studentUid, ownerUid, requestId, deadlineMs };
}

/** L'input FORCE-SUBMIT-01 corrispondente a una task. */
export function forceSubmitInputForTask(payload: ForceCloseTaskPayload): ForceSubmitInput {
  return { verificationId: payload.verificationId, studentUid: payload.studentUid };
}

/**
 * Nome deterministico della Cloud Task, derivato dal `requestId` opaco. Cloud
 * Tasks rifiuta un nome già usato: accodare due volte la **stessa**
 * programmazione è quindi impossibile, anche se la callable viene ritentata.
 * Il nome non contiene uid né id verifica.
 */
export function taskNameFor(requestId: string): string {
  if (!isCanonicalRequestId(requestId)) {
    throw new ForceCloseError('invalid_input', 'requestId non valido.');
  }
  return `fc-${requestId}`;
}

/**
 * Esito della decisione di esecuzione. Ogni via è **terminale e non ambigua**:
 * non esiste un percorso che lasci una scadenza superata con i marcatori ancora
 * presenti e nessuna ricevuta.
 *
 * - `run` — la bozza porta ancora **esattamente** questa programmazione e la
 *   scadenza è passata: si chiude.
 * - `too_early` — la coda ha consegnato in anticipo: **non** si chiude prima
 *   della scadenza, si lascia ritentare.
 * - `cleanup` — questa programmazione non è più eseguibile ma i suoi marcatori
 *   sono ancora sul documento (tipicamente: lo studente ha consegnato
 *   normalmente durante la finestra). Vanno rimossi, **condizionatamente a
 *   questo `requestId`**, altrimenti lo studente resterebbe con un banner
 *   scaduto e nessuna ricevuta.
 * - `noop` — non c'è nulla da fare **e** nulla da ripulire: consegna eliminata,
 *   programmazione già rimossa, oppure una programmazione **diversa** ha preso
 *   il posto di questa (che non va mai cancellata da noi).
 */
export type ForceCloseTaskDecision =
  | { kind: 'run' }
  | { kind: 'too_early'; remainingMs: number }
  | { kind: 'cleanup'; reason: ForceCloseCleanupReason }
  | { kind: 'noop'; reason: ForceCloseNoopReason };

export type ForceCloseCleanupReason =
  | 'already_submitted'
  | 'already_forced'
  | 'markers_malformed'
  | 'submission_incoherent';

export type ForceCloseNoopReason =
  | 'submission_missing'
  | 'identity_mismatch'
  | 'markers_absent'
  | 'superseded';

export interface ForceCloseTaskContext {
  payload: ForceCloseTaskPayload;
  submission: ScheduleSubmissionSnapshot | null;
  /** Orologio iniettabile: nessun test dipende dal tempo reale. */
  nowMs: number;
}

/**
 * Fail-closed **e** no-op-safe. La task agisce solo se ritrova esattamente la
 * bozza che aveva programmato, con lo stesso `requestId` **e** la stessa
 * scadenza; e solo dopo che la scadenza è realmente passata.
 *
 * Non ripara documenti, non ricrea consegne, non sovrascrive mai una consegna
 * normale e non rimuove mai la programmazione di qualcun altro.
 */
export function decideForceCloseTask(context: ForceCloseTaskContext): ForceCloseTaskDecision {
  const { payload, submission, nowMs } = context;
  if (!submission) return { kind: 'noop', reason: 'submission_missing' };

  const expectedId = submissionIdFor(payload.verificationId, payload.studentUid);
  const identityOk =
    submission.submissionId === expectedId &&
    submission.verificationId === payload.verificationId &&
    submission.studentUid === payload.studentUid &&
    submission.ownerUid === payload.ownerUid;

  const markers = readMarkerState(submission);
  /** I marcatori sul documento appartengono **a questa** programmazione? */
  const isOurs =
    markers.kind === 'present' &&
    markers.requestId === payload.requestId &&
    markers.deadlineKey === millisToTimestampKey(payload.deadlineMs);

  if (!identityOk) {
    // Documento incoerente: se porta comunque i nostri marcatori vanno tolti,
    // altrimenti non è affar nostro.
    return isOurs
      ? { kind: 'cleanup', reason: 'submission_incoherent' }
      : { kind: 'noop', reason: 'identity_mismatch' };
  }

  if (markers.kind === 'absent') return { kind: 'noop', reason: 'markers_absent' };
  if (markers.kind === 'malformed') {
    // Stato parziale: non lo si interpreta, lo si rimuove. È l'unico modo per
    // non lasciare lo studente con un banner che non scadrà mai.
    return { kind: 'cleanup', reason: 'markers_malformed' };
  }
  if (!isOurs) return { kind: 'noop', reason: 'superseded' };

  if (submission.status !== 'draft') {
    // La consegna normale dello studente ha vinto: non la si tocca, ma i
    // marcatori residui vanno rimossi.
    return { kind: 'cleanup', reason: 'already_submitted' };
  }
  if (submission.forcedByTeacher !== undefined) {
    return { kind: 'cleanup', reason: 'already_forced' };
  }

  if (nowMs < payload.deadlineMs) {
    // Consegna anticipata della coda: mai chiudere prima del tempo promesso.
    return { kind: 'too_early', remainingMs: payload.deadlineMs - nowMs };
  }

  return { kind: 'run' };
}

/** Chiave canonica equivalente a `timestampKey`, a partire da millisecondi. */
export function millisToTimestampKey(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const nanos = (ms - seconds * 1000) * 1e6;
  return `${seconds}.${String(nanos).padStart(9, '0')}`;
}
