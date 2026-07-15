/**
 * ID convention for `publicLessons` projections (HARD-02B-1).
 *
 * New projections are **import-scoped** (`${importId}_${lessonId}`) so that two
 * imports of the same lesson can coexist without colliding — the foundation the
 * future chunked import (HARD-02B-2) needs to prepare a new import invisibly
 * before an atomic `activeImportId` switch. Projections written before
 * HARD-02B-1 used the bare `lessonId`; they carry an `importId` field but no
 * `publicLessonId` on their `LessonDoc`, so they resolve to the legacy id.
 *
 * Pure module: no Firebase SDK, no reads. The legacy fallback is decided purely
 * by the presence of the field — never by trying one id, then another.
 */

/** Import-scoped id for a new projection. */
export function newPublicLessonId(importId: string, lessonId: string): string {
  return `${importId}_${lessonId}`;
}

/**
 * Resolves the `publicLessons` document id for a lesson: the stored
 * import-scoped id when present, otherwise the legacy `lessonId`. Never reads
 * Firestore and never tries two ids in turn.
 */
export function resolvePublicLessonId(
  lesson: { publicLessonId?: string | null },
  lessonId: string,
): string {
  return lesson.publicLessonId ?? lessonId;
}
