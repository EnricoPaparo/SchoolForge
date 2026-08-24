import { randomUUID } from 'node:crypto';
import { getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore';
import type { DocumentReference, Firestore, Transaction } from 'firebase-admin/firestore';
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
  computeVisualRunId,
  inspectWebp,
  resolveAiVisualMode,
  validateAiVisualRequest,
  type AiVisualMode,
} from './aiVisualCore.js';
import {
  VISUAL_CANDIDATE_TTL_MS,
  checkVisualCandidate,
  computeSourceBodyHash,
  describeCandidateCheckFailure,
  describeCandidateConflict,
  parseStoredVisualCandidate,
  reconcileVisualCandidateBind,
  serializeVisualCandidate,
  validateVisualCandidateBindInput,
  type StoredVisualCandidate,
} from './aiVisualCandidate.js';
import {
  canonicalVisualStorageRef,
  composePublicLessonVisual,
  projectLessonVisual,
  validateLessonVisualPublicManifest,
  validatePublicLessonVisualDoc,
  validateLessonVisualPrivateManifest,
  type LessonVisualPrivateManifest,
} from './aiVisualManifest.js';
import {
  abandonedVisualRunId,
  lifecycleFingerprint,
  validateAbandonVisualInput,
  validateCanonicalLessonVisual,
  validateDeleteVisualArtifactsInput,
  validateRemoveLessonVisualInput,
  validateSetLessonCompletedInput,
  visualRemovalId,
  type LessonLifecycleInput,
} from './aiVisualLifecycle.js';
import {
  assertStagedBytesMatchRun,
  buildPromotionPlan,
  composePrivateManifest,
  computePromotionInputHash,
  parseStoredVisualPromotion,
  reconcileVisualPromotion,
  resolveAnchorByIndex,
  validateVisualPromotionInput,
  visualFingerprint,
  type PromotableRunImage,
  type StoredVisualPromotion,
  type VisualPromotionInput,
  type VisualPromotionPlan,
} from './aiVisualPromotion.js';
import {
  MAX_VISUAL_EXPORT_TOTAL_BYTES,
  serializeVisualManifestForExport,
  validateVisualExportInput,
  type VisualExportItem,
  type VisualExportResult,
} from './aiVisualExport.js';
import {
  composeReanchoredManifest,
  isSameAnchor,
  validateVisualReanchorInput,
} from './aiVisualReanchor.js';
import {
  checkLessonForVisual,
  checkProjectionForVisual,
  describeVisualBindingFailure,
} from './aiVisualLessonBinding.js';
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
import { isStorageNotFound, type BucketLike } from './repositoryGatewayCore.js';

/** Secret Firebase esistente. Il binding è presente solo su `aiVisualGenerate`. */
export const AI_VISUAL_OPENAI_API_KEY = defineSecret('OPENAI_API_KEY');

/**
 * Cloud Run deve accettare il trasporto delle callable Firebase; la vera
 * autorizzazione resta owner-only in `requireOwner`, all'inizio degli handler.
 */
const VISUAL_CALLABLE_OPTIONS = {
  region: SCHOOLFORGE_FUNCTION_REGION,
  invoker: 'public' as const,
};

/** Collezioni server-only: nessuna regola le apre in scrittura al client. */
const VISUAL_CANDIDATES = 'aiVisualCandidates';
const VISUAL_PROMOTIONS = 'aiVisualPromotions';
const PUBLIC_LESSON_VISUALS = 'publicLessonVisuals';
const VISUAL_REMOVALS = 'aiVisualRemovals';
const VISUAL_ABANDONMENTS = 'aiVisualAbandonments';

function lessonPath(programId: string, importId: string, lessonId: string): string {
  return `programs/${programId}/imports/${importId}/lessons/${lessonId}`;
}

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

