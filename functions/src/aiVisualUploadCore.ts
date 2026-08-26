/**
 * MULTI-VISUAL-02 — nucleo puro della catena binaria dell'upload (roadmap
 * §9, §9.6–§9.9): contratto `VisualUploadRun`, sniffing dei magic byte,
 * decodifica base64 con cap grezzo verificato **prima** di qualunque
 * decodifica immagine, identità deterministica e percorso di staging.
 *
 * **Riuso, non reinvenzione.** L'identità opaca e il percorso di staging
 * hanno **la stessa forma** di VE (`computeVisualRunId`/`visualStagingRef`,
 * `aiVisualCore.ts`): stesso `canonicalTuple`/`sha256Hex`, solo un namespace
 * diverso (`visual-upload/v1` invece di `visual-enrichment/v1`), e lo stesso
 * `visualStagingRef`/`isCanonicalVisualStagingRef` — nessun secondo
 * costruttore di percorso. Il selettore d'ancora è quello di MULTI-VISUAL-01
 * (`VisualAnchorSelector`, indice+testo), non una terza forma.
 *
 * Puro: nessuna rete, nessun I/O, nessuna dipendenza Firebase o Sharp — la
 * normalizzazione vera (che tocca Sharp) vive in
 * `aiVisualUploadNormalizer.ts`, la (de)serializzazione Firestore in
 * `aiVisualUploadRunDoc.ts`.
 */

import { AiContentError, timestampToMillis } from './aiContentCore.js';
import {
  MAX_VISUAL_ALT_TEXT_CHARS,
  MAX_VISUAL_BYTES,
  MAX_VISUAL_CAPTION_CHARS,
  MAX_VISUAL_LONG_EDGE,
  VISUAL_STAGING_TTL_MS,
  assertProposalField,
  type VisualTimestampLike,
} from './aiContentVisualProposal.js';
import {
  AiVisualError,
  canonicalTuple,
  inspectWebp,
  isCanonicalVisualStagingRef,
  sha256Hex,
  visualStagingRef,
} from './aiVisualCore.js';
import { isValidDocumentIdInput } from './firestoreDocumentId.js';
import { validateVisualAnchorSelector, type VisualAnchorSelector } from './aiVisualMultiAnchor.js';
import {
  MAX_VISUAL_UPLOAD_INPUT_BYTES,
  AiVisualMultiError,
  asRecord,
  assertExactKeys,
  isSha256Hex,
  isUuidV4,
} from './aiVisualMultiCore.js';
import type { ACCEPTED_VISUAL_UPLOAD_MIME_TYPES } from './aiVisualMultiCore.js';

// ─── Identità (roadmap §9.6) ────────────────────────────────────────────────

export const VISUAL_UPLOAD_CONTRACT_VERSION = 'visual-upload/v1' as const;

/**
 * `opaqueUploadRunId = SHA-256(canonical(['visual-upload/v1', ownerUid,
 * requestId]))` (roadmap §9.6) — stesso schema di `computeVisualRunId`/
 * `computeOpaqueVisualPlanId`, namespace distinto perché un `requestId` non
 * deve poter collidere fra domini diversi (VE §8.1).
 */
export function computeOpaqueVisualUploadRunId(ownerUid: string, requestId: string): string {
  return sha256Hex(canonicalTuple([VISUAL_UPLOAD_CONTRACT_VERSION, ownerUid, requestId]));
}

/**
 * `staging/{ownerUid}/{opaqueUploadRunId}.webp` — **stessa** funzione di VE
 * (`visualStagingRef`), non una seconda definizione: la forma del percorso
 * di staging non dipende dal dominio (piano, upload o generazione singola),
 * solo dall'identità che lo popola.
 */
export function visualUploadStagingRef(ownerUid: string, opaqueUploadRunId: string): string {
  return visualStagingRef(ownerUid, opaqueUploadRunId);
}

export { isCanonicalVisualStagingRef as isCanonicalVisualUploadStagingRef };

// ─── Passo 0 — sniffing del formato (roadmap §9.2) ─────────────────────────

export type VisualUploadFormat = (typeof ACCEPTED_VISUAL_UPLOAD_MIME_TYPES)[number];

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff]);

/**
 * Allowlist esclusiva a tre formati sui **magic byte reali**, mai sul
 * `Content-Type` dichiarato dal client (roadmap §9.2). SVG (testuale/
 * vettoriale, può veicolare script) e GIF non sono mai in allowlist,
 * indipendentemente da come il client li dichiara.
 */
