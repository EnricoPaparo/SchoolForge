/**
 * MULTI-VISUAL-01 — manifest ad array (roadmap §5.1–§5.3), compatibilità e
 * adozione dal manifest singolo VE (roadmap §6).
 *
 * Ogni tipo qui dentro **riusa** i contratti canonici del visual singolo
 * invece di ridefinirli: `LessonVisualAnchor`, `validateLessonVisualAnchor`,
 * `validateLessonVisualManifest`, `assertManifestText`,
 * `assertCanonicalStorageRef`, le costanti `MAX_VISUAL_*`, `VISUAL_STYLE_VERSION`
 * vengono tutte da `aiContentVisualProposal.ts` (VE-01) — mai una seconda
 * definizione dello stesso vincolo. `FORBIDDEN_PUBLIC_VISUAL_KEYS` viene da
 * `aiVisualManifest.ts` (VE-03) ed è **esteso**, non riscritto, con `source`.
 *
 * Puro: nessuna rete, nessun I/O, nessuna dipendenza Firebase.
 */

import {
  MAX_VISUAL_ALT_TEXT_CHARS,
  MAX_VISUAL_BYTES,
  MAX_VISUAL_CAPTION_CHARS,
  MAX_VISUAL_LONG_EDGE,
  VISUAL_STYLE_VERSION,
  assertCanonicalStorageRef,
  assertManifestText,
  validateLessonVisualAnchor,
  validateLessonVisualManifest,
  type LessonVisualAnchor,
  type LessonVisualManifest,
  type VisualTimestampLike,
} from './aiContentVisualProposal.js';
import { timestampToMillis } from './aiContentCore.js';
import { FORBIDDEN_PUBLIC_VISUAL_KEYS } from './aiVisualManifest.js';
import {
  LESSON_VISUALS_CONTRACT_VERSION,
  MAX_VISUALS_PER_LESSON,
  UPLOADED_VISUAL_STYLE_VERSION,
  AiVisualMultiError,
  asRecord,
  assertExactKeys,
} from './aiVisualMultiCore.js';

// ─── Forme dati (roadmap §5.1–§5.3) ────────────────────────────────────────────

/** Un'immagine approvata, generata o caricata. Vista SOLO del docente. */
export interface LessonVisualItem {
  assetId: string;
  storageRef: string;
  anchor: LessonVisualAnchor;
  caption: string;
  altText: string;
  width: number;
  height: number;
  byteLength: number;
  sha256: string;
  mimeType: 'image/webp';
  source: 'generated' | 'uploaded';
  styleVersion: typeof VISUAL_STYLE_VERSION | typeof UPLOADED_VISUAL_STYLE_VERSION;
  sourceBodyHash: string;
  approvedAt: VisualTimestampLike;
}

/** Contenitore delle immagini approvate di una lezione. 1..3 elementi, mai vuoto. */
export interface LessonVisualsManifest {
  contractVersion: typeof LESSON_VISUALS_CONTRACT_VERSION;
  items: LessonVisualItem[];
}

/** Sottoinsieme del manifest privato per la proiezione studente. Niente `source`. */
export interface PublicLessonVisualItem {
  assetId: string;
  anchor: LessonVisualAnchor;
  caption: string;
  altText: string;
  width: number;
  height: number;
}

export interface PublicLessonVisualsManifest {
  contractVersion: typeof LESSON_VISUALS_CONTRACT_VERSION;
  items: PublicLessonVisualItem[];
}

// ─── Validazione dell'immagine singola dell'array ──────────────────────────────

const ITEM_KEYS = [
  'assetId',
  'storageRef',
  'anchor',
  'caption',
  'altText',
  'width',
  'height',
  'byteLength',
  'sha256',
  'mimeType',
  'source',
  'styleVersion',
  'sourceBodyHash',
  'approvedAt',
] as const;

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA256_HEX_RE = /^[0-9a-f]{64}$/;

function invalid(message: string): never {
  throw new AiVisualMultiError('invalid_input', message);
}

function assertPositiveInt(value: unknown, label: string, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0 || value > max) {
    invalid(`${label} non valido.`);
  }
  return value;
}

