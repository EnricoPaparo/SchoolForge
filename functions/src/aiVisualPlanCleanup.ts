import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import type { Firestore } from 'firebase-admin/firestore';
import { reconcile } from './aiCorrectionBudget.js';
import { timestampToMillis } from './aiContentCore.js';
import type { LessonLifecycleInput } from './aiVisualLifecycle.js';
import { AiVisualMultiError, computeOpaqueVisualPlanId } from './aiVisualMultiCore.js';
import {
  deriveVisualPlanTerminalStatus,
  validateVisualPlanRun,
  type VisualPlanRun,
  type VisualPlanSlot,
} from './aiVisualMultiPlan.js';
import {
  slotRunIdFor,
  validateStoredVisualPlanSlotRun,
  visualPlanPhaseReservationKey,
  visualPlanSlotStagingRef,
} from './aiVisualPlanExecution.js';
import { computeVisualPlanLeaseId, validateVisualPlanLease } from './aiVisualPlanLease.js';
import {
  closeVisualPlanReservation,
  readVisualPlanLedgerState,
  writeVisualPlanLedgerState,
} from './aiVisualPlanLedger.js';

const SLOT_RUNS = 'visualPlanSlotRuns';
const CLEANUP_RECOVERIES = 'visualPlanCleanupRecoveries';
const CLEANUP_RECOVERY_CONTRACT_VERSION = 'visual-plan-cleanup-recovery/v1';

interface VisualPlanCleanupRecovery {
  contractVersion: typeof CLEANUP_RECOVERY_CONTRACT_VERSION;
  ownerUid: string;
  programId: string;
  importId: string;
  lessonId: string;
  stagingRefs: string[];
  updatedAt: Timestamp;
}

export function visualPlanCleanupRecoveryPath(ownerUid: string, lessonId: string): string {
  return `${CLEANUP_RECOVERIES}/${computeVisualPlanLeaseId(ownerUid, lessonId)}`;
}

function validateCleanupRecovery(
  value: unknown,
  ownerUid: string,
  input: LessonLifecycleInput,
): VisualPlanCleanupRecovery {
  if (typeof value !== 'object' || value === null)
    throw new AiVisualMultiError('corrupted_state', 'Recovery cleanup piano non valida.');
  const raw = value as Record<string, unknown>;
  const stagingRefs = raw.stagingRefs;
  const prefix = `staging/${ownerUid}/`;
  if (
    raw.contractVersion !== CLEANUP_RECOVERY_CONTRACT_VERSION ||
    raw.ownerUid !== ownerUid ||
    raw.programId !== input.programId ||
    raw.importId !== input.importId ||
    raw.lessonId !== input.lessonId ||
    !Array.isArray(stagingRefs) ||
    stagingRefs.length > 100 ||
    stagingRefs.some(
      (ref) =>
        typeof ref !== 'string' ||
        !ref.startsWith(prefix) ||
        !ref.endsWith('.webp') ||
        ref.includes('..'),
    ) ||
    !(raw.updatedAt instanceof Timestamp)
  ) {
    throw new AiVisualMultiError('corrupted_state', 'Recovery cleanup piano divergente.');
  }
  return raw as unknown as VisualPlanCleanupRecovery;
}

function ledgerLimit(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new AiVisualMultiError('corrupted_state', `${label} del ledger non valido.`);
  }
  return value;
}

function sameIdentity(plan: VisualPlanRun, ownerUid: string, input: LessonLifecycleInput): boolean {
  return (
    plan.ownerUid === ownerUid &&
    plan.programId === input.programId &&
    plan.importId === input.importId &&
    plan.lessonId === input.lessonId
  );
}

function abandonedSlot(slot: VisualPlanSlot): VisualPlanSlot {
  if (slot.state === 'promoted' || slot.state === 'abandoned') return slot;
  return {
    ...slot,
    state: 'abandoned',
    lastError: null,
    staged: null,
    promotedAssetId: null,
  };
}

/**
 * Chiude il piano che detiene il lease di una lezione prima che la lezione
 * venga pulita o eliminata. Un tentativo provider già `pending` viene
 * liquidato al cap; una quota soltanto riservata viene invece rilasciata.
 */
