/**
 * M5-05D2B-2 — policy **pura** e centralizzata del retry applicativo del provider
 * OpenAI. È l'**unica** policy di retry di SchoolForge: l'SDK OpenAI gira sempre
 * con `maxRetries: 0` (una sola richiesta per tentativo). Al massimo **un** retry
 * applicativo (≤ 2 tentativi complessivi), con backoff esponenziale + jitter,
 * rispetto prudente di `Retry-After` e deadline complessiva.
 *
 * Nessuna dipendenza da rete, orologio o `Math.random`: `random`, `sleep` e il
 * clock sono **iniettati** dal chiamante, così i test sono deterministici. Tutte
 * le durate sono in **millisecondi**.
 *
 * L'insieme dei transitori ritentabili è allineato al comportamento ufficiale
 * dell'SDK (connessione, 408, 409, 429, ≥ 500 — vedi
 * https://github.com/openai/openai-node#retries): li ritentiamo **noi**, non l'SDK.
 */

/** Ritardo base del backoff esponenziale. */
export const RETRY_BASE_DELAY_MS = 500;
/** Cap del ritardo di backoff (prudente: attese brevi, costi Function bassi). */
export const RETRY_MAX_DELAY_MS = 4_000;
/**
 * Massima attesa `Retry-After` che accettiamo di rispettare automaticamente.
 * Oltre questo, non dormiamo per tempi arbitrari: si interrompe il retry
 * automatico e si restituisce un errore ritentabile **manualmente**.
 */
export const RETRY_MAX_RETRY_AFTER_MS = 8_000;
/** Sanity cap assoluto per qualsiasi valore `Retry-After` (24h): oltre ⇒ ignorato. */
const RETRY_AFTER_SANITY_MAX_MS = 24 * 60 * 60 * 1000;

/** Politica di retry risolta dalla configurazione runtime + costanti prudenti. */
export interface RetryPolicy {
  /** Numero massimo di retry applicativi (0 o 1; hard ceiling DEV = 1). */
  maxRetries: number;
  /** Timeout per singolo tentativo (ms, ≤ 60_000, dalla config runtime). */
  attemptTimeoutMs: number;
  baseDelayMs: number;
  maxDelayMs: number;
  maxRetryAfterMs: number;
}

/** Codici motivo **aggregati** e privacy-safe (nessun dato personale). */
export type RetryReasonCode =
  | 'connection'
  | 'timeout'
  | 'http_408'
  | 'http_409'
  | 'http_429'
  | 'http_5xx';

/** Interfaccia minima dell'errore di trasporto classificato (evita cicli di import). */
export interface ClassifiedTransportError {
  transient: boolean;
  status?: number;
  retryAfterMs?: number;
}

/**
 * Legge in modo **difensivo** un header da un contenitore di forma ignota
 * (oggetto piatto o `Headers`-like con `.get`). Ritorna la prima stringa non
 * vuota trovata, o `null`.
 */
export function readHeader(headers: unknown, name: string): string | null {
  if (!headers || typeof headers !== 'object') return null;
  const lower = name.toLowerCase();
  const anyHeaders = headers as { get?: (n: string) => unknown } & Record<string, unknown>;
  if (typeof anyHeaders.get === 'function') {
    try {
      const v = anyHeaders.get(name) ?? anyHeaders.get(lower);
      if (typeof v === 'string' && v.trim().length > 0) return v;
    } catch {
      // header container non conforme: si prosegue con la lettura piatta
    }
  }
  for (const key of Object.keys(anyHeaders)) {
    if (key.toLowerCase() === lower) {
      const v = anyHeaders[key];
      if (typeof v === 'string' && v.trim().length > 0) return v;
    }
  }
  return null;
}

function finitePositiveOrNull(value: number): number | null {
  if (!Number.isFinite(value) || value < 0 || value > RETRY_AFTER_SANITY_MAX_MS) return null;
  return value;
}

/**
 * Parsing **puro** di `Retry-After` in millisecondi da un contenitore di header.
 * Supporta, in ordine di priorità:
 * 1. `retry-after-ms` (millisecondi interi);
 * 2. `Retry-After` in **secondi** (intero);
 * 3. `Retry-After` come **HTTP-date** (differenza da `nowMs`).
 * Valori assenti, non numerici, `NaN`/`Infinity`, negativi o assurdamente grandi
 * (> 24h) ⇒ `null` (il chiamante userà il backoff applicativo).
 */
