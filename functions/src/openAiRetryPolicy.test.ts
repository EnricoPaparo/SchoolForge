import { describe, expect, it } from 'vitest';
import {
  RETRY_BASE_DELAY_MS,
  RETRY_MAX_DELAY_MS,
  RETRY_MAX_RETRY_AFTER_MS,
  computeBackoffMs,
  decideRetry,
  parseRetryAfterMs,
  readHeader,
  retryReasonCode,
  type ClassifiedTransportError,
  type RetryPolicy,
} from './openAiRetryPolicy.js';

const POLICY: RetryPolicy = {
  maxRetries: 1,
  attemptTimeoutMs: 60_000,
  baseDelayMs: RETRY_BASE_DELAY_MS,
  maxDelayMs: RETRY_MAX_DELAY_MS,
  maxRetryAfterMs: RETRY_MAX_RETRY_AFTER_MS,
};

// ── readHeader (difensivo) ────────────────────────────────────────────────────

describe('readHeader', () => {
  it('reads from a flat object case-insensitively', () => {
    expect(readHeader({ 'Retry-After': '3' }, 'retry-after')).toBe('3');
    expect(readHeader({ 'retry-after-ms': '1500' }, 'Retry-After-Ms')).toBe('1500');
  });
  it('reads from a Headers-like get()', () => {
    const headers = { get: (n: string) => (n.toLowerCase() === 'retry-after' ? '5' : null) };
    expect(readHeader(headers, 'retry-after')).toBe('5');
  });
  it('returns null for missing/empty/non-object', () => {
    expect(readHeader(undefined, 'retry-after')).toBeNull();
    expect(readHeader({}, 'retry-after')).toBeNull();
    expect(readHeader({ 'retry-after': '   ' }, 'retry-after')).toBeNull();
  });
});

// ── parseRetryAfterMs ─────────────────────────────────────────────────────────

describe('parseRetryAfterMs', () => {
  const now = Date.UTC(2026, 6, 17, 12, 0, 0);

  it('prefers retry-after-ms (milliseconds)', () => {
    expect(parseRetryAfterMs({ 'retry-after-ms': '1500' }, now)).toBe(1500);
  });
  it('parses Retry-After in seconds', () => {
    expect(parseRetryAfterMs({ 'retry-after': '3' }, now)).toBe(3000);
  });
  it('parses Retry-After as HTTP-date (difference from now)', () => {
    const future = new Date(now + 4000).toUTCString();
    expect(parseRetryAfterMs({ 'retry-after': future }, now)).toBe(4000);
  });
  it('returns null for absent, invalid, negative, NaN or Infinity values (→ fallback)', () => {
    expect(parseRetryAfterMs({}, now)).toBeNull();
    expect(parseRetryAfterMs({ 'retry-after': 'soon' }, now)).toBeNull();
    expect(parseRetryAfterMs({ 'retry-after-ms': 'NaN' }, now)).toBeNull();
    expect(parseRetryAfterMs({ 'retry-after-ms': 'Infinity' }, now)).toBeNull();
    expect(parseRetryAfterMs({ 'retry-after-ms': '-500' }, now)).toBeNull();
    // Data nel passato → differenza negativa → null.
    expect(
      parseRetryAfterMs({ 'retry-after': new Date(now - 5000).toUTCString() }, now),
    ).toBeNull();
  });
  it('keeps a syntactically valid but huge value (clamped to the sanity cap, not null)', () => {
    // 48h è valido ma enorme: NON deve diventare null (sarebbe scambiato per
    // header assente → backoff). Resta un numero, clampato al sanity cap (24h),
    // così decideRetry lo vede oltre il cap automatico e blocca il retry.
    const parsed = parseRetryAfterMs({ 'retry-after-ms': String(48 * 3600 * 1000) }, now);
    expect(parsed).toBe(24 * 3600 * 1000);
    expect(parsed).not.toBeNull();
  });
});

// ── computeBackoffMs ──────────────────────────────────────────────────────────

describe('computeBackoffMs', () => {
  it('is deterministic with injected random and respects the cap', () => {
    // base 500, attemptIndex 0 → cap min(4000, 500) = 500; random 0.5 → 250.
    expect(computeBackoffMs(0, POLICY, () => 0.5)).toBe(250);
    // attemptIndex 4 → 500*16=8000 capped a 4000; random 1 → 4000.
    expect(computeBackoffMs(4, POLICY, () => 1)).toBe(4000);
    // random 0 → 0 (full jitter).
    expect(computeBackoffMs(2, POLICY, () => 0)).toBe(0);
  });
  it('never exceeds maxDelay nor goes negative', () => {
    for (const r of [0, 0.3, 0.99, 1]) {
      const d = computeBackoffMs(10, POLICY, () => r);
      expect(d).toBeGreaterThanOrEqual(0);
      expect(d).toBeLessThanOrEqual(POLICY.maxDelayMs);
    }
  });
});

// ── retryReasonCode ───────────────────────────────────────────────────────────

