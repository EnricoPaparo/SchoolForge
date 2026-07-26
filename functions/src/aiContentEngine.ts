/**
 * AIGEN-01 — motore **puro** della generazione contenuti. Nessun Firestore/rete
 * qui: le operazioni con effetti sono **porte iniettate** (`AiContentPorts`), così
 * l'ordine fail-closed, l'idempotenza/replay, la lease, la macchina
 * reserved→pending→reconciled e l'integrazione budget sono testabili senza
 * emulatori. La materializzazione `schoolforge-pool/v2` (mapper ID + `parsePool`)
 * NON è qui: è di AIGEN-02, nel web.
 */

import {
  AiContentError,
  AI_CONTENT_CONTRACT_VERSION,
  AI_CONTENT_LIMITS,
  AI_CONTENT_RUN_TTL_MS,
  computeBudgetReservationKey,
  computeInputHash,
  computeOpaqueRunId,
  resolveContentModel,
  utf8ByteLength,
  type AiContentMode,
  type AiContentRequest,
  type ContentKind,
} from './aiContentCore.js';
import { estimateContentCost } from './aiContentCost.js';
import { validateLessonProposal, validatePoolProposal } from './aiContentValidation.js';
import { actualCostMicroUsd, normalizeUsageActual } from './aiCorrectionCost.js';
import type { AiRuntimeConfig } from './aiCorrectionRuntimeConfig.js';
import type { ContentProviderOutcome } from './aiContentProvider.js';
import { DEFAULT_OPENAI_RETRY_POLICY, ATTEMPT_HARD_ABORT_MARGIN_MS } from './openAiGrader.js';
import type { RetryPolicy } from './openAiRetryPolicy.js';

/**
 * Durata lease derivata dal **massimo percorso timeout+retry**: per ogni
 * tentativo il timeout SDK più il margine di hard-abort, più i backoff massimi fra
 * i retry, più un margine di finalizzazione. Non può scadere durante l'intera
 * finestra provider (AIGEN-01-REVIEW-FIX §7).
 */
export const AI_CONTENT_FINALIZATION_MARGIN_MS = 20_000;

export function computeContentLeaseTtlMs(policy: RetryPolicy): number {
  const attempts = 1 + Math.max(0, policy.maxRetries);
  const perAttempt = policy.attemptTimeoutMs + ATTEMPT_HARD_ABORT_MARGIN_MS;
  const backoffAllowance = Math.max(0, policy.maxRetries) * policy.maxDelayMs;
  const derived = attempts * perAttempt + backoffAllowance + AI_CONTENT_FINALIZATION_MARGIN_MS;
  // Tetto conservativo documentato: mai inferiore all'intera finestra provider.
  return Math.max(derived, 300_000);
}

/** Lease di default (policy DEV: timeout 60 s, 1 retry) — ≈ 5 minuti. */
export const AI_CONTENT_LEASE_TTL_MS = computeContentLeaseTtlMs(DEFAULT_OPENAI_RETRY_POLICY);

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
  /** Tetto conservativo prenotato al ledger. */
  reservedCostMicroUsd: number;
  /** Importo effettivamente contabilizzato (≤ reserved). */
  settledCostMicroUsd: number | null;
  /** Costo effettivo noto (null se ignoto → settlement conservativo). */
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
  /** Modalità server-side risolta (AI_CONTENT_MODE). */
  mode: AiContentMode;
  /** Durata lease (ms), derivata dalla policy retry runtime. */
  leaseMs: number;
}

/** Esito della prenotazione run+budget in transazione (idempotente). */
export type ReserveOutcome =
  | { kind: 'reserved'; reservedMicroUsd: number }
  | { kind: 'replay_completed'; run: StoredAiContentRun }
  | { kind: 'running' }
  | { kind: 'conflict' }
  | { kind: 'budget'; code: 'budget_exceeded' | 'daily_budget_exceeded' | 'budget_unavailable' };

/**
 * Porte con effetti. Ogni metodo è una singola operazione mockabile. Il gateway
 * concreto (Admin SDK + provider Responses API) le implementa.
 */
