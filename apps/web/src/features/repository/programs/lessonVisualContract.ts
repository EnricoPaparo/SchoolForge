import type {
  LessonVisualPrivateManifest,
  LessonVisualItem,
  LessonVisualPublicManifest,
  LessonVisualsManifest,
} from '../../../types/firestore.js';
import type { Timestamp } from 'firebase/firestore';

/**
 * VISUAL-ENRICHMENT-04A — lettura **fail-closed** dei dati visuali lato client.
 *
 * Stesso ruolo di `conceptMapContract.ts` per la mappa: un solo posto in cui si
 * decide se ciò che è arrivato è utilizzabile, così nessuna vista deve rifare
 * quel ragionamento e nessuna può dimenticarsene.
 *
 * Il criterio è sempre lo stesso: **niente figura è meglio di una figura
 * sbagliata**. Un manifest incompleto, un `assetId` che non combacia, un data
 * URI che non è WebP producono `null` — la lezione si legge senza immagine, che
 * è esattamente com'era prima che la funzione esistesse.
 */

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEADING_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const WEBP_DATA_URI_PREFIX = 'data:image/webp;base64,';
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

/**
 * Tetto sul data URI, non sui byte: 204.800 byte di WebP diventano ~273.070
 * caratteri base64. Il margine copre l'arrotondamento del padding.
 */
export const MAX_VISUAL_DATA_URI_LENGTH = WEBP_DATA_URI_PREFIX.length + 280_000;

/** Le sei chiavi di presentazione, e nient'altro. */
const PUBLIC_MANIFEST_KEYS = [
  'assetId',
  'anchor',
  'caption',
  'altText',
  'width',
  'height',
] as const;

const ANCHOR_KEYS = ['headingSlug', 'headingText', 'placement'] as const;
const PRIVATE_MANIFEST_KEYS = [
  ...PUBLIC_MANIFEST_KEYS,
  'storageRef',
  'byteLength',
  'sha256',
  'mimeType',
  'styleVersion',
  'sourceBodyHash',
  'approvedAt',
] as const;
const MULTI_PRIVATE_MANIFEST_KEYS = [...PRIVATE_MANIFEST_KEYS, 'source'] as const;
const SHA256_HEX_RE = /^[0-9a-f]{64}$/;

function hasControlCharacters(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0)!;
    return codePoint <= 0x1f || codePoint === 0x7f;
  });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, i) => key === expected[i]);
}

function isPositiveInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isCanonicalSegment(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value === value.trim() &&
    !value.includes('/') &&
    value !== '.' &&
    value !== '..' &&
    !hasControlCharacters(value)
  );
}

function isClosedText(value: unknown, max: number): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value === value.trim() &&
    [...value].length <= max &&
    !hasControlCharacters(value) &&
    !/<\/?[a-z][^>]*>/i.test(value)
  );
}

function isResolvedTimestamp(value: unknown): value is Timestamp {
  if (!isPlainObject(value) && typeof value !== 'object') return false;
  if (value === null || typeof (value as { toMillis?: unknown }).toMillis !== 'function') {
    return false;
  }
  try {
    const millis = (value as { toMillis: () => unknown }).toMillis();
    return typeof millis === 'number' && Number.isFinite(millis);
  } catch {
    return false;
  }
}

export type PrivateVisualManifestParseResult =
  | { kind: 'absent' }
  | { kind: 'valid'; manifest: LessonVisualPrivateManifest }
  | { kind: 'malformed' };

export type PrivateVisualsManifestParseResult =
  | { kind: 'absent' }
  | { kind: 'valid'; manifest: LessonVisualsManifest }
  | { kind: 'malformed' };

