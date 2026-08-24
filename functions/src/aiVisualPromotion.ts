/**
 * VISUAL-ENRICHMENT-03A — promozione di un candidato approvato.
 *
 * È il punto in cui un'immagine smette di essere una proposta e diventa parte
 * della lezione: i byte staged vengono copiati nella posizione canonica, il
 * manifest privato viene scritto sul `LessonDoc`, e — **solo** se la lezione è
 * svolta — la proiezione pubblica e i byte per lo studente vengono scritti nello
 * stesso commit.
 *
 * **Firestore e Storage non sono transazionali fra loro, e questo modulo non
 * finge il contrario.** La garanzia offerta è precisa e più stretta di
 * «atomicità»:
 *
 * - manifest privato, proiezione pubblica, byte pubblici e audit sono atomici
 *   **fra loro**, perché stanno in una sola transazione Firestore;
 * - la copia in Storage avviene **prima** della transazione, così una
 *   proiezione pubblica non può mai puntare a byte che non esistono;
 * - il fallimento peggiore possibile lascia un blob privato **orfano** — mai una
 *   proiezione rotta, mai un'immagine visibile allo studente che nessuno ha
 *   approvato;
 * - lo staging viene eliminato **dopo** il commit, e il vecchio blob canonico di
 *   una sostituzione anche: eliminarli prima significherebbe non poter più
 *   riprovare.
 *
 * L'ordine è quello: l'orfano è recuperabile, la proiezione rotta no.
 *
 * Puro rispetto all'infrastruttura: ogni accesso passa da `VisualPromotionPorts`.
 */

import type { Timestamp } from 'firebase-admin/firestore';
import { AiVisualError, sha256Hex } from './aiVisualCore.js';
import {
  checkVisualCandidate,
  computeSourceBodyHash,
  describeCandidateCheckFailure,
  type StoredVisualCandidate,
} from './aiVisualCandidate.js';
import {
  canonicalVisualStorageRef,
  composePublicLessonVisual,
  projectLessonVisual,
  validateLessonVisualPrivateManifest,
  type LessonVisualPrivateManifest,
  type LessonVisualPublicManifest,
  type PublicLessonVisualDoc,
} from './aiVisualManifest.js';
import {
  assignLessonHeadingSlugs,
  canonicalLessonHeadingText,
  lessonHeadingSlug,
  type LessonHeadingRef,
} from '@schoolforge/lesson-contract';
import {
  MAX_VISUAL_ALT_TEXT_CHARS,
  MAX_VISUAL_ANCHOR_HEADING_CHARS,
  MAX_VISUAL_CAPTION_CHARS,
  VISUAL_STYLE_VERSION,
  codePointLength,
  extractAnchorableLessonHeadings,
} from './aiContentVisualProposal.js';

// ─── Input editoriale ─────────────────────────────────────────────────────────

/**
 * Ciò che il client può dire.
 *
 * Identifica il candidato e la lezione, e porta i **soli** valori editoriali che
 * il docente può davvero modificare prima di approvare: didascalia, testo
 * alternativo e a quale titolo ancorare. Tutto il resto — `ownerUid`, `udaDir`,
 * `publicLessonId`, `assetId`, `storageRef`, `sha256`, `byteLength`, dimensioni,
 * `mimeType`, `approvedAt`, `sourceBodyHash` — è **derivato dal server** e non è
 * accettabile dal chiamante nemmeno se lo mandasse.
 */
export interface VisualPromotionInput {
  requestId: string;
  programId: string;
  importId: string;
  lessonId: string;
  anchorHeadingText: string;
  anchorHeadingIndex: number;
  caption: string;
  altText: string;
}

const PROMOTION_KEYS = [
  'requestId',
  'programId',
  'importId',
  'lessonId',
  'anchorHeadingText',
  'anchorHeadingIndex',
  'caption',
  'altText',
] as const;

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function invalidInput(message: string): never {
  throw new AiVisualError('invalid_input', message);
}

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
    invalidInput(`${label} non valido.`);
  }
  return value;
}

function assertEditorialText(value: unknown, label: string, maxChars: number): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value !== value.trim() ||
    codePointLength(value) > maxChars
  ) {
    invalidInput(`${label} non valido.`);
  }
  return value;
}