export interface AiContentPorts {
  /** Config runtime (kill switch/limiti/budget). `null` ⇒ provider disabilitato. */
  loadRuntimeConfig(): Promise<AiRuntimeConfig | null>;
  /** Disponibilità budget in sola lettura (µUSD), per la preview. */
  readAvailableBudgetMicroUsd(): Promise<number | null>;
  /** Legge il run esistente (parser fail-closed nel gateway). */
  loadRun(opaqueRunId: string): Promise<StoredAiContentRun | null>;
  /**
   * Transazione: replay (stesso inputHash completed → replay), lease (running
   * valida altrui → running; scaduta → takeover), prenota il budget come
   * **reserved** (NON pending) e scrive il run `running`. Input diverso → conflict.
   * Documento tecnico esistente malformato/legacy → conflict (mai replay).
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
  /**
   * Transizione `reserved → pending` **gated dalla lease**, immediatamente prima
   * dell'invocazione provider. `false` ⇒ lease persa (takeover): il provider NON
   * va chiamato.
   */
  markProviderPending(params: {
    opaqueRunId: string;
    budgetReservationKey: string;
    executionId: string;
    nowMs: number;
  }): Promise<boolean>;
  /** Una sola chiamata provider per operazione (retry interno al provider). */
  callProvider(params: {
    request: AiContentRequest;
    model: string;
  }): Promise<ContentProviderOutcome>;
  /**
   * Finalizza: persiste output + costo reale e riconcilia (reconcile al costo
   * effettivo) in transazione, solo se la lease appartiene ancora a `executionId`.
   */
  finalizeRun(params: {
    opaqueRunId: string;
    budgetReservationKey: string;
    executionId: string;
    output: unknown;
    actualInputTokens: number | null;
    actualOutputTokens: number | null;
    /** Costo effettivo noto, o `null` se non conoscibile (priorBillingRisk). */
    actualCostMicroUsd: number | null;
    settledMicroUsd: number;
    nowMs: number;
  }): Promise<'finalized' | 'lost_lease'>;
  /** Segna `failed` e riconcilia al `settledMicroUsd` (0 o tetto conservativo). */
  failRun(params: {
    opaqueRunId: string;
    budgetReservationKey: string;
    executionId: string;
    actualInputTokens: number | null;
    actualOutputTokens: number | null;
    actualCostMicroUsd: number | null;
    settledMicroUsd: number;
    nowMs: number;
  }): Promise<void>;
}

export interface AiContentPreviewResult {
  kind: ContentKind;
  modelProfile: string;
  estimatedInputTokens: number;
  maxOutputTokens: number;
  estimatedCostMicroUsd: number;
  /** Tetto conservativo che il run prenoterebbe (trasparenza UI). */
  reservationCostMicroUsd: number;
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

interface ResolvedCost {
  model: string;
  priceListVersion: string;
  estimatedInputTokens: number;
  maxOutputTokens: number;
  estimatedCostMicroUsd: number;
  reservationCostMicroUsd: number;
}

/** Numero massimo di tentativi complessivi (1 + retry) dalla config runtime. */
function maxAttemptsFromConfig(config: AiRuntimeConfig): number {
  return 1 + Math.max(0, config.limits.maxApplicationRetries);
}

function enforceConfigAndLimits(
  request: AiContentRequest,
  config: AiRuntimeConfig | null,
): ResolvedCost {
  // 3. kill switch / feature flag runtime.
  if (!config || !config.enabled) {
    throw new AiContentError('feature_disabled', 'La generazione IA è disattivata.');
  }
  // 6. risoluzione profilo → modello/listino (server-side, nessun fallback).
  const { model, priceListVersion } = resolveContentModel(request.modelProfile);
  // 7. stima informativa + prenotazione conservativa (× tentativi).
  const estimate = estimateContentCost(
    request,
    model,
    priceListVersion,
    maxAttemptsFromConfig(config),
  );
  const totalTokens = estimate.estimatedInputTokens + estimate.maxOutputTokens;
  if (totalTokens > config.limits.maxEstimatedTokensPerOperation) {
    throw new AiContentError('limit_exceeded', 'La richiesta supera i token consentiti.');
  }
  if (estimate.reservationCostMicroUsd > config.maxOperationCostMicroUsd) {
    throw new AiContentError(
      'operation_budget_exceeded',
      'Il costo prenotato supera il limite per operazione.',
    );
  }
  return {
    model,
    priceListVersion,
    estimatedInputTokens: estimate.estimatedInputTokens,
    maxOutputTokens: estimate.maxOutputTokens,
    estimatedCostMicroUsd: estimate.estimatedCostMicroUsd,
    reservationCostMicroUsd: estimate.reservationCostMicroUsd,
  };
}

/**
 * PREVIEW: nessuna chiamata provider, nessuna prenotazione, nessuna scrittura,
 * nessun accesso al secret. `mode === 'disabled'` ⇒ `feature_disabled` **prima**
 * di ogni altra cosa. Applica gli stessi limiti del run e legge (sola lettura) il
 * budget disponibile.
 */
export async function previewContent(
  request: AiContentRequest,
  ctx: AiContentContext,
  ports: AiContentPorts,
): Promise<AiContentPreviewResult> {
  if (ctx.mode === 'disabled') {
    throw new AiContentError('feature_disabled', 'La generazione IA è disattivata.');
  }
  const config = await ports.loadRuntimeConfig();
  const resolved = enforceConfigAndLimits(request, config);
  const available = await ports.readAvailableBudgetMicroUsd();
  if (available === null) {
    throw new AiContentError('budget_unavailable', 'Budget non disponibile. Riprova più tardi.');
  }
  // La preview mostra la stima realistica; verifica però la fattibilità sul tetto
  // conservativo che il run prenoterebbe.
  if (resolved.reservationCostMicroUsd > available) {
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
    reservationCostMicroUsd: resolved.reservationCostMicroUsd,
    requestedTotal:
      request.kind === 'pool'
        ? request.counts.aperta + request.counts.chiusa_singola + request.counts.chiusa_multipla
        : null,
  };
}

/** Bound prudenziale UTF-8 del **documento run completo** che verrebbe persistito. */
function wholeRunDocumentBytes(run: StoredAiContentRun, output: unknown): number {
  const candidate = { ...run, status: 'completed', output };
  // Overhead documentato: nomi campi Firestore, wrapper Timestamp, margine di
  // sicurezza. `JSON.stringify` misura output + metadati + hash + costi + lease.
  const SAFETY_OVERHEAD_BYTES = 4_096;
  return utf8ByteLength(JSON.stringify(candidate)) + SAFETY_OVERHEAD_BYTES;
}

/**
 * GENERATE: ordine fail-closed con macchina budget reserved → pending →
 * reconciled. `reserve` NON marca pending; `markProviderPending` (gated dalla
 * lease) precede la chiamata provider; il settlement (finalize/fail) è gated dalla
 * lease. Idempotenza/replay via `aiContentRuns/{opaqueRunId}`.
 */
export async function generateContent(
  request: AiContentRequest,
  ctx: AiContentContext,
  ports: AiContentPorts,
): Promise<AiContentGenerateResult> {
  if (ctx.mode === 'disabled') {
    throw new AiContentError('feature_disabled', 'La generazione IA è disattivata.');
  }
  const config = await ports.loadRuntimeConfig();
  const resolved = enforceConfigAndLimits(request, config);

  const opaqueRunId = computeOpaqueRunId(ctx.authenticatedOwnerUid, request.requestId);
  const budgetReservationKey = computeBudgetReservationKey(
    ctx.authenticatedOwnerUid,
    request.requestId,
  );
  const inputHash = computeInputHash(request);
  const leaseExpiresAtMs = ctx.nowMs + ctx.leaseMs;

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
    reservedCostMicroUsd: resolved.reservationCostMicroUsd,
    settledCostMicroUsd: null,
    actualCostMicroUsd: null,
    leaseExecutionId: ctx.executionId,
    leaseExpiresAtMs,
    output: null,
    createdAtMs: ctx.nowMs,
    updatedAtMs: ctx.nowMs,
    expireAtMs: ctx.nowMs + AI_CONTENT_RUN_TTL_MS,
  };

