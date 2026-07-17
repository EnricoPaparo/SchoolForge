import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AiGatewayError,
  AiGraderInvalidOutputError,
  MockAiGrader,
  buildMockGeneralFeedback,
  type AiGrader,
  type AiGraderOutput,
} from './aiCorrectionGatewayCore.js';
import { USD_MICRO, OPENAI_PRODUCTION_MODEL } from './aiCorrectionCost.js';
import {
  emptyLedger,
  availableMicroUsd,
  monthKeyFromMs,
  reserve as reserveLedger,
  reconcile as reconcileLedger,
  type BudgetLedgerState,
} from './aiCorrectionBudget.js';
import {
  AI_RUN_CONTRACT_VERSION,
  canonicalizeSubmissionIds,
  classifySubmission,
  computeSelectionHash,
  estimateOpenTokensForSubmission,
  runExecution,
  runPreview,
  sameIdSet,
  scoreClosedQuestion,
  validateGraderOutput,
  RUN_LEASE_MS,
  RUN_RETENTION_MS,
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
import { OPENAI_PRODUCTION_MODEL } from './aiCorrectionCost.js';

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
  optionIds?: string[],
): TeacherQuestion {
  return {
    order,
    tipo,
    maxPoints,
    testo: `${Q_MARK}-${order}`,
    soluzione,
    ...(optionIds ? { optionIds } : {}),
  };
}

/** Fedele alla porta reale (aiCorrectionGateway): applica il feedback generale
 *  solo se la consegna è interamente valutata e il docente non ne ha già uno. */
function fullyEvaluated(evaluations: Record<string, ExistingEvaluation>): boolean {
  const values = Object.values(evaluations);
  return values.length > 0 && values.every((e) => e.points !== null);
}
function resolveGeneralFeedback(
  evaluations: Record<string, ExistingEvaluation>,
  existing: string | null,
  candidate: string | null,
): string | null {
  if (typeof existing === 'string' && existing.trim().length > 0) return existing;
  if (candidate !== null && fullyEvaluated(evaluations)) return candidate;
  return existing;
}

// ── In-memory ports (faithful implementation of the wiring contract) ──────────

class FakeStore implements EngineWritePorts {
  verification: VerificationData | null = null;
  submissions = new Map<string, SubmissionData>();
  corrections = new Map<string, CorrectionData>();
  // M5-04B: `generalFeedback` per consegna (fedele al campo CorrectionDoc). Può
  // essere pre-seedato per simulare un testo scritto dal docente.
  generalFeedbacks = new Map<string, string | null>();
  runs = new Map<
    string,
    {
      status: 'running' | 'completed' | 'partial' | 'failed';
      runContractVersion?: number;
      selectionHash: string;
      mode?: PersistedRun['mode'];
      counts?: PersistedRun['counts'];
      inputTokensEstimated?: number;
      outputTokensEstimated?: number;
      tokensEstimated?: number;
      costEstimatedMicroUsd?: number;
      inputTokensActual?: number;
      outputTokensActual?: number;
      tokensActual?: number;
      costActualMicroUsd?: number;
      resultOrdinals?: PersistedRun['resultOrdinals'];
      executionId?: string;
      leaseExpiresAt?: number;
      expireAtMs?: number;
    }
  >();
  // M5-05D2B-1 — ledger di budget mensile in-memory (fedele alla porta reale).
  ledgers = new Map<string, BudgetLedgerState>();
  reserveBudgetCalls = 0;
  reconcileBudgetCalls = 0;
  mirror = new Map<
    string,
    {
      correctionStatus: string;
      correctionSummary: { totalPoints: number; maxPoints: number; percentage: number | null };
    }
  >();
  events: unknown[] = [];

  loadVerificationCalls = 0;
  loadSubmissionCalls = 0;
  loadCorrectionCalls = 0;
  commitCalls = 0;

  loadVerification = async (): Promise<VerificationData | null> => {
    this.loadVerificationCalls++;
    return this.verification;
  };
  loadSubmission = async (id: string): Promise<SubmissionData | null> => {
    this.loadSubmissionCalls++;
    return this.submissions.get(id) ?? null;
  };
  loadCorrection = async (id: string): Promise<CorrectionData | null> => {
    this.loadCorrectionCalls++;
    const c = this.corrections.get(id);
    return c
      ? { status: c.status, evaluations: { ...c.evaluations }, reopenCount: c.reopenCount }
      : null;
  };

  beginRun: EngineWritePorts['beginRun'] = async (requestId, meta) => {
    const existing = this.runs.get(requestId);
    const acquire = (): BeginRunResult => {
      this.runs.set(requestId, {
        ...(existing ?? {}),
        runContractVersion: AI_RUN_CONTRACT_VERSION,
        status: 'running',
        selectionHash: meta.selectionHash,
        mode: meta.provider === 'openai' ? 'openai' : 'mock',
        executionId: meta.executionId,
        leaseExpiresAt: meta.nowMs + meta.leaseMs,
        ...(existing ? {} : { expireAtMs: meta.expireAtMs }),
      });
      return { state: 'acquired', executionId: meta.executionId };
    };
    if (!existing) return acquire();
    if (existing.runContractVersion !== AI_RUN_CONTRACT_VERSION) return { state: 'legacy' };
    if (existing.selectionHash !== meta.selectionHash) return { state: 'conflict' };
    if (
      (existing.status === 'completed' ||
        existing.status === 'partial' ||
        existing.status === 'failed') &&
      existing.mode &&
      existing.counts &&
      existing.resultOrdinals
    ) {
      return {
        state: 'completed',
        existing: {
          runContractVersion: AI_RUN_CONTRACT_VERSION,
          status: existing.status,
          selectionHash: existing.selectionHash,
          mode: existing.mode,
          counts: existing.counts,
          inputTokensEstimated: existing.inputTokensEstimated ?? 0,
          outputTokensEstimated: existing.outputTokensEstimated ?? 0,
          tokensEstimated: existing.tokensEstimated ?? 0,
          costEstimatedMicroUsd: existing.costEstimatedMicroUsd ?? 0,
          inputTokensActual: existing.inputTokensActual ?? 0,
          outputTokensActual: existing.outputTokensActual ?? 0,
          tokensActual: existing.tokensActual ?? 0,
          costActualMicroUsd: existing.costActualMicroUsd ?? 0,
          resultOrdinals: existing.resultOrdinals,
        },
      };
    }
    if (existing.status === 'running' && (existing.leaseExpiresAt ?? 0) > meta.nowMs) {
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
      runContractVersion: run.runContractVersion,
      selectionHash: run.selectionHash,
      mode: run.mode,
      counts: run.counts,
      inputTokensEstimated: run.inputTokensEstimated,
      outputTokensEstimated: run.outputTokensEstimated,
      tokensEstimated: run.tokensEstimated,
      costEstimatedMicroUsd: run.costEstimatedMicroUsd,
      inputTokensActual: run.inputTokensActual,
      outputTokensActual: run.outputTokensActual,
      tokensActual: run.tokensActual,
      costActualMicroUsd: run.costActualMicroUsd,
      resultOrdinals: run.resultOrdinals,
      leaseExpiresAt: 0,
    });
  };

  // M5-05D2B-1 — porte budget in-memory, fedeli alla transazione reale.
  reserveBudget: NonNullable<EngineWritePorts['reserveBudget']> = async (input) => {
    this.reserveBudgetCalls++;
    const state =
      this.ledgers.get(input.monthKey) ?? emptyLedger(input.monthKey, input.budgetMicroUsd);
    const withBudget = { ...state, budgetMicroUsd: input.budgetMicroUsd };
    const result = reserveLedger(
      withBudget,
      input.requestId,
      input.amountMicroUsd,
      input.expiresAtMs,
      input.nowMs,
    );
    if (!result.ok) return { ok: false, reason: 'budget_exceeded' };
    this.ledgers.set(input.monthKey, result.state);
    return { ok: true, reservedMicroUsd: result.reservedMicroUsd };
  };

  reconcileBudget: NonNullable<EngineWritePorts['reconcileBudget']> = async (input) => {
    this.reconcileBudgetCalls++;
    // Gate di titolarità: solo il proprietario corrente della lease riconcilia.
    const run = this.runs.get(input.requestId);
    if (!run || run.executionId !== input.executionId) return;
    const state = this.ledgers.get(input.monthKey);
    if (!state) return;
    const next = reconcileLedger(
      { ...state, budgetMicroUsd: input.budgetMicroUsd },
      input.requestId,
      input.actualMicroUsd,
      input.nowMs,
    );
    this.ledgers.set(input.monthKey, next);
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
      this.generalFeedbacks.set(
        input.submissionId,
        resolveGeneralFeedback(evaluations, null, input.proposedGeneralFeedback),
      );
      this.setMirror(input.submissionId, evaluations);
      return { result: 'written', writtenOrders: written };
    }
    if (existing.status !== 'in_progress') return { result: 'changed', writtenOrders: [] };
    const evaluations = { ...existing.evaluations };
    const written = this.apply(evaluations, input.proposed);
    existing.evaluations = evaluations;
    const existingGf = this.generalFeedbacks.get(input.submissionId) ?? null;
    this.generalFeedbacks.set(
      input.submissionId,
      resolveGeneralFeedback(evaluations, existingGf, input.proposedGeneralFeedback),
    );
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

