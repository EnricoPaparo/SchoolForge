// Closed, versioned checkpoint stored at .git/schoolforge-agent/<taskId>.json.
// Written atomically (temp file + rename). A malformed checkpoint or a
// manifestHash mismatch is fail-closed: it is reported, never auto-repaired.

import { join } from 'node:path';

export const CHECKPOINT_SCHEMA = 'schoolforge-agent-checkpoint/v1';

// States owned end-to-end by the full orchestrator (ORCHESTRATOR-00 roadmap
// §6). This local adapter only ever writes implementing/quota_wait/blocked;
// the full enum is accepted on read so later packages can reuse the file.
export const STATES = Object.freeze([
  'planned',
  'implementing',
  'ci',
  'review',
  'fix_required',
  'quota_wait',
  'blocked',
  'gate_human',
  'merge_dev',
  'complete',
]);

export const OUTCOMES = Object.freeze([
  'success',
  'explicit_quota',
  'transient_error',
  'permanent_error',
  'interrupted',
]);

const REQUIRED_KEYS = Object.freeze([
  'schema',
  'taskId',
  'manifestHash',
  'state',
  'previousState',
  'branch',
  'pr',
  'headSha',
  'sessionId',
  'promptHash',
  'invocationCount',
  'reviewCycle',
  'retryCount',
  'retryAt',
  'lastOutcome',
  'updatedAt',
]);

const HEX64 = /^[0-9a-f]{64}$/;
// Canonical, filesystem-safe task id segment: alphanumeric and hyphens
// only. No '.', '/', '\\' or control characters, so it can never escape
// `.git/schoolforge-agent/` when interpolated into a filename.
const SAFE_TASK_ID = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,62}[A-Za-z0-9])?$/;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GIT_SHA = /^[0-9a-f]{7,40}$/i;

export class CheckpointMalformedError extends Error {
  constructor(reason) {
    super(`checkpoint malformed: ${reason}`);
    this.name = 'CheckpointMalformedError';
    this.reason = reason;
  }
}

export class InvalidTaskIdError extends Error {
  constructor(taskId) {
    super(`unsafe taskId: ${JSON.stringify(taskId)}`);
    this.name = 'InvalidTaskIdError';
    this.taskId = taskId;
  }
}

/** Throws InvalidTaskIdError unless taskId is a safe, canonical segment. */
export function assertSafeTaskId(taskId) {
  if (typeof taskId !== 'string' || !SAFE_TASK_ID.test(taskId)) {
    throw new InvalidTaskIdError(taskId);
  }
  return taskId;
}

export class ManifestHashMismatchError extends Error {
  constructor(expected, actual) {
    super('checkpoint manifestHash diverges from current manifest');
    this.name = 'ManifestHashMismatchError';
    this.expected = expected;
    this.actual = actual;
  }
}

function isNullableNonNegativeInteger(value) {
  return value === null || (Number.isInteger(value) && value >= 0);
}

