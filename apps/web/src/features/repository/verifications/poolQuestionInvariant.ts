import type { PoolDifficulty } from '@schoolforge/lesson-contract';

/**
 * POOL-SIMPLE v2 runtime invariant, shared by the question index loader and the
 * verification activation preflight. Fail-closed: an incoherent question/ref is
 * rejected rather than silently cast, so difficoltà 4/5 traverse correctly and
 * an inconsistent document never reaches the picker, a snapshot or a write.
 *
 * Invariant: `tipo` is one of the three allowed values, `difficolta` is an
 * integer 1–5, and `maxPoints` is finite and exactly equal to `difficolta`
 * (there is no `peso`).
 */
export const QUESTION_TIPI = ['aperta', 'chiusa_singola', 'chiusa_multipla'] as const;
export type QuestionTipo = (typeof QUESTION_TIPI)[number];

export function isValidPoolDifficulty(value: unknown): value is PoolDifficulty {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 5;
}

export function isValidQuestionTipo(value: unknown): value is QuestionTipo {
  return typeof value === 'string' && (QUESTION_TIPI as readonly string[]).includes(value);
}

/**
 * Returns `null` when the question satisfies the V2 invariant, otherwise a
 * short human-readable reason. `maxPoints` must be finite and `=== difficolta`.
 */
export function poolQuestionInvariantError(q: {
  tipo?: unknown;
  difficolta?: unknown;
  maxPoints?: unknown;
}): string | null {
  if (!isValidQuestionTipo(q.tipo)) {
    return 'tipo domanda non valido';
  }
  if (!isValidPoolDifficulty(q.difficolta)) {
    return 'la difficoltà deve essere un intero compreso tra 1 e 5';
  }
  if (
    typeof q.maxPoints !== 'number' ||
    !Number.isFinite(q.maxPoints) ||
    q.maxPoints !== q.difficolta
  ) {
    return 'maxPoints deve essere finito e uguale alla difficoltà';
  }
  return null;
}
