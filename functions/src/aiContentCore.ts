/**
 * AIGEN-01 — core **puro** della generazione IA di contenuti (pool e lezione).
 *
 * Nessuna dipendenza Firestore/rete/OpenAI: solo validazione del payload chiuso,
 * risoluzione fail-closed del profilo modello (riuso di `aiCorrectionModelProfile`),
 * fingerprint pseudonimi (`opaqueRunId`, `budgetReservationKey`, `inputHash`) e
 * i limiti dimensionali congelati in `ai-content-generation-roadmap.md`.
 *
 * **Separazione di dominio (scelta AIGEN-01):** questo modulo **non** costruisce
 * `schoolforge-pool/v2`, **non** assegna ID persistenti e **non** importa
 * `parsePool`. La materializzazione del pool (mapper ID → build v2 → `parsePool`
 * → `poolEditorService`) è di AIGEN-02, nel web, dove `@schoolforge/lesson-contract`
 * è già disponibile. Qui si valida **solo** la struttura semantica della proposta.
 */

import { createHash } from 'node:crypto';
import {
  parseModelProfileField,
  resolveModelProfile,
  type ModelProfile,
} from './aiCorrectionModelProfile.js';

// ─── Error contract (dominio contenuti, distinto da AiGatewayError) ───────────

export type AiContentErrorCode =
  | 'unauthenticated'
  | 'not_owner'
  | 'feature_disabled'
  | 'invalid_input'
  | 'content_too_large'
  | 'limit_exceeded'
  | 'operation_budget_exceeded'
  | 'budget_exceeded'
  | 'daily_budget_exceeded'
  | 'budget_unavailable'
  | 'running'
  | 'provider_config_invalid'
  | 'provider_unavailable'
  | 'provider_invalid_output'
  | 'output_too_large'
  | 'run_conflict'
  | 'internal';

/**
 * Errore tipizzato del dominio contenuti. Il `message` è **sanitizzato** e sicuro
 * per il client: mai raw provider error, prompt, API key, testo sorgente o dati
 * personali.
 */
export class AiContentError extends Error {
  readonly code: AiContentErrorCode;
  constructor(code: AiContentErrorCode, message: string) {
    super(message);
    this.name = 'AiContentError';
    this.code = code;
  }
}

// ─── Costanti congelate (contratto AIGEN-00) ──────────────────────────────────

export const AI_CONTENT_CONTRACT_VERSION = 1 as const;
export const AI_CONTENT_RUN_TTL_MS = 24 * 60 * 60 * 1000;
export const MAX_GUIDANCE_CHARS = 500;
export const MAX_POOL_TOTAL_QUESTIONS = 30;

// ─── Feature switch server-side dedicato (AIGEN-01-REVIEW-FIX §1) ─────────────

/**
 * Modalità **esplicita** e **indipendente** della generazione contenuti IA,
 * distinta da `AI_CORRECTION_MODE`: consente di tenere la correzione IA attiva e
 * AIGEN disabilitato (o viceversa) durante il rollout. Default e valori
 * sconosciuti ⇒ `'disabled'`, senza alcun fallback silenzioso.
 */
export type AiContentMode = 'disabled' | 'mock' | 'openai';

/**
 * Risolve la modalità **solo** dalla configurazione server (env della Function).
 * Unici valori operativi: gli esatti `'mock'` e `'openai'`. Assenza, stringa
 * vuota, casing diverso o qualunque altro valore ⇒ `'disabled'` (fail-closed).
 */
export function resolveAiContentMode(env: { AI_CONTENT_MODE?: string | undefined }): AiContentMode {
  if (env.AI_CONTENT_MODE === 'mock' || env.AI_CONTENT_MODE === 'openai') {
    return env.AI_CONTENT_MODE;
  }
  return 'disabled';
}

// ─── Limiti dell'intero payload normalizzato (AIGEN-01-REVIEW-FIX §11) ────────

/** Numero massimo di concetti chiave / obiettivi accettati nella lezione. */
export const MAX_LESSON_LIST_ITEMS = 40;
/** Lunghezza massima (caratteri) di un singolo concetto/obiettivo. */
export const MAX_LESSON_ITEM_CHARS = 300;
/** Lunghezza massima (caratteri) di titolo/sottotitolo/UDA. */
export const MAX_TITLE_CHARS = 300;
/** Tetto ragionevole del contesto quantitativo del pool esistente. */
export const MAX_EXISTING_POOL_QUESTIONS = 1_000;
/**
 * Dimensione UTF-8 complessiva massima della richiesta **normalizzata**. Poco
 * sopra il cap del singolo sorgente (200 KB): impedisce di aggirare il limite
 * gonfiando i metadati (titoli/liste) attorno a un sorgente già al massimo.
 */
