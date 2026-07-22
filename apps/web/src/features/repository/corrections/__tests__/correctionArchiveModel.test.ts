import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  CorrectionDoc,
  SubmissionDoc,
  VerificationDoc,
  VerificationTeacherQuestionSnapshot,
} from '../../../../types/firestore.js';
import {
  buildCorrectionArchiveModel,
  formatArchiveAnswer,
  loadCorrectionArchiveModel,
  loadCorrectionArchiveModels,
} from '../correctionArchiveModel.js';

const firestoreMocks = vi.hoisted(() => ({ doc: vi.fn(), getDoc: vi.fn() }));
vi.mock('firebase/firestore', () => ({
  doc: (...args: unknown[]) => firestoreMocks.doc(...args),
  getDoc: (...args: unknown[]) => firestoreMocks.getDoc(...args),
}));

const ownerUid = 'owner-private';
const studentUid = 'student-private';
const submissionId = 'verification-private_student-private';
const verificationId = 'verification-private';

function question(
  order: number,
  overrides: Partial<VerificationTeacherQuestionSnapshot> = {},
): VerificationTeacherQuestionSnapshot {
  return {
    order,
    tipo: 'aperta',
    difficolta: 4,
    maxPoints: 4,
    testo: `Domanda ${order}`,
    soluzione: `Soluzione segreta ${order}`,
    ...overrides,
  };
}

const questions = [
  question(0),
  question(1, {
    tipo: 'chiusa_singola',
    difficolta: 2,
    maxPoints: 2,
    opzioni: [
      { id: 'a', testo: 'Opzione alfa' },
      { id: 'b', testo: 'Opzione beta' },
    ],
    soluzione: ['a'],
  }),
  question(2, {
    tipo: 'chiusa_multipla',
    difficolta: 3,
    maxPoints: 3,
    opzioni: [
      { id: 'x', testo: 'Opzione x' },
      { id: 'y', testo: 'Opzione y' },
    ],
    soluzione: ['x', 'y'],
  }),
];

function verification(overrides: Record<string, unknown> = {}): VerificationDoc {
  return {
    ownerUid,
    status: 'active',
    config: {} as never,
    teacherSnapshot: {
      title: 'Verifica archivio',
      classId: 'class-private',
      className: '3A',
      programId: 'program-private',
      importId: 'import-private',
      questionRefs: [],
      questions,
      distributionMode: 'same_questions',
      activatedAt: { seconds: 1, nanoseconds: 0 } as never,
      ...overrides,
    },
    createdAt: {} as never,
    updatedAt: {} as never,
    activatedAt: {} as never,
    closedAt: null,
  };
}

function submission(overrides: Partial<SubmissionDoc> = {}): SubmissionDoc {
  return {
    submissionId,
    verificationId,
    studentUid,
    ownerUid,
    status: 'submitted',
    answers: {
      '0': { tipo: 'aperta', testo: 'Risposta aperta completa' },
      '1': { tipo: 'chiusa_singola', selectedId: 'a' },
      '2': { tipo: 'chiusa_multipla', selectedIds: ['x', 'y'] },
    },
    flagged: {},
    attentionEvents: [],
    deliveryCode: 'PRIVATE-CODE',
    verificationTitle: 'Verifica archivio',
    className: '3A',
    startedAt: {} as never,
    lastSavedAt: {} as never,
    submittedAt: { seconds: 1_721_034_600, nanoseconds: 0 } as never,
    ...overrides,
  };
}

function correction(overrides: Partial<CorrectionDoc> = {}): CorrectionDoc {
  return {
    submissionId,
    verificationId,
    studentUid,
    ownerUid,
    status: 'completed',
    evaluations: {
      '0': { order: 0, points: 3, maxPoints: 4, feedback: 'Approfondisci il secondo punto.' },
      '1': { order: 1, points: 2, maxPoints: 2 },
      '2': { order: 2, points: 2.5, maxPoints: 3 },
    },
    generalFeedback: 'Buona prova complessiva.',
    totalPoints: 7.5,
    maxPoints: 9,
    percentage: 83,
    createdAt: {} as never,
    updatedAt: {} as never,
    completedAt: {} as never,
    returnedAt: null,
    reopenCount: 0,
    ...overrides,
  };
}

function build(
  overrides: {
    verification?: VerificationDoc;
    submission?: SubmissionDoc;
    correction?: CorrectionDoc;
  } = {},
) {
  return buildCorrectionArchiveModel({
    verificationId,
    verification: overrides.verification ?? verification(),
    ownerUid,
    candidate: { submissionId, studentUid, studentName: 'Anna Bianchi' },
    submission: overrides.submission ?? submission(),
    correction: overrides.correction ?? correction(),
  });
}

