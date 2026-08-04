import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  resolveContentModel,
  validateAiContentRequest,
  type LessonDepth,
  type LessonRequest,
  type LessonUdaContext,
} from './aiContentCore.js';
import { estimateContentCost } from './aiContentCost.js';
import type { ModelProfile } from './aiCorrectionModelProfile.js';
import {
  loadLessonManualQualityDataset,
  LESSON_MANUAL_QUALITY_DATASET_VERSION,
  LESSON_MANUAL_QUALITY_PROFILE,
  LESSON_MANUAL_QUALITY_RUBRIC_VERSION,
} from './lessonManualQualityBenchmark.js';
import { DEFAULT_OPENAI_RETRY_POLICY } from './openAiGrader.js';
import { maxAttemptsForPolicy } from './openAiStructuredRunner.js';

export const LESSON_TUNE_EXTENSION_VERSION = 'lesson-tune-01-extension-v1' as const;
export const LESSON_TUNE_DATASET_VERSION = 'lesson-tune-01-combined-v1' as const;
export const LESSON_TUNE_SPLITS = ['tuning', 'holdout'] as const;
export const LESSON_TUNE_PLAN_SPLITS = ['all', ...LESSON_TUNE_SPLITS] as const;

export type LessonTuneSplit = (typeof LESSON_TUNE_SPLITS)[number];
export type LessonTunePlanSplit = (typeof LESSON_TUNE_PLAN_SPLITS)[number];

export const DEFAULT_LESSON_TUNE_EXTENSION_PATH = fileURLToPath(
  new URL('../../documentazione/evidenze/lesson-tune-01-extension.json', import.meta.url),
);

export interface LessonTuneScenario {
  id: string;
  split: LessonTuneSplit;
  category: string;
  titolo: string;
  sottotitolo: string | null;
  difficolta: string;
  concettiChiave: string[];
  obiettivi: string[];
  udaTitle: string;
  udaContext: LessonUdaContext;
  depth: LessonDepth;
  teacherGuidance: string | null;
}

interface LessonTuneExtension {
  extensionVersion: typeof LESSON_TUNE_EXTENSION_VERSION;
  baseDatasetVersion: typeof LESSON_MANUAL_QUALITY_DATASET_VERSION;
  rubricVersion: typeof LESSON_MANUAL_QUALITY_RUBRIC_VERSION;
  generatedSamplesIncluded: false;
  scenarios: LessonTuneScenario[];
}

export interface LessonTuneDataset {
  datasetVersion: typeof LESSON_TUNE_DATASET_VERSION;
  baseDatasetVersion: typeof LESSON_MANUAL_QUALITY_DATASET_VERSION;
  extensionVersion: typeof LESSON_TUNE_EXTENSION_VERSION;
  rubricVersion: typeof LESSON_MANUAL_QUALITY_RUBRIC_VERSION;
  generatedSamplesIncluded: false;
  primaryModelProfile: typeof LESSON_MANUAL_QUALITY_PROFILE;
  scenarios: LessonTuneScenario[];
}

export interface LessonTuneScenarioPlan {
  id: string;
  split: LessonTuneSplit;
  category: string;
  depth: LessonDepth;
  estimatedInputTokens: number;
  maxOutputTokens: number;
  reservationInputTokenUpperBound: number;
  reservationOutputTokens: number;
  estimatedCostMicroUsd: number;
  costUpperBoundMicroUsd: number;
}

