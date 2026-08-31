import { describe, expect, it } from 'vitest';
import { parseAiRuntimeConfig, isRealProviderEnabled } from './aiCorrectionRuntimeConfig.js';
import { DEV_LIMITS, enforceOperationLimits } from './aiCorrectionLimits.js';
import { AiGatewayError } from './aiCorrectionGatewayCore.js';
import {
  DEFAULT_PRICE_LIST_VERSION,
  OPENAI_PRODUCTION_MODEL,
  OPENAI_RUNTIME_LUNA_MODEL,
  OPENAI_RUNTIME_LUNA_PRICE_LIST_VERSION,
  PRICE_LISTS,
  lookupModelPrice,
  tokenCostMicroUsd,
  microUsdToUsd,
  estimateCostBreakdown,
  normalizeUsageActual,
  actualCostMicroUsd,
  USD_MICRO,
} from './aiCorrectionCost.js';
import {
  availableDailyMicroUsd,
  availableMicroUsd,
  dayKeyFromMs,
  emptyLedger,
  markPending,
  monthKeyFromMs,
  reconcile,
  reserve,
  utilizationState,
  type BudgetLedgerState,
} from './aiCorrectionBudget.js';

// ── Runtime config (fail-closed + kill switch) ───────────────────────────────

const VALID_CONFIG_RAW = {
  enabled: true,
  provider: 'openai',
  model: OPENAI_PRODUCTION_MODEL,
  environment: 'dev',
  limits: { ...DEV_LIMITS },
  maxOperationCostMicroUsd: 5_000_000,
  dailyBudgetMicroUsd: 5_000_000,
  monthlyBudgetMicroUsd: 5_000_000,
  configVersion: 'cfg-1',
  priceListVersion: DEFAULT_PRICE_LIST_VERSION,
};

