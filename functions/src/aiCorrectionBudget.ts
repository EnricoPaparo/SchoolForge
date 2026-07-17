/**
 * M5-05D1 / M5-05D2B-1 / M5-05E-1 — ledger mensile con aggregati giornalieri
 * UTC della correzione IA, **logica pura**.
 *
 * Contatori mensile e giornalieri in **micro-USD interi** con prenotazioni
 * atomiche keyed by `requestId`. La transazione Firestore su un **singolo** documento
 * (`aiBudgetLedger/{YYYY-MM}`) serializza le operazioni concorrenti, così due run
 * in parallelo non possono superare il budget disponibile.
 *
 * **Macchina a stati crash-safe (M5-05D2B-1).** Ogni prenotazione ha uno
 * `status`:
 * - `reserved`: prenotata ma il provider **non** è ancora stato invocato. Una
 *   `reserved` **scaduta** è recuperabile: viene rilasciata (nessun costo).
 * - `pending`: il provider **può** essere stato invocato (costo potenzialmente
 *   già sostenuto). Una `pending` **non** viene mai liberata silenziosamente: se
 *   scade (crash prima della riconciliazione) viene **addebitata al tetto
 *   prenotato** (conservativo: in dubbio si sovrastima, mai si sottocontabilizza).
 *
 * La riconciliazione è **idempotente** su `requestId`: rimuove la prenotazione e
 * addebita il costo **effettivo** (≤ tetto), liberando l'eccedenza. Ri-prenotare
 * lo stesso `requestId` (retry/replay) **non** somma due volte.
 *
 * Nessuno scheduler/polling: il settlement delle prenotazioni scadute avviene
 * alla lettura successiva, dentro la stessa transazione di reserve/reconcile. Il
 * wiring Firestore è una porta iniettata; qui nessuna dipendenza `firebase-admin`.
 * Il ledger contiene **solo** importi tecnici e prenotazioni per `requestId`
 * opaco: nessun ID/UID/PII/contenuto.
 */

/** Stato della prenotazione (default storico: `reserved`). */
export type ReservationStatus = 'reserved' | 'pending';

export interface BudgetReservation {
  microUsd: number;
  expiresAtMs: number;
  /** Giorno UTC `YYYY-MM-DD` fissato alla prenotazione. Assente solo nei legacy. */
  dayKey?: string;
  /** Assente ⇒ trattata come `reserved` (compatibilità coi documenti storici). */
  status?: ReservationStatus;
}

