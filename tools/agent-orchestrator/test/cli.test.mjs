import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { test } from 'node:test';

import { runCli } from '../src/cli.mjs';
import { EXIT_CODES } from '../src/exitCodes.mjs';
import { checkpointPath, newCheckpoint } from '../src/checkpoint.mjs';
import { createFakePorts, createFakeSpawn, windowsClaudeBinaryPath } from './fakePorts.mjs';

test('status: not found returns exit code 9 without touching exec', async () => {
  const { ports } = createFakePorts({ env: { USERPROFILE: 'C:/Users/dev' }, platform: 'win32' });
  ports.exec.spawn = () => {
    throw new Error('status must never invoke claude');
  };

  const { output, exitCode } = await runCli(
    ['status', '--repo-root', 'C:/repo', '--task-id', 'TEST-1'],
    ports,
  );

  assert.equal(exitCode, EXIT_CODES.CHECKPOINT_NOT_FOUND);
  assert.equal(output.found, false);
});

test('status: found returns the checkpoint verbatim and exit code 0, never spawning claude', async () => {
  const { ports, files } = createFakePorts({
    env: { USERPROFILE: 'C:/Users/dev' },
    platform: 'win32',
  });
  ports.exec.spawn = () => {
    throw new Error('status must never invoke claude');
  };
  const checkpoint = newCheckpoint({
    taskId: 'TEST-1',
    manifestHash: 'a'.repeat(64),
    state: 'implementing',
    now: ports.clock.nowIso(),
  });
  files.set(checkpointPath('C:/repo', 'TEST-1'), `${JSON.stringify(checkpoint, null, 2)}\n`);

  const { output, exitCode } = await runCli(
    ['status', '--repo-root', 'C:/repo', '--task-id', 'TEST-1'],
    ports,
  );

  assert.equal(exitCode, EXIT_CODES.SUCCESS);
  assert.deepEqual(output.checkpoint, checkpoint);
});

test('status: malformed checkpoint fails closed with exit code 8', async () => {
  const { ports, files } = createFakePorts({
    env: { USERPROFILE: 'C:/Users/dev' },
    platform: 'win32',
  });
  files.set(checkpointPath('C:/repo', 'TEST-1'), '{not valid json');

  const { output, exitCode } = await runCli(
    ['status', '--repo-root', 'C:/repo', '--task-id', 'TEST-1'],
    ports,
  );

  assert.equal(exitCode, EXIT_CODES.CHECKPOINT_INVALID);
  assert.equal(output.checkpoint, null);
});

test('status: is idempotent across repeated calls (pure read, no side effects)', async () => {
  const { ports, files } = createFakePorts({
    env: { USERPROFILE: 'C:/Users/dev' },
    platform: 'win32',
  });
  const checkpoint = newCheckpoint({
    taskId: 'TEST-1',
    manifestHash: 'a'.repeat(64),
    state: 'implementing',
    now: ports.clock.nowIso(),
  });
  files.set(checkpointPath('C:/repo', 'TEST-1'), `${JSON.stringify(checkpoint, null, 2)}\n`);

  const first = await runCli(['status', '--repo-root', 'C:/repo', '--task-id', 'TEST-1'], ports);
  const second = await runCli(['status', '--repo-root', 'C:/repo', '--task-id', 'TEST-1'], ports);

  assert.deepEqual(first, second);
});

test('unknown command returns a usage error, exit code 1', async () => {
  const { ports } = createFakePorts();
  const { exitCode, output } = await runCli(['not-a-command'], ports);
  assert.equal(exitCode, EXIT_CODES.USAGE_ERROR);
  assert.ok(output.error.includes('unknown command'));
});

test('run: missing required flag returns a usage error, exit code 1', async () => {
  const { ports } = createFakePorts();
  const { exitCode, output } = await runCli(['run', '--repo-root', 'C:/repo'], ports);
  assert.equal(exitCode, EXIT_CODES.USAGE_ERROR);
  assert.ok(output.error.includes('task-id'));
});

test('preflight: propagates ok=true/false into the exit code', async () => {
  const { ports, files } = createFakePorts({
    env: { USERPROFILE: 'C:/Users/dev' },
    platform: 'win32',
  });
  files.set(windowsClaudeBinaryPath('C:/Users/dev'), 'stub');
  ports.exec.spawn = createFakeSpawn({
    async run({ emitStdout, emitClose }) {
      emitStdout(
        JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', subscriptionType: 'pro' }),
      );
      emitClose(0, null);
    },
  });

  const { output, exitCode } = await runCli(['preflight'], ports);
  assert.equal(exitCode, EXIT_CODES.SUCCESS);
  assert.equal(output.ok, true);
});

test('run: end-to-end via CLI produces a success envelope with exit code 0', async () => {
  const { ports, files } = createFakePorts({
    env: { USERPROFILE: 'C:/Users/dev' },
    platform: 'win32',
  });
  files.set(windowsClaudeBinaryPath('C:/Users/dev'), 'stub');
  files.set(resolve('C:/manifest.yaml'), 'schema: schoolforge-agent-task/v1\ntaskId: TEST-1\n');
  files.set(resolve('C:/prompt.txt'), 'implement the thing');

  ports.exec.spawn = (command, args) =>
    createFakeSpawn({
      async run({ emitStdout, emitClose }) {
        if (args[0] === 'auth') {
          emitStdout(
            JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', subscriptionType: 'pro' }),
          );
        } else {
          emitStdout(JSON.stringify({ is_error: false, result: 'done' }));
        }
        emitClose(0, null);
      },
    })(command, args);

  const { output, exitCode } = await runCli(
    [
      'run',
      '--repo-root',
      'C:/repo',
      '--task-id',
      'TEST-1',
      '--manifest-file',
      'C:/manifest.yaml',
      '--prompt-file',
      'C:/prompt.txt',
      '--allowed-tools',
      'Edit,Bash(git *)',
      '--max-turns',
      '6',
    ],
    ports,
  );

  assert.equal(exitCode, EXIT_CODES.SUCCESS);
  assert.equal(output.outcome, 'success');
  assert.equal(output.checkpoint.invocationCount, 1);
});
