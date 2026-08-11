import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  resolveContentModel,
  validateAiContentRequestForOfflinePoolBenchmark,
  type PoolCounts,
  type PoolLevel,
  type PoolRequest,
} from './aiContentCore.js';
import { estimateContentCost } from './aiContentCost.js';
import type { ModelProfile } from './aiCorrectionModelProfile.js';
import { DEFAULT_OPENAI_RETRY_POLICY } from './openAiGrader.js';
import { maxAttemptsForPolicy } from './openAiStructuredRunner.js';

export const POOL_TUNE_DATASET_VERSION = 'pool-tune-00-dataset-v1' as const;
export const POOL_TUNE_RUBRIC_VERSION = 'pool-tune-00-rubric-v1' as const;
export const POOL_TUNE_PHASES = ['profile_probe', 'tuning', 'holdout'] as const;
export type PoolTunePhase = (typeof POOL_TUNE_PHASES)[number];
export type PoolTuneSplit = 'tuning' | 'holdout';

export const POOL_TUNE_PROFILE_PROBE_IDS = ['PT00-01', 'PT00-02', 'PT00-04', 'PT00-07'] as const;

export const DEFAULT_POOL_TUNE_DATASET_PATH = fileURLToPath(
  new URL('../../documentazione/evidenze/pool-tune-00-dataset.json', import.meta.url),
);
export const DEFAULT_POOL_TUNE_SOURCES_DIR = fileURLToPath(
  new URL('../../documentazione/evidenze/pool-tune-00-sources/', import.meta.url),
);

export const POOL_TUNE_RUBRIC_DIMENSIONS = [
  'fedelta_alla_fonte',
  'copertura',
  'chiarezza_e_autonomia',
  'profondita_cognitiva',
  'calibrazione_difficolta',
  'qualita_soluzioni_aperte',
  'qualita_domande_chiuse',
  'varieta_e_non_duplicazione',
  'ragionamento_e_applicazione',
  'utilita_formativa',
] as const;

export const POOL_TUNE_BLOCKERS = [
  'risposta_corretta_errata',
  'contenuto_necessario_non_supportato_dalla_fonte',
  'domanda_chiusa_ambigua_o_con_piu_soluzioni_non_dichiarate',
  'soluzione_aperta_materialmente_incompleta',
  'esercizio_non_risolto_o_passaggi_incoerenti',
  'riferimento_alla_posizione_nella_lezione',
  'duplicazione_sostanziale',
  'copertura_gravemente_sbilanciata',
] as const;

export interface PoolTuneScenario {
  id: string;
  split: PoolTuneSplit;
  category: string;
  sourceFile: string;
  sourceSha256: string;
  lessonSource: string;
  level: PoolLevel;
  counts: PoolCounts;
  teacherGuidance: string | null;
  coverageTargets: string[];
  reasoningTargets: string[];
}

export interface PoolTuneDataset {
  datasetVersion: typeof POOL_TUNE_DATASET_VERSION;
  rubricVersion: typeof POOL_TUNE_RUBRIC_VERSION;
  generatedSamplesIncluded: false;
  sourceProvenance: string;
  scenarios: PoolTuneScenario[];
}

export interface PoolTuneScenarioPlan {
  scenarioId: string;
  split: PoolTuneSplit;
  category: string;
  modelProfile: ModelProfile;
  model: string;
  level: PoolLevel;
  counts: PoolCounts;
  totalQuestions: number;
  estimatedInputTokens: number;
  maxOutputTokens: number;
  reservationInputTokenUpperBound: number;
  reservationOutputTokens: number;
  estimatedCostMicroUsd: number;
  costUpperBoundMicroUsd: number;
}

export interface PoolTuneExecutionPlan {
  dryRun: true;
  datasetVersion: typeof POOL_TUNE_DATASET_VERSION;
  rubricVersion: typeof POOL_TUNE_RUBRIC_VERSION;
  phase: PoolTunePhase;
  selectedModelProfile: ModelProfile | 'paired';
  plannedCalls: number;
  maximumProviderAttempts: number;
  estimatedCostMicroUsd: number;
  costUpperBoundMicroUsd: number;
  scenarios: PoolTuneScenarioPlan[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertExactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
) {
  const keys = Object.keys(value);
  if (keys.length !== allowed.length || keys.some((key) => !allowed.includes(key))) {
    throw new Error(`${label}: proprietà mancanti o non ammesse.`);
  }
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() !== value || value.length === 0) {
    throw new Error(`${label}: stringa non valida.`);
  }
  return value;
}

function stringList(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`${label}: elenco non valido.`);
  const result = value.map((item, index) => requiredString(item, `${label}[${index}]`));
  if (new Set(result.map((item) => item.toLocaleLowerCase('it-IT'))).size !== result.length) {
    throw new Error(`${label}: voci duplicate.`);
  }
  return result;
}