export function createVisualPorts(
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
    async requireCandidateTicket({ opaqueRunId, ownerUid, nowMs }) {
      const snap = await db.doc(`${VISUAL_CANDIDATES}/${opaqueRunId}`).get();
      const candidate = parseStoredVisualCandidate(snap.exists ? snap.data() : null);
      const check = checkVisualCandidate({ candidate, ownerUid, nowMs });
      if (!check.ok) {
        throw new AiVisualError('invalid_input', describeCandidateCheckFailure(check.reason));
      }
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
    const ports = createVisualPorts(db, mode, sharedConfig);
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
export const aiVisualPreview = onCall(VISUAL_CALLABLE_OPTIONS, (request) =>
  handleVisualRequest(request, 'preview'),
);

/** Generazione reale: unica callable con binding del secret Firebase esistente. */
export const aiVisualGenerate = onCall(
  { ...VISUAL_CALLABLE_OPTIONS, secrets: [AI_VISUAL_OPENAI_API_KEY] },
  (request) => handleVisualRequest(request, 'generate'),
);

// ─── VE-03A — bind del candidato alla lezione ────────────────────────────────

/**
 * Legge la lezione e la sua proiezione, verifica che siano coerenti fra loro, e
 * restituisce i soli valori **autorevoli**: id pubblico, UDA, corpo salvato e
 * stato di svolgimento.
 *
 * Le due letture sono sequenziali di proposito. L'indirizzo della proiezione non
 * è quello ricevuto dal chiamante ma quello **derivato** dal documento tecnico,
 * quindi non può essere calcolato prima di aver letto il primo documento: un
 * `getAll` parallelo richiederebbe di fidarsi di un id che è esattamente ciò che
 * questo cancello rifiuta di considerare autorevole.
 */
async function readAuthoritativeLesson(
  db: Firestore,
  params: { ownerUid: string; programId: string; importId: string; lessonId: string },
): Promise<{
  publicLessonId: string;
  udaDir: string;
  body: string;
  completed: boolean;
}> {
  const { ownerUid, programId, importId, lessonId } = params;
  const lessonSnap = await db.doc(lessonPath(programId, importId, lessonId)).get();
  const lesson = lessonSnap.exists ? (lessonSnap.data() as Record<string, unknown>) : null;
  const gate = checkLessonForVisual({ lesson, lessonId, ownerUid, importId });
  if (!gate.ok) {
    throw new AiVisualError('invalid_input', describeVisualBindingFailure(gate.failure));
  }

  const publicSnap = await db.doc(`publicLessons/${gate.publicLessonId}`).get();
  const projectionGate = checkProjectionForVisual({
    lesson: lesson as Record<string, unknown>,
    publicLesson: publicSnap.exists ? (publicSnap.data() as Record<string, unknown>) : null,
    programId,
    importId,
    ownerUid,
  });
  if (!projectionGate.ok) {
    throw new AiVisualError('invalid_input', describeVisualBindingFailure(projectionGate.failure));
  }
  return {
    publicLessonId: gate.publicLessonId,
    udaDir: gate.udaDir,
    body: projectionGate.body,
    completed: projectionGate.completed,
  };
}

/**
 * Lega un `requestId` alla lezione da cui la proposta nasce.
 *
 * Estratta dall'handler come le altre operazioni di VE-03 — promozione,
 * lifecycle, export — così l'intero ciclo di vita è pilotabile da una suite
 * end-to-end senza passare da `onCall`, e la callable resta un guscio di
 * autenticazione e traduzione degli errori.
 */
export async function bindVisualCandidateForOwner(params: {
  db: Firestore;
  ownerUid: string;
  input: ReturnType<typeof validateVisualCandidateBindInput>;
  nowMs: number;
}): Promise<{ requestId: string; status: 'created' | 'replayed' }> {
  const { db, ownerUid, input, nowMs } = params;
  const lesson = await readAuthoritativeLesson(db, { ownerUid, ...input });

  const opaqueRunId = computeVisualRunId(ownerUid, input.requestId);
  const next: StoredVisualCandidate = {
    contractVersion: 1,
    ownerUid,
    programId: input.programId,
    importId: input.importId,
    lessonId: input.lessonId,
    publicLessonId: lesson.publicLessonId,
    udaDir: lesson.udaDir,
    // Il corpo non viene conservato: solo la sua impronta, che serve a
    // confrontare e non a leggere.
    sourceBodyHash: computeSourceBodyHash(lesson.body),
    createdAtMs: nowMs,
    expireAtMs: nowMs + VISUAL_CANDIDATE_TTL_MS,
  };

  const ref = db.doc(`${VISUAL_CANDIDATES}/${opaqueRunId}`);
  const abandonmentRef = db.doc(`${VISUAL_ABANDONMENTS}/${opaqueRunId}`);
  const outcome = await db.runTransaction(async (tx) => {
    const [abandonmentSnap, snap] = await Promise.all([tx.get(abandonmentRef), tx.get(ref)]);
    if (abandonmentSnap.exists) {
      throw new AiVisualError('run_conflict', 'Il candidato visuale è stato abbandonato.');
    }
    const existing = parseStoredVisualCandidate(snap.exists ? snap.data() : null);
    const result = reconcileVisualCandidateBind({ existing, next });
    if (result.status === 'created') tx.set(ref, serializeVisualCandidate(result.candidate));
    return result;
  });
  if (outcome.status === 'conflict') {
    throw new AiVisualError('run_conflict', describeCandidateConflict(outcome.reason));
  }
  // Nient'altro esce di qui: né l'impronta del corpo, né l'id pubblico, né il
  // run id opaco. Il client sa soltanto che può procedere.
  return { requestId: input.requestId, status: outcome.status };
}

async function handleBindCandidate(request: CallableRequest<unknown>): Promise<unknown> {
  const db = database();
  try {
    const ownerUid = await requireOwner(request, db);
    if (visualMode() === 'disabled') {
      throw new AiVisualError('feature_disabled', 'La generazione visuale è disattivata.');
    }
    return await bindVisualCandidateForOwner({
      db,
      ownerUid,
      input: validateVisualCandidateBindInput(request.data),
      nowMs: Date.now(),
    });
  } catch (error) {
    if (error instanceof AiVisualError) throw toHttpsError(error);
    logger.error('aiVisualBindCandidate internal error', { name: (error as Error)?.name });
    throw new HttpsError('internal', 'Errore interno della preparazione visuale.');
  }
}

/**
 * Prepara un candidato: lega `requestId` a una lezione **prima** che l'immagine
 * esista. Nessun secret, nessun provider, nessuna spesa.
 */
export const aiVisualBindCandidate = onCall(VISUAL_CALLABLE_OPTIONS, handleBindCandidate);

// ─── VE-03A — promozione del candidato approvato ─────────────────────────────

/** 412: la precondizione «solo se non esiste» non è stata soddisfatta. */
export function isStoragePreconditionFailed(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 412;
}

/**
 * Le verifiche che legano lo stato **osservato** della lezione al ticket.
 *
 * Vive in un solo posto perché viene eseguita due volte — nel preflight e
 * dentro la transazione — e due copie divergerebbero: è esattamente il tipo di
 * controllo che si indebolisce per distrazione nella copia che conta.
 */
function assertPromotableAgainstCandidate(params: {
  observed: { publicLessonId: string; udaDir: string; body: string; completed: boolean };
  candidate: StoredVisualCandidate;
}): void {
  const { observed, candidate } = params;
  if (
    observed.publicLessonId !== candidate.publicLessonId ||
    observed.udaDir !== candidate.udaDir
  ) {
    throw new AiVisualError('invalid_input', describeCandidateCheckFailure('target'));
  }
  // Il corpo è cambiato dopo la preparazione: errore tipizzato, zero scritture
  // persistenti, staging intatto fino al TTL cleanup.
  if (computeSourceBodyHash(observed.body) !== candidate.sourceBodyHash) {
    throw new AiVisualError('invalid_input', describeCandidateCheckFailure('source_body'));
  }
}

/**
 * L'ordine delle operazioni è la garanzia, e vale la pena dirlo dove il codice
 * lo esegue:
 *
 * 1. **preflight** — ticket, lezione, proiezione, corpo invariato, run
 *    completato, byte staged identici a quelli del run;
 * 2. **copia** in Storage nella posizione canonica, con precondizione di
 *    creazione: se quel percorso esiste già la copia fallisce invece di
 *    sovrascrivere;
 * 3. **transazione** Firestore: **tutte le letture prima di ogni scrittura**,
 *    e ogni verifica del preflight rifatta sullo stato fresco;
 * 4. **pulizia** — staging e blob superato, solo dopo il commit.
 *
 * **Il preflight non è la verifica: è un filtro.** Serve a non pagare copia e
 * transazione per una richiesta già insensata. Ciò che *decide* è la
 * transazione, dove lo stato viene riletto e ricontrollato da capo — corpo
 * pubblico compreso, che è il punto in cui una modifica concorrente
 * assocerebbe altrimenti l'immagine a un testo diverso da quello che il
 * docente ha visto.
 *
 * Fra 2 e 3 un crash lascia un blob orfano che nessuno referenzia: recuperabile.
 * L'ordine inverso lascerebbe una proiezione che punta a byte inesistenti, cioè
 * un'immagine rotta in faccia allo studente. Fra 3 e 4 un crash lascia uno
 * staging che il TTL cleanup rimuove da sé.
 */
export async function promoteVisualForOwner(params: {
  db: Firestore;
  bucket: BucketLike;
  ownerUid: string;
  input: VisualPromotionInput;
  nowMs: number;
  /** Iniettabile per determinismo nei test; in produzione è `randomUUID`. */
  generateAssetId?: () => string;
  /**
   * Punto di iniezione fra preflight e transazione. Esiste per una ragione
   * sola: una corsa non si dimostra sperando che due scritture si incrocino,
   * si dimostra provocandola in quel punto esatto. In produzione è assente.
   */
  beforeTransaction?: () => Promise<void>;
}): Promise<{ requestId: string; replayed: boolean; assetId: string }> {
  const { db, bucket, ownerUid, input, nowMs } = params;
  const generateAssetId = params.generateAssetId ?? randomUUID;
  const opaqueRunId = computeVisualRunId(ownerUid, input.requestId);
  const inputHash = computePromotionInputHash(input);

  // Replay prima di tutto: una risposta persa dopo il commit non deve
  // produrre un secondo asset, un secondo audit e una seconda copia.
  const promotionRef = db.doc(`${VISUAL_PROMOTIONS}/${opaqueRunId}`);
  const promotionSnap = await promotionRef.get();
  if (promotionSnap.exists) {
    const storedPromotion = parseStoredVisualPromotion(promotionSnap.data());
    if (!storedPromotion) {
      // Il documento c'è ma non si sa che cosa dica: non è «fresh» e non è un
      // replay. Trattarlo come assente creerebbe un secondo asset per un
      // requestId già promosso.
      throw new AiVisualError('corrupted_state', 'Registro di approvazione non leggibile.');
    }
    const replay = reconcileVisualPromotion({ existing: storedPromotion, ownerUid, inputHash });
    if (replay.status === 'replayed') {
      return { requestId: input.requestId, replayed: true, assetId: replay.assetId };
    }
    if (replay.status === 'conflict') {
      throw new AiVisualError(
        'run_conflict',
        'Lo stesso identificativo è già stato approvato con dati diversi.',
      );
    }
  }

  const candidateSnap = await db.doc(`${VISUAL_CANDIDATES}/${opaqueRunId}`).get();
  const candidateCheck = checkVisualCandidate({
    candidate: parseStoredVisualCandidate(candidateSnap.exists ? candidateSnap.data() : null),
    ownerUid,
    nowMs,
    expectedTarget: {
      programId: input.programId,
      importId: input.importId,
      lessonId: input.lessonId,
    },
  });
  if (!candidateCheck.ok) {
    throw new AiVisualError('invalid_input', describeCandidateCheckFailure(candidateCheck.reason));
  }
  const candidate = candidateCheck.candidate;

  const lessonRef = db.doc(lessonPath(input.programId, input.importId, input.lessonId));

  // ── Preflight: filtro, non verifica. ────────────────────────────────────────
  const preflight = await readAuthoritativeLesson(db, {
    ownerUid,
    programId: input.programId,
    importId: input.importId,
    lessonId: input.lessonId,
  });
  assertPromotableAgainstCandidate({ observed: preflight, candidate });

  const preflightVisual = visualFingerprint((await lessonRef.get()).data()?.visual);

  const runSnap = await db.doc(`visualRuns/${opaqueRunId}`).get();
  const run = parseVisualRunDocument(runSnap.exists ? runSnap.data() : null, opaqueRunId);
  if (!run || run.status !== 'completed' || !run.image) {
    throw new AiVisualError('invalid_input', 'Il candidato non è stato generato con successo.');
  }
  const image: PromotableRunImage = {
    sha256: run.image.sha256,
    byteLength: run.image.byteLength,
    width: run.image.width,
    height: run.image.height,
    mimeType: run.image.mimeType,
    styleVersion: run.image.styleVersion as PromotableRunImage['styleVersion'],
  };

  let staged: Uint8Array;
  try {
    [staged] = await bucket.file(run.stagingRef).download();
  } catch (error) {
    if (isStorageNotFound(error)) {
      throw new AiVisualError('invalid_input', 'Il candidato non è più disponibile: rigeneralo.');
    }
    throw error;
  }
  assertStagedBytesMatchRun({ bytes: staged, image, inspect: inspectWebp });

  const assetId = generateAssetId();
  const approvedAt = Timestamp.fromMillis(nowMs);
  // Composto qui solo per conoscere il percorso canonico da occupare: il
  // manifest che verrà scritto è quello ricomposto sullo stato fresco.
  const plannedStorageRef = composePrivateManifest({
    assetId,
    candidate,
    image,
    anchor: resolveAnchorByIndex({
      lessonBody: preflight.body,
      anchorHeadingIndex: input.anchorHeadingIndex,
      anchorHeadingText: input.anchorHeadingText,
    }),
    caption: input.caption,
    altText: input.altText,
    approvedAt,
  }).storageRef;

  // ── Copia, prima del commit e senza mai sovrascrivere. ──────────────────────
  //
  // `ifGenerationMatch: 0` significa «solo se non esiste». Una collisione di
  // percorso non deve poter cancellare byte di qualcun altro, e poiché la copia
  // precede la transazione un suo fallimento lascia Firestore intatto per
  // costruzione: zero scritture, e l'oggetto preesistente resta dov'era.
  try {
    await bucket.file(plannedStorageRef).save(Buffer.from(staged), {
      resumable: false,
      preconditionOpts: { ifGenerationMatch: 0 },
      metadata: {
        contentType: 'image/webp',
        cacheControl: 'private,no-store',
        metadata: { sha256: image.sha256 },
      },
    });
  } catch (error) {
    if (isStoragePreconditionFailed(error)) {
      throw new AiVisualError(
        'corrupted_state',
        'La posizione dell’immagine è già occupata: riprova l’approvazione.',
      );
    }
    throw error;
  }

  if (params.beforeTransaction) await params.beforeTransaction();

  // ── Transazione: rileggere tutto, poi — e solo poi — scrivere. ──────────────
  const auditRef = db.collection('auditEvents').doc();
  const plan = await db.runTransaction(async (tx): Promise<VisualPromotionPlan> => {
    // (1) registro di approvazione.
    const freshPromotion = await tx.get(promotionRef);
    if (freshPromotion.exists) throw new AiVisualError('running', 'Approvazione già in corso.');

    // (2) documento tecnico.
    const freshLessonSnap = await tx.get(lessonRef);
    const freshLesson = freshLessonSnap.exists
      ? (freshLessonSnap.data() as Record<string, unknown>)
      : null;
    const lessonGate = checkLessonForVisual({
      lesson: freshLesson,
      lessonId: input.lessonId,
      ownerUid,
      importId: input.importId,
    });
    if (!lessonGate.ok) {
      throw new AiVisualError('invalid_input', describeVisualBindingFailure(lessonGate.failure));
    }

    // (3) proiezione, all'id **riderivato** dal documento appena letto: mai
    //     quello osservato nel preflight, che nel frattempo poteva cambiare.
    const freshPublicRef = db.doc(`publicLessons/${lessonGate.publicLessonId}`);
    const freshPublicSnap = await tx.get(freshPublicRef);
    const projectionGate = checkProjectionForVisual({
      lesson: freshLesson as Record<string, unknown>,
      publicLesson: freshPublicSnap.exists
        ? (freshPublicSnap.data() as Record<string, unknown>)
        : null,
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

    // Letture finite. Da qui in poi solo verifiche pure e scritture.
    const fresh = {
      publicLessonId: lessonGate.publicLessonId,
      udaDir: lessonGate.udaDir,
      body: projectionGate.body,
      completed: projectionGate.completed,
    };
    assertPromotableAgainstCandidate({ observed: fresh, candidate });

    // Un'altra promozione è passata fra il preflight e adesso: fermarsi. Il
    // manifest appena approvato dall'altra non va sovrascritto, e il blob che
    // *questa* operazione credeva di sostituire non è più quello vero — quindi
    // non si cancella niente. Resta al massimo un blob nuovo non referenziato.
    if (visualFingerprint(freshLesson?.visual) !== preflightVisual) {
      throw new AiVisualError(
        'uncertain_state',
        'Un’altra approvazione è avvenuta nel frattempo: riprova.',
      );
    }

    let previousManifest: LessonVisualPrivateManifest | null = null;
    if (freshLesson?.visual !== undefined && freshLesson?.visual !== null) {
      try {
        previousManifest = validateLessonVisualPrivateManifest(freshLesson.visual);
      } catch {
        // Un manifest precedente illeggibile non blocca la sostituzione, ma il
        // suo blob non viene toccato: cancellare in base a un dato che non si
        // sa interpretare è peggio che lasciare un orfano.
        previousManifest = null;
      }
    }

    // Manifest e piano ricomposti sullo stato **fresco**: l'ancora si risolve
    // contro il corpo appena riletto, non contro quello del preflight.
    const manifest = composePrivateManifest({
      assetId,
      candidate,
      image,
      anchor: resolveAnchorByIndex({
        lessonBody: fresh.body,
        anchorHeadingIndex: input.anchorHeadingIndex,
        anchorHeadingText: input.anchorHeadingText,
      }),
      caption: input.caption,
      altText: input.altText,
      approvedAt,
    });
    if (manifest.storageRef !== plannedStorageRef) {
      // Irraggiungibile finché il ticket è immutabile e l'assetId è fissato
      // prima della copia; se accadesse, i byte copiati starebbero altrove.
      throw new AiVisualError('corrupted_state', 'Percorso canonico incoerente.');
    }

    const nextPlan = buildPromotionPlan({
      manifest,
      bytes: staged,
      completed: fresh.completed,
      publicLessonId: fresh.publicLessonId,
      programId: input.programId,
      importId: input.importId,
      previousManifest,
    });

    tx.update(lessonRef, { visual: nextPlan.privateManifest });
    if (nextPlan.publicManifest && nextPlan.publicBytes) {
      tx.update(freshPublicRef, { visual: nextPlan.publicManifest });
      tx.set(db.doc(`${PUBLIC_LESSON_VISUALS}/${fresh.publicLessonId}`), nextPlan.publicBytes);
    }
    tx.set(promotionRef, {
      contractVersion: 1,
      ownerUid,
      inputHash,
      assetId,
      storageRef: manifest.storageRef,
      createdAtMs: nowMs,
      expireAtMs: nowMs + VISUAL_CANDIDATE_TTL_MS,
    } satisfies StoredVisualPromotion);
    tx.set(auditRef, {
      actorUid: ownerUid,
      action: 'lesson.visualApproved',
      targetId: input.lessonId,
      outcome: 'success',
      reason: fresh.completed ? 'approved and projected' : 'approved (lesson not completed)',
      timestamp: FieldValue.serverTimestamp(),
    });
    return nextPlan;
  });

  // Solo dopo il commit: prima significherebbe non poter più riprovare.
  await Promise.allSettled([
    bucket.file(run.stagingRef).delete(),
    ...(plan.supersededStorageRef ? [bucket.file(plan.supersededStorageRef).delete()] : []),
  ]);

  return { requestId: input.requestId, replayed: false, assetId };
}

async function handlePromoteVisual(request: CallableRequest<unknown>): Promise<unknown> {
  const db = database();
  try {
    const ownerUid = await requireOwner(request, db);
    if (visualMode() === 'disabled') {
      throw new AiVisualError('feature_disabled', 'La generazione visuale è disattivata.');
    }
    return await promoteVisualForOwner({
      db,
      bucket: getStorage().bucket() as unknown as BucketLike,
      ownerUid,
      input: validateVisualPromotionInput(request.data),
      nowMs: Date.now(),
    });
  } catch (error) {
    if (error instanceof AiVisualError) throw toHttpsError(error);
    logger.error('aiVisualPromote internal error', { name: (error as Error)?.name });
    throw new HttpsError('internal', 'Errore interno dell’approvazione visuale.');
  }
}

/** Approvazione: nessun secret, nessun provider, nessuna spesa. */
export const aiVisualPromote = onCall(VISUAL_CALLABLE_OPTIONS, handlePromoteVisual);

// ─── VE-03B: completamento, rimozione e abbandono ───────────────────────────

const MAX_CONCEPT_MAP_BYTES = 32_000;

function validConceptMap(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    Buffer.byteLength(value, 'utf8') <= MAX_CONCEPT_MAP_BYTES
  );
}

async function readLifecyclePair(
  db: Firestore,
  ownerUid: string,
  input: LessonLifecycleInput,
): Promise<{
  lesson: Record<string, unknown>;
  publicLesson: Record<string, unknown>;
  publicLessonId: string;
  udaDir: string;
  completed: boolean;
}> {
  const lessonSnap = await db
    .doc(lessonPath(input.programId, input.importId, input.lessonId))
    .get();
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
  const publicSnap = await db.doc(`publicLessons/${lessonGate.publicLessonId}`).get();
  const publicLesson = publicSnap.exists ? (publicSnap.data() as Record<string, unknown>) : null;
  const publicGate = checkProjectionForVisual({
    lesson: lesson as Record<string, unknown>,
    publicLesson,
    programId: input.programId,
    importId: input.importId,
    ownerUid,
  });
  if (!publicGate.ok) {
    throw new AiVisualError('invalid_input', describeVisualBindingFailure(publicGate.failure));
  }
  return {
    lesson: lesson as Record<string, unknown>,
    publicLesson: publicLesson as Record<string, unknown>,
    publicLessonId: lessonGate.publicLessonId,
    udaDir: lessonGate.udaDir,
    completed: publicGate.completed,
  };
}

function assertPrivateMap(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (!validConceptMap(value)) {
    throw new AiVisualError(
      'corrupted_state',
      'La mappa concettuale salvata non è valida: correggila prima di cambiare lo stato.',
    );
  }
  return value;
}

function samePublicVisual(value: unknown, manifest: LessonVisualPrivateManifest): boolean {
  try {
    return (
      lifecycleFingerprint(validateLessonVisualPublicManifest(value)) ===
      lifecycleFingerprint(projectLessonVisual(manifest))
    );
  } catch {
    return false;
  }
}

function samePublicBytes(
  value: unknown,
  expected: ReturnType<typeof composePublicLessonVisual>,
): boolean {
  try {
    return (
      lifecycleFingerprint(validatePublicLessonVisualDoc(value)) === lifecycleFingerprint(expected)
    );
  } catch {
    return false;
  }
}

export async function setLessonCompletedForOwner(params: {
  db: Firestore;
  bucket: BucketLike;
  ownerUid: string;
  input: ReturnType<typeof validateSetLessonCompletedInput>;
  beforeTransaction?: () => Promise<void>;
}): Promise<{ status: 'completed' | 'replayed' }> {
  const { db, bucket, ownerUid, input } = params;
  const pair = await readLifecyclePair(db, ownerUid, input);
  // Nascondere dati pubblici non richiede di interpretare la copia privata:
  // una mappa corrotta blocca la pubblicazione, mai la messa in sicurezza.
  const privateMap = input.completed ? assertPrivateMap(pair.lesson.conceptMapMarkdown) : undefined;
  const manifest =
    input.completed && pair.lesson.visual !== undefined
      ? validateCanonicalLessonVisual({
          value: pair.lesson.visual,
          ownerUid,
          importId: input.importId,
          udaDir: pair.udaDir,
        })
      : null;

  let publicBytes: ReturnType<typeof composePublicLessonVisual> | null = null;
  if (manifest) {
    let bytes: Uint8Array;
    try {
      [bytes] = await bucket.file(manifest.storageRef).download();
    } catch {
      throw new AiVisualError(
        'corrupted_state',
        'I byte del visual approvato non sono disponibili.',
      );
    }
    publicBytes = composePublicLessonVisual({
      manifest,
      bytes,
      publicLessonId: pair.publicLessonId,
      programId: input.programId,
      importId: input.importId,
    });
  }

  const publicBytesSnap = await db.doc(`${PUBLIC_LESSON_VISUALS}/${pair.publicLessonId}`).get();
  const alreadyProjected = input.completed
    ? pair.completed &&
      pair.publicLesson.conceptMapMarkdown === privateMap &&
      (manifest
        ? samePublicVisual(pair.publicLesson.visual, manifest) &&
          publicBytesSnap.exists &&
          samePublicBytes(publicBytesSnap.data(), publicBytes as NonNullable<typeof publicBytes>)
        : pair.publicLesson.visual === undefined && !publicBytesSnap.exists)
    : !pair.completed &&
      pair.publicLesson.conceptMapMarkdown === undefined &&
      pair.publicLesson.visual === undefined &&
      !publicBytesSnap.exists;
  if (alreadyProjected) return { status: 'replayed' };

  const preflightVisual = lifecycleFingerprint(pair.lesson.visual);
  const preflightPublicVisual = lifecycleFingerprint(pair.publicLesson.visual);
  const preflightMap = lifecycleFingerprint(pair.lesson.conceptMapMarkdown);
  const preflightPublicMap = lifecycleFingerprint(pair.publicLesson.conceptMapMarkdown);
  await params.beforeTransaction?.();

  await db.runTransaction(async (tx) => {
    const lessonRef = db.doc(lessonPath(input.programId, input.importId, input.lessonId));
    const lessonSnap = await tx.get(lessonRef);
    const lesson = lessonSnap.exists ? (lessonSnap.data() as Record<string, unknown>) : null;
    const lessonGate = checkLessonForVisual({
      lesson,
      lessonId: input.lessonId,
      ownerUid,
      importId: input.importId,
    });
    if (!lessonGate.ok || lessonGate.publicLessonId !== pair.publicLessonId) {
      throw new AiVisualError('run_conflict', 'La lezione è cambiata durante l’operazione.');
    }
    const publicRef = db.doc(`publicLessons/${pair.publicLessonId}`);
    const publicSnap = await tx.get(publicRef);
    const freshPublic = publicSnap.exists ? (publicSnap.data() as Record<string, unknown>) : null;
    const publicGate = checkProjectionForVisual({
      lesson: lesson as Record<string, unknown>,
      publicLesson: freshPublic,
      programId: input.programId,
      importId: input.importId,
      ownerUid,
    });
    if (!publicGate.ok) {
      throw new AiVisualError('run_conflict', 'La proiezione è cambiata durante l’operazione.');
    }
    if (
      publicGate.completed !== pair.completed ||
      lifecycleFingerprint(lesson?.visual) !== preflightVisual ||
      lifecycleFingerprint(freshPublic?.visual) !== preflightPublicVisual ||
      lifecycleFingerprint(lesson?.conceptMapMarkdown) !== preflightMap ||
      lifecycleFingerprint(freshPublic?.conceptMapMarkdown) !== preflightPublicMap
    ) {
      throw new AiVisualError('run_conflict', 'La lezione è cambiata durante l’operazione.');
    }

    const publicUpdate: Record<string, unknown> = {
      completed: input.completed,
      conceptMapMarkdown:
        input.completed && privateMap !== undefined ? privateMap : FieldValue.delete(),
      visual: input.completed && manifest ? projectLessonVisual(manifest) : FieldValue.delete(),
    };
    tx.update(lessonRef, {
      completed: input.completed,
      completedAt: input.completed ? FieldValue.serverTimestamp() : null,
    });
    tx.update(publicRef, publicUpdate);
    const publicVisualRef = db.doc(`${PUBLIC_LESSON_VISUALS}/${pair.publicLessonId}`);
    if (input.completed && publicBytes) tx.set(publicVisualRef, publicBytes);
    else tx.delete(publicVisualRef);
    tx.set(db.collection('auditEvents').doc(), {
      actorUid: ownerUid,
      action: 'lesson.completed',
      targetId: input.lessonId,
      outcome: 'success',
      reason: input.completed ? 'marked as completed' : 'marked as not completed',
      timestamp: FieldValue.serverTimestamp(),
    });
  });
  return { status: 'completed' };
}

async function handleSetLessonCompleted(request: CallableRequest<unknown>): Promise<unknown> {
  const db = database();
  try {
    const ownerUid = await requireOwner(request, db);
    return await setLessonCompletedForOwner({
      db,
      bucket: getStorage().bucket() as unknown as BucketLike,
      ownerUid,
      input: validateSetLessonCompletedInput(request.data),
    });
  } catch (error) {
    if (error instanceof AiVisualError) throw toHttpsError(error);
    logger.error('setLessonCompleted internal error', { name: (error as Error)?.name });
    throw new HttpsError('internal', 'Errore interno dello stato della lezione.');
  }
}

/** Unica mutazione autorevole dello stato svolta; nessun secret/provider. */
export const setLessonCompleted = onCall(VISUAL_CALLABLE_OPTIONS, handleSetLessonCompleted);

export interface RemovalRecoveryDoc extends LessonLifecycleInput {
  ownerUid: string;
  publicLessonId: string;
  udaDir: string;
  storageRef: string;
  assetId: string;
  createdAt: Timestamp;
}

type RemovalRecoveryDraft = Omit<RemovalRecoveryDoc, 'createdAt'>;

export type RemovalRecoveryState =
  | { kind: 'absent' }
  | { kind: 'valid'; recovery: RemovalRecoveryDoc };

function containsRecoveryControl(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0) as number;
    if (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)) return true;
  }
  return false;
}

