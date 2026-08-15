/**
 * VEX-01B — nucleo **puro** e testabile della callable `assignVerificationVariant`
 * (nessun import Firebase/Admin/rete). Valida input e autorizzazione fail-closed,
 * decide l'assegnazione idempotente e sanitizza la risposta. Il wiring Admin SDK
 * (`verificationVariantGateway.ts`) fornisce le porte di lettura/transazione.
 */

import {
  isValidResolvedAssignment,
  parseResolvableSnapshot,
  resolveDifferentiatedOrders,
  sanitizeResolvedQuestions,
  VexAssignmentError,
  type RandomIntBelow,
  type ResolvableSnapshot,
  type VexAssignedQuestion,
} from './verificationVariantCore.js';

export type AssignErrorCode =
  | 'unauthenticated'
  | 'invalid_input'
  | 'not_found'
  | 'permission_denied'
  | 'failed_precondition';

export class AssignGatewayError extends Error {
  readonly code: AssignErrorCode;
  constructor(code: AssignErrorCode, message: string) {
    super(message);
    this.name = 'AssignGatewayError';
    this.code = code;
  }
}

/** Traduce un errore del core puro nel codice gateway corrispondente. */
function fromCoreError(err: VexAssignmentError): AssignGatewayError {
  if (err.code === 'wrong_mode') {
    return new AssignGatewayError('failed_precondition', err.message);
  }
  // invalid_snapshot / invalid_assignment: dati server incoerenti ⇒ fail-closed,
  // nessuna rigenerazione silenziosa, nessun dettaglio sensibile esposto.
  return new AssignGatewayError('failed_precondition', err.message);
}

// ── Input chiuso ───────────────────────────────────────────────────────────────

export interface AssignInput {
  verificationId: string;
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
 * Parsing **chiuso** dell'input: deve essere un plain-object con la sola chiave
 * `verificationId` (stringa, segmento Firestore valido). Proprietà extra, tipi
 * non-oggetto e id malformati sono rifiutati (`invalid_input`).
 */
export function parseAssignInput(raw: unknown): AssignInput {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new AssignGatewayError('invalid_input', 'Input non valido.');
  }
  const keys = Object.keys(raw);
  if (keys.length !== 1 || keys[0] !== 'verificationId') {
    throw new AssignGatewayError('invalid_input', 'Input non valido: chiavi non ammesse.');
  }
  const verificationId = (raw as Record<string, unknown>).verificationId;
  if (typeof verificationId !== 'string' || !isValidFirestoreSegment(verificationId)) {
    throw new AssignGatewayError('invalid_input', 'verificationId non valido.');
  }
  return { verificationId };
}

// ── Porte (fornite dal wiring Admin SDK; nei test dei fake in-memory) ───────────

export interface VerificationContext {
  ownerUid: string;
  status: string;
  onlineEnabled: boolean;
  studentPdfEnabled: boolean;
  visibility: string;
  classId: string | null;
  title: string;
  className: string | null;
  /** teacherSnapshot grezzo (owner-only), mai esposto al client. */
  teacherSnapshotRaw: unknown;
}

export interface StudentContext {
  ownerUid: string;
  status: string;
  classId: string | null;
}

export interface PersistAssignmentInput {
  submissionId: string;
  verificationId: string;
  studentUid: string;
  ownerUid: string;
  verificationTitle: string;
  className: string | null;
  snapshot: ResolvableSnapshot;
  randomIntBelow: RandomIntBelow;
}

export interface PersistAssignmentResult {
  assignedQuestionOrders: number[];
  /** Numero di scritture effettuate (0 = riuso idempotente). Per test/telemetria. */
  writes: number;
}

export interface AssignVariantDeps {
  callerUid: string | null;
  /** Portale studenti abilitato (settings/studentAccess). */
  portalEnabled(): Promise<boolean>;
  loadVerification(verificationId: string): Promise<VerificationContext | null>;
  loadStudent(uid: string): Promise<StudentContext | null>;
  /** Transazione idempotente read-or-assign su `submissions/{submissionId}`. */
  persistAssignment(input: PersistAssignmentInput): Promise<PersistAssignmentResult>;
  randomIntBelow: RandomIntBelow;
}

export interface ResolveStudentPdfDeps {
  callerUid: string | null;
  portalEnabled(): Promise<boolean>;
  loadVerification(verificationId: string): Promise<VerificationContext | null>;
  loadStudent(uid: string): Promise<StudentContext | null>;
  /**
   * Transazione read-or-assign separata dalla submission: scaricare il PDF non
   * deve far apparire la verifica come iniziata.
   */
  persistPdfAssignment(input: PersistAssignmentInput): Promise<PersistAssignmentResult>;
  randomIntBelow: RandomIntBelow;
}

