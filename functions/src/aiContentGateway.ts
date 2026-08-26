/**
 * AIGEN-01 — wiring runtime dei callable di generazione contenuti. Monta il
 * motore puro `aiContentEngine` sull'Admin SDK: due Cloud Functions v2 `onCall`
 * scale-to-zero, `aiContentPreview` (nessun secret/provider/prenotazione/scrittura)
 * e `aiContentGenerate` (ordine fail-closed completo).
 *
 * Feature switch **dedicato** `AI_CONTENT_MODE` (disabled|mock|openai), distinto da
 * `AI_CORRECTION_MODE`: la correzione IA resta invariata. Riuso: `settings/owner`,
 * `settings/aiConfig` (kill switch), `aiBudgetLedger/{mese}`, profili/listini/costo,
 * transport Responses API + retry. Nuova collection server-only
 * `aiContentRuns/{opaqueRunId}` (mai leggibile dal client — Rules). Nessuna API
 * key, chiamata reale o deploy in questa PR.
 */

import { randomUUID } from 'node:crypto';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import type { CallableRequest, FunctionsErrorCode } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import { defineSecret } from 'firebase-functions/params';
import { SCHOOLFORGE_FUNCTION_REGION } from './deploymentRegion.js';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import type { Firestore, Transaction } from 'firebase-admin/firestore';
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
import {
  AiContentError,
  assertGenericAiContentCallableKind,
  resolveAiContentMode,
  validateAiContentRequest,
  type AiContentMode,
} from './aiContentCore.js';
import {
  computeContentLeaseTtlMs,
  generateContent,
  previewContent,
  type AiContentPorts,
  type ReserveOutcome,
} from './aiContentEngine.js';
import { selectContentProvider } from './aiContentProvider.js';
import { canMarkProviderPending } from './aiContentPending.js';
import { parseStoredRunDocument, serializeRun } from './aiContentRunDoc.js';
import { DEFAULT_OPENAI_RETRY_POLICY } from './openAiGrader.js';
import type { RetryPolicy } from './openAiRetryPolicy.js';

export const OPENAI_API_KEY = defineSecret('OPENAI_API_KEY');

function db(): Firestore {
  if (getApps().length === 0) initializeApp();
  return getFirestore();
}

async function loadOwnerUid(database: Firestore): Promise<string | null> {
  const snap = await database.doc('settings/owner').get();
  return snap.exists ? ((snap.data()?.ownerUid as string | undefined) ?? null) : null;
}

/** Esportata per MULTI-VISUAL-03A: stesso documento `settings/aiConfig`, nessun secondo percorso. */
export async function loadRuntimeConfig(database: Firestore): Promise<AiRuntimeConfig | null> {
  const snap = await database.doc('settings/aiConfig').get();
  return snap.exists ? parseAiRuntimeConfig(snap.data()) : null;
}

/**
 * Policy retry dalla config runtime validata (ceiling DEV: retry ≤ 1, timeout
 * ≤ 60 s). Esportata per MULTI-VISUAL-03A: la lease TTL della chiamata
 * interna `generateContent` per `visual_plan_proposal` deve derivare dalla
 * stessa policy delle altre fasi testuali, non da un valore proprio.
 */
