import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MockAiGrader, type AiGrader, type AiGraderOutput } from './aiCorrectionGatewayCore.js';
import {
  classifySubmission,
  computeSelectionHash,
  estimateOpenTokensForSubmission,
  runExecution,
  runPreview,
  sameIdSet,
  scoreClosedQuestion,
  validateGraderOutput,
  RUN_LEASE_MS,
  type BeginRunResult,
  type CommitSubmissionInput,
  type CommitSubmissionResult,
  type CorrectionData,
  type EngineWritePorts,
  type ExistingEvaluation,
  type PersistedRun,
  type SubmissionData,
  type TeacherQuestion,
  type ValidatedScore,
  type VerificationData,
} from './aiCorrectionEngine.js';

const OWNER = 'owner-uid';
const VERIF = 'verif-1';
const REQ = 'req-abcdef01';
const SOL_MARK = 'SOLUZIONE_SEGRETA_XYZ';
const ANS_MARK = 'RISPOSTA_STUDENTE_XYZ';
const Q_MARK = 'TESTO_DOMANDA_XYZ';

function sid(student: string): string {
  return `${VERIF}_${student}`;
}

function tq(
  order: number,
  tipo: TeacherQuestion['tipo'],
  maxPoints: number,
  soluzione: string | string[],
): TeacherQuestion {
  return { order, tipo, maxPoints, testo: `${Q_MARK}-${order}`, soluzione };
}

// ── In-memory ports (faithful implementation of the wiring contract) ──────────

class FakeStore implements EngineWritePorts {
  verification: VerificationData | null = null;
  submissions = new Map<string, SubmissionData>();
  corrections = new Map<string, CorrectionData>();
  runs = new Map<
    string,
    {
      status: 'running' | 'completed' | 'partial' | 'failed';
      selectionHash: string;
      response?: unknown;
      executionId?: string;
      leaseExpiresAt?: number;
    }
  >();
  mirror = new Map<
    string,
    {
      correctionStatus: string;
      correctionSummary: { totalPoints: number; maxPoints: number; percentage: number | null };
    }
  >();
  events: unknown[] = [];

  loadVerificationCalls = 0;
  commitCalls = 0;

  loadVerification = async (): Promise<VerificationData | null> => {
    this.loadVerificationCalls++;
    return this.verification;
  };
  loadSubmission = async (id: string): Promise<SubmissionData | null> =>
    this.submissions.get(id) ?? null;
  loadCorrection = async (id: string): Promise<CorrectionData | null> => {
    const c = this.corrections.get(id);
    return c
      ? { status: c.status, evaluations: { ...c.evaluations }, reopenCount: c.reopenCount }
      : null;
  };

  beginRun: EngineWritePorts['beginRun'] = async (requestId, meta) => {
    const existing = this.runs.get(requestId);
    const nowMs = Date.now();
    const acquire = (): BeginRunResult => {
      this.runs.set(requestId, {
        ...(existing ?? {}),
        status: 'running',
        selectionHash: meta.selectionHash,
        executionId: meta.executionId,
        leaseExpiresAt: nowMs + meta.leaseMs,
      });
      return { state: 'acquired', executionId: meta.executionId };
    };
    if (!existing) return acquire();
    if (existing.selectionHash !== meta.selectionHash) return { state: 'conflict' };
    if (
      (existing.status === 'completed' ||
        existing.status === 'partial' ||
        existing.status === 'failed') &&
      existing.response
    ) {
      return {
        state: 'completed',
        existing: {
          status: existing.status,
          selectionHash: existing.selectionHash,
          response: existing.response as PersistedRun['response'],
        },
      };
    }
    if (existing.status === 'running' && (existing.leaseExpiresAt ?? 0) > nowMs) {
      return { state: 'locked' };
    }
    return acquire();
  };

