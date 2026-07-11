import { describe, expect, it } from 'vitest';
import { normalizeStudentPdfEnabled } from '../studentPdfEnabled.js';

describe('normalizeStudentPdfEnabled', () => {
  it('returns true when the value is exactly true', () => {
    expect(normalizeStudentPdfEnabled(true)).toBe(true);
  });

  it('returns false when the value is false', () => {
    expect(normalizeStudentPdfEnabled(false)).toBe(false);
  });

  it('returns false when the value is undefined (pre-M3F-09 documents)', () => {
    expect(normalizeStudentPdfEnabled(undefined)).toBe(false);
  });

  it('returns false for null', () => {
    expect(normalizeStudentPdfEnabled(null)).toBe(false);
  });

  it('returns false for any non-boolean truthy value', () => {
    expect(normalizeStudentPdfEnabled(1)).toBe(false);
    expect(normalizeStudentPdfEnabled('true')).toBe(false);
    expect(normalizeStudentPdfEnabled({})).toBe(false);
  });
});
