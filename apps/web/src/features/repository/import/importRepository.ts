import {
  collection,
  doc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  where,
  writeBatch,
} from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import { ref, uploadBytes } from 'firebase/storage';
import type { FirebaseStorage } from 'firebase/storage';
import { validateImport } from '../validation/index.js';
import { buildImportPayload } from './buildImportPayload.js';
import type { ImportRepositoryInput, ImportRepositoryResult } from './types.js';

/**
 * Full import pipeline:
 * 1. Validate (validateImport from M1-A)
 * 2. On structural failure → return validation_failed, no writes
 * 3. Upload files to Storage under repository/{ownerUid}/imports/{importId}/...
 * 4. Write Firestore sub-docs (batch): udas, lessons, questionIndex, import metadata
 * 5. Transaction: update programs/{programId}.activeImportId + audit event
 *
 * A failure before step 5 leaves the previous activeImportId untouched.
 * Orphaned Storage/Firestore objects are removable by the teacher via cleanup (future M1-D).
 */
export async function importRepository(
  input: ImportRepositoryInput,
  deps: { db: Firestore; storage: FirebaseStorage },
): Promise<ImportRepositoryResult> {
  const { ownerUid, programmaTitle, programId: existingProgramId, files } = input;
  const { db, storage: st } = deps;

  // ── Step 1: Validate ────────────────────────────────────────────────────────
  const validation = validateImport(programmaTitle, files);
  if (!validation.valid) {
    return { status: 'validation_failed', validationIssues: validation.issues };
  }

  // ── Step 2: Generate stable IDs ─────────────────────────────────────────────
  const importId = crypto.randomUUID();
  const programId = existingProgramId ?? crypto.randomUUID();

  // ── Step 3: Build pure payload ───────────────────────────────────────────────
  const payload = buildImportPayload({
    validation,
    programmaTitle,
    ownerUid,
    programId,
    importId,
    files,
  });

  // ── Step 4: Upload files to Storage ─────────────────────────────────────────
  // Every object is tagged with customMetadata.kind so the Storage Rules can
  // whitelist student (M3-lite) reads without inspecting the file name —
  // string methods like .matches()/.size() aren't reliably available across
  // Storage Rules runtimes. Only 'lesson' is ever readable by a student;
  // '.pool.md' files are always tagged 'pool' and stay owner-only.
  //
  // programId is also tagged (M3L-C) so the Storage Rules can look up the
  // live program document and gate the read on classIds — classIds itself
  // is deliberately NOT copied into the metadata, since it can change after
  // upload whenever the teacher (re)assigns classes to the program; only
  // the (effectively immutable) programId is safe to freeze at upload time.
  // ownerUid/importId are included too since they're already known here and
  // may be useful for future debugging/cleanup tooling, though the Storage
  // Rules gate only reads programId today. A file uploaded before this field
  // existed has no programId metadata and is denied by default until the
  // program is reimported (see storage.rules).
  const encoder = new TextEncoder();
  await Promise.all(
    files.map((file) => {
      const storagePath = `repository/${ownerUid}/imports/${importId}/${file.path}`;
      const kind = file.path.endsWith('.pool.md') ? 'pool' : 'lesson';
      return uploadBytes(ref(st, storagePath), encoder.encode(file.content), {
        customMetadata: { kind, programId, ownerUid, importId },
      });
    }),
  );

  // ── Step 5: Batch-write Firestore sub-documents ──────────────────────────────
  const batch = writeBatch(db);
  const importBasePath = `programs/${programId}/imports/${importId}`;

  batch.set(doc(db, importBasePath), {
    ...payload.importMeta,
    importedAt: serverTimestamp(),
  });

  for (const uda of payload.udas) {
    batch.set(doc(db, `${importBasePath}/udas`, uda.id), uda.data);
  }

  for (const lesson of payload.lessons) {
    batch.set(doc(db, `${importBasePath}/lessons`, lesson.id), lesson.data);
  }

  for (const entry of payload.questionIndex) {
    batch.set(doc(db, `${importBasePath}/questionIndex`, entry.id), entry.data);
  }

  await batch.commit();

  // ── Step 6: Atomic commit — update activeImportId, publicLessons + audit ────
  // publicLessons are committed in the SAME transaction as activeImportId
  // (not in the step-5 batch) so a student never observes a partial or
  // superseded import: either the whole switch happens, or none of it does.
  const programRef = doc(db, 'programs', programId);

  const stalePublicLessonsSnap = await getDocs(
    query(collection(db, 'publicLessons'), where('programId', '==', programId)),
  );
  const stalePublicLessonRefs = stalePublicLessonsSnap.docs.map((d) => d.ref);

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(programRef);
    if (!snap.exists()) {
      tx.set(programRef, {
        ownerUid,
        title: programmaTitle,
        activeImportId: importId,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      tx.update(programRef, {
        activeImportId: importId,
        updatedAt: serverTimestamp(),
      });
    }

    for (const staleRef of stalePublicLessonRefs) {
      tx.delete(staleRef);
    }
    for (const publicLesson of payload.publicLessons) {
      tx.set(doc(db, 'publicLessons', publicLesson.id), {
        ...publicLesson.data,
        createdAt: serverTimestamp(),
      });
    }

    const auditRef = doc(collection(db, 'auditEvents'));
    tx.set(auditRef, {
      actorUid: ownerUid,
      action: 'import.committed',
      targetId: importId,
      outcome: 'success',
      reason: null,
      timestamp: serverTimestamp(),
    });
  });

  return {
    status: 'committed',
    programId,
    importId,
    validationIssues: validation.issues,
    udaCount: payload.importMeta.udaCount,
    lessonCount: payload.importMeta.lessonCount,
    questionCount: payload.importMeta.questionCount,
  };
}
