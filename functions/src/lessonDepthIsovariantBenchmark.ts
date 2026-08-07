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
 * LESSON-DEPTH-03 — il dataset **isovariante**.
 *
 * LESSON-DEPTH-02 ha misurato il caso povero, ma il suo disegno fa variare due
 * cose insieme: la disciplina e il numero di concetti chiave. LD02-01 è
 * grammatica con un concetto, LD02-03 è storia con due; quando il confronto
 * dice «da uno a due concetti il testo cresce del 43%» non è possibile sapere
 * quanta parte sia il conteggio e quanta il fatto che la storia si presti a
 * scrivere più della grammatica. LD02-05 lo mostra apertamente: tre concetti,
 * meno testo di uno scenario a due.
 *
 * Qui la variabile è **una sola**. Gli scenari sono organizzati in terne: stessa
 * materia, stessa lezione, stessi obiettivi, stessa UDA, stessa profondità —
 * cambia soltanto quanti concetti chiave il docente ha dichiarato, e i concetti
 * sono **annidati** (1 ⊂ 2 ⊂ 3), così la terna a due contiene esattamente
 * quella a uno più una voce.
 *
 * L'esito è perciò decidibile senza rubrica: se il prompt tratta i concetti
 * chiave come *perimetro* le tre lezioni di una terna hanno lunghezza simile;
 * se li tratta come *budget di contenuto* la lunghezza cresce con il conteggio,
 * ed è il difetto che LESSON-DEPTH-01 vuole eliminare.
 *
 * Due terne su due discipline diverse, non una: una sola terna non
 * distinguerebbe il comportamento del prompt da una peculiarità della materia.
 *
 * Il dataset è **separato** da quelli congelati e ne riusa validatore, tipo di
 * scenario e rubrica, così i risultati restano confrontabili senza tradurre
 * nulla. Tutti gli scenari sono in split `tuning`: serve a diagnosticare, non a
 * certificare — il verdetto finale resta compito dell'holdout di
 * LESSON-TUNE-01.
 */

export const LESSON_DEPTH_ISOVARIANT_DATASET_VERSION = 'lesson-depth-03-isovariant-v1' as const;

/** Scenari per terna: le arità esplorate sono esattamente 1, 2 e 3. */
export const ISOVARIANT_TRIAD_SIZE = 3;

export const DEFAULT_LESSON_DEPTH_ISOVARIANT_PATH = fileURLToPath(
  new URL('../../documentazione/evidenze/lesson-depth-03-isovariant.json', import.meta.url),
);

/** Numero di concetti chiave dichiarati: l'unica variabile del disegno. */
export function isovariantConceptArity(scenario: LessonTuneScenario): number {
  return scenario.concettiChiave.length;
}

/**
 * Le terne come gruppi già pronti per il confronto: `triads[i][k]` è lo scenario
 * della terna `i` con `k + 1` concetti chiave.
 */