export function parseRetryAfterMs(headers: unknown, nowMs: number): number | null {
  const ms = readHeader(headers, 'retry-after-ms');
  if (ms !== null) {
    const parsed = Number(ms);
    if (Number.isFinite(parsed)) return finitePositiveOrNull(Math.round(parsed));
  }
  const retryAfter = readHeader(headers, 'retry-after');
  if (retryAfter === null) return null;
  const trimmed = retryAfter.trim();
  if (/^\d+$/.test(trimmed)) {
    return finitePositiveOrNull(Number(trimmed) * 1000);
  }
  const dateMs = Date.parse(trimmed);
  if (Number.isNaN(dateMs)) return null;
  return finitePositiveOrNull(dateMs - nowMs);
}

/**
 * Backoff esponenziale con **full jitter**: `delay = random() × min(maxDelay,
 * base × 2^attemptIndex)`. `random` è iniettato ([0,1)). Il risultato è finito,
 * non negativo e ≤ `maxDelay`. `attemptIndex` è l'indice (0-based) del tentativo
 * appena fallito.
 */
export function computeBackoffMs(
  attemptIndex: number,
  policy: Pick<RetryPolicy, 'baseDelayMs' | 'maxDelayMs'>,
  random: () => number,
): number {
  const exponential = policy.baseDelayMs * 2 ** Math.max(0, attemptIndex);
  const capped = Math.min(policy.maxDelayMs, exponential);
  const r = random();
  const factor = Number.isFinite(r) ? Math.min(1, Math.max(0, r)) : 1;
  return Math.max(0, Math.round(capped * factor));
}

/** Codice motivo aggregato da un errore transitorio classificato. */
export function retryReasonCode(error: ClassifiedTransportError): RetryReasonCode {
  switch (error.status) {
    case 408:
      return 'http_408';
    case 409:
      return 'http_409';
    case 429:
      return 'http_429';
    default:
      if (error.status !== undefined && error.status >= 500) return 'http_5xx';
      // Nessuno status: connessione o timeout di trasporto.
      return 'timeout';
  }
}

export type RetryDecision =
  | { retry: false; blockedByRetryAfter?: boolean }
  | { retry: true; delayMs: number; reasonCode: RetryReasonCode };

/**
 * Decide se ritentare il tentativo appena fallito. Regole:
 * - non transitorio ⇒ **no retry** (fail-closed);
 * - allotment esaurito (`attemptIndex ≥ maxRetries`) ⇒ no retry;
 * - `Retry-After` valido e ≤ `maxRetryAfterMs` ⇒ delay = `Retry-After`;
 * - `Retry-After` presente ma **oltre** il cap ⇒ **no retry automatico**
 *   (`blockedByRetryAfter: true`): il gateway restituirà un errore ritentabile
 *   manualmente, senza dormire per tempi arbitrari;
 * - altrimenti delay = backoff esponenziale + jitter;
 * - se `delay + attemptTimeoutMs > remainingMs` (deadline) ⇒ no retry.
 */
export function decideRetry(params: {
  error: ClassifiedTransportError;
  attemptIndex: number;
  policy: RetryPolicy;
  remainingMs: number;
  random: () => number;
}): RetryDecision {
  const { error, attemptIndex, policy, remainingMs, random } = params;
  if (!error.transient) return { retry: false };
  if (attemptIndex >= policy.maxRetries) return { retry: false };

  let delayMs: number;
  if (error.retryAfterMs !== undefined && error.retryAfterMs !== null) {
    if (error.retryAfterMs > policy.maxRetryAfterMs) {
      return { retry: false, blockedByRetryAfter: true };
    }
    delayMs = Math.max(0, Math.round(error.retryAfterMs));
  } else {
    delayMs = computeBackoffMs(attemptIndex, policy, random);
  }

  // Deadline: non iniziare un retry se non c'è tempo per delay + tentativo.
  if (delayMs + policy.attemptTimeoutMs > remainingMs) return { retry: false };

  return { retry: true, delayMs, reasonCode: retryReasonCode(error) };
}