function requestIdForScenario(id: string): string {
  const numeric = Number.parseInt(id.slice(-2), 10);
  if (!Number.isInteger(numeric) || numeric < 1 || numeric > 12) {
    throw new Error(`${id}: indice non valido.`);
  }
  return `00000000-0000-4000-a000-${String(numeric).padStart(12, '0')}`;
}

function validateRequest(
  scenario: Omit<PoolTuneScenario, 'lessonSource'>,
  lessonSource: string,
  modelProfile: ModelProfile,
): PoolRequest {
  const request = validateAiContentRequestForOfflinePoolBenchmark({
    kind: 'pool',
    requestId: requestIdForScenario(scenario.id),
    modelProfile,
    teacherGuidance: scenario.teacherGuidance,
    level: scenario.level,
    counts: scenario.counts,
    lessonSource,
    existingPoolQuestionCount: 0,
  });
  if (request.kind !== 'pool') throw new Error(`${scenario.id}: richiesta non pool.`);
  return request;
}

function parseScenario(raw: unknown, index: number): Omit<PoolTuneScenario, 'lessonSource'> {
  if (!isPlainObject(raw)) throw new Error(`Scenario ${index + 1} non valido.`);
  assertExactKeys(
    raw,
    [
      'id',
      'split',
      'category',
      'sourceFile',
      'sourceSha256',
      'level',
      'counts',
      'teacherGuidance',
      'coverageTargets',
      'reasoningTargets',
    ],
    `Scenario ${index + 1}`,
  );
  const id = `PT00-${String(index + 1).padStart(2, '0')}`;
  if (raw.id !== id) throw new Error(`Scenario ${index + 1}: id non canonico.`);
  const split: PoolTuneSplit = index < 8 ? 'tuning' : 'holdout';
  if (raw.split !== split) throw new Error(`${id}: split non canonico.`);
  if (raw.sourceFile !== `${id}.md`) throw new Error(`${id}: sourceFile non canonico.`);
  const sourceSha256 = requiredString(raw.sourceSha256, `${id}.sourceSha256`);
  if (!/^[a-f0-9]{64}$/.test(sourceSha256)) throw new Error(`${id}: SHA-256 non valido.`);
  const category = requiredString(raw.category, `${id}.category`);
  if (!/^[a-z][a-z_]+$/.test(category)) throw new Error(`${id}: categoria non valida.`);
  if (raw.level !== 'base' && raw.level !== 'balanced' && raw.level !== 'advanced') {
    throw new Error(`${id}: livello non valido.`);
  }
  if (!isPlainObject(raw.counts)) throw new Error(`${id}: conteggi non validi.`);
  assertExactKeys(raw.counts, ['aperta', 'chiusa_singola', 'chiusa_multipla'], `${id}.counts`);
  const counts = raw.counts as unknown as PoolCounts;
  if (raw.teacherGuidance !== null && typeof raw.teacherGuidance !== 'string') {
    throw new Error(`${id}: indicazioni docente non valide.`);
  }
  return {
    id,
    split,
    category,
    sourceFile: raw.sourceFile,
    sourceSha256,
    level: raw.level,
    counts,
    teacherGuidance: raw.teacherGuidance,
    coverageTargets: stringList(raw.coverageTargets, `${id}.coverageTargets`),
    reasoningTargets: stringList(raw.reasoningTargets, `${id}.reasoningTargets`),
  };
}

function decodeUtf8(bytes: Uint8Array, id: string): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`${id}: sorgente non UTF-8 valida.`);
  }
}