export async function invalidateVisualPlanForLessonCleanup(params: {
  db: Firestore;
  ownerUid: string;
  input: LessonLifecycleInput;
  nowMs?: number;
}): Promise<{
  invalidated: boolean;
  stagingRefs: string[];
  recoveryRefPath: string | null;
}> {
  const nowMs = params.nowMs ?? Date.now();
  const leaseRef = params.db.doc(
    `visualPlanLeases/${computeVisualPlanLeaseId(params.ownerUid, params.input.lessonId)}`,
  );
  const recoveryRef = params.db.doc(
    visualPlanCleanupRecoveryPath(params.ownerUid, params.input.lessonId),
  );

  return params.db.runTransaction(async (tx) => {
    const [leaseSnap, recoverySnap] = await Promise.all([tx.get(leaseRef), tx.get(recoveryRef)]);
    const previousRecovery = recoverySnap.exists
      ? validateCleanupRecovery(recoverySnap.data(), params.ownerUid, params.input)
      : null;
    if (!leaseSnap.exists)
      return {
        invalidated: false,
        stagingRefs: previousRecovery?.stagingRefs ?? [],
        recoveryRefPath: previousRecovery ? recoveryRef.path : null,
      };

    const lease = validateVisualPlanLease(leaseSnap.data());
    if (
      lease.ownerUid !== params.ownerUid ||
      lease.programId !== params.input.programId ||
      lease.importId !== params.input.importId ||
      lease.lessonId !== params.input.lessonId
    ) {
      throw new AiVisualMultiError(
        'corrupted_state',
        'Lease del piano non coerente con la lezione.',
      );
    }

    const planRef = params.db.doc(`visualPlanRuns/${lease.opaquePlanId}`);
    const planSnap = await tx.get(planRef);
    if (!planSnap.exists) {
      throw new AiVisualMultiError('corrupted_state', 'Piano del lease non disponibile.');
    }
    const plan = validateVisualPlanRun(planSnap.data());
    if (
      !sameIdentity(plan, params.ownerUid, params.input) ||
      computeOpaqueVisualPlanId(plan.ownerUid, plan.requestId) !== lease.opaquePlanId ||
      plan.requestId !== lease.requestId
    ) {
      throw new AiVisualMultiError('corrupted_state', 'Piano e lease non coerenti.');
    }

    const slotRunRefs = plan.slots.map((slot) =>
      params.db.doc(`${SLOT_RUNS}/${slotRunIdFor(plan, slot.slotIndex)}`),
    );
    const slotRunSnaps = await Promise.all(slotRunRefs.map((ref) => tx.get(ref)));
    const ledgerRef = params.db.doc(`aiBudgetLedger/${plan.budgetCeiling.reservationMonthKey}`);
    const ledgerSnap = await tx.get(ledgerRef);
    if (!ledgerSnap.exists) {
      throw new AiVisualMultiError('corrupted_state', 'Ledger del piano non disponibile.');
    }
    const rawLedger = ledgerSnap.data() as Record<string, unknown>;
    let ledger = readVisualPlanLedgerState(
      ledgerSnap,
      plan.budgetCeiling.reservationMonthKey,
      ledgerLimit(rawLedger.budgetMicroUsd, 'budgetMicroUsd'),
      ledgerLimit(rawLedger.dailyBudgetMicroUsd, 'dailyBudgetMicroUsd'),
    );

    for (let index = 0; index < slotRunSnaps.length; index += 1) {
      const runSnap = slotRunSnaps[index]!;
      if (!runSnap.exists) continue;
      const run = validateStoredVisualPlanSlotRun(runSnap.data());
      const slot = plan.slots[index]!;
      if (
        run.ownerUid !== params.ownerUid ||
        run.opaquePlanId !== lease.opaquePlanId ||
        run.planHash !== plan.planHash ||
        run.slotIndex !== slot.slotIndex
      ) {
        throw new AiVisualMultiError('corrupted_state', 'Run dello slot non coerente col piano.');
      }
      if (run.status !== 'pending') continue;
      const phaseKey = visualPlanPhaseReservationKey(
        plan.budgetCeiling.reservationKey,
        slot.slotIndex,
        run.attempts,
      );
      const phaseReservation = ledger.reservations[phaseKey];
      const charged = phaseReservation?.status === 'pending' ? phaseReservation.microUsd : 0;
      ledger = reconcile(ledger, phaseKey, charged, nowMs);
      const runCreatedMs = timestampToMillis(run.createdAt)!;
      const runExpireMs = timestampToMillis(run.expireAt)!;
      tx.set(slotRunRefs[index]!, {
        ...run,
        status: 'uncertain',
        settledCostMicroUsd: run.settledCostMicroUsd + charged,
        updatedAt: Timestamp.fromMillis(Math.max(runCreatedMs, Math.min(nowMs, runExpireMs))),
      });
    }

    ledger = closeVisualPlanReservation(ledger, plan, nowMs);
    writeVisualPlanLedgerState(tx, ledgerRef, ledger);

    const slots = plan.slots.map(abandonedSlot);
    const status = deriveVisualPlanTerminalStatus(slots);
    const createdMs = timestampToMillis(plan.createdAt)!;
    const expireMs = timestampToMillis(plan.expireAt)!;
    const updatedAt = Timestamp.fromMillis(Math.max(createdMs, Math.min(nowMs, expireMs)));
    const closed = validateVisualPlanRun({ ...plan, slots, status, updatedAt });
    tx.set(planRef, closed);
    tx.delete(leaseRef);
    tx.set(params.db.collection('auditEvents').doc(), {
      actorUid: params.ownerUid,
      action: 'lesson.visualPlanInvalidated',
      targetId: params.input.lessonId,
      outcome: 'success',
      reason: 'lesson_cleanup',
      timestamp: FieldValue.serverTimestamp(),
    });

    const stagingRefs = [
      ...(previousRecovery?.stagingRefs ?? []),
      ...plan.slots
        .filter((slot) => slot.decision === 'image' && slot.state !== 'promoted')
        .map((slot) =>
          visualPlanSlotStagingRef(params.ownerUid, lease.opaquePlanId, slot.slotIndex),
        ),
    ].filter((storageRef, index, all) => all.indexOf(storageRef) === index);
    tx.set(recoveryRef, {
      contractVersion: CLEANUP_RECOVERY_CONTRACT_VERSION,
      ownerUid: params.ownerUid,
      programId: params.input.programId,
      importId: params.input.importId,
      lessonId: params.input.lessonId,
      stagingRefs,
      updatedAt,
    } satisfies VisualPlanCleanupRecovery);

    return {
      invalidated: true,
      stagingRefs,
      recoveryRefPath: recoveryRef.path,
    };
  });
}
