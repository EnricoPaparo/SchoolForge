/**
 * VISUAL-ENRICHMENT-03A — il **ticket del candidato**: il legame autorevole fra
 * un candidato visuale e la lezione da cui è nato.
 *
 * **Perché esiste.** VE-02 genera un'immagine da un `subject` e basta: la sua
 * richiesta è `{ requestId, subject }`, il suo `inputHash` copre il solo
 * soggetto, e il run non sa a quale lezione appartenga. Senza un legame
 * esterno, `sourceBodyHash` calcolato al momento dell'approvazione non
 * proteggerebbe da nulla: descriverebbe il corpo di **adesso**, non quello da
 * cui la proposta è nata, e una lezione riscritta fra generazione e
 * approvazione produrrebbe un'immagine che illustra un testo che non esiste
 * più — con un manifest che giura il contrario.
 *
 * **Perché un documento separato e non un campo del run.** Toccare
 * `AiVisualRequest` o `computeVisualInputHash` per infilarci l'identità della
 * lezione cambierebbe la **chiave di replay** dei run già memorizzati,
 * invalidandoli in silenzio. Il ticket vive accanto al run, condivide il suo
 * `opaqueRunId` deterministico, e lascia i contratti di VE-02 byte per byte come
 * sono.
 *
 * **Il corpo della lezione non entra qui.** Nel ticket finisce soltanto il suo
 * SHA-256: serve a confrontare, non a leggere. Il corpo non raggiunge mai il
 * provider di immagini — quello vede solo il `subject` validato (VE-01 §9.2) —
 * e nemmeno questo documento lo conserva.
 *
 * Puro: nessuna rete, nessun I/O. Le letture e le scritture vivono nel gateway.
 */

import { AI_CONTENT_RUN_TTL_MS, timestampToMillis } from './aiContentCore.js';
import { AiVisualError, sha256Hex } from './aiVisualCore.js';

/** TTL del ticket: lo stesso del run e dello staging che accompagna. */
export const VISUAL_CANDIDATE_TTL_MS = AI_CONTENT_RUN_TTL_MS;

export const AI_VISUAL_CANDIDATE_CONTRACT_VERSION = 1 as const;

/**
 * Identità della destinazione, derivata **sempre** lato server: il client dice
 * quale lezione, il server dice tutto il resto.
 */
export interface VisualCandidateTarget {
  programId: string;
  importId: string;
  lessonId: string;
  /** Derivato dal `LessonDoc`, mai accettato dal chiamante. */
  publicLessonId: string;
  /** Derivato dal `LessonDoc`: serve a comporre il percorso canonico. */
  udaDir: string;
}

export interface StoredVisualCandidate extends VisualCandidateTarget {
  contractVersion: typeof AI_VISUAL_CANDIDATE_CONTRACT_VERSION;
  ownerUid: string;
  /** SHA-256 del corpo **salvato** letto durante il bind. Mai dal client. */
  sourceBodyHash: string;
  createdAtMs: number;
  expireAtMs: number;
}

const CANDIDATE_KEYS = [
  'contractVersion',
  'ownerUid',
  'programId',
  'importId',
  'lessonId',
  'publicLessonId',
  'udaDir',
  'sourceBodyHash',
] as const;

/**
 * Le due rappresentazioni ammesse del tempo. Il serializzatore scrive sempre i
 * millisecondi; `createdAt`/`expireAt` restano leggibili perché un `Timestamp`
 * server-side può arrivare in quella forma, e rifiutarlo significherebbe
 * dichiarare corrotto un ticket perfettamente valido.
 */
const CANDIDATE_TIME_KEYS = ['createdAtMs', 'expireAtMs', 'createdAt', 'expireAt'] as const;

const SHA256_HEX_RE = /^[0-9a-f]{64}$/;

function invalid(code: 'invalid_input' | 'corrupted_state', message: string): never {
  throw new AiVisualError(code, message);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Segmento di identità: non vuoto, senza spazi esterni, senza `/`, senza
 * traversal. Gli stessi vincoli del percorso canonico, perché questi valori
 * finiscono **dentro** quel percorso.
 */
function assertSegment(value: unknown, label: string): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value !== value.trim() ||
    value.includes('/') ||
    value === '.' ||
    value === '..' ||
    Buffer.byteLength(value, 'utf8') > 1_500
  ) {
    invalid('invalid_input', `${label} non valido.`);
  }
  return value;
}

/** SHA-256 del corpo salvato. Il corpo non viene conservato, solo confrontato. */
export function computeSourceBodyHash(lessonBody: string): string {
  return sha256Hex(lessonBody);
}

/**
 * Payload **chiuso** che il client può mandare al bind: dice soltanto *quale*
 * lezione. Nessun `ownerUid`, nessun `udaDir`, nessun `publicLessonId`, nessun
 * corpo e soprattutto **nessun hash**: un hash dichiarato dal chiamante non
 * dimostra nulla su ciò che il chiamante ha davvero mandato, e accettarlo
 * renderebbe la protezione una formalità.
 */
