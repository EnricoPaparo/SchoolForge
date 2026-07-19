import { collection, getDocs } from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import type { QuestionIndexEntry as QuestionIndexDoc } from '../../../types/firestore.js';

/**
 * Metadata + safe preview view of a question index entry.
 * NEVER includes the full questionText, answers, correctAnswer or solution —
 * questionPreview is a short (max 100 char) normalized snippet only.
 */
export type QuestionIndexEntry = {
  /** Firestore document id — stable key for VerificationQuestionRef */
  id: string;
  udaDir: string;
  lessonFilename: string;
  poolStorageRef: string;
  questionLocalId: string;
  tipo: 'aperta' | 'chiusa_singola' | 'chiusa_multipla';
  difficolta: QuestionIndexDoc['difficolta'];
  peso: 1 | 2 | 3;
  maxPoints: number;
  questionPreview: string;
  // NEVER expose: full questionText, answers, correctAnswer, solution
};

export async function listQuestionIndex(
  programId: string,
  importId: string,
  db: Firestore,
): Promise<QuestionIndexEntry[]> {
  const snap = await getDocs(
    collection(db, 'programs', programId, 'imports', importId, 'questionIndex'),
  );
  const entries = snap.docs.map((d) => {
    const data = d.data() as QuestionIndexDoc;
    // Explicitly select only metadata + preview fields — never expose full question content
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
      // Absent on questionIndex entries created before the preview field existed.
      questionPreview: data.questionPreview ?? '',
    };
  });
  // Deterministic order: UDA, then lesson, then question — so the picker
  // doesn't reshuffle between loads (Firestore doesn't guarantee doc order).
  return entries.sort(
    (a, b) =>
      a.udaDir.localeCompare(b.udaDir) ||
      a.lessonFilename.localeCompare(b.lessonFilename) ||
      a.questionLocalId.localeCompare(b.questionLocalId),
  );
}
