import assert from 'node:assert/strict';
import { clearInterval, setInterval } from 'node:timers';
import { test } from 'node:test';

import {
  InvalidInvocationOptionsError,
  buildInvocationArgs,
  runInvocation,
} from '../src/invoke.mjs';
import { readCheckpoint } from '../src/checkpoint.mjs';
import { hashManifest } from '../src/manifest.mjs';
import { createFakePorts, createFakeSpawn, windowsClaudeBinaryPath } from './fakePorts.mjs';

const MANIFEST_TEXT = 'schema: schoolforge-agent-task/v1\ntaskId: TEST-1\n';
const MANIFEST_HASH = hashManifest(MANIFEST_TEXT);

function setupPorts({
  statusJson = { loggedIn: true, authMethod: 'claude.ai', subscriptionType: 'max' },
} = {}) {
  const { ports, files } = createFakePorts({
    env: { USERPROFILE: 'C:/Users/dev' },
    platform: 'win32',
  });
  files.set(windowsClaudeBinaryPath('C:/Users/dev'), 'stub');
  return { ports, files, statusJson };
}

function stubClaudeInvocations(ports, statusJson, invocationBehavior) {
  let call = 0;
  ports.exec.spawn = (command, args) => {
    call += 1;
    const isAuthStatus = args[0] === 'auth' && args[1] === 'status';
    return createFakeSpawn({
      async run({ emitStdout, emitClose, emitStderr, emitError, getStdin, child }) {
        if (isAuthStatus) {
          emitStdout(JSON.stringify(statusJson));
          emitClose(0, null);
          return;
        }
        await invocationBehavior({
          emitStdout,
          emitStderr,
          emitClose,
          emitError,
          getStdin,
          child,
          call,
          args,
        });
      },
    })(command, args);
  };
}

test('buildInvocationArgs: never emits a forbidden flag and rejects bypass permission mode', () => {
  assert.throws(
    () =>
      buildInvocationArgs({
        mode: 'run',
        sessionId: 'sid-1',
        maxTurns: 5,
        permissionMode: 'bypassPermissions',
        allowedTools: ['Edit'],
      }),
    InvalidInvocationOptionsError,
  );
});

test('buildInvocationArgs: rejects a non-finite/non-positive maxTurns', () => {
  assert.throws(
    () =>
      buildInvocationArgs({ mode: 'run', sessionId: 'sid-1', maxTurns: 0, allowedTools: ['Edit'] }),
    InvalidInvocationOptionsError,
  );
  assert.throws(
    () =>
      buildInvocationArgs({
        mode: 'run',
        sessionId: 'sid-1',
        maxTurns: Number.POSITIVE_INFINITY,
        allowedTools: ['Edit'],
      }),
    InvalidInvocationOptionsError,
  );
});

test('buildInvocationArgs: builds a non-interactive JSON, resumable, allowlisted invocation', () => {
  const args = buildInvocationArgs({
    mode: 'run',
    sessionId: 'sid-123',
    maxTurns: 8,
    permissionMode: 'default',
    allowedTools: ['Edit', 'Bash(git *)'],
  });

  assert.ok(args.includes('-p'));
  assert.ok(args.includes('--output-format'));
  assert.ok(args.includes('json'));
  assert.ok(args.includes('--max-turns'));
  assert.ok(args.includes('8'));
  assert.ok(args.includes('--session-id'));
  assert.ok(args.includes('sid-123'));
  assert.ok(!args.includes('--resume'));
  assert.ok(!args.includes('--dangerously-skip-permissions'));
  assert.ok(!args.includes('--bare'));
  assert.ok(!args.includes('--model'));
});

test('buildInvocationArgs: resume mode uses --resume with the given session id', () => {
  const args = buildInvocationArgs({
    mode: 'resume',
    sessionId: 'sid-999',
    maxTurns: 3,
    allowedTools: ['Edit'],
  });
  assert.ok(args.includes('--resume'));
  assert.ok(args.includes('sid-999'));
  assert.ok(!args.includes('--session-id'));
});