export function retryPolicyFromConfig(config: AiRuntimeConfig | null): RetryPolicy {
  if (!config) return DEFAULT_OPENAI_RETRY_POLICY;
  return {
    ...DEFAULT_OPENAI_RETRY_POLICY,
    maxRetries: Math.max(
      0,
      Math.min(DEFAULT_OPENAI_RETRY_POLICY.maxRetries, config.limits.maxApplicationRetries),
    ),
    attemptTimeoutMs: Math.max(
      1,
      Math.min(DEFAULT_OPENAI_RETRY_POLICY.attemptTimeoutMs, config.limits.attemptTimeoutMs),
    ),
  };
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

// ── Porte concrete (Admin SDK) ────────────────────────────────────────────────

/**
 * Esportata per MULTI-VISUAL-03A (`aiVisualPlanGateway.ts`): la proposta
 * coordinata (`kind: 'visual_plan_proposal'`) invoca `generateContent`
 * internamente, dopo aver già creato il piano/lease/prenotazione — le stesse
 * porte concrete del motore generico, non una seconda fabbrica.
 */
export function createPorts(
  database: Firestore,
  config: AiRuntimeConfig | null,
  mode: AiContentMode,
  secret: string | undefined,
  withProvider: boolean,
): AiContentPorts {
  const policy = retryPolicyFromConfig(config);
  // Il provider è costruito **solo** per il percorso generate (`withProvider`), mai
  // per la preview: `selectContentProvider` ritorna `null` in preview e non tocca
  // il secret. In generate mode openai senza secret/transport →
  // provider_config_invalid **prima** di reserve/lease/rete.
  const provider = selectContentProvider({
    mode,
    withProvider,
    openAiApiKey: secret,
    runnerDeps: { policy },
  });

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
      return snap.exists ? parseStoredRunDocument(snap.data()) : null;
    },
    async reserveRunAndBudget(params): Promise<ReserveOutcome> {
      if (!config) return { kind: 'budget', code: 'budget_unavailable' };
      const monthKey = monthKeyFromMs(params.nowMs);
      const runRef = database.doc(`aiContentRuns/${params.opaqueRunId}`);
      const ledgerRef = database.doc(`aiBudgetLedger/${monthKey}`);
      return database.runTransaction(async (tx): Promise<ReserveOutcome> => {
        const [runSnap, ledgerSnap] = await Promise.all([tx.get(runRef), tx.get(ledgerRef)]);
        if (runSnap.exists) {
          const existing = parseStoredRunDocument(runSnap.data());
          // Documento malformato/legacy/incoerente → conflict (mai replay).
          if (!existing) return { kind: 'conflict' };
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
        // Prenotazione **reserved** (NON pending): markPending avviene subito
        // prima del provider, in una transazione separata gated dalla lease.
        const reserved = reserveLedger(
          state,
          params.budgetReservationKey,
          params.reserveMicroUsd,
          params.expiresAtMs,
          params.nowMs,
        );
        if (!reserved.ok) return { kind: 'budget', code: reserved.reason };
        writeLedgerState(tx, ledgerRef, reserved.state);
        tx.set(runRef, serializeRun(params.run));
        return { kind: 'reserved', reservedMicroUsd: reserved.reservedMicroUsd };
      });
    },
    async markProviderPending(params): Promise<boolean> {
      const monthKey = monthKeyFromMs(params.nowMs);
      const runRef = database.doc(`aiContentRuns/${params.opaqueRunId}`);
      const ledgerRef = database.doc(`aiBudgetLedger/${monthKey}`);
      return database.runTransaction(async (tx): Promise<boolean> => {
        const runSnap = await tx.get(runRef);
        if (!runSnap.exists) return false;
        const run = parseStoredRunDocument(runSnap.data());
        const ledgerSnap = await tx.get(ledgerRef);
        const state = readLedgerState(
          ledgerSnap,
          monthKey,
          config?.monthlyBudgetMicroUsd ?? 0,
          config?.dailyBudgetMicroUsd ?? 0,
        );
        // Precondizioni **fail-closed** (helper puro): run running+lease+executionId
        // e prenotazione esistente, `reserved`, di importo coerente. Qualunque
        // incoerenza ⇒ nessuna transizione, `false` → il provider non è chiamato.
        if (
          !canMarkProviderPending({
            run,
            reservation: state.reservations[params.budgetReservationKey],
            executionId: params.executionId,
            nowMs: params.nowMs,
          })
        ) {
          return false;
        }
        writeLedgerState(
          tx,
          ledgerRef,
          markPendingLedger(state, params.budgetReservationKey, params.nowMs),
        );
        return true;
      });
    },
    async callProvider({ request, model }) {
      if (!provider) {
        throw new AiContentError('feature_disabled', 'La generazione IA è disattivata.');
      }
      return provider.generate(request, model);
    },
    async finalizeRun(params) {
      const monthKey = monthKeyFromMs(params.nowMs);
      const runRef = database.doc(`aiContentRuns/${params.opaqueRunId}`);
      const ledgerRef = database.doc(`aiBudgetLedger/${monthKey}`);
      return database.runTransaction(async (tx): Promise<'finalized' | 'lost_lease'> => {
        const [runSnap, ledgerSnap] = await Promise.all([tx.get(runRef), tx.get(ledgerRef)]);
        if (!runSnap.exists) return 'lost_lease';
        const run = parseStoredRunDocument(runSnap.data());
        if (!run || run.leaseExecutionId !== params.executionId) return 'lost_lease';
        const state = readLedgerState(
          ledgerSnap,
          monthKey,
          config?.monthlyBudgetMicroUsd ?? 0,
          config?.dailyBudgetMicroUsd ?? 0,
        );
        writeLedgerState(
          tx,
          ledgerRef,
          reconcileLedger(state, params.budgetReservationKey, params.settledMicroUsd, params.nowMs),
        );
        tx.set(
          runRef,
          {
            status: 'completed',
            output: params.output,
            actualInputTokens: params.actualInputTokens,
            actualOutputTokens: params.actualOutputTokens,
            actualCostMicroUsd: params.actualCostMicroUsd,
            settledCostMicroUsd: params.settledMicroUsd,
            updatedAt: Timestamp.fromMillis(params.nowMs),
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
        const run = parseStoredRunDocument(runSnap.data());
        if (!run || run.leaseExecutionId !== params.executionId) return;
        const state = readLedgerState(
          ledgerSnap,
          monthKey,
          config?.monthlyBudgetMicroUsd ?? 0,
          config?.dailyBudgetMicroUsd ?? 0,
        );
        writeLedgerState(
          tx,
          ledgerRef,
          reconcileLedger(state, params.budgetReservationKey, params.settledMicroUsd, params.nowMs),
        );
        tx.set(
          runRef,
          {
            status: 'failed',
            actualInputTokens: params.actualInputTokens,
            actualOutputTokens: params.actualOutputTokens,
            actualCostMicroUsd: params.actualCostMicroUsd,
            settledCostMicroUsd: params.settledMicroUsd,
            updatedAt: Timestamp.fromMillis(params.nowMs),
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
  output_incomplete: 'resource-exhausted',
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

function contentMode(): AiContentMode {
  return resolveAiContentMode({ AI_CONTENT_MODE: process.env.AI_CONTENT_MODE });
}

function readOpenAiSecret(): string | undefined {
  try {
    return OPENAI_API_KEY.value();
  } catch {
    return undefined;
  }
}

/**
 * `aiContentPreview` — stima senza secret/provider/prenotazione/scrittura.
 * **Nessun** binding del secret: la preview non ha accesso alla API key.
 */
export const aiContentPreview = onCall({ region: SCHOOLFORGE_FUNCTION_REGION }, async (request) => {
  const database = db();
  const mode = contentMode();
  try {
    // Ordine contratto: auth → owner → mode/kill switch → payload. Un anonimo
    // riceve `unauthenticated` prima di `feature_disabled`.
    const ownerUid = await requireOwner(request, database);
    if (mode === 'disabled') {
      throw new AiContentError('feature_disabled', 'La generazione IA è disattivata.');
    }
    const validated = validateAiContentRequest(request.data);
    assertGenericAiContentCallableKind(validated);
    const config = await loadRuntimeConfig(database);
    // La preview non costruisce il provider né legge il secret (withProvider=false).
    const ports = createPorts(database, config, mode, undefined, false);
    return await previewContent(
      validated,
      {
        authenticatedOwnerUid: ownerUid,
        nowMs: Date.now(),
        executionId: randomUUID(),
        mode,
        leaseMs: computeContentLeaseTtlMs(retryPolicyFromConfig(config)),
      },
      ports,
    );
  } catch (err) {
    if (err instanceof AiContentError) throw toHttpsError(err);
    logger.error('aiContentPreview internal error', { name: (err as Error)?.name });
    throw new HttpsError('internal', 'Errore interno della generazione IA.');
  }
});

/** `aiContentGenerate` — ordine fail-closed completo. Una sola generazione logica. */
export const aiContentGenerate = onCall(
  { region: SCHOOLFORGE_FUNCTION_REGION, secrets: [OPENAI_API_KEY] },
  async (request) => {
    const database = db();
    const mode = contentMode();
    try {
      // Ordine contratto: auth → owner → mode/kill switch → payload.
      const ownerUid = await requireOwner(request, database);
      if (mode === 'disabled') {
        throw new AiContentError('feature_disabled', 'La generazione IA è disattivata.');
      }
      const validated = validateAiContentRequest(request.data);
      assertGenericAiContentCallableKind(validated);
      const config = await loadRuntimeConfig(database);
      // Il secret è letto **solo** qui (percorso generate) e **solo** in mode openai.
      const secret = mode === 'openai' ? readOpenAiSecret() : undefined;
      const ports = createPorts(database, config, mode, secret, true);
      return await generateContent(
        validated,
        {
          authenticatedOwnerUid: ownerUid,
          nowMs: Date.now(),
          executionId: randomUUID(),
          mode,
          leaseMs: computeContentLeaseTtlMs(retryPolicyFromConfig(config)),
        },
        ports,
      );
    } catch (err) {
      if (err instanceof AiContentError) throw toHttpsError(err);
      logger.error('aiContentGenerate internal error', { name: (err as Error)?.name });
      throw new HttpsError('internal', 'Errore interno della generazione IA.');
    }
  },
);
