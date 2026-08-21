import { collection, doc, runTransaction, serverTimestamp } from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import { validateImport } from '../validation/index.js';
import type { BatchWriteFile } from '../gateway/repositoryGatewayClient.js';
import { commitOpsInChunks } from '../firestoreChunks.js';
import type { BatchOp } from '../firestoreChunks.js';
import { buildImportPayload } from './buildImportPayload.js';
import { cleanupStalePublicLessons } from './stalePublicLessonsCleanup.js';
import type { ImportRepositoryInput, ImportRepositoryResult } from './types.js';

const NOT_APPLIED_MESSAGE = 'Import non applicato: il corso precedente è rimasto intatto.';

/**
 * Resilient, chunked import pipeline (HARD-02B-2 / HARD-F06).
 *
 * Protocol (binding order):
 *  A. Generate a fresh `newImportId` (and `programId` for a new program).
 *  B. Validate the whole ZIP. On structural failure → `validation_failed`,
 *     no writes, `activeImportId` untouched.
 *  C. Upload files to Storage under repository/{ownerUid}/imports/{newImportId}.
 *  D. Chunk-write (≤400 mutations per writeBatch, sequential) the technical
 *     docs: import metadata (status `'staging'`), UDAs, lessons (each
 *     carrying its import-scoped `publicLessonId`), questionIndex.
 *  E. Chunk-write the new `publicLessons` (import-scoped id, importId ==
 *     newImportId). These are INVISIBLE to students because `activeImportId`
 *     still points at the previous import (query + Security Rules both gate
 *     on it).
 *  — During all of C/D/E, `activeImportId` is NEVER changed.
 *  F. SWITCH — a single small transaction containing ONLY: set
 *     `program.activeImportId = newImportId`, set the new import
 *     `status = 'active'`, write the audit event. Nothing else. From this
 *     instant the old import is immediately invisible; nothing is deleted.
 *  G. CLEANUP — deferred, best-effort, chunked deletion of ONLY the previous
 *     import's stale `publicLessons` (+ best-effort mark it `superseded`).
 *
 * Failure semantics:
 *  - Any failure in C/D/E/F (before or at the switch) → the switch did not
 *    take effect, `activeImportId` is unchanged, the previous course is intact
 *    and still visible, staged docs are invisible orphans → `not_applied`.
 *    No fake rollback. Retrying generates a fresh importId.
 *  - Switch succeeds → result is always `committed`.
 *  - Cleanup failure after a successful switch → result stays `committed` with
 *    `cleanupPending: true` (non-blocking); the stale projections are already
 *    invisible and cleanup is idempotently retryable.
 */
