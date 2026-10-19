import { describe, expect, it, vi } from 'vitest';
import {
  AiGatewayError,
  MockAiGrader,
  validateAiCorrectionRequest,
  type AiCorrectionRequest,
  type AiGrader,
} from './aiCorrectionGatewayCore.js';
import {
  previewCorrectionPlan,
  executeCorrectionPlanGroup,
  loadCorrectionPlan,
  type PlanDeps,
  type CorrectionPlan,
  type PlanView,
  MAX_PLAN_SUBMISSIONS,
  MAX_PLAN_DOCUMENT_BYTES,
  encodeCorrectionPlan,
  decodeCorrectionPlan,
  terminalPlanSizeForecast,
  planStorageUpperBound,
  assertPlanStorageCapacity,
} from './aiCorrectionPlan.js';
import {
  replayPersistedRun,
  runPreview,
  runExecution,
  type PersistedRun,
  type EngineWritePorts,
  type SubmissionData,
  type CorrectionData,
  type VerificationData,
} from './aiCorrectionEngine.js';
import {
  emptyLedger,
  reserve,
  reconcile,
  markPending,
  monthKeyFromMs,
} from './aiCorrectionBudget.js';
import { DEV_LIMITS } from './aiCorrectionLimits.js';
import {
  OPENAI_RUNTIME_GPT6_LUNA_MODEL,
  OPENAI_RUNTIME_GPT6_LUNA_PRICE_LIST_VERSION,
} from './aiCorrectionCost.js';
import { OpenAiGrader } from './openAiGrader.js';
import type { AiRuntimeConfig } from './aiCorrectionRuntimeConfig.js';

