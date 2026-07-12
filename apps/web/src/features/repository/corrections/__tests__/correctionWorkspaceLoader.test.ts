import { beforeEach, describe, expect, it, vi } from 'vitest';

type FakeDocEntry = { exists: boolean; data?: unknown };
type FakeRef = { __path: string };

let store: Record<string, FakeDocEntry> = {};

const mockGetDoc = vi.fn();
const mockDoc = vi.fn();
const mockOpenOrLoadCorrection = vi.fn();

vi.mock('firebase/firestore', () => ({
  doc: (...args: unknown[]) => mockDoc(...args),
  getDoc: (...args: unknown[]) => mockGetDoc(...args),
}));

vi.mock('../correctionsService.js', () => ({
  openOrLoadCorrection: (...args: unknown[]) => mockOpenOrLoadCorrection(...args),
}));

import type { Firestore } from 'firebase/firestore';
import { loadCorrectionWorkspace } from '../correctionWorkspaceLoader.js';

const fakeDb = {} as Firestore;
const OWNER_UID = 'owner-uid';
const VERIFICATION_ID = 'v1';
const STUDENT_UID = 'student-1';
const SUBMISSION_ID = `${VERIFICATION_ID}_${STUDENT_UID}`;

function seedDoc(path: string, entry: FakeDocEntry) {
  store[path] = entry;
}

beforeEach(() => {
  vi.clearAllMocks();
  store = {};
  mockDoc.mockImplementation((_db: unknown, ...rest: string[]) => ({
    __path: rest.join('/'),
  }));
  mockGetDoc.mockImplementation(async (ref: FakeRef) => {
    const entry = store[ref.__path];
    return { exists: () => !!entry?.exists, data: () => entry?.data };
  });
});

function seedSubmittedSubmission(overrides: Record<string, unknown> = {}) {
  seedDoc(`submissions/${SUBMISSION_ID}`, {
    exists: true,
    data: {
      submissionId: SUBMISSION_ID,
      verificationId: VERIFICATION_ID,
      studentUid: STUDENT_UID,
      ownerUid: OWNER_UID,
      status: 'submitted',
      answers: {},
      flagged: {},
      attentionEvents: [],
      deliveryCode: 'SF-2026-AAAA',
      verificationTitle: 'Verifica 1',
      className: 'Classe A',
      startedAt: { seconds: 1, nanoseconds: 0 },
      lastSavedAt: { seconds: 2, nanoseconds: 0 },
      submittedAt: { seconds: 3, nanoseconds: 0 },
      ...overrides,
    },
  });
}

function seedVerification() {
  seedDoc(`verifications/${VERIFICATION_ID}`, {
    exists: true,
    data: {
      ownerUid: OWNER_UID,
      status: 'active',
      config: {
        title: 'Verifica 1',
        classId: 'a',
        programId: 'p1',
        importId: 'i1',
        questionRefs: [],
      },
      teacherSnapshot: {
        title: 'Verifica 1',
        classId: 'a',
        className: 'Classe A',
        programId: 'p1',
        importId: 'i1',
        questionRefs: [],
        questions: [{ order: 0, tipo: 'aperta', maxPoints: 10, testo: 'D1', soluzione: 'sol' }],
        activatedAt: { seconds: 1, nanoseconds: 0 },
      },
      activatedAt: { seconds: 1, nanoseconds: 0 },
      closedAt: null,
    },
  });
}

describe('loadCorrectionWorkspace', () => {
  it('assembles submission + verification + correction + null correctionReturn', async () => {
    seedSubmittedSubmission();
    seedVerification();
    mockOpenOrLoadCorrection.mockResolvedValue({ status: 'in_progress', evaluations: {} });

    const result = await loadCorrectionWorkspace(SUBMISSION_ID, OWNER_UID, fakeDb);

    expect(result.submission.status).toBe('submitted');
    expect(result.verification.teacherSnapshot?.title).toBe('Verifica 1');
    expect(result.correction.status).toBe('in_progress');
    expect(result.correctionReturn).toBeNull();
    expect(mockOpenOrLoadCorrection).toHaveBeenCalledWith(SUBMISSION_ID, OWNER_UID, fakeDb);
  });

  it('includes the correctionReturn when one already exists', async () => {
    seedSubmittedSubmission();
    seedVerification();
    seedDoc(`correctionReturns/${SUBMISSION_ID}`, {
      exists: true,
      data: { visibleToStudent: true, solutionsVisible: false },
    });
    mockOpenOrLoadCorrection.mockResolvedValue({ status: 'returned', evaluations: {} });

    const result = await loadCorrectionWorkspace(SUBMISSION_ID, OWNER_UID, fakeDb);

    expect(result.correctionReturn).toEqual({ visibleToStudent: true, solutionsVisible: false });
  });

  it('rejects when the submission does not exist', async () => {
    seedVerification();
    await expect(loadCorrectionWorkspace(SUBMISSION_ID, OWNER_UID, fakeDb)).rejects.toThrow(
      /consegna non trovata/i,
    );
    expect(mockOpenOrLoadCorrection).not.toHaveBeenCalled();
  });

  it('rejects when the submission is still a draft', async () => {
    seedSubmittedSubmission({ status: 'draft' });
    seedVerification();
    await expect(loadCorrectionWorkspace(SUBMISSION_ID, OWNER_UID, fakeDb)).rejects.toThrow(
      /non è ancora stata inviata/i,
    );
  });

  it("rejects when the submission belongs to a different owner's verification", async () => {
    seedSubmittedSubmission({ ownerUid: 'someone-else' });
    seedVerification();
    await expect(loadCorrectionWorkspace(SUBMISSION_ID, OWNER_UID, fakeDb)).rejects.toThrow(
      /non appartiene a questo docente/i,
    );
  });

  it('rejects when the verification does not exist', async () => {
    seedSubmittedSubmission();
    await expect(loadCorrectionWorkspace(SUBMISSION_ID, OWNER_UID, fakeDb)).rejects.toThrow(
      /verifica non trovata/i,
    );
  });
});