export async function importRepository(
  input: ImportRepositoryInput,
  deps: { db: Firestore; writeFiles?: (files: BatchWriteFile[]) => Promise<void> },
): Promise<ImportRepositoryResult> {
  const { ownerUid, programmaTitle, programId: existingProgramId, files } = input;
  const { db } = deps;
  // Import lazily: Rules tests inject a Storage-emulator writer and must not
  // initialize the production Firebase Auth singleton merely by importing this
  // otherwise-pure service module.
  const writeFiles =
    deps.writeFiles ??
    (async (batch: BatchWriteFile[]) => {
      const { writeTexts } = await import('../gateway/repositoryGatewayClient.js');
      await writeTexts(batch);
    });

  // ── Step B: Validate ────────────────────────────────────────────────────────
  const validation = validateImport(programmaTitle, files);
  if (!validation.valid) {
    return { status: 'validation_failed', validationIssues: validation.issues };
  }

  // ── Step A: Generate stable IDs (after validation, before any write) ─────────
  const importId = crypto.randomUUID();
  const programId = existingProgramId ?? crypto.randomUUID();

  // Build pure payload (import metadata already carries status 'staging').
  const payload = buildImportPayload({
    validation,
    programmaTitle,
    ownerUid,
    programId,
    importId,
    files,
  });

  const importBasePath = `programs/${programId}/imports/${importId}`;

  // Steps C/D/E are all "pre-switch": any failure must leave activeImportId
  // untouched and report `not_applied` (no fake rollback — staged docs stay as
  // invisible orphans carrying the not-yet-active importId).
  try {
    // ── Step C: Upload files to Storage ──────────────────────────────────────
    await writeFiles(
      files.map((file) => ({
        path: `repository/${ownerUid}/imports/${importId}/${file.path}`,
        content: file.content,
      })),
    );

    // ── Step D: Chunk-write technical docs (staging, invisible) ──────────────
    const technicalOps: BatchOp[] = [];
    technicalOps.push((batch) =>
      batch.set(doc(db, importBasePath), {
        ...payload.importMeta,
        importedAt: serverTimestamp(),
      }),
    );
    for (const uda of payload.udas) {
      technicalOps.push((batch) => batch.set(doc(db, `${importBasePath}/udas`, uda.id), uda.data));
    }
    for (const lesson of payload.lessons) {
      technicalOps.push((batch) =>
        batch.set(doc(db, `${importBasePath}/lessons`, lesson.id), lesson.data),
      );
    }
    for (const entry of payload.questionIndex) {
      technicalOps.push((batch) =>
        batch.set(doc(db, `${importBasePath}/questionIndex`, entry.id), entry.data),
      );
    }
    await commitOpsInChunks(db, technicalOps);

    // ── Step E: Chunk-write new publicLessons (import-scoped, invisible) ──────
    // Import-scoped ids (`${importId}_${lessonId}`) + importId == newImportId
    // mean these coexist with the previous import's projections without
    // collision and stay invisible until the switch flips activeImportId.
    const publicLessonOps: BatchOp[] = payload.publicLessons.map(
      (publicLesson) => (batch) =>
        batch.set(doc(db, 'publicLessons', publicLesson.id), {
          ...publicLesson.data,
          createdAt: serverTimestamp(),
        }),
    );
    await commitOpsInChunks(db, publicLessonOps);
  } catch {
    return { status: 'not_applied', message: NOT_APPLIED_MESSAGE };
  }

  // ── Step F: Atomic switch (ONLY activeImportId + import status + audit) ───────
  // The previous activeImportId is captured here to drive the deferred cleanup.
  // This transaction must NOT touch UDAs/lessons/questionIndex/publicLessons.
  const programRef = doc(db, 'programs', programId);
  let previousActiveImportId: string | null = null;
  try {
    previousActiveImportId = await runTransaction(db, async (tx) => {
      const snap = await tx.get(programRef);
      let prev: string | null = null;
      if (!snap.exists()) {
        tx.set(programRef, {
          ownerUid,
          title: programmaTitle,
          activeImportId: importId,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } else {
        prev = (snap.data().activeImportId as string | null) ?? null;
        tx.update(programRef, {
          activeImportId: importId,
          updatedAt: serverTimestamp(),
        });
      }

      tx.update(doc(db, importBasePath), { status: 'active' });

      const auditRef = doc(collection(db, 'auditEvents'));
      tx.set(auditRef, {
        actorUid: ownerUid,
        action: 'import.committed',
        targetId: importId,
        outcome: 'success',
        reason: null,
        timestamp: serverTimestamp(),
      });

      return prev;
    });
  } catch {
    // Switch did not take effect → import not applied, previous course intact.
    return { status: 'not_applied', message: NOT_APPLIED_MESSAGE };
  }

  // ── Step G: Deferred, best-effort cleanup of the OLD import's projections ────
  // Non-blocking: a failure leaves the import committed and correct (stale
  // projections are already invisible via the activeImportId gate) and is
  // reported as cleanupPending for an idempotent retry.
  let cleanupPending = false;
  if (previousActiveImportId && previousActiveImportId !== importId) {
    try {
      await cleanupStalePublicLessons({
        programId,
        oldImportId: previousActiveImportId,
        db,
      });
    } catch {
      cleanupPending = true;
    }
  }

  return {
    status: 'committed',
    programId,
    importId,
    validationIssues: validation.issues,
    udaCount: payload.importMeta.udaCount,
    lessonCount: payload.importMeta.lessonCount,
    questionCount: payload.importMeta.questionCount,
    annoScolastico: payload.importMeta.programmaMeta?.annoScolastico ?? null,
    cleanupPending,
  };
}