  finishRun: EngineWritePorts['finishRun'] = async (requestId, run) => {
    const existing = this.runs.get(requestId);
    if (!existing) return;
    if (existing.executionId !== run.executionId) return; // takeover → no-op
    this.runs.set(requestId, {
      ...existing,
      status: run.status,
      selectionHash: run.selectionHash,
      response: run.response,
      leaseExpiresAt: 0,
    });
  };

  commitSubmission = async (input: CommitSubmissionInput): Promise<CommitSubmissionResult> => {
    this.commitCalls++;
    const existing = this.corrections.get(input.submissionId);
    if (!existing) {
      const evaluations: Record<string, ExistingEvaluation> = {};
      for (const q of input.skeleton) {
        evaluations[q.order.toString()] = { order: q.order, points: null, maxPoints: q.maxPoints };
      }
      const written = this.apply(evaluations, input.proposed);
      this.corrections.set(input.submissionId, {
        status: 'in_progress',
        evaluations,
        reopenCount: 0,
      });
      this.setMirror(input.submissionId, evaluations);
      return { result: 'written', writtenOrders: written };
    }
    if (existing.status !== 'in_progress') return { result: 'changed', writtenOrders: [] };
    const evaluations = { ...existing.evaluations };
    const written = this.apply(evaluations, input.proposed);
    existing.evaluations = evaluations;
    this.setMirror(input.submissionId, evaluations);
    if (existing.reopenCount > 0 && written.length > 0) {
      this.events.push({
        type: 'scoreAdjusted',
        correctionId: input.submissionId,
        orders: written,
      });
    }
    return { result: 'written', writtenOrders: written };
  };

  private apply(
    evaluations: Record<string, ExistingEvaluation>,
    proposed: Map<number, ValidatedScore>,
  ): number[] {
    const written: number[] = [];
    for (const [order, score] of proposed) {
      const key = order.toString();
      const cur = evaluations[key];
      if (!cur || cur.points !== null) continue;
      evaluations[key] = {
        order: cur.order,
        maxPoints: cur.maxPoints,
        points: score.points,
        ...(score.feedback !== undefined ? { feedback: score.feedback } : {}),
      };
      written.push(order);
    }
    return written;
  }

  private setMirror(id: string, evaluations: Record<string, ExistingEvaluation>): void {
    let totalPoints = 0;
    let maxPoints = 0;
    for (const e of Object.values(evaluations)) {
      if (e.points !== null) totalPoints += e.points;
      maxPoints += e.maxPoints;
    }
    const percentage = maxPoints > 0 ? Math.round((totalPoints / maxPoints) * 100) : null;
    const status = Object.values(evaluations).some((e) => e.points !== null)
      ? 'in_progress'
      : 'submitted';
    this.mirror.set(id, {
      correctionStatus: status,
      correctionSummary: { totalPoints, maxPoints, percentage },
    });
  }
}

function baseDeps(store: FakeStore, grader: AiGrader) {
  return {
    callerUid: OWNER,
    getOwnerUid: async () => OWNER,
    featureMode: 'mock' as const,
    ports: store,
    grader,
  };
}

function req(submissionIds: string[], overrides: Record<string, unknown> = {}) {
  return { verificationId: VERIF, submissionIds, requestId: REQ, ...overrides };
}

let fetchSpy: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchSpy = vi.fn(() => Promise.reject(new Error('no network in M5-02')));
  vi.stubGlobal('fetch', fetchSpy);
});
afterEach(() => vi.unstubAllGlobals());

// ── Pure helpers ──────────────────────────────────────────────────────────────

describe('scoreClosedQuestion — chiusa_singola', () => {
  const q = tq(0, 'chiusa_singola', 2, 'opt-b');
  it('correct → maxPoints', () => {
    expect(scoreClosedQuestion(q, { tipo: 'chiusa_singola', selectedId: 'opt-b' })).toBe(2);
  });
  it('wrong → 0', () => {
    expect(scoreClosedQuestion(q, { tipo: 'chiusa_singola', selectedId: 'opt-a' })).toBe(0);
  });
  it('empty (null) → 0', () => {
    expect(scoreClosedQuestion(q, { tipo: 'chiusa_singola', selectedId: null })).toBe(0);
  });
  it('missing answer → 0', () => {
    expect(scoreClosedQuestion(q, undefined)).toBe(0);
  });
});