/** Manifest docente chiuso: assenza e corruzione sono esiti distinti. */
export function parsePrivateVisualManifest(params: {
  value: unknown;
  ownerUid: unknown;
  importId: unknown;
  udaDir: unknown;
}): PrivateVisualManifestParseResult {
  const { value, ownerUid, importId, udaDir } = params;
  if (value === undefined || value === null) return { kind: 'absent' };
  if (
    !isCanonicalSegment(ownerUid) ||
    !isCanonicalSegment(importId) ||
    !isCanonicalSegment(udaDir) ||
    !isPlainObject(value) ||
    !hasExactKeys(value, PRIVATE_MANIFEST_KEYS)
  ) {
    return { kind: 'malformed' };
  }
  const { assetId, anchor, caption, altText, width, height } = value;
  if (typeof assetId !== 'string' || !UUID_V4_RE.test(assetId)) return { kind: 'malformed' };
  if (!isClosedText(caption, 500) || !isClosedText(altText, 1_000)) {
    return { kind: 'malformed' };
  }
  if (
    !isPositiveInt(width) ||
    !isPositiveInt(height) ||
    Math.max(width, height) > 1_200 ||
    !isPositiveInt(value.byteLength) ||
    value.byteLength > 204_800
  ) {
    return { kind: 'malformed' };
  }
  if (
    !isPlainObject(anchor) ||
    !hasExactKeys(anchor, ANCHOR_KEYS) ||
    typeof anchor.headingSlug !== 'string' ||
    !HEADING_SLUG_RE.test(anchor.headingSlug) ||
    !isClosedText(anchor.headingText, 300) ||
    anchor.placement !== 'after-heading'
  ) {
    return { kind: 'malformed' };
  }
  const expectedStorageRef = `repository/${ownerUid}/${importId}/${udaDir}/visuals/${assetId}.webp`;
  if (
    value.storageRef !== expectedStorageRef ||
    typeof value.sha256 !== 'string' ||
    !SHA256_HEX_RE.test(value.sha256) ||
    value.mimeType !== 'image/webp' ||
    value.styleVersion !== 'schoolforge-sketch/v1' ||
    typeof value.sourceBodyHash !== 'string' ||
    !SHA256_HEX_RE.test(value.sourceBodyHash) ||
    !isResolvedTimestamp(value.approvedAt)
  ) {
    return { kind: 'malformed' };
  }
  return { kind: 'valid', manifest: value as unknown as LessonVisualPrivateManifest };
}

/** Manifest multi-visuale privato: radice chiusa e ogni voce validata integralmente. */
export function parsePrivateVisualsManifest(params: {
  value: unknown;
  ownerUid: unknown;
  importId: unknown;
  udaDir: unknown;
}): PrivateVisualsManifestParseResult {
  const { value, ownerUid, importId, udaDir } = params;
  if (value === undefined || value === null) return { kind: 'absent' };
  if (
    !isPlainObject(value) ||
    !hasExactKeys(value, ['contractVersion', 'items']) ||
    value.contractVersion !== 'lesson-visuals/v1' ||
    !Array.isArray(value.items) ||
    value.items.length < 1 ||
    value.items.length > 3
  ) {
    return { kind: 'malformed' };
  }
  const items: LessonVisualItem[] = [];
  const assetIds = new Set<string>();
  for (const item of value.items) {
    if (!isPlainObject(item) || !hasExactKeys(item, MULTI_PRIVATE_MANIFEST_KEYS)) {
      return { kind: 'malformed' };
    }
    const validSourceStyle =
      (item.source === 'generated' && item.styleVersion === 'schoolforge-sketch/v1') ||
      (item.source === 'uploaded' && item.styleVersion === 'uploaded/v1');
    if (!validSourceStyle) return { kind: 'malformed' };
    const legacyShape = { ...item, styleVersion: 'schoolforge-sketch/v1' };
    delete (legacyShape as { source?: unknown }).source;
    const parsed = parsePrivateVisualManifest({
      value: legacyShape,
      ownerUid,
      importId,
      udaDir,
    });
    if (parsed.kind !== 'valid' || assetIds.has(parsed.manifest.assetId)) {
      return { kind: 'malformed' };
    }
    assetIds.add(parsed.manifest.assetId);
    items.push(item as unknown as LessonVisualItem);
  }
  return {
    kind: 'valid',
    manifest: { contractVersion: 'lesson-visuals/v1', items },
  };
}

