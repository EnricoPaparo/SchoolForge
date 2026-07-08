import { describe, expect, it } from 'vitest';
import { normalizeStudentStatus } from '../status.js';

describe('normalizeStudentStatus', () => {
  it('returns approved when value is exactly approved', () => {
    expect(normalizeStudentStatus('approved')).toBe('approved');
  });

  it('returns blocked when value is exactly blocked', () => {
    expect(normalizeStudentStatus('blocked')).toBe('blocked');
  });

  it('returns pending when value is exactly pending', () => {
    expect(normalizeStudentStatus('pending')).toBe('pending');
  });

  it('returns pending for undefined', () => {
    expect(normalizeStudentStatus(undefined)).toBe('pending');
  });

  it('returns pending for null', () => {
    expect(normalizeStudentStatus(null)).toBe('pending');
  });

  it('returns pending for any unexpected value', () => {
    expect(normalizeStudentStatus('APPROVED')).toBe('pending');
    expect(normalizeStudentStatus(42)).toBe('pending');
    expect(normalizeStudentStatus('deleted')).toBe('pending');
  });
});
