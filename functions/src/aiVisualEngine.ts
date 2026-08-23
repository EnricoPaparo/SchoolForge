import { AI_CONTENT_RUN_TTL_MS } from './aiContentCore.js';
import {
  AI_VISUAL_CONTRACT_VERSION,
  AI_VISUAL_SERVER_CONFIG,
  AiVisualError,
  actualVisualCostMicroUsd,
  computeVisualBudgetReservationKey,
  computeVisualInputHash,
  computeVisualRunId,
  estimateVisualCost,
  toVisualDataUri,
  visualStagingRef,
  type AiVisualMode,
  type AiVisualRequest,
  type VisualCostEstimate,
} from './aiVisualCore.js';
import type { NormalizedVisual } from './aiVisualNormalizer.js';
import type { ImageProviderOutcome } from './aiVisualProvider.js';
import type {
  StoredAiVisualBudget,
  StoredAiVisualImage,
  StoredAiVisualRun,
} from './aiVisualRunDoc.js';

export const AI_VISUAL_LEASE_MS = 5 * 60 * 1000;

export interface AiVisualRuntimeConfig {
  enabled: boolean;
  maxOperationCostMicroUsd: number;
  dailyBudgetMicroUsd: number;
  monthlyBudgetMicroUsd: number;
}

export interface AiVisualContext {
  authenticatedOwnerUid: string;
  mode: AiVisualMode;
  executionId: string;
  nowMs: number;
  leaseMs?: number;
}

export type VisualReserveOutcome =
  | { kind: 'reserved' }
  | { kind: 'replay_completed'; run: StoredAiVisualRun & { image: StoredAiVisualImage } }
  | { kind: 'running' }
  | { kind: 'conflict' }
  | { kind: 'corrupted' }
  | { kind: 'uncertain' }
  | {
      kind: 'budget';
      code: 'budget_exceeded' | 'daily_budget_exceeded' | 'budget_unavailable';
    };

export interface AiVisualPorts {
  loadRuntimeConfig(mode: AiVisualMode): Promise<AiVisualRuntimeConfig | null>;
  readAvailableBudgetMicroUsd(config: AiVisualRuntimeConfig): Promise<number | null>;
  reserveRunAndBudget(params: {
    opaqueRunId: string;
    run: StoredAiVisualRun;
    nowMs: number;
  }): Promise<VisualReserveOutcome>;
  markProviderPending(params: {
    opaqueRunId: string;
    executionId: string;
    nowMs: number;
  }): Promise<boolean>;
  callProvider(params: {
    mode: Exclude<AiVisualMode, 'disabled'>;
    subject: string;
  }): Promise<ImageProviderOutcome>;
  normalize(bytes: Uint8Array): Promise<NormalizedVisual>;
  uploadStaging(params: { stagingRef: string; bytes: Buffer; sha256: string }): Promise<void>;
  finalizeRun(params: {
    opaqueRunId: string;
    executionId: string;
    image: StoredAiVisualImage;
    actualInputTokens: number | null;
    actualOutputTokens: number | null;
    actualCostMicroUsd: number | null;
    settledCostMicroUsd: number;
    nowMs: number;
  }): Promise<'finalized' | 'lost_lease'>;
  failRun(params: {
    opaqueRunId: string;
    executionId: string;
    actualInputTokens: number | null;
    actualOutputTokens: number | null;
    actualCostMicroUsd: number | null;
    settledCostMicroUsd: number;
    nowMs: number;
  }): Promise<void>;
}

export interface AiVisualPreviewResult {
  requestId: string;
  styleVersion: string;
  preset: typeof AI_VISUAL_SERVER_CONFIG;
  estimatedInputTokens: number;
  expectedOutputTokens: number;
  estimatedCostMicroUsd: number;
  reservationCostMicroUsd: number;
}

export interface AiVisualGenerateResult {
  requestId: string;
  replayed: boolean;
  dataUri: string;
  width: number;
  height: number;
  byteLength: number;
  sha256: string;
  mimeType: 'image/webp';
  styleVersion: string;
  estimatedCostMicroUsd: number;
  actualCostMicroUsd: number | null;
  settledCostMicroUsd: number;
}

async function resolveConfigAndCost(
  request: AiVisualRequest,
  ctx: AiVisualContext,
  ports: AiVisualPorts,
): Promise<{ config: AiVisualRuntimeConfig; cost: VisualCostEstimate }> {
  if (ctx.mode === 'disabled') {
    throw new AiVisualError('feature_disabled', 'La generazione visuale è disattivata.');
  }
  const config = await ports.loadRuntimeConfig(ctx.mode);
  if (!config || !config.enabled) {
    throw new AiVisualError('feature_disabled', 'La generazione visuale è disattivata.');
  }
  const cost = estimateVisualCost(request.subject, ctx.mode);
  if (cost.reservationCostMicroUsd > config.maxOperationCostMicroUsd) {
    throw new AiVisualError(
      'operation_budget_exceeded',
      'Il costo prenotato supera il limite per operazione.',
    );
  }
  return { config, cost };
}

