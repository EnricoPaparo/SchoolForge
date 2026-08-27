/**
 * MULTI-VISUAL-03B — contratti puri dell'esecuzione e promozione per slot.
 * Nessun Firebase, Storage, provider o orologio globale.
 */

import { timestampToMillis } from './aiContentCore.js';
import { isValidDocumentIdInput } from './firestoreDocumentId.js';
import {
  AiVisualMultiError,
  VISUAL_PLAN_MAX_ATTEMPTS_PER_SLOT,
  VISUAL_PLAN_PROMOTION_CONTRACT_VERSION,
  VISUAL_PLAN_PROMOTION_RECOVERY_CONTRACT_VERSION,
  VISUAL_PLAN_SLOT_RUN_CONTRACT_VERSION,
  asRecord,
  assertExactKeys,
  computeOpaqueVisualPlanId,
  computeOpaqueVisualPlanSlotRunId,
  isSha256Hex,
  isUuidV4,
} from './aiVisualMultiCore.js';
import {
  deriveVisualPlanTerminalStatus,
  validateVisualPlanRun,
  type VisualPlanRun,
  type VisualPlanSlot,
  type VisualPlanSlotLastError,
  type VisualPlanSlotStaged,
} from './aiVisualMultiPlan.js';

export interface VisualPlanSlotInput {
  requestId: string;
  programId: string;
  importId: string;
  lessonId: string;
  slotIndex: number;
}

export type VisualPlanPromotionMode = { mode: 'add' } | { mode: 'replace'; replaceAssetId: string };

export interface VisualPlanPromoteInput extends VisualPlanSlotInput {
  promotionRequestId: string;
  mode: VisualPlanPromotionMode;
}

const SLOT_INPUT_KEYS = ['requestId', 'programId', 'importId', 'lessonId', 'slotIndex'] as const;
const PROMOTE_INPUT_KEYS = [...SLOT_INPUT_KEYS, 'promotionRequestId', 'mode'] as const;

function invalid(message: string): never {
  throw new AiVisualMultiError('invalid_input', message);
}

function parseIdentity(root: Record<string, unknown>): VisualPlanSlotInput {
  if (!isUuidV4(root.requestId)) invalid('requestId non valido.');
  if (!isValidDocumentIdInput(root.programId)) invalid('programId non valido.');
  if (!isValidDocumentIdInput(root.importId)) invalid('importId non valido.');
  if (!isValidDocumentIdInput(root.lessonId)) invalid('lessonId non valido.');
  if (
    typeof root.slotIndex !== 'number' ||
    !Number.isInteger(root.slotIndex) ||
    root.slotIndex < 0 ||
    root.slotIndex > 2
  ) {
    invalid('slotIndex non valido.');
  }
  return {
    requestId: root.requestId,
    programId: root.programId,
    importId: root.importId,
    lessonId: root.lessonId,
    slotIndex: root.slotIndex,
  } as VisualPlanSlotInput;
}

export function validateVisualPlanSlotInput(value: unknown): VisualPlanSlotInput {
  const root = asRecord(value, 'Richiesta slot non valida.');
  assertExactKeys(root, SLOT_INPUT_KEYS, 'Richiesta slot');
  return parseIdentity(root);
}

export function validateVisualPlanPromoteInput(value: unknown): VisualPlanPromoteInput {
  const root = asRecord(value, 'Richiesta di promozione non valida.');
  assertExactKeys(root, PROMOTE_INPUT_KEYS, 'Richiesta di promozione');
  const identity = parseIdentity(root);
  if (!isUuidV4(root.promotionRequestId)) invalid('promotionRequestId non valido.');
  const mode = asRecord(root.mode, 'Modalità di promozione non valida.');
  if (mode.mode === 'add') {
    assertExactKeys(mode, ['mode'], 'Modalità add');
    return {
      ...identity,
      promotionRequestId: root.promotionRequestId,
      mode: { mode: 'add' },
    } as VisualPlanPromoteInput;
  }
  if (mode.mode === 'replace') {
    assertExactKeys(mode, ['mode', 'replaceAssetId'], 'Modalità replace');
    if (!isUuidV4(mode.replaceAssetId)) invalid('replaceAssetId non valido.');
    return {
      ...identity,
      promotionRequestId: root.promotionRequestId,
      mode: { mode: 'replace', replaceAssetId: mode.replaceAssetId },
    } as VisualPlanPromoteInput;
  }
  invalid('Modalità di promozione non valida.');
}