export function sniffVisualUploadFormat(bytes: Buffer): VisualUploadFormat {
  if (
    bytes.length >= PNG_SIGNATURE.length &&
    bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)
  ) {
    return 'image/png';
  }
  if (
    bytes.length >= JPEG_SIGNATURE.length &&
    bytes.subarray(0, JPEG_SIGNATURE.length).equals(JPEG_SIGNATURE)
  ) {
    return 'image/jpeg';
  }
  if (
    bytes.length >= 12 &&
    bytes.toString('ascii', 0, 4) === 'RIFF' &&
    bytes.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  throw new AiVisualMultiError(
    'visual_upload_unsupported_format',
    'Formato immagine non ammesso: sono accettati solo PNG, JPEG e WebP.',
  );
}

/**
 * Preflight puro eseguito sul payload prima di qualunque lettura o scrittura.
 * Per WebP riusa il parser di contenitore VE e rifiuta subito animazione o
 * contenitore corrotto; PNG/JPEG vengono poi decodificati realmente da Sharp
 * soltanto dopo la reservation anti-race.
 */
function assertAllowedUploadMagicBytes(bytes: Buffer): void {
  const format = sniffVisualUploadFormat(bytes);
  if (format !== 'image/webp') return;
  try {
    if (inspectWebp(bytes).animated) {
      throw new AiVisualMultiError(
        'visual_upload_unsupported_format',
        'I WebP animati non sono ammessi.',
      );
    }
  } catch (error) {
    if (error instanceof AiVisualMultiError) throw error;
    if (error instanceof AiVisualError) {
      throw new AiVisualMultiError(
        'visual_upload_unsupported_format',
        'Il file WebP non è valido.',
      );
    }
    throw error;
  }
}

const STRICT_BASE64_RE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

/**
 * Decodifica base64 → byte grezzi, con il cap di 2.000.000 byte verificato
 * **prima** di qualunque decodifica dell'immagine (roadmap §9.2 passo 1):
 * la lunghezza grezza è calcolata **aritmeticamente** dalla lunghezza della
 * stringa base64 (`(len/4)×3 − padding`), quindi il cap rifiuta un input
 * troppo grande senza che `Buffer.from` lo decodifichi mai. Base64 non
 * canonico (lunghezza non multipla di 4, caratteri fuori alfabeto, padding
 * malformato) è rifiutato allo stesso passo, con lo stesso esito: nessun
 * decoder, nessun I/O.
 */
export function decodeVisualUploadBase64(value: unknown): Buffer {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length % 4 !== 0 ||
    !STRICT_BASE64_RE.test(value)
  ) {
    throw new AiVisualMultiError('invalid_input', 'Byte immagine mancanti o non canonici.');
  }
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  const rawByteLength = (value.length / 4) * 3 - padding;
  if (rawByteLength > MAX_VISUAL_UPLOAD_INPUT_BYTES) {
    throw new AiVisualMultiError(
      'visual_upload_too_large',
      `Il file supera il limite di ${MAX_VISUAL_UPLOAD_INPUT_BYTES} byte.`,
    );
  }
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length !== rawByteLength || bytes.toString('base64') !== value) {
    throw new AiVisualMultiError('invalid_input', 'Byte immagine mancanti o non canonici.');
  }
  return bytes;
}

// ─── Contratto `VisualUploadRun` (roadmap §9.6) ────────────────────────────

export type VisualUploadRunStatus =
  | 'accepted'
  | 'ready'
  | 'promoted'
  | 'abandoned'
  | 'expired'
  | 'failed';

export type VisualUploadLastError =
  | 'visual_upload_too_large'
  | 'visual_upload_unsupported_format'
  | 'visual_upload_conflict';

export interface VisualUploadNormalized {
  storageRef: string;
  width: number;
  height: number;
  byteLength: number;
  sha256: string;
}

/**
 * Forma persistita del run di upload. `caption`/`altText` sono qui
 * **sempre** stringhe non nulle: a differenza di `VisualPlanSlot` (dove sono
 * nulli finché una decisione non li produce), MULTI-VISUAL-02 implementa un
 * solo punto d'ingresso — la callable di accettazione — che riceve byte e
 * metadati editoriali **nella stessa chiamata** (roadmap §9.3, «il docente
 * scrive caption/altText esplicitamente prima di poter confermare»): non
 * esiste, in questo scope, una fase successiva che li imposti su un record
 * già creato con campi nulli.
 */