const now = Date.UTC(2026, 9, 19, 9);
function fixture(count = 7) {
  const config: AiRuntimeConfig = {
    enabled: true,
    environment: 'dev',
    provider: 'openai',
    model: OPENAI_RUNTIME_GPT6_LUNA_MODEL,
    priceListVersion: OPENAI_RUNTIME_GPT6_LUNA_PRICE_LIST_VERSION,
    configVersion: 'test-v1',
    limits: { ...DEV_LIMITS },
    maxOperationCostMicroUsd: 5_000_000,
    dailyBudgetMicroUsd: 15_000_000,
    monthlyBudgetMicroUsd: 50_000_000,
  };
  const request: AiCorrectionRequest = {
    verificationId: 'v1',
    requestId: 'request-plan-01',
    submissionIds: Array.from({ length: count }, (_, i) => `v1_s${String(i).padStart(4, '0')}`),
    gradingMode: 'balanced',
    modelProfile: 'economy',
    advancedReview: false,
  };
  const verification: VerificationData = {
    ownerUid: 'owner',
    status: 'closed',
    teacherQuestions: [
      {
        order: 0,
        tipo: 'aperta',
        difficolta: 2,
        maxPoints: 2,
        testo: 'QUESTION_PRIVATE',
        soluzione: 'REFERENCE_PRIVATE',
      },
    ],
  };
  const submissions = new Map<string, SubmissionData>(
    request.submissionIds.map((id) => [
      id,
      {
        ownerUid: 'owner',
        verificationId: 'v1',
        studentUid: id.slice(3),
        status: 'submitted',
        answers: { '0': { tipo: 'aperta', testo: 'ANSWER_PRIVATE' } },
      },
    ]),
  );
  const corrections = new Map<string, CorrectionData>();
  const plans = new Map<string, CorrectionPlan>();
  const runs = new Map<string, PersistedRun>();
  const runLeases = new Set<string>();
  let head: string | undefined;
  let ledger = emptyLedger(
    monthKeyFromMs(now),
    config.monthlyBudgetMicroUsd,
    config.dailyBudgetMicroUsd,
  );
  const mock = new MockAiGrader();
  const bound = new OpenAiGrader(config.model, {
    send: async () => {
      throw new Error('No provider allowed');
    },
  });
  const grade = vi.fn<AiGrader['grade']>(async (input) => ({
    ...(await mock.grade(input)),
    usage: {
      inputTokens: 100,
      outputTokens: 20,
      tokens: 120,
      cachedInputTokens: 0,
      cacheWriteInputTokens: 0,
    },
  }));
  const grader: AiGrader = {
    id: 'openai',
    model: config.model,
    maxOutputTokensPerCall: bound.maxOutputTokensPerCall,
    reservationInputTokenUpperBound: (input) => bound.reservationInputTokenUpperBound(input),
    grade,
  };
  const ports: EngineWritePorts = {
    loadVerification: vi.fn(async () => structuredClone(verification)),
    loadSubmission: vi.fn(async (id) => structuredClone(submissions.get(id) ?? null)),
    loadCorrection: vi.fn(async (id) => structuredClone(corrections.get(id) ?? null)),
    beginRun: vi.fn(async (id, meta) => {
      if (runs.has(id)) return { state: 'completed', existing: runs.get(id)! };
      if (runLeases.has(id)) return { state: 'locked' };
      runLeases.add(id);
      return { state: 'acquired', executionId: meta.executionId };
    }),
    finishRun: vi.fn(async (id, run) => {
      runs.set(id, structuredClone(run));
    }),
    commitSubmission: vi.fn(async (input) => {
      corrections.set(input.submissionId, {
        status: 'in_progress',
        reopenCount: 0,
        evaluations: Object.fromEntries(
          [...input.proposed].map(([order, score]) => [
            String(order),
            { order, points: score.points, maxPoints: 2 },
          ]),
        ),
      });
      return { result: 'written', writtenOrders: [...input.proposed.keys()] };
    }),
    reserveBudget: vi.fn(async (input) => {
      const outcome = reserve(
        ledger,
        input.requestId,
        input.amountMicroUsd,
        input.expiresAtMs,
        input.nowMs,
        input.dayKey,
      );
      if (outcome.ok) ledger = outcome.state;
      return outcome.ok ? { ok: true, reservedMicroUsd: outcome.reservedMicroUsd } : outcome;
    }),
    markBudgetInvoked: vi.fn(async (input) => {
      ledger = markPending(ledger, input.requestId, input.nowMs);
      return true;
    }),
    reconcileBudget: vi.fn(async (input) => {
      ledger = reconcile(ledger, input.requestId, input.actualMicroUsd, input.nowMs);
    }),
  };
  const deps: PlanDeps = {
    callerUid: 'owner',
    getOwnerUid: async () => 'owner',
    featureMode: 'openai',
    ports,
    grader,
    loadRuntimeConfig: async () => config,
    now: () => now,
    plans: {
      save: async (plan) => {
        plans.set(plan.planId, structuredClone(plan));
        head = plan.planId;
        return structuredClone(plan);
      },
      load: async (owner, verificationId, id = head) => {
        const p = id ? plans.get(id) : null;
        return p?.ownerUid === owner && p.verificationId === verificationId
          ? structuredClone(p)
          : null;
      },
      update: async (id, mutate) => {
        const updated = mutate(structuredClone(plans.get(id)!));
        plans.set(id, structuredClone(updated));
        return updated;
      },
      ledger: async () => ({
        ...ledger,
        budgetMicroUsd: config.monthlyBudgetMicroUsd,
        dailyBudgetMicroUsd: config.dailyBudgetMicroUsd,
      }),
      terminalResult: async (child) =>
        runs.has(child.requestId) ? replayPersistedRun(child, runs.get(child.requestId)!) : null,
    },
  };
  return {
    config,
    request,
    verification,
    submissions,
    corrections,
    plans,
    runs,
    grade,
    ports,
    deps,
    ledger: () => ledger,
  };
}
function action(plan: PlanView, index = 0) {
  return {
    verificationId: plan.verificationId,
    planId: plan.planId,
    groupIndex: index,
    maximumCostMicroUsd: plan.preview.maximumCostMicroUsd,
    groupMaximumCostMicroUsd: plan.groups[index]!.maximumCostMicroUsd,
  };
}