export function assertPlanIdentity(
  plan: VisualPlanRun,
  ownerUid: string,
  input: VisualPlanSlotInput,
): void {
  if (
    plan.ownerUid !== ownerUid ||
    plan.requestId !== input.requestId ||
    plan.programId !== input.programId ||
    plan.importId !== input.importId ||
    plan.lessonId !== input.lessonId
  ) {
    throw new AiVisualMultiError('corrupted_state', 'Identità del piano divergente.');
  }
}

export function visualPlanSlotStagingRef(
  ownerUid: string,
  opaquePlanId: string,
  slotIndex: number,
): string {
  return `staging/${ownerUid}/${opaquePlanId}/${slotIndex}.webp`;
}

export interface StoredVisualPlanSlotRun {
  contractVersion: typeof VISUAL_PLAN_SLOT_RUN_CONTRACT_VERSION;
  ownerUid: string;
  opaquePlanId: string;
  planHash: string;
  slotIndex: number;
  subjectHash: string;
  status: 'pending' | 'completed' | 'failed' | 'uncertain';
  attempts: number;
  executionId: string;
  settledCostMicroUsd: number;
  stagingRef: string;
  createdAt: unknown;
  updatedAt: unknown;
  expireAt: unknown;
}

const SLOT_RUN_KEYS = [
  'contractVersion',
  'ownerUid',
  'opaquePlanId',
  'planHash',
  'slotIndex',
  'subjectHash',
  'status',
  'attempts',
  'executionId',
  'settledCostMicroUsd',
  'stagingRef',
  'createdAt',
  'updatedAt',
  'expireAt',
] as const;

export function validateStoredVisualPlanSlotRun(value: unknown): StoredVisualPlanSlotRun {
  const root = asRecord(value, 'Run dello slot non valido.', 'corrupted_state');
  assertExactKeys(root, SLOT_RUN_KEYS, 'Run dello slot', 'corrupted_state');
  if (root.contractVersion !== VISUAL_PLAN_SLOT_RUN_CONTRACT_VERSION) {
    throw new AiVisualMultiError('corrupted_state', 'contractVersion del run non valida.');
  }
  if (
    !isValidDocumentIdInput(root.ownerUid) ||
    !isSha256Hex(root.opaquePlanId) ||
    !isSha256Hex(root.planHash) ||
    !isSha256Hex(root.subjectHash)
  ) {
    throw new AiVisualMultiError('corrupted_state', 'Identità del run non valida.');
  }
  if (
    typeof root.slotIndex !== 'number' ||
    !Number.isInteger(root.slotIndex) ||
    root.slotIndex < 0 ||
    root.slotIndex > 2
  ) {
    throw new AiVisualMultiError('corrupted_state', 'slotIndex del run non valido.');
  }
  if (!['pending', 'completed', 'failed', 'uncertain'].includes(root.status as string)) {
    throw new AiVisualMultiError('corrupted_state', 'status del run non valido.');
  }
  if (
    typeof root.attempts !== 'number' ||
    !Number.isInteger(root.attempts) ||
    root.attempts < 1 ||
    root.attempts > VISUAL_PLAN_MAX_ATTEMPTS_PER_SLOT
  ) {
    throw new AiVisualMultiError('corrupted_state', 'attempts del run non valido.');
  }
  if (!isUuidV4(root.executionId))
    throw new AiVisualMultiError('corrupted_state', 'executionId non valido.');
  if (
    typeof root.settledCostMicroUsd !== 'number' ||
    !Number.isInteger(root.settledCostMicroUsd) ||
    root.settledCostMicroUsd < 0
  ) {
    throw new AiVisualMultiError('corrupted_state', 'Costo del run non valido.');
  }
  const expectedRef = visualPlanSlotStagingRef(root.ownerUid, root.opaquePlanId, root.slotIndex);
  if (root.stagingRef !== expectedRef)
    throw new AiVisualMultiError('corrupted_state', 'stagingRef del run non canonico.');
  const created = timestampToMillis(root.createdAt);
  const updated = timestampToMillis(root.updatedAt);
  const expire = timestampToMillis(root.expireAt);
  if (
    created === null ||
    updated === null ||
    expire === null ||
    created > updated ||
    updated > expire
  ) {
    throw new AiVisualMultiError('corrupted_state', 'Timestamp del run non validi.');
  }
  return root as unknown as StoredVisualPlanSlotRun;
}