describe('scoreClosedQuestion — chiusa_multipla', () => {
  const q = tq(0, 'chiusa_multipla', 3, ['a', 'b', 'c']);
  it('exact set → maxPoints', () => {
    expect(scoreClosedQuestion(q, { tipo: 'chiusa_multipla', selectedIds: ['a', 'b', 'c'] })).toBe(
      3,
    );
  });
  it('reordered set → maxPoints', () => {
    expect(scoreClosedQuestion(q, { tipo: 'chiusa_multipla', selectedIds: ['c', 'a', 'b'] })).toBe(
      3,
    );
  });
  it('incomplete → 0', () => {
    expect(scoreClosedQuestion(q, { tipo: 'chiusa_multipla', selectedIds: ['a', 'b'] })).toBe(0);
  });
  it('extra option → 0', () => {
    expect(
      scoreClosedQuestion(q, { tipo: 'chiusa_multipla', selectedIds: ['a', 'b', 'c', 'd'] }),
    ).toBe(0);
  });
  it('wrong → 0', () => {
    expect(scoreClosedQuestion(q, { tipo: 'chiusa_multipla', selectedIds: ['x', 'y', 'z'] })).toBe(
      0,
    );
  });
  it('empty → 0', () => {
    expect(scoreClosedQuestion(q, { tipo: 'chiusa_multipla', selectedIds: [] })).toBe(0);
  });
  it('sameIdSet dedupes', () => {
    expect(sameIdSet(['a', 'a', 'b'], ['b', 'a'])).toBe(true);
  });
});

describe('validateGraderOutput', () => {
  const orders = new Set([0, 1, 2, 3]);
  const maxByOrder = new Map([
    [0, 2],
    [1, 3],
    [2, 2],
    [3, 3],
  ]);
  const out = (results: unknown[], requestId = REQ): AiGraderOutput =>
    ({ requestId, results }) as unknown as AiGraderOutput;

  it('accepts valid results', () => {
    const v = validateGraderOutput(
      out([
        { order: 0, points: 1.5 },
        { order: 1, points: 3 },
      ]),
      REQ,
      orders,
      maxByOrder,
    );
    expect(v.get(0)).toEqual({ points: 1.5 });
    expect(v.get(1)).toEqual({ points: 3 });
  });
  it('rejects the whole output on requestId mismatch', () => {
    expect(
      validateGraderOutput(out([{ order: 0, points: 1 }], 'other'), REQ, orders, maxByOrder).size,
    ).toBe(0);
  });
  it('drops out-of-range / non-quarter / NaN / foreign / duplicate, keeps valid', () => {
    const v = validateGraderOutput(
      out([
        { order: 0, points: 5 }, // out of range
        { order: 1, points: 1.1 }, // non-quarter
        { order: 2, points: Number.NaN }, // NaN
        { order: 9, points: 1 }, // foreign order
        { order: 3, points: 2 }, // valid
        { order: 3, points: 1 }, // duplicate of a valid → ignored
      ]),
      REQ,
      orders,
      maxByOrder,
    );
    expect(v.has(0)).toBe(false);
    expect(v.has(1)).toBe(false);
    expect(v.has(2)).toBe(false);
    expect(v.get(3)).toEqual({ points: 2 });
    expect(v.size).toBe(1);
  });
  it('drops over-long feedback', () => {
    const v = validateGraderOutput(
      out([{ order: 0, points: 1, feedback: 'x'.repeat(5000) }]),
      REQ,
      orders,
      maxByOrder,
    );
    expect(v.has(0)).toBe(false);
  });
});