function validRecoverySegment(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value === value.trim() &&
    !value.includes('/') &&
    value !== '.' &&
    value !== '..' &&
    !containsRecoveryControl(value) &&
    Buffer.byteLength(value, 'utf8') <= 1_500
  );
}

function corruptedRemovalRecovery(): never {
  throw new AiVisualError('corrupted_state', 'Il record di recovery della rimozione non è valido.');
}

export function parseRemovalRecovery(params: {
  exists: boolean;
  value: unknown;
  ownerUid: string;
  input: LessonLifecycleInput;
  publicLessonId: string;
  udaDir: string;
}): RemovalRecoveryState {
  if (!params.exists) return { kind: 'absent' };
  const { value } = params;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    corruptedRemovalRecovery();
  }
  const root = value as Record<string, unknown>;
  const keys = [
    'ownerUid',
    'programId',
    'importId',
    'lessonId',
    'publicLessonId',
    'udaDir',
    'storageRef',
    'assetId',
    'createdAt',
  ].sort();
  const actual = Object.keys(root).sort();
  if (actual.length !== keys.length || actual.some((key, index) => key !== keys[index])) {
    corruptedRemovalRecovery();
  }
  for (const key of ['ownerUid', 'programId', 'importId', 'lessonId', 'publicLessonId', 'udaDir']) {
    if (!validRecoverySegment(root[key])) corruptedRemovalRecovery();
  }
  if (
    root.ownerUid !== params.ownerUid ||
    root.programId !== params.input.programId ||
    root.importId !== params.input.importId ||
    root.lessonId !== params.input.lessonId ||
    root.publicLessonId !== params.publicLessonId ||
    root.udaDir !== params.udaDir
  ) {
    corruptedRemovalRecovery();
  }
  if (!validRecoverySegment(root.assetId) || typeof root.storageRef !== 'string') {
    corruptedRemovalRecovery();
  }
  let expectedStorageRef: string;
  try {
    expectedStorageRef = canonicalVisualStorageRef({
      ownerUid: root.ownerUid as string,
      importId: root.importId as string,
      udaDir: root.udaDir as string,
      assetId: root.assetId as string,
    });
  } catch {
    corruptedRemovalRecovery();
  }
  if (root.storageRef !== expectedStorageRef) corruptedRemovalRecovery();
  if (!(root.createdAt instanceof Timestamp)) corruptedRemovalRecovery();
  try {
    const createdAtMs = root.createdAt.toMillis();
    if (!Number.isFinite(createdAtMs)) corruptedRemovalRecovery();
  } catch {
    corruptedRemovalRecovery();
  }
  return { kind: 'valid', recovery: root as unknown as RemovalRecoveryDoc };
}

