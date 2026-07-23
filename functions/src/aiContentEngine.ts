/**
 * AIGEN-01 — motore **puro** della generazione contenuti. Nessun Firestore/rete
 * qui: le operazioni con effetti sono **porte iniettate** (`AiContentPorts`), così
 * l'ordine fail-closed, l'idempotenza/replay, la lease e l'integrazione budget
 * sono testabili senza emulatori. La materializzazione `schoolforge-pool/v2`
 * (mapper ID + `parsePool`) NON è qui: è di AIGEN-02, nel web.
 */

import {
  AiContentError,
  AI_CONTENT_CONTRACT_VERSION,
  AI_CONTENT_LIMITS,
  computeBudgetReservationKey,
  computeInputHash,
  computeOpaqueRunId,
  resolveContentModel,
  utf8ByteLength,
  type AiContentRequest,
  type ContentKind,
} from './aiContentCore.js';
import { estimateContentCost } from './aiContentCost.js';
import { validateLessonProposal, validatePoolProposal } from './aiContentValidation.js';
import { actualCostMicroUsd, normalizeUsageActual } from './aiCorrectionCost.js';
import { AI_CONTENT_RUN_TTL_MS } from './aiContentCore.js';
import type { AiRuntimeConfig } from './aiCorrectionRuntimeConfig.js';

/** Durata lease sul run (ms): deve coprire un tentativo provider + finalizzazione. */
export const AI_CONTENT_LEASE_TTL_MS = 90_000;

/** Documento run **privacy-minimal** (nessun UID/testo/prompt/guidance/raw response). */
export interface StoredAiContentRun {
  contractVersion: number;
  kind: ContentKind;
  status: 'running' | 'completed' | 'failed';
  inputHash: string;
  modelProfile: string;
  model: string;
  priceListVersion: string;
  estimatedInputTokens: number;
  maxOutputTokens: number;
  actualInputTokens: number | null;
  actualOutputTokens: number | null;
  estimatedCostMicroUsd: number;
  reservedCostMicroUsd: number;
  actualCostMicroUsd: number | null;
  leaseExecutionId: string;
  leaseExpiresAtMs: number;
  /** Proposta strutturata validata (pool senza ID / corpo lezione). */
  output: unknown | null;
  createdAtMs: number;
  updatedAtMs: number;
  expireAtMs: number;
}

export interface AiContentContext {
  authenticatedOwnerUid: string;
  nowMs: number;
  executionId: string;
}

/** Esito della prenotazione run+budget in transazione (idempotente). */
export type ReserveOutcome =
  | { kind: 'reserved'; reservedMicroUsd: number }
  | { kind: 'replay_completed'; run: StoredAiContentRun }
  | { kind: 'running' }
  | { kind: 'conflict' }
  | { kind: 'budget'; code: 'budget_exceeded' | 'daily_budget_exceeded' | 'budget_unavailable' };

export interface ProviderOutput {
  output: unknown;
  usage: { inputTokens?: number; outputTokens?: number; tokens?: number } | null;
}

/**
 * Porte con effetti. Ogni metodo è una singola operazione mockabile. Il gateway
 * concreto (Admin SDK + provider Responses API) le implementa.
 */
export interface AiContentPorts {
  /** Config runtime (kill switch/limiti/budget). `null` ⇒ provider disabilitato. */
  loadRuntimeConfig(): Promise<AiRuntimeConfig | null>;
  /** Disponibilità budget in sola lettura (µUSD), per la preview. */
  readAvailableBudgetMicroUsd(): Promise<number | null>;
  /** Legge il run esistente (per replay/lease). */
  loadRun(opaqueRunId: string): Promise<StoredAiContentRun | null>;
  /**
   * Transazione: verifica replay (stesso inputHash completed → replay), lease
   * (running valida altrui → running; scaduta → takeover), prenota budget e
   * scrive il run `running` con la lease del chiamante. Input diverso → conflict.
   */
  reserveRunAndBudget(params: {
    opaqueRunId: string;
    budgetReservationKey: string;
    inputHash: string;
    run: StoredAiContentRun;
    reserveMicroUsd: number;
    expiresAtMs: number;
    nowMs: number;
  }): Promise<ReserveOutcome>;
  /** Una sola chiamata provider per tentativo (retry ≤ 1 dentro l'implementazione). */
  callProvider(params: { request: AiContentRequest; model: string }): Promise<ProviderOutput>;
  /**
   * Finalizza: persiste output + costo reale e riconcilia il budget in
   * transazione, solo se la lease appartiene ancora a `executionId`.
   */
  finalizeRun(params: {
    opaqueRunId: string;
    budgetReservationKey: string;
    executionId: string;
    output: unknown;
    actualInputTokens: number | null;
    actualOutputTokens: number | null;
    actualCostMicroUsd: number;
    nowMs: number;
  }): Promise<'finalized' | 'lost_lease'>;
  /** Segna il run come `failed` e riconcilia (costo reale, anche 0), se lease valida. */
  failRun(params: {
    opaqueRunId: string;
    budgetReservationKey: string;
    executionId: string;
    actualCostMicroUsd: number;
    nowMs: number;
  }): Promise<void>;
}