/**
 * Valida il manifest **pubblico** di una lezione.
 *
 * La forma è chiusa in entrambi i versi: mancano chiavi ⇒ `null`, ce ne sono in
 * più ⇒ `null`. Una chiave in più non è un dettaglio: significherebbe che la
 * proiezione ha guadagnato un campo che nessuno ha progettato — magari uno di
 * quelli privati che VE-03A ha lavorato per tenere fuori.
 */
export function readPublicVisualManifest(value: unknown): LessonVisualPublicManifest | null {
  if (!isPlainObject(value)) return null;
  if (!hasExactKeys(value, PUBLIC_MANIFEST_KEYS)) return null;

  const { assetId, anchor, caption, altText, width, height } = value;
  if (typeof assetId !== 'string' || !UUID_V4_RE.test(assetId)) return null;
  if (!isNonEmptyString(caption) || !isNonEmptyString(altText)) return null;
  if (!isPositiveInt(width) || !isPositiveInt(height)) return null;

  if (!isPlainObject(anchor) || !hasExactKeys(anchor, ANCHOR_KEYS)) return null;
  if (typeof anchor.headingSlug !== 'string' || !HEADING_SLUG_RE.test(anchor.headingSlug)) {
    return null;
  }
  if (!isNonEmptyString(anchor.headingText)) return null;
  if (anchor.placement !== 'after-heading') return null;

  return {
    assetId,
    anchor: {
      headingSlug: anchor.headingSlug,
      headingText: anchor.headingText,
      placement: 'after-heading',
    },
    caption,
    altText,
    width,
    height,
  };
}

/**
 * Il manifest esiste per lo studente **solo** se la lezione è svolta.
 *
 * L'invariante è già imposto dalle Rules e dal server, ma viene riapplicato in
 * lettura come per la mappa concettuale: un documento scritto male o rimasto
 * indietro non deve poter mostrare un'immagine su una lezione che il docente
 * non ha ancora svolto.
 */
export function readStudentVisualManifest(data: unknown): LessonVisualPublicManifest | null {
  if (!isPlainObject(data)) return null;
  if (data.completed !== true) return null;
  return readPublicVisualManifest(data.visual);
}

export function readStudentVisualManifests(data: unknown): LessonVisualPublicManifest[] {
  if (!isPlainObject(data) || data.completed !== true || !isPlainObject(data.visuals)) return [];
  const root = data.visuals;
  if (
    !hasExactKeys(root, ['contractVersion', 'items']) ||
    root.contractVersion !== 'lesson-visuals/v1' ||
    !Array.isArray(root.items) ||
    root.items.length < 1 ||
    root.items.length > 3
  )
    return [];
  const parsed = root.items.map(readPublicVisualManifest);
  if (!parsed.every((item): item is LessonVisualPublicManifest => item !== null)) return [];
  if (new Set(parsed.map((item) => item.assetId)).size !== parsed.length) return [];
  return parsed;
}

/** Byte pubblici di una lezione, come li scrive `publicLessonVisuals`. */
export interface PublicLessonVisualBytes {
  publicLessonId: string;
  programId: string;
  importId: string;
  assetId: string;
  dataUri: string;
  width: number;
  height: number;
}

const BYTES_DOC_KEYS = [
  'publicLessonId',
  'programId',
  'importId',
  'assetId',
  'dataUri',
  'width',
  'height',
] as const;

/**
 * Valida un data URI WebP **senza decodificarlo**.
 *
 * Decodificare per validare significherebbe allocare 200 KB per scoprire che
 * sono spazzatura; il prefisso e l'alfabeto base64 bastano a escludere tutto
 * ciò che non è un'immagine WebP. Il contenuto vero l'ha già verificato il
 * server — hash, dimensioni e struttura RIFF — prima di scriverlo.
 */
export function isWebpDataUri(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (!value.startsWith(WEBP_DATA_URI_PREFIX)) return false;
  if (value.length > MAX_VISUAL_DATA_URI_LENGTH) return false;
  const payload = value.slice(WEBP_DATA_URI_PREFIX.length);
  if (payload.length === 0 || payload.length % 4 !== 0) return false;
  return BASE64_RE.test(payload);
}

