/** MULTI-VISUAL-03B — documento pubblico dei byte per 1..3 immagini. */

import { MAX_VISUAL_BYTES, MAX_VISUAL_LONG_EDGE } from './aiContentVisualProposal.js';
import { decodeVisualDataUri, inspectWebp, sha256Hex } from './aiVisualCore.js';
import {
  AiVisualMultiError,
  LESSON_VISUALS_CONTRACT_VERSION,
  asRecord,
  assertExactKeys,
  isUuidV4,
} from './aiVisualMultiCore.js';
import type { LessonVisualItem, LessonVisualsManifest } from './aiVisualMultiManifest.js';

export interface PublicLessonVisualBytesEntry {
  dataUri: string;
  mimeType: 'image/webp';
  width: number;
  height: number;
}

export interface PublicLessonVisualBytesDoc {
  contractVersion: typeof LESSON_VISUALS_CONTRACT_VERSION;
  publicLessonId: string;
  programId: string;
  importId: string;
  bytes: Record<string, PublicLessonVisualBytesEntry>;
}

function invalid(message: string): never {
  throw new AiVisualMultiError('corrupted_state', message);
}

function id(value: unknown, label: string): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value !== value.trim() ||
    value === '.' ||
    value === '..' ||
    value.includes('/') ||
    Buffer.byteLength(value, 'utf8') > 1_500
  )
    invalid(`${label} non valido.`);
  return value;
}

export function validatePublicLessonVisualBytesDoc(value: unknown): PublicLessonVisualBytesDoc {
  const root = asRecord(value, 'Documento byte multi-visuale non valido.', 'corrupted_state');
  assertExactKeys(
    root,
    ['contractVersion', 'publicLessonId', 'programId', 'importId', 'bytes'],
    'Documento byte multi-visuale',
    'corrupted_state',
  );
  if (root.contractVersion !== LESSON_VISUALS_CONTRACT_VERSION)
    invalid('contractVersion non valida.');
  const bytesRoot = asRecord(root.bytes, 'Mappa byte non valida.', 'corrupted_state');
  const entries = Object.entries(bytesRoot);
  if (entries.length < 1 || entries.length > 3)
    invalid('La mappa byte deve contenere da uno a tre asset.');
  const bytes: Record<string, PublicLessonVisualBytesEntry> = {};
  for (const [assetId, raw] of entries) {
    if (!isUuidV4(assetId)) invalid('Chiave assetId non valida.');
    const entry = asRecord(raw, 'Byte asset non validi.', 'corrupted_state');
    assertExactKeys(
      entry,
      ['dataUri', 'mimeType', 'width', 'height'],
      'Byte asset',
      'corrupted_state',
    );
    if (entry.mimeType !== 'image/webp') invalid('mimeType non valido.');
    if (
      typeof entry.width !== 'number' ||
      !Number.isInteger(entry.width) ||
      entry.width <= 0 ||
      entry.width > MAX_VISUAL_LONG_EDGE ||
      typeof entry.height !== 'number' ||
      !Number.isInteger(entry.height) ||
      entry.height <= 0 ||
      entry.height > MAX_VISUAL_LONG_EDGE
    ) {
      invalid('Dimensioni dei byte non valide.');
    }
    const decoded = decodeVisualDataUri(entry.dataUri);
    if (decoded.byteLength > MAX_VISUAL_BYTES) invalid('Byte oltre il limite.');
    const inspected = inspectWebp(decoded);
    if (inspected.width !== entry.width || inspected.height !== entry.height)
      invalid('Dimensioni dichiarate divergenti dai byte.');
    bytes[assetId] = {
      dataUri: entry.dataUri as string,
      mimeType: 'image/webp',
      width: entry.width,
      height: entry.height,
    };
  }
  return {
    contractVersion: LESSON_VISUALS_CONTRACT_VERSION,
    publicLessonId: id(root.publicLessonId, 'publicLessonId'),
    programId: id(root.programId, 'programId'),
    importId: id(root.importId, 'importId'),
    bytes,
  };
}

export function composePublicBytesEntry(
  item: LessonVisualItem,
  bytes: Uint8Array,
): PublicLessonVisualBytesEntry {
  if (sha256Hex(bytes) !== item.sha256 || bytes.byteLength !== item.byteLength) {
    invalid('I byte non corrispondono al manifest.');
  }
  return {
    dataUri: `data:image/webp;base64,${Buffer.from(bytes).toString('base64')}`,
    mimeType: 'image/webp',
    width: item.width,
    height: item.height,
  };
}

export function composePublicLessonVisualBytesDoc(params: {
  manifest: LessonVisualsManifest;
  entries: ReadonlyMap<string, Uint8Array>;
  publicLessonId: string;
  programId: string;
  importId: string;
}): PublicLessonVisualBytesDoc {
  const bytes: Record<string, PublicLessonVisualBytesEntry> = {};
  for (const item of params.manifest.items) {
    const raw = params.entries.get(item.assetId);
    if (!raw) invalid('Mancano i byte di un asset del manifest.');
    bytes[item.assetId] = composePublicBytesEntry(item, raw);
  }
  return validatePublicLessonVisualBytesDoc({
    contractVersion: LESSON_VISUALS_CONTRACT_VERSION,
    publicLessonId: params.publicLessonId,
    programId: params.programId,
    importId: params.importId,
    bytes,
  });
}
