import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createCompletePracticeState,
  runCompletePractice,
  parseCompletePracticeState,
} from '../completePracticeGeneration.js';
import {
  createCompleteLessonCheckpoint,
  parseCompleteLessonCheckpoint,
} from '../completeLessonCheckpoint.js';
import { studyFixture, STUDY_BODY } from './studyFixture.js';
import type { PracticeEstimate } from '../completePracticeGeneration.js';
import type {
  AiPoolGenerateResult,
  AiPoolReviewResult,
  AiPoolContentRequest,
  AiPoolReviewRequest,
} from '../../pools/aiContentClient.js';
const identity = { programId: 'p', importId: 'i', lessonId: 'l' };
function fixture(n = 6): AiPoolGenerateResult {
  const f = studyFixture();
  return {
    status: 'completed',
    kind: 'pool',
    modelProfile: 'economy',
    actualCostMicroUsd: 10,
    replayed: false,
    output: {
      questions: Array.from({ length: n }, (_, i) => ({
        ...f.questions[i === n - 1 ? 2 : 0]!,
        order: i,
        testo: `Caso ${i}`,
      })),
      studyPlan: {
        ...f.plan,
        steps: Array.from({ length: n }, (_, i) => ({
          ...f.plan.steps[0]!,
          questionOrder: i,
          stage: i === 0 ? 'esempio' : i === 1 ? 'guidato' : 'autonomo',
        })),
      },
    },
  };
}
function setup(n = 6) {
  const base = fixture(n);
  const reviewed: AiPoolReviewResult = {
    ...base,
    kind: 'pool_review',
    actualCostMicroUsd: 20,
    output: { ...base.output, reviewOutcome: 'unchanged', issueCodes: [] },
    reviewFeedback: { changes: ['TRANSIENT_REPORT'] },
  };
  const state = createCompletePracticeState(['Prevedere output']);
  const callables = {
    preview: vi.fn(async (_request: AiPoolContentRequest) => ({
      kind: 'pool' as const,
      modelProfile: 'economy',
      estimatedInputTokens: 10,
      maxOutputTokens: 100,
      estimatedCostMicroUsd: 30,
      reservationCostMicroUsd: 50,
      requestedTotal: n,
    })),
    generate: vi.fn(async (_request: AiPoolContentRequest) => base),
    previewReview: vi.fn(async (_request: AiPoolReviewRequest) => ({
      kind: 'pool_review' as const,
      modelProfile: 'economy',
      estimatedInputTokens: 10,
      maxOutputTokens: 100,
      estimatedCostMicroUsd: 40,
      reservationCostMicroUsd: 60,
      requestedTotal: n,
    })),
    generateReview: vi.fn(async (_request: AiPoolReviewRequest) => reviewed),
  };
  const params = {
    body: STUDY_BODY,
    count: n,
    modelProfile: 'economy' as const,
    review: true,
    callables,
    checkpoint: vi.fn(),
    confirm: vi.fn(async (_estimate: PracticeEstimate) => true),
    save: vi.fn(async () => undefined),
    verify: vi.fn(async () => undefined),
  };
  const checkpoint = () =>
    createCompleteLessonCheckpoint({
      identity,
      body: STUDY_BODY,
      nowMs: 1000,
      options: {
        practiceEnabled: true,
        practiceCount: n as 3 | 6 | 9,
        modelProfile: 'economy',
        reviewStatus: 'improved',
        level: 'balanced',
        counts: { aperta: 1, chiusa_singola: 0, chiusa_multipla: 0 },
      },
      bodyPersisted: true,
      mapCompleted: true,
      poolCompleted: false,
      mapRequestId: 'map',
      poolRequestId: 'pool',
      mapCostMicroUsd: 0,
      poolCostMicroUsd: 0,
      visual: null,
      practice: parseCompletePracticeState(state, STUDY_BODY, n),
    });
  return { state, params, checkpoint };
}
describe('resumable complete practice', () => {
  beforeEach(() => vi.clearAllMocks());
  it.each([3, 6, 9])(
    'confirms generation and review costs for %i activities from the final body, saving only after review',
    async (n) => {
      const { state, params } = setup(n);
      const result = await runCompletePractice(state, params);
      expect(params.confirm.mock.calls.map((c) => c[0].phase)).toEqual(['generation', 'review']);
      expect(params.callables.generate.mock.calls[0]?.[0]).toMatchObject({
        lessonSource: STUDY_BODY,
        purpose: 'practice',
        counts: { aperta: n - 1, chiusa_singola: 1 },
      });
      expect(params.callables.generateReview.mock.calls[0]?.[0]).toMatchObject({
        candidateStudyPlan: state.base!.output.studyPlan,
      });
      expect(params.save).toHaveBeenCalledTimes(1);
      expect(params.verify).toHaveBeenCalledTimes(1);
      expect(result.cost).toBe(30);
      expect(result.context).toContain('Tracciare un ciclo');
    },
  );
  it('persists paid base on review failure; reopening retries only review with the same IDs and reports uncertain total', async () => {
    const { state, params, checkpoint } = setup();
    params.callables.generateReview.mockRejectedValueOnce(new Error('review failed'));
    await expect(runCompletePractice(state, params)).rejects.toThrow();
    expect(params.save).not.toHaveBeenCalled();
    const stored = JSON.stringify(checkpoint());
    expect(stored).not.toContain('TRANSIENT_REPORT');
    const restored = parseCompleteLessonCheckpoint(stored, identity, STUDY_BODY, 2000)!.practice!;
    const result = await runCompletePractice(restored, params);
    expect(params.callables.generate).toHaveBeenCalledTimes(1);
    expect(params.callables.generateReview).toHaveBeenCalledTimes(2);
    expect(params.callables.generateReview.mock.calls[0]?.[0]).toEqual(
      params.callables.generateReview.mock.calls[1]?.[0],
    );
    expect(result.cost).toBeNull();
  });
  it('save failure or lost save response preserves final reviewed result; resume performs no generation or review', async () => {
    const { state, params, checkpoint } = setup();
    params.save.mockRejectedValueOnce(new Error('lost save response'));
    await expect(runCompletePractice(state, params)).rejects.toThrow();
    const restored = parseCompleteLessonCheckpoint(
      JSON.stringify(checkpoint()),
      identity,
      STUDY_BODY,
      2000,
    )!.practice!;
    await runCompletePractice(restored, params);
    await runCompletePractice(restored, params);
    expect(params.callables.generate).toHaveBeenCalledTimes(1);
    expect(params.callables.generateReview).toHaveBeenCalledTimes(1);
    expect(params.save).toHaveBeenCalledTimes(2);
    expect(params.verify).toHaveBeenCalledTimes(2);
  });
  it('preview-only failure or declined confirmation causes no spend or unknown-cost flag', async () => {
    const { state, params } = setup();
    params.callables.preview.mockRejectedValueOnce(new Error('preview'));
    await expect(runCompletePractice(state, params)).rejects.toThrow();
    expect(state.costUnknown).toBe(false);
    expect(params.callables.generate).not.toHaveBeenCalled();
    params.confirm.mockResolvedValueOnce(false);
    await expect(runCompletePractice(state, params)).rejects.toThrow();
    expect(params.callables.generate).not.toHaveBeenCalled();
    params.review = false;
    expect((await runCompletePractice(state, params)).cost).toBe(10);
    expect(params.callables.generateReview).not.toHaveBeenCalled();
  });
  it('rejects changed source/checkpoint and stops all later calls after unmount during generation', async () => {
    const { state, params, checkpoint } = setup();
    let active = true;
    params.callables.generate.mockImplementationOnce(async () => {
      active = false;
      return fixture();
    });
    await expect(runCompletePractice(state, { ...params, active: () => active })).rejects.toThrow();
    expect(state.base).not.toBeNull();
    expect(params.callables.generateReview).not.toHaveBeenCalled();
    expect(params.save).not.toHaveBeenCalled();
    expect(
      parseCompleteLessonCheckpoint(
        JSON.stringify(checkpoint()),
        identity,
        STUDY_BODY + ' cambiato',
        2000,
      ),
    ).toBeNull();
    await expect(
      runCompletePractice(state, { ...params, body: STUDY_BODY + ' cambiato' }),
    ).rejects.toThrow();
    expect(params.callables.generateReview).not.toHaveBeenCalled();
  });
});
