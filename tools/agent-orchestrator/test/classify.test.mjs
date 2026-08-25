import assert from 'node:assert/strict';
import { test } from 'node:test';

import { classifyOutcome } from '../src/classify.mjs';

function base(overrides = {}) {
  return {
    exitCode: 0,
    signal: null,
    timedOut: false,
    interrupted: false,
    spawnError: null,
    stdout: '',
    stderr: '',
    ...overrides,
  };
}

test('classifyOutcome: success on exit 0 with valid, non-error JSON', () => {
  const result = classifyOutcome(
    base({ stdout: JSON.stringify({ is_error: false, result: 'ok' }) }),
  );
  assert.equal(result.outcome, 'success');
});

test('classifyOutcome: explicit_quota only on an explicit usage-limit signal', () => {
  const result = classifyOutcome(
    base({
      exitCode: 1,
      stdout: JSON.stringify({ is_error: true, result: 'Claude AI usage limit reached.' }),
    }),
  );
  assert.equal(result.outcome, 'explicit_quota');
});

test('classifyOutcome: explicit_quota preserves retryAt when the provider states a reset time', () => {
  const result = classifyOutcome(
    base({
      exitCode: 1,
      stdout: JSON.stringify({
        is_error: true,
        result: 'usage limit reached, resets at 2026-08-25T18:00:00.000Z',
      }),
    }),
  );
  assert.equal(result.outcome, 'explicit_quota');
  assert.equal(result.retryAt, '2026-08-25T18:00:00.000Z');
});

test('classifyOutcome: timeout is transient_error, never quota', () => {
  const result = classifyOutcome(base({ timedOut: true, exitCode: null }));
  assert.equal(result.outcome, 'transient_error');
  assert.equal(result.reason, 'timeout');
});

test('classifyOutcome: network-absence style stderr without explicit quota wording is transient_error', () => {
  const result = classifyOutcome(
    base({
      exitCode: 1,
      stdout: JSON.stringify({ is_error: true, result: 'network unreachable' }),
    }),
  );
  assert.equal(result.outcome, 'permanent_error');
});

test('classifyOutcome: a crash (unexpected signal) is transient_error, never quota', () => {
  const result = classifyOutcome(base({ signal: 'SIGSEGV', exitCode: null }));
  assert.equal(result.outcome, 'transient_error');
  assert.equal(result.reason, 'crash');
});

test('classifyOutcome: spawn error is transient_error', () => {
  const result = classifyOutcome(base({ spawnError: new Error('ENOENT') }));
  assert.equal(result.outcome, 'transient_error');
  assert.equal(result.reason, 'spawn_error');
});

test('classifyOutcome: invalid JSON output is permanent_error, fail-closed', () => {
  const result = classifyOutcome(base({ exitCode: 0, stdout: 'not json at all' }));
  assert.equal(result.outcome, 'permanent_error');
  assert.equal(result.reason, 'invalid_output_json');
});

test('classifyOutcome: our own interrupt kill is interrupted, not transient_error', () => {
  const result = classifyOutcome(base({ interrupted: true, exitCode: null, signal: 'SIGTERM' }));
  assert.equal(result.outcome, 'interrupted');
});

test('classifyOutcome: a clean application-level error is permanent_error', () => {
  const result = classifyOutcome(
    base({
      exitCode: 1,
      stdout: JSON.stringify({ is_error: true, result: 'invalid tool arguments' }),
    }),
  );
  assert.equal(result.outcome, 'permanent_error');
  assert.equal(result.reason, 'claude_reported_error');
});

test('classifyOutcome: subtype error_max_turns is interrupted (resumable), not permanent_error', () => {
  const result = classifyOutcome(
    base({
      exitCode: 1,
      stdout: JSON.stringify({ is_error: true, subtype: 'error_max_turns', result: 'stopped' }),
    }),
  );
  assert.equal(result.outcome, 'interrupted');
  assert.equal(result.reason, 'max_turns_reached');
});

test('classifyOutcome: terminal_reason max_turns is interrupted (resumable)', () => {
  const result = classifyOutcome(
    base({
      exitCode: 1,
      stdout: JSON.stringify({ is_error: true, terminal_reason: 'max_turns' }),
    }),
  );
  assert.equal(result.outcome, 'interrupted');
  assert.equal(result.reason, 'max_turns_reached');
});

test('classifyOutcome: an errors[] entry naming the turn limit is interrupted (resumable)', () => {
  const result = classifyOutcome(
    base({
      exitCode: 1,
      stdout: JSON.stringify({
        is_error: true,
        errors: ['Reached maximum number of turns (8)'],
      }),
    }),
  );
  assert.equal(result.outcome, 'interrupted');
  assert.equal(result.reason, 'max_turns_reached');
});

test('classifyOutcome: max-turns is never confused with our own kill-based interrupted', () => {
  const result = classifyOutcome(
    base({
      exitCode: 1,
      stdout: JSON.stringify({ is_error: true, subtype: 'error_max_turns' }),
      interrupted: false,
    }),
  );
  assert.equal(result.outcome, 'interrupted');
  assert.equal(result.isError, true);
});
