import type { GradingMode } from './aiCorrectionGatewayCore.js';
import type {
  BenchmarkExpectedRange,
  BenchmarkTechnicalValue,
  M5BenchmarkComparativeReport,
} from './m5BenchmarkComparison.js';

/**
 * M5-QUALITY-05 — sintesi comparativa **fra modelli** (baseline nano vs uno o
 * più candidati: mini, Luna, …), generabile quando sono disponibili il baseline
 * e almeno un report candidato. Non ricostruisce né inventa dati mancanti: i
 * candidati assenti sono elencati e, se manca il baseline o tutti i candidati,
 * il confronto è dichiarato non disponibile.
 *
 * Il confronto è rigorosamente interpretabile solo perché i report usano lo
 * stesso dataset congelato, gli stessi casi/modalità/ripetizioni, lo stesso
 * prompt e le stesse fasce: qui si limita a giustapporre le osservazioni già
 * calcolate, senza rieseguire alcuna valutazione.
 */

/** Casi sistematici del Gate G7 sotto osservazione. */
export const M5_MODEL_COMPARISON_FOCUS_CASES = ['SCI-002', 'SCI-003', 'SCI-004'] as const;

const MODES: readonly GradingMode[] = ['compassionate', 'balanced', 'rigorous'];

export interface BaselineCompatibility {
  compatible: boolean;
  /** Campo che impedisce il riuso, quando `compatible` è `false`. */
  blockingField?: 'datasetVersion' | 'model' | 'priceListVersion' | 'promptContractVersion';
  detail: string;
}

export interface BaselineExpectations {
  model: string;
  priceListVersion: string;
  promptContractVersion: string;
  datasetVersion: string;
}

function reportModels(report: M5BenchmarkComparativeReport): Set<string> {
  return new Set(MODES.map((mode) => report.modelByMode[mode]).filter((m): m is string => !!m));
}

/**
 * M5-QUALITY-05 — stabilisce, **senza rieseguire alcuna valutazione**, se un
 * report comparativo esistente possa essere riusato come baseline nano di un
 * confronto fra modelli. Il riuso è ammesso solo se dataset, modello, listino e
 * **versione del contratto di valutazione (prompt + schema)** coincidono con
 * quelli attesi: solo così il confronto isola l'effetto-modello dall'effetto
 * prompt. Non modifica né ricostruisce i dati reali del report.
 */
export function assessBaselineCompatibility(
  report: M5BenchmarkComparativeReport,
  expected: BaselineExpectations,
): BaselineCompatibility {
  if (report.datasetVersion !== expected.datasetVersion) {
    return {
      compatible: false,
      blockingField: 'datasetVersion',
      detail: `datasetVersion del report (${report.datasetVersion}) diverso da ${expected.datasetVersion}.`,
    };
  }
  const models = reportModels(report);
  if (models.size !== 1 || !models.has(expected.model)) {
    return {
      compatible: false,
      blockingField: 'model',
      detail: `il report non è uniformemente sul modello atteso ${expected.model} (modelli: ${[...models].join(', ') || 'assente'}).`,
    };
  }
  if (report.technical.priceListVersion !== expected.priceListVersion) {
    return {
      compatible: false,
      blockingField: 'priceListVersion',
      detail: `priceListVersion del report (${report.technical.priceListVersion}) diverso da ${expected.priceListVersion}.`,
    };
  }
  // Il campo può mancare del tutto nei report prodotti prima dello stamp: in
  // quel caso il prompt non è verificabile e il riuso è rifiutato.
  if (report.promptContractVersion !== expected.promptContractVersion) {
    return {
      compatible: false,
      blockingField: 'promptContractVersion',
      detail:
        report.promptContractVersion === undefined
          ? 'il report non registra promptContractVersion: prodotto prima dello stamp del contratto, prompt non verificabile.'
          : `promptContractVersion del report (${report.promptContractVersion}) diverso dal contratto corrente (${expected.promptContractVersion}): prompt cambiato dopo la generazione.`,
    };
  }
  return { compatible: true, detail: 'Report compatibile: riusabile come baseline nano.' };
}

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
  /** Osservazioni per modello (baseline + ogni candidato presente), per modalità. */
  byModel: Record<string, Record<GradingMode, FocusCaseModeObservation>>;
}