/** Throws CheckpointMalformedError on any deviation. Never mutates input. */
export function validateCheckpoint(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new CheckpointMalformedError('not an object');
  }

  const keys = Object.keys(value);
  const unknown = keys.filter((key) => !REQUIRED_KEYS.includes(key));
  if (unknown.length > 0) {
    throw new CheckpointMalformedError(`unknown keys: ${unknown.join(', ')}`);
  }
  const missing = REQUIRED_KEYS.filter((key) => !(key in value));
  if (missing.length > 0) {
    throw new CheckpointMalformedError(`missing keys: ${missing.join(', ')}`);
  }

  if (value.schema !== CHECKPOINT_SCHEMA) {
    throw new CheckpointMalformedError(`unexpected schema: ${String(value.schema)}`);
  }
  if (typeof value.taskId !== 'string' || !SAFE_TASK_ID.test(value.taskId)) {
    throw new CheckpointMalformedError('taskId must be a safe, canonical segment');
  }
  if (typeof value.manifestHash !== 'string' || !HEX64.test(value.manifestHash)) {
    throw new CheckpointMalformedError('manifestHash must be a SHA-256 hex digest');
  }
  if (!STATES.includes(value.state)) {
    throw new CheckpointMalformedError(`unknown state: ${String(value.state)}`);
  }
  if (value.previousState !== null && !STATES.includes(value.previousState)) {
    throw new CheckpointMalformedError(`unknown previousState: ${String(value.previousState)}`);
  }
  if (value.branch !== null && (typeof value.branch !== 'string' || value.branch.length === 0)) {
    throw new CheckpointMalformedError('branch must be a non-empty string or null');
  }
  if (value.pr !== null && !(Number.isInteger(value.pr) && value.pr > 0)) {
    throw new CheckpointMalformedError('pr must be a positive integer or null');
  }
  if (
    value.headSha !== null &&
    (typeof value.headSha !== 'string' || !GIT_SHA.test(value.headSha))
  ) {
    throw new CheckpointMalformedError('headSha must be a git SHA hex string or null');
  }
  if (
    value.sessionId !== null &&
    (typeof value.sessionId !== 'string' || !UUID_PATTERN.test(value.sessionId))
  ) {
    throw new CheckpointMalformedError('sessionId must be a UUID or null');
  }
  if (value.promptHash !== null && !HEX64.test(value.promptHash)) {
    throw new CheckpointMalformedError('promptHash must be a SHA-256 hex digest or null');
  }
  if (!Number.isInteger(value.invocationCount) || value.invocationCount < 0) {
    throw new CheckpointMalformedError('invocationCount must be a non-negative integer');
  }
  if (!Number.isInteger(value.reviewCycle) || value.reviewCycle < 0) {
    throw new CheckpointMalformedError('reviewCycle must be a non-negative integer');
  }
  if (!isNullableNonNegativeInteger(value.retryCount)) {
    throw new CheckpointMalformedError('retryCount must be a non-negative integer');
  }
  if (
    value.retryAt !== null &&
    (typeof value.retryAt !== 'string' || !ISO_TIMESTAMP.test(value.retryAt))
  ) {
    throw new CheckpointMalformedError('retryAt must be an ISO 8601 timestamp or null');
  }
  if (value.lastOutcome !== null && !OUTCOMES.includes(value.lastOutcome)) {
    throw new CheckpointMalformedError(`unknown lastOutcome: ${String(value.lastOutcome)}`);
  }
  if (typeof value.updatedAt !== 'string' || !ISO_TIMESTAMP.test(value.updatedAt)) {
    throw new CheckpointMalformedError('updatedAt must be an ISO 8601 timestamp');
  }

  return value;
}

export function checkpointDir(repoRoot) {
  return join(repoRoot, '.git', 'schoolforge-agent');
}

export function checkpointPath(repoRoot, taskId) {
  assertSafeTaskId(taskId);
  return join(checkpointDir(repoRoot), `${taskId}.json`);
}

/**
 * Reads and validates the checkpoint for a task.
 * Returns null when no checkpoint exists yet.
 * Throws CheckpointMalformedError when the file exists but does not match
 * the closed schema; the caller must stop, not repair it.
 */
export async function readCheckpoint(ports, repoRoot, taskId) {
  const path = checkpointPath(repoRoot, taskId);
  const exists = await ports.fs.exists(path);
  if (!exists) {
    return null;
  }
  let raw;
  try {
    raw = await ports.fs.readFile(path);
  } catch (error) {
    throw new CheckpointMalformedError(`unreadable file: ${error.message}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new CheckpointMalformedError('invalid JSON');
  }
  return validateCheckpoint(parsed);
}

/**
 * Reads the checkpoint and asserts its manifestHash matches expectedManifestHash.
 * Throws ManifestHashMismatchError (fail-closed, no repair) on divergence.
 */
export async function readCheckpointOrFailClosed(ports, repoRoot, taskId, expectedManifestHash) {
  const checkpoint = await readCheckpoint(ports, repoRoot, taskId);
  if (checkpoint !== null && checkpoint.manifestHash !== expectedManifestHash) {
    throw new ManifestHashMismatchError(expectedManifestHash, checkpoint.manifestHash);
  }
  return checkpoint;
}

/** Writes the checkpoint atomically: write to a temp file, then rename. */
export async function writeCheckpointAtomic(ports, repoRoot, checkpoint) {
  validateCheckpoint(checkpoint);
  const dir = checkpointDir(repoRoot);
  await ports.fs.mkdir(dir);
  const target = checkpointPath(repoRoot, checkpoint.taskId);
  const tmpPath = `${target}.tmp-${ports.uuid.randomUUID()}`;
  const serialized = `${JSON.stringify(checkpoint, null, 2)}\n`;
  await ports.fs.writeFile(tmpPath, serialized);
  await ports.fs.rename(tmpPath, target);
  return target;
}

export function newCheckpoint({ taskId, manifestHash, state, now }) {
  return validateCheckpoint({
    schema: CHECKPOINT_SCHEMA,
    taskId,
    manifestHash,
    state,
    previousState: null,
    branch: null,
    pr: null,
    headSha: null,
    sessionId: null,
    promptHash: null,
    invocationCount: 0,
    reviewCycle: 0,
    retryCount: 0,
    retryAt: null,
    lastOutcome: null,
    updatedAt: now,
  });
}
