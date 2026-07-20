import { describe, expect, it } from 'vitest';
import {
  isEquivalentVariants,
  normalizeDistributionMode,
  VEX_UNKNOWN_MODE_MESSAGE,
} from '../vexDistribution.js';

describe('normalizeDistributionMode (VEX-01A)', () => {
  it('normalizes absent/undefined/null to same_questions (compat)', () => {
    expect(normalizeDistributionMode(undefined)).toBe('same_questions');
    expect(normalizeDistributionMode(null)).toBe('same_questions');
  });

  it('keeps a valid mode', () => {
    expect(normalizeDistributionMode('same_questions')).toBe('same_questions');
    expect(normalizeDistributionMode('equivalent_variants')).toBe('equivalent_variants');
  });

  it('rejects an unknown value with a readable error (no silent fallback)', () => {
    expect(() => normalizeDistributionMode('random')).toThrow(VEX_UNKNOWN_MODE_MESSAGE);
    expect(() => normalizeDistributionMode(42)).toThrow(VEX_UNKNOWN_MODE_MESSAGE);
    expect(() => normalizeDistributionMode('SAME_QUESTIONS')).toThrow();
  });

  it('isEquivalentVariants never throws on absent and reflects the mode', () => {
    expect(isEquivalentVariants(undefined)).toBe(false);
    expect(isEquivalentVariants('same_questions')).toBe(false);
    expect(isEquivalentVariants('equivalent_variants')).toBe(true);
  });
});
