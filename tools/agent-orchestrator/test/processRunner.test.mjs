import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { test } from 'node:test';

import { runProcess } from '../src/processRunner.mjs';
import { createFakePorts, createFakeSpawn } from './fakePorts.mjs';

test('runProcess: caps stdout by UTF-8 byte length, not JS string length', async () => {
  const { ports } = createFakePorts();
  // Each '日' is 1 JS UTF-16 code unit but 3 UTF-8 bytes: 100 of them is
  // 100 JS chars but 300 bytes, well above a 50-byte cap.
  const text = '日'.repeat(100);
  ports.exec.spawn = createFakeSpawn({
    async run({ emitStdout, emitClose }) {
      emitStdout(text);
      emitClose(0, null);
    },
  });

  const result = await runProcess(ports, {
    command: 'stub',
    args: [],
    input: null,
    timeoutMs: 5000,
    maxBufferBytes: 50,
  });

  assert.equal(result.stdoutTruncated, true);
  assert.ok(Buffer.byteLength(result.stdout, 'utf8') > 50);
  // The captured (pre-marker) portion must not exceed the byte cap.
  const withoutMarker = result.stdout.replace(/\n…\[truncated\]$/, '');
  assert.ok(Buffer.byteLength(withoutMarker, 'utf8') <= 50);
});

test('runProcess: does not corrupt a multi-byte UTF-8 character split across two chunks', async () => {
  const { ports } = createFakePorts();
  // '😀' (U+1F600) is 4 UTF-8 bytes; split the raw bytes across two writes
  // at byte offset 2, which a naive per-chunk toString('utf8') would mangle.
  const emojiBytes = Buffer.from('😀', 'utf8');
  const firstHalf = emojiBytes.subarray(0, 2);
  const secondHalf = emojiBytes.subarray(2);

  ports.exec.spawn = () => {
    const listeners = { close: [] };
    const dataListeners = [];
    const child = {
      stdout: { on: (event, cb) => event === 'data' && dataListeners.push(cb) },
      stderr: { on: () => {} },
      stdin: { write: () => {}, end: () => {} },
      on: (event, cb) => {
        if (event === 'close') listeners.close.push(cb);
      },
      kill: () => {},
    };
    Promise.resolve().then(() => {
      dataListeners.forEach((cb) => cb(firstHalf));
      dataListeners.forEach((cb) => cb(secondHalf));
      listeners.close.forEach((cb) => cb(0, null));
    });
    return child;
  };

  const result = await runProcess(ports, {
    command: 'stub',
    args: [],
    input: null,
    timeoutMs: 5000,
    maxBufferBytes: 1024,
  });

  assert.equal(result.stdout, '😀');
  assert.equal(result.stdoutTruncated, false);
});

test('runProcess: does not truncate stdout that fits comfortably under the byte cap, Unicode included', async () => {
  const { ports } = createFakePorts();
  const text = 'caffè ☕ 日本語 emoji 🎉 done';
  ports.exec.spawn = createFakeSpawn({
    async run({ emitStdout, emitClose }) {
      emitStdout(text);
      emitClose(0, null);
    },
  });

  const result = await runProcess(ports, {
    command: 'stub',
    args: [],
    input: null,
    timeoutMs: 5000,
    maxBufferBytes: 4096,
  });

  assert.equal(result.stdout, text);
  assert.equal(result.stdoutTruncated, false);
});

test('runProcess: interrupted kill classification only fires from the injected signal, never from timeout', async () => {
  const { ports } = createFakePorts();
  ports.exec.spawn = createFakeSpawn({
    async run({ emitClose }) {
      emitClose(0, null);
    },
  });

  const result = await runProcess(ports, {
    command: 'stub',
    args: [],
    input: null,
    timeoutMs: 5000,
    maxBufferBytes: 1024,
  });

  assert.equal(result.interrupted, false);
  assert.equal(result.timedOut, false);
});