export async function previewVisual(
  request: AiVisualRequest,
  ctx: AiVisualContext,
  ports: AiVisualPorts,
): Promise<AiVisualPreviewResult> {
  const { config, cost } = await resolveConfigAndCost(request, ctx, ports);
  if (ctx.mode === 'openai') {
    const available = await ports.readAvailableBudgetMicroUsd(config);
    if (available === null) {
      throw new AiVisualError('budget_unavailable', 'Budget non disponibile. Riprova più tardi.');
    }
    if (cost.reservationCostMicroUsd > available) {
      throw new AiVisualError('budget_exceeded', 'Budget insufficiente per la generazione.');
    }
  }
  return {
    requestId: request.requestId,
    styleVersion: AI_VISUAL_SERVER_CONFIG.styleVersion,
    preset: AI_VISUAL_SERVER_CONFIG,
    estimatedInputTokens: cost.estimatedInputTokens,
    expectedOutputTokens: cost.expectedOutputTokens,
    estimatedCostMicroUsd: cost.estimatedCostMicroUsd,
    reservationCostMicroUsd: cost.reservationCostMicroUsd,
  };
}

function responseFromRun(
  requestId: string,
  run: StoredAiVisualRun & { image: StoredAiVisualImage },
  replayed: boolean,
): AiVisualGenerateResult {
  return {
    requestId,
    replayed,
    dataUri: run.image.dataUri,
    width: run.image.width,
    height: run.image.height,
    byteLength: run.image.byteLength,
    sha256: run.image.sha256,
    mimeType: run.image.mimeType,
    styleVersion: run.image.styleVersion,
    estimatedCostMicroUsd: run.budget.estimatedCostMicroUsd,
    actualCostMicroUsd: run.budget.actualCostMicroUsd,
    settledCostMicroUsd: run.budget.settledCostMicroUsd ?? run.budget.reservedCostMicroUsd,
  };
}

function usageSettlement(
  outcome: Extract<ImageProviderOutcome, { status: 'success' | 'billed_unusable' }>,
  reservationCap: number,
): {
  actualInputTokens: number | null;
  actualOutputTokens: number | null;
  actualCostMicroUsd: number | null;
  settledCostMicroUsd: number;
} {
  if (outcome.priorBillingRisk) {
    return {
      actualInputTokens: null,
      actualOutputTokens: null,
      actualCostMicroUsd: null,
      settledCostMicroUsd: reservationCap,
    };
  }
  if (outcome.status === 'success' && !outcome.metered) {
    return {
      actualInputTokens: 0,
      actualOutputTokens: 0,
      actualCostMicroUsd: 0,
      settledCostMicroUsd: 0,
    };
  }
  const actualCost = outcome.usage ? actualVisualCostMicroUsd(outcome.usage) : null;
  if (actualCost === null || actualCost > reservationCap) {
    return {
      actualInputTokens: null,
      actualOutputTokens: null,
      actualCostMicroUsd: null,
      settledCostMicroUsd: reservationCap,
    };
  }
  return {
    actualInputTokens: outcome.usage?.inputTokens ?? null,
    actualOutputTokens: outcome.usage?.outputTokens ?? null,
    actualCostMicroUsd: actualCost,
    settledCostMicroUsd: actualCost,
  };
}

