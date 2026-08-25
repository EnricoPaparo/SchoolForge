// Resolves the local `claude` binary path. Configurable override first,
// then the documented Windows default, then a PATH search. Never downloads,
// installs or falls back to a remote/API client.

import { posix, win32 } from 'node:path';

// Path handling is keyed off the injected `ports.platform`, not the host OS
// running this process, so the same code and its tests behave identically
// on the Windows workstation this adapter targets and on Linux CI.
function pathImplFor(platform) {
  return platform === 'win32' ? win32 : posix;
}

export class ClaudeBinaryNotFoundError extends Error {
  constructor(candidates) {
    super('claude binary not found');
    this.name = 'ClaudeBinaryNotFoundError';
    this.candidates = candidates;
  }
}

function windowsDefaultCandidate(env) {
  const home = env.USERPROFILE;
  if (!home) return null;
  return win32.join(home, '.local', 'bin', 'claude.exe');
}

function posixDefaultCandidate(env) {
  const home = env.HOME;
  if (!home) return null;
  return posix.join(home, '.local', 'bin', 'claude');
}

function pathCandidates(env, platform) {
  const pathVar = env.PATH ?? env.Path ?? '';
  const delimiter = platform === 'win32' ? ';' : ':';
  const binaryName = platform === 'win32' ? 'claude.exe' : 'claude';
  const { join } = pathImplFor(platform);
  return pathVar
    .split(delimiter)
    .filter((entry) => entry.length > 0)
    .map((entry) => join(entry, binaryName));
}

/**
 * @param {object} ports - injected fs/env/platform ports
 * @param {string|null} override - explicit CLI/env override path, if any
 */
export async function resolveClaudeBinary(ports, override) {
  const candidates = [];

  if (override) {
    candidates.push(override);
  }

  const defaultCandidate =
    ports.platform === 'win32'
      ? windowsDefaultCandidate(ports.env)
      : posixDefaultCandidate(ports.env);
  if (defaultCandidate) {
    candidates.push(defaultCandidate);
  }

  candidates.push(...pathCandidates(ports.env, ports.platform));

  for (const candidate of candidates) {
    if (await ports.fs.exists(candidate)) {
      return candidate;
    }
  }

  throw new ClaudeBinaryNotFoundError(candidates);
}
