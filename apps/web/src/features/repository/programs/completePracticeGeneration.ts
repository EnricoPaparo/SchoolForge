import { fingerprintCompleteLessonBody } from './completeLessonFingerprint.js';
import { validateStudyPlan } from '@schoolforge/lesson-contract';
import { validateStudyPractice, type StudyPractice, practicePoolContext } from './studyPractice.js';
import {
  newRequestId,
  type AiContentCallables,
  type AiPoolGenerateResult,
  type AiPoolReviewResult,
  type AiPoolReviewRequest,
  type AiPoolContentRequest,
} from '../pools/aiContentClient.js';
export interface CompletePracticeState {
  sourceFingerprint: string | null;
  requestId: string;
  reviewRequestId: string;
  plannedObjectives: string[];
  base: AiPoolGenerateResult | null;
  reviewed: AiPoolReviewResult | null;
  saved: boolean;
  costUnknown: boolean;
}
export interface PracticeEstimate {
  phase: 'generation' | 'review';
  estimatedCostMicroUsd: number;
  reservationCostMicroUsd: number;
}
export function createCompletePracticeState(objectives: string[]): CompletePracticeState {
  return {
    sourceFingerprint: null,
    requestId: newRequestId(),
    reviewRequestId: newRequestId(),
    plannedObjectives: [...objectives],
    base: null,
    reviewed: null,
    saved: false,
    costUnknown: false,
  };
}
function materialize(output: AiPoolGenerateResult['output'], body: string) {
  return validateStudyPractice(
    { version: 1, sourceBody: body, plan: output.studyPlan, questions: output.questions },
    body,
  );
}
export function completePracticeFromState(
  state: CompletePracticeState,
  body: string,
): StudyPractice | null {
  const output = state.reviewed?.output ?? state.base?.output;
  return output ? materialize(output, body) : null;
}
/** Canonical whitelist; no teacher prompts, raw responses, source body or transient feedback stored. */
export function parseCompletePracticeState(
  raw: unknown,
  body: string,
  count: number,
): CompletePracticeState {
  if (!raw || typeof raw !== 'object') throw new Error('Checkpoint esercitazioni non valido.');
  const s = raw as CompletePracticeState;
  if (s.sourceFingerprint !== null && s.sourceFingerprint !== fingerprintCompleteLessonBody(body))
    throw new Error('La fonte esercitazioni è cambiata.');
  if (
    typeof s.requestId !== 'string' ||
    typeof s.reviewRequestId !== 'string' ||
    !Array.isArray(s.plannedObjectives) ||
    s.plannedObjectives.length > 40 ||
    s.plannedObjectives.some((o) => typeof o !== 'string' || !o.trim() || o.length > 300) ||
    typeof s.saved !== 'boolean' ||
    typeof s.costUnknown !== 'boolean'
  )
    throw new Error('Checkpoint esercitazioni non valido.');
  function result<T extends AiPoolGenerateResult | AiPoolReviewResult>(
    value: T | null,
    kind: 'pool' | 'pool_review',
  ): T | null {
    if (value === null) return null;
    if (
      value.kind !== kind ||
      value.status !== 'completed' ||
      typeof value.modelProfile !== 'string'
    )
      throw new Error('Risultato esercitazioni non valido.');
    if (kind === 'pool_review') {
      const out = (value as AiPoolReviewResult).output;
      if (
        !['improved', 'unchanged'].includes(out.reviewOutcome) ||
        !Array.isArray(out.issueCodes) ||
        out.issueCodes.length > 20 ||
        out.issueCodes.some((c) => typeof c !== 'string' || c.length > 100)
      )
        throw new Error('Revisione non valida.');
    }
    const practice = materialize(value.output, body);
    validateStudyPlan(practice.plan, body, count, s.plannedObjectives);
    if (
      practice.questions.length !== count ||
      practice.questions.filter((q) => q.tipo === 'aperta').length !== count - 1 ||
      practice.questions.filter((q) => q.tipo === 'chiusa_singola').length !== 1
    )
      throw new Error('Quantità esercitazioni non valida.');
    if (
      value.actualCostMicroUsd !== null &&
      (!Number.isSafeInteger(value.actualCostMicroUsd) || value.actualCostMicroUsd < 0)
    )
      throw new Error('Costo esercitazioni non valido.');
    return {
      status: 'completed',
      kind: value.kind,
      modelProfile: value.modelProfile,
      actualCostMicroUsd: value.actualCostMicroUsd,
      replayed: !!value.replayed,
      output: {
        questions: practice.questions,
        studyPlan: practice.plan,
        ...(value.kind === 'pool_review'
          ? {
              reviewOutcome: (value as AiPoolReviewResult).output.reviewOutcome,
              issueCodes: (value as AiPoolReviewResult).output.issueCodes,
            }
          : {}),
      },
    } as T;
  }
  const base = result(s.base, 'pool'),
    reviewed = result(s.reviewed, 'pool_review');
  if ((reviewed && !base) || (s.saved && !base))
    throw new Error('Checkpoint esercitazioni incoerente.');
  return {
    sourceFingerprint: s.sourceFingerprint,
    requestId: s.requestId,
    reviewRequestId: s.reviewRequestId,
    plannedObjectives: [...s.plannedObjectives],
    base,
    reviewed,
    saved: s.saved,
    costUnknown: s.costUnknown,
  };
}
export async function runCompletePractice(
  state: CompletePracticeState,
  params: {
    body: string;
    count: number;
    modelProfile: 'economy' | 'quality';
    review: boolean;
    callables: AiContentCallables;
    checkpoint: () => void;
    confirm: (estimate: PracticeEstimate) => Promise<boolean>;
    save: (practice: StudyPractice) => Promise<void>;
    verify?: (practice: StudyPractice) => Promise<void>;
    active?: () => boolean;
  },
) {
  const { body, count, callables, checkpoint } = params;
  function active() {
    if (params.active && !params.active())
      throw new Error('La lezione è cambiata o la finestra è stata chiusa.');
  }
  active();
  const signature = fingerprintCompleteLessonBody(body);
  if (state.sourceFingerprint !== null && state.sourceFingerprint !== signature)
    throw new Error('La fonte esercitazioni è cambiata.');
  state.sourceFingerprint = signature;
  if (state.base) materialize(state.base.output, body);
  const request: AiPoolContentRequest = {
    kind: 'pool',
    purpose: 'practice',
    requestId: state.requestId,
    modelProfile: params.modelProfile,
    level: 'balanced',
    counts: { aperta: count - 1, chiusa_singola: 1, chiusa_multipla: 0 },
    lessonSource: body,
    plannedObjectives: state.plannedObjectives,
    existingPoolQuestionCount: 0,
  };
  if (!state.base) {
    const preview = await callables.preview(request);
    if (!(await params.confirm({ phase: 'generation', ...preview })))
      throw new Error('Conferma esercitazioni annullata.');
    active();
    try {
      const generated = await callables.generate(request);
      materialize(generated.output, body);
      state.base = generated;
      checkpoint();
    } catch (e) {
      state.costUnknown = true;
      checkpoint();
      throw e;
    }
  }
  active();
  if (params.review && !state.reviewed) {
    if (!callables.previewReview || !callables.generateReview)
      throw new Error('Revisore esercitazioni non disponibile.');
    const review: AiPoolReviewRequest = {
      ...request,
      kind: 'pool_review',
      requestId: state.reviewRequestId,
      candidateQuestions: state.base.output.questions,
      candidateStudyPlan: state.base.output.studyPlan,
    };
    const preview = await callables.previewReview(review);
    if (!(await params.confirm({ phase: 'review', ...preview })))
      throw new Error('Conferma revisione annullata.');
    active();
    try {
      const result = await callables.generateReview(review);
      materialize(result.output, body);
      state.reviewed = result;
      checkpoint();
    } catch (e) {
      state.costUnknown = true;
      checkpoint();
      throw e;
    }
  }
  active();
  const practice = completePracticeFromState(state, body)!;
  if (!state.saved) {
    await params.save(practice);
    state.saved = true;
    checkpoint();
  }
  active();
  await params.verify?.(practice);
  active();
  const costs = [
    state.base.actualCostMicroUsd,
    ...(state.reviewed ? [state.reviewed.actualCostMicroUsd] : []),
  ];
  return {
    practice,
    context: practicePoolContext(practice),
    cost:
      state.costUnknown || costs.includes(null)
        ? null
        : costs.reduce<number>((a, b) => a + (b ?? 0), 0),
  };
}
