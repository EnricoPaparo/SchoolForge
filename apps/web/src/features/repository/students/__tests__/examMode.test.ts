import { describe, expect, it } from 'vitest';
import { isExamModeActiveForClass, normalizeExamMode } from '../examMode.js';

describe('normalizeExamMode', () => {
  it('treats a missing value as disabled', () => {
    expect(normalizeExamMode(undefined)).toEqual({
      enabled: false,
      scope: 'all',
      classIds: [],
      enabledAt: null,
    });
  });

  it('treats a non-object value as disabled', () => {
    expect(normalizeExamMode('nope').enabled).toBe(false);
    expect(normalizeExamMode(42).enabled).toBe(false);
  });

  it('treats enabled !== true as disabled, regardless of other fields', () => {
    expect(normalizeExamMode({ enabled: 'true', scope: 'all' }).enabled).toBe(false);
    expect(normalizeExamMode({ scope: 'all' }).enabled).toBe(false);
  });

  it('normalizes a valid scope=all document', () => {
    const result = normalizeExamMode({
      enabled: true,
      scope: 'all',
      classIds: [],
      enabledAt: null,
    });
    expect(result).toEqual({ enabled: true, scope: 'all', classIds: [], enabledAt: null });
  });

  it('normalizes a valid scope=classes document', () => {
    const result = normalizeExamMode({
      enabled: true,
      scope: 'classes',
      classIds: ['c1', 'c2'],
      enabledAt: null,
    });
    expect(result).toEqual({
      enabled: true,
      scope: 'classes',
      classIds: ['c1', 'c2'],
      enabledAt: null,
    });
  });

  it('treats scope=classes with an empty classIds array as disabled', () => {
    expect(normalizeExamMode({ enabled: true, scope: 'classes', classIds: [] }).enabled).toBe(
      false,
    );
  });

  it('treats scope=classes with a missing/malformed classIds as disabled', () => {
    expect(normalizeExamMode({ enabled: true, scope: 'classes' }).enabled).toBe(false);
    expect(normalizeExamMode({ enabled: true, scope: 'classes', classIds: 'c1' }).enabled).toBe(
      false,
    );
  });

  it('filters out non-string entries from classIds', () => {
    const result = normalizeExamMode({
      enabled: true,
      scope: 'classes',
      classIds: ['c1', 42, null, ''],
    });
    expect(result.classIds).toEqual(['c1']);
  });

  it('treats an unrecognized scope as disabled', () => {
    expect(normalizeExamMode({ enabled: true, scope: 'bogus' }).enabled).toBe(false);
  });
});

describe('isExamModeActiveForClass', () => {
  it('is false when examMode is absent/malformed', () => {
    expect(isExamModeActiveForClass(undefined, 'c1')).toBe(false);
    expect(isExamModeActiveForClass({}, 'c1')).toBe(false);
    expect(isExamModeActiveForClass({ enabled: true, scope: 'classes' }, 'c1')).toBe(false);
  });

  it('is true for scope=all whenever enabled, regardless of classId', () => {
    const examMode = { enabled: true, scope: 'all', classIds: [], enabledAt: null };
    expect(isExamModeActiveForClass(examMode, 'c1')).toBe(true);
    expect(isExamModeActiveForClass(examMode, null)).toBe(true);
  });

  it('is true for scope=classes only when classId is included', () => {
    const examMode = { enabled: true, scope: 'classes', classIds: ['c1', 'c2'], enabledAt: null };
    expect(isExamModeActiveForClass(examMode, 'c1')).toBe(true);
    expect(isExamModeActiveForClass(examMode, 'c3')).toBe(false);
  });

  it('is false for scope=classes when classId is null/missing', () => {
    const examMode = { enabled: true, scope: 'classes', classIds: ['c1'], enabledAt: null };
    expect(isExamModeActiveForClass(examMode, null)).toBe(false);
  });

  it('is false when disabled, even with a matching classId', () => {
    const examMode = { enabled: false, scope: 'classes', classIds: ['c1'], enabledAt: null };
    expect(isExamModeActiveForClass(examMode, 'c1')).toBe(false);
  });
});