/**
 * Valida una singola immagine dell'array, fail-closed e senza correzioni.
 *
 * **Non** è `validateLessonVisualManifest` con una chiave in più: quel
 * validatore accetta solo `styleVersion === VISUAL_STYLE_VERSION`, mentre qui
 * `source: 'uploaded'` richiede `styleVersion === 'uploaded/v1'` — delegare
 * l'intera validazione rifiuterebbe ogni immagine caricata. La forma e le
 * singole regole restano però quelle canoniche, importate una per una.
 */
export function validateLessonVisualItem(value: unknown): LessonVisualItem {
  const root = asRecord(value, 'Immagine della lezione non valida.');
  assertExactKeys(root, ITEM_KEYS, 'Immagine della lezione');

  const assetIdRaw = root.assetId;
  if (typeof assetIdRaw !== 'string' || !UUID_V4_RE.test(assetIdRaw))
    invalid('assetId non valido.');
  const assetId = assetIdRaw;

  const storageRef = assertCanonicalStorageRef(root.storageRef, assetId);
  const anchor = validateLessonVisualAnchor(root.anchor);
  const caption = assertManifestText(root.caption, 'Didascalia', MAX_VISUAL_CAPTION_CHARS);
  const altText = assertManifestText(root.altText, 'Testo alternativo', MAX_VISUAL_ALT_TEXT_CHARS);
  const width = assertPositiveInt(root.width, 'Larghezza', MAX_VISUAL_LONG_EDGE);
  const height = assertPositiveInt(root.height, 'Altezza', MAX_VISUAL_LONG_EDGE);
  if (Math.max(width, height) > MAX_VISUAL_LONG_EDGE) {
    invalid(`Il lato lungo supera ${MAX_VISUAL_LONG_EDGE} pixel.`);
  }
  const byteLength = assertPositiveInt(root.byteLength, 'Dimensione', MAX_VISUAL_BYTES);

  const sha256 = root.sha256;
  if (typeof sha256 !== 'string' || !SHA256_HEX_RE.test(sha256)) invalid('sha256 non valido.');
  if (root.mimeType !== 'image/webp') invalid('mimeType non ammesso.');

  const source = root.source;
  if (source !== 'generated' && source !== 'uploaded') invalid('source non ammesso.');

  const styleVersion = root.styleVersion;
  if (source === 'generated' && styleVersion !== VISUAL_STYLE_VERSION) {
    invalid('styleVersion non coerente con source "generated".');
  }
  if (source === 'uploaded' && styleVersion !== UPLOADED_VISUAL_STYLE_VERSION) {
    invalid('styleVersion non coerente con source "uploaded".');
  }

  const sourceBodyHash = root.sourceBodyHash;
  if (typeof sourceBodyHash !== 'string' || !SHA256_HEX_RE.test(sourceBodyHash)) {
    invalid('sourceBodyHash non valido.');
  }

  const approvedAt = root.approvedAt;
  if (timestampToMillis(approvedAt) === null) invalid('approvedAt non valido.');

  return {
    assetId,
    storageRef,
    anchor,
    caption,
    altText,
    width,
    height,
    byteLength,
    sha256,
    mimeType: 'image/webp',
    source,
    styleVersion: styleVersion as LessonVisualItem['styleVersion'],
    sourceBodyHash,
    approvedAt: approvedAt as VisualTimestampLike,
  };
}

// ─── Validazione del manifest privato (array) ──────────────────────────────────

const MANIFEST_KEYS = ['contractVersion', 'items'] as const;

/**
 * `items.length` in 1..3 — mai vuoto, mai oltre il tetto (roadmap §4). Ordine
 * preservato: è l'array stesso, non un riordino implicito. `assetId` unici:
 * due elementi con lo stesso identificatore descriverebbero lo stesso asset
 * due volte, uno stato che il resto del contratto non sa interpretare.
 */
