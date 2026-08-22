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
  | 'output_incomplete'
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
 * AIGEN-CONTEXT-01 — numero massimo di voci dell'indice UDA. Chiuso e validato:
 * l'indice resta compatto (solo titoli), quindi l'incremento di token è piccolo
 * e limitato anche per un'UDA molto lunga.
 */
export const MAX_UDA_OUTLINE_ITEMS = 60;
/**
 * Dimensione UTF-8 massima dell'intero contesto UDA serializzato — indice
 * **e**, da STRUCTURE-IMPORT-03, descrizione/competenze/obiettivi dell'UDA.
 */
export const MAX_UDA_OUTLINE_BYTES = 20_000;
/**
 * STRUCTURE-IMPORT-03 — cap sulla descrizione dell'UDA. Più generoso di un
 * titolo perché una descrizione legacy può derivare dalla prima riga del corpo
 * Markdown (`extractDescription`) ed essere un paragrafo intero: un cap da
 * titolo bloccherebbe la generazione su corsi già esistenti. Resta comunque
 * chiuso, e il cap complessivo della richiesta continua ad applicarsi.
 */
export const MAX_UDA_DESCRIPTION_CHARS = 2_000;
/** Lunghezza massima (caratteri) del valore libero `difficolta` della lezione. */
export const MAX_DIFFICOLTA_CHARS = 120;
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
  /**
   * CONCEPT-MAP-01 — Markdown canonico della mappa concettuale, composto dal
   * server. Due ordini di grandezza sotto la lezione: una mappa lunga è una
   * mappa fallita, e il cap tiene l'artefatto lontano dal limite documentale
   * Firestore anche quando verrà persistito sul `LessonDoc` (CONCEPT-MAP-02).
   */
  MAX_CONCEPT_MAP_OUTPUT_BYTES: 32_000,
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

export type ContentKind = 'pool' | 'lesson' | 'concept_map' | 'visual_proposal';
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

/**
 * AIGEN-CONTEXT-01 — voce dell'indice compatto dell'UDA. **Solo** posizione e
 * titolazione: nessun ID tecnico, nessun corpo/pool/concetto/obiettivo delle
 * altre lezioni, nessun dato studente.
 */
export interface LessonUdaOutlineItem {
  /** Posizione deterministica 1-based nell'ordine canonico dell'UDA. */
  position: number;
  titolo: string;
  sottotitolo: string | null;
}

/**
 * Perimetro didattico dell'UDA: serve al modello per evitare ripetizioni di ciò
 * che precede e anticipazioni di ciò che segue. Costruito dall'albero già in
 * memoria nel workspace: nessuna nuova lettura.
 */
export interface LessonUdaContext {
  title: string;
  /**
   * STRUCTURE-IMPORT-03 — contesto generale dell'UDA. Nomi canonici italiani,
   * gli stessi di `UdaDoc`: il mapping dal documento avviene una sola volta, al
   * confine del payload lato client.
   *
   * `null` quando l'UDA non ha descrizione; array vuoti per le UDA legacy prive
   * di competenze o obiettivi. Nessun valore sintetico, nessun fallback dal
   * corpo Markdown della lezione.
   */
  descrizione: string | null;
  competenze: string[];
  obiettivi: string[];
  /** Posizione (1-based) della lezione corrente dentro `lessons`. */
  currentLessonPosition: number;
  lessons: LessonUdaOutlineItem[];
}

export interface LessonRequest {
  kind: 'lesson';
  requestId: string;
  modelProfile: ModelProfile;
  teacherGuidance: string | null;
  depth: LessonDepth;
  /** Metadati didattici autorevoli: definiscono il perimetro della lezione. */
  titolo: string;
  sottotitolo: string | null;
  /** Livello pedagogico richiesto: **non** è `depth` (estensione della trattazione). */
  difficolta: string;
  concettiChiave: string[];
  obiettivi: string[];
  udaTitle: string;
  /** Indice compatto dell'UDA (perimetro, non contenuto). */
  udaContext: LessonUdaContext;
  /** Corpo Markdown corrente nell'editor (contesto non attendibile). */
  currentBody: string;
  hasCurrentContent: boolean;
}

