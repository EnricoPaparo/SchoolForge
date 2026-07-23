/**
 * AIGEN-01 — wiring runtime dei callable di generazione contenuti. Monta il
 * motore puro `aiContentEngine` sull'Admin SDK: due Cloud Functions v2 `onCall`
 * scale-to-zero, `aiContentPreview` (nessun provider/prenotazione/scrittura) e
 * `aiContentGenerate` (ordine fail-closed completo).
 *
 * Riuso: `settings/owner` (owner singleton), `settings/aiConfig` (kill switch),
 * `aiBudgetLedger/{mese}` (budget), profili/listini/costo. Nuova collection
 * server-only `aiContentRuns/{opaqueRunId}` (mai leggibile dal client — Rules).
 * Nessuna API key, chiamata reale o deploy in questa PR.
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import type { CallableRequest, FunctionsErrorCode } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import { defineSecret } from 'firebase-functions/params';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import type { Firestore, Transaction } from 'firebase-admin/firestore';
import { resolveAiFeatureMode } from './aiCorrectionGatewayCore.js';
import { parseAiRuntimeConfig, type AiRuntimeConfig } from './aiCorrectionRuntimeConfig.js';
import {
  availableMicroUsd,
  emptyLedger,
  markPending as markPendingLedger,
  monthKeyFromMs,
  reconcile as reconcileLedger,
  reserve as reserveLedger,
  type BudgetLedgerState,
  type BudgetReservation,
  type ReservationStatus,
} from './aiCorrectionBudget.js';
import { AiContentError, validateAiContentRequest } from './aiContentCore.js';
import {
  generateContent,
  previewContent,
  type AiContentPorts,
  type ReserveOutcome,
  type StoredAiContentRun,
} from './aiContentEngine.js';
import { createContentProvider, type ContentProviderMode } from './aiContentProvider.js';

export const OPENAI_API_KEY = defineSecret('OPENAI_API_KEY');

function db(): Firestore {
  if (getApps().length === 0) initializeApp();
  return getFirestore();
}

async function loadOwnerUid(database: Firestore): Promise<string | null> {
  const snap = await database.doc('settings/owner').get();
  return snap.exists ? ((snap.data()?.ownerUid as string | undefined) ?? null) : null;
}

async function loadRuntimeConfig(database: Firestore): Promise<AiRuntimeConfig | null> {
  const snap = await database.doc('settings/aiConfig').get();
  return snap.exists ? parseAiRuntimeConfig(snap.data()) : null;
}

// ── Ledger helpers (adapter Admin SDK, stessi del gateway correzione) ─────────

function readLedgerState(
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
      const r = value as {
        microUsd?: unknown;
        expiresAtMs?: unknown;
        dayKey?: unknown;
        status?: unknown;
      };
      if (typeof r?.microUsd === 'number' && typeof r?.expiresAtMs === 'number') {
        const status: ReservationStatus = r.status === 'pending' ? 'pending' : 'reserved';
        reservations[id] = {
          microUsd: r.microUsd,
          expiresAtMs: r.expiresAtMs,
          ...(typeof r.dayKey === 'string' ? { dayKey: r.dayKey } : {}),
          status,
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

function writeLedgerState(
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
    updatedAt: FieldValue.serverTimestamp(),
  });
}

function toStoredRun(data: Record<string, unknown>): StoredAiContentRun {
  return data as unknown as StoredAiContentRun;
}

// ── Porte concrete (Admin SDK) ────────────────────────────────────────────────

function createPorts(database: Firestore, config: AiRuntimeConfig | null): AiContentPorts {
  const providerMode: ContentProviderMode = ((): ContentProviderMode => {
    const mode = resolveAiFeatureMode({ AI_CORRECTION_MODE: process.env.AI_CORRECTION_MODE });
    return mode === 'openai' ? 'openai' : mode === 'mock' ? 'mock' : 'disabled';
  })();

  return {
    async loadRuntimeConfig() {
      return config;
    },
    async readAvailableBudgetMicroUsd() {
      if (!config) return null;
      const monthKey = monthKeyFromMs(Date.now());
      const snap = await database.doc(`aiBudgetLedger/${monthKey}`).get();
      const state = readLedgerState(
        snap,
        monthKey,
        config.monthlyBudgetMicroUsd,
        config.dailyBudgetMicroUsd,
      );
      return availableMicroUsd(state, Date.now());
    },
    async loadRun(opaqueRunId) {
      const snap = await database.doc(`aiContentRuns/${opaqueRunId}`).get();
      return snap.exists ? toStoredRun(snap.data() as Record<string, unknown>) : null;
    },
    async reserveRunAndBudget(params): Promise<ReserveOutcome> {
      if (!config) return { kind: 'budget', code: 'budget_unavailable' };
      const monthKey = monthKeyFromMs(params.nowMs);
      const runRef = database.doc(`aiContentRuns/${params.opaqueRunId}`);
      const ledgerRef = database.doc(`aiBudgetLedger/${monthKey}`);
      return database.runTransaction(async (tx): Promise<ReserveOutcome> => {
        const [runSnap, ledgerSnap] = await Promise.all([tx.get(runRef), tx.get(ledgerRef)]);
        if (runSnap.exists) {
          const existing = toStoredRun(runSnap.data() as Record<string, unknown>);
          if (existing.inputHash !== params.inputHash) return { kind: 'conflict' };
          if (existing.status === 'completed') return { kind: 'replay_completed', run: existing };
          if (existing.status === 'running' && existing.leaseExpiresAtMs > params.nowMs) {
            return { kind: 'running' };
          }
          // failed o lease scaduta → takeover consentito.
        }
        const state = readLedgerState(
          ledgerSnap,
          monthKey,
          config.monthlyBudgetMicroUsd,
          config.dailyBudgetMicroUsd,
        );
        const reserved = reserveLedger(
          state,
          params.budgetReservationKey,
          params.reserveMicroUsd,
          params.expiresAtMs,
          params.nowMs,
        );
        if (!reserved.ok) return { kind: 'budget', code: reserved.reason };
        // Prenotazione + markPending (il provider verrà chiamato subito dopo): una
        // scadenza addebiterà comunque il tetto, mai un doppio addebito.
        const pending = markPendingLedger(
          reserved.state,
          params.budgetReservationKey,
          params.nowMs,
        );
        writeLedgerState(tx, ledgerRef, pending);
        tx.set(runRef, { ...params.run });
        return { kind: 'reserved', reservedMicroUsd: reserved.reservedMicroUsd };
      });
    },
    async callProvider({ request, model }) {
      const provider = createContentProvider({ mode: providerMode });
      return provider.generate(request, model);
    },
    async finalizeRun(params) {
      const monthKey = monthKeyFromMs(params.nowMs);
      const runRef = database.doc(`aiContentRuns/${params.opaqueRunId}`);
      const ledgerRef = database.doc(`aiBudgetLedger/${monthKey}`);
      return database.runTransaction(async (tx): Promise<'finalized' | 'lost_lease'> => {
        const [runSnap, ledgerSnap] = await Promise.all([tx.get(runRef), tx.get(ledgerRef)]);
        if (!runSnap.exists) return 'lost_lease';
        const run = toStoredRun(runSnap.data() as Record<string, unknown>);
        if (run.leaseExecutionId !== params.executionId) return 'lost_lease';
        const state = readLedgerState(
          ledgerSnap,
          monthKey,
          config?.monthlyBudgetMicroUsd ?? 0,
          config?.dailyBudgetMicroUsd ?? 0,
        );
        writeLedgerState(
          tx,
          ledgerRef,
          reconcileLedger(
            state,
            params.budgetReservationKey,
            params.actualCostMicroUsd,
            params.nowMs,
          ),
        );
        tx.set(
          runRef,
          {
            status: 'completed',
            output: params.output,
            actualInputTokens: params.actualInputTokens,
            actualOutputTokens: params.actualOutputTokens,
            actualCostMicroUsd: params.actualCostMicroUsd,
            updatedAtMs: params.nowMs,
          },
          { merge: true },
        );
        return 'finalized';
      });
    },
    async failRun(params) {
      const monthKey = monthKeyFromMs(params.nowMs);
      const runRef = database.doc(`aiContentRuns/${params.opaqueRunId}`);
      const ledgerRef = database.doc(`aiBudgetLedger/${monthKey}`);
      await database.runTransaction(async (tx) => {
        const [runSnap, ledgerSnap] = await Promise.all([tx.get(runRef), tx.get(ledgerRef)]);
        if (!runSnap.exists) return;
        const run = toStoredRun(runSnap.data() as Record<string, unknown>);
        if (run.leaseExecutionId !== params.executionId) return;
        const state = readLedgerState(
          ledgerSnap,
          monthKey,
          config?.monthlyBudgetMicroUsd ?? 0,
          config?.dailyBudgetMicroUsd ?? 0,
        );
        writeLedgerState(
          tx,
          ledgerRef,
          reconcileLedger(
            state,
            params.budgetReservationKey,
            params.actualCostMicroUsd,
            params.nowMs,
          ),
        );
        tx.set(
          runRef,
          {
            status: 'failed',
            actualCostMicroUsd: params.actualCostMicroUsd,
            updatedAtMs: params.nowMs,
          },
          { merge: true },
        );
      });
    },
  };
}

// ── Errori → HttpsError (mai raw provider error o contenuto sensibile) ─────────

const ERROR_MAP: Record<string, FunctionsErrorCode> = {
  unauthenticated: 'unauthenticated',
  not_owner: 'permission-denied',
  feature_disabled: 'failed-precondition',
  invalid_input: 'invalid-argument',
  content_too_large: 'invalid-argument',
  limit_exceeded: 'resource-exhausted',
  operation_budget_exceeded: 'resource-exhausted',
  budget_exceeded: 'resource-exhausted',
  daily_budget_exceeded: 'resource-exhausted',
  budget_unavailable: 'unavailable',
  running: 'aborted',
  run_conflict: 'invalid-argument',
  provider_config_invalid: 'failed-precondition',
  provider_unavailable: 'unavailable',
  provider_invalid_output: 'internal',
  output_too_large: 'resource-exhausted',
  internal: 'internal',
};

function toHttpsError(err: AiContentError): HttpsError {
  return new HttpsError(ERROR_MAP[err.code] ?? 'internal', err.message, { code: err.code });
}

async function requireOwner(
  request: CallableRequest<unknown>,
  database: Firestore,
): Promise<string> {
  const uid = request.auth?.uid;
  if (!uid) throw new AiContentError('unauthenticated', 'Autenticazione richiesta.');
  const owner = await loadOwnerUid(database);
  if (!owner || owner !== uid)
    throw new AiContentError('not_owner', 'Accesso riservato al docente proprietario.');
  return uid;
}

function newExecutionId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** `aiContentPreview` — stima senza provider/prenotazione/scrittura. */
export const aiContentPreview = onCall({ secrets: [OPENAI_API_KEY] }, async (request) => {
  const database = db();
  try {
    const ownerUid = await requireOwner(request, database);
    const validated = validateAiContentRequest(request.data);
    const config = await loadRuntimeConfig(database);
    const ports = createPorts(database, config);
    const result = await previewContent(
      validated,
      { authenticatedOwnerUid: ownerUid, nowMs: Date.now(), executionId: newExecutionId() },
      ports,
    );
    return result;
  } catch (err) {
    if (err instanceof AiContentError) throw toHttpsError(err);
    logger.error('aiContentPreview internal error', { name: (err as Error)?.name });
    throw new HttpsError('internal', 'Errore interno della generazione IA.');
  }
});

/** `aiContentGenerate` — ordine fail-closed completo. Una sola generazione logica. */
export const aiContentGenerate = onCall({ secrets: [OPENAI_API_KEY] }, async (request) => {
  const database = db();
  try {
    const ownerUid = await requireOwner(request, database);
    const validated = validateAiContentRequest(request.data);
    const config = await loadRuntimeConfig(database);
    const ports = createPorts(database, config);
    const result = await generateContent(
      validated,
      { authenticatedOwnerUid: ownerUid, nowMs: Date.now(), executionId: newExecutionId() },
      ports,
    );
    return result;
  } catch (err) {
    if (err instanceof AiContentError) throw toHttpsError(err);
    logger.error('aiContentGenerate internal error', { name: (err as Error)?.name });
    throw new HttpsError('internal', 'Errore interno della generazione IA.');
  }
});
