import { describe, expect, it } from 'vitest';
import { computeReadiness } from '../readinessReport.js';
import type { LessonItem, ProgramItem, UdaItem } from '../../programs/programsService.js';

function makeLesson(overrides: Partial<LessonItem> = {}): LessonItem {
  return {
    id: 'l1',
    ownerUid: 'uid1',
    importId: 'imp1',
    udaDir: 'uda-01',
    path: 'uda-01/lezione-001-test.md',
    filename: 'lezione-001-test.md',
    poolStatus: 'absent',
    questionCount: 0,
    storageRef: 'gs://bucket/uda-01/lezione-001-test.md',
    poolStorageRef: null,
    ...overrides,
  };
}

function makeUda(overrides: Partial<UdaItem> = {}): UdaItem {
  return {
    id: 'u1',
    ownerUid: 'uid1',
    importId: 'imp1',
    dir: 'uda-01',
    filename: 'uda-01-test.md',
    storageBasePath: 'gs://bucket/uda-01',
    lessonCount: 1,
    ...overrides,
  };
}

const baseProgram: ProgramItem = {
  id: 'p1',
  ownerUid: 'uid1',
  title: 'Test',
  activeImportId: 'imp1',
  createdAt: null as never,
  updatedAt: null as never,
};

describe('computeReadiness', () => {
  it('returns blocker and canConsultLessons=false when hasActiveImport=false', () => {
    const report = computeReadiness({
      program: null,
      udas: [],
      lessons: [],
      hasActiveImport: false,
    });
    expect(report.overallStatus).toBe('blocker');
    expect(report.canConsultLessons).toBe(false);
    const check = report.checks.find((c) => c.id === 'active-import');
    expect(check?.status).toBe('blocker');
  });

  it('returns blocker when lessons is empty (with active import)', () => {
    const report = computeReadiness({
      program: baseProgram,
      udas: [makeUda()],
      lessons: [],
      hasActiveImport: true,
    });
    expect(report.overallStatus).toBe('blocker');
    expect(report.canConsultLessons).toBe(false);
    const check = report.checks.find((c) => c.id === 'lessons');
    expect(check?.status).toBe('blocker');
  });

  it('returns warning and canGenerateVerifiche=false when no pool valid', () => {
    const report = computeReadiness({
      program: baseProgram,
      udas: [makeUda()],
      lessons: [makeLesson({ poolStatus: 'absent', questionCount: 0 })],
      hasActiveImport: true,
    });
    expect(report.overallStatus).toBe('warning');
    expect(report.canConsultLessons).toBe(true);
    expect(report.canGenerateVerifiche).toBe(false);
    const check = report.checks.find((c) => c.id === 'valid-pool');
    expect(check?.status).toBe('warning');
  });

  it('returns ok and canGenerateVerifiche=true when valid pool with questionCount>0', () => {
    const report = computeReadiness({
      program: baseProgram,
      udas: [makeUda()],
      lessons: [makeLesson({ poolStatus: 'valid', questionCount: 5, completed: true })],
      hasActiveImport: true,
    });
    expect(report.overallStatus).toBe('ok');
    expect(report.canGenerateVerifiche).toBe(true);
    expect(report.canExportProgrammaSvolto).toBe(true);
  });

  it('returns warning and canExportProgrammaSvolto=false when no completed lessons', () => {
    const report = computeReadiness({
      program: baseProgram,
      udas: [makeUda()],
      lessons: [makeLesson({ poolStatus: 'valid', questionCount: 3, completed: false })],
      hasActiveImport: true,
    });
    expect(report.canExportProgrammaSvolto).toBe(false);
    const check = report.checks.find((c) => c.id === 'completed-lessons');
    expect(check?.status).toBe('warning');
  });

  it('sets canExportProgrammaSvolto=true when at least one lesson is completed', () => {
    const report = computeReadiness({
      program: baseProgram,
      udas: [makeUda()],
      lessons: [
        makeLesson({ id: 'l1', poolStatus: 'valid', questionCount: 3, completed: true }),
        makeLesson({ id: 'l2', poolStatus: 'absent', questionCount: 0, completed: false }),
      ],
      hasActiveImport: true,
    });
    expect(report.canExportProgrammaSvolto).toBe(true);
  });

  it('returns warning when pool invalid present', () => {
    const report = computeReadiness({
      program: baseProgram,
      udas: [makeUda()],
      lessons: [
        makeLesson({ id: 'l1', poolStatus: 'invalid', questionCount: 0 }),
        makeLesson({ id: 'l2', poolStatus: 'valid', questionCount: 2, completed: false }),
      ],
      hasActiveImport: true,
    });
    const check = report.checks.find((c) => c.id === 'invalid-pool');
    expect(check?.status).toBe('warning');
    expect(report.overallStatus).toBe('warning');
  });
});
