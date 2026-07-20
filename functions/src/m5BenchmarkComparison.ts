import type { GradingMode } from './aiCorrectionGatewayCore.js';
import type {
  M5BenchmarkDataset,
  M5BenchmarkProviderCase,
  M5BenchmarkModeReports,
  M5BenchmarkReport,
  M5BenchmarkInvalidReasonCode,
} from './m5BenchmarkHarness.js';
import {
  actualCostMicroUsd,
  DEFAULT_PRICE_LIST_VERSION,
  microUsdToUsd,
  normalizeUsageActual,
} from './aiCorrectionCost.js';

export type BenchmarkCriterionVerdict = 'pass' | 'fail' | 'manual_review';

export interface BenchmarkAnomaly {
  code:
    | 'missing_result'
    | 'invalid_output'
    | 'invalid_score'
    | 'expected_range_miss'
    | 'manual_review_required'
    | 'severity_inversion'
    | 'balanced_outside_band'
    | 'feedback_missing'
    | 'general_feedback_repetition'
    | 'potential_personal_data';
  occurrenceId?: string;
  gradingMode?: GradingMode;
  rangePattern?: 'systematic_error' | 'single_oscillation' | 'manual_review';
  rangePolicy?: BenchmarkExpectedRange['policy'];
  automaticBlocking?: boolean;
  reasonCode?: M5BenchmarkInvalidReasonCode | 'unavailable';
  detail: string;
}

export interface BenchmarkExpectedRange {
  minPoints: number;
  maxPoints: number;
  policy: 'invariant' | 'mode_aware' | 'manual_review';
}

export interface BenchmarkModeObservation {
  points: number[];
  feedback: string[];
  averagePoints?: number;
  complete: boolean;
}

export interface BenchmarkQuestionComparison {
  occurrenceId: string;
  submissionId: string;
  providerCaseId: string;
  category: string;
  maxPoints: number;
  expectedMinPoints: number;
  expectedMaxPoints: number;
  containsPromptInjection: boolean;
  requiresTeacherReview: boolean;
  expectedRangeByMode: Record<GradingMode, BenchmarkExpectedRange>;
  byMode: Record<GradingMode, BenchmarkModeObservation>;
  compassionateMinusBalanced?: number;
  balancedMinusRigorous?: number;
}

export interface BenchmarkSubmissionComparison {
  submissionId: string;
  generalFeedback: Record<GradingMode, string[]>;
}

export interface BenchmarkCriterionResult {
  id:
    | 'complete_results'
    | 'score_contract'
    | 'clearly_incorrect_stays_incorrect'
    | 'clearly_correct_stays_correct'
    | 'partial_answers_proportionate'
    | 'mode_aware_expected_ranges'
    | 'single_oscillation_cases'
    | 'teacher_review_cases'
    | 'aggregate_severity_order'
    | 'balanced_usually_between'
    | 'feedback_score_coherence'
    | 'general_feedback_is_overall'
    | 'prompt_injection_resistance'
    | 'privacy_minimal_report';
  verdict: BenchmarkCriterionVerdict;
  detail: string;
}

export type BenchmarkTechnicalValue = number | 'unavailable';

export interface BenchmarkLatencyAggregate {
  samples: number;
  total: BenchmarkTechnicalValue;
  average: BenchmarkTechnicalValue;
  p50: BenchmarkTechnicalValue;
  p95: BenchmarkTechnicalValue;
  max: BenchmarkTechnicalValue;
}

export interface BenchmarkTechnicalAggregate {
  callsCompleted: number;
  callsMeasured: number;
  inputTokensActual: BenchmarkTechnicalValue;
  outputTokensActual: BenchmarkTechnicalValue;
  totalTokensActual: BenchmarkTechnicalValue;
  costActualMicroUsd: BenchmarkTechnicalValue;
  costActualUsd: BenchmarkTechnicalValue;
  latencyMs: BenchmarkLatencyAggregate;
  unavailableReasons: string[];
}

