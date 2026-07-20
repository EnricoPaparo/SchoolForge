import { describe, expect, it, vi } from 'vitest';
import type { AiGrader } from './aiCorrectionGatewayCore.js';
import type { M5BenchmarkComparativeReport } from './m5BenchmarkComparison.js';
import type { M5BenchmarkDataset, M5BenchmarkModeReports } from './m5BenchmarkHarness.js';
import type { M5BenchmarkExecutionPlan } from './m5BenchmarkPlan.js';
import {
  M5_BENCHMARK_CONFIRMATION,
  M5_BENCHMARK_COST_ACK_FLAG,
  M5_BENCHMARK_EXECUTE_FLAG,
  runM5QualityBenchmarkCli,
  type M5QualityBenchmarkCliDeps,
} from './m5QualityBenchmarkCli.js';

const dataset = { providerCases: [], benchmarkSubmissions: [] } satisfies M5BenchmarkDataset;
const plan = {
  dryRun: true,
  modes: ['compassionate', 'balanced', 'rigorous'],
  repetitions: 3,
  submissionsPerMode: 4,
  plannedCalls: 36,
  maximumProviderAttempts: 72,
  inputTokensUpperBound: 1,
  outputTokensUpperBound: 1,
  costUpperBoundMicroUsd: 1,
  model: 'fixture-model',
  priceListVersion: 'fixture-price-list',
} satisfies M5BenchmarkExecutionPlan;
const reports = {
  compassionate: [],
  balanced: [],
  rigorous: [],
} satisfies M5BenchmarkModeReports;
const comparison = { verdict: 'READY_FOR_MANUAL_REVIEW' } as M5BenchmarkComparativeReport;
const fakeGrader = { id: 'fake', grade: vi.fn() } satisfies AiGrader;

function deps(overrides: Partial<M5QualityBenchmarkCliDeps> = {}): M5QualityBenchmarkCliDeps {
  return {
    argv: [],
    getApiKey: vi.fn(() => undefined),
    stdinIsTTY: false,
    stdoutIsTTY: false,
    loadDataset: vi.fn(async () => dataset),
    buildPlan: vi.fn(() => plan),
    confirm: vi.fn(async () => M5_BENCHMARK_CONFIRMATION),
    createGrader: vi.fn(() => fakeGrader),
    runModes: vi.fn(async () => reports),
    buildComparison: vi.fn(() => comparison),
    writeReport: vi.fn(async () => undefined),
    log: vi.fn(),
    ...overrides,
  };
}

describe('M5 quality benchmark CLI safety gate', () => {
  it('defaults to dry-run and never constructs the provider', async () => {
    const current = deps();
    await expect(runM5QualityBenchmarkCli(current)).resolves.toBe('dry-run');
    expect(current.createGrader).not.toHaveBeenCalled();
    expect(current.getApiKey).not.toHaveBeenCalled();
    expect(current.confirm).not.toHaveBeenCalled();
    expect(current.runModes).not.toHaveBeenCalled();
    expect(current.writeReport).not.toHaveBeenCalled();
  });

  it('requires both explicit flags before confirmation or provider construction', async () => {
    const current = deps({ argv: [M5_BENCHMARK_EXECUTE_FLAG] });
    await expect(runM5QualityBenchmarkCli(current)).rejects.toThrow(M5_BENCHMARK_COST_ACK_FLAG);
    expect(current.confirm).not.toHaveBeenCalled();
    expect(current.createGrader).not.toHaveBeenCalled();
    expect(current.getApiKey).not.toHaveBeenCalled();
  });

  it('requires an interactive TTY before asking for confirmation', async () => {
    const current = deps({
      argv: [M5_BENCHMARK_EXECUTE_FLAG, M5_BENCHMARK_COST_ACK_FLAG],
      stdinIsTTY: false,
      stdoutIsTTY: true,
    });
    await expect(runM5QualityBenchmarkCli(current)).rejects.toThrow('terminale interattivo');
    expect(current.confirm).not.toHaveBeenCalled();
    expect(current.createGrader).not.toHaveBeenCalled();
    expect(current.getApiKey).not.toHaveBeenCalled();
  });

  it('requires the exact confirmation and does not build a provider on mismatch', async () => {
    const current = deps({
      argv: [M5_BENCHMARK_EXECUTE_FLAG, M5_BENCHMARK_COST_ACK_FLAG],
      stdinIsTTY: true,
      stdoutIsTTY: true,
      confirm: vi.fn(async () => 'esegui benchmark reale'),
    });
    await expect(runM5QualityBenchmarkCli(current)).rejects.toThrow('Conferma non valida');
    expect(current.createGrader).not.toHaveBeenCalled();
    expect(current.getApiKey).not.toHaveBeenCalled();
  });

  it('passes all gates only with two flags, TTY, exact confirmation and an injected fake', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const current = deps({
      argv: [M5_BENCHMARK_EXECUTE_FLAG, M5_BENCHMARK_COST_ACK_FLAG],
      getApiKey: vi.fn(() => 'synthetic-test-value'),
      stdinIsTTY: true,
      stdoutIsTTY: true,
    });
    await expect(runM5QualityBenchmarkCli(current)).resolves.toBe('executed');
    expect(current.createGrader).toHaveBeenCalledOnce();
    expect(current.getApiKey).toHaveBeenCalledOnce();
    expect(current.runModes).toHaveBeenCalledOnce();
    expect(current.writeReport).toHaveBeenCalledWith(comparison);
    expect(fakeGrader.grade).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