export interface AssignResponse {
  /**
   * VDIF-04 — la risposta dichiara il **canale**, non la natura della verifica.
   * `server_resolved` è lo stesso valore che VEX produrrebbe da solo: il client
   * non può dedurre da qui se la verifica sia differenziata, e non ha motivo di
   * saperlo.
   */
  assignmentMode: 'server_resolved';
  assignedQuestionOrders: number[];
  questions: VexAssignedQuestion[];
}

/** id deterministico della submission: `${verificationId}_${studentUid}`. */
export function submissionIdFor(verificationId: string, studentUid: string): string {
  return `${verificationId}_${studentUid}`;
}

// ── Decisione pura dell'assegnazione (usata dentro la transazione) ──────────────

export interface ExistingSubmissionState {
  exists: boolean;
  assignedQuestionOrders?: number[];
}

export type AssignmentDecision =
  | { kind: 'reuse'; assignedQuestionOrders: number[] }
  | { kind: 'update'; assignedQuestionOrders: number[] }
  | { kind: 'create'; assignedQuestionOrders: number[] };

/**
 * Decide l'assegnazione **dentro** la transazione, a partire dallo stato letto
 * della submission:
 * - assegnazione già presente e **valida** ⇒ `reuse` (nessuna scrittura, nessun
 *   ri-sorteggio);
 * - assegnazione presente ma **invalida** ⇒ errore fail-closed (nessuna
 *   rigenerazione silenziosa);
 * - submission esistente senza assegnazione ⇒ genera e `update`;
 * - submission assente ⇒ genera e `create`.
 *
 * VDIF-04: la validità di un'assegnazione già persistita dipende ora anche
 * dall'etichetta congelata dello studente, quindi `studentUid` entra nella
 * firma. Idempotenza, replay e retry restano quelli di VEX — è la stessa
 * transazione read-or-assign, con un criterio di calcolo diverso.
 */
export function decideAssignment(
  existing: ExistingSubmissionState,
  snapshot: ResolvableSnapshot,
  studentUid: string,
  randomIntBelow: RandomIntBelow,
): AssignmentDecision {
  if (existing.exists && existing.assignedQuestionOrders !== undefined) {
    if (!isValidResolvedAssignment(snapshot, studentUid, existing.assignedQuestionOrders)) {
      throw new VexAssignmentError(
        'invalid_assignment',
        'Assegnazione persistita non coerente con lo snapshot.',
      );
    }
    return { kind: 'reuse', assignedQuestionOrders: existing.assignedQuestionOrders };
  }
  const assignedQuestionOrders = resolveDifferentiatedOrders(snapshot, studentUid, randomIntBelow);
  return existing.exists
    ? { kind: 'update', assignedQuestionOrders }
    : { kind: 'create', assignedQuestionOrders };
}

// ── Orchestrazione ──────────────────────────────────────────────────────────────

/**
 * Punto d'ingresso puro: valida input+auth (fail-closed), assegna in modo
 * idempotente e restituisce **solo** le domande assegnate sanitizzate. Non
 * espone mai soluzioni, alternative non assegnate, teacherSnapshot, gruppi o
 * dati di altri studenti.
 */