describe('parseAiRuntimeConfig (M5-05D1 fail-closed)', () => {
  it('parses a fully valid, enabled config', () => {
    const cfg = parseAiRuntimeConfig(VALID_CONFIG_RAW);
    expect(cfg).not.toBeNull();
    expect(isRealProviderEnabled(cfg)).toBe(true);
    expect(cfg!.model).toBe(OPENAI_PRODUCTION_MODEL);
    expect(cfg!.maxOperationCostMicroUsd).toBe(5_000_000);
    expect(cfg!.dailyBudgetMicroUsd).toBe(5_000_000);
    expect(cfg!.monthlyBudgetMicroUsd).toBe(5_000_000);
  });

  it('returns null for absent/non-object', () => {
    expect(parseAiRuntimeConfig(undefined)).toBeNull();
    expect(parseAiRuntimeConfig(null)).toBeNull();
    expect(parseAiRuntimeConfig('x')).toBeNull();
  });

  it('kill switch: enabled=false parses but is NOT real-provider-enabled', () => {
    const cfg = parseAiRuntimeConfig({ ...VALID_CONFIG_RAW, enabled: false });
    expect(cfg).not.toBeNull();
    expect(isRealProviderEnabled(cfg)).toBe(false);
  });

  it('rejects wrong provider/environment/model/versions/budget/limits', () => {
    for (const bad of [
      { provider: 'anthropic' },
      { environment: 'prod' },
      { model: 'bad model!' },
      { configVersion: '' },
      { priceListVersion: 'x y' },
      { maxOperationCostMicroUsd: 0 },
      { dailyBudgetMicroUsd: -1 },
      { monthlyBudgetMicroUsd: 5_000_001 },
      { limits: { ...DEV_LIMITS, maxProviderConcurrency: 0 } },
      { limits: { ...DEV_LIMITS, attemptTimeoutMs: -1 } },
      { enabled: 'yes' },
    ]) {
      expect(parseAiRuntimeConfig({ ...VALID_CONFIG_RAW, ...bad })).toBeNull();
    }
  });

  it('rejects an unknown model/priceListVersion pair before provider construction', () => {
    expect(parseAiRuntimeConfig({ ...VALID_CONFIG_RAW, model: 'gpt-5-nano' })).toBeNull();
    expect(parseAiRuntimeConfig({ ...VALID_CONFIG_RAW, model: 'gpt-5.4-nano' })).toBeNull();
    expect(
      parseAiRuntimeConfig({
        ...VALID_CONFIG_RAW,
        model: 'gpt-5-nano-2025-08-07',
        priceListVersion: 'v1-2026-07-16',
      }),
    ).toBeNull();
    expect(
      parseAiRuntimeConfig({ ...VALID_CONFIG_RAW, priceListVersion: 'v2-unknown' }),
    ).toBeNull();
  });

  it('M5-QUALITY-07: accepts Luna only with its runtime price list; rejects mismatched pairs', () => {
    // nano valid (baseline, explicit choice) — unchanged.
    expect(parseAiRuntimeConfig(VALID_CONFIG_RAW)!.model).toBe(OPENAI_PRODUCTION_MODEL);

    // Luna valid with its own runtime price list.
    const lunaCfg = parseAiRuntimeConfig({
      ...VALID_CONFIG_RAW,
      model: OPENAI_RUNTIME_LUNA_MODEL,
      priceListVersion: OPENAI_RUNTIME_LUNA_PRICE_LIST_VERSION,
    });
    expect(lunaCfg).not.toBeNull();
    expect(lunaCfg!.model).toBe(OPENAI_RUNTIME_LUNA_MODEL);
    expect(lunaCfg!.priceListVersion).toBe(OPENAI_RUNTIME_LUNA_PRICE_LIST_VERSION);

    // Luna with nano's price list → rejected (no silent fallback).
    expect(
      parseAiRuntimeConfig({
        ...VALID_CONFIG_RAW,
        model: OPENAI_RUNTIME_LUNA_MODEL,
        priceListVersion: DEFAULT_PRICE_LIST_VERSION,
      }),
    ).toBeNull();
    // nano with Luna's price list → rejected.
    expect(
      parseAiRuntimeConfig({
        ...VALID_CONFIG_RAW,
        model: OPENAI_PRODUCTION_MODEL,
        priceListVersion: OPENAI_RUNTIME_LUNA_PRICE_LIST_VERSION,
      }),
    ).toBeNull();
    // Luna with a completely unknown price list → rejected.
    expect(
      parseAiRuntimeConfig({
        ...VALID_CONFIG_RAW,
        model: OPENAI_RUNTIME_LUNA_MODEL,
        priceListVersion: 'v4-2026-07-20-luna-benchmark',
      }),
    ).toBeNull();
    // Unknown model (even with a real price-list version) → rejected.
    expect(
      parseAiRuntimeConfig({
        ...VALID_CONFIG_RAW,
        model: 'gpt-5.6-luna-preview',
        priceListVersion: OPENAI_RUNTIME_LUNA_PRICE_LIST_VERSION,
      }),
    ).toBeNull();
  });

  it.each([
    ['maxSubmissionsPerOperation', 30, 29, 31],
    ['maxOpenQuestionsPerSubmission', 20, 19, 21],
    ['maxEstimatedTokensPerSubmission', 10_000, 9_999, 10_001],
    ['maxEstimatedTokensPerOperation', 300_000, 299_999, 300_001],
    ['maxProviderConcurrency', 3, 2, 4],
    ['attemptTimeoutMs', 60_000, 59_999, 60_001],
    ['maxApplicationRetries', 1, 0, 2],
  ] as const)(
    '%s: ceiling and lower values are valid; a higher value is invalid',
    (key, cap, lower, over) => {
      const withValue = (value: number) => ({
        ...VALID_CONFIG_RAW,
        limits: { ...DEV_LIMITS, [key]: value },
      });
      expect(parseAiRuntimeConfig(withValue(cap))).not.toBeNull();
      expect(parseAiRuntimeConfig(withValue(lower))).not.toBeNull();
      expect(parseAiRuntimeConfig(withValue(over))).toBeNull();
    },
  );

  it.each([
    ['maxOperationCostMicroUsd', 5_000_000],
    ['dailyBudgetMicroUsd', 5_000_000],
    ['monthlyBudgetMicroUsd', 5_000_000],
  ] as const)('%s: ceiling and lower positive values pass; zero/over fail', (key, ceiling) => {
    expect(parseAiRuntimeConfig({ ...VALID_CONFIG_RAW, [key]: ceiling })).not.toBeNull();
    expect(parseAiRuntimeConfig({ ...VALID_CONFIG_RAW, [key]: ceiling - 1 })).not.toBeNull();
    expect(parseAiRuntimeConfig({ ...VALID_CONFIG_RAW, [key]: 0 })).toBeNull();
    expect(parseAiRuntimeConfig({ ...VALID_CONFIG_RAW, [key]: ceiling + 1 })).toBeNull();
  });

  it.each(['maxOperationCostMicroUsd', 'dailyBudgetMicroUsd', 'monthlyBudgetMicroUsd'] as const)(
    'rejects a config with missing %s',
    (key) => {
      const raw: Record<string, unknown> = { ...VALID_CONFIG_RAW };
      delete raw[key];
      expect(parseAiRuntimeConfig(raw)).toBeNull();
    },
  );
});