export interface StoredVisualPlanPromotion {
  contractVersion: typeof VISUAL_PLAN_PROMOTION_CONTRACT_VERSION;
  ownerUid: string;
  opaquePlanId: string;
  planHash: string;
  slotIndex: number;
  sequence: number;
  promotionRequestId: string;
  mode: 'add' | 'replace';
  replacedAssetId: string | null;
  assetId: string;
  storageRef: string;
  createdAt: unknown;
}

export interface StoredVisualPlanPromotionRecovery {
  contractVersion: typeof VISUAL_PLAN_PROMOTION_RECOVERY_CONTRACT_VERSION;
  ownerUid: string;
  opaquePlanId: string;
  planHash: string;
  slotIndex: number;
  promotionRequestId: string;
  mode: 'add' | 'replace';
  replacedAssetId: string | null;
  assetId: string;
  storageRef: string;
  status: 'prepared' | 'committed';
  createdAt: unknown;
  updatedAt: unknown;
  expireAt: unknown;
}

const PROMOTION_RECOVERY_KEYS = [
  'contractVersion',
  'ownerUid',
  'opaquePlanId',
  'planHash',
  'slotIndex',
  'promotionRequestId',
  'mode',
  'replacedAssetId',
  'assetId',
  'storageRef',
  'status',
  'createdAt',
  'updatedAt',
  'expireAt',
] as const;

export function validateStoredVisualPlanPromotionRecovery(
  value: unknown,
): StoredVisualPlanPromotionRecovery {
  const root = asRecord(value, 'Recovery di promozione non valido.', 'corrupted_state');
  assertExactKeys(root, PROMOTION_RECOVERY_KEYS, 'Recovery di promozione', 'corrupted_state');
  if (
    root.contractVersion !== VISUAL_PLAN_PROMOTION_RECOVERY_CONTRACT_VERSION ||
    !isValidDocumentIdInput(root.ownerUid) ||
    !isSha256Hex(root.opaquePlanId) ||
    !isSha256Hex(root.planHash) ||
    !isUuidV4(root.promotionRequestId) ||
    !isUuidV4(root.assetId)
  )
    throw new AiVisualMultiError('corrupted_state', 'Identità del recovery non valida.');
  if (
    !Number.isInteger(root.slotIndex) ||
    (root.slotIndex as number) < 0 ||
    (root.slotIndex as number) > 2
  )
    throw new AiVisualMultiError('corrupted_state', 'slotIndex del recovery non valido.');
  if (root.mode === 'add') {
    if (root.replacedAssetId !== null)
      throw new AiVisualMultiError('corrupted_state', 'Recovery add incoerente.');
  } else if (root.mode === 'replace') {
    if (!isUuidV4(root.replacedAssetId))
      throw new AiVisualMultiError('corrupted_state', 'Recovery replace incoerente.');
  } else throw new AiVisualMultiError('corrupted_state', 'mode del recovery non valido.');
  if (!['prepared', 'committed'].includes(root.status as string))
    throw new AiVisualMultiError('corrupted_state', 'status del recovery non valido.');
  if (typeof root.storageRef !== 'string' || !root.storageRef.endsWith(`/${root.assetId}.webp`))
    throw new AiVisualMultiError('corrupted_state', 'storageRef del recovery non valido.');
  const created = timestampToMillis(root.createdAt);
  const updated = timestampToMillis(root.updatedAt);
  const expire = timestampToMillis(root.expireAt);
  if (
    created === null ||
    updated === null ||
    expire === null ||
    created > updated ||
    updated > expire
  )
    throw new AiVisualMultiError('corrupted_state', 'Timestamp del recovery non validi.');
  return root as unknown as StoredVisualPlanPromotionRecovery;
}

