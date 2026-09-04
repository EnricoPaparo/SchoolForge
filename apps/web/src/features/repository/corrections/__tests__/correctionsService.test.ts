import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Firebase mocks ───────────────────────────────────────────────────────────

type FakeDocEntry = { exists: boolean; data?: unknown };
type FakeRef = { __path: string };
type FakeCollectionRef = { __collection: string };

let store: Record<string, FakeDocEntry> = {};
let autoIdCounter = 0;

const mockGetDoc = vi.fn();
const mockSetDoc = vi.fn();
const mockUpdateDoc = vi.fn();
const mockDoc = vi.fn();
const mockCollection = vi.fn();
const mockServerTimestamp = vi.fn(() => ({ __serverTimestamp: true }));
const mockRunTransaction = vi.fn();
const mockBatchUpdate = vi.fn();
const mockBatchSet = vi.fn();
const mockBatchCommit = vi.fn();
const mockWriteBatch = vi.fn((..._args: unknown[]) => ({
  update: mockBatchUpdate,
  set: mockBatchSet,
  commit: mockBatchCommit,
}));

vi.mock('firebase/firestore', () => ({
  doc: (...args: unknown[]) => mockDoc(...args),
  collection: (...args: unknown[]) => mockCollection(...args),
  getDoc: (...args: unknown[]) => mockGetDoc(...args),
  setDoc: (...args: unknown[]) => mockSetDoc(...args),
  updateDoc: (...args: unknown[]) => mockUpdateDoc(...args),
  writeBatch: (...args: unknown[]) => mockWriteBatch(...args),
  runTransaction: (...args: unknown[]) => mockRunTransaction(...args),
  serverTimestamp: () => mockServerTimestamp(),
}));

import type { Firestore } from 'firebase/firestore';
import { runBatchCorrectionAction } from '../batchCorrectionActions.js';
import type { CorrectionDoc, CorrectionReturnDoc } from '../../../../types/firestore.js';
import {
  clearCorrection,
  completeCorrection,
  openOrLoadCorrection,
  reopenCorrection,
  returnCorrection,
  saveCorrection,
  setReturnVisibleToStudent,
  setSolutionsVisible,
} from '../correctionsService.js';

const fakeDb = {} as Firestore;
const VERIFICATION_ID = 'v1';
const STUDENT_UID = 'student-1';
const OWNER_UID = 'owner-1';
const SUBMISSION_ID = `${VERIFICATION_ID}_${STUDENT_UID}`;

function seedDoc(path: string, entry: FakeDocEntry) {
  store[path] = entry;
}

beforeEach(() => {
  vi.clearAllMocks();
  store = {};
  autoIdCounter = 0;

  mockDoc.mockImplementation((first: unknown, ...rest: string[]) => {
    if (first && typeof first === 'object' && '__collection' in (first as FakeCollectionRef)) {
      const collectionName = (first as FakeCollectionRef).__collection;
      return { __path: `${collectionName}/auto-${autoIdCounter++}` } satisfies FakeRef;
    }
    return { __path: rest.join('/') } satisfies FakeRef;
  });
  mockCollection.mockImplementation((_db: unknown, name: string) => ({
    __collection: name,
  }));
  mockGetDoc.mockImplementation(async (ref: FakeRef) => {
    const entry = store[ref.__path];
    return {
      exists: () => !!entry?.exists,
      data: () => entry?.data,
    };
  });
  mockSetDoc.mockResolvedValue(undefined);
  mockUpdateDoc.mockResolvedValue(undefined);
  mockBatchCommit.mockResolvedValue(undefined);
});

// ─── Fixtures ────────────────────────────────────────────────────────────────

