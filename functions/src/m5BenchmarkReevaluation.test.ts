import { describe, expect, it } from 'vitest';
import type { GradingMode } from './aiCorrectionGatewayCore.js';
import {
  OPENAI_BENCHMARK_LUNA_MODEL,
  OPENAI_BENCHMARK_LUNA_PRICE_LIST_VERSION,
} from './aiCorrectionCost.js';
import {
  buildM5BenchmarkComparativeReport,
  getBenchmarkExpectedRange,
} from './m5BenchmarkComparison.js';
import {
  loadM5BenchmarkDataset,
  type M5BenchmarkDataset,
  type M5BenchmarkModeReports,
  type M5BenchmarkProviderCase,
  type M5BenchmarkReport,
} from './m5BenchmarkHarness.js';
import { OPENAI_GRADING_CONTRACT_VERSION } from './openAiGrader.js';
import {
  assertReevaluable,
  buildReevaluationReviewSummary,
  G7_HUMAN_REVIEW_CHECKLIST,
  reevaluateComparativeReport,
  ReevaluationIncompatibleError,
} from './m5BenchmarkReevaluation.js';

const MODES: readonly GradingMode[] = ['compassionate', 'balanced', 'rigorous'];

// ── INF-004 recalibration on the real frozen dataset ────────────────────────
describe('M5-QUALITY-06 — INF-004 teacher recalibration', () => {
  it('uses the frozen balanced band 2.00–2.50 with mode-aware derivation', async () => {
    const dataset = await loadM5BenchmarkDataset();
    const inf004 = dataset.providerCases.find((item) => item.id === 'INF-004')!;
    expect(inf004.expectedMinPoints).toBe(2.0);
    expect(inf004.expectedMaxPoints).toBe(2.5);
    expect(inf004.categoria).toBe('parzialmente_corretta');

    // balanced = frozen band; compassionate ≤ +0.50 above; rigorous ≤ −0.50 below.
    expect(getBenchmarkExpectedRange(inf004, 'balanced')).toMatchObject({
      minPoints: 2.0,
      maxPoints: 2.5,
      policy: 'mode_aware',
    });
    expect(getBenchmarkExpectedRange(inf004, 'compassionate')).toMatchObject({
      minPoints: 2.0,
      maxPoints: 3.0,
    });
    expect(getBenchmarkExpectedRange(inf004, 'rigorous')).toMatchObject({
      minPoints: 1.5,
      maxPoints: 2.5,
    });
    // Every bound stays within 0..maxPoints and on the 0.25 step.
    for (const mode of MODES) {
      const range = getBenchmarkExpectedRange(inf004, mode);
      for (const bound of [range.minPoints, range.maxPoints]) {
        expect(bound).toBeGreaterThanOrEqual(0);
        expect(bound).toBeLessThanOrEqual(inf004.maxPoints);
        expect(Number.isInteger(bound * 4)).toBe(true);
      }
    }
  });
});

// ── Offline re-evaluation of an existing report ─────────────────────────────
const INF004_OLD: M5BenchmarkProviderCase = {
  id: 'INF-004',
  materia: 'informatica',
  categoria: 'parzialmente_corretta',
  domanda: 'Domanda.',
  soluzioneRiferimento: 'Soluzione.',
  rispostaStudente: 'Risposta.',
  maxPoints: 4,
  difficolta: 2,
  expectedMinPoints: 2.5,
  expectedMaxPoints: 3.25,
  motivazioneAttesa: 'Vecchia fascia.',
  requiresTeacherReview: false,
  containsPromptInjection: false,
};

const datasetWith = (min: number, max: number): M5BenchmarkDataset => ({
  providerCases: [{ ...INF004_OLD, expectedMinPoints: min, expectedMaxPoints: max }],
  benchmarkSubmissions: [{ id: 'SUB-1', descrizione: 'S.', providerCaseIds: ['INF-004'] }],
});

const OLD_DATASET = datasetWith(2.5, 3.25);
const NEW_DATASET = datasetWith(2.0, 2.5);

function lunaReports(pointsByMode: Record<GradingMode, number[]>): M5BenchmarkModeReports {
  return Object.fromEntries(
    MODES.map((mode) => [
      mode,
      pointsByMode[mode].map(
        (value): M5BenchmarkReport => ({
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
              results: [
                { providerCaseId: 'INF-004', order: 1, points: value, feedback: `Fb ${mode}.` },
              ],
              generalFeedback: `Giudizio ${mode} con passo concreto.`,
              usage: { tokens: 12_000, inputTokens: 10_000, outputTokens: 2_000 },
            },
          ],
        }),
      ),
    ]),
  ) as M5BenchmarkModeReports;
}

// Luna scored INF-004 stricter (~2.25 balanced): below the OLD band, inside the NEW band.
const LUNA_POINTS: Record<GradingMode, number[]> = {
  compassionate: [2.5, 2.5],
  balanced: [2.25, 2.25],
  rigorous: [2.0, 2.0],
};

const originalReport = () =>
  buildM5BenchmarkComparativeReport(
    OLD_DATASET,
    lunaReports(LUNA_POINTS),
    OPENAI_BENCHMARK_LUNA_PRICE_LIST_VERSION,
  );

