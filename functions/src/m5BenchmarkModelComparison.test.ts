import { describe, expect, it } from 'vitest';
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
import { OPENAI_GRADING_CONTRACT_VERSION } from './openAiGrader.js';
import {
  assessBaselineCompatibility,
  buildM5ModelComparisonSynthesis,
  type BaselineExpectations,
} from './m5BenchmarkModelComparison.js';

const MODES: readonly GradingMode[] = ['compassionate', 'balanced', 'rigorous'];

// Dataset congelato minimale con un caso sistematico osservato (SCI-002).
const dataset: M5BenchmarkDataset = {
  providerCases: [
    {
      id: 'SCI-002',
      materia: 'scienze',
      categoria: 'alternativa_valida_non_citata',
      domanda: 'Domanda sintetica.',
      soluzioneRiferimento: 'Riferimento sintetico.',
      rispostaStudente: 'Alternativa valida non citata.',
      maxPoints: 4,
      difficolta: 2,
      expectedMinPoints: 3.5,
      expectedMaxPoints: 4,
      motivazioneAttesa: 'Alternativa valida.',
      requiresTeacherReview: false,
      containsPromptInjection: false,
    },
  ],
  benchmarkSubmissions: [{ id: 'SUB-1', descrizione: 'Sintetica.', providerCaseIds: ['SCI-002'] }],
};

function reports(
  model: string,
  pointsByMode: Record<GradingMode, number[]>,
): M5BenchmarkModeReports {
  return Object.fromEntries(
    MODES.map((mode) => [
      mode,
      pointsByMode[mode].map(
        (value): M5BenchmarkReport => ({
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
              results: [
                { providerCaseId: 'SCI-002', order: 1, points: value, feedback: `Fb ${mode}.` },
              ],
              generalFeedback: `Giudizio complessivo ${mode} con passo successivo concreto.`,
              usage: { tokens: 12_000, inputTokens: 10_000, outputTokens: 2_000 },
            },
          ],
        }),
      ),
    ]),
  ) as M5BenchmarkModeReports;
}

function nanoReport(): M5BenchmarkComparativeReport {
  return buildM5BenchmarkComparativeReport(
    dataset,
    reports(OPENAI_PRODUCTION_MODEL, {
      compassionate: [3, 3],
      balanced: [3, 3],
      rigorous: [3, 3],
    }),
    DEFAULT_PRICE_LIST_VERSION,
  );
}

function miniReport(): M5BenchmarkComparativeReport {
  return buildM5BenchmarkComparativeReport(
    dataset,
    reports(OPENAI_BENCHMARK_CANDIDATE_MODEL, {
      compassionate: [4, 4],
      balanced: [3.75, 4],
      rigorous: [3.5, 3.5],
    }),
    OPENAI_BENCHMARK_CANDIDATE_PRICE_LIST_VERSION,
  );
}

function lunaReport(): M5BenchmarkComparativeReport {
  return buildM5BenchmarkComparativeReport(
    dataset,
    reports(OPENAI_BENCHMARK_LUNA_MODEL, {
      compassionate: [4, 3.75],
      balanced: [3.5, 3.75],
      rigorous: [3.25, 3.5],
    }),
    OPENAI_BENCHMARK_LUNA_PRICE_LIST_VERSION,
  );
}

const mini = () => ({ model: OPENAI_BENCHMARK_CANDIDATE_MODEL, report: miniReport() });
const luna = () => ({ model: OPENAI_BENCHMARK_LUNA_MODEL, report: lunaReport() });