function seedSubmittedSubmission(overrides: Record<string, unknown> = {}) {
  seedDoc(`submissions/${SUBMISSION_ID}`, {
    exists: true,
    data: {
      submissionId: SUBMISSION_ID,
      verificationId: VERIFICATION_ID,
      studentUid: STUDENT_UID,
      ownerUid: OWNER_UID,
      status: 'submitted',
      answers: {
        '0': { tipo: 'aperta', testo: 'risposta 1' },
        '1': { tipo: 'aperta', testo: 'risposta 2' },
      },
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

function seedPublishedProjection(
  questions = [
    { order: 0, tipo: 'aperta', maxPoints: 10, testo: 'D1' },
    { order: 1, tipo: 'aperta', maxPoints: 5, testo: 'D2' },
  ],
) {
  seedDoc(`verifications/${VERIFICATION_ID}/publishedProjection/data`, {
    exists: true,
    data: {
      ownerUid: OWNER_UID,
      title: 'Verifica 1',
      className: 'Classe A',
      classId: 'class-a',
      visibility: 'public',
      questions,
      activatedAt: { seconds: 1, nanoseconds: 0 },
    },
  });
}

function seedVerification(overrides: Record<string, unknown> = {}) {
  seedDoc(`verifications/${VERIFICATION_ID}`, {
    exists: true,
    data: {
      ownerUid: OWNER_UID,
      status: 'active',
      config: {
        title: 'Verifica 1',
        classId: 'class-a',
        programId: 'p1',
        importId: 'i1',
        questionRefs: [],
      },
      teacherSnapshot: {
        title: 'Verifica 1',
        classId: 'class-a',
        className: 'Classe A',
        programId: 'p1',
        importId: 'i1',
        questionRefs: [],
        questions: [
          { order: 0, tipo: 'aperta', maxPoints: 10, testo: 'D1', soluzione: 'sol0' },
          { order: 1, tipo: 'aperta', maxPoints: 5, testo: 'D2', soluzione: 'sol1' },
        ],
        activatedAt: { seconds: 1, nanoseconds: 0 },
      },
      activatedAt: { seconds: 1, nanoseconds: 0 },
      closedAt: null,
      ...overrides,
    },
  });
}

function correctionFixture(overrides: Partial<CorrectionDoc> = {}): CorrectionDoc {
  return {
    submissionId: SUBMISSION_ID,
    verificationId: VERIFICATION_ID,
    studentUid: STUDENT_UID,
    ownerUid: OWNER_UID,
    status: 'in_progress',
    evaluations: {
      '0': { order: 0, points: null, maxPoints: 10 },
      '1': { order: 1, points: null, maxPoints: 5 },
    },
    generalFeedback: null,
    totalPoints: 0,
    maxPoints: 15,
    percentage: 0,
    createdAt: { seconds: 1, nanoseconds: 0 } as never,
    updatedAt: { seconds: 1, nanoseconds: 0 } as never,
    completedAt: null,
    returnedAt: null,
    reopenCount: 0,
    ...overrides,
  };
}

function seedCorrection(overrides: Partial<CorrectionDoc> = {}) {
  seedDoc(`corrections/${SUBMISSION_ID}`, { exists: true, data: correctionFixture(overrides) });
}

function returnFixture(overrides: Partial<CorrectionReturnDoc> = {}): CorrectionReturnDoc {
  return {
    correctionId: SUBMISSION_ID,
    verificationId: VERIFICATION_ID,
    studentUid: STUDENT_UID,
    ownerUid: OWNER_UID,
    verificationTitle: 'Verifica 1',
    className: 'Classe A',
    submittedAt: { seconds: 3, nanoseconds: 0 } as never,
    returnedAt: { seconds: 4, nanoseconds: 0 } as never,
    questions: [
      {
        order: 0,
        tipo: 'aperta',
        testo: 'D1',
        studentAnswer: { tipo: 'aperta', testo: 'risposta 1' },
        points: 8,
        maxPoints: 10,
      },
      {
        order: 1,
        tipo: 'aperta',
        testo: 'D2',
        studentAnswer: { tipo: 'aperta', testo: 'risposta 2' },
        points: 4,
        maxPoints: 5,
      },
    ],
    generalFeedback: null,
    totalPoints: 12,
    maxPoints: 15,
    percentage: 80,
    visibleToStudent: true,
    solutionsVisible: false,
    updatedAt: { seconds: 4, nanoseconds: 0 } as never,
    ...overrides,
  };
}

function seedReturn(overrides: Partial<CorrectionReturnDoc> = {}) {
  seedDoc(`correctionReturns/${SUBMISSION_ID}`, { exists: true, data: returnFixture(overrides) });
}

// ─── openOrLoadCorrection ────────────────────────────────────────────────────

describe('openOrLoadCorrection', () => {
  it('returns the existing correction without writing when one already exists', async () => {
    seedCorrection();
    seedSubmittedSubmission();
    seedVerification();
    seedPublishedProjection();

    const { correction, projectionQuestions } = await openOrLoadCorrection(
      SUBMISSION_ID,
      OWNER_UID,
      fakeDb,
    );

    expect(correction.status).toBe('in_progress');
    // The service validates the existing skeleton but does not expose the
    // projection as a create-path reuse value.
    expect(projectionQuestions).toBeNull();
    expect(mockRunTransaction).not.toHaveBeenCalled();
    expect(mockSetDoc).not.toHaveBeenCalled();
  });

  it('creates a new in_progress correction initialized from the published projection', async () => {
    seedSubmittedSubmission();
    seedVerification();
    seedPublishedProjection();
    mockRunTransaction.mockImplementation(async (_db: unknown, fn: (tx: unknown) => unknown) => {
      const tx = {
        get: vi.fn().mockResolvedValue({ exists: () => false }),
        set: vi.fn(),
      };
      return fn(tx);
    });

    const { correction, projectionQuestions } = await openOrLoadCorrection(
      SUBMISSION_ID,
      OWNER_UID,
      fakeDb,
    );

    expect(correction.status).toBe('in_progress');
    expect(correction.reopenCount).toBe(0);
    expect(correction.evaluations).toEqual({
      '0': { order: 0, points: null, maxPoints: 10 },
      '1': { order: 1, points: null, maxPoints: 5 },
    });
    expect(correction.completedAt).toBeNull();
    expect(correction.returnedAt).toBeNull();
    // The projection read during creation is surfaced for the loader to reuse.
    expect(projectionQuestions).toHaveLength(2);
  });

  it('is idempotent against two near-simultaneous opens (transaction re-checks existence)', async () => {
    seedSubmittedSubmission();
    seedVerification();
    seedPublishedProjection();
    const alreadyCreated = correctionFixture({ reopenCount: 0 });
    mockRunTransaction.mockImplementation(async (_db: unknown, fn: (tx: unknown) => unknown) => {
      const tx = {
        get: vi.fn().mockResolvedValue({ exists: () => true, data: () => alreadyCreated }),
        set: vi.fn(),
      };
      return fn(tx);
    });

    const { correction } = await openOrLoadCorrection(SUBMISSION_ID, OWNER_UID, fakeDb);

    expect(correction).toEqual(alreadyCreated);
  });

  it('rejects when the submission does not exist', async () => {
    seedPublishedProjection();

    await expect(openOrLoadCorrection(SUBMISSION_ID, OWNER_UID, fakeDb)).rejects.toThrow(
      /consegna non trovata/i,
    );
  });

  it('rejects when the submission is not yet submitted', async () => {
    seedSubmittedSubmission({ status: 'draft' });

    await expect(openOrLoadCorrection(SUBMISSION_ID, OWNER_UID, fakeDb)).rejects.toThrow(
      /non è ancora stata inviata/i,
    );
  });

  it("rejects when the submission belongs to a different owner's verification", async () => {
    seedSubmittedSubmission({ ownerUid: 'someone-else' });

    await expect(openOrLoadCorrection(SUBMISSION_ID, OWNER_UID, fakeDb)).rejects.toThrow(
      /non appartiene a questo docente/i,
    );
  });
});

// ─── saveCorrection ──────────────────────────────────────────────────────────

describe('saveCorrection', () => {
  beforeEach(() => {
    seedSubmittedSubmission();
    seedVerification();
    seedPublishedProjection();
  });
  it('computes totals correctly and writes a single update with no reopen', async () => {
    seedCorrection();

    await saveCorrection(
      {
        submissionId: SUBMISSION_ID,
        evaluations: {
          '0': { points: 7 },
          '1': { points: 3 },
        },
        generalFeedback: 'buon lavoro',
      },
      fakeDb,
    );

    expect(mockBatchUpdate).toHaveBeenCalledTimes(3);
    const [, update] = mockBatchUpdate.mock.calls[0]!;
    expect(update.totalPoints).toBe(10);
    expect(update.maxPoints).toBe(15);
    expect(update.percentage).toBe(67);
    expect(mockBatchCommit).toHaveBeenCalledTimes(1);
  });

  it('rejects an out-of-range score', async () => {
    seedCorrection();

    await expect(
      saveCorrection(
        {
          submissionId: SUBMISSION_ID,
          evaluations: { '0': { points: 999 }, '1': { points: null } },
          generalFeedback: null,
        },
        fakeDb,
      ),
    ).rejects.toThrow(/Punteggio non valido/);
    expect(mockUpdateDoc).not.toHaveBeenCalled();
  });

  it('rejects a question set missing a frozen question', async () => {
    seedCorrection();

    await expect(
      saveCorrection(
        {
          submissionId: SUBMISSION_ID,
          evaluations: { '0': { points: 5 } }, // missing '1'
          generalFeedback: null,
        },
        fakeDb,
      ),
    ).rejects.toThrow(/non corrispondono/i);
  });

  it('rejects a question set with an extra unknown question', async () => {
    seedCorrection();

    await expect(
      saveCorrection(
        {
          submissionId: SUBMISSION_ID,
          evaluations: { '0': { points: 5 }, '1': { points: 2 }, '2': { points: 1 } },
          generalFeedback: null,
        },
        fakeDb,
      ),
    ).rejects.toThrow(/non corrispondono/i);
  });

  it('writes nothing when the save is identical to the current state', async () => {
    seedCorrection({
      evaluations: {
        '0': { order: 0, points: 5, maxPoints: 10 },
        '1': { order: 1, points: 2, maxPoints: 5 },
      },
      generalFeedback: 'ok',
    });

    await saveCorrection(
      {
        submissionId: SUBMISSION_ID,
        evaluations: { '0': { points: 5 }, '1': { points: 2 } },
        generalFeedback: 'ok',
      },
      fakeDb,
    );

    expect(mockUpdateDoc).not.toHaveBeenCalled();
    expect(mockWriteBatch).not.toHaveBeenCalled();
  });

  it('produces no correctionEvents on the first pass (reopenCount 0), however the save', async () => {
    seedCorrection({ reopenCount: 0 });

    await saveCorrection(
      {
        submissionId: SUBMISSION_ID,
        evaluations: { '0': { points: 9 }, '1': { points: 1 } },
        generalFeedback: null,
      },
      fakeDb,
    );

    expect(mockUpdateDoc).not.toHaveBeenCalled();
    expect(mockWriteBatch).toHaveBeenCalledTimes(1);
    expect(mockBatchUpdate).toHaveBeenCalledTimes(3);
    expect(mockBatchSet).not.toHaveBeenCalled();
    const submissionUpdate = mockBatchUpdate.mock.calls.find(
      ([ref]) => (ref as { __path?: string }).__path === `submissions/${SUBMISSION_ID}`,
    )?.[1];
    expect(submissionUpdate).toMatchObject({
      correctionStatus: 'in_progress',
      correctionSummary: { totalPoints: 10, maxPoints: 15, percentage: 67 },
    });
  });

  it('writes an atomic scoreAdjusted event with a minimal delta after a reopen', async () => {
    seedCorrection({
      reopenCount: 1,
      evaluations: {
        '0': { order: 0, points: 5, maxPoints: 10 },
        '1': { order: 1, points: 2, maxPoints: 5 },
      },
    });

    await saveCorrection(
      {
        submissionId: SUBMISSION_ID,
        evaluations: { '0': { points: 8 }, '1': { points: 2 } }, // only '0' changes
        generalFeedback: null,
      },
      fakeDb,
    );

    expect(mockWriteBatch).toHaveBeenCalledTimes(1);
    expect(mockBatchUpdate).toHaveBeenCalledTimes(2);
    expect(mockBatchSet).toHaveBeenCalledTimes(1);
    expect(mockBatchCommit).toHaveBeenCalledTimes(1);
    expect(mockUpdateDoc).not.toHaveBeenCalled();

    const [, event] = mockBatchSet.mock.calls[0]!;
    expect(event.type).toBe('scoreAdjusted');
    expect(event.questionDeltas).toEqual([{ order: 0, previousPoints: 5, nextPoints: 8 }]);
    const submissionUpdate = mockBatchUpdate.mock.calls.find(
      ([ref]) => (ref as { __path?: string }).__path === `submissions/${SUBMISSION_ID}`,
    )?.[1];
    expect(submissionUpdate).toMatchObject({
      correctionSummary: { totalPoints: 10, maxPoints: 15, percentage: 67 },
    });
    expect(submissionUpdate).not.toHaveProperty('correctionStatus');
  });

  it('rejects saving on a completed correction', async () => {
    seedCorrection({ status: 'completed' });

    await expect(
      saveCorrection(
        {
          submissionId: SUBMISSION_ID,
          evaluations: { '0': { points: 5 }, '1': { points: 2 } },
          generalFeedback: null,
        },
        fakeDb,
      ),
    ).rejects.toThrow(/non è in corso/i);
  });
});

// ─── completeCorrection ──────────────────────────────────────────────────────

describe('completeCorrection', () => {
  beforeEach(() => {
    seedSubmittedSubmission();
    seedVerification();
    seedPublishedProjection();
  });
  it('rejects completion while a question is unevaluated', async () => {
    seedCorrection({
      evaluations: {
        '0': { order: 0, points: 5, maxPoints: 10 },
        '1': { order: 1, points: null, maxPoints: 5 },
      },
    });

    await expect(completeCorrection(SUBMISSION_ID, fakeDb)).rejects.toThrow(
      /non sono ancora state valutate/i,
    );
    expect(mockUpdateDoc).not.toHaveBeenCalled();
  });

  it('rejects completion on an empty evaluations map', async () => {
    seedCorrection({ evaluations: {} });

    await expect(completeCorrection(SUBMISSION_ID, fakeDb)).rejects.toThrow();
  });

  it('completes when every question is evaluated', async () => {
    seedCorrection({
      evaluations: {
        '0': { order: 0, points: 5, maxPoints: 10 },
        '1': { order: 1, points: 0, maxPoints: 5 },
      },
    });

    await completeCorrection(SUBMISSION_ID, fakeDb);

    expect(mockBatchUpdate).toHaveBeenCalledTimes(3);
    const [, update] = mockBatchUpdate.mock.calls[0]!;
    expect(update.status).toBe('completed');
    expect(update.completedAt).toBeDefined();
    const [, submissionUpdate] = mockBatchUpdate.mock.calls[1]!;
    expect(submissionUpdate).not.toHaveProperty('correctionSummary');
    expect(submissionUpdate).not.toHaveProperty('correctionSummaryUpdatedAt');
  });
});

// ─── returnCorrection ────────────────────────────────────────────────────────

describe('returnCorrection', () => {
  it('atomically returns same_questions visible with every frozen solution', async () => {
    seedSubmittedSubmission();
    seedVerification();
    seedPublishedProjection();
    seedCorrection({
      status: 'completed',
      evaluations: {
        '0': { order: 0, points: 8, maxPoints: 10 },
        '1': { order: 1, points: 4, maxPoints: 5 },
      },
      totalPoints: 12,
      maxPoints: 15,
      percentage: 80,
    });

    await returnCorrection(SUBMISSION_ID, fakeDb);

    expect(mockWriteBatch).toHaveBeenCalledTimes(1);
    expect(mockBatchUpdate).toHaveBeenCalledTimes(3); // correction + submission + receipt
    expect(mockBatchSet).toHaveBeenCalledTimes(2); // correctionReturns + event
    expect(mockBatchCommit).toHaveBeenCalledTimes(1);
    expect(
      mockGetDoc.mock.calls.some(
        ([ref]) =>
          (ref as FakeRef).__path === `verifications/${VERIFICATION_ID}/publishedProjection/data`,
      ),
    ).toBe(false);

    const [correctionUpdateRef, correctionUpdate] = mockBatchUpdate.mock.calls[0]!;
    expect(correctionUpdateRef.__path).toBe(`corrections/${SUBMISSION_ID}`);
    expect(correctionUpdate.status).toBe('returned');

    const [returnRef, returnDoc] = mockBatchSet.mock.calls[0]!;
    expect(returnRef.__path).toBe(`correctionReturns/${SUBMISSION_ID}`);
    expect(returnDoc.visibleToStudent).toBe(true);
    expect(returnDoc.solutionsVisible).toBe(true);
    expect(returnDoc.questions).toHaveLength(2);
    expect(
      returnDoc.questions.map((question: { correctAnswer: string }) => question.correctAnswer),
    ).toEqual(['sol0', 'sol1']);
    for (const question of returnDoc.questions) expect(typeof question.points).toBe('number');
    expect(returnDoc.questions[0].studentAnswer).toEqual({ tipo: 'aperta', testo: 'risposta 1' });

    const [, event] = mockBatchSet.mock.calls[1]!;
    expect(event.type).toBe('returned');
  });

  // ─── UI-VERIFICHE-06B follow-up — data e argomenti autosufficienti ─────────

  const TOPIC_OUTLINE = [
    { udaTitle: 'Il Web', lessonTitles: ['Come funziona Internet', 'Il protocollo HTTP'] },
  ];

  function seedVerificationWithTopics(extra: Record<string, unknown> = {}) {
    seedVerification({
      teacherSnapshot: {
        title: 'Verifica 1',
        classId: 'class-a',
        className: 'Classe A',
        programId: 'p1',
        importId: 'i1',
        verificationDate: '2026-02-02',
        topicOutline: TOPIC_OUTLINE,
        questionRefs: [],
        questions: [
          { order: 0, tipo: 'aperta', maxPoints: 10, testo: 'D1', soluzione: 'sol0' },
          { order: 1, tipo: 'aperta', maxPoints: 5, testo: 'D2', soluzione: 'sol1' },
        ],
        activatedAt: { seconds: 1, nanoseconds: 0 },
        ...extra,
      },
    });
  }

  function seedCompleted() {
    seedCorrection({
      status: 'completed',
      evaluations: {
        '0': { order: 0, points: 8, maxPoints: 10 },
        '1': { order: 1, points: 4, maxPoints: 5 },
      },
      totalPoints: 12,
      maxPoints: 15,
      percentage: 80,
    });
  }

  it('copia data e argomenti dal teacherSnapshot congelato, senza write aggiuntive', async () => {
    seedSubmittedSubmission();
    seedVerificationWithTopics();
    seedCompleted();

    await returnCorrection(SUBMISSION_ID, fakeDb);

    const [, returnDoc] = mockBatchSet.mock.calls[0]!;
    expect(returnDoc.verificationDate).toBe('2026-02-02');
    expect(returnDoc.topicOutline).toEqual(TOPIC_OUTLINE);
    // Conteggio write invariato rispetto a prima dei nuovi campi.
    expect(mockWriteBatch).toHaveBeenCalledTimes(1);
    expect(mockBatchUpdate).toHaveBeenCalledTimes(3);
    expect(mockBatchSet).toHaveBeenCalledTimes(2);
    expect(mockBatchCommit).toHaveBeenCalledTimes(1);
    // Nessuna lettura della proiezione pubblica reintrodotta.
    expect(
      mockGetDoc.mock.calls.some(
        ([ref]) =>
          (ref as FakeRef).__path === `verifications/${VERIFICATION_ID}/publishedProjection/data`,
      ),
    ).toBe(false);
  });

  it('copia gli stessi dati anche quando la verifica è chiusa o nascosta', async () => {
    for (const state of [
      { status: 'closed', visibility: 'hidden' },
      { status: 'active', visibility: 'hidden' },
    ]) {
      vi.clearAllMocks();
      store = {};
      seedSubmittedSubmission();
      seedVerification({
        ...state,
        teacherSnapshot: {
          title: 'Verifica 1',
          classId: 'class-a',
          className: 'Classe A',
          programId: 'p1',
          importId: 'i1',
          verificationDate: '2026-02-02',
          topicOutline: TOPIC_OUTLINE,
          questionRefs: [],
          questions: [
            { order: 0, tipo: 'aperta', maxPoints: 10, testo: 'D1', soluzione: 'sol0' },
            { order: 1, tipo: 'aperta', maxPoints: 5, testo: 'D2', soluzione: 'sol1' },
          ],
          activatedAt: { seconds: 1, nanoseconds: 0 },
        },
      });
      seedCompleted();

      await returnCorrection(SUBMISSION_ID, fakeDb);

      const [, returnDoc] = mockBatchSet.mock.calls[0]!;
      expect(returnDoc.verificationDate).toBe('2026-02-02');
      expect(returnDoc.topicOutline).toEqual(TOPIC_OUTLINE);
    }
  });

  it('omette i campi su uno snapshot legacy che non li ha, senza inventarli', async () => {
    seedSubmittedSubmission();
    seedVerification();
    seedCompleted();

    await returnCorrection(SUBMISSION_ID, fakeDb);

    const [, returnDoc] = mockBatchSet.mock.calls[0]!;
    expect(returnDoc).not.toHaveProperty('verificationDate');
    expect(returnDoc).not.toHaveProperty('topicOutline');
    // Il resto della restituzione resta pienamente funzionante.
    expect(returnDoc.questions).toHaveLength(2);
  });

  it('fallisce prima di qualunque write con argomenti congelati malformati', async () => {
    seedSubmittedSubmission();
    seedVerificationWithTopics({ topicOutline: [{ udaTitle: 'Il Web', lessonTitles: [] }] });
    seedCompleted();

    await expect(returnCorrection(SUBMISSION_ID, fakeDb)).rejects.toThrow(
      /argomenti congelati|non sono validi/i,
    );
    expect(mockBatchCommit).not.toHaveBeenCalled();
    expect(mockBatchSet).not.toHaveBeenCalled();
  });

  it('fallisce prima di qualunque write con una data congelata malformata', async () => {
    seedSubmittedSubmission();
    seedVerificationWithTopics({ verificationDate: '2026-02-30' });
    seedCompleted();

    await expect(returnCorrection(SUBMISSION_ID, fakeDb)).rejects.toThrow(/AAAA-MM-GG/);
    expect(mockBatchCommit).not.toHaveBeenCalled();
    expect(mockBatchSet).not.toHaveBeenCalled();
  });

  it('gli argomenti restituiti non contengono dati vietati né la variante assegnata', async () => {
    seedSubmittedSubmission();
    seedVerificationWithTopics();
    seedCompleted();

    await returnCorrection(SUBMISSION_ID, fakeDb);

    const [, returnDoc] = mockBatchSet.mock.calls[0]!;
    const serialized = JSON.stringify(returnDoc.topicOutline);
    for (const forbidden of [
      'sol0',
      'sol1',
      'D1',
      'D2',
      'questionIndexEntryId',
      'poolStorageRef',
      'assigned',
      OWNER_UID,
      STUDENT_UID,
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
    for (const uda of returnDoc.topicOutline) {
      expect(Object.keys(uda)).toEqual(['udaTitle', 'lessonTitles']);
    }
  });

  it('la restituzione batch produce esattamente lo stesso risultato della singola', async () => {
    // Il runner batch invoca lo **stesso** `returnCorrection` per ogni riga: qui
    // lo si esercita davvero (nessun mock del service) su due consegne.
    const otherStudent = 'student-2';
    const otherSubmission = `${VERIFICATION_ID}_${otherStudent}`;
    seedSubmittedSubmission();
    seedVerificationWithTopics();
    seedCompleted();
    seedDoc(`submissions/${otherSubmission}`, {
      exists: true,
      data: {
        submissionId: otherSubmission,
        verificationId: VERIFICATION_ID,
        studentUid: otherStudent,
        ownerUid: OWNER_UID,
        status: 'submitted',
        answers: {
          '0': { tipo: 'aperta', testo: 'risposta 1' },
          '1': { tipo: 'aperta', testo: 'risposta 2' },
        },
        flagged: {},
        attentionEvents: [],
        deliveryCode: 'SF-2',
        verificationTitle: 'Verifica 1',
        className: 'Classe A',
        startedAt: { seconds: 1, nanoseconds: 0 },
        lastSavedAt: { seconds: 2, nanoseconds: 0 },
        submittedAt: { seconds: 3, nanoseconds: 0 },
      },
    });
    seedDoc(`corrections/${otherSubmission}`, {
      exists: true,
      data: correctionFixture({
        submissionId: otherSubmission,
        studentUid: otherStudent,
        status: 'completed',
        evaluations: {
          '0': { order: 0, points: 8, maxPoints: 10 },
          '1': { order: 1, points: 4, maxPoints: 5 },
        },
        totalPoints: 12,
        maxPoints: 15,
        percentage: 80,
      }),
    });

    const results = await runBatchCorrectionAction(
      'return',
      [
        { studentUid: STUDENT_UID, studentName: 'A', submissionId: SUBMISSION_ID },
        { studentUid: otherStudent, studentName: 'B', submissionId: otherSubmission },
      ],
      fakeDb,
    );
    expect(results.every((r) => r.outcome === 'succeeded')).toBe(true);

    const returns = mockBatchSet.mock.calls
      .filter(([ref]) => (ref as FakeRef).__path?.startsWith('correctionReturns/'))
      .map(([, data]) => data);
    expect(returns).toHaveLength(2);
    for (const returnDoc of returns) {
      expect(returnDoc.verificationDate).toBe('2026-02-02');
      expect(returnDoc.topicOutline).toEqual(TOPIC_OUTLINE);
    }
  });

  it('rejects returning a correction that is not completed', async () => {
    seedCorrection({ status: 'in_progress' });

    await expect(returnCorrection(SUBMISSION_ID, fakeDb)).rejects.toThrow(
      /Transizione di stato correzione non valida/,
    );
  });

  it('rejects when the self-sufficient projection would exceed the size limit', async () => {
    seedSubmittedSubmission();
    const hugeTesto = 'x'.repeat(400_000);
    seedVerification({
      teacherSnapshot: {
        title: 'Verifica 1',
        classId: 'class-a',
        className: 'Classe A',
        programId: 'p1',
        importId: 'i1',
        questionRefs: [],
        questions: [
          { order: 0, tipo: 'aperta', maxPoints: 10, testo: hugeTesto, soluzione: 'sol0' },
          { order: 1, tipo: 'aperta', maxPoints: 5, testo: hugeTesto, soluzione: 'sol1' },
        ],
        activatedAt: { seconds: 1, nanoseconds: 0 },
      },
    });
    seedCorrection({
      status: 'completed',
      evaluations: {
        '0': { order: 0, points: 8, maxPoints: 10 },
        '1': { order: 1, points: 4, maxPoints: 5 },
      },
    });

    await expect(returnCorrection(SUBMISSION_ID, fakeDb)).rejects.toThrow(/troppo grande/i);
    expect(mockBatchCommit).not.toHaveBeenCalled();
  });

  it('fails before every write when the frozen snapshot or a solution is unavailable', async () => {
    seedSubmittedSubmission();
    seedVerification({ teacherSnapshot: null });
    seedCorrection({
      status: 'completed',
      evaluations: {
        '0': { order: 0, points: 8, maxPoints: 10 },
        '1': { order: 1, points: 4, maxPoints: 5 },
      },
    });

    await expect(returnCorrection(SUBMISSION_ID, fakeDb)).rejects.toThrow(/snapshot docente/i);
    expect(mockBatchUpdate).not.toHaveBeenCalled();
    expect(mockBatchSet).not.toHaveBeenCalled();
    expect(mockBatchCommit).not.toHaveBeenCalled();

    seedVerification({
      teacherSnapshot: {
        title: 'Verifica 1',
        classId: 'class-a',
        className: 'Classe A',
        programId: 'p1',
        importId: 'i1',
        questionRefs: [],
        questions: [
          { order: 0, tipo: 'aperta', maxPoints: 10, testo: 'D1', soluzione: '' },
          { order: 1, tipo: 'aperta', maxPoints: 5, testo: 'D2', soluzione: 'sol1' },
        ],
        activatedAt: { seconds: 1, nanoseconds: 0 },
      },
    });
    await expect(returnCorrection(SUBMISSION_ID, fakeDb)).rejects.toThrow(/soluzione congelata/i);
    expect(mockBatchCommit).not.toHaveBeenCalled();
  });
});

// ─── reopenCorrection ────────────────────────────────────────────────────────

describe('reopenCorrection', () => {
  beforeEach(() => {
    seedSubmittedSubmission();
    seedVerification();
    seedPublishedProjection();
  });

  it('increments reopenCount by exactly one and appends a reopened event', async () => {
    seedCorrection({ status: 'completed', reopenCount: 0 });

    await reopenCorrection(SUBMISSION_ID, fakeDb);

    expect(mockBatchUpdate).toHaveBeenCalledTimes(3);
    const [, correctionUpdate] = mockBatchUpdate.mock.calls[0]!;
    expect(correctionUpdate.status).toBe('in_progress');
    expect(correctionUpdate.reopenCount).toBe(1);
    expect(correctionUpdate.completedAt).toBeNull();
    expect(correctionUpdate.returnedAt).toBeNull();

    expect(mockBatchSet).toHaveBeenCalledTimes(1); // only the event, no return projection to hide
    const [, event] = mockBatchSet.mock.calls[0]!;
    expect(event.type).toBe('reopened');
    expect(mockBatchCommit).toHaveBeenCalledTimes(1);
  });

  it('hides the existing return projection atomically when reopening a returned correction', async () => {
    seedCorrection({ status: 'returned', reopenCount: 0 });

    await reopenCorrection(SUBMISSION_ID, fakeDb);

    expect(mockBatchUpdate).toHaveBeenCalledTimes(4); // correction + mirrors + correctionReturns
    const returnUpdateCall = mockBatchUpdate.mock.calls.find(
      ([ref]) => (ref as { __path: string }).__path === `correctionReturns/${SUBMISSION_ID}`,
    );
    expect(returnUpdateCall).toBeDefined();
    expect(returnUpdateCall![1]).toMatchObject({ visibleToStudent: false });
  });

  it('rejects reopening an already in_progress correction', async () => {
    seedCorrection({ status: 'in_progress' });

    await expect(reopenCorrection(SUBMISSION_ID, fakeDb)).rejects.toThrow(
      /Transizione di stato correzione non valida/,
    );
  });
});

// ─── clearCorrection (M5-04C) ────────────────────────────────────────────────

describe('clearCorrection', () => {
  beforeEach(() => {
    seedSubmittedSubmission();
    seedVerification();
    seedPublishedProjection();
  });

  type Write = { path: string; data: Record<string, unknown> };
  function wireTransaction(): { updates: Write[]; sets: Write[] } {
    const updates: Write[] = [];
    const sets: Write[] = [];
    mockRunTransaction.mockImplementation(async (_db: unknown, fn: (tx: unknown) => unknown) => {
      const tx = {
        get: async (ref: FakeRef) => {
          const e = store[ref.__path];
          return { exists: () => !!e?.exists, data: () => e?.data };
        },
        update: (ref: FakeRef, data: Record<string, unknown>) =>
          updates.push({ path: ref.__path, data }),
        set: (ref: FakeRef, data: Record<string, unknown>) => sets.push({ path: ref.__path, data }),
      };
      return fn(tx);
    });
    return { updates, sets };
  }

  it('clears points and per-question feedback, nulls generalFeedback, keeps identity and in_progress', async () => {
    seedCorrection({
      status: 'in_progress',
      evaluations: {
        '0': { order: 0, points: 7, maxPoints: 10, feedback: 'Risposta corretta.' },
        '1': { order: 1, points: 3, maxPoints: 5, feedback: '2 su 3.' },
      },
      generalFeedback: '[mock] qualcosa',
      totalPoints: 10,
      maxPoints: 15,
      percentage: 67,
    });
    const { updates, sets } = wireTransaction();

    const res = await clearCorrection(SUBMISSION_ID, fakeDb);

    expect(res).toEqual({
      cleared: true,
      status: 'in_progress',
      summary: { totalPoints: 0, maxPoints: 15, percentage: 0 },
    });
    const correctionUpdate = updates.find((u) => u.path === `corrections/${SUBMISSION_ID}`)!;
    // Identity/structure preserved; points nulled; feedback removed; general nulled.
    expect(correctionUpdate.data.evaluations).toEqual({
      '0': { order: 0, points: null, maxPoints: 10 },
      '1': { order: 1, points: null, maxPoints: 5 },
    });
    expect(correctionUpdate.data.generalFeedback).toBeNull();
    expect(correctionUpdate.data.totalPoints).toBe(0);
    expect(correctionUpdate.data.status).toBeUndefined(); // status not rewritten (stays in_progress)
    // Mirror updated on submission + receipt (status back to a not-evaluated state).
    const submissionUpdate = updates.find((u) => u.path === `submissions/${SUBMISSION_ID}`)!;
    expect(submissionUpdate.data.correctionStatus).toBe('submitted');
    expect(submissionUpdate.data.correctionSummary).toEqual({
      totalPoints: 0,
      maxPoints: 15,
      percentage: 0,
    });
    expect(updates.some((u) => u.path === `submissionReceipts/${SUBMISSION_ID}`)).toBe(true);
    // Exactly one minimal audit event, no sensitive content.
    const events = sets.filter((s) => s.path.startsWith('correctionEvents/'));
    expect(events).toHaveLength(1);
    expect(events[0]!.data).toMatchObject({
      correctionId: SUBMISSION_ID,
      type: 'correctionCleared',
      previousStatus: 'in_progress',
      nextStatus: 'in_progress',
      reason: null,
    });
    expect(Object.keys(events[0]!.data)).not.toContain('evaluations');
    expect(Object.keys(events[0]!.data)).not.toContain('questionDeltas');
  });

  it('is a no-op (no writes, no event) when there is nothing to clear', async () => {
    seedCorrection({
      status: 'in_progress',
      evaluations: {
        '0': { order: 0, points: null, maxPoints: 10 },
        '1': { order: 1, points: null, maxPoints: 5 },
      },
      generalFeedback: null,
    });
    const { updates, sets } = wireTransaction();

    const res = await clearCorrection(SUBMISSION_ID, fakeDb);

    expect(res.cleared).toBe(false);
    expect(updates).toHaveLength(0);
    expect(sets).toHaveLength(0);
  });

  it('rejects when the correction is not in_progress (completed/returned)', async () => {
    seedCorrection({ status: 'completed' });
    wireTransaction();
    await expect(clearCorrection(SUBMISSION_ID, fakeDb)).rejects.toThrow(/riapri prima/i);
  });

  it('rejects without writes when the correction does not exist', async () => {
    const { updates, sets } = wireTransaction();
    await expect(clearCorrection(SUBMISSION_ID, fakeDb)).rejects.toThrow(/non trovata/i);
    expect(updates).toHaveLength(0);
    expect(sets).toHaveLength(0);
  });
});

// ─── setReturnVisibleToStudent ───────────────────────────────────────────────

describe('setReturnVisibleToStudent', () => {
  it('updates visibleToStudent when it actually changes', async () => {
    seedCorrection({ status: 'returned' });
    seedReturn({ visibleToStudent: true });

    const result = await setReturnVisibleToStudent(SUBMISSION_ID, false, fakeDb);

    expect(result).toBe('changed');
    expect(mockUpdateDoc).toHaveBeenCalledTimes(1);
    const [, update] = mockUpdateDoc.mock.calls[0]!;
    expect(update.visibleToStudent).toBe(false);
  });

  it('writes nothing when the value is already what was requested', async () => {
    seedCorrection({ status: 'returned' });
    seedReturn({ visibleToStudent: true });

    const result = await setReturnVisibleToStudent(SUBMISSION_ID, true, fakeDb);

    expect(result).toBe('noop');
    expect(mockUpdateDoc).not.toHaveBeenCalled();
  });

  it('rejects when no return projection exists', async () => {
    seedCorrection({ status: 'returned' });

    await expect(setReturnVisibleToStudent(SUBMISSION_ID, false, fakeDb)).rejects.toThrow();
  });

  it('rejects when no correction exists at all', async () => {
    await expect(setReturnVisibleToStudent(SUBMISSION_ID, false, fakeDb)).rejects.toThrow(
      /correzione non trovata/i,
    );
    expect(mockUpdateDoc).not.toHaveBeenCalled();
  });

  it('rejects (no write) when the correction was reopened and is no longer returned', async () => {
    seedCorrection({ status: 'in_progress', reopenCount: 1 });
    seedReturn({ visibleToStudent: false });

    await expect(setReturnVisibleToStudent(SUBMISSION_ID, true, fakeDb)).rejects.toThrow(
      /non è attualmente restituita/i,
    );
    expect(mockUpdateDoc).not.toHaveBeenCalled();
  });

  it('rejects (no write) when the correction is completed but not yet returned', async () => {
    seedCorrection({ status: 'completed' });
    seedReturn({ visibleToStudent: false });

    await expect(setReturnVisibleToStudent(SUBMISSION_ID, true, fakeDb)).rejects.toThrow(
      /non è attualmente restituita/i,
    );
    expect(mockUpdateDoc).not.toHaveBeenCalled();
  });
});

// ─── setSolutionsVisible ─────────────────────────────────────────────────────

describe('setSolutionsVisible', () => {
  it('inserts frozen correctAnswer on every question when turning visible on', async () => {
    seedSubmittedSubmission();
    seedVerification();
    seedCorrection({ status: 'returned' });
    seedReturn({ solutionsVisible: false });

    const result = await setSolutionsVisible(SUBMISSION_ID, true, fakeDb);

    expect(result).toBe('changed');
    expect(mockUpdateDoc).toHaveBeenCalledTimes(1);
    const [, update] = mockUpdateDoc.mock.calls[0]!;
    expect(update.solutionsVisible).toBe(true);
    expect(update.questions[0].correctAnswer).toBe('sol0');
    expect(update.questions[1].correctAnswer).toBe('sol1');
  });

  it('physically removes correctAnswer from every question when turning visible off', async () => {
    seedCorrection({ status: 'returned' });
    seedReturn({
      solutionsVisible: true,
      questions: [
        {
          order: 0,
          tipo: 'aperta',
          testo: 'D1',
          studentAnswer: { tipo: 'aperta', testo: 'r1' },
          points: 8,
          maxPoints: 10,
          correctAnswer: 'sol0',
        },
      ],
    });

    const result = await setSolutionsVisible(SUBMISSION_ID, false, fakeDb);

    expect(result).toBe('changed');
    expect(mockUpdateDoc).toHaveBeenCalledTimes(1);
    const [, update] = mockUpdateDoc.mock.calls[0]!;
    expect(update.solutionsVisible).toBe(false);
    expect('correctAnswer' in update.questions[0]).toBe(false);
  });

  it('writes nothing when solutionsVisible already matches the requested value', async () => {
    seedCorrection({ status: 'returned' });
    seedReturn({ solutionsVisible: false });

    const result = await setSolutionsVisible(SUBMISSION_ID, false, fakeDb);

    expect(result).toBe('noop');
    expect(mockUpdateDoc).not.toHaveBeenCalled();
  });

  it('rejects revealing solutions for a legacy verification with no frozen teacherSnapshot.questions', async () => {
    seedSubmittedSubmission();
    seedDoc(`verifications/${VERIFICATION_ID}`, {
      exists: true,
      data: {
        ownerUid: OWNER_UID,
        status: 'active',
        config: { title: 'V', classId: null, programId: 'p1', importId: 'i1', questionRefs: [] },
        teacherSnapshot: {
          title: 'V',
          classId: null,
          className: null,
          programId: 'p1',
          importId: 'i1',
          questionRefs: [],
          activatedAt: { seconds: 1, nanoseconds: 0 },
          // no `questions` — legacy, pre-SEC-02
        },
        activatedAt: { seconds: 1, nanoseconds: 0 },
        closedAt: null,
      },
    });
    seedCorrection({ status: 'returned' });
    seedReturn({ solutionsVisible: false });

    await expect(setSolutionsVisible(SUBMISSION_ID, true, fakeDb)).rejects.toThrow(
      /snapshot.*soluzioni/i,
    );
  });

  it('rejects (no write) when no correction exists at all', async () => {
    await expect(setSolutionsVisible(SUBMISSION_ID, true, fakeDb)).rejects.toThrow(
      /correzione non trovata/i,
    );
    expect(mockUpdateDoc).not.toHaveBeenCalled();
  });

  it('rejects (no write) when the correction was reopened and is no longer returned', async () => {
    seedCorrection({ status: 'in_progress', reopenCount: 1 });
    seedReturn({ solutionsVisible: false });

    await expect(setSolutionsVisible(SUBMISSION_ID, true, fakeDb)).rejects.toThrow(
      /non è attualmente restituita/i,
    );
    expect(mockUpdateDoc).not.toHaveBeenCalled();
  });

  it('rejects (no write) when the correction is completed but not yet returned', async () => {
    seedCorrection({ status: 'completed' });
    seedReturn({ solutionsVisible: false });

    await expect(setSolutionsVisible(SUBMISSION_ID, true, fakeDb)).rejects.toThrow(
      /non è attualmente restituita/i,
    );
    expect(mockUpdateDoc).not.toHaveBeenCalled();
  });
});

// ─── VEX-02B — correzione ristretta alla variante assegnata ──────────────────

function seedVexVerification(distributionMode: unknown = 'equivalent_variants') {
  seedDoc(`verifications/${VERIFICATION_ID}`, {
    exists: true,
    data: {
      ownerUid: OWNER_UID,
      status: 'active',
      config: { title: 'V', classId: 'class-a', programId: 'p1', importId: 'i1', questionRefs: [] },
      teacherSnapshot: {
        title: 'V',
        classId: 'class-a',
        className: 'Classe A',
        programId: 'p1',
        importId: 'i1',
        questionRefs: [],
        distributionMode,
        commonQuestionOrders: [0],
        equivalentGroups: [{ id: 'g1', alternativeOrders: [1, 2] }],
        questions: [
          { order: 0, tipo: 'aperta', maxPoints: 10, testo: 'Comune', soluzione: 'sol0' },
          { order: 1, tipo: 'aperta', maxPoints: 5, testo: 'Alt A', soluzione: 'sol1' },
          { order: 2, tipo: 'aperta', maxPoints: 5, testo: 'Alt B', soluzione: 'sol2' },
        ],
        activatedAt: { seconds: 1, nanoseconds: 0 },
      },
      activatedAt: { seconds: 1, nanoseconds: 0 },
      closedAt: null,
    },
  });
}

function seedDifferentiatedVerification() {
  seedDoc(`verifications/${VERIFICATION_ID}`, {
    exists: true,
    data: {
      ownerUid: OWNER_UID,
      status: 'active',
      config: { title: 'V', classId: 'class-a', programId: 'p1', importId: 'i1', questionRefs: [] },
      teacherSnapshot: {
        title: 'V',
        classId: 'class-a',
        className: 'Classe A',
        programId: 'p1',
        importId: 'i1',
        questionRefs: [],
        distributionMode: 'same_questions',
        commonQuestionOrders: [0, 1],
        equivalentGroups: [],
        questions: [
          { order: 0, tipo: 'aperta', maxPoints: 10, testo: 'Comune', soluzione: 'sol0' },
          { order: 1, tipo: 'aperta', maxPoints: 5, testo: 'Base riservata', soluzione: 'sol1' },
          {
            order: 2,
            tipo: 'aperta',
            maxPoints: 5,
            testo: 'Alternativa assegnata',
            soluzione: 'sol2',
          },
        ],
        differentiation: {
          version: 1,
          questions: [{ baseOrder: 1, choices: { L1: { kind: 'alternative', order: 2 } } }],
          labels: [{ labelId: 'L1', labelName: 'PDP_SEGRETO_ROSSO_7F91' }],
          differentiatedAlternativeOrders: [2],
        },
        labelAssignments: { version: 1, byStudentUid: { [STUDENT_UID]: 'L1' } },
        activatedAt: { seconds: 1, nanoseconds: 0 },
      },
      activatedAt: { seconds: 1, nanoseconds: 0 },
      closedAt: null,
    },
  });
}

describe('VEX-02B — assigned-variant correction', () => {
  it('fails closed before writes when a VEX assignment is missing or empty', async () => {
    seedSubmittedSubmission();
    seedVexVerification();
    await expect(openOrLoadCorrection(SUBMISSION_ID, OWNER_UID, fakeDb)).rejects.toThrow(
      /variante assegnata mancante/i,
    );
    expect(mockRunTransaction).not.toHaveBeenCalled();

    seedSubmittedSubmission({ assignedQuestionOrders: [], assignedAnswerKeys: [] });
    await expect(openOrLoadCorrection(SUBMISSION_ID, OWNER_UID, fakeDb)).rejects.toThrow(/vuota/i);
    expect(mockRunTransaction).not.toHaveBeenCalled();
  });

  it.each([null, '', 'future_mode'])(
    'fails closed for malformed distributionMode %p',
    async (distributionMode) => {
      seedSubmittedSubmission({
        assignedQuestionOrders: [0, 1],
        assignedAnswerKeys: ['0', '1'],
      });
      seedVexVerification(distributionMode);
      await expect(openOrLoadCorrection(SUBMISSION_ID, OWNER_UID, fakeDb)).rejects.toThrow(
        /modalit/i,
      );
      expect(mockRunTransaction).not.toHaveBeenCalled();
    },
  );

  it('same_questions with unexpected assignment still uses the complete projection', async () => {
    seedSubmittedSubmission({ assignedQuestionOrders: [0], assignedAnswerKeys: ['0'] });
    seedVerification();
    seedPublishedProjection();
    mockRunTransaction.mockImplementation(async (_db: unknown, fn: (tx: unknown) => unknown) =>
      fn({
        get: vi.fn().mockResolvedValue({ exists: () => false }),
        set: vi.fn(),
      }),
    );
    const { correction } = await openOrLoadCorrection(SUBMISSION_ID, OWNER_UID, fakeDb);
    expect(Object.keys(correction.evaluations)).toEqual(['0', '1']);
  });

  it('openOrLoadCorrection builds the skeleton on the assigned variant only', async () => {
    seedSubmittedSubmission({ assignedQuestionOrders: [0, 1], assignedAnswerKeys: ['0', '1'] });
    seedVexVerification();
    let captured: Record<string, unknown> | undefined;
    mockRunTransaction.mockImplementation(async (_db: unknown, fn: (tx: unknown) => unknown) => {
      const tx = {
        get: vi.fn().mockResolvedValue({ exists: () => false }),
        set: vi.fn((_ref: unknown, data: Record<string, unknown>) => {
          captured = data;
        }),
      };
      return fn(tx);
    });

    const { correction } = await openOrLoadCorrection(SUBMISSION_ID, OWNER_UID, fakeDb);

    expect(Object.keys(correction.evaluations).sort()).toEqual(['0', '1']);
    expect((captured?.evaluations as Record<string, unknown>) ?? {}).toHaveProperty('1');
    expect((captured?.evaluations as Record<string, unknown>) ?? {}).not.toHaveProperty('2');
    expect(correction.maxPoints).toBe(15); // 10 + 5, not the whole bank (20)
  });

  it('save and complete reject an unassigned evaluation before any write', async () => {
    seedSubmittedSubmission({ assignedQuestionOrders: [0, 1], assignedAnswerKeys: ['0', '1'] });
    seedVexVerification();
    seedCorrection({
      evaluations: {
        '0': { order: 0, points: 8, maxPoints: 10 },
        '1': { order: 1, points: 4, maxPoints: 5 },
        '2': { order: 2, points: 4, maxPoints: 5 },
      },
      totalPoints: 16,
      maxPoints: 20,
      percentage: 80,
    });

    await expect(
      saveCorrection(
        {
          submissionId: SUBMISSION_ID,
          evaluations: { '0': { points: 8 }, '1': { points: 4 }, '2': { points: 4 } },
          generalFeedback: null,
        },
        fakeDb,
      ),
    ).rejects.toThrow(/insieme delle domande|estranea|incoerente/i);
    await expect(completeCorrection(SUBMISSION_ID, fakeDb)).rejects.toThrow(
      /insieme delle domande|estranea|incoerente/i,
    );
    expect(mockBatchUpdate).not.toHaveBeenCalled();
    expect(mockUpdateDoc).not.toHaveBeenCalled();
  });

  it('returnCorrection includes only the assigned variant, no unassigned alternative', async () => {
    seedSubmittedSubmission({ assignedQuestionOrders: [0, 1], assignedAnswerKeys: ['0', '1'] });
    seedVexVerification();
    seedDoc(`corrections/${SUBMISSION_ID}`, {
      exists: true,
      data: correctionFixture({
        status: 'completed',
        evaluations: {
          '0': { order: 0, points: 8, maxPoints: 10 },
          '1': { order: 1, points: 4, maxPoints: 5 },
        },
        totalPoints: 12,
        maxPoints: 15,
        percentage: 80,
      }),
    });

    await returnCorrection(SUBMISSION_ID, fakeDb);

    const [, returnDoc] = mockBatchSet.mock.calls[0]!;
    expect(returnDoc.questions.map((q: { order: number }) => q.order)).toEqual([0, 1]);
    expect(returnDoc.questions.some((q: { order: number }) => q.order === 2)).toBe(false);
    expect(returnDoc.maxPoints).toBe(15);
    expect(
      returnDoc.questions.map((question: { correctAnswer: string }) => question.correctAnswer),
    ).toEqual(['sol0', 'sol1']);
    expect(JSON.stringify(returnDoc)).not.toContain('sol2');
  });

  it('setSolutionsVisible reveals solutions only for the assigned VEX questions', async () => {
    seedSubmittedSubmission({ assignedQuestionOrders: [0, 1], assignedAnswerKeys: ['0', '1'] });
    seedVexVerification();
    seedCorrection({
      status: 'returned',
      evaluations: {
        '0': { order: 0, points: 8, maxPoints: 10 },
        '1': { order: 1, points: 4, maxPoints: 5 },
      },
      totalPoints: 12,
      maxPoints: 15,
      percentage: 80,
    });
    seedReturn({
      solutionsVisible: false,
      questions: returnFixture().questions.filter((question) => question.order !== 2),
    });

    await setSolutionsVisible(SUBMISSION_ID, true, fakeDb);

    const [, update] = mockUpdateDoc.mock.calls[0]!;
    expect(update.questions.map((question: { order: number }) => question.order)).toEqual([0, 1]);
    expect(
      update.questions.map((question: { correctAnswer: string }) => question.correctAnswer),
    ).toEqual(['sol0', 'sol1']);
    expect(JSON.stringify(update)).not.toContain('sol2');
  });

  it('VDIF-05 — apertura e scheletro usano solo le domande differenziate assegnate', async () => {
    seedSubmittedSubmission({ assignedQuestionOrders: [0, 2], assignedAnswerKeys: ['0', '2'] });
    seedDifferentiatedVerification();
    let captured: Record<string, unknown> | undefined;
    mockRunTransaction.mockImplementation(async (_db: unknown, fn: (tx: unknown) => unknown) => {
      const tx = {
        get: vi.fn().mockResolvedValue({ exists: () => false }),
        set: vi.fn((_ref: unknown, data: Record<string, unknown>) => {
          captured = data;
        }),
      };
      return fn(tx);
    });

    const { correction } = await openOrLoadCorrection(SUBMISSION_ID, OWNER_UID, fakeDb);

    expect(Object.keys(correction.evaluations).sort()).toEqual(['0', '2']);
    expect(captured?.evaluations).not.toHaveProperty('1');
    expect(correction.maxPoints).toBe(15);
    expect(JSON.stringify(correction)).not.toContain('PDP_SEGRETO_ROSSO_7F91');
  });

  it('VDIF-05 — restituzione include solo il percorso assegnato e nessun metadato privato', async () => {
    seedSubmittedSubmission({
      assignedQuestionOrders: [0, 2],
      assignedAnswerKeys: ['0', '2'],
      answers: {
        '0': { tipo: 'aperta', testo: 'Risposta comune' },
        '2': { tipo: 'aperta', testo: 'Risposta alternativa' },
      },
    });
    seedDifferentiatedVerification();
    seedDoc(`corrections/${SUBMISSION_ID}`, {
      exists: true,
      data: correctionFixture({
        status: 'completed',
        evaluations: {
          '0': { order: 0, points: 8, maxPoints: 10 },
          '2': { order: 2, points: 4, maxPoints: 5 },
        },
        totalPoints: 12,
        maxPoints: 15,
        percentage: 80,
      }),
    });

    await returnCorrection(SUBMISSION_ID, fakeDb);

    const [, returnDoc] = mockBatchSet.mock.calls[0]!;
    expect(returnDoc.questions.map((question: { order: number }) => question.order)).toEqual([
      0, 2,
    ]);
    expect(JSON.stringify(returnDoc)).toContain('sol0');
    expect(JSON.stringify(returnDoc)).toContain('sol2');
    expect(JSON.stringify(returnDoc)).not.toContain('Base riservata');
    expect(JSON.stringify(returnDoc)).not.toContain('sol1');
    expect(JSON.stringify(returnDoc)).not.toContain('PDP_SEGRETO_ROSSO_7F91');
    expect(JSON.stringify(returnDoc)).not.toMatch(/labelId|labelName|differentiation/i);
  });
});