test('runInvocation: run writes a pre-invocation checkpoint before spawning and a post-invocation one after', async () => {
  const { ports, statusJson } = setupPorts();
  stubClaudeInvocations(ports, statusJson, async ({ emitStdout, emitClose }) => {
    emitStdout(JSON.stringify({ is_error: false, result: 'done' }));
    emitClose(0, null);
  });

  const result = await runInvocation(ports, {
    mode: 'run',
    repoRoot: 'C:/repo',
    taskId: 'TEST-1',
    manifestHash: MANIFEST_HASH,
    prompt: 'do the thing',
    allowedTools: ['Edit'],
    maxTurns: 4,
  });

  assert.equal(result.kind, 'invoked');
  assert.equal(result.classification.outcome, 'success');
  assert.equal(result.checkpoint.invocationCount, 1);
  assert.ok(result.checkpoint.sessionId);
  assert.equal(result.checkpoint.promptHash.length, 64);

  const stored = await readCheckpoint(ports, 'C:/repo', 'TEST-1');
  assert.deepEqual(stored, result.checkpoint);
});

test('runInvocation: never persists the prompt text, only its hash', async () => {
  const { ports, statusJson } = setupPorts();
  stubClaudeInvocations(ports, statusJson, async ({ emitStdout, emitClose }) => {
    emitStdout(JSON.stringify({ is_error: false, result: 'done' }));
    emitClose(0, null);
  });

  const result = await runInvocation(ports, {
    mode: 'run',
    repoRoot: 'C:/repo',
    taskId: 'TEST-1',
    manifestHash: MANIFEST_HASH,
    prompt: 'a very secret prompt body',
    allowedTools: ['Edit'],
    maxTurns: 4,
  });

  const serializedResult = JSON.stringify(result);
  assert.ok(!serializedResult.includes('a very secret prompt body'));
});

test('runInvocation: resume reuses the session id from the checkpoint', async () => {
  const { ports, statusJson } = setupPorts();
  stubClaudeInvocations(ports, statusJson, async ({ emitStdout, emitClose }) => {
    emitStdout(JSON.stringify({ is_error: false, result: 'done' }));
    emitClose(0, null);
  });

  const first = await runInvocation(ports, {
    mode: 'run',
    repoRoot: 'C:/repo',
    taskId: 'TEST-1',
    manifestHash: MANIFEST_HASH,
    prompt: 'first',
    allowedTools: ['Edit'],
    maxTurns: 4,
  });

  let capturedArgs = null;
  stubClaudeInvocations(ports, statusJson, async ({ emitStdout, emitClose, args }) => {
    capturedArgs = args;
    emitStdout(JSON.stringify({ is_error: false, result: 'done again' }));
    emitClose(0, null);
  });

  const second = await runInvocation(ports, {
    mode: 'resume',
    repoRoot: 'C:/repo',
    taskId: 'TEST-1',
    manifestHash: MANIFEST_HASH,
    prompt: 'second',
    allowedTools: ['Edit'],
    maxTurns: 4,
  });

  assert.equal(second.checkpoint.sessionId, first.checkpoint.sessionId);
  assert.ok(capturedArgs.includes('--resume'));
  assert.equal(second.checkpoint.invocationCount, 2);
});

test('runInvocation: resume without a prior session returns needs_new_session and does not spawn claude', async () => {
  const { ports, statusJson } = setupPorts();
  let spawnedNonAuth = false;
  stubClaudeInvocations(ports, statusJson, async () => {
    spawnedNonAuth = true;
  });

  const result = await runInvocation(ports, {
    mode: 'resume',
    repoRoot: 'C:/repo',
    taskId: 'TEST-1',
    manifestHash: MANIFEST_HASH,
    prompt: 'resume please',
    allowedTools: ['Edit'],
    maxTurns: 4,
  });

  assert.equal(result.kind, 'needs_new_session');
  assert.equal(spawnedNonAuth, false);
});

test('runInvocation: explicit quota moves state to quota_wait and keeps retryAt', async () => {
  const { ports, statusJson } = setupPorts();
  stubClaudeInvocations(ports, statusJson, async ({ emitStdout, emitClose }) => {
    emitStdout(
      JSON.stringify({
        is_error: true,
        result: 'usage limit reached, resets at 2026-08-26T00:00:00.000Z',
      }),
    );
    emitClose(1, null);
  });

  const result = await runInvocation(ports, {
    mode: 'run',
    repoRoot: 'C:/repo',
    taskId: 'TEST-1',
    manifestHash: MANIFEST_HASH,
    prompt: 'do the thing',
    allowedTools: ['Edit'],
    maxTurns: 4,
  });

  assert.equal(result.classification.outcome, 'explicit_quota');
  assert.equal(result.checkpoint.state, 'quota_wait');
  assert.equal(result.checkpoint.retryAt, '2026-08-26T00:00:00.000Z');
});

