import { describe, expect, it, vi } from 'vitest';
import type { GradingMode } from './aiCorrectionGatewayCore.js';
import {
  OPENAI_BENCHMARK_LUNA_MODEL,
  OPENAI_BENCHMARK_LUNA_PRICE_LIST_VERSION,
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
  M5_REEVAL_COMMAND,
  M5_REEVAL_DERIVED_FILE,
  M5_REEVAL_INPUT_FILE,
  M5_REEVAL_SUMMARY_FILE,
  runM5ReevaluateCli,
  type M5ReevaluateCliDeps,
} from './m5ReevaluateCli.js';

const MODES: readonly GradingMode[] = ['compassionate', 'balanced', 'rigorous'];

const dataset: M5BenchmarkDataset = {
  providerCases: [
    {
      id: 'INF-004',
      materia: 'informatica',
      categoria: 'parzialmente_corretta',
      domanda: 'D.',
      soluzioneRiferimento: 'S.',
      rispostaStudente: 'R.',
      maxPoints: 4,
      difficolta: 2,
      expectedMinPoints: 2.0,
      expectedMaxPoints: 2.5,
      motivazioneAttesa: 'Nuova fascia.',
      requiresTeacherReview: false,
      containsPromptInjection: false,
    },
  ],
  benchmarkSubmissions: [{ id: 'SUB-1', descrizione: 'S.', providerCaseIds: ['INF-004'] }],
};

function lunaReport(): M5BenchmarkComparativeReport {
  const reports = Object.fromEntries(
    MODES.map((mode) => [
      mode,
      [
        {
          datasetVersion: 'm5-benchmark-dataset-v1',
          graderId: 'openai',
          model: OPENAI_BENCHMARK_LUNA_MODEL,
          gradingMode: mode,
          submissions: [
            {
              submissionId: 'SUB-1',
              providerCaseIds: ['INF-004'],
              latencyMs: 5000,
              callCompleted: true,
              outputInvalid: false,
              results: [{ providerCaseId: 'INF-004', order: 1, points: 2.25, feedback: 'Fb.' }],
              generalFeedback: 'Giudizio complessivo con passo concreto.',
              usage: { tokens: 12_000, inputTokens: 10_000, outputTokens: 2_000 },
            },
          ],
        } satisfies M5BenchmarkReport,
      ],
    ]),
  ) as M5BenchmarkModeReports;
  return buildM5BenchmarkComparativeReport(
    dataset,
    reports,
    OPENAI_BENCHMARK_LUNA_PRICE_LIST_VERSION,
  );
}

function deps(report: M5BenchmarkComparativeReport | null): M5ReevaluateCliDeps & {
  derived: Map<string, M5BenchmarkComparativeReport>;
  summaries: Map<string, unknown>;
  logs: string[];
} {
  const derived = new Map<string, M5BenchmarkComparativeReport>();
  const summaries = new Map<string, unknown>();
  const logs: string[] = [];
  return {
    readReport: vi.fn(async (fileName) => (fileName === M5_REEVAL_INPUT_FILE ? report : null)),
    loadDataset: vi.fn(async () => dataset),
    writeDerived: vi.fn(async (fileName, r) => {
      derived.set(fileName, r);
    }),
    writeSummary: vi.fn(async (fileName, s) => {
      summaries.set(fileName, s);
    }),
    log: (m) => logs.push(m),
    derived,
    summaries,
    logs,
  };
}

describe('M5-QUALITY-06 re-evaluation CLI', () => {
  it('declares unavailable and prints the command when the Luna report is absent', async () => {
    const current = deps(null);
    const result = await runM5ReevaluateCli(current);
    expect(result.status).toBe('unavailable');
    // Nothing derived or written; no verdict fabricated.
    expect(current.writeDerived).not.toHaveBeenCalled();
    expect(current.writeSummary).not.toHaveBeenCalled();
    expect(current.logs.join('\n')).toContain(M5_REEVAL_COMMAND);
  });

  it('re-evaluates offline and writes a new derived report + summary without overwriting the input', async () => {
    const current = deps(lunaReport());
    const result = await runM5ReevaluateCli(current);
    expect(result.status).toBe('reevaluated');
    // Derived and summary go to NEW files, never the input file.
    expect(current.derived.has(M5_REEVAL_DERIVED_FILE)).toBe(true);
    expect(current.summaries.has(M5_REEVAL_SUMMARY_FILE)).toBe(true);
    expect(current.derived.has(M5_REEVAL_INPUT_FILE)).toBe(false);
    // Gate G7 stays open in the log.
    expect(current.logs.join('\n')).toMatch(/G7 resta APERTO/);
  });
});
