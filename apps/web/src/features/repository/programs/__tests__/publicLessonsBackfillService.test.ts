import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetDocs = vi.fn();
const mockUpdateDoc = vi.fn();
const mockGetBytes = vi.fn();

vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, name: string) => ({ __collection: name }),
  doc: (_db: unknown, ...segments: string[]) => ({ __path: segments.join('/') }),
  query: (collRef: unknown, ...clauses: unknown[]) => ({ __collRef: collRef, __clauses: clauses }),
  where: (field: string, op: string, value: unknown) => ({ field, op, value }),
  getDocs: (...args: unknown[]) => mockGetDocs(...args),
  updateDoc: (...args: unknown[]) => mockUpdateDoc(...args),
}));

vi.mock('firebase/storage', () => ({
  ref: (_storage: unknown, path: string) => ({ __storagePath: path }),
  getBytes: (...args: unknown[]) => mockGetBytes(...args),
}));

import { backfillPublicLessonsContent } from '../publicLessonsBackfillService.js';
import type { Firestore } from 'firebase/firestore';
import type { FirebaseStorage } from 'firebase/storage';

const fakeDb = {} as Firestore;
const fakeStorage = {} as FirebaseStorage;
const OWNER_UID = 'owner-uid';

function encode(content: string): Uint8Array {
  return new TextEncoder().encode(content);
}

function docsFor(items: { id: string; data: Record<string, unknown> }[]) {
  return { docs: items.map((item) => ({ id: item.id, data: () => item.data })) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUpdateDoc.mockResolvedValue(undefined);
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
    mockGetBytes.mockResolvedValueOnce(encode('---\ntitolo: "L1"\n---\n\nCorpo.'));

    const summary = await backfillPublicLessonsContent(OWNER_UID, fakeDb, fakeStorage);

    expect(summary).toEqual({ analyzed: 1, migrated: 1, skipped: 0, failed: [] });
    expect(mockUpdateDoc).toHaveBeenCalledWith(
      { __path: 'publicLessons/l1' },
      { content: 'Corpo.' },
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
          },
        },
      ]),
    );

    const summary = await backfillPublicLessonsContent(OWNER_UID, fakeDb, fakeStorage);

    expect(summary).toEqual({ analyzed: 1, migrated: 0, skipped: 1, failed: [] });
    expect(mockGetBytes).not.toHaveBeenCalled();
    expect(mockUpdateDoc).not.toHaveBeenCalled();
  });

  it('records a failure with reason when the Storage read fails, and does not throw', async () => {
    mockGetDocs.mockResolvedValueOnce(
      docsFor([
        {
          id: 'l1',
          data: { ownerUid: OWNER_UID, contentPath: 'repository/x/l1.md', filename: 'l1.md' },
        },
      ]),
    );
    mockGetBytes.mockRejectedValueOnce(new Error('permission-denied'));

    const summary = await backfillPublicLessonsContent(OWNER_UID, fakeDb, fakeStorage);

    expect(summary.migrated).toBe(0);
    expect(summary.failed).toEqual([{ id: 'l1', reason: 'permission-denied' }]);
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
    mockGetBytes.mockResolvedValueOnce(encode('a'.repeat(800_000)));

    const summary = await backfillPublicLessonsContent(OWNER_UID, fakeDb, fakeStorage);

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
          },
        },
      ]),
    );

    const summary = await backfillPublicLessonsContent(OWNER_UID, fakeDb, fakeStorage);
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
          },
        },
      ]),
    );
    mockGetBytes.mockResolvedValueOnce(encode('Corpo l1.'));

    const summary = await backfillPublicLessonsContent(OWNER_UID, fakeDb, fakeStorage);

    expect(summary).toEqual({ analyzed: 2, migrated: 1, skipped: 1, failed: [] });
    expect(mockUpdateDoc).toHaveBeenCalledTimes(1);
  });
});