async function finishRemovalStorageCleanup(params: {
  db: Firestore;
  bucket: BucketLike;
  recoveryRef: DocumentReference;
  recovery: RemovalRecoveryDoc;
}): Promise<void> {
  const lessonSnap = await params.db
    .doc(lessonPath(params.recovery.programId, params.recovery.importId, params.recovery.lessonId))
    .get();
  const current = lessonSnap.data()?.visual;
  // Un nuovo manifest che riusa esattamente il path rende il cleanup vecchio
  // non sicuro. Un asset nuovo ha invece un UUID/path diverso.
  if (
    typeof current === 'object' &&
    current !== null &&
    (current as Record<string, unknown>).storageRef === params.recovery.storageRef
  ) {
    throw new AiVisualError('run_conflict', 'Il visual è stato sostituito durante il cleanup.');
  }
  try {
    await params.bucket.file(params.recovery.storageRef).delete();
  } catch (error) {
    if (!isStorageNotFound(error)) throw error;
  }
  await params.recoveryRef.delete();
}

export async function removeLessonVisualForOwner(params: {
  db: Firestore;
  bucket: BucketLike;
  ownerUid: string;
  input: LessonLifecycleInput;
  beforeTransaction?: () => Promise<void>;
}): Promise<{ status: 'removed' | 'replayed' }> {
  const removalRef = params.db.doc(
    `${VISUAL_REMOVALS}/${visualRemovalId(params.ownerUid, params.input)}`,
  );
  const pair = await readLifecyclePair(params.db, params.ownerUid, params.input);
  const existingSnap = await removalRef.get();
  const existingRecovery = parseRemovalRecovery({
    exists: existingSnap.exists,
    value: existingSnap.data(),
    ownerUid: params.ownerUid,
    input: params.input,
    publicLessonId: pair.publicLessonId,
    udaDir: pair.udaDir,
  });
  if (existingRecovery.kind === 'valid') {
    await finishRemovalStorageCleanup({
      ...params,
      recoveryRef: removalRef,
      recovery: existingRecovery.recovery,
    });
    return { status: 'replayed' };
  }

  if (pair.lesson.visual === undefined) return { status: 'replayed' };
  const manifest = validateCanonicalLessonVisual({
    value: pair.lesson.visual,
    ownerUid: params.ownerUid,
    importId: params.input.importId,
    udaDir: pair.udaDir,
  });
  const fingerprint = lifecycleFingerprint(pair.lesson.visual);
  await params.beforeTransaction?.();
  const recovery: RemovalRecoveryDraft = {
    ownerUid: params.ownerUid,
    ...params.input,
    publicLessonId: pair.publicLessonId,
    udaDir: pair.udaDir,
    storageRef: manifest.storageRef,
    assetId: manifest.assetId,
  };

  await params.db.runTransaction(async (tx) => {
    const lessonRef = params.db.doc(
      lessonPath(params.input.programId, params.input.importId, params.input.lessonId),
    );
    const lessonSnap = await tx.get(lessonRef);
    const lesson = lessonSnap.exists ? (lessonSnap.data() as Record<string, unknown>) : null;
    const gate = checkLessonForVisual({
      lesson,
      lessonId: params.input.lessonId,
      ownerUid: params.ownerUid,
      importId: params.input.importId,
    });
    if (
      !gate.ok ||
      gate.publicLessonId !== pair.publicLessonId ||
      lifecycleFingerprint(lesson?.visual) !== fingerprint
    ) {
      throw new AiVisualError('run_conflict', 'Il visual è cambiato durante la rimozione.');
    }
    const publicRef = params.db.doc(`publicLessons/${pair.publicLessonId}`);
    const publicSnap = await tx.get(publicRef);
    const publicGate = checkProjectionForVisual({
      lesson: lesson as Record<string, unknown>,
      publicLesson: publicSnap.exists ? (publicSnap.data() as Record<string, unknown>) : null,
      programId: params.input.programId,
      importId: params.input.importId,
      ownerUid: params.ownerUid,
    });
    if (!publicGate.ok) {
      throw new AiVisualError('run_conflict', 'La proiezione è cambiata durante la rimozione.');
    }
    tx.delete(params.db.doc(`${PUBLIC_LESSON_VISUALS}/${pair.publicLessonId}`));
    tx.update(publicRef, { visual: FieldValue.delete() });
    tx.update(lessonRef, { visual: FieldValue.delete() });
    tx.set(removalRef, { ...recovery, createdAt: FieldValue.serverTimestamp() });
    tx.set(params.db.collection('auditEvents').doc(), {
      actorUid: params.ownerUid,
      action: 'lesson.visualRemoved',
      targetId: params.input.lessonId,
      outcome: 'success',
      reason: null,
      timestamp: FieldValue.serverTimestamp(),
    });
  });

  const committedSnap = await removalRef.get();
  const committedRecovery = parseRemovalRecovery({
    exists: committedSnap.exists,
    value: committedSnap.data(),
    ownerUid: params.ownerUid,
    input: params.input,
    publicLessonId: pair.publicLessonId,
    udaDir: pair.udaDir,
  });
  if (committedRecovery.kind !== 'valid') corruptedRemovalRecovery();
  await finishRemovalStorageCleanup({
    db: params.db,
    bucket: params.bucket,
    recoveryRef: removalRef,
    recovery: committedRecovery.recovery,
  });
  return { status: 'removed' };
}

