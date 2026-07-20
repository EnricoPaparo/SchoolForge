import { describe, expect, it, vi } from 'vitest';
import type { AiGrader } from './aiCorrectionGatewayCore.js';
import type { M5BenchmarkComparativeReport } from './m5BenchmarkComparison.js';
import type { M5BenchmarkDataset, M5BenchmarkModeReports } from './m5BenchmarkHarness.js';
import type { M5BenchmarkExecutionPlan } from './m5BenchmarkPlan.js';
import {
  OPENAI_BENCHMARK_CANDIDATE_MODEL,
  OPENAI_BENCHMARK_CANDIDATE_PRICE_LIST_VERSION,
  OPENAI_PRODUCTION_MODEL,
  DEFAULT_PRICE_LIST_VERSION,
} from './aiCorrectionCost.js';
import {
  benchmarkReportFileName,
  M5_BENCHMARK_CONFIRMATION,
  M5_BENCHMARK_COST_ACK_FLAG,
  M5_BENCHMARK_EXECUTE_FLAG,
  M5_BENCHMARK_MODEL_FLAG,
  resolveBenchmarkModelSelection,
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
    expect(current.writeReport).toHaveBeenCalledWith(
      comparison,
      expect.objectContaining({ model: OPENAI_PRODUCTION_MODEL }),
    );
    expect(fakeGrader.grade).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

describe('M5 quality benchmark model override (M5-QUALITY-05)', () => {
  it('resolves to the production nano model by default (unchanged)', () => {
    expect(resolveBenchmarkModelSelection([])).toEqual({
      model: OPENAI_PRODUCTION_MODEL,
      priceListVersion: DEFAULT_PRICE_LIST_VERSION,
    });
  });

  it('resolves the mini candidate with its own price list when overridden', () => {
    expect(
      resolveBenchmarkModelSelection([
        `${M5_BENCHMARK_MODEL_FLAG}=${OPENAI_BENCHMARK_CANDIDATE_MODEL}`,
      ]),
    ).toEqual({
      model: OPENAI_BENCHMARK_CANDIDATE_MODEL,
      priceListVersion: OPENAI_BENCHMARK_CANDIDATE_PRICE_LIST_VERSION,
    });
  });

  it('rejects a non-allowlisted model with a readable error', () => {
    expect(() => resolveBenchmarkModelSelection([`${M5_BENCHMARK_MODEL_FLAG}=gpt-4o`])).toThrow(
      /non consentito/,
    );
  });

  it('rejects the flag without a value and a repeated flag', () => {
    expect(() => resolveBenchmarkModelSelection([M5_BENCHMARK_MODEL_FLAG])).toThrow(/=<modello>/);
    expect(() =>
      resolveBenchmarkModelSelection([
        `${M5_BENCHMARK_MODEL_FLAG}=${OPENAI_PRODUCTION_MODEL}`,
        `${M5_BENCHMARK_MODEL_FLAG}=${OPENAI_BENCHMARK_CANDIDATE_MODEL}`,
      ]),
    ).toThrow(/una sola volta/);
  });

  it('threads the default nano selection into plan and grader', async () => {
    const current = deps({
      argv: [M5_BENCHMARK_EXECUTE_FLAG, M5_BENCHMARK_COST_ACK_FLAG],
      getApiKey: vi.fn(() => 'synthetic-test-value'),
      stdinIsTTY: true,
      stdoutIsTTY: true,
    });
    await runM5QualityBenchmarkCli(current);
    expect(current.buildPlan).toHaveBeenCalledWith(
      dataset,
      expect.objectContaining({ model: OPENAI_PRODUCTION_MODEL }),
    );
    expect(current.createGrader).toHaveBeenCalledWith(
      'synthetic-test-value',
      expect.objectContaining({ model: OPENAI_PRODUCTION_MODEL }),
    );
  });

  it('applies the mini override to the grader actually built by the CLI', async () => {
    const current = deps({
      argv: [
        M5_BENCHMARK_EXECUTE_FLAG,
        M5_BENCHMARK_COST_ACK_FLAG,
        `${M5_BENCHMARK_MODEL_FLAG}=${OPENAI_BENCHMARK_CANDIDATE_MODEL}`,
      ],
      getApiKey: vi.fn(() => 'synthetic-test-value'),
      stdinIsTTY: true,
      stdoutIsTTY: true,
    });
    await runM5QualityBenchmarkCli(current);
    expect(current.createGrader).toHaveBeenCalledWith(
      'synthetic-test-value',
      expect.objectContaining({
        model: OPENAI_BENCHMARK_CANDIDATE_MODEL,
        priceListVersion: OPENAI_BENCHMARK_CANDIDATE_PRICE_LIST_VERSION,
      }),
    );
    expect(current.buildComparison).toHaveBeenCalledWith(
      dataset,
      reports,
      expect.objectContaining({ model: OPENAI_BENCHMARK_CANDIDATE_MODEL }),
    );
  });

  it('rejects an invalid model before reading the key, dataset or network', async () => {
    const current = deps({
      argv: [`${M5_BENCHMARK_MODEL_FLAG}=gpt-4o`],
    });
    await expect(runM5QualityBenchmarkCli(current)).rejects.toThrow(/non consentito/);
    expect(current.loadDataset).not.toHaveBeenCalled();
    expect(current.getApiKey).not.toHaveBeenCalled();
    expect(current.createGrader).not.toHaveBeenCalled();
  });

  it('names the local report per model to avoid accidental overwrite', () => {
    expect(benchmarkReportFileName(OPENAI_PRODUCTION_MODEL)).toBe(
      'm5-quality-05-gpt-5.4-nano-2026-03-17-report.json',
    );
    expect(benchmarkReportFileName(OPENAI_BENCHMARK_CANDIDATE_MODEL)).toBe(
      'm5-quality-05-gpt-5.4-mini-2026-03-17-report.json',
    );
    expect(benchmarkReportFileName(OPENAI_PRODUCTION_MODEL)).not.toBe(
      benchmarkReportFileName(OPENAI_BENCHMARK_CANDIDATE_MODEL),
    );
  });

  it('keeps the production/runtime model on nano (mini is benchmark-only)', () => {
    expect(OPENAI_PRODUCTION_MODEL).toBe('gpt-5.4-nano-2026-03-17');
    expect(OPENAI_BENCHMARK_CANDIDATE_MODEL).not.toBe(OPENAI_PRODUCTION_MODEL);
  });
});
