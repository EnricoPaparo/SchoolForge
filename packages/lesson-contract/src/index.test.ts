import { describe, expect, it } from 'vitest';
import { POOL_SCHEMA_VERSION } from './index.js';

describe('lesson-contract', () => {
  it('exports the pool schema version identifier', () => {
    expect(POOL_SCHEMA_VERSION).toBe('schoolforge-pool/v1');
  });
});