function inf004RangeMisses(report: ReturnType<typeof originalReport>): unknown[] {
  return report.anomalies.filter(
    (a) => a.code === 'expected_range_miss' && a.occurrenceId === 'SUB-1:INF-004',
  );
}

describe('M5-QUALITY-06 — offline re-evaluation against the updated dataset', () => {
  it('resolves the INF-004 balanced range miss after recalibration, immutably', () => {
    const original = originalReport();
    // Under the OLD band Luna's 2.25 balanced was below range → a miss exists.
    expect(inf004RangeMisses(original).length).toBeGreaterThan(0);

    const outcome = reevaluateComparativeReport(original, NEW_DATASET, {
      datasetVersion: 'm5-benchmark-dataset-v1',
      promptContractVersion: OPENAI_GRADING_CONTRACT_VERSION,
    });

    // Derived: the INF-004 miss is gone under the recalibrated band.
    expect(inf004RangeMisses(outcome.derived)).toHaveLength(0);
    // Original results are immutable: points/feedback unchanged, real technical preserved.
    expect(outcome.derived.questions[0]!.byMode.balanced.points).toEqual([2.25, 2.25]);
    expect(outcome.derived.questions[0]!.byMode.balanced.feedback).toEqual([
      'Fb balanced.',
      'Fb balanced.',
    ]);
    expect(outcome.derived.technical).toEqual(original.technical);
    expect(outcome.model).toBe(OPENAI_BENCHMARK_LUNA_MODEL);
    // The original report object is not mutated.
    expect(inf004RangeMisses(original).length).toBeGreaterThan(0);
  });

  it('preserves the real measured cost and latency in the derived report', () => {
    const outcome = reevaluateComparativeReport(originalReport(), NEW_DATASET);
    const overall = outcome.derived.technical.overall;
    expect(overall.costActualMicroUsd).not.toBe('unavailable');
    expect(overall.latencyMs.average).not.toBe('unavailable');
    expect(outcome.derived.technical.priceListVersion).toBe(
      OPENAI_BENCHMARK_LUNA_PRICE_LIST_VERSION,
    );
  });

  it('is fail-closed on datasetVersion, promptContractVersion, model and structure', () => {
    const good = originalReport();
    expect(() =>
      assertReevaluable(good, {
        datasetVersion: 'other-dataset',
        promptContractVersion: OPENAI_GRADING_CONTRACT_VERSION,
      }),
    ).toThrow(ReevaluationIncompatibleError);
    expect(() =>
      assertReevaluable(good, {
        datasetVersion: 'm5-benchmark-dataset-v1',
        promptContractVersion: 'stale-hash',
      }),
    ).toThrow(/promptContractVersion/);

    const noStamp = { ...good, promptContractVersion: undefined } as unknown as typeof good;
    expect(() =>
      assertReevaluable(noStamp, {
        datasetVersion: 'm5-benchmark-dataset-v1',
        promptContractVersion: OPENAI_GRADING_CONTRACT_VERSION,
      }),
    ).toThrow(/non registra promptContractVersion/);

    const wrongModel = originalReport();
    wrongModel.modelByMode = { compassionate: 'a', balanced: 'b', rigorous: 'c' };
    expect(() =>
      reevaluateComparativeReport(wrongModel, NEW_DATASET, {
        datasetVersion: 'm5-benchmark-dataset-v1',
        promptContractVersion: OPENAI_GRADING_CONTRACT_VERSION,
        model: OPENAI_BENCHMARK_LUNA_MODEL,
      }),
    ).toThrow(/modello/i);

    const broken = { ...good, questions: undefined } as unknown as typeof good;
    expect(() =>
      assertReevaluable(broken, {
        datasetVersion: 'm5-benchmark-dataset-v1',
        promptContractVersion: OPENAI_GRADING_CONTRACT_VERSION,
      }),
    ).toThrow(/Struttura/);
  });
});

describe('M5-QUALITY-06 — human-review summary', () => {
  it('surfaces criteria, blocking anomalies, feedback, cost, latency and the G7 checklist', () => {
    const outcome = reevaluateComparativeReport(originalReport(), NEW_DATASET);
    const summary = buildReevaluationReviewSummary(outcome);

    expect(summary.model).toBe(OPENAI_BENCHMARK_LUNA_MODEL);
    expect(Array.isArray(summary.automaticCriteria)).toBe(true);
    expect(summary.automaticCriteria.length).toBeGreaterThan(0);
    expect(summary.blockingAnomalies.every((a) => a.automaticBlocking === true)).toBe(true);
    expect(summary.perQuestionFeedback[0]!.byMode.balanced).toEqual([
      'Fb balanced.',
      'Fb balanced.',
    ]);
    expect(summary.generalFeedback[0]!.submissionId).toBe('SUB-1');
    expect(summary.cost.costActualMicroUsd).not.toBe('unavailable');
    expect(summary.latency.average).not.toBe('unavailable');
    // G7 stays open: the four manual confirmation points are carried through.
    expect(summary.pendingHumanChecklist).toEqual(G7_HUMAN_REVIEW_CHECKLIST);
    expect(summary.pendingHumanChecklist).toHaveLength(4);
  });
});
