import { describe, expect, it, vi } from 'vitest';
import type { GradingMode } from './aiCorrectionGatewayCore.js';
import {
  DEFAULT_PRICE_LIST_VERSION,
  OPENAI_BENCHMARK_CANDIDATE_MODEL,
  OPENAI_BENCHMARK_CANDIDATE_PRICE_LIST_VERSION,
  OPENAI_BENCHMARK_LUNA_MODEL,
  OPENAI_BENCHMARK_LUNA_PRICE_LIST_VERSION,
  OPENAI_PRODUCTION_MODEL,
} from './aiCorrectionCost.js';
import {
  buildM5BenchmarkComparativeReport,
  type M5BenchmarkComparativeReport,
} from './m5BenchmarkComparison.js';
import type {
  M5BenchmarkDataset,
  M5BenchmarkModeReports,
  M5BenchmarkReport,
} from './m5BenchmarkHarness.js';
import {
  LEGACY_NANO_BASELINE_FILE,
  M5_MODEL_COMPARISON_OUTPUT_FILE,
  runM5ModelComparisonCli,
  type M5ModelComparisonCliDeps,
} from './m5ModelComparisonCli.js';
import { benchmarkReportFileName } from './m5QualityBenchmarkCli.js';

const MODES: readonly GradingMode[] = ['compassionate', 'balanced', 'rigorous'];

const dataset: M5BenchmarkDataset = {
  providerCases: [
    {
      id: 'SCI-002',
      materia: 'scienze',
      categoria: 'alternativa_valida_non_citata',
      domanda: 'Domanda.',
      soluzioneRiferimento: 'Riferimento.',
      rispostaStudente: 'Alternativa valida.',
      maxPoints: 4,
      difficolta: 2,
      expectedMinPoints: 3.5,
      expectedMaxPoints: 4,
      motivazioneAttesa: 'Valida.',
      requiresTeacherReview: false,
      containsPromptInjection: false,
    },
  ],
  benchmarkSubmissions: [{ id: 'SUB-1', descrizione: 'Sintetica.', providerCaseIds: ['SCI-002'] }],
};

function modeReports(model: string, points: number): M5BenchmarkModeReports {
  return Object.fromEntries(
    MODES.map((mode) => [
      mode,
      [
        {
          datasetVersion: 'm5-benchmark-dataset-v1',
          graderId: 'openai',
          model,
          gradingMode: mode,
          submissions: [
            {
              submissionId: 'SUB-1',
              providerCaseIds: ['SCI-002'],
              latencyMs: 100,
              callCompleted: true,
              outputInvalid: false,
              results: [{ providerCaseId: 'SCI-002', order: 1, points, feedback: `Fb ${mode}.` }],
              generalFeedback: `Giudizio ${mode} con passo concreto.`,
              usage: { tokens: 12_000, inputTokens: 10_000, outputTokens: 2_000 },
            },
          ],
        } satisfies M5BenchmarkReport,
      ],
    ]),
  ) as M5BenchmarkModeReports;
}

const nano = (): M5BenchmarkComparativeReport =>
  buildM5BenchmarkComparativeReport(
    dataset,
    modeReports(OPENAI_PRODUCTION_MODEL, 3),
    DEFAULT_PRICE_LIST_VERSION,
  );
const mini = (): M5BenchmarkComparativeReport =>
  buildM5BenchmarkComparativeReport(
    dataset,
    modeReports(OPENAI_BENCHMARK_CANDIDATE_MODEL, 4),
    OPENAI_BENCHMARK_CANDIDATE_PRICE_LIST_VERSION,
  );
const lunaR = (): M5BenchmarkComparativeReport =>
  buildM5BenchmarkComparativeReport(
    dataset,
    modeReports(OPENAI_BENCHMARK_LUNA_MODEL, 3.5),
    OPENAI_BENCHMARK_LUNA_PRICE_LIST_VERSION,
  );

function deps(
  files: Record<string, M5BenchmarkComparativeReport | null>,
): M5ModelComparisonCliDeps {
  return {
    readReportFile: vi.fn(async (fileName: string) => files[fileName] ?? null),
    writeSynthesis: vi.fn(async () => undefined),
    log: vi.fn(),
  };
}

const nanoFile = benchmarkReportFileName(OPENAI_PRODUCTION_MODEL);
const miniFile = benchmarkReportFileName(OPENAI_BENCHMARK_CANDIDATE_MODEL);
const lunaFile = benchmarkReportFileName(OPENAI_BENCHMARK_LUNA_MODEL);