export interface AiContentPreviewResult {
  kind: ContentKind;
  modelProfile: string;
  estimatedInputTokens: number;
  maxOutputTokens: number;
  estimatedCostMicroUsd: number;
  /** Solo per il pool: totale domande richieste. */
  requestedTotal: number | null;
}

export interface AiContentGenerateResult {
  status: 'completed';
  kind: ContentKind;
  modelProfile: string;
  output: unknown;
  actualCostMicroUsd: number | null;
  replayed: boolean;
}

function enforceConfigAndLimits(
  request: AiContentRequest,
  config: AiRuntimeConfig | null,
): {
  model: string;
  priceListVersion: string;
  estimatedInputTokens: number;
  maxOutputTokens: number;
  estimatedCostMicroUsd: number;
} {
  // 3. kill switch / feature flag.
  if (!config || !config.enabled) {
    throw new AiContentError('feature_disabled', 'La generazione IA è disattivata.');
  }
  // 6. risoluzione profilo → modello/listino (server-side, nessun fallback).
  const { model, priceListVersion } = resolveContentModel(request.modelProfile);
  // 7. stima e limiti.
  const estimate = estimateContentCost(request, model, priceListVersion);
  const totalTokens = estimate.estimatedInputTokens + estimate.maxOutputTokens;
  if (totalTokens > config.limits.maxEstimatedTokensPerOperation) {
    throw new AiContentError('limit_exceeded', 'La richiesta supera i token consentiti.');
  }
  if (estimate.breakdown.costMicroUsd > config.maxOperationCostMicroUsd) {
    throw new AiContentError(
      'operation_budget_exceeded',
      'Il costo stimato supera il limite per operazione.',
    );
  }
  return {
    model,
    priceListVersion,
    estimatedInputTokens: estimate.estimatedInputTokens,
    maxOutputTokens: estimate.maxOutputTokens,
    estimatedCostMicroUsd: estimate.breakdown.costMicroUsd,
  };
}

/**
 * PREVIEW (passi 1–7): nessuna chiamata provider, nessuna prenotazione, nessuna
 * scrittura. Applica gli stessi limiti del run e legge il budget disponibile.
 */
export async function previewContent(
  request: AiContentRequest,
  ctx: AiContentContext,
  ports: AiContentPorts,
): Promise<AiContentPreviewResult> {
  const config = await ports.loadRuntimeConfig();
  const resolved = enforceConfigAndLimits(request, config);
  const available = await ports.readAvailableBudgetMicroUsd();
  if (available === null) {
    throw new AiContentError('budget_unavailable', 'Budget non disponibile. Riprova più tardi.');
  }
  if (resolved.estimatedCostMicroUsd > available) {
    throw new AiContentError(
      'budget_exceeded',
      'Budget mensile insufficiente per questa generazione.',
    );
  }
  return {
    kind: request.kind,
    modelProfile: request.modelProfile,
    estimatedInputTokens: resolved.estimatedInputTokens,
    maxOutputTokens: resolved.maxOutputTokens,
    estimatedCostMicroUsd: resolved.estimatedCostMicroUsd,
    requestedTotal:
      request.kind === 'pool'
        ? request.counts.aperta + request.counts.chiusa_singola + request.counts.chiusa_multipla
        : null,
  };
}

/**
 * GENERATE (passi 1–14): ordine fail-closed. Una sola generazione logica; il
 * retry tecnico ≤ 1 è dentro `callProvider`. Idempotenza/replay tramite
 * `aiContentRuns/{opaqueRunId}`; budget prenotato prima del provider e
 * riconciliato dopo (l'output fatturabile ma invalido è contabilizzato senza
 * essere persistito come successo).
 */
