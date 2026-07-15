import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetDocs = vi.fn();
const mockGetDoc = vi.fn();
const mockUpdateDoc = vi.fn();
const mockSetDoc = vi.fn();
const mockReadTexts = vi.fn();

vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, name: string) => ({ __collection: name }),
  doc: (_db: unknown, ...segments: string[]) => ({ __path: segments.join('/') }),
  query: (collRef: unknown, ...clauses: unknown[]) => ({ __collRef: collRef, __clauses: clauses }),
  where: (field: string, op: string, value: unknown) => ({ field, op, value }),
  getDocs: (...args: unknown[]) => mockGetDocs(...args),
  getDoc: (...args: unknown[]) => mockGetDoc(...args),
  updateDoc: (...args: unknown[]) => mockUpdateDoc(...args),
  setDoc: (...args: unknown[]) => mockSetDoc(...args),
  serverTimestamp: () => ({ __type: 'serverTimestamp' }),
}));

vi.mock('../../gateway/repositoryGatewayClient.js', () => ({
  readTexts: (...args: unknown[]) => mockReadTexts(...args),
}));

import {
  backfillPublicLessonsContent,
  isPublicLessonsMigrationComplete,
} from '../publicLessonsBackfillService.js';
import type { Firestore } from 'firebase/firestore';

const fakeDb = {} as Firestore;
const OWNER_UID = 'owner-uid';

function docsFor(items: { id: string; data: Record<string, unknown> }[]) {
  return {
    docs: items.map((item) => ({
      id: item.id,
      data: () => ({ programId: 'program-1', importId: 'import-1', ...item.data }),
    })),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUpdateDoc.mockResolvedValue(undefined);
  mockSetDoc.mockResolvedValue(undefined);
  mockGetDoc.mockResolvedValue({ exists: () => true, data: () => ({ completed: false }) });
  mockReadTexts.mockImplementation(async (paths: string[]) =>
    paths.map((path) => ({ ok: true, path, content: 'Corpo.' })),
  );
});

