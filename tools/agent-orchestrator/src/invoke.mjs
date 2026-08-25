// Builds the non-interactive `claude -p` invocation and runs the full
// run/resume flow: preflight -> checkpoint (before) -> spawn -> classify ->
// checkpoint (after). Never includes --dangerously-skip-permissions, --bare
// or a model/API fallback flag, and never puts the prompt on argv or in the
// checkpoint — only its SHA-256 (contract points 4, 5, 9).

import {
  CheckpointMalformedError,
  InvalidTaskIdError,
  ManifestHashMismatchError,
  readCheckpointOrFailClosed,
  writeCheckpointAtomic,
} from './checkpoint.mjs';
import { hashPrompt } from './manifest.mjs';
import { classifyOutcome } from './classify.mjs';
import { runProcess } from './processRunner.mjs';
import { runPreflight } from './preflight.mjs';

const FORBIDDEN_FLAGS = Object.freeze([
  '--dangerously-skip-permissions',
  '--bare',
  '--model',
  '--api-key',
]);
const ALLOWED_PERMISSION_MODES = Object.freeze(['default', 'acceptEdits', 'plan']);

export class InvalidInvocationOptionsError extends Error {
  constructor(reason) {
    super(reason);
    this.name = 'InvalidInvocationOptionsError';
  }
}

export class SessionRequiresNewOneError extends Error {
  constructor(reason) {
    super(reason);
    this.name = 'SessionRequiresNewOneError';
    this.reason = reason;
  }
}

function assertNoForbiddenFlags(allowedTools) {
  for (const tool of allowedTools) {
    if (FORBIDDEN_FLAGS.includes(tool)) {
      throw new InvalidInvocationOptionsError(`forbidden flag disguised as tool: ${tool}`);
    }
  }
}

/**
 * Builds the argv for a non-interactive, JSON-output, resumable invocation.
 * Never returns a forbidden flag regardless of caller input.
 */
export function buildInvocationArgs({
  mode,
  sessionId,
  maxTurns,
  permissionMode = 'default',
  allowedTools,
}) {
  if (mode !== 'run' && mode !== 'resume') {
    throw new InvalidInvocationOptionsError(`unknown mode: ${mode}`);
  }
  if (!Number.isInteger(maxTurns) || maxTurns <= 0 || !Number.isFinite(maxTurns)) {
    throw new InvalidInvocationOptionsError('maxTurns must be a finite positive integer');
  }
  if (!ALLOWED_PERMISSION_MODES.includes(permissionMode)) {
    throw new InvalidInvocationOptionsError(`permission mode not allowed: ${permissionMode}`);
  }
  if (!Array.isArray(allowedTools) || allowedTools.length === 0) {
    throw new InvalidInvocationOptionsError('allowedTools must be a non-empty array');
  }
  assertNoForbiddenFlags(allowedTools);
  if (typeof sessionId !== 'string' || sessionId.length === 0) {
    throw new InvalidInvocationOptionsError('sessionId is required');
  }

  const args = ['-p', '--output-format', 'json', '--max-turns', String(maxTurns)];
  args.push('--permission-mode', permissionMode);
  args.push('--allowedTools', allowedTools.join(','));
  args.push(mode === 'resume' ? '--resume' : '--session-id', sessionId);

  for (const flag of FORBIDDEN_FLAGS) {
    if (args.includes(flag)) {
      // Defensive: this branch is unreachable by construction above, kept
      // as a hard fail-closed guard against future accidental additions.
      throw new InvalidInvocationOptionsError(`forbidden flag present: ${flag}`);
    }
  }

  return args;
}

function nextCheckpointAfterOutcome(checkpoint, classification, now) {
  const base = { ...checkpoint, updatedAt: now, lastOutcome: classification.outcome };

  if (classification.outcome === 'explicit_quota') {
    // A repeated quota hit while already in quota_wait must not overwrite
    // previousState with 'quota_wait' itself, or the original state to
    // return to once the quota clears would be lost.
    const previousState =
      checkpoint.state === 'quota_wait' ? checkpoint.previousState : checkpoint.state;
    return {
      ...base,
      previousState,
      state: 'quota_wait',
      retryCount: checkpoint.retryCount + 1,
      retryAt: classification.retryAt,
    };
  }
  if (classification.outcome === 'permanent_error') {
    return {
      ...base,
      previousState: checkpoint.state,
      state: 'blocked',
    };
  }
  if (classification.outcome === 'transient_error') {
    return { ...base, retryCount: checkpoint.retryCount + 1 };
  }
  if (classification.outcome === 'success' && checkpoint.state === 'quota_wait') {
    return {
      ...base,
      state: checkpoint.previousState ?? 'implementing',
      previousState: null,
      retryAt: null,
    };
  }
  // success (outside quota_wait) and interrupted keep the current state:
  // the controller decides the next step, or a resume is expected later.
  return base;
}

