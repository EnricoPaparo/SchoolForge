import { randomUUID } from 'node:crypto';
import { getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore';
import type { Firestore, Transaction } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import * as logger from 'firebase-functions/logger';
import { defineSecret } from 'firebase-functions/params';
import { onDocumentDeleted } from 'firebase-functions/v2/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import type { CallableRequest, FunctionsErrorCode } from 'firebase-functions/v2/https';
import {
  availableDailyMicroUsd,
  availableMicroUsd,
  dayKeyFromMs,
  emptyLedger,
  markPending as markPendingLedger,
  reconcile as reconcileLedger,
  reserve as reserveLedger,
  type BudgetLedgerState,
  type BudgetReservation,
  type ReservationStatus,
} from './aiCorrectionBudget.js';
import {
  MAX_DAILY_BUDGET_MICRO_USD,
  MAX_MONTHLY_BUDGET_MICRO_USD,
  MAX_OPERATION_COST_MICRO_USD,
  parseAiRuntimeConfig,
  type AiRuntimeConfig,
} from './aiCorrectionRuntimeConfig.js';
import {
  AiVisualError,
  resolveAiVisualMode,
  validateAiVisualRequest,
  type AiVisualMode,
} from './aiVisualCore.js';
import {
  generateVisual,
  previewVisual,
  type AiVisualPorts,
  type AiVisualRuntimeConfig,
  type VisualReserveOutcome,
} from './aiVisualEngine.js';
import { normalizeVisualWebp } from './aiVisualNormalizer.js';
import {
  createDeterministicMockImageProvider,
  createImageProvider,
  createOpenAiImageTransport,
} from './aiVisualProvider.js';
import { parseVisualRunDocument, serializeVisualRun } from './aiVisualRunDoc.js';
import { SCHOOLFORGE_FUNCTION_REGION } from './deploymentRegion.js';
import { DEFAULT_OPENAI_RETRY_POLICY } from './openAiGrader.js';
import { isStorageNotFound } from './repositoryGatewayCore.js';

/** Secret Firebase esistente. Il binding è presente solo su `aiVisualGenerate`. */
export const AI_VISUAL_OPENAI_API_KEY = defineSecret('OPENAI_API_KEY');

function database(): Firestore {
  if (getApps().length === 0) initializeApp();
  return getFirestore();
}

function visualMode(): AiVisualMode {
  return resolveAiVisualMode({ AI_VISUAL_MODE: process.env.AI_VISUAL_MODE });
}

async function requireOwner(request: CallableRequest<unknown>, db: Firestore): Promise<string> {
  const uid = request.auth?.uid;
  if (typeof uid !== 'string' || uid.length === 0) {
    throw new AiVisualError('unauthenticated', 'Autenticazione richiesta.');
  }
  const ownerSnap = await db.doc('settings/owner').get();
  const ownerUid = ownerSnap.exists ? ownerSnap.data()?.ownerUid : null;
  return authorizeVisualCaller(uid, ownerUid);
}

export function authorizeVisualCaller(uid: unknown, ownerUid: unknown): string {
  if (typeof uid !== 'string' || uid.length === 0) {
    throw new AiVisualError('unauthenticated', 'Autenticazione richiesta.');
  }
  if (typeof ownerUid !== 'string' || ownerUid !== uid) {
    throw new AiVisualError('not_owner', 'Accesso riservato al docente proprietario.');
  }
  return uid;
}

async function loadSharedRuntimeConfig(db: Firestore): Promise<AiRuntimeConfig | null> {
  const snap = await db.doc('settings/aiConfig').get();
  return snap.exists ? parseAiRuntimeConfig(snap.data()) : null;
}

function toVisualConfig(
  mode: AiVisualMode,
  config: AiRuntimeConfig | null,
): AiVisualRuntimeConfig | null {
  if (mode === 'mock') {
    return {
      enabled: true,
      maxOperationCostMicroUsd: MAX_OPERATION_COST_MICRO_USD,
      dailyBudgetMicroUsd: MAX_DAILY_BUDGET_MICRO_USD,
      monthlyBudgetMicroUsd: MAX_MONTHLY_BUDGET_MICRO_USD,
    };
  }
  if (mode !== 'openai' || !config?.enabled) return null;
  return {
    enabled: true,
    maxOperationCostMicroUsd: config.maxOperationCostMicroUsd,
    dailyBudgetMicroUsd: config.dailyBudgetMicroUsd,
    monthlyBudgetMicroUsd: config.monthlyBudgetMicroUsd,
  };
}

function readLedgerState(
  snap: FirebaseFirestore.DocumentSnapshot,
  monthKey: string,
  monthlyBudgetMicroUsd: number,
  dailyBudgetMicroUsd: number,
): BudgetLedgerState {
  if (!snap.exists) return emptyLedger(monthKey, monthlyBudgetMicroUsd, dailyBudgetMicroUsd);
  const data = snap.data() as Record<string, unknown>;
  const dailySpentMicroUsd: Record<string, number> = {};
  if (data.dailySpentMicroUsd && typeof data.dailySpentMicroUsd === 'object') {
    for (const [key, value] of Object.entries(data.dailySpentMicroUsd as Record<string, unknown>)) {
      if (typeof value === 'number' && Number.isInteger(value) && value >= 0) {
        dailySpentMicroUsd[key] = value;
      }
    }
  }
  const reservations: Record<string, BudgetReservation> = {};
  if (data.reservations && typeof data.reservations === 'object') {
    for (const [key, value] of Object.entries(data.reservations as Record<string, unknown>)) {
      if (!value || typeof value !== 'object') continue;
      const reservation = value as Record<string, unknown>;
      if (
        typeof reservation.microUsd === 'number' &&
        Number.isInteger(reservation.microUsd) &&
        reservation.microUsd >= 0 &&
        typeof reservation.expiresAtMs === 'number' &&
        Number.isInteger(reservation.expiresAtMs)
      ) {
        const status: ReservationStatus = reservation.status === 'pending' ? 'pending' : 'reserved';
        reservations[key] = {
          microUsd: reservation.microUsd,
          expiresAtMs: reservation.expiresAtMs,
          ...(typeof reservation.dayKey === 'string' ? { dayKey: reservation.dayKey } : {}),
          status,
        };
      }
    }
  }
  return {
    monthKey,
    budgetMicroUsd: monthlyBudgetMicroUsd,
    dailyBudgetMicroUsd,
    spentMicroUsd:
      typeof data.spentMicroUsd === 'number' && Number.isInteger(data.spentMicroUsd)
        ? Math.max(0, data.spentMicroUsd)
        : 0,
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

function createPorts(
  db: Firestore,
  mode: AiVisualMode,
  sharedConfig: AiRuntimeConfig | null,
): AiVisualPorts {
  const config = toVisualConfig(mode, sharedConfig);
  const mockProvider = createDeterministicMockImageProvider();

  async function settleRun(
    params: Parameters<AiVisualPorts['failRun']>[0] & {
      completedImage?: Parameters<AiVisualPorts['finalizeRun']>[0]['image'];
    },
  ): Promise<'finalized' | 'lost_lease'> {
    const runRef = db.doc(`visualRuns/${params.opaqueRunId}`);
    return db.runTransaction(async (tx): Promise<'finalized' | 'lost_lease'> => {
      const runSnap = await tx.get(runRef);
      if (!runSnap.exists) return 'lost_lease';
      const run = parseVisualRunDocument(runSnap.data(), params.opaqueRunId);
      if (!run || run.status !== 'pending' || run.leaseExecutionId !== params.executionId) {
        return 'lost_lease';
      }

      let nextLedger: {
        ref: FirebaseFirestore.DocumentReference;
        state: BudgetLedgerState;
      } | null = null;
      if (run.budget.reservedCostMicroUsd > 0) {
        if (!config) throw new Error('visual runtime config unavailable');
        const ledgerRef = db.doc(`aiBudgetLedger/${run.budget.monthKey}`);
        const ledgerSnap = await tx.get(ledgerRef);
        const state = readLedgerState(
          ledgerSnap,
          run.budget.monthKey,
          config.monthlyBudgetMicroUsd,
          config.dailyBudgetMicroUsd,
        );
        nextLedger = {
          ref: ledgerRef,
          state: reconcileLedger(
            state,
            run.budget.reservationKey,
            params.settledCostMicroUsd,
            params.nowMs,
          ),
        };
      }
      if (nextLedger) writeLedgerState(tx, nextLedger.ref, nextLedger.state);
      tx.update(runRef, {
        status: params.completedImage ? 'completed' : 'failed',
        image: params.completedImage ?? null,
        'budget.actualInputTokens': params.actualInputTokens,
        'budget.actualOutputTokens': params.actualOutputTokens,
        'budget.actualCostMicroUsd': params.actualCostMicroUsd,
        'budget.settledCostMicroUsd': params.settledCostMicroUsd,
        updatedAt: Timestamp.fromMillis(params.nowMs),
      });
      return 'finalized';
    });
  }

  return {
    async loadRuntimeConfig() {
      return config;
    },
    async readAvailableBudgetMicroUsd(runtimeConfig) {
      const nowMs = Date.now();
      const monthKey = new Date(nowMs).toISOString().slice(0, 7);
      const snap = await db.doc(`aiBudgetLedger/${monthKey}`).get();
      const state = readLedgerState(
        snap,
        monthKey,
        runtimeConfig.monthlyBudgetMicroUsd,
        runtimeConfig.dailyBudgetMicroUsd,
      );
      return Math.min(
        availableMicroUsd(state, nowMs),
        availableDailyMicroUsd(state, dayKeyFromMs(nowMs), nowMs),
      );
    },
    async reserveRunAndBudget(params): Promise<VisualReserveOutcome> {
      const runRef = db.doc(`visualRuns/${params.opaqueRunId}`);
      return db.runTransaction(async (tx): Promise<VisualReserveOutcome> => {
        const runSnap = await tx.get(runRef);
        if (runSnap.exists) {
          const existing = parseVisualRunDocument(runSnap.data(), params.opaqueRunId);
          if (!existing) return { kind: 'corrupted' };
          if (existing.inputHash !== params.run.inputHash) return { kind: 'conflict' };
          if (existing.status === 'completed' && existing.image) {
            return { kind: 'replay_completed', run: { ...existing, image: existing.image } };
          }
          if (existing.status === 'pending' || existing.status === 'failed') {
            return { kind: 'uncertain' };
          }
          if (existing.leaseExpiresAtMs > params.nowMs) return { kind: 'running' };
        }

        if (params.run.budget.reservedCostMicroUsd > 0) {
          if (!config) return { kind: 'budget', code: 'budget_unavailable' };
          const ledgerRef = db.doc(`aiBudgetLedger/${params.run.budget.monthKey}`);
          const ledgerSnap = await tx.get(ledgerRef);
          const state = readLedgerState(
            ledgerSnap,
            params.run.budget.monthKey,
            config.monthlyBudgetMicroUsd,
            config.dailyBudgetMicroUsd,
          );
          const reserved = reserveLedger(
            state,
            params.run.budget.reservationKey,
            params.run.budget.reservedCostMicroUsd,
            params.run.leaseExpiresAtMs,
            params.nowMs,
          );
          if (!reserved.ok) return { kind: 'budget', code: reserved.reason };
          writeLedgerState(tx, ledgerRef, reserved.state);
        }
        tx.set(runRef, serializeVisualRun(params.run));
        return { kind: 'reserved' };
      });
    },
    async markProviderPending(params) {
      const runRef = db.doc(`visualRuns/${params.opaqueRunId}`);
      return db.runTransaction(async (tx): Promise<boolean> => {
        const runSnap = await tx.get(runRef);
        if (!runSnap.exists) return false;
        const run = parseVisualRunDocument(runSnap.data(), params.opaqueRunId);
        if (
          !run ||
          run.status !== 'reserved' ||
          run.leaseExecutionId !== params.executionId ||
          run.leaseExpiresAtMs <= params.nowMs
        ) {
          return false;
        }
        if (run.budget.reservedCostMicroUsd > 0) {
          if (!config) return false;
          const ledgerRef = db.doc(`aiBudgetLedger/${run.budget.monthKey}`);
          const ledgerSnap = await tx.get(ledgerRef);
          const state = readLedgerState(
            ledgerSnap,
            run.budget.monthKey,
            config.monthlyBudgetMicroUsd,
            config.dailyBudgetMicroUsd,
          );
          const reservation = state.reservations[run.budget.reservationKey];
          if (
            !reservation ||
            reservation.status === 'pending' ||
            reservation.microUsd !== run.budget.reservedCostMicroUsd
          ) {
            return false;
          }
          writeLedgerState(
            tx,
            ledgerRef,
            markPendingLedger(state, run.budget.reservationKey, params.nowMs),
          );
        }
        tx.update(runRef, { status: 'pending', updatedAt: Timestamp.fromMillis(params.nowMs) });
        return true;
      });
    },
    async callProvider({ mode: selectedMode, subject }) {
      if (selectedMode === 'mock') return mockProvider.generate(subject);
      // L'unica lettura del secret è qui: mode/auth/payload/reserve/budget e
      // transizione pending sono già avvenuti. Mai all'import o in preview.
      let apiKey: string | undefined;
      try {
        apiKey = AI_VISUAL_OPENAI_API_KEY.value();
      } catch {
        apiKey = undefined;
      }
      if (!apiKey) return { status: 'pre_invocation' };
      const policy = sharedConfig
        ? {
            ...DEFAULT_OPENAI_RETRY_POLICY,
            maxRetries: Math.min(
              DEFAULT_OPENAI_RETRY_POLICY.maxRetries,
              sharedConfig.limits.maxApplicationRetries,
            ),
            attemptTimeoutMs: Math.min(
              DEFAULT_OPENAI_RETRY_POLICY.attemptTimeoutMs,
              sharedConfig.limits.attemptTimeoutMs,
            ),
          }
        : DEFAULT_OPENAI_RETRY_POLICY;
      return createImageProvider(createOpenAiImageTransport(apiKey), { policy }).generate(subject);
    },
    normalize: normalizeVisualWebp,
    async uploadStaging({ stagingRef, bytes, sha256 }) {
      await getStorage()
        .bucket()
        .file(stagingRef)
        .save(bytes, {
          resumable: false,
          preconditionOpts: { ifGenerationMatch: 0 },
          metadata: {
            contentType: 'image/webp',
            cacheControl: 'private,no-store',
            metadata: { sha256 },
          },
        });
    },
    async finalizeRun(params) {
      return settleRun({ ...params, completedImage: params.image });
    },
    async failRun(params) {
      await settleRun(params);
    },
  };
}

const ERROR_MAP: Partial<Record<AiVisualError['code'], FunctionsErrorCode>> = {
  unauthenticated: 'unauthenticated',
  not_owner: 'permission-denied',
  feature_disabled: 'failed-precondition',
  invalid_input: 'invalid-argument',
  running: 'aborted',
  run_conflict: 'invalid-argument',
  corrupted_state: 'data-loss',
  uncertain_state: 'aborted',
  operation_budget_exceeded: 'resource-exhausted',
  budget_exceeded: 'resource-exhausted',
  daily_budget_exceeded: 'resource-exhausted',
  budget_unavailable: 'unavailable',
  provider_config_invalid: 'failed-precondition',
  provider_unavailable: 'unavailable',
  provider_invalid_response: 'data-loss',
  provider_billed_unusable: 'data-loss',
  visual_invalid_format: 'data-loss',
  visual_corrupted: 'data-loss',
  visual_too_large: 'resource-exhausted',
  staging_failed: 'unavailable',
  internal: 'internal',
};

function toHttpsError(error: AiVisualError): HttpsError {
  return new HttpsError(ERROR_MAP[error.code] ?? 'internal', error.message, { code: error.code });
}

async function handleVisualRequest(
  request: CallableRequest<unknown>,
  operation: 'preview' | 'generate',
): Promise<unknown> {
  const db = database();
  const mode = visualMode();
  try {
    const ownerUid = await requireOwner(request, db);
    if (mode === 'disabled') {
      throw new AiVisualError('feature_disabled', 'La generazione visuale è disattivata.');
    }
    const validated = validateAiVisualRequest(request.data);
    const sharedConfig = await loadSharedRuntimeConfig(db);
    const ports = createPorts(db, mode, sharedConfig);
    const context = {
      authenticatedOwnerUid: ownerUid,
      mode,
      executionId: randomUUID(),
      nowMs: Date.now(),
    };
    return operation === 'preview'
      ? await previewVisual(validated, context, ports)
      : await generateVisual(validated, context, ports);
  } catch (error) {
    if (error instanceof AiVisualError) throw toHttpsError(error);
    logger.error(`aiVisual${operation === 'preview' ? 'Preview' : 'Generate'} internal error`, {
      name: (error as Error)?.name,
    });
    throw new HttpsError('internal', 'Errore interno della generazione visuale.');
  }
}

/** Preview read-only: nessun secret binding, nessuna scrittura e nessun provider. */
export const aiVisualPreview = onCall({ region: SCHOOLFORGE_FUNCTION_REGION }, (request) =>
  handleVisualRequest(request, 'preview'),
);

/** Generazione reale: unica callable con binding del secret Firebase esistente. */
export const aiVisualGenerate = onCall(
  { region: SCHOOLFORGE_FUNCTION_REGION, secrets: [AI_VISUAL_OPENAI_API_KEY] },
  (request) => handleVisualRequest(request, 'generate'),
);

export async function cleanupDeletedVisualRun(params: {
  opaqueRunId: string;
  data: unknown;
  deleteObject: (stagingRef: string) => Promise<void>;
}): Promise<'deleted' | 'not_found' | 'skipped'> {
  const run = parseVisualRunDocument(params.data, params.opaqueRunId);
  if (!run) return 'skipped';
  try {
    await params.deleteObject(run.stagingRef);
    return 'deleted';
  } catch (error) {
    if (isStorageNotFound(error)) return 'not_found';
    throw error;
  }
}

/** TTL delete → rimozione idempotente del solo oggetto staging esatto del run. */
export const visualRunCleanup = onDocumentDeleted(
  {
    document: 'visualRuns/{opaqueRunId}',
    region: SCHOOLFORGE_FUNCTION_REGION,
    retry: true,
  },
  async (event) => {
    const snapshot = event.data;
    if (!snapshot) return;
    const result = await cleanupDeletedVisualRun({
      opaqueRunId: event.params.opaqueRunId,
      data: snapshot.data(),
      deleteObject: async (stagingRef) => {
        await getStorage().bucket().file(stagingRef).delete();
      },
    });
    logger.info('visual_run_cleanup', { result });
  },
);
