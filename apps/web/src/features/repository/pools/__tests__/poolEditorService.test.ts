import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../lib/firebase.js', () => ({ db: {}, storage: {} }));

const mockGetDoc = vi.fn();
const mockGetDocs = vi.fn();
const mockSetDoc = vi.fn();
const mockUpdateDoc = vi.fn();
const mockBatchSet = vi.fn();
const mockBatchUpdate = vi.fn();
const mockBatchDelete = vi.fn();
const mockBatchCommit = vi.fn();
const mockWriteBatch = vi.fn();

function isCollectionRef(value: unknown): value is { __path: string } {
  return typeof value === 'object' && value !== null && '__path' in value;
}

vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...segments: string[]) => ({ __path: segments.join('/') }),
  doc: (...args: unknown[]) => {
    const [first, ...rest] = args;
    if (isCollectionRef(first)) {
      if (rest.length === 0) return { __path: `${first.__path}/auto-id` };
      return { __path: `${first.__path}/${rest.join('/')}` };
    }
    return { __path: rest.filter((s): s is string => typeof s === 'string').join('/') };
  },
  getDoc: (...args: unknown[]) => mockGetDoc(...args),
  getDocs: (...args: unknown[]) => mockGetDocs(...args),
  setDoc: (...args: unknown[]) => mockSetDoc(...args),
  updateDoc: (...args: unknown[]) => mockUpdateDoc(...args),
  query: (collRef: unknown) => collRef,
  where: () => ({}),
  writeBatch: (...args: unknown[]) => mockWriteBatch(...args),
}));

const mockGetBytes = vi.fn();
const mockUploadBytes = vi.fn();
const mockDeleteObject = vi.fn();

vi.mock('firebase/storage', () => ({
  ref: (_storage: unknown, path: string) => ({ __storagePath: path }),
  getBytes: (...args: unknown[]) => mockGetBytes(...args),
  uploadBytes: (...args: unknown[]) => mockUploadBytes(...args),
  deleteObject: (...args: unknown[]) => mockDeleteObject(...args),
}));

import { deletePool, loadPool, PoolDeleteBlockedError, savePool } from '../poolEditorService.js';
import type { Firestore } from 'firebase/firestore';
import type { FirebaseStorage } from 'firebase/storage';
import type { LessonDoc, VerificationDoc } from '../../../../types/firestore.js';

const fakeDb = {} as Firestore;
const fakeStorage = {} as FirebaseStorage;
const OWNER_UID = 'owner-uid';
const PROGRAM_ID = 'prog-1';
const IMPORT_ID = 'imp-1';
const LESSON_ID = 'uda_01_reti_lezione-001-http';

const POOL_STORAGE_REF = `repository/${OWNER_UID}/imports/${IMPORT_ID}/uda-01-reti/lezione-001-http.pool.md`;

const BASE_LESSON: LessonDoc = {
  ownerUid: OWNER_UID,
  importId: IMPORT_ID,
  udaDir: 'uda-01-reti',
  path: 'uda-01-reti/lezione-001-http.md',
  filename: 'lezione-001-http.md',
  poolStatus: 'valid',
  questionCount: 1,
  storageRef: `repository/${OWNER_UID}/imports/${IMPORT_ID}/uda-01-reti/lezione-001-http.md`,
  poolStorageRef: POOL_STORAGE_REF,
};

const VALID_POOL_MD = `---
schema: schoolforge-pool/v1
questions:
  - id: q1
    tipo: aperta
    difficolta: 2
    peso: 2
    testo: Spiega la differenza tra HTTP e HTTPS.
    soluzione: HTTPS aggiunge TLS.
---`;

function lessonSnap(lesson: LessonDoc) {
  return { exists: () => true, data: () => lesson };
}

function missingSnap() {
  return { exists: () => false };
}

function encode(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSetDoc.mockResolvedValue(undefined);
  mockUpdateDoc.mockResolvedValue(undefined);
  mockUploadBytes.mockResolvedValue(undefined);
  mockDeleteObject.mockResolvedValue(undefined);
  mockGetDocs.mockResolvedValue({ docs: [] });
  mockBatchCommit.mockResolvedValue(undefined);
  mockWriteBatch.mockReturnValue({
    set: mockBatchSet,
    update: mockBatchUpdate,
    delete: mockBatchDelete,
    commit: mockBatchCommit,
  });
});

