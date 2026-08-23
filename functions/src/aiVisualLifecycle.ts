/**
 * VISUAL-ENRICHMENT-03B — contratti puri del lifecycle di un visual approvato.
 *
 * Nessuna funzione in questo file accede a Firebase. Il gateway usa questi
 * parser chiusi prima di ogni I/O e questi fingerprint per dimostrare che il
 * preflight e la transazione hanno osservato lo stesso stato.
 */

import { AiVisualError, computeVisualRunId, sha256Hex } from './aiVisualCore.js';
import {
  canonicalVisualStorageRef,
  validateLessonVisualPrivateManifest,
  type LessonVisualPrivateManifest,
} from './aiVisualManifest.js';
import { visualFingerprint } from './aiVisualPromotion.js';

export interface LessonLifecycleInput {
  programId: string;
  importId: string;
  lessonId: string;
}

export interface SetLessonCompletedInput extends LessonLifecycleInput {
  completed: boolean;
}

export interface AbandonVisualInput {
  requestId: string;
}

export interface DeleteVisualArtifactsInput {
  programId: string;
  importId: string;
  lessonIds: string[];
}

const IDENTITY_KEYS = ['programId', 'importId', 'lessonId'] as const;
const COMPLETION_KEYS = [...IDENTITY_KEYS, 'completed'] as const;
const ABANDON_KEYS = ['requestId'] as const;
const DELETE_ARTIFACT_KEYS = ['programId', 'importId', 'lessonIds'] as const;
const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function invalid(message: string): never {
  throw new AiVisualError('invalid_input', message);
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    invalid('Payload mancante o non valido.');
  }
  return value as Record<string, unknown>;
}

function exact(root: Record<string, unknown>, expected: readonly string[]): void {
  const keys = Object.keys(root).sort();
  const sorted = [...expected].sort();
  if (keys.length !== sorted.length || keys.some((key, index) => key !== sorted[index])) {
    invalid('Il payload contiene proprietà non ammesse.');
  }
}

function segment(value: unknown, label: string): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value !== value.trim() ||
    value.includes('/') ||
    value === '.' ||
    value === '..' ||
    Buffer.byteLength(value, 'utf8') > 1_500
  ) {
    invalid(`${label} non valido.`);
  }
  return value;
}

function parseIdentity(root: Record<string, unknown>): LessonLifecycleInput {
  return {
    programId: segment(root.programId, 'programId'),
    importId: segment(root.importId, 'importId'),
    lessonId: segment(root.lessonId, 'lessonId'),
  };
}

export function validateSetLessonCompletedInput(value: unknown): SetLessonCompletedInput {
  const root = object(value);
  exact(root, COMPLETION_KEYS);
  if (typeof root.completed !== 'boolean') invalid('completed non valido.');
  return { ...parseIdentity(root), completed: root.completed };
}

export function validateRemoveLessonVisualInput(value: unknown): LessonLifecycleInput {
  const root = object(value);
  exact(root, IDENTITY_KEYS);
  return parseIdentity(root);
}

export function validateAbandonVisualInput(value: unknown): AbandonVisualInput {
  const root = object(value);
  exact(root, ABANDON_KEYS);
  if (typeof root.requestId !== 'string' || !UUID_V4_RE.test(root.requestId)) {
    invalid('requestId mancante o malformato.');
  }
  return { requestId: root.requestId };
}

export function validateDeleteVisualArtifactsInput(value: unknown): DeleteVisualArtifactsInput {
  const root = object(value);
  exact(root, DELETE_ARTIFACT_KEYS);
  if (
    !Array.isArray(root.lessonIds) ||
    root.lessonIds.length === 0 ||
    root.lessonIds.length > 100
  ) {
    invalid('lessonIds non valido.');
  }
  const lessonIds = root.lessonIds.map((value) => segment(value, 'lessonId'));
  if (new Set(lessonIds).size !== lessonIds.length) invalid('lessonIds contiene duplicati.');
  return {
    programId: segment(root.programId, 'programId'),
    importId: segment(root.importId, 'importId'),
    lessonIds,
  };
}

/**
 * Un manifest presente deve essere valido e puntare all'unico percorso che la
 * destinazione autorevole consente. Non si usa mai il path per inferire dati.
 */
export function validateCanonicalLessonVisual(params: {
  value: unknown;
  ownerUid: string;
  importId: string;
  udaDir: string;
}): LessonVisualPrivateManifest {
  let manifest: LessonVisualPrivateManifest;
  try {
    manifest = validateLessonVisualPrivateManifest(params.value);
  } catch {
    throw new AiVisualError('corrupted_state', 'Il manifest visuale privato non è valido.');
  }
  const expected = canonicalVisualStorageRef({
    ownerUid: params.ownerUid,
    importId: params.importId,
    udaDir: params.udaDir,
    assetId: manifest.assetId,
  });
  if (manifest.storageRef !== expected) {
    throw new AiVisualError('corrupted_state', 'Il riferimento Storage del visual non è canonico.');
  }
  return manifest;
}

export function lifecycleFingerprint(value: unknown): string {
  return visualFingerprint(value);
}

/** ID opaco e deterministico del record di recovery della rimozione. */
export function visualRemovalId(ownerUid: string, input: LessonLifecycleInput): string {
  return sha256Hex(
    JSON.stringify([
      'visual-removal/v1',
      ownerUid,
      input.programId,
      input.importId,
      input.lessonId,
    ]),
  );
}

export function abandonedVisualRunId(ownerUid: string, requestId: string): string {
  return computeVisualRunId(ownerUid, requestId);
}
