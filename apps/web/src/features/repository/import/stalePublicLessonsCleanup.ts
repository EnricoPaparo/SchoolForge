import { collection, doc, getDoc, getDocs, query, updateDoc, where } from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import { deleteDocRefsInBatches } from '../firestoreChunks.js';

export interface CleanupStalePublicLessonsParams {
  programId: string;
  /** The import whose stale `publicLessons` projections are to be removed. */
  oldImportId: string;
  db: Firestore;
}

/**
 * Deferred, best-effort cleanup of a superseded import's public projections
 * (HARD-02B-2 / HARD-F06).
 *
 * DOES:
 * 1. Delete, in chunks of at most `BATCH_CHUNK_SIZE`, **only** the
 *    `publicLessons` of `oldImportId` (`programId == X && importId == oldId`).
 * 2. Best-effort mark `programs/{programId}/imports/{oldImportId}.status =
 *    'superseded'` — **only if that import document still exists**.
 *
 * DOES NOT: touch UDAs, lessons, questionIndex, or any Storage file of the
 * old import. Retention and technical-data deletion stay in the explicit,
 * guarded deletion flows (deleteProgram/deleteUda/deleteLesson) — out of
 * scope for HARD-02B.
 *
 * Idempotent and retryable: deleting already-deleted projections is a no-op,
 * marking an already-`superseded` (or absent) import is a no-op. Safe on zero
 * matching documents. Because the stale projections are already invisible to
 * students (query + Security Rules both gate on `activeImportId`), a failure
 * here never produces a partial or inconsistent view — the caller reports it
 * via a non-blocking `cleanupPending` flag and can retry later.
 */
export async function cleanupStalePublicLessons(
  params: CleanupStalePublicLessonsParams,
): Promise<void> {
  const { programId, oldImportId, db } = params;

  const staleSnap = await getDocs(
    query(
      collection(db, 'publicLessons'),
      where('programId', '==', programId),
      where('importId', '==', oldImportId),
    ),
  );
  await deleteDocRefsInBatches(
    db,
    staleSnap.docs.map((d) => d.ref),
  );

  // Best-effort: mark the old import superseded ONLY if it still exists.
  const oldImportRef = doc(db, 'programs', programId, 'imports', oldImportId);
  const oldImportSnap = await getDoc(oldImportRef);
  if (oldImportSnap.exists()) {
    await updateDoc(oldImportRef, { status: 'superseded' });
  }
}

/**
 * Explicit, idempotent retry entry point for a cleanup that was deferred
 * (an earlier import returned `cleanupPending: true`). Same contract as
 * `cleanupStalePublicLessons`; provided as a named, discoverable function so
 * a caller (service or future UI) can re-drive cleanup without re-running an
 * import. There is deliberately NO polling, listener, scheduler, or Cloud
 * Function — retry is a manual, on-demand call.
 */
export async function retryStalePublicLessonsCleanup(
  params: CleanupStalePublicLessonsParams,
): Promise<void> {
  await cleanupStalePublicLessons(params);
}
