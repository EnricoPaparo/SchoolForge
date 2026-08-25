import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  CheckpointMalformedError,
  InvalidTaskIdError,
  ManifestHashMismatchError,
  assertSafeTaskId,
  checkpointPath,
  newCheckpoint,
  readCheckpoint,
  readCheckpointOrFailClosed,
  writeCheckpointAtomic,
} from '../src/checkpoint.mjs';
import { createFakePorts } from './fakePorts.mjs';

const MANIFEST_HASH = 'a'.repeat(64);

test('readCheckpoint returns null when no file exists', async () => {
  const { ports } = createFakePorts();
  const result = await readCheckpoint(ports, 'C:/repo', 'TASK-1');
  assert.equal(result, null);
});

test('writeCheckpointAtomic writes via temp file then rename, leaving no temp file behind', async () => {
  const { ports, files } = createFakePorts();
  const checkpoint = newCheckpoint({
    taskId: 'TASK-1',
    manifestHash: MANIFEST_HASH,
    state: 'implementing',
    now: ports.clock.nowIso(),
  });

  await writeCheckpointAtomic(ports, 'C:/repo', checkpoint);

  const target = checkpointPath('C:/repo', 'TASK-1');
  assert.ok(files.has(target));
  const tempFiles = [...files.keys()].filter((path) => path.includes('.tmp-'));
  assert.deepEqual(tempFiles, []);

  const readBack = await readCheckpoint(ports, 'C:/repo', 'TASK-1');
  assert.deepEqual(readBack, checkpoint);
});

test('writeCheckpointAtomic is idempotent: repeated writes of the same content converge', async () => {
  const { ports, files } = createFakePorts();
  const checkpoint = newCheckpoint({
    taskId: 'TASK-1',
    manifestHash: MANIFEST_HASH,
    state: 'implementing',
    now: ports.clock.nowIso(),
  });

  await writeCheckpointAtomic(ports, 'C:/repo', checkpoint);
  const sizeAfterFirst = files.size;
  await writeCheckpointAtomic(ports, 'C:/repo', checkpoint);
  const sizeAfterSecond = files.size;

  assert.equal(sizeAfterFirst, sizeAfterSecond);
  const readBack = await readCheckpoint(ports, 'C:/repo', 'TASK-1');
  assert.deepEqual(readBack, checkpoint);
});

test('readCheckpoint fails closed on invalid JSON and does not repair it', async () => {
  const { ports, files } = createFakePorts();
  files.set(checkpointPath('C:/repo', 'TASK-1'), 'not json');

  await assert.rejects(() => readCheckpoint(ports, 'C:/repo', 'TASK-1'), CheckpointMalformedError);
  assert.equal(files.get(checkpointPath('C:/repo', 'TASK-1')), 'not json');
});

test('readCheckpoint fails closed on unknown keys', async () => {
  const { ports, files } = createFakePorts();
  const checkpoint = newCheckpoint({
    taskId: 'TASK-1',
    manifestHash: MANIFEST_HASH,
    state: 'implementing',
    now: ports.clock.nowIso(),
  });
  files.set(
    checkpointPath('C:/repo', 'TASK-1'),
    JSON.stringify({ ...checkpoint, extraField: 'nope' }),
  );

  await assert.rejects(() => readCheckpoint(ports, 'C:/repo', 'TASK-1'), CheckpointMalformedError);
});

test('readCheckpoint fails closed on missing keys', async () => {
  const { ports, files } = createFakePorts();
  const checkpoint = newCheckpoint({
    taskId: 'TASK-1',
    manifestHash: MANIFEST_HASH,
    state: 'implementing',
    now: ports.clock.nowIso(),
  });
  const { retryAt, ...withoutRetryAt } = checkpoint;
  void retryAt;
  files.set(checkpointPath('C:/repo', 'TASK-1'), JSON.stringify(withoutRetryAt));

  await assert.rejects(() => readCheckpoint(ports, 'C:/repo', 'TASK-1'), CheckpointMalformedError);
});

test('readCheckpointOrFailClosed rejects on manifestHash divergence without repairing', async () => {
  const { ports } = createFakePorts();
  const checkpoint = newCheckpoint({
    taskId: 'TASK-1',
    manifestHash: MANIFEST_HASH,
    state: 'implementing',
    now: ports.clock.nowIso(),
  });
  await writeCheckpointAtomic(ports, 'C:/repo', checkpoint);

  const otherHash = 'b'.repeat(64);
  await assert.rejects(
    () => readCheckpointOrFailClosed(ports, 'C:/repo', 'TASK-1', otherHash),
    ManifestHashMismatchError,
  );

  const stillOriginal = await readCheckpoint(ports, 'C:/repo', 'TASK-1');
  assert.equal(stillOriginal.manifestHash, MANIFEST_HASH);
});

test('readCheckpointOrFailClosed passes through when hash matches', async () => {
  const { ports } = createFakePorts();
  const checkpoint = newCheckpoint({
    taskId: 'TASK-1',
    manifestHash: MANIFEST_HASH,
    state: 'implementing',
    now: ports.clock.nowIso(),
  });
  await writeCheckpointAtomic(ports, 'C:/repo', checkpoint);

  const result = await readCheckpointOrFailClosed(ports, 'C:/repo', 'TASK-1', MANIFEST_HASH);
  assert.deepEqual(result, checkpoint);
});

