import type { VerificationTeacherQuestionSnapshot } from '../../../types/firestore.js';

/**
 * Conservative, centralized ceiling on the serialized size of
 * `teacherSnapshot.questions` (PERF-SEC follow-up to the immutable teacher
 * snapshot fix). Firestore's hard limit is 1 MiB (1_048_576 bytes) per
 * *document*, and `teacherSnapshot` is only one field among several on the
 * `verifications/{id}` document (`config` — including the full
 * `questionRefs` array — plus `teacherSnapshot`'s own non-`questions`
 * fields). `JSON.stringify` byte length also understates Firestore's actual
 * wire encoding (repeated field-name/type overhead per map entry), so this
 * threshold is set well below the hard limit rather than close to it:
 * roughly two-thirds of 1 MiB, leaving a wide margin for everything else on
 * the same document and for encoding overhead this estimate doesn't
 * capture.
 */
export const TEACHER_SNAPSHOT_QUESTIONS_MAX_BYTES = 700_000;

/** Pure byte-size estimate of the serialized snapshot questions array. */
export function estimateTeacherSnapshotQuestionsBytes(
  questions: VerificationTeacherQuestionSnapshot[],
): number {
  return new TextEncoder().encode(JSON.stringify(questions)).length;
}

/**
 * Throws a readable error when `questions` would serialize beyond
 * `TEACHER_SNAPSHOT_QUESTIONS_MAX_BYTES`. Called before opening the
 * activation transaction — a size failure must never leave a verification
 * partially activated.
 */
export function assertTeacherSnapshotQuestionsWithinLimit(
  questions: VerificationTeacherQuestionSnapshot[],
): void {
  const bytes = estimateTeacherSnapshotQuestionsBytes(questions);
  if (bytes > TEACHER_SNAPSHOT_QUESTIONS_MAX_BYTES) {
    throw new Error(
      `Impossibile attivare: lo snapshot delle domande è troppo grande (${bytes} byte, ` +
        `limite ${TEACHER_SNAPSHOT_QUESTIONS_MAX_BYTES} byte). Riduci il numero o la ` +
        'lunghezza delle domande selezionate.',
    );
  }
}