/**
 * CONCEPT-MAP-01 — mappa concettuale di una lezione già scritta.
 *
 * Payload deliberatamente **povero**: solo il corpo della lezione. Niente
 * titolo, metadati, UDA, indice, pool o indicazioni docente — la mappa deve
 * poter affermare soltanto ciò che è ricavabile dal corpo, e ciò che non le
 * viene dato non può contraddirlo.
 *
 * Il profilo è scelto esplicitamente dal docente fra gli stessi due profili
 * chiusi degli altri generatori. Model ID, listino e prezzi restano risolti
 * esclusivamente dal server.
 */
export interface ConceptMapRequest {
  kind: 'concept_map';
  requestId: string;
  modelProfile: ModelProfile;
  /** Corpo Markdown della lezione — dato non attendibile, delimitato nel prompt. */
  lessonBody: string;
}

/**
 * VISUAL-ENRICHMENT-01 — fase **testuale** dell'arricchimento visuale: decide se
 * una lezione beneficia davvero di una piccola illustrazione didattica.
 *
 * A differenza della mappa concettuale, qui i metadati didattici servono
 * davvero: la domanda «questa immagine aiuta?» non si risponde dal solo corpo,
 * perché dipende dal livello, dagli obiettivi e da ciò che le altre lezioni
 * dell'UDA hanno già trattato. Il perimetro resta però chiuso: niente
 * indicazioni docente, niente profondità, niente dati studente, niente URL o
 * riferimenti Storage, e **nessun hash dichiarato dal client** — `sourceBodyHash`
 * sarà calcolato server-side dall'esatto `lessonBody` quando servirà (VE-03).
 *
 * Il profilo è **fisso a `quality`**: questa fase produce un giudizio che il
 * docente approva e che poi autorizza una spesa in immagini. Un giudizio
 * economico che sbaglia costa più di quanto risparmi.
 */
export interface VisualProposalRequest {
  kind: 'visual_proposal';
  requestId: string;
  modelProfile: 'quality';
  titolo: string;
  sottotitolo: string | null;
  difficolta: string;
  concettiChiave: string[];
  obiettivi: string[];
  udaTitle: string;
  udaContext: LessonUdaContext;
  /** Corpo salvato della lezione — dato **non attendibile**, delimitato nel prompt. */
  lessonBody: string;
}

export type AiContentRequest =
  | PoolRequest
  | LessonRequest
  | ConceptMapRequest
  | VisualProposalRequest;

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
  // CONCEPT-MAP-01 — l'aggiunta di un terzo kind non deve spostare un solo byte
  // della forma canonica di pool e lezione: `inputHash` è la chiave di replay dei
  // run già memorizzati, e cambiarla li invaliderebbe tutti in silenzio.
  if (request.kind === 'concept_map') {
    return JSON.stringify({
      kind: 'concept_map',
      modelProfile: request.modelProfile,
      lessonBody: request.lessonBody,
    });
  }
  // VISUAL-ENRICHMENT-01 — quarto kind, stessa regola: la sua forma canonica è
  // un ramo a sé e non tocca un byte di quelle già esistenti.
  if (request.kind === 'visual_proposal') {
    return JSON.stringify({
      kind: 'visual_proposal',
      modelProfile: request.modelProfile,
      titolo: request.titolo,
      sottotitolo: request.sottotitolo,
      difficolta: request.difficolta,
      udaTitle: request.udaTitle,
      udaContext: {
        title: request.udaContext.title,
        descrizione: request.udaContext.descrizione,
        competenze: request.udaContext.competenze,
        obiettivi: request.udaContext.obiettivi,
        currentLessonPosition: request.udaContext.currentLessonPosition,
        lessons: request.udaContext.lessons.map((l) => ({
          position: l.position,
          titolo: l.titolo,
          sottotitolo: l.sottotitolo,
        })),
      },
      concettiChiave: request.concettiChiave,
      obiettivi: request.obiettivi,
      lessonBody: request.lessonBody,
    });
  }
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
          // AIGEN-CONTEXT-01: difficoltà e indice UDA partecipano all'inputHash,
          // così cambiarli invalida la requestId precedente come ogni altro
          // campo del payload.
          difficolta: request.difficolta,
          udaTitle: request.udaTitle,
          udaContext: {
            title: request.udaContext.title,
            // STRUCTURE-IMPORT-03: il contesto generale dell'UDA fa parte del
            // payload canonico, quindi dell'`inputHash`: cambiarlo invalida la
            // requestId precedente come ogni altro campo.
            descrizione: request.udaContext.descrizione,
            competenze: request.udaContext.competenze,
            obiettivi: request.udaContext.obiettivi,
            currentLessonPosition: request.udaContext.currentLessonPosition,
            lessons: request.udaContext.lessons.map((l) => ({
              position: l.position,
              titolo: l.titolo,
              sottotitolo: l.sottotitolo,
            })),
          },
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