export interface CandidateSideSummary extends ModelSideSummary {
  /** Rapporto costo reale candidato/baseline, `unavailable` se non calcolabile. */
  costRatioOverBaseline: number | 'unavailable';
}

export interface M5ModelComparisonAvailable {
  available: true;
  datasetVersion: M5BenchmarkComparativeReport['datasetVersion'];
  baseline: ModelSideSummary;
  /** Candidati confrontati (mini, Luna, …), nell'ordine fornito. */
  candidates: CandidateSideSummary[];
  focusCases: FocusCaseOccurrence[];
  /** Etichette dei candidati il cui report non era disponibile (nessun dato inventato). */
  missingCandidates: string[];
}

export interface M5ModelComparisonUnavailable {
  available: false;
  reason: string;
  missing: string[];
}

export type M5ModelComparisonSynthesis = M5ModelComparisonAvailable | M5ModelComparisonUnavailable;

/** Un candidato benchmark con il suo report locale (o `null` se assente). */
export interface CandidateReport {
  model: string;
  report: M5BenchmarkComparativeReport | null;
}

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

function costRatioOverBaseline(
  baseline: M5BenchmarkComparativeReport,
  candidate: M5BenchmarkComparativeReport,
): number | 'unavailable' {
  const baselineCost = baseline.technical.overall.costActualMicroUsd;
  const candidateCost = candidate.technical.overall.costActualMicroUsd;
  return typeof baselineCost === 'number' && typeof candidateCost === 'number' && baselineCost > 0
    ? Math.round((candidateCost / baselineCost) * 1_000) / 1_000
    : 'unavailable';
}

/**
 * Costruisce la sintesi comparativa fra il baseline nano e uno o più candidati
 * (mini, Luna, …). Ritorna `available: false` — senza inventare valori — se
 * manca il baseline o se nessun candidato ha un report. I candidati presenti
 * sono confrontati; quelli assenti sono elencati in `missingCandidates`.
 */
export function buildM5ModelComparisonSynthesis(
  baseline: M5BenchmarkComparativeReport | null,
  candidates: ReadonlyArray<CandidateReport>,
): M5ModelComparisonSynthesis {
  const present = candidates.filter((item) => item.report !== null);
  const missingCandidates = candidates
    .filter((item) => item.report === null)
    .map((item) => item.model);

  if (!baseline || present.length === 0) {
    const missing: string[] = [];
    if (!baseline) missing.push('baseline');
    if (present.length === 0)
      missing.push(...(missingCandidates.length ? missingCandidates : ['candidate']));
    return {
      available: false,
      reason:
        'Confronto non disponibile: serve il baseline nano e almeno un report candidato locale.',
      missing,
    };
  }

  const focusSet = new Set<string>(M5_MODEL_COMPARISON_FOCUS_CASES);
  const focusCases: FocusCaseOccurrence[] = [];
  // Le occorrenze provengono dal report baseline; il dataset congelato e la
  // stessa logica garantiscono le stesse occorrenze in ogni candidato.
  for (const question of baseline.questions) {
    if (!focusSet.has(question.providerCaseId)) continue;
    const byModel: Record<string, Record<GradingMode, FocusCaseModeObservation>> = {
      [firstModel(baseline)]: observationsByModel(baseline, question.occurrenceId),
    };
    for (const candidate of present) {
      byModel[firstModel(candidate.report!)] = observationsByModel(
        candidate.report!,
        question.occurrenceId,
      );
    }
    focusCases.push({
      occurrenceId: question.occurrenceId,
      submissionId: question.submissionId,
      providerCaseId: question.providerCaseId,
      maxPoints: question.maxPoints,
      byModel,
    });
  }

  return {
    available: true,
    datasetVersion: baseline.datasetVersion,
    baseline: summarize(baseline),
    candidates: present.map((candidate) => ({
      ...summarize(candidate.report!),
      costRatioOverBaseline: costRatioOverBaseline(baseline, candidate.report!),
    })),
    focusCases,
    missingCandidates,
  };
}
