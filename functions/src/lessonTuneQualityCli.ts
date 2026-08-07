import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { fileURLToPath } from 'node:url';
import { actualCostMicroUsd } from './aiCorrectionCost.js';
import type { ModelProfile } from './aiCorrectionModelProfile.js';
import { resolveContentModel, type LessonRequest } from './aiContentCore.js';
import { createContentProvider, type ContentProvider } from './aiContentProvider.js';
import { AI_CONTENT_PROMPT_VERSION } from './aiContentPrompt.js';
import { validateLessonProposal } from './aiContentValidation.js';
import { loadLessonDepthIsovariantDataset } from './lessonDepthIsovariantBenchmark.js';
import { loadLessonDepthSparseDataset } from './lessonDepthSparseBenchmark.js';
import {
  buildLessonTuneExecutionPlan,
  buildLessonTuneRequest,
  loadLessonTuneDataset,
  selectLessonTuneScenarios,
  type LessonTuneDataset,
  type LessonTuneExecutionPlan,
  type LessonTunePlanSplit,
} from './lessonTuneQualityBenchmark.js';
import { LESSON_MANUAL_QUALITY_PROFILE } from './lessonManualQualityBenchmark.js';

export const LESSON_TUNE_EXECUTE_FLAG = '--execute-real-openai';
export const LESSON_TUNE_COST_ACK_FLAG = '--i-understand-this-costs-money';
export const LESSON_TUNE_SPLIT_FLAG_PREFIX = '--benchmark-split=';
export const LESSON_TUNE_PROFILE_FLAG_PREFIX = '--benchmark-model-profile=';

const ECONOMY_CONFIRMATIONS: Readonly<Record<Exclude<LessonTunePlanSplit, 'all'>, string>> = {
  tuning: 'ESEGUI 8 LEZIONI TUNING REALI',
  holdout: 'ESEGUI 4 LEZIONI HOLDOUT REALI',
};
const QUALITY_CONFIRMATIONS: Readonly<Record<Exclude<LessonTunePlanSplit, 'all'>, string>> = {
  tuning: 'ESEGUI 8 LEZIONI TUNING REALI QUALITY',
  holdout: 'ESEGUI 4 LEZIONI HOLDOUT REALI QUALITY',
};

function confirmationFor(
  split: Exclude<LessonTunePlanSplit, 'all'>,
  modelProfile: ModelProfile,
): string {
  return modelProfile === 'quality' ? QUALITY_CONFIRMATIONS[split] : ECONOMY_CONFIRMATIONS[split];
}

export interface LessonTuneGeneratedSample {
  scenarioId: string;
  split: Exclude<LessonTunePlanSplit, 'all'>;
  fileName: string;
  inputTokens: number | null;
  outputTokens: number | null;
  actualCostMicroUsd: number | null;
  priorBillingRisk: boolean;
}

export interface LessonTuneLocalReport {
  datasetVersion: string;
  rubricVersion: string;
  promptVersion: typeof AI_CONTENT_PROMPT_VERSION;
  split: Exclude<LessonTunePlanSplit, 'all'>;
  generatedAt: string;
  modelProfile: ModelProfile;
  model: string;
  priceListVersion: string;
  samples: LessonTuneGeneratedSample[];
  totalActualCostMicroUsd: number | null;
  costUpperBoundMicroUsd: number;
}

export interface LessonTuneCliDeps {
  argv: readonly string[];
  getApiKey: () => string | undefined;
  stdinIsTTY: boolean;
  stdoutIsTTY: boolean;
  nodeMajorVersion: number;
  loadDataset: () => Promise<LessonTuneDataset>;
  buildPlan: (
    dataset: LessonTuneDataset,
    split: LessonTunePlanSplit,
    modelProfile: ModelProfile,
  ) => LessonTuneExecutionPlan;
  confirm: (prompt: string) => Promise<string>;
  createProvider: (apiKey: string) => ContentProvider;
  writeOutput: (params: {
    dataset: LessonTuneDataset;
    plan: LessonTuneExecutionPlan;
    split: Exclude<LessonTunePlanSplit, 'all'>;
    generatedAt: string;
    samples: Array<LessonTuneGeneratedSample & { body: string }>;
  }) => Promise<string>;
  now: () => Date;
  log: (message: string) => void;
}

