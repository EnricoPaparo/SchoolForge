/** MULTI-VISUAL-04 — callable owner-only per la revisione gratuita §8.4. */
import { getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';
import * as logger from 'firebase-functions/logger';
import {
  HttpsError,
  onCall,
  type CallableRequest,
  type FunctionsErrorCode,
} from 'firebase-functions/v2/https';
import { reconcile, reserve } from './aiCorrectionBudget.js';
import { timestampToMillis } from './aiContentCore.js';
import { AiVisualError, sha256Hex } from './aiVisualCore.js';
import {
  checkLessonForVisual,
  checkProjectionForVisual,
  describeVisualBindingFailure,
} from './aiVisualLessonBinding.js';
import { AiVisualMultiError, computeOpaqueVisualPlanId } from './aiVisualMultiCore.js';
import { resolveVisualAnchorForWrite } from './aiVisualMultiAnchor.js';
import {
  applyVisualPlanSlotEdit,
  validateStoredVisualPlanSlotEdit,
  validateVisualPlanEditSlotInput,
  visualPlanSlotEditId,
  visualPlanSlotEditInputHash,
  type StoredVisualPlanSlotEdit,
  type VisualPlanEditSlotInput,
} from './aiVisualPlanEditorial.js';
import { remainingGenerationReservation } from './aiVisualPlanExecution.js';
import { validateVisualPlanRun, type VisualPlanRun } from './aiVisualMultiPlan.js';
import { computeVisualPlanLeaseId, validateVisualPlanLease } from './aiVisualPlanLease.js';
import { readVisualPlanLedgerState, writeVisualPlanLedgerState } from './aiVisualPlanGateway.js';
import { lessonPath, requireOwner } from './aiVisualIdentity.js';
import { SCHOOLFORGE_FUNCTION_REGION } from './deploymentRegion.js';

const OPTIONS = { region: SCHOOLFORGE_FUNCTION_REGION, invoker: 'public' as const };
const EDITS = 'visualPlanSlotEdits';

function database(): Firestore {
  if (getApps().length === 0) initializeApp();
  return getFirestore();
}

function samePlanIdentity(
  plan: VisualPlanRun,
  ownerUid: string,
  input: VisualPlanEditSlotInput,
): boolean {
  return (
    plan.ownerUid === ownerUid &&
    plan.requestId === input.requestId &&
    plan.programId === input.programId &&
    plan.importId === input.importId &&
    plan.lessonId === input.lessonId
  );
}

function ledgerLimit(raw: unknown, label: string): number {
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 0) {
    throw new AiVisualMultiError('corrupted_state', `${label} del ledger non valido.`);
  }
  return raw;
}