export interface VisualUploadRun {
  contractVersion: typeof VISUAL_UPLOAD_CONTRACT_VERSION;
  ownerUid: string;
  programId: string;
  importId: string;
  lessonId: string;
  publicLessonId: string;
  udaDir: string;
  requestId: string;
  status: VisualUploadRunStatus;
  sourceBodyHash: string;
  anchor: VisualAnchorSelector;
  rawBytesSha256: string;
  rawByteLength: number;
  normalized: VisualUploadNormalized | null;
  caption: string;
  altText: string;
  lastError: VisualUploadLastError | null;
  createdAt: VisualTimestampLike;
  updatedAt: VisualTimestampLike;
  expireAt: VisualTimestampLike;
}

const RUN_KEYS = [
  'contractVersion',
  'ownerUid',
  'programId',
  'importId',
  'lessonId',
  'publicLessonId',
  'udaDir',
  'requestId',
  'status',
  'sourceBodyHash',
  'anchor',
  'rawBytesSha256',
  'rawByteLength',
  'normalized',
  'caption',
  'altText',
  'lastError',
  'createdAt',
  'updatedAt',
  'expireAt',
] as const;

const NORMALIZED_KEYS = ['storageRef', 'width', 'height', 'byteLength', 'sha256'] as const;

const RUN_STATUSES: readonly VisualUploadRunStatus[] = [
  'accepted',
  'ready',
  'promoted',
  'abandoned',
  'expired',
  'failed',
];
const LAST_ERRORS: readonly VisualUploadLastError[] = [
  'visual_upload_too_large',
  'visual_upload_unsupported_format',
  'visual_upload_conflict',
];

function invalidRun(message: string): never {
  throw new AiVisualMultiError('corrupted_state', message);
}

function assertIdSegment(value: unknown, label: string): string {
  if (!isValidDocumentIdInput(value)) invalidRun(`${label} non valido.`);
  return value;
}

/**
 * Stessa forma di `assertIdSegment`, ma per il payload **del client**: un
 * `programId`/`importId`/`lessonId` malformato lì è `invalid_input` (un
 * client ha mandato un valore fuori contratto), mai `corrupted_state` (che
 * significa «un record persistito è incoerente con se stesso» — non è mai
 * ciò che succede qui, la richiesta non è ancora stata scritta).
 */
function assertIdSegmentInput(value: unknown, label: string): string {
  if (!isValidDocumentIdInput(value)) {
    throw new AiVisualMultiError('invalid_input', `${label} non valido.`);
  }
  return value as string;
}

function assertBoundedPositiveInt(value: unknown, label: string, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0 || value > max) {
    invalidRun(`${label} non valida.`);
  }
  return value;
}

function assertTimestampLike(value: unknown, label: string): VisualTimestampLike {
  if (timestampToMillis(value) === null) invalidRun(`${label} non valido.`);
  return value as VisualTimestampLike;
}

function validateNormalized(
  value: unknown,
  ownerUid: string,
  opaqueUploadRunId: string,
): VisualUploadNormalized {
  const root = asRecord(value, 'Byte normalizzati non validi.', 'corrupted_state');
  assertExactKeys(root, NORMALIZED_KEYS, 'Byte normalizzati', 'corrupted_state');
  const storageRef = root.storageRef;
  if (
    typeof storageRef !== 'string' ||
    !isCanonicalVisualStagingRef(storageRef, opaqueUploadRunId) ||
    storageRef.split('/')[1] !== ownerUid
  ) {
    invalidRun('storageRef normalizzato non valido o non appartenente a questo run.');
  }
  const width = assertBoundedPositiveInt(root.width, 'Larghezza', MAX_VISUAL_LONG_EDGE);
  const height = assertBoundedPositiveInt(root.height, 'Altezza', MAX_VISUAL_LONG_EDGE);
  if (Math.max(width, height) > MAX_VISUAL_LONG_EDGE) {
    invalidRun(`Il lato lungo supera ${MAX_VISUAL_LONG_EDGE} pixel.`);
  }
  const byteLength = assertBoundedPositiveInt(root.byteLength, 'Dimensione', MAX_VISUAL_BYTES);
  const sha256 = root.sha256;
  if (!isSha256Hex(sha256)) invalidRun('sha256 normalizzato non valido.');
  return { storageRef, width, height, byteLength, sha256 };
}

