import { parsePool } from '@schoolforge/lesson-contract';
import type { QuestionOption } from '@schoolforge/lesson-contract';
import type { VerificationQuestionRef } from '../../../types/firestore.js';
import { readTexts } from '../gateway/repositoryGatewayClient.js';

/** Safe question data for PDF — never includes soluzione, correctAnswer or answers. */
export type LoadedQuestion = {
  ref: VerificationQuestionRef;
  testo: string;
  tipo: 'aperta' | 'chiusa_singola' | 'chiusa_multipla';
  /** Present only for chiusa_singola / chiusa_multipla. Contains id + testo only — no solution marker. */
  opzioni?: QuestionOption[];
};

export type LoadQuestionsResult =
  | { ok: true; questions: LoadedQuestion[] }
  | { ok: false; error: string };

/**
 * Loads the question text and options for each selected ref.
 * Fetches pool files through the same-origin repository gateway, parses them, and returns
 * only the safe metadata — testo and opzioni — never soluzione.
 *
 * Returns refs in the same order as the input array.
 */
export async function loadSelectedQuestions(
  questionRefs: VerificationQuestionRef[],
  _legacyStorage?: unknown,
): Promise<LoadQuestionsResult> {
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

  const resultMap = new Map<string, LoadedQuestion>();

  let batchResults: Awaited<ReturnType<typeof readTexts>>;
  try {
    batchResults = await readTexts([...byPool.keys()]);
  } catch {
    return { ok: false, error: 'Impossibile caricare i pool delle domande.' };
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

      // Explicitly select only safe fields — soluzione is never included
      const loaded: LoadedQuestion = {
        ref: r,
        testo: q.testo,
        tipo: q.tipo,
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
    .filter((q): q is LoadedQuestion => q !== undefined);

  return { ok: true, questions };
}
