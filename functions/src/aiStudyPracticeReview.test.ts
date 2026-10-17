import { describe, expect, it } from 'vitest';
import {
  validateAiContentRequest,
  canonicalRequest,
  computeInputHash,
  resolveContentModelForRequest,
  type PoolReviewRequest,
} from './aiContentCore.js';
import {
  validatePracticeReview,
  providerPracticePlan,
  isValidStoredPracticeReview,
  buildPracticeReviewPrompt,
} from './aiStudyPracticeReview.js';
import {
  buildContentStructuredRequest,
  estimateInputTokens,
  CHARS_PER_TOKEN,
  PROMPT_OVERHEAD_TOKENS,
  reservationInputTokenUpperBound,
} from './aiContentPayload.js';
import { estimateContentCost } from './aiContentCost.js';
import { buildDidacticReviewPrompt } from './aiContentDidacticReview.js';
import { isValidStoredDidacticReview } from './aiContentDidacticReview.js';
const source =
  'Per tracciare un ciclo controlla prima la condizione, esegui il corpo e aggiorna il valore prima di ripetere.';
const questions = [0, 1, 2].map((order) => ({
  order,
  tipo: 'aperta' as const,
  testo: `Caso ${order}`,
  difficolta: 2,
  soluzione: 'Controlla la condizione e aggiorna.',
}));
const plan = {
  plannedCoverage: [],
  objectives: [
    {
      capability: 'Tracciare',
      prerequisites: 'Variabili',
      method: 'Tabella dei valori',
      sourceQuote: source,
    },
  ],
  steps: ['esempio', 'guidato', 'autonomo'].map((stage, i) => ({
    questionOrder: i,
    objectiveIndex: 0,
    stage: stage as 'esempio' | 'guidato' | 'autonomo',
    hints: ['Controlla la condizione.', 'Aggiorna il valore.'],
  })),
};
export function practiceReviewFixture(extra: Record<string, unknown> = {}) {
  return validateAiContentRequest({
    kind: 'pool_review',
    purpose: 'practice',
    plannedObjectives: [],
    requestId: '11111111-2222-4333-8444-555555555555',
    modelProfile: 'economy',
    level: 'balanced',
    counts: { aperta: 3, chiusa_singola: 0, chiusa_multipla: 0 },
    lessonSource: source,
    existingPoolQuestionCount: 0,
    candidateQuestions: questions,
    candidateStudyPlan: plan,
    ...extra,
  }) as PoolReviewRequest;
}
export function practiceReviewRaw() {
  return {
    sourceInsufficient: false,
    questions: questions.map(({ order, ...q }) => {
      void order;
      return q;
    }),
    studyPlan: providerPracticePlan(structuredClone(plan), source),
    reviewOutcome: 'unchanged',
    issueCodes: [] as string[],
  };
}
describe('dedicated full practice review', () => {
  it('requires a complete bounded canonical candidate before provider or lease', () => {
    expect(() => practiceReviewFixture({ candidateStudyPlan: undefined })).toThrow(
      expect.objectContaining({ code: 'invalid_input' }),
    );
    expect(() => practiceReviewFixture({ candidateStudyPlan: { ...plan, steps: [] } })).toThrow(
      expect.objectContaining({ code: 'invalid_input' }),
    );
    expect(() => practiceReviewFixture({ purpose: undefined })).toThrow(
      expect.objectContaining({ code: 'invalid_input' }),
    );
  });
  it('separates practice identity and includes every hint, plan, source and request purpose', () => {
    const r = practiceReviewFixture();
    expect(canonicalRequest(r)).toContain('practice-review-v1');
    expect(
      computeInputHash(
        practiceReviewFixture({
          candidateStudyPlan: {
            ...plan,
            steps: plan.steps.map((s, i) =>
              i ? s : { ...s, hints: ['Altro aiuto', 'Altro passaggio'] },
            ),
          },
        }),
      ),
    ).not.toBe(computeInputHash(r));
    expect(
      computeInputHash(practiceReviewFixture({ lessonSource: source + ' Nuova parte.' })),
    ).not.toBe(computeInputHash(r));
  });
  it('resolves exact evidence and preserves canonical v1 without raw IDs or review feedback', () => {
    const r = practiceReviewFixture();
    const result = validatePracticeReview(practiceReviewRaw(), r);
    expect(result.studyPlan).toEqual(plan);
    expect(result.questions).toEqual(questions);
    expect(JSON.stringify(result)).not.toContain('sourceExcerptId');
    expect(isValidStoredPracticeReview(result)).toBe(true);
    expect(isValidStoredDidacticReview('pool_review', result)).toBe(true);
    expect(validatePracticeReview(result, r, true)).toEqual(result);
  });
  it('corrects a concrete irrelevant hint with a complete valid plan and refuses disguised unchanged edits', () => {
    const raw = practiceReviewRaw();
    raw.studyPlan.steps[1]!.hints = ['Individua il valore attuale.', 'Valuta la condizione.'];
    expect(() => validatePracticeReview(raw, practiceReviewFixture())).toThrow();
    raw.reviewOutcome = 'improved';
    raw.issueCodes = ['irrelevant_hint'];
    expect(validatePracticeReview(raw, practiceReviewFixture()).studyPlan?.steps[1]?.hints).toEqual(
      raw.studyPlan.steps[1]?.hints,
    );
  });
  it('blocks insufficient source, foreign refs, missing stages, changed difficulty and contradictory outcomes', () => {
    const request = practiceReviewFixture();
    expect(() =>
      validatePracticeReview({ ...practiceReviewRaw(), sourceInsufficient: true }, request),
    ).toThrow(expect.objectContaining({ code: 'source_insufficient' }));
    const raw = practiceReviewRaw();
    raw.studyPlan.objectives[0]!.sourceExcerptId = 999;
    expect(() => validatePracticeReview(raw, request)).toThrow();
    const changed = practiceReviewRaw();
    changed.questions[0]!.difficolta = 4;
    changed.reviewOutcome = 'improved';
    changed.issueCodes = ['incorrect_solution'];
    expect(() => validatePracticeReview(changed, request)).toThrow();
    expect(() =>
      validatePracticeReview({ ...practiceReviewRaw(), issueCodes: ['irrelevant_hint'] }, request),
    ).toThrow();
    const invalid = practiceReviewRaw();
    invalid.studyPlan.steps[1]!.stage = 'esempio';
    expect(() => validatePracticeReview(invalid, request)).toThrow();
  });
  it('uses Sol and the exact quoted-source payload for estimates and reservations', () => {
    const r = practiceReviewFixture();
    const policy = resolveContentModelForRequest(r);
    expect(policy.model).toContain('sol');
    const payload = buildContentStructuredRequest(r, policy.model);
    expect(payload.max_output_tokens).toBe(16000);
    expect(reservationInputTokenUpperBound(r, policy.model)).toBe(
      Buffer.byteLength(JSON.stringify(payload), 'utf8'),
    );
    expect(
      estimateContentCost(r, policy.model, policy.priceListVersion, 1).reservationCostMicroUsd,
    ).toBeGreaterThan(0);
    const text = buildPracticeReviewPrompt(r).user;
    expect(text).toContain('OGNI hint');
    expect(text).toContain('sourceExcerptId');
    expect(text.split('<<<ESTRATTO 0>>>')).toHaveLength(2);
  });
  it('estimates the complete actual review prompt when only hints change, preserving the exact reservation payload and ordinary pool formula', () => {
    const base = practiceReviewFixture();
    const changed = practiceReviewFixture({
      candidateStudyPlan: {
        ...plan,
        steps: plan.steps.map((step, i) =>
          i ? step : { ...step, hints: ['Aiuto dettagliato '.repeat(60), step.hints[1]!] },
        ),
      },
    });
    expect(estimateInputTokens(changed)).toBeGreaterThan(estimateInputTokens(base));
    for (const request of [base, changed]) {
      const prompt = buildPracticeReviewPrompt(request);
      expect(estimateInputTokens(request)).toBe(
        Math.ceil((prompt.system.length + prompt.user.length) / CHARS_PER_TOKEN) +
          PROMPT_OVERHEAD_TOKENS,
      );
      const policy = resolveContentModelForRequest(request);
      expect(reservationInputTokenUpperBound(request, policy.model)).toBe(
        Buffer.byteLength(
          JSON.stringify(buildContentStructuredRequest(request, policy.model)),
          'utf8',
        ),
      );
    }
    const { candidateStudyPlan, ...ordinaryFields } = base;
    void candidateStudyPlan;
    const ordinary = { ...ordinaryFields, purpose: undefined } as PoolReviewRequest;
    const prompt = buildDidacticReviewPrompt(ordinary);
    expect(estimateInputTokens(ordinary)).toBe(
      Math.ceil((prompt.system.length + prompt.user.length) / CHARS_PER_TOKEN) +
        PROMPT_OVERHEAD_TOKENS,
    );
  });
  it('fails stored malformed references and source changes while ordinary pool legacy remains readable', () => {
    const result = validatePracticeReview(practiceReviewRaw(), practiceReviewFixture());
    expect(isValidStoredPracticeReview({ ...result, studyPlan: { ...plan, steps: [] } })).toBe(
      false,
    );
    expect(() =>
      validatePracticeReview(
        result,
        practiceReviewFixture({
          lessonSource: 'Una fonte completamente diversa non contiene il metodo precedente.',
        }),
        true,
      ),
    ).toThrow();
    expect(
      isValidStoredDidacticReview('pool_review', {
        questions,
        reviewOutcome: 'unchanged',
        issueCodes: [],
      }),
    ).toBe(true);
  });
});
import type { Firestore } from 'firebase-admin/firestore';
import { createPorts } from './aiContentGateway.js';
import { generateContent } from './aiContentEngine.js';
import {
  OPENAI_RUNTIME_LUNA_MODEL,
  OPENAI_RUNTIME_LUNA_PRICE_LIST_VERSION,
} from './aiCorrectionCost.js';
import type { AiRuntimeConfig } from './aiCorrectionRuntimeConfig.js';
import { vi } from 'vitest';

