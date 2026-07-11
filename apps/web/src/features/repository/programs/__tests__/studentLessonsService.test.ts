import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../lib/firebase.js', () => ({ db: {} }));

const mockGetDocs = vi.fn();
const mockGetOwnStudentDoc = vi.fn();

vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, name: string) => ({ __collection: name }),
  query: (collRef: unknown, ...clauses: unknown[]) => ({ __collRef: collRef, __clauses: clauses }),
  where: (field: string, op: string, value: unknown) => ({ field, op, value }),
  getDocs: (...args: unknown[]) => mockGetDocs(...args),
}));

vi.mock('../../students/studentsService.js', () => ({
  getOwnStudentDoc: (...args: unknown[]) => mockGetOwnStudentDoc(...args),
}));

import { loadStudentLessons } from '../studentLessonsService.js';
import type { Firestore } from 'firebase/firestore';

const fakeDb = {} as Firestore;
const STUDENT_UID = 'student-uid';

function docsFor(collectionName: string, items: { id: string; data: Record<string, unknown> }[]) {
  return {
    docs: items.map((item) => ({ id: item.id, data: () => item.data })),
    __collectionName: collectionName,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('loadStudentLessons — no class assigned', () => {
  it('returns no-class when classId is null', async () => {
    mockGetOwnStudentDoc.mockResolvedValue({ classId: null });

    const result = await loadStudentLessons(STUDENT_UID, fakeDb);
    expect(result).toEqual({ status: 'no-class' });
    expect(mockGetDocs).not.toHaveBeenCalled();
  });

  it('returns no-class when the student document does not exist', async () => {
    mockGetOwnStudentDoc.mockResolvedValue(null);

    const result = await loadStudentLessons(STUDENT_UID, fakeDb);
    expect(result).toEqual({ status: 'no-class' });
  });
});

describe('loadStudentLessons — program filtering', () => {
  it('returns only programs whose classIds includes the student class', async () => {
    mockGetOwnStudentDoc.mockResolvedValue({ classId: 'class-a' });
    mockGetDocs.mockImplementation((q: { __collRef: { __collection: string } }) => {
      if (q.__collRef.__collection === 'programs') {
        return Promise.resolve(
          docsFor('programs', [
            { id: 'p1', data: { title: 'Informatica', classIds: ['class-a'] } },
          ]),
        );
      }
      return Promise.resolve(docsFor('publicLessons', []));
    });

    const result = await loadStudentLessons(STUDENT_UID, fakeDb);
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.programs).toEqual([{ id: 'p1', title: 'Informatica', classIds: ['class-a'] }]);
  });

  it('does not include a program with no classIds (query-level filter already excludes it)', async () => {
    // The Firestore array-contains query itself never returns a program
    // with an empty/absent classIds — this test documents that assumption
    // by simulating an empty result set from the mocked query.
    mockGetOwnStudentDoc.mockResolvedValue({ classId: 'class-a' });
    mockGetDocs.mockResolvedValue(docsFor('programs', []));

    const result = await loadStudentLessons(STUDENT_UID, fakeDb);
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.programs).toEqual([]);
  });

  it('sorts programs by title', async () => {
    mockGetOwnStudentDoc.mockResolvedValue({ classId: 'class-a' });
    mockGetDocs.mockImplementation((q: { __collRef: { __collection: string } }) => {
      if (q.__collRef.__collection === 'programs') {
        return Promise.resolve(
          docsFor('programs', [
            { id: 'p2', data: { title: 'Zeta', classIds: ['class-a'] } },
            { id: 'p1', data: { title: 'Alfa', classIds: ['class-a'] } },
          ]),
        );
      }
      return Promise.resolve(docsFor('publicLessons', []));
    });

    const result = await loadStudentLessons(STUDENT_UID, fakeDb);
    if (result.status !== 'ok') throw new Error('expected ok');
    expect(result.programs.map((p) => p.title)).toEqual(['Alfa', 'Zeta']);
  });
});

