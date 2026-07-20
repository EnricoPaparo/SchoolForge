import type { GradingMode } from './aiCorrectionGatewayCore.js';
import {
  buildM5BenchmarkComparativeReport,
  type BenchmarkAnomaly,
  type BenchmarkCriterionResult,
  type BenchmarkTechnicalValue,
  type M5BenchmarkComparativeReport,
} from './m5BenchmarkComparison.js';
import type {
  M5BenchmarkDataset,
  M5BenchmarkModeReports,
  M5BenchmarkReport,
} from './m5BenchmarkHarness.js';
import { OPENAI_GRADING_CONTRACT_VERSION } from './openAiGrader.js';

/**
 * M5-QUALITY-06 — rivalutazione **offline** di un report benchmark già
 * esistente contro il dataset aggiornato (ricalibrazione docente di INF-004).
 *
 * Vincoli assoluti: nessuna rete, nessuna API key, nessuna nuova risposta del
 * provider. I risultati reali del report originale (punteggi, feedback, usage,
 * costo, latenza) restano **immutati**: si ricalcolano soltanto le fasce
 * mode-aware, le anomalie e i criteri che dipendono dal dataset, riusando la
 * stessa logica del comparatore. L'esito è un report **derivato nuovo**; il
 * report originale non viene mai sovrascritto.
 */

const MODES: readonly GradingMode[] = ['compassionate', 'balanced', 'rigorous'];

export type ReevaluationBlockingField =
  | 'datasetVersion'
  | 'promptContractVersion'
  | 'model'
  | 'structure';

export class ReevaluationIncompatibleError extends Error {
  readonly blockingField: ReevaluationBlockingField;
  constructor(blockingField: ReevaluationBlockingField, message: string) {
    super(message);
    this.name = 'ReevaluationIncompatibleError';
    this.blockingField = blockingField;
  }
}

export interface ReevaluationExpectations {
  datasetVersion: string;
  promptContractVersion: string;
  /** Modello atteso; se omesso qualunque modello uniforme è accettato. */
  model?: string;
}

function uniqueModel(report: M5BenchmarkComparativeReport): string | null {
  const models = new Set(MODES.map((mode) => report.modelByMode[mode]).filter(Boolean));
  return models.size === 1 ? [...models][0]! : null;
}

/**
 * Verifica **fail-closed** che un report sia rivalutabile: `datasetVersion` e
 * `promptContractVersion` coincidenti con quelli attesi, modello uniforme (ed
 * eventualmente uguale a quello atteso) e struttura minima presente. Qualunque
 * scostamento impedisce la rivalutazione: non si inventano dati.
 */
export function assertReevaluable(
  report: M5BenchmarkComparativeReport,
  expected: ReevaluationExpectations,
): void {
  if (
    typeof report !== 'object' ||
    report === null ||
    !Array.isArray(report.questions) ||
    !Array.isArray(report.submissions) ||
    typeof report.technical !== 'object' ||
    typeof report.repetitionsByMode !== 'object'
  ) {
    throw new ReevaluationIncompatibleError('structure', 'Struttura del report non riconosciuta.');
  }
  if (report.datasetVersion !== expected.datasetVersion) {
    throw new ReevaluationIncompatibleError(
      'datasetVersion',
      `datasetVersion del report (${String(report.datasetVersion)}) diverso da ${expected.datasetVersion}.`,
    );
  }
  if (report.promptContractVersion !== expected.promptContractVersion) {
    throw new ReevaluationIncompatibleError(
      'promptContractVersion',
      report.promptContractVersion === undefined
        ? 'Il report non registra promptContractVersion: prompt non verificabile, rivalutazione rifiutata.'
        : `promptContractVersion del report (${report.promptContractVersion}) diverso dal contratto corrente (${expected.promptContractVersion}).`,
    );
  }
  const model = uniqueModel(report);
  if (!model) {
    throw new ReevaluationIncompatibleError('model', 'Il report non ha un modello uniforme.');
  }
  if (expected.model !== undefined && model !== expected.model) {
    throw new ReevaluationIncompatibleError(
      'model',
      `Modello del report (${model}) diverso da quello atteso (${expected.model}).`,
    );
  }
}