export function validateLessonVisualsManifest(value: unknown): LessonVisualsManifest {
  const root = asRecord(value, 'Manifest visivo non valido.');
  assertExactKeys(root, MANIFEST_KEYS, 'Manifest visivo');
  if (root.contractVersion !== LESSON_VISUALS_CONTRACT_VERSION) {
    invalid('contractVersion non valida.');
  }
  if (!Array.isArray(root.items)) invalid('items non valido.');
  if (root.items.length < 1 || root.items.length > MAX_VISUALS_PER_LESSON) {
    invalid(`items deve contenere da 1 a ${MAX_VISUALS_PER_LESSON} elementi.`);
  }

  const items = root.items.map((item: unknown) => validateLessonVisualItem(item));
  const seenAssetIds = new Set<string>();
  for (const item of items) {
    if (seenAssetIds.has(item.assetId)) invalid('assetId duplicato nel manifest.');
    seenAssetIds.add(item.assetId);
  }

  return { contractVersion: LESSON_VISUALS_CONTRACT_VERSION, items };
}

// ─── Manifest pubblico ──────────────────────────────────────────────────────────

export const PUBLIC_VISUAL_ITEM_KEYS = [
  'assetId',
  'anchor',
  'caption',
  'altText',
  'width',
  'height',
] as const;

/**
 * Come VE §4 (`FORBIDDEN_PUBLIC_VISUAL_KEYS`), **esteso** con `source`: la
 * provenienza è un metadato di governo, non serve al renderer studente
 * (roadmap §5.3, §13). La lista di VE non viene riscritta, solo estesa.
 */
export const FORBIDDEN_PUBLIC_VISUAL_ITEM_KEYS = [
  ...FORBIDDEN_PUBLIC_VISUAL_KEYS,
  'source',
] as const;

export function validatePublicLessonVisualItem(value: unknown): PublicLessonVisualItem {
  const root = asRecord(value, 'Immagine pubblica della lezione non valida.');
  for (const forbidden of FORBIDDEN_PUBLIC_VISUAL_ITEM_KEYS) {
    if (forbidden in root) {
      invalid(`Immagine pubblica della lezione: il campo privato ${forbidden} non è proiettabile.`);
    }
  }
  assertExactKeys(root, PUBLIC_VISUAL_ITEM_KEYS, 'Immagine pubblica della lezione');

  const assetId = root.assetId;
  if (typeof assetId !== 'string' || !UUID_V4_RE.test(assetId)) invalid('assetId non valido.');

  const width = assertPositiveInt(root.width, 'Larghezza', MAX_VISUAL_LONG_EDGE);
  const height = assertPositiveInt(root.height, 'Altezza', MAX_VISUAL_LONG_EDGE);
  if (Math.max(width, height) > MAX_VISUAL_LONG_EDGE) {
    invalid(`Il lato lungo supera ${MAX_VISUAL_LONG_EDGE} pixel.`);
  }

  return {
    assetId,
    anchor: validateLessonVisualAnchor(root.anchor),
    caption: assertManifestText(root.caption, 'Didascalia', MAX_VISUAL_CAPTION_CHARS),
    altText: assertManifestText(root.altText, 'Testo alternativo', MAX_VISUAL_ALT_TEXT_CHARS),
    width,
    height,
  };
}

export function validatePublicLessonVisualsManifest(value: unknown): PublicLessonVisualsManifest {
  const root = asRecord(value, 'Manifest visivo pubblico non valido.');
  assertExactKeys(root, MANIFEST_KEYS, 'Manifest visivo pubblico');
  if (root.contractVersion !== LESSON_VISUALS_CONTRACT_VERSION) {
    invalid('contractVersion non valida.');
  }
  if (!Array.isArray(root.items)) invalid('items non valido.');
  if (root.items.length < 1 || root.items.length > MAX_VISUALS_PER_LESSON) {
    invalid(`items deve contenere da 1 a ${MAX_VISUALS_PER_LESSON} elementi.`);
  }

  const items = root.items.map((item: unknown) => validatePublicLessonVisualItem(item));
  const seenAssetIds = new Set<string>();
  for (const item of items) {
    if (seenAssetIds.has(item.assetId)) invalid('assetId duplicato nel manifest pubblico.');
    seenAssetIds.add(item.assetId);
  }

  return { contractVersion: LESSON_VISUALS_CONTRACT_VERSION, items };
}