export const MAX_REQUEST_TOTAL_BYTES = 210_000;

/** Cap dimensionali (byte UTF-8) — §3.4/§6.6 del contratto. */
export const AI_CONTENT_LIMITS = {
  /** Materiale lezione (pool) inviato come sorgente. */
  MAX_POOL_SOURCE_BYTES: 200_000,
  /** Corpo/contesto lezione inviato come sorgente. */
  MAX_LESSON_SOURCE_BYTES: 200_000,
  /** Output pool persistito nel run. */
  MAX_POOL_OUTPUT_BYTES: 200_000,
  /** Output lezione persistito nel run (più prudente dei 700_000 canonici). */
  MAX_LESSON_OUTPUT_BYTES: 600_000,
  /** Lezione salvata canonica (invariata) — riferimento, applicata in AIGEN-02. */
  MAX_LESSON_CANONICAL_BYTES: 700_000,
  /** Tetto prudenziale della dimensione complessiva del documento run. */
  MAX_RUN_DOCUMENT_BYTES: 900_000,
} as const;

/** Stili pool → range di difficoltà ammesso (interi 1–5). */
export const POOL_LEVELS = ['base', 'balanced', 'advanced'] as const;
export type PoolLevel = (typeof POOL_LEVELS)[number];
export const POOL_LEVEL_DIFFICULTY: Readonly<Record<PoolLevel, { min: number; max: number }>> = {
  base: { min: 1, max: 3 },
  balanced: { min: 1, max: 5 },
  advanced: { min: 3, max: 5 },
};

export const LESSON_DEPTHS = ['synthetic', 'complete', 'in_depth'] as const;
export type LessonDepth = (typeof LESSON_DEPTHS)[number];

export type ContentKind = 'pool' | 'lesson';
export const QUESTION_TYPES = ['aperta', 'chiusa_singola', 'chiusa_multipla'] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

// ─── Payload chiuso (validato) ────────────────────────────────────────────────

export interface PoolCounts {
  aperta: number;
  chiusa_singola: number;
  chiusa_multipla: number;
}

export interface PoolRequest {
  kind: 'pool';
  requestId: string;
  modelProfile: ModelProfile;
  teacherGuidance: string | null;
  level: PoolLevel;
  counts: PoolCounts;
  /** Materiale didattico (testo lezione) — dato non attendibile, delimitato nel prompt. */
  lessonSource: string;
  /** Solo contesto quantitativo; NON abilita deduplicazione semantica. */
  existingPoolQuestionCount: number;
}

export interface LessonRequest {
  kind: 'lesson';
  requestId: string;
  modelProfile: ModelProfile;
  teacherGuidance: string | null;
  depth: LessonDepth;
  /** Metadati didattici autorevoli. */
  titolo: string | null;
  sottotitolo: string | null;
  concettiChiave: string[];
  obiettivi: string[];
  udaTitle: string | null;
  /** Corpo Markdown corrente nell'editor (contesto non attendibile). */
  currentBody: string;
  hasCurrentContent: boolean;
}

export type AiContentRequest = PoolRequest | LessonRequest;

// ─── Helpers puri ─────────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export function utf8ByteLength(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

/** Serializzazione canonica non ambigua di una tupla di stringhe. */
export function canonicalTuple(parts: string[]): string {
  return JSON.stringify(parts);
}

function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/**
 * `opaqueRunId = SHA-256(canonical(["ai-content/v1", ownerUid, requestId]))`.
 * Calcolato **solo** server-side dall'UID autenticato; mai accettato dal client.
 * Fingerprint **pseudonimo** (ricollegabile all'owner da chi ha i valori), non
 * anonimo.
 */
export function computeOpaqueRunId(authenticatedOwnerUid: string, requestId: string): string {
  return sha256Hex(canonicalTuple(['ai-content/v1', authenticatedOwnerUid, requestId]));
}

/**
 * Chiave di prenotazione budget in un **namespace distinto** dal run e da
 * `aiCorrectionRuns`, per non collidere con una `requestId` della correzione IA.
 */
export function computeBudgetReservationKey(
  authenticatedOwnerUid: string,
  requestId: string,
): string {
  return sha256Hex(canonicalTuple(['ai-content-budget/v1', authenticatedOwnerUid, requestId]));
}

/**
 * `inputHash` = fingerprint del payload **normalizzato** (kind, profilo, config,
 * guidance, materiale). Copre il contenuto ma non è testo in chiaro: pseudonimo.
 * Deterministico e stabile tra i retry dello stesso payload.
 */
