import {
  estimateCostBreakdown,
  OPENAI_PRODUCTION_MODEL,
  DEFAULT_PRICE_LIST_VERSION,
} from './aiCorrectionCost.js';
import { buildBenchmarkGraderInput, type M5BenchmarkDataset } from './m5BenchmarkHarness.js';
import { buildOpenAiGradingRequest, OPENAI_MAX_OUTPUT_TOKENS } from './openAiGrader.js';

export interface M5BenchmarkExecutionPlan {
  dryRun: true;
  modes: readonly ['compassionate', 'balanced', 'rigorous'];
  repetitions: number;
  submissionsPerMode: number;
  plannedCalls: number;
  maximumProviderAttempts: number;
  inputTokensUpperBound: number;
  outputTokensUpperBound: number;
  costUpperBoundMicroUsd: number;
  model: string;
  priceListVersion: string;
}

/** Piano locale puro: nessun transport, secret, rete o scrittura. */
export function buildM5BenchmarkExecutionPlan(
  dataset: M5BenchmarkDataset,
  options: { repetitions?: number; maxAttemptsPerCall?: number } = {},
): M5BenchmarkExecutionPlan {
  const repetitions = options.repetitions ?? 3;
  const maxAttemptsPerCall = options.maxAttemptsPerCall ?? 2;
  if (!Number.isInteger(repetitions) || repetitions < 1) throw new Error('Ripetizioni non valide.');
  if (!Number.isInteger(maxAttemptsPerCall) || maxAttemptsPerCall < 1) {
    throw new Error('Numero massimo di tentativi non valido.');
  }

  const modes = ['compassionate', 'balanced', 'rigorous'] as const;
  const casesById = new Map(dataset.providerCases.map((item) => [item.id, item]));
  let inputPerRepetition = 0;
  for (const gradingMode of modes) {
    for (const submission of dataset.benchmarkSubmissions) {
      const { input } = buildBenchmarkGraderInput(submission, casesById, gradingMode);
      inputPerRepetition += Buffer.byteLength(
        JSON.stringify(buildOpenAiGradingRequest(input, OPENAI_PRODUCTION_MODEL)),
        'utf8',
      );
    }
  }

  const plannedCalls = modes.length * dataset.benchmarkSubmissions.length * repetitions;
  const maximumProviderAttempts = plannedCalls * maxAttemptsPerCall;
  const inputTokensUpperBound = inputPerRepetition * repetitions * maxAttemptsPerCall;
  const outputTokensUpperBound = OPENAI_MAX_OUTPUT_TOKENS * maximumProviderAttempts;
  const cost = estimateCostBreakdown(
    inputTokensUpperBound,
    outputTokensUpperBound,
    DEFAULT_PRICE_LIST_VERSION,
    OPENAI_PRODUCTION_MODEL,
  );
  if (!cost) throw new Error('Listino benchmark non disponibile.');

  return {
    dryRun: true,
    modes,
    repetitions,
    submissionsPerMode: dataset.benchmarkSubmissions.length,
    plannedCalls,
    maximumProviderAttempts,
    inputTokensUpperBound,
    outputTokensUpperBound,
    costUpperBoundMicroUsd: cost.costMicroUsd,
    model: OPENAI_PRODUCTION_MODEL,
    priceListVersion: DEFAULT_PRICE_LIST_VERSION,
  };
}