/**
 * Valida un `VisualUploadRun` persistito, fail-closed. Un record presente ma
 * strutturalmente divergente è sempre `corrupted_state` (stessa disciplina
 * di `VisualPlanRun`, roadmap §5.5, §9.7): non è compito di questo
 * validatore decidere se il record è un replay legittimo o un conflitto
 * d'identità — quel giudizio confronta i campi persistiti con la richiesta
 * corrente ed è competenza del chiamante (gateway), che ha l'I/O per farlo.
 *
 * **Traduzione di qualunque errore annidato in `corrupted_state`** (stessa
 * disciplina di `validateVisualPlanRun`, blocker 5): `caption`/`altText`
 * (via `assertProposalField`) e `anchor` (via `validateVisualAnchorSelector`)
 * lanciano rispettivamente `AiContentError('provider_invalid_output', …)` e
 * `AiVisualMultiError('invalid_input', …)` — codici che appartengono alla
 * validazione di un output **fresco** di un provider o di un payload
 * **client**, mai a un record già persistito. Un record letto da Firestore
 * non deve mai far trapelare quella tassonomia: qualunque divergenza qui è
 * `corrupted_state`, senza eccezioni.
 */
export function validateVisualUploadRun(value: unknown): VisualUploadRun {
  try {
    return parseVisualUploadRunFields(value);
  } catch (error) {
    if (error instanceof AiVisualMultiError) throw error;
    if (error instanceof AiContentError) {
      throw new AiVisualMultiError('corrupted_state', error.message);
    }
    throw error;
  }
}

function parseVisualUploadRunFields(value: unknown): VisualUploadRun {
  const root = asRecord(value, 'Run di upload non valido.', 'corrupted_state');
  assertExactKeys(root, RUN_KEYS, 'Run di upload', 'corrupted_state');

  if (root.contractVersion !== VISUAL_UPLOAD_CONTRACT_VERSION) {
    invalidRun('contractVersion del run di upload non valida.');
  }

  const ownerUid = assertIdSegment(root.ownerUid, 'ownerUid');
  const programId = assertIdSegment(root.programId, 'programId');
  const importId = assertIdSegment(root.importId, 'importId');
  const lessonId = assertIdSegment(root.lessonId, 'lessonId');
  const publicLessonId = assertIdSegment(root.publicLessonId, 'publicLessonId');
  const udaDir = assertIdSegment(root.udaDir, 'udaDir');

  const requestId = root.requestId;
  if (!isUuidV4(requestId)) invalidRun('requestId del run di upload non valido.');

  const status = root.status;
  if (typeof status !== 'string' || !RUN_STATUSES.includes(status as VisualUploadRunStatus)) {
    invalidRun('status del run di upload non valido.');
  }

  const sourceBodyHash = root.sourceBodyHash;
  if (!isSha256Hex(sourceBodyHash)) invalidRun('sourceBodyHash non valido.');

  let anchor: VisualAnchorSelector;
  try {
    anchor = validateVisualAnchorSelector(root.anchor);
  } catch {
    invalidRun("Ancora dell'upload non valida.");
  }

  const rawBytesSha256 = root.rawBytesSha256;
  if (!isSha256Hex(rawBytesSha256)) invalidRun('rawBytesSha256 non valido.');
  const rawByteLength = root.rawByteLength;
  if (
    typeof rawByteLength !== 'number' ||
    !Number.isInteger(rawByteLength) ||
    rawByteLength <= 0 ||
    rawByteLength > MAX_VISUAL_UPLOAD_INPUT_BYTES
  ) {
    invalidRun('rawByteLength non valido.');
  }

  const opaqueUploadRunId = computeOpaqueVisualUploadRunId(ownerUid, requestId);
  const normalizedRaw = root.normalized;
  const requiresNormalized = status === 'ready' || status === 'promoted';
  const forbidsNormalized = status === 'accepted' || status === 'failed';
  if (requiresNormalized && normalizedRaw === null) {
    invalidRun('normalized deve essere presente nello stato ready o promoted.');
  }
  if (forbidsNormalized && normalizedRaw !== null) {
    invalidRun('normalized deve essere assente nello stato accepted o failed.');
  }
  const normalized =
    normalizedRaw === null ? null : validateNormalized(normalizedRaw, ownerUid, opaqueUploadRunId);

  const caption = assertProposalField(root.caption, 'Didascalia', MAX_VISUAL_CAPTION_CHARS);
  const altText = assertProposalField(root.altText, 'Testo alternativo', MAX_VISUAL_ALT_TEXT_CHARS);

  const lastErrorRaw = root.lastError;
  if (lastErrorRaw !== null && !LAST_ERRORS.includes(lastErrorRaw as VisualUploadLastError)) {
    invalidRun('lastError non valido.');
  }
  if ((lastErrorRaw !== null) !== (status === 'failed')) {
    invalidRun('lastError deve essere presente se e solo se lo stato è failed.');
  }

  const createdAt = assertTimestampLike(root.createdAt, 'createdAt');
  const updatedAt = assertTimestampLike(root.updatedAt, 'updatedAt');
  const expireAt = assertTimestampLike(root.expireAt, 'expireAt');
  const createdMs = timestampToMillis(createdAt)!;
  const updatedMs = timestampToMillis(updatedAt)!;
  const expireMs = timestampToMillis(expireAt)!;
  if (expireMs !== createdMs + VISUAL_STAGING_TTL_MS) {
    invalidRun('expireAt non corrisponde a createdAt + TTL 24h.');
  }
  if (status === 'expired') {
    if (updatedMs < expireMs) invalidRun('status "expired" richiede updatedAt >= expireAt.');
  } else if (!(createdMs <= updatedMs && updatedMs <= expireMs)) {
    invalidRun('I timestamp del run di upload non rispettano createdAt ≤ updatedAt ≤ expireAt.');
  }

  return {
    contractVersion: VISUAL_UPLOAD_CONTRACT_VERSION,
    ownerUid,
    programId,
    importId,
    lessonId,
    publicLessonId,
    udaDir,
    requestId,
    status: status as VisualUploadRunStatus,
    sourceBodyHash,
    anchor,
    rawBytesSha256,
    rawByteLength,
    normalized,
    caption,
    altText,
    lastError: lastErrorRaw as VisualUploadLastError | null,
    createdAt,
    updatedAt,
    expireAt,
  };
}