/**
 * Valida il documento dei byte **contro il manifest che lo ha annunciato**.
 *
 * I due documenti sono scritti nello stesso commit, ma sono comunque due: il
 * confronto di `assetId`, `publicLessonId` e dimensioni è ciò che impedisce a
 * un documento rimasto indietro — lezione smarcata, immagine sostituita — di
 * essere mostrato al posto di quello giusto. Divergenza ⇒ `null`, mai la
 * figura sbagliata.
 */
export function readPublicLessonVisualBytes(params: {
  data: unknown;
  publicLessonId: string;
  manifest: LessonVisualPublicManifest;
}): PublicLessonVisualBytes | null {
  const { data, publicLessonId, manifest } = params;
  if (!isPlainObject(data)) return null;
  if (!hasExactKeys(data, BYTES_DOC_KEYS)) return null;

  if (data.publicLessonId !== publicLessonId) return null;
  if (data.assetId !== manifest.assetId) return null;
  if (data.width !== manifest.width || data.height !== manifest.height) return null;
  if (!isNonEmptyString(data.programId) || !isNonEmptyString(data.importId)) return null;
  if (!isWebpDataUri(data.dataUri)) return null;

  return {
    publicLessonId,
    programId: data.programId,
    importId: data.importId,
    assetId: manifest.assetId,
    dataUri: data.dataUri,
    width: manifest.width,
    height: manifest.height,
  };
}

/** Valida il documento dei byte multi-visuali contro il manifest pubblico. */
export function readPublicLessonVisualBytesMulti(params: {
  data: unknown;
  publicLessonId: string;
  manifests: LessonVisualPublicManifest[];
}): Record<string, { assetId: string; dataUri: string; width: number; height: number }> | null {
  if (!isPlainObject(params.data) || params.manifests.length === 0) return null;
  if (
    !hasExactKeys(params.data, [
      'contractVersion',
      'publicLessonId',
      'programId',
      'importId',
      'bytes',
    ]) ||
    params.data.contractVersion !== 'lesson-visuals/v1' ||
    params.data.publicLessonId !== params.publicLessonId ||
    typeof params.data.programId !== 'string' ||
    typeof params.data.importId !== 'string' ||
    !isPlainObject(params.data.bytes)
  )
    return null;
  const bytesRoot = params.data.bytes;
  const expectedAssetIds = params.manifests.map((manifest) => manifest.assetId).sort();
  const actualAssetIds = Object.keys(bytesRoot).sort();
  if (
    actualAssetIds.length !== expectedAssetIds.length ||
    !actualAssetIds.every((assetId, index) => assetId === expectedAssetIds[index])
  ) {
    return null;
  }
  const result: Record<
    string,
    { assetId: string; dataUri: string; width: number; height: number }
  > = {};
  for (const manifest of params.manifests) {
    const raw = bytesRoot[manifest.assetId];
    if (
      !isPlainObject(raw) ||
      !hasExactKeys(raw, ['dataUri', 'mimeType', 'width', 'height']) ||
      raw.mimeType !== 'image/webp' ||
      !isWebpDataUri(raw.dataUri)
    )
      return null;
    if (raw.width !== manifest.width || raw.height !== manifest.height) return null;
    result[manifest.assetId] = {
      assetId: manifest.assetId,
      dataUri: raw.dataUri,
      width: manifest.width,
      height: manifest.height,
    };
  }
  return result;
}

/**
 * Compone il data URI dai byte base64 restituiti dall'export docente.
 *
 * `null` se il base64 non è utilizzabile: il docente vede la lezione senza
 * figura, non un'immagine rotta con l'icona del browser.
 */
export function composeVisualDataUri(base64: unknown): string | null {
  if (typeof base64 !== 'string' || base64.length === 0) return null;
  if (base64.length % 4 !== 0 || !BASE64_RE.test(base64)) return null;
  const dataUri = `${WEBP_DATA_URI_PREFIX}${base64}`;
  return dataUri.length > MAX_VISUAL_DATA_URI_LENGTH ? null : dataUri;
}