describe('classifySubmission', () => {
  const questions = [tq(0, 'chiusa_singola', 1, 'a'), tq(1, 'aperta', 2, SOL_MARK)];
  const sub = (overrides: Partial<SubmissionData> = {}): SubmissionData => ({
    ownerUid: OWNER,
    verificationId: VERIF,
    studentUid: 's1',
    status: 'submitted',
    answers: {},
    ...overrides,
  });
  const base = {
    submissionId: sid('s1'),
    expectedOwner: OWNER,
    expectedVerificationId: VERIF,
    teacherQuestions: questions,
  };

  it('excludes a missing submission', () => {
    expect(classifySubmission({ ...base, submission: null, correction: null })).toMatchObject({
      status: 'excluded',
      code: 'not_found',
    });
  });
  it('excludes wrong owner / wrong verification / not submitted', () => {
    expect(
      classifySubmission({ ...base, submission: sub({ ownerUid: 'x' }), correction: null }).status,
    ).toBe('excluded');
    expect(
      classifySubmission({
        ...base,
        submission: sub({ verificationId: 'other' }),
        correction: null,
      }),
    ).toMatchObject({ code: 'wrong_verification' });
    expect(
      classifySubmission({ ...base, submission: sub({ status: 'draft' }), correction: null }),
    ).toMatchObject({
      code: 'not_submitted',
    });
  });
  it('excludes when snapshot unavailable', () => {
    expect(
      classifySubmission({ ...base, teacherQuestions: null, submission: sub(), correction: null }),
    ).toMatchObject({ code: 'snapshot_unavailable' });
  });
  it('excludes a completed/returned correction', () => {
    const correction: CorrectionData = { status: 'completed', evaluations: {}, reopenCount: 0 };
    expect(classifySubmission({ ...base, submission: sub(), correction }).status).toBe('excluded');
  });
  it('excludes when nothing left to grade (all already graded)', () => {
    const correction: CorrectionData = {
      status: 'in_progress',
      reopenCount: 0,
      evaluations: {
        '0': { order: 0, points: 1, maxPoints: 1 },
        '1': { order: 1, points: 2, maxPoints: 2 },
      },
    };
    expect(classifySubmission({ ...base, submission: sub(), correction })).toMatchObject({
      code: 'nothing_to_grade',
    });
  });
  it('eligible: counts closed/open/alreadyGraded, absent correction', () => {
    const c = classifySubmission({ ...base, submission: sub(), correction: null });
    expect(c.status).toBe('eligible');
    if (c.status !== 'eligible') return;
    expect(c.eligible.closedOrders).toEqual([0]);
    expect(c.eligible.openOrders).toEqual([1]);
    expect(c.eligible.alreadyGraded).toBe(0);
  });
});

// ── runPreview ────────────────────────────────────────────────────────────────

function seedOneOpenOneClosed(store: FakeStore, student = 's1') {
  store.verification = {
    ownerUid: OWNER,
    status: 'active',
    teacherQuestions: [tq(0, 'chiusa_singola', 2, 'a'), tq(1, 'aperta', 2, SOL_MARK)],
  };
  store.submissions.set(sid(student), {
    ownerUid: OWNER,
    verificationId: VERIF,
    studentUid: student,
    status: 'submitted',
    answers: {
      '0': { tipo: 'chiusa_singola', selectedId: 'a' },
      '1': { tipo: 'aperta', testo: ANS_MARK },
    },
  });
}