// ── DEV limits ───────────────────────────────────────────────────────────────

describe('enforceOperationLimits (M5-05D1)', () => {
  const ok = {
    eligibleSubmissionCount: 2,
    perSubmission: [
      { openQuestionCount: 3, estimatedTokens: 1000 },
      { openQuestionCount: 5, estimatedTokens: 2000 },
    ],
    totalEstimatedTokens: 3000,
  };
  it('passes within limits', () => {
    expect(() => enforceOperationLimits(DEV_LIMITS, ok)).not.toThrow();
  });
  it('rejects too many submissions', () => {
    expect(() =>
      enforceOperationLimits(DEV_LIMITS, { ...ok, eligibleSubmissionCount: 31 }),
    ).toThrow(AiGatewayError);
  });
  it('rejects too many open questions in one submission', () => {
    expect(() =>
      enforceOperationLimits(DEV_LIMITS, {
        ...ok,
        perSubmission: [{ openQuestionCount: 21, estimatedTokens: 100 }],
      }),
    ).toThrow(/domande aperte/);
  });
  it('rejects per-submission token cap', () => {
    expect(() =>
      enforceOperationLimits(DEV_LIMITS, {
        ...ok,
        perSubmission: [{ openQuestionCount: 1, estimatedTokens: 10_001 }],
      }),
    ).toThrow(/token stimati/);
  });
  it('rejects per-operation token cap', () => {
    expect(() =>
      enforceOperationLimits(DEV_LIMITS, { ...ok, totalEstimatedTokens: 300_001 }),
    ).toThrow(/operazione supera/);
  });
});

// ── Cost (versioned price list) ──────────────────────────────────────────────

describe('cost (M5-05D1)', () => {
  it('looks up the versioned model price and computes micro-USD exactly', () => {
    const price = lookupModelPrice(DEFAULT_PRICE_LIST_VERSION, OPENAI_PRODUCTION_MODEL);
    expect(price).toEqual({
      inputMicroUsdPerMillion: 200_000,
      outputMicroUsdPerMillion: 1_250_000,
    });
    // 4000 in * $0.20/M + 1000 out * $1.25/M = 2050 µUSD.
    expect(tokenCostMicroUsd(4000, 1000, price!, 'nearest')).toBe(2050);
    expect(microUsdToUsd(2050)).toBe(0.00205);
  });
  it('ceil rounding for estimates never under-charges', () => {
    const price = {
      inputMicroUsdPerMillion: 200_000,
      outputMicroUsdPerMillion: 1_250_000,
    };
    // 4001 * 200000 / 1M = 800.2 → ceil 801, nearest 800.
    expect(tokenCostMicroUsd(4001, 0, price, 'ceil')).toBe(801);
    expect(tokenCostMicroUsd(4001, 0, price, 'nearest')).toBe(800);
  });
  it('returns null for unknown version/model', () => {
    expect(lookupModelPrice('nope', OPENAI_PRODUCTION_MODEL)).toBeNull();
    expect(lookupModelPrice(DEFAULT_PRICE_LIST_VERSION, 'nope')).toBeNull();
  });
  it('zero tokens → zero cost (mock / closed-only)', () => {
    const price = lookupModelPrice(DEFAULT_PRICE_LIST_VERSION, OPENAI_PRODUCTION_MODEL)!;
    expect(tokenCostMicroUsd(0, 0, price, 'ceil')).toBe(0);
    expect(tokenCostMicroUsd(0, 0, price, 'nearest')).toBe(0);
  });

  it('production list contains only the verified immutable OpenAI snapshot', () => {
    expect(Object.keys(PRICE_LISTS[DEFAULT_PRICE_LIST_VERSION]!)).toEqual([
      OPENAI_PRODUCTION_MODEL,
    ]);
  });
});