export function validateVisualPromotionInput(value: unknown): VisualPromotionInput {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    invalidInput('Payload mancante o non valido.');
  }
  const root = value as Record<string, unknown>;
  const keys = Object.keys(root).sort();
  const expected = [...PROMOTION_KEYS].sort();
  if (keys.length !== expected.length || keys.some((k, i) => k !== expected[i])) {
    invalidInput('Il payload contiene proprietà non ammesse.');
  }
  if (typeof root.requestId !== 'string' || !UUID_V4_RE.test(root.requestId)) {
    invalidInput('requestId mancante o malformato.');
  }
  return {
    requestId: root.requestId,
    programId: assertSegment(root.programId, 'programId'),
    importId: assertSegment(root.importId, 'importId'),
    lessonId: assertSegment(root.lessonId, 'lessonId'),
    anchorHeadingText: assertEditorialText(
      root.anchorHeadingText,
      'Heading di ancoraggio',
      MAX_VISUAL_ANCHOR_HEADING_CHARS,
    ),
    anchorHeadingIndex:
      typeof root.anchorHeadingIndex === 'number' &&
      Number.isInteger(root.anchorHeadingIndex) &&
      root.anchorHeadingIndex >= 0
        ? root.anchorHeadingIndex
        : invalidInput('Indice dell’heading di ancoraggio non valido.'),
    caption: assertEditorialText(root.caption, 'Didascalia', MAX_VISUAL_CAPTION_CHARS),
    altText: assertEditorialText(root.altText, 'Testo alternativo', MAX_VISUAL_ALT_TEXT_CHARS),
  };
}

// ─── Slug dell'ancora ─────────────────────────────────────────────────────────

/**
 * L'identità degli heading vive in `@schoolforge/lesson-contract`.
 *
 * VE-04A aveva allineato le due implementazioni e congelato una tabella
 * condivisa; il review fix è andato fino in fondo e ne ha eliminata una. Una
 * tabella dimostra che due implementazioni coincidono **oggi**; un modulo
 * condiviso rende impossibile che divergano **domani**. Il re-export conserva
 * l'API per i chiamanti esistenti.
 */
export { lessonHeadingSlug as headingSlug };

/**
 * Elenco degli heading **ancorabili** del corpo, con slug e indice.
 *
 * Ancorabili significa livelli 2 e 3: sono gli unici a cui il renderer assegna
 * un `id`, quindi ancorare a un `#` o a un `####` vorrebbe dire puntare a un
 * elemento che nella pagina non ha identificatore.
 */
export function listAnchorableHeadings(lessonBody: string): LessonHeadingRef[] {
  return assignLessonHeadingSlugs(
    extractAnchorableLessonHeadings(lessonBody).map((heading) => ({
      text: canonicalLessonHeadingText(heading.text),
      level: heading.level as 2 | 3,
    })),
  );
}

/**
 * Risolve lo slug di un heading **dentro un corpo reale**, per testo.
 *
 * Usato dalla promozione, dove l'ancora arriva da una proposta del modello e
 * non da una scelta puntuale del docente: se due heading hanno lo stesso testo
 * vince il primo, perché non c'è nulla che permetta di distinguerli. Il
 * riancoraggio, dove la scelta è del docente, usa invece l'indice — vedi
 * `resolveAnchorByIndex`.
 */
export function resolveAnchorSlugInBody(
  anchorHeadingText: string,
  lessonBody: string,
): { headingSlug: string; headingText: string } {
  /*
   * La proposta conserva il testo sorgente esatto, perché il modello lo copia
   * dal Markdown (`**Reti**`, `` `Reti` ``, `[Reti](url)`). Il manifest deve
   * invece contenere il testo visibile e usare lo stesso slug del renderer.
   * Canonicalizzare qui unisce i due contratti senza riscrivere il run IA e
   * senza rendere fuzzy il confronto: la proposta è già stata verificata contro
   * un heading sorgente H2/H3 reale prima della persistenza.
   */
  const canonicalAnchorHeadingText = canonicalLessonHeadingText(anchorHeadingText);
  const match = listAnchorableHeadings(lessonBody).find(
    (heading) => heading.text === canonicalAnchorHeadingText,
  );
  if (!match) {
    throw new AiVisualError(
      'invalid_input',
      'L\u2019heading di ancoraggio non esiste nel corpo salvato della lezione.',
    );
  }
  return { headingSlug: match.slug, headingText: match.text };
}

