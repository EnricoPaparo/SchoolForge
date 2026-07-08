import { getBytes, ref } from 'firebase/storage';
import type { FirebaseStorage } from 'firebase/storage';
import { parsePool } from '@schoolforge/lesson-contract';
import type { QuestionOption } from '@schoolforge/lesson-contract';
import type { VerificationQuestionRef } from '../../../types/firestore.js';

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

  for (const [poolRef, refs] of byPool) {
    let content: string;
    try {
      const bytes = await getBytes(ref(storage, poolRef));
      content = new TextDecoder().decode(bytes);
    } catch {
      return { ok: false, error: `Pool non trovato: ${poolRef}` };
    }

    const parsed = parsePool(content, poolRef);
    if (!parsed.ok) {
      return { ok: false, error: `Pool non valido: ${poolRef}` };
    }

    const questionMap = new Map(parsed.pool.questions.map((q) => [q.id, q]));

    for (const r of refs) {
      const q = questionMap.get(r.questionLocalId);
      if (!q) {
        return { ok: false, error: `Domanda non trovata: ${r.questionLocalId} in ${poolRef}` };
      }

      const loaded: LoadedQuestionWithSolution = {
        ref: r,
        testo: q.testo,
        tipo: q.tipo,
        soluzione: q.soluzione,
        ...(q.tipo !== 'aperta' && {
          opzioni: q.opzioni.map((o) => ({ id: o.id, testo: o.testo })),
        }),
      };
      resultMap.set(r.questionIndexEntryId, loaded);
    }
  }

  // Restore original ordering from questionRefs
  const questions = questionRefs
    .map((r) => resultMap.get(r.questionIndexEntryId))
    .filter((q): q is LoadedQuestionWithSolution => q !== undefined);

  return { ok: true, questions };
}
