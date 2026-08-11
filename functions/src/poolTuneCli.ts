import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { fileURLToPath } from 'node:url';
import { actualCostMicroUsd } from './aiCorrectionCost.js';
import type { ModelProfile } from './aiCorrectionModelProfile.js';
import { AiContentError, resolveContentModel, type PoolRequest } from './aiContentCore.js';
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
export const POOL_TUNE_RESUME_FLAG_PREFIX = '--resume-session=';
export const DEFAULT_POOL_TUNE_OUTPUT_ROOT = fileURLToPath(new URL('../lib/', import.meta.url));

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

export type PoolTuneRejectedSample = Omit<PoolTuneGeneratedSample, 'fileName'> & {
  fileName: string | null;
  validationError: string;
  evidence: 'raw_output' | 'legacy_checkpoint_without_raw';
  rawOutput?: unknown;
};

type PoolTuneSessionStatus = 'running' | 'failed' | 'complete';

interface PoolTuneSessionFailure {
  scenarioId: string;
  modelProfile: ModelProfile;
  reason: string;
}

interface PoolTuneResumeState {
  outputPath: string;
  generatedAt: string;
  samples: Array<PoolTuneGeneratedSample & { proposal: ValidatedPoolProposal }>;
  rejections: PoolTuneRejectedSample[];
}

