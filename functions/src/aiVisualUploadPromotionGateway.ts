/** MULTI-VISUAL-UPLOAD-01A — adozione atomica di un upload normalizzato. */

import { randomUUID } from 'node:crypto';
import { getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import * as logger from 'firebase-functions/logger';
import {
  HttpsError,
  onCall,
  type CallableRequest,
  type FunctionsErrorCode,
} from 'firebase-functions/v2/https';
import { AiVisualError, inspectWebp, sha256Hex } from './aiVisualCore.js';
import { timestampToMillis } from './aiContentCore.js';
import {
  checkLessonForVisual,
  checkProjectionForVisual,
  describeVisualBindingFailure,
} from './aiVisualLessonBinding.js';
import {
  canonicalVisualStorageRef,
  validateLessonVisualPublicManifest,
  validatePublicLessonVisualDoc,
} from './aiVisualManifest.js';
import {
  AiVisualMultiError,
  LESSON_VISUALS_CONTRACT_VERSION,
  UPLOADED_VISUAL_STYLE_VERSION,
  VISUAL_UPLOAD_PROMOTION_CONTRACT_VERSION,
  VISUAL_UPLOAD_PROMOTION_RECOVERY_CONTRACT_VERSION,
} from './aiVisualMultiCore.js';
import { resolveVisualAnchorForWrite } from './aiVisualMultiAnchor.js';
import {
  projectLessonVisualsManifest,
  readLegacyLessonVisuals,
  validateLessonVisualsManifest,
  validatePublicLessonVisualsManifest,
  type LessonVisualItem,
  type LessonVisualsManifest,
} from './aiVisualMultiManifest.js';
import {
  composePublicBytesEntry,
  validatePublicLessonVisualBytesDoc,
  type PublicLessonVisualBytesDoc,
} from './aiVisualMultiPublicBytes.js';
import {
  computeOpaqueVisualUploadRunId,
  visualUploadStagingRef,
  type VisualUploadRun,
} from './aiVisualUploadCore.js';
import { parseStoredVisualUploadRun, serializeVisualUploadRun } from './aiVisualUploadRunDoc.js';
import {
  validateStoredVisualUploadPromotion,
  validateStoredVisualUploadPromotionRecovery,
  validateVisualUploadPromoteInput,
  type StoredVisualUploadPromotion,
  type StoredVisualUploadPromotionRecovery,
  type VisualUploadPromoteInput,
} from './aiVisualUploadPromotion.js';
import { lessonPath, requireOwner } from './aiVisualIdentity.js';
import { isStorageNotFound, type BucketLike } from './repositoryGatewayCore.js';
import { SCHOOLFORGE_FUNCTION_REGION } from './deploymentRegion.js';

const RUNS = 'visualUploadRuns';
const PROMOTIONS = 'visualUploadPromotions';
const RECOVERIES = 'visualUploadPromotionRecoveries';
const PUBLIC_BYTES = 'publicLessonVisuals';
const OPTIONS = { region: SCHOOLFORGE_FUNCTION_REGION, invoker: 'public' as const };

function database(): Firestore {
  if (getApps().length === 0) initializeApp();
  return getFirestore();
}

function isStoragePreconditionFailed(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 412;
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function parseRun(value: unknown): VisualUploadRun {
  const run = parseStoredVisualUploadRun(value);
  if (!run) throw new AiVisualMultiError('corrupted_state', 'Run di upload non leggibile.');
  return run;
}

function assertRunIdentity(
  run: VisualUploadRun,
  ownerUid: string,
  input: VisualUploadPromoteInput,
): void {
  if (run.ownerUid !== ownerUid || run.requestId !== input.requestId) {
    throw new AiVisualMultiError('corrupted_state', 'Identità del run di upload divergente.');
  }
}

function readManifest(lesson: Record<string, unknown>): LessonVisualsManifest | null {
  const read = readLegacyLessonVisuals({ visual: lesson.visual, visuals: lesson.visuals });
  if (read.status === 'none') return null;
  if (read.status !== 'ok')
    throw new AiVisualMultiError(read.status, 'Manifest visuale incoerente.');
  return read.manifest;
}

function readPublicBytes(
  raw: unknown,
  manifest: LessonVisualsManifest,
): PublicLessonVisualBytesDoc {
  try {
    return validatePublicLessonVisualBytesDoc(raw);
  } catch {
    const singular = validatePublicLessonVisualDoc(raw);
    if (manifest.items.length !== 1 || singular.assetId !== manifest.items[0]!.assetId) {
      throw new AiVisualMultiError('corrupted_state', 'Byte pubblici singolari incoerenti.');
    }
    return validatePublicLessonVisualBytesDoc({
      contractVersion: LESSON_VISUALS_CONTRACT_VERSION,
      publicLessonId: singular.publicLessonId,
      programId: singular.programId,
      importId: singular.importId,
      bytes: {
        [singular.assetId]: {
          dataUri: singular.dataUri,
          mimeType: 'image/webp',
          width: singular.width,
          height: singular.height,
        },
      },
    });
  }
}

function assertProjectionAligned(params: {
  publicLesson: Record<string, unknown>;
  publicBytes: unknown | null;
  manifest: LessonVisualsManifest | null;
  completed: boolean;
  publicLessonId: string;
  programId: string;
  importId: string;
}): PublicLessonVisualBytesDoc | null {
  const { publicLesson, manifest, completed } = params;
  if (!completed) {
    if (
      publicLesson.visual !== undefined ||
      publicLesson.visuals !== undefined ||
      params.publicBytes !== null
    )
      throw new AiVisualMultiError(
        'corrupted_state',
        'Visual pubblico presente su lezione non svolta.',
      );
    return null;
  }
  if (!manifest) {
    if (
      publicLesson.visual !== undefined ||
      publicLesson.visuals !== undefined ||
      params.publicBytes !== null
    )
      throw new AiVisualMultiError('corrupted_state', 'Proiezione visuale senza manifest privato.');
    return null;
  }
  const expected = projectLessonVisualsManifest(manifest);
  let actual: unknown;
  if (publicLesson.visuals !== undefined && publicLesson.visual === undefined)
    actual = validatePublicLessonVisualsManifest(publicLesson.visuals);
  else if (publicLesson.visual !== undefined && publicLesson.visuals === undefined) {
    if (expected.items.length !== 1)
      throw new AiVisualMultiError('corrupted_state', 'Proiezione singolare incoerente.');
    actual = {
      contractVersion: LESSON_VISUALS_CONTRACT_VERSION,
      items: [validateLessonVisualPublicManifest(publicLesson.visual)],
    };
  } else throw new AiVisualMultiError('corrupted_state', 'Manifest pubblico assente o ambiguo.');
  if (!same(actual, expected))
    throw new AiVisualMultiError('corrupted_state', 'Manifest pubblico divergente.');
  if (params.publicBytes === null)
    throw new AiVisualMultiError('corrupted_state', 'Byte pubblici assenti.');
  const bytes = readPublicBytes(params.publicBytes, manifest);
  if (
    bytes.publicLessonId !== params.publicLessonId ||
    bytes.programId !== params.programId ||
    bytes.importId !== params.importId
  )
    throw new AiVisualMultiError('corrupted_state', 'Identità dei byte pubblici divergente.');
  const ids = manifest.items.map((item) => item.assetId).sort();
  if (!same(Object.keys(bytes.bytes).sort(), ids))
    throw new AiVisualMultiError('corrupted_state', 'Asset pubblici divergenti.');
  for (const item of manifest.items) {
    const entry = bytes.bytes[item.assetId];
    if (!entry || entry.width !== item.width || entry.height !== item.height)
      throw new AiVisualMultiError('corrupted_state', 'Dimensioni pubbliche divergenti.');
    const data = Buffer.from(entry.dataUri.slice(entry.dataUri.indexOf(',') + 1), 'base64');
    if (data.byteLength !== item.byteLength || sha256Hex(data) !== item.sha256)
      throw new AiVisualMultiError('corrupted_state', 'Byte pubblici divergenti.');
  }
  return bytes;
}

async function deleteIfPresent(bucket: BucketLike, path: string): Promise<void> {
  try {
    await bucket.file(path).delete();
  } catch (error) {
    if (!isStorageNotFound(error)) throw error;
  }
}

async function verifyReplay(params: {
  db: Firestore;
  bucket: BucketLike;
  ownerUid: string;
  run: VisualUploadRun;
  promotion: StoredVisualUploadPromotion;
}): Promise<void> {
  const lessonSnap = await params.db
    .doc(lessonPath(params.run.programId, params.run.importId, params.run.lessonId))
    .get();
  if (!lessonSnap.exists)
    throw new AiVisualMultiError('corrupted_state', 'LessonDoc assente nel replay.');
  const lesson = lessonSnap.data() as Record<string, unknown>;
  const gate = checkLessonForVisual({
    lesson,
    lessonId: params.run.lessonId,
    ownerUid: params.ownerUid,
    importId: params.run.importId,
  });
  if (!gate.ok || gate.publicLessonId !== params.run.publicLessonId)
    throw new AiVisualMultiError('corrupted_state', 'LessonDoc divergente nel replay.');
  const [publicSnap, bytesSnap] = await Promise.all([
    params.db.doc(`publicLessons/${gate.publicLessonId}`).get(),
    params.db.doc(`${PUBLIC_BYTES}/${gate.publicLessonId}`).get(),
  ]);
  const projection = checkProjectionForVisual({
    lesson,
    publicLesson: publicSnap.exists ? (publicSnap.data() as Record<string, unknown>) : null,
    programId: params.run.programId,
    importId: params.run.importId,
    ownerUid: params.ownerUid,
  });
  if (!projection.ok || sha256Hex(projection.body) !== params.run.sourceBodyHash)
    throw new AiVisualMultiError('corrupted_state', 'Sorgente divergente nel replay.');
  const manifest = readManifest(lesson);
  const item = manifest?.items.find((candidate) => candidate.assetId === params.promotion.assetId);
  if (
    !manifest ||
    !item ||
    item.storageRef !== params.promotion.storageRef ||
    item.source !== 'uploaded' ||
    item.sourceBodyHash !== params.run.sourceBodyHash
  )
    throw new AiVisualMultiError('corrupted_state', 'Asset promosso non più live.');
  assertProjectionAligned({
    publicLesson: publicSnap.data() as Record<string, unknown>,
    publicBytes: bytesSnap.exists ? bytesSnap.data() : null,
    manifest,
    completed: projection.completed,
    publicLessonId: gate.publicLessonId,
    programId: params.run.programId,
    importId: params.run.importId,
  });
  const [canonical] = await params.bucket.file(item.storageRef).download();
  const inspected = inspectWebp(canonical);
  if (
    canonical.byteLength !== item.byteLength ||
    sha256Hex(canonical) !== item.sha256 ||
    inspected.width !== item.width ||
    inspected.height !== item.height
  )
    throw new AiVisualMultiError('corrupted_state', 'Byte canonici divergenti nel replay.');
}

export async function promoteVisualUploadForOwner(params: {
  db: Firestore;
  bucket: BucketLike;
  ownerUid: string;
  input: VisualUploadPromoteInput;
  nowMs: number;
  generateAssetId?: () => string;
  afterPromotionReads?: () => Promise<void>;
}): Promise<{ replayed: boolean; assetId: string }> {
  const { db, bucket, ownerUid, input, nowMs } = params;
  const opaqueUploadRunId = computeOpaqueVisualUploadRunId(ownerUid, input.requestId);
  const runRef = db.doc(`${RUNS}/${opaqueUploadRunId}`);
  const promotionRef = db.doc(`${PROMOTIONS}/${opaqueUploadRunId}`);
  const recoveryRef = db.doc(`${RECOVERIES}/${opaqueUploadRunId}`);
  const [runSnap, promotionSnap] = await Promise.all([runRef.get(), promotionRef.get()]);
  if (!runSnap.exists)
    throw new AiVisualMultiError('invalid_input', 'Il run di upload non esiste.');
  const run = parseRun(runSnap.data());
  assertRunIdentity(run, ownerUid, input);
  if (promotionSnap.exists) {
    const promotion = validateStoredVisualUploadPromotion(promotionSnap.data());
    if (
      promotion.ownerUid !== ownerUid ||
      promotion.opaqueUploadRunId !== opaqueUploadRunId ||
      promotion.promotionRequestId !== input.promotionRequestId ||
      promotion.mode !== input.mode.mode ||
      promotion.replacedAssetId !==
        (input.mode.mode === 'replace' ? input.mode.replaceAssetId : null)
    )
      throw new AiVisualMultiError(
        'visual_upload_conflict',
        'Upload già promosso con una richiesta diversa.',
      );
    if (run.status !== 'promoted')
      throw new AiVisualMultiError('corrupted_state', 'Run e promozione divergenti.');
    await verifyReplay({ db, bucket, ownerUid, run, promotion });
    const recoverySnap = await recoveryRef.get();
    if (!recoverySnap.exists)
      throw new AiVisualMultiError('corrupted_state', 'Recovery della promozione assente.');
    const recovery = validateStoredVisualUploadPromotionRecovery(recoverySnap.data());
    if (recovery.status !== 'committed' || recovery.assetId !== promotion.assetId)
      throw new AiVisualMultiError('corrupted_state', 'Recovery della promozione divergente.');
    await Promise.all([
      deleteIfPresent(bucket, recovery.stagingRef),
      ...(recovery.supersededStorageRef
        ? [deleteIfPresent(bucket, recovery.supersededStorageRef)]
        : []),
    ]);
    return { replayed: true, assetId: promotion.assetId };
  }
  if (run.status !== 'ready' || !run.normalized)
    throw new AiVisualMultiError(
      'visual_upload_conflict',
      `Il run non è promuovibile nello stato ${run.status}.`,
    );
  const expireAtMs = timestampToMillis(run.expireAt);
  if (expireAtMs === null)
    throw new AiVisualMultiError('corrupted_state', 'Scadenza del run illeggibile.');
  if (expireAtMs <= nowMs)
    throw new AiVisualMultiError('visual_upload_conflict', 'Il run di upload è scaduto.');
  const stagingRef = visualUploadStagingRef(ownerUid, opaqueUploadRunId);
  if (run.normalized.storageRef !== stagingRef)
    throw new AiVisualMultiError('corrupted_state', 'Staging del run divergente.');
  const [staged] = await bucket.file(stagingRef).download();
  const inspected = inspectWebp(staged);
  if (
    staged.byteLength !== run.normalized.byteLength ||
    sha256Hex(staged) !== run.normalized.sha256 ||
    inspected.width !== run.normalized.width ||
    inspected.height !== run.normalized.height
  )
    throw new AiVisualMultiError('corrupted_state', 'Byte di staging divergenti dal run.');
  const priorRecoverySnap = await recoveryRef.get();
  const priorRecovery = priorRecoverySnap.exists
    ? validateStoredVisualUploadPromotionRecovery(priorRecoverySnap.data())
    : null;
  const assetId = priorRecovery?.assetId ?? (params.generateAssetId ?? randomUUID)();
  const storageRef = canonicalVisualStorageRef({
    ownerUid,
    importId: run.importId,
    udaDir: run.udaDir,
    assetId,
  });
  const replacedAssetId = input.mode.mode === 'replace' ? input.mode.replaceAssetId : null;
  const timestamp = Timestamp.fromMillis(nowMs);
  const prepared: StoredVisualUploadPromotionRecovery = priorRecovery ?? {
    contractVersion: VISUAL_UPLOAD_PROMOTION_RECOVERY_CONTRACT_VERSION,
    ownerUid,
    opaqueUploadRunId,
    promotionRequestId: input.promotionRequestId,
    mode: input.mode.mode,
    replacedAssetId,
    assetId,
    storageRef,
    stagingRef,
    supersededStorageRef: null,
    status: 'prepared',
    createdAt: timestamp,
    updatedAt: timestamp,
    expireAt: run.expireAt,
  };
  validateStoredVisualUploadPromotionRecovery(prepared);
  if (
    priorRecovery &&
    (prepared.status !== 'prepared' ||
      prepared.ownerUid !== ownerUid ||
      prepared.opaqueUploadRunId !== opaqueUploadRunId ||
      prepared.promotionRequestId !== input.promotionRequestId ||
      prepared.mode !== input.mode.mode ||
      prepared.replacedAssetId !== replacedAssetId ||
      prepared.storageRef !== storageRef ||
      prepared.stagingRef !== stagingRef)
  )
    throw new AiVisualMultiError(
      'visual_upload_conflict',
      'Recovery già associato a dati diversi.',
    );
  if (!priorRecovery) await recoveryRef.create(prepared);
  try {
    await bucket.file(storageRef).save(staged, {
      resumable: false,
      preconditionOpts: { ifGenerationMatch: 0 },
      metadata: {
        contentType: 'image/webp',
        cacheControl: 'private,no-store',
        metadata: { sha256: run.normalized.sha256 },
      },
    });
  } catch (error) {
    if (!isStoragePreconditionFailed(error)) throw error;
    const [existing] = await bucket.file(storageRef).download();
    if (existing.byteLength !== staged.byteLength || sha256Hex(existing) !== run.normalized.sha256)
      throw new AiVisualMultiError('corrupted_state', 'Percorso canonico già occupato.');
  }
  const lessonRef = db.doc(lessonPath(run.programId, run.importId, run.lessonId));
  const auditRef = db.collection('auditEvents').doc();
  let supersededStorageRef: string | null = null;
  await db.runTransaction(async (tx) => {
    const [freshPromotion, freshRecovery, freshRun, lessonSnap] = await Promise.all([
      tx.get(promotionRef),
      tx.get(recoveryRef),
      tx.get(runRef),
      tx.get(lessonRef),
    ]);
    if (freshPromotion.exists) throw new AiVisualError('running', 'Promozione già in corso.');
    if (!freshRecovery.exists || !freshRun.exists || !lessonSnap.exists)
      throw new AiVisualMultiError('corrupted_state', 'Stato autorevole assente.');
    const currentRun = parseRun(freshRun.data());
    assertRunIdentity(currentRun, ownerUid, input);
    const recovery = validateStoredVisualUploadPromotionRecovery(freshRecovery.data());
    if (
      currentRun.status !== 'ready' ||
      !currentRun.normalized ||
      recovery.status !== 'prepared' ||
      recovery.assetId !== assetId ||
      recovery.storageRef !== storageRef ||
      recovery.promotionRequestId !== input.promotionRequestId
    )
      throw new AiVisualMultiError(
        'visual_upload_conflict',
        'Run o recovery cambiato durante la promozione.',
      );
    const lesson = lessonSnap.data() as Record<string, unknown>;
    const gate = checkLessonForVisual({
      lesson,
      lessonId: run.lessonId,
      ownerUid,
      importId: run.importId,
    });
    if (!gate.ok || gate.publicLessonId !== run.publicLessonId)
      throw new AiVisualError(
        'invalid_input',
        gate.ok ? 'publicLessonId divergente.' : describeVisualBindingFailure(gate.failure),
      );
    const publicRef = db.doc(`publicLessons/${gate.publicLessonId}`);
    const publicSnap = await tx.get(publicRef);
    const projection = checkProjectionForVisual({
      lesson,
      publicLesson: publicSnap.exists ? (publicSnap.data() as Record<string, unknown>) : null,
      programId: run.programId,
      importId: run.importId,
      ownerUid,
    });
    if (!projection.ok)
      throw new AiVisualError('invalid_input', describeVisualBindingFailure(projection.failure));
    const publicBytesRef = db.doc(`${PUBLIC_BYTES}/${gate.publicLessonId}`);
    const publicBytesSnap = await tx.get(publicBytesRef);
    await params.afterPromotionReads?.();
    if (sha256Hex(projection.body) !== currentRun.sourceBodyHash)
      throw new AiVisualMultiError(
        'visual_promotion_anchor_stale',
        'Il corpo della lezione è cambiato.',
      );
    const currentManifest = readManifest(lesson);
    const currentBytes = assertProjectionAligned({
      publicLesson: publicSnap.data() as Record<string, unknown>,
      publicBytes: publicBytesSnap.exists ? publicBytesSnap.data() : null,
      manifest: currentManifest,
      completed: projection.completed,
      publicLessonId: gate.publicLessonId,
      programId: run.programId,
      importId: run.importId,
    });
    const anchor = resolveVisualAnchorForWrite(currentRun.anchor, projection.body);
    const item: LessonVisualItem = {
      assetId,
      storageRef,
      anchor,
      caption: currentRun.caption,
      altText: currentRun.altText,
      width: currentRun.normalized.width,
      height: currentRun.normalized.height,
      byteLength: currentRun.normalized.byteLength,
      sha256: currentRun.normalized.sha256,
      mimeType: 'image/webp',
      source: 'uploaded',
      styleVersion: UPLOADED_VISUAL_STYLE_VERSION,
      sourceBodyHash: currentRun.sourceBodyHash,
      approvedAt: timestamp,
    };
    const items = currentManifest ? [...currentManifest.items] : [];
    if (input.mode.mode === 'add') {
      if (items.length >= 3)
        throw new AiVisualMultiError('visual_slot_full', 'La lezione ha già tre immagini.');
      items.push(item);
    } else {
      const index = items.findIndex((candidate) => candidate.assetId === replacedAssetId);
      if (index < 0)
        throw new AiVisualMultiError(
          'visual_replace_target_missing',
          'Immagine da sostituire non presente.',
        );
      supersededStorageRef = items[index]!.storageRef;
      items.splice(index, 1, item);
    }
    const manifest = validateLessonVisualsManifest({
      contractVersion: LESSON_VISUALS_CONTRACT_VERSION,
      items,
    });
    tx.update(lessonRef, { visuals: manifest, visual: FieldValue.delete() });
    if (projection.completed) {
      const bytes = currentBytes ? { ...currentBytes.bytes } : {};
      if (replacedAssetId) delete bytes[replacedAssetId];
      bytes[assetId] = composePublicBytesEntry(item, staged);
      tx.update(publicRef, {
        visuals: projectLessonVisualsManifest(manifest),
        visual: FieldValue.delete(),
      });
      tx.set(
        publicBytesRef,
        validatePublicLessonVisualBytesDoc({
          contractVersion: LESSON_VISUALS_CONTRACT_VERSION,
          publicLessonId: gate.publicLessonId,
          programId: run.programId,
          importId: run.importId,
          bytes,
        }),
      );
    }
    const promotion: StoredVisualUploadPromotion = {
      contractVersion: VISUAL_UPLOAD_PROMOTION_CONTRACT_VERSION,
      ownerUid,
      opaqueUploadRunId,
      promotionRequestId: input.promotionRequestId,
      mode: input.mode.mode,
      replacedAssetId,
      assetId,
      storageRef,
      createdAt: timestamp,
    };
    validateStoredVisualUploadPromotion(promotion);
    tx.set(promotionRef, promotion);
    tx.set(
      runRef,
      serializeVisualUploadRun({ ...currentRun, status: 'promoted', updatedAt: timestamp }),
    );
    tx.set(recoveryRef, {
      ...recovery,
      supersededStorageRef,
      status: 'committed',
      updatedAt: timestamp,
    });
    tx.set(auditRef, {
      actorUid: ownerUid,
      action: 'lesson.visualApproved',
      targetId: run.lessonId,
      outcome: 'success',
      reason: JSON.stringify({
        source: 'uploaded',
        mode: input.mode.mode,
        assetId,
        total: items.length,
      }),
      timestamp: FieldValue.serverTimestamp(),
    });
  });
  await Promise.all([
    deleteIfPresent(bucket, stagingRef),
    ...(supersededStorageRef ? [deleteIfPresent(bucket, supersededStorageRef)] : []),
  ]);
  return { replayed: false, assetId };
}

const ERROR_MAP: Partial<Record<string, FunctionsErrorCode>> = {
  invalid_input: 'invalid-argument',
  corrupted_state: 'data-loss',
  visual_upload_conflict: 'invalid-argument',
  visual_promotion_anchor_stale: 'failed-precondition',
  visual_slot_full: 'resource-exhausted',
  visual_replace_target_missing: 'failed-precondition',
  unauthenticated: 'unauthenticated',
  not_owner: 'permission-denied',
  running: 'aborted',
  run_conflict: 'invalid-argument',
};

export const aiVisualUploadPromote = onCall(OPTIONS, async (request: CallableRequest<unknown>) => {
  const db = database();
  try {
    const ownerUid = await requireOwner(request, db);
    return await promoteVisualUploadForOwner({
      db,
      bucket: getStorage().bucket() as unknown as BucketLike,
      ownerUid,
      input: validateVisualUploadPromoteInput(request.data),
      nowMs: Date.now(),
    });
  } catch (error) {
    if (error instanceof AiVisualError || error instanceof AiVisualMultiError)
      throw new HttpsError(ERROR_MAP[error.code] ?? 'internal', error.message, {
        code: error.code,
      });
    logger.error('aiVisualUploadPromote internal error', { name: (error as Error)?.name });
    throw new HttpsError('internal', "Errore interno della promozione dell'upload.");
  }
});
