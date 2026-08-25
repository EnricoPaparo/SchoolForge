import assert from 'node:assert/strict';
import { win32 } from 'node:path';
import { test } from 'node:test';

import { ClaudeBinaryNotFoundError, resolveClaudeBinary } from '../src/resolveBinary.mjs';
import { createFakePorts, windowsClaudeBinaryPath } from './fakePorts.mjs';

test('resolveClaudeBinary uses the Windows default path when present', async () => {
  const { ports, files } = createFakePorts({
    env: { USERPROFILE: 'C:/Users/dev' },
    platform: 'win32',
  });
  const defaultPath = windowsClaudeBinaryPath('C:/Users/dev');
  files.set(defaultPath, 'stub');

  const resolved = await resolveClaudeBinary(ports, null);
  assert.equal(resolved, defaultPath);
});

test('resolveClaudeBinary prefers an explicit override', async () => {
  const { ports, files } = createFakePorts({
    env: { USERPROFILE: 'C:/Users/dev' },
    platform: 'win32',
  });
  files.set(windowsClaudeBinaryPath('C:/Users/dev'), 'stub');
  files.set('C:/custom/claude.exe', 'stub');

  const resolved = await resolveClaudeBinary(ports, 'C:/custom/claude.exe');
  assert.equal(resolved, 'C:/custom/claude.exe');
});

test('resolveClaudeBinary falls back to PATH when the default is missing', async () => {
  const { ports, files } = createFakePorts({
    env: { USERPROFILE: 'C:/Users/dev', PATH: 'C:/tools;C:/other/bin' },
    platform: 'win32',
  });
  const pathCandidate = win32.join('C:/other/bin', 'claude.exe');
  files.set(pathCandidate, 'stub');

  const resolved = await resolveClaudeBinary(ports, null);
  assert.equal(resolved, pathCandidate);
});

test('resolveClaudeBinary throws a typed error when nothing is found', async () => {
  const { ports } = createFakePorts({
    env: { USERPROFILE: 'C:/Users/dev', PATH: 'C:/tools' },
    platform: 'win32',
  });

  await assert.rejects(() => resolveClaudeBinary(ports, null), ClaudeBinaryNotFoundError);
});
