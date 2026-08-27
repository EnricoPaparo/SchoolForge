/** MULTI-VISUAL-03C — lifecycle editoriale owner-only. */
import { getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import type { CallableRequest } from 'firebase-functions/v2/https';
import { AiVisualMultiError } from './aiVisualMultiCore.js';
import { lessonPath, requireOwner } from './aiVisualIdentity.js';
import {
  projectEditorialVisuals,
  removeVisualFromManifest,
  reorderVisualsManifest,
  validateReorderVisualsInput,
  validateVisualCleanupRecoveryRecord,
  type VisualCleanupRecoveryRecord,
} from './aiVisualMultiEditorial.js';
import {
  validateLessonVisualsManifest,
  type LessonVisualsManifest,
} from './aiVisualMultiManifest.js';
import { validatePublicLessonVisualBytesDoc } from './aiVisualMultiPublicBytes.js';
import { SCHOOLFORGE_FUNCTION_REGION } from './deploymentRegion.js';

const OPTIONS = { region: SCHOOLFORGE_FUNCTION_REGION, invoker: 'public' as const };
const CLEANUPS = 'aiVisualMultiCleanups';
const PUBLIC_BYTES = 'publicLessonVisuals';

function db(): Firestore {
  if (getApps().length === 0) initializeApp();
  return getFirestore();
}
function fail(code: AiVisualMultiError['code'], message: string): never {
  throw new AiVisualMultiError(code, message);
}
function inputRoot(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    fail('invalid_input', 'Payload non valido.');
  return value as Record<string, unknown>;
}
function segment(value: unknown, label: string): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value !== value.trim() ||
    value.includes('/') ||
    value === '.' ||
    value === '..'
  )
    fail('invalid_input', `${label} non valido.`);
  return value;
}
function basicInput(value: unknown): { programId: string; importId: string; lessonId: string } {
  const root = inputRoot(value);
  const keys = Object.keys(root).sort();
  if (keys.join(',') !== 'importId,lessonId,programId')
    fail('invalid_input', 'Payload non valido.');
  return {
    programId: segment(root.programId, 'programId'),
    importId: segment(root.importId, 'importId'),
    lessonId: segment(root.lessonId, 'lessonId'),
  };
}
function mapOrNone(value: unknown): LessonVisualsManifest | null {
  if (value === undefined) return null;
  return validateLessonVisualsManifest(value);
}
async function lifecycle(
  dbRef: Firestore,
  ownerUid: string,
  input: { programId: string; importId: string; lessonId: string },
) {
  const lessonRef = dbRef.doc(lessonPath(input.programId, input.importId, input.lessonId));
  const snap = await lessonRef.get();
  if (!snap.exists) fail('invalid_input', 'Lezione non trovata.');
  const lesson = snap.data() as Record<string, unknown>;
  if (lesson.ownerUid !== ownerUid || lesson.importId !== input.importId)
    fail('invalid_input', 'Lezione non appartenente al docente.');
  const publicLessonId =
    typeof lesson.publicLessonId === 'string' ? lesson.publicLessonId : input.lessonId;
  const publicRef = dbRef.doc(`publicLessons/${publicLessonId}`);
  const publicSnap = await publicRef.get();
  if (!publicSnap.exists) fail('invalid_input', 'Proiezione non trovata.');
  const publicLesson = publicSnap.data() as Record<string, unknown>;
  if (
    publicLesson.ownerUid !== ownerUid ||
    publicLesson.programId !== input.programId ||
    publicLesson.importId !== input.importId
  )
    fail('invalid_input', 'Proiezione incoerente.');
  return { lessonRef, publicRef, publicLessonId, lesson, publicLesson };
}

export async function reorderMultiVisualForOwner(params: {
  db: Firestore;
  ownerUid: string;
  input: unknown;
}) {
  const root = inputRoot(params.input);
  const base = basicInput({
    programId: root.programId,
    importId: root.importId,
    lessonId: root.lessonId,
  });
  const reorder = validateReorderVisualsInput({
    expectedAssetIds: root.expectedAssetIds,
    nextAssetIds: root.nextAssetIds,
  });
  const pair = await lifecycle(params.db, params.ownerUid, base);
  await params.db.runTransaction(async (tx) => {
    const lessonSnap = await tx.get(pair.lessonRef);
    const fresh = lessonSnap.data() as Record<string, unknown>;
    const current = mapOrNone(fresh.visuals);
    if (
      !current ||
      current.items.map((x) => x.assetId).join('|') !== reorder.expectedAssetIds.join('|')
    )
      fail('visual_plan_external_mutation', 'Il manifest è cambiato.');
    const next = reorderVisualsManifest(current, reorder.nextAssetIds);
    const publicNext = projectEditorialVisuals(next);
    tx.update(pair.lessonRef, { visuals: next, visual: FieldValue.delete() });
    tx.update(pair.publicRef, { visuals: publicNext, visual: FieldValue.delete() });
    tx.set(params.db.collection('auditEvents').doc(), {
      actorUid: params.ownerUid,
      action: 'lesson.visualsReordered',
      targetId: base.lessonId,
      outcome: 'success',
      reason: null,
      timestamp: FieldValue.serverTimestamp(),
    });
  });
  return { status: 'reordered' as const };
}