test('assertSafeTaskId accepts canonical alphanumeric-hyphen segments', () => {
  assert.equal(assertSafeTaskId('ORCHESTRATOR-01'), 'ORCHESTRATOR-01');
  assert.equal(assertSafeTaskId('MULTI-VISUAL-00'), 'MULTI-VISUAL-00');
  assert.equal(assertSafeTaskId('a'), 'a');
});

test('assertSafeTaskId rejects path traversal and unsafe segments', () => {
  const unsafe = [
    '../escape',
    '..',
    '.',
    'a/b',
    'a\\b',
    'a.b',
    '',
    ' TASK-1',
    'TASK-1 ',
    'TASK\u0000-1',
    'TASK\n1',
    '-TASK',
    'TASK-',
  ];
  for (const taskId of unsafe) {
    assert.throws(() => assertSafeTaskId(taskId), InvalidTaskIdError, `expected reject: ${taskId}`);
  }
});

test('checkpointPath rejects an unsafe taskId before touching the filesystem', () => {
  assert.throws(() => checkpointPath('C:/repo', '../../etc/passwd'), InvalidTaskIdError);
});

test('readCheckpoint rejects an unsafe taskId without reading any file', async () => {
  const { ports } = createFakePorts();
  await assert.rejects(() => readCheckpoint(ports, 'C:/repo', '../escape'), InvalidTaskIdError);
});

test('validateCheckpoint (via newCheckpoint) rejects an unsafe taskId', () => {
  assert.throws(
    () =>
      newCheckpoint({
        taskId: '../escape',
        manifestHash: MANIFEST_HASH,
        state: 'implementing',
        now: '2026-08-25T00:00:00.000Z',
      }),
    CheckpointMalformedError,
  );
});

test('readCheckpoint fails closed on a malformed sessionId (not a UUID)', async () => {
  const { ports, files } = createFakePorts();
  const checkpoint = newCheckpoint({
    taskId: 'TASK-1',
    manifestHash: MANIFEST_HASH,
    state: 'implementing',
    now: '2026-08-25T00:00:00.000Z',
  });
  files.set(
    checkpointPath('C:/repo', 'TASK-1'),
    JSON.stringify({ ...checkpoint, sessionId: 'not-a-uuid' }),
  );
  await assert.rejects(() => readCheckpoint(ports, 'C:/repo', 'TASK-1'), CheckpointMalformedError);
});

test('readCheckpoint fails closed on a non-positive pr', async () => {
  const { ports, files } = createFakePorts();
  const checkpoint = newCheckpoint({
    taskId: 'TASK-1',
    manifestHash: MANIFEST_HASH,
    state: 'implementing',
    now: '2026-08-25T00:00:00.000Z',
  });
  files.set(checkpointPath('C:/repo', 'TASK-1'), JSON.stringify({ ...checkpoint, pr: 0 }));
  await assert.rejects(() => readCheckpoint(ports, 'C:/repo', 'TASK-1'), CheckpointMalformedError);
});

test('readCheckpoint fails closed on a headSha that is not a git SHA', async () => {
  const { ports, files } = createFakePorts();
  const checkpoint = newCheckpoint({
    taskId: 'TASK-1',
    manifestHash: MANIFEST_HASH,
    state: 'implementing',
    now: '2026-08-25T00:00:00.000Z',
  });
  files.set(
    checkpointPath('C:/repo', 'TASK-1'),
    JSON.stringify({ ...checkpoint, headSha: 'not-a-sha!' }),
  );
  await assert.rejects(() => readCheckpoint(ports, 'C:/repo', 'TASK-1'), CheckpointMalformedError);
});

test('readCheckpoint fails closed on a non-ISO updatedAt/retryAt', async () => {
  const { ports, files } = createFakePorts();
  const checkpoint = newCheckpoint({
    taskId: 'TASK-1',
    manifestHash: MANIFEST_HASH,
    state: 'implementing',
    now: '2026-08-25T00:00:00.000Z',
  });
  files.set(
    checkpointPath('C:/repo', 'TASK-1'),
    JSON.stringify({ ...checkpoint, updatedAt: '25/08/2026' }),
  );
  await assert.rejects(() => readCheckpoint(ports, 'C:/repo', 'TASK-1'), CheckpointMalformedError);

  files.set(
    checkpointPath('C:/repo', 'TASK-1'),
    JSON.stringify({ ...checkpoint, retryAt: 'tomorrow' }),
  );
  await assert.rejects(() => readCheckpoint(ports, 'C:/repo', 'TASK-1'), CheckpointMalformedError);
});

test('readCheckpoint accepts legitimate, fully populated states without breaking', async () => {
  const { ports, files } = createFakePorts();
  const checkpoint = {
    ...newCheckpoint({
      taskId: 'TASK-1',
      manifestHash: MANIFEST_HASH,
      state: 'quota_wait',
      now: '2026-08-25T00:00:00.000Z',
    }),
    previousState: 'implementing',
    branch: 'agent-orchestrator-01',
    pr: 420,
    headSha: 'a'.repeat(40),
    sessionId: '00000000-0000-4000-8000-000000000001',
    promptHash: 'b'.repeat(64),
    invocationCount: 3,
    retryCount: 2,
    retryAt: '2026-08-26T00:00:00.000Z',
    lastOutcome: 'explicit_quota',
  };
  files.set(checkpointPath('C:/repo', 'TASK-1'), JSON.stringify(checkpoint));

  const result = await readCheckpoint(ports, 'C:/repo', 'TASK-1');
  assert.deepEqual(result, checkpoint);
});
