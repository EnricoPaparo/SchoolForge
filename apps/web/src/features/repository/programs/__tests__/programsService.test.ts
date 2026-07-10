import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../lib/firebase.js', () => ({ db: {}, storage: {} }));

const mockGetDocs = vi.fn();
const mockCollection = vi.fn();
const mockDoc = vi.fn();
const mockDeleteDoc = vi.fn();
const mockSetDoc = vi.fn();
const mockUpdateDoc = vi.fn();
const mockBatchDelete = vi.fn();
const mockBatchCommit = vi.fn();
const mockWriteBatch = vi.fn();

vi.mock('firebase/firestore', () => ({
  collection: (...args: unknown[]) => mockCollection(...args),
  doc: (...args: unknown[]) => mockDoc(...args),
  getDoc: vi.fn(),
  getDocs: (...args: unknown[]) => mockGetDocs(...args),
  // Path-echoing stubs: query() passes the collection ref through unchanged
  // so setupGetDocs can keep branching on collRef.__path.
  query: (collRef: unknown) => collRef,
  where: () => ({}),
  serverTimestamp: vi.fn(),
  setDoc: (...args: unknown[]) => mockSetDoc(...args),
  updateDoc: (...args: unknown[]) => mockUpdateDoc(...args),
  deleteDoc: (...args: unknown[]) => mockDeleteDoc(...args),
  writeBatch: (...args: unknown[]) => mockWriteBatch(...args),
}));

const mockStorageRef = vi.fn();
const mockListAll = vi.fn();
const mockDeleteObject = vi.fn();

vi.mock('firebase/storage', () => ({
  ref: (...args: unknown[]) => mockStorageRef(...args),
  listAll: (...args: unknown[]) => mockListAll(...args),
  deleteObject: (...args: unknown[]) => mockDeleteObject(...args),
}));

import {
  createProgram,
  deleteProgram,
  listLessons,
  listPrograms,
  listUdas,
  setProgramClassIds,
  PROGRAM_DELETE_BLOCKED_MESSAGE,
} from '../programsService.js';
import type { Firestore } from 'firebase/firestore';
import type { FirebaseStorage } from 'firebase/storage';

const fakeDb = {} as Firestore;
const fakeStorage = {} as FirebaseStorage;

/** Path-echoing stub: joins all path segments so tests can branch by full path. */
function pathStub(_root: unknown, ...segments: string[]) {
  return { __path: segments.join('/') };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCollection.mockImplementation(pathStub);
  mockDoc.mockImplementation(pathStub);
  mockBatchCommit.mockResolvedValue(undefined);
  mockWriteBatch.mockReturnValue({ delete: mockBatchDelete, commit: mockBatchCommit });
  mockUpdateDoc.mockResolvedValue(undefined);
  mockSetDoc.mockResolvedValue(undefined);
});

describe('listPrograms — legacy classIds normalization', () => {
  it('defaults classIds to [] when absent on the raw Firestore doc', async () => {
    mockGetDocs.mockResolvedValue({
      docs: [{ id: 'p1', data: () => ({ ownerUid: 'owner-uid', title: 'Programma legacy' }) }],
    });

    const [program] = await listPrograms(fakeDb);
    expect(program.classIds).toEqual([]);
  });

  it('preserves classIds when present on the raw Firestore doc', async () => {
    mockGetDocs.mockResolvedValue({
      docs: [
        {
          id: 'p1',
          data: () => ({ ownerUid: 'owner-uid', title: 'Programma', classIds: ['class-1'] }),
        },
      ],
    });

    const [program] = await listPrograms(fakeDb);
    expect(program.classIds).toEqual(['class-1']);
  });
});

describe('createProgram', () => {
  it('initializes classIds to []', async () => {
    mockDoc.mockReturnValueOnce({ id: 'new-program-id' });

    const id = await createProgram('Nuovo programma', 'owner-uid', fakeDb);

    expect(id).toBe('new-program-id');
    const [, data] = mockSetDoc.mock.calls[0];
    expect(data.classIds).toEqual([]);
  });
});

