/**
 * M5-05D1 — ledger di budget mensile della correzione IA, **logica pura**.
 *
 * Rappresenta un contatore mensile in **micro-USD interi** con prenotazioni
 * atomiche keyed by `requestId`. La transazione Firestore su un **singolo**
 * documento (`aiBudgetLedger/{YYYY-MM}`) serializza operazioni concorrenti, così
 * due run in parallelo non possono superare il budget disponibile.
 *
 * Recupero da crash/takeover: ogni prenotazione porta un `expiresAtMs`; le
 * prenotazioni scadute vengono **rilasciate automaticamente** alla lettura
 * successiva (nessun job esterno). La riconciliazione è **idempotente** su
 * `requestId`: sposta la prenotazione in `spent` con il costo effettivo e libera
 * l'eccedenza; ri-prenotare lo stesso `requestId` (retry/replay) **non** somma
 * due volte.
 *
 * Il wiring Firestore (transazione) è una porta iniettata; qui non ci sono
 * dipendenze da `firebase-admin`.
 */

export interface BudgetReservation {
  microUsd: number;
  expiresAtMs: number;
}

export interface BudgetLedgerState {
  monthKey: string;
  budgetMicroUsd: number;
  spentMicroUsd: number;
  reservations: Record<string, BudgetReservation>;
}

export type BudgetUtilizationState = 'ok' | 'warn50' | 'warn80' | 'exhausted';

/** Chiave mensile UTC `YYYY-MM` da un istante epoch-ms. */
export function monthKeyFromMs(nowMs: number): string {
  const d = new Date(nowMs);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

/** Ledger vuoto per un mese/budget. */
export function emptyLedger(monthKey: string, budgetMicroUsd: number): BudgetLedgerState {
  return { monthKey, budgetMicroUsd, spentMicroUsd: 0, reservations: {} };
}

/** Somma delle prenotazioni **non scadute**. */
export function activeReservedMicroUsd(state: BudgetLedgerState, nowMs: number): number {
  let total = 0;
  for (const r of Object.values(state.reservations)) {
    if (r.expiresAtMs > nowMs) total += r.microUsd;
  }
  return total;
}

/** Disponibilità residua = budget − spesa − prenotazioni attive (mai negativa). */
export function availableMicroUsd(state: BudgetLedgerState, nowMs: number): number {
  return Math.max(
    0,
    state.budgetMicroUsd - state.spentMicroUsd - activeReservedMicroUsd(state, nowMs),
  );
}

/** Stato di utilizzo (per metriche): soglie 50%/80%/100% su spesa+prenotato. */
export function utilizationState(state: BudgetLedgerState, nowMs: number): BudgetUtilizationState {
  if (state.budgetMicroUsd <= 0) return 'exhausted';
  const used = state.spentMicroUsd + activeReservedMicroUsd(state, nowMs);
  const ratio = used / state.budgetMicroUsd;
  if (ratio >= 1) return 'exhausted';
  if (ratio >= 0.8) return 'warn80';
  if (ratio >= 0.5) return 'warn50';
  return 'ok';
}

/** Copia lo stato rilasciando le prenotazioni scadute (recovery). */
function withoutExpired(state: BudgetLedgerState, nowMs: number): BudgetLedgerState {
  const reservations: Record<string, BudgetReservation> = {};
  for (const [id, r] of Object.entries(state.reservations)) {
    if (r.expiresAtMs > nowMs) reservations[id] = r;
  }
  return { ...state, reservations };
}

export type ReserveResult =
  | { ok: true; state: BudgetLedgerState; reservedMicroUsd: number }
  | { ok: false; reason: 'budget_exceeded' };

/**
 * Prenota atomicamente `amountMicroUsd` per `requestId`. Prima rilascia le
 * prenotazioni scadute (recovery). **Idempotente**: se esiste già una
 * prenotazione attiva per lo stesso `requestId` la riusa senza raddoppiare.
 * Rifiuta (`budget_exceeded`) se la disponibilità è insufficiente o il budget è
 * già esaurito (hard stop 100%).
 */
export function reserve(
  state: BudgetLedgerState,
  requestId: string,
  amountMicroUsd: number,
  expiresAtMs: number,
  nowMs: number,
): ReserveResult {
  const cleaned = withoutExpired(state, nowMs);
  const existing = cleaned.reservations[requestId];
  if (existing) {
    // Retry/replay dello stesso requestId: nessun doppio addebito.
    return { ok: true, state: cleaned, reservedMicroUsd: existing.microUsd };
  }
  if (amountMicroUsd <= 0) {
    // Nulla da prenotare (nessuna aperta): non tocca il ledger.
    return { ok: true, state: cleaned, reservedMicroUsd: 0 };
  }
  if (availableMicroUsd(cleaned, nowMs) < amountMicroUsd) {
    return { ok: false, reason: 'budget_exceeded' };
  }
  return {
    ok: true,
    reservedMicroUsd: amountMicroUsd,
    state: {
      ...cleaned,
      reservations: {
        ...cleaned.reservations,
        [requestId]: { microUsd: amountMicroUsd, expiresAtMs },
      },
    },
  };
}

/**
 * Riconcilia la prenotazione di `requestId` con il costo **effettivo**: rimuove
 * la prenotazione e somma `actualMicroUsd` alla spesa, liberando l'eccedenza.
 * Idempotente: se la prenotazione non esiste più (già riconciliata) lo stato non
 * cambia. `actualMicroUsd` è clampato a `>= 0`.
 */
export function reconcile(
  state: BudgetLedgerState,
  requestId: string,
  actualMicroUsd: number,
  nowMs: number,
): BudgetLedgerState {
  const cleaned = withoutExpired(state, nowMs);
  if (!cleaned.reservations[requestId]) return cleaned;
  const reservations = { ...cleaned.reservations };
  delete reservations[requestId];
  return {
    ...cleaned,
    reservations,
    spentMicroUsd: cleaned.spentMicroUsd + Math.max(0, Math.round(actualMicroUsd)),
  };
}
