/**
 * AIGEN-01-REVIEW-FIX-2 §3 — precondizioni **pure e fail-closed** della
 * transizione `reserved → pending` (`markProviderPending`). Isolate qui per
 * essere testate senza Firestore. La transizione avviene **solo** se tutte le
 * condizioni sono vere; qualunque incoerenza ⇒ `false` (e zero chiamate provider).
 */

import type { BudgetReservation } from './aiCorrectionBudget.js';
import type { StoredAiContentRun } from './aiContentEngine.js';

export interface MarkPendingCheck {
  run: StoredAiContentRun | null;
  reservation: BudgetReservation | undefined;
  executionId: string;
  nowMs: number;
}

/**
 * `true` **solo** se: il run esiste, è `running`, appartiene a `executionId`, la
 * lease è ancora valida; **e** la prenotazione esiste, è `reserved` (non già
 * `pending`) e il suo importo coincide con `reservedCostMicroUsd` del run.
 * Prenotazione assente, scaduta, già pending, di importo incoerente o run
 * malformato ⇒ `false`.
 */
export function canMarkProviderPending(check: MarkPendingCheck): boolean {
  const { run, reservation, executionId, nowMs } = check;
  if (!run) return false;
  if (run.status !== 'running') return false;
  if (run.leaseExecutionId !== executionId) return false;
  if (run.leaseExpiresAtMs <= nowMs) return false;
  if (!reservation) return false;
  // `status` assente nei documenti storici ⇒ trattato come `reserved`.
  const status = reservation.status ?? 'reserved';
  if (status !== 'reserved') return false;
  // La prenotazione non deve essere già scaduta (coerente con la lease valida).
  if (reservation.expiresAtMs <= nowMs) return false;
  if (reservation.microUsd !== run.reservedCostMicroUsd) return false;
  return true;
}