describe('setProgramClassIds', () => {
  it('dedupes classIds and writes them with updatedAt', async () => {
    await setProgramClassIds('prog-1', ['class-1', 'class-2', 'class-1'], 'owner-uid', fakeDb);

    expect(mockUpdateDoc).toHaveBeenCalledTimes(1);
    const [ref, data] = mockUpdateDoc.mock.calls[0];
    expect(ref).toEqual({ __path: 'programs/prog-1' });
    expect(data.classIds).toEqual(['class-1', 'class-2']);
    expect(data).toHaveProperty('updatedAt');
  });

  it('saves an empty array when no class is selected', async () => {
    await setProgramClassIds('prog-1', [], 'owner-uid', fakeDb);

    const [, data] = mockUpdateDoc.mock.calls[0];
    expect(data.classIds).toEqual([]);
  });

  it('writes a program.classesUpdated audit event', async () => {
    await setProgramClassIds('prog-1', ['class-1'], 'owner-uid', fakeDb);

    const auditCall = mockSetDoc.mock.calls.find(
      ([, data]) => (data as { action?: string }).action === 'program.classesUpdated',
    );
    expect(auditCall).toBeDefined();
    const [, auditData] = auditCall!;
    expect(auditData).toMatchObject({
      actorUid: 'owner-uid',
      action: 'program.classesUpdated',
      targetId: 'prog-1',
      outcome: 'success',
    });
  });
});

describe('listUdas — deterministic ordering', () => {
  it('sorts legacy UDAs by the numeric uda-XX prefix regardless of Firestore return order', async () => {
    mockGetDocs.mockResolvedValue({
      docs: [
        { id: 'uda-c', data: () => ({ dir: 'uda-10-finale', filename: 'uda-10-finale.md' }) },
        { id: 'uda-a', data: () => ({ dir: 'uda-01-intro', filename: 'uda-01-intro.md' }) },
        { id: 'uda-b', data: () => ({ dir: 'uda-02-reti', filename: 'uda-02-reti.md' }) },
      ],
    });

    const result = await listUdas('prog-1', 'imp-1', fakeDb);
    expect(result.map((u) => u.dir)).toEqual(['uda-01-intro', 'uda-02-reti', 'uda-10-finale']);
  });

  it('keeps newly ordered UDAs after legacy UDA prefixes instead of moving them first', async () => {
    mockGetDocs.mockResolvedValue({
      docs: [
        {
          id: 'uda-new',
          data: () => ({ dir: 'uda-10-finale', filename: 'uda-10-finale.md', order: 9 }),
        },
        { id: 'uda-old', data: () => ({ dir: 'uda-09-legacy', filename: 'uda-09-legacy.md' }) },
      ],
    });

    const result = await listUdas('prog-1', 'imp-1', fakeDb);
    expect(result.map((u) => u.dir)).toEqual(['uda-09-legacy', 'uda-10-finale']);
  });
});

describe('listUdas — legacy document normalization', () => {
  it('defaults descrizione/competenze/obiettivi when absent on the raw Firestore doc', async () => {
    mockGetDocs.mockResolvedValue({
      docs: [
        { id: 'uda-legacy', data: () => ({ dir: 'uda-01-legacy', filename: 'uda-01-legacy.md' }) },
      ],
    });

    const [uda] = await listUdas('prog-1', 'imp-1', fakeDb);

    expect(uda.descrizione).toBeNull();
    expect(uda.competenze).toEqual([]);
    expect(uda.obiettivi).toEqual([]);
  });

  it('preserves descrizione/competenze/obiettivi when present on the raw Firestore doc', async () => {
    mockGetDocs.mockResolvedValue({
      docs: [
        {
          id: 'uda-1',
          data: () => ({
            dir: 'uda-01-reti',
            filename: 'uda-01-reti.md',
            descrizione: 'Reti informatiche di base',
            competenze: ['Competenza A'],
            obiettivi: ['Obiettivo 1'],
          }),
        },
      ],
    });

    const [uda] = await listUdas('prog-1', 'imp-1', fakeDb);

    expect(uda.descrizione).toBe('Reti informatiche di base');
    expect(uda.competenze).toEqual(['Competenza A']);
    expect(uda.obiettivi).toEqual(['Obiettivo 1']);
  });
});