export interface BudgetLedgerState {
  monthKey: string;
  budgetMicroUsd: number;
  dailyBudgetMicroUsd: number;
  spentMicroUsd: number;
  /** Spesa riconciliata per giorno UTC; nessun contenuto o identificativo utente. */
  dailySpentMicroUsd: Record<string, number>;
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

/** Chiave giornaliera UTC `YYYY-MM-DD` da un istante epoch-ms. */
export function dayKeyFromMs(nowMs: number): string {
  const d = new Date(nowMs);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Bucket prudenziale per importi legacy dei quali non è ricostruibile il giorno. */
export const LEGACY_UNKNOWN_DAY_KEY = 'legacy-unknown';

/** Ledger vuoto per un mese/budget. */
export function emptyLedger(
  monthKey: string,
  budgetMicroUsd: number,
  dailyBudgetMicroUsd = budgetMicroUsd,
): BudgetLedgerState {
  return {
    monthKey,
    budgetMicroUsd,
    dailyBudgetMicroUsd,
    spentMicroUsd: 0,
    dailySpentMicroUsd: {},
    reservations: {},
  };
}

/**
 * Una prenotazione **trattiene** budget se è ancora attiva (non scaduta) **oppure**
 * è `pending` (il provider può aver generato costo): una `pending` scaduta continua
 * a trattenere finché non è addebitata al `spent` dal settlement.
 */
function isHeld(r: BudgetReservation, nowMs: number): boolean {
  return r.status === 'pending' || r.expiresAtMs > nowMs;
}

/** Somma delle prenotazioni che **trattengono** budget (attive o `pending`). */
export function activeReservedMicroUsd(state: BudgetLedgerState, nowMs: number): number {
  let total = 0;
  for (const r of Object.values(state.reservations)) {
    if (isHeld(r, nowMs)) total += r.microUsd;
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

/** Prenotazioni che gravano sul giorno richiesto; i legacy senza dayKey gravano su tutti. */
export function activeReservedDailyMicroUsd(
  state: BudgetLedgerState,
  dayKey: string,
  nowMs: number,
): number {
  let total = 0;
  for (const r of Object.values(state.reservations)) {
    if (isHeld(r, nowMs) && (r.dayKey === undefined || r.dayKey === dayKey)) total += r.microUsd;
  }
  return total;
}

/** Disponibilità giornaliera UTC, includendo spesa, pending e reserved attive. */
export function availableDailyMicroUsd(
  state: BudgetLedgerState,
  dayKey: string,
  nowMs: number,
): number {
  const spent =
    (state.dailySpentMicroUsd[dayKey] ?? 0) +
    (state.dailySpentMicroUsd[LEGACY_UNKNOWN_DAY_KEY] ?? 0);
  return Math.max(
    0,
    state.dailyBudgetMicroUsd - spent - activeReservedDailyMicroUsd(state, dayKey, nowMs),
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

/**
 * **Settlement** delle prenotazioni scadute (recovery, nessuno scheduler):
 * - `reserved` scaduta → **rilasciata** (mai arrivata al provider, nessun costo);
 * - `pending` scaduta → **addebitata al tetto prenotato** in `spent` (il provider
 *   può aver generato costo e un crash ha impedito la riconciliazione: si
 *   sovrastima, mai si sottocontabilizza);
 * - non scaduta → invariata.
 * Applicato **prima** di ogni reserve/markPending/reconcile.
 */
function settleExpired(state: BudgetLedgerState, nowMs: number): BudgetLedgerState {
  const reservations: Record<string, BudgetReservation> = {};
  let spentMicroUsd = state.spentMicroUsd;
  const dailySpentMicroUsd = { ...state.dailySpentMicroUsd };
  for (const [id, r] of Object.entries(state.reservations)) {
    if (r.expiresAtMs > nowMs) {
      reservations[id] = r; // ancora attiva
    } else if (r.status === 'pending') {
      spentMicroUsd += r.microUsd; // crash dopo il provider → addebita il tetto
      const dayKey = r.dayKey ?? LEGACY_UNKNOWN_DAY_KEY;
      dailySpentMicroUsd[dayKey] = (dailySpentMicroUsd[dayKey] ?? 0) + r.microUsd;
    }
    // else: `reserved` scaduta → rilasciata (nessun costo)
  }
  return { ...state, spentMicroUsd, dailySpentMicroUsd, reservations };
}

export type ReserveResult =
  | { ok: true; state: BudgetLedgerState; reservedMicroUsd: number }
  | { ok: false; reason: 'daily_budget_exceeded' | 'budget_exceeded' };

/**
 * Prenota atomicamente `amountMicroUsd` (tetto **conservativo**) per `requestId`
 * come `reserved`. Prima esegue il settlement delle scadute. **Idempotente**: se
 * esiste già una prenotazione per lo stesso `requestId` la riusa senza
 * raddoppiare (ne conserva lo `status`). Rifiuta (`budget_exceeded`) se la
 * disponibilità è insufficiente o il budget è già esaurito (hard stop 100%).
 */
export function reserve(
  state: BudgetLedgerState,
  requestId: string,
  amountMicroUsd: number,
  expiresAtMs: number,
  nowMs: number,
  dayKey = dayKeyFromMs(nowMs),
): ReserveResult {
  const cleaned = settleExpired(state, nowMs);
  const existing = cleaned.reservations[requestId];
  if (existing) {
    // Retry/replay dello stesso requestId: nessun doppio addebito.
    return { ok: true, state: cleaned, reservedMicroUsd: existing.microUsd };
  }
  if (amountMicroUsd <= 0) {
    // Nulla da prenotare (nessuna aperta): non tocca il ledger.
    return { ok: true, state: cleaned, reservedMicroUsd: 0 };
  }
  if (availableDailyMicroUsd(cleaned, dayKey, nowMs) < amountMicroUsd) {
    return { ok: false, reason: 'daily_budget_exceeded' };
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
        [requestId]: { microUsd: amountMicroUsd, expiresAtMs, dayKey, status: 'reserved' },
      },
    },
  };
}

/**
 * Transizione `reserved → pending` per `requestId`, da eseguire **subito prima**
 * della prima chiamata provider: da qui in poi la prenotazione non è più
 * liberabile per scadenza (una scadenza la addebiterà al tetto). Idempotente e
 * no-op se la prenotazione non esiste più.
 */
export function markPending(
  state: BudgetLedgerState,
  requestId: string,
  nowMs: number,
): BudgetLedgerState {
  const cleaned = settleExpired(state, nowMs);
  const existing = cleaned.reservations[requestId];
  if (!existing) return cleaned;
  return {
    ...cleaned,
    reservations: { ...cleaned.reservations, [requestId]: { ...existing, status: 'pending' } },
  };
}

/**
 * Riconcilia la prenotazione di `requestId` con il costo **effettivo**: rimuove
 * la prenotazione e somma `actualMicroUsd` (≤ tetto) alla spesa, liberando
 * l'eccedenza. Idempotente: se la prenotazione non esiste più (già riconciliata o
 * già addebitata per scadenza) lo stato non cambia. `actualMicroUsd` è clampato a
 * `>= 0`.
 */
export function reconcile(
  state: BudgetLedgerState,
  requestId: string,
  actualMicroUsd: number,
  nowMs: number,
): BudgetLedgerState {
  const cleaned = settleExpired(state, nowMs);
  const reservation = cleaned.reservations[requestId];
  if (!reservation) return cleaned;
  const reservations = { ...cleaned.reservations };
  delete reservations[requestId];
  const settled = Math.max(0, Math.round(actualMicroUsd));
  const dayKey = reservation.dayKey ?? LEGACY_UNKNOWN_DAY_KEY;
  return {
    ...cleaned,
    reservations,
    spentMicroUsd: cleaned.spentMicroUsd + settled,
    dailySpentMicroUsd: {
      ...cleaned.dailySpentMicroUsd,
      [dayKey]: (cleaned.dailySpentMicroUsd[dayKey] ?? 0) + settled,
    },
  };
}