/**
 * Testo facoltativo e più lungo di un titolo: assente o `null` ⇒ `null`, ma un
 * valore presente di tipo sbagliato è un errore — a differenza di `parseTitle`,
 * che degrada a `null` per retrocompatibilità dei sottotitoli.
 */
function parseOptionalLongText(value: unknown, label: string, maxChars: number): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') {
    throw new AiContentError('invalid_input', `${label} deve essere una stringa.`);
  }
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > maxChars) {
    throw new AiContentError('invalid_input', `${label} supera la lunghezza massima.`);
  }
  return trimmed;
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

/**
 * Metadato obbligatorio: stringa non vuota entro il cap. A differenza di
 * `parseTitle` non degrada a `null` — l'assenza è un errore, mai un fallback.
 */
function parseRequiredText(value: unknown, label: string, maxChars: number): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new AiContentError('invalid_input', `${label} è obbligatorio.`);
  }
  const trimmed = value.trim();
  if (trimmed.length > maxChars) {
    throw new AiContentError('invalid_input', `${label} troppo lungo.`);
  }
  return trimmed;
}

/** Lista obbligatoria non vuota (concetti chiave / obiettivi). */
function parseRequiredStringArray(value: unknown, label: string): string[] {
  const items = parseStringArray(value, label);
  if (items.length === 0) {
    throw new AiContentError('invalid_input', `${label}: serve almeno un elemento.`);
  }
  return items;
}

/**
 * AIGEN-CONTEXT-01 — validazione **fail-closed** dell'indice UDA. Rifiuta
 * indice assente/malformato, vuoto o oltre il cap, posizioni non 1-based
 * consecutive (ordine canonico deterministico), `currentLessonPosition` fuori
 * range e qualunque proprietà extra — inclusi ID tecnici (lessonId, udaId,
 * filename, storageRef, publicLessonId), che lo schema chiuso non ammette.
 */