describe('retryReasonCode', () => {
  it('maps status to aggregate reason codes', () => {
    expect(retryReasonCode({ transient: true, status: 408 })).toBe('http_408');
    expect(retryReasonCode({ transient: true, status: 409 })).toBe('http_409');
    expect(retryReasonCode({ transient: true, status: 429 })).toBe('http_429');
    expect(retryReasonCode({ transient: true, status: 503 })).toBe('http_5xx');
  });
  it('distinguishes connection (never sent) from timeout (sent, no reply) via billingRisk', () => {
    // Connessione fallita: mai arrivata → nessun costo → 'connection'.
    expect(retryReasonCode({ transient: true, billingRisk: false })).toBe('connection');
    // Timeout dopo l'invio: può aver generato costo → 'timeout'.
    expect(retryReasonCode({ transient: true, billingRisk: true })).toBe('timeout');
  });
});

// ── decideRetry (matrice + Retry-After + deadline) ────────────────────────────

const transient = (extra: Partial<ClassifiedTransportError> = {}): ClassifiedTransportError => ({
  transient: true,
  ...extra,
});

describe('decideRetry', () => {
  const base = { attemptIndex: 0, policy: POLICY, remainingMs: 300_000, random: () => 0.5 };

  it('does not retry non-transient errors (fail-closed)', () => {
    expect(decideRetry({ ...base, error: { transient: false, status: 400 } }).retry).toBe(false);
  });
  it('does not retry once the allotment is exhausted', () => {
    expect(decideRetry({ ...base, attemptIndex: 1, error: transient({ status: 429 }) }).retry).toBe(
      false,
    );
  });
  it('retries a transient error with backoff when no Retry-After', () => {
    const d = decideRetry({ ...base, error: transient({ status: 500 }) });
    expect(d).toEqual({ retry: true, delayMs: 250, reasonCode: 'http_5xx' });
  });
  it('honors a Retry-After within the cap', () => {
    const d = decideRetry({ ...base, error: transient({ status: 429, retryAfterMs: 2000 }) });
    expect(d).toEqual({ retry: true, delayMs: 2000, reasonCode: 'http_429' });
  });
  it('does not auto-retry when Retry-After exceeds the cap', () => {
    const d = decideRetry({
      ...base,
      error: transient({ status: 429, retryAfterMs: RETRY_MAX_RETRY_AFTER_MS + 1 }),
    });
    expect(d).toEqual({ retry: false, blockedByRetryAfter: true });
  });
  it('does not auto-retry a huge-but-valid Retry-After (parsed → clamped → blocked)', () => {
    // Retry-After enorme ma sintatticamente valido: il parser lo clampa al sanity
    // cap (24h) e decideRetry lo blocca (oltre il cap automatico) → zero retry,
    // nessuna attesa assurda, nessun fallback al backoff.
    const retryAfterMs = parseRetryAfterMs({ 'retry-after-ms': String(48 * 3600 * 1000) }, 0);
    expect(retryAfterMs).toBe(24 * 3600 * 1000);
    const d = decideRetry({ ...base, error: transient({ status: 429, retryAfterMs }) });
    expect(d).toEqual({ retry: false, blockedByRetryAfter: true });
  });
  it('does not auto-retry a Retry-After above the auto-limit but below the sanity cap', () => {
    // 30s: valido, ben sotto il sanity cap ma oltre maxRetryAfterMs → zero retry.
    const retryAfterMs = parseRetryAfterMs({ 'retry-after': '30' }, 0);
    expect(retryAfterMs).toBe(30_000);
    expect(retryAfterMs).toBeGreaterThan(RETRY_MAX_RETRY_AFTER_MS);
    const d = decideRetry({ ...base, error: transient({ status: 429, retryAfterMs }) });
    expect(d).toEqual({ retry: false, blockedByRetryAfter: true });
  });
  it('falls back to backoff+jitter when the header is invalid (parsed → null)', () => {
    // Header non valido → parser null → nessun retryAfterMs → backoff.
    expect(parseRetryAfterMs({ 'retry-after': 'soon' }, 0)).toBeNull();
    const d = decideRetry({ ...base, error: transient({ status: 500 }) });
    expect(d).toEqual({ retry: true, delayMs: 250, reasonCode: 'http_5xx' });
  });
  it('never retries an intentional abort / non-transient error (permanent)', () => {
    // Un abort intenzionale è normalizzato a non-transitorio a valle: qui il
    // contratto puro garantisce zero retry per qualunque errore non transitorio.
    const d = decideRetry({ ...base, error: { transient: false } });
    expect(d).toEqual({ retry: false });
  });
  it('does not retry if the deadline cannot fit delay + attempt', () => {
    // remaining appena sotto attemptTimeout + delay.
    const d = decideRetry({
      ...base,
      remainingMs: POLICY.attemptTimeoutMs + 100,
      error: transient({ status: 500 }),
    });
    expect(d.retry).toBe(false);
  });
});