describe('correctionArchiveModel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('builds a closed same_questions model and resolves frozen option labels', () => {
    const model = build();
    expect(model.questions.map((entry) => entry.answerText)).toEqual([
      'Risposta aperta completa',
      'Opzione alfa',
      '• Opzione x\n• Opzione y',
    ]);
    expect(model.questions[0]).not.toHaveProperty('options');
    expect(model.questions[0]).not.toHaveProperty('correctAnswerText');
    expect(model.questions[1]).toMatchObject({
      options: [
        { text: 'Opzione alfa', selected: true },
        { text: 'Opzione beta', selected: false },
      ],
      correctAnswerText: 'Opzione alfa',
    });
    expect(model.questions[2]).toMatchObject({
      options: [
        { text: 'Opzione x', selected: true },
        { text: 'Opzione y', selected: true },
      ],
      correctAnswerText: 'Opzione x\nOpzione y',
    });
    expect(model.correctionStatus).toBe('completed');
    expect(JSON.stringify(model)).not.toMatch(
      /Soluzione segreta 0|PRIVATE-CODE|owner-private|student-private|verification-private|"id":/,
    );
  });

  it('uses only the canonically assigned VEX questions and rejects foreign answers', () => {
    const vexVerification = verification({
      distributionMode: 'equivalent_variants',
      commonQuestionOrders: [0],
      equivalentGroups: [{ id: 'g1', alternativeOrders: [1, 2] }],
    });
    const vexSubmission = submission({
      assignedQuestionOrders: [0, 2],
      assignedAnswerKeys: ['0', '2'],
      answers: {
        '0': { tipo: 'aperta', testo: 'Risposta aperta completa' },
        '2': { tipo: 'chiusa_multipla', selectedIds: ['x'] },
      },
    });
    const vexCorrection = correction({
      status: 'returned',
      evaluations: {
        '0': { order: 0, points: 3, maxPoints: 4 },
        '2': { order: 2, points: 2, maxPoints: 3 },
      },
      totalPoints: 5,
      maxPoints: 7,
      percentage: 71,
      returnedAt: {} as never,
    });
    const model = build({
      verification: vexVerification,
      submission: vexSubmission,
      correction: vexCorrection,
    });
    expect(model.questions.map((entry) => entry.order)).toEqual([0, 2]);
    expect(JSON.stringify(model)).not.toContain('Opzione alfa');
    expect(model.questions[1]).toMatchObject({
      options: [
        { text: 'Opzione x', selected: true },
        { text: 'Opzione y', selected: false },
      ],
      correctAnswerText: 'Opzione x\nOpzione y',
    });

    expect(() =>
      build({
        verification: vexVerification,
        submission: {
          ...vexSubmission,
          answers: { ...vexSubmission.answers, '1': { tipo: 'chiusa_singola', selectedId: 'a' } },
        },
        correction: vexCorrection,
      }),
    ).toThrow(/non coerenti/);
  });

  it('accepts returned and rejects non-exportable or incomplete corrections', () => {
    expect(
      build({ correction: correction({ status: 'returned', returnedAt: {} as never }) })
        .correctionStatus,
    ).toBe('returned');
    expect(() => build({ correction: correction({ status: 'in_progress' }) })).toThrow();
    expect(() =>
      build({
        correction: correction({ evaluations: { '0': { order: 0, points: 3, maxPoints: 4 } } }),
      }),
    ).toThrow();
  });

  it('fails closed on a missing snapshot, inconsistent totals, or foreign option IDs', () => {
    expect(() => build({ verification: { ...verification(), teacherSnapshot: null } })).toThrow();
    expect(() => build({ correction: correction({ totalPoints: 8 }) })).toThrow();
    expect(() =>
      build({
        submission: submission({
          answers: {
            ...submission().answers,
            '1': { tipo: 'chiusa_singola', selectedId: 'foreign' },
          },
        }),
      }),
    ).toThrow();
  });

  it('renders unanswered values and rejects duplicate multiple-choice IDs', () => {
    expect(formatArchiveAnswer(questions[0]!, undefined)).toBe('Nessuna risposta');
    expect(formatArchiveAnswer(questions[1]!, { tipo: 'chiusa_singola', selectedId: null })).toBe(
      'Nessuna risposta',
    );
    expect(() =>
      formatArchiveAnswer(questions[2]!, {
        tipo: 'chiusa_multipla',
        selectedIds: ['x', 'x'],
      }),
    ).toThrow();
  });

  it('loads at most three selected submissions concurrently and preserves row order', async () => {
    let active = 0;
    let peak = 0;
    const candidates = Array.from({ length: 7 }, (_, index) => ({
      submissionId: `sub-${index}`,
      studentUid: `student-${index}`,
      studentName: `Studente ${index}`,
    }));
    const loadOne = async ({ candidate }: { candidate: (typeof candidates)[number] }) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active -= 1;
      return { ...build(), studentName: candidate.studentName };
    };
    const result = await loadCorrectionArchiveModels({
      verificationId,
      verification: verification(),
      ownerUid,
      candidates,
      db: {} as never,
      loadOne: loadOne as never,
    });
    expect(peak).toBe(3);
    expect(result.models.map((entry) => entry.model.studentName)).toEqual(
      candidates.map((entry) => entry.studentName),
    );
  });

  it('performs exactly the two authoritative point reads and no write surface', async () => {
    firestoreMocks.doc.mockImplementation((_db, collection: string, id: string) => ({
      path: `${collection}/${id}`,
    }));
    firestoreMocks.getDoc.mockImplementation(async (ref: { path: string }) => ({
      exists: () => true,
      data: () => (ref.path.startsWith('submissions/') ? submission() : correction()),
    }));
    const model = await loadCorrectionArchiveModel({
      verificationId,
      verification: verification(),
      ownerUid,
      candidate: { submissionId, studentUid, studentName: 'Anna Bianchi' },
      db: {} as never,
    });
    expect(model.studentName).toBe('Anna Bianchi');
    expect(firestoreMocks.doc.mock.calls.map((call) => call.slice(1))).toEqual([
      ['submissions', submissionId],
      ['corrections', submissionId],
    ]);
    expect(firestoreMocks.getDoc).toHaveBeenCalledTimes(2);
  });
});