  // 8–9. run/lease/idempotenza + prenotazione budget **reserved** (transazione).
  const outcome = await ports.reserveRunAndBudget({
    opaqueRunId,
    budgetReservationKey,
    inputHash,
    run: runDoc,
    reserveMicroUsd: resolved.reservationCostMicroUsd,
    expiresAtMs: leaseExpiresAtMs,
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

  const reservationCap = resolved.reservationCostMicroUsd;

  // 10. reserved → pending, gated dalla lease. Se la lease è persa, il provider
  // NON viene chiamato (nessun costo).
  const canProceed = await ports.markProviderPending({
    opaqueRunId,
    budgetReservationKey,
    executionId: ctx.executionId,
    nowMs: ctx.nowMs,
  });
  if (!canProceed) {
    throw new AiContentError('running', 'Generazione ripresa da un altro tentativo.');
  }

  // 11. provider (esito tipizzato: pre-invocazione vs invocazione incerta).
  const providerOutcome = await ports.callProvider({ request, model: resolved.model });

  if (providerOutcome.status === 'error') {
    // pre_invocation → costo 0 (release); invocation_unknown → settlement
    // conservativo del tetto prenotato (il provider può aver elaborato).
    const settled = providerOutcome.phase === 'invocation_unknown' ? reservationCap : 0;
    await ports.failRun({
      opaqueRunId,
      budgetReservationKey,
      executionId: ctx.executionId,
      actualInputTokens: null,
      actualOutputTokens: null,
      actualCostMicroUsd: null,
      settledMicroUsd: settled,
      nowMs: ctx.nowMs,
    });
    if (providerOutcome.reason === 'max_output_tokens') {
      throw new AiContentError(
        'output_too_large',
        'La generazione ha raggiunto il limite di output. Riduci il numero di domande e riprova.',
      );
    }
    throw new AiContentError(
      'provider_unavailable',
      providerOutcome.reason === 'content_filter'
        ? 'La generazione è stata interrotta dai controlli di sicurezza.'
        : 'Il servizio di generazione non è disponibile. Riprova.',
    );
  }

  // Costo effettivo dall'usage (mai inventato). `priorBillingRisk` (un tentativo
  // precedente incerto poi ritentato con successo) rende il **totale** non
  // conoscibile: si salva il contenuto valido ma `actualCost` resta `null` e il
  // settlement è il tetto conservativo (mai sotto-contabilizzare).
  const priorBillingRisk = providerOutcome.metered && providerOutcome.priorBillingRisk;
  let actualInputTokens: number | null = null;
  let actualOutputTokens: number | null = null;
  let actualCost: number | null;
  let settledCost: number;
  if (!providerOutcome.metered) {
    // mock → costo zero autorevole.
    actualInputTokens = 0;
    actualOutputTokens = 0;
    actualCost = 0;
    settledCost = 0;
  } else if (priorBillingRisk) {
    // Tentativo incerto seguito da retry riuscito: costo totale ignoto.
    actualInputTokens = null;
    actualOutputTokens = null;
    actualCost = null;
    settledCost = reservationCap;
  } else {
    const usage = normalizeUsageActual(providerOutcome.usage ?? undefined);
    if (usage === null) {
      // openai completed senza usage valido (nessun tentativo incerto prima):
      // fail-closed + settlement conservativo.
      await ports.failRun({
        opaqueRunId,
        budgetReservationKey,
        executionId: ctx.executionId,
        actualInputTokens: null,
        actualOutputTokens: null,
        actualCostMicroUsd: null,
        settledMicroUsd: reservationCap,
        nowMs: ctx.nowMs,
      });
      throw new AiContentError(
        'provider_invalid_output',
        'La risposta generata non riporta un consumo valido.',
      );
    }
    actualInputTokens = usage.inputTokens;
    actualOutputTokens = usage.outputTokens;
    actualCost =
      actualCostMicroUsd(
        usage.inputTokens,
        usage.outputTokens,
        resolved.priceListVersion,
        resolved.model,
      ) ?? 0;
    settledCost = actualCost;
  }

  // 12. validazione output (fail-closed, rifiuto integrale). Costo già fatturato →
  // contabilizzato (conservativo se priorBillingRisk), nessun output completed.
  let output: unknown;
  try {
    output =
      request.kind === 'pool'
        ? validatePoolProposal(providerOutcome.output, request.counts, request.level)
        : validateLessonProposal(providerOutcome.output);
  } catch (e) {
    await ports.failRun({
      opaqueRunId,
      budgetReservationKey,
      executionId: ctx.executionId,
      actualInputTokens,
      actualOutputTokens,
      actualCostMicroUsd: actualCost,
      settledMicroUsd: settledCost,
      nowMs: ctx.nowMs,
    });
    if (e instanceof AiContentError) {
      // Diagnostica sanitizzata: nessun prompt, contenuto, UID o requestId.
      console.warn('ai_content_pool_validation_failed', {
        kind: request.kind,
        reason: e.message,
      });
      throw e;
    }
    throw new AiContentError('provider_invalid_output', 'La risposta generata non è valida.');
  }

  // 13. bound prudenziale del **documento run completo** (< 1 MiB).
  if (wholeRunDocumentBytes(runDoc, output) > AI_CONTENT_LIMITS.MAX_RUN_DOCUMENT_BYTES) {
    await ports.failRun({
      opaqueRunId,
      budgetReservationKey,
      executionId: ctx.executionId,
      actualInputTokens,
      actualOutputTokens,
      actualCostMicroUsd: actualCost,
      settledMicroUsd: settledCost,
      nowMs: ctx.nowMs,
    });
    throw new AiContentError('output_too_large', 'Il risultato supera il limite di dimensione.');
  }

  // 14. persistenza + riconciliazione + finalizzazione (solo se la lease è ancora
  // mia). Con priorBillingRisk: contenuto salvato, `actualCost` null, settlement
  // al tetto conservativo.
  const finalized = await ports.finalizeRun({
    opaqueRunId,
    budgetReservationKey,
    executionId: ctx.executionId,
    output,
    actualInputTokens,
    actualOutputTokens,
    actualCostMicroUsd: actualCost,
    settledMicroUsd: settledCost,
    nowMs: ctx.nowMs,
  });
  if (finalized === 'lost_lease') {
    throw new AiContentError('running', 'Generazione ripresa da un altro tentativo.');
  }

  return {
    status: 'completed',
    kind: request.kind,
    modelProfile: request.modelProfile,
    output,
    actualCostMicroUsd: actualCost,
    replayed: false,
  };
}
