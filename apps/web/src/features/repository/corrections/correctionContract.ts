import type {
  CorrectionStatus,
  QuestionEvaluation,
  QuestionEvaluationDelta,
} from '../../../types/firestore.js';

/** D-M4-05: the only valid score range for a question is `[0, maxPoints]`. */
export const MIN_QUESTION_POINTS = 0;

/**
 * D-M4-05: a score is valid only when both `points` and `maxPoints` are
 * finite numbers, `maxPoints` is not negative, and `points` falls within
 * `[0, maxPoints]`. Partial/decimal credit (e.g. `1.5`) is allowed — this
 * codebase never mandates integer points, only the range. A malformed
 * `maxPoints` (negative, `NaN`, `Infinity`) is rejected the same as an
 * out-of-range `points` — it can never be satisfied by any valid score.
 */
export function isValidQuestionPoints(points: number, maxPoints: number): boolean {
  return (
    Number.isFinite(points) &&
    Number.isFinite(maxPoints) &&
    maxPoints >= MIN_QUESTION_POINTS &&
    points >= MIN_QUESTION_POINTS &&
    points <= maxPoints
  );
}

/**
 * Rejects an out-of-range score explicitly instead of silently clamping it
 * (task requirement: "preferire il rifiuto esplicito al clamp silenzioso").
 * Throws a readable `Error`, following the same convention as
 * `assertTeacherSnapshotQuestionsWithinLimit` elsewhere in this codebase.
 */
export function assertValidQuestionPoints(points: number, maxPoints: number): void {
  if (!isValidQuestionPoints(points, maxPoints)) {
    throw new Error(
      `Punteggio non valido: ${points}. Deve essere un numero compreso tra ` +
        `${MIN_QUESTION_POINTS} e ${maxPoints}.`,
    );
  }
}

/**
 * D-M4-06: a question is "evaluated" once it has a non-null `points`, even
 * when that value is `0` — `null` is the only sentinel for "not yet
 * touched by the teacher".
 */
export function isQuestionEvaluated(evaluation: QuestionEvaluation): boolean {
  return evaluation.points !== null;
}

/**
 * D-M4-06/D-M4-08: a correction may transition to `'completed'` only once
 * `evaluations` is non-empty and every question in it has been evaluated
 * (see `isQuestionEvaluated`). An empty `evaluations` map is **not**
 * complete — a correction with nothing to grade is not a legitimate state,
 * and must never be reachable as `'completed'`.
 */
export function isCorrectionComplete(evaluations: Record<string, QuestionEvaluation>): boolean {
  const values = Object.values(evaluations);
  return values.length > 0 && values.every(isQuestionEvaluated);
}

export type CorrectionTotals = {
  /** Sum of every evaluated question's `points`. Unevaluated questions contribute `0`. */
  totalPoints: number;
  /** Sum of every question's frozen `maxPoints`, evaluated or not. */
  maxPoints: number;
  /**
   * D-M4-07: `round(totalPoints / maxPoints * 100)` to the nearest whole
   * percentage point (standard round-half-up via `Math.round`) — no
   * decimals, matching the UX concept's plain "percentuale, se prevista".
   * `null` only when `maxPoints === 0` (a verification with no scoreable
   * questions), never `NaN`/`Infinity`.
   */
  percentage: number | null;
};

/**
 * Derives `totalPoints`/`maxPoints`/`percentage` from `evaluations` —
 * `CorrectionDoc` never has these fields written freehand (D-M4-07), only
 * ever computed by this function at every save.
 */
export function computeCorrectionTotals(
  evaluations: Record<string, QuestionEvaluation>,
): CorrectionTotals {
  let totalPoints = 0;
  let maxPoints = 0;
  for (const evaluation of Object.values(evaluations)) {
    if (evaluation.points !== null) totalPoints += evaluation.points;
    maxPoints += evaluation.maxPoints;
  }
  const percentage = maxPoints > 0 ? Math.round((totalPoints / maxPoints) * 100) : null;
  return { totalPoints, maxPoints, percentage };
}

