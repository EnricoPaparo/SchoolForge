import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  resolveContentModel,
  validateAiContentRequest,
  type LessonRequest,
  type LessonDepth,
  type LessonUdaContext,
} from './aiContentCore.js';
import { estimateContentCost, type ContentCostEstimate } from './aiContentCost.js';
import { DEFAULT_OPENAI_RETRY_POLICY } from './openAiGrader.js';
import { maxAttemptsForPolicy } from './openAiStructuredRunner.js';

export const LESSON_MANUAL_QUALITY_DATASET_VERSION = 'lesson-manual-02-scenarios-v1' as const;
export const LESSON_MANUAL_QUALITY_RUBRIC_VERSION = 'lesson-manual-02-rubric-v1' as const;
export const LESSON_MANUAL_QUALITY_PROFILE = 'economy' as const;

export const DEFAULT_LESSON_MANUAL_QUALITY_DATASET_PATH = fileURLToPath(
  new URL('../../documentazione/evidenze/lesson-manual-02-scenarios.json', import.meta.url),
);

export const LESSON_MANUAL_SCENARIO_CATEGORIES = [
  'introductory_theory',
  'technical_procedure',
  'practical_examples',
  'worked_exercises',
  'advanced_in_depth',
  'uda_boundary',
] as const;

export type LessonManualScenarioCategory = (typeof LESSON_MANUAL_SCENARIO_CATEGORIES)[number];