const PROMOTION_KEYS = [
  'contractVersion',
  'ownerUid',
  'opaquePlanId',
  'planHash',
  'slotIndex',
  'sequence',
  'promotionRequestId',
  'mode',
  'replacedAssetId',
  'assetId',
  'storageRef',
  'createdAt',
] as const;

export function validateStoredVisualPlanPromotion(value: unknown): StoredVisualPlanPromotion {
  const root = asRecord(value, 'Registro di promozione non valido.', 'corrupted_state');
  assertExactKeys(root, PROMOTION_KEYS, 'Registro di promozione', 'corrupted_state');
  if (
    root.contractVersion !== VISUAL_PLAN_PROMOTION_CONTRACT_VERSION ||
    !isValidDocumentIdInput(root.ownerUid) ||
    !isSha256Hex(root.opaquePlanId) ||
    !isSha256Hex(root.planHash) ||
    !isUuidV4(root.promotionRequestId) ||
    !isUuidV4(root.assetId)
  ) {
    throw new AiVisualMultiError('corrupted_state', 'Identità della promozione non valida.');
  }
  if (
    !Number.isInteger(root.sequence) ||
    (root.sequence as number) < 0 ||
    (root.sequence as number) > 2
  )
    throw new AiVisualMultiError('corrupted_state', 'sequence della promozione non valida.');
  if (
    typeof root.slotIndex !== 'number' ||
    !Number.isInteger(root.slotIndex) ||
    root.slotIndex < 0 ||
    root.slotIndex > 2
  ) {
    throw new AiVisualMultiError('corrupted_state', 'slotIndex della promozione non valido.');
  }
  if (root.mode === 'add') {
    if (root.replacedAssetId !== null)
      throw new AiVisualMultiError('corrupted_state', 'Promozione add incoerente.');
  } else if (root.mode === 'replace') {
    if (!isUuidV4(root.replacedAssetId))
      throw new AiVisualMultiError('corrupted_state', 'Promozione replace incoerente.');
  } else {
    throw new AiVisualMultiError('corrupted_state', 'mode della promozione non valido.');
  }
  if (typeof root.storageRef !== 'string' || !root.storageRef.endsWith(`/${root.assetId}.webp`)) {
    throw new AiVisualMultiError('corrupted_state', 'storageRef della promozione non valido.');
  }
  if (timestampToMillis(root.createdAt) === null)
    throw new AiVisualMultiError('corrupted_state', 'createdAt della promozione non valido.');
  return root as unknown as StoredVisualPlanPromotion;
}

