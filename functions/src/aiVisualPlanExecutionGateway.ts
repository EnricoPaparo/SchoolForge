/**
 * MULTI-VISUAL-03B — generazione/retry e promozione di un singolo slot.
 * Le due callable condividono il piano/lease/budget di 03A; solo la prima ha
 * il secret immagini. Nessuna UI o lifecycle editoriale vive qui.
 */

import { randomUUID } from 'node:crypto';
import { getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore';
import type { Firestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import * as logger from 'firebase-functions/logger';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import type { CallableRequest, FunctionsErrorCode } from 'firebase-functions/v2/https';
import { markPending, reconcile, reserve, type BudgetLedgerState } from './aiCorrectionBudget.js';
import { timestampToMillis } from './aiContentCore.js';
import { VISUAL_STYLE_VERSION } from './aiContentVisualProposal.js';
import {
  AiVisualError,
  inspectWebp,
  resolveAiVisualMode,
  sha256Hex,
  type AiVisualMode,
} from './aiVisualCore.js';
import { settleVisualProviderUsage } from './aiVisualEngine.js';
import { AI_VISUAL_OPENAI_API_KEY, isStoragePreconditionFailed } from './aiVisualGateway.js';
import {
  checkLessonForVisual,
  checkProjectionForVisual,
  describeVisualBindingFailure,
} from './aiVisualLessonBinding.js';
import { canonicalVisualStorageRef, validatePublicLessonVisualDoc } from './aiVisualManifest.js';
import {
  AiVisualMultiError,
  LESSON_VISUALS_CONTRACT_VERSION,
  VISUAL_PLAN_MAX_ATTEMPTS_PER_SLOT,
  VISUAL_PLAN_PROMOTION_CONTRACT_VERSION,
  VISUAL_PLAN_PROMOTION_RECOVERY_CONTRACT_VERSION,
  VISUAL_PLAN_SLOT_RUN_CONTRACT_VERSION,
  computeOpaqueVisualPlanId,
  computeOpaqueVisualPlanSlotRunId,
  isUuidV4,
} from './aiVisualMultiCore.js';
import {
  projectLessonVisualsManifest,
  readLegacyLessonVisuals,
  validateLessonVisualsManifest,
  type LessonVisualItem,
} from './aiVisualMultiManifest.js';
import {
  assertPlanIdentity,
  computeExpectedLiveAssetIds,
  failedSlot,
  readySlot,
  remainingGenerationReservation,
  replaceSlot,
  slotRunIdFor,
  upsertSlotSettlement,
  validateStoredVisualPlanPromotion,
  validateStoredVisualPlanPromotionRecovery,
  validateStoredVisualPlanSlotRun,
  validateVisualPlanPromoteInput,
  validateVisualPlanSlotInput,
  visualPlanSlotStagingRef,
  type StoredVisualPlanPromotion,
  type StoredVisualPlanPromotionRecovery,
  type StoredVisualPlanSlotRun,
  type VisualPlanPromoteInput,
  type VisualPlanSlotInput,
} from './aiVisualPlanExecution.js';
import {
  validateVisualPlanRun,
  type VisualPlanRun,
  type VisualPlanSlotLastError,
} from './aiVisualMultiPlan.js';
import { computeVisualPlanLeaseId, validateVisualPlanLease } from './aiVisualPlanLease.js';
import {
  composePublicBytesEntry,
  validatePublicLessonVisualBytesDoc,
  type PublicLessonVisualBytesDoc,
} from './aiVisualMultiPublicBytes.js';
import { normalizeVisualWebp } from './aiVisualNormalizer.js';
import {
  createDeterministicMockImageProvider,
  createImageProvider,
  createOpenAiImageTransport,
  type ImageProviderOutcome,
} from './aiVisualProvider.js';
import { readVisualPlanLedgerState, writeVisualPlanLedgerState } from './aiVisualPlanGateway.js';
import { resolveVisualAnchorForWrite } from './aiVisualMultiAnchor.js';
import { loadRuntimeConfig, retryPolicyFromConfig } from './aiContentGateway.js';
import { SCHOOLFORGE_FUNCTION_REGION } from './deploymentRegion.js';
import { lessonPath, requireOwner } from './aiVisualIdentity.js';
import type { BucketLike } from './repositoryGatewayCore.js';

const PUBLIC_BYTES = 'publicLessonVisuals';
const SLOT_RUNS = 'visualPlanSlotRuns';
const PROMOTIONS = 'visualPlanPromotions';
const PROMOTION_RECOVERIES = 'visualPlanPromotionRecoveries';

const COMMON_OPTIONS = { region: SCHOOLFORGE_FUNCTION_REGION, invoker: 'public' as const };
const GENERATE_OPTIONS = { ...COMMON_OPTIONS, secrets: [AI_VISUAL_OPENAI_API_KEY] };

function database(): Firestore {
  if (getApps().length === 0) initializeApp();
  return getFirestore();
}

function nowOrThrow(plan: VisualPlanRun, nowMs: number): number {
  const expires = timestampToMillis(plan.expireAt);
  if (expires === null)
    throw new AiVisualMultiError('corrupted_state', 'Scadenza del piano illeggibile.');
  if (expires <= nowMs)
    throw new AiVisualMultiError('visual_plan_expired', 'Il piano visivo è scaduto.');
  return expires;
}

function assertLease(plan: VisualPlanRun, raw: unknown, nowMs: number): void {
  const lease = validateVisualPlanLease(raw);
  const opaquePlanId = computeOpaqueVisualPlanId(plan.ownerUid, plan.requestId);
  const expiry = timestampToMillis(lease.expireAt);
  if (
    lease.ownerUid !== plan.ownerUid ||
    lease.programId !== plan.programId ||
    lease.importId !== plan.importId ||
    lease.lessonId !== plan.lessonId ||
    lease.requestId !== plan.requestId ||
    lease.opaquePlanId !== opaquePlanId ||
    expiry === null ||
    expiry <= nowMs
  )
    throw new AiVisualMultiError('corrupted_state', 'Lease del piano non coerente.');
}

function preserveReservation(
  state: BudgetLedgerState,
  plan: VisualPlanRun,
  settledMicroUsd: number,
  remainingMicroUsd: number,
  nowMs: number,
  expireAtMs: number,
): BudgetLedgerState {
  const reconciled = reconcile(state, plan.budgetCeiling.reservationKey, settledMicroUsd, nowMs);
  if (remainingMicroUsd === 0) return reconciled;
  const next = reserve(
    reconciled,
    plan.budgetCeiling.reservationKey,
    remainingMicroUsd,
    expireAtMs,
    nowMs,
  );
  if (!next.ok)
    throw new AiVisualMultiError(
      'corrupted_state',
      'Impossibile preservare la prenotazione del piano.',
    );
  return next.state;
}

export interface GenerateVisualPlanSlotDeps {
  callProvider?: (
    subject: string,
    mode: Exclude<AiVisualMode, 'disabled'>,
  ) => Promise<ImageProviderOutcome>;
  normalize?: typeof normalizeVisualWebp;
  executionId?: () => string;
  resolveSecret?: () => string | undefined;
}

export async function generateVisualPlanSlotForOwner(params: {
  db: Firestore;
  bucket: BucketLike;
  ownerUid: string;
  input: VisualPlanSlotInput;
  mode: AiVisualMode;
  secret?: string;
  nowMs: number;
  deps?: GenerateVisualPlanSlotDeps;
}): Promise<{ replayed: boolean; plan: VisualPlanRun }> {
  const { db, bucket, ownerUid, input, mode, nowMs } = params;
  const opaquePlanId = computeOpaqueVisualPlanId(ownerUid, input.requestId);
  const planRef = db.doc(`visualPlanRuns/${opaquePlanId}`);
  const leaseRef = db.doc(`visualPlanLeases/${computeVisualPlanLeaseId(ownerUid, input.lessonId)}`);
  const slotRunRef = db.doc(
    `${SLOT_RUNS}/${computeOpaqueVisualPlanSlotRunId(ownerUid, opaquePlanId, input.slotIndex)}`,
  );

  const replaySnap = await planRef.get();
  if (!replaySnap.exists) throw new AiVisualMultiError('invalid_input', 'Il piano non esiste.');
  let plan = validateVisualPlanRun(replaySnap.data());
  assertPlanIdentity(plan, ownerUid, input);
  const replaySlot = plan.slots.find((slot) => slot.slotIndex === input.slotIndex);
  if (!replaySlot) throw new AiVisualMultiError('invalid_input', 'Lo slot non esiste.');
  if (replaySlot.state === 'ready' || replaySlot.state === 'promoted')
    return { replayed: true, plan };
  if (mode === 'disabled')
    throw new AiVisualError('feature_disabled', 'La generazione visuale è disattivata.');
  const config = await loadRuntimeConfig(db);
  if (!config || !config.enabled)
    throw new AiVisualError('feature_disabled', 'La generazione visuale è disattivata.');
  const executionId = params.deps?.executionId?.() ?? randomUUID();

  plan = await db.runTransaction(async (tx) => {
    const [planSnap, leaseSnap, ledgerSnap, runSnap] = await Promise.all([
      tx.get(planRef),
      tx.get(leaseRef),
      tx.get(db.doc(`aiBudgetLedger/${plan.budgetCeiling.reservationMonthKey}`)),
      tx.get(slotRunRef),
    ]);
    if (!planSnap.exists || !leaseSnap.exists)
      throw new AiVisualMultiError('corrupted_state', 'Piano o lease assente.');
    const current = validateVisualPlanRun(planSnap.data());
    assertPlanIdentity(current, ownerUid, input);
    nowOrThrow(current, nowMs);
    assertLease(current, leaseSnap.data(), nowMs);
    const slot = current.slots.find((candidate) => candidate.slotIndex === input.slotIndex);
    if (!slot || slot.decision !== 'image' || !slot.subject)
      throw new AiVisualMultiError('visual_plan_slot_not_generatable', 'Slot non generabile.');
    if (slot.state === 'ready' || slot.state === 'promoted') return current;
    if (slot.state === 'generating')
      throw new AiVisualError('running', 'Generazione dello slot già in corso.');
    if (slot.state !== 'pending' && slot.state !== 'failed')
      throw new AiVisualMultiError('visual_plan_slot_not_generatable', 'Slot non generabile.');
    if (slot.attempts >= VISUAL_PLAN_MAX_ATTEMPTS_PER_SLOT)
      throw new AiVisualMultiError(
        'visual_plan_slot_attempts_exhausted',
        'Tentativi dello slot esauriti.',
      );
    if (runSnap.exists) {
      const existingRun = validateStoredVisualPlanSlotRun(runSnap.data());
      if (
        existingRun.ownerUid !== ownerUid ||
        existingRun.opaquePlanId !== opaquePlanId ||
        existingRun.planHash !== current.planHash ||
        existingRun.slotIndex !== input.slotIndex ||
        existingRun.attempts !== slot.attempts ||
        existingRun.subjectHash !== sha256Hex(slot.subject)
      ) {
        throw new AiVisualMultiError('corrupted_state', 'Run dello slot divergente.');
      }
      if (existingRun.status === 'pending' || existingRun.status === 'uncertain')
        throw new AiVisualError(
          'uncertain_state',
          'Esito dello slot incerto; nessun nuovo tentativo.',
        );
      if (existingRun.status !== 'failed')
        throw new AiVisualMultiError(
          'corrupted_state',
          'Run concluso incompatibile con uno slot ritentabile.',
        );
    }
    const ledger = readVisualPlanLedgerState(
      ledgerSnap,
      current.budgetCeiling.reservationMonthKey,
      config.monthlyBudgetMicroUsd,
      config.dailyBudgetMicroUsd,
    );
    const reservation = ledger.reservations[current.budgetCeiling.reservationKey];
    if (
      !reservation ||
      reservation.status === 'pending' ||
      reservation.microUsd < current.budgetCeiling.generationCap
    ) {
      throw new AiVisualError('budget_unavailable', 'Prenotazione del piano non disponibile.');
    }
    const attempts = slot.attempts + 1;
    const generating = {
      ...slot,
      state: 'generating' as const,
      attempts,
      lastError: null,
      staged: null,
      promotedAssetId: null,
    };
    const next = replaceSlot(
      { ...current, settlement: upsertSlotSettlement(current, input.slotIndex, attempts, 0) },
      input.slotIndex,
      generating,
      'generating',
    );
    const timestamp = Timestamp.fromMillis(nowMs);
    const slotRun: StoredVisualPlanSlotRun = {
      contractVersion: VISUAL_PLAN_SLOT_RUN_CONTRACT_VERSION,
      ownerUid,
      opaquePlanId,
      planHash: current.planHash,
      slotIndex: input.slotIndex,
      subjectHash: sha256Hex(slot.subject),
      status: 'pending',
      attempts,
      executionId,
      settledCostMicroUsd: runSnap.exists
        ? validateStoredVisualPlanSlotRun(runSnap.data()).settledCostMicroUsd
        : 0,
      stagingRef: visualPlanSlotStagingRef(ownerUid, opaquePlanId, input.slotIndex),
      createdAt: runSnap.exists
        ? validateStoredVisualPlanSlotRun(runSnap.data()).createdAt
        : timestamp,
      updatedAt: timestamp,
      expireAt: current.expireAt,
    };
    validateStoredVisualPlanSlotRun(slotRun);
    tx.set(planRef, { ...next, updatedAt: timestamp });
    tx.set(slotRunRef, slotRun);
    writeVisualPlanLedgerState(
      tx,
      db.doc(`aiBudgetLedger/${current.budgetCeiling.reservationMonthKey}`),
      markPending(ledger, current.budgetCeiling.reservationKey, nowMs),
    );
    tx.update(leaseRef, { updatedAt: timestamp, expireAt: current.expireAt });
    return { ...next, updatedAt: timestamp };
  });

  const slot = plan.slots.find((candidate) => candidate.slotIndex === input.slotIndex)!;
  if (slot.state !== 'generating' || !slot.subject) return { replayed: true, plan };
  let outcome: ImageProviderOutcome;
  try {
    if (params.deps?.callProvider)
      outcome = await params.deps.callProvider(
        slot.subject,
        mode as Exclude<AiVisualMode, 'disabled'>,
      );
    else if (mode === 'mock')
      outcome = await createDeterministicMockImageProvider().generate(slot.subject);
    else if (mode === 'openai') {
      const secret = params.secret ?? params.deps?.resolveSecret?.();
      outcome = secret
        ? await createImageProvider(createOpenAiImageTransport(secret), {
            policy: retryPolicyFromConfig(config),
          }).generate(slot.subject)
        : { status: 'pre_invocation' };
    } else outcome = { status: 'pre_invocation' };
  } catch {
    outcome = { status: 'pre_invocation' };
  }

  const cap = plan.budgetCeiling.generationCap;
  let staged: {
    storageRef: string;
    width: number;
    height: number;
    byteLength: number;
    sha256: string;
  } | null = null;
  let errorCode: VisualPlanSlotLastError | null = null;
  let settledCostMicroUsd = 0;
  let actualCostMicroUsd: number | null = 0;
  if (outcome.status === 'pre_invocation' || outcome.status === 'invocation_unknown') {
    errorCode = 'transient_error';
    settledCostMicroUsd = outcome.status === 'invocation_unknown' ? cap : 0;
    actualCostMicroUsd = outcome.status === 'invocation_unknown' ? null : 0;
  } else {
    const settlement = settleVisualProviderUsage(outcome, cap);
    settledCostMicroUsd = settlement.settledCostMicroUsd;
    actualCostMicroUsd = settlement.actualCostMicroUsd;
    if (outcome.status === 'billed_unusable') errorCode = 'provider_invalid_output';
    else {
      try {
        const normalized = await (params.deps?.normalize ?? normalizeVisualWebp)(outcome.bytes);
        const storageRef = visualPlanSlotStagingRef(ownerUid, opaquePlanId, input.slotIndex);
        await bucket.file(storageRef).save(normalized.bytes, {
          resumable: false,
          metadata: {
            contentType: 'image/webp',
            cacheControl: 'private,no-store',
            metadata: {
              ownerUid,
              opaquePlanId,
              slotIndex: String(input.slotIndex),
              sha256: normalized.sha256,
            },
          },
        });
        staged = {
          storageRef,
          width: normalized.width,
          height: normalized.height,
          byteLength: normalized.byteLength,
          sha256: normalized.sha256,
        };
      } catch (error) {
        errorCode =
          error instanceof AiVisualError && error.code === 'visual_too_large'
            ? 'visual_too_large'
            : error instanceof AiVisualError
              ? 'provider_invalid_output'
              : 'transient_error';
      }
    }
  }

  try {
    return await db.runTransaction(async (tx) => {
      const [planSnap, leaseSnap, ledgerSnap, runSnap] = await Promise.all([
        tx.get(planRef),
        tx.get(leaseRef),
        tx.get(db.doc(`aiBudgetLedger/${plan.budgetCeiling.reservationMonthKey}`)),
        tx.get(slotRunRef),
      ]);
      if (!planSnap.exists || !leaseSnap.exists || !runSnap.exists)
        throw new AiVisualError('uncertain_state', 'Finalizzazione dello slot incerta.');
      const current = validateVisualPlanRun(planSnap.data());
      const run = validateStoredVisualPlanSlotRun(runSnap.data());
      if (run.executionId !== executionId || run.status !== 'pending')
        throw new AiVisualError('uncertain_state', 'La lease dello slot è cambiata.');
      const currentSlot = current.slots.find(
        (candidate) => candidate.slotIndex === input.slotIndex,
      );
      if (
        !currentSlot ||
        currentSlot.state !== 'generating' ||
        currentSlot.attempts !== run.attempts
      )
        throw new AiVisualError('uncertain_state', 'Lo slot è cambiato durante la generazione.');
      const expireAtMs = nowOrThrow(current, nowMs);
      assertLease(current, leaseSnap.data(), nowMs);
      const resultSlot = staged
        ? readySlot(currentSlot, staged)
        : failedSlot(currentSlot, errorCode ?? 'provider_invalid_output');
      const withSettlement = {
        ...current,
        settlement: upsertSlotSettlement(
          current,
          input.slotIndex,
          currentSlot.attempts,
          actualCostMicroUsd,
        ),
      };
      const next = replaceSlot(withSettlement, input.slotIndex, resultSlot);
      const ledger = readVisualPlanLedgerState(
        ledgerSnap,
        current.budgetCeiling.reservationMonthKey,
        config.monthlyBudgetMicroUsd,
        config.dailyBudgetMicroUsd,
      );
      const nextLedger = preserveReservation(
        ledger,
        current,
        settledCostMicroUsd,
        remainingGenerationReservation(next),
        nowMs,
        expireAtMs,
      );
      const timestamp = Timestamp.fromMillis(nowMs);
      tx.set(planRef, { ...next, updatedAt: timestamp });
      tx.set(slotRunRef, {
        ...run,
        status: staged ? 'completed' : 'failed',
        settledCostMicroUsd: run.settledCostMicroUsd + settledCostMicroUsd,
        updatedAt: timestamp,
      });
      writeVisualPlanLedgerState(
        tx,
        db.doc(`aiBudgetLedger/${current.budgetCeiling.reservationMonthKey}`),
        nextLedger,
      );
      if (['completed', 'partially_completed', 'abandoned'].includes(next.status))
        tx.delete(leaseRef);
      else tx.update(leaseRef, { updatedAt: timestamp, expireAt: current.expireAt });
      return { replayed: false, plan: { ...next, updatedAt: timestamp } };
    });
  } catch (error) {
    if (error instanceof AiVisualError) throw error;
    throw new AiVisualError(
      'uncertain_state',
      'Il provider potrebbe essere stato fatturato; riconciliare lo slot senza una nuova chiamata.',
    );
  }
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

function promotionId(plan: VisualPlanRun, slotIndex: number): string {
  return slotRunIdFor(plan, slotIndex);
}

export async function promoteVisualPlanSlotForOwner(params: {
  db: Firestore;
  bucket: BucketLike;
  ownerUid: string;
  input: VisualPlanPromoteInput;
  nowMs: number;
  generateAssetId?: () => string;
}): Promise<{ replayed: boolean; assetId: string; plan: VisualPlanRun }> {
  const { db, bucket, ownerUid, input, nowMs } = params;
  const opaquePlanId = computeOpaqueVisualPlanId(ownerUid, input.requestId);
  const planRef = db.doc(`visualPlanRuns/${opaquePlanId}`);
  const fastPlanSnap = await planRef.get();
  if (!fastPlanSnap.exists) throw new AiVisualMultiError('invalid_input', 'Il piano non esiste.');
  const fastPlan = validateVisualPlanRun(fastPlanSnap.data());
  assertPlanIdentity(fastPlan, ownerUid, input);
  const promotionRef = db.doc(`${PROMOTIONS}/${promotionId(fastPlan, input.slotIndex)}`);
  const existingPromotionSnap = await promotionRef.get();
  if (existingPromotionSnap.exists) {
    const existing = validateStoredVisualPlanPromotion(existingPromotionSnap.data());
    if (
      existing.promotionRequestId !== input.promotionRequestId ||
      existing.mode !== input.mode.mode ||
      existing.replacedAssetId !==
        (input.mode.mode === 'replace' ? input.mode.replaceAssetId : null)
    ) {
      throw new AiVisualError('run_conflict', 'Lo slot è già stato promosso con dati diversi.');
    }
    return { replayed: true, assetId: existing.assetId, plan: fastPlan };
  }
  const slot = fastPlan.slots.find((candidate) => candidate.slotIndex === input.slotIndex);
  if (
    !slot ||
    slot.state !== 'ready' ||
    !slot.staged ||
    !slot.anchor ||
    !slot.caption ||
    !slot.altText
  ) {
    throw new AiVisualMultiError(
      'visual_plan_slot_not_generatable',
      'Lo slot non è pronto per la promozione.',
    );
  }
  const stagedMeta = slot.staged;
  const [staged] = await bucket.file(stagedMeta.storageRef).download();
  if (sha256Hex(staged) !== stagedMeta.sha256 || staged.byteLength !== stagedMeta.byteLength)
    throw new AiVisualMultiError('corrupted_state', 'Byte staging divergenti.');
  const inspected = inspectWebp(staged);
  if (inspected.width !== stagedMeta.width || inspected.height !== stagedMeta.height)
    throw new AiVisualMultiError('corrupted_state', 'Dimensioni staging divergenti.');
  const replaceAssetId = input.mode.mode === 'replace' ? input.mode.replaceAssetId : null;
  const recoveryRef = db.doc(`${PROMOTION_RECOVERIES}/${promotionId(fastPlan, input.slotIndex)}`);
  const recoverySnap = await recoveryRef.get();
  const priorRecovery = recoverySnap.exists
    ? validateStoredVisualPlanPromotionRecovery(recoverySnap.data())
    : null;
  if (
    priorRecovery &&
    (priorRecovery.ownerUid !== ownerUid ||
      priorRecovery.opaquePlanId !== opaquePlanId ||
      priorRecovery.planHash !== fastPlan.planHash ||
      priorRecovery.slotIndex !== input.slotIndex ||
      priorRecovery.promotionRequestId !== input.promotionRequestId ||
      priorRecovery.mode !== input.mode.mode ||
      priorRecovery.replacedAssetId !== replaceAssetId)
  )
    throw new AiVisualError('run_conflict', 'Recovery di promozione divergente.');
  if (priorRecovery?.status === 'committed')
    throw new AiVisualMultiError(
      'corrupted_state',
      'Recovery committato senza registro di promozione.',
    );
  const assetId = priorRecovery?.assetId ?? params.generateAssetId?.() ?? randomUUID();
  if (!isUuidV4(assetId))
    throw new AiVisualMultiError('corrupted_state', 'assetId generato non valido.');
  const storageRef = canonicalVisualStorageRef({
    ownerUid,
    importId: input.importId,
    udaDir: fastPlan.udaDir,
    assetId,
  });
  if (priorRecovery && priorRecovery.storageRef !== storageRef)
    throw new AiVisualMultiError('corrupted_state', 'Path del recovery divergente.');

  // Preflight read-only: input stantio o mondo mutato devono produrre zero scritture.
  const lessonRef = db.doc(lessonPath(input.programId, input.importId, input.lessonId));
  const lessonPreflight = await lessonRef.get();
  if (!lessonPreflight.exists)
    throw new AiVisualMultiError('corrupted_state', 'LessonDoc autorevole assente.');
  const lessonPreflightData = lessonPreflight.data() as Record<string, unknown>;
  const lessonPreflightGate = checkLessonForVisual({
    lesson: lessonPreflightData,
    lessonId: input.lessonId,
    ownerUid,
    importId: input.importId,
  });
  if (!lessonPreflightGate.ok)
    throw new AiVisualError(
      'invalid_input',
      describeVisualBindingFailure(lessonPreflightGate.failure),
    );
  const publicPreflight = await db.doc(`publicLessons/${lessonPreflightGate.publicLessonId}`).get();
  const projectionPreflight = checkProjectionForVisual({
    lesson: lessonPreflightData,
    publicLesson: publicPreflight.exists
      ? (publicPreflight.data() as Record<string, unknown>)
      : null,
    programId: input.programId,
    importId: input.importId,
    ownerUid,
  });
  if (!projectionPreflight.ok)
    throw new AiVisualError(
      'invalid_input',
      describeVisualBindingFailure(projectionPreflight.failure),
    );
  if (sha256Hex(projectionPreflight.body) !== fastPlan.sourceBodyHash)
    throw new AiVisualMultiError(
      'visual_plan_proposal_body_changed',
      'Il corpo della lezione è cambiato.',
    );
  resolveVisualAnchorForWrite(slot.anchor, projectionPreflight.body);
  const preflightManifest = readLegacyLessonVisuals({
    visual: lessonPreflightData.visual,
    visuals: lessonPreflightData.visuals,
  });
  if (preflightManifest.status !== 'ok' && preflightManifest.status !== 'none')
    throw new AiVisualMultiError(preflightManifest.status, 'Manifest visuale incoerente.');
  const promotedIndexes = fastPlan.slots
    .filter((candidate) => candidate.state === 'promoted')
    .map((candidate) => candidate.slotIndex);
  const preflightPromotionSnaps = await Promise.all(
    promotedIndexes.map((index) => db.doc(`${PROMOTIONS}/${promotionId(fastPlan, index)}`).get()),
  );
  const preflightPromotions = preflightPromotionSnaps.map((snap) => {
    if (!snap.exists)
      throw new AiVisualMultiError('corrupted_state', 'Registro precedente assente.');
    return validateStoredVisualPlanPromotion(snap.data());
  });
  const preflightLiveIds =
    preflightManifest.status === 'ok'
      ? preflightManifest.manifest.items.map((item) => item.assetId)
      : [];
  if (!sameIds(preflightLiveIds, computeExpectedLiveAssetIds(fastPlan, preflightPromotions)))
    throw new AiVisualMultiError(
      'visual_plan_external_mutation',
      'La galleria è cambiata fuori dal piano.',
    );
  if (input.mode.mode === 'add' && preflightLiveIds.length >= 3)
    throw new AiVisualMultiError('visual_slot_full', 'La lezione ha già tre immagini.');
  if (input.mode.mode === 'replace' && !preflightLiveIds.includes(input.mode.replaceAssetId))
    throw new AiVisualMultiError(
      'visual_replace_target_missing',
      'Immagine da sostituire non presente.',
    );

  const timestamp = Timestamp.fromMillis(nowMs);
  const preparedRecovery: StoredVisualPlanPromotionRecovery = priorRecovery ?? {
    contractVersion: VISUAL_PLAN_PROMOTION_RECOVERY_CONTRACT_VERSION,
    ownerUid,
    opaquePlanId,
    planHash: fastPlan.planHash,
    slotIndex: input.slotIndex,
    promotionRequestId: input.promotionRequestId,
    mode: input.mode.mode,
    replacedAssetId: replaceAssetId,
    assetId,
    storageRef,
    status: 'prepared',
    createdAt: timestamp,
    updatedAt: timestamp,
    expireAt: fastPlan.expireAt,
  };
  validateStoredVisualPlanPromotionRecovery(preparedRecovery);
  if (!priorRecovery) await recoveryRef.create(preparedRecovery);
  try {
    await bucket.file(storageRef).save(staged, {
      resumable: false,
      preconditionOpts: { ifGenerationMatch: 0 },
      metadata: {
        contentType: 'image/webp',
        cacheControl: 'private,no-store',
        metadata: { sha256: slot.staged.sha256 },
      },
    });
  } catch (error) {
    if (isStoragePreconditionFailed(error)) {
      const [existing] = await bucket.file(storageRef).download();
      if (existing.byteLength !== staged.byteLength || sha256Hex(existing) !== stagedMeta.sha256)
        throw new AiVisualMultiError('corrupted_state', 'Percorso canonico già occupato.');
    } else {
      throw error;
    }
  }

  const leaseRef = db.doc(`visualPlanLeases/${computeVisualPlanLeaseId(ownerUid, input.lessonId)}`);
  const auditRef = db.collection('auditEvents').doc();
  let supersededStorageRef: string | null = null;
  const result = await db.runTransaction(async (tx) => {
    const promotedSlotIndexes = fastPlan.slots
      .filter((candidate) => candidate.state === 'promoted')
      .map((candidate) => candidate.slotIndex);
    const promotionRefs = promotedSlotIndexes.map((index) =>
      db.doc(`${PROMOTIONS}/${promotionId(fastPlan, index)}`),
    );
    const [
      promotionSnap,
      recoverySnap,
      planSnap,
      leaseSnap,
      lessonSnap,
      ...previousPromotionSnaps
    ] = await Promise.all([
      tx.get(promotionRef),
      tx.get(recoveryRef),
      tx.get(planRef),
      tx.get(leaseRef),
      tx.get(lessonRef),
      ...promotionRefs.map((ref) => tx.get(ref)),
    ]);
    if (promotionSnap.exists) throw new AiVisualError('running', 'Promozione già in corso.');
    if (!recoverySnap.exists || !planSnap.exists || !leaseSnap.exists || !lessonSnap.exists)
      throw new AiVisualMultiError('corrupted_state', 'Stato autorevole assente.');
    const recovery = validateStoredVisualPlanPromotionRecovery(recoverySnap.data());
    if (
      recovery.status !== 'prepared' ||
      recovery.ownerUid !== ownerUid ||
      recovery.opaquePlanId !== opaquePlanId ||
      recovery.planHash !== fastPlan.planHash ||
      recovery.slotIndex !== input.slotIndex ||
      recovery.promotionRequestId !== input.promotionRequestId ||
      recovery.assetId !== assetId ||
      recovery.storageRef !== storageRef ||
      recovery.mode !== input.mode.mode ||
      recovery.replacedAssetId !== replaceAssetId
    )
      throw new AiVisualMultiError('corrupted_state', 'Recovery transazionale divergente.');
    const plan = validateVisualPlanRun(planSnap.data());
    assertPlanIdentity(plan, ownerUid, input);
    nowOrThrow(plan, nowMs);
    assertLease(plan, leaseSnap.data(), nowMs);
    const currentSlot = plan.slots.find((candidate) => candidate.slotIndex === input.slotIndex);
    if (
      !currentSlot ||
      currentSlot.state !== 'ready' ||
      !currentSlot.staged ||
      !currentSlot.anchor ||
      !currentSlot.caption ||
      !currentSlot.altText ||
      currentSlot.staged.sha256 !== stagedMeta.sha256
    )
      throw new AiVisualError('run_conflict', 'Lo slot è cambiato.');
    const lessonData = lessonSnap.data() as Record<string, unknown>;
    const lessonGate = checkLessonForVisual({
      lesson: lessonData,
      lessonId: input.lessonId,
      ownerUid,
      importId: input.importId,
    });
    if (!lessonGate.ok)
      throw new AiVisualError('invalid_input', describeVisualBindingFailure(lessonGate.failure));
    const publicRef = db.doc(`publicLessons/${lessonGate.publicLessonId}`);
    const publicSnap = await tx.get(publicRef);
    const projectionGate = checkProjectionForVisual({
      lesson: lessonData,
      publicLesson: publicSnap.exists ? (publicSnap.data() as Record<string, unknown>) : null,
      programId: input.programId,
      importId: input.importId,
      ownerUid,
    });
    if (!projectionGate.ok)
      throw new AiVisualError(
        'invalid_input',
        describeVisualBindingFailure(projectionGate.failure),
      );
    const publicBytesRef = db.doc(`${PUBLIC_BYTES}/${lessonGate.publicLessonId}`);
    const publicBytesSnap = await tx.get(publicBytesRef);
    const previousPromotions = previousPromotionSnaps.map((snap) => {
      if (!snap.exists)
        throw new AiVisualMultiError(
          'corrupted_state',
          'Registro di una promozione precedente assente.',
        );
      return validateStoredVisualPlanPromotion(snap.data());
    });
    // Letture finite.
    if (sha256Hex(projectionGate.body) !== plan.sourceBodyHash)
      throw new AiVisualMultiError(
        'visual_plan_proposal_body_changed',
        'Il corpo della lezione è cambiato.',
      );
    const legacy = readLegacyLessonVisuals({
      visual: lessonData.visual,
      visuals: lessonData.visuals,
    });
    if (legacy.status !== 'ok' && legacy.status !== 'none')
      throw new AiVisualMultiError(legacy.status, 'Manifest visuale incoerente.');
    const currentManifest = legacy.status === 'ok' ? legacy.manifest : null;
    const liveIds = currentManifest?.items.map((item) => item.assetId) ?? [];
    const expectedIds = computeExpectedLiveAssetIds(plan, previousPromotions);
    if (!sameIds(liveIds, expectedIds))
      throw new AiVisualMultiError(
        'visual_plan_external_mutation',
        'La galleria è cambiata fuori dal piano.',
      );
    const anchor = resolveVisualAnchorForWrite(currentSlot.anchor, projectionGate.body);
    const item: LessonVisualItem = {
      assetId,
      storageRef,
      anchor,
      caption: currentSlot.caption!,
      altText: currentSlot.altText!,
      width: currentSlot.staged.width,
      height: currentSlot.staged.height,
      byteLength: currentSlot.staged.byteLength,
      sha256: currentSlot.staged.sha256,
      mimeType: 'image/webp',
      source: 'generated',
      styleVersion: VISUAL_STYLE_VERSION,
      sourceBodyHash: plan.sourceBodyHash,
      approvedAt: Timestamp.fromMillis(nowMs),
    };
    const items = currentManifest ? [...currentManifest.items] : [];
    if (input.mode.mode === 'add') {
      if (items.length >= 3)
        throw new AiVisualMultiError('visual_slot_full', 'La lezione ha già tre immagini.');
      items.push(item);
    } else {
      const index = items.findIndex((candidate) => candidate.assetId === replaceAssetId);
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
    let publicBytes: PublicLessonVisualBytesDoc | null = null;
    if (projectionGate.completed) {
      let bytesMap: Record<
        string,
        { dataUri: string; mimeType: 'image/webp'; width: number; height: number }
      > = {};
      if (publicBytesSnap.exists) {
        try {
          bytesMap = { ...validatePublicLessonVisualBytesDoc(publicBytesSnap.data()).bytes };
        } catch {
          const singular = validatePublicLessonVisualDoc(publicBytesSnap.data());
          bytesMap[singular.assetId] = {
            dataUri: singular.dataUri,
            mimeType: 'image/webp',
            width: singular.width,
            height: singular.height,
          };
        }
      } else if (items.length > 1) {
        throw new AiVisualMultiError('corrupted_state', 'Byte pubblici precedenti assenti.');
      }
      if (replaceAssetId) delete bytesMap[replaceAssetId];
      bytesMap[assetId] = composePublicBytesEntry(item, staged);
      publicBytes = validatePublicLessonVisualBytesDoc({
        contractVersion: LESSON_VISUALS_CONTRACT_VERSION,
        publicLessonId: lessonGate.publicLessonId,
        programId: input.programId,
        importId: input.importId,
        bytes: bytesMap,
      });
    }
    const promoted = {
      ...currentSlot,
      state: 'promoted' as const,
      staged: null,
      lastError: null,
      promotedAssetId: assetId,
    };
    const nextPlan = replaceSlot(plan, input.slotIndex, promoted);
    const timestamp = Timestamp.fromMillis(nowMs);
    const record: StoredVisualPlanPromotion = {
      contractVersion: VISUAL_PLAN_PROMOTION_CONTRACT_VERSION,
      ownerUid,
      opaquePlanId,
      planHash: plan.planHash,
      slotIndex: input.slotIndex,
      promotionRequestId: input.promotionRequestId,
      mode: input.mode.mode,
      replacedAssetId: input.mode.mode === 'replace' ? input.mode.replaceAssetId : null,
      assetId,
      storageRef,
      createdAt: timestamp,
    };
    validateStoredVisualPlanPromotion(record);
    tx.update(lessonRef, { visuals: manifest, visual: FieldValue.delete() });
    if (projectionGate.completed) {
      tx.update(publicRef, {
        visuals: projectLessonVisualsManifest(manifest),
        visual: FieldValue.delete(),
      });
      tx.set(publicBytesRef, publicBytes!);
    }
    tx.set(planRef, { ...nextPlan, updatedAt: timestamp });
    tx.set(promotionRef, record);
    tx.set(recoveryRef, {
      contractVersion: VISUAL_PLAN_PROMOTION_RECOVERY_CONTRACT_VERSION,
      ownerUid,
      opaquePlanId,
      planHash: plan.planHash,
      slotIndex: input.slotIndex,
      promotionRequestId: input.promotionRequestId,
      mode: input.mode.mode,
      replacedAssetId: replaceAssetId,
      assetId,
      storageRef,
      status: 'committed',
      createdAt: preparedRecovery.createdAt,
      updatedAt: timestamp,
      expireAt: plan.expireAt,
    });
    tx.set(auditRef, {
      actorUid: ownerUid,
      action: 'lesson.visualApproved',
      targetId: input.lessonId,
      outcome: 'success',
      reason: JSON.stringify({
        mode: input.mode.mode,
        assetId,
        slotIndex: input.slotIndex,
        total: items.length,
      }),
      timestamp: FieldValue.serverTimestamp(),
    });
    if (['completed', 'partially_completed', 'abandoned'].includes(nextPlan.status))
      tx.delete(leaseRef);
    else tx.update(leaseRef, { updatedAt: timestamp, expireAt: plan.expireAt });
    return { replayed: false, assetId, plan: { ...nextPlan, updatedAt: timestamp } };
  });
  await Promise.allSettled([
    bucket.file(slot.staged.storageRef).delete(),
    ...(supersededStorageRef ? [bucket.file(supersededStorageRef).delete()] : []),
  ]);
  return result;
}

const ERROR_MAP: Partial<Record<string, FunctionsErrorCode>> = {
  invalid_input: 'invalid-argument',
  corrupted_state: 'data-loss',
  visual_plan_expired: 'failed-precondition',
  visual_plan_slot_not_generatable: 'failed-precondition',
  visual_plan_slot_attempts_exhausted: 'resource-exhausted',
  visual_plan_external_mutation: 'failed-precondition',
  visual_slot_full: 'resource-exhausted',
  visual_replace_target_missing: 'failed-precondition',
  visual_promotion_anchor_stale: 'failed-precondition',
  feature_disabled: 'failed-precondition',
  budget_unavailable: 'unavailable',
  running: 'aborted',
  run_conflict: 'invalid-argument',
  uncertain_state: 'aborted',
};

function https(error: AiVisualError | AiVisualMultiError): HttpsError {
  return new HttpsError(ERROR_MAP[error.code] ?? 'internal', error.message, { code: error.code });
}

export const aiVisualPlanGenerateSlot = onCall(
  GENERATE_OPTIONS,
  async (request: CallableRequest<unknown>) => {
    const db = database();
    try {
      const ownerUid = await requireOwner(request, db);
      const input = validateVisualPlanSlotInput(request.data);
      const mode = resolveAiVisualMode({ AI_VISUAL_MODE: process.env.AI_VISUAL_MODE });
      return await generateVisualPlanSlotForOwner({
        db,
        bucket: getStorage().bucket() as unknown as BucketLike,
        ownerUid,
        input,
        mode,
        nowMs: Date.now(),
        deps: {
          resolveSecret: () => {
            try {
              return AI_VISUAL_OPENAI_API_KEY.value();
            } catch {
              return undefined;
            }
          },
        },
      });
    } catch (error) {
      if (error instanceof AiVisualError || error instanceof AiVisualMultiError) throw https(error);
      logger.error('aiVisualPlanGenerateSlot internal error', { name: (error as Error)?.name });
      throw new HttpsError('internal', 'Errore interno nella generazione dello slot.');
    }
  },
);

export const aiVisualPlanPromoteSlot = onCall(
  COMMON_OPTIONS,
  async (request: CallableRequest<unknown>) => {
    const db = database();
    try {
      const ownerUid = await requireOwner(request, db);
      const input = validateVisualPlanPromoteInput(request.data);
      return await promoteVisualPlanSlotForOwner({
        db,
        bucket: getStorage().bucket() as unknown as BucketLike,
        ownerUid,
        input,
        nowMs: Date.now(),
      });
    } catch (error) {
      if (error instanceof AiVisualError || error instanceof AiVisualMultiError) throw https(error);
      logger.error('aiVisualPlanPromoteSlot internal error', { name: (error as Error)?.name });
      throw new HttpsError('internal', 'Errore interno nella promozione dello slot.');
    }
  },
);
