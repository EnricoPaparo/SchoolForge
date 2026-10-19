import { parseCompletePoolContext, type CompletePoolContext } from './studyPractice.js';
import {
  parseArtifactState,
  type MapArtifactState,
  type PoolArtifactState,
} from './completeArtifactState.js';
import { fingerprintCompleteLessonBody } from './completeLessonFingerprint.js';
export { fingerprintCompleteLessonBody } from './completeLessonFingerprint.js';
import {
  parseCompletePracticeState,
  type CompletePracticeState,
} from './completePracticeGeneration.js';
import type { PoolLevel, PoolModelProfile } from '../pools/aiContentClient.js';

export const COMPLETE_LESSON_CHECKPOINT_VERSION = 1 as const;
const CHECKPOINT_TTL_MS = 24 * 60 * 60 * 1_000;

export interface CompleteLessonCheckpointIdentity {
  programId: string;
  importId: string;
  lessonId: string;
}

export interface CompleteLessonCheckpointOptions {
  practiceEnabled?: boolean;
  practiceCount?: 3 | 6 | 9;
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
  practice?: CompletePracticeState;
  mapState?: MapArtifactState;
  poolState?: PoolArtifactState;
  poolContext?: CompletePoolContext;
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
  if (value.practiceEnabled !== undefined && typeof value.practiceEnabled !== 'boolean')
    return false;
  if (
    value.practiceCount !== undefined &&
    (typeof value.practiceCount !== 'number' || ![3, 6, 9].includes(value.practiceCount))
  )
    return false;
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
  if (!raw || raw.length > 1500000 || !currentBody.trim()) return null;
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
    if (value.practice !== undefined) {
      const options = value.options as unknown as CompleteLessonCheckpointOptions;
      if (!options.practiceEnabled || !options.practiceCount) return null;
      value.practice = parseCompletePracticeState(
        value.practice,
        currentBody,
        options.practiceCount,
      );
    }
    if (value.mapState !== undefined)
      value.mapState = parseArtifactState(
        value.mapState,
        'map',
        value.options as unknown as CompleteLessonCheckpointOptions,
      );
    if (value.poolState !== undefined)
      value.poolState = parseArtifactState(
        value.poolState,
        'pool',
        value.options as unknown as CompleteLessonCheckpointOptions,
      );
    if (value.poolContext !== undefined)
      value.poolContext = parseCompletePoolContext(value.poolContext);
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
      JSON.stringify({
        version: checkpoint.version,
        identity: checkpoint.identity,
        expiresAtMs: checkpoint.expiresAtMs,
        bodyFingerprint: checkpoint.bodyFingerprint,
        options: {
          practiceEnabled: checkpoint.options.practiceEnabled,
          practiceCount: checkpoint.options.practiceCount,
          level: checkpoint.options.level,
          counts: checkpoint.options.counts,
          modelProfile: checkpoint.options.modelProfile,
          reviewStatus: checkpoint.options.reviewStatus,
        },
        practice: checkpoint.practice,
        bodyPersisted: checkpoint.bodyPersisted,
        mapState: checkpoint.mapState
          ? parseArtifactState(checkpoint.mapState, 'map', checkpoint.options)
          : undefined,
        poolState: checkpoint.poolState
          ? parseArtifactState(checkpoint.poolState, 'pool', checkpoint.options)
          : undefined,
        poolContext: checkpoint.poolContext
          ? parseCompletePoolContext(checkpoint.poolContext)
          : undefined,
        mapCompleted: checkpoint.mapCompleted,
        poolCompleted: checkpoint.poolCompleted,
        mapRequestId: checkpoint.mapRequestId,
        poolRequestId: checkpoint.poolRequestId,
        mapReviewRequestId: checkpoint.mapReviewRequestId,
        poolReviewRequestId: checkpoint.poolReviewRequestId,
        mapCostMicroUsd: checkpoint.mapCostMicroUsd,
        poolCostMicroUsd: checkpoint.poolCostMicroUsd,
        visual: checkpoint.visual,
      }),
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