export async function loadPoolTuneDataset(
  datasetPath = DEFAULT_POOL_TUNE_DATASET_PATH,
  sourcesDir = DEFAULT_POOL_TUNE_SOURCES_DIR,
): Promise<PoolTuneDataset> {
  const raw = JSON.parse(await readFile(datasetPath, 'utf8')) as unknown;
  if (!isPlainObject(raw)) throw new Error('Dataset POOL-TUNE-00 non valido.');
  assertExactKeys(
    raw,
    [
      'datasetVersion',
      'rubricVersion',
      'generatedSamplesIncluded',
      'sourceProvenance',
      'scenarios',
    ],
    'Dataset POOL-TUNE-00',
  );
  if (raw.datasetVersion !== POOL_TUNE_DATASET_VERSION) throw new Error('Dataset non supportato.');
  if (raw.rubricVersion !== POOL_TUNE_RUBRIC_VERSION) throw new Error('Rubrica non supportata.');
  if (raw.generatedSamplesIncluded !== false) {
    throw new Error('Il dataset non deve contenere output generati.');
  }
  const sourceProvenance = requiredString(raw.sourceProvenance, 'sourceProvenance');
  if (!Array.isArray(raw.scenarios) || raw.scenarios.length !== 12) {
    throw new Error('Il dataset deve contenere 12 scenari: 8 tuning e 4 holdout.');
  }
  const metadata = raw.scenarios.map(parseScenario);
  const scenarios = await Promise.all(
    metadata.map(async (scenario) => {
      const bytes = await readFile(resolve(sourcesDir, scenario.sourceFile));
      const hash = createHash('sha256').update(bytes).digest('hex');
      if (hash !== scenario.sourceSha256) throw new Error(`${scenario.id}: sorgente modificata.`);
      const lessonSource = decodeUtf8(bytes, scenario.id);
      validateRequest(scenario, lessonSource, 'quality');
      return { ...scenario, lessonSource };
    }),
  );
  if (new Set(scenarios.map((scenario) => scenario.category)).size !== scenarios.length) {
    throw new Error('Le categorie devono essere univoche.');
  }
  return {
    datasetVersion: POOL_TUNE_DATASET_VERSION,
    rubricVersion: POOL_TUNE_RUBRIC_VERSION,
    generatedSamplesIncluded: false,
    sourceProvenance,
    scenarios,
  };
}

export function buildPoolTuneRequest(
  scenario: PoolTuneScenario,
  modelProfile: ModelProfile,
): PoolRequest {
  return validateRequest(scenario, scenario.lessonSource, modelProfile);
}

interface SelectedRun {
  scenario: PoolTuneScenario;
  modelProfile: ModelProfile;
}

export function selectPoolTuneRuns(
  dataset: PoolTuneDataset,
  phase: PoolTunePhase,
  modelProfile: ModelProfile = 'quality',
): SelectedRun[] {
  if (!POOL_TUNE_PHASES.includes(phase)) throw new Error('Fase benchmark non supportata.');
  if (phase === 'profile_probe') {
    return POOL_TUNE_PROFILE_PROBE_IDS.flatMap((id) => {
      const scenario = dataset.scenarios.find((item) => item.id === id);
      if (!scenario) throw new Error(`${id}: scenario del probe mancante.`);
      return [
        { scenario, modelProfile: 'economy' as const },
        { scenario, modelProfile: 'quality' as const },
      ];
    });
  }
  const split: PoolTuneSplit = phase;
  return dataset.scenarios
    .filter((scenario) => scenario.split === split)
    .map((scenario) => ({ scenario, modelProfile }));
}

export function buildPoolTuneExecutionPlan(
  dataset: PoolTuneDataset,
  phase: PoolTunePhase = 'profile_probe',
  modelProfile: ModelProfile = 'quality',
): PoolTuneExecutionPlan {
  const maxAttempts = maxAttemptsForPolicy(DEFAULT_OPENAI_RETRY_POLICY);
  const scenarios = selectPoolTuneRuns(dataset, phase, modelProfile).map(
    ({ scenario, modelProfile: scenarioProfile }) => {
      const { model, priceListVersion } = resolveContentModel(scenarioProfile);
      const request = buildPoolTuneRequest(scenario, scenarioProfile);
      const estimate = estimateContentCost(request, model, priceListVersion, maxAttempts);
      return {
        scenarioId: scenario.id,
        split: scenario.split,
        category: scenario.category,
        modelProfile: scenarioProfile,
        model,
        level: scenario.level,
        counts: scenario.counts,
        totalQuestions:
          scenario.counts.aperta + scenario.counts.chiusa_singola + scenario.counts.chiusa_multipla,
        estimatedInputTokens: estimate.estimatedInputTokens,
        maxOutputTokens: estimate.maxOutputTokens,
        reservationInputTokenUpperBound: estimate.reservationInputTokenUpperBound,
        reservationOutputTokens: estimate.reservationOutputTokens,
        estimatedCostMicroUsd: estimate.estimatedCostMicroUsd,
        costUpperBoundMicroUsd: estimate.reservationCostMicroUsd,
      };
    },
  );
  return {
    dryRun: true,
    datasetVersion: dataset.datasetVersion,
    rubricVersion: dataset.rubricVersion,
    phase,
    selectedModelProfile: phase === 'profile_probe' ? 'paired' : modelProfile,
    plannedCalls: scenarios.length,
    maximumProviderAttempts: scenarios.length * maxAttempts,
    estimatedCostMicroUsd: scenarios.reduce(
      (total, scenario) => total + scenario.estimatedCostMicroUsd,
      0,
    ),
    costUpperBoundMicroUsd: scenarios.reduce(
      (total, scenario) => total + scenario.costUpperBoundMicroUsd,
      0,
    ),
    scenarios,
  };
}