interface PoolTuneSessionReport {
  reportVersion: 'pool-tune-session-v2';
  datasetVersion: string;
  rubricVersion: string;
  promptVersion: string;
  phase: PoolTunePhase;
  selectedModelProfile: ModelProfile | 'paired';
  plannedCalls: number;
  generatedAt: string;
  status: PoolTuneSessionStatus;
  failure: PoolTuneSessionFailure | null;
  samples: PoolTuneGeneratedSample[];
  rejections: PoolTuneRejectedSample[];
  totalActualCostMicroUsd: number | null;
  costUpperBoundMicroUsd: number;
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
  loadResume: (params: {
    outputPath: string;
    dataset: PoolTuneDataset;
    plan: PoolTuneExecutionPlan;
    phase: PoolTunePhase;
    modelProfile: ModelProfile;
  }) => Promise<PoolTuneResumeState>;
  writeOutput: (params: {
    dataset: PoolTuneDataset;
    plan: PoolTuneExecutionPlan;
    generatedAt: string;
    samples: Array<PoolTuneGeneratedSample & { proposal: ValidatedPoolProposal }>;
    rejections: PoolTuneRejectedSample[];
    outputPath: string | null;
    status: PoolTuneSessionStatus;
    failure: PoolTuneSessionFailure | null;
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

function parseResumePath(argv: readonly string[]): string | null {
  const flags = argv.filter((arg) => arg.startsWith(POOL_TUNE_RESUME_FLAG_PREFIX));
  if (flags.length > 1) throw new Error('Specificare una sola sessione da riprendere.');
  if (flags.length === 0) return null;
  const value = flags[0]?.slice(POOL_TUNE_RESUME_FLAG_PREFIX.length).trim();
  if (!value) throw new Error('Il percorso della sessione da riprendere è vuoto.');
  return value;
}

function resumeConfirmation(
  remainingCalls: number,
  phase: PoolTunePhase,
  modelProfile: ModelProfile,
): string {
  const phaseLabel = phase === 'profile_probe' ? 'PROFILE' : phase.toUpperCase();
  const profileLabel = phase === 'profile_probe' ? '' : ` ${modelProfile.toUpperCase()}`;
  return `RIPRENDI ${remainingCalls} POOL ${phaseLabel} REALI${profileLabel}`;
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
): Promise<
  (PoolTuneGeneratedSample & { proposal: ValidatedPoolProposal }) | PoolTuneRejectedSample
> {
  const { model, priceListVersion } = resolveContentModel(modelProfile);
  const outcome = await provider.generate(request, model);
  if (outcome.status !== 'ok') {
    throw new Error(`${scenarioId}/${modelProfile}: provider non disponibile (${outcome.phase}).`);
  }
  const inputTokens = usageValue(outcome.usage?.inputTokens);
  const outputTokens = usageValue(outcome.usage?.outputTokens);
  const actual =
    !outcome.priorBillingRisk && inputTokens !== null && outputTokens !== null
      ? actualCostMicroUsd(inputTokens, outputTokens, priceListVersion, model)
      : null;
  const metadata: PoolTuneGeneratedSample = {
    scenarioId,
    phase,
    modelProfile,
    fileName: `pool-tune-00-${scenarioId}-${modelProfile}.json`,
    inputTokens,
    outputTokens,
    actualCostMicroUsd: actual,
    priorBillingRisk: outcome.priorBillingRisk,
  };
  try {
    const proposal = validatePoolProposal(outcome.output, request.counts, request.level);
    return { ...metadata, proposal };
  } catch (error) {
    if (!(error instanceof AiContentError) || error.code !== 'provider_invalid_output') {
      throw error;
    }
    return {
      ...metadata,
      fileName: `pool-tune-00-${scenarioId}-${modelProfile}-rejected.json`,
      validationError: error.message,
      evidence: 'raw_output',
      rawOutput: outcome.output,
    };
  }
}

export async function runPoolTuneCli(deps: PoolTuneCliDeps): Promise<'dry-run' | 'executed'> {
  const allowed = new Set([POOL_TUNE_EXECUTE_FLAG, POOL_TUNE_COST_ACK_FLAG]);
  const unknown = deps.argv.filter(
    (arg) =>
      arg.startsWith('--') &&
      !allowed.has(arg) &&
      !arg.startsWith(POOL_TUNE_PHASE_FLAG_PREFIX) &&
      !arg.startsWith(POOL_TUNE_PROFILE_FLAG_PREFIX) &&
      !arg.startsWith(POOL_TUNE_RESUME_FLAG_PREFIX),
  );
  if (unknown.length > 0) throw new Error(`Flag non supportato: ${unknown.join(', ')}.`);

  const phase = parsePhase(deps.argv);
  const modelProfile = parseModelProfile(deps.argv);
  const resumePath = parseResumePath(deps.argv);
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
    if (resumePath !== null) {
      throw new Error('La ripresa di una sessione richiede l’esecuzione reale esplicita.');
    }
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
  const selectedRuns = selectPoolTuneRuns(dataset, phase, modelProfile);
  let generatedAt = deps.now().toISOString();
  let outputPath: string | null = null;
  let samples: Array<PoolTuneGeneratedSample & { proposal: ValidatedPoolProposal }> = [];
  let rejections: PoolTuneRejectedSample[] = [];
  if (resumePath !== null) {
    const resume = await deps.loadResume({
      outputPath: resumePath,
      dataset,
      plan,
      phase,
      modelProfile,
    });
    generatedAt = resume.generatedAt;
    outputPath = resume.outputPath;
    samples = resume.samples;
    rejections = resume.rejections;
  }
  const remainingRuns = selectedRuns.slice(samples.length + rejections.length);
  if (remainingRuns.length === 0) {
    if (resumePath === null || outputPath === null) {
      throw new Error('Il piano benchmark non contiene chiamate da eseguire.');
    }
    await deps.writeOutput({
      dataset,
      plan,
      generatedAt,
      samples,
      rejections,
      outputPath,
      status: 'complete',
      failure: null,
    });
    deps.log(`Sessione completa recuperata senza nuove chiamate: ${outputPath}.`);
    return 'executed';
  }
  const confirmation =
    resumePath === null
      ? CONFIRMATIONS[phase][modelProfile]
      : resumeConfirmation(remainingRuns.length, phase, modelProfile);
  const attemptsPerCall = plan.maximumProviderAttempts / plan.plannedCalls;
  if (!Number.isInteger(attemptsPerCall) || attemptsPerCall < 1) {
    throw new Error('Il piano benchmark dichiara un numero di tentativi incoerente.');
  }
  const answer = await deps.confirm(
    `Per confermare ${remainingRuns.length} chiamate ancora necessarie (fino a ${remainingRuns.length * attemptsPerCall} tentativi), digitare esattamente “${confirmation}”: `,
  );
  if (answer !== confirmation) throw new Error('Conferma non valida: benchmark annullato.');
  const apiKey = deps.getApiKey()?.trim();
  if (!apiKey) throw new Error('OPENAI_API_KEY non disponibile: benchmark annullato.');

  const provider = deps.createProvider(apiKey);
  if (outputPath === null) {
    outputPath = await deps.writeOutput({
      dataset,
      plan,
      generatedAt,
      samples,
      rejections,
      outputPath: null,
      status: 'running',
      failure: null,
    });
  }
  deps.log(`Sessione benchmark: ${outputPath}.`);
  for (const run of remainingRuns) {
    let result:
      | (PoolTuneGeneratedSample & { proposal: ValidatedPoolProposal })
      | PoolTuneRejectedSample;
    try {
      result = await generateOne(
        provider,
        buildPoolTuneRequest(run.scenario, run.modelProfile),
        run.scenario.id,
        phase,
        run.modelProfile,
      );
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Errore provider non classificato.';
      await deps.writeOutput({
        dataset,
        plan,
        generatedAt,
        samples,
        rejections,
        outputPath,
        status: 'failed',
        failure: {
          scenarioId: run.scenario.id,
          modelProfile: run.modelProfile,
          reason,
        },
      });
      throw new Error(`${reason} Checkpoint conservato in ${outputPath}.`);
    }
    if ('proposal' in result) samples.push(result);
    else rejections.push(result);
    try {
      await deps.writeOutput({
        dataset,
        plan,
        generatedAt,
        samples,
        rejections,
        outputPath,
        status: 'running',
        failure: null,
      });
    } catch (error) {
      const reason =
        error instanceof Error ? error.message : 'Errore locale non classificato nel checkpoint.';
      throw new Error(
        `${run.scenario.id}/${run.modelProfile}: risultato ottenuto ma checkpoint non confermato (${reason}). Non riprendere questa sessione senza verifica manuale.`,
      );
    }
  }
  await deps.writeOutput({
    dataset,
    plan,
    generatedAt,
    samples,
    rejections,
    outputPath,
    status: 'complete',
    failure: null,
  });
  deps.log(
    `Report, ${samples.length} pool validi e ${rejections.length} output rifiutati scritti localmente in ${outputPath}.`,
  );
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertExactKeys(value: Record<string, unknown>, keys: readonly string[], label: string) {
  const actual = Object.keys(value);
  if (actual.length !== keys.length || actual.some((key) => !keys.includes(key))) {
    throw new Error(`${label}: proprietà mancanti o non ammesse.`);
  }
}

function safeSessionDirectory(value: string): string {
  const outputRoot = resolve(DEFAULT_POOL_TUNE_OUTPUT_ROOT);
  const outputPath = resolve(value);
  const child = relative(outputRoot, outputPath);
  if (child.length === 0 || child.startsWith('..') || isAbsolute(child)) {
    throw new Error('La sessione deve essere una directory figlia di functions/lib.');
  }
  return outputPath;
}

function optionalUsage(value: unknown, label: string): number | null {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error(`${label}: valore non valido.`);
  }
  return value;
}

function parseCanonicalTimestamp(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Timestamp della sessione non valido.');
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== value) {
    throw new Error('Timestamp della sessione non valido.');
  }
  return value;
}

function expectedActualCost(
  sample: Pick<
    PoolTuneGeneratedSample,
    'modelProfile' | 'priorBillingRisk' | 'inputTokens' | 'outputTokens'
  >,
): number | null {
  if (sample.priorBillingRisk || sample.inputTokens === null || sample.outputTokens === null) {
    return null;
  }
  const { model, priceListVersion } = resolveContentModel(sample.modelProfile);
  return actualCostMicroUsd(sample.inputTokens, sample.outputTokens, priceListVersion, model);
}

function parseStoredPoolProposal(value: unknown, request: PoolRequest): ValidatedPoolProposal {
  if (!isPlainObject(value)) throw new Error('Proposta persistita non valida.');
  assertExactKeys(value, ['questions'], 'Proposta persistita');
  if (!Array.isArray(value.questions)) throw new Error('Domande persistite non valide.');
  const providerQuestions = value.questions.map((question, index) => {
    if (!isPlainObject(question)) throw new Error(`Domanda persistita ${index + 1} non valida.`);
    if (question.tipo === 'aperta') {
      assertExactKeys(
        question,
        ['order', 'tipo', 'testo', 'difficolta', 'soluzione'],
        `Domanda persistita ${index + 1}`,
      );
      return {
        tipo: question.tipo,
        testo: question.testo,
        difficolta: question.difficolta,
        soluzione: question.soluzione,
      };
    }
    if (question.tipo === 'chiusa_singola' || question.tipo === 'chiusa_multipla') {
      assertExactKeys(
        question,
        ['order', 'tipo', 'testo', 'difficolta', 'opzioni', 'soluzioneIndici'],
        `Domanda persistita ${index + 1}`,
      );
      return {
        tipo: question.tipo,
        testo: question.testo,
        difficolta: question.difficolta,
        opzioni: question.opzioni,
        soluzione: question.soluzioneIndici,
      };
    }
    throw new Error(`Tipo della domanda persistita ${index + 1} non valido.`);
  });
  const validated = validatePoolProposal(
    { questions: providerQuestions },
    request.counts,
    request.level,
  );
  if (JSON.stringify(validated) !== JSON.stringify(value)) {
    throw new Error('La proposta persistita non coincide con il DTO canonico validato.');
  }
  return validated;
}

export async function loadPoolTuneResume(params: {
  outputPath: string;
  dataset: PoolTuneDataset;
  plan: PoolTuneExecutionPlan;
  phase: PoolTunePhase;
  modelProfile: ModelProfile;
}): Promise<PoolTuneResumeState> {
  const outputPath = safeSessionDirectory(params.outputPath);
  const raw = JSON.parse(
    await readFile(resolve(outputPath, 'pool-tune-00-report.json'), 'utf8'),
  ) as unknown;
  if (!isPlainObject(raw)) throw new Error('Report della sessione non valido.');
  const isV2 = raw.reportVersion === 'pool-tune-session-v2';
  assertExactKeys(
    raw,
    isV2
      ? [
          'reportVersion',
          'datasetVersion',
          'rubricVersion',
          'promptVersion',
          'phase',
          'selectedModelProfile',
          'plannedCalls',
          'generatedAt',
          'status',
          'failure',
          'samples',
          'rejections',
          'totalActualCostMicroUsd',
          'costUpperBoundMicroUsd',
        ]
      : [
          'datasetVersion',
          'rubricVersion',
          'promptVersion',
          'phase',
          'selectedModelProfile',
          'plannedCalls',
          'generatedAt',
          'status',
          'failure',
          'samples',
          'totalActualCostMicroUsd',
          'costUpperBoundMicroUsd',
        ],
    'Report della sessione',
  );
  if (
    raw.datasetVersion !== params.dataset.datasetVersion ||
    raw.rubricVersion !== params.dataset.rubricVersion ||
    raw.promptVersion !== AI_POOL_PROMPT_VERSION ||
    raw.phase !== params.phase ||
    raw.selectedModelProfile !== params.plan.selectedModelProfile ||
    raw.plannedCalls !== params.plan.plannedCalls ||
    raw.costUpperBoundMicroUsd !== params.plan.costUpperBoundMicroUsd
  ) {
    throw new Error('La sessione non appartiene al piano benchmark corrente.');
  }
  if (raw.status === 'complete') throw new Error('La sessione indicata è già completa.');
  if (raw.status !== 'running' && raw.status !== 'failed') {
    throw new Error('Stato della sessione non valido.');
  }
  const generatedAt = parseCanonicalTimestamp(raw.generatedAt);
  if (!Array.isArray(raw.samples)) throw new Error('Campioni della sessione non validi.');
  if (isV2 && !Array.isArray(raw.rejections)) {
    throw new Error('Output rifiutati della sessione non validi.');
  }
  const selectedRuns = selectPoolTuneRuns(params.dataset, params.phase, params.modelProfile);
  if (raw.samples.length > selectedRuns.length) throw new Error('Troppi campioni nella sessione.');
  const completedIndexes = new Set<number>();
  const samples: Array<PoolTuneGeneratedSample & { proposal: ValidatedPoolProposal }> = [];
  for (const [index, value] of raw.samples.entries()) {
    if (!isPlainObject(value)) throw new Error(`Campione ${index + 1} non valido.`);
    assertExactKeys(
      value,
      [
        'scenarioId',
        'phase',
        'modelProfile',
        'fileName',
        'inputTokens',
        'outputTokens',
        'actualCostMicroUsd',
        'priorBillingRisk',
      ],
      `Campione ${index + 1}`,
    );
    const expectedIndex = isV2
      ? selectedRuns.findIndex(
          (run) => run.scenario.id === value.scenarioId && run.modelProfile === value.modelProfile,
        )
      : index;
    const expected = selectedRuns[expectedIndex];
    if (!expected) throw new Error(`Campione ${index + 1} fuori piano.`);
    if (completedIndexes.has(expectedIndex)) throw new Error('Risultato duplicato nella sessione.');
    const expectedFile = `pool-tune-00-${expected.scenario.id}-${expected.modelProfile}.json`;
    if (
      value.scenarioId !== expected.scenario.id ||
      value.phase !== params.phase ||
      value.modelProfile !== expected.modelProfile ||
      value.fileName !== expectedFile ||
      typeof value.priorBillingRisk !== 'boolean'
    ) {
      throw new Error(`Campione ${index + 1} non è il prefisso canonico del piano.`);
    }
    const proposalRaw = JSON.parse(
      await readFile(resolve(outputPath, expectedFile), 'utf8'),
    ) as unknown;
    const request = buildPoolTuneRequest(expected.scenario, expected.modelProfile);
    const proposal = parseStoredPoolProposal(proposalRaw, request);
    const sample: PoolTuneGeneratedSample & { proposal: ValidatedPoolProposal } = {
      scenarioId: expected.scenario.id,
      phase: params.phase,
      modelProfile: expected.modelProfile,
      fileName: expectedFile,
      inputTokens: optionalUsage(value.inputTokens, `${expectedFile}.inputTokens`),
      outputTokens: optionalUsage(value.outputTokens, `${expectedFile}.outputTokens`),
      actualCostMicroUsd: optionalUsage(
        value.actualCostMicroUsd,
        `${expectedFile}.actualCostMicroUsd`,
      ),
      priorBillingRisk: value.priorBillingRisk,
      proposal,
    };
    if (sample.actualCostMicroUsd !== expectedActualCost(sample)) {
      throw new Error(`${expectedFile}.actualCostMicroUsd non è coerente con usage e listino.`);
    }
    completedIndexes.add(expectedIndex);
    samples.push(sample);
  }

  const rejections: PoolTuneRejectedSample[] = [];
  if (isV2) {
    for (const [index, value] of (raw.rejections as unknown[]).entries()) {
      if (!isPlainObject(value)) throw new Error(`Output rifiutato ${index + 1} non valido.`);
      assertExactKeys(
        value,
        [
          'scenarioId',
          'phase',
          'modelProfile',
          'fileName',
          'inputTokens',
          'outputTokens',
          'actualCostMicroUsd',
          'priorBillingRisk',
          'validationError',
          'evidence',
        ],
        `Output rifiutato ${index + 1}`,
      );
      const expectedIndex = selectedRuns.findIndex(
        (run) => run.scenario.id === value.scenarioId && run.modelProfile === value.modelProfile,
      );
      const expected = selectedRuns[expectedIndex];
      if (!expected || completedIndexes.has(expectedIndex)) {
        throw new Error(`Output rifiutato ${index + 1} fuori piano o duplicato.`);
      }
      if (
        value.phase !== params.phase ||
        typeof value.priorBillingRisk !== 'boolean' ||
        typeof value.validationError !== 'string' ||
        value.validationError.length === 0 ||
        value.validationError.length > 1_000 ||
        /[\r\n]/u.test(value.validationError)
      ) {
        throw new Error(`Output rifiutato ${index + 1} incoerente.`);
      }
      const rejection: PoolTuneRejectedSample = {
        scenarioId: expected.scenario.id,
        phase: params.phase,
        modelProfile: expected.modelProfile,
        fileName:
          value.fileName === null
            ? null
            : typeof value.fileName === 'string'
              ? value.fileName
              : (() => {
                  throw new Error(`Output rifiutato ${index + 1}: file non valido.`);
                })(),
        inputTokens: optionalUsage(value.inputTokens, `Rifiuto ${index + 1}.inputTokens`),
        outputTokens: optionalUsage(value.outputTokens, `Rifiuto ${index + 1}.outputTokens`),
        actualCostMicroUsd: optionalUsage(
          value.actualCostMicroUsd,
          `Rifiuto ${index + 1}.actualCostMicroUsd`,
        ),
        priorBillingRisk: value.priorBillingRisk,
        validationError: value.validationError,
        evidence:
          value.evidence === 'raw_output'
            ? 'raw_output'
            : value.evidence === 'legacy_checkpoint_without_raw'
              ? 'legacy_checkpoint_without_raw'
              : (() => {
                  throw new Error(`Output rifiutato ${index + 1}: evidenza non valida.`);
                })(),
      };
      if (rejection.actualCostMicroUsd !== expectedActualCost(rejection)) {
        throw new Error(`Output rifiutato ${index + 1}: costo incoerente.`);
      }
      if (rejection.evidence === 'raw_output') {
        const expectedFile = `pool-tune-00-${expected.scenario.id}-${expected.modelProfile}-rejected.json`;
        if (rejection.fileName !== expectedFile) {
          throw new Error(`Output rifiutato ${index + 1}: file non canonico.`);
        }
        const rawOutput = JSON.parse(
          await readFile(resolve(outputPath, expectedFile), 'utf8'),
        ) as unknown;
        const request = buildPoolTuneRequest(expected.scenario, expected.modelProfile);
        try {
          validatePoolProposal(rawOutput, request.counts, request.level);
          throw new Error(`Output rifiutato ${index + 1} risulta invece valido.`);
        } catch (error) {
          if (
            !(error instanceof AiContentError) ||
            error.code !== 'provider_invalid_output' ||
            error.message !== rejection.validationError
          ) {
            throw new Error(`Output rifiutato ${index + 1} non riproduce lo stesso errore.`);
          }
        }
        rejection.rawOutput = rawOutput;
      } else if (
        rejection.fileName !== null ||
        rejection.inputTokens !== null ||
        rejection.outputTokens !== null ||
        rejection.actualCostMicroUsd !== null ||
        !rejection.priorBillingRisk
      ) {
        throw new Error(`Output rifiutato ${index + 1}: evidenza legacy incoerente.`);
      }
      completedIndexes.add(expectedIndex);
      rejections.push(rejection);
    }
  }

  let failure = raw.failure;
  if (raw.status === 'running') {
    if (failure !== null) {
      throw new Error('Una sessione in corso non può contenere un errore terminale.');
    }
  } else {
    if (!isPlainObject(failure)) {
      throw new Error('Una sessione fallita deve descrivere il campione non completato.');
    }
    assertExactKeys(failure, ['scenarioId', 'modelProfile', 'reason'], 'Errore sessione');
    const nextIndex = completedIndexes.size;
    const next = selectedRuns[nextIndex];
    if (
      !next ||
      failure.scenarioId !== next.scenario.id ||
      failure.modelProfile !== next.modelProfile ||
      typeof failure.reason !== 'string' ||
      failure.reason.length === 0 ||
      failure.reason.length > 1_000 ||
      /[\r\n]/u.test(failure.reason)
    ) {
      throw new Error('La sessione fallita non coincide con il prossimo campione canonico.');
    }
    const providerFailurePrefix = `${next.scenario.id}/${next.modelProfile}: provider non disponibile (`;
    if (!isV2 && !failure.reason.startsWith(providerFailurePrefix)) {
      rejections.push({
        scenarioId: next.scenario.id,
        phase: params.phase,
        modelProfile: next.modelProfile,
        fileName: null,
        inputTokens: null,
        outputTokens: null,
        actualCostMicroUsd: null,
        priorBillingRisk: true,
        validationError: failure.reason,
        evidence: 'legacy_checkpoint_without_raw',
      });
      completedIndexes.add(nextIndex);
      failure = null;
    }
  }

  const completed = [...completedIndexes].sort((left, right) => left - right);
  if (completed.some((value, index) => value !== index)) {
    throw new Error('I risultati della sessione non formano un prefisso canonico completo.');
  }
  const costs = [...samples, ...rejections].map((result) => result.actualCostMicroUsd);
  const expectedTotal = costs.every((cost): cost is number => cost !== null)
    ? costs.reduce((total, cost) => total + cost, 0)
    : null;
  const reportExpectedTotal = isV2
    ? expectedTotal
    : samples.every((sample) => sample.actualCostMicroUsd !== null)
      ? samples.reduce((total, sample) => total + (sample.actualCostMicroUsd ?? 0), 0)
      : null;
  if (raw.totalActualCostMicroUsd !== reportExpectedTotal) {
    throw new Error('Il costo totale della sessione non coincide con i risultati persistiti.');
  }
  return { outputPath, generatedAt, samples, rejections };
}

export async function writePoolTuneCheckpoint(params: {
  dataset: PoolTuneDataset;
  plan: PoolTuneExecutionPlan;
  generatedAt: string;
  samples: Array<PoolTuneGeneratedSample & { proposal: ValidatedPoolProposal }>;
  rejections: PoolTuneRejectedSample[];
  outputPath: string | null;
  status: PoolTuneSessionStatus;
  failure: PoolTuneSessionFailure | null;
}): Promise<string> {
  const timestamp = params.generatedAt.replaceAll(':', '-').replaceAll('.', '-');
  const outputDir =
    params.outputPath === null
      ? safeSessionDirectory(
          resolve(DEFAULT_POOL_TUNE_OUTPUT_ROOT, `pool-tune-00-${params.plan.phase}-${timestamp}`),
        )
      : safeSessionDirectory(params.outputPath);
  if (params.outputPath === null) await mkdir(outputDir, { recursive: false });
  for (const sample of params.samples) {
    const proposalPath = resolve(outputDir, sample.fileName);
    const temporaryProposalPath = `${proposalPath}.tmp`;
    await writeFile(temporaryProposalPath, `${JSON.stringify(sample.proposal, null, 2)}\n`, 'utf8');
    await rename(temporaryProposalPath, proposalPath);
  }
  for (const rejection of params.rejections) {
    if (rejection.evidence !== 'raw_output' || rejection.fileName === null) continue;
    if (rejection.rawOutput === undefined) {
      throw new Error(`${rejection.fileName}: raw output mancante.`);
    }
    const rejectedPath = resolve(outputDir, rejection.fileName);
    const temporaryRejectedPath = `${rejectedPath}.tmp`;
    await writeFile(
      temporaryRejectedPath,
      `${JSON.stringify(rejection.rawOutput, null, 2)}\n`,
      'utf8',
    );
    await rename(temporaryRejectedPath, rejectedPath);
  }
  const publicSamples = params.samples.map(({ proposal: _proposal, ...sample }) => sample);
  const publicRejections = params.rejections.map(
    ({ rawOutput: _rawOutput, ...rejection }) => rejection,
  );
  const costs = [...publicSamples, ...publicRejections].map((result) => result.actualCostMicroUsd);
  const report: PoolTuneSessionReport = {
    reportVersion: 'pool-tune-session-v2',
    datasetVersion: params.dataset.datasetVersion,
    rubricVersion: params.dataset.rubricVersion,
    promptVersion: AI_POOL_PROMPT_VERSION,
    phase: params.plan.phase,
    selectedModelProfile: params.plan.selectedModelProfile,
    plannedCalls: params.plan.plannedCalls,
    generatedAt: params.generatedAt,
    status: params.status,
    failure: params.failure,
    samples: publicSamples,
    rejections: publicRejections,
    totalActualCostMicroUsd: costs.every((cost): cost is number => cost !== null)
      ? costs.reduce((total, cost) => total + cost, 0)
      : null,
    costUpperBoundMicroUsd: params.plan.costUpperBoundMicroUsd,
  };
  const reportPath = resolve(outputDir, 'pool-tune-00-report.json');
  const temporaryReportPath = `${reportPath}.tmp`;
  await writeFile(temporaryReportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await rename(temporaryReportPath, reportPath);
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
    loadResume: loadPoolTuneResume,
    writeOutput: writePoolTuneCheckpoint,
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
