import { doc, type Firestore } from 'firebase/firestore';
/** Derive this reference inside the transaction after reading the private lesson. */
export function lessonProjectionRef(
  db: Firestore,
  lesson: { hiddenFromStudents?: unknown } | null,
  publicLessonId: string,
) {
  return doc(
    db,
    lesson?.hiddenFromStudents === true ? 'hiddenLessonProjections' : 'publicLessons',
    publicLessonId,
  );
}
