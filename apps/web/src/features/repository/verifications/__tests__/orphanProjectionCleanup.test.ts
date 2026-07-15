import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetDoc = vi.fn();
const mockGetDocs = vi.fn();
const mockSetDoc = vi.fn();
const mockDoc = vi.fn((...path: unknown[]) => ({ path }));
const mockCollectionGroup = vi.fn((..._args: unknown[]) => ({ kind: 'publishedProjection' }));
const mockWhere = vi.fn((...args: unknown[]) => ({ where: args }));
const mockQuery = vi.fn((...args: unknown[]) => ({ query: args }));
const mockDeleteRefs = vi.fn();

vi.mock('firebase/firestore', () => ({
  collectionGroup: (...args: unknown[]) => mockCollectionGroup(...args),
  doc: (...args: unknown[]) => mockDoc(...args),
  getDoc: (...args: unknown[]) => mockGetDoc(...args),
  getDocs: (...args: unknown[]) => mockGetDocs(...args),
  query: (...args: unknown[]) => mockQuery(...args),
  serverTimestamp: () => ({ _type: 'serverTimestamp' }),
  setDoc: (...args: unknown[]) => mockSetDoc(...args),
  where: (...args: unknown[]) => mockWhere(...args),
}));

vi.mock('../../firestoreChunks.js', () => ({
  deleteDocRefsInBatches: (...args: unknown[]) => mockDeleteRefs(...args),
}));

import { cleanupOrphanVerificationProjections } from '../orphanProjectionCleanup.js';
import type { Firestore } from 'firebase/firestore';

const db = {} as Firestore;

function projectionRef(verificationId: string) {
  return { parent: { parent: { id: verificationId } } };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSetDoc.mockResolvedValue(undefined);
  mockDeleteRefs.mockResolvedValue(undefined);
});

describe('cleanupOrphanVerificationProjections', () => {
  it('does not scan again after the private migration marker is complete', async () => {
    mockGetDoc.mockResolvedValue({ data: () => ({ cleanupVersion: 1 }) });

    await expect(cleanupOrphanVerificationProjections('owner', new Set(['v1']), db)).resolves.toBe(
      0,
    );

    expect(mockGetDocs).not.toHaveBeenCalled();
    expect(mockDeleteRefs).not.toHaveBeenCalled();
    expect(mockSetDoc).not.toHaveBeenCalled();
  });

  it('deletes only orphan projections, then writes the one-time marker', async () => {
    const valid = projectionRef('v1');
    const orphan = projectionRef('deleted-v2');
    mockGetDoc.mockResolvedValue({ data: () => undefined });
    mockGetDocs.mockResolvedValue({ docs: [{ ref: valid }, { ref: orphan }] });

    await expect(cleanupOrphanVerificationProjections('owner', new Set(['v1']), db)).resolves.toBe(
      1,
    );

    expect(mockWhere).toHaveBeenCalledWith('ownerUid', '==', 'owner');
    expect(mockDeleteRefs).toHaveBeenCalledWith(db, [orphan]);
    expect(mockSetDoc).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ cleanupVersion: 1 }),
    );
  });

  it('does not mark the migration complete when cleanup fails', async () => {
    const orphan = projectionRef('deleted-v2');
    mockGetDoc.mockResolvedValue({ data: () => undefined });
    mockGetDocs.mockResolvedValue({ docs: [{ ref: orphan }] });
    mockDeleteRefs.mockRejectedValue(new Error('write failed'));

    await expect(cleanupOrphanVerificationProjections('owner', new Set(), db)).rejects.toThrow(
      'write failed',
    );
    expect(mockSetDoc).not.toHaveBeenCalled();
  });
});