describe('loadStudentLessons — lesson sorting', () => {
  it('sorts lessons by udaDir then filename, stably', async () => {
    mockGetOwnStudentDoc.mockResolvedValue({ classId: 'class-a' });
    mockGetDocs.mockImplementation((q: { __collRef: { __collection: string } }) => {
      if (q.__collRef.__collection === 'programs') {
        return Promise.resolve(
          docsFor('programs', [
            { id: 'p1', data: { title: 'Informatica', classIds: ['class-a'] } },
          ]),
        );
      }
      return Promise.resolve(
        docsFor('publicLessons', [
          {
            id: 'l3',
            data: {
              programId: 'p1',
              udaId: 'uda-2',
              udaDir: 'uda-02-web',
              filename: 'lezione-001.md',
              path: 'uda-02-web/lezione-001.md',
              contentPath: 'repository/x/imports/i1/uda-02-web/lezione-001.md',
              ownerUid: 'owner',
              importId: 'i1',
            },
          },
          {
            id: 'l1',
            data: {
              programId: 'p1',
              udaId: 'uda-1',
              udaDir: 'uda-01-reti',
              filename: 'lezione-002.md',
              path: 'uda-01-reti/lezione-002.md',
              contentPath: 'repository/x/imports/i1/uda-01-reti/lezione-002.md',
              ownerUid: 'owner',
              importId: 'i1',
            },
          },
          {
            id: 'l2',
            data: {
              programId: 'p1',
              udaId: 'uda-1',
              udaDir: 'uda-01-reti',
              filename: 'lezione-001.md',
              path: 'uda-01-reti/lezione-001.md',
              contentPath: 'repository/x/imports/i1/uda-01-reti/lezione-001.md',
              ownerUid: 'owner',
              importId: 'i1',
            },
          },
        ]),
      );
    });

    const result = await loadStudentLessons(STUDENT_UID, fakeDb);
    if (result.status !== 'ok') throw new Error('expected ok');
    const order = result.lessonsByProgram['p1']!.map((l) => `${l.udaDir}/${l.filename}`);
    expect(order).toEqual([
      'uda-01-reti/lezione-001.md',
      'uda-01-reti/lezione-002.md',
      'uda-02-web/lezione-001.md',
    ]);
  });

  it('never includes technical fields (poolStatus, poolStorageRef, questionCount)', async () => {
    mockGetOwnStudentDoc.mockResolvedValue({ classId: 'class-a' });
    mockGetDocs.mockImplementation((q: { __collRef: { __collection: string } }) => {
      if (q.__collRef.__collection === 'programs') {
        return Promise.resolve(
          docsFor('programs', [
            { id: 'p1', data: { title: 'Informatica', classIds: ['class-a'] } },
          ]),
        );
      }
      return Promise.resolve(
        docsFor('publicLessons', [
          {
            id: 'l1',
            data: {
              programId: 'p1',
              udaId: 'uda-1',
              udaDir: 'uda-01-reti',
              filename: 'lezione-001.md',
              path: 'uda-01-reti/lezione-001.md',
              contentPath: 'repository/x/imports/i1/uda-01-reti/lezione-001.md',
              ownerUid: 'owner',
              importId: 'i1',
            },
          },
        ]),
      );
    });

    const result = await loadStudentLessons(STUDENT_UID, fakeDb);
    if (result.status !== 'ok') throw new Error('expected ok');
    const lesson = result.lessonsByProgram['p1']![0]!;
    expect(lesson).not.toHaveProperty('poolStatus');
    expect(lesson).not.toHaveProperty('poolStorageRef');
    expect(lesson).not.toHaveProperty('questionCount');
  });
});

describe('loadStudentLessons — M3F-08 content projection', () => {
  function singleLessonSnap(data: Record<string, unknown>) {
    return (q: { __collRef: { __collection: string } }) => {
      if (q.__collRef.__collection === 'programs') {
        return Promise.resolve(
          docsFor('programs', [
            { id: 'p1', data: { title: 'Informatica', classIds: ['class-a'] } },
          ]),
        );
      }
      return Promise.resolve(
        docsFor('publicLessons', [
          {
            id: 'l1',
            data: {
              programId: 'p1',
              udaId: 'uda-1',
              udaDir: 'uda-01-reti',
              filename: 'lezione-001.md',
              path: 'uda-01-reti/lezione-001.md',
              contentPath: 'repository/x/imports/i1/uda-01-reti/lezione-001.md',
              ownerUid: 'owner',
              importId: 'i1',
              ...data,
            },
          },
        ]),
      );
    };
  }

  it('exposes content as-is when the projection has a valid string', async () => {
    mockGetOwnStudentDoc.mockResolvedValue({ classId: 'class-a' });
    mockGetDocs.mockImplementation(singleLessonSnap({ content: 'Corpo della lezione.' }));

    const result = await loadStudentLessons(STUDENT_UID, fakeDb);
    if (result.status !== 'ok') throw new Error('expected ok');
    expect(result.lessonsByProgram['p1']![0]!.content).toBe('Corpo della lezione.');
  });

  it('normalizes a legacy document with no content field to null (no Storage fallback)', async () => {
    mockGetOwnStudentDoc.mockResolvedValue({ classId: 'class-a' });
    mockGetDocs.mockImplementation(singleLessonSnap({}));

    const result = await loadStudentLessons(STUDENT_UID, fakeDb);
    if (result.status !== 'ok') throw new Error('expected ok');
    expect(result.lessonsByProgram['p1']![0]!.content).toBeNull();
  });

  it('normalizes a corrupt non-string content value to null', async () => {
    mockGetOwnStudentDoc.mockResolvedValue({ classId: 'class-a' });
    mockGetDocs.mockImplementation(singleLessonSnap({ content: 42 }));

    const result = await loadStudentLessons(STUDENT_UID, fakeDb);
    if (result.status !== 'ok') throw new Error('expected ok');
    expect(result.lessonsByProgram['p1']![0]!.content).toBeNull();
  });
});