test('runInvocation: a repeated quota hit while already in quota_wait preserves the original previousState', async () => {
  const { ports, statusJson } = setupPorts();
  const quotaResult = (resetAt) =>
    JSON.stringify({ is_error: true, result: `usage limit reached, resets at ${resetAt}` });

  stubClaudeInvocations(ports, statusJson, async ({ emitStdout, emitClose }) => {
    emitStdout(quotaResult('2026-08-26T00:00:00.000Z'));
    emitClose(1, null);
  });
  const first = await runInvocation(ports, {
    mode: 'run',
    repoRoot: 'C:/repo',
    taskId: 'TEST-1',
    manifestHash: MANIFEST_HASH,
    prompt: 'first',
    allowedTools: ['Edit'],
    maxTurns: 4,
  });
  assert.equal(first.checkpoint.state, 'quota_wait');
  assert.equal(first.checkpoint.previousState, 'implementing');

  stubClaudeInvocations(ports, statusJson, async ({ emitStdout, emitClose }) => {
    emitStdout(quotaResult('2026-08-27T00:00:00.000Z'));
    emitClose(1, null);
  });
  const second = await runInvocation(ports, {
    mode: 'resume',
    repoRoot: 'C:/repo',
    taskId: 'TEST-1',
    manifestHash: MANIFEST_HASH,
    prompt: 'second',
    allowedTools: ['Edit'],
    maxTurns: 4,
  });

  assert.equal(second.checkpoint.state, 'quota_wait');
  // Must still be 'implementing', not overwritten with 'quota_wait' itself.
  assert.equal(second.checkpoint.previousState, 'implementing');
  assert.equal(second.checkpoint.retryAt, '2026-08-27T00:00:00.000Z');
  assert.equal(second.checkpoint.retryCount, 2);
});

test('runInvocation: a success on resume from quota_wait returns exactly to previousState and clears retryAt', async () => {
  const { ports, statusJson } = setupPorts();
  stubClaudeInvocations(ports, statusJson, async ({ emitStdout, emitClose }) => {
    emitStdout(
      JSON.stringify({
        is_error: true,
        result: 'usage limit reached, resets at 2026-08-26T00:00:00.000Z',
      }),
    );
    emitClose(1, null);
  });
  const quotaHit = await runInvocation(ports, {
    mode: 'run',
    repoRoot: 'C:/repo',
    taskId: 'TEST-1',
    manifestHash: MANIFEST_HASH,
    prompt: 'first',
    allowedTools: ['Edit'],
    maxTurns: 4,
  });
  assert.equal(quotaHit.checkpoint.state, 'quota_wait');
  assert.equal(quotaHit.checkpoint.previousState, 'implementing');

  stubClaudeInvocations(ports, statusJson, async ({ emitStdout, emitClose }) => {
    emitStdout(JSON.stringify({ is_error: false, result: 'done after quota cleared' }));
    emitClose(0, null);
  });
  const afterQuota = await runInvocation(ports, {
    mode: 'resume',
    repoRoot: 'C:/repo',
    taskId: 'TEST-1',
    manifestHash: MANIFEST_HASH,
    prompt: 'second',
    allowedTools: ['Edit'],
    maxTurns: 4,
  });

  assert.equal(afterQuota.classification.outcome, 'success');
  assert.equal(afterQuota.checkpoint.state, 'implementing');
  assert.equal(afterQuota.checkpoint.previousState, null);
  assert.equal(afterQuota.checkpoint.retryAt, null);
});

test('runInvocation: invalid invocation options leave the checkpoint and invocationCount untouched', async () => {
  const { ports, statusJson } = setupPorts();
  let spawnedNonAuth = false;
  stubClaudeInvocations(ports, statusJson, async () => {
    spawnedNonAuth = true;
  });

  const before = await readCheckpoint(ports, 'C:/repo', 'TEST-1');
  assert.equal(before, null);

  const result = await runInvocation(ports, {
    mode: 'run',
    repoRoot: 'C:/repo',
    taskId: 'TEST-1',
    manifestHash: MANIFEST_HASH,
    prompt: 'do the thing',
    allowedTools: ['Edit'],
    maxTurns: 0, // invalid: must be a finite positive integer
  });

  assert.equal(result.kind, 'invalid_options');
  assert.equal(spawnedNonAuth, false);
  const after = await readCheckpoint(ports, 'C:/repo', 'TEST-1');
  assert.equal(after, null);
});