export interface LessonManualQualityScenario {
  id: string;
  category: LessonManualScenarioCategory;
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

export interface LessonManualQualityDataset {
  datasetVersion: typeof LESSON_MANUAL_QUALITY_DATASET_VERSION;
  rubricVersion: typeof LESSON_MANUAL_QUALITY_RUBRIC_VERSION;
  generatedSamplesIncluded: false;
  primaryModelProfile: typeof LESSON_MANUAL_QUALITY_PROFILE;
  scenarios: LessonManualQualityScenario[];
}

export interface LessonManualScenarioPlan {
  id: string;
  category: LessonManualScenarioCategory;
  depth: LessonDepth;
  estimatedInputTokens: number;
  maxOutputTokens: number;
  reservationInputTokenUpperBound: number;
  reservationOutputTokens: number;
  estimatedCostMicroUsd: number;
  costUpperBoundMicroUsd: number;
}

export interface LessonManualQualityExecutionPlan {
  dryRun: true;
  datasetVersion: typeof LESSON_MANUAL_QUALITY_DATASET_VERSION;
  rubricVersion: typeof LESSON_MANUAL_QUALITY_RUBRIC_VERSION;
  modelProfile: typeof LESSON_MANUAL_QUALITY_PROFILE;
  model: string;
  priceListVersion: string;
  plannedCalls: 6;
  maximumProviderAttempts: number;
  estimatedCostMicroUsd: number;
  costUpperBoundMicroUsd: number;
  scenarios: LessonManualScenarioPlan[];
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

function scenarioRequestId(index: number): string {
  return `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
}

function parseScenario(raw: unknown, index: number): LessonManualQualityScenario {
  if (!isPlainObject(raw)) throw new Error(`Scenario ${index + 1} non valido.`);
  assertExactKeys(
    raw,
    [
      'id',
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
    `Scenario ${index + 1}`,
  );
  const expectedId = `LM02-${String(index + 1).padStart(2, '0')}`;
  if (raw.id !== expectedId) throw new Error(`Scenario ${index + 1}: id non canonico.`);
  const expectedCategory = LESSON_MANUAL_SCENARIO_CATEGORIES[index];
  if (raw.category !== expectedCategory) {
    throw new Error(`${expectedId}: categoria non canonica.`);
  }

  const request = validateAiContentRequest({
    kind: 'lesson',
    requestId: scenarioRequestId(index),
    modelProfile: LESSON_MANUAL_QUALITY_PROFILE,
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
  if (request.kind !== 'lesson') throw new Error(`${expectedId}: richiesta non lezione.`);
  return {
    id: expectedId,
    category: expectedCategory,
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

export function parseLessonManualQualityDataset(raw: unknown): LessonManualQualityDataset {
  if (!isPlainObject(raw)) throw new Error('Dataset LESSON-MANUAL-02 non valido.');
  assertExactKeys(
    raw,
    [
      'datasetVersion',
      'rubricVersion',
      'generatedSamplesIncluded',
      'primaryModelProfile',
      'scenarios',
    ],
    'Dataset LESSON-MANUAL-02',
  );
  if (raw.datasetVersion !== LESSON_MANUAL_QUALITY_DATASET_VERSION) {
    throw new Error('Versione dataset LESSON-MANUAL-02 non supportata.');
  }
  if (raw.rubricVersion !== LESSON_MANUAL_QUALITY_RUBRIC_VERSION) {
    throw new Error('Versione rubrica LESSON-MANUAL-02 non supportata.');
  }
  if (raw.generatedSamplesIncluded !== false) {
    throw new Error('Il dataset non deve contenere campioni generati.');
  }
  if (raw.primaryModelProfile !== LESSON_MANUAL_QUALITY_PROFILE) {
    throw new Error('Il profilo primario deve essere economy.');
  }
  if (!Array.isArray(raw.scenarios) || raw.scenarios.length !== 6) {
    throw new Error('Il dataset deve contenere esattamente 6 scenari.');
  }
  const scenarios = raw.scenarios.map(parseScenario);
  return {
    datasetVersion: LESSON_MANUAL_QUALITY_DATASET_VERSION,
    rubricVersion: LESSON_MANUAL_QUALITY_RUBRIC_VERSION,
    generatedSamplesIncluded: false,
    primaryModelProfile: LESSON_MANUAL_QUALITY_PROFILE,
    scenarios,
  };
}

export async function loadLessonManualQualityDataset(
  path = DEFAULT_LESSON_MANUAL_QUALITY_DATASET_PATH,
): Promise<LessonManualQualityDataset> {
  return parseLessonManualQualityDataset(JSON.parse(await readFile(path, 'utf8')) as unknown);
}

export function buildLessonManualRequest(
  scenario: LessonManualQualityScenario,
  index: number,
): LessonRequest {
  const validated = validateAiContentRequest({
    kind: 'lesson',
    requestId: scenarioRequestId(index),
    modelProfile: LESSON_MANUAL_QUALITY_PROFILE,
    teacherGuidance: scenario.teacherGuidance,
    depth: scenario.depth,
    titolo: scenario.titolo,
    sottotitolo: scenario.sottotitolo,
    difficolta: scenario.difficolta,
    concettiChiave: scenario.concettiChiave,
    obiettivi: scenario.obiettivi,
    udaTitle: scenario.udaTitle,
    udaContext: scenario.udaContext,
    currentBody: '',
    hasCurrentContent: false,
  });
  if (validated.kind !== 'lesson') throw new Error(`${scenario.id}: richiesta non lezione.`);
  return validated;
}

function scenarioPlan(
  scenario: LessonManualQualityScenario,
  index: number,
  maxAttempts: number,
): LessonManualScenarioPlan {
  const request = buildLessonManualRequest(scenario, index);
  const { model, priceListVersion } = resolveContentModel(LESSON_MANUAL_QUALITY_PROFILE);
  const estimate: ContentCostEstimate = estimateContentCost(
    request,
    model,
    priceListVersion,
    maxAttempts,
  );
  return {
    id: scenario.id,
    category: scenario.category,
    depth: scenario.depth,
    estimatedInputTokens: estimate.estimatedInputTokens,
    maxOutputTokens: estimate.maxOutputTokens,
    reservationInputTokenUpperBound: estimate.reservationInputTokenUpperBound,
    reservationOutputTokens: estimate.reservationOutputTokens,
    estimatedCostMicroUsd: estimate.estimatedCostMicroUsd,
    costUpperBoundMicroUsd: estimate.reservationCostMicroUsd,
  };
}

export function buildLessonManualQualityExecutionPlan(
  dataset: LessonManualQualityDataset,
): LessonManualQualityExecutionPlan {
  const maxAttempts = maxAttemptsForPolicy(DEFAULT_OPENAI_RETRY_POLICY);
  const { model, priceListVersion } = resolveContentModel(LESSON_MANUAL_QUALITY_PROFILE);
  const scenarios = dataset.scenarios.map((scenario, index) =>
    scenarioPlan(scenario, index, maxAttempts),
  );
  return {
    dryRun: true,
    datasetVersion: dataset.datasetVersion,
    rubricVersion: dataset.rubricVersion,
    modelProfile: LESSON_MANUAL_QUALITY_PROFILE,
    model,
    priceListVersion,
    plannedCalls: 6,
    maximumProviderAttempts: 6 * maxAttempts,
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
