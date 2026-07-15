import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Firestore mock ──────────────────────────────────────────────────────────
const mockGetDoc = vi.fn();
const mockGetDocs = vi.fn();
const mockUpdateDoc = vi.fn();
const mockWhere = vi.fn((...args: unknown[]) => ({ __where: args }));

interface RecordedBatch {
  deletes: unknown[];
  committed: boolean;
}
let batches: RecordedBatch[] = [];

function makeBatch(): unknown {
  const rec: RecordedBatch = { deletes: [], committed: false };
  batches.push(rec);
  return {
    set: () => {},
    update: () => {},
    delete: (ref: unknown) => rec.deletes.push(ref),
    commit: async () => {
      rec.committed = true;
    },
  };
}

vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...segments: string[]) => ({ __path: segments.join('/') }),
  doc: (_db: unknown, ...segments: string[]) => ({ __path: segments.join('/') }),
  getDoc: (...args: unknown[]) => mockGetDoc(...args),
  getDocs: (...args: unknown[]) => mockGetDocs(...args),
  updateDoc: (...args: unknown[]) => mockUpdateDoc(...args),
  query: (collRef: unknown, ...rest: unknown[]) => ({ collRef, rest }),
  where: (...args: unknown[]) => mockWhere(...args),
  writeBatch: () => makeBatch(),
}));

import {
  cleanupStalePublicLessons,
  retryStalePublicLessonsCleanup,
} from '../stalePublicLessonsCleanup.js';
import type { Firestore } from 'firebase/firestore';

const fakeDb = {} as Firestore;
const PROGRAM_ID = 'prog-1';
const OLD_IMPORT_ID = 'old-imp';

function publicLessonDocs(n: number) {
  return {
    docs: Array.from({ length: n }, (_, i) => ({
      ref: { __path: `publicLessons/${OLD_IMPORT_ID}_l${i}` },
    })),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  batches = [];
  mockGetDocs.mockResolvedValue({ docs: [] });
  mockUpdateDoc.mockResolvedValue(undefined);
  mockGetDoc.mockResolvedValue({ exists: () => true });
});

describe('cleanupStalePublicLessons', () => {
  it('queries publicLessons filtered by programId AND importId', async () => {
    await cleanupStalePublicLessons({
      programId: PROGRAM_ID,
      oldImportId: OLD_IMPORT_ID,
      db: fakeDb,
    });
    expect(mockWhere).toHaveBeenCalledWith('programId', '==', PROGRAM_ID);
    expect(mockWhere).toHaveBeenCalledWith('importId', '==', OLD_IMPORT_ID);
  });

  it('is safe on zero matching documents (deletes nothing)', async () => {
    mockGetDocs.mockResolvedValueOnce(publicLessonDocs(0));
    await cleanupStalePublicLessons({
      programId: PROGRAM_ID,
      oldImportId: OLD_IMPORT_ID,
      db: fakeDb,
    });
    expect(batches).toHaveLength(0);
  });

  it('deletes only the old import publicLessons, chunked over 400', async () => {
    mockGetDocs.mockResolvedValueOnce(publicLessonDocs(401));
    await cleanupStalePublicLessons({
      programId: PROGRAM_ID,
      oldImportId: OLD_IMPORT_ID,
      db: fakeDb,
    });
    expect(batches).toHaveLength(2);
    const deleted = batches.flatMap((b) => b.deletes);
    expect(deleted).toHaveLength(401);
    // Never touches UDA/lessons/questionIndex/Storage: no updateDoc except the
    // status marker (which targets the import doc, not technical sub-docs).
    expect(mockUpdateDoc).toHaveBeenCalledTimes(1);
    expect(mockUpdateDoc).toHaveBeenCalledWith(
      { __path: `programs/${PROGRAM_ID}/imports/${OLD_IMPORT_ID}` },
      { status: 'superseded' },
    );
  });

  it('marks the old import superseded only when it still exists', async () => {
    mockGetDoc.mockResolvedValueOnce({ exists: () => false });
    await cleanupStalePublicLessons({
      programId: PROGRAM_ID,
      oldImportId: OLD_IMPORT_ID,
      db: fakeDb,
    });
    expect(mockUpdateDoc).not.toHaveBeenCalled();
  });

  it('is idempotent — a second run with no docs left is a no-op delete', async () => {
    mockGetDocs.mockResolvedValue({ docs: [] });
    await cleanupStalePublicLessons({
      programId: PROGRAM_ID,
      oldImportId: OLD_IMPORT_ID,
      db: fakeDb,
    });
    await cleanupStalePublicLessons({
      programId: PROGRAM_ID,
      oldImportId: OLD_IMPORT_ID,
      db: fakeDb,
    });
    expect(batches).toHaveLength(0);
  });
});

describe('retryStalePublicLessonsCleanup', () => {
  it('delegates to the same idempotent cleanup', async () => {
    mockGetDocs.mockResolvedValueOnce(publicLessonDocs(2));
    await retryStalePublicLessonsCleanup({
      programId: PROGRAM_ID,
      oldImportId: OLD_IMPORT_ID,
      db: fakeDb,
    });
    expect(batches.flatMap((b) => b.deletes)).toHaveLength(2);
  });
});