export interface VisualCandidateBindInput {
  requestId: string;
  programId: string;
  importId: string;
  lessonId: string;
}

const BIND_KEYS = ['requestId', 'programId', 'importId', 'lessonId'] as const;
const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function validateVisualCandidateBindInput(value: unknown): VisualCandidateBindInput {
  if (!isObject(value)) invalid('invalid_input', 'Payload mancante o non valido.');
  const keys = Object.keys(value).sort();
  const expected = [...BIND_KEYS].sort();
  if (keys.length !== expected.length || keys.some((k, i) => k !== expected[i])) {
    invalid('invalid_input', 'Il payload contiene proprietà non ammesse.');
  }
  if (typeof value.requestId !== 'string' || !UUID_V4_RE.test(value.requestId)) {
    invalid('invalid_input', 'requestId mancante o malformato.');
  }
  return {
    requestId: value.requestId,
    programId: assertSegment(value.programId, 'programId'),
    importId: assertSegment(value.importId, 'importId'),
    lessonId: assertSegment(value.lessonId, 'lessonId'),
  };
}

/** Serializza il ticket per Firestore, con i due istanti come millisecondi. */
export function serializeVisualCandidate(
  candidate: StoredVisualCandidate,
): Record<string, unknown> {
  return {
    contractVersion: candidate.contractVersion,
    ownerUid: candidate.ownerUid,
    programId: candidate.programId,
    importId: candidate.importId,
    lessonId: candidate.lessonId,
    publicLessonId: candidate.publicLessonId,
    udaDir: candidate.udaDir,
    sourceBodyHash: candidate.sourceBodyHash,
    createdAtMs: candidate.createdAtMs,
    expireAtMs: candidate.expireAtMs,
  };
}

/**
 * Parser **fail-closed** del ticket persistito. Restituisce `null` — e non
 * lancia — perché i chiamanti devono poter distinguere «ticket assente o
 * illeggibile» da «ticket incoerente», e trattare entrambi i casi come «non
 * promuovibile» senza propagare eccezioni.
 *
 * Un documento con chiavi in più o in meno è rifiutato: un ticket che ha
 * accumulato campi non previsti non è più il documento che questo contratto
 * descrive.
 */
export function parseStoredVisualCandidate(
  data: unknown,
  toMillis: (value: unknown) => number | null = timestampToMillis,
): StoredVisualCandidate | null {
  if (!isObject(data)) return null;
  if (data.contractVersion !== AI_VISUAL_CANDIDATE_CONTRACT_VERSION) return null;
  // Forma chiusa: né chiavi in più né in meno. Un ticket che ha accumulato
  // campi non previsti non è più il documento che questo contratto descrive, e
  // interpretarlo lo stesso significherebbe fidarsi di qualcosa che nessuno ha
  // scritto di proposito.
  const allowed = new Set<string>([...CANDIDATE_KEYS, ...CANDIDATE_TIME_KEYS]);
  if (
    Object.keys(data).some((key) => !allowed.has(key)) ||
    CANDIDATE_KEYS.some((key) => !Object.prototype.hasOwnProperty.call(data, key))
  ) {
    return null;
  }

  const createdAtMs =
    typeof data.createdAtMs === 'number' ? data.createdAtMs : toMillis(data.createdAt);
  const expireAtMs =
    typeof data.expireAtMs === 'number' ? data.expireAtMs : toMillis(data.expireAt);
  if (
    createdAtMs === null ||
    expireAtMs === null ||
    !Number.isFinite(createdAtMs) ||
    !Number.isFinite(expireAtMs)
  ) {
    return null;
  }

  const sourceBodyHash = data.sourceBodyHash;
  if (typeof sourceBodyHash !== 'string' || !SHA256_HEX_RE.test(sourceBodyHash)) return null;

  try {
    return {
      contractVersion: AI_VISUAL_CANDIDATE_CONTRACT_VERSION,
      ownerUid: assertSegment(data.ownerUid, 'ownerUid'),
      programId: assertSegment(data.programId, 'programId'),
      importId: assertSegment(data.importId, 'importId'),
      lessonId: assertSegment(data.lessonId, 'lessonId'),
      publicLessonId: assertSegment(data.publicLessonId, 'publicLessonId'),
      udaDir: assertSegment(data.udaDir, 'udaDir'),
      sourceBodyHash,
      createdAtMs,
      expireAtMs,
    };
  } catch {
    return null;
  }
}

/** Esito del confronto fra un bind ripetuto e il ticket già memorizzato. */
export type VisualCandidateBindOutcome =
  | { status: 'created'; candidate: StoredVisualCandidate }
  | { status: 'replayed'; candidate: StoredVisualCandidate }
  | { status: 'conflict'; reason: 'target' | 'owner' | 'source_body' };

