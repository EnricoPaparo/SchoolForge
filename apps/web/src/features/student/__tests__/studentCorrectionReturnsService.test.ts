import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetDocs = vi.fn();
const mockGetDoc = vi.fn();

vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, name: string) => ({ __collection: name }),
  doc: (_db: unknown, name: string, id: string) => ({ __collection: name, __id: id }),
  query: (collRef: unknown, ...clauses: unknown[]) => ({ __collRef: collRef, __clauses: clauses }),
  where: (field: string, op: string, value: unknown) => ({ __kind: 'where', field, op, value }),
  getDocs: (...args: unknown[]) => mockGetDocs(...args),
  getDoc: (...args: unknown[]) => mockGetDoc(...args),
}));

import {
  loadStudentCorrectionReturn,
  loadStudentCorrectionReturns,
} from '../studentCorrectionReturnsService.js';
import type { Firestore } from 'firebase/firestore';

const fakeDb = {} as Firestore;
const STUDENT_UID = 'student-uid';

function fakeReturnDoc(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    data: () => ({
      correctionId: id,
      verificationId: 'v1',
      studentUid: STUDENT_UID,
      ownerUid: 'owner-uid',
      verificationTitle: 'Verifica 1',
      className: 'Classe A',
      submittedAt: { seconds: 100 },
      returnedAt: { seconds: 200 },
      questions: [],
      generalFeedback: null,
      totalPoints: 8,
      maxPoints: 10,
      percentage: 80,
      visibleToStudent: true,
      solutionsVisible: false,
      updatedAt: { seconds: 200 },
      ...overrides,
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('loadStudentCorrectionReturns — query shape', () => {
  it('queries correctionReturns filtered by studentUid == uid AND visibleToStudent == true, with no orderBy on the query itself', async () => {
    mockGetDocs.mockResolvedValue({ docs: [] });

    await loadStudentCorrectionReturns(STUDENT_UID, fakeDb);

    expect(mockGetDocs).toHaveBeenCalledOnce();
    const [queryArg] = mockGetDocs.mock.calls[0] as [
      { __collRef: { __collection: string }; __clauses: Record<string, unknown>[] },
    ];
    expect(queryArg.__collRef.__collection).toBe('correctionReturns');
    expect(queryArg.__clauses).toEqual([
      { __kind: 'where', field: 'studentUid', op: '==', value: STUDENT_UID },
      { __kind: 'where', field: 'visibleToStudent', op: '==', value: true },
    ]);
  });

  it('performs a single getDocs call regardless of result size — no per-verification N+1 reads', async () => {
    mockGetDocs.mockResolvedValue({
      docs: [fakeReturnDoc('v1_student-uid'), fakeReturnDoc('v2_student-uid')],
    });

    await loadStudentCorrectionReturns(STUDENT_UID, fakeDb);

    expect(mockGetDocs).toHaveBeenCalledOnce();
    expect(mockGetDoc).not.toHaveBeenCalled();
  });
});

describe('loadStudentCorrectionReturns — normalization and ordering', () => {
  it('normalizes each doc into a StudentCorrectionReturnItem with its doc id as submissionId', async () => {
    mockGetDocs.mockResolvedValue({ docs: [fakeReturnDoc('v1_student-uid')] });

    const result = await loadStudentCorrectionReturns(STUDENT_UID, fakeDb);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      submissionId: 'v1_student-uid',
      verificationTitle: 'Verifica 1',
      totalPoints: 8,
      maxPoints: 10,
    });
  });

  it('sorts by returnedAt descending (defensive re-sort, mirrors the query order)', async () => {
    mockGetDocs.mockResolvedValue({
      docs: [
        fakeReturnDoc('older', { returnedAt: { seconds: 100 } }),
        fakeReturnDoc('newer', { returnedAt: { seconds: 500 } }),
      ],
    });

    const result = await loadStudentCorrectionReturns(STUDENT_UID, fakeDb);

    expect(result.map((r) => r.submissionId)).toEqual(['newer', 'older']);
  });

  it('keeps a legacy/missing returnedAt in the result set (never excluded) and sorts it last', async () => {
    mockGetDocs.mockResolvedValue({
      docs: [
        fakeReturnDoc('legacy', { returnedAt: undefined }),
        fakeReturnDoc('normal', { returnedAt: { seconds: 500 } }),
      ],
    });

    const result = await loadStudentCorrectionReturns(STUDENT_UID, fakeDb);

    // Both documents are present — the query itself has no orderBy that
    // could silently drop "legacy" from the results; only the JS-side sort
    // pushes it last.
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.submissionId)).toEqual(['normal', 'legacy']);
  });

  it('sorts a malformed returnedAt (wrong shape, not a Timestamp-like object) last too', async () => {
    mockGetDocs.mockResolvedValue({
      docs: [
        fakeReturnDoc('malformed', { returnedAt: 'not-a-timestamp' }),
        fakeReturnDoc('normal', { returnedAt: { seconds: 500 } }),
      ],
    });

    const result = await loadStudentCorrectionReturns(STUDENT_UID, fakeDb);

    expect(result.map((r) => r.submissionId)).toEqual(['normal', 'malformed']);
  });
});

describe('loadStudentCorrectionReturn — single-doc manual reload', () => {
  it('reads the single doc by submissionId and returns it normalized', async () => {
    mockGetDoc.mockResolvedValue({
      exists: () => true,
      id: 'v1_student-uid',
      data: fakeReturnDoc('v1_student-uid').data,
    });

    const result = await loadStudentCorrectionReturn('v1_student-uid', fakeDb);

    expect(result).toMatchObject({
      submissionId: 'v1_student-uid',
      verificationTitle: 'Verifica 1',
    });
    expect(mockGetDocs).not.toHaveBeenCalled();
  });

  it('returns null when the document does not exist', async () => {
    mockGetDoc.mockResolvedValue({ exists: () => false });

    const result = await loadStudentCorrectionReturn('missing', fakeDb);

    expect(result).toBeNull();
  });

  it('returns null (never throws) when the read is denied — e.g. the docente just hid the correction', async () => {
    mockGetDoc.mockRejectedValue(Object.assign(new Error('denied'), { code: 'permission-denied' }));

    const result = await loadStudentCorrectionReturn('v1_student-uid', fakeDb);

    expect(result).toBeNull();
  });

  it('rethrows a transient/network error instead of masking it as "hidden"', async () => {
    mockGetDoc.mockRejectedValue(Object.assign(new Error('offline'), { code: 'unavailable' }));

    await expect(loadStudentCorrectionReturn('v1_student-uid', fakeDb)).rejects.toThrow('offline');
  });

  it('rethrows an error with no code at all', async () => {
    mockGetDoc.mockRejectedValue(new Error('boom'));

    await expect(loadStudentCorrectionReturn('v1_student-uid', fakeDb)).rejects.toThrow('boom');
  });
});