/**
 * Risolve l'ancora per **indice**, con il testo come conferma.
 *
 * Il solo testo non basta a distinguere due heading identici — e due `## Reti`
 * nella stessa lezione sono normali. L'indice li distingue; il testo canonico
 * a quell'indice deve però coincidere **esattamente**, altrimenti significa che
 * il corpo è cambiato fra la scelta del docente e il commit, e riancorare
 * userebbe una posizione che non descrive più ciò che il docente ha visto.
 *
 * Lo slug non arriva mai dal client: è ricalcolato qui contando tutte le
 * collisioni precedenti.
 */
export function resolveAnchorByIndex(params: {
  lessonBody: string;
  anchorHeadingIndex: number;
  anchorHeadingText: string;
}): { headingSlug: string; headingText: string } {
  const headings = listAnchorableHeadings(params.lessonBody);
  const match = headings[params.anchorHeadingIndex];
  if (!match) {
    throw new AiVisualError(
      'invalid_input',
      'La sezione scelta non esiste più nel corpo della lezione.',
    );
  }
  if (match.text !== params.anchorHeadingText) {
    throw new AiVisualError(
      'invalid_input',
      'Le sezioni della lezione sono cambiate: riapri il riancoraggio.',
    );
  }
  return { headingSlug: match.slug, headingText: match.text };
}

// ─── Byte staged ↔ run completato ─────────────────────────────────────────────

/** Ciò che il run completato dichiara dell'immagine prodotta. */
export interface PromotableRunImage {
  sha256: string;
  byteLength: number;
  width: number;
  height: number;
  mimeType: 'image/webp';
  styleVersion: typeof VISUAL_STYLE_VERSION;
}

/**
 * Verifica che i byte riletti dallo staging siano **esattamente** quelli che il
 * run ha prodotto.
 *
 * Non è ridondante rispetto alla normalizzazione di VE-02: fra la generazione e
 * l'approvazione passa il tempo di una decisione umana, e lo staging è un
 * oggetto scrivibile che nel frattempo potrebbe essere stato sostituito. Il
 * confronto è sui byte, non sui soli metadati, perché due immagini diverse
 * possono avere le stesse dimensioni.
 */
export function assertStagedBytesMatchRun(params: {
  bytes: Uint8Array;
  image: PromotableRunImage;
  inspect: (bytes: Uint8Array) => { width: number; height: number };
}): void {
  const { bytes, image, inspect } = params;
  if (bytes.byteLength !== image.byteLength) {
    throw new AiVisualError('corrupted_state', 'I byte staged non corrispondono al run.');
  }
  if (sha256Hex(bytes) !== image.sha256) {
    throw new AiVisualError('corrupted_state', 'I byte staged non corrispondono al run.');
  }
  if (image.mimeType !== 'image/webp' || image.styleVersion !== VISUAL_STYLE_VERSION) {
    throw new AiVisualError('corrupted_state', 'Il run non descrive un WebP dello stile atteso.');
  }
  const inspected = inspect(bytes);
  if (inspected.width !== image.width || inspected.height !== image.height) {
    throw new AiVisualError('corrupted_state', 'Le dimensioni staged non corrispondono al run.');
  }
}

// ─── Composizione del manifest ────────────────────────────────────────────────

/**
 * Compone il manifest privato dai **soli** valori autorevoli: identità dal
 * ticket, byte dal run, editoriale dal docente, `assetId` e `approvedAt` dal
 * server.
 */
export function composePrivateManifest(params: {
  assetId: string;
  candidate: StoredVisualCandidate;
  image: PromotableRunImage;
  anchor: { headingSlug: string; headingText: string };
  caption: string;
  altText: string;
  approvedAt: Timestamp;
}): LessonVisualPrivateManifest {
  const { assetId, candidate, image, anchor, caption, altText, approvedAt } = params;
  return validateLessonVisualPrivateManifest({
    assetId,
    storageRef: canonicalVisualStorageRef({
      ownerUid: candidate.ownerUid,
      importId: candidate.importId,
      udaDir: candidate.udaDir,
      assetId,
    }),
    anchor: {
      headingSlug: anchor.headingSlug,
      headingText: anchor.headingText,
      placement: 'after-heading',
    },
    caption,
    altText,
    width: image.width,
    height: image.height,
    byteLength: image.byteLength,
    sha256: image.sha256,
    mimeType: 'image/webp',
    styleVersion: VISUAL_STYLE_VERSION,
    // Dal ticket, non ricalcolato: rappresenta il corpo **al momento in cui il
    // candidato è nato**, che è l'unica cosa che questa protezione può dire.
    sourceBodyHash: candidate.sourceBodyHash,
    approvedAt,
  });
}

