import type { PoolLevel, PoolModelProfile } from '../pools/aiContentClient.js';

export const COMPLETE_LESSON_CHECKPOINT_VERSION = 1 as const;
const CHECKPOINT_TTL_MS = 24 * 60 * 60 * 1_000;

export interface CompleteLessonCheckpointIdentity {
  programId: string;
  importId: string;
  lessonId: string;
}

export interface CompleteLessonCheckpointOptions {
  level: PoolLevel;
  counts: { aperta: number; chiusa_singola: number; chiusa_multipla: number };
  modelProfile: PoolModelProfile;
  reviewStatus: 'disabled' | 'improved' | 'unchanged';
}

export interface CompleteLessonCheckpoint {
  version: typeof COMPLETE_LESSON_CHECKPOINT_VERSION;
  identity: CompleteLessonCheckpointIdentity;
  expiresAtMs: number;
  bodyFingerprint: string;
  options: CompleteLessonCheckpointOptions;
  bodyPersisted: true;
  mapCompleted: boolean;
  poolCompleted: boolean;
  mapRequestId: string;
  poolRequestId: string;
  mapReviewRequestId?: string;
  poolReviewRequestId?: string;
  mapCostMicroUsd: number | null;
  poolCostMicroUsd: number | null;
  visual: {
    contentRequestId: string;
    planRequestId: string;
    promotionRequestIds: Record<string, string>;
  } | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Impronta locale anti-stale, non usata come garanzia crittografica. */
export function fingerprintCompleteLessonBody(body: string): string {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < body.length; index += 1) {
    const code = body.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ (code + index), 0x85ebca6b);
  }
  return `${body.length}:${(first >>> 0).toString(16)}:${(second >>> 0).toString(16)}`;
}

export function completeLessonCheckpointKey(identity: CompleteLessonCheckpointIdentity): string {
  return `schoolforge:complete-lesson:v1:${identity.programId}:${identity.importId}:${identity.lessonId}`;
}

export function createCompleteLessonCheckpoint(
  input: Omit<CompleteLessonCheckpoint, 'version' | 'expiresAtMs' | 'bodyFingerprint'> & {
    body: string;
    nowMs?: number;
  },
): CompleteLessonCheckpoint {
  const { body, nowMs = Date.now(), ...checkpoint } = input;
  return {
    version: COMPLETE_LESSON_CHECKPOINT_VERSION,
    expiresAtMs: nowMs + CHECKPOINT_TTL_MS,
    bodyFingerprint: fingerprintCompleteLessonBody(body),
    ...checkpoint,
  };
}

function validOptions(value: unknown): value is CompleteLessonCheckpointOptions {
  if (!isRecord(value)) return false;
  if (value.level !== 'base' && value.level !== 'balanced' && value.level !== 'advanced') {
    return false;
  }
  if (value.modelProfile !== 'economy' && value.modelProfile !== 'quality') return false;
  if (
    value.reviewStatus !== 'disabled' &&
    value.reviewStatus !== 'improved' &&
    value.reviewStatus !== 'unchanged'
  ) {
    return false;
  }
  if (!isRecord(value.counts)) return false;
  const counts = value.counts;
  return ['aperta', 'chiusa_singola', 'chiusa_multipla'].every((key) => {
    const count = counts[key];
    return typeof count === 'number' && Number.isInteger(count) && count >= 0;
  });
}

function validIdentity(
  value: unknown,
  expected: CompleteLessonCheckpointIdentity,
): value is CompleteLessonCheckpointIdentity {
  return (
    isRecord(value) &&
    value.programId === expected.programId &&
    value.importId === expected.importId &&
    value.lessonId === expected.lessonId
  );
}

export function parseCompleteLessonCheckpoint(
  raw: string | null,
  identity: CompleteLessonCheckpointIdentity,
  currentBody: string,
  nowMs = Date.now(),
): CompleteLessonCheckpoint | null {
  if (!raw || !currentBody.trim()) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value)) return null;
    if (value.version !== COMPLETE_LESSON_CHECKPOINT_VERSION) return null;
    if (!validIdentity(value.identity, identity)) return null;
    if (typeof value.expiresAtMs !== 'number' || value.expiresAtMs <= nowMs) return null;
    if (value.bodyFingerprint !== fingerprintCompleteLessonBody(currentBody)) return null;
    if (!validOptions(value.options)) return null;
    if (value.bodyPersisted !== true) return null;
    if (typeof value.mapCompleted !== 'boolean' || typeof value.poolCompleted !== 'boolean') {
      return null;
    }
    if (typeof value.mapRequestId !== 'string' || typeof value.poolRequestId !== 'string')
      return null;
    if (
      (value.mapReviewRequestId !== undefined && typeof value.mapReviewRequestId !== 'string') ||
      (value.poolReviewRequestId !== undefined && typeof value.poolReviewRequestId !== 'string')
    )
      return null;
    for (const cost of [value.mapCostMicroUsd, value.poolCostMicroUsd]) {
      if (cost !== null && (typeof cost !== 'number' || !Number.isFinite(cost) || cost < 0))
        return null;
    }
    if (value.visual !== null) {
      if (!isRecord(value.visual)) return null;
      if (
        typeof value.visual.contentRequestId !== 'string' ||
        typeof value.visual.planRequestId !== 'string' ||
        !isRecord(value.visual.promotionRequestIds)
      ) {
        return null;
      }
      if (!Object.values(value.visual.promotionRequestIds).every((id) => typeof id === 'string')) {
        return null;
      }
    }
    return value as unknown as CompleteLessonCheckpoint;
  } catch {
    return null;
  }
}

export function readCompleteLessonCheckpoint(
  identity: CompleteLessonCheckpointIdentity,
  currentBody: string,
): CompleteLessonCheckpoint | null {
  if (typeof window === 'undefined') return null;
  // Il contenuto può essere ancora in caricamento quando la pagina si monta:
  // non cancellare un checkpoint potenzialmente valido prima della lettura.
  if (!currentBody.trim()) return null;
  const key = completeLessonCheckpointKey(identity);
  try {
    const parsed = parseCompleteLessonCheckpoint(
      window.sessionStorage.getItem(key),
      identity,
      currentBody,
    );
    if (!parsed) window.sessionStorage.removeItem(key);
    return parsed;
  } catch {
    return null;
  }
}

export function writeCompleteLessonCheckpoint(checkpoint: CompleteLessonCheckpoint): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(
      completeLessonCheckpointKey(checkpoint.identity),
      JSON.stringify(checkpoint),
    );
  } catch {
    // Storage disabilitato o pieno: il workflow in memoria continua normalmente.
  }
}

export function clearCompleteLessonCheckpoint(identity: CompleteLessonCheckpointIdentity): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(completeLessonCheckpointKey(identity));
  } catch {
    // Nessun blocco del workflow se lo storage del browser non è disponibile.
  }
}