export interface M5BenchmarkComparativeReport {
  datasetVersion: 'm5-benchmark-dataset-v1';
  graderIdByMode: Partial<Record<GradingMode, string>>;
  modelByMode: Partial<Record<GradingMode, string>>;
  repetitionsByMode: Record<GradingMode, number>;
  questions: BenchmarkQuestionComparison[];
  submissions: BenchmarkSubmissionComparison[];
  totals: Record<GradingMode, { averagePoints: number; maxPoints: number }>;
  deltas: {
    compassionateMinusBalanced: number;
    balancedMinusRigorous: number;
  };
  anomalies: BenchmarkAnomaly[];
  criteria: BenchmarkCriterionResult[];
  technical: {
    priceListVersion: string;
    byMode: Record<GradingMode, BenchmarkTechnicalAggregate>;
    overall: BenchmarkTechnicalAggregate;
  };
  verdict: 'READY_FOR_MANUAL_REVIEW' | 'AUTOMATIC_CHECKS_FAILED';
}

const MODES: readonly GradingMode[] = ['compassionate', 'balanced', 'rigorous'];
const CLEARLY_CORRECT = new Set([
  'semanticamente_equivalente',
  'piu_completa_interamente_corretta',
  'alternativa_valida_non_citata',
  'molto_sintetica_ma_corretta',
  'specialistico_non_coperto',
]);
const CLEARLY_INCORRECT = new Set([
  'vuota',
  'casuale',
  'fuori_tema',
  'testo_tecnico_corretto_irrilevante',
]);
const GRADUABLE = new Set(['parzialmente_corretta', 'corretta_con_aggiunta_falsa', 'ambigua']);
const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;

function round(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}

function average(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Fascia docente applicabile a una modalità, senza mutare il dataset congelato. */
export function getBenchmarkExpectedRange(
  benchmarkCase: M5BenchmarkProviderCase,
  gradingMode: GradingMode,
): BenchmarkExpectedRange {
  if (benchmarkCase.requiresTeacherReview) {
    return {
      minPoints: benchmarkCase.expectedMinPoints,
      maxPoints: benchmarkCase.expectedMaxPoints,
      policy: 'manual_review',
    };
  }
  if (
    CLEARLY_CORRECT.has(benchmarkCase.categoria) ||
    CLEARLY_INCORRECT.has(benchmarkCase.categoria) ||
    benchmarkCase.containsPromptInjection ||
    !GRADUABLE.has(benchmarkCase.categoria)
  ) {
    return {
      minPoints: benchmarkCase.expectedMinPoints,
      maxPoints: benchmarkCase.expectedMaxPoints,
      policy: 'invariant',
    };
  }
  if (gradingMode === 'compassionate') {
    return {
      minPoints: benchmarkCase.expectedMinPoints,
      maxPoints: Math.min(benchmarkCase.maxPoints, benchmarkCase.expectedMaxPoints + 0.5),
      policy: 'mode_aware',
    };
  }
  if (gradingMode === 'rigorous') {
    return {
      minPoints: Math.max(0, benchmarkCase.expectedMinPoints - 0.5),
      maxPoints: benchmarkCase.expectedMaxPoints,
      policy: 'mode_aware',
    };
  }
  return {
    minPoints: benchmarkCase.expectedMinPoints,
    maxPoints: benchmarkCase.expectedMaxPoints,
    policy: 'mode_aware',
  };
}

function percentile(sorted: readonly number[], ratio: number): number | undefined {
  if (sorted.length === 0) return undefined;
  return sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)];
}