// ── loadPool ──────────────────────────────────────────────────────────────────

describe('loadPool', () => {
  it('throws when lesson document does not exist', async () => {
    mockGetDoc.mockResolvedValueOnce(missingSnap());

    await expect(
      loadPool({
        programId: PROGRAM_ID,
        importId: IMPORT_ID,
        lessonId: LESSON_ID,
        db: fakeDb,
        storage: fakeStorage,
      }),
    ).rejects.toThrow('Lezione non trovata.');
    expect(mockGetBytes).not.toHaveBeenCalled();
  });

  it('returns absent when poolStatus is absent', async () => {
    mockGetDoc.mockResolvedValueOnce(
      lessonSnap({ ...BASE_LESSON, poolStatus: 'absent', poolStorageRef: null }),
    );

    const result = await loadPool({
      programId: PROGRAM_ID,
      importId: IMPORT_ID,
      lessonId: LESSON_ID,
      db: fakeDb,
      storage: fakeStorage,
    });
    expect(result).toEqual({ status: 'absent' });
    expect(mockGetBytes).not.toHaveBeenCalled();
  });

  it('returns absent when Storage file is missing (storage/object-not-found)', async () => {
    mockGetDoc.mockResolvedValueOnce(lessonSnap(BASE_LESSON));
    const storageErr = Object.assign(new Error('not found'), { code: 'storage/object-not-found' });
    mockGetBytes.mockRejectedValueOnce(storageErr);

    const result = await loadPool({
      programId: PROGRAM_ID,
      importId: IMPORT_ID,
      lessonId: LESSON_ID,
      db: fakeDb,
      storage: fakeStorage,
    });
    expect(result).toEqual({ status: 'absent' });
  });

  it('rethrows unexpected Storage errors', async () => {
    mockGetDoc.mockResolvedValueOnce(lessonSnap(BASE_LESSON));
    mockGetBytes.mockRejectedValueOnce(new Error('network error'));

    await expect(
      loadPool({
        programId: PROGRAM_ID,
        importId: IMPORT_ID,
        lessonId: LESSON_ID,
        db: fakeDb,
        storage: fakeStorage,
      }),
    ).rejects.toThrow('Impossibile leggere il file pool da Storage.');
  });

  it('returns valid pool when file parses correctly', async () => {
    mockGetDoc.mockResolvedValueOnce(lessonSnap(BASE_LESSON));
    mockGetBytes.mockResolvedValueOnce(encode(VALID_POOL_MD));

    const result = await loadPool({
      programId: PROGRAM_ID,
      importId: IMPORT_ID,
      lessonId: LESSON_ID,
      db: fakeDb,
      storage: fakeStorage,
    });
    expect(result.status).toBe('valid');
    if (result.status === 'valid') {
      expect(result.pool.questions).toHaveLength(1);
      expect(result.pool.questions[0]!.id).toBe('q1');
    }
  });

  it('returns invalid with errors and rawContent when pool file fails validation', async () => {
    mockGetDoc.mockResolvedValueOnce(lessonSnap(BASE_LESSON));
    const badPool = `---\nschema: schoolforge-pool/v1\nquestions:\n  - id: q1\n    tipo: INVALID\n    difficolta: 2\n    peso: 2\n    testo: x\n    soluzione: x\n---`;
    mockGetBytes.mockResolvedValueOnce(encode(badPool));

    const result = await loadPool({
      programId: PROGRAM_ID,
      importId: IMPORT_ID,
      lessonId: LESSON_ID,
      db: fakeDb,
      storage: fakeStorage,
    });
    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') {
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.rawContent).toBe(badPool);
    }
  });
});

// ── savePool ──────────────────────────────────────────────────────────────────

