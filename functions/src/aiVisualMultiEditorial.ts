/**
 * MULTI-VISUAL-03C — operazioni editoriali pure sul manifest multi-visuale.
 *
 * Questo modulo non legge Firestore/Storage e non conosce callable: compone e
 * valida i nuovi stati prima che un gateway li persista. Il gateway deve
 * rileggere i documenti dentro la transazione e usare questi risultati senza
 * ricostruire array a mano.
 */
import {
  AiVisualMultiError,
  MAX_VISUALS_PER_LESSON,
  assertExactKeys,
  asRecord,
  isUuidV4,
} from './aiVisualMultiCore.js';
import {
  validateLessonVisualsManifest,
  validatePublicLessonVisualsManifest,
  type LessonVisualsManifest,
  type PublicLessonVisualsManifest,
} from './aiVisualMultiManifest.js';
import { canonicalVisualStorageRef } from './aiVisualManifest.js';
import { timestampToMillis } from './aiContentCore.js';

function invalid(message: string): never {
  throw new AiVisualMultiError('invalid_input', message);
}

/** Confronto d'insieme ordinato, usato per proteggere il riordino da stale write. */
export function sameAssetOrder(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((assetId, index) => assetId === b[index]);
}

export interface ReorderVisualsInput {
  expectedAssetIds: string[];
  nextAssetIds: string[];
}

export function validateReorderVisualsInput(value: unknown): ReorderVisualsInput {
  const root = asRecord(value, 'Payload di riordino non valido.');
  assertExactKeys(root, ['expectedAssetIds', 'nextAssetIds'], 'Payload di riordino');
  const parse = (raw: unknown, label: string): string[] => {
    if (!Array.isArray(raw) || raw.length < 1 || raw.length > MAX_VISUALS_PER_LESSON) {
      invalid(`${label} non valido.`);
    }
    const ids = raw.map((id, index) => {
      if (!isUuidV4(id)) invalid(`${label}[${index}] non valido.`);
      return id;
    });
    if (new Set(ids).size !== ids.length) invalid(`${label} contiene duplicati.`);
    return ids;
  };
  const expectedAssetIds = parse(root.expectedAssetIds, 'expectedAssetIds');
  const nextAssetIds = parse(root.nextAssetIds, 'nextAssetIds');
  if (
    new Set(expectedAssetIds).size !== new Set(nextAssetIds).size ||
    !expectedAssetIds.every((id) => nextAssetIds.includes(id))
  ) {
    invalid('Il riordino non può aggiungere o rimuovere immagini.');
  }
  return { expectedAssetIds, nextAssetIds };
}

export function reorderVisualsManifest(
  manifest: LessonVisualsManifest,
  nextAssetIds: readonly string[],
): LessonVisualsManifest {
  const current = manifest.items.map((item) => item.assetId);
  if (!sameAssetOrder([...current].sort(), [...nextAssetIds].sort())) {
    invalid('Il riordino non corrisponde al manifest corrente.');
  }
  const byId = new Map(manifest.items.map((item) => [item.assetId, item]));
  const items = nextAssetIds.map((assetId) => byId.get(assetId));
  if (items.some((item) => item === undefined)) invalid('Asset assente nel manifest.');
  return validateLessonVisualsManifest({ contractVersion: manifest.contractVersion, items });
}

export function removeVisualFromManifest(
  manifest: LessonVisualsManifest,
  assetId: string,
): LessonVisualsManifest | null {
  if (!isUuidV4(assetId)) invalid('assetId non valido.');
  const items = manifest.items.filter((item) => item.assetId !== assetId);
  if (items.length === manifest.items.length) invalid('Asset non presente nel manifest.');
  return items.length === 0
    ? null
    : validateLessonVisualsManifest({ contractVersion: manifest.contractVersion, items });
}

export function projectEditorialVisuals(
  manifest: LessonVisualsManifest | null,
): PublicLessonVisualsManifest | null {
  if (manifest === null) return null;
  return validatePublicLessonVisualsManifest({
    contractVersion: manifest.contractVersion,
    items: manifest.items.map(({ assetId, anchor, caption, altText, width, height }) => ({
      assetId,
      anchor,
      caption,
      altText,
      width,
      height,
    })),
  });
}

const CLEANUP_KEYS = [
  'ownerUid',
  'programId',
  'importId',
  'lessonId',
  'publicLessonId',
  'udaDir',
  'assetIds',
  'storageRefs',
  'createdAt',
] as const;

export interface VisualCleanupRecoveryRecord {
  ownerUid: string;
  programId: string;
  importId: string;
  lessonId: string;
  publicLessonId: string;
  udaDir: string;
  assetIds: string[];
  storageRefs: string[];
  createdAt: unknown;
}

function segment(
  value: unknown,
  label: string,
  code: AiVisualMultiError['code'] = 'invalid_input',
): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value !== value.trim() ||
    value.includes('/') ||
    value === '.' ||
    value === '..' ||
    Buffer.byteLength(value, 'utf8') > 1500
  )
    throw new AiVisualMultiError(code, `${label} non valido.`);
  return value;
}

export function validateVisualCleanupRecoveryRecord(value: unknown): VisualCleanupRecoveryRecord {
  const root = asRecord(value, 'Record di recovery non valido.', 'corrupted_state');
  assertExactKeys(root, CLEANUP_KEYS, 'Record di recovery', 'corrupted_state');
  for (const key of ['ownerUid', 'programId', 'importId', 'lessonId', 'publicLessonId', 'udaDir']) {
    segment(root[key], key, 'corrupted_state');
  }
  if (
    !Array.isArray(root.assetIds) ||
    !Array.isArray(root.storageRefs) ||
    root.assetIds.length < 1 ||
    root.assetIds.length > MAX_VISUALS_PER_LESSON ||
    root.assetIds.length !== root.storageRefs.length
  ) {
    throw new AiVisualMultiError('corrupted_state', 'Recovery con cardinalità non valida.');
  }
  const assetIds = root.assetIds.map((id) => {
    if (!isUuidV4(id))
      throw new AiVisualMultiError('corrupted_state', 'assetId di recovery non valido.');
    return id;
  });
  if (new Set(assetIds).size !== assetIds.length) {
    throw new AiVisualMultiError('corrupted_state', 'assetId duplicato nel recovery.');
  }
  const storageRefs = root.storageRefs.map((ref, index) => {
    if (
      typeof ref !== 'string' ||
      ref !==
        canonicalVisualStorageRef({
          ownerUid: root.ownerUid as string,
          importId: root.importId as string,
          udaDir: root.udaDir as string,
          assetId: assetIds[index],
        })
    )
      throw new AiVisualMultiError('corrupted_state', 'Percorso di recovery non canonico.');
    return ref;
  });
  if (timestampToMillis(root.createdAt) === null) {
    throw new AiVisualMultiError('corrupted_state', 'Timestamp di recovery non valido.');
  }
  return {
    ...root,
    assetIds,
    storageRefs,
    createdAt: root.createdAt,
  } as VisualCleanupRecoveryRecord;
}