async function handleRemoveLessonVisual(request: CallableRequest<unknown>): Promise<unknown> {
  const db = database();
  try {
    const ownerUid = await requireOwner(request, db);
    return await removeLessonVisualForOwner({
      db,
      bucket: getStorage().bucket() as unknown as BucketLike,
      ownerUid,
      input: validateRemoveLessonVisualInput(request.data),
    });
  } catch (error) {
    if (error instanceof AiVisualError) throw toHttpsError(error);
    logger.error('aiVisualRemove internal error', { name: (error as Error)?.name });
    throw new HttpsError('internal', 'Errore interno della rimozione visuale.');
  }
}

export const aiVisualRemove = onCall(VISUAL_CALLABLE_OPTIONS, handleRemoveLessonVisual);

export async function cleanupVisualArtifactsForDelete(params: {
  db: Firestore;
  bucket: BucketLike;
  ownerUid: string;
  input: ReturnType<typeof validateDeleteVisualArtifactsInput>;
}): Promise<{ status: 'completed'; lessons: number; blobs: number }> {
  const prepared: Array<{
    input: LessonLifecycleInput;
    pair: Awaited<ReturnType<typeof readLifecyclePair>>;
    fingerprint: string;
    recovery: RemovalRecoveryDraft | null;
    existingRecovery: RemovalRecoveryDoc | null;
    recoveryRef: DocumentReference;
  }> = [];

  for (const lessonId of params.input.lessonIds) {
    const input: LessonLifecycleInput = {
      programId: params.input.programId,
      importId: params.input.importId,
      lessonId,
    };
    const recoveryRef = params.db.doc(
      `${VISUAL_REMOVALS}/${visualRemovalId(params.ownerUid, input)}`,
    );
    const pair = await readLifecyclePair(params.db, params.ownerUid, input);
    const existingSnap = await recoveryRef.get();
    const existing = parseRemovalRecovery({
      exists: existingSnap.exists,
      value: existingSnap.data(),
      ownerUid: params.ownerUid,
      input,
      publicLessonId: pair.publicLessonId,
      udaDir: pair.udaDir,
    });
    let recovery: RemovalRecoveryDraft | null = null;
    if (pair.lesson.visual !== undefined) {
      try {
        const manifest = validateCanonicalLessonVisual({
          value: pair.lesson.visual,
          ownerUid: params.ownerUid,
          importId: params.input.importId,
          udaDir: pair.udaDir,
        });
        recovery = {
          ownerUid: params.ownerUid,
          ...input,
          publicLessonId: pair.publicLessonId,
          udaDir: pair.udaDir,
          storageRef: manifest.storageRef,
          assetId: manifest.assetId,
        };
      } catch {
        // Manifest malformato: si rimuovono i riferimenti Firestore ma non si
        // costruisce e non si tenta alcun path Storage.
      }
    }
    prepared.push({
      input,
      pair,
      fingerprint: lifecycleFingerprint(pair.lesson.visual),
      recovery,
      existingRecovery: existing.kind === 'valid' ? existing.recovery : null,
      recoveryRef,
    });
  }

  // Prima si validano tutti i record del gruppo. Un solo documento malformato
  // deve fermare il bulk prima di qualunque delete Storage o scrittura.
  for (const item of prepared) {
    if (!item.existingRecovery) continue;
    await finishRemovalStorageCleanup({
      db: params.db,
      bucket: params.bucket,
      recoveryRef: item.recoveryRef,
      recovery: item.existingRecovery,
    });
  }

  await params.db.runTransaction(async (tx) => {
    const fresh: Array<{
      item: (typeof prepared)[number];
      lessonRef: DocumentReference;
      publicRef: DocumentReference;
    }> = [];
    for (const item of prepared) {
      const lessonRef = params.db.doc(
        lessonPath(item.input.programId, item.input.importId, item.input.lessonId),
      );
      const lessonSnap = await tx.get(lessonRef);
      const lesson = lessonSnap.exists ? (lessonSnap.data() as Record<string, unknown>) : null;
      const gate = checkLessonForVisual({
        lesson,
        lessonId: item.input.lessonId,
        ownerUid: params.ownerUid,
        importId: item.input.importId,
      });
      if (
        !gate.ok ||
        gate.publicLessonId !== item.pair.publicLessonId ||
        lifecycleFingerprint(lesson?.visual) !== item.fingerprint
      ) {
        throw new AiVisualError('run_conflict', 'Una lezione è cambiata durante il cleanup.');
      }
      const publicRef = params.db.doc(`publicLessons/${item.pair.publicLessonId}`);
      const publicSnap = await tx.get(publicRef);
      const publicGate = checkProjectionForVisual({
        lesson: lesson as Record<string, unknown>,
        publicLesson: publicSnap.exists ? (publicSnap.data() as Record<string, unknown>) : null,
        programId: item.input.programId,
        importId: item.input.importId,
        ownerUid: params.ownerUid,
      });
      if (!publicGate.ok) {
        throw new AiVisualError('run_conflict', 'Una proiezione è cambiata durante il cleanup.');
      }
      fresh.push({ item, lessonRef, publicRef });
    }
    for (const { item, lessonRef, publicRef } of fresh) {
      tx.delete(params.db.doc(`${PUBLIC_LESSON_VISUALS}/${item.pair.publicLessonId}`));
      tx.update(publicRef, { visual: FieldValue.delete() });
      tx.update(lessonRef, { visual: FieldValue.delete() });
      if (item.recovery) {
        tx.set(item.recoveryRef, {
          ...item.recovery,
          createdAt: FieldValue.serverTimestamp(),
        });
      }
    }
  });

  let blobs = 0;
  for (const item of prepared) {
    if (!item.recovery) continue;
    const committedSnap = await item.recoveryRef.get();
    const committedRecovery = parseRemovalRecovery({
      exists: committedSnap.exists,
      value: committedSnap.data(),
      ownerUid: params.ownerUid,
      input: item.input,
      publicLessonId: item.pair.publicLessonId,
      udaDir: item.pair.udaDir,
    });
    if (committedRecovery.kind !== 'valid') corruptedRemovalRecovery();
    await finishRemovalStorageCleanup({
      db: params.db,
      bucket: params.bucket,
      recoveryRef: item.recoveryRef,
      recovery: committedRecovery.recovery,
    });
    blobs += 1;
  }
  return { status: 'completed', lessons: prepared.length, blobs };
}