export async function generateContent(
  request: AiContentRequest,
  ctx: AiContentContext,
  ports: AiContentPorts,
): Promise<AiContentGenerateResult> {
  const config = await ports.loadRuntimeConfig();
  const resolved = enforceConfigAndLimits(request, config);

  const opaqueRunId = computeOpaqueRunId(ctx.authenticatedOwnerUid, request.requestId);
  const budgetReservationKey = computeBudgetReservationKey(
    ctx.authenticatedOwnerUid,
    request.requestId,
  );
  const inputHash = computeInputHash(request);

  const runDoc: StoredAiContentRun = {
    contractVersion: AI_CONTENT_CONTRACT_VERSION,
    kind: request.kind,
    status: 'running',
    inputHash,
    modelProfile: request.modelProfile,
    model: resolved.model,
    priceListVersion: resolved.priceListVersion,
    estimatedInputTokens: resolved.estimatedInputTokens,
    maxOutputTokens: resolved.maxOutputTokens,
    actualInputTokens: null,
    actualOutputTokens: null,
    estimatedCostMicroUsd: resolved.estimatedCostMicroUsd,
    reservedCostMicroUsd: resolved.estimatedCostMicroUsd,
    actualCostMicroUsd: null,
    leaseExecutionId: ctx.executionId,
    leaseExpiresAtMs: ctx.nowMs + AI_CONTENT_LEASE_TTL_MS,
    output: null,
    createdAtMs: ctx.nowMs,
    updatedAtMs: ctx.nowMs,
    expireAtMs: ctx.nowMs + AI_CONTENT_RUN_TTL_MS,
  };

  // 8–9. run/lease/idempotenza + prenotazione budget (transazione).
  const outcome = await ports.reserveRunAndBudget({
    opaqueRunId,
    budgetReservationKey,
    inputHash,
    run: runDoc,
    reserveMicroUsd: resolved.estimatedCostMicroUsd,
    expiresAtMs: runDoc.leaseExpiresAtMs,
    nowMs: ctx.nowMs,
  });

  if (outcome.kind === 'replay_completed') {
    return {
      status: 'completed',
      kind: request.kind,
      modelProfile: request.modelProfile,
      output: outcome.run.output,
      actualCostMicroUsd: outcome.run.actualCostMicroUsd,
      replayed: true,
    };
  }
  if (outcome.kind === 'running') {
    throw new AiContentError('running', 'Generazione già in corso per questa richiesta.');
  }
  if (outcome.kind === 'conflict') {
    throw new AiContentError('run_conflict', 'Richiesta già usata con contenuti diversi.');
  }
  if (outcome.kind === 'budget') {
    throw new AiContentError(outcome.code, 'Budget insufficiente per la generazione.');
  }

  // 10. provider (una chiamata, retry ≤ 1 interno).
  let provider: ProviderOutput;
  try {
    provider = await ports.callProvider({ request, model: resolved.model });
  } catch {
    await ports.failRun({
      opaqueRunId,
      budgetReservationKey,
      executionId: ctx.executionId,
      actualCostMicroUsd: 0,
      nowMs: ctx.nowMs,
    });
    throw new AiContentError(
      'provider_unavailable',
      'Il servizio di generazione non è disponibile. Riprova.',
    );
  }

  // Costo reale (fatturabile anche se l'output sarà invalido).
  const usage = normalizeUsageActual(provider.usage ?? undefined);
  const actualInputTokens = usage?.inputTokens ?? null;
  const actualOutputTokens = usage?.outputTokens ?? null;
  const actual =
    usage === null
      ? 0
      : (actualCostMicroUsd(
          usage.inputTokens,
          usage.outputTokens,
          resolved.priceListVersion,
          resolved.model,
        ) ?? 0);

  // 11. validazione output (fail-closed, rifiuto integrale).
  let output: unknown;
  try {
    output =
      request.kind === 'pool'
        ? validatePoolProposal(provider.output, request.counts, request.level)
        : validateLessonProposal(provider.output);
  } catch (e) {
    // Output fatturabile ma invalido: contabilizza il costo, NON persistere come successo.
    await ports.failRun({
      opaqueRunId,
      budgetReservationKey,
      executionId: ctx.executionId,
      actualCostMicroUsd: actual,
      nowMs: ctx.nowMs,
    });
    if (e instanceof AiContentError) throw e;
    throw new AiContentError('provider_invalid_output', 'La risposta generata non è valida.');
  }

  // Cap prudenziale della dimensione complessiva del documento run.
  if (utf8ByteLength(JSON.stringify(output)) > AI_CONTENT_LIMITS.MAX_RUN_DOCUMENT_BYTES) {
    await ports.failRun({
      opaqueRunId,
      budgetReservationKey,
      executionId: ctx.executionId,
      actualCostMicroUsd: actual,
      nowMs: ctx.nowMs,
    });
    throw new AiContentError('output_too_large', 'Il risultato supera il limite di dimensione.');
  }

  // 12–14. persistenza + riconciliazione + finalizzazione (solo se lease ancora mia).
  const finalized = await ports.finalizeRun({
    opaqueRunId,
    budgetReservationKey,
    executionId: ctx.executionId,
    output,
    actualInputTokens,
    actualOutputTokens,
    actualCostMicroUsd: actual,
    nowMs: ctx.nowMs,
  });
  if (finalized === 'lost_lease') {
    // Un worker più recente ha preso il run: non sovrascrivere né ri-riconciliare.
    throw new AiContentError('running', 'Generazione ripresa da un altro tentativo.');
  }

  return {
    status: 'completed',
    kind: request.kind,
    modelProfile: request.modelProfile,
    output,
    actualCostMicroUsd: actual,
    replayed: false,
  };
}
