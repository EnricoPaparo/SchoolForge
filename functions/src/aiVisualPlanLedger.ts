import { Timestamp } from 'firebase-admin/firestore';
import type { Transaction } from 'firebase-admin/firestore';
import {
  emptyLedger,
  reconcile,
  type BudgetLedgerState,
  type BudgetReservation,
} from './aiCorrectionBudget.js';
import type { VisualPlanRun } from './aiVisualMultiPlan.js';

/** Adapter condiviso dello schema `aiBudgetLedger` per i piani visuali. */
export function readVisualPlanLedgerState(
  snap: FirebaseFirestore.DocumentSnapshot,
  monthKey: string,
  budgetMicroUsd: number,
  dailyBudgetMicroUsd: number,
): BudgetLedgerState {
  if (!snap.exists) return emptyLedger(monthKey, budgetMicroUsd, dailyBudgetMicroUsd);
  const data = snap.data() as Record<string, unknown>;
  const spentMicroUsd = typeof data.spentMicroUsd === 'number' ? data.spentMicroUsd : 0;
  const dailySpentMicroUsd: Record<string, number> = {};
  if (data.dailySpentMicroUsd && typeof data.dailySpentMicroUsd === 'object') {
    for (const [dayKey, value] of Object.entries(
      data.dailySpentMicroUsd as Record<string, unknown>,
    )) {
      if (typeof value === 'number' && Number.isInteger(value) && value >= 0) {
        dailySpentMicroUsd[dayKey] = value;
      }
    }
  }
  const reservations: Record<string, BudgetReservation> = {};
  const raw = data.reservations;
  if (raw && typeof raw === 'object') {
    for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
      const reservation = value as {
        microUsd?: unknown;
        expiresAtMs?: unknown;
        dayKey?: unknown;
        status?: unknown;
      };
      if (
        typeof reservation?.microUsd === 'number' &&
        typeof reservation?.expiresAtMs === 'number'
      ) {
        reservations[id] = {
          microUsd: reservation.microUsd,
          expiresAtMs: reservation.expiresAtMs,
          ...(typeof reservation.dayKey === 'string' ? { dayKey: reservation.dayKey } : {}),
          status: reservation.status === 'pending' ? 'pending' : 'reserved',
        };
      }
    }
  }
  return {
    monthKey,
    budgetMicroUsd,
    dailyBudgetMicroUsd,
    spentMicroUsd,
    dailySpentMicroUsd,
    reservations,
  };
}

export function writeVisualPlanLedgerState(
  tx: Transaction,
  ref: FirebaseFirestore.DocumentReference,
  state: BudgetLedgerState,
): void {
  tx.set(ref, {
    monthKey: state.monthKey,
    budgetMicroUsd: state.budgetMicroUsd,
    dailyBudgetMicroUsd: state.dailyBudgetMicroUsd,
    spentMicroUsd: state.spentMicroUsd,
    dailySpentMicroUsd: state.dailySpentMicroUsd,
    reservations: state.reservations,
    updatedAt: Timestamp.now(),
  });
}

/** Chiude la master reservation senza addebitare slot mai invocati. */
export function closeVisualPlanReservation(
  state: BudgetLedgerState,
  plan: VisualPlanRun,
  nowMs: number,
): BudgetLedgerState {
  const reservationKey = plan.budgetCeiling.reservationKey;
  const reservation = state.reservations[reservationKey];
  if (!reservation) return state;
  const pending = reservation.status === 'pending';
  const reconciliationNowMs = pending
    ? Math.min(nowMs, Math.max(0, reservation.expiresAtMs - 1))
    : nowMs;
  return reconcile(
    state,
    reservationKey,
    pending ? plan.budgetCeiling.proposalCap : 0,
    reconciliationNowMs,
  );
}