describe('M5-QUALITY-05 model comparison CLI — legacy baseline reuse', () => {
  it('reuses the real legacy nano report (m5-quality-02) as baseline when compatible', async () => {
    // No per-model nano file yet; the legacy real report is present and current.
    const current = deps({ [LEGACY_NANO_BASELINE_FILE]: nano(), [miniFile]: mini() });
    const synthesis = await runM5ModelComparisonCli(current);
    expect(synthesis.available).toBe(true);
    expect((current.log as ReturnType<typeof vi.fn>).mock.calls.flat().join('\n')).toMatch(
      new RegExp(`riuso il report reale ${LEGACY_NANO_BASELINE_FILE.replace('.', '\\.')}`),
    );
  });

  it('prefers the per-model nano report over the legacy one when both are present', async () => {
    const current = deps({
      [nanoFile]: nano(),
      [LEGACY_NANO_BASELINE_FILE]: nano(),
      [miniFile]: mini(),
    });
    const synthesis = await runM5ModelComparisonCli(current);
    expect(synthesis.available).toBe(true);
    expect((current.log as ReturnType<typeof vi.fn>).mock.calls.flat().join('\n')).toMatch(
      new RegExp(`riuso il report reale ${nanoFile.replace(/\./g, '\\.')}`),
    );
  });

  it('does not reuse a legacy report lacking the contract-version stamp; reports the blocking field', async () => {
    const legacy = nano();
    delete (legacy as { promptContractVersion?: string }).promptContractVersion;
    const current = deps({ [LEGACY_NANO_BASELINE_FILE]: legacy, [miniFile]: mini() });
    const synthesis = await runM5ModelComparisonCli(current);
    expect(synthesis.available).toBe(false);
    if (synthesis.available) return;
    expect(synthesis.missing).toContain('baseline');
    expect((current.log as ReturnType<typeof vi.fn>).mock.calls.flat().join('\n')).toMatch(
      /non riusabile.*prima dello stamp/,
    );
  });

  it('supports nano vs mini vs Luna when all three reports are present', async () => {
    const current = deps({ [nanoFile]: nano(), [miniFile]: mini(), [lunaFile]: lunaR() });
    const synthesis = await runM5ModelComparisonCli(current);
    expect(synthesis.available).toBe(true);
    if (!synthesis.available) return;
    expect(synthesis.baseline.model).toBe(OPENAI_PRODUCTION_MODEL);
    expect(synthesis.candidates.map((c) => c.model)).toEqual([
      OPENAI_BENCHMARK_CANDIDATE_MODEL,
      OPENAI_BENCHMARK_LUNA_MODEL,
    ]);
    expect(synthesis.missingCandidates).toEqual([]);
  });

  it('stays available with mini present and Luna absent, listing Luna as missing', async () => {
    const current = deps({ [nanoFile]: nano(), [miniFile]: mini() });
    const synthesis = await runM5ModelComparisonCli(current);
    expect(synthesis.available).toBe(true);
    if (!synthesis.available) return;
    expect(synthesis.candidates.map((c) => c.model)).toEqual([OPENAI_BENCHMARK_CANDIDATE_MODEL]);
    expect(synthesis.missingCandidates).toEqual([OPENAI_BENCHMARK_LUNA_MODEL]);
  });

  it('never reads or writes the nano files from the mini side (mini cannot overwrite nano)', async () => {
    const current = deps({ [nanoFile]: nano(), [miniFile]: mini() });
    await runM5ModelComparisonCli(current);
    // The mini and Luna report file names are distinct from every nano baseline
    // candidate, so a candidate benchmark can never overwrite the nano report.
    expect(miniFile).not.toBe(nanoFile);
    expect(miniFile).not.toBe(LEGACY_NANO_BASELINE_FILE);
    expect(lunaFile).not.toBe(nanoFile);
    expect(lunaFile).not.toBe(LEGACY_NANO_BASELINE_FILE);
    expect(lunaFile).not.toBe(miniFile);
    // The comparison CLI only ever writes the synthesis file, never a report.
    const writeCalls = (current.writeSynthesis as ReturnType<typeof vi.fn>).mock.calls;
    expect(writeCalls).toHaveLength(1);
    expect(M5_MODEL_COMPARISON_OUTPUT_FILE).not.toBe(nanoFile);
    expect(M5_MODEL_COMPARISON_OUTPUT_FILE).not.toBe(miniFile);
  });
});
