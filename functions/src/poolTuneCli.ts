import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { fileURLToPath } from 'node:url';
import { actualCostMicroUsd } from './aiCorrectionCost.js';
import type { ModelProfile } from './aiCorrectionModelProfile.js';
import { resolveContentModel, type PoolRequest } from './aiContentCore.js';
import { createContentProvider, type ContentProvider } from './aiContentProvider.js';
import { AI_POOL_PROMPT_VERSION } from './aiContentPrompt.js';
import { validatePoolProposal, type ValidatedPoolProposal } from './aiContentValidation.js';
import {
  buildPoolTuneExecutionPlan,
  buildPoolTuneRequest,
  loadPoolTuneDataset,
  selectPoolTuneRuns,
  type PoolTuneDataset,
  type PoolTuneExecutionPlan,
  type PoolTunePhase,
} from './poolTuneBenchmark.js';

export const POOL_TUNE_EXECUTE_FLAG = '--execute-real-openai';
export const POOL_TUNE_COST_ACK_FLAG = '--i-understand-this-costs-money';
export const POOL_TUNE_PHASE_FLAG_PREFIX = '--benchmark-phase=';
export const POOL_TUNE_PROFILE_FLAG_PREFIX = '--benchmark-model-profile=';

const CONFIRMATIONS: Readonly<Record<PoolTunePhase, Readonly<Record<ModelProfile, string>>>> = {
  profile_probe: {
    economy: 'ESEGUI 8 POOL PROFILE REALI',
    quality: 'ESEGUI 8 POOL PROFILE REALI',
  },
  tuning: {
    economy: 'ESEGUI 8 POOL TUNING REALI ECONOMY',
    quality: 'ESEGUI 8 POOL TUNING REALI QUALITY',
  },
  holdout: {
    economy: 'ESEGUI 4 POOL HOLDOUT REALI ECONOMY',
    quality: 'ESEGUI 4 POOL HOLDOUT REALI QUALITY',
  },
};

export interface PoolTuneGeneratedSample {
  scenarioId: string;
  phase: PoolTunePhase;
  modelProfile: ModelProfile;
  fileName: string;
  inputTokens: number | null;
  outputTokens: number | null;
  actualCostMicroUsd: number | null;
  priorBillingRisk: boolean;
}

export interface PoolTuneCliDeps {
  argv: readonly string[];
  getApiKey: () => string | undefined;
  stdinIsTTY: boolean;
  stdoutIsTTY: boolean;
  nodeMajorVersion: number;
  loadDataset: () => Promise<PoolTuneDataset>;
  buildPlan: (
    dataset: PoolTuneDataset,
    phase: PoolTunePhase,
    modelProfile: ModelProfile,
  ) => PoolTuneExecutionPlan;
  confirm: (prompt: string) => Promise<string>;
  createProvider: (apiKey: string) => ContentProvider;
  writeOutput: (params: {
    dataset: PoolTuneDataset;
    plan: PoolTuneExecutionPlan;
    generatedAt: string;
    samples: Array<PoolTuneGeneratedSample & { proposal: ValidatedPoolProposal }>;
  }) => Promise<string>;
  now: () => Date;
  log: (message: string) => void;
}

function parsePhase(argv: readonly string[]): PoolTunePhase {
  const flags = argv.filter((arg) => arg.startsWith(POOL_TUNE_PHASE_FLAG_PREFIX));
  if (flags.length > 1) throw new Error('Specificare una sola fase benchmark.');
  if (flags.length === 0) return 'profile_probe';
  const value = flags[0]?.slice(POOL_TUNE_PHASE_FLAG_PREFIX.length);
  if (value !== 'profile_probe' && value !== 'tuning' && value !== 'holdout') {
    throw new Error('Fase non supportata: usare profile_probe, tuning oppure holdout.');
  }
  return value;
}

function parseModelProfile(argv: readonly string[]): ModelProfile {
  const flags = argv.filter((arg) => arg.startsWith(POOL_TUNE_PROFILE_FLAG_PREFIX));
  if (flags.length > 1) throw new Error('Specificare un solo profilo modello.');
  if (flags.length === 0) return 'quality';
  const value = flags[0]?.slice(POOL_TUNE_PROFILE_FLAG_PREFIX.length);
  if (value !== 'economy' && value !== 'quality') {
    throw new Error('Profilo non supportato: usare economy oppure quality.');
  }
  return value;
}

function usageValue(value: number | undefined): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

async function generateOne(
  provider: ContentProvider,
  request: PoolRequest,
  scenarioId: string,
  phase: PoolTunePhase,
  modelProfile: ModelProfile,
): Promise<PoolTuneGeneratedSample & { proposal: ValidatedPoolProposal }> {
  const { model, priceListVersion } = resolveContentModel(modelProfile);
  const outcome = await provider.generate(request, model);
  if (outcome.status !== 'ok') {
    throw new Error(`${scenarioId}/${modelProfile}: provider non disponibile (${outcome.phase}).`);
  }
  const proposal = validatePoolProposal(outcome.output, request.counts, request.level);
  const inputTokens = usageValue(outcome.usage?.inputTokens);
  const outputTokens = usageValue(outcome.usage?.outputTokens);
  const actual =
    !outcome.priorBillingRisk && inputTokens !== null && outputTokens !== null
      ? actualCostMicroUsd(inputTokens, outputTokens, priceListVersion, model)
      : null;
  return {
    scenarioId,
    phase,
    modelProfile,
    fileName: `pool-tune-00-${scenarioId}-${modelProfile}.json`,
    inputTokens,
    outputTokens,
    actualCostMicroUsd: actual,
    priorBillingRisk: outcome.priorBillingRisk,
    proposal,
  };
}