test('runInvocation: invalid options on a second call do not bump invocationCount', async () => {
  const { ports, statusJson } = setupPorts();
  stubClaudeInvocations(ports, statusJson, async ({ emitStdout, emitClose }) => {
    emitStdout(JSON.stringify({ is_error: false, result: 'done' }));
    emitClose(0, null);
  });
  const first = await runInvocation(ports, {
    mode: 'run',
    repoRoot: 'C:/repo',
    taskId: 'TEST-1',
    manifestHash: MANIFEST_HASH,
    prompt: 'first',
    allowedTools: ['Edit'],
    maxTurns: 4,
  });
  assert.equal(first.checkpoint.invocationCount, 1);

  const invalid = await runInvocation(ports, {
    mode: 'resume',
    repoRoot: 'C:/repo',
    taskId: 'TEST-1',
    manifestHash: MANIFEST_HASH,
    prompt: 'second',
    allowedTools: ['Edit'],
    maxTurns: 4,
    permissionMode: 'bypassPermissions', // invalid: never allowed
  });
  assert.equal(invalid.kind, 'invalid_options');

  const stillFirst = await readCheckpoint(ports, 'C:/repo', 'TEST-1');
  assert.equal(stillFirst.invocationCount, 1);
});

test('runInvocation: timeout kills only the child and classifies as transient_error', async () => {
  const { ports, statusJson } = setupPorts();
  stubClaudeInvocations(ports, statusJson, async ({ emitClose, child }) => {
    // Never resolves on its own; the timeout must kill it.
    const wasKilled = await new Promise((resolvePromise) => {
      const check = setInterval(() => {
        if (child.killed) {
          clearInterval(check);
          resolvePromise(true);
        }
      }, 5);
    });
    if (wasKilled) {
      emitClose(null, null);
    }
  });

  const result = await runInvocation(ports, {
    mode: 'run',
    repoRoot: 'C:/repo',
    taskId: 'TEST-1',
    manifestHash: MANIFEST_HASH,
    prompt: 'do the thing',
    allowedTools: ['Edit'],
    maxTurns: 4,
    timeoutMs: 30,
  });

  assert.equal(result.classification.outcome, 'transient_error');
  assert.equal(result.classification.reason, 'timeout');
});

test('runInvocation: oversized stdout is capped, never crashes classification or checkpoint writing', async () => {
  const { ports, statusJson } = setupPorts();
  const huge = 'x'.repeat(600_000); // above the 512 KiB cap used for run/resume
  stubClaudeInvocations(ports, statusJson, async ({ emitStdout, emitClose }) => {
    emitStdout(huge);
    emitClose(0, null);
  });

  const result = await runInvocation(ports, {
    mode: 'run',
    repoRoot: 'C:/repo',
    taskId: 'TEST-1',
    manifestHash: MANIFEST_HASH,
    prompt: 'do the thing',
    allowedTools: ['Edit'],
    maxTurns: 4,
  });

  // The capped, non-JSON-parseable buffer must not crash classification;
  // it is treated as an invalid JSON output (fail-closed), and the
  // checkpoint write still succeeds.
  assert.equal(result.kind, 'invoked');
  assert.equal(result.stdoutTruncated, true);
  assert.equal(result.classification.outcome, 'permanent_error');
  assert.equal(result.classification.reason, 'invalid_output_json');
});

test('runInvocation: manifestHash divergence against an existing checkpoint is fail-closed', async () => {
  const { ports, statusJson } = setupPorts();
  stubClaudeInvocations(ports, statusJson, async ({ emitStdout, emitClose }) => {
    emitStdout(JSON.stringify({ is_error: false, result: 'done' }));
    emitClose(0, null);
  });

  await runInvocation(ports, {
    mode: 'run',
    repoRoot: 'C:/repo',
    taskId: 'TEST-1',
    manifestHash: MANIFEST_HASH,
    prompt: 'first',
    allowedTools: ['Edit'],
    maxTurns: 4,
  });

  const otherHash = 'b'.repeat(64);
  const result = await runInvocation(ports, {
    mode: 'resume',
    repoRoot: 'C:/repo',
    taskId: 'TEST-1',
    manifestHash: otherHash,
    prompt: 'second',
    allowedTools: ['Edit'],
    maxTurns: 4,
  });

  assert.equal(result.kind, 'checkpoint_rejected');
});
