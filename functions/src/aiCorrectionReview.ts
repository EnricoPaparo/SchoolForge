import { createHash } from 'node:crypto';
import {
  AiGraderFailure,
  AiGraderInvalidOutputError,
  CORRECTION_ERROR_CODES,
  MAX_GENERAL_FEEDBACK_CHARS,
  MAX_QUESTION_FEEDBACK_CHARS,
  type AiGraderInput,
  type AiGraderOutput,
  type AiGraderAttemptStats,
  type AiGraderUsage,
  type AiGrader,
  type AiGradeContext,
} from './aiCorrectionGatewayCore.js';
import { OPENAI_GRADING_CONTRACT_VERSION } from './openAiGrader.js';
import { normalizeUsageActual } from './aiCorrectionCost.js';
export type CorrectionReview = { status: 'verified' | 'review_recommended'; reasons: string[] };
export interface ReviewCheckpoint {
  primary?: AiGraderOutput;
  secondary?: AiGraderOutput;
}
export interface ReviewCheckpointPorts {
  recordReview?: (key: string, reviews: Map<number, CorrectionReview>) => Promise<void>;
  load: (key: string) => Promise<ReviewCheckpoint>;
  claim: (key: string, stage: 'primary' | 'secondary') => Promise<boolean>;
  finish: (
    key: string,
    stage: 'primary' | 'secondary',
    output: AiGraderOutput | null,
    retryable: boolean,
    failure?: { usage?: AiGraderUsage; attempts?: AiGraderAttemptStats },
  ) => Promise<void>;
}
const emptyStats = (): AiGraderAttemptStats => ({
  attemptsTotal: 0,
  retriesTotal: 0,
  retryReasonCodes: [],
  retryDelayTotalMs: 0,
  unknownBillingAttempts: 0,
});
export function reviewInputHash(input: AiGraderInput, model: string | undefined): string {
  const data = {
    questions: input.questions,
    submissionContext: input.submissionContext,
    gradingMode: input.gradingMode,
    teacherGuidance: input.teacherGuidance,
  };
  return createHash('sha256')
    .update(
      JSON.stringify([data, model ?? 'mock', OPENAI_GRADING_CONTRACT_VERSION, 'blind-review-v1']),
    )
    .digest('hex');
}
function assertOutput(output: AiGraderOutput, input: AiGraderInput): void {
  if (
    output.requestId !== input.requestId ||
    output.results.length !== input.questions.length ||
    typeof output.generalFeedback !== 'string' ||
    !output.generalFeedback.trim() ||
    output.generalFeedback.length > MAX_GENERAL_FEEDBACK_CHARS
  ) {
    throw new AiGraderInvalidOutputError(
      'Incomplete grading output.',
      output.usage,
      output.attempts,
    );
  }
  const seen = new Set<number>();
  for (const result of output.results) {
    const question = input.questions.find((q) => q.order === result.order);
    const evidence = result.evidence;
    if (
      !question ||
      seen.has(result.order) ||
      !Number.isFinite(result.points) ||
      result.points < 0 ||
      result.points > question.maxPoints ||
      !Number.isInteger(result.points * 4) ||
      typeof result.feedback !== 'string' ||
      !result.feedback.trim() ||
      result.feedback.length > MAX_QUESTION_FEEDBACK_CHARS ||
      !evidence ||
      !Array.isArray(evidence.errorCodes) ||
      evidence.errorCodes.some((code) => !CORRECTION_ERROR_CODES.includes(code)) ||
      typeof evidence.ambiguity !== 'boolean' ||
      typeof evidence.reviewRecommended !== 'boolean' ||
      typeof evidence.alternativeValid !== 'boolean'
    ) {
      throw new AiGraderInvalidOutputError(
        'Invalid grading evidence.',
        output.usage,
        output.attempts,
      );
    }
    seen.add(result.order);
  }
}
export function reconcileIndependentGrades(
  primary: AiGraderOutput,
  secondary: AiGraderOutput,
): Map<number, CorrectionReview> {
  const reviews = new Map<number, CorrectionReview>();
  for (const result of primary.results) {
    const other = secondary.results.find((r) => r.order === result.order)!;
    const a = result.evidence!;
    const b = other.evidence!;
    const reasons: string[] = [];
    if (result.points !== other.points) reasons.push('score_disagreement');
    if (
      JSON.stringify([...new Set(a.errorCodes)].sort()) !==
      JSON.stringify([...new Set(b.errorCodes)].sort())
    )
      reasons.push('evidence_disagreement');
    if (a.alternativeValid !== b.alternativeValid) reasons.push('alternative_disagreement');
    if (a.ambiguity || b.ambiguity) reasons.push('ambiguous_reference');
    if (a.reviewRecommended || b.reviewRecommended) reasons.push('evaluator_uncertain');
    reviews.set(result.order, {
      status: reasons.length ? 'review_recommended' : 'verified',
      reasons,
    });
  }
  return reviews;
}
/** Independent calls share only immutable evidence, never the first score or feedback. */
export async function gradeWithIndependentReview(
  grader: AiGrader,
  input: AiGraderInput,
  ctx: AiGradeContext,
  checkpoint?: ReviewCheckpointPorts,
  advancedReview = true,
): Promise<AiGraderOutput & { reviews: Map<number, CorrectionReview> }> {
  const key = reviewInputHash(input, grader.model);
  const saved = checkpoint ? await checkpoint.load(key) : {};
  const stats = emptyStats();
  let inputTokens = 0;
  let outputTokens = 0;
  let cachedInputTokens = 0;
  let cacheWriteInputTokens = 0;
  let cachedDetailsKnown = true;
  let cacheWriteDetailsKnown = true;
  const add = (usage?: AiGraderUsage, attempts?: AiGraderAttemptStats, billed = false) => {
    const u = normalizeUsageActual(usage);
    if (u) {
      inputTokens += u.inputTokens;
      outputTokens += u.outputTokens;
      cachedDetailsKnown &&= u.cachedInputTokens !== undefined;
      cacheWriteDetailsKnown &&= u.cacheWriteInputTokens !== undefined;
      cachedInputTokens += u.cachedInputTokens ?? 0;
      cacheWriteInputTokens += u.cacheWriteInputTokens ?? 0;
    }
    const a = attempts ?? { ...emptyStats(), attemptsTotal: 1 };
    stats.attemptsTotal += a.attemptsTotal;
    stats.retriesTotal += a.retriesTotal;
    stats.retryReasonCodes.push(...a.retryReasonCodes);
    stats.retryDelayTotalMs += a.retryDelayTotalMs;
    stats.unknownBillingAttempts += a.unknownBillingAttempts;
    if (billed && grader.id !== 'mock' && !u) stats.unknownBillingAttempts++;
  };
  const usage = (): AiGraderUsage => ({
    tokens: inputTokens + outputTokens,
    inputTokens,
    outputTokens,
    ...(cachedDetailsKnown ? { cachedInputTokens } : {}),
    ...(cacheWriteDetailsKnown ? { cacheWriteInputTokens } : {}),
  });
  const stage = async (name: 'primary' | 'secondary'): Promise<AiGraderOutput> => {
    const stored = saved[name];
    if (stored) {
      const replay = { ...stored, requestId: input.requestId };
      assertOutput(replay, input);
      return replay;
    }
    if (checkpoint && !(await checkpoint.claim(key, name)))
      throw new AiGraderFailure('Stage already invoked; manual recovery required.', {
        attempts: stats,
        usage: usage(),
        reasonCode: 'provider_unavailable',
      });
    let output: AiGraderOutput;
    try {
      output = await grader.grade(input, ctx);
      assertOutput(output, input);
    } catch (error) {
      if (error instanceof AiGraderFailure || error instanceof AiGraderInvalidOutputError) {
        add(error.usage, error.attempts, error instanceof AiGraderInvalidOutputError);
        try {
          await checkpoint?.finish(
            key,
            name,
            null,
            error instanceof AiGraderFailure &&
              error.attempts.unknownBillingAttempts === 0 &&
              !error.usage,
            {
              ...(error.usage ? { usage: error.usage } : {}),
              ...(error.attempts ? { attempts: error.attempts } : {}),
            },
          );
        } catch {
          /* Keep the invocation fence and carry paid usage even if the lease was lost. */
        }
        throw new AiGraderFailure('Independent evaluation failed.', {
          attempts: stats,
          usage: usage(),
          reasonCode: error.reasonCode,
        });
      }
      // Unknown transport outcome: retain the invocation fence, never repeat it implicitly.
      throw new AiGraderFailure('Independent evaluation interrupted.', {
        attempts: {
          ...stats,
          attemptsTotal: stats.attemptsTotal + 1,
          unknownBillingAttempts: stats.unknownBillingAttempts + 1,
        },
        usage: usage(),
        reasonCode: 'provider_unavailable',
      });
    }
    add(output.usage, output.attempts, true);
    try {
      await checkpoint?.finish(key, name, output, false);
    } catch {
      throw new AiGraderFailure('Checkpoint unavailable.', {
        attempts: stats,
        usage: usage(),
        reasonCode: 'provider_unavailable',
      });
    }
    return output;
  };
  const primary = await stage('primary');
  if (!advancedReview) return { ...primary, usage: usage(), attempts: stats, reviews: new Map() };
  const secondary = await stage('secondary');
  const reviews = reconcileIndependentGrades(primary, secondary);
  try {
    await checkpoint?.recordReview?.(key, reviews);
  } catch {
    throw new AiGraderFailure('Review checkpoint unavailable.', {
      attempts: stats,
      usage: usage(),
      reasonCode: 'provider_unavailable',
    });
  }
  return { ...primary, usage: usage(), attempts: stats, reviews };
}
