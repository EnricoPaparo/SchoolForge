/**
 * VISUAL-ENRICHMENT-03 — contratti **puri** del livello persistente
 * dell'arricchimento visuale: manifest privato, proiezione pubblica e documento
 * dei byte destinati allo studente.
 *
 * I tre contratti stanno insieme perché sono **un contratto solo letto da tre
 * lati**, e separarli inviterebbe a proiettare un campo che il privato conosce
 * ma che il pubblico non deve vedere. La proiezione qui è una funzione
 * dichiarata: non si costruisce il documento pubblico copiando campi a mano nel
 * punto di scrittura, si deriva da quello privato attraverso una sola porta.
 *
 * **La differenza fra i due manifest non è cosmetica.** Il privato porta
 * `storageRef`, `sourceBodyHash`, `sha256`, `byteLength` e `approvedAt`: sono
 * metadati di **governo** — dicono dove stanno i byte nel repository del
 * docente, di quale testo parlava l'immagine e come verificarne l'identità. Il
 * pubblico porta solo ciò che serve a **mostrare** l'immagine. Ciò che non
 * serve allo studente non gli viene dato, e `storageRef` in particolare
 * rivelerebbe la struttura del repository del docente.
 *
 * Puro: nessuna rete, nessun I/O, nessun accesso a Firestore o Storage.
 */

import {
  MAX_VISUAL_ALT_TEXT_CHARS,
  MAX_VISUAL_BYTES,
  MAX_VISUAL_CAPTION_CHARS,
  MAX_VISUAL_LONG_EDGE,
  VISUAL_STYLE_VERSION,
  codePointLength,
  validateLessonVisualAnchor,
  validateLessonVisualManifest,
  type LessonVisualAnchor,
  type LessonVisualManifest,
} from './aiContentVisualProposal.js';
import { AiVisualError, decodeVisualDataUri, inspectWebp, sha256Hex } from './aiVisualCore.js';

// ─── Manifest privato ─────────────────────────────────────────────────────────

/**
 * Il manifest privato è **esattamente** `LessonVisualManifest` di VE-01, e il
 * suo validatore è quello già scritto e già testato là: chiavi chiuse,
 * `storageRef` canonico coerente con l'`assetId`, `approvedAt` risolto e finito,
 * `sha256` esadecimale, dimensioni entro i limiti.
 *
 * Non ne esiste una seconda definizione. Due validatori dello stesso documento
 * divergono al primo cambiamento, e uno dei due sarebbe quello sbagliato.
 */
export type LessonVisualPrivateManifest = LessonVisualManifest;
export { validateLessonVisualManifest as validateLessonVisualPrivateManifest };

// ─── Manifest pubblico ────────────────────────────────────────────────────────

/**
 * Ciò che lo studente riceve dentro `PublicLessonDoc.visual`: **solo** quanto
 * serve a rendere l'immagine e a riservarne lo spazio prima che arrivi.
 */
export interface LessonVisualPublicManifest {
  assetId: string;
  anchor: LessonVisualAnchor;
  caption: string;
  altText: string;
  width: number;
  height: number;
}

/** Chiavi ammesse nel manifest pubblico. Nient'altro può comparire. */
export const PUBLIC_VISUAL_KEYS = [
  'assetId',
  'anchor',
  'caption',
  'altText',
  'width',
  'height',
] as const;

/**
 * Campi che **non devono mai** raggiungere la proiezione. Sono elencati
 * esplicitamente, e non solo esclusi per omissione, perché un elenco negativo è
 * ciò che un test può verificare: «questi non ci sono» è una garanzia
 * dimostrabile, «ho copiato solo i campi giusti» è una speranza.
 */
export const FORBIDDEN_PUBLIC_VISUAL_KEYS = [
  'storageRef',
  'sourceBodyHash',
  'sha256',
  'byteLength',
  'approvedAt',
  'mimeType',
  'styleVersion',
  'ownerUid',
  'runId',
  'opaqueRunId',
  'subject',
  'prompt',
  'costMicroUsd',
] as const;

function invalid(message: string): never {
  throw new AiVisualError('corrupted_state', message);
}

function asObject(value: unknown, message: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) invalid(message);
  return value as Record<string, unknown>;
}

function assertExactKeys(
  root: Record<string, unknown>,
  keys: readonly string[],
  label: string,
): void {
  const actual = Object.keys(root).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((k, i) => k !== expected[i])) {
    invalid(`${label}: chiavi non ammesse.`);
  }
}

function assertText(value: unknown, label: string, maxChars: number): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value !== value.trim() ||
    codePointLength(value) > maxChars
  ) {
    invalid(`${label} non valido.`);
  }
  return value;
}

