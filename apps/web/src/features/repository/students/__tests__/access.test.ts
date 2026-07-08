import { describe, expect, it } from 'vitest';
import { canReadStudentContent } from '../access.js';

describe('canReadStudentContent', () => {
  it('allows when portal enabled and student approved', () => {
    expect(canReadStudentContent({ studentPortalEnabled: true }, { status: 'approved' })).toBe(
      true,
    );
  });

  it('denies when portal disabled, even if approved', () => {
    expect(canReadStudentContent({ studentPortalEnabled: false }, { status: 'approved' })).toBe(
      false,
    );
  });

  it('denies when student is pending', () => {
    expect(canReadStudentContent({ studentPortalEnabled: true }, { status: 'pending' })).toBe(
      false,
    );
  });

  it('denies when student is blocked', () => {
    expect(canReadStudentContent({ studentPortalEnabled: true }, { status: 'blocked' })).toBe(
      false,
    );
  });

  it('denies when access settings are missing', () => {
    expect(canReadStudentContent(null, { status: 'approved' })).toBe(false);
    expect(canReadStudentContent(undefined, { status: 'approved' })).toBe(false);
  });

  it('denies when student document is missing', () => {
    expect(canReadStudentContent({ studentPortalEnabled: true }, null)).toBe(false);
    expect(canReadStudentContent({ studentPortalEnabled: true }, undefined)).toBe(false);
  });
});