// ── Cost/token breakdown effettivo e stimato (M5-05D2B-1) ────────────────────

describe('cost breakdown (M5-05D2B-1)', () => {
  it('estimateCostBreakdown splits input/output and rounds up (conservativo)', () => {
    const b = estimateCostBreakdown(1000, 200, DEFAULT_PRICE_LIST_VERSION, OPENAI_PRODUCTION_MODEL);
    // 1000 * $0.20/M + 200 * $1.25/M = 450 µUSD.
    expect(b).toEqual({
      inputTokens: 1000,
      outputTokens: 200,
      totalTokens: 1200,
      costMicroUsd: 450,
    });
  });

  it('estimateCostBreakdown returns null for an unknown version/model (fail-closed)', () => {
    expect(estimateCostBreakdown(1, 1, 'nope', OPENAI_PRODUCTION_MODEL)).toBeNull();
    expect(estimateCostBreakdown(1, 1, DEFAULT_PRICE_LIST_VERSION, 'nope')).toBeNull();
  });

  it('normalizeUsageActual accepts coherent usage, rejects incoherent (no invented actual)', () => {
    expect(normalizeUsageActual({ inputTokens: 300, outputTokens: 100, tokens: 400 })).toEqual({
      inputTokens: 300,
      outputTokens: 100,
      totalTokens: 400,
    });
    // Totale incoerente con input+output → null (mai un actual inventato).
    expect(normalizeUsageActual({ inputTokens: 300, outputTokens: 100, tokens: 999 })).toBeNull();
    // Split assente (solo totale) → null: non si inventa la ripartizione.
    expect(normalizeUsageActual({ tokens: 400 })).toBeNull();
    // Valori negativi/non interi → null.
    expect(normalizeUsageActual({ inputTokens: -1, outputTokens: 2 })).toBeNull();
    expect(normalizeUsageActual({ inputTokens: 1.5, outputTokens: 2 })).toBeNull();
    // Usage assente (mock / sole-chiuse) → null → 0 a valle.
    expect(normalizeUsageActual(undefined)).toBeNull();
  });

  it('actualCostMicroUsd uses nearest rounding and knows the versioned price', () => {
    // 300 * $0.20/M + 100 * $1.25/M = 185 µUSD.
    expect(actualCostMicroUsd(300, 100, DEFAULT_PRICE_LIST_VERSION, OPENAI_PRODUCTION_MODEL)).toBe(
      185,
    );
    expect(actualCostMicroUsd(0, 0, DEFAULT_PRICE_LIST_VERSION, OPENAI_PRODUCTION_MODEL)).toBe(0);
    expect(actualCostMicroUsd(1, 1, 'nope', OPENAI_PRODUCTION_MODEL)).toBeNull();
  });
});

// ── Costo Luna runtime (M5-QUALITY-07) ──────────────────────────────────────