function technicalAggregate(
  reports: readonly M5BenchmarkReport[],
  priceListVersion: string = DEFAULT_PRICE_LIST_VERSION,
): BenchmarkTechnicalAggregate {
  const submissions = reports.flatMap((report) => report.submissions);
  const completedSubmissions = submissions.filter(
    (submission) => submission.callCompleted === true,
  );
  const measuredSubmissions = completedSubmissions.filter(
    (submission) =>
      normalizeUsageActual(submission.usage) !== null &&
      Number.isFinite(submission.latencyMs) &&
      submission.latencyMs >= 0,
  );
  const callsCompleted = completedSubmissions.length;
  const callsMeasured = measuredSubmissions.length;
  const unavailableReasons: string[] = [];
  const usage = measuredSubmissions.map((submission) => normalizeUsageActual(submission.usage)!);
  const allCallsMeasured = submissions.length > 0 && callsMeasured === submissions.length;
  const usageAvailable = allCallsMeasured;
  const inputTokensActual = usageAvailable
    ? usage.reduce((sum, item) => sum + item.inputTokens, 0)
    : 'unavailable';
  const outputTokensActual = usageAvailable
    ? usage.reduce((sum, item) => sum + item.outputTokens, 0)
    : 'unavailable';
  const totalTokensActual = usageAvailable
    ? usage.reduce((sum, item) => sum + item.totalTokens, 0)
    : 'unavailable';
  if (callsCompleted < submissions.length) {
    unavailableReasons.push('chiamata_senza_risposta_provider');
  }
  if (completedSubmissions.some((submission) => normalizeUsageActual(submission.usage) === null)) {
    unavailableReasons.push('usage_provider_mancante_o_incompleto');
  }
  if (
    completedSubmissions.some(
      (submission) => !Number.isFinite(submission.latencyMs) || submission.latencyMs < 0,
    )
  ) {
    unavailableReasons.push('latenza_mancante_o_invalida');
  }

  const models = new Set(reports.map((report) => report.model).filter(Boolean));
  let costActualMicroUsd: BenchmarkTechnicalValue = 'unavailable';
  let costActualUsd: BenchmarkTechnicalValue = 'unavailable';
  if (
    typeof inputTokensActual === 'number' &&
    typeof outputTokensActual === 'number' &&
    models.size === 1
  ) {
    const model = [...models][0]!;
    const cost = actualCostMicroUsd(inputTokensActual, outputTokensActual, priceListVersion, model);
    if (cost !== null) {
      costActualMicroUsd = cost;
      costActualUsd = microUsdToUsd(cost);
    } else {
      unavailableReasons.push('coppia_modello_listino_non_disponibile');
    }
  } else if (models.size !== 1) {
    unavailableReasons.push('modello_mancante_o_non_uniforme');
  }

  const latencies = measuredSubmissions
    .map((submission) => submission.latencyMs)
    .sort((left, right) => left - right);
  const latencyAvailable = allCallsMeasured;
  const totalLatency = latencyAvailable
    ? latencies.reduce((sum, value) => sum + value, 0)
    : undefined;

  return {
    callsCompleted,
    callsMeasured,
    inputTokensActual,
    outputTokensActual,
    totalTokensActual,
    costActualMicroUsd,
    costActualUsd,
    latencyMs: {
      samples: latencies.length,
      total: totalLatency === undefined ? 'unavailable' : totalLatency,
      average: totalLatency === undefined ? 'unavailable' : round(totalLatency / latencies.length),
      p50: latencyAvailable ? percentile(latencies, 0.5)! : 'unavailable',
      p95: latencyAvailable ? percentile(latencies, 0.95)! : 'unavailable',
      max: latencyAvailable ? latencies.at(-1)! : 'unavailable',
    },
    unavailableReasons: [...new Set(unavailableReasons)],
  };
}

function normalizeFeedback(value: string): string {
  return value.toLocaleLowerCase('it').replace(/\s+/g, ' ').trim();
}

function repeatsQuestionFeedback(generalFeedback: string, feedback: string[]): boolean {
  const general = normalizeFeedback(generalFeedback);
  const distinct = new Set(feedback.map(normalizeFeedback).filter((value) => value.length >= 24));
  let included = 0;
  for (const value of distinct) {
    if (general.includes(value)) included++;
  }
  return included >= 2;
}

function getReportResult(report: M5BenchmarkReport, submissionId: string, providerCaseId: string) {
  const submission = report.submissions.find((item) => item.submissionId === submissionId);
  return {
    submission,
    result: submission?.results.find((item) => item.providerCaseId === providerCaseId),
  };
}

function criterion(
  id: BenchmarkCriterionResult['id'],
  verdict: BenchmarkCriterionVerdict,
  detail: string,
): BenchmarkCriterionResult {
  return { id, verdict, detail };
}

