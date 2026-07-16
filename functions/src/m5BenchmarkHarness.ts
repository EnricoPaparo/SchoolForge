import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { AiGrader, AiGraderInput, AiGraderOutput } from './aiCorrectionGatewayCore.js';

export const DEFAULT_M5_BENCHMARK_DATASET_PATH = fileURLToPath(
  new URL('../../documentazione/evidenze/m5-benchmark-dataset-v1.json', import.meta.url),
);

export interface M5BenchmarkProviderCase {
  id: string;
  materia: string;
  categoria: string;
  domanda: string;
  soluzioneRiferimento: string;
  rispostaStudente: string;
  maxPoints: number;
  difficolta: number;
  expectedMinPoints: number;
  expectedMaxPoints: number;
  motivazioneAttesa: string;
  requiresTeacherReview: boolean;
  containsPromptInjection: boolean;
}

export interface M5BenchmarkSubmission {
  id: string;
  descrizione: string;
  providerCaseIds: string[];
}

export interface M5BenchmarkDataset {
  providerCases: M5BenchmarkProviderCase[];
  benchmarkSubmissions: M5BenchmarkSubmission[];
}

export interface M5BenchmarkCaseResult {
  providerCaseId: string;
  order: number;
  points?: number;
  feedback?: string;
}

export interface M5BenchmarkSubmissionResult {
  submissionId: string;
  providerCaseIds: string[];
  latencyMs: number;
  outputInvalid: boolean;
  results: M5BenchmarkCaseResult[];
  generalFeedback?: string;
  usage?: AiGraderOutput['usage'];
}

export interface M5BenchmarkReport {
  datasetVersion: 'm5-benchmark-dataset-v1';
  graderId: string;
  model?: string;
  submissions: M5BenchmarkSubmissionResult[];
}

export async function loadM5BenchmarkDataset(
  path = DEFAULT_M5_BENCHMARK_DATASET_PATH,
): Promise<M5BenchmarkDataset> {
  const parsed = JSON.parse(await readFile(path, 'utf8')) as unknown;
  if (typeof parsed !== 'object' || parsed === null)
    throw new Error('Dataset benchmark non valido.');
  const value = parsed as Record<string, unknown>;
  if (!Array.isArray(value.providerCases) || !Array.isArray(value.benchmarkSubmissions)) {
    throw new Error('Dataset benchmark incompleto.');
  }
  return value as unknown as M5BenchmarkDataset;
}

export function buildBenchmarkGraderInput(
  submission: M5BenchmarkSubmission,
  casesById: ReadonlyMap<string, M5BenchmarkProviderCase>,
): { input: AiGraderInput; caseIdByOrder: Map<number, string> } {
  const caseIdByOrder = new Map<number, string>();
  const questions = submission.providerCaseIds.map((caseId, index) => {
    const benchmarkCase = casesById.get(caseId);
    if (!benchmarkCase) throw new Error(`Caso benchmark mancante: ${caseId}`);
    const order = index + 1;
    caseIdByOrder.set(order, caseId);
    return {
      order,
      questionText: benchmarkCase.domanda,
      referenceSolution: benchmarkCase.soluzioneRiferimento,
      studentAnswer: benchmarkCase.rispostaStudente,
      maxPoints: benchmarkCase.maxPoints,
      difficulty: benchmarkCase.difficolta,
    };
  });
  return {
    input: {
      requestId: `benchmark_${submission.id}`,
      questions,
      submissionContext: {
        priorPoints: 0,
        totalMaxPoints: questions.reduce((sum, question) => sum + question.maxPoints, 0),
      },
    },
    caseIdByOrder,
  };
}

function assertBenchmarkOutput(output: AiGraderOutput, input: AiGraderInput): void {
  if (
    output.requestId !== input.requestId ||
    typeof output.generalFeedback !== 'string' ||
    output.generalFeedback.trim().length === 0 ||
    output.results.length !== input.questions.length
  ) {
    throw new Error('Output benchmark incompleto.');
  }
  const maxByOrder = new Map(
    input.questions.map((question) => [question.order, question.maxPoints]),
  );
  const seen = new Set<number>();
  for (const result of output.results) {
    const maxPoints = maxByOrder.get(result.order);
    if (
      maxPoints === undefined ||
      seen.has(result.order) ||
      !Number.isFinite(result.points) ||
      result.points < 0 ||
      result.points > maxPoints ||
      !Number.isInteger(result.points * 4) ||
      typeof result.feedback !== 'string' ||
      result.feedback.trim().length === 0
    ) {
      throw new Error('Output benchmark non valido.');
    }
    seen.add(result.order);
  }
}

/**
 * Runner solo locale/in-memory: stesso AiGraderInput dell'adapter, una chiamata
 * per benchmarkSubmission, nessun dato reale e nessuna promozione automatica.
 */
export async function runM5Benchmark(
  dataset: M5BenchmarkDataset,
  grader: AiGrader,
  options: { now?: () => number } = {},
): Promise<M5BenchmarkReport> {
  const now = options.now ?? Date.now;
  const casesById = new Map(
    dataset.providerCases.map((benchmarkCase) => [benchmarkCase.id, benchmarkCase]),
  );
  const submissions: M5BenchmarkSubmissionResult[] = [];

  for (const submission of dataset.benchmarkSubmissions) {
    const { input, caseIdByOrder } = buildBenchmarkGraderInput(submission, casesById);
    const started = now();
    try {
      const output = await grader.grade(input);
      assertBenchmarkOutput(output, input);
      submissions.push({
        submissionId: submission.id,
        providerCaseIds: [...submission.providerCaseIds],
        latencyMs: Math.max(0, now() - started),
        outputInvalid: false,
        results: output.results.map((result) => ({
          providerCaseId: caseIdByOrder.get(result.order) ?? 'unknown',
          order: result.order,
          points: result.points,
          ...(result.feedback === undefined ? {} : { feedback: result.feedback }),
        })),
        ...(output.generalFeedback === undefined
          ? {}
          : { generalFeedback: output.generalFeedback }),
        ...(output.usage === undefined ? {} : { usage: output.usage }),
      });
    } catch {
      submissions.push({
        submissionId: submission.id,
        providerCaseIds: [...submission.providerCaseIds],
        latencyMs: Math.max(0, now() - started),
        outputInvalid: true,
        results: submission.providerCaseIds.map((providerCaseId, index) => ({
          providerCaseId,
          order: index + 1,
        })),
      });
    }
  }

  return {
    datasetVersion: 'm5-benchmark-dataset-v1',
    graderId: grader.id,
    ...(grader.model ? { model: grader.model } : {}),
    submissions,
  };
}