export function computeExpectedLiveAssetIds(
  plan: VisualPlanRun,
  promotions: readonly StoredVisualPlanPromotion[],
): string[] {
  const live = [...plan.existingItemAssetIds];
  const ordered = [...promotions].sort((a, b) => a.sequence - b.sequence);
  if (ordered.some((promotion, index) => promotion.sequence !== index))
    throw new AiVisualMultiError('corrupted_state', 'Sequenza delle promozioni non contigua.');
  for (const promotion of ordered) {
    if (
      promotion.ownerUid !== plan.ownerUid ||
      promotion.opaquePlanId !== computeOpaqueVisualPlanId(plan.ownerUid, plan.requestId) ||
      promotion.planHash !== plan.planHash
    ) {
      throw new AiVisualMultiError('corrupted_state', 'Registro di promozione estraneo al piano.');
    }
    if (promotion.mode === 'replace') {
      const index = live.indexOf(promotion.replacedAssetId!);
      if (index < 0)
        throw new AiVisualMultiError(
          'corrupted_state',
          'Target sostituito non presente nel baseline atteso.',
        );
      live.splice(index, 1, promotion.assetId);
    } else {
      live.push(promotion.assetId);
    }
  }
  return live;
}

export function replaceSlot(
  plan: VisualPlanRun,
  slotIndex: number,
  slot: VisualPlanSlot,
  status?: VisualPlanRun['status'],
): VisualPlanRun {
  const slots = plan.slots.map((current) => (current.slotIndex === slotIndex ? slot : current));
  let nextStatus = status;
  if (!nextStatus) {
    const allTerminal = slots.every(
      (candidate) =>
        candidate.state === 'promoted' ||
        candidate.state === 'abandoned' ||
        (candidate.state === 'failed' && candidate.attempts === VISUAL_PLAN_MAX_ATTEMPTS_PER_SLOT),
    );
    if (allTerminal) nextStatus = deriveVisualPlanTerminalStatus(slots);
    else if (slots.some((candidate) => candidate.state === 'generating')) nextStatus = 'generating';
    else if (slots.some((candidate) => candidate.state === 'ready')) nextStatus = 'awaiting_review';
    else nextStatus = 'awaiting_review';
  }
  const next = { ...plan, status: nextStatus, slots };
  return validateVisualPlanRun(next);
}

export function upsertSlotSettlement(
  plan: VisualPlanRun,
  slotIndex: number,
  attempts: number,
  attemptCostMicroUsd: number | null,
): VisualPlanRun['settlement'] {
  const current = plan.settlement.slots.find((entry) => entry.slotIndex === slotIndex);
  const known = current?.actualCost;
  const actualCost =
    known === null || attemptCostMicroUsd === null ? null : (known ?? 0) + attemptCostMicroUsd;
  return {
    ...plan.settlement,
    slots: [
      ...plan.settlement.slots.filter((entry) => entry.slotIndex !== slotIndex),
      { slotIndex, attempts, actualCost },
    ].sort((a, b) => a.slotIndex - b.slotIndex),
  };
}

export function remainingGenerationReservation(plan: VisualPlanRun): number {
  let attempts = 0;
  for (const slot of plan.slots) {
    if (slot.decision !== 'image') continue;
    if (slot.state === 'pending') attempts += VISUAL_PLAN_MAX_ATTEMPTS_PER_SLOT;
    if (
      slot.state === 'failed' &&
      slot.lastError !== 'uncertain_outcome' &&
      slot.lastError !== 'staging_conflict'
    ) {
      attempts += VISUAL_PLAN_MAX_ATTEMPTS_PER_SLOT - slot.attempts;
    }
  }
  return attempts * plan.budgetCeiling.generationCap;
}

export function failedSlot(
  slot: VisualPlanSlot,
  lastError: VisualPlanSlotLastError,
): VisualPlanSlot {
  return { ...slot, state: 'failed', lastError, staged: null, promotedAssetId: null };
}

export function readySlot(slot: VisualPlanSlot, staged: VisualPlanSlotStaged): VisualPlanSlot {
  return { ...slot, state: 'ready', lastError: null, staged, promotedAssetId: null };
}

export function slotRunIdFor(plan: VisualPlanRun, slotIndex: number): string {
  return computeOpaqueVisualPlanSlotRunId(
    plan.ownerUid,
    computeOpaqueVisualPlanId(plan.ownerUid, plan.requestId),
    slotIndex,
  );
}
