import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../lib/firebase.js', () => ({ db: {}, storage: {} }));

const mockGetDocs = vi.fn();
const mockCollection = vi.fn();
const mockDoc = vi.fn();
const mockDeleteDoc = vi.fn();
const mockSetDoc = vi.fn();
const mockUpdateDoc = vi.fn();
const mockBatchDelete = vi.fn();
const mockBatchSet = vi.fn();
const mockBatchUpdate = vi.fn();
const mockBatchCommit = vi.fn();
const mockWriteBatch = vi.fn();
const mockRunTransaction = vi.fn();
const mockTxGet = vi.fn();
const mockTxUpdate = vi.fn();
const mockTxSet = vi.fn();

const mockWhere = vi.fn((...args: unknown[]) => ({ __where: args }));
const mockLimit = vi.fn((...args: unknown[]) => ({ __limit: args }));

vi.mock('firebase/firestore', () => ({
  collection: (...args: unknown[]) => mockCollection(...args),
  doc: (...args: unknown[]) => mockDoc(...args),
  getDoc: vi.fn(),
  getDocs: (...args: unknown[]) => mockGetDocs(...args),
  // Path-echoing stub: query() passes the collection ref through unchanged
  // so setupGetDocs can keep branching on collRef.__path — the where/limit
  // constraints themselves are asserted separately via mockWhere/mockLimit,
  // since this stub doesn't simulate actual server-side filtering.
  query: (collRef: unknown) => collRef,
  where: (...args: unknown[]) => mockWhere(...args),
  limit: (...args: unknown[]) => mockLimit(...args),
  serverTimestamp: vi.fn(),
  setDoc: (...args: unknown[]) => mockSetDoc(...args),
  updateDoc: (...args: unknown[]) => mockUpdateDoc(...args),
  deleteDoc: (...args: unknown[]) => mockDeleteDoc(...args),
  writeBatch: (...args: unknown[]) => mockWriteBatch(...args),
  runTransaction: (...args: unknown[]) => mockRunTransaction(...args),
  // Sentinella riconoscibile: `deleteField()` non ha una rappresentazione utile
  // fuori dall'SDK, e i test devono poter asserire «qui il campo viene rimosso».
  deleteField: () => ({ __delete: true }),
}));

const mockWriteText = vi.fn();
const mockDeleteFile = vi.fn();
const mockDeleteImportPrefix = vi.fn();

vi.mock('../../gateway/repositoryGatewayClient.js', () => ({
  writeText: (...args: unknown[]) => mockWriteText(...args),
  deleteFile: (...args: unknown[]) => mockDeleteFile(...args),
  deleteImportPrefix: (...args: unknown[]) => mockDeleteImportPrefix(...args),
}));

import {
  createProgram,
  createInitializedProgram,
  deleteProgram,
  listLessons,
  listPrograms,
  listUdas,
  setProgramClassIds,
  setLessonCompleted,
  PROGRAM_DELETE_BLOCKED_MESSAGE,
} from '../programsService.js';
import type { Firestore } from 'firebase/firestore';

const fakeDb = {} as Firestore;

/** Path-echoing stub: joins all path segments so tests can branch by full path. */
function pathStub(_root: unknown, ...segments: string[]) {
  return { __path: segments.join('/') };
}