export function canonicalRequest(request: AiContentRequest): string {
  const canonical: unknown =
    request.kind === 'pool'
      ? {
          kind: 'pool',
          modelProfile: request.modelProfile,
          level: request.level,
          counts: {
            aperta: request.counts.aperta,
            chiusa_singola: request.counts.chiusa_singola,
            chiusa_multipla: request.counts.chiusa_multipla,
          },
          teacherGuidance: request.teacherGuidance,
          existingPoolQuestionCount: request.existingPoolQuestionCount,
          lessonSource: request.lessonSource,
        }
      : {
          kind: 'lesson',
          modelProfile: request.modelProfile,
          depth: request.depth,
          titolo: request.titolo,
          sottotitolo: request.sottotitolo,
          udaTitle: request.udaTitle,
          concettiChiave: request.concettiChiave,
          obiettivi: request.obiettivi,
          teacherGuidance: request.teacherGuidance,
          hasCurrentContent: request.hasCurrentContent,
          currentBody: request.currentBody,
        };
  return JSON.stringify(canonical);
}

export function computeInputHash(request: AiContentRequest): string {
  return sha256Hex(canonicalRequest(request));
}

// ─── Validazione payload chiuso ───────────────────────────────────────────────

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertNoExtraKeys(obj: Record<string, unknown>, allowed: readonly string[]): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) {
      throw new AiContentError('invalid_input', 'Il payload contiene proprietà non ammesse.');
    }
  }
}

function parseGuidance(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') {
    throw new AiContentError('invalid_input', 'Indicazioni non valide.');
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > MAX_GUIDANCE_CHARS) {
    throw new AiContentError('invalid_input', 'Indicazioni troppo lunghe (max 500 caratteri).');
  }
  return trimmed;
}

function parseNonNegativeInt(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new AiContentError('invalid_input', `${label} deve essere un intero ≥ 0.`);
  }
  return value;
}

function parseStringArray(value: unknown, label: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) {
    throw new AiContentError('invalid_input', `${label} deve essere una lista di stringhe.`);
  }
  // Cap sul numero di elementi PRIMA di normalizzare: rifiuta array enormi anche
  // se composti da voci vuote/spazi (che verrebbero poi filtrate).
  if (value.length > MAX_LESSON_LIST_ITEMS) {
    throw new AiContentError('limit_exceeded', `${label}: troppi elementi.`);
  }
  const items = (value as string[]).map((s) => s.trim()).filter((s) => s.length > 0);
  for (const item of items) {
    if (item.length > MAX_LESSON_ITEM_CHARS) {
      throw new AiContentError('invalid_input', `${label}: un elemento è troppo lungo.`);
    }
  }
  return items;
}

function parseTitle(value: unknown, label: string): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > MAX_TITLE_CHARS) {
    throw new AiContentError('invalid_input', `${label} troppo lungo.`);
  }
  return trimmed;
}

/** Cap fail-closed sulla dimensione UTF-8 dell'intera richiesta **normalizzata**. */
function enforceTotalRequestSize(request: AiContentRequest): AiContentRequest {
  if (utf8ByteLength(canonicalRequest(request)) > MAX_REQUEST_TOTAL_BYTES) {
    throw new AiContentError('content_too_large', 'La richiesta complessiva è troppo grande.');
  }
  return request;
}

function parseProfile(value: unknown): ModelProfile {
  const res = parseModelProfileField(value);
  if (!res.ok || res.profile === undefined) {
    throw new AiContentError('invalid_input', 'Profilo modello non valido.');
  }
  return res.profile;
}

/**
 * Valida il payload **chiuso** inviato dal client (mai throw di errori raw).
 * Rifiuta proprietà extra, `kind` sconosciuto, `requestId` non-UUID, profilo
 * non valido, guidance oltre limite e conteggi/dimensioni fuori contratto.
 * Le dimensioni dei sorgenti sono controllate qui (`content_too_large`).
 */
