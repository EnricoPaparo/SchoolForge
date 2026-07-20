import { httpsCallable } from 'firebase/functions';
import type { Functions } from 'firebase/functions';

/**
 * ANNOT-CLEANUP-01 — typed client for the owner-only `cleanupProgramLessonNotes`
 * callable. It sends only the `programId`; the Function returns minimal counts
 * (no uid, path, lessonId, name, email or note content). Called by
 * `deleteProgram` before the program document is removed.
 */

export interface ProgramNotesCleanupResult {
  status: 'completed';
  notesDeleted: number;
  indexesDeleted: number;
}

/** Builds the callable on an injected `Functions` (testable). */
export function createProgramNotesCleanupCallable(
  functions: Functions,
): (programId: string) => Promise<ProgramNotesCleanupResult> {
  const fn = httpsCallable<{ programId: string }, ProgramNotesCleanupResult>(
    functions,
    'cleanupProgramLessonNotes',
  );
  return async (programId) => (await fn({ programId })).data;
}