// M5-05D1 — config runtime valida e abilitata, per esercitare il percorso del
// provider reale nei test (kill switch + limiti DEV superati).
const ENABLED_RUNTIME_CONFIG = {
  enabled: true,
  provider: 'openai' as const,
  model: OPENAI_PRODUCTION_MODEL,
  environment: 'dev' as const,
  limits: {
    maxSubmissionsPerOperation: 30,
    maxOpenQuestionsPerSubmission: 20,
    maxEstimatedTokensPerSubmission: 10_000,
    maxEstimatedTokensPerOperation: 300_000,
    maxProviderConcurrency: 3,
    attemptTimeoutMs: 60_000,
    maxApplicationRetries: 1,
  },
  budget: { monthlyUsd: 5 },
  configVersion: 'cfg-test',
  priceListVersion: 'v1-2026-07-16',
};
const enabledConfigPort = async () => ENABLED_RUNTIME_CONFIG;

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

describe('scoreClosedQuestion — chiusa_singola (M5-04C)', () => {
  // Root cause: canonical solution is an ARRAY of one id — ["a"] — not "a".
  const canonical = tq(0, 'chiusa_singola', 2, ['a']);
  const legacy = tq(0, 'chiusa_singola', 2, 'a');

  it('canonical ["a"] + selectedId "a" → maxPoints (regression)', () => {
    const r = scoreClosedQuestion(canonical, { tipo: 'chiusa_singola', selectedId: 'a' });
    expect(r).toEqual({ evaluable: true, points: 2, feedback: 'Risposta corretta.' });
  });
  it('legacy string "a" + selectedId "a" → maxPoints', () => {
    const r = scoreClosedQuestion(legacy, { tipo: 'chiusa_singola', selectedId: 'a' });
    expect(r).toEqual({ evaluable: true, points: 2, feedback: 'Risposta corretta.' });
  });
  it('wrong → 0 with feedback', () => {
    const r = scoreClosedQuestion(canonical, { tipo: 'chiusa_singola', selectedId: 'b' });
    expect(r).toEqual({ evaluable: true, points: 0, feedback: 'Risposta non corretta.' });
  });
  it('not answered → 0 with "Risposta non fornita."', () => {
    expect(scoreClosedQuestion(canonical, { tipo: 'chiusa_singola', selectedId: null })).toEqual({
      evaluable: true,
      points: 0,
      feedback: 'Risposta non fornita.',
    });
    expect(scoreClosedQuestion(canonical, undefined)).toEqual({
      evaluable: true,
      points: 0,
      feedback: 'Risposta non fornita.',
    });
  });
  it('malformed solution → non-evaluable (no unjust zero)', () => {
    for (const bad of [[], ['a', 'b'], [''], [1] as unknown as string[], '', undefined, null]) {
      const q = { ...canonical, soluzione: bad as string | string[] };
      expect(scoreClosedQuestion(q, { tipo: 'chiusa_singola', selectedId: 'a' })).toEqual({
        evaluable: false,
      });
    }
  });
});