describe('listLessons — deterministic ordering', () => {
  it('sorts lessons alphabetically by path so numbering decides the order — legacy docs with no filename', async () => {
    // Deliberately omits `filename` (a required LessonDoc field for current
    // imports) to exercise the legacy fallback: pre-RE-00/RE-01 documents may
    // only carry `path`, and sorting must not crash on it.
    mockGetDocs.mockResolvedValue({
      docs: [
        {
          id: 'l3',
          data: () => ({ udaDir: 'uda-01-intro', path: 'uda-01-intro/lezione-003.md' }),
        },
        {
          id: 'l1',
          data: () => ({ udaDir: 'uda-01-intro', path: 'uda-01-intro/lezione-001.md' }),
        },
        {
          id: 'l2',
          data: () => ({ udaDir: 'uda-01-intro', path: 'uda-01-intro/lezione-002.md' }),
        },
      ],
    });

    const result = await listLessons('prog-1', 'imp-1', fakeDb);
    expect(result.map((l) => l.path)).toEqual([
      'uda-01-intro/lezione-001.md',
      'uda-01-intro/lezione-002.md',
      'uda-01-intro/lezione-003.md',
    ]);
    // The fallback derives filename from path's last segment, not just an
    // empty placeholder — verified explicitly so the fallback logic itself
    // stays covered, not just "it doesn't crash".
    expect(result.map((l) => l.filename)).toEqual([
      'lezione-001.md',
      'lezione-002.md',
      'lezione-003.md',
    ]);
  });

  it('sorts by udaDir, then order, then filename when filename is present', async () => {
    mockGetDocs.mockResolvedValue({
      docs: [
        {
          id: 'l-b',
          data: () => ({
            udaDir: 'uda-01-intro',
            path: 'uda-01-intro/lezione-b.md',
            filename: 'lezione-b.md',
            order: 1,
          }),
        },
        {
          id: 'l-a',
          data: () => ({
            udaDir: 'uda-01-intro',
            path: 'uda-01-intro/lezione-a.md',
            filename: 'lezione-a.md',
            order: 0,
          }),
        },
      ],
    });

    const result = await listLessons('prog-1', 'imp-1', fakeDb);
    expect(result.map((l) => l.filename)).toEqual(['lezione-a.md', 'lezione-b.md']);
  });
});