export function validateAiContentRequest(input: unknown): AiContentRequest {
  if (!isPlainObject(input)) {
    throw new AiContentError('invalid_input', 'Payload mancante o non valido.');
  }
  const requestId = input.requestId;
  if (typeof requestId !== 'string' || !UUID_RE.test(requestId)) {
    throw new AiContentError('invalid_input', 'requestId mancante o malformato.');
  }
  if (input.kind !== 'pool' && input.kind !== 'lesson') {
    throw new AiContentError('invalid_input', 'kind non supportato.');
  }
  const modelProfile = parseProfile(input.modelProfile);
  const teacherGuidance = parseGuidance(input.teacherGuidance);

  if (input.kind === 'pool') {
    assertNoExtraKeys(input, [
      'kind',
      'requestId',
      'modelProfile',
      'teacherGuidance',
      'level',
      'counts',
      'lessonSource',
      'existingPoolQuestionCount',
    ]);
    if (input.level !== 'base' && input.level !== 'balanced' && input.level !== 'advanced') {
      throw new AiContentError('invalid_input', 'Livello del pool non valido.');
    }
    if (!isPlainObject(input.counts)) {
      throw new AiContentError('invalid_input', 'Conteggi mancanti o non validi.');
    }
    assertNoExtraKeys(input.counts, ['aperta', 'chiusa_singola', 'chiusa_multipla']);
    const counts: PoolCounts = {
      aperta: parseNonNegativeInt(input.counts.aperta, 'Domande aperte'),
      chiusa_singola: parseNonNegativeInt(input.counts.chiusa_singola, 'Risposte singole'),
      chiusa_multipla: parseNonNegativeInt(input.counts.chiusa_multipla, 'Risposte multiple'),
    };
    const total = counts.aperta + counts.chiusa_singola + counts.chiusa_multipla;
    if (total < 1) {
      throw new AiContentError('invalid_input', 'Serve almeno una domanda.');
    }
    if (total > MAX_POOL_TOTAL_QUESTIONS) {
      throw new AiContentError('limit_exceeded', `Massimo ${MAX_POOL_TOTAL_QUESTIONS} domande.`);
    }
    if (typeof input.lessonSource !== 'string' || input.lessonSource.trim().length === 0) {
      throw new AiContentError('invalid_input', 'Materiale della lezione mancante.');
    }
    if (utf8ByteLength(input.lessonSource) > AI_CONTENT_LIMITS.MAX_POOL_SOURCE_BYTES) {
      throw new AiContentError('content_too_large', 'Il materiale della lezione è troppo grande.');
    }
    const existingPoolQuestionCount =
      input.existingPoolQuestionCount === undefined
        ? 0
        : parseNonNegativeInt(input.existingPoolQuestionCount, 'Conteggio pool esistente');
    if (existingPoolQuestionCount > MAX_EXISTING_POOL_QUESTIONS) {
      throw new AiContentError('limit_exceeded', 'Conteggio pool esistente troppo grande.');
    }
    return enforceTotalRequestSize({
      kind: 'pool',
      requestId,
      modelProfile,
      teacherGuidance,
      level: input.level,
      counts,
      lessonSource: input.lessonSource,
      existingPoolQuestionCount,
    });
  }

  // kind === 'lesson'
  assertNoExtraKeys(input, [
    'kind',
    'requestId',
    'modelProfile',
    'teacherGuidance',
    'depth',
    'titolo',
    'sottotitolo',
    'concettiChiave',
    'obiettivi',
    'udaTitle',
    'currentBody',
    'hasCurrentContent',
  ]);
  if (input.depth !== 'synthetic' && input.depth !== 'complete' && input.depth !== 'in_depth') {
    throw new AiContentError('invalid_input', 'Profondità non valida.');
  }
  const currentBody = typeof input.currentBody === 'string' ? input.currentBody : '';
  if (utf8ByteLength(currentBody) > AI_CONTENT_LIMITS.MAX_LESSON_SOURCE_BYTES) {
    throw new AiContentError(
      'content_too_large',
      'Il contenuto attuale della lezione è troppo grande.',
    );
  }
  const titolo = parseTitle(input.titolo, 'Titolo');
  const sottotitolo = parseTitle(input.sottotitolo, 'Sottotitolo');
  const udaTitle = parseTitle(input.udaTitle, 'Titolo UDA');
  const hasCurrentContent =
    typeof input.hasCurrentContent === 'boolean'
      ? input.hasCurrentContent
      : currentBody.trim().length > 0;
  return enforceTotalRequestSize({
    kind: 'lesson',
    requestId,
    modelProfile,
    teacherGuidance,
    depth: input.depth,
    titolo,
    sottotitolo,
    concettiChiave: parseStringArray(input.concettiChiave, 'Concetti chiave'),
    obiettivi: parseStringArray(input.obiettivi, 'Obiettivi'),
    udaTitle,
    currentBody,
    hasCurrentContent,
  });
}

/** Risoluzione **server-side** profilo → modello/listino (riuso, mai dal client). */
export function resolveContentModel(profile: ModelProfile): {
  model: string;
  priceListVersion: string;
} {
  return resolveModelProfile(profile);
}