// ─── Piano di scrittura ───────────────────────────────────────────────────────

/**
 * Che cosa la transazione deve scrivere. Calcolato **prima** di qualunque
 * scrittura, così «zero write» è vero a ogni livello e non solo al commit —
 * la stessa regola già applicata a `saveLessonConceptMap` in CONCEPT-MAP-02.
 */
export interface VisualPromotionPlan {
  privateManifest: LessonVisualPrivateManifest;
  /** Presenti solo se la lezione è svolta. */
  publicManifest: LessonVisualPublicManifest | null;
  publicBytes: PublicLessonVisualDoc | null;
  /** Blob canonico da eliminare **dopo** il commit, in caso di sostituzione. */
  supersededStorageRef: string | null;
}

/**
 * Costruisce il piano.
 *
 * **La proiezione pubblica esiste se e solo se la lezione è svolta.** Non è una
 * condizione dell'interfaccia ma un confine dati, lo stesso di CONCEPT-MAP-02:
 * se `completed !== true` il campo pubblico e il documento dei byte non devono
 * proprio esistere, così uno studente non può leggerli nemmeno con un `get()`
 * diretto su un id noto.
 */
export function buildPromotionPlan(params: {
  manifest: LessonVisualPrivateManifest;
  bytes: Uint8Array;
  completed: boolean;
  publicLessonId: string;
  programId: string;
  importId: string;
  previousManifest: LessonVisualPrivateManifest | null;
}): VisualPromotionPlan {
  const { manifest, bytes, completed, publicLessonId, programId, importId, previousManifest } =
    params;

  const supersededStorageRef =
    previousManifest && previousManifest.storageRef !== manifest.storageRef
      ? previousManifest.storageRef
      : null;

  if (!completed) {
    return {
      privateManifest: manifest,
      publicManifest: null,
      publicBytes: null,
      supersededStorageRef,
    };
  }

  return {
    privateManifest: manifest,
    publicManifest: projectLessonVisual(manifest),
    publicBytes: composePublicLessonVisual({
      manifest,
      bytes,
      publicLessonId,
      programId,
      importId,
    }),
    supersededStorageRef,
  };
}

// ─── Impronta del visual precedente ───────────────────────────────────────────

/**
 * Impronta stabile del valore grezzo di `LessonDoc.visual`, usata per accorgersi
 * che **un'altra promozione** è passata nel frattempo.
 *
 * Serve a un caso preciso: due approvazioni concorrenti sulla stessa lezione.
 * Senza questo confronto la seconda sovrascriverebbe il manifest della prima
 * senza saperlo, e — peggio — calcolerebbe il blob da eliminare sul manifest
 * *che aveva letto lei*, cancellando i byte appena approvati dall'altra.
 *
 * Non è un confronto di uguaglianza profonda su dati arbitrari: normalizza i
 * `Timestamp` in millisecondi e ordina le chiavi, cosi due letture dello stesso
 * documento producono la stessa stringa. Un valore che non si riesce a
 * serializzare diventa `unreadable`, che è comunque diverso da `absent` e da
 * qualunque manifest leggibile: l'unico effetto è un abort in più, mai uno in
 * meno.
 */
export function visualFingerprint(raw: unknown): string {
  if (raw === undefined || raw === null) return 'absent';
  try {
    return stableStringify(raw);
  } catch {
    return 'unreadable';
  }
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  const maybeTimestamp = value as { toMillis?: unknown };
  if (typeof maybeTimestamp.toMillis === 'function') {
    return `T${(maybeTimestamp.toMillis as () => number)()}`;
  }
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}

// ─── Idempotenza ──────────────────────────────────────────────────────────────

/**
 * Impronta dell'input approvato. Due promozioni con lo stesso `requestId` sono
 * la stessa promozione **solo** se anche l'editoriale coincide: cambiare la
 * didascalia e ripresentare lo stesso `requestId` non è un retry, è una
 * richiesta diversa, e va rifiutata invece di essere silenziosamente ignorata.
 */
export function computePromotionInputHash(input: VisualPromotionInput): string {
  return sha256Hex(
    JSON.stringify({
      programId: input.programId,
      importId: input.importId,
      lessonId: input.lessonId,
      anchorHeadingText: input.anchorHeadingText,
      anchorHeadingIndex: input.anchorHeadingIndex,
      caption: input.caption,
      altText: input.altText,
    }),
  );
}

