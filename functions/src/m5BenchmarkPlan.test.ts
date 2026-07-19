import { describe, expect, it } from 'vitest';
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
});