describe('backfillPublicLessonsContent', () => {
  it('migrates a legacy document with no content field', async () => {
    mockGetDocs.mockResolvedValueOnce(
      docsFor([
        {
          id: 'l1',
          data: { ownerUid: OWNER_UID, contentPath: 'repository/x/l1.md', filename: 'l1.md' },
        },
      ]),
    );
    mockReadTexts.mockImplementationOnce(async (paths: string[]) =>
      paths.map((path) => ({
        ok: true,
        path,
        content: '---\ntitolo: "L1"\n---\n\nCorpo.',
      })),
    );

    const summary = await backfillPublicLessonsContent(OWNER_UID, fakeDb);

    expect(summary).toEqual({ analyzed: 1, migrated: 1, skipped: 0, failed: [] });
    expect(mockUpdateDoc).toHaveBeenCalledWith(
      { __path: 'publicLessons/l1' },
      { content: 'Corpo.', completed: false },
    );
    expect(mockSetDoc).toHaveBeenCalledWith(
      { __path: 'settings/publicLessonsMigration' },
      expect.objectContaining({ publicLessonsContentVersion: 2 }),
    );
  });

  it('skips a document that already has valid content, without reading Storage', async () => {
    mockGetDocs.mockResolvedValueOnce(
      docsFor([
        {
          id: 'l1',
          data: {
            ownerUid: OWNER_UID,
            contentPath: 'repository/x/l1.md',
            filename: 'l1.md',
            content: 'Già migrato.',
            completed: false,
          },
        },
      ]),
    );

    const summary = await backfillPublicLessonsContent(OWNER_UID, fakeDb);

    expect(summary).toEqual({ analyzed: 1, migrated: 0, skipped: 1, failed: [] });
    expect(mockReadTexts).not.toHaveBeenCalled();
    expect(mockUpdateDoc).not.toHaveBeenCalled();
  });

  it('records a failure with reason when batch-read fails, and does not throw', async () => {
    mockGetDocs.mockResolvedValueOnce(
      docsFor([
        {
          id: 'l1',
          data: { ownerUid: OWNER_UID, contentPath: 'repository/x/l1.md', filename: 'l1.md' },
        },
      ]),
    );
    mockReadTexts.mockRejectedValueOnce(new Error('permission-denied'));

    const summary = await backfillPublicLessonsContent(OWNER_UID, fakeDb);

    expect(summary.migrated).toBe(0);
    expect(summary.failed).toEqual([{ id: 'l1', reason: 'permission-denied' }]);
    expect(mockSetDoc).not.toHaveBeenCalled();
  });

  it('records a failure when the fetched content exceeds the size limit', async () => {
    mockGetDocs.mockResolvedValueOnce(
      docsFor([
        {
          id: 'l1',
          data: { ownerUid: OWNER_UID, contentPath: 'repository/x/l1.md', filename: 'l1.md' },
        },
      ]),
    );
    mockReadTexts.mockImplementationOnce(async (paths: string[]) =>
      paths.map((path) => ({ ok: true, path, content: 'a'.repeat(800_000) })),
    );

    const summary = await backfillPublicLessonsContent(OWNER_UID, fakeDb);

    expect(summary.migrated).toBe(0);
    expect(summary.failed[0]?.id).toBe('l1');
    expect(summary.failed[0]?.reason).toMatch(/supera il limite/);
  });

  it('is idempotent: rerunning after a successful migration skips the now-migrated document', async () => {
    mockGetDocs.mockResolvedValueOnce(
      docsFor([
        {
          id: 'l1',
          data: {
            ownerUid: OWNER_UID,
            contentPath: 'repository/x/l1.md',
            filename: 'l1.md',
            content: 'Corpo.',
            completed: false,
          },
        },
      ]),
    );

    const summary = await backfillPublicLessonsContent(OWNER_UID, fakeDb);
    expect(summary).toEqual({ analyzed: 1, migrated: 0, skipped: 1, failed: [] });
  });

  it('processes multiple legacy documents and only migrates the ones missing content', async () => {
    mockGetDocs.mockResolvedValueOnce(
      docsFor([
        {
          id: 'l1',
          data: { ownerUid: OWNER_UID, contentPath: 'repository/x/l1.md', filename: 'l1.md' },
        },
        {
          id: 'l2',
          data: {
            ownerUid: OWNER_UID,
            contentPath: 'repository/x/l2.md',
            filename: 'l2.md',
            content: 'Già ok.',
            completed: false,
          },
        },
      ]),
    );
    mockReadTexts.mockImplementationOnce(async (paths: string[]) =>
      paths.map((path) => ({ ok: true, path, content: 'Corpo l1.' })),
    );

    const summary = await backfillPublicLessonsContent(OWNER_UID, fakeDb);

    expect(summary).toEqual({ analyzed: 2, migrated: 1, skipped: 1, failed: [] });
    expect(mockUpdateDoc).toHaveBeenCalledTimes(1);
  });

  it('backfills completion from the matching technical lesson without reading Storage', async () => {
    mockGetDocs.mockResolvedValueOnce(
      docsFor([
        {
          id: 'import-1_l1',
          data: {
            ownerUid: OWNER_UID,
            contentPath: 'repository/x/l1.md',
            filename: 'l1.md',
            content: 'Già migrato.',
          },
        },
      ]),
    );
    mockGetDoc.mockResolvedValueOnce({ exists: () => true, data: () => ({ completed: true }) });

    const summary = await backfillPublicLessonsContent(OWNER_UID, fakeDb);

    expect(summary).toEqual({ analyzed: 1, migrated: 1, skipped: 0, failed: [] });
    expect(mockReadTexts).not.toHaveBeenCalled();
    expect(mockGetDoc).toHaveBeenCalledWith({
      __path: 'programs/program-1/imports/import-1/lessons/l1',
    });
    expect(mockUpdateDoc).toHaveBeenCalledWith(
      { __path: 'publicLessons/import-1_l1' },
      { completed: true },
    );
  });
});

describe('isPublicLessonsMigrationComplete', () => {
  it('returns false when the marker document does not exist', async () => {
    mockGetDoc.mockResolvedValueOnce({ exists: () => false });

    expect(await isPublicLessonsMigrationComplete(fakeDb)).toBe(false);
  });

  it('returns true when the marker carries the current version', async () => {
    mockGetDoc.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ publicLessonsContentVersion: 2 }),
    });

    expect(await isPublicLessonsMigrationComplete(fakeDb)).toBe(true);
  });

  it('returns false for an unrecognized version value', async () => {
    mockGetDoc.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ publicLessonsContentVersion: 1 }),
    });

    expect(await isPublicLessonsMigrationComplete(fakeDb)).toBe(false);
  });
});