/** Record server-only della promozione, per il replay dopo una risposta persa. */
export interface StoredVisualPromotion {
  contractVersion: 1;
  ownerUid: string;
  inputHash: string;
  assetId: string;
  storageRef: string;
  createdAtMs: number;
  expireAtMs: number;
}

const PROMOTION_RECORD_KEYS = [
  'contractVersion',
  'ownerUid',
  'inputHash',
  'assetId',
  'storageRef',
  'createdAtMs',
  'expireAtMs',
] as const;

const SHA256_HEX_RE = /^[0-9a-f]{64}$/;

/**
 * Parser **chiuso** del record di promozione.
 *
 * Un cast diretto qui sarebbe la cosa più pericolosa del modulo: questo
 * documento decide se una richiesta è un replay, e un record malformato letto
 * come valido restituirebbe al docente un `assetId` che non esiste — oppure,
 * peggio, verrebbe scambiato per assente e produrrebbe una **seconda**
 * promozione dello stesso `requestId`, con un secondo asset e un secondo audit.
 *
 * Restituisce `null` per «malformato». Chi chiama non deve tradurlo in «fresh»:
 * un record che c'è ma non si sa leggere è uno stato corrotto, non uno stato
 * vuoto — ed è l'unica lettura possibile, perché il documento esiste e nessuno
 * sa che cosa dica.
 */
export function parseStoredVisualPromotion(value: unknown): StoredVisualPromotion | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const root = value as Record<string, unknown>;

  const keys = Object.keys(root).sort();
  const expected = [...PROMOTION_RECORD_KEYS].sort();
  if (keys.length !== expected.length || keys.some((k, i) => k !== expected[i])) return null;
  if (root.contractVersion !== 1) return null;

  const { ownerUid, inputHash, assetId, storageRef, createdAtMs, expireAtMs } = root;
  if (typeof ownerUid !== 'string' || ownerUid.length === 0 || ownerUid !== ownerUid.trim()) {
    return null;
  }
  if (typeof inputHash !== 'string' || !SHA256_HEX_RE.test(inputHash)) return null;
  if (typeof assetId !== 'string' || !UUID_V4_RE.test(assetId)) return null;
  if (typeof storageRef !== 'string' || storageRef.length === 0) return null;
  // Lo `storageRef` non è un'etichetta libera: è la posizione canonica di
  // **questo** asset. Se non finisce con l'`assetId` che il record dichiara,
  // i due campi raccontano due cose diverse e nessuna delle due è affidabile.
  if (!storageRef.endsWith(`/visuals/${assetId}.webp`)) return null;
  if (
    typeof createdAtMs !== 'number' ||
    typeof expireAtMs !== 'number' ||
    !Number.isFinite(createdAtMs) ||
    !Number.isFinite(expireAtMs) ||
    createdAtMs <= 0 ||
    expireAtMs <= createdAtMs
  ) {
    return null;
  }

  return {
    contractVersion: 1,
    ownerUid,
    inputHash,
    assetId,
    storageRef,
    createdAtMs,
    expireAtMs,
  };
}

export type VisualPromotionReplay =
  | { status: 'fresh' }
  | { status: 'replayed'; assetId: string; storageRef: string }
  | { status: 'conflict' };

/**
 * Decide se una promozione è nuova, un replay o un conflitto.
 *
 * Una risposta persa **dopo** il commit non deve creare un secondo asset, un
 * secondo audit o una seconda copia: il record dice che quel `requestId` è già
 * stato promosso, e il replay restituisce lo stesso risultato.
 */
export function reconcileVisualPromotion(params: {
  existing: StoredVisualPromotion | null;
  ownerUid: string;
  inputHash: string;
}): VisualPromotionReplay {
  const { existing, ownerUid, inputHash } = params;
  if (!existing) return { status: 'fresh' };
  if (existing.ownerUid !== ownerUid || existing.inputHash !== inputHash) {
    return { status: 'conflict' };
  }
  return { status: 'replayed', assetId: existing.assetId, storageRef: existing.storageRef };
}

/** Messaggio del rifiuto del ticket, riusato dal gateway. */
export { describeCandidateCheckFailure, checkVisualCandidate, computeSourceBodyHash };