/**
 * Deriva la proiezione pubblica dal manifest privato. Unica porta, come
 * `projectLessonVisual` di VE-03: nessun punto di scrittura compone il
 * documento pubblico a campo per campo nel punto di commit.
 */
export function projectLessonVisualsManifest(
  manifest: LessonVisualsManifest,
): PublicLessonVisualsManifest {
  return validatePublicLessonVisualsManifest({
    contractVersion: LESSON_VISUALS_CONTRACT_VERSION,
    items: manifest.items.map((item) => ({
      assetId: item.assetId,
      anchor: {
        headingSlug: item.anchor.headingSlug,
        headingText: item.anchor.headingText,
        placement: item.anchor.placement,
      },
      caption: item.caption,
      altText: item.altText,
      width: item.width,
      height: item.height,
    })),
  });
}

// ─── Adozione pigra dal manifest singolo (roadmap §6.2) ────────────────────────

/**
 * Lettura compatibile invariata: `visual` singolare trattato come un array a
 * un elemento. Copia 1:1, `source: 'generated'` — il manifest singolo VE non
 * ha mai avuto altro. Puro: non scrive nulla, la scrittura reale (adozione
 * transazionale) è competenza delle fasi successive (§6.2, non nello scope
 * di MULTI-VISUAL-01).
 */
export function adaptSingular(manifest: LessonVisualManifest): LessonVisualItem {
  return {
    assetId: manifest.assetId,
    storageRef: manifest.storageRef,
    anchor: manifest.anchor,
    caption: manifest.caption,
    altText: manifest.altText,
    width: manifest.width,
    height: manifest.height,
    byteLength: manifest.byteLength,
    sha256: manifest.sha256,
    mimeType: manifest.mimeType,
    source: 'generated',
    styleVersion: manifest.styleVersion,
    sourceBodyHash: manifest.sourceBodyHash,
    approvedAt: manifest.approvedAt,
  };
}

// ─── Matrice di lettura legacy (roadmap §6.1) ──────────────────────────────────

export type LegacyLessonVisualsReadOutcome =
  | { status: 'none' }
  | { status: 'ok'; manifest: LessonVisualsManifest; adoptedFromSingular: boolean }
  | { status: 'visuals_malformed' }
  | { status: 'visual_legacy_malformed' }
  | { status: 'visual_legacy_conflict' };

/**
 * Procedura di lettura a tre passi, sempre in quest'ordine (roadmap §6.1):
 *
 * 1. co-presenza di `visuals` e `visual` → `visual_legacy_conflict`, **prima**
 *    di qualunque validazione strutturale, indipendentemente dalla validità
 *    di ciascuno;
 * 2. un solo campo presente → si valida quello, malformato è fail-closed con
 *    il codice specifico del campo che ha fallito;
 * 3. nessuno dei due presente → nessuna immagine.
 *
 * «Presente» significa il campo diverso da `undefined`: un documento
 * Firestore non porta mai una chiave con valore `undefined`, quindi questa è
 * la stessa nozione di presenza che una lettura reale del documento userebbe.
 */
export function readLegacyLessonVisuals(doc: {
  visual?: unknown;
  visuals?: unknown;
}): LegacyLessonVisualsReadOutcome {
  const hasVisuals = doc.visuals !== undefined;
  const hasVisual = doc.visual !== undefined;

  if (hasVisuals && hasVisual) {
    return { status: 'visual_legacy_conflict' };
  }

  if (hasVisuals) {
    try {
      return {
        status: 'ok',
        manifest: validateLessonVisualsManifest(doc.visuals),
        adoptedFromSingular: false,
      };
    } catch {
      return { status: 'visuals_malformed' };
    }
  }

  if (hasVisual) {
    try {
      const single = validateLessonVisualManifest(doc.visual);
      return {
        status: 'ok',
        manifest: {
          contractVersion: LESSON_VISUALS_CONTRACT_VERSION,
          items: [adaptSingular(single)],
        },
        adoptedFromSingular: true,
      };
    } catch {
      return { status: 'visual_legacy_malformed' };
    }
  }

  return { status: 'none' };
}
