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
  options: {
    repetitions?: number;
    maxAttemptsPerCall?: number;
    /** M5-QUALITY-05: modello del piano (default = produzione nano). */
    model?: string;
    /** Listino coerente col modello (default = listino DEV). */
    priceListVersion?: string;
  } = {},
): M5BenchmarkExecutionPlan {
  const repetitions = options.repetitions ?? 3;
  const maxAttemptsPerCall = options.maxAttemptsPerCall ?? 2;
  const model = options.model ?? OPENAI_PRODUCTION_MODEL;
  const priceListVersion = options.priceListVersion ?? DEFAULT_PRICE_LIST_VERSION;
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
        JSON.stringify(buildOpenAiGradingRequest(input, model)),
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
    priceListVersion,
    model,
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
    model,
    priceListVersion,
  };
}