function parseSplit(argv: readonly string[]): LessonTunePlanSplit {
  const flags = argv.filter((arg) => arg.startsWith(LESSON_TUNE_SPLIT_FLAG_PREFIX));
  if (flags.length > 1) throw new Error('Specificare un solo split benchmark.');
  if (flags.length === 0) return 'all';
  const value = flags[0]?.slice(LESSON_TUNE_SPLIT_FLAG_PREFIX.length);
  if (value !== 'tuning' && value !== 'holdout') {
    throw new Error('Split benchmark non supportato: usare tuning oppure holdout.');
  }
  return value;
}

function parseModelProfile(argv: readonly string[]): ModelProfile {
  const flags = argv.filter((arg) => arg.startsWith(LESSON_TUNE_PROFILE_FLAG_PREFIX));
  if (flags.length > 1) throw new Error('Specificare un solo profilo modello benchmark.');
  if (flags.length === 0) return LESSON_MANUAL_QUALITY_PROFILE;
  const value = flags[0]?.slice(LESSON_TUNE_PROFILE_FLAG_PREFIX.length);
  if (value !== 'economy' && value !== 'quality') {
    throw new Error('Profilo modello benchmark non supportato: usare economy oppure quality.');
  }
  return value;
}

function usageValue(value: number | undefined): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

async function generateOne(
  provider: ContentProvider,
  request: LessonRequest,
  scenarioId: string,
  split: Exclude<LessonTunePlanSplit, 'all'>,
  modelProfile: ModelProfile,
  model: string,
  priceListVersion: string,
): Promise<LessonTuneGeneratedSample & { body: string }> {
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
    split,
    fileName: `lesson-tune-01-${scenarioId}-${modelProfile}.md`,
    inputTokens,
    outputTokens,
    actualCostMicroUsd: actual,
    priorBillingRisk: outcome.priorBillingRisk,
    body: proposal.body,
  };
}

