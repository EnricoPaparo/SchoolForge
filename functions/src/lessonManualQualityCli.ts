import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { fileURLToPath } from 'node:url';
import { actualCostMicroUsd } from './aiCorrectionCost.js';
import { resolveContentModel, type LessonRequest } from './aiContentCore.js';
import { createContentProvider, type ContentProvider } from './aiContentProvider.js';
import { validateLessonProposal } from './aiContentValidation.js';
import {
  buildLessonManualQualityExecutionPlan,
  buildLessonManualRequest,
  loadLessonManualQualityDataset,
  LESSON_MANUAL_QUALITY_PROFILE,
  type LessonManualQualityDataset,
  type LessonManualQualityExecutionPlan,
} from './lessonManualQualityBenchmark.js';

export const LESSON_MANUAL_EXECUTE_FLAG = '--execute-real-openai';
export const LESSON_MANUAL_COST_ACK_FLAG = '--i-understand-this-costs-money';
export const LESSON_MANUAL_CONFIRMATION = 'ESEGUI 6 LEZIONI REALI';

export interface LessonManualGeneratedSample {
  scenarioId: string;
  fileName: string;
  inputTokens: number | null;
  outputTokens: number | null;
  actualCostMicroUsd: number | null;
  priorBillingRisk: boolean;
}

export interface LessonManualQualityLocalReport {
  datasetVersion: string;
  rubricVersion: string;
  generatedAt: string;
  modelProfile: typeof LESSON_MANUAL_QUALITY_PROFILE;
  model: string;
  priceListVersion: string;
  samples: LessonManualGeneratedSample[];
  totalActualCostMicroUsd: number | null;
  costUpperBoundMicroUsd: number;
}

export interface LessonManualQualityCliDeps {
  argv: readonly string[];
  getApiKey: () => string | undefined;
  stdinIsTTY: boolean;
  stdoutIsTTY: boolean;
  nodeMajorVersion: number;
  loadDataset: () => Promise<LessonManualQualityDataset>;
  buildPlan: (dataset: LessonManualQualityDataset) => LessonManualQualityExecutionPlan;
  confirm: (prompt: string) => Promise<string>;
  createProvider: (apiKey: string) => ContentProvider;
  writeOutput: (params: {
    dataset: LessonManualQualityDataset;
    plan: LessonManualQualityExecutionPlan;
    generatedAt: string;
    samples: Array<LessonManualGeneratedSample & { body: string }>;
  }) => Promise<string>;
  now: () => Date;
  log: (message: string) => void;
}

export type LessonManualQualityCliResult = 'dry-run' | 'executed';

function usageValue(value: number | undefined): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

async function generateOne(
  provider: ContentProvider,
  request: LessonRequest,
  scenarioId: string,
  model: string,
  priceListVersion: string,
): Promise<LessonManualGeneratedSample & { body: string }> {
  const outcome = await provider.generate(request, model);
  if (outcome.status !== 'ok') {
    throw new Error(`${scenarioId}: provider non disponibile (${outcome.phase}).`);
  }
  const proposal = validateLessonProposal(outcome.output);
  const inputTokens = usageValue(outcome.usage?.inputTokens);
  const outputTokens = usageValue(outcome.usage?.outputTokens);
  const actual =
    !outcome.priorBillingRisk && inputTokens !== null && outputTokens !== null
      ? actualCostMicroUsd(inputTokens, outputTokens, priceListVersion, model)
      : null;
  return {
    scenarioId,
    fileName: `lesson-manual-03-${scenarioId}-economy.md`,
    inputTokens,
    outputTokens,
    actualCostMicroUsd: actual,
    priorBillingRisk: outcome.priorBillingRisk,
    body: proposal.body,
  };
}

