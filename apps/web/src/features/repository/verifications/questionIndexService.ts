import { collection, getDocs } from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import type { QuestionIndexEntry as QuestionIndexDoc } from '../../../types/firestore.js';

/**
 * Metadata-only view of a question index entry.
 * NEVER includes questionText, answers, correctAnswer or solution.
 */
export type QuestionIndexEntry = {
  /** Firestore document id — stable key for VerificationQuestionRef */
  id: string;
  udaDir: string;
  lessonFilename: string;
  poolStorageRef: string;
  questionLocalId: string;
  tipo: 'aperta' | 'chiusa_singola' | 'chiusa_multipla';
  difficolta: 1 | 2 | 3;
  peso: 1 | 2 | 3;
  maxPoints: number;
  // NEVER expose: questionText, answers, correctAnswer, solution
};

export async function listQuestionIndex(
  programId: string,
  importId: string,
  db: Firestore,
): Promise<QuestionIndexEntry[]> {
  const snap = await getDocs(
    collection(db, 'programs', programId, 'imports', importId, 'questionIndex'),
  );
  return snap.docs.map((d) => {
    const data = d.data() as QuestionIndexDoc;
    // Explicitly select only metadata fields — never expose question content
    return {
      id: d.id,
      udaDir: data.udaDir,
      lessonFilename: data.lessonFilename,
      poolStorageRef: data.poolStorageRef,
      questionLocalId: data.questionLocalId,
      tipo: data.tipo,
      difficolta: data.difficolta,
      peso: data.peso,
      maxPoints: data.maxPoints,
    };
  });
}