describe('durable correction plans', () => {
  it('reserves checkpoint growth before consent for the maximum selection, single-student groups and escaped Unicode guidance', async () => {
    const f = fixture(MAX_PLAN_SUBMISSIONS);
    const verificationId = 'v'.repeat(180);
    const ids = f.request.submissionIds.map(
      (_, i) => `${verificationId}_${String(i).padStart(19, '0')}`,
    );
    const rows = [...f.submissions.values()];
    f.submissions.clear();
    ids.forEach((id, i) => f.submissions.set(id, { ...rows[i]!, verificationId }));
    f.request.verificationId = verificationId;
    f.request.submissionIds = ids;
    f.request.teacherGuidance = '😀\\"\n'.repeat(100);
    f.config.limits.maxProviderConcurrency = 1;
    const view = await previewCorrectionPlan(f.request, f.deps);
    expect(view.groups).toHaveLength(MAX_PLAN_SUBMISSIONS);
    const plan = f.plans.get(view.planId)!;
    expect(decodeCorrectionPlan(structuredClone(plan))).toEqual(plan);
    // Budget recommendations can repeat up to all selected IDs in the same
    // document: include their maximal contribution in this boundary case.
    plan.budget = {
      reason: 'daily_budget_exceeded',
      availableMicroUsd: 1,
      compatibleSubmissionIds: ids,
    };
    assertPlanStorageCapacity(plan);
    const terminal = terminalPlanSizeForecast(plan);
    expect(planStorageUpperBound(terminal)).toBeLessThan(MAX_PLAN_DOCUMENT_BYTES);
    const encoded = encodeCorrectionPlan(terminal);
    expect(
      encoded.groups.every(
        (g) => !('teacherGuidance' in g.request) && !('verificationId' in g.request),
      ),
    ).toBe(true);
    expect(encoded.groups[0]!.result!.results[0]).not.toHaveProperty('submissionId');
    expect(decodeCorrectionPlan(encoded)).toEqual(terminal);
    const excessive: CorrectionPlan = {
      ...plan,
      groups: [...plan.groups, ...plan.groups],
      budget: undefined,
    };
    delete excessive.budget;
    expect(() => assertPlanStorageCapacity(excessive)).toThrowError(
      expect.objectContaining({ code: 'plan_size_exceeded' }),
    );
    expect(f.grade).not.toHaveBeenCalled();
  });
  it('plans >200 selections in canonical server groups without enlarging the run request limit or reading content twice', async () => {
    const f = fixture(205);
    expect(() => validateAiCorrectionRequest(f.request)).toThrowError(AiGatewayError);
    const plan = await previewCorrectionPlan(f.request, f.deps);
    expect(plan.groups).toHaveLength(69);
    expect(plan.groups.every((g) => g.submissionIds.length <= 3)).toBe(true);
    expect(plan.groups.flatMap((g) => g.submissionIds)).toEqual(
      [...f.request.submissionIds].sort(),
    );
    expect(f.ports.loadVerification).toHaveBeenCalledTimes(1);
    expect(f.ports.loadSubmission).toHaveBeenCalledTimes(205);
    expect(f.grade).not.toHaveBeenCalled();
    expect(f.ports.reserveBudget).not.toHaveBeenCalled();
    expect(JSON.stringify([...f.plans.values()])).not.toMatch(
      /QUESTION_PRIVATE|REFERENCE_PRIVATE|ANSWER_PRIVATE/,
    );
    const replay = await previewCorrectionPlan(
      { ...f.request, submissionIds: [...f.request.submissionIds].reverse() },
      f.deps,
    );
    expect(replay.groups).toEqual(plan.groups);
  });
  it('groups by token and exact conservative reservation ceilings, including cache write, audit and retries', async () => {
    const f = fixture(5);
    const first = await previewCorrectionPlan(f.request, f.deps);
    const perItem = first.groups[0]!.maximumCostMicroUsd / 3;
    f.config.maxOperationCostMicroUsd = Math.ceil(perItem * 1.5);
    const plan = await previewCorrectionPlan(
      { ...f.request, requestId: 'request-plan-02' },
      f.deps,
    );
    expect(plan.groups).toHaveLength(5);
    expect(
      plan.groups.every((g) => g.maximumCostMicroUsd <= f.config.maxOperationCostMicroUsd),
    ).toBe(true);
    const baseline = await previewCorrectionPlan(
      { ...f.request, requestId: 'request-plan-03', submissionIds: [f.request.submissionIds[0]!] },
      f.deps,
    );
    f.config.maxOperationCostMicroUsd = 5_000_000;
    const reviewed = await previewCorrectionPlan(
      {
        ...f.request,
        requestId: 'request-plan-04',
        submissionIds: [f.request.submissionIds[0]!],
        advancedReview: true,
      },
      f.deps,
    );
    expect(reviewed.preview.maximumCostMicroUsd).toBeGreaterThan(
      baseline.preview.maximumCostMicroUsd * 2,
    );
    f.config.limits.maxEstimatedTokensPerOperation = 500;
    const tokenPlan = await previewCorrectionPlan(
      { ...f.request, requestId: 'request-plan-05' },
      f.deps,
    );
    expect(tokenPlan.groups.every((g) => g.submissionIds.length < 3)).toBe(true);
  });
  it('isolates a long submission without truncating its question, reference or answer, including the reviewer', async () => {
    const f = fixture(3);
    const question = 'Domanda completa '.repeat(500);
    const reference = 'Soluzione completa '.repeat(700);
    const answer = 'Risposta completa '.repeat(1000);
    f.verification.teacherQuestions![0]!.testo = question;
    f.verification.teacherQuestions![0]!.soluzione = reference;
    f.submissions.get(f.request.submissionIds[1]!)!.answers['0'] = {
      tipo: 'aperta',
      testo: answer,
    };
    const request = { ...f.request, advancedReview: true };
    const plan = await previewCorrectionPlan(request, f.deps);
    expect(plan.preview.counts).toMatchObject({ selected: 3, eligible: 3, excluded: 0 });
    expect(plan.groups.map((g) => g.submissionIds)).toEqual(
      f.request.submissionIds.map((id) => [id]),
    );
    expect(f.config.limits.maxEstimatedTokensPerSubmission).toBe(10000);
    await executeCorrectionPlanGroup(action(plan, 0), f.deps);
    const result = await executeCorrectionPlanGroup(action(plan, 1), f.deps);
    const calls = f.grade.mock.calls.filter(
      ([input]) => input.questions[0]?.studentAnswer === answer,
    );
    expect(calls).toHaveLength(2);
    for (const [input] of calls)
      expect(input.questions[0]).toMatchObject({
        questionText: question,
        referenceSolution: reference,
        studentAnswer: answer,
      });
    expect(calls[1]![0].reviewProposal).toBeTruthy();
    expect(result.groups[1]!.result!.costReservationMicroUsd).toBe(
      plan.groups[1]!.maximumCostMicroUsd,
    );
    expect(result.groups[1]!.result!.costSettledMicroUsd).toBeLessThanOrEqual(
      result.groups[1]!.result!.costReservationMicroUsd,
    );
    const attempts = f.grade.mock.calls.length;
    await executeCorrectionPlanGroup(action(plan, 1), f.deps);
    expect(f.grade).toHaveBeenCalledTimes(attempts);
    f.submissions.get(f.request.submissionIds[2]!)!.answers['0'] = {
      tipo: 'aperta',
      testo: answer,
    };
    const legacy = {
      ...request,
      requestId: 'legacy-long-request',
      submissionIds: [f.request.submissionIds[2]!],
    };
    await expect(runPreview(legacy, f.deps)).rejects.toMatchObject({
      code: 'submission_tokens_exceeded',
    });
    await expect(runExecution(legacy, f.deps)).rejects.toMatchObject({
      code: 'submission_tokens_exceeded',
    });
    await expect(
      runPreview({ ...legacy, isolatedPlanSubmission: true }, f.deps),
    ).rejects.toMatchObject({
      code: 'invalid_input',
    });
  });
  it('retains the operation workload cap and character guards for isolated plan submissions', async () => {
    const f = fixture(3);
    f.config.limits.maxEstimatedTokensPerOperation = 1000;
    f.submissions.get(f.request.submissionIds[1]!)!.answers['0'] = {
      tipo: 'aperta',
      testo: 'a'.repeat(18000),
    };
    f.submissions.get(f.request.submissionIds[2]!)!.answers['0'] = {
      tipo: 'aperta',
      testo: 'a'.repeat(20001),
    };
    const plan = await previewCorrectionPlan(f.request, f.deps);
    expect(plan.preview.counts).toMatchObject({ selected: 3, eligible: 1, excluded: 2 });
    expect(plan.preview.excluded).toEqual([
      { submissionId: f.request.submissionIds[1], reason: 'operation_tokens_exceeded' },
      { submissionId: f.request.submissionIds[2], reason: 'too_large' },
    ]);
    expect(f.grade).not.toHaveBeenCalled();
  });
  it('does not combine a long isolated item with other submissions or bypass the reviewer workload cap', async () => {
    const f = fixture(3);
    f.config.limits.maxEstimatedTokensPerSubmission = 1000;
    f.submissions.get(f.request.submissionIds[1]!)!.answers['0'] = {
      tipo: 'aperta',
      testo: 'a'.repeat(18000),
    };
    const plan = await previewCorrectionPlan(f.request, f.deps);
    expect(plan.groups.map((g) => g.submissionIds)).toEqual(
      f.request.submissionIds.map((id) => [id]),
    );
    await expect(
      runPreview(f.request, { ...f.deps, isolatedPlanSubmission: true }),
    ).rejects.toMatchObject({ code: 'submission_tokens_exceeded' });
    f.config.limits.maxEstimatedTokensPerOperation = 6000;
    const reviewed = await previewCorrectionPlan(
      { ...f.request, requestId: 'reviewed-limited-plan', advancedReview: true },
      f.deps,
    );
    expect(reviewed.preview.excluded).toEqual([
      { submissionId: f.request.submissionIds[1], reason: 'operation_tokens_exceeded' },
    ]);
    expect(f.grade).not.toHaveBeenCalled();
  });
  it('requires a new plan if the operation cap is lowered after a long submission was consented', async () => {
    const f = fixture(1);
    f.verification.teacherQuestions![0]!.soluzione = 'Soluzione completa '.repeat(1200);
    f.submissions.get(f.request.submissionIds[0]!)!.answers['0'] = {
      tipo: 'aperta',
      testo: 'a'.repeat(18000),
    };
    const plan = await previewCorrectionPlan(f.request, f.deps);
    expect(plan.preview.counts.eligible).toBe(1);
    f.config.limits.maxEstimatedTokensPerOperation = 1000;
    await expect(executeCorrectionPlanGroup(action(plan), f.deps)).rejects.toMatchObject({
      code: 'plan_changed',
    });
    expect(f.grade).not.toHaveBeenCalled();
    expect(f.ports.reserveBudget).not.toHaveBeenCalled();
    expect(f.ports.markBudgetInvoked).not.toHaveBeenCalled();
  });
  it.each(['daily', 'monthly'] as const)(
    'offers an explicit budget-compatible subset for insufficient %s budget without reserving anything',
    async (kind) => {
      const f = fixture(8);
      const full = await previewCorrectionPlan(f.request, f.deps);
      const ceiling = Math.floor((full.groups[0]!.maximumCostMicroUsd * 2) / 3);
      if (kind === 'daily') f.config.dailyBudgetMicroUsd = ceiling;
      else f.config.monthlyBudgetMicroUsd = ceiling;
      const plan = await previewCorrectionPlan(
        { ...f.request, requestId: 'request-plan-budget' },
        f.deps,
      );
      expect(plan.budget?.reason).toBe(
        kind === 'daily' ? 'daily_budget_exceeded' : 'budget_exceeded',
      );
      expect(plan.budget?.compatibleSubmissionIds.length).toBeGreaterThan(0);
      expect(plan.budget?.compatibleSubmissionIds.length).toBeLessThan(8);
      await expect(executeCorrectionPlanGroup(action(plan), f.deps)).rejects.toMatchObject({
        code: plan.budget?.reason,
      });
      expect(f.ports.reserveBudget).not.toHaveBeenCalled();
      const subset = await previewCorrectionPlan(
        {
          ...f.request,
          requestId: 'request-plan-subset',
          submissionIds: plan.budget!.compatibleSubmissionIds,
        },
        f.deps,
      );
      expect(subset.budget).toBeUndefined();
      expect(subset.preview.maximumCostMicroUsd).toBeLessThanOrEqual(ceiling);
    },
  );
  it('enforces total and per-group consent, order, completed replay and stable pending membership after reload', async () => {
    const f = fixture(7);
    let plan = await previewCorrectionPlan(f.request, f.deps);
    await expect(
      executeCorrectionPlanGroup({ ...action(plan), maximumCostMicroUsd: 1 }, f.deps),
    ).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(
      executeCorrectionPlanGroup({ ...action(plan), groupMaximumCostMicroUsd: 1 }, f.deps),
    ).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(executeCorrectionPlanGroup(action(plan, 1), f.deps)).rejects.toMatchObject({
      code: 'invalid_input',
    });
    const stable = plan.groups.map((g) => [g.requestId, g.submissionIds]);
    plan = await executeCorrectionPlanGroup(action(plan), f.deps);
    expect(plan.groups[0]!.state).toBe('completed');
    expect(f.grade).toHaveBeenCalledTimes(3);
    await executeCorrectionPlanGroup(action(plan), f.deps);
    expect(f.grade).toHaveBeenCalledTimes(3);
    const loaded = await loadCorrectionPlan({ verificationId: 'v1' }, f.deps);
    expect(loaded?.groups.map((g) => [g.requestId, g.submissionIds])).toEqual(stable);
    plan = await executeCorrectionPlanGroup(action(plan, 1), f.deps);
    plan = await executeCorrectionPlanGroup(action(plan, 2), f.deps);
    expect(f.grade).toHaveBeenCalledTimes(7);
    expect(plan.groups.every((g) => g.state === 'completed')).toBe(true);
    expect(f.ledger().spentMicroUsd).toBeLessThanOrEqual(plan.preview.maximumCostMicroUsd);
  });
  it('concurrent starts have one writer and cannot invoke a group twice', async () => {
    const f = fixture(3);
    const plan = await previewCorrectionPlan(f.request, f.deps);
    await Promise.allSettled([
      executeCorrectionPlanGroup(action(plan), f.deps),
      executeCorrectionPlanGroup(action(plan), f.deps),
    ]);
    expect(f.grade).toHaveBeenCalledTimes(3);
    expect(f.ports.reserveBudget).toHaveBeenCalledTimes(1);
  });
  it('restores a terminal child after lost parent finalization without any additional provider call', async () => {
    const f = fixture(3);
    const plan = await previewCorrectionPlan(f.request, f.deps);
    const realUpdate = f.deps.plans.update;
    f.deps.plans.update = async (id, mutate) => {
      if (f.runs.size > 0) throw new Error('lost finalization');
      return realUpdate(id, mutate);
    };
    await expect(executeCorrectionPlanGroup(action(plan), f.deps)).rejects.toThrow(
      'lost finalization',
    );
    f.deps.plans.update = realUpdate;
    const recovered = await executeCorrectionPlanGroup(action(plan), f.deps);
    expect(recovered.groups[0]!.state).toBe('completed');
    expect(f.grade).toHaveBeenCalledTimes(3);
    expect(f.ports.reserveBudget).toHaveBeenCalledTimes(1);
  });
  it('fences unknown invocation outcomes and prevents a disjoint new plan from hiding them', async () => {
    const f = fixture(4);
    const plan = await previewCorrectionPlan(f.request, f.deps);
    f.ports.markBudgetInvoked = async () => {
      throw new Error('lost fence response');
    };
    await expect(executeCorrectionPlanGroup(action(plan), f.deps)).rejects.toThrow(
      'lost fence response',
    );
    await expect(executeCorrectionPlanGroup(action(plan), f.deps)).rejects.toMatchObject({
      code: 'plan_ambiguous',
    });
    await expect(
      previewCorrectionPlan(
        {
          ...f.request,
          requestId: 'request-other-plan',
          submissionIds: [f.request.submissionIds[3]!],
        },
        f.deps,
      ),
    ).rejects.toMatchObject({ code: 'plan_ambiguous' });
    expect(f.grade).not.toHaveBeenCalled();
  });
  it('does not strand proven pre-provider budget rejection as an ambiguous group; fresh consent can recover remaining IDs', async () => {
    const f = fixture(3);
    const plan = await previewCorrectionPlan(f.request, f.deps);
    f.ports.reserveBudget = async () => ({ ok: false, reason: 'daily_budget_exceeded' });
    await expect(executeCorrectionPlanGroup(action(plan), f.deps)).rejects.toMatchObject({
      code: 'daily_budget_exceeded',
    });
    expect((await loadCorrectionPlan({ verificationId: 'v1' }, f.deps))?.groups[0]!.state).toBe(
      'blocked',
    );
    await expect(executeCorrectionPlanGroup(action(plan), f.deps)).rejects.toMatchObject({
      code: 'daily_budget_exceeded',
    });
    expect(f.grade).not.toHaveBeenCalled();
    await expect(
      previewCorrectionPlan({ ...f.request, requestId: 'request-fresh-plan' }, f.deps),
    ).resolves.toMatchObject({ consented: false });
  });
  it.each(['source', 'config', 'expiry'] as const)(
    'fails closed on %s changes and verifies session owner before reuse',
    async (kind) => {
      const f = fixture(3);
      const plan = await previewCorrectionPlan(f.request, f.deps);
      if (kind === 'source')
        f.submissions.get(f.request.submissionIds[0]!)!.answers['0'] = {
          tipo: 'aperta',
          testo: 'changed answer',
        };
      if (kind === 'config') f.config.limits.maxSubmissionsPerOperation--;
      if (kind === 'expiry') f.deps.now = () => now + 86400001;
      await expect(executeCorrectionPlanGroup(action(plan), f.deps)).rejects.toMatchObject({
        code: 'plan_changed',
      });
      await expect(
        loadCorrectionPlan({ verificationId: 'v1' }, { ...f.deps, callerUid: 'other' }),
      ).rejects.toMatchObject({ code: 'not_owner' });
      await expect(
        loadCorrectionPlan({ verificationId: 'v1' }, { ...f.deps, callerUid: null }),
      ).rejects.toMatchObject({ code: 'unauthenticated' });
      expect(f.grade).not.toHaveBeenCalled();
    },
  );
});