// ─── Payload chiuso della callable di accettazione (roadmap §9.2) ─────────

export interface VisualUploadAcceptInput {
  requestId: string;
  programId: string;
  importId: string;
  lessonId: string;
  rawBytes: Buffer;
  anchor: VisualAnchorSelector;
  caption: string;
  altText: string;
}

const ACCEPT_INPUT_KEYS = [
  'requestId',
  'programId',
  'importId',
  'lessonId',
  'base64',
  'anchor',
  'caption',
  'altText',
] as const;

/**
 * Valida il payload chiuso della callable owner-only di accettazione. Il
 * cap grezzo di 2.000.000 byte e la forma canonica del base64 sono
 * verificati **qui**, dentro `decodeVisualUploadBase64` — prima di
 * qualunque rilettura di `LessonDoc`, prima di Sharp, prima di Storage.
 * `destination` (programId/importId/lessonId) è **proposta** dal client: il
 * server la rilegge sempre contro `LessonDoc` (§9.6, stessa disciplina di
 * `VisualPlanRun`) prima di fidarsene per qualunque scrittura.
 */
export function validateVisualUploadAcceptInput(value: unknown): VisualUploadAcceptInput {
  const root = asRecord(value, 'Payload di upload non valido.');
  assertExactKeys(root, ACCEPT_INPUT_KEYS, 'Payload di upload');

  const requestId = root.requestId;
  if (!isUuidV4(requestId)) throw new AiVisualMultiError('invalid_input', 'requestId non valido.');
  const programId = assertIdSegmentInput(root.programId, 'programId');
  const importId = assertIdSegmentInput(root.importId, 'importId');
  const lessonId = assertIdSegmentInput(root.lessonId, 'lessonId');

  const rawBytes = decodeVisualUploadBase64(root.base64);
  assertAllowedUploadMagicBytes(rawBytes);
  const anchor = validateVisualAnchorSelector(root.anchor);
  // `assertProposalField` lancia `AiContentError('provider_invalid_output', …)`
  // — il codice corretto per un output di provider, non per un payload
  // client. Tradotto qui in `invalid_input`, l'unica volta in cui questo
  // modulo tocca quel campo di testo prima della persistenza.
  let caption: string;
  let altText: string;
  try {
    caption = assertProposalField(root.caption, 'Didascalia', MAX_VISUAL_CAPTION_CHARS);
    altText = assertProposalField(root.altText, 'Testo alternativo', MAX_VISUAL_ALT_TEXT_CHARS);
  } catch (error) {
    if (error instanceof AiContentError) {
      throw new AiVisualMultiError('invalid_input', error.message);
    }
    throw error;
  }

  return { requestId, programId, importId, lessonId, rawBytes, anchor, caption, altText };
}

// ─── Payload chiuso della callable di abbandono ────────────────────────────

export interface VisualUploadAbandonInput {
  requestId: string;
}

export function validateVisualUploadAbandonInput(value: unknown): VisualUploadAbandonInput {
  const root = asRecord(value, 'Payload di abbandono non valido.');
  assertExactKeys(root, ['requestId'], 'Payload di abbandono');
  const requestId = root.requestId;
  if (!isUuidV4(requestId)) throw new AiVisualMultiError('invalid_input', 'requestId non valido.');
  return { requestId };
}
