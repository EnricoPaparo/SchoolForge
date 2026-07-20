import { describe, expect, it } from 'vitest';
import {
  isEquivalentVariants,
  normalizeDistributionMode,
  VEX_UNKNOWN_MODE_MESSAGE,
} from '../vexDistribution.js';

describe('normalizeDistributionMode (VEX-01A-FIX: fail-closed)', () => {
  it('normalizes ONLY undefined (missing field, legacy doc) to same_questions', () => {
    expect(normalizeDistributionMode(undefined)).toBe('same_questions');
  });

  it('rejects null (present but malformed, not a legacy-missing field)', () => {
    expect(() => normalizeDistributionMode(null)).toThrow(VEX_UNKNOWN_MODE_MESSAGE);
  });

  it('rejects an empty string', () => {
    expect(() => normalizeDistributionMode('')).toThrow(VEX_UNKNOWN_MODE_MESSAGE);
  });

  it('rejects an unknown value with a readable error (no silent fallback)', () => {
    expect(() => normalizeDistributionMode('random')).toThrow(VEX_UNKNOWN_MODE_MESSAGE);
    expect(() => normalizeDistributionMode('SAME_QUESTIONS')).toThrow(VEX_UNKNOWN_MODE_MESSAGE);
  });

  it('rejects non-string types (number, array, object)', () => {
    expect(() => normalizeDistributionMode(42)).toThrow(VEX_UNKNOWN_MODE_MESSAGE);
    expect(() => normalizeDistributionMode(['same_questions'])).toThrow(VEX_UNKNOWN_MODE_MESSAGE);
    expect(() => normalizeDistributionMode({ mode: 'same_questions' })).toThrow(
      VEX_UNKNOWN_MODE_MESSAGE,
    );
  });

  it('keeps valid values unchanged', () => {
    expect(normalizeDistributionMode('same_questions')).toBe('same_questions');
    expect(normalizeDistributionMode('equivalent_variants')).toBe('equivalent_variants');
  });

  it('isEquivalentVariants reflects the mode and does not throw on undefined', () => {
    expect(isEquivalentVariants(undefined)).toBe(false);
    expect(isEquivalentVariants('same_questions')).toBe(false);
    expect(isEquivalentVariants('equivalent_variants')).toBe(true);
  });
});