describe('Luna runtime cost (M5-QUALITY-07)', () => {
  it('prices Luna at $1.00/M input and $6.00/M output in its runtime version', () => {
    expect(
      lookupModelPrice(OPENAI_RUNTIME_LUNA_PRICE_LIST_VERSION, OPENAI_RUNTIME_LUNA_MODEL),
    ).toEqual({
      inputMicroUsdPerMillion: 1_000_000,
      outputMicroUsdPerMillion: 6_000_000,
    });
    // nano's model is not in Luna's runtime list and vice-versa.
    expect(
      lookupModelPrice(OPENAI_RUNTIME_LUNA_PRICE_LIST_VERSION, OPENAI_PRODUCTION_MODEL),
    ).toBeNull();
    expect(lookupModelPrice(DEFAULT_PRICE_LIST_VERSION, OPENAI_RUNTIME_LUNA_MODEL)).toBeNull();
  });

  it('estimate is conservative (ceil) and actual (nearest) never exceeds it for Luna', () => {
    // 4001 input at $1.00/M = 4001 µUSD exactly; 100 output at $6.00/M = 600.
    const est = estimateCostBreakdown(
      4001,
      100,
      OPENAI_RUNTIME_LUNA_PRICE_LIST_VERSION,
      OPENAI_RUNTIME_LUNA_MODEL,
    )!;
    const actual = actualCostMicroUsd(
      4001,
      100,
      OPENAI_RUNTIME_LUNA_PRICE_LIST_VERSION,
      OPENAI_RUNTIME_LUNA_MODEL,
    )!;
    expect(est.costMicroUsd).toBe(4601);
    // Reservation (ceil) ≥ actual (nearest): the invariant holds for Luna too.
    expect(actual).toBeLessThanOrEqual(est.costMicroUsd);
  });

  it('holds costActual ≤ costReservation with Unicode-heavy token counts (Luna)', () => {
    // A fractional µUSD boundary that rounds up for the reservation and down for
    // the actual, mirroring Unicode payloads whose byte length inflates tokens.
    const inputTokens = 1234567; // arbitrary large count
    const outputTokens = 7654;
    const reservation = estimateCostBreakdown(
      inputTokens,
      outputTokens,
      OPENAI_RUNTIME_LUNA_PRICE_LIST_VERSION,
      OPENAI_RUNTIME_LUNA_MODEL,
    )!.costMicroUsd;
    const actual = actualCostMicroUsd(
      inputTokens,
      outputTokens,
      OPENAI_RUNTIME_LUNA_PRICE_LIST_VERSION,
      OPENAI_RUNTIME_LUNA_MODEL,
    )!;
    expect(actual).toBeLessThanOrEqual(reservation);
  });
});

// ── Budget ledger ─────────────────────────────────────────────────────────────

const FIVE_USD = 5 * USD_MICRO;
const HOUR = 3_600_000;