export async function editVisualPlanSlotForOwner(params: {
  db: Firestore;
  ownerUid: string;
  input: VisualPlanEditSlotInput;
  nowMs?: number;
}): Promise<{ replayed: boolean; plan: VisualPlanRun }> {
  const { db, ownerUid, input } = params;
  const nowMs = params.nowMs ?? Date.now();
  const opaquePlanId = computeOpaqueVisualPlanId(ownerUid, input.requestId);
  const planRef = db.doc(`visualPlanRuns/${opaquePlanId}`);
  const lessonRef = db.doc(lessonPath(input.programId, input.importId, input.lessonId));
  const leaseRef = db.doc(`visualPlanLeases/${computeVisualPlanLeaseId(ownerUid, input.lessonId)}`);
  const ownerRef = db.doc('settings/owner');
  const editRef = db.doc(`${EDITS}/${visualPlanSlotEditId(ownerUid, input.editRequestId)}`);
  const inputHash = visualPlanSlotEditInputHash(input);
  const auditRef = db.doc(`auditEvents/${visualPlanSlotEditId(ownerUid, input.editRequestId)}`);

  return db.runTransaction(async (tx) => {
    // Tutte le fonti autoritative vengono rilette nella stessa transazione;
    // il ledger canonico viene poi selezionato dal mese congelato nel piano.
    const [ownerSnap, planSnap, lessonSnap, leaseSnap, editSnap] = await Promise.all([
      tx.get(ownerRef),
      tx.get(planRef),
      tx.get(lessonRef),
      tx.get(leaseRef),
      tx.get(editRef),
    ]);
    if (!ownerSnap.exists || ownerSnap.data()?.ownerUid !== ownerUid) {
      throw new AiVisualError('not_owner', 'Solo il docente proprietario può modificare il piano.');
    }
    if (!planSnap.exists) throw new AiVisualMultiError('invalid_input', 'Il piano non esiste.');
    const current = validateVisualPlanRun(planSnap.data());
    if (!samePlanIdentity(current, ownerUid, input)) {
      throw new AiVisualMultiError('corrupted_state', 'Identità del piano divergente.');
    }
    const lesson = lessonSnap.exists ? (lessonSnap.data() as Record<string, unknown>) : null;
    const lessonGate = checkLessonForVisual({
      lesson,
      lessonId: input.lessonId,
      ownerUid,
      importId: input.importId,
    });
    if (!lessonGate.ok) {
      throw new AiVisualError('invalid_input', describeVisualBindingFailure(lessonGate.failure));
    }
    const publicRef = db.doc(`publicLessons/${lessonGate.publicLessonId}`);
    const publicSnap = await tx.get(publicRef);
    const projectionGate = checkProjectionForVisual({
      lesson: lesson as Record<string, unknown>,
      publicLesson: publicSnap.exists ? (publicSnap.data() as Record<string, unknown>) : null,
      programId: input.programId,
      importId: input.importId,
      ownerUid,
    });
    if (!projectionGate.ok) {
      throw new AiVisualError(
        'invalid_input',
        describeVisualBindingFailure(projectionGate.failure),
      );
    }
    if (sha256Hex(projectionGate.body) !== current.sourceBodyHash) {
      throw new AiVisualMultiError(
        'visual_plan_proposal_body_changed',
        'Il corpo della lezione è cambiato dopo la proposta.',
      );
    }

    if (editSnap.exists) {
      const stored = validateStoredVisualPlanSlotEdit(editSnap.data());
      if (
        stored.ownerUid !== ownerUid ||
        stored.opaquePlanId !== opaquePlanId ||
        stored.planHash !== current.planHash ||
        stored.slotIndex !== input.slotIndex ||
        stored.editRequestId !== input.editRequestId ||
        stored.inputHash !== inputHash
      ) {
        throw new AiVisualMultiError(
          'invalid_input',
          'editRequestId già usato con una modifica diversa.',
        );
      }
      return { replayed: true, plan: current };
    }

    if (!leaseSnap.exists)
      throw new AiVisualMultiError('corrupted_state', 'Lease del piano assente.');
    const lease = validateVisualPlanLease(leaseSnap.data());
    const leaseExpiry = timestampToMillis(lease.expireAt);
    const planExpiry = timestampToMillis(current.expireAt);
    if (
      lease.ownerUid !== ownerUid ||
      lease.opaquePlanId !== opaquePlanId ||
      lease.requestId !== current.requestId ||
      lease.programId !== current.programId ||
      lease.importId !== current.importId ||
      lease.lessonId !== current.lessonId ||
      leaseExpiry === null ||
      leaseExpiry <= nowMs ||
      planExpiry === null ||
      planExpiry <= nowMs
    ) {
      throw new AiVisualMultiError('visual_plan_expired', 'Il piano visivo è scaduto.');
    }
    if (!input.abandon) {
      resolveVisualAnchorForWrite(
        {
          anchorHeadingIndex: input.anchorHeadingIndex,
          anchorHeadingText: input.anchorHeadingText,
        },
        projectionGate.body,
      );
    }

    const nextBase = applyVisualPlanSlotEdit(current, input);
    const timestamp = Timestamp.fromMillis(nowMs);
    const next = validateVisualPlanRun({ ...nextBase, updatedAt: timestamp });

    // Un abbandono libera subito e soltanto la capacità del master reservation.
    // Una semplice correzione testuale non legge né scrive il ledger.
    if (input.abandon) {
      const canonicalLedgerRef = db.doc(
        `aiBudgetLedger/${current.budgetCeiling.reservationMonthKey}`,
      );
      const canonicalLedgerSnap = await tx.get(canonicalLedgerRef);
      if (!canonicalLedgerSnap.exists) {
        throw new AiVisualMultiError('corrupted_state', 'Ledger del piano assente.');
      }
      const rawLedger = canonicalLedgerSnap.data() as Record<string, unknown>;
      const ledger = readVisualPlanLedgerState(
        canonicalLedgerSnap,
        current.budgetCeiling.reservationMonthKey,
        ledgerLimit(rawLedger.budgetMicroUsd, 'budgetMicroUsd'),
        ledgerLimit(rawLedger.dailyBudgetMicroUsd, 'dailyBudgetMicroUsd'),
      );
      const master = ledger.reservations[current.budgetCeiling.reservationKey];
      if (
        !master ||
        master.status !== 'reserved' ||
        master.microUsd !== remainingGenerationReservation(current)
      ) {
        throw new AiVisualMultiError(
          'corrupted_state',
          'Prenotazione master del piano divergente.',
        );
      }
      let nextLedger = reconcile(ledger, current.budgetCeiling.reservationKey, 0, nowMs);
      const remaining = remainingGenerationReservation(next);
      if (remaining > 0) {
        const reserved = reserve(
          nextLedger,
          current.budgetCeiling.reservationKey,
          remaining,
          planExpiry,
          nowMs,
        );
        if (!reserved.ok) {
          throw new AiVisualMultiError('corrupted_state', 'Prenotazione residua non preservabile.');
        }
        nextLedger = reserved.state;
      }
      writeVisualPlanLedgerState(tx, canonicalLedgerRef, nextLedger);
    }

    const record: StoredVisualPlanSlotEdit = {
      contractVersion: 'visual-plan-slot-edit/v1',
      ownerUid,
      opaquePlanId,
      planHash: current.planHash,
      slotIndex: input.slotIndex,
      editRequestId: input.editRequestId,
      inputHash,
      outcome: input.abandon ? 'abandoned' : 'updated',
      createdAt: timestamp,
    };
    validateStoredVisualPlanSlotEdit(record);
    tx.set(planRef, next);
    tx.set(editRef, record);
    tx.set(auditRef, {
      actorUid: ownerUid,
      action: input.abandon ? 'lesson.visualPlanSlotAbandoned' : 'lesson.visualPlanSlotEdited',
      targetId: input.lessonId,
      outcome: 'success',
      reason: null,
      timestamp: FieldValue.serverTimestamp(),
    });
    if (next.status === 'abandoned') tx.delete(leaseRef);
    else tx.update(leaseRef, { updatedAt: timestamp });
    return { replayed: false, plan: next };
  });
}