beforeEach(() => {
  vi.clearAllMocks();
  // `clearAllMocks` azzera le chiamate ma NON le code di
  // `mockResolvedValueOnce`: un test che fallisce prima di consumarle
  // le lascerebbe al test successivo.
  mockTxGet.mockReset();
  mockCollection.mockImplementation(pathStub);
  mockDoc.mockImplementation(pathStub);
  mockBatchCommit.mockResolvedValue(undefined);
  mockWriteBatch.mockReturnValue({
    set: mockBatchSet,
    update: mockBatchUpdate,
    delete: mockBatchDelete,
    commit: mockBatchCommit,
  });
  mockWriteText.mockResolvedValue(undefined);
  mockDeleteFile.mockResolvedValue(undefined);
  mockUpdateDoc.mockResolvedValue(undefined);
  mockSetDoc.mockResolvedValue(undefined);
  // Transazione finta: esegue il callback una volta con un `tx` che registra le
  // chiamate. Le letture sono configurate per test con `mockTxGet`.
  mockRunTransaction.mockImplementation(
    async (_db: unknown, fn: (tx: unknown) => Promise<unknown>) =>
      fn({ get: mockTxGet, update: mockTxUpdate, set: mockTxSet }),
  );
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

describe('setLessonCompleted (VE-03B: solo callable autorevole)', () => {
  it('invia il payload chiuso senza uid, publicLessonId o Firestore', async () => {
    const invoke = vi.fn().mockResolvedValue(undefined);
    await setLessonCompleted(
      'program-1',
      'import-1',
      'lesson-1',
      'import-1_lesson-1',
      true,
      'owner-1',
      fakeDb,
      invoke,
    );
    expect(invoke).toHaveBeenCalledWith({
      programId: 'program-1',
      importId: 'import-1',
      lessonId: 'lesson-1',
      completed: true,
    });
    expect(mockRunTransaction).not.toHaveBeenCalled();
    expect(mockWriteBatch).not.toHaveBeenCalled();
  });

  it('propaga un errore della callable senza fallback client', async () => {
    const invoke = vi.fn().mockRejectedValue(new Error('stato corrotto'));
    await expect(
      setLessonCompleted(
        'program-1',
        'import-1',
        'lesson-1',
        'ignorato',
        false,
        'owner-1',
        fakeDb,
        invoke,
      ),
    ).rejects.toThrow('stato corrotto');
    expect(mockRunTransaction).not.toHaveBeenCalled();
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

describe('createInitializedProgram', () => {
  it('writes programma.md and atomically creates an immediately usable empty import', async () => {
    mockDoc.mockReturnValueOnce({ id: 'new-program-id' }).mockImplementation(pathStub);
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('11111111-1111-4111-8111-111111111111');

    const result = await createInitializedProgram(
      '  Nuovo corso  ',
      '2025/2026',
      'owner-uid',
      fakeDb,
    );

    expect(result).toEqual({
      programId: 'new-program-id',
      importId: '11111111-1111-4111-8111-111111111111',
      annoScolastico: '2025/2026',
    });
    expect(mockWriteText).toHaveBeenCalledWith(
      'repository/owner-uid/imports/11111111-1111-4111-8111-111111111111/programma.md',
      expect.stringContaining('anno_scolastico: 2025/2026'),
    );
    expect(mockBatchSet).toHaveBeenCalledTimes(3);
    expect(mockBatchSet.mock.calls[0]?.[1]).toMatchObject({
      ownerUid: 'owner-uid',
      title: 'Nuovo corso',
      activeImportId: '11111111-1111-4111-8111-111111111111',
      classIds: [],
    });
    expect(mockBatchSet.mock.calls[1]?.[1]).toMatchObject({
      status: 'active',
      udaCount: 0,
      lessonCount: 0,
      questionCount: 0,
      programmaMeta: { annoScolastico: '2025/2026' },
    });
    expect(mockBatchCommit).toHaveBeenCalledOnce();
  });

  it('removes programma.md best-effort when the Firestore batch fails', async () => {
    mockDoc.mockReturnValueOnce({ id: 'new-program-id' }).mockImplementation(pathStub);
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('22222222-2222-4222-8222-222222222222');
    mockBatchCommit.mockRejectedValueOnce(new Error('commit failed'));

    await expect(
      createInitializedProgram('Nuovo corso', '2025/2026', 'owner-uid', fakeDb),
    ).rejects.toThrow('Impossibile completare la creazione del corso');

    expect(mockDeleteFile).toHaveBeenCalledWith(
      'repository/owner-uid/imports/22222222-2222-4222-8222-222222222222/programma.md',
    );
  });

  it('rejects a non-consecutive school year before any write', async () => {
    await expect(
      createInitializedProgram('Nuovo corso', '2025/2027', 'owner-uid', fakeDb),
    ).rejects.toThrow('Anno scolastico non valido');
    expect(mockWriteText).not.toHaveBeenCalled();
    expect(mockWriteBatch).not.toHaveBeenCalled();
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

  it('sorts legacy lessons (no order) by the numeric lezione-XXX prefix, not by string comparison', async () => {
    // "lezione-002" would sort after "lezione-010" alphabetically as a
    // string (a "1" comes before "2" as a character), but not numerically —
    // the legacy fallback must compare the parsed number, matching
    // udaOrderOrLegacy's reasoning for UDA dirs.
    mockGetDocs.mockResolvedValue({
      docs: [
        {
          id: 'l-10',
          data: () => ({ udaDir: 'uda-01-intro', filename: 'lezione-010-finale.md' }),
        },
        {
          id: 'l-2',
          data: () => ({ udaDir: 'uda-01-intro', filename: 'lezione-002-basi.md' }),
        },
      ],
    });

    const result = await listLessons('prog-1', 'imp-1', fakeDb);
    expect(result.map((l) => l.filename)).toEqual(['lezione-002-basi.md', 'lezione-010-finale.md']);
  });

  it('sorts legacy lessons without a slug by the numeric lezione-XXX prefix', async () => {
    mockGetDocs.mockResolvedValue({
      docs: [
        { id: 'l-10', data: () => ({ udaDir: 'uda-01-intro', filename: 'lezione-010.md' }) },
        { id: 'l-2', data: () => ({ udaDir: 'uda-01-intro', filename: 'lezione-002.md' }) },
      ],
    });

    const result = await listLessons('prog-1', 'imp-1', fakeDb);
    expect(result.map((l) => l.filename)).toEqual(['lezione-002.md', 'lezione-010.md']);
  });

  it('keeps a newly ordered lesson after legacy lesson prefixes instead of moving it first', async () => {
    mockGetDocs.mockResolvedValue({
      docs: [
        {
          id: 'l-new',
          data: () => ({
            udaDir: 'uda-01-intro',
            filename: 'lezione-010-finale.md',
            order: 9,
          }),
        },
        {
          id: 'l-old',
          data: () => ({ udaDir: 'uda-01-intro', filename: 'lezione-009-legacy.md' }),
        },
      ],
    });

    const result = await listLessons('prog-1', 'imp-1', fakeDb);
    expect(result.map((l) => l.filename)).toEqual([
      'lezione-009-legacy.md',
      'lezione-010-finale.md',
    ]);
  });
});

describe('deleteProgram', () => {
  let cleanupNotes: ReturnType<typeof vi.fn<[string], Promise<unknown>>>;
  beforeEach(() => {
    cleanupNotes = vi
      .fn<[string], Promise<unknown>>()
      .mockResolvedValue({ status: 'completed', notesDeleted: 0, indexesDeleted: 0 });
  });

  function setupGetDocs(overrides: {
    verifications?: { data: () => { config: { programId: string } } }[];
    imports?: { id: string }[];
    udas?: { ref: unknown }[];
    lessons?: { id?: string; ref: unknown; data?: () => Record<string, unknown> }[];
    questionIndex?: { ref: unknown }[];
    publicLessons?: { ref: unknown }[];
  }) {
    mockGetDocs.mockImplementation((collRef: { __path: string }) => {
      if (collRef.__path === 'verifications') {
        const docs = overrides.verifications ?? [];
        return Promise.resolve({ docs, empty: docs.length === 0 });
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

  it('throws and does not delete anything when a verification references the program (targeted query, no full scan)', async () => {
    // Simulates the server-side filter: the guard query for prog-1 returns
    // exactly the (single, limit(1)) matching document — a real Firestore
    // `where('config.programId','==','prog-1').limit(1)` query never
    // returns a doc for a different program in the first place, so the
    // mock reflects that instead of re-filtering client-side.
    setupGetDocs({
      verifications: [{ data: () => ({ config: { programId: 'prog-1' } }) }],
    });

    await expect(deleteProgram('prog-1', 'owner-uid', fakeDb, cleanupNotes)).rejects.toThrow(
      PROGRAM_DELETE_BLOCKED_MESSAGE,
    );
    expect(mockDeleteDoc).not.toHaveBeenCalled();
    expect(mockWriteBatch).not.toHaveBeenCalled();
    expect(mockDeleteImportPrefix).not.toHaveBeenCalled();

    // The guard query is targeted (config.programId equality + limit(1)),
    // never an unfiltered full-collection scan.
    expect(mockWhere).toHaveBeenCalledWith('config.programId', '==', 'prog-1');
    expect(mockLimit).toHaveBeenCalledWith(1);
  });

  it('does not block when the guard query finds no linked verification (different program)', async () => {
    // A real `where('config.programId','==','prog-1').limit(1)` query
    // against verifications for a different program returns zero docs —
    // simulated here directly, since the mock doesn't filter server-side.
    setupGetDocs({
      verifications: [],
      imports: [],
    });
    await expect(
      deleteProgram('prog-1', 'owner-uid', fakeDb, cleanupNotes),
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
    await deleteProgram('prog-1', 'owner-uid', fakeDb, cleanupNotes);

    // All docs under the import (udas, lessons, questionIndex, the import doc itself) are batch-deleted.
    expect(mockBatchDelete).toHaveBeenCalledWith(udaRef);
    expect(mockBatchDelete).toHaveBeenCalledWith(lessonRef);
    expect(mockBatchDelete).toHaveBeenCalledWith(questionRef);
    expect(mockBatchDelete).toHaveBeenCalledWith({ __path: 'programs/prog-1/imports/imp-1' });
    expect(mockBatchCommit).toHaveBeenCalled();

    // Prefisso testuale storico + prefisso canonico VE-03A dei WebP.
    expect(mockDeleteImportPrefix).toHaveBeenCalledTimes(2);
    expect(mockDeleteImportPrefix).toHaveBeenCalledWith('repository/owner-uid/imports/imp-1');
    expect(mockDeleteImportPrefix).toHaveBeenCalledWith('repository/owner-uid/imp-1');

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
    await deleteProgram('prog-1', 'owner-uid', fakeDb, cleanupNotes);

    expect(mockWriteBatch).not.toHaveBeenCalled();
    expect(mockDeleteImportPrefix).not.toHaveBeenCalled();
    expect(mockDeleteDoc).toHaveBeenCalledWith({ __path: 'programs/prog-1' });
  });

  it('ripulisce in gruppo i visual prima dei prefissi e dei documenti del corso', async () => {
    const cleanupVisuals = vi.fn().mockResolvedValue(undefined);
    setupGetDocs({
      verifications: [],
      imports: [{ id: 'imp-1' }],
      lessons: [
        { id: 'l1', ref: { id: 'l1' }, data: () => ({ visual: { assetId: 'a' } }) },
        { id: 'l2', ref: { id: 'l2' }, data: () => ({}) },
      ],
    });
    await deleteProgram('prog-1', 'owner-uid', fakeDb, cleanupNotes, cleanupVisuals);
    expect(cleanupVisuals).toHaveBeenCalledWith({
      programId: 'prog-1',
      importId: 'imp-1',
      lessonIds: ['l1', 'l2'],
    });
    expect(cleanupVisuals.mock.invocationCallOrder[0]).toBeLessThan(
      mockDeleteImportPrefix.mock.invocationCallOrder[0]!,
    );
  });

  it('deletes publicLessons projections associated with the program (M3-lite cleanup)', async () => {
    const publicLessonRef = { id: 'public-lesson-ref' };
    setupGetDocs({
      verifications: [],
      imports: [],
      publicLessons: [{ ref: publicLessonRef }],
    });
    await deleteProgram('prog-1', 'owner-uid', fakeDb, cleanupNotes);

    expect(mockBatchDelete).toHaveBeenCalledWith(publicLessonRef);
  });

  it('ANNOT-CLEANUP-01 — invokes the notes cleanup with the programId before deleting the program document', async () => {
    setupGetDocs({ verifications: [], imports: [] });
    await deleteProgram('prog-1', 'owner-uid', fakeDb, cleanupNotes);

    expect(cleanupNotes).toHaveBeenCalledTimes(1);
    expect(cleanupNotes).toHaveBeenCalledWith('prog-1');
    // Cleanup ran before the program document was removed.
    const cleanupOrder = cleanupNotes.mock.invocationCallOrder[0]!;
    const deleteProgramCall = mockDeleteDoc.mock.calls.findIndex(
      ([ref]) => (ref as { __path?: string }).__path === 'programs/prog-1',
    );
    const deleteOrder = mockDeleteDoc.mock.invocationCallOrder[deleteProgramCall]!;
    expect(cleanupOrder).toBeLessThan(deleteOrder);
  });

  it('ANNOT-CLEANUP-01 — a cleanup failure performs no destructive operation and leaves the course fully intact', async () => {
    // An import is present so that, if cleanup ran AFTER any destructive step,
    // the Storage gateway / batch deletes would have fired — they must not.
    setupGetDocs({
      verifications: [],
      imports: [{ id: 'imp-1' }],
      udas: [{ ref: { __path: 'programs/prog-1/imports/imp-1/udas/u1' } }],
      publicLessons: [{ ref: { __path: 'publicLessons/pl-1' } }],
    });
    cleanupNotes.mockRejectedValue(new Error('cleanup failed'));

    await expect(deleteProgram('prog-1', 'owner-uid', fakeDb, cleanupNotes)).rejects.toThrow();

    // Cleanup runs before any destructive operation: none of them happen.
    expect(mockDeleteImportPrefix).not.toHaveBeenCalled();
    expect(mockWriteBatch).not.toHaveBeenCalled();
    expect(mockBatchCommit).not.toHaveBeenCalled();
    expect(mockBatchDelete).not.toHaveBeenCalled();
    expect(mockDeleteDoc).not.toHaveBeenCalled();
    // No success audit event is written (no false success).
    const auditCall = mockSetDoc.mock.calls.find(
      ([, data]) => (data as { action?: string }).action === 'program.deleted',
    );
    expect(auditCall).toBeUndefined();
  });
});