describe('canonical selection (M5-05D2A)', () => {
  it('canonicalizes checkbox order and produces the same SHA-256 selection hash', () => {
    const a = [sid('s2'), sid('s1')];
    const b = [sid('s1'), sid('s2')];
    expect(canonicalizeSubmissionIds(a)).toEqual(b);
    expect(computeSelectionHash(VERIF, a)).toBe(computeSelectionHash(VERIF, b));
    expect(computeSelectionHash(VERIF, a)).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe('scoreClosedQuestion — chiusa_multipla partial scoring (M5-04C)', () => {
  // Mandated example: 3 correct (a,b,c), 2 wrong (d,e), maxPoints = 6.
  const q = tq(0, 'chiusa_multipla', 6, ['a', 'b', 'c'], ['a', 'b', 'c', 'd', 'e']);
  const pts = (selectedIds: string[]) => {
    const r = scoreClosedQuestion(q, { tipo: 'chiusa_multipla', selectedIds });
    if (!r.evaluable) throw new Error('expected evaluable');
    return r.points;
  };

  it('all and only correct → maxPoints', () => {
    expect(pts(['a', 'b', 'c'])).toBe(6);
  });
  it('2 correct, 0 wrong → 4', () => {
    expect(pts(['a', 'b'])).toBe(4);
  });
  it('2 correct, 1 wrong → 1', () => {
    expect(pts(['a', 'b', 'd'])).toBe(1);
  });
  it('all five options → 0', () => {
    expect(pts(['a', 'b', 'c', 'd', 'e'])).toBe(0);
  });
  it('none selected → 0 with "Risposta non fornita."', () => {
    const r = scoreClosedQuestion(q, { tipo: 'chiusa_multipla', selectedIds: [] });
    expect(r).toEqual({ evaluable: true, points: 0, feedback: 'Risposta non fornita.' });
  });
  it('order and duplicate ids are irrelevant', () => {
    expect(pts(['c', 'a', 'b'])).toBe(6);
    expect(pts(['a', 'a', 'b', 'b'])).toBe(4);
  });
  it('unknown/manipulated ids count as wrong selections', () => {
    // 2 correct + 1 unknown id → same as 2 correct + 1 wrong → 1.
    expect(pts(['a', 'b', 'zzz'])).toBe(1);
  });
  it('always within [0, maxPoints] and a multiple of 0.25', () => {
    for (const sel of [['a'], ['a', 'd'], ['a', 'b', 'c', 'd'], ['d', 'e'], ['a', 'b', 'c']]) {
      const p = pts(sel);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(6);
      expect(Math.abs(p * 4 - Math.round(p * 4))).toBeLessThan(1e-9);
    }
  });
  it('deterministic count-based feedback with the mandated wording', () => {
    const r = scoreClosedQuestion(q, { tipo: 'chiusa_multipla', selectedIds: ['a', 'b', 'd'] });
    if (!r.evaluable) throw new Error('evaluable');
    expect(r.feedback).toBe('2 risposte corrette su 3; 1 selezione errata.');
  });
  it('feedback never leaks option ids (distinctive ids)', () => {
    const qd = tq(
      0,
      'chiusa_multipla',
      6,
      ['SOLID_ONE', 'SOLID_TWO', 'SOLID_THREE'],
      ['SOLID_ONE', 'SOLID_TWO', 'SOLID_THREE', 'WRONG_ONE', 'WRONG_TWO'],
    );
    const r = scoreClosedQuestion(qd, {
      tipo: 'chiusa_multipla',
      selectedIds: ['SOLID_ONE', 'SOLID_TWO', 'WRONG_ONE'],
    });
    if (!r.evaluable) throw new Error('evaluable');
    for (const id of ['SOLID_ONE', 'SOLID_TWO', 'SOLID_THREE', 'WRONG_ONE', 'WRONG_TWO']) {
      expect(r.feedback).not.toContain(id);
    }
  });
  it('all correct → dedicated positive feedback', () => {
    const r = scoreClosedQuestion(q, { tipo: 'chiusa_multipla', selectedIds: ['a', 'b', 'c'] });
    if (!r.evaluable) throw new Error('evaluable');
    expect(r.feedback).toBe('Tutte le risposte corrette sono state selezionate.');
  });
  it('missing/malformed options or solution → non-evaluable', () => {
    const noOptions = tq(0, 'chiusa_multipla', 6, ['a', 'b']); // no optionIds
    expect(scoreClosedQuestion(noOptions, { tipo: 'chiusa_multipla', selectedIds: ['a'] })).toEqual(
      {
        evaluable: false,
      },
    );
    const solOutsideOptions = tq(0, 'chiusa_multipla', 6, ['a', 'z'], ['a', 'b', 'c']);
    expect(
      scoreClosedQuestion(solOutsideOptions, { tipo: 'chiusa_multipla', selectedIds: ['a'] }),
    ).toEqual({ evaluable: false });
  });
  it('sameIdSet dedupes (helper)', () => {
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

// ── M5-05D1: guardrail server-side del provider reale ─────────────────────────

describe('M5-05D1 — kill switch + limiti sul percorso provider reale', () => {
  it('run: openai con config assente/disabilitata è bloccato (fail-closed, no lease, no grader)', async () => {
    for (const port of [
      undefined,
      async () => null,
      async () => ({ ...ENABLED_RUNTIME_CONFIG, enabled: false }),
    ]) {
      const store = new FakeStore();
      seedOneOpenOneClosed(store, 's1');
      const grader = { id: 'openai', model: 'm', grade: vi.fn() } as unknown as AiGrader;
      const graderFactory = vi.fn(() => grader);
      await expect(
        runExecution(req([sid('s1')]), {
          ...baseDeps(store, grader),
          grader: graderFactory,
          featureMode: 'openai',
          loadRuntimeConfig: port,
        }),
      ).rejects.toMatchObject({ code: 'feature_disabled' });
      expect(store.runs.size).toBe(0); // nessuna lease acquisita
      expect(store.commitCalls).toBe(0);
      expect(store.loadVerificationCalls).toBe(0); // config precede classificazione
      expect(graderFactory).not.toHaveBeenCalled();
      expect(grader.grade as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
    }
  });

  it('run: openai abilitato entro i limiti procede e valuta', async () => {
    const store = new FakeStore();
    seedOneOpenOneClosed(store, 's1');
    const grader = new MockAiGrader();
    const graderFactory = vi.fn(() => grader);
    const res = await runExecution(req([sid('s1')]), {
      ...baseDeps(store, grader),
      grader: graderFactory,
      featureMode: 'openai',
      loadRuntimeConfig: enabledConfigPort,
    });
    expect(res.mode).toBe('openai');
    expect(res.results[0]!.outcome).toBe('succeeded');
    expect(graderFactory).toHaveBeenCalledTimes(1);
    expect(graderFactory).toHaveBeenCalledWith(ENABLED_RUNTIME_CONFIG);
    // Il preflight viene riusato dopo la lease: nessuna seconda lettura della
    // verifica/submission/correction prima del commit transazionale.
    expect(store.loadVerificationCalls).toBe(1);
    expect(store.loadSubmissionCalls).toBe(1);
    expect(store.loadCorrectionCalls).toBe(1);
  });

  it('run: openai oltre il limite di consegne è rifiutato prima della lease', async () => {
    const store = new FakeStore();
    const ids: string[] = [];
    store.verification = {
      ownerUid: OWNER,
      status: 'active',
      teacherQuestions: [tq(0, 'chiusa_singola', 2, 'a')],
    };
    for (let i = 0; i < 31; i++) {
      const s = `s${i}`;
      ids.push(sid(s));
      store.submissions.set(sid(s), {
        ownerUid: OWNER,
        verificationId: VERIF,
        studentUid: s,
        status: 'submitted',
        answers: { '0': { tipo: 'chiusa_singola', selectedId: 'a' } },
      });
    }
    const graderFactory = vi.fn(() => new MockAiGrader());
    await expect(
      runExecution(
        { verificationId: VERIF, submissionIds: ids, requestId: REQ },
        {
          ...baseDeps(store, new MockAiGrader()),
          grader: graderFactory,
          featureMode: 'openai',
          loadRuntimeConfig: enabledConfigPort,
        },
      ),
    ).rejects.toMatchObject({ code: 'limit_exceeded' });
    expect(store.runs.size).toBe(0);
    expect(store.commitCalls).toBe(0);
    expect(graderFactory).not.toHaveBeenCalled();
  });

  it('preview: openai disabilitato è bloccato; abilitato passa', async () => {
    const store = new FakeStore();
    seedOneOpenOneClosed(store, 's1');
    await expect(
      runPreview(req([sid('s1')]), {
        ...baseDeps(store, new MockAiGrader()),
        featureMode: 'openai',
      }),
    ).rejects.toMatchObject({ code: 'feature_disabled' });
    expect(store.loadVerificationCalls).toBe(0);
    expect(store.loadSubmissionCalls).toBe(0);
    expect(store.loadCorrectionCalls).toBe(0);

    const res = await runPreview(req([sid('s1')]), {
      ...baseDeps(store, new MockAiGrader()),
      featureMode: 'openai',
      loadRuntimeConfig: enabledConfigPort,
    });
    expect(res.mode).toBe('openai');
    expect(res.counts.eligible).toBe(1);
  });

  it('mock resta invariato: nessun gate, nessuna config richiesta, costo zero', async () => {
    const store = new FakeStore();
    seedOneOpenOneClosed(store, 's1');
    const res = await runExecution(req([sid('s1')]), baseDeps(store, new MockAiGrader()));
    expect(res.mode).toBe('mock');
    expect(res.costActual).toBe(0);
    expect(res.results[0]!.outcome).toBe('succeeded');
  });
});

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
    // M5-04B: sole domande chiuse → feedback deterministico, nessun provider →
    // **zero** token stimati.
    expect(res.tokensEstimated).toBe(0);
  });
});

// ── runExecution ──────────────────────────────────────────────────────────────

describe('runExecution — closed scoring + open grading', () => {
  it('resolves OpenAI configuration after auth but before run metadata or provider calls', async () => {
    const store = new FakeStore();
    const providerCall = vi.fn();
    const graderFactory = vi.fn(() => {
      throw new AiGatewayError('provider_config_invalid', 'Configurazione mancante.');
    });
    await expect(
      runExecution(req([sid('s1')]), {
        callerUid: OWNER,
        getOwnerUid: async () => OWNER,
        featureMode: 'openai',
        ports: store,
        loadRuntimeConfig: enabledConfigPort,
        grader: graderFactory,
      }),
    ).rejects.toMatchObject({ code: 'provider_config_invalid' });
    expect(store.runs.size).toBe(0);
    expect(store.commitCalls).toBe(0);
    expect(graderFactory).toHaveBeenCalledTimes(1);
    expect(graderFactory).toHaveBeenCalledWith(ENABLED_RUNTIME_CONFIG);
    expect(providerCall).not.toHaveBeenCalled();
  });

  it('does not persist deterministic closed scores when the provider adapter rejects', async () => {
    const store = new FakeStore();
    seedOneOpenOneClosed(store, 's1');
    const grader: AiGrader = {
      id: 'openai',
      model: 'test-model',
      grade: vi.fn(async () => {
        throw new Error('invalid structured output');
      }),
    };

    const result = await runExecution(req([sid('s1')]), {
      ...baseDeps(store, grader),
      featureMode: 'openai',
      loadRuntimeConfig: enabledConfigPort,
    });

    expect(result.results[0]).toMatchObject({ outcome: 'failed', closedGraded: 0, openGraded: 0 });
    expect(store.commitCalls).toBe(0);
    expect(store.corrections.has(sid('s1'))).toBe(false);
  });

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
          generalFeedback: '[mock] ok',
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
        generalFeedback: '[mock] ok',
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
        generalFeedback: '[mock] ok',
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
      runContractVersion: AI_RUN_CONTRACT_VERSION,
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
      runContractVersion: AI_RUN_CONTRACT_VERSION,
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
    const nowMs = Date.now();
    const meta = {
      selectionHash,
      submissionCount: 1,
      provider: 'mock',
      leaseMs: RUN_LEASE_MS,
      nowMs,
      expireAtMs: nowMs + RUN_RETENTION_MS,
    };
    // Attempt A acquires the lease.
    const a = await store.beginRun(REQ, { ...meta, executionId: 'A' });
    expect(a.state).toBe('acquired');
    // A's lease expires; attempt B takes over.
    store.runs.get(REQ)!.leaseExpiresAt = nowMs - 1;
    const b = await store.beginRun(REQ, { ...meta, executionId: 'B' });
    expect(b.state).toBe('acquired');
    // A (old worker) tries to finalize → must be a no-op.
    await store.finishRun(REQ, {
      runContractVersion: AI_RUN_CONTRACT_VERSION,
      status: 'completed',
      selectionHash,
      mode: 'mock',
      counts: {
        selected: 1,
        eligible: 1,
        excluded: 0,
        closedToGrade: 0,
        openToGrade: 0,
        closedOnlySubmissions: 0,
        alreadyGradedIgnored: 0,
        succeeded: 1,
        partial: 0,
        failed: 0,
      },
      inputTokensEstimated: 0,
      outputTokensEstimated: 0,
      tokensEstimated: 0,
      costEstimatedMicroUsd: 0,
      inputTokensActual: 0,
      outputTokensActual: 0,
      tokensActual: 0,
      costActualMicroUsd: 0,
      resultOrdinals: [{ ordinal: 0, status: 'succeeded' }],
      executionId: 'A',
    });
    expect(store.runs.get(REQ)!.status).toBe('running');
    expect(store.runs.get(REQ)!.executionId).toBe('B');
    // B finalizes → applied.
    await store.finishRun(REQ, {
      runContractVersion: AI_RUN_CONTRACT_VERSION,
      status: 'completed',
      selectionHash,
      mode: 'mock',
      counts: {
        selected: 1,
        eligible: 1,
        excluded: 0,
        closedToGrade: 0,
        openToGrade: 0,
        closedOnlySubmissions: 0,
        alreadyGradedIgnored: 0,
        succeeded: 1,
        partial: 0,
        failed: 0,
      },
      inputTokensEstimated: 0,
      outputTokensEstimated: 0,
      tokensEstimated: 0,
      costEstimatedMicroUsd: 0,
      inputTokensActual: 0,
      outputTokensActual: 0,
      tokensActual: 0,
      costActualMicroUsd: 0,
      resultOrdinals: [{ ordinal: 0, status: 'succeeded' }],
      executionId: 'B',
    });
    expect(store.runs.get(REQ)!.status).toBe('completed');
  });
});

describe('runExecution — lease clock captured at acquisition (M5-05D2A regression)', () => {
  // Un preflight lento (config/kill switch + classificazione + limiti) non deve
  // consumare la lease: `leaseExpiresAt` ed `expireAt` devono basarsi sull'istante
  // effettivo di acquisizione, non sull'inizio della request.
  it('bases leaseExpiresAt/expireAt on acquisition time even when preflight is slow', async () => {
    const store = new FakeStore();
    seedOneOpenOneClosed(store, 's1');
    const T0 = Date.UTC(2026, 6, 16, 12, 0, 0);
    let clock = T0;
    // Il preflight (qui la lettura config) fa avanzare il clock oltre RUN_LEASE_MS.
    const SLOW = RUN_LEASE_MS * 3;
    const slowConfigPort = async () => {
      clock += SLOW;
      return ENABLED_RUNTIME_CONFIG;
    };
    let capturedNowMs = -1;
    let capturedExpireAtMs = -1;
    const originalBeginRun = store.beginRun;
    store.beginRun = async (requestId, meta) => {
      capturedNowMs = meta.nowMs;
      capturedExpireAtMs = meta.expireAtMs;
      return originalBeginRun(requestId, meta);
    };
    const grade = vi.fn(new MockAiGrader().grade);
    const grader = { id: 'openai', model: 'm', grade } as unknown as AiGrader;

    await runExecution(req([sid('s1')]), {
      ...baseDeps(store, grader),
      featureMode: 'openai',
      loadRuntimeConfig: slowConfigPort,
      now: () => clock,
    });

    // Il clock della lease è letto DOPO il preflight lento: acquisizione a T0+SLOW.
    expect(capturedNowMs).toBe(T0 + SLOW);
    expect(capturedExpireAtMs).toBe(T0 + SLOW + RUN_RETENTION_MS);
    // Non è basato sull'inizio della request.
    expect(capturedNowMs).not.toBe(T0);
    // La lease appena acquisita scade a acquisitionTime + RUN_LEASE_MS.
    // (finishRun azzera la lease a fine run: la ricaviamo dal clock catturato.)
    expect(capturedNowMs + RUN_LEASE_MS).toBe(T0 + SLOW + RUN_LEASE_MS);
    expect(grade).toHaveBeenCalledTimes(1);
    expect(store.commitCalls).toBe(1);
  });

  it('a second worker before the acquisition-based expiry gets locked; no double grader/commit', async () => {
    const store = new FakeStore();
    seedOneOpenOneClosed(store, 's1');
    // Worker A ha acquisito la lease all'istante TA (post-preflight).
    const TA = Date.UTC(2026, 6, 16, 12, 0, 0);
    store.runs.set(REQ, {
      runContractVersion: AI_RUN_CONTRACT_VERSION,
      status: 'running',
      selectionHash: computeSelectionHash(VERIF, [sid('s1')]),
      mode: 'openai',
      executionId: 'A',
      leaseExpiresAt: TA + RUN_LEASE_MS,
      expireAtMs: TA + RUN_RETENTION_MS,
    });
    const grade = vi.fn();
    const grader = { id: 'openai', model: 'm', grade } as unknown as AiGrader;

    // Worker B arriva PRIMA della scadenza (basata sull'acquisizione di A).
    const res = await runExecution(req([sid('s1')]), {
      ...baseDeps(store, grader),
      featureMode: 'openai',
      loadRuntimeConfig: enabledConfigPort,
      now: () => TA + RUN_LEASE_MS - 1,
    });

    expect(res.status).toBe('running');
    expect(res.idempotentReplay).toBe(true);
    expect(grade).not.toHaveBeenCalled(); // nessuna doppia elaborazione
    expect(store.commitCalls).toBe(0);
    expect(store.runs.get(REQ)!.executionId).toBe('A'); // A possiede ancora il run
    // expireAt non esteso né riscritto dal tentativo locked.
    expect(store.runs.get(REQ)!.expireAtMs).toBe(TA + RUN_RETENTION_MS);
  });

  it('takeover after the true expiry processes without extending the original expireAt', async () => {
    const store = new FakeStore();
    seedOneOpenOneClosed(store, 's1');
    const TA = Date.UTC(2026, 6, 16, 12, 0, 0);
    store.runs.set(REQ, {
      runContractVersion: AI_RUN_CONTRACT_VERSION,
      status: 'running',
      selectionHash: computeSelectionHash(VERIF, [sid('s1')]),
      mode: 'openai',
      executionId: 'crashed-A',
      leaseExpiresAt: TA + RUN_LEASE_MS,
      expireAtMs: TA + RUN_RETENTION_MS,
    });
    const grade = vi.fn(new MockAiGrader().grade);
    const grader = { id: 'openai', model: 'm', grade } as unknown as AiGrader;

    // Worker B arriva DOPO la vera scadenza → takeover.
    const res = await runExecution(req([sid('s1')]), {
      ...baseDeps(store, grader),
      featureMode: 'openai',
      loadRuntimeConfig: enabledConfigPort,
      now: () => TA + RUN_LEASE_MS + 1,
    });

    expect(res.idempotentReplay).toBe(false);
    expect(store.corrections.has(sid('s1'))).toBe(true); // elaborato
    expect(store.runs.get(REQ)!.status).toBe('completed');
    expect(grade).toHaveBeenCalledTimes(1);
    // Il takeover NON estende né riscrive l'expireAt del documento originale.
    expect(store.runs.get(REQ)!.expireAtMs).toBe(TA + RUN_RETENTION_MS);
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
  it('persists only ordinal results: no IDs, UIDs or educational content', async () => {
    const store = new FakeStore();
    seedOneOpenOneClosed(store, 's1');
    await runExecution(req([sid('s1')]), baseDeps(store, new MockAiGrader()));
    const persisted = store.runs.get(REQ)!;
    const serialized = JSON.stringify(persisted);
    expect(serialized).not.toContain(SOL_MARK);
    expect(serialized).not.toContain(ANS_MARK);
    expect(serialized).not.toContain(Q_MARK);
    expect(serialized).not.toContain('[mock]'); // no mock feedback text
    expect(serialized).not.toContain(sid('s1'));
    expect(serialized).not.toContain(VERIF);
    expect(serialized).not.toContain(OWNER);
    expect(serialized).not.toContain('studentUid');
    expect(serialized).not.toContain('submissionId');
    expect(serialized).not.toContain('verificationId');
    expect(persisted.resultOrdinals).toEqual([{ ordinal: 0, status: 'succeeded' }]);
    // metadata present
    expect(serialized).toContain('selectionHash');
    expect(serialized).toContain('completed');
  });

  it('replays the same canonical selection in a different order without swapping outcomes', async () => {
    const store = new FakeStore();
    seedOneOpenOneClosed(store, 's1');
    seedExtra(store, 's2');
    store.submissions.get(sid('s2'))!.status = 'draft';

    const first = await runExecution(
      req([sid('s2'), sid('s1')]),
      baseDeps(store, new MockAiGrader()),
    );
    expect(first.results.map((result) => [result.submissionId, result.outcome])).toEqual([
      [sid('s1'), 'succeeded'],
      [sid('s2'), 'excluded'],
    ]);

    const replay = await runExecution(
      req([sid('s1'), sid('s2')]),
      baseDeps(store, new MockAiGrader()),
    );
    expect(replay.idempotentReplay).toBe(true);
    expect(replay.counts).toEqual(first.counts);
    expect(
      replay.results.map((result) => [result.submissionId, result.outcome, result.reason]),
    ).toEqual([
      [sid('s1'), 'succeeded', undefined],
      [sid('s2'), 'excluded', 'not_submitted'],
    ]);
  });

  it('uses the injected clock for a deterministic 30-day expireAt', async () => {
    const store = new FakeStore();
    seedOneOpenOneClosed(store, 's1');
    const nowMs = Date.UTC(2026, 6, 16, 12, 0, 0);
    await runExecution(req([sid('s1')]), {
      ...baseDeps(store, new MockAiGrader()),
      now: () => nowMs,
    });
    expect(store.runs.get(REQ)!.expireAtMs).toBe(nowMs + RUN_RETENTION_MS);
  });

  it('fails safely on a legacy run and requires a new requestId without mutating it', async () => {
    const store = new FakeStore();
    seedOneOpenOneClosed(store, 's1');
    store.runs.set(REQ, {
      status: 'completed',
      selectionHash: computeSelectionHash(VERIF, [sid('s1')]),
      // no runContractVersion => legacy
    });
    const before = JSON.stringify(store.runs.get(REQ));
    await expect(
      runExecution(req([sid('s1')]), baseDeps(store, new MockAiGrader())),
    ).rejects.toMatchObject({ code: 'invalid_input' });
    expect(JSON.stringify(store.runs.get(REQ))).toBe(before);
    expect(store.commitCalls).toBe(0);
  });

  it('makes no network call across the whole run', async () => {
    const store = new FakeStore();
    seedOneOpenOneClosed(store, 's1');
    await runExecution(req([sid('s1')]), baseDeps(store, new MockAiGrader()));
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// ── M5-04B: feedback generale della consegna ─────────────────────────────────
describe('runExecution — general feedback (M5-04B)', () => {
  /** Grader spia che valuta ogni domanda al massimo e produce un feedback generale. */
  function fullMarkGrader() {
    const grade = vi.fn(
      (input: {
        requestId: string;
        questions: { order: number; maxPoints: number }[];
        submissionContext?: { priorPoints: number; totalMaxPoints: number };
      }) =>
        Promise.resolve({
          requestId: input.requestId,
          results: input.questions.map((q) => ({ order: q.order, points: q.maxPoints })),
          generalFeedback: buildMockGeneralFeedback(
            (input.submissionContext?.priorPoints ?? 0) +
              input.questions.reduce((s, q) => s + q.maxPoints, 0),
            input.submissionContext?.totalMaxPoints ?? 0,
          ),
        }),
    );
    return { id: 'mock', grade } as unknown as AiGrader & {
      grade: ReturnType<typeof vi.fn>;
    };
  }

  it('writes a general feedback for a fully-graded submission with open questions', async () => {
    const store = new FakeStore();
    seedOneOpenOneClosed(store, 's1');
    const grader = fullMarkGrader();
    const res = await runExecution(req([sid('s1')]), baseDeps(store, grader));
    expect(res.status).toBe('completed');
    const gf = store.generalFeedbacks.get(sid('s1'));
    expect(typeof gf).toBe('string');
    expect(gf).toContain('[mock]');
    expect(gf!.length).toBeLessThanOrEqual(700);
  });

  it('produces the general feedback in the SAME grader call (no second call)', async () => {
    const store = new FakeStore();
    seedOneOpenOneClosed(store, 's1');
    const grader = fullMarkGrader();
    await runExecution(req([sid('s1')]), baseDeps(store, grader));
    expect(grader.grade).toHaveBeenCalledTimes(1);
    // The grader received the score context to compute the final total.
    expect(grader.grade.mock.calls[0]![0].submissionContext).toBeDefined();
  });

  it('never overwrites a non-empty teacher-written general feedback', async () => {
    const store = new FakeStore();
    seedOneOpenOneClosed(store, 's1');
    // Correction already open with q0 graded and a teacher feedback present.
    store.corrections.set(sid('s1'), {
      status: 'in_progress',
      reopenCount: 0,
      evaluations: {
        '0': { order: 0, points: 2, maxPoints: 2 },
        '1': { order: 1, points: null, maxPoints: 2 },
      },
    });
    store.generalFeedbacks.set(sid('s1'), 'Commento del docente da preservare');
    await runExecution(req([sid('s1')]), baseDeps(store, fullMarkGrader()));
    // Now fully graded, but the teacher text stays untouched.
    expect(store.generalFeedbacks.get(sid('s1'))).toBe('Commento del docente da preservare');
  });

  it('does NOT generate a general feedback when the correction stays incomplete', async () => {
    const store = new FakeStore();
    seedOneOpenOneClosed(store, 's1');
    // Grader returns nothing valid → open question stays null → incomplete.
    const grade = vi.fn((input: { requestId: string }) =>
      Promise.resolve({ requestId: input.requestId, results: [], generalFeedback: '[mock] x' }),
    );
    const grader = { id: 'mock', grade } as unknown as AiGrader;
    const res = await runExecution(req([sid('s1')]), baseDeps(store, grader));
    expect(res.status).toBe('partial');
    expect(store.generalFeedbacks.get(sid('s1')) ?? null).toBeNull();
  });

  it('closed-only: deterministic general feedback with zero grader calls and zero tokens', async () => {
    const store = new FakeStore();
    store.verification = {
      ownerUid: OWNER,
      status: 'active',
      teacherQuestions: [tq(0, 'chiusa_singola', 2, 'a'), tq(1, 'chiusa_singola', 2, 'b')],
    };
    store.submissions.set(sid('s1'), {
      ownerUid: OWNER,
      verificationId: VERIF,
      studentUid: 's1',
      status: 'submitted',
      answers: {
        '0': { tipo: 'chiusa_singola', selectedId: 'a' },
        '1': { tipo: 'chiusa_singola', selectedId: 'b' },
      },
    });
    const grader = fullMarkGrader();
    const res = await runExecution(req([sid('s1')]), baseDeps(store, grader));
    expect(res.status).toBe('completed');
    expect(grader.grade).not.toHaveBeenCalled(); // no open questions → no grader call
    // Closed-only → deterministic feedback, no provider → zero tokens/cost.
    expect(res.tokensEstimated).toBe(0);
    expect(res.tokensActual).toBe(0);
    expect(res.costActual).toBe(0);
    const gf = store.generalFeedbacks.get(sid('s1'));
    // 4/4 → maximum → positive feedback, deterministic and mock-marked.
    expect(gf).toBe(buildMockGeneralFeedback(4, 4));
    expect(gf).toContain('[mock]');
  });

  it('M5-04C: a partial multipla is stored with its points+feedback and drives the final totals', async () => {
    const store = new FakeStore();
    store.verification = {
      ownerUid: OWNER,
      status: 'active',
      // Single multipla: 3 correct (a,b,c) + 2 wrong (d,e), max 6.
      teacherQuestions: [tq(0, 'chiusa_multipla', 6, ['a', 'b', 'c'], ['a', 'b', 'c', 'd', 'e'])],
    };
    store.submissions.set(sid('s1'), {
      ownerUid: OWNER,
      verificationId: VERIF,
      studentUid: 's1',
      status: 'submitted',
      answers: { '0': { tipo: 'chiusa_multipla', selectedIds: ['a', 'b'] } }, // 2/3, 0 wrong → 4
    });
    const grader = fullMarkGrader();
    const res = await runExecution(req([sid('s1')]), baseDeps(store, grader));
    expect(res.status).toBe('completed');
    expect(grader.grade).not.toHaveBeenCalled();
    const correction = store.corrections.get(sid('s1'))!;
    expect(correction.evaluations['0']!.points).toBe(4); // partial credit
    expect(correction.evaluations['0']!.feedback).toBe(
      '2 risposte corrette su 3; 0 selezioni errate.',
    );
    // General feedback uses the FINAL total incl. the partial multipla (4/6).
    expect(store.generalFeedbacks.get(sid('s1'))).toBe(buildMockGeneralFeedback(4, 6));
  });

  it('M5-04C: a malformed closed solution leaves the question unevaluated (partial), no unjust zero', async () => {
    const store = new FakeStore();
    store.verification = {
      ownerUid: OWNER,
      status: 'active',
      // chiusa_singola with a malformed 2-element solution → non-evaluable.
      teacherQuestions: [tq(0, 'chiusa_singola', 2, ['a', 'b'])],
    };
    store.submissions.set(sid('s1'), {
      ownerUid: OWNER,
      verificationId: VERIF,
      studentUid: 's1',
      status: 'submitted',
      answers: { '0': { tipo: 'chiusa_singola', selectedId: 'a' } },
    });
    const res = await runExecution(req([sid('s1')]), baseDeps(store, new MockAiGrader()));
    // Nothing gradable was written → partial, and the question stays null (no 0).
    expect(res.results[0]).toMatchObject({ outcome: 'partial', closedSkipped: 1, closedGraded: 0 });
    const correction = store.corrections.get(sid('s1'));
    expect(correction?.evaluations['0']?.points ?? null).toBeNull();
  });

  it('maximum result yields a coherent positive general feedback', async () => {
    const full = buildMockGeneralFeedback(10, 10);
    expect(full).toContain('pieno');
    expect(full.length).toBeLessThanOrEqual(700);
    // A partial result is phrased differently (motivation + advice).
    const partial = buildMockGeneralFeedback(4, 10);
    expect(partial).not.toBe(full);
    expect(partial).toContain('complessivo');
  });

  // M5-04B (atomicità): con domande aperte il feedback generale è RICHIESTO. Un
  // output di feedback invalido rende invalido l'INTERO output del grader per
  // quella consegna: nessun punteggio, nessun feedback, nessun commitSubmission,
  // consegna `failed`, nessuna scrittura parziale.
  /** Grader a punteggio pieno con un generalFeedback arbitrario (o assente). */
  function graderWithFeedback(gf: unknown, present = true) {
    const grade = vi.fn(
      (input: { requestId: string; questions: { order: number; maxPoints: number }[] }) =>
        Promise.resolve({
          requestId: input.requestId,
          results: input.questions.map((q) => ({ order: q.order, points: q.maxPoints })),
          ...(present ? { generalFeedback: gf } : {}),
        }),
    );
    return { id: 'mock', grade } as unknown as AiGrader & { grade: ReturnType<typeof vi.fn> };
  }

  const invalidFeedbackCases: { name: string; grader: () => AiGrader }[] = [
    { name: 'missing feedback', grader: () => graderWithFeedback(undefined, false) },
    { name: 'non-string feedback', grader: () => graderWithFeedback(42) },
    { name: 'empty feedback', grader: () => graderWithFeedback('   ') },
    { name: 'over-limit feedback', grader: () => graderWithFeedback('x'.repeat(701)) },
  ];

  for (const { name, grader } of invalidFeedbackCases) {
    it(`rejects the whole grader output atomically — ${name} — no partial writes`, async () => {
      const store = new FakeStore();
      seedOneOpenOneClosed(store, 's1');
      const res = await runExecution(req([sid('s1')]), baseDeps(store, grader()));
      // Submission failed, NOT completed.
      expect(res.status).toBe('failed');
      expect(res.results[0]).toMatchObject({ outcome: 'failed' });
      expect(res.results[0]!.reason).toBeDefined();
      // commitSubmission never called → no scores, no feedback written.
      expect(store.commitCalls).toBe(0);
      expect(store.corrections.get(sid('s1'))).toBeUndefined();
      expect(store.generalFeedbacks.get(sid('s1')) ?? null).toBeNull();
    });
  }

  it('an invalid grader output on one submission does not block the others (same batch)', async () => {
    const store = new FakeStore();
    store.verification = {
      ownerUid: OWNER,
      status: 'active',
      teacherQuestions: [tq(0, 'chiusa_singola', 2, 'a'), tq(1, 'aperta', 2, SOL_MARK)],
    };
    // s1's open answer is 'BAD' → the grader returns an over-limit feedback for it;
    // s2 gets a valid feedback.
    store.submissions.set(sid('s1'), {
      ownerUid: OWNER,
      verificationId: VERIF,
      studentUid: 's1',
      status: 'submitted',
      answers: {
        '0': { tipo: 'chiusa_singola', selectedId: 'a' },
        '1': { tipo: 'aperta', testo: 'BAD' },
      },
    });
    store.submissions.set(sid('s2'), {
      ownerUid: OWNER,
      verificationId: VERIF,
      studentUid: 's2',
      status: 'submitted',
      answers: {
        '0': { tipo: 'chiusa_singola', selectedId: 'a' },
        '1': { tipo: 'aperta', testo: ANS_MARK },
      },
    });
    const grade = vi.fn(
      (input: {
        requestId: string;
        questions: { order: number; maxPoints: number; studentAnswer: string }[];
      }) => {
        const bad = input.questions.some((q) => q.studentAnswer === 'BAD');
        return Promise.resolve({
          requestId: input.requestId,
          results: input.questions.map((q) => ({ order: q.order, points: q.maxPoints })),
          generalFeedback: bad ? 'x'.repeat(701) : '[mock] ok',
        });
      },
    );
    const grader = { id: 'mock', grade } as unknown as AiGrader;
    const res = await runExecution(req([sid('s1'), sid('s2')]), baseDeps(store, grader));
    // One failed, one succeeded → partial batch.
    expect(res.status).toBe('partial');
    expect(store.corrections.get(sid('s1'))).toBeUndefined(); // failed → untouched
    expect(store.corrections.get(sid('s2'))).toBeDefined(); // graded normally
  });

  it('does not touch an existing teacher-graded question when the grader output is invalid', async () => {
    const store = new FakeStore();
    seedOneOpenOneClosed(store, 's1');
    // Pre-existing correction: q0 graded by the teacher (0.25), q1 open still null.
    store.corrections.set(sid('s1'), {
      status: 'in_progress',
      reopenCount: 0,
      evaluations: {
        '0': { order: 0, points: 0.25, maxPoints: 2 },
        '1': { order: 1, points: null, maxPoints: 2 },
      },
    });
    const res = await runExecution(
      req([sid('s1')]),
      baseDeps(store, graderWithFeedback('x'.repeat(701))),
    );
    expect(res.status).toBe('failed');
    // Teacher's evaluation preserved, nothing overwritten.
    const correction = store.corrections.get(sid('s1'))!;
    expect(correction.evaluations['0']!.points).toBe(0.25);
    expect(correction.evaluations['1']!.points).toBeNull();
  });

  it('uses the FINAL totals (prior + closed + open) for the feedback', async () => {
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
        '0': { tipo: 'chiusa_singola', selectedId: 'a' }, // correct → 2
        '1': { tipo: 'aperta', testo: ANS_MARK },
      },
    });
    const grader = fullMarkGrader(); // open q1 → 2
    await runExecution(req([sid('s1')]), baseDeps(store, grader));
    // Final total = 2 (closed) + 2 (open) = 4 / 4 → the grader saw priorPoints=2
    // (closed) and totalMax=4, producing the maximum-result feedback.
    expect(store.generalFeedbacks.get(sid('s1'))).toBe(buildMockGeneralFeedback(4, 4));
  });

  it('mock keeps tokensActual and costActual at zero', async () => {
    const store = new FakeStore();
    seedOneOpenOneClosed(store, 's1');
    const res = await runExecution(req([sid('s1')]), baseDeps(store, new MockAiGrader()));
    expect(res.tokensActual).toBe(0);
    expect(res.costActual).toBe(0);
  });

  it('never persists the general feedback text in aiCorrectionRuns', async () => {
    const store = new FakeStore();
    seedOneOpenOneClosed(store, 's1');
    await runExecution(req([sid('s1')]), baseDeps(store, new MockAiGrader()));
    const serialized = JSON.stringify(store.runs.get(REQ));
    // The run doc holds metadata only — never the feedback text ([mock] marker).
    expect(serialized).not.toContain('[mock]');
    expect(serialized).not.toContain('Punteggio complessivo');
    expect(serialized).not.toContain('Risultato pieno');
  });
});

// ── M5-05D2B-1 — costo runtime + budget mensile atomico ──────────────────────

/** Grader openai simulato che restituisce l'usage indicato (nessuna rete). */
function usageGrader(usage: AiGraderOutput['usage']): AiGrader {
  const mock = new MockAiGrader();
  return {
    id: 'openai',
    model: OPENAI_PRODUCTION_MODEL,
    grade: async (input) => ({ ...(await mock.grade(input)), ...(usage ? { usage } : {}) }),
  };
}

function openaiDeps(store: FakeStore, grader: AiGrader, nowMs: number) {
  return {
    ...baseDeps(store, grader),
    featureMode: 'openai' as const,
    loadRuntimeConfig: enabledConfigPort,
    now: () => nowMs,
  };
}

describe('M5-05D2B-1 — cost accounting + budget ledger runtime', () => {
  const NOW = Date.UTC(2026, 6, 16, 12, 0, 0);
  const MONTH = monthKeyFromMs(NOW);
  const FIVE_USD = 5 * USD_MICRO;

  it('openai run: actual cost from usage, reserve then reconcile the monthly ledger', async () => {
    const store = new FakeStore();
    seedOneOpenOneClosed(store, 's1');
    const res = await runExecution(
      req([sid('s1')]),
      openaiDeps(store, usageGrader({ inputTokens: 1000, outputTokens: 200, tokens: 1200 }), NOW),
    );
    expect(res.mode).toBe('openai');
    expect(res.inputTokensActual).toBe(1000);
    expect(res.outputTokensActual).toBe(200);
    expect(res.totalTokensActual).toBe(1200);
    // 1000 * 0.05 + 200 * 0.4 = 130 µUSD.
    expect(res.costActualMicroUsd).toBe(130);
    expect(res.costEstimatedMicroUsd).toBeGreaterThan(0);
    expect(store.reserveBudgetCalls).toBe(1);
    expect(store.reconcileBudgetCalls).toBe(1);
    const ledger = store.ledgers.get(MONTH)!;
    expect(ledger.spentMicroUsd).toBe(130);
    expect(availableMicroUsd(ledger, NOW)).toBe(FIVE_USD - 130);
    expect(store.runs.get(REQ)!.costActualMicroUsd).toBe(130);
  });

  it('mock: no reservation, no reconciliation, zero cost', async () => {
    const store = new FakeStore();
    seedOneOpenOneClosed(store, 's1');
    const res = await runExecution(req([sid('s1')]), baseDeps(store, new MockAiGrader()));
    expect(res.costActualMicroUsd).toBe(0);
    expect(res.costEstimatedMicroUsd).toBe(0);
    expect(store.reserveBudgetCalls).toBe(0);
    expect(store.reconcileBudgetCalls).toBe(0);
    expect(store.ledgers.size).toBe(0);
  });

  it('openai closed-only operation: estimate 0 → no unnecessary reservation, no provider call', async () => {
    const store = new FakeStore();
    store.verification = {
      ownerUid: OWNER,
      status: 'active',
      teacherQuestions: [tq(0, 'chiusa_singola', 2, 'a')],
    };
    store.submissions.set(sid('s1'), {
      ownerUid: OWNER,
      verificationId: VERIF,
      studentUid: 's1',
      status: 'submitted',
      answers: { '0': { tipo: 'chiusa_singola', selectedId: 'a' } },
    });
    const grade = vi.fn();
    const res = await runExecution(
      req([sid('s1')]),
      openaiDeps(
        store,
        { id: 'openai', model: OPENAI_PRODUCTION_MODEL, grade } as unknown as AiGrader,
        NOW,
      ),
    );
    expect(res.results[0]!.outcome).toBe('succeeded');
    expect(res.costEstimatedMicroUsd).toBe(0);
    expect(store.reserveBudgetCalls).toBe(0);
    expect(grade).not.toHaveBeenCalled();
  });

  it('preview and run agree on the estimated cost for the same selection/config', async () => {
    const store = new FakeStore();
    seedOneOpenOneClosed(store, 's1');
    const preview = await runPreview(req([sid('s1')]), {
      ...baseDeps(store, new MockAiGrader()),
      featureMode: 'openai',
      loadRuntimeConfig: enabledConfigPort,
    });
    const run = await runExecution(
      req([sid('s1')]),
      openaiDeps(store, usageGrader({ inputTokens: 10, outputTokens: 10, tokens: 20 }), NOW),
    );
    expect(preview.costEstimatedMicroUsd).toBeGreaterThan(0);
    expect(run.costEstimatedMicroUsd).toBe(preview.costEstimatedMicroUsd);
    expect(preview.inputTokensEstimated).toBe(run.inputTokensEstimated);
    expect(preview.outputTokensEstimated).toBe(run.outputTokensEstimated);
    // La preview non prenota budget.
    expect(store.reserveBudgetCalls).toBe(1); // solo il run
  });

  it('insufficient budget → budget_exceeded before any provider call or commit', async () => {
    const store = new FakeStore();
    seedOneOpenOneClosed(store, 's1');
    store.ledgers.set(MONTH, {
      monthKey: MONTH,
      budgetMicroUsd: FIVE_USD,
      spentMicroUsd: FIVE_USD, // budget esaurito
      reservations: {},
    });
    const grade = vi.fn(new MockAiGrader().grade);
    await expect(
      runExecution(
        req([sid('s1')]),
        openaiDeps(
          store,
          { id: 'openai', model: OPENAI_PRODUCTION_MODEL, grade } as unknown as AiGrader,
          NOW,
        ),
      ),
    ).rejects.toMatchObject({ code: 'budget_exceeded' });
    expect(grade).not.toHaveBeenCalled();
    expect(store.commitCalls).toBe(0);
    expect(store.reconcileBudgetCalls).toBe(0);
  });

  it('idempotent replay does not spend twice', async () => {
    const store = new FakeStore();
    seedOneOpenOneClosed(store, 's1');
    await runExecution(
      req([sid('s1')]),
      openaiDeps(store, usageGrader({ inputTokens: 1000, outputTokens: 200, tokens: 1200 }), NOW),
    );
    const spentAfterFirst = store.ledgers.get(MONTH)!.spentMicroUsd;
    const replay = await runExecution(
      req([sid('s1')]),
      openaiDeps(store, usageGrader({ inputTokens: 9999, outputTokens: 9999, tokens: 19998 }), NOW),
    );
    expect(replay.idempotentReplay).toBe(true);
    expect(store.reserveBudgetCalls).toBe(1); // nessuna seconda prenotazione
    expect(store.ledgers.get(MONTH)!.spentMicroUsd).toBe(spentAfterFirst);
  });

  it('locked attempt does not reserve budget or call the provider', async () => {
    const store = new FakeStore();
    seedOneOpenOneClosed(store, 's1');
    store.runs.set(REQ, {
      runContractVersion: AI_RUN_CONTRACT_VERSION,
      status: 'running',
      selectionHash: computeSelectionHash(VERIF, [sid('s1')]),
      mode: 'openai',
      executionId: 'other',
      leaseExpiresAt: NOW + RUN_LEASE_MS,
    });
    const grade = vi.fn();
    const res = await runExecution(
      req([sid('s1')]),
      openaiDeps(
        store,
        { id: 'openai', model: OPENAI_PRODUCTION_MODEL, grade } as unknown as AiGrader,
        NOW,
      ),
    );
    expect(res.idempotentReplay).toBe(true);
    expect(res.status).toBe('running');
    expect(store.reserveBudgetCalls).toBe(0);
    expect(grade).not.toHaveBeenCalled();
  });

  it('an old worker after takeover cannot reconcile the new worker reservation', async () => {
    const store = new FakeStore();
    store.ledgers.set(MONTH, {
      monthKey: MONTH,
      budgetMicroUsd: FIVE_USD,
      spentMicroUsd: 0,
      reservations: { [REQ]: { microUsd: 200, expiresAtMs: NOW + RUN_LEASE_MS } },
    });
    // Il run doc è ora posseduto dal worker nuovo B.
    store.runs.set(REQ, {
      runContractVersion: AI_RUN_CONTRACT_VERSION,
      status: 'running',
      selectionHash: computeSelectionHash(VERIF, [sid('s1')]),
      executionId: 'B',
      leaseExpiresAt: NOW + RUN_LEASE_MS,
    });
    // Il worker vecchio A prova a riconciliare → no-op (non è più titolare).
    await store.reconcileBudget({
      requestId: REQ,
      actualMicroUsd: 999_999,
      budgetMicroUsd: FIVE_USD,
      monthKey: MONTH,
      nowMs: NOW,
      executionId: 'A',
    });
    const ledger = store.ledgers.get(MONTH)!;
    expect(ledger.spentMicroUsd).toBe(0); // nessun addebito dal worker vecchio
    expect(ledger.reservations[REQ]).toBeDefined(); // prenotazione del nuovo worker intatta
  });

  it('bills provider usage even when the output is rejected as invalid (no invalid scores saved)', async () => {
    const store = new FakeStore();
    seedOneOpenOneClosed(store, 's1');
    const grader: AiGrader = {
      id: 'openai',
      model: OPENAI_PRODUCTION_MODEL,
      grade: async () => {
        throw new AiGraderInvalidOutputError('bad', {
          tokens: 600,
          inputTokens: 500,
          outputTokens: 100,
        });
      },
    };
    const res = await runExecution(req([sid('s1')]), openaiDeps(store, grader, NOW));
    expect(res.results[0]!.outcome).toBe('failed');
    expect(res.inputTokensActual).toBe(500);
    expect(res.outputTokensActual).toBe(100);
    // 500 * 0.05 + 100 * 0.4 = 65 µUSD, contabilizzati anche se l'output è rifiutato.
    expect(res.costActualMicroUsd).toBe(65);
    expect(store.ledgers.get(MONTH)!.spentMicroUsd).toBe(65);
    // Nessun punteggio/feedback invalido persistito.
    expect(store.corrections.has(sid('s1'))).toBe(false);
  });

  it('transport error carries no usage → no invented actual cost', async () => {
    const store = new FakeStore();
    seedOneOpenOneClosed(store, 's1');
    const grader: AiGrader = {
      id: 'openai',
      model: OPENAI_PRODUCTION_MODEL,
      grade: async () => {
        throw new Error('network timeout');
      },
    };
    const res = await runExecution(req([sid('s1')]), openaiDeps(store, grader, NOW));
    expect(res.results[0]!.outcome).toBe('failed');
    expect(res.costActualMicroUsd).toBe(0);
    expect(store.ledgers.get(MONTH)!.spentMicroUsd).toBe(0);
  });

  it('the ledger holds only technical amounts (no ids / uid / pii / content)', async () => {
    const store = new FakeStore();
    seedOneOpenOneClosed(store, 's1');
    await runExecution(
      req([sid('s1')]),
      openaiDeps(store, usageGrader({ inputTokens: 1000, outputTokens: 200, tokens: 1200 }), NOW),
    );
    const serialized = JSON.stringify([...store.ledgers.values()]);
    expect(serialized).not.toContain(sid('s1'));
    expect(serialized).not.toContain(VERIF);
    expect(serialized).not.toContain(OWNER);
    expect(serialized).not.toContain(SOL_MARK);
    expect(serialized).not.toContain(ANS_MARK);
    expect(serialized).not.toContain('studentUid');
  });
});