export async function runLessonManualQualityCli(
  deps: LessonManualQualityCliDeps,
): Promise<LessonManualQualityCliResult> {
  const unknownFlags = deps.argv.filter(
    (arg) =>
      arg.startsWith('--') &&
      arg !== LESSON_MANUAL_EXECUTE_FLAG &&
      arg !== LESSON_MANUAL_COST_ACK_FLAG,
  );
  if (unknownFlags.length > 0) {
    throw new Error(`Flag non supportato: ${unknownFlags.join(', ')}.`);
  }
  const dataset = await deps.loadDataset();
  const plan = deps.buildPlan(dataset);
  deps.log(JSON.stringify(plan, null, 2));

  if (!deps.argv.includes(LESSON_MANUAL_EXECUTE_FLAG)) {
    deps.log('DRY-RUN: nessuna API key letta, nessun provider e nessuna chiamata di rete.');
    return 'dry-run';
  }
  if (!deps.argv.includes(LESSON_MANUAL_COST_ACK_FLAG)) {
    throw new Error(`Esecuzione negata: aggiungere anche ${LESSON_MANUAL_COST_ACK_FLAG}.`);
  }
  if (deps.nodeMajorVersion !== 22) {
    throw new Error('Esecuzione reale negata: usare Node 22 come richiesto dal repository.');
  }
  if (!deps.stdinIsTTY || !deps.stdoutIsTTY) {
    throw new Error('Esecuzione reale negata senza terminale interattivo.');
  }
  const answer = await deps.confirm(
    `Per confermare ${plan.plannedCalls} chiamate pianificate (fino a ${plan.maximumProviderAttempts} tentativi) sul profilo economy, digitare esattamente “${LESSON_MANUAL_CONFIRMATION}”: `,
  );
  if (answer !== LESSON_MANUAL_CONFIRMATION) {
    throw new Error('Conferma non valida: benchmark annullato.');
  }
  const apiKey = deps.getApiKey()?.trim();
  if (!apiKey) throw new Error('OPENAI_API_KEY non disponibile: benchmark annullato.');

  const provider = deps.createProvider(apiKey);
  const generatedAt = deps.now().toISOString();
  const { model, priceListVersion } = resolveContentModel(LESSON_MANUAL_QUALITY_PROFILE);
  const samples: Array<LessonManualGeneratedSample & { body: string }> = [];
  for (const [index, scenario] of dataset.scenarios.entries()) {
    const request = buildLessonManualRequest(scenario, index);
    samples.push(await generateOne(provider, request, scenario.id, model, priceListVersion));
  }
  const outputPath = await deps.writeOutput({ dataset, plan, generatedAt, samples });
  deps.log(`Report e 6 Markdown originali scritti localmente in ${outputPath}.`);
  deps.log('Nessun dato è stato scritto su Firestore o Storage.');
  return 'executed';
}

async function defaultConfirmation(promptText: string): Promise<string> {
  const prompt = createInterface({ input: stdin, output: stdout });
  try {
    return await prompt.question(promptText);
  } finally {
    prompt.close();
  }
}

async function defaultWriteOutput(params: {
  dataset: LessonManualQualityDataset;
  plan: LessonManualQualityExecutionPlan;
  generatedAt: string;
  samples: Array<LessonManualGeneratedSample & { body: string }>;
}): Promise<string> {
  const safeTimestamp = params.generatedAt.replaceAll(':', '-').replaceAll('.', '-');
  const outputDir = resolve('lib', `lesson-manual-03-${safeTimestamp}`);
  await mkdir(outputDir, { recursive: false });
  for (const sample of params.samples) {
    await writeFile(resolve(outputDir, sample.fileName), `${sample.body.trim()}\n`, 'utf8');
  }
  const publicSamples = params.samples.map(({ body: _body, ...sample }) => sample);
  const knownCosts = publicSamples.map((sample) => sample.actualCostMicroUsd);
  const report: LessonManualQualityLocalReport = {
    datasetVersion: params.dataset.datasetVersion,
    rubricVersion: params.dataset.rubricVersion,
    generatedAt: params.generatedAt,
    modelProfile: LESSON_MANUAL_QUALITY_PROFILE,
    model: params.plan.model,
    priceListVersion: params.plan.priceListVersion,
    samples: publicSamples,
    totalActualCostMicroUsd: knownCosts.every((cost): cost is number => cost !== null)
      ? knownCosts.reduce((total, cost) => total + cost, 0)
      : null,
    costUpperBoundMicroUsd: params.plan.costUpperBoundMicroUsd,
  };
  await writeFile(
    resolve(outputDir, 'lesson-manual-03-report.json'),
    `${JSON.stringify(report, null, 2)}\n`,
    'utf8',
  );
  return outputDir;
}

async function main(): Promise<void> {
  await runLessonManualQualityCli({
    argv: process.argv.slice(2),
    getApiKey: () => process.env.OPENAI_API_KEY,
    stdinIsTTY: Boolean(stdin.isTTY),
    stdoutIsTTY: Boolean(stdout.isTTY),
    nodeMajorVersion: Number.parseInt(process.versions.node.split('.')[0] ?? '', 10),
    loadDataset: () => loadLessonManualQualityDataset(),
    buildPlan: buildLessonManualQualityExecutionPlan,
    confirm: defaultConfirmation,
    createProvider: (apiKey) => createContentProvider({ mode: 'openai', openAiApiKey: apiKey }),
    writeOutput: defaultWriteOutput,
    now: () => new Date(),
    log: console.log,
  });
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Benchmark non riuscito.');
    process.exitCode = 1;
  });
}