describe('budget ledger (M5-05D1)', () => {
  it('monthKeyFromMs is UTC YYYY-MM', () => {
    expect(monthKeyFromMs(Date.UTC(2026, 6, 16))).toBe('2026-07');
  });

  it('dayKeyFromMs is UTC and changes exactly at midnight', () => {
    expect(dayKeyFromMs(Date.UTC(2026, 6, 16, 23, 59, 59, 999))).toBe('2026-07-16');
    expect(dayKeyFromMs(Date.UTC(2026, 6, 17, 0, 0, 0, 0))).toBe('2026-07-17');
  });

  it('daily budget accepts under/exact limit and rejects the next micro-USD', () => {
    const day = '2026-07-16';
    let state = emptyLedger('2026-07', FIVE_USD, USD_MICRO);
    state.dailySpentMicroUsd[day] = 999_000;
    const exact = reserve(state, 'exact', 1_000, 10_000, 0, day);
    expect(exact.ok).toBe(true);
    state = (exact as { state: BudgetLedgerState }).state;
    expect(availableDailyMicroUsd(state, day, 0)).toBe(0);
    expect(reserve(state, 'over', 1, 10_000, 0, day)).toEqual({
      ok: false,
      reason: 'daily_budget_exceeded',
    });
  });

  it('two atomic reservations cannot exceed the same daily budget', () => {
    const day = '2026-07-16';
    let state = emptyLedger('2026-07', FIVE_USD, USD_MICRO);
    state = (reserve(state, 'a', 600_000, 10_000, 0, day) as { state: BudgetLedgerState }).state;
    expect(reserve(state, 'b', 500_000, 10_000, 0, day)).toEqual({
      ok: false,
      reason: 'daily_budget_exceeded',
    });
  });

  it('reconcile after UTC midnight remains charged to the reservation day', () => {
    const day1 = '2026-07-16';
    const startedAt = Date.UTC(2026, 6, 16, 23, 59);
    const completedAt = Date.UTC(2026, 6, 17, 0, 1);
    let state = emptyLedger('2026-07', FIVE_USD, USD_MICRO);
    state = (
      reserve(state, 'cross-midnight', 10_000, completedAt + 60_000, startedAt, day1) as {
        state: BudgetLedgerState;
      }
    ).state;
    state = markPending(state, 'cross-midnight', startedAt);
    state = reconcile(state, 'cross-midnight', 450, completedAt);
    expect(state.dailySpentMicroUsd[day1]).toBe(450);
    expect(state.dailySpentMicroUsd['2026-07-17']).toBeUndefined();
  });

  it('reserves when budget is sufficient and rejects when insufficient', () => {
    const now = 0;
    let s = emptyLedger('2026-07', FIVE_USD);
    const r1 = reserve(s, 'req-1', 3 * USD_MICRO, now + HOUR, now);
    expect(r1.ok).toBe(true);
    s = (r1 as { state: typeof s }).state;
    expect(availableMicroUsd(s, now)).toBe(2 * USD_MICRO);
    // Second op needs 3 USD but only 2 left → rejected.
    const r2 = reserve(s, 'req-2', 3 * USD_MICRO, now + HOUR, now);
    expect(r2.ok).toBe(false);
  });

  it('two concurrent reservations cannot exceed the budget (sequential tx model)', () => {
    const now = 0;
    let s = emptyLedger('2026-07', FIVE_USD);
    const a = reserve(s, 'a', 3 * USD_MICRO, now + HOUR, now);
    s = (a as { state: typeof s }).state;
    const b = reserve(s, 'b', 3 * USD_MICRO, now + HOUR, now); // sees a's reservation
    expect(b.ok).toBe(false);
    expect(availableMicroUsd(s, now)).toBe(2 * USD_MICRO);
  });

  it('re-reserving the same requestId is idempotent (no double charge)', () => {
    const now = 0;
    let s = emptyLedger('2026-07', FIVE_USD);
    s = (reserve(s, 'req', USD_MICRO, now + HOUR, now) as { state: typeof s }).state;
    const again = reserve(s, 'req', USD_MICRO, now + HOUR, now);
    expect(again.ok).toBe(true);
    s = (again as { state: typeof s }).state;
    expect(availableMicroUsd(s, now)).toBe(4 * USD_MICRO);
  });

  it('reconcile with actual < reserved frees the excess', () => {
    const now = 0;
    let s = emptyLedger('2026-07', FIVE_USD);
    s = (reserve(s, 'req', 2 * USD_MICRO, now + HOUR, now) as { state: typeof s }).state;
    s = reconcile(s, 'req', 100, now); // spent only 100 µUSD
    expect(s.spentMicroUsd).toBe(100);
    expect(availableMicroUsd(s, now)).toBe(FIVE_USD - 100);
  });

  it('reconcile is idempotent (missing reservation → no change)', () => {
    const now = 0;
    let s = emptyLedger('2026-07', FIVE_USD);
    s = (reserve(s, 'req', USD_MICRO, now + HOUR, now) as { state: typeof s }).state;
    s = reconcile(s, 'req', 500, now);
    const before = s.spentMicroUsd;
    s = reconcile(s, 'req', 500, now); // already reconciled
    expect(s.spentMicroUsd).toBe(before);
  });

  it('recovers an interrupted reservation via expiry (no leak)', () => {
    const now = 1000;
    let s = emptyLedger('2026-07', FIVE_USD);
    // A crashed run reserved 4 USD with a lease that has now expired.
    s = { ...s, reservations: { dead: { microUsd: 4 * USD_MICRO, expiresAtMs: 500 } } };
    // A new op can still reserve: the expired reservation is auto-released.
    const r = reserve(s, 'fresh', 4 * USD_MICRO, now + HOUR, now);
    expect(r.ok).toBe(true);
    expect(availableMicroUsd((r as { state: typeof s }).state, now)).toBe(USD_MICRO);
  });

  it('hard stop at 100%: no reservation when nothing is available', () => {
    const now = 0;
    const s = { ...emptyLedger('2026-07', FIVE_USD), spentMicroUsd: FIVE_USD };
    expect(availableMicroUsd(s, now)).toBe(0);
    expect(reserve(s, 'x', 1, now + HOUR, now).ok).toBe(false);
    expect(utilizationState(s, now)).toBe('exhausted');
  });

  it('utilization thresholds 50/80/100 are reported as state', () => {
    const now = 0;
    const base = emptyLedger('2026-07', FIVE_USD);
    expect(utilizationState({ ...base, spentMicroUsd: 2 * USD_MICRO }, now)).toBe('ok');
    expect(utilizationState({ ...base, spentMicroUsd: 2.5 * USD_MICRO }, now)).toBe('warn50');
    expect(utilizationState({ ...base, spentMicroUsd: 4 * USD_MICRO }, now)).toBe('warn80');
    expect(utilizationState({ ...base, spentMicroUsd: 5 * USD_MICRO }, now)).toBe('exhausted');
  });

  it('a zero-amount reservation does not touch the ledger', () => {
    const now = 0;
    const s = emptyLedger('2026-07', FIVE_USD);
    const r = reserve(s, 'closed-only', 0, now + HOUR, now);
    expect(r.ok).toBe(true);
    expect((r as { state: typeof s }).state.reservations).toEqual({});
  });
});