/**
 * @param {object} ports
 * @param {object} options
 * @param {'run'|'resume'} options.mode
 * @param {string} options.repoRoot
 * @param {string} options.taskId
 * @param {string} options.manifestHash
 * @param {string} options.prompt - never persisted verbatim
 * @param {string[]} options.allowedTools
 * @param {number} options.maxTurns
 * @param {string} [options.permissionMode]
 * @param {number} [options.timeoutMs]
 * @param {string|null} [options.claudeBinOverride]
 * @param {AbortSignal|null} [options.interruptSignal]
 * @param {{branch?: string|null, pr?: number|null, headSha?: string|null}} [options.passthrough]
 */
export async function runInvocation(ports, options) {
  const {
    mode,
    repoRoot,
    taskId,
    manifestHash,
    prompt,
    allowedTools,
    maxTurns,
    permissionMode = 'default',
    timeoutMs = 10 * 60 * 1000,
    claudeBinOverride = null,
    interruptSignal = null,
    passthrough = {},
  } = options;

  let checkpoint;
  try {
    checkpoint = await readCheckpointOrFailClosed(ports, repoRoot, taskId, manifestHash);
  } catch (error) {
    if (error instanceof InvalidTaskIdError) {
      return { kind: 'invalid_task_id', error };
    }
    if (error instanceof CheckpointMalformedError || error instanceof ManifestHashMismatchError) {
      return { kind: 'checkpoint_rejected', error };
    }
    throw error;
  }

  if (mode === 'resume') {
    if (checkpoint === null || !checkpoint.sessionId) {
      return {
        kind: 'needs_new_session',
        error: new SessionRequiresNewOneError('no resumable session in checkpoint'),
      };
    }
  }
  if (mode === 'run' && checkpoint !== null && checkpoint.sessionId) {
    return {
      kind: 'active_session_exists',
      error: new SessionRequiresNewOneError('checkpoint already has an active session; use resume'),
    };
  }

  const preflight = await runPreflight(ports, { claudeBinOverride });
  if (!preflight.ok) {
    return { kind: 'preflight_failed', preflight };
  }

  const sessionId = mode === 'resume' ? checkpoint.sessionId : ports.uuid.randomUUID();

  // Validated before anything touches the checkpoint: invalid invocation
  // options must leave the world (including invocationCount) untouched.
  let args;
  try {
    args = buildInvocationArgs({ mode, sessionId, maxTurns, permissionMode, allowedTools });
  } catch (error) {
    return { kind: 'invalid_options', error };
  }

  const promptHash = hashPrompt(prompt);
  const now = ports.clock.nowIso();

  const base = checkpoint ?? {
    schema: 'schoolforge-agent-checkpoint/v1',
    taskId,
    manifestHash,
    state: 'implementing',
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
  };

  const preInvocation = {
    ...base,
    sessionId,
    promptHash,
    invocationCount: base.invocationCount + 1,
    updatedAt: now,
    branch: passthrough.branch ?? base.branch,
    pr: passthrough.pr ?? base.pr,
    headSha: passthrough.headSha ?? base.headSha,
  };
  await writeCheckpointAtomic(ports, repoRoot, preInvocation);

  const result = await runProcess(ports, {
    command: preflight.claudeBin,
    args,
    input: prompt,
    timeoutMs,
    maxBufferBytes: 512 * 1024,
    interruptSignal,
  });

  const classification = classifyOutcome(result);
  const postInvocation = nextCheckpointAfterOutcome(
    preInvocation,
    classification,
    ports.clock.nowIso(),
  );
  await writeCheckpointAtomic(ports, repoRoot, postInvocation);

  return {
    kind: 'invoked',
    classification,
    checkpoint: postInvocation,
    stderrExcerpt: result.stderr.slice(0, 2000),
    stdoutTruncated: result.stdoutTruncated,
    stderrTruncated: result.stderrTruncated,
  };
}
