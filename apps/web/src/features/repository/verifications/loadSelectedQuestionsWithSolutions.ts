import { getBytes, ref } from 'firebase/storage';
import type { FirebaseStorage } from 'firebase/storage';
import { parsePool } from '@schoolforge/lesson-contract';
import type { QuestionOption } from '@schoolforge/lesson-contract';
import type { VerificationQuestionRef } from '../../../types/firestore.js';
import { mapWithConcurrency } from './mapWithConcurrency.js';

const POOL_READ_CONCURRENCY = 4;

/**
 * Question data for the teacher-only solutions PDF. Unlike `LoadedQuestion`
 * (student-facing), this includes `soluzione` — the textual answer for
 * `aperta`, or the correct option id(s) for `chiusa_singola`/`chiusa_multipla`.
 * Fetched fresh from the pool in Storage at download time; never persisted
 * to Firestore.
 */
export type LoadedQuestionWithSolution = {
  ref: VerificationQuestionRef;
  testo: string;
  tipo: 'aperta' | 'chiusa_singola' | 'chiusa_multipla';
  opzioni?: QuestionOption[];
  soluzione: string | string[];
};

export type LoadQuestionsWithSolutionsResult =
  | { ok: true; questions: LoadedQuestionWithSolution[] }
  | { ok: false; error: string };

/**
 * Loads question text, options and solution for each selected ref, for the
 * teacher-only "solutions PDF". Fetches pool files from Firebase Storage and
 * parses them at call time — solutions are never stored anywhere besides
 * the pool files themselves.
 *
 * Distinct pool files are read with the same bounded concurrency (at most
 * `POOL_READ_CONCURRENCY` Storage reads in flight) as `loadSelectedQuestions`
 * — see PERF-09 / PERF-SEC-01B-2 — instead of one `getBytes` at a time.
 * The number of Storage reads is unchanged (still one per distinct pool
 * file); only the wall-clock time to fetch them drops.
 *
 * Returns refs in the same order as the input array.
 */
export async function loadSelectedQuestionsWithSolutions(
  questionRefs: VerificationQuestionRef[],
  storage: FirebaseStorage,
): Promise<LoadQuestionsWithSolutionsResult> {
  if (questionRefs.length === 0) {
    return { ok: false, error: 'Nessuna domanda selezionata.' };
  }

  // Group refs by poolStorageRef to minimise Storage reads
  const byPool = new Map<string, VerificationQuestionRef[]>();
  for (const r of questionRefs) {
    const arr = byPool.get(r.poolStorageRef) ?? [];
    arr.push(r);
    byPool.set(r.poolStorageRef, arr);
  }

  const resultMap = new Map<string, LoadedQuestionWithSolution>();

  // Reads distinct pool files with bounded concurrency (PERF-09 /
  // PERF-SEC-01B-2) instead of one `getBytes` at a time — the pools are
  // still deduplicated by `poolStorageRef` above, so a ref repeated across
  // many questions is still fetched exactly once. Matches the same
  // POOL_READ_CONCURRENCY=4 pattern as `loadSelectedQuestions.ts`.
  const loadedPools = await mapWithConcurrency(
    Array.from(byPool.entries()),
    POOL_READ_CONCURRENCY,
    async ([poolRef, refs]) => {
      let content: string;
      try {
        const bytes = await getBytes(ref(storage, poolRef));
        content = new TextDecoder().decode(bytes);
      } catch {
        return { ok: false as const, error: `Pool non trovato: ${poolRef}` };
      }

      const parsed = parsePool(content, poolRef);
      if (!parsed.ok) {
        return { ok: false as const, error: `Pool non valido: ${poolRef}` };
      }

      return {
        ok: true as const,
        poolRef,
        refs,
        questionMap: new Map(parsed.pool.questions.map((q) => [q.id, q])),
      };
    },
  );

  for (const loaded of loadedPools) {
    if (!loaded.ok) return { ok: false, error: loaded.error };
    const { poolRef, refs, questionMap } = loaded;

    for (const r of refs) {
      const q = questionMap.get(r.questionLocalId);
      if (!q) {
        return { ok: false, error: `Domanda non trovata: ${r.questionLocalId} in ${poolRef}` };
      }

      const loadedQuestion: LoadedQuestionWithSolution = {
        ref: r,
        testo: q.testo,
        tipo: q.tipo,
        soluzione: q.soluzione,
        ...(q.tipo !== 'aperta' && {
          opzioni: q.opzioni.map((o) => ({ id: o.id, testo: o.testo })),
        }),
      };
      resultMap.set(r.questionIndexEntryId, loadedQuestion);
    }
  }

  // Restore original ordering from questionRefs
  const questions = questionRefs
    .map((r) => resultMap.get(r.questionIndexEntryId))
    .filter((q): q is LoadedQuestionWithSolution => q !== undefined);

  return { ok: true, questions };
}