it.each(['invalid', 'invocation_unknown'] as const)(
  'retries only failed review using real gateway ports and ledger, then replays without cost (%s)',
  async (failure) => {
    const documents = new Map<string, Record<string, unknown>>();
    const doc = (path: string) => ({
      path,
      get: async () => ({ exists: documents.has(path), data: () => documents.get(path) }),
    });
    const tx = {
      get: async (ref: ReturnType<typeof doc>) => ref.get(),
      set: (
        ref: ReturnType<typeof doc>,
        value: Record<string, unknown>,
        options?: { merge?: boolean },
      ) => {
        documents.set(ref.path, options?.merge ? { ...documents.get(ref.path), ...value } : value);
      },
    };
    const database = {
      doc,
      runTransaction: async <T>(callback: (transaction: typeof tx) => Promise<T>) => callback(tx),
    } as unknown as Firestore;
    const config: AiRuntimeConfig = {
      enabled: true,
      provider: 'openai',
      model: OPENAI_RUNTIME_LUNA_MODEL,
      environment: 'dev',
      limits: {
        maxSubmissionsPerOperation: 30,
        maxOpenQuestionsPerSubmission: 20,
        maxEstimatedTokensPerSubmission: 10000,
        maxEstimatedTokensPerOperation: 300000,
        maxProviderConcurrency: 3,
        attemptTimeoutMs: 60000,
        maxApplicationRetries: 1,
      },
      maxOperationCostMicroUsd: 5000000,
      dailyBudgetMicroUsd: 10000000,
      monthlyBudgetMicroUsd: 50000000,
      configVersion: 'test',
      priceListVersion: OPENAI_RUNTIME_LUNA_PRICE_LIST_VERSION,
    };
    const request = practiceReviewFixture();
    const context = {
      authenticatedOwnerUid: 'synthetic-owner',
      nowMs: 1000000,
      executionId: 'execution-one',
      mode: 'mock' as const,
      leaseMs: 300000,
    };
    const ports = createPorts(database, config, 'mock', undefined, true, 'pool_review');
    const provider = vi
      .fn()
      .mockResolvedValueOnce(
        failure === 'invalid'
          ? {
              status: 'ok',
              output: {},
              usage: { inputTokens: 100, outputTokens: 100 },
              metered: true,
              priorBillingRisk: false,
            }
          : { status: 'error', phase: 'invocation_unknown' },
      )
      .mockResolvedValue({
        status: 'ok',
        output: practiceReviewRaw(),
        usage: { inputTokens: 100, outputTokens: 100 },
        metered: true,
        priorBillingRisk: false,
      });
    ports.callProvider = provider;
    await expect(generateContent(request, context, ports)).rejects.toMatchObject({
      code: failure === 'invalid' ? 'provider_invalid_output' : 'provider_unavailable',
    });
    const runBefore = [...documents.entries()].find(([path]) =>
      path.startsWith('aiContentRuns/'),
    )![1];
    expect(runBefore.status).toBe('failed');
    const ledger = () =>
      [...documents.entries()].find(([path]) => path.startsWith('aiBudgetLedger/'))![1];
    const spentAfterFailure = ledger().spentMicroUsd as number;
    expect(spentAfterFailure).toBeGreaterThan(0);
    expect(ledger().reservations).toEqual({});
    const result = await generateContent(
      request,
      { ...context, nowMs: 1000001, executionId: 'execution-two' },
      ports,
    );
    expect(result.replayed).toBe(false);
    expect(provider).toHaveBeenCalledTimes(2);
    expect(ledger().spentMicroUsd).toBeGreaterThan(spentAfterFailure);
    expect(ledger().reservations).toEqual({});
    const spentAfterSuccess = ledger().spentMicroUsd;
    const replay = await generateContent(
      request,
      { ...context, nowMs: 1000002, executionId: 'execution-three' },
      ports,
    );
    expect(replay.replayed).toBe(true);
    expect(replay.output).toEqual(result.output);
    expect(provider).toHaveBeenCalledTimes(2);
    expect(ledger().spentMicroUsd).toBe(spentAfterSuccess);
  },
);