describe('savePool', () => {
  const POOL = {
    schema: 'schoolforge-pool/v1' as const,
    questions: [
      {
        id: 'q1',
        tipo: 'aperta' as const,
        difficolta: 2 as const,
        peso: 2 as const,
        maxPoints: 4,
        testo: 'Spiega la differenza tra HTTP e HTTPS.',
        soluzione: 'HTTPS aggiunge TLS.',
      },
      {
        id: 'q2',
        tipo: 'chiusa_singola' as const,
        difficolta: 1 as const,
        peso: 1 as const,
        maxPoints: 1,
        testo: 'Quale porta usa HTTP di default?',
        opzioni: [
          { id: 'a', testo: '80' },
          { id: 'b', testo: '443' },
        ],
        soluzione: ['a'] as [string],
      },
    ],
  };

  it('throws when lesson does not exist, without touching Storage', async () => {
    mockGetDoc.mockResolvedValueOnce(missingSnap());

    await expect(
      savePool({
        programId: PROGRAM_ID,
        importId: IMPORT_ID,
        lessonId: LESSON_ID,
        pool: POOL,
        ownerUid: OWNER_UID,
        db: fakeDb,
        storage: fakeStorage,
      }),
    ).rejects.toThrow('Lezione non trovata.');
    expect(mockUploadBytes).not.toHaveBeenCalled();
  });

  it('writes serialized pool to Storage', async () => {
    mockGetDoc.mockResolvedValueOnce(lessonSnap(BASE_LESSON));
    mockGetDocs.mockResolvedValueOnce({ docs: [] });

    await savePool({
      programId: PROGRAM_ID,
      importId: IMPORT_ID,
      lessonId: LESSON_ID,
      pool: POOL,
      ownerUid: OWNER_UID,
      db: fakeDb,
      storage: fakeStorage,
    });

    expect(mockUploadBytes).toHaveBeenCalledOnce();
    const [refArg, bytesArg] = mockUploadBytes.mock.calls[0] as [
      { __storagePath: string },
      Uint8Array,
    ];
    expect(refArg.__storagePath).toBe(POOL_STORAGE_REF);
    const written = new TextDecoder().decode(bytesArg);
    expect(written).toContain('schema: schoolforge-pool/v1');
    expect(written).toContain('q1');
    expect(written).toContain('q2');
    expect(written).not.toContain('maxPoints');
  });

  it('creates questionIndex entries for all questions via a single writeBatch (no sequential setDoc)', async () => {
    mockGetDoc.mockResolvedValueOnce(lessonSnap(BASE_LESSON));
    mockGetDocs.mockResolvedValueOnce({ docs: [] });

    await savePool({
      programId: PROGRAM_ID,
      importId: IMPORT_ID,
      lessonId: LESSON_ID,
      pool: POOL,
      ownerUid: OWNER_UID,
      db: fakeDb,
      storage: fakeStorage,
    });

    expect(mockSetDoc).not.toHaveBeenCalled();
    expect(mockWriteBatch).toHaveBeenCalledTimes(1);
    expect(mockBatchCommit).toHaveBeenCalledTimes(1);
    // 2 questions -> 2 batch.set calls; the lesson doc is a separate batch.update.
    expect(mockBatchSet).toHaveBeenCalledTimes(2);
    expect(mockBatchUpdate).toHaveBeenCalledTimes(1);

    const [, entry1] = mockBatchSet.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(entry1['questionLocalId']).toBe('q1');
    expect(entry1['tipo']).toBe('aperta');
    expect(entry1['poolStorageRef']).toBe(POOL_STORAGE_REF);
    expect(typeof entry1['questionPreview']).toBe('string');
  });

  it('deletes stale questionIndex entries no longer in the pool, in the same batch', async () => {
    mockGetDoc.mockResolvedValueOnce(lessonSnap(BASE_LESSON));
    const staleDocRef = { __path: 'stale-entry', id: 'old-entry-id', ref: { __path: 'stale-ref' } };
    mockGetDocs.mockResolvedValueOnce({ docs: [staleDocRef] });

    await savePool({
      programId: PROGRAM_ID,
      importId: IMPORT_ID,
      lessonId: LESSON_ID,
      pool: POOL,
      ownerUid: OWNER_UID,
      db: fakeDb,
      storage: fakeStorage,
    });

    expect(mockBatchDelete).toHaveBeenCalledWith({ __path: 'stale-ref' });
    expect(mockBatchDelete).toHaveBeenCalledTimes(1);
    // Both valid questions are still upserted — the stale entry is never
    // one of them, so no valid question is ever accidentally deleted.
    expect(mockBatchSet).toHaveBeenCalledTimes(2); // 2 questions
    expect(mockBatchUpdate).toHaveBeenCalledTimes(1); // lesson update
    expect(mockWriteBatch).toHaveBeenCalledTimes(1);
    expect(mockBatchCommit).toHaveBeenCalledTimes(1);
  });

  it('updates lessonDoc poolStatus, questionCount, and poolStorageRef in the same batch (batch.update, not updateDoc)', async () => {
    mockGetDoc.mockResolvedValueOnce(lessonSnap(BASE_LESSON));
    mockGetDocs.mockResolvedValueOnce({ docs: [] });

    await savePool({
      programId: PROGRAM_ID,
      importId: IMPORT_ID,
      lessonId: LESSON_ID,
      pool: POOL,
      ownerUid: OWNER_UID,
      db: fakeDb,
      storage: fakeStorage,
    });

    expect(mockUpdateDoc).not.toHaveBeenCalled();
    expect(mockBatchUpdate).toHaveBeenCalledOnce();
    const [, patch] = mockBatchUpdate.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(patch['poolStatus']).toBe('valid');
    expect(patch['questionCount']).toBe(2);
    expect(patch['poolStorageRef']).toBe(POOL_STORAGE_REF);
  });

  it('chunks more than 400 mutations into multiple sequential batches, none exceeding 400', async () => {
    mockGetDoc.mockResolvedValueOnce(lessonSnap(BASE_LESSON));
    mockGetDocs.mockResolvedValueOnce({ docs: [] });

    // 450 questions + 1 final lesson update = 451 mutations -> ceil(451/400) = 2 chunks.
    const bigPool = {
      schema: 'schoolforge-pool/v1' as const,
      questions: Array.from({ length: 450 }, (_, i) => ({
        id: `q${i}`,
        tipo: 'aperta' as const,
        difficolta: 2 as const,
        peso: 1 as const,
        maxPoints: 2,
        testo: `Domanda ${i}`,
        soluzione: `Risposta ${i}`,
      })),
    };

    const commitOrder: number[] = [];
    mockBatchCommit.mockImplementation(() => {
      commitOrder.push(
        mockBatchSet.mock.calls.length +
          mockBatchDelete.mock.calls.length +
          mockBatchUpdate.mock.calls.length,
      );
      return Promise.resolve(undefined);
    });

    await savePool({
      programId: PROGRAM_ID,
      importId: IMPORT_ID,
      lessonId: LESSON_ID,
      pool: bigPool,
      ownerUid: OWNER_UID,
      db: fakeDb,
      storage: fakeStorage,
    });

    expect(mockWriteBatch).toHaveBeenCalledTimes(2);
    expect(mockBatchCommit).toHaveBeenCalledTimes(2);
    // Exactly 450 question upserts, none lost or duplicated, plus the
    // trailing lesson update as a separate batch.update call.
    expect(mockBatchSet).toHaveBeenCalledTimes(450);
    expect(mockBatchUpdate).toHaveBeenCalledTimes(1);
    // First commit happens after exactly 400 ops (the chunk boundary); the
    // batches are committed sequentially, one chunk fully applied before
    // the next chunk's mutations are even added to a batch.
    expect(commitOrder[0]).toBe(400);
    expect(commitOrder[1]).toBe(451);
  });

  it('does not touch Firestore when Storage upload fails', async () => {
    mockGetDoc.mockResolvedValueOnce(lessonSnap(BASE_LESSON));
    mockUploadBytes.mockRejectedValueOnce(new Error('network error'));

    await expect(
      savePool({
        programId: PROGRAM_ID,
        importId: IMPORT_ID,
        lessonId: LESSON_ID,
        pool: POOL,
        ownerUid: OWNER_UID,
        db: fakeDb,
        storage: fakeStorage,
      }),
    ).rejects.toThrow('Impossibile scrivere il file pool su Storage.');
    expect(mockSetDoc).not.toHaveBeenCalled();
    expect(mockUpdateDoc).not.toHaveBeenCalled();
    expect(mockWriteBatch).not.toHaveBeenCalled();
  });

  it('reports a distinct error when Firestore fails after Storage succeeds', async () => {
    mockGetDoc.mockResolvedValueOnce(lessonSnap(BASE_LESSON));
    mockGetDocs.mockRejectedValueOnce(new Error('firestore error'));

    await expect(
      savePool({
        programId: PROGRAM_ID,
        importId: IMPORT_ID,
        lessonId: LESSON_ID,
        pool: POOL,
        ownerUid: OWNER_UID,
        db: fakeDb,
        storage: fakeStorage,
      }),
    ).rejects.toThrow('Firestore');
    expect(mockUploadBytes).toHaveBeenCalledOnce();
  });

  it('computes poolStorageRef from storageRef when lesson has no poolStorageRef yet', async () => {
    const lessonWithoutPool: LessonDoc = {
      ...BASE_LESSON,
      poolStatus: 'absent',
      poolStorageRef: null,
    };
    mockGetDoc.mockResolvedValueOnce(lessonSnap(lessonWithoutPool));
    mockGetDocs.mockResolvedValueOnce({ docs: [] });

    await savePool({
      programId: PROGRAM_ID,
      importId: IMPORT_ID,
      lessonId: LESSON_ID,
      pool: POOL,
      ownerUid: OWNER_UID,
      db: fakeDb,
      storage: fakeStorage,
    });

    const [refArg] = mockUploadBytes.mock.calls[0] as [{ __storagePath: string }];
    expect(refArg.__storagePath).toBe(POOL_STORAGE_REF);
  });
});