/**
 * Decide che cosa fare quando un bind arriva su un `opaqueRunId` che ha già un
 * ticket.
 *
 * **Stessa identità e stesso hash ⇒ replay idempotente.** Una risposta persa
 * non deve costringere a ricominciare, e ripetere il bind non deve produrre un
 * secondo ticket.
 *
 * **Qualunque divergenza ⇒ conflict fail-closed, mai sovrascrittura.** Se lo
 * stesso `requestId` venisse riusato per un'altra lezione, sovrascrivere
 * silenziosamente significherebbe promuovere più tardi un'immagine verso una
 * destinazione che non è quella per cui è stata generata. E se il corpo è
 * cambiato, il candidato non descrive più quel testo: va rifatto, non riusato.
 * Il `reason` distingue i tre casi perché sono tre errori diversi da spiegare a
 * un essere umano.
 */
export function reconcileVisualCandidateBind(params: {
  existing: StoredVisualCandidate | null;
  next: StoredVisualCandidate;
}): VisualCandidateBindOutcome {
  const { existing, next } = params;
  if (!existing) return { status: 'created', candidate: next };
  if (existing.ownerUid !== next.ownerUid) return { status: 'conflict', reason: 'owner' };
  if (
    existing.programId !== next.programId ||
    existing.importId !== next.importId ||
    existing.lessonId !== next.lessonId ||
    existing.publicLessonId !== next.publicLessonId ||
    existing.udaDir !== next.udaDir
  ) {
    return { status: 'conflict', reason: 'target' };
  }
  if (existing.sourceBodyHash !== next.sourceBodyHash) {
    return { status: 'conflict', reason: 'source_body' };
  }
  return { status: 'replayed', candidate: existing };
}

/** Messaggi dei tre conflitti, espliciti su che cosa è cambiato. */
export function describeCandidateConflict(reason: 'target' | 'owner' | 'source_body'): string {
  switch (reason) {
    case 'owner':
      return 'Il candidato appartiene a un altro proprietario.';
    case 'target':
      return 'Lo stesso identificativo è già legato a un’altra lezione.';
    case 'source_body':
      return 'Il contenuto della lezione è cambiato dopo la preparazione: genera di nuovo.';
  }
}

/** Esito del controllo del ticket prima della generazione e della promozione. */
export type VisualCandidateCheck =
  | { ok: true; candidate: StoredVisualCandidate }
  | { ok: false; reason: 'missing' | 'expired' | 'owner' | 'target' | 'source_body' };

/**
 * Verifica che un ticket esista, non sia scaduto, appartenga a chi chiama e
 * descriva la destinazione attesa.
 *
 * `nowMs` è un parametro e non `Date.now()`: la scadenza è una decisione, e una
 * decisione che dipende dall'orologio di sistema non è verificabile in un test.
 */
export function checkVisualCandidate(params: {
  candidate: StoredVisualCandidate | null;
  ownerUid: string;
  nowMs: number;
  expectedTarget?: Partial<VisualCandidateTarget>;
  expectedSourceBodyHash?: string;
}): VisualCandidateCheck {
  const { candidate, ownerUid, nowMs, expectedTarget, expectedSourceBodyHash } = params;
  if (!candidate) return { ok: false, reason: 'missing' };
  if (candidate.expireAtMs <= nowMs) return { ok: false, reason: 'expired' };
  if (candidate.ownerUid !== ownerUid) return { ok: false, reason: 'owner' };

  if (expectedTarget) {
    for (const key of ['programId', 'importId', 'lessonId', 'publicLessonId', 'udaDir'] as const) {
      const expected = expectedTarget[key];
      if (expected !== undefined && candidate[key] !== expected) {
        return { ok: false, reason: 'target' };
      }
    }
  }
  if (expectedSourceBodyHash !== undefined && candidate.sourceBodyHash !== expectedSourceBodyHash) {
    return { ok: false, reason: 'source_body' };
  }
  return { ok: true, candidate };
}

/** Messaggi del controllo, distinti perché richiedono azioni diverse. */
export function describeCandidateCheckFailure(
  reason: 'missing' | 'expired' | 'owner' | 'target' | 'source_body',
): string {
  switch (reason) {
    case 'missing':
      // Copre anche i run VE-02 anteriori al ticket: non sono promuovibili, e
      // non vengono "riparati" inventando un legame che non è mai esistito.
      return 'Nessuna preparazione valida per questo candidato: rigenera l’immagine.';
    case 'expired':
      return 'La preparazione di questo candidato è scaduta: rigenera l’immagine.';
    case 'owner':
      return 'Il candidato appartiene a un altro proprietario.';
    case 'target':
      return 'Il candidato è stato preparato per un’altra lezione.';
    case 'source_body':
      return 'Il contenuto della lezione è cambiato dopo la preparazione: rigenera l’immagine.';
  }
}
