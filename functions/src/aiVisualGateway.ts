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
import { validateLessonVisualPrivateManifest } from './aiVisualManifest.js';
import {
  assertStagedBytesMatchRun,
  buildPromotionPlan,
  composePrivateManifest,
  computePromotionInputHash,
  reconcileVisualPromotion,
  resolveAnchorSlugInBody,
  validateVisualPromotionInput,
  type PromotableRunImage,
  type StoredVisualPromotion,
} from './aiVisualPromotion.js';
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
import { isStorageNotFound } from './repositoryGatewayCore.js';

/** Secret Firebase esistente. Il binding è presente solo su `aiVisualGenerate`. */
export const AI_VISUAL_OPENAI_API_KEY = defineSecret('OPENAI_API_KEY');

/** Collezioni server-only: nessuna regola le apre in scrittura al client. */
const VISUAL_CANDIDATES = 'aiVisualCandidates';
const VISUAL_PROMOTIONS = 'aiVisualPromotions';
const PUBLIC_LESSON_VISUALS = 'publicLessonVisuals';

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
export const aiVisualPreview = onCall({ region: SCHOOLFORGE_FUNCTION_REGION }, (request) =>
  handleVisualRequest(request, 'preview'),
);

/** Generazione reale: unica callable con binding del secret Firebase esistente. */
export const aiVisualGenerate = onCall(
  { region: SCHOOLFORGE_FUNCTION_REGION, secrets: [AI_VISUAL_OPENAI_API_KEY] },
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

async function handleBindCandidate(request: CallableRequest<unknown>): Promise<unknown> {
  const db = database();
  try {
    const ownerUid = await requireOwner(request, db);
    if (visualMode() === 'disabled') {
      throw new AiVisualError('feature_disabled', 'La generazione visuale è disattivata.');
    }
    const input = validateVisualCandidateBindInput(request.data);
    const lesson = await readAuthoritativeLesson(db, { ownerUid, ...input });

    const nowMs = Date.now();
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
    const outcome = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
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
export const aiVisualBindCandidate = onCall(
  { region: SCHOOLFORGE_FUNCTION_REGION },
  handleBindCandidate,
);

// ─── VE-03A — promozione del candidato approvato ─────────────────────────────

/**
 * L'ordine delle operazioni è la garanzia, e vale la pena dirlo dove il codice
 * lo esegue:
 *
 * 1. **verifiche** — ticket, lezione, proiezione, corpo invariato, run
 *    completato, byte staged identici a quelli del run;
 * 2. **copia** in Storage nella posizione canonica;
 * 3. **transazione** Firestore: manifest privato, proiezione pubblica, byte
 *    pubblici, record di promozione e audit, tutti insieme o nessuno;
 * 4. **pulizia** — staging e blob superato, solo dopo il commit.
 *
 * Fra 2 e 3 un crash lascia un blob orfano che nessuno referenzia: recuperabile.
 * L'ordine inverso lascerebbe una proiezione che punta a byte inesistenti, cioè
 * un'immagine rotta in faccia allo studente. Fra 3 e 4 un crash lascia uno
 * staging che il TTL cleanup rimuove da sé.
 */
async function handlePromoteVisual(request: CallableRequest<unknown>): Promise<unknown> {
  const db = database();
  try {
    const ownerUid = await requireOwner(request, db);
    if (visualMode() === 'disabled') {
      throw new AiVisualError('feature_disabled', 'La generazione visuale è disattivata.');
    }
    const input = validateVisualPromotionInput(request.data);
    const nowMs = Date.now();
    const opaqueRunId = computeVisualRunId(ownerUid, input.requestId);
    const inputHash = computePromotionInputHash(input);

    // Replay prima di tutto: una risposta persa dopo il commit non deve
    // produrre un secondo asset, un secondo audit e una seconda copia.
    const promotionRef = db.doc(`${VISUAL_PROMOTIONS}/${opaqueRunId}`);
    const promotionSnap = await promotionRef.get();
    const storedPromotion = promotionSnap.exists
      ? (promotionSnap.data() as StoredVisualPromotion)
      : null;
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
      throw new AiVisualError(
        'invalid_input',
        describeCandidateCheckFailure(candidateCheck.reason),
      );
    }
    const candidate = candidateCheck.candidate;

    const lesson = await readAuthoritativeLesson(db, {
      ownerUid,
      programId: input.programId,
      importId: input.importId,
      lessonId: input.lessonId,
    });
    if (lesson.publicLessonId !== candidate.publicLessonId || lesson.udaDir !== candidate.udaDir) {
      throw new AiVisualError('invalid_input', describeCandidateCheckFailure('target'));
    }
    // Il corpo è cambiato dopo la preparazione: errore tipizzato, zero
    // scritture persistenti, staging intatto fino al TTL cleanup.
    if (computeSourceBodyHash(lesson.body) !== candidate.sourceBodyHash) {
      throw new AiVisualError('invalid_input', describeCandidateCheckFailure('source_body'));
    }

    const runSnap = await db.doc(`visualRuns/${opaqueRunId}`).get();
    const run = parseVisualRunDocument(runSnap.exists ? runSnap.data() : null, opaqueRunId);
    if (!run || run.status !== 'completed' || !run.image) {
      throw new AiVisualError('invalid_input', 'Il candidato non è stato generato con successo.');
    }

    const bucket = getStorage().bucket();
    let staged: Buffer;
    try {
      [staged] = await bucket.file(run.stagingRef).download();
    } catch (error) {
      if (isStorageNotFound(error)) {
        throw new AiVisualError('invalid_input', 'Il candidato non è più disponibile: rigeneralo.');
      }
      throw error;
    }
    assertStagedBytesMatchRun({
      bytes: staged,
      image: {
        sha256: run.image.sha256,
        byteLength: run.image.byteLength,
        width: run.image.width,
        height: run.image.height,
        mimeType: run.image.mimeType,
        styleVersion: run.image.styleVersion as PromotableRunImage['styleVersion'],
      },
      inspect: inspectWebp,
    });

    const anchor = resolveAnchorSlugInBody(input.anchorHeadingText, lesson.body);
    const assetId = randomUUID();
    const manifest = composePrivateManifest({
      assetId,
      candidate,
      image: {
        sha256: run.image.sha256,
        byteLength: run.image.byteLength,
        width: run.image.width,
        height: run.image.height,
        mimeType: run.image.mimeType,
        styleVersion: run.image.styleVersion as PromotableRunImage['styleVersion'],
      },
      anchor,
      caption: input.caption,
      altText: input.altText,
      approvedAt: Timestamp.fromMillis(nowMs),
    });

    const lessonRef = db.doc(lessonPath(input.programId, input.importId, input.lessonId));
    const previousSnap = await lessonRef.get();
    const previousRaw = previousSnap.data()?.visual;
    let previousManifest: ReturnType<typeof composePrivateManifest> | null = null;
    if (previousRaw !== undefined && previousRaw !== null) {
      try {
        previousManifest = validateLessonVisualPrivateManifest(previousRaw);
      } catch {
        // Un manifest precedente illeggibile non blocca la sostituzione, ma il
        // suo blob non viene toccato: cancellare in base a un dato che non si
        // sa interpretare è peggio che lasciare un orfano.
        previousManifest = null;
      }
    }

    const plan = buildPromotionPlan({
      manifest,
      bytes: staged,
      completed: lesson.completed,
      publicLessonId: lesson.publicLessonId,
      programId: input.programId,
      importId: input.importId,
      previousManifest,
    });

    // Copia **prima** del commit: una proiezione pubblica non deve mai poter
    // puntare a byte che non esistono.
    await bucket.file(manifest.storageRef).save(staged, {
      resumable: false,
      metadata: {
        contentType: 'image/webp',
        cacheControl: 'private,no-store',
        metadata: { sha256: manifest.sha256 },
      },
    });

    const publicRef = db.doc(`publicLessons/${lesson.publicLessonId}`);
    const publicVisualRef = db.doc(`${PUBLIC_LESSON_VISUALS}/${lesson.publicLessonId}`);
    await db.runTransaction(async (tx) => {
      // Rilettura dentro la transazione: fra le verifiche e il commit la
      // lezione potrebbe essere cambiata, e ciò che è stato dimostrato fuori
      // non è ancora garantito dentro.
      const freshPromotion = await tx.get(promotionRef);
      if (freshPromotion.exists) throw new AiVisualError('running', 'Approvazione già in corso.');
      const freshLesson = await tx.get(lessonRef);
      const freshData = freshLesson.exists ? (freshLesson.data() as Record<string, unknown>) : null;
      if (!freshData || freshData.ownerUid !== ownerUid) {
        throw new AiVisualError('invalid_input', describeVisualBindingFailure('lesson_missing'));
      }
      if ((freshData.completed === true) !== lesson.completed) {
        throw new AiVisualError(
          'uncertain_state',
          'Lo stato di svolgimento della lezione è cambiato: riprova.',
        );
      }

      tx.update(lessonRef, { visual: plan.privateManifest });
      if (plan.publicManifest && plan.publicBytes) {
        tx.update(publicRef, { visual: plan.publicManifest });
        tx.set(publicVisualRef, plan.publicBytes);
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
      tx.set(db.collection('auditEvents').doc(), {
        actorUid: ownerUid,
        action: 'lesson.visualApproved',
        targetId: input.lessonId,
        outcome: 'success',
        reason: lesson.completed ? 'approved and projected' : 'approved (lesson not completed)',
        timestamp: FieldValue.serverTimestamp(),
      });
    });

    // Solo dopo il commit: prima significherebbe non poter più riprovare.
    await Promise.allSettled([
      bucket.file(run.stagingRef).delete(),
      ...(plan.supersededStorageRef ? [bucket.file(plan.supersededStorageRef).delete()] : []),
    ]);

    return { requestId: input.requestId, replayed: false, assetId };
  } catch (error) {
    if (error instanceof AiVisualError) throw toHttpsError(error);
    logger.error('aiVisualPromote internal error', { name: (error as Error)?.name });
    throw new HttpsError('internal', 'Errore interno dell’approvazione visuale.');
  }
}

/** Approvazione: nessun secret, nessun provider, nessuna spesa. */
export const aiVisualPromote = onCall({ region: SCHOOLFORGE_FUNCTION_REGION }, handlePromoteVisual);

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