describe('runPreview', () => {
  it('rejects unauthenticated / non-owner / disabled without reading data', async () => {
    const store = new FakeStore();
    const grader = new MockAiGrader();
    await expect(
      runPreview(req([sid('s1')]), { ...baseDeps(store, grader), callerUid: null }),
    ).rejects.toMatchObject({
      code: 'unauthenticated',
    });
    await expect(
      runPreview(req([sid('s1')]), { ...baseDeps(store, grader), callerUid: 'intruder' }),
    ).rejects.toMatchObject({ code: 'not_owner' });
    await expect(
      runPreview(req([sid('s1')]), { ...baseDeps(store, grader), featureMode: 'disabled' }),
    ).rejects.toMatchObject({ code: 'feature_disabled' });
  });

  it('counts eligible/excluded and estimates tokens without writing or grading', async () => {
    const store = new FakeStore();
    seedOneOpenOneClosed(store, 's1');
    const graderSpy = { id: 'mock', grade: vi.fn() } as unknown as AiGrader;
    const res = await runPreview(req([sid('s1'), sid('missing')]), baseDeps(store, graderSpy));
    expect(res.mode).toBe('mock');
    expect(res.costEstimated).toBe(0);
    expect(res.counts.eligible).toBe(1);
    expect(res.counts.excluded).toBe(1);
    expect(res.counts.closedToGrade).toBe(1);
    expect(res.counts.openToGrade).toBe(1);
    expect(res.tokensEstimated).toBeGreaterThan(0);
    expect(
      (graderSpy as unknown as { grade: ReturnType<typeof vi.fn> }).grade,
    ).not.toHaveBeenCalled();
    expect(store.commitCalls).toBe(0);
    expect(store.runs.size).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('counts a closed-only submission as eligible', async () => {
    const store = new FakeStore();
    store.verification = {
      ownerUid: OWNER,
      status: 'active',
      teacherQuestions: [tq(0, 'chiusa_singola', 1, 'a')],
    };
    store.submissions.set(sid('s1'), {
      ownerUid: OWNER,
      verificationId: VERIF,
      studentUid: 's1',
      status: 'submitted',
      answers: { '0': { tipo: 'chiusa_singola', selectedId: 'a' } },
    });
    const res = await runPreview(req([sid('s1')]), baseDeps(store, new MockAiGrader()));
    expect(res.counts.closedOnlySubmissions).toBe(1);
    expect(res.counts.openToGrade).toBe(0);
    expect(res.tokensEstimated).toBe(0);
  });
});

// ── runExecution ──────────────────────────────────────────────────────────────

describe('runExecution — closed scoring + open grading', () => {
  it('grades closed deterministically and open via a single grader call per submission', async () => {
    const store = new FakeStore();
    store.verification = {
      ownerUid: OWNER,
      status: 'active',
      teacherQuestions: [
        tq(0, 'chiusa_singola', 2, 'a'),
        tq(1, 'aperta', 2, SOL_MARK),
        tq(2, 'aperta', 3, SOL_MARK),
      ],
    };
    store.submissions.set(sid('s1'), {
      ownerUid: OWNER,
      verificationId: VERIF,
      studentUid: 's1',
      status: 'submitted',
      answers: {
        '0': { tipo: 'chiusa_singola', selectedId: 'a' },
        '1': { tipo: 'aperta', testo: ANS_MARK },
        '2': { tipo: 'aperta', testo: ANS_MARK },
      },
    });
    const grade = vi.fn(
      (input: { requestId: string; questions: { order: number; maxPoints: number }[] }) =>
        Promise.resolve({
          requestId: input.requestId,
          results: input.questions.map((q) => ({ order: q.order, points: q.maxPoints })),
        }),
    );
    const grader = { id: 'mock', grade } as unknown as AiGrader;

    const res = await runExecution(req([sid('s1')]), baseDeps(store, grader));
    expect(grade).toHaveBeenCalledTimes(1); // one call for BOTH open questions
    expect(grade.mock.calls[0]![0].questions).toHaveLength(2);
    expect(res.status).toBe('completed');
    expect(res.results[0]).toMatchObject({ outcome: 'succeeded', closedGraded: 1, openGraded: 2 });

    const correction = store.corrections.get(sid('s1'))!;
    expect(correction.evaluations['0']!.points).toBe(2);
    expect(correction.evaluations['1']!.points).toBe(2);
    expect(correction.evaluations['2']!.points).toBe(3);
    // mirror coherent: total 7 / 7
    expect(store.mirror.get(sid('s1'))!.correctionSummary).toMatchObject({
      totalPoints: 7,
      maxPoints: 7,
      percentage: 100,
    });
    expect(store.mirror.get(sid('s1'))!.correctionStatus).toBe('in_progress');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('never overwrites an already-graded question', async () => {
    const store = new FakeStore();
    store.verification = {
      ownerUid: OWNER,
      status: 'active',
      teacherQuestions: [tq(0, 'chiusa_singola', 2, 'a'), tq(1, 'aperta', 2, SOL_MARK)],
    };
    store.submissions.set(sid('s1'), {
      ownerUid: OWNER,
      verificationId: VERIF,
      studentUid: 's1',
      status: 'submitted',
      answers: {
        '0': { tipo: 'chiusa_singola', selectedId: 'a' },
        '1': { tipo: 'aperta', testo: ANS_MARK },
      },
    });
    // Pre-existing correction with q0 already graded by the teacher (0.25).
    store.corrections.set(sid('s1'), {
      status: 'in_progress',
      reopenCount: 0,
      evaluations: {
        '0': { order: 0, points: 0.25, maxPoints: 2 },
        '1': { order: 1, points: null, maxPoints: 2 },
      },
    });
    const grader = {
      id: 'mock',
      grade: async (i: { requestId: string }) => ({
        requestId: i.requestId,
        results: [{ order: 1, points: 2 }],
      }),
    } as unknown as AiGrader;

    const res = await runExecution(req([sid('s1')]), baseDeps(store, grader));
    const correction = store.corrections.get(sid('s1'))!;
    expect(correction.evaluations['0']!.points).toBe(0.25); // untouched
    expect(correction.evaluations['1']!.points).toBe(2);
    expect(res.results[0]).toMatchObject({ closedGraded: 0, openGraded: 1, alreadyIgnored: 1 });
  });

  it('reports partial when some open results are invalid, without corrupting the correction', async () => {
    const store = new FakeStore();
    store.verification = {
      ownerUid: OWNER,
      status: 'active',
      teacherQuestions: [tq(0, 'aperta', 2, SOL_MARK), tq(1, 'aperta', 2, SOL_MARK)],
    };
    store.submissions.set(sid('s1'), {
      ownerUid: OWNER,
      verificationId: VERIF,
      studentUid: 's1',
      status: 'submitted',
      answers: {
        '0': { tipo: 'aperta', testo: ANS_MARK },
        '1': { tipo: 'aperta', testo: ANS_MARK },
      },
    });
    const grader = {
      id: 'mock',
      grade: async (i: { requestId: string }) => ({
        requestId: i.requestId,
        results: [
          { order: 0, points: 1 },
          { order: 1, points: 99 },
        ], // order 1 out of range
      }),
    } as unknown as AiGrader;

    const res = await runExecution(req([sid('s1')]), baseDeps(store, grader));
    expect(res.status).toBe('partial');
    expect(res.results[0]).toMatchObject({ outcome: 'partial', openGraded: 1, openSkipped: 1 });
    const correction = store.corrections.get(sid('s1'))!;
    expect(correction.evaluations['0']!.points).toBe(1);
    expect(correction.evaluations['1']!.points).toBeNull();
  });

  it('processes a batch with independent successes and exclusions', async () => {
    const store = new FakeStore();
    store.verification = {
      ownerUid: OWNER,
      status: 'active',
      teacherQuestions: [tq(0, 'chiusa_singola', 1, 'a')],
    };
    store.submissions.set(sid('ok'), {
      ownerUid: OWNER,
      verificationId: VERIF,
      studentUid: 'ok',
      status: 'submitted',
      answers: { '0': { tipo: 'chiusa_singola', selectedId: 'a' } },
    });
    // 'bad' is not submitted → excluded, must not affect 'ok'
    store.submissions.set(sid('bad'), {
      ownerUid: OWNER,
      verificationId: VERIF,
      studentUid: 'bad',
      status: 'draft',
      answers: {},
    });
    const res = await runExecution(
      req([sid('ok'), sid('bad')]),
      baseDeps(store, new MockAiGrader()),
    );
    expect(res.counts.succeeded).toBe(1);
    expect(res.counts.excluded).toBe(1);
    expect(store.corrections.has(sid('ok'))).toBe(true);
    expect(store.corrections.has(sid('bad'))).toBe(false);
  });
});

describe('runExecution — idempotency', () => {
  it('replays a completed run without reprocessing (grader not called again)', async () => {
    const store = new FakeStore();
    seedOneOpenOneClosed(store, 's1');
    const grade = vi.fn(
      (i: { requestId: string; questions: { order: number; maxPoints: number }[] }) =>
        Promise.resolve({
          requestId: i.requestId,
          results: i.questions.map((q) => ({ order: q.order, points: q.maxPoints })),
        }),
    );
    const grader = { id: 'mock', grade } as unknown as AiGrader;
    const first = await runExecution(req([sid('s1')]), baseDeps(store, grader));
    expect(first.idempotentReplay).toBe(false);
    const callsAfterFirst = grade.mock.calls.length;

    const second = await runExecution(req([sid('s1')]), baseDeps(store, grader));
    expect(second.idempotentReplay).toBe(true);
    expect(grade.mock.calls.length).toBe(callsAfterFirst); // no reprocessing
    expect(second.counts).toEqual(first.counts);
  });

  it('rejects the same requestId with a different selection', async () => {
    const store = new FakeStore();
    seedOneOpenOneClosed(store, 's1');
    seedExtra(store, 's2');
    await runExecution(req([sid('s1')]), baseDeps(store, new MockAiGrader()));
    await expect(
      runExecution(req([sid('s1'), sid('s2')]), baseDeps(store, new MockAiGrader())),
    ).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('a retry does not double-write (non-overwrite makes it idempotent)', async () => {
    const store = new FakeStore();
    seedOneOpenOneClosed(store, 's1');
    await runExecution(req([sid('s1')]), baseDeps(store, new MockAiGrader()));
    const before = JSON.stringify(store.corrections.get(sid('s1')));
    // Same requestId → replay path, no new writes.
    await runExecution(req([sid('s1')]), baseDeps(store, new MockAiGrader()));
    expect(JSON.stringify(store.corrections.get(sid('s1')))).toBe(before);
  });
});

describe('runExecution — concurrent idempotency (lease)', () => {
  it('does not re-grade or re-write while another attempt holds a valid lease', async () => {
    const store = new FakeStore();
    seedOneOpenOneClosed(store, 's1');
    // Simulate a first attempt that is still running with a VALID lease.
    store.runs.set(REQ, {
      status: 'running',
      selectionHash: computeSelectionHash(VERIF, [sid('s1')]),
      executionId: 'other-attempt',
      leaseExpiresAt: Date.now() + RUN_LEASE_MS,
    });
    const grade = vi.fn();
    const grader = { id: 'mock', grade } as unknown as AiGrader;

    const res = await runExecution(req([sid('s1')]), baseDeps(store, grader));
    expect(res.status).toBe('running');
    expect(res.idempotentReplay).toBe(true);
    expect(grade).not.toHaveBeenCalled(); // no grader invocation
    expect(store.commitCalls).toBe(0); // no double write
    // The other attempt still owns the run.
    expect(store.runs.get(REQ)!.executionId).toBe('other-attempt');
  });

  it('takes over a run whose lease has expired and processes it', async () => {
    const store = new FakeStore();
    seedOneOpenOneClosed(store, 's1');
    store.runs.set(REQ, {
      status: 'running',
      selectionHash: computeSelectionHash(VERIF, [sid('s1')]),
      executionId: 'crashed-attempt',
      leaseExpiresAt: Date.now() - 1000, // expired
    });
    const res = await runExecution(req([sid('s1')]), baseDeps(store, new MockAiGrader()));
    expect(res.idempotentReplay).toBe(false);
    expect(store.corrections.has(sid('s1'))).toBe(true); // processed
    expect(store.runs.get(REQ)!.status).toBe('completed');
  });

  it('an old worker cannot finalize after a takeover (executionId no longer owns the lease)', async () => {
    const store = new FakeStore();
    const selectionHash = computeSelectionHash(VERIF, [sid('s1')]);
    const meta = {
      ownerUid: OWNER,
      actorUid: OWNER,
      verificationId: VERIF,
      selectionHash,
      submissionCount: 1,
      leaseMs: RUN_LEASE_MS,
    };
    // Attempt A acquires the lease.
    const a = await store.beginRun(REQ, { ...meta, executionId: 'A' });
    expect(a.state).toBe('acquired');
    // A's lease expires; attempt B takes over.
    store.runs.get(REQ)!.leaseExpiresAt = Date.now() - 1;
    const b = await store.beginRun(REQ, { ...meta, executionId: 'B' });
    expect(b.state).toBe('acquired');
    // A (old worker) tries to finalize → must be a no-op.
    await store.finishRun(REQ, {
      status: 'completed',
      selectionHash,
      response: undefined,
      executionId: 'A',
    });
    expect(store.runs.get(REQ)!.status).toBe('running');
    expect(store.runs.get(REQ)!.executionId).toBe('B');
    // B finalizes → applied.
    await store.finishRun(REQ, {
      status: 'completed',
      selectionHash,
      response: undefined,
      executionId: 'B',
    });
    expect(store.runs.get(REQ)!.status).toBe('completed');
  });
});

describe('token estimation and consumption', () => {
  const questions = [tq(0, 'aperta', 3, SOL_MARK)];

  it('a longer student answer increases tokensEstimated (question + solution + answer)', () => {
    const short = estimateOpenTokensForSubmission(questions, [0], {
      '0': { tipo: 'aperta', testo: 'x' },
    });
    const long = estimateOpenTokensForSubmission(questions, [0], {
      '0': { tipo: 'aperta', testo: 'x'.repeat(400) },
    });
    expect(long).toBeGreaterThan(short);
  });

  it('preview and run produce the same tokensEstimated for the same selection', async () => {
    const store = new FakeStore();
    seedOneOpenOneClosed(store, 's1');
    const preview = await runPreview(req([sid('s1')]), baseDeps(store, new MockAiGrader()));
    const run = await runExecution(req([sid('s1')]), baseDeps(store, new MockAiGrader()));
    expect(preview.tokensEstimated).toBeGreaterThan(0);
    expect(run.tokensEstimated).toBe(preview.tokensEstimated);
  });

  it('MockAiGrader yields tokensActual == 0 (no real tokens consumed)', async () => {
    const store = new FakeStore();
    seedOneOpenOneClosed(store, 's1');
    const run = await runExecution(req([sid('s1')]), baseDeps(store, new MockAiGrader()));
    expect(run.tokensActual).toBe(0);
    expect(run.costActual).toBe(0);
  });
});

function seedExtra(store: FakeStore, student: string) {
  store.submissions.set(sid(student), {
    ownerUid: OWNER,
    verificationId: VERIF,
    studentUid: student,
    status: 'submitted',
    answers: {
      '0': { tipo: 'chiusa_singola', selectedId: 'a' },
      '1': { tipo: 'aperta', testo: ANS_MARK },
    },
  });
}

describe('runExecution — privacy of aiCorrectionRuns', () => {
  it('persists no question text, answer, solution or feedback in the run doc', async () => {
    const store = new FakeStore();
    seedOneOpenOneClosed(store, 's1');
    await runExecution(req([sid('s1')]), baseDeps(store, new MockAiGrader()));
    const serialized = JSON.stringify(store.runs.get(REQ));
    expect(serialized).not.toContain(SOL_MARK);
    expect(serialized).not.toContain(ANS_MARK);
    expect(serialized).not.toContain(Q_MARK);
    expect(serialized).not.toContain('[mock]'); // no mock feedback text
    // metadata present
    expect(serialized).toContain('selectionHash');
    expect(serialized).toContain('completed');
  });

  it('makes no network call across the whole run', async () => {
    const store = new FakeStore();
    seedOneOpenOneClosed(store, 's1');
    await runExecution(req([sid('s1')]), baseDeps(store, new MockAiGrader()));
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
