import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  LESSON_MANUAL_QUALITY_DATASET_VERSION,
  LESSON_MANUAL_QUALITY_PROFILE,
  LESSON_MANUAL_QUALITY_RUBRIC_VERSION,
} from './lessonManualQualityBenchmark.js';
import {
  LESSON_TUNE_EXTENSION_VERSION,
  validateScenarioRequest,
  type LessonTuneDataset,
  type LessonTuneScenario,
} from './lessonTuneQualityBenchmark.js';

/**
 * LESSON-DEPTH-02 — il dataset del **caso povero**.
 *
 * Il benchmark esistente non può dire se le lezioni scarne sono state risolte,
 * perché non contiene il caso che le produce: tutti e sei gli scenari di
 * LESSON-TUNE-01 hanno 5-6 concetti chiave, 3 obiettivi e le indicazioni docente
 * compilate. Le lezioni che hanno originato la segnalazione ne hanno **due**,
 * senza indicazioni. Il prompt è stato tarato su un input ricco in ogni singolo
 * caso, e la configurazione povera non è mai stata misurata.
 *
 * Questo dataset è **separato** e non estende quello congelato: le evidenze di
 * LESSON-TUNE-01→07 devono restare riproducibili esattamente com'erano. Riusa
 * però lo stesso validatore di richiesta, la stessa rubrica e lo stesso tipo di
 * scenario, quindi i due possono essere confrontati senza tradurre nulla.
 *
 * Copertura voluta: uno e due concetti chiave — il caso segnalato e il suo
 * estremo — più una soglia a tre e una coppia a profondità `in_depth`. Sei
 * scenari su sei discipline diverse, perché un solo esempio non distingue «il
 * prompt è povero» da «quella materia è povera».
 *
 * Tutti in split `tuning`: non esiste un holdout: questo dataset serve a
 * diagnosticare e a confrontare due candidati, non a certificare un verdetto
 * finale, che resta compito dell'holdout di LESSON-TUNE-01.
 */

export const LESSON_DEPTH_SPARSE_DATASET_VERSION = 'lesson-depth-02-sparse-v1' as const;

export const DEFAULT_LESSON_DEPTH_SPARSE_PATH = fileURLToPath(
  new URL('../../documentazione/evidenze/lesson-depth-02-sparse.json', import.meta.url),
);

/** Numero di concetti chiave dichiarati: è la variabile che il dataset esplora. */
export function sparseConceptCount(scenario: LessonTuneScenario): number {
  return scenario.concettiChiave.length;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseScenario(raw: unknown, index: number): LessonTuneScenario {
  const position = index + 1;
  if (!isPlainObject(raw)) throw new Error(`Scenario sparse ${position} non valido.`);

  const expectedId = `LD02-${String(position).padStart(2, '0')}`;
  if (raw.id !== expectedId) throw new Error(`Scenario sparse ${position}: id non canonico.`);
  if (raw.split !== 'tuning') throw new Error(`${expectedId}: questo dataset non ha holdout.`);
  if (typeof raw.category !== 'string' || !/^[a-z][a-z_0-9]+$/.test(raw.category)) {
    throw new Error(`${expectedId}: categoria non valida.`);
  }

  // Il punto del dataset: se uno scenario avesse molti concetti o le indicazioni
  // compilate, misurerebbe di nuovo il caso ricco e non ce ne accorgeremmo.
  if (!Array.isArray(raw.concettiChiave) || raw.concettiChiave.length > 3) {
    throw new Error(`${expectedId}: il caso povero ammette al massimo tre concetti chiave.`);
  }
  if (raw.teacherGuidance !== null) {
    throw new Error(`${expectedId}: le indicazioni docente devono essere assenti.`);
  }

  const request = validateScenarioRequest(raw, expectedId);
  return {
    id: expectedId,
    split: 'tuning',
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

/**
 * Il dataset sparse nella forma che il pianificatore e il runner di
 * LESSON-TUNE-01 già consumano: nessuna macchina di esecuzione nuova.
 */
export function parseLessonDepthSparseDataset(raw: unknown): LessonTuneDataset {
  if (!isPlainObject(raw)) throw new Error('Dataset LESSON-DEPTH-02 non valido.');
  if (raw.datasetVersion !== LESSON_DEPTH_SPARSE_DATASET_VERSION) {
    throw new Error('Versione dataset LESSON-DEPTH-02 non supportata.');
  }
  if (raw.baseDatasetVersion !== LESSON_MANUAL_QUALITY_DATASET_VERSION) {
    throw new Error('Dataset base non accoppiato.');
  }
  if (raw.rubricVersion !== LESSON_MANUAL_QUALITY_RUBRIC_VERSION) {
    throw new Error('Rubrica non accoppiata: il confronto non sarebbe leggibile.');
  }
  if (raw.generatedSamplesIncluded !== false) {
    throw new Error('Il dataset non può contenere output generati.');
  }
  if (!Array.isArray(raw.scenarios) || raw.scenarios.length === 0) {
    throw new Error('Il dataset deve contenere almeno uno scenario.');
  }

  const scenarios = raw.scenarios.map(parseScenario);

  const ids = new Set(scenarios.map((scenario) => scenario.id));
  if (ids.size !== scenarios.length) throw new Error('Id duplicati nel dataset sparse.');

  // Se il dataset perdesse la copertura, un confronto «tutto verde» direbbe
  // molto meno di quanto sembra: la variabile esplorata deve restare esplorata.
  const counts = new Set(scenarios.map(sparseConceptCount));
  for (const expected of [1, 2]) {
    if (!counts.has(expected)) {
      throw new Error(`Il dataset deve contenere almeno uno scenario con ${expected} concetti.`);
    }
  }
  const categories = new Set(scenarios.map((scenario) => scenario.category));
  if (categories.size !== scenarios.length) {
    throw new Error('Ogni scenario deve appartenere a una disciplina distinta.');
  }

  return {
    datasetVersion:
      LESSON_DEPTH_SPARSE_DATASET_VERSION as unknown as LessonTuneDataset['datasetVersion'],
    baseDatasetVersion: LESSON_MANUAL_QUALITY_DATASET_VERSION,
    extensionVersion: LESSON_TUNE_EXTENSION_VERSION,
    rubricVersion: LESSON_MANUAL_QUALITY_RUBRIC_VERSION,
    generatedSamplesIncluded: false,
    primaryModelProfile: LESSON_MANUAL_QUALITY_PROFILE,
    scenarios,
  };
}

/** Carica il dataset sparse dal percorso canonico. */
export async function loadLessonDepthSparseDataset(
  path: string = DEFAULT_LESSON_DEPTH_SPARSE_PATH,
): Promise<LessonTuneDataset> {
  return parseLessonDepthSparseDataset(JSON.parse(await readFile(path, 'utf8')));
}