function assertPositiveInt(value: unknown, label: string, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0 || value > max) {
    invalid(`${label} non valido.`);
  }
  return value;
}

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * Valida la proiezione pubblica, fail-closed e **senza correzioni**.
 *
 * Il rifiuto dei campi privati è esplicito e viene **prima** del controllo di
 * chiusura, così l'errore dice quale confine è stato attraversato invece di un
 * generico «chiavi non ammesse»: se un giorno qualcuno proiettasse `storageRef`,
 * il test che fallisce deve nominarlo.
 */
export function validateLessonVisualPublicManifest(value: unknown): LessonVisualPublicManifest {
  const root = asObject(value, 'Manifest visuale pubblico non valido.');
  for (const forbidden of FORBIDDEN_PUBLIC_VISUAL_KEYS) {
    if (forbidden in root) {
      invalid(`Manifest visuale pubblico: il campo privato ${forbidden} non è proiettabile.`);
    }
  }
  assertExactKeys(root, PUBLIC_VISUAL_KEYS, 'Manifest visuale pubblico');

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
    caption: assertText(root.caption, 'Didascalia', MAX_VISUAL_CAPTION_CHARS),
    altText: assertText(root.altText, 'Testo alternativo', MAX_VISUAL_ALT_TEXT_CHARS),
    width,
    height,
  };
}

/**
 * Deriva la proiezione pubblica dal manifest privato.
 *
 * È l'**unica** porta: nessun punto di scrittura compone il documento pubblico
 * a mano. Costruirlo campo per campo nel punto di commit significherebbe che
 * ogni nuovo campo privato è, per default, un campo che qualcuno potrebbe
 * dimenticare di escludere — qui è il contrario, e un campo nuovo resta privato
 * finché non viene aggiunto **qui** di proposito.
 */
export function projectLessonVisual(
  manifest: LessonVisualPrivateManifest,
): LessonVisualPublicManifest {
  return validateLessonVisualPublicManifest({
    assetId: manifest.assetId,
    anchor: {
      headingSlug: manifest.anchor.headingSlug,
      headingText: manifest.anchor.headingText,
      placement: manifest.anchor.placement,
    },
    caption: manifest.caption,
    altText: manifest.altText,
    width: manifest.width,
    height: manifest.height,
  });
}

// ─── Byte pubblici ────────────────────────────────────────────────────────────

/**
 * Documento `publicLessonVisuals/{publicLessonId}`: i byte che lo studente
 * vede davvero.
 *
 * **Perché un documento separato e non un campo di `PublicLessonDoc`.** Lo
 * studente non ha, e non deve avere, accesso a Storage (VE-00 §3): le
 * `storage.rules` sono owner-only e il gateway è testuale per contratto. I byte
 * devono quindi arrivargli via Firestore. Metterli dentro `PublicLessonDoc`
 * significherebbe però trascinare ~200 KB in **ogni** lettura dell'elenco
 * lezioni, che è la query più frequente del portale studente: il documento
 * separato è ciò che tiene il costo dell'elenco dov'è oggi e fa pagare i byte
 * solo a chi apre quella lezione.
 */
export interface PublicLessonVisualDoc {
  publicLessonId: string;
  programId: string;
  importId: string;
  assetId: string;
  /** WebP come data URI base64. Unica forma ammessa. */
  dataUri: string;
  width: number;
  height: number;
}

export const PUBLIC_LESSON_VISUAL_KEYS = [
  'publicLessonId',
  'programId',
  'importId',
  'assetId',
  'dataUri',
  'width',
  'height',
] as const;

/**
 * Campi che non devono comparire nei byte pubblici. Come per il manifest, sono
 * dichiarati e non solo omessi.
 */
export const FORBIDDEN_PUBLIC_VISUAL_DOC_KEYS = [
  'ownerUid',
  'storageRef',
  'sha256',
  'sourceBodyHash',
  'byteLength',
  'subject',
  'prompt',
  'costMicroUsd',
  'runId',
  'opaqueRunId',
  'approvedAt',
] as const;

function assertIdSegment(value: unknown, label: string): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value !== value.trim() ||
    value.includes('/') ||
    // `.` e `..` sono traversal: dentro un percorso Storage cambierebbero la
    // cartella di destinazione, e dentro un id di documento non sono un id.
    value === '.' ||
    value === '..' ||
    Buffer.byteLength(value, 'utf8') > 1_500
  ) {
    invalid(`${label} non valido.`);
  }
  return value;
}