export interface LessonTuneExecutionPlan {
  dryRun: true;
  datasetVersion: typeof LESSON_TUNE_DATASET_VERSION;
  rubricVersion: typeof LESSON_MANUAL_QUALITY_RUBRIC_VERSION;
  split: LessonTunePlanSplit;
  modelProfile: ModelProfile;
  model: string;
  priceListVersion: string;
  plannedCalls: number;
  maximumProviderAttempts: number;
  estimatedCostMicroUsd: number;
  costUpperBoundMicroUsd: number;
  scenarios: LessonTuneScenarioPlan[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertExactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
): void {
  const keys = Object.keys(value);
  if (keys.length !== allowed.length || keys.some((key) => !allowed.includes(key))) {
    throw new Error(`${label}: proprietà mancanti o non ammesse.`);
  }
}

function requestIdForScenario(id: string): string {
  const numeric = Number.parseInt(id.slice(-2), 10);
  if (!Number.isInteger(numeric) || numeric < 1 || numeric > 12) {
    throw new Error(`${id}: indice non valido.`);
  }
  return `00000000-0000-4000-9000-${String(numeric).padStart(12, '0')}`;
}

function validateScenarioRequest(
  raw: Record<string, unknown>,
  id: string,
  modelProfile: ModelProfile = LESSON_MANUAL_QUALITY_PROFILE,
): LessonRequest {
  const validated = validateAiContentRequest({
    kind: 'lesson',
    requestId: requestIdForScenario(id),
    modelProfile,
    teacherGuidance: raw.teacherGuidance,
    depth: raw.depth,
    titolo: raw.titolo,
    sottotitolo: raw.sottotitolo,
    difficolta: raw.difficolta,
    concettiChiave: raw.concettiChiave,
    obiettivi: raw.obiettivi,
    udaTitle: raw.udaTitle,
    udaContext: raw.udaContext,
    currentBody: '',
    hasCurrentContent: false,
  });
  if (validated.kind !== 'lesson') throw new Error(`${id}: richiesta non lezione.`);
  return validated;
}

function parseExtensionScenario(raw: unknown, index: number): LessonTuneScenario {
  if (!isPlainObject(raw)) throw new Error(`Scenario esteso ${index + 1} non valido.`);
  assertExactKeys(
    raw,
    [
      'id',
      'split',
      'category',
      'titolo',
      'sottotitolo',
      'difficolta',
      'concettiChiave',
      'obiettivi',
      'udaTitle',
      'udaContext',
      'depth',
      'teacherGuidance',
    ],
    `Scenario esteso ${index + 1}`,
  );
  const expectedId = `LT01-${String(index + 7).padStart(2, '0')}`;
  if (raw.id !== expectedId) throw new Error(`Scenario esteso ${index + 1}: id non canonico.`);
  const expectedSplit: LessonTuneSplit = index < 4 ? 'tuning' : 'holdout';
  if (raw.split !== expectedSplit) throw new Error(`${expectedId}: split non canonico.`);
  if (typeof raw.category !== 'string' || !/^[a-z][a-z_]+$/.test(raw.category)) {
    throw new Error(`${expectedId}: categoria non valida.`);
  }
  const request = validateScenarioRequest(raw, expectedId);
  return {
    id: expectedId,
    split: expectedSplit,
    category: raw.category,
    titolo: request.titolo,
    sottotitolo: request.sottotitolo,
    difficolta: request.difficolta,
    concettiChiave: request.concettiChiave,
    obiettivi: request.obiettivi,
    udaTitle: request.udaTitle,
    udaContext: request.udaContext,
    depth: request.depth,
    teacherGuidance: request.teacherGuidance,
  };
}

export function parseLessonTuneExtension(raw: unknown): LessonTuneExtension {
  if (!isPlainObject(raw)) throw new Error('Estensione LESSON-TUNE-01 non valida.');
  assertExactKeys(
    raw,
    [
      'extensionVersion',
      'baseDatasetVersion',
      'rubricVersion',
      'generatedSamplesIncluded',
      'scenarios',
    ],
    'Estensione LESSON-TUNE-01',
  );
  if (raw.extensionVersion !== LESSON_TUNE_EXTENSION_VERSION) {
    throw new Error('Versione estensione LESSON-TUNE-01 non supportata.');
  }
  if (raw.baseDatasetVersion !== LESSON_MANUAL_QUALITY_DATASET_VERSION) {
    throw new Error('Dataset base LESSON-TUNE-01 non supportato.');
  }
  if (raw.rubricVersion !== LESSON_MANUAL_QUALITY_RUBRIC_VERSION) {
    throw new Error('Rubrica LESSON-TUNE-01 non supportata.');
  }
  if (raw.generatedSamplesIncluded !== false) {
    throw new Error('L’estensione non deve contenere campioni generati.');
  }
  if (!Array.isArray(raw.scenarios) || raw.scenarios.length !== 6) {
    throw new Error('L’estensione deve contenere esattamente 6 scenari.');
  }
  return {
    extensionVersion: LESSON_TUNE_EXTENSION_VERSION,
    baseDatasetVersion: LESSON_MANUAL_QUALITY_DATASET_VERSION,
    rubricVersion: LESSON_MANUAL_QUALITY_RUBRIC_VERSION,
    generatedSamplesIncluded: false,
    scenarios: raw.scenarios.map(parseExtensionScenario),
  };
}

export async function loadLessonTuneDataset(
  extensionPath = DEFAULT_LESSON_TUNE_EXTENSION_PATH,
): Promise<LessonTuneDataset> {
  const [base, extensionRaw] = await Promise.all([
    loadLessonManualQualityDataset(),
    readFile(extensionPath, 'utf8'),
  ]);
  const extension = parseLessonTuneExtension(JSON.parse(extensionRaw) as unknown);
  const baseScenarios: LessonTuneScenario[] = base.scenarios.map((scenario, index) => ({
    ...scenario,
    split: index < 4 ? 'tuning' : 'holdout',
  }));
  const scenarios = [...baseScenarios, ...extension.scenarios];
  if (new Set(scenarios.map((scenario) => scenario.id)).size !== 12) {
    throw new Error('Gli identificatori LESSON-TUNE-01 devono essere univoci.');
  }
  if (scenarios.filter((scenario) => scenario.split === 'tuning').length !== 8) {
    throw new Error('LESSON-TUNE-01 deve contenere 8 scenari tuning.');
  }
  if (scenarios.filter((scenario) => scenario.split === 'holdout').length !== 4) {
    throw new Error('LESSON-TUNE-01 deve contenere 4 scenari holdout.');
  }
  return {
    datasetVersion: LESSON_TUNE_DATASET_VERSION,
    baseDatasetVersion: LESSON_MANUAL_QUALITY_DATASET_VERSION,
    extensionVersion: LESSON_TUNE_EXTENSION_VERSION,
    rubricVersion: LESSON_MANUAL_QUALITY_RUBRIC_VERSION,
    generatedSamplesIncluded: false,
    primaryModelProfile: LESSON_MANUAL_QUALITY_PROFILE,
    scenarios,
  };
}

export function buildLessonTuneRequest(
  scenario: LessonTuneScenario,
  modelProfile: ModelProfile = LESSON_MANUAL_QUALITY_PROFILE,
): LessonRequest {
  return validateScenarioRequest(
    scenario as unknown as Record<string, unknown>,
    scenario.id,
    modelProfile,
  );
}

export function selectLessonTuneScenarios(
  dataset: LessonTuneDataset,
  split: LessonTunePlanSplit,
): LessonTuneScenario[] {
  return split === 'all'
    ? dataset.scenarios
    : dataset.scenarios.filter((scenario) => scenario.split === split);
}

export function buildLessonTuneExecutionPlan(
  dataset: LessonTuneDataset,
  split: LessonTunePlanSplit = 'all',
  modelProfile: ModelProfile = LESSON_MANUAL_QUALITY_PROFILE,
): LessonTuneExecutionPlan {
  if (!LESSON_TUNE_PLAN_SPLITS.includes(split)) throw new Error('Split benchmark non supportato.');
  const maxAttempts = maxAttemptsForPolicy(DEFAULT_OPENAI_RETRY_POLICY);
  const { model, priceListVersion } = resolveContentModel(modelProfile);
  const scenarios = selectLessonTuneScenarios(dataset, split).map((scenario) => {
    const estimate = estimateContentCost(
      buildLessonTuneRequest(scenario, modelProfile),
      model,
      priceListVersion,
      maxAttempts,
    );
    return {
      id: scenario.id,
      split: scenario.split,
      category: scenario.category,
      depth: scenario.depth,
      estimatedInputTokens: estimate.estimatedInputTokens,
      maxOutputTokens: estimate.maxOutputTokens,
      reservationInputTokenUpperBound: estimate.reservationInputTokenUpperBound,
      reservationOutputTokens: estimate.reservationOutputTokens,
      estimatedCostMicroUsd: estimate.estimatedCostMicroUsd,
      costUpperBoundMicroUsd: estimate.reservationCostMicroUsd,
    };
  });
  return {
    dryRun: true,
    datasetVersion: dataset.datasetVersion,
    rubricVersion: dataset.rubricVersion,
    split,
    modelProfile,
    model,
    priceListVersion,
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