describe('deleteProgram', () => {
  function setupGetDocs(overrides: {
    verifications?: { data: () => { config: { programId: string } } }[];
    imports?: { id: string }[];
    udas?: { ref: unknown }[];
    lessons?: { ref: unknown }[];
    questionIndex?: { ref: unknown }[];
    publicLessons?: { ref: unknown }[];
  }) {
    mockGetDocs.mockImplementation((collRef: { __path: string }) => {
      if (collRef.__path === 'verifications') {
        return Promise.resolve({ docs: overrides.verifications ?? [] });
      }
      if (collRef.__path === 'programs/prog-1/imports') {
        return Promise.resolve({ docs: overrides.imports ?? [] });
      }
      if (collRef.__path === 'programs/prog-1/imports/imp-1/udas') {
        return Promise.resolve({ docs: overrides.udas ?? [] });
      }
      if (collRef.__path === 'programs/prog-1/imports/imp-1/lessons') {
        return Promise.resolve({ docs: overrides.lessons ?? [] });
      }
      if (collRef.__path === 'programs/prog-1/imports/imp-1/questionIndex') {
        return Promise.resolve({ docs: overrides.questionIndex ?? [] });
      }
      if (collRef.__path === 'publicLessons') {
        return Promise.resolve({ docs: overrides.publicLessons ?? [] });
      }
      return Promise.resolve({ docs: [] });
    });
  }

  function setupStorage() {
    mockStorageRef.mockImplementation((_storage: unknown, path: string) => ({ __path: path }));
    mockListAll.mockImplementation((storageRef: { __path: string }) => {
      if (storageRef.__path === 'repository/owner-uid/imports/imp-1') {
        return Promise.resolve({
          items: [{ fullPath: 'repository/owner-uid/imports/imp-1/uda-01/lezione-001.md' }],
          prefixes: [{ fullPath: 'repository/owner-uid/imports/imp-1/uda-01' }],
        });
      }
      if (storageRef.__path === 'repository/owner-uid/imports/imp-1/uda-01') {
        return Promise.resolve({
          items: [{ fullPath: 'repository/owner-uid/imports/imp-1/uda-01/lezione-001.pool.md' }],
          prefixes: [],
        });
      }
      return Promise.resolve({ items: [], prefixes: [] });
    });
  }

  it('throws and does not delete anything when a verification references the program', async () => {
    setupGetDocs({
      verifications: [{ data: () => ({ config: { programId: 'prog-1' } }) }],
    });

    await expect(deleteProgram('prog-1', 'owner-uid', fakeDb, fakeStorage)).rejects.toThrow(
      PROGRAM_DELETE_BLOCKED_MESSAGE,
    );
    expect(mockDeleteDoc).not.toHaveBeenCalled();
    expect(mockWriteBatch).not.toHaveBeenCalled();
    expect(mockListAll).not.toHaveBeenCalled();
  });

  it('does not block on verifications referencing a different program', async () => {
    setupGetDocs({
      verifications: [{ data: () => ({ config: { programId: 'other-program' } }) }],
      imports: [],
    });
    setupStorage();

    await expect(
      deleteProgram('prog-1', 'owner-uid', fakeDb, fakeStorage),
    ).resolves.toBeUndefined();
    expect(mockDeleteDoc).toHaveBeenCalledWith({ __path: 'programs/prog-1' });
  });

  it('deletes program doc, all import subcollections and Storage files, and writes an audit event', async () => {
    const udaRef = { id: 'uda-ref' };
    const lessonRef = { id: 'lesson-ref' };
    const questionRef = { id: 'question-ref' };
    setupGetDocs({
      verifications: [],
      imports: [{ id: 'imp-1' }],
      udas: [{ ref: udaRef }],
      lessons: [{ ref: lessonRef }],
      questionIndex: [{ ref: questionRef }],
    });
    setupStorage();

    await deleteProgram('prog-1', 'owner-uid', fakeDb, fakeStorage);

    // All docs under the import (udas, lessons, questionIndex, the import doc itself) are batch-deleted.
    expect(mockBatchDelete).toHaveBeenCalledWith(udaRef);
    expect(mockBatchDelete).toHaveBeenCalledWith(lessonRef);
    expect(mockBatchDelete).toHaveBeenCalledWith(questionRef);
    expect(mockBatchDelete).toHaveBeenCalledWith({ __path: 'programs/prog-1/imports/imp-1' });
    expect(mockBatchCommit).toHaveBeenCalled();

    // Storage files are deleted recursively (top-level items + nested uda-01/ prefix).
    expect(mockDeleteObject).toHaveBeenCalledTimes(2);

    // The program doc itself is deleted.
    expect(mockDeleteDoc).toHaveBeenCalledWith({ __path: 'programs/prog-1' });

    // Audit event recorded.
    const auditCall = mockSetDoc.mock.calls.find(
      ([, data]) => (data as { action?: string }).action === 'program.deleted',
    );
    expect(auditCall).toBeDefined();
    const [, auditData] = auditCall!;
    expect(auditData).toMatchObject({
      actorUid: 'owner-uid',
      action: 'program.deleted',
      targetId: 'prog-1',
      outcome: 'success',
    });
  });

  it('deletes a program with no imports at all (no batch/storage calls needed)', async () => {
    setupGetDocs({ verifications: [], imports: [] });
    setupStorage();

    await deleteProgram('prog-1', 'owner-uid', fakeDb, fakeStorage);

    expect(mockWriteBatch).not.toHaveBeenCalled();
    expect(mockListAll).not.toHaveBeenCalled();
    expect(mockDeleteDoc).toHaveBeenCalledWith({ __path: 'programs/prog-1' });
  });

  it('deletes publicLessons projections associated with the program (M3-lite cleanup)', async () => {
    const publicLessonRef = { id: 'public-lesson-ref' };
    setupGetDocs({
      verifications: [],
      imports: [],
      publicLessons: [{ ref: publicLessonRef }],
    });
    setupStorage();

    await deleteProgram('prog-1', 'owner-uid', fakeDb, fakeStorage);

    expect(mockBatchDelete).toHaveBeenCalledWith(publicLessonRef);
  });
});