export async function removeMultiVisualForOwner(params: {
  db: Firestore;
  ownerUid: string;
  input: unknown;
}) {
  const root = inputRoot(params.input);
  const base = basicInput({
    programId: root.programId,
    importId: root.importId,
    lessonId: root.lessonId,
  });
  if (Object.keys(root).sort().join(',') !== 'assetId,importId,lessonId,programId')
    fail('invalid_input', 'Payload non valido.');
  const assetId = segment(root.assetId, 'assetId');
  const pair = await lifecycle(params.db, params.ownerUid, base);
  let recovery: Omit<VisualCleanupRecoveryRecord, 'createdAt'> | null = null;
  await params.db.runTransaction(async (tx) => {
    const freshSnap = await tx.get(pair.lessonRef);
    const fresh = freshSnap.data() as Record<string, unknown>;
    const current = mapOrNone(fresh.visuals);
    if (!current) fail('invalid_input', 'Manifest multi-visuale assente.');
    const item = current.items.find((x) => x.assetId === assetId);
    if (!item) fail('invalid_input', 'Asset non presente.');
    const next = removeVisualFromManifest(current, assetId);
    const publicNext = projectEditorialVisuals(next);
    const bytesRef = params.db.doc(`${PUBLIC_BYTES}/${pair.publicLessonId}`);
    const bytesSnap = await tx.get(bytesRef);
    if (bytesSnap.exists) {
      const bytesDoc = validatePublicLessonVisualBytesDoc(bytesSnap.data());
      const nextBytes = { ...bytesDoc.bytes };
      delete nextBytes[assetId];
      if (Object.keys(nextBytes).length === 0) tx.delete(bytesRef);
      else tx.update(bytesRef, { bytes: nextBytes });
    }
    recovery = {
      ownerUid: params.ownerUid,
      ...base,
      publicLessonId: pair.publicLessonId,
      udaDir: item.storageRef.split('/')[3],
      assetIds: [assetId],
      storageRefs: [item.storageRef],
    };
    if (next) {
      tx.update(pair.lessonRef, { visuals: next });
      tx.update(pair.publicRef, { visuals: publicNext });
    } else {
      tx.update(pair.lessonRef, { visuals: FieldValue.delete() });
      tx.update(pair.publicRef, { visuals: FieldValue.delete() });
    }
    tx.set(params.db.doc(`${CLEANUPS}/${base.lessonId}_${assetId}`), {
      ...recovery,
      createdAt: FieldValue.serverTimestamp(),
    });
    tx.set(params.db.collection('auditEvents').doc(), {
      actorUid: params.ownerUid,
      action: 'lesson.visualRemoved',
      targetId: base.lessonId,
      outcome: 'success',
      reason: null,
      timestamp: FieldValue.serverTimestamp(),
    });
  });
  const recoveryRef = params.db.doc(`${CLEANUPS}/${base.lessonId}_${assetId}`);
  const committed = validateVisualCleanupRecoveryRecord((await recoveryRef.get()).data());
  try {
    await getStorage().bucket().file(committed.storageRefs[0]).delete();
  } catch (error) {
    const code = (error as { code?: number }).code;
    if (code !== 404) throw error;
  }
  await recoveryRef.delete();
  return { status: 'removed' as const };
}

async function handle(request: CallableRequest<unknown>, action: 'reorder' | 'remove') {
  const firestore = db();
  try {
    const ownerUid = await requireOwner(request, firestore);
    return action === 'reorder'
      ? await reorderMultiVisualForOwner({ db: firestore, ownerUid, input: request.data })
      : await removeMultiVisualForOwner({ db: firestore, ownerUid, input: request.data });
  } catch (error) {
    if (error instanceof AiVisualMultiError)
      throw new HttpsError('failed-precondition', error.message, { code: error.code });
    throw new HttpsError('internal', 'Errore interno del lifecycle visuale.');
  }
}
export const aiVisualMultiReorder = onCall(OPTIONS, (request) => handle(request, 'reorder'));
export const aiVisualMultiRemove = onCall(OPTIONS, (request) => handle(request, 'remove'));