export async function generateVisual(
  request: AiVisualRequest,
  ctx: AiVisualContext,
  ports: AiVisualPorts,
): Promise<AiVisualGenerateResult> {
  const { cost } = await resolveConfigAndCost(request, ctx, ports);
  if (ctx.mode === 'disabled') {
    throw new AiVisualError('feature_disabled', 'La generazione visuale è disattivata.');
  }
  const mode = ctx.mode;
  const opaqueRunId = computeVisualRunId(ctx.authenticatedOwnerUid, request.requestId);
  const reservationKey = computeVisualBudgetReservationKey(
    ctx.authenticatedOwnerUid,
    request.requestId,
  );
  const stagingRef = visualStagingRef(ctx.authenticatedOwnerUid, opaqueRunId);
  const budget: StoredAiVisualBudget = {
    monthKey: new Date(ctx.nowMs).toISOString().slice(0, 7),
    reservationKey,
    estimatedInputTokens: cost.estimatedInputTokens,
    reservedInputTokens: cost.reservedInputTokens,
    expectedOutputTokens: cost.expectedOutputTokens,
    estimatedCostMicroUsd: cost.estimatedCostMicroUsd,
    reservedCostMicroUsd: cost.reservationCostMicroUsd,
    actualInputTokens: null,
    actualOutputTokens: null,
    actualCostMicroUsd: null,
    settledCostMicroUsd: null,
  };
  const run: StoredAiVisualRun = {
    contractVersion: AI_VISUAL_CONTRACT_VERSION,
    status: 'reserved',
    inputHash: computeVisualInputHash(request),
    config: AI_VISUAL_SERVER_CONFIG,
    leaseExecutionId: ctx.executionId,
    leaseExpiresAtMs: ctx.nowMs + (ctx.leaseMs ?? AI_VISUAL_LEASE_MS),
    budget,
    image: null,
    stagingRef,
    createdAtMs: ctx.nowMs,
    updatedAtMs: ctx.nowMs,
    expireAtMs: ctx.nowMs + AI_CONTENT_RUN_TTL_MS,
  };

  const reserved = await ports.reserveRunAndBudget({ opaqueRunId, run, nowMs: ctx.nowMs });
  if (reserved.kind === 'replay_completed') {
    return responseFromRun(request.requestId, reserved.run, true);
  }
  if (reserved.kind === 'running') {
    throw new AiVisualError('running', 'Generazione visuale già in corso.');
  }
  if (reserved.kind === 'conflict') {
    throw new AiVisualError('run_conflict', 'requestId già usato con un soggetto diverso.');
  }
  if (reserved.kind === 'corrupted') {
    throw new AiVisualError('corrupted_state', 'Stato visuale non valido.');
  }
  if (reserved.kind === 'uncertain') {
    throw new AiVisualError('uncertain_state', 'Esito visuale incerto; nessun nuovo tentativo.');
  }
  if (reserved.kind === 'budget') {
    throw new AiVisualError(reserved.code, 'Budget insufficiente per la generazione.');
  }

  const marked = await ports.markProviderPending({
    opaqueRunId,
    executionId: ctx.executionId,
    nowMs: ctx.nowMs,
  });
  if (!marked) throw new AiVisualError('running', 'La lease visuale non è più valida.');

  const outcome = await ports.callProvider({ mode, subject: request.subject });
  const cap = cost.reservationCostMicroUsd;
  if (outcome.status === 'pre_invocation' || outcome.status === 'invocation_unknown') {
    await ports.failRun({
      opaqueRunId,
      executionId: ctx.executionId,
      actualInputTokens: null,
      actualOutputTokens: null,
      actualCostMicroUsd: null,
      settledCostMicroUsd: outcome.status === 'pre_invocation' ? 0 : cap,
      nowMs: ctx.nowMs,
    });
    throw new AiVisualError(
      outcome.status === 'pre_invocation' ? 'provider_config_invalid' : 'provider_unavailable',
      'Il provider immagini non è disponibile.',
    );
  }

  const settlement = usageSettlement(outcome, cap);
  if (outcome.status === 'billed_unusable') {
    await ports.failRun({
      opaqueRunId,
      executionId: ctx.executionId,
      ...settlement,
      nowMs: ctx.nowMs,
    });
    throw new AiVisualError(
      'provider_billed_unusable',
      'Il provider non ha restituito una singola immagine utilizzabile.',
    );
  }

  let normalized: NormalizedVisual;
  try {
    normalized = await ports.normalize(outcome.bytes);
  } catch (error) {
    await ports.failRun({
      opaqueRunId,
      executionId: ctx.executionId,
      ...settlement,
      nowMs: ctx.nowMs,
    });
    if (error instanceof AiVisualError) throw error;
    throw new AiVisualError('visual_corrupted', 'L’immagine restituita non è valida.');
  }

  const image: StoredAiVisualImage = {
    dataUri: toVisualDataUri(normalized.bytes),
    width: normalized.width,
    height: normalized.height,
    byteLength: normalized.byteLength,
    sha256: normalized.sha256,
    mimeType: normalized.mimeType,
    styleVersion: AI_VISUAL_SERVER_CONFIG.styleVersion,
    webpQuality: normalized.webpQuality,
    normalizationAttempts: normalized.normalizationAttempts,
  };
  try {
    await ports.uploadStaging({ stagingRef, bytes: normalized.bytes, sha256: normalized.sha256 });
  } catch {
    await ports.failRun({
      opaqueRunId,
      executionId: ctx.executionId,
      ...settlement,
      nowMs: ctx.nowMs,
    });
    throw new AiVisualError('staging_failed', 'Impossibile salvare l’immagine temporanea.');
  }

  let finalized: 'finalized' | 'lost_lease';
  try {
    finalized = await ports.finalizeRun({
      opaqueRunId,
      executionId: ctx.executionId,
      image,
      ...settlement,
      nowMs: ctx.nowMs,
    });
  } catch {
    // Upload già avvenuto + transazione finale di esito ignoto: non si ritenta
    // mai provider/upload. TTL cleanup e settlement pending chiudono la finestra.
    throw new AiVisualError('uncertain_state', 'Finalizzazione visuale di esito incerto.');
  }
  if (finalized === 'lost_lease') {
    throw new AiVisualError('uncertain_state', 'La lease è cambiata dopo l’upload.');
  }

  return responseFromRun(
    request.requestId,
    {
      ...run,
      status: 'completed',
      budget: {
        ...budget,
        actualInputTokens: settlement.actualInputTokens,
        actualOutputTokens: settlement.actualOutputTokens,
        actualCostMicroUsd: settlement.actualCostMicroUsd,
        settledCostMicroUsd: settlement.settledCostMicroUsd,
      },
      image,
    },
    false,
  );
}