export async function runAssignVariant(
  raw: unknown,
  deps: AssignVariantDeps,
): Promise<AssignResponse> {
  const input = parseAssignInput(raw);

  const callerUid = deps.callerUid;
  if (!callerUid) {
    throw new AssignGatewayError('unauthenticated', 'Autenticazione richiesta.');
  }

  if (!(await deps.portalEnabled())) {
    throw new AssignGatewayError('failed_precondition', 'Portale studenti non attivo.');
  }

  const verification = await deps.loadVerification(input.verificationId);
  if (!verification) {
    throw new AssignGatewayError('not_found', 'Verifica non trovata.');
  }

  const student = await deps.loadStudent(callerUid);
  if (!student || student.status !== 'approved' || student.ownerUid !== verification.ownerUid) {
    throw new AssignGatewayError('permission_denied', 'Studente non autorizzato.');
  }

  // Vincoli server-side identici al portale/regole di submission.
  if (verification.status !== 'active') {
    throw new AssignGatewayError('failed_precondition', 'La verifica non è attiva.');
  }
  if (!verification.onlineEnabled) {
    throw new AssignGatewayError('failed_precondition', 'Lo svolgimento online non è abilitato.');
  }
  if (verification.classId === null || verification.classId !== student.classId) {
    throw new AssignGatewayError(
      'permission_denied',
      'La verifica non è assegnata alla tua classe.',
    );
  }

  // Snapshot risolvibile dal server: `parseResolvableSnapshot` copre i tre casi
  // reali — solo VEX, solo differenziazione, entrambe — e valida modalità e
  // struttura fail-closed. Una verifica che non richiede assegnazione dal
  // server viene rifiutata qui: il client non deve arrivarci.
  let snapshot: ResolvableSnapshot;
  try {
    snapshot = parseResolvableSnapshot(verification.teacherSnapshotRaw);
  } catch (err) {
    if (err instanceof VexAssignmentError) throw fromCoreError(err);
    throw err;
  }

  const submissionId = submissionIdFor(input.verificationId, callerUid);
  let persisted: PersistAssignmentResult;
  try {
    persisted = await deps.persistAssignment({
      submissionId,
      verificationId: input.verificationId,
      studentUid: callerUid,
      ownerUid: verification.ownerUid,
      verificationTitle: verification.title,
      className: verification.className,
      snapshot,
      randomIntBelow: deps.randomIntBelow,
    });
  } catch (err) {
    if (err instanceof VexAssignmentError) throw fromCoreError(err);
    throw err;
  }

  return {
    assignmentMode: 'server_resolved',
    assignedQuestionOrders: persisted.assignedQuestionOrders,
    // Solo le domande realmente assegnate: mai un'alternativa non assegnata,
    // mai una soluzione, mai un'etichetta o un motivo della selezione.
    questions: sanitizeResolvedQuestions(snapshot, persisted.assignedQuestionOrders),
  };
}

/**
 * Risolve il PDF personale di una verifica `server_resolved` senza creare una
 * submission. Il toggle docente è verificato sul documento autorevole e la
 * risposta contiene soltanto le domande assegnate e sanitizzate.
 */
export async function runResolveStudentPdf(
  raw: unknown,
  deps: ResolveStudentPdfDeps,
): Promise<AssignResponse> {
  const input = parseAssignInput(raw);
  const callerUid = deps.callerUid;
  if (!callerUid) {
    throw new AssignGatewayError('unauthenticated', 'Autenticazione richiesta.');
  }
  if (!(await deps.portalEnabled())) {
    throw new AssignGatewayError('failed_precondition', 'Portale studenti non attivo.');
  }

  const verification = await deps.loadVerification(input.verificationId);
  if (!verification) {
    throw new AssignGatewayError('not_found', 'Verifica non trovata.');
  }
  const student = await deps.loadStudent(callerUid);
  if (!student || student.status !== 'approved' || student.ownerUid !== verification.ownerUid) {
    throw new AssignGatewayError('permission_denied', 'Studente non autorizzato.');
  }
  if (verification.status !== 'active' && verification.status !== 'closed') {
    throw new AssignGatewayError('failed_precondition', 'La verifica non è disponibile.');
  }
  if (verification.visibility !== 'public' || !verification.studentPdfEnabled) {
    throw new AssignGatewayError('failed_precondition', 'Il PDF non è disponibile.');
  }
  if (verification.classId === null || verification.classId !== student.classId) {
    throw new AssignGatewayError(
      'permission_denied',
      'La verifica non è assegnata alla tua classe.',
    );
  }

  let snapshot: ResolvableSnapshot;
  try {
    snapshot = parseResolvableSnapshot(verification.teacherSnapshotRaw);
  } catch (err) {
    if (err instanceof VexAssignmentError) throw fromCoreError(err);
    throw err;
  }

  let persisted: PersistAssignmentResult;
  try {
    persisted = await deps.persistPdfAssignment({
      submissionId: submissionIdFor(input.verificationId, callerUid),
      verificationId: input.verificationId,
      studentUid: callerUid,
      ownerUid: verification.ownerUid,
      verificationTitle: verification.title,
      className: verification.className,
      snapshot,
      randomIntBelow: deps.randomIntBelow,
    });
  } catch (err) {
    if (err instanceof VexAssignmentError) throw fromCoreError(err);
    throw err;
  }

  return {
    assignmentMode: 'server_resolved',
    assignedQuestionOrders: persisted.assignedQuestionOrders,
    questions: sanitizeResolvedQuestions(snapshot, persisted.assignedQuestionOrders),
  };
}
