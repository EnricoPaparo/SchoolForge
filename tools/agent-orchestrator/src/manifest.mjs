// Manifest hashing. Schema validation of the task manifest (unknown keys,
// forbidden wildcards, etc. — roadmap §5) belongs to the GitHub-facing
// orchestrator (ORCHESTRATOR-02/03). This adapter only needs a stable
// SHA-256 over the manifest text to detect divergence against the
// checkpoint (contract point 6).

import { createHash } from 'node:crypto';

export function hashManifest(manifestText) {
  if (typeof manifestText !== 'string' || manifestText.length === 0) {
    throw new TypeError('manifestText must be a non-empty string');
  }
  return createHash('sha256').update(manifestText, 'utf8').digest('hex');
}

export function hashPrompt(promptText) {
  if (typeof promptText !== 'string' || promptText.length === 0) {
    throw new TypeError('promptText must be a non-empty string');
  }
  return createHash('sha256').update(promptText, 'utf8').digest('hex');
}