export async function runLessonTuneCli(deps: LessonTuneCliDeps): Promise<'dry-run' | 'executed'> {
  const allowed = new Set([LESSON_TUNE_EXECUTE_FLAG, LESSON_TUNE_COST_ACK_FLAG]);
  const unknownFlags = deps.argv.filter(
    (arg) =>
      arg.startsWith('--') &&
      !allowed.has(arg) &&
      !arg.startsWith(LESSON_TUNE_SPLIT_FLAG_PREFIX) &&
      !arg.startsWith(LESSON_TUNE_PROFILE_FLAG_PREFIX),
  );
  if (unknownFlags.length > 0) throw new Error(`Flag non supportato: ${unknownFlags.join(', ')}.`);

  const split = parseSplit(deps.argv);
  const modelProfile = parseModelProfile(deps.argv);
  if (modelProfile === 'quality' && split === 'all') {
    throw new Error('Il profilo quality richiede uno split esplicito: tuning oppure holdout.');
  }
  const dataset = await deps.loadDataset();
  const plan = deps.buildPlan(dataset, split, modelProfile);
  deps.log(JSON.stringify({ ...plan, promptVersion: AI_CONTENT_PROMPT_VERSION }, null, 2));

  if (!deps.argv.includes(LESSON_TUNE_EXECUTE_FLAG)) {
    deps.log('DRY-RUN: nessuna API key letta, nessun provider e nessuna chiamata di rete.');
    return 'dry-run';
  }
  if (split === 'all') {
    throw new Error('Esecuzione reale negata: scegliere esplicitamente tuning oppure holdout.');
  }
  if (!deps.argv.includes(LESSON_TUNE_COST_ACK_FLAG)) {
    throw new Error(`Esecuzione negata: aggiungere anche ${LESSON_TUNE_COST_ACK_FLAG}.`);
  }
  if (deps.nodeMajorVersion !== 22) {
    throw new Error('Esecuzione reale negata: usare Node 22 come richiesto dal repository.');
  }
  if (!deps.stdinIsTTY || !deps.stdoutIsTTY) {
    throw new Error('Esecuzione reale negata senza terminale interattivo.');
  }
  const confirmation = confirmationFor(split, modelProfile);
  const answer = await deps.confirm(
    `Per confermare ${plan.plannedCalls} chiamate pianificate (fino a ${plan.maximumProviderAttempts} tentativi) sullo split ${split} e profilo ${modelProfile}, digitare esattamente “${confirmation}”: `,
  );
  if (answer !== confirmation) throw new Error('Conferma non valida: benchmark annullato.');

  const apiKey = deps.getApiKey()?.trim();
  if (!apiKey) throw new Error('OPENAI_API_KEY non disponibile: benchmark annullato.');
  const provider = deps.createProvider(apiKey);
  const generatedAt = deps.now().toISOString();
  const { model, priceListVersion } = resolveContentModel(modelProfile);
  const samples: Array<LessonTuneGeneratedSample & { body: string }> = [];
  for (const scenario of selectLessonTuneScenarios(dataset, split)) {
    samples.push(
      await generateOne(
        provider,
        buildLessonTuneRequest(scenario, modelProfile),
        scenario.id,
        scenario.split,
        modelProfile,
        model,
        priceListVersion,
      ),
    );
  }
  const outputPath = await deps.writeOutput({ dataset, plan, split, generatedAt, samples });
  deps.log(`Report e ${samples.length} Markdown originali scritti localmente in ${outputPath}.`);
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
  dataset: LessonTuneDataset;
  plan: LessonTuneExecutionPlan;
  split: Exclude<LessonTunePlanSplit, 'all'>;
  generatedAt: string;
  samples: Array<LessonTuneGeneratedSample & { body: string }>;
}): Promise<string> {
  const safeTimestamp = params.generatedAt.replaceAll(':', '-').replaceAll('.', '-');
  const outputDir = resolve('lib', `lesson-tune-01-${params.split}-${safeTimestamp}`);
  await mkdir(outputDir, { recursive: false });
  for (const sample of params.samples) {
    await writeFile(resolve(outputDir, sample.fileName), `${sample.body.trim()}\n`, 'utf8');
  }
  const publicSamples = params.samples.map(({ body: _body, ...sample }) => sample);
  const knownCosts = publicSamples.map((sample) => sample.actualCostMicroUsd);
  const report: LessonTuneLocalReport = {
    datasetVersion: params.dataset.datasetVersion,
    rubricVersion: params.dataset.rubricVersion,
    promptVersion: AI_CONTENT_PROMPT_VERSION,
    split: params.split,
    generatedAt: params.generatedAt,
    modelProfile: params.plan.modelProfile,
    model: params.plan.model,
    priceListVersion: params.plan.priceListVersion,
    samples: publicSamples,
    totalActualCostMicroUsd: knownCosts.every((cost): cost is number => cost !== null)
      ? knownCosts.reduce((total, cost) => total + cost, 0)
      : null,
    costUpperBoundMicroUsd: params.plan.costUpperBoundMicroUsd,
  };
  await writeFile(
    resolve(outputDir, 'lesson-tune-01-report.json'),
    `${JSON.stringify(report, null, 2)}\n`,
    'utf8',
  );
  return outputDir;
}

async function main(): Promise<void> {
  await runLessonTuneCli({
    argv: process.argv.slice(2),
    getApiKey: () => process.env.OPENAI_API_KEY,
    stdinIsTTY: Boolean(stdin.isTTY),
    stdoutIsTTY: Boolean(stdout.isTTY),
    nodeMajorVersion: Number.parseInt(process.versions.node.split('.')[0] ?? '', 10),
    // LESSON-DEPTH-02/03 — `SPARSE=1` esegue il dataset del caso povero e
    // `ISOVARIANT=1` quello a variabile singola, invece di quello congelato.
    // Sono interruttori sull'ingresso, non runner alternativi: piano,
    // esecuzione, costi e report restano quelli già validati. Se sono attivi
    // entrambi il comando si ferma, perché il report non direbbe da solo quale
    // dei due dataset è stato eseguito.
    loadDataset: () => {
      const sparse = process.env.SPARSE === '1';
      const isovariant = process.env.ISOVARIANT === '1';
      if (sparse && isovariant) {
        throw new Error('SPARSE e ISOVARIANT sono alternativi: impostane uno solo.');
      }
      if (isovariant) return loadLessonDepthIsovariantDataset();
      return sparse ? loadLessonDepthSparseDataset() : loadLessonTuneDataset();
    },
    buildPlan: buildLessonTuneExecutionPlan,
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