// ── Macchina a stati crash-safe della prenotazione (M5-05D2B-1) ──────────────

describe('budget reservation state machine (M5-05D2B-1)', () => {
  const FIVE = 5 * USD_MICRO;

  it('markPending then reconcile within the window charges only the actual', () => {
    let s = emptyLedger('2026-07', FIVE);
    s = (reserve(s, 'req', 2 * USD_MICRO, 3_600_000, 0) as { state: typeof s }).state;
    expect(s.reservations.req!.status).toBe('reserved');
    s = markPending(s, 'req', 0);
    expect(s.reservations.req!.status).toBe('pending');
    s = reconcile(s, 'req', 100, 0);
    expect(s.spentMicroUsd).toBe(100);
    expect(s.dailySpentMicroUsd['1970-01-01']).toBe(100);
    expect(s.reservations.req).toBeUndefined();
  });

  it('an expired RESERVED reservation is released (recoverable, no cost)', () => {
    const s: BudgetLedgerState = {
      monthKey: '2026-07',
      budgetMicroUsd: FIVE,
      dailyBudgetMicroUsd: FIVE,
      spentMicroUsd: 0,
      dailySpentMicroUsd: {},
      reservations: {
        dead: {
          microUsd: 4 * USD_MICRO,
          expiresAtMs: 500,
          dayKey: '1970-01-01',
          status: 'reserved',
        },
      },
    };
    // Non trattiene budget da scaduta; una reserve successiva la rilascia.
    expect(availableMicroUsd(s, 1000)).toBe(FIVE);
    const r = reserve(s, 'fresh', 4 * USD_MICRO, 2000, 1000) as { state: BudgetLedgerState };
    expect(r.state.spentMicroUsd).toBe(0);
    expect(r.state.dailySpentMicroUsd).toEqual({});
    expect(r.state.reservations.dead).toBeUndefined();
  });

  it('an expired PENDING reservation is charged at the reserved cap, never freed silently', () => {
    const s: BudgetLedgerState = {
      monthKey: '2026-07',
      budgetMicroUsd: FIVE,
      dailyBudgetMicroUsd: FIVE,
      spentMicroUsd: 0,
      dailySpentMicroUsd: {},
      reservations: {
        crashed: {
          microUsd: 2 * USD_MICRO,
          expiresAtMs: 500,
          dayKey: '1970-01-01',
          status: 'pending',
        },
      },
    };
    // Una `pending` trattiene budget anche da scaduta (costo potenziale).
    expect(availableMicroUsd(s, 1000)).toBe(FIVE - 2 * USD_MICRO);
    // Il settlement (dentro reserve) la addebita al tetto, non la libera.
    const r = reserve(s, 'x', USD_MICRO, 3000, 1000) as { state: BudgetLedgerState };
    expect(r.state.spentMicroUsd).toBe(2 * USD_MICRO);
    expect(r.state.dailySpentMicroUsd['1970-01-01']).toBe(2 * USD_MICRO);
    expect(r.state.reservations.crashed).toBeUndefined();
  });

  it('markPending is a no-op when the reservation no longer exists', () => {
    const s = emptyLedger('2026-07', FIVE);
    expect(markPending(s, 'missing', 0)).toEqual(s);
  });
});
