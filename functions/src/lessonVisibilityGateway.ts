import { getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore, type Firestore } from 'firebase-admin/firestore';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { SCHOOLFORGE_FUNCTION_REGION } from './deploymentRegion.js';
import { requireOwner, lessonPath } from './aiVisualIdentity.js';
import { AiVisualError } from './aiVisualCore.js';
import { checkLessonForVisual, checkProjectionForVisualDeletion } from './aiVisualLessonBinding.js';
import { isValidDocumentIdInput } from './firestoreDocumentId.js';

function database() {
  if (!getApps().length) initializeApp();
  return getFirestore();
}
export interface LessonVisibilityInput {
  programId: string;
  importId: string;
  lessonId: string;
  hiddenFromStudents: boolean;
}
export function validateLessonVisibilityInput(value: unknown): LessonVisibilityInput {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new HttpsError('invalid-argument', 'Richiesta non valida.');
  const input = value as Record<string, unknown>;
  if (
    Object.keys(input).sort().join(',') !== 'hiddenFromStudents,importId,lessonId,programId' ||
    typeof input.hiddenFromStudents !== 'boolean' ||
    ![input.programId, input.importId, input.lessonId].every(isValidDocumentIdInput)
  )
    throw new HttpsError('invalid-argument', 'Identità o visibilità non valida.');
  return input as unknown as LessonVisibilityInput;
}
/** Shared import lock keeps atomic forty-lesson publication below the Rules access limit. */
export function lessonVisibilityLockPath(programId: string, importId: string) {
  return `lessonVisibilityLocks/${programId}/imports/${importId}`;
}
export async function setLessonVisibilityForOwner(db: Firestore, ownerUid: string, raw: unknown) {
  const input = validateLessonVisibilityInput(raw);
  return db.runTransaction(async (tx) => {
    const privateRef = db.doc(lessonPath(input.programId, input.importId, input.lessonId));
    const privateSnap = await tx.get(privateRef);
    const lesson = privateSnap.exists ? privateSnap.data()! : null;
    const gate = checkLessonForVisual({
      lesson,
      lessonId: input.lessonId,
      ownerUid,
      importId: input.importId,
    });
    if (!gate.ok) throw new HttpsError('failed-precondition', 'Identità della lezione non valida.');
    const publicRef = db.doc(`publicLessons/${gate.publicLessonId}`);
    const hiddenRef = db.doc(`hiddenLessonProjections/${gate.publicLessonId}`);
    const lockRef = db.doc(lessonVisibilityLockPath(input.programId, input.importId));
    const [publicSnap, hiddenSnap, lockSnap, programSnap] = await Promise.all([
      tx.get(publicRef),
      tx.get(hiddenRef),
      tx.get(lockRef),
      tx.get(db.doc(`programs/${input.programId}`)),
    ]);
    if (!programSnap.exists || programSnap.data()?.ownerUid !== ownerUid)
      throw new HttpsError('permission-denied', 'Corso non autorizzato.');
    const wasHidden = lesson!.hiddenFromStudents === true;
    const sourceSnap = wasHidden ? hiddenSnap : publicSnap;
    if (
      (wasHidden && !sourceSnap.exists) ||
      (wasHidden ? publicSnap.exists : hiddenSnap.exists) ||
      (!sourceSnap.exists && !input.hiddenFromStudents)
    )
      throw new HttpsError('failed-precondition', 'Proiezione della lezione non coerente.');
    const source = sourceSnap.exists
      ? sourceSnap.data()!
      : {
          ownerUid,
          programId: input.programId,
          importId: input.importId,
          udaId: lesson!.udaDir,
          udaDir: lesson!.udaDir,
          path: lesson!.path,
          filename: lesson!.filename,
          contentPath: lesson!.storageRef,
          createdAt: FieldValue.serverTimestamp(),
          completed: lesson!.completed === true,
        };
    if (wasHidden && source.lessonId !== input.lessonId)
      throw new HttpsError('failed-precondition', 'Identità della proiezione privata non valida.');
    const identity = checkProjectionForVisualDeletion({
      lesson: lesson!,
      publicLesson: source,
      programId: input.programId,
      importId: input.importId,
      ownerUid,
    });
    if (!identity.ok)
      throw new HttpsError('failed-precondition', 'Proiezione della lezione non valida.');
    const oldIds = lockSnap.exists ? lockSnap.data()?.hiddenPublicLessonIds : [];
    if (
      !Array.isArray(oldIds) ||
      oldIds.some((id) => typeof id !== 'string' || !id.length || id.length > 1500) ||
      oldIds.length > 10_000 ||
      Buffer.byteLength(JSON.stringify(oldIds), 'utf8') > 700_000 ||
      (lockSnap.exists &&
        (lockSnap.data()?.ownerUid !== ownerUid ||
          lockSnap.data()?.programId !== input.programId ||
          lockSnap.data()?.importId !== input.importId))
    )
      throw new HttpsError('failed-precondition', 'Registro della visibilità non valido.');
    if (wasHidden === input.hiddenFromStudents)
      return {
        hiddenFromStudents: wasHidden,
        completed: lesson!.completed === true,
        publicLessonId: gate.publicLessonId,
      };
    const hiddenIds = new Set(oldIds as string[]);
    if (input.hiddenFromStudents) hiddenIds.add(gate.publicLessonId);
    else hiddenIds.delete(gate.publicLessonId);
    const ids = [...hiddenIds].sort();
    if (ids.length > 10_000 || Buffer.byteLength(JSON.stringify(ids), 'utf8') > 700_000)
      throw new HttpsError(
        'resource-exhausted',
        'Il registro della visibilità supera i limiti consentiti.',
      );
    const projection: Record<string, unknown> = { ...source, completed: false };
    delete projection.conceptMapMarkdown;
    delete projection.visual;
    delete projection.visuals;
    if (input.hiddenFromStudents) {
      projection.lessonId = input.lessonId;
      tx.set(hiddenRef, projection);
      tx.delete(publicRef);
    } else {
      delete projection.lessonId;
      tx.set(publicRef, projection);
      tx.delete(hiddenRef);
    }
    tx.update(privateRef, {
      hiddenFromStudents: input.hiddenFromStudents,
      completed: false,
      completedAt: null,
    });
    tx.set(lockRef, {
      ownerUid,
      programId: input.programId,
      importId: input.importId,
      hiddenPublicLessonIds: ids,
    });
    tx.delete(db.doc(`publicLessonPractice/${gate.publicLessonId}`));
    tx.delete(db.doc(`publicLessonVisuals/${gate.publicLessonId}`));
    tx.set(db.collection('auditEvents').doc(), {
      actorUid: ownerUid,
      action: 'lesson.visibilityChanged',
      targetId: input.lessonId,
      outcome: 'success',
      reason: input.hiddenFromStudents ? 'hidden' : 'visible',
      timestamp: FieldValue.serverTimestamp(),
    });
    return {
      hiddenFromStudents: input.hiddenFromStudents,
      completed: false,
      publicLessonId: gate.publicLessonId,
    };
  });
}
export const setLessonVisibility = onCall(
  { region: SCHOOLFORGE_FUNCTION_REGION },
  async (request) => {
    const db = database();
    try {
      const ownerUid = await requireOwner(request, db);
      return await setLessonVisibilityForOwner(db, ownerUid, request.data);
    } catch (error) {
      if (error instanceof HttpsError) throw error;
      if (error instanceof AiVisualError)
        throw new HttpsError(
          error.code === 'unauthenticated' ? 'unauthenticated' : 'permission-denied',
          error.message,
        );
      throw new HttpsError('internal', 'Impossibile cambiare la visibilità della lezione.');
    }
  },
);
