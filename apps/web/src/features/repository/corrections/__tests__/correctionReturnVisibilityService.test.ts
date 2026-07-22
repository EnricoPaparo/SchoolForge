import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetDocs = vi.fn();
const mockCollection = vi.fn((...args: unknown[]) => ({ collectionArgs: args }));
const mockWhere = vi.fn((...args: unknown[]) => ({ whereArgs: args }));
const mockQuery = vi.fn((...args: unknown[]) => ({ queryArgs: args }));

vi.mock('firebase/firestore', () => ({
  collection: (...args: unknown[]) => mockCollection(...args),
  where: (...args: unknown[]) => mockWhere(...args),
  query: (...args: unknown[]) => mockQuery(...args),
  getDocs: (...args: unknown[]) => mockGetDocs(...args),
}));

import type { Firestore } from 'firebase/firestore';
import { loadCorrectionReturnVisibilityBySubmission } from '../correctionReturnVisibilityService.js';

const db = {} as Firestore;

function snapshot(entries: { id: string; data: Record<string, unknown> }[]) {
  return { docs: entries.map(({ id, data }) => ({ id, data: () => data })) };
}

function valid(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    data: {
      correctionId: id,
      ownerUid: 'owner',
      verificationId: 'verification',
      studentUid: id.split('_').at(-1),
      visibleToStudent: true,
      solutionsVisible: false,
      ...overrides,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('loadCorrectionReturnVisibilityBySubmission', () => {
  it('uses one query scoped to the verification and maps valid projections', async () => {
    mockGetDocs.mockResolvedValueOnce(snapshot([valid('verification_student')]));
    const result = await loadCorrectionReturnVisibilityBySubmission('verification', 'owner', db);

    expect(mockGetDocs).toHaveBeenCalledTimes(1);
    expect(mockWhere).toHaveBeenCalledWith('verificationId', '==', 'verification');
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(result.get('verification_student')).toEqual({
      submissionId: 'verification_student',
      studentUid: 'student',
      visibleToStudent: true,
      solutionsVisible: false,
    });
  });

  it('ignores other-owner, other-verification and malformed documents fail-closed', async () => {
    mockGetDocs.mockResolvedValueOnce(
      snapshot([
        valid('verification_owner', { ownerUid: 'other' }),
        valid('verification_other', { verificationId: 'other' }),
        valid('verification_wrong-id', { correctionId: 'different' }),
        valid('verification_missing-student', { studentUid: '' }),
        valid('verification_wrong-student', { studentUid: 'different' }),
        valid('verification_bad-flags', { visibleToStudent: 'yes' }),
        valid('verification_ok', { studentUid: 'ok', solutionsVisible: true }),
      ]),
    );
    const result = await loadCorrectionReturnVisibilityBySubmission('verification', 'owner', db);
    expect([...result.keys()]).toEqual(['verification_ok']);
  });

  it('propagates query errors without inventing values', async () => {
    mockGetDocs.mockRejectedValueOnce(new Error('permission-denied'));
    await expect(
      loadCorrectionReturnVisibilityBySubmission('verification', 'owner', db),
    ).rejects.toThrow('permission-denied');
  });
});
