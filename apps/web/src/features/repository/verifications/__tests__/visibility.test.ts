import { describe, expect, it } from 'vitest';
import { normalizeVisibility } from '../visibility.js';

describe('normalizeVisibility', () => {
  it('returns "public" when the value is exactly "public"', () => {
    expect(normalizeVisibility('public')).toBe('public');
  });

  it('returns "hidden" when the value is exactly "hidden"', () => {
    expect(normalizeVisibility('hidden')).toBe('hidden');
  });

  it('returns "hidden" when the value is undefined (pre-M3-lite documents)', () => {
    expect(normalizeVisibility(undefined)).toBe('hidden');
  });

  it('returns "hidden" for null', () => {
    expect(normalizeVisibility(null)).toBe('hidden');
  });

  it('returns "hidden" for any unexpected value', () => {
    expect(normalizeVisibility('anything-else')).toBe('hidden');
    expect(normalizeVisibility(1)).toBe('hidden');
    expect(normalizeVisibility({})).toBe('hidden');
  });
});
