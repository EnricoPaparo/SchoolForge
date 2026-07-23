/**
 * AIGEN-01 — runner **generico** di una chiamata OpenAI Responses API con
 * Structured Output. Riusa **senza duplicare** il transport già collaudato dalla
 * correzione IA (`OpenAiTransport`/`createOpenAiSdkTransport`), la policy di
 * retry pura (`decideRetry`/`computeBackoffMs`/`parseRetryAfterMs`), il timeout
 * per-tentativo e la classificazione degli errori (`normalizeTransportError`).
 *
 * Non è un nuovo client HTTP e non reimplementa il backoff: orchestra soltanto i
 * moduli esistenti attorno a un payload arbitrario, restituendo un **esito
 * tipizzato** che distingue gli errori **certamente pre-invocazione** (nessun
 * costo) da quelli **a invocazione incerta** (la richiesta può aver raggiunto il
 * provider → settlement conservativo). La correzione IA continua a usare il
 * proprio loop in `OpenAiGrader`: qui non viene toccata.
 */

import {
  ATTEMPT_HARD_ABORT_MARGIN_MS,
  DEFAULT_OPENAI_RETRY_POLICY,
  abortableSleep,
  normalizeTransportError,
  type OpenAiStructuredRequest,
  type OpenAiTransport,
} from './openAiGrader.js';
import { decideRetry, type RetryPolicy } from './openAiRetryPolicy.js';

export interface StructuredRunnerDeps {
  policy?: RetryPolicy;
  now?: () => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  random?: () => number;
}

/** Esito **tipizzato** del runner: distingue pre-invocazione da invocazione incerta. */
export type StructuredRunOutcome =
  | {
      status: 'ok';
      outputText: string;
      usage: { inputTokens: number; outputTokens: number } | null;
    }
  /** La richiesta **certamente non** ha raggiunto il provider: nessun costo. */
  | { status: 'pre_invocation' }
  /** La richiesta **può** aver raggiunto il provider: settlement conservativo. */
  | { status: 'invocation_unknown' };

/** Numero massimo di tentativi complessivi (1 + retry) per una policy. */
export function maxAttemptsForPolicy(policy: RetryPolicy): number {
  return 1 + Math.max(0, policy.maxRetries);
}

/**
 * Esegue la chiamata con l'**unica** policy di retry applicativa (SDK a
 * `maxRetries: 0`): al massimo `policy.maxRetries` retry su soli errori
 * transitori, con backoff+jitter e rispetto prudente di `Retry-After`. Ritorna un
 * esito tipizzato invece di lanciare, così il chiamante decide il settlement.
 */
export async function runStructuredCall(
  transport: OpenAiTransport,
  request: OpenAiStructuredRequest,
  deps: StructuredRunnerDeps = {},
): Promise<StructuredRunOutcome> {
  const policy = deps.policy ?? DEFAULT_OPENAI_RETRY_POLICY;
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? abortableSleep;
  const random = deps.random ?? Math.random;

  // `true` non appena un tentativo può aver generato costo: da lì in poi l'esito
  // finale è `invocation_unknown` anche se l'ultimo errore fosse pre-invocazione.
  let anyBillingRisk = false;

  for (let attemptIndex = 0; ; attemptIndex++) {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      policy.attemptTimeoutMs + ATTEMPT_HARD_ABORT_MARGIN_MS,
    );
    try {
      const response = await transport.send(request, {
        timeoutMs: policy.attemptTimeoutMs,
        signal: controller.signal,
      });
      return {
        status: 'ok',
        outputText: response.outputText,
        usage: response.usage
          ? { inputTokens: response.usage.inputTokens, outputTokens: response.usage.outputTokens }
          : null,
      };
    } catch (error) {
      const transportError = normalizeTransportError(error);
      if (transportError.billingRisk) anyBillingRisk = true;
      const decision = decideRetry({
        error: transportError,
        attemptIndex,
        policy,
        remainingMs: Number.POSITIVE_INFINITY,
        random,
      });
      if (!decision.retry) {
        return anyBillingRisk ? { status: 'invocation_unknown' } : { status: 'pre_invocation' };
      }
      try {
        await sleep(decision.delayMs);
      } catch {
        return anyBillingRisk ? { status: 'invocation_unknown' } : { status: 'pre_invocation' };
      }
    } finally {
      clearTimeout(timer);
    }
    // `now` è iniettato solo per i test deterministici; il loop non lo consulta
    // direttamente ma lo espone per coerenza con gli altri runner.
    void now;
  }
}