const MULTI_CODES: Partial<Record<AiVisualMultiError['code'], FunctionsErrorCode>> = {
  invalid_input: 'invalid-argument',
  corrupted_state: 'data-loss',
  visual_plan_slot_not_generatable: 'failed-precondition',
  visual_plan_expired: 'failed-precondition',
  visual_plan_proposal_body_changed: 'failed-precondition',
  visual_promotion_anchor_stale: 'failed-precondition',
};

async function handle(request: CallableRequest<unknown>) {
  const db = database();
  try {
    const ownerUid = await requireOwner(request, db);
    const input = validateVisualPlanEditSlotInput(request.data);
    return await editVisualPlanSlotForOwner({ db, ownerUid, input });
  } catch (error) {
    if (error instanceof AiVisualMultiError) {
      throw new HttpsError(MULTI_CODES[error.code] ?? 'internal', error.message, {
        code: error.code,
      });
    }
    if (error instanceof AiVisualError) {
      const code: FunctionsErrorCode =
        error.code === 'unauthenticated'
          ? 'unauthenticated'
          : error.code === 'not_owner'
            ? 'permission-denied'
            : error.code === 'invalid_input'
              ? 'invalid-argument'
              : 'internal';
      throw new HttpsError(code, error.message, { code: error.code });
    }
    logger.error('aiVisualPlanEditSlot internal error', { name: (error as Error)?.name });
    throw new HttpsError('internal', 'Errore interno nella revisione dello slot.');
  }
}

export const aiVisualPlanEditSlot = onCall(OPTIONS, handle);