export function isovariantTriads(dataset: LessonTuneDataset): LessonTuneScenario[][] {
  const triads: LessonTuneScenario[][] = [];
  for (let index = 0; index < dataset.scenarios.length; index += ISOVARIANT_TRIAD_SIZE) {
    triads.push(dataset.scenarios.slice(index, index + ISOVARIANT_TRIAD_SIZE));
  }
  return triads;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseScenario(raw: unknown, index: number): LessonTuneScenario {
  const position = index + 1;
  if (!isPlainObject(raw)) throw new Error(`Scenario isovariante ${position} non valido.`);

  const expectedId = `LD03-${String(position).padStart(2, '0')}`;
  if (raw.id !== expectedId) throw new Error(`Scenario isovariante ${position}: id non canonico.`);
  if (raw.split !== 'tuning') throw new Error(`${expectedId}: questo dataset non ha holdout.`);
  if (typeof raw.category !== 'string' || !/^[a-z][a-z_0-9]+$/.test(raw.category)) {
    throw new Error(`${expectedId}: categoria non valida.`);
  }

  // L'arità è determinata dalla posizione nella terna: è il disegno stesso, non
  // un dato libero. Uno scenario fuori posto renderebbe il confronto illeggibile
  // senza che nulla lo segnali.
  const expectedArity = (index % ISOVARIANT_TRIAD_SIZE) + 1;
  if (!Array.isArray(raw.concettiChiave) || raw.concettiChiave.length !== expectedArity) {
    throw new Error(`${expectedId}: attesi esattamente ${expectedArity} concetti chiave.`);
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
 * Tutto ciò che, all'interno di una terna, **deve** restare identico. Se uno di
 * questi campi cambiasse, la terna smetterebbe di misurare il conteggio dei
 * concetti e tornerebbe a misurare due cose insieme, com'era in LESSON-DEPTH-02.
 */
function invariantSignature(scenario: LessonTuneScenario): string {
  return JSON.stringify([
    scenario.titolo,
    scenario.sottotitolo,
    scenario.difficolta,
    scenario.obiettivi,
    scenario.udaTitle,
    scenario.udaContext,
    scenario.depth,
  ]);
}

function assertNestedConcepts(triad: LessonTuneScenario[]): void {
  for (let level = 1; level < triad.length; level += 1) {
    const previous = triad[level - 1]!.concettiChiave;
    const current = triad[level]!.concettiChiave;
    // Annidamento come **prefisso**, non come semplice inclusione: se l'ordine
    // cambiasse, cambierebbe anche l'ordine in cui il prompt riceve i concetti,
    // e quella sarebbe una seconda variabile.
    for (let position = 0; position < previous.length; position += 1) {
      if (previous[position] !== current[position]) {
        throw new Error(
          `${triad[level]!.id}: i concetti chiave devono estendere quelli dello scenario precedente.`,
        );
      }
    }
  }
}

/**
 * Il dataset isovariante nella forma che il pianificatore e il runner di
 * LESSON-TUNE-01 già consumano: nessuna macchina di esecuzione nuova.
 */
export function parseLessonDepthIsovariantDataset(raw: unknown): LessonTuneDataset {
  if (!isPlainObject(raw)) throw new Error('Dataset LESSON-DEPTH-03 non valido.');
  if (raw.datasetVersion !== LESSON_DEPTH_ISOVARIANT_DATASET_VERSION) {
    throw new Error('Versione dataset LESSON-DEPTH-03 non supportata.');
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
  if (raw.scenarios.length % ISOVARIANT_TRIAD_SIZE !== 0) {
    throw new Error('Gli scenari devono formare terne complete: 1, 2 e 3 concetti chiave.');
  }

  const scenarios = raw.scenarios.map(parseScenario);

  const ids = new Set(scenarios.map((scenario) => scenario.id));
  if (ids.size !== scenarios.length) throw new Error('Id duplicati nel dataset isovariante.');
  const categories = new Set(scenarios.map((scenario) => scenario.category));
  if (categories.size !== scenarios.length) {
    throw new Error('Ogni scenario deve avere una categoria distinta.');
  }

  const dataset: LessonTuneDataset = {
    datasetVersion:
      LESSON_DEPTH_ISOVARIANT_DATASET_VERSION as unknown as LessonTuneDataset['datasetVersion'],
    baseDatasetVersion: LESSON_MANUAL_QUALITY_DATASET_VERSION,
    extensionVersion: LESSON_TUNE_EXTENSION_VERSION,
    rubricVersion: LESSON_MANUAL_QUALITY_RUBRIC_VERSION,
    generatedSamplesIncluded: false,
    primaryModelProfile: LESSON_MANUAL_QUALITY_PROFILE,
    scenarios,
  };

  const triads = isovariantTriads(dataset);
  if (triads.length < 2) {
    throw new Error(
      'Servono almeno due terne su discipline diverse: una sola non distingue il prompt dalla materia.',
    );
  }
  for (const triad of triads) {
    const signatures = new Set(triad.map(invariantSignature));
    if (signatures.size !== 1) {
      throw new Error(
        `${triad[0]!.id}: dentro una terna può cambiare solo il numero di concetti chiave.`,
      );
    }
    assertNestedConcepts(triad);
  }

  const lessons = new Set(triads.map((triad) => triad[0]!.titolo));
  if (lessons.size !== triads.length) {
    throw new Error('Ogni terna deve riguardare una lezione diversa.');
  }

  return dataset;
}

/** Carica il dataset isovariante dal percorso canonico. */
export async function loadLessonDepthIsovariantDataset(
  path: string = DEFAULT_LESSON_DEPTH_ISOVARIANT_PATH,
): Promise<LessonTuneDataset> {
  return parseLessonDepthIsovariantDataset(JSON.parse(await readFile(path, 'utf8')));
}
