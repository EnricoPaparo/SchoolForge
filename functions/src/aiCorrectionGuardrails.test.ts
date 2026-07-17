import { describe, expect, it } from 'vitest';
import { parseAiRuntimeConfig, isRealProviderEnabled } from './aiCorrectionRuntimeConfig.js';
import { DEV_LIMITS, enforceOperationLimits } from './aiCorrectionLimits.js';
import { AiGatewayError } from './aiCorrectionGatewayCore.js';
import {
  DEFAULT_PRICE_LIST_VERSION,
  OPENAI_PRODUCTION_MODEL,
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
  availableMicroUsd,
  emptyLedger,
  monthKeyFromMs,
  reconcile,
  reserve,
  utilizationState,
} from './aiCorrectionBudget.js';

// ── Runtime config (fail-closed + kill switch) ───────────────────────────────

const VALID_CONFIG_RAW = {
  enabled: true,
  provider: 'openai',
  model: OPENAI_PRODUCTION_MODEL,
  environment: 'dev',
  limits: { ...DEV_LIMITS },
  budget: { monthlyUsd: 5 },
  configVersion: 'cfg-1',
  priceListVersion: DEFAULT_PRICE_LIST_VERSION,
};

describe('parseAiRuntimeConfig (M5-05D1 fail-closed)', () => {
  it('parses a fully valid, enabled config', () => {
    const cfg = parseAiRuntimeConfig(VALID_CONFIG_RAW);
    expect(cfg).not.toBeNull();
    expect(isRealProviderEnabled(cfg)).toBe(true);
    expect(cfg!.model).toBe(OPENAI_PRODUCTION_MODEL);
    expect(cfg!.budget.monthlyUsd).toBe(5);
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
      { budget: { monthlyUsd: 0 } },
      { budget: {} },
      { limits: { ...DEV_LIMITS, maxProviderConcurrency: 0 } },
      { limits: { ...DEV_LIMITS, attemptTimeoutMs: -1 } },
      { enabled: 'yes' },
    ]) {
      expect(parseAiRuntimeConfig({ ...VALID_CONFIG_RAW, ...bad })).toBeNull();
    }
  });

  it('rejects an unknown model/priceListVersion pair before provider construction', () => {
    expect(parseAiRuntimeConfig({ ...VALID_CONFIG_RAW, model: 'gpt-5-nano' })).toBeNull();
    expect(
      parseAiRuntimeConfig({ ...VALID_CONFIG_RAW, priceListVersion: 'v2-unknown' }),
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

  it('monthlyUsd: 5 and lower positive values are valid; above 5 is invalid', () => {
    expect(parseAiRuntimeConfig({ ...VALID_CONFIG_RAW, budget: { monthlyUsd: 5 } })).not.toBeNull();
    expect(parseAiRuntimeConfig({ ...VALID_CONFIG_RAW, budget: { monthlyUsd: 1 } })).not.toBeNull();
    expect(parseAiRuntimeConfig({ ...VALID_CONFIG_RAW, budget: { monthlyUsd: 5.01 } })).toBeNull();
  });
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
    expect(price).toEqual({ inputPerMillionUsd: 0.05, outputPerMillionUsd: 0.4 });
    // 4000 in * $0.05/M + 1000 out * $0.40/M = 200 + 400 = 600 µUSD = $0.0006.
    expect(tokenCostMicroUsd(4000, 1000, price!, 'nearest')).toBe(600);
    expect(microUsdToUsd(600)).toBe(0.0006);
  });
  it('ceil rounding for estimates never under-charges', () => {
    const price = { inputPerMillionUsd: 0.05, outputPerMillionUsd: 0.4 };
    // 4001 * 0.05 = 200.05 → ceil 201, nearest 200.
    expect(tokenCostMicroUsd(4001, 0, price, 'ceil')).toBe(201);
    expect(tokenCostMicroUsd(4001, 0, price, 'nearest')).toBe(200);
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
    // 1000 * 0.05 + 200 * 0.4 = 50 + 80 = 130 µUSD.
    expect(b).toEqual({
      inputTokens: 1000,
      outputTokens: 200,
      totalTokens: 1200,
      costMicroUsd: 130,
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
    // 300 * 0.05 + 100 * 0.4 = 15 + 40 = 55 µUSD.
    expect(actualCostMicroUsd(300, 100, DEFAULT_PRICE_LIST_VERSION, OPENAI_PRODUCTION_MODEL)).toBe(
      55,
    );
    expect(actualCostMicroUsd(0, 0, DEFAULT_PRICE_LIST_VERSION, OPENAI_PRODUCTION_MODEL)).toBe(0);
    expect(actualCostMicroUsd(1, 1, 'nope', OPENAI_PRODUCTION_MODEL)).toBeNull();
  });
});

// ── Budget ledger ─────────────────────────────────────────────────────────────

const FIVE_USD = 5 * USD_MICRO;
const HOUR = 3_600_000;

describe('budget ledger (M5-05D1)', () => {
  it('monthKeyFromMs is UTC YYYY-MM', () => {
    expect(monthKeyFromMs(Date.UTC(2026, 6, 16))).toBe('2026-07');
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
