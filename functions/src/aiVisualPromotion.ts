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
  MAX_VISUAL_ALT_TEXT_CHARS,
  MAX_VISUAL_ANCHOR_HEADING_CHARS,
  MAX_VISUAL_CAPTION_CHARS,
  VISUAL_STYLE_VERSION,
  codePointLength,
  extractLessonHeadings,
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
  caption: string;
  altText: string;
}

const PROMOTION_KEYS = [
  'requestId',
  'programId',
  'importId',
  'lessonId',
  'anchorHeadingText',
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
    caption: assertEditorialText(root.caption, 'Didascalia', MAX_VISUAL_CAPTION_CHARS),
    altText: assertEditorialText(root.altText, 'Testo alternativo', MAX_VISUAL_ALT_TEXT_CHARS),
  };
}

// ─── Slug dell'ancora ─────────────────────────────────────────────────────────

/**
 * Slug deterministico di un heading, con le regole di LESSON-MANUAL-01:
 * normalizzazione NFKD, rimozione dei diacritici, minuscolo, tutto ciò che non è
 * alfanumerico diventa separatore.
 *
 * **Duplicazione dichiarata.** L'implementazione autorevole per il *rendering*
 * vive in `apps/web`, che Functions non può importare: qui l'algoritmo è
 * riscritto. È un rischio reale — se le due divergessero, l'ancora calcolata
 * qui non troverebbe l'heading là — ed è per questo che i casi sono congelati in
 * un test e che il suffisso progressivo sui duplicati è risolto **contro il
 * corpo reale**, non inventato.
 */
export function headingSlug(text: string): string {
  const slug = text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug;
}

/**
 * Risolve lo slug di un heading **dentro un corpo reale**, applicando il
 * suffisso progressivo dei duplicati come fa il renderer.
 *
 * Se il testo non corrisponde a nessun heading del corpo, non si indovina: è un
 * errore. Un'ancora inventata produrrebbe un'immagine che in pagina finisce in
 * coda per un difetto della proposta, non per una scelta del docente.
 */
export function resolveAnchorSlugInBody(
  anchorHeadingText: string,
  lessonBody: string,
): { headingSlug: string; headingText: string } {
  const headings = extractLessonHeadings(lessonBody);
  const seen = new Map<string, number>();
  for (const heading of headings) {
    const base = headingSlug(heading);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    const slug = count === 0 ? base : `${base}-${count}`;
    if (heading === anchorHeadingText) {
      if (slug.length === 0) {
        throw new AiVisualError(
          'invalid_input',
          'L’heading di ancoraggio non produce uno slug valido.',
        );
      }
      return { headingSlug: slug, headingText: heading };
    }
  }
  throw new AiVisualError(
    'invalid_input',
    'L’heading di ancoraggio non esiste nel corpo salvato della lezione.',
  );
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