/**
 * D-M4-03/D-M4-08/D-M4-10: the full set of allowed `CorrectionStatus`
 * transitions.
 *
 *   in_progress → completed   (only when `isCorrectionComplete`)
 *   completed   → returned    (explicit docente action, D-M4-09)
 *   completed   → in_progress (reopen, D-M4-10)
 *   returned    → in_progress (reopen, D-M4-10)
 *
 * Deliberately excluded:
 *   - `returned → completed` directly: a reopened correction must pass
 *     through `in_progress` again before it can be re-completed, so every
 *     rectification is visibly "in progress" before it is re-finalized.
 *   - `in_progress → returned` directly: a correction must be `completed`
 *     before it can be returned (D-M4-08 gates `completed` on
 *     `isCorrectionComplete`; skipping straight to `returned` would let an
 *     incomplete correction reach the student).
 *   - same-status no-op "transitions" are not modeled here at all.
 */
const ALLOWED_TRANSITIONS: Record<CorrectionStatus, readonly CorrectionStatus[]> = {
  in_progress: ['completed'],
  completed: ['returned', 'in_progress'],
  returned: ['in_progress'],
};

export function isValidCorrectionStatusTransition(
  from: CorrectionStatus,
  to: CorrectionStatus,
): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/** Rejects an invalid status transition explicitly — see `assertValidQuestionPoints` for the same convention. */
export function assertValidCorrectionStatusTransition(
  from: CorrectionStatus,
  to: CorrectionStatus,
): void {
  if (!isValidCorrectionStatusTransition(from, to)) {
    throw new Error(`Transizione di stato correzione non valida: '${from}' → '${to}'.`);
  }
}

/** D-M4-03: the status a newly created `CorrectionDoc` always starts at. */
export const INITIAL_CORRECTION_STATUS: CorrectionStatus = 'in_progress';

export type CorrectionUiStatus = 'to_correct' | CorrectionStatus;

/**
 * D-M4-03: the UI-facing status shown in the "Consegne online" table and
 * workspace header. When no `CorrectionDoc` exists yet for a submitted
 * submission, the UI derives `'to_correct'` itself — no placeholder
 * document is ever created just to represent "not started".
 */
export function deriveCorrectionUiStatus(
  correction: { status: CorrectionStatus } | null,
): CorrectionUiStatus {
  return correction ? correction.status : 'to_correct';
}

/** D-M4-10: the `reopenCount` every newly created `CorrectionDoc` starts at. */
export const INITIAL_CORRECTION_REOPEN_COUNT = 0;

/**
 * D-M4-10/D-M4-12: whether a correction has ever been reopened. This is
 * the exact condition M4-01's save operation must check to decide whether
 * an edit needs a `correctionEvents` entry at all — a first-pass edit
 * (`reopenCount === 0`) never does, however many times the docente saves;
 * only an edit made after at least one reopen does, and only when it
 * actually changes something (see `computeQuestionEvaluationDeltas`).
 */
export function isReopenedCorrection(correction: { reopenCount: number }): boolean {
  return correction.reopenCount > 0;
}

/**
 * D-M4-11: computes the minimal set of per-question deltas between two
 * `evaluations` snapshots — only questions whose `points` and/or
 * `feedback` actually changed, never the full map. Order-stable (iterates
 * `next` in key order) so a caller can persist `questionDeltas` directly
 * on a `CorrectionEventDoc` without further filtering.
 */
export function computeQuestionEvaluationDeltas(
  previous: Record<string, QuestionEvaluation>,
  next: Record<string, QuestionEvaluation>,
): QuestionEvaluationDelta[] {
  const deltas: QuestionEvaluationDelta[] = [];
  for (const key of Object.keys(next)) {
    const before = previous[key];
    const after = next[key];
    const pointsChanged = (before?.points ?? null) !== after.points;
    const feedbackChanged = (before?.feedback ?? undefined) !== after.feedback;
    if (!pointsChanged && !feedbackChanged) continue;
    deltas.push({
      order: after.order,
      previousPoints: before?.points ?? null,
      nextPoints: after.points,
      ...(before?.feedback !== undefined ? { previousFeedback: before.feedback } : {}),
      ...(after.feedback !== undefined ? { nextFeedback: after.feedback } : {}),
    });
  }
  return deltas;
}

/**
 * D-M4-11: whether `generalFeedback` changed between two correction
 * snapshots — the companion check to `computeQuestionEvaluationDeltas` for
 * `CorrectionEventDoc.generalFeedbackDelta`.
 */
export function computeGeneralFeedbackDelta(
  previous: string | null,
  next: string | null,
): { previous: string | null; next: string | null } | undefined {
  return previous === next ? undefined : { previous, next };
}
