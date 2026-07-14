import { parsePool } from '@schoolforge/lesson-contract';
import type { QuestionOption } from '@schoolforge/lesson-contract';
import type { VerificationQuestionRef } from '../../../types/firestore.js';
import { readTexts } from '../gateway/repositoryGatewayClient.js';

/**
 * Question data for the teacher-only solutions PDF. Unlike `LoadedQuestion`
 * (student-facing), this includes `soluzione` — the textual answer for
 * `aperta`, or the correct option id(s) for `chiusa_singola`/`chiusa_multipla`.
 * Fetched fresh from the pool through the same-origin repository gateway at
 * download time; never persisted to Firestore.
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
 * teacher-only "solutions PDF". Fetches all distinct pool files through the
 * batch-read gateway and parses them at call time — solutions are never stored
 * anywhere besides the pool files themselves.
 *
 * Returns refs in the same order as the input array.
 */
export async function loadSelectedQuestionsWithSolutions(
  questionRefs: VerificationQuestionRef[],
  _legacyStorage?: unknown,
): Promise<LoadQuestionsWithSolutionsResult> {
  if (questionRefs.length === 0) {
    return { ok: false, error: 'Nessuna domanda selezionata.' };
  }

  // Group refs by poolStorageRef to avoid duplicate file reads in the gateway batch.
  const byPool = new Map<string, VerificationQuestionRef[]>();
  for (const r of questionRefs) {
    const arr = byPool.get(r.poolStorageRef) ?? [];
    arr.push(r);
    byPool.set(r.poolStorageRef, arr);
  }

  const resultMap = new Map<string, LoadedQuestionWithSolution>();

  let batchResults: Awaited<ReturnType<typeof readTexts>>;
  try {
    batchResults = await readTexts([...byPool.keys()]);
  } catch {
    return { ok: false, error: 'Impossibile caricare i pool con le soluzioni.' };
  }
  const contentByPath = new Map(
    batchResults.filter((result) => result.ok).map((result) => [result.path, result.content]),
  );

  for (const [poolRef, refs] of byPool.entries()) {
    const content = contentByPath.get(poolRef);
    if (content === undefined) {
      return { ok: false, error: `Pool non trovato: ${poolRef}` };
    }
    const parsed = parsePool(content, poolRef);
    if (!parsed.ok) {
      return { ok: false as const, error: `Pool non valido: ${poolRef}` };
    }
    const questionMap = new Map(parsed.pool.questions.map((q) => [q.id, q]));

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