// ── deletePool ────────────────────────────────────────────────────────────────

describe('deletePool', () => {
  it('throws when lesson does not exist', async () => {
    mockGetDoc.mockResolvedValueOnce(missingSnap());

    await expect(
      deletePool({
        programId: PROGRAM_ID,
        importId: IMPORT_ID,
        lessonId: LESSON_ID,
        ownerUid: OWNER_UID,
        db: fakeDb,
        storage: fakeStorage,
      }),
    ).rejects.toThrow('Lezione non trovata.');
    expect(mockDeleteObject).not.toHaveBeenCalled();
  });

  it('is a no-op when pool is already absent', async () => {
    mockGetDoc.mockResolvedValueOnce(
      lessonSnap({ ...BASE_LESSON, poolStatus: 'absent', poolStorageRef: null }),
    );

    await deletePool({
      programId: PROGRAM_ID,
      importId: IMPORT_ID,
      lessonId: LESSON_ID,
      ownerUid: OWNER_UID,
      db: fakeDb,
      storage: fakeStorage,
    });
    expect(mockDeleteObject).not.toHaveBeenCalled();
    expect(mockUpdateDoc).not.toHaveBeenCalled();
  });

  it('throws PoolDeleteBlockedError when a draft verification references the pool', async () => {
    mockGetDoc.mockResolvedValueOnce(lessonSnap(BASE_LESSON));

    const draftVerification: Partial<VerificationDoc> & { id: string } = {
      id: 'ver-1',
      status: 'draft',
      config: {
        title: 'Verifica bozza',
        classId: null,
        programId: PROGRAM_ID,
        importId: IMPORT_ID,
        questionRefs: [
          {
            questionIndexEntryId: 'entry-1',
            questionLocalId: 'q1',
            udaDir: 'uda-01-reti',
            lessonFilename: 'lezione-001-http.md',
            poolStorageRef: POOL_STORAGE_REF,
            tipo: 'aperta',
            difficolta: 2,
            peso: 2,
            maxPoints: 4,
          },
        ],
      },
    };
    mockGetDocs.mockResolvedValueOnce({
      docs: [{ id: 'ver-1', data: () => draftVerification }],
    });

    await expect(
      deletePool({
        programId: PROGRAM_ID,
        importId: IMPORT_ID,
        lessonId: LESSON_ID,
        ownerUid: OWNER_UID,
        db: fakeDb,
        storage: fakeStorage,
      }),
    ).rejects.toBeInstanceOf(PoolDeleteBlockedError);
    expect(mockDeleteObject).not.toHaveBeenCalled();
  });

  it('does not block deletion when only active/closed verifications reference the pool', async () => {
    mockGetDoc.mockResolvedValueOnce(lessonSnap(BASE_LESSON));

    const activeVerification: Partial<VerificationDoc> = {
      status: 'active',
      config: {
        title: 'Verifica attiva',
        classId: null,
        programId: PROGRAM_ID,
        importId: IMPORT_ID,
        questionRefs: [
          {
            questionIndexEntryId: 'entry-1',
            questionLocalId: 'q1',
            udaDir: 'uda-01-reti',
            lessonFilename: 'lezione-001-http.md',
            poolStorageRef: POOL_STORAGE_REF,
            tipo: 'aperta',
            difficolta: 2,
            peso: 2,
            maxPoints: 4,
          },
        ],
      },
    };
    mockGetDocs
      .mockResolvedValueOnce({ docs: [{ id: 'ver-1', data: () => activeVerification }] })
      .mockResolvedValueOnce({ docs: [] });

    await deletePool({
      programId: PROGRAM_ID,
      importId: IMPORT_ID,
      lessonId: LESSON_ID,
      ownerUid: OWNER_UID,
      db: fakeDb,
      storage: fakeStorage,
    });
    expect(mockDeleteObject).toHaveBeenCalledOnce();
  });

  it('deletes the Storage file', async () => {
    mockGetDoc.mockResolvedValueOnce(lessonSnap(BASE_LESSON));
    mockGetDocs.mockResolvedValueOnce({ docs: [] }).mockResolvedValueOnce({ docs: [] });

    await deletePool({
      programId: PROGRAM_ID,
      importId: IMPORT_ID,
      lessonId: LESSON_ID,
      ownerUid: OWNER_UID,
      db: fakeDb,
      storage: fakeStorage,
    });

    expect(mockDeleteObject).toHaveBeenCalledOnce();
    const [refArg] = mockDeleteObject.mock.calls[0] as [{ __storagePath: string }];
    expect(refArg.__storagePath).toBe(POOL_STORAGE_REF);
  });

  it('tolerates an already-missing Storage file (storage/object-not-found)', async () => {
    mockGetDoc.mockResolvedValueOnce(lessonSnap(BASE_LESSON));
    mockGetDocs.mockResolvedValueOnce({ docs: [] }).mockResolvedValueOnce({ docs: [] });
    const storageErr = Object.assign(new Error('not found'), { code: 'storage/object-not-found' });
    mockDeleteObject.mockRejectedValueOnce(storageErr);

    await expect(
      deletePool({
        programId: PROGRAM_ID,
        importId: IMPORT_ID,
        lessonId: LESSON_ID,
        ownerUid: OWNER_UID,
        db: fakeDb,
        storage: fakeStorage,
      }),
    ).resolves.toBeUndefined();
  });

  it('deletes all questionIndex entries for the lesson', async () => {
    mockGetDoc.mockResolvedValueOnce(lessonSnap(BASE_LESSON));
    const entryRef = { __path: 'entry-ref' };
    mockGetDocs
      .mockResolvedValueOnce({ docs: [] })
      .mockResolvedValueOnce({ docs: [{ ref: entryRef }] });

    await deletePool({
      programId: PROGRAM_ID,
      importId: IMPORT_ID,
      lessonId: LESSON_ID,
      ownerUid: OWNER_UID,
      db: fakeDb,
      storage: fakeStorage,
    });

    expect(mockBatchDelete).toHaveBeenCalledWith(entryRef);
    expect(mockBatchCommit).toHaveBeenCalled();
  });

  it('updates lesson to poolStatus absent, questionCount 0, poolStorageRef null', async () => {
    mockGetDoc.mockResolvedValueOnce(lessonSnap(BASE_LESSON));
    mockGetDocs.mockResolvedValueOnce({ docs: [] }).mockResolvedValueOnce({ docs: [] });

    await deletePool({
      programId: PROGRAM_ID,
      importId: IMPORT_ID,
      lessonId: LESSON_ID,
      ownerUid: OWNER_UID,
      db: fakeDb,
      storage: fakeStorage,
    });

    expect(mockUpdateDoc).toHaveBeenCalledOnce();
    const [, patch] = mockUpdateDoc.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(patch['poolStatus']).toBe('absent');
    expect(patch['questionCount']).toBe(0);
    expect(patch['poolStorageRef']).toBeNull();
  });

  it('reports a distinct error when Firestore cleanup fails after Storage deletion', async () => {
    mockGetDoc.mockResolvedValueOnce(lessonSnap(BASE_LESSON));
    mockGetDocs
      .mockResolvedValueOnce({ docs: [] })
      .mockRejectedValueOnce(new Error('firestore error'));

    await expect(
      deletePool({
        programId: PROGRAM_ID,
        importId: IMPORT_ID,
        lessonId: LESSON_ID,
        ownerUid: OWNER_UID,
        db: fakeDb,
        storage: fakeStorage,
      }),
    ).rejects.toThrow('Firestore');
    expect(mockDeleteObject).toHaveBeenCalledOnce();
  });
});