describe('M5-QUALITY-05 cross-model comparison synthesis', () => {
  it('declares the comparison unavailable when the baseline or all candidates are missing', () => {
    expect(buildM5ModelComparisonSynthesis(null, [mini()])).toMatchObject({
      available: false,
      missing: ['baseline'],
    });
    expect(
      buildM5ModelComparisonSynthesis(nanoReport(), [
        { model: OPENAI_BENCHMARK_CANDIDATE_MODEL, report: null },
      ]),
    ).toMatchObject({
      available: false,
      missing: [OPENAI_BENCHMARK_CANDIDATE_MODEL],
    });
    expect(buildM5ModelComparisonSynthesis(null, [])).toMatchObject({ available: false });
  });

  it('supports nano vs mini vs Luna with the SCI focus case per mode and repetition', () => {
    const synthesis = buildM5ModelComparisonSynthesis(nanoReport(), [mini(), luna()]);
    expect(synthesis.available).toBe(true);
    if (!synthesis.available) return;

    expect(synthesis.baseline.model).toBe(OPENAI_PRODUCTION_MODEL);
    expect(synthesis.candidates.map((c) => c.model)).toEqual([
      OPENAI_BENCHMARK_CANDIDATE_MODEL,
      OPENAI_BENCHMARK_LUNA_MODEL,
    ]);
    expect(synthesis.candidates[0]!.priceListVersion).toBe(
      OPENAI_BENCHMARK_CANDIDATE_PRICE_LIST_VERSION,
    );
    expect(synthesis.candidates[1]!.priceListVersion).toBe(
      OPENAI_BENCHMARK_LUNA_PRICE_LIST_VERSION,
    );
    expect(synthesis.missingCandidates).toEqual([]);

    expect(synthesis.focusCases).toHaveLength(1);
    const focus = synthesis.focusCases[0]!;
    expect(focus.providerCaseId).toBe('SCI-002');
    // Observations per model, two repetitions per mode.
    expect(focus.byModel[OPENAI_PRODUCTION_MODEL]!.balanced.points).toEqual([3, 3]);
    expect(focus.byModel[OPENAI_BENCHMARK_CANDIDATE_MODEL]!.balanced.points).toEqual([3.75, 4]);
    expect(focus.byModel[OPENAI_BENCHMARK_LUNA_MODEL]!.balanced.points).toEqual([3.5, 3.75]);
    for (const mode of MODES) {
      expect(focus.byModel[OPENAI_PRODUCTION_MODEL]![mode].expectedRange.minPoints).toBe(3.5);
    }
  });

  it('stays available with a subset of candidates and lists the missing ones', () => {
    const synthesis = buildM5ModelComparisonSynthesis(nanoReport(), [
      mini(),
      { model: OPENAI_BENCHMARK_LUNA_MODEL, report: null },
    ]);
    expect(synthesis.available).toBe(true);
    if (!synthesis.available) return;
    expect(synthesis.candidates.map((c) => c.model)).toEqual([OPENAI_BENCHMARK_CANDIDATE_MODEL]);
    expect(synthesis.missingCandidates).toEqual([OPENAI_BENCHMARK_LUNA_MODEL]);
  });

  it('reports each candidate cost ratio over the baseline from actual measured usage', () => {
    const synthesis = buildM5ModelComparisonSynthesis(nanoReport(), [mini(), luna()]);
    if (!synthesis.available) throw new Error('expected available synthesis');
    expect(typeof synthesis.baseline.costActualMicroUsd).toBe('number');
    for (const candidate of synthesis.candidates) {
      expect(typeof candidate.costActualMicroUsd).toBe('number');
      // Both mini and Luna cost strictly more than nano at these token counts.
      expect(candidate.costRatioOverBaseline).toBeGreaterThan(1);
    }
    // Luna ($1.00/$6.00) is pricier than mini ($0.75/$4.50).
    expect(synthesis.candidates[1]!.costRatioOverBaseline).toBeGreaterThan(
      synthesis.candidates[0]!.costRatioOverBaseline as number,
    );
  });

  it('stamps the current prompt/grading-contract version on generated reports', () => {
    expect(nanoReport().promptContractVersion).toBe(OPENAI_GRADING_CONTRACT_VERSION);
  });
});

describe('M5-QUALITY-05 nano baseline compatibility gate', () => {
  const expected: BaselineExpectations = {
    model: OPENAI_PRODUCTION_MODEL,
    priceListVersion: DEFAULT_PRICE_LIST_VERSION,
    promptContractVersion: OPENAI_GRADING_CONTRACT_VERSION,
    datasetVersion: 'm5-benchmark-dataset-v1',
  };

  it('accepts a report with the same dataset, model, price list and contract version', () => {
    expect(assessBaselineCompatibility(nanoReport(), expected)).toEqual({
      compatible: true,
      detail: expect.any(String),
    });
  });

  it('rejects a report on a different model (e.g. the mini candidate) — blockingField model', () => {
    const result = assessBaselineCompatibility(miniReport(), expected);
    expect(result.compatible).toBe(false);
    expect(result.blockingField).toBe('model');
  });

  it('rejects a report priced with a different list — blockingField priceListVersion', () => {
    const result = assessBaselineCompatibility(nanoReport(), {
      ...expected,
      priceListVersion: 'v-somewhere-else',
    });
    expect(result.compatible).toBe(false);
    expect(result.blockingField).toBe('priceListVersion');
  });

  it('rejects a legacy report without the contract-version stamp — prompt not verifiable', () => {
    const legacy = nanoReport();
    // Simulate a report generated before the stamp existed (e.g. m5-quality-02).
    delete (legacy as { promptContractVersion?: string }).promptContractVersion;
    const result = assessBaselineCompatibility(legacy, expected);
    expect(result.compatible).toBe(false);
    expect(result.blockingField).toBe('promptContractVersion');
    expect(result.detail).toMatch(/prima dello stamp/);
  });

  it('rejects a report whose prompt changed after generation — blockingField promptContractVersion', () => {
    const stale = { ...nanoReport(), promptContractVersion: 'deadbeefdeadbeef' };
    const result = assessBaselineCompatibility(stale, expected);
    expect(result.compatible).toBe(false);
    expect(result.blockingField).toBe('promptContractVersion');
    expect(result.detail).toMatch(/prompt cambiato/);
  });
});
