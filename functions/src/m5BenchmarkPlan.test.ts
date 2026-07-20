import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PRICE_LIST_VERSION,
  OPENAI_BENCHMARK_CANDIDATE_MODEL,
  OPENAI_BENCHMARK_CANDIDATE_PRICE_LIST_VERSION,
  OPENAI_BENCHMARK_LUNA_MODEL,
  OPENAI_BENCHMARK_LUNA_PRICE_LIST_VERSION,
  OPENAI_PRODUCTION_MODEL,
} from './aiCorrectionCost.js';
import { loadM5BenchmarkDataset } from './m5BenchmarkHarness.js';
import { buildM5BenchmarkExecutionPlan } from './m5BenchmarkPlan.js';

describe('M5-QUALITY-02 dry-run plan', () => {
  it('estimates three modes and three repetitions without creating a provider', async () => {
    const dataset = await loadM5BenchmarkDataset();
    const plan = buildM5BenchmarkExecutionPlan(dataset);

    expect(plan).toMatchObject({
      dryRun: true,
      repetitions: 3,
      submissionsPerMode: 4,
      plannedCalls: 36,
      maximumProviderAttempts: 72,
    });
    expect(plan.inputTokensUpperBound).toBeGreaterThan(0);
    expect(plan.outputTokensUpperBound).toBe(8_000 * 72);
    expect(plan.costUpperBoundMicroUsd).toBeGreaterThan(0);
  });

  it('rejects invalid repetitions before any execution', async () => {
    const dataset = await loadM5BenchmarkDataset();
    expect(() => buildM5BenchmarkExecutionPlan(dataset, { repetitions: 0 })).toThrow(
      'Ripetizioni non valide',
    );
  });

  it('defaults to the production nano model and DEV price list (unchanged)', async () => {
    const dataset = await loadM5BenchmarkDataset();
    const plan = buildM5BenchmarkExecutionPlan(dataset);
    expect(plan.model).toBe(OPENAI_PRODUCTION_MODEL);
    expect(plan.priceListVersion).toBe(DEFAULT_PRICE_LIST_VERSION);
  });

  it('M5-QUALITY-05 — computes the mini dry-run ceiling with the mini price list', async () => {
    const dataset = await loadM5BenchmarkDataset();
    const nano = buildM5BenchmarkExecutionPlan(dataset);
    const mini = buildM5BenchmarkExecutionPlan(dataset, {
      model: OPENAI_BENCHMARK_CANDIDATE_MODEL,
      priceListVersion: OPENAI_BENCHMARK_CANDIDATE_PRICE_LIST_VERSION,
    });

    // Same frozen dataset, same planned calls/attempts and modes/repetitions.
    expect(mini.plannedCalls).toBe(nano.plannedCalls);
    expect(mini.maximumProviderAttempts).toBe(nano.maximumProviderAttempts);
    expect(mini.submissionsPerMode).toBe(nano.submissionsPerMode);
    expect(mini.repetitions).toBe(nano.repetitions);

    expect(mini.model).toBe(OPENAI_BENCHMARK_CANDIDATE_MODEL);
    expect(mini.priceListVersion).toBe(OPENAI_BENCHMARK_CANDIDATE_PRICE_LIST_VERSION);
    expect(mini.dryRun).toBe(true);
    // Mini is priced higher than nano, so its own ceiling is strictly larger.
    expect(mini.costUpperBoundMicroUsd).toBeGreaterThan(nano.costUpperBoundMicroUsd);
  });

  it('M5-QUALITY-05 — computes the Luna dry-run ceiling with the Luna price list', async () => {
    const dataset = await loadM5BenchmarkDataset();
    const nano = buildM5BenchmarkExecutionPlan(dataset);
    const mini = buildM5BenchmarkExecutionPlan(dataset, {
      model: OPENAI_BENCHMARK_CANDIDATE_MODEL,
      priceListVersion: OPENAI_BENCHMARK_CANDIDATE_PRICE_LIST_VERSION,
    });
    const luna = buildM5BenchmarkExecutionPlan(dataset, {
      model: OPENAI_BENCHMARK_LUNA_MODEL,
      priceListVersion: OPENAI_BENCHMARK_LUNA_PRICE_LIST_VERSION,
    });

    // Same frozen dataset → identical planned calls/attempts. The output-token
    // bound is model-independent; the input bound varies only by the model-name
    // length inside the serialized payload, not by dataset/prompt/parameters.
    expect(luna.plannedCalls).toBe(nano.plannedCalls);
    expect(luna.maximumProviderAttempts).toBe(nano.maximumProviderAttempts);
    expect(luna.outputTokensUpperBound).toBe(nano.outputTokensUpperBound);

    expect(luna.model).toBe(OPENAI_BENCHMARK_LUNA_MODEL);
    expect(luna.priceListVersion).toBe(OPENAI_BENCHMARK_LUNA_PRICE_LIST_VERSION);
    // Luna ($1.00/$6.00) is priced above mini ($0.75/$4.50), above nano.
    expect(luna.costUpperBoundMicroUsd).toBeGreaterThan(mini.costUpperBoundMicroUsd);
  });
});