/**
 * Ricostruisce i `M5BenchmarkModeReports` grezzi dal report comparativo,
 * fedelmente e senza inventare nulla: punteggi e feedback per ripetizione,
 * feedback generale per consegna, ordine dedotto dal dataset (immutato). È
 * fail-closed: se le lunghezze delle serie non combaciano con le ripetizioni
 * dichiarate, la ricostruzione è rifiutata (report degradato non rivalutabile).
 */
export function reconstructModeReportsFromComparative(
  report: M5BenchmarkComparativeReport,
  dataset: M5BenchmarkDataset,
): M5BenchmarkModeReports {
  const model = uniqueModel(report);
  if (!model) throw new ReevaluationIncompatibleError('model', 'Modello non uniforme.');
  const questionByOccurrence = new Map(report.questions.map((q) => [q.occurrenceId, q]));
  const generalBySubmission = new Map(report.submissions.map((s) => [s.submissionId, s]));

  const reports: M5BenchmarkModeReports = { compassionate: [], balanced: [], rigorous: [] };
  for (const mode of MODES) {
    const repetitions = report.repetitionsByMode[mode];
    if (!Number.isInteger(repetitions) || repetitions < 0) {
      throw new ReevaluationIncompatibleError('structure', 'repetitionsByMode non valido.');
    }
    for (let r = 0; r < repetitions; r++) {
      const submissions = dataset.benchmarkSubmissions.map((submission) => {
        const general = generalBySubmission.get(submission.id)?.generalFeedback?.[mode];
        if (!Array.isArray(general) || general.length !== repetitions) {
          throw new ReevaluationIncompatibleError(
            'structure',
            `Feedback generale incoerente per ${submission.id} (${mode}).`,
          );
        }
        const results = submission.providerCaseIds.map((providerCaseId, index) => {
          const question = questionByOccurrence.get(`${submission.id}:${providerCaseId}`);
          const observation = question?.byMode?.[mode];
          if (
            !observation ||
            observation.points.length !== repetitions ||
            observation.feedback.length !== repetitions
          ) {
            throw new ReevaluationIncompatibleError(
              'structure',
              `Serie punteggi/feedback incoerente per ${submission.id}:${providerCaseId} (${mode}).`,
            );
          }
          return {
            providerCaseId,
            order: index + 1,
            points: observation.points[r],
            feedback: observation.feedback[r],
          };
        });
        return {
          submissionId: submission.id,
          providerCaseIds: [...submission.providerCaseIds],
          // Latenza/usage reali non sono ricostruibili dal report comparativo:
          // il blocco `technical` viene preservato tale e quale dal report
          // originale (vedi reevaluateComparativeReport), quindi qui è neutro.
          latencyMs: 0,
          callCompleted: true,
          outputInvalid: false,
          results,
          generalFeedback: general[r],
        };
      });
      reports[mode].push({
        datasetVersion: report.datasetVersion,
        graderId: report.graderIdByMode[mode] ?? 'openai',
        ...(model ? { model } : {}),
        gradingMode: mode,
        submissions,
      } satisfies M5BenchmarkReport);
    }
  }
  return reports;
}

export interface ReevaluationOutcome {
  status: 'reevaluated';
  model: string;
  datasetVersion: string;
  promptContractVersion: string;
  original: { verdict: M5BenchmarkComparativeReport['verdict'] };
  /** Report derivato nuovo: fasce/anomalie/criteri/verdetto ricalcolati. */
  derived: M5BenchmarkComparativeReport;
}

/**
 * Rivaluta offline il report contro il dataset aggiornato. Fail-closed sulla
 * compatibilità; ricostruisce i report grezzi, ri-esegue il comparatore con il
 * dataset aggiornato e **preserva** il blocco `technical` reale (costo, token,
 * latenza non dipendono dal dataset). Ritorna un esito derivato senza toccare
 * il report originale.
 */
export function reevaluateComparativeReport(
  report: M5BenchmarkComparativeReport,
  dataset: M5BenchmarkDataset,
  expected: ReevaluationExpectations = {
    datasetVersion: 'm5-benchmark-dataset-v1',
    promptContractVersion: OPENAI_GRADING_CONTRACT_VERSION,
  },
): ReevaluationOutcome {
  assertReevaluable(report, expected);
  const model = uniqueModel(report)!;
  const reconstructed = reconstructModeReportsFromComparative(report, dataset);
  const rebuilt = buildM5BenchmarkComparativeReport(
    dataset,
    reconstructed,
    report.technical.priceListVersion,
  );
  // Il blocco technical reale (costo/token/latenza) non dipende dal dataset:
  // si preserva verbatim dal report originale invece del ricalcolo neutro.
  const derived: M5BenchmarkComparativeReport = { ...rebuilt, technical: report.technical };
  return {
    status: 'reevaluated',
    model,
    datasetVersion: report.datasetVersion,
    promptContractVersion: report.promptContractVersion,
    original: { verdict: report.verdict },
    derived,
  };
}

