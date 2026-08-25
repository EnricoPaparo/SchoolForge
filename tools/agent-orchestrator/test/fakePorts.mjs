/* global queueMicrotask */
// In-memory fake ports for tests: no real filesystem, clock, uuid or
// process execution. Every test wires its own claude "process" behaviour.

import { Buffer } from 'node:buffer';
import { win32 } from 'node:path';

export function windowsClaudeBinaryPath(home) {
  return win32.join(home, '.local', 'bin', 'claude.exe');
}

export function createFakePorts({
  env = {},
  platform = 'win32',
  now = '2026-08-25T00:00:00.000Z',
} = {}) {
  const files = new Map();
  let uuidCounter = 0;
  let clockMs = Date.parse(now);

  const fs = {
    async readFile(path) {
      if (!files.has(path)) {
        const error = new Error(`ENOENT: ${path}`);
        error.code = 'ENOENT';
        throw error;
      }
      return files.get(path);
    },
    async writeFile(path, data) {
      files.set(path, data);
    },
    async rename(from, to) {
      if (!files.has(from)) {
        const error = new Error(`ENOENT: ${from}`);
        error.code = 'ENOENT';
        throw error;
      }
      files.set(to, files.get(from));
      files.delete(from);
    },
    async mkdir() {
      // in-memory: no real directories to create
    },
    async exists(path) {
      return files.has(path);
    },
    async unlink(path) {
      files.delete(path);
    },
  };

  const clock = {
    now: () => clockMs,
    nowIso: () => new Date(clockMs).toISOString(),
  };

  const uuid = {
    randomUUID: () => {
      uuidCounter += 1;
      return `00000000-0000-4000-8000-${String(uuidCounter).padStart(12, '0')}`;
    },
  };

  return {
    ports: {
      fs,
      clock,
      uuid,
      exec: {
        spawn: () => {
          throw new Error('exec.spawn not stubbed for this test');
        },
      },
      env,
      platform,
    },
    files,
    advanceClock(ms) {
      clockMs += ms;
    },
  };
}

/** Fake child_process-like spawn stub driven entirely by the test. */
export function createFakeSpawn(behavior) {
  return function fakeSpawn(command, args, options) {
    const listeners = { error: [], close: [] };
    let stdinData = '';
    const stdout = {
      listeners: [],
      on(event, cb) {
        if (event === 'data') this.listeners.push(cb);
      },
    };
    const stderr = {
      listeners: [],
      on(event, cb) {
        if (event === 'data') this.listeners.push(cb);
      },
    };
    const child = {
      stdout,
      stderr,
      stdin: {
        write(chunk) {
          stdinData += chunk;
        },
        end() {},
      },
      on(event, cb) {
        listeners[event]?.push(cb);
      },
      kill() {
        child.killed = true;
        behavior.onKill?.();
      },
      killed: false,
    };

    queueMicrotask(async () => {
      await behavior.run({
        command,
        args,
        options,
        emitStdout: (chunk) => stdout.listeners.forEach((cb) => cb(Buffer.from(chunk, 'utf8'))),
        emitStderr: (chunk) => stderr.listeners.forEach((cb) => cb(Buffer.from(chunk, 'utf8'))),
        emitError: (err) => listeners.error.forEach((cb) => cb(err)),
        emitClose: (code, signal) => listeners.close.forEach((cb) => cb(code, signal)),
        getStdin: () => stdinData,
        child,
      });
    });

    return child;
  };
}
