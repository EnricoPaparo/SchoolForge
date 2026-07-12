import { describe, expect, it } from 'vitest';
import type { QuestionEvaluation } from '../../../../types/firestore.js';
import {
  assertValidCorrectionStatusTransition,
  assertValidQuestionPoints,
  computeCorrectionTotals,
  deriveCorrectionUiStatus,
  isCorrectionComplete,
  isQuestionEvaluated,
  isValidCorrectionStatusTransition,
  isValidQuestionPoints,
  MIN_QUESTION_POINTS,
} from '../correctionContract.js';

function evaluation(overrides: Partial<QuestionEvaluation> = {}): QuestionEvaluation {
  return { order: 0, points: null, maxPoints: 10, ...overrides };
}

describe('isValidQuestionPoints / assertValidQuestionPoints', () => {
  it('accepts scores within [0, maxPoints], including decimals', () => {
    expect(isValidQuestionPoints(0, 10)).toBe(true);
    expect(isValidQuestionPoints(10, 10)).toBe(true);
    expect(isValidQuestionPoints(2.5, 10)).toBe(true);
    expect(MIN_QUESTION_POINTS).toBe(0);
  });

  it('rejects negative scores, scores above maxPoints, NaN and Infinity', () => {
    expect(isValidQuestionPoints(-1, 10)).toBe(false);
    expect(isValidQuestionPoints(11, 10)).toBe(false);
    expect(isValidQuestionPoints(Number.NaN, 10)).toBe(false);
    expect(isValidQuestionPoints(Number.POSITIVE_INFINITY, 10)).toBe(false);
  });

  it('assertValidQuestionPoints throws a readable error instead of clamping', () => {
    expect(() => assertValidQuestionPoints(11, 10)).toThrow(/Punteggio non valido/);
    expect(() => assertValidQuestionPoints(-0.01, 10)).toThrow(/Punteggio non valido/);
    expect(() => assertValidQuestionPoints(5, 10)).not.toThrow();
  });
});

describe('isQuestionEvaluated / isCorrectionComplete', () => {
  it('treats a 0 score as evaluated, and null as not evaluated', () => {
    expect(isQuestionEvaluated(evaluation({ points: 0 }))).toBe(true);
    expect(isQuestionEvaluated(evaluation({ points: null }))).toBe(false);
  });

  it('is complete only when every question has a non-null score', () => {
    expect(
      isCorrectionComplete({
        '0': evaluation({ order: 0, points: 5 }),
        '1': evaluation({ order: 1, points: 0 }),
      }),
    ).toBe(true);

    expect(
      isCorrectionComplete({
        '0': evaluation({ order: 0, points: 5 }),
        '1': evaluation({ order: 1, points: null }),
      }),
    ).toBe(false);
  });

  it('is vacuously complete for an empty evaluations map', () => {
    expect(isCorrectionComplete({})).toBe(true);
  });
});

describe('computeCorrectionTotals', () => {
  it('sums points/maxPoints and rounds the percentage to the nearest whole number', () => {
    const totals = computeCorrectionTotals({
      '0': evaluation({ order: 0, points: 7, maxPoints: 10 }),
      '1': evaluation({ order: 1, points: 2, maxPoints: 5 }),
    });
    expect(totals.totalPoints).toBe(9);
    expect(totals.maxPoints).toBe(15);
    // 9/15 = 60% exactly
    expect(totals.percentage).toBe(60);
  });

  it('treats unevaluated (null) questions as contributing 0 to totalPoints, but their maxPoints still counts', () => {
    const totals = computeCorrectionTotals({
      '0': evaluation({ order: 0, points: 3, maxPoints: 10 }),
      '1': evaluation({ order: 1, points: null, maxPoints: 10 }),
    });
    expect(totals.totalPoints).toBe(3);
    expect(totals.maxPoints).toBe(20);
    expect(totals.percentage).toBe(15);
  });

  it('rounds half up (round-half-away-from-zero via Math.round)', () => {
    // 1/3 = 33.333...% -> 33
    expect(
      computeCorrectionTotals({ '0': evaluation({ points: 1, maxPoints: 3 }) }).percentage,
    ).toBe(33);
    // 5/6 = 83.333...% -> 83
    expect(
      computeCorrectionTotals({ '0': evaluation({ points: 5, maxPoints: 6 }) }).percentage,
    ).toBe(83);
    // 2/3 = 66.666...% -> 67
    expect(
      computeCorrectionTotals({ '0': evaluation({ points: 2, maxPoints: 3 }) }).percentage,
    ).toBe(67);
  });

  it('returns null percentage when maxPoints is 0, never NaN/Infinity', () => {
    expect(computeCorrectionTotals({}).percentage).toBeNull();
    expect(computeCorrectionTotals({}).totalPoints).toBe(0);
    expect(computeCorrectionTotals({}).maxPoints).toBe(0);
  });
});

describe('correction status transitions', () => {
  it('allows the documented transitions', () => {
    expect(isValidCorrectionStatusTransition('in_progress', 'completed')).toBe(true);
    expect(isValidCorrectionStatusTransition('completed', 'returned')).toBe(true);
    expect(isValidCorrectionStatusTransition('completed', 'in_progress')).toBe(true);
    expect(isValidCorrectionStatusTransition('returned', 'in_progress')).toBe(true);
  });

  it('rejects skipping completed, same-status no-ops, and returned->completed directly', () => {
    expect(isValidCorrectionStatusTransition('in_progress', 'returned')).toBe(false);
    expect(isValidCorrectionStatusTransition('returned', 'completed')).toBe(false);
    expect(isValidCorrectionStatusTransition('in_progress', 'in_progress')).toBe(false);
    expect(isValidCorrectionStatusTransition('completed', 'completed')).toBe(false);
    expect(isValidCorrectionStatusTransition('returned', 'returned')).toBe(false);
  });

  it('assertValidCorrectionStatusTransition throws a readable error on an invalid transition', () => {
    expect(() => assertValidCorrectionStatusTransition('in_progress', 'returned')).toThrow(
      /Transizione di stato correzione non valida/,
    );
    expect(() => assertValidCorrectionStatusTransition('in_progress', 'completed')).not.toThrow();
  });
});

describe('deriveCorrectionUiStatus', () => {
  it('derives "to_correct" when no correction document exists, without creating one', () => {
    expect(deriveCorrectionUiStatus(null)).toBe('to_correct');
  });

  it('mirrors the correction document status otherwise', () => {
    expect(deriveCorrectionUiStatus({ status: 'in_progress' })).toBe('in_progress');
    expect(deriveCorrectionUiStatus({ status: 'completed' })).toBe('completed');
    expect(deriveCorrectionUiStatus({ status: 'returned' })).toBe('returned');
  });
});
