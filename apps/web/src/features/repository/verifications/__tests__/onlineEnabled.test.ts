import { describe, expect, it } from 'vitest';
import { normalizeOnlineEnabled } from '../onlineEnabled.js';

describe('normalizeOnlineEnabled', () => {
  it('returns true when the value is exactly true', () => {
    expect(normalizeOnlineEnabled(true)).toBe(true);
  });

  it('returns false when the value is false', () => {
    expect(normalizeOnlineEnabled(false)).toBe(false);
  });

  it('returns false when the value is undefined (pre-M3-full documents)', () => {
    expect(normalizeOnlineEnabled(undefined)).toBe(false);
  });

  it('returns false for null', () => {
    expect(normalizeOnlineEnabled(null)).toBe(false);
  });

  it('returns false for any non-boolean truthy value', () => {
    expect(normalizeOnlineEnabled(1)).toBe(false);
    expect(normalizeOnlineEnabled('true')).toBe(false);
    expect(normalizeOnlineEnabled({})).toBe(false);
  });
});
