import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import {
  HttpsError,
  onCall,
  type CallableRequest,
  type FunctionsErrorCode,
} from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import {
  ProgramNotesCleanupError,
  runProgramNotesCleanup,
  type DocRefPath,
  type ProgramNotesCleanupErrorCode,
  type ProgramNotesCleanupResult,
  type RawLessonNoteIndex,
} from './programNotesCleanupCore.js';

/**
 * ANNOT-CLEANUP-01 — owner-only Cloud Function v2 `onCall` that deletes a
 * program's student lesson notes and per-course indexes when the teacher
 * deletes the course. Runs with the Admin SDK (bypasses Security Rules), so the
 * teacher never gains Rules access to student notes and never reads their
 * content. Same region as the rest of the project. Scale-to-zero.
 */
export const PROGRAM_NOTES_CLEANUP_REGION = 'us-central1';

if (getApps().length === 0) initializeApp();

async function getOwnerUid(db: Firestore): Promise<string | null> {
  const snap = await db.doc('settings/owner').get();
  return snap.exists ? ((snap.data()?.ownerUid as string | undefined) ?? null) : null;
}

/**
 * One collection-group read over `lessonNoteIndexes` filtered by `programId`.
 * The equality filter uses the explicit collection-group single-field index
 * declared in `firestore.indexes.json` for `lessonNoteIndexes.programId`.
 * The `content` of `lessonNotes` is never read here.
 */
async function queryIndexesByProgram(
  db: Firestore,
  programId: string,
): Promise<RawLessonNoteIndex[]> {
  const snap = await db
    .collectionGroup('lessonNoteIndexes')
    .where('programId', '==', programId)
    .get();
  return snap.docs.map((doc) => ({
    // students/{studentUid}/lessonNoteIndexes/{programId}
    pathStudentUid: doc.ref.parent.parent?.id ?? '',
    pathProgramId: doc.id,
    data: doc.data() as Record<string, unknown>,
  }));
}

function makeDeleteChunk(db: Firestore) {
  return async (refs: DocRefPath[]): Promise<void> => {
    if (refs.length === 0) return;
    const batch = db.batch();
    for (const ref of refs) {
      // Deleting an already-absent document is a no-op in a batch — idempotent.
      batch.delete(db.doc(ref.segments.join('/')));
    }
    await batch.commit();
  };
}

const ERROR_STATUS: Record<ProgramNotesCleanupErrorCode, FunctionsErrorCode> = {
  unauthenticated: 'unauthenticated',
  not_owner: 'permission-denied',
  invalid_input: 'invalid-argument',
  malformed_index: 'failed-precondition',
  internal: 'internal',
};

export const cleanupProgramLessonNotes = onCall(
  { region: PROGRAM_NOTES_CLEANUP_REGION, minInstances: 0, maxInstances: 3 },
  async (request: CallableRequest): Promise<ProgramNotesCleanupResult> => {
    const db = getFirestore();
    const started = Date.now();
    try {
      const result = await runProgramNotesCleanup(request.data, {
        callerUid: request.auth?.uid ?? null,
        getOwnerUid: () => getOwnerUid(db),
        queryIndexesByProgram: (programId) => queryIndexesByProgram(db, programId),
        deleteChunk: makeDeleteChunk(db),
      });
      // Minimal, non-sensitive log: counts only, never a uid/path/content.
      logger.info('cleanupProgramLessonNotes', {
        outcome: 'ok',
        notesDeleted: result.notesDeleted,
        indexesDeleted: result.indexesDeleted,
        durationMs: Date.now() - started,
      });
      return result;
    } catch (err) {
      if (err instanceof ProgramNotesCleanupError) {
        logger.info('cleanupProgramLessonNotes', {
          outcome: err.code,
          durationMs: Date.now() - started,
        });
        throw new HttpsError(ERROR_STATUS[err.code], err.message, { code: err.code });
      }
      logger.error('cleanupProgramLessonNotes', {
        outcome: 'internal',
        durationMs: Date.now() - started,
      });
      throw new HttpsError('internal', 'Errore interno durante la pulizia degli appunti.');
    }
  },
);