async function handleCleanupVisualArtifactsForDelete(
  request: CallableRequest<unknown>,
): Promise<unknown> {
  const db = database();
  try {
    const ownerUid = await requireOwner(request, db);
    return await cleanupVisualArtifactsForDelete({
      db,
      bucket: getStorage().bucket() as unknown as BucketLike,
      ownerUid,
      input: validateDeleteVisualArtifactsInput(request.data),
    });
  } catch (error) {
    if (error instanceof AiVisualError) throw toHttpsError(error);
    logger.error('aiVisualCleanupForDelete internal error', { name: (error as Error)?.name });
    throw new HttpsError('internal', 'Errore interno del cleanup visuale.');
  }
}

export const aiVisualCleanupForDelete = onCall(
  VISUAL_CALLABLE_OPTIONS,
  handleCleanupVisualArtifactsForDelete,
);

export async function abandonVisualForOwner(params: {
  db: Firestore;
  bucket: BucketLike;
  ownerUid: string;
  requestId: string;
}): Promise<{ status: 'abandoned' | 'replayed' }> {
  const opaqueRunId = abandonedVisualRunId(params.ownerUid, params.requestId);
  const abandonmentRef = params.db.doc(`${VISUAL_ABANDONMENTS}/${opaqueRunId}`);
  const abandonmentSnap = await abandonmentRef.get();
  const expectedStagingRef = `staging/${params.ownerUid}/${opaqueRunId}.webp`;
  if (abandonmentSnap.exists) {
    const data = abandonmentSnap.data();
    const keys = ['ownerUid', 'opaqueRunId', 'stagingRef', 'expireAt', 'createdAt'].sort();
    const actual = data ? Object.keys(data).sort() : [];
    const expireAtMs = (data?.expireAt as { toMillis?: () => number } | undefined)?.toMillis?.();
    const createdAtMs = (data?.createdAt as { toMillis?: () => number } | undefined)?.toMillis?.();
    if (
      actual.length !== keys.length ||
      actual.some((key, index) => key !== keys[index]) ||
      data?.ownerUid !== params.ownerUid ||
      data?.opaqueRunId !== opaqueRunId ||
      data?.stagingRef !== expectedStagingRef ||
      typeof expireAtMs !== 'number' ||
      !Number.isFinite(expireAtMs) ||
      typeof createdAtMs !== 'number' ||
      !Number.isFinite(createdAtMs)
    ) {
      throw new AiVisualError('corrupted_state', 'Il record di abbandono non è valido.');
    }
    try {
      await params.bucket.file(expectedStagingRef).delete();
    } catch (error) {
      if (!isStorageNotFound(error)) throw error;
    }
    return { status: 'replayed' };
  }

  const candidateRef = params.db.doc(`${VISUAL_CANDIDATES}/${opaqueRunId}`);
  const runRef = params.db.doc(`visualRuns/${opaqueRunId}`);
  const [candidateSnap, runSnap] = await Promise.all([candidateRef.get(), runRef.get()]);
  const candidate = parseStoredVisualCandidate(candidateSnap.data());
  const run = parseVisualRunDocument(runSnap.data(), opaqueRunId);
  if (!candidate || candidate.ownerUid !== params.ownerUid || !run) {
    throw new AiVisualError('invalid_input', 'Il candidato visuale non esiste o non è valido.');
  }
  if (run.stagingRef !== expectedStagingRef) {
    throw new AiVisualError('corrupted_state', 'Il riferimento staging non è canonico.');
  }
  await params.db.runTransaction(async (tx) => {
    const fresh = parseStoredVisualCandidate((await tx.get(candidateRef)).data());
    if (!fresh || fresh.ownerUid !== params.ownerUid) {
      throw new AiVisualError('run_conflict', 'Il candidato è cambiato durante l’abbandono.');
    }
    tx.delete(candidateRef);
    tx.set(abandonmentRef, {
      ownerUid: params.ownerUid,
      opaqueRunId,
      stagingRef: expectedStagingRef,
      expireAt: Timestamp.fromMillis(run.expireAtMs),
      createdAt: FieldValue.serverTimestamp(),
    });
  });
  try {
    await params.bucket.file(expectedStagingRef).delete();
  } catch (error) {
    if (!isStorageNotFound(error)) throw error;
  }
  return { status: 'abandoned' };
}

