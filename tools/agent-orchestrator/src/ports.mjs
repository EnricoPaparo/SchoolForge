// Dependency-injected ports for filesystem, clock, UUID and process execution.
// Production ports wrap Node builtins only; tests inject fakes to avoid any
// network access or real `claude` invocation.

import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { access, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import process from 'node:process';

export function createNodePorts() {
  return {
    fs: {
      async readFile(path) {
        return readFile(path, 'utf8');
      },
      async writeFile(path, data) {
        await writeFile(path, data, 'utf8');
      },
      async rename(from, to) {
        await rename(from, to);
      },
      async mkdir(path) {
        await mkdir(path, { recursive: true });
      },
      async exists(path) {
        try {
          await access(path);
          return true;
        } catch {
          return false;
        }
      },
      async unlink(path) {
        try {
          await unlink(path);
        } catch {
          // best-effort cleanup only
        }
      },
    },
    clock: {
      now() {
        return Date.now();
      },
      nowIso() {
        return new Date().toISOString();
      },
    },
    uuid: {
      randomUUID,
    },
    exec: {
      spawn(command, args, options) {
        return spawn(command, args, options);
      },
    },
    env: process.env,
    platform: process.platform,
  };
}