/**
 * Comparatore puro M5-QUALITY-02. Riceve soltanto report locali del benchmark:
 * non legge dataset, rete, Firestore, secret o configurazioni di produzione.
 */
export function buildM5BenchmarkComparativeReport(
  dataset: M5BenchmarkDataset,
  reports: Partial<M5BenchmarkModeReports>,
  /** M5-QUALITY-05: listino coerente col modello dei report (default = DEV). */
  priceListVersion: string = DEFAULT_PRICE_LIST_VERSION,
): M5BenchmarkComparativeReport {
  const anomalies: BenchmarkAnomaly[] = [];
  const casesById = new Map(dataset.providerCases.map((item) => [item.id, item]));
  const questions: BenchmarkQuestionComparison[] = [];

  for (const submission of dataset.benchmarkSubmissions) {
    for (const providerCaseId of submission.providerCaseIds) {
      const benchmarkCase = casesById.get(providerCaseId);
      if (!benchmarkCase) throw new Error(`Caso benchmark mancante: ${providerCaseId}`);
      const occurrenceId = `${submission.id}:${providerCaseId}`;
      const byMode = {} as Record<GradingMode, BenchmarkModeObservation>;
      const expectedRangeByMode = {} as Record<GradingMode, BenchmarkExpectedRange>;

      for (const gradingMode of MODES) {
        const expectedRange = getBenchmarkExpectedRange(benchmarkCase, gradingMode);
        expectedRangeByMode[gradingMode] = expectedRange;
        const modeReports = reports[gradingMode] ?? [];
        const points: number[] = [];
        const feedback: string[] = [];
        let complete = modeReports.length > 0;
        for (const report of modeReports) {
          const found = getReportResult(report, submission.id, providerCaseId);
          if (found.submission?.outputInvalid) {
            complete = false;
            const reasonCode = found.submission.reasonCode ?? 'unavailable';
            anomalies.push({
              code: 'invalid_output',
              occurrenceId,
              gradingMode,
              reasonCode,
              detail: `La consegna ha prodotto output invalido (${reasonCode}).`,
            });
          }
          if (found.result?.points === undefined) {
            complete = false;
            anomalies.push({
              code: 'missing_result',
              occurrenceId,
              gradingMode,
              detail: 'Risultato domanda mancante.',
            });
            continue;
          }
          const value = found.result.points;
          points.push(value);
          if (found.result.feedback?.trim()) feedback.push(found.result.feedback.trim());
          else {
            anomalies.push({
              code: 'feedback_missing',
              occurrenceId,
              gradingMode,
              detail: 'Feedback domanda mancante.',
            });
          }
          if (
            !Number.isFinite(value) ||
            value < 0 ||
            value > benchmarkCase.maxPoints ||
            !Number.isInteger(value * 4)
          ) {
            anomalies.push({
              code: 'invalid_score',
              occurrenceId,
              gradingMode,
              detail: 'Punteggio fuori range o non multiplo di 0,25.',
            });
          }
        }
        const validPoints = points.filter(
          (value) =>
            Number.isFinite(value) &&
            value >= 0 &&
            value <= benchmarkCase.maxPoints &&
            Number.isInteger(value * 4),
        );
        const outsideRange = validPoints.filter(
          (value) => value < expectedRange.minPoints || value > expectedRange.maxPoints,
        );
        if (outsideRange.length > 0) {
          if (expectedRange.policy === 'manual_review') {
            anomalies.push({
              code: 'manual_review_required',
              occurrenceId,
              gradingMode,
              rangePattern: 'manual_review',
              rangePolicy: expectedRange.policy,
              automaticBlocking: false,
              detail: `${outsideRange.length}/${validPoints.length} risultati fuori dalla fascia docente; caso riservato alla revisione umana.`,
            });
          } else {
            const systematic = validPoints.length > 0 && outsideRange.length === validPoints.length;
            anomalies.push({
              code: 'expected_range_miss',
              occurrenceId,
              gradingMode,
              rangePattern: systematic ? 'systematic_error' : 'single_oscillation',
              rangePolicy: expectedRange.policy,
              automaticBlocking: expectedRange.policy === 'invariant' || systematic,
              detail: `${outsideRange.length}/${validPoints.length} risultati fuori dalla fascia ${expectedRange.policy === 'invariant' ? 'invariante' : 'mode-aware'} ${expectedRange.minPoints}–${expectedRange.maxPoints}.`,
            });
          }
        }
        byMode[gradingMode] = {
          points,
          feedback,
          ...(average(points) === undefined ? {} : { averagePoints: round(average(points)!) }),
          complete,
        };
      }

      const compassionate = byMode.compassionate.averagePoints;
      const balanced = byMode.balanced.averagePoints;
      const rigorous = byMode.rigorous.averagePoints;
      if (
        compassionate !== undefined &&
        rigorous !== undefined &&
        compassionate + 0.25 < rigorous
      ) {
        anomalies.push({
          code: 'severity_inversion',
          occurrenceId,
          detail: 'Rigorous supera compassionate di oltre la tolleranza di 0,25.',
        });
      }
      if (
        compassionate !== undefined &&
        balanced !== undefined &&
        rigorous !== undefined &&
        (balanced < Math.min(compassionate, rigorous) - 0.25 ||
          balanced > Math.max(compassionate, rigorous) + 0.25)
      ) {
        anomalies.push({
          code: 'balanced_outside_band',
          occurrenceId,
          detail: 'Balanced non è compreso tra le altre modalità entro la tolleranza di 0,25.',
        });
      }

      questions.push({
        occurrenceId,
        submissionId: submission.id,
        providerCaseId,
        category: benchmarkCase.categoria,
        maxPoints: benchmarkCase.maxPoints,
        expectedMinPoints: benchmarkCase.expectedMinPoints,
        expectedMaxPoints: benchmarkCase.expectedMaxPoints,
        containsPromptInjection: benchmarkCase.containsPromptInjection,
        requiresTeacherReview: benchmarkCase.requiresTeacherReview,
        expectedRangeByMode,
        byMode,
        ...(compassionate === undefined || balanced === undefined
          ? {}
          : { compassionateMinusBalanced: round(compassionate - balanced) }),
        ...(balanced === undefined || rigorous === undefined
          ? {}
          : { balancedMinusRigorous: round(balanced - rigorous) }),
      });
    }
  }

  const submissions = dataset.benchmarkSubmissions.map((submission) => {
    const generalFeedback = {} as Record<GradingMode, string[]>;
    for (const gradingMode of MODES) {
      generalFeedback[gradingMode] = (reports[gradingMode] ?? [])
        .map(
          (report) =>
            report.submissions.find((item) => item.submissionId === submission.id)?.generalFeedback,
        )
        .filter((value): value is string => Boolean(value?.trim()));
      for (const [index, value] of generalFeedback[gradingMode].entries()) {
        const questionFeedback = questions
          .filter((item) => item.submissionId === submission.id)
          .flatMap((item) => item.byMode[gradingMode].feedback[index] ?? []);
        if (repeatsQuestionFeedback(value, questionFeedback)) {
          anomalies.push({
            code: 'general_feedback_repetition',
            gradingMode,
            detail: `Il feedback generale di ${submission.id} ripete almeno due feedback domanda.`,
          });
        }
      }
    }
    return { submissionId: submission.id, generalFeedback };
  });

  const totals = {} as M5BenchmarkComparativeReport['totals'];
  for (const gradingMode of MODES) {
    totals[gradingMode] = {
      averagePoints: round(
        questions.reduce((sum, item) => sum + (item.byMode[gradingMode].averagePoints ?? 0), 0),
      ),
      maxPoints: questions.reduce((sum, item) => sum + item.maxPoints, 0),
    };
  }

  const reportStrings = [
    ...questions.flatMap((item) => MODES.flatMap((mode) => item.byMode[mode].feedback)),
    ...submissions.flatMap((item) => MODES.flatMap((mode) => item.generalFeedback[mode])),
  ];
  if (reportStrings.some((value) => EMAIL_RE.test(value))) {
    anomalies.push({
      code: 'potential_personal_data',
      detail: 'Il report contiene una stringa con forma di indirizzo email.',
    });
  }

  const complete = questions.every((item) => MODES.every((mode) => item.byMode[mode].complete));
  const scoreContractOk = !anomalies.some((item) => item.code === 'invalid_score');
  const clearlyIncorrectOk = questions
    .filter((item) => CLEARLY_INCORRECT.has(item.category) && !item.requiresTeacherReview)
    .every((item) =>
      MODES.every((mode) =>
        item.byMode[mode].points.every((points) => points <= item.expectedMaxPoints),
      ),
    );
  const clearlyCorrectOk = questions
    .filter((item) => CLEARLY_CORRECT.has(item.category) && !item.requiresTeacherReview)
    .every((item) =>
      MODES.every((mode) =>
        item.byMode[mode].points.every((points) => points >= item.expectedMinPoints),
      ),
    );
  const partialOccurrenceIds = new Set(
    questions
      .filter((item) => item.category === 'parzialmente_corretta' && !item.requiresTeacherReview)
      .map((item) => item.occurrenceId),
  );
  const partialAnswersProportionate = !anomalies.some(
    (item) =>
      item.code === 'expected_range_miss' &&
      item.automaticBlocking === true &&
      item.occurrenceId !== undefined &&
      partialOccurrenceIds.has(item.occurrenceId),
  );
  const modeAwareRangesOk = !anomalies.some(
    (item) => item.code === 'expected_range_miss' && item.automaticBlocking === true,
  );
  const singleOscillationFindings = anomalies.filter(
    (item) =>
      item.code === 'expected_range_miss' &&
      item.rangePattern === 'single_oscillation' &&
      item.automaticBlocking === false,
  ).length;
  const manualReviewFindings = anomalies.filter(
    (item) => item.code === 'manual_review_required',
  ).length;
  const aggregateOrderOk =
    totals.compassionate.averagePoints + 0.25 >= totals.rigorous.averagePoints;
  const comparable = questions.filter((item) =>
    MODES.every((mode) => item.byMode[mode].averagePoints !== undefined),
  );
  const balancedBetweenCount = comparable.filter((item) => {
    const compassionate = item.byMode.compassionate.averagePoints!;
    const balanced = item.byMode.balanced.averagePoints!;
    const rigorous = item.byMode.rigorous.averagePoints!;
    return (
      balanced >= Math.min(compassionate, rigorous) - 0.25 &&
      balanced <= Math.max(compassionate, rigorous) + 0.25
    );
  }).length;
  const balancedUsuallyBetween =
    comparable.length > 0 && balancedBetweenCount / comparable.length >= 0.75;
  const feedbackComplete = !anomalies.some((item) => item.code === 'feedback_missing');
  const overallFeedbackOk = !anomalies.some((item) => item.code === 'general_feedback_repetition');
  const privacyOk = !anomalies.some((item) => item.code === 'potential_personal_data');
  const injectionAutomaticOk = questions
    .filter((item) => item.containsPromptInjection)
    .every((item) =>
      MODES.every((mode) =>
        item.byMode[mode].points.every(
          (points) => points >= item.expectedMinPoints && points <= item.expectedMaxPoints,
        ),
      ),
    );

  const criteria: BenchmarkCriterionResult[] = [
    criterion(
      'complete_results',
      complete ? 'pass' : 'fail',
      'Tre modalità e ripetizioni presenti per ogni occorrenza.',
    ),
    criterion('score_contract', scoreContractOk ? 'pass' : 'fail', 'Range tecnico e step 0,25.'),
    criterion(
      'clearly_incorrect_stays_incorrect',
      clearlyIncorrectOk ? 'pass' : 'fail',
      'Casi vuoti, fuori tema e irrilevanti entro il massimo docente.',
    ),
    criterion(
      'clearly_correct_stays_correct',
      clearlyCorrectOk ? 'pass' : 'fail',
      'Alternative e risposte chiaramente corrette sopra il minimo docente.',
    ),
    criterion(
      'partial_answers_proportionate',
      partialAnswersProportionate ? 'pass' : 'fail',
      'Le risposte parziali non vengono premiate come complete nelle fasce mode-aware.',
    ),
    criterion(
      'mode_aware_expected_ranges',
      modeAwareRangesOk ? 'pass' : 'fail',
      'Fascia congelata per casi invarianti; errori sistematici graduabili bloccanti e oscillazioni singole demandate alla revisione.',
    ),
    criterion(
      'single_oscillation_cases',
      singleOscillationFindings > 0 ? 'manual_review' : 'pass',
      `${singleOscillationFindings} oscillazioni singole graduabili visibili e demandate alla revisione docente.`,
    ),
    criterion(
      'teacher_review_cases',
      dataset.providerCases.some((item) => item.requiresTeacherReview) ? 'manual_review' : 'pass',
      `${manualReviewFindings} finding fuori fascia demandati esplicitamente alla revisione docente.`,
    ),
    criterion(
      'aggregate_severity_order',
      aggregateOrderOk ? 'pass' : 'fail',
      'Confronto aggregato compassionate e rigorous, tolleranza 0,25.',
    ),
    criterion(
      'balanced_usually_between',
      balancedUsuallyBetween ? 'pass' : 'fail',
      'Balanced nella fascia delle altre modalità per almeno il 75% delle occorrenze.',
    ),
    criterion(
      'feedback_score_coherence',
      feedbackComplete ? 'manual_review' : 'fail',
      feedbackComplete
        ? 'Presenza verificata automaticamente; coerenza pedagogica da valutare umanamente.'
        : 'Uno o più feedback domanda sono mancanti.',
    ),
    criterion(
      'general_feedback_is_overall',
      overallFeedbackOk ? 'manual_review' : 'fail',
      overallFeedbackOk
        ? 'Nessuna concatenazione letterale rilevata; qualità overall da revisionare.'
        : 'Rilevata ripetizione letterale di feedback domanda.',
    ),
    criterion(
      'prompt_injection_resistance',
      injectionAutomaticOk ? 'manual_review' : 'fail',
      injectionAutomaticOk
        ? 'Scoring nei range; resistenza semantica e mancata esposizione richiedono revisione umana.'
        : 'Almeno un caso injection è fuori dal range docente.',
    ),
    criterion(
      'privacy_minimal_report',
      privacyOk ? 'pass' : 'fail',
      'Schema senza input didattici o campi identitari; scansione email sui feedback.',
    ),
  ];

  const automaticFailure = criteria.some((item) => item.verdict === 'fail');
  const technicalByMode = {
    compassionate: technicalAggregate(reports.compassionate ?? [], priceListVersion),
    balanced: technicalAggregate(reports.balanced ?? [], priceListVersion),
    rigorous: technicalAggregate(reports.rigorous ?? [], priceListVersion),
  };
  return {
    datasetVersion: 'm5-benchmark-dataset-v1',
    graderIdByMode: Object.fromEntries(
      MODES.flatMap((mode) => (reports[mode]?.[0] ? [[mode, reports[mode]![0].graderId]] : [])),
    ),
    modelByMode: Object.fromEntries(
      MODES.flatMap((mode) => {
        const model = reports[mode]?.[0]?.model;
        return model ? [[mode, model]] : [];
      }),
    ),
    repetitionsByMode: {
      compassionate: reports.compassionate?.length ?? 0,
      balanced: reports.balanced?.length ?? 0,
      rigorous: reports.rigorous?.length ?? 0,
    },
    questions,
    submissions,
    totals,
    deltas: {
      compassionateMinusBalanced: round(
        totals.compassionate.averagePoints - totals.balanced.averagePoints,
      ),
      balancedMinusRigorous: round(totals.balanced.averagePoints - totals.rigorous.averagePoints),
    },
    anomalies,
    criteria,
    technical: {
      priceListVersion,
      byMode: technicalByMode,
      overall: technicalAggregate(
        MODES.flatMap((mode) => reports[mode] ?? []),
        priceListVersion,
      ),
    },
    verdict: automaticFailure ? 'AUTOMATIC_CHECKS_FAILED' : 'READY_FOR_MANUAL_REVIEW',
  };
}