async function handleAbandonVisual(request: CallableRequest<unknown>): Promise<unknown> {
  const db = database();
  try {
    const ownerUid = await requireOwner(request, db);
    const input = validateAbandonVisualInput(request.data);
    return await abandonVisualForOwner({
      db,
      bucket: getStorage().bucket() as unknown as BucketLike,
      ownerUid,
      requestId: input.requestId,
    });
  } catch (error) {
    if (error instanceof AiVisualError) throw toHttpsError(error);
    logger.error('aiVisualAbandon internal error', { name: (error as Error)?.name });
    throw new HttpsError('internal', 'Errore interno dell’abbandono visuale.');
  }
}

export const aiVisualAbandon = onCall(VISUAL_CALLABLE_OPTIONS, handleAbandonVisual);

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

// ─── VE-03C — export binario, l'unica operazione non testuale ────────────────

/**
 * Legge i byte canonici delle lezioni richieste, per l'export ZIP.
 *
 * **Perché una callable e non una rotta del gateway testuale.** Il gateway
 * SGW-01 parla di percorsi: chi chiama dice *quale file* vuole. Qui il
 * chiamante non deve poter nominare alcun percorso — direbbe di fatto «leggimi
 * questo oggetto dello Storage», che è la lettura arbitraria che tutta VE-03 ha
 * evitato. L'input porta solo identificatori di dominio; `ownerUid`, `udaDir`,
 * `assetId` e `storageRef` li deriva il server dal `LessonDoc`.
 *
 * **Fail-closed.** Una lezione senza `visual` risponde `absent` ed è il caso
 * normale. Una lezione che **dichiara** un visual e non lo consegna verificato
 * fa fallire l'intera richiesta: nessun risultato parziale dentro un batch,
 * perché un batch a metà diventerebbe un archivio a metà che sembra intero.
 */
export async function exportLessonVisualsForOwner(params: {
  db: Firestore;
  bucket: BucketLike;
  ownerUid: string;
  /**
   * **`unknown` di proposito.** Finché il tipo era `VisualExportInput` il
   * validator si poteva saltare semplicemente costruendo un oggetto già
   * tipizzato — ed è esattamente ciò che faceva un test, che passava per il
   * motivo sbagliato. Ora la validazione è all'ingresso della funzione di
   * servizio, non dell'handler: la callable è un chiamante come un altro, e
   * nessun percorso può raggiungere Firestore o Storage senza attraversarla.
   */
  input: unknown;
}): Promise<VisualExportResult> {
  const { db, bucket, ownerUid } = params;
  // Prima riga del corpo, prima di qualunque `db.doc()`, `get()` o
  // `bucket.file()`: un payload malformato non deve costare nemmeno una lettura.
  const input = validateVisualExportInput(params.input);

  // Letture sequenziali per lezione: l'`udaDir` da cui dipende il percorso
  // canonico vive sul `LessonDoc`, quindi non esiste un modo di sapere che cosa
  // leggere prima di averlo letto. La concorrenza sta nei batch lato client.
  const items: VisualExportItem[] = [];
  let totalBytes = 0;

  for (const lessonId of input.lessonIds) {
    const snap = await db.doc(lessonPath(input.programId, input.importId, lessonId)).get();
    const lesson = snap.exists ? (snap.data() as Record<string, unknown>) : null;
    const gate = checkLessonForVisual({
      lesson,
      lessonId,
      ownerUid,
      importId: input.importId,
    });
    if (!gate.ok) {
      throw new AiVisualError('invalid_input', describeVisualBindingFailure(gate.failure));
    }

    const raw = lesson?.visual;
    if (raw === undefined || raw === null) {
      items.push({ lessonId, status: 'absent' });
      continue;
    }

    // Manifest valido **e** percorso canonico ricalcolato: il path memorizzato
    // viene confrontato, mai usato come istruzione di lettura.
    const manifest = validateCanonicalLessonVisual({
      value: raw,
      ownerUid,
      importId: input.importId,
      udaDir: gate.udaDir,
    });

    let bytes: Uint8Array;
    try {
      [bytes] = await bucket.file(manifest.storageRef).download();
    } catch (error) {
      if (isStorageNotFound(error)) {
        throw new AiVisualError(
          'corrupted_state',
          `L’immagine della lezione ${lessonId} non è più presente nell’archivio.`,
        );
      }
      throw error;
    }

    // Gli stessi controlli della promozione, rifatti sui byte appena letti: fra
    // approvazione ed export può essere passato tutto il tempo del mondo, e un
    // archivio è esattamente il posto in cui un byte sbagliato sopravvive.
    assertStagedBytesMatchRun({
      bytes,
      image: {
        sha256: manifest.sha256,
        byteLength: manifest.byteLength,
        width: manifest.width,
        height: manifest.height,
        mimeType: manifest.mimeType,
        styleVersion: manifest.styleVersion,
      },
      inspect: inspectWebp,
    });

    totalBytes += bytes.byteLength;
    if (totalBytes > MAX_VISUAL_EXPORT_TOTAL_BYTES) {
      throw new AiVisualError(
        'visual_too_large',
        `La risposta supera il limite di ${MAX_VISUAL_EXPORT_TOTAL_BYTES} byte.`,
      );
    }

    items.push({
      lessonId,
      status: 'present',
      assetId: manifest.assetId,
      manifestJson: serializeVisualManifestForExport(manifest),
      base64: Buffer.from(bytes).toString('base64'),
      byteLength: bytes.byteLength,
    });
  }

  return { items };
}

