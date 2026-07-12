import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase/firestore';

const mockListPrograms = vi.fn();
const mockListUdas = vi.fn();
const mockListLessons = vi.fn();
const mockGetImportMeta = vi.fn();
const mockListClasses = vi.fn();

vi.mock('../programsService.js', () => ({
  listPrograms: (...a: unknown[]) => mockListPrograms(...a),
  listUdas: (...a: unknown[]) => mockListUdas(...a),
  listLessons: (...a: unknown[]) => mockListLessons(...a),
  getImportMeta: (...a: unknown[]) => mockGetImportMeta(...a),
}));
vi.mock('../../classes/classesService.js', () => ({
  listClasses: (...a: unknown[]) => mockListClasses(...a),
}));

import { loadCourseLibrary } from '../courseLibrary.js';

const db = {} as Firestore;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('loadCourseLibrary', () => {
  it('aggregates the card metrics from the existing services (counts, anno, class names)', async () => {
    mockListPrograms.mockResolvedValue([
      { id: 'p1', title: 'Reti', activeImportId: 'i1', classIds: ['cA', 'cB'] },
    ]);
    mockListClasses.mockResolvedValue([
      { id: 'cA', name: '4A INF' },
      { id: 'cB', name: '5A INF' },
    ]);
    mockListUdas.mockResolvedValue([{ id: 'u1' }, { id: 'u2' }, { id: 'u3' }]);
    mockListLessons.mockResolvedValue([
      { id: 'l1', completed: true, questionCount: 4 },
      { id: 'l2', completed: true, questionCount: 3 },
      { id: 'l3', completed: false, questionCount: 0 },
      { id: 'l4', questionCount: 2 },
    ]);
    mockGetImportMeta.mockResolvedValue({ annoScolastico: '2025/2026' });

    const cards = await loadCourseLibrary('owner', db);

    expect(cards).toEqual([
      {
        programId: 'p1',
        title: 'Reti',
        annoScolastico: '2025/2026',
        classIds: ['cA', 'cB'],
        classNames: ['4A INF', '5A INF'],
        udaCount: 3,
        lessonsTotal: 4,
        lessonsDone: 2,
        questionsTotal: 9,
        hasImport: true,
        activeImportId: 'i1',
      },
    ]);
  });

  it('handles a program with no active import: no tree reads, zeros, Senza anno', async () => {
    mockListPrograms.mockResolvedValue([
      { id: 'p1', title: 'Bozza', activeImportId: null, classIds: [] },
    ]);
    mockListClasses.mockResolvedValue([]);

    const cards = await loadCourseLibrary('owner', db);

    expect(cards[0]).toMatchObject({
      programId: 'p1',
      annoScolastico: null,
      classNames: [],
      udaCount: 0,
      lessonsTotal: 0,
      lessonsDone: 0,
      questionsTotal: 0,
      hasImport: false,
    });
    // No per-program tree reads for a program that was never imported.
    expect(mockListUdas).not.toHaveBeenCalled();
    expect(mockListLessons).not.toHaveBeenCalled();
    expect(mockGetImportMeta).not.toHaveBeenCalled();
  });

  it('spends the documented query budget: 1 listPrograms + 1 listClasses + 3 reads per imported program', async () => {
    mockListPrograms.mockResolvedValue([
      { id: 'p1', title: 'A', activeImportId: 'i1', classIds: [] },
      { id: 'p2', title: 'B', activeImportId: 'i2', classIds: [] },
      { id: 'p3', title: 'C', activeImportId: null, classIds: [] }, // no import → no tree reads
    ]);
    mockListClasses.mockResolvedValue([]);
    mockListUdas.mockResolvedValue([]);
    mockListLessons.mockResolvedValue([]);
    mockGetImportMeta.mockResolvedValue(null);

    await loadCourseLibrary('owner', db);

    expect(mockListPrograms).toHaveBeenCalledTimes(1);
    expect(mockListClasses).toHaveBeenCalledTimes(1);
    // Only the two imported programs trigger the 3 per-program reads.
    expect(mockListUdas).toHaveBeenCalledTimes(2);
    expect(mockListLessons).toHaveBeenCalledTimes(2);
    expect(mockGetImportMeta).toHaveBeenCalledTimes(2);
  });

  it('drops class ids that no longer resolve to a class name', async () => {
    mockListPrograms.mockResolvedValue([
      { id: 'p1', title: 'X', activeImportId: null, classIds: ['gone', 'cA'] },
    ]);
    mockListClasses.mockResolvedValue([{ id: 'cA', name: '3B INF' }]);

    const cards = await loadCourseLibrary('owner', db);
    expect(cards[0].classNames).toEqual(['3B INF']);
  });
});