/**
 * Checklist di revisione umana per il Gate G7: resta APERTO finché il docente
 * non conferma manualmente ciascun punto. La rivalutazione automatica non può
 * chiudere G7.
 */
export const G7_HUMAN_REVIEW_CHECKLIST: readonly string[] = [
  'Qualita pedagogica dei feedback per domanda.',
  'Qualita overall dei feedback generali.',
  'Resistenza semantica alle prompt injection.',
  'Accettabilita delle modalita compassionate/balanced/rigorous.',
];

export interface ReevaluationReviewSummary {
  model: string;
  datasetVersion: string;
  promptContractVersion: string;
  originalVerdict: M5BenchmarkComparativeReport['verdict'];
  derivedVerdict: M5BenchmarkComparativeReport['verdict'];
  automaticCriteria: BenchmarkCriterionResult[];
  /** Anomalie che bloccano automaticamente (automaticBlocking === true). */
  blockingAnomalies: BenchmarkAnomaly[];
  /** Casi riservati alla revisione docente (finding manuali da confermare). */
  manualReviewAnomalies: BenchmarkAnomaly[];
  perQuestionFeedback: Array<{
    occurrenceId: string;
    providerCaseId: string;
    byMode: Record<GradingMode, string[]>;
  }>;
  generalFeedback: Array<{ submissionId: string; byMode: Record<GradingMode, string[]> }>;
  cost: {
    priceListVersion: string;
    costActualMicroUsd: BenchmarkTechnicalValue;
    costActualUsd: BenchmarkTechnicalValue;
  };
  latency: {
    average: BenchmarkTechnicalValue;
    p50: BenchmarkTechnicalValue;
    p95: BenchmarkTechnicalValue;
  };
  /** G7 resta aperto: punti che il docente deve confermare manualmente. */
  pendingHumanChecklist: readonly string[];
}

/**
 * Prepara il riepilogo per la revisione umana a partire dall'esito derivato.
 * Non introduce contenuti nuovi: espone criteri automatici, anomalie bloccanti,
 * casi da revisione manuale, feedback (dal dataset sintetico), costo e latenza
 * reali, oltre alla checklist G7 ancora da confermare.
 */
export function buildReevaluationReviewSummary(
  outcome: ReevaluationOutcome,
): ReevaluationReviewSummary {
  const derived = outcome.derived;
  const overall = derived.technical.overall;
  return {
    model: outcome.model,
    datasetVersion: outcome.datasetVersion,
    promptContractVersion: outcome.promptContractVersion,
    originalVerdict: outcome.original.verdict,
    derivedVerdict: derived.verdict,
    automaticCriteria: derived.criteria,
    blockingAnomalies: derived.anomalies.filter((item) => item.automaticBlocking === true),
    manualReviewAnomalies: derived.anomalies.filter(
      (item) => item.code === 'manual_review_required',
    ),
    perQuestionFeedback: derived.questions.map((question) => ({
      occurrenceId: question.occurrenceId,
      providerCaseId: question.providerCaseId,
      byMode: {
        compassionate: question.byMode.compassionate.feedback,
        balanced: question.byMode.balanced.feedback,
        rigorous: question.byMode.rigorous.feedback,
      },
    })),
    generalFeedback: derived.submissions.map((submission) => ({
      submissionId: submission.submissionId,
      byMode: submission.generalFeedback,
    })),
    cost: {
      priceListVersion: derived.technical.priceListVersion,
      costActualMicroUsd: overall.costActualMicroUsd,
      costActualUsd: overall.costActualUsd,
    },
    latency: {
      average: overall.latencyMs.average,
      p50: overall.latencyMs.p50,
      p95: overall.latencyMs.p95,
    },
    pendingHumanChecklist: G7_HUMAN_REVIEW_CHECKLIST,
  };
}
