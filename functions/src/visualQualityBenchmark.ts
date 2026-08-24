import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  resolveContentModel,
  validateAiContentRequest,
  type VisualProposalRequest,
} from './aiContentCore.js';
import { estimateContentCost } from './aiContentCost.js';
import { estimateVisualCost } from './aiVisualCore.js';
import { DEFAULT_OPENAI_RETRY_POLICY } from './openAiGrader.js';
import { maxAttemptsForPolicy } from './openAiStructuredRunner.js';

export const VISUAL_QUALITY_DATASET_VERSION = 'visual-enrichment-05a-dataset-v2' as const;
export const VISUAL_QUALITY_RUBRIC_VERSION = 'visual-enrichment-05a-rubric-v1' as const;
export const VISUAL_QUALITY_SPLITS = ['tuning', 'holdout'] as const;
export type VisualQualitySplit = (typeof VISUAL_QUALITY_SPLITS)[number];

export const DEFAULT_VISUAL_QUALITY_DATASET_PATH = fileURLToPath(
  new URL('../../documentazione/evidenze/visual-enrichment-05a-dataset.json', import.meta.url),
);
export const DEFAULT_VISUAL_QUALITY_SOURCES_DIR = fileURLToPath(
  new URL('../../documentazione/evidenze/visual-enrichment-05a-sources/', import.meta.url),
);

export const VISUAL_PROPOSAL_RUBRIC_DIMENSIONS = [
  'decisione_appropriata',
  'utilita_didattica_dichiarata',
  'concetto_visualizzabile',
  'posizione_nella_lezione',
  'caption_e_alt_text',
  'subject_sicuro_e_preciso',
] as const;

export const VISUAL_IMAGE_RUBRIC_DIMENSIONS = [
  'correttezza_concettuale',
  'utilita_aggiuntiva',
  'chiarezza_visiva',
  'gerarchia_e_leggibilita',
  'coerenza_schoolforge_sketch',
  'assenza_decorazioni_inutili',
  'testo_leggibile_e_non_inventato',
  'caption_coerente',
  'accessibilita_alt_text',
  'posizione_adeguata',
] as const;

export const VISUAL_QUALITY_BLOCKERS = [
  'errore_concettuale',
  'relazione_falsa_o_assolutizzata',
  'testo_inventato',
  'etichette_illeggibili',
  'figura_puramente_decorativa',
  'contenuto_estraneo_alla_lezione',
  'immagine_sostituisce_spiegazioni_indispensabili',
  'unsafe_content_o_subject_non_valido',
  'asset_oltre_200_kb',
  'mime_hash_o_dimensioni_incoerenti',
  'layout_shift_visibile',
  'heading_errato',
  'decision_image_sistematica_sui_non_visuali',
] as const;

export interface VisualQualityScenario {
  id: string;
  split: VisualQualitySplit;
  category: string;
  expectedDecision: 'image' | 'none' | 'either';
  sourceFile: string;
  sourceSha256: string;
  titolo: string;
  sottotitolo: string;
  difficolta: string;
  concettiChiave: string[];
  obiettivi: string[];
  udaTitle: string;
  udaContext: string;
  lessonBody: string;
}

export interface VisualQualityDataset {
  datasetVersion: typeof VISUAL_QUALITY_DATASET_VERSION;
  rubricVersion: typeof VISUAL_QUALITY_RUBRIC_VERSION;
  generatedSamplesIncluded: false;
  sourceProvenance: string;
  scenarios: VisualQualityScenario[];
}

export interface VisualQualityExecutionPlan {
  dryRun: boolean;
  split: VisualQualitySplit;
  datasetVersion: string;
  rubricVersion: string;
  scenarios: number;
  maximumProviderCalls: number;
  maximumProviderAttempts: number;
  estimatedCostMicroUsd: number;
  costUpperBoundMicroUsd: number;
  proposalCostUpperBoundMicroUsd: number;
  imageCostUpperBoundMicroUsd: number;
}

function plainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value).sort();
  const expected = [...allowed].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${label}: proprietà mancanti o non ammesse.`);
  }
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim()) {
    throw new Error(`${label}: stringa non valida.`);
  }
  return value;
}

function textList(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`${label}: elenco non valido.`);
  return value.map((item, index) => text(item, `${label}[${index}]`));
}

function requestIdForScenario(id: string): string {
  const number = Number.parseInt(id.slice(-2), 10);
  if (!Number.isInteger(number) || number < 1 || number > 12)
    throw new Error(`${id}: id invalido.`);
  return `050a0000-0000-4000-a000-${String(number).padStart(12, '0')}`;
}

function parseScenario(raw: unknown, index: number): Omit<VisualQualityScenario, 'lessonBody'> {
  if (!plainObject(raw)) throw new Error(`Scenario ${index + 1}: forma non valida.`);
  exactKeys(
    raw,
    [
      'id',
      'split',
      'category',
      'expectedDecision',
      'sourceFile',
      'sourceSha256',
      'titolo',
      'sottotitolo',
      'difficolta',
      'concettiChiave',
      'obiettivi',
      'udaTitle',
      'udaContext',
    ],
    `Scenario ${index + 1}`,
  );
  const id = `VE05A-${String(index + 1).padStart(2, '0')}`;
  const split: VisualQualitySplit = index < 8 ? 'tuning' : 'holdout';
  if (raw.id !== id || raw.split !== split || raw.sourceFile !== `${id}.md`) {
    throw new Error(`${id}: identità o split non canonico.`);
  }
  if (
    raw.expectedDecision !== 'image' &&
    raw.expectedDecision !== 'none' &&
    raw.expectedDecision !== 'either'
  ) {
    throw new Error(`${id}: expectedDecision non valida.`);
  }
  const sourceSha256 = text(raw.sourceSha256, `${id}.sourceSha256`);
  if (!/^[a-f0-9]{64}$/.test(sourceSha256)) throw new Error(`${id}: SHA-256 non valido.`);
  return {
    id,
    split,
    category: text(raw.category, `${id}.category`),
    expectedDecision: raw.expectedDecision,
    sourceFile: raw.sourceFile,
    sourceSha256,
    titolo: text(raw.titolo, `${id}.titolo`),
    sottotitolo: text(raw.sottotitolo, `${id}.sottotitolo`),
    difficolta: text(raw.difficolta, `${id}.difficolta`),
    concettiChiave: textList(raw.concettiChiave, `${id}.concettiChiave`),
    obiettivi: textList(raw.obiettivi, `${id}.obiettivi`),
    udaTitle: text(raw.udaTitle, `${id}.udaTitle`),
    udaContext: text(raw.udaContext, `${id}.udaContext`),
  };
}

export async function loadVisualQualityDataset(
  datasetPath = DEFAULT_VISUAL_QUALITY_DATASET_PATH,
  sourcesDir = DEFAULT_VISUAL_QUALITY_SOURCES_DIR,
): Promise<VisualQualityDataset> {
  const raw = JSON.parse(await readFile(datasetPath, 'utf8')) as unknown;
  if (!plainObject(raw)) throw new Error('Dataset VE-05A non valido.');
  exactKeys(
    raw,
    [
      'datasetVersion',
      'rubricVersion',
      'generatedSamplesIncluded',
      'sourceProvenance',
      'scenarios',
    ],
    'Dataset VE-05A',
  );
  if (
    raw.datasetVersion !== VISUAL_QUALITY_DATASET_VERSION ||
    raw.rubricVersion !== VISUAL_QUALITY_RUBRIC_VERSION ||
    raw.generatedSamplesIncluded !== false ||
    !Array.isArray(raw.scenarios) ||
    raw.scenarios.length !== 12
  ) {
    throw new Error('Dataset VE-05A: versione, rubrica o cardinalità non valida.');
  }
  const scenarios: VisualQualityScenario[] = [];
  for (let index = 0; index < raw.scenarios.length; index += 1) {
    const parsed = parseScenario(raw.scenarios[index], index);
    const bytes = await readFile(resolve(sourcesDir, parsed.sourceFile));
    const actualHash = createHash('sha256').update(bytes).digest('hex');
    if (actualHash !== parsed.sourceSha256)
      throw new Error(`${parsed.id}: sorgente mutata (SHA-256).`);
    const lessonBody = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const scenario = { ...parsed, lessonBody };
    buildVisualProposalRequest(scenario);
    scenarios.push(scenario);
  }
  const tuningCategories = new Set(scenarios.slice(0, 8).map((scenario) => scenario.category));
  for (const required of [
    'processo_sequenziale',
    'struttura_fisica',
    'relazione_componenti',
    'confronto_concettuale',
    'rappresentazione_dati',
    'argomento_astratto',
    'testo_normativo',
    'testo_autosufficiente',
  ]) {
    if (!tuningCategories.has(required))
      throw new Error(`Dataset VE-05A: categoria tuning mancante (${required}).`);
  }
  return {
    datasetVersion: VISUAL_QUALITY_DATASET_VERSION,
    rubricVersion: VISUAL_QUALITY_RUBRIC_VERSION,
    generatedSamplesIncluded: false,
    sourceProvenance: text(raw.sourceProvenance, 'sourceProvenance'),
    scenarios,
  };
}

/** Il tuning non riceve mai oggetti holdout: lo split è eliminato dal valore restituito. */
export function selectVisualQualityScenarios(
  dataset: VisualQualityDataset,
  split: VisualQualitySplit,
): VisualQualityScenario[] {
  return dataset.scenarios.filter((scenario) => scenario.split === split);
}

export function buildVisualProposalRequest(scenario: VisualQualityScenario): VisualProposalRequest {
  const request = validateAiContentRequest({
    kind: 'visual_proposal',
    requestId: requestIdForScenario(scenario.id),
    modelProfile: 'quality',
    titolo: scenario.titolo,
    sottotitolo: scenario.sottotitolo,
    difficolta: scenario.difficolta,
    concettiChiave: scenario.concettiChiave,
    obiettivi: scenario.obiettivi,
    udaTitle: scenario.udaTitle,
    udaContext: {
      title: scenario.udaTitle,
      descrizione: scenario.udaContext,
      competenze: [],
      obiettivi: scenario.obiettivi,
      currentLessonPosition: 1,
      lessons: [{ position: 1, titolo: scenario.titolo, sottotitolo: scenario.sottotitolo }],
    },
    lessonBody: scenario.lessonBody,
  });
  if (request.kind !== 'visual_proposal') throw new Error(`${scenario.id}: richiesta non visuale.`);
  return request;
}

export function buildVisualQualityExecutionPlan(
  dataset: VisualQualityDataset,
  split: VisualQualitySplit,
): VisualQualityExecutionPlan {
  const scenarios = selectVisualQualityScenarios(dataset, split);
  const attempts = maxAttemptsForPolicy(DEFAULT_OPENAI_RETRY_POLICY);
  const { model, priceListVersion } = resolveContentModel('quality');
  let proposalEstimate = 0;
  let proposalCap = 0;
  for (const scenario of scenarios) {
    const estimate = estimateContentCost(
      buildVisualProposalRequest(scenario),
      model,
      priceListVersion,
      attempts,
    );
    proposalEstimate += estimate.estimatedCostMicroUsd;
    proposalCap += estimate.reservationCostMicroUsd;
  }
  // Il subject non è noto al dry-run: 400 caratteri è il massimo ammesso dal contratto.
  const image = estimateVisualCost('x'.repeat(400), 'openai');
  const imageEstimate = image.estimatedCostMicroUsd * scenarios.length;
  const imageCap = image.reservationCostMicroUsd * scenarios.length;
  return {
    dryRun: true,
    split,
    datasetVersion: dataset.datasetVersion,
    rubricVersion: dataset.rubricVersion,
    scenarios: scenarios.length,
    maximumProviderCalls: scenarios.length * 2,
    maximumProviderAttempts: scenarios.length * attempts * 2,
    estimatedCostMicroUsd: proposalEstimate + imageEstimate,
    costUpperBoundMicroUsd: proposalCap + imageCap,
    proposalCostUpperBoundMicroUsd: proposalCap,
    imageCostUpperBoundMicroUsd: imageCap,
  };
}

export function benchmarkVerdict(params: {
  complete: boolean;
  blockers: readonly string[];
  proposalScores: readonly number[];
  imageScores: readonly number[];
  noneRate: number | null;
}): 'PASS' | 'REVIEW' {
  if (!params.complete || params.blockers.length > 0 || params.noneRate === null) return 'REVIEW';
  if (
    [...params.proposalScores, ...params.imageScores].some(
      (score) => !Number.isInteger(score) || score < 0 || score > 4,
    )
  )
    return 'REVIEW';
  // Un tasso nullo è sospetto per costruzione del dataset e non può produrre PASS.
  if (params.noneRate === 0) return 'REVIEW';
  return 'PASS';
}