export async function runPoolTuneCli(deps: PoolTuneCliDeps): Promise<'dry-run' | 'executed'> {
  const allowed = new Set([POOL_TUNE_EXECUTE_FLAG, POOL_TUNE_COST_ACK_FLAG]);
  const unknown = deps.argv.filter(
    (arg) =>
      arg.startsWith('--') &&
      !allowed.has(arg) &&
      !arg.startsWith(POOL_TUNE_PHASE_FLAG_PREFIX) &&
      !arg.startsWith(POOL_TUNE_PROFILE_FLAG_PREFIX),
  );
  if (unknown.length > 0) throw new Error(`Flag non supportato: ${unknown.join(', ')}.`);

  const phase = parsePhase(deps.argv);
  const modelProfile = parseModelProfile(deps.argv);
  if (
    phase === 'profile_probe' &&
    deps.argv.some((arg) => arg.startsWith(POOL_TUNE_PROFILE_FLAG_PREFIX))
  ) {
    throw new Error('Il profile probe confronta già economy e quality: non accetta un profilo.');
  }
  const dataset = await deps.loadDataset();
  const plan = deps.buildPlan(dataset, phase, modelProfile);
  deps.log(JSON.stringify({ ...plan, promptVersion: AI_POOL_PROMPT_VERSION }, null, 2));

  if (!deps.argv.includes(POOL_TUNE_EXECUTE_FLAG)) {
    deps.log('DRY-RUN: nessuna API key letta, nessun provider e nessuna chiamata di rete.');
    return 'dry-run';
  }
  if (!deps.argv.includes(POOL_TUNE_COST_ACK_FLAG)) {
    throw new Error(`Esecuzione negata: aggiungere anche ${POOL_TUNE_COST_ACK_FLAG}.`);
  }
  if (deps.nodeMajorVersion !== 22) {
    throw new Error('Esecuzione reale negata: usare Node 22 come richiesto dal repository.');
  }
  if (!deps.stdinIsTTY || !deps.stdoutIsTTY) {
    throw new Error('Esecuzione reale negata senza terminale interattivo.');
  }
  const confirmation = CONFIRMATIONS[phase][modelProfile];
  const answer = await deps.confirm(
    `Per confermare ${plan.plannedCalls} chiamate pianificate (fino a ${plan.maximumProviderAttempts} tentativi), digitare esattamente “${confirmation}”: `,
  );
  if (answer !== confirmation) throw new Error('Conferma non valida: benchmark annullato.');
  const apiKey = deps.getApiKey()?.trim();
  if (!apiKey) throw new Error('OPENAI_API_KEY non disponibile: benchmark annullato.');

  const provider = deps.createProvider(apiKey);
  const generatedAt = deps.now().toISOString();
  const samples: Array<PoolTuneGeneratedSample & { proposal: ValidatedPoolProposal }> = [];
  for (const run of selectPoolTuneRuns(dataset, phase, modelProfile)) {
    samples.push(
      await generateOne(
        provider,
        buildPoolTuneRequest(run.scenario, run.modelProfile),
        run.scenario.id,
        phase,
        run.modelProfile,
      ),
    );
  }
  const outputPath = await deps.writeOutput({ dataset, plan, generatedAt, samples });
  deps.log(`Report e ${samples.length} pool originali scritti localmente in ${outputPath}.`);
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
  dataset: PoolTuneDataset;
  plan: PoolTuneExecutionPlan;
  generatedAt: string;
  samples: Array<PoolTuneGeneratedSample & { proposal: ValidatedPoolProposal }>;
}): Promise<string> {
  const timestamp = params.generatedAt.replaceAll(':', '-').replaceAll('.', '-');
  const outputDir = resolve('lib', `pool-tune-00-${params.plan.phase}-${timestamp}`);
  await mkdir(outputDir, { recursive: false });
  for (const sample of params.samples) {
    await writeFile(
      resolve(outputDir, sample.fileName),
      `${JSON.stringify(sample.proposal, null, 2)}\n`,
      'utf8',
    );
  }
  const publicSamples = params.samples.map(({ proposal: _proposal, ...sample }) => sample);
  const costs = publicSamples.map((sample) => sample.actualCostMicroUsd);
  await writeFile(
    resolve(outputDir, 'pool-tune-00-report.json'),
    `${JSON.stringify(
      {
        datasetVersion: params.dataset.datasetVersion,
        rubricVersion: params.dataset.rubricVersion,
        promptVersion: AI_POOL_PROMPT_VERSION,
        phase: params.plan.phase,
        generatedAt: params.generatedAt,
        samples: publicSamples,
        totalActualCostMicroUsd: costs.every((cost): cost is number => cost !== null)
          ? costs.reduce((total, cost) => total + cost, 0)
          : null,
        costUpperBoundMicroUsd: params.plan.costUpperBoundMicroUsd,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  return outputDir;
}

async function main(): Promise<void> {
  await runPoolTuneCli({
    argv: process.argv.slice(2),
    getApiKey: () => process.env.OPENAI_API_KEY,
    stdinIsTTY: Boolean(stdin.isTTY),
    stdoutIsTTY: Boolean(stdout.isTTY),
    nodeMajorVersion: Number.parseInt(process.versions.node.split('.')[0] ?? '', 10),
    loadDataset: loadPoolTuneDataset,
    buildPlan: buildPoolTuneExecutionPlan,
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