async function handleExportLessonVisuals(request: CallableRequest<unknown>): Promise<unknown> {
  const db = database();
  try {
    const ownerUid = await requireOwner(request, db);
    return await exportLessonVisualsForOwner({
      db,
      bucket: getStorage().bucket() as unknown as BucketLike,
      ownerUid,
      // Non validato qui: lo fa la funzione di servizio, che è l'unico punto
      // in cui la validazione non può essere aggirata.
      input: request.data,
    });
  } catch (error) {
    if (error instanceof AiVisualError) throw toHttpsError(error);
    logger.error('aiVisualExportBatch internal error', { name: (error as Error)?.name });
    throw new HttpsError('internal', 'Errore interno dell’export visuale.');
  }
}

/**
 * Export binario: owner-only, nessun secret, nessun provider, nessuna spesa IA.
 *
 * Non emette audit — e non per dimenticanza: l'export testuale che affianca non
 * ne emette, e introdurne uno solo qui creerebbe una traccia asimmetrica che
 * racconta metà della stessa azione.
 */
export const aiVisualExportBatch = onCall(VISUAL_CALLABLE_OPTIONS, handleExportLessonVisuals);

// ─── VE-04A — riancoraggio ────────────────────────────────────────────────────

/**
 * Sposta l'ancora dell'immagine già approvata, e **nient'altro**.
 *
 * Il docente riscrive una lezione e la sezione a cui l'immagine era ancorata
 * sparisce: l'immagine resta valida, ma finisce in fondo. Rigenerarla per
 * rimetterla al posto giusto significherebbe pagare un provider per riprodurre
 * qualcosa che si ha già — quindi qui non c'è provider, non c'è secret e non si
 * tocca un solo byte.
 *
 * **`publicLessonVisuals` non viene toccato.** I byte sono identici: riscriverli
 * sarebbe una scrittura pagata per non cambiare nulla. Cambia il manifest, cioè
 * dove la figura va messa, non che cosa mostra.
 *
 * Tutte le letture transazionali precedono tutte le scritture, come in
 * promozione e lifecycle: ciò che è stato dimostrato fuori dalla transazione
 * non è ancora garantito dentro.
 */
export async function reanchorLessonVisualForOwner(params: {
  db: Firestore;
  ownerUid: string;
  input: unknown;
  beforeTransaction?: () => Promise<void>;
}): Promise<{ status: 'reanchored' | 'replayed'; headingSlug: string }> {
  const { db, ownerUid } = params;
  // Validazione all'ingresso della funzione di servizio, non dell'handler: la
  // callable è un chiamante come un altro e non può aggirarla.
  const input = validateVisualReanchorInput(params.input);

  // ── Preflight: filtro, non verifica. ────────────────────────────────────────
  const preflight = await readLifecyclePair(db, ownerUid, input);
  if (preflight.lesson.visual === undefined || preflight.lesson.visual === null) {
    throw new AiVisualError('invalid_input', 'La lezione non ha un’immagine da riancorare.');
  }
  validateCanonicalLessonVisual({
    value: preflight.lesson.visual,
    ownerUid,
    importId: input.importId,
    udaDir: preflight.udaDir,
  });

  await params.beforeTransaction?.();

  const lessonRef = db.doc(lessonPath(input.programId, input.importId, input.lessonId));
  const auditRef = db.collection('auditEvents').doc();

  return db.runTransaction(async (tx) => {
    // (1) documento tecnico.
    const lessonSnap = await tx.get(lessonRef);
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

    // (2) proiezione, all'id **riderivato** dal documento appena letto.
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

    // Letture finite. Da qui in poi solo verifiche pure e scritture.
    const raw = lesson?.visual;
    if (raw === undefined || raw === null) {
      throw new AiVisualError('invalid_input', 'La lezione non ha un’immagine da riancorare.');
    }
    const current = validateCanonicalLessonVisual({
      value: raw,
      ownerUid,
      importId: input.importId,
      udaDir: lessonGate.udaDir,
    });

    // L'ancora si risolve sul corpo **fresco**: è il punto di tutta
    // l'operazione, e usare quello del preflight vorrebbe dire riancorare a una
    // sezione che nel frattempo poteva essere sparita di nuovo.
    // Per **indice**, non per testo: due `## Reti` sono indistinguibili se si
    // guarda solo il titolo, e il docente ha scelto una posizione precisa.
    const anchor = resolveAnchorByIndex({
      lessonBody: projectionGate.body,
      anchorHeadingIndex: input.anchorHeadingIndex,
      anchorHeadingText: input.anchorHeadingText,
    });

    if (isSameAnchor(current, anchor)) {
      // Replay: l'ancora è già quella. Zero scritture e zero audit — una
      // traccia qui racconterebbe un'operazione che non è avvenuta.
      return { status: 'replayed' as const, headingSlug: anchor.headingSlug };
    }

    const next = composeReanchoredManifest({ current, anchor });

    tx.update(lessonRef, { visual: next });
    if (projectionGate.completed) {
      // Stesso commit: la proiezione non può restare indietro rispetto al
      // manifest privato nemmeno per un istante.
      tx.update(publicRef, { visual: projectLessonVisual(next) });
    }
    tx.set(auditRef, {
      actorUid: ownerUid,
      action: 'lesson.visualReanchored',
      targetId: input.lessonId,
      outcome: 'success',
      // Nessun testo editoriale nell'audit: lo slug è un identificatore, la
      // didascalia sarebbe contenuto.
      reason: projectionGate.completed
        ? `reanchored to ${anchor.headingSlug} and projected`
        : `reanchored to ${anchor.headingSlug} (lesson not completed)`,
      timestamp: FieldValue.serverTimestamp(),
    });
    return { status: 'reanchored' as const, headingSlug: anchor.headingSlug };
  });
}

async function handleReanchorLessonVisual(request: CallableRequest<unknown>): Promise<unknown> {
  const db = database();
  try {
    const ownerUid = await requireOwner(request, db);
    return await reanchorLessonVisualForOwner({ db, ownerUid, input: request.data });
  } catch (error) {
    if (error instanceof AiVisualError) throw toHttpsError(error);
    logger.error('aiVisualReanchor internal error', { name: (error as Error)?.name });
    throw new HttpsError('internal', 'Errore interno del riancoraggio.');
  }
}

/** Riancoraggio: owner-only, nessun secret, nessun provider, nessuno Storage. */
export const aiVisualReanchor = onCall(VISUAL_CALLABLE_OPTIONS, handleReanchorLessonVisual);