/**
 * Valida il documento dei byte pubblici, fail-closed.
 *
 * Il data URI è **decodificato davvero** e i byte sono ispezionati: non basta
 * che la stringa cominci con il prefisso giusto. Una data URI che non decodifica
 * a un WebP reale, o le cui dimensioni non coincidono con quelle dichiarate,
 * produrrebbe allo studente un'immagine rotta con un manifest che giura il
 * contrario — e il layout riserverebbe uno spazio che nessuna immagine riempie.
 */
export function validatePublicLessonVisualDoc(value: unknown): PublicLessonVisualDoc {
  const root = asObject(value, 'Documento dei byte visuali non valido.');
  for (const forbidden of FORBIDDEN_PUBLIC_VISUAL_DOC_KEYS) {
    if (forbidden in root) {
      invalid(`Byte visuali: il campo privato ${forbidden} non è proiettabile.`);
    }
  }
  assertExactKeys(root, PUBLIC_LESSON_VISUAL_KEYS, 'Byte visuali');

  const assetId = root.assetId;
  if (typeof assetId !== 'string' || !UUID_V4_RE.test(assetId)) invalid('assetId non valido.');

  const width = assertPositiveInt(root.width, 'Larghezza', MAX_VISUAL_LONG_EDGE);
  const height = assertPositiveInt(root.height, 'Altezza', MAX_VISUAL_LONG_EDGE);

  // `decodeVisualDataUri` applica il prefisso `data:image/webp;base64,`, il
  // base64 stretto e il cap di 200 KB: qui si aggiunge la sola cosa che manca,
  // cioè che i byte siano un WebP reale delle dimensioni dichiarate.
  const bytes = decodeVisualDataUri(root.dataUri);
  const inspection = inspectWebp(bytes);
  if (inspection.width !== width || inspection.height !== height) {
    invalid('Byte visuali: le dimensioni dichiarate non corrispondono ai byte.');
  }
  if (bytes.byteLength > MAX_VISUAL_BYTES) {
    invalid('Byte visuali: dimensione oltre il limite.');
  }

  return {
    publicLessonId: assertIdSegment(root.publicLessonId, 'publicLessonId'),
    programId: assertIdSegment(root.programId, 'programId'),
    importId: assertIdSegment(root.importId, 'importId'),
    assetId,
    dataUri: root.dataUri as string,
    width,
    height,
  };
}

/**
 * Compone il documento dei byte pubblici a partire dal manifest privato e dai
 * byte canonici, verificando che i byte siano **quelli** del manifest.
 *
 * Il confronto `sha256` non è una ripetizione: il manifest e i byte arrivano da
 * due letture diverse — Firestore e Storage — e questa è l'unica funzione che
 * li vede insieme. Se divergessero, lo studente riceverebbe byte che nessuno ha
 * approvato, con un manifest che ne descrive altri.
 */
export function composePublicLessonVisual(params: {
  manifest: LessonVisualPrivateManifest;
  bytes: Uint8Array;
  publicLessonId: string;
  programId: string;
  importId: string;
}): PublicLessonVisualDoc {
  const { manifest, bytes, publicLessonId, programId, importId } = params;
  if (sha256Hex(bytes) !== manifest.sha256) {
    invalid('I byte non corrispondono al manifest approvato.');
  }
  if (bytes.byteLength !== manifest.byteLength) {
    invalid('La dimensione dei byte non corrisponde al manifest approvato.');
  }
  const dataUri = `data:image/webp;base64,${Buffer.from(bytes).toString('base64')}`;
  return validatePublicLessonVisualDoc({
    publicLessonId,
    programId,
    importId,
    assetId: manifest.assetId,
    dataUri,
    width: manifest.width,
    height: manifest.height,
  });
}

/** Percorso canonico dell'oggetto Storage approvato. */
export function canonicalVisualStorageRef(params: {
  ownerUid: string;
  importId: string;
  udaDir: string;
  assetId: string;
}): string {
  const { ownerUid, importId, udaDir, assetId } = params;
  for (const [value, label] of [
    [ownerUid, 'ownerUid'],
    [importId, 'importId'],
    [udaDir, 'udaDir'],
  ] as const) {
    assertIdSegment(value, label);
  }
  if (!UUID_V4_RE.test(assetId)) invalid('assetId non valido.');
  return `repository/${ownerUid}/${importId}/${udaDir}/visuals/${assetId}.webp`;
}

/** Il manifest pubblico dichiara `styleVersion`? No — ed è verificabile. */
export const PUBLIC_VISUAL_OMITS_STYLE_VERSION = !(
  PUBLIC_VISUAL_KEYS as readonly string[]
).includes('styleVersion');

export { VISUAL_STYLE_VERSION };