function parseUdaContext(value: unknown): LessonUdaContext {
  if (!isPlainObject(value)) {
    throw new AiContentError('invalid_input', 'Contesto UDA mancante o non valido.');
  }
  assertNoExtraKeys(value, [
    'title',
    'descrizione',
    'competenze',
    'obiettivi',
    'currentLessonPosition',
    'lessons',
  ]);
  const title = parseRequiredText(value.title, 'Titolo UDA del contesto', MAX_TITLE_CHARS);
  // STRUCTURE-IMPORT-03 — contesto generale dell'UDA. Facoltativo per natura:
  // una UDA legacy può non avere descrizione, competenze o obiettivi, e la loro
  // assenza non deve impedire una generazione che oggi funziona. Un valore
  // *presente ma malformato* resta invece un errore, senza fallback.
  const descrizione = parseOptionalLongText(
    value.descrizione,
    "Descrizione dell'UDA",
    MAX_UDA_DESCRIPTION_CHARS,
  );
  const competenze = parseStringArray(value.competenze, "Competenze dell'UDA");
  const obiettivi = parseStringArray(value.obiettivi, "Obiettivi dell'UDA");

  if (!Array.isArray(value.lessons)) {
    throw new AiContentError('invalid_input', "L'indice dell'UDA non è valido.");
  }
  if (value.lessons.length === 0) {
    throw new AiContentError('invalid_input', "L'indice dell'UDA non può essere vuoto.");
  }
  if (value.lessons.length > MAX_UDA_OUTLINE_ITEMS) {
    throw new AiContentError('limit_exceeded', "L'indice dell'UDA contiene troppe voci.");
  }

  const lessons: LessonUdaOutlineItem[] = value.lessons.map((raw, index) => {
    if (!isPlainObject(raw)) {
      throw new AiContentError('invalid_input', "Una voce dell'indice UDA non è valida.");
    }
    assertNoExtraKeys(raw, ['position', 'titolo', 'sottotitolo']);
    // Ordine canonico: posizioni 1-based consecutive nell'ordine di invio.
    if (raw.position !== index + 1) {
      throw new AiContentError('invalid_input', "L'indice dell'UDA non è ordinato correttamente.");
    }
    return {
      position: raw.position,
      titolo: parseRequiredText(raw.titolo, "Titolo di una lezione dell'indice", MAX_TITLE_CHARS),
      sottotitolo: parseTitle(raw.sottotitolo, 'Sottotitolo di una lezione'),
    };
  });

  const currentLessonPosition = value.currentLessonPosition;
  if (
    typeof currentLessonPosition !== 'number' ||
    !Number.isInteger(currentLessonPosition) ||
    currentLessonPosition < 1 ||
    currentLessonPosition > lessons.length
  ) {
    throw new AiContentError(
      'invalid_input',
      "La posizione della lezione corrente non è coerente con l'indice dell'UDA.",
    );
  }

  const context: LessonUdaContext = {
    title,
    descrizione,
    competenze,
    obiettivi,
    currentLessonPosition,
    lessons,
  };
  if (utf8ByteLength(JSON.stringify(context)) > MAX_UDA_OUTLINE_BYTES) {
    throw new AiContentError('content_too_large', "L'indice dell'UDA è troppo grande.");
  }
  return context;
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
function validateAiContentRequestWithPolicy(
  input: unknown,
  policy: 'runtime' | 'offline_pool_benchmark',
): AiContentRequest {
  if (!isPlainObject(input)) {
    throw new AiContentError('invalid_input', 'Payload mancante o non valido.');
  }
  const requestId = input.requestId;
  if (typeof requestId !== 'string' || !UUID_RE.test(requestId)) {
    throw new AiContentError('invalid_input', 'requestId mancante o malformato.');
  }
  if (
    input.kind !== 'pool' &&
    input.kind !== 'lesson' &&
    input.kind !== 'concept_map' &&
    input.kind !== 'visual_proposal'
  ) {
    throw new AiContentError('invalid_input', 'kind non supportato.');
  }

  // VISUAL-ENRICHMENT-01 — proposta visuale: payload chiuso, profilo fisso a
  // `quality`, nessun hash dichiarato dal client. Validato **prima** di
  // qualunque altra cosa nella callable, quindi prima di provider, stima,
  // prenotazione, run e scritture.
  if (input.kind === 'visual_proposal') {
    assertNoExtraKeys(input, [
      'kind',
      'requestId',
      'modelProfile',
      'titolo',
      'sottotitolo',
      'difficolta',
      'concettiChiave',
      'obiettivi',
      'udaTitle',
      'udaContext',
      'lessonBody',
    ]);
    // Il profilo è verificato come letterale, non tramite il parser condiviso:
    // `economy` è un valore *valido* per gli altri kind, quindi il parser lo
    // accetterebbe e il rifiuto arriverebbe più tardi, o non arriverebbe.
    if (input.modelProfile !== 'quality') {
      throw new AiContentError(
        'invalid_input',
        'La proposta visuale è disponibile solo con il profilo quality.',
      );
    }
    if (typeof input.lessonBody !== 'string' || input.lessonBody.trim().length === 0) {
      throw new AiContentError('invalid_input', 'Il corpo della lezione è mancante o vuoto.');
    }
    if (utf8ByteLength(input.lessonBody) > AI_CONTENT_LIMITS.MAX_LESSON_SOURCE_BYTES) {
      throw new AiContentError('content_too_large', 'Il corpo della lezione è troppo grande.');
    }
    return enforceTotalRequestSize({
      kind: 'visual_proposal',
      requestId,
      modelProfile: 'quality',
      titolo: parseRequiredText(input.titolo, 'Titolo', MAX_TITLE_CHARS),
      sottotitolo: parseTitle(input.sottotitolo, 'Sottotitolo'),
      difficolta: parseRequiredText(input.difficolta, 'Difficoltà', MAX_DIFFICOLTA_CHARS),
      concettiChiave: parseRequiredStringArray(input.concettiChiave, 'Concetti chiave'),
      obiettivi: parseRequiredStringArray(input.obiettivi, 'Obiettivi'),
      udaTitle: parseRequiredText(input.udaTitle, 'Titolo UDA', MAX_TITLE_CHARS),
      udaContext: parseUdaContext(input.udaContext),
      // Nessun `trim()`: al prompt arriva esattamente il testo salvato, e
      // l'`inputHash` copre quel testo.
      lessonBody: input.lessonBody,
    });
  }

  // CONCEPT-MAP-01 — payload povero, validato prima di tutto il resto. Il
  // profilo resta un enum chiuso economy|quality, risolto col parser condiviso;
  // nessun model ID, listino o prezzo proviene dal client.
  if (input.kind === 'concept_map') {
    assertNoExtraKeys(input, ['kind', 'requestId', 'modelProfile', 'lessonBody']);
    const modelProfile = parseProfile(input.modelProfile);
    if (typeof input.lessonBody !== 'string' || input.lessonBody.trim().length === 0) {
      throw new AiContentError('invalid_input', 'Il corpo della lezione è mancante o vuoto.');
    }
    if (utf8ByteLength(input.lessonBody) > AI_CONTENT_LIMITS.MAX_LESSON_SOURCE_BYTES) {
      throw new AiContentError('content_too_large', 'Il corpo della lezione è troppo grande.');
    }
    return enforceTotalRequestSize({
      kind: 'concept_map',
      requestId,
      modelProfile,
      // Nessun `trim()`: il corpo va al prompt esattamente com'è salvato, e una
      // normalizzazione qui cambierebbe l'`inputHash` rispetto al testo reale.
      lessonBody: input.lessonBody,
    });
  }

  const modelProfile = parseProfile(input.modelProfile);

  if (input.kind === 'pool') {
    // POOL-ROLLOUT-01 — il Gate qualitativo qualifica esclusivamente Quality.
    // Nessun fallback: Economy viene rifiutato prima di guidance, stima,
    // configurazione runtime, budget, run, provider o scritture.
    if (policy === 'runtime' && modelProfile !== 'quality') {
      throw new AiContentError(
        'invalid_input',
        'La generazione dei pool richiede il profilo Quality.',
      );
    }
    const teacherGuidance = parseGuidance(input.teacherGuidance);
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
  const teacherGuidance = parseGuidance(input.teacherGuidance);
  assertNoExtraKeys(input, [
    'kind',
    'requestId',
    'modelProfile',
    'teacherGuidance',
    'depth',
    'titolo',
    'sottotitolo',
    'difficolta',
    'concettiChiave',
    'obiettivi',
    'udaTitle',
    'udaContext',
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
  // AIGEN-CONTEXT-01 — contratto didattico autorevole: titolo, difficoltà,
  // almeno un concetto, almeno un obiettivo, titolo UDA e indice UDA sono
  // **obbligatori** e validati fail-closed lato server (la validazione client è
  // solo UX). Il sottotitolo resta facoltativo. Nessun valore sintetico.
  const titolo = parseRequiredText(input.titolo, 'Titolo', MAX_TITLE_CHARS);
  const sottotitolo = parseTitle(input.sottotitolo, 'Sottotitolo');
  const difficolta = parseRequiredText(input.difficolta, 'Difficoltà', MAX_DIFFICOLTA_CHARS);
  const udaTitle = parseRequiredText(input.udaTitle, 'Titolo UDA', MAX_TITLE_CHARS);
  const udaContext = parseUdaContext(input.udaContext);
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
    difficolta,
    concettiChiave: parseRequiredStringArray(input.concettiChiave, 'Concetti chiave'),
    obiettivi: parseRequiredStringArray(input.obiettivi, 'Obiettivi'),
    udaTitle,
    udaContext,
    currentBody,
    hasCurrentContent,
  });
}

/**
 * Porta autorevole usata dalle callable: applica tutti i vincoli runtime,
 * incluso Quality obbligatorio per i pool.
 */
export function validateAiContentRequest(input: unknown): AiContentRequest {
  return validateAiContentRequestWithPolicy(input, 'runtime');
}

/**
 * Eccezione deliberata e solo offline per ricostruire i benchmark storici
 * Economy/Quality. Non deve essere usata da gateway, callable o applicazione.
 */
export function validateAiContentRequestForOfflinePoolBenchmark(input: unknown): AiContentRequest {
  return validateAiContentRequestWithPolicy(input, 'offline_pool_benchmark');
}

/** Risoluzione **server-side** profilo → modello/listino (riuso, mai dal client). */
export function resolveContentModel(profile: ModelProfile): {
  model: string;
  priceListVersion: string;
} {
  return resolveModelProfile(profile);
}
