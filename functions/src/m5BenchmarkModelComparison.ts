import type { GradingMode } from './aiCorrectionGatewayCore.js';
import type {
  BenchmarkExpectedRange,
  BenchmarkTechnicalValue,
  M5BenchmarkComparativeReport,
} from './m5BenchmarkComparison.js';

/**
 * M5-QUALITY-05 — sintesi comparativa **fra modelli** (baseline nano vs
 * candidato mini), generabile **solo** quando entrambi i report comparativi
 * locali sono disponibili. Non ricostruisce né inventa dati mancanti: se manca
 * un report, il confronto è dichiarato non disponibile.
 *
 * Il confronto è rigorosamente interpretabile solo perché i due report usano lo
 * stesso dataset congelato, gli stessi casi/modalità/ripetizioni, lo stesso
 * prompt e le stesse fasce: qui si limita a giustapporre le osservazioni già
 * calcolate, senza rieseguire alcuna valutazione.
 */

/** Casi sistematici del Gate G7 sotto osservazione. */
export const M5_MODEL_COMPARISON_FOCUS_CASES = ['SCI-002', 'SCI-003', 'SCI-004'] as const;

const MODES: readonly GradingMode[] = ['compassionate', 'balanced', 'rigorous'];

export interface ModelSideSummary {
  model: string | 'unknown';
  verdict: M5BenchmarkComparativeReport['verdict'];
  priceListVersion: string;
  callsCompleted: number;
  callsMeasured: number;
  invalidOutputCount: number;
  oscillationCount: number;
  totalTokensActual: BenchmarkTechnicalValue;
  costActualMicroUsd: BenchmarkTechnicalValue;
  costActualUsd: BenchmarkTechnicalValue;
  latency: {
    average: BenchmarkTechnicalValue;
    p50: BenchmarkTechnicalValue;
    p95: BenchmarkTechnicalValue;
  };
}

export interface FocusCaseModeObservation {
  points: number[];
  averagePoints?: number;
  expectedRange: BenchmarkExpectedRange;
}

export interface FocusCaseOccurrence {
  occurrenceId: string;
  submissionId: string;
  providerCaseId: string;
  maxPoints: number;
  baselineByMode: Record<GradingMode, FocusCaseModeObservation>;
  candidateByMode: Record<GradingMode, FocusCaseModeObservation>;
}

export interface M5ModelComparisonAvailable {
  available: true;
  datasetVersion: M5BenchmarkComparativeReport['datasetVersion'];
  baseline: ModelSideSummary;
  candidate: ModelSideSummary;
  focusCases: FocusCaseOccurrence[];
  /** Rapporto costo reale candidato/baseline, `unavailable` se non calcolabile. */
  costRatioCandidateOverBaseline: number | 'unavailable';
}

export interface M5ModelComparisonUnavailable {
  available: false;
  reason: string;
  missing: string[];
}

export type M5ModelComparisonSynthesis = M5ModelComparisonAvailable | M5ModelComparisonUnavailable;

function firstModel(report: M5BenchmarkComparativeReport): string | 'unknown' {
  for (const mode of MODES) {
    const model = report.modelByMode[mode];
    if (model) return model;
  }
  return 'unknown';
}

function summarize(report: M5BenchmarkComparativeReport): ModelSideSummary {
  const overall = report.technical.overall;
  return {
    model: firstModel(report),
    verdict: report.verdict,
    priceListVersion: report.technical.priceListVersion,
    callsCompleted: overall.callsCompleted,
    callsMeasured: overall.callsMeasured,
    invalidOutputCount: report.anomalies.filter((item) => item.code === 'invalid_output').length,
    oscillationCount: report.anomalies.filter((item) => item.rangePattern === 'single_oscillation')
      .length,
    totalTokensActual: overall.totalTokensActual,
    costActualMicroUsd: overall.costActualMicroUsd,
    costActualUsd: overall.costActualUsd,
    latency: {
      average: overall.latencyMs.average,
      p50: overall.latencyMs.p50,
      p95: overall.latencyMs.p95,
    },
  };
}

function observationsByModel(report: M5BenchmarkComparativeReport, occurrenceId: string) {
  const question = report.questions.find((item) => item.occurrenceId === occurrenceId);
  const byMode = {} as Record<GradingMode, FocusCaseModeObservation>;
  for (const mode of MODES) {
    const observation = question?.byMode[mode];
    byMode[mode] = {
      points: observation ? [...observation.points] : [],
      ...(observation?.averagePoints === undefined
        ? {}
        : { averagePoints: observation.averagePoints }),
      expectedRange: question
        ? question.expectedRangeByMode[mode]
        : { minPoints: 0, maxPoints: 0, policy: 'invariant' },
    };
  }
  return byMode;
}

/**
 * Costruisce la sintesi comparativa fra due report. Ritorna `available: false`
 * — senza inventare valori — se manca uno dei due report.
 */
export function buildM5ModelComparisonSynthesis(
  baseline: M5BenchmarkComparativeReport | null,
  candidate: M5BenchmarkComparativeReport | null,
): M5ModelComparisonSynthesis {
  const missing: string[] = [];
  if (!baseline) missing.push('baseline');
  if (!candidate) missing.push('candidate');
  if (!baseline || !candidate) {
    return {
      available: false,
      reason: 'Confronto non disponibile: manca almeno un report comparativo locale.',
      missing,
    };
  }

  const focusSet = new Set<string>(M5_MODEL_COMPARISON_FOCUS_CASES);
  const focusCases: FocusCaseOccurrence[] = [];
  // Le occorrenze provengono dal report baseline; il dataset congelato e la
  // stessa logica garantiscono le stesse occorrenze nel candidato.
  for (const question of baseline.questions) {
    if (!focusSet.has(question.providerCaseId)) continue;
    focusCases.push({
      occurrenceId: question.occurrenceId,
      submissionId: question.submissionId,
      providerCaseId: question.providerCaseId,
      maxPoints: question.maxPoints,
      baselineByMode: observationsByModel(baseline, question.occurrenceId),
      candidateByMode: observationsByModel(candidate, question.occurrenceId),
    });
  }

  const baselineCost = baseline.technical.overall.costActualMicroUsd;
  const candidateCost = candidate.technical.overall.costActualMicroUsd;
  const costRatioCandidateOverBaseline =
    typeof baselineCost === 'number' && typeof candidateCost === 'number' && baselineCost > 0
      ? Math.round((candidateCost / baselineCost) * 1_000) / 1_000
      : 'unavailable';

  return {
    available: true,
    datasetVersion: baseline.datasetVersion,
    baseline: summarize(baseline),
    candidate: summarize(candidate),
    focusCases,
    costRatioCandidateOverBaseline,
  };
}
