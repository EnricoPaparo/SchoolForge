import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

afterEach(cleanup);

vi.mock('../../../lib/firebase.js', () => ({ app: {}, auth: {}, db: {}, storage: {} }));

import { ReadinessView } from '../ReadinessView.js';
import type {
  LessonItem,
  ProgramItem,
  UdaItem,
} from '../../repository/programs/programsService.js';

const baseProgram: ProgramItem = {
  id: 'p1',
  ownerUid: 'uid1',
  title: 'Test',
  activeImportId: 'imp1',
  createdAt: null as never,
  updatedAt: null as never,
};

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
    storageRef: 'gs://bucket/test.md',
    poolStorageRef: null,
    ...overrides,
  };
}

function makeUda(): UdaItem {
  return {
    id: 'u1',
    ownerUid: 'uid1',
    importId: 'imp1',
    dir: 'uda-01',
    filename: 'uda-01-test.md',
    storageBasePath: 'gs://bucket/uda-01',
    lessonCount: 1,
  };
}

describe('ReadinessView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows loading when udas is null', () => {
    render(<ReadinessView program={baseProgram} udas={null} lessons={null} />);
    expect(screen.getByText(/Caricamento dati prontezza/)).toBeTruthy();
  });

  it('shows loading when lessons is null', () => {
    render(<ReadinessView program={baseProgram} udas={[makeUda()]} lessons={null} />);
    expect(screen.getByText(/Caricamento dati prontezza/)).toBeTruthy();
  });

  it('shows Bloccato status when no active import', () => {
    const programNoImport: ProgramItem = { ...baseProgram, activeImportId: null };
    render(<ReadinessView program={programNoImport} udas={[]} lessons={[]} />);
    expect(screen.getByText(/Bloccato/)).toBeTruthy();
  });

  it('shows status and counts for a valid program with completed lessons', () => {
    const lesson = makeLesson({ poolStatus: 'valid', questionCount: 5, completed: true });
    render(<ReadinessView program={baseProgram} udas={[makeUda()]} lessons={[lesson]} />);
    expect(screen.getByText(/Pronto/)).toBeTruthy();
  });

  it('shows warning labels when pool is invalid', () => {
    const lesson = makeLesson({ poolStatus: 'invalid', questionCount: 0, completed: false });
    render(<ReadinessView program={baseProgram} udas={[makeUda()]} lessons={[lesson]} />);
    expect(screen.getByText(/Attenzione/)).toBeTruthy();
    expect(screen.getByText(/Pool non validi presenti/)).toBeTruthy();
  });
});
