import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LESSON_DEPTH_ISOVARIANT_PATH,
  ISOVARIANT_TRIAD_SIZE,
  LESSON_DEPTH_ISOVARIANT_DATASET_VERSION,
  isovariantConceptArity,
  isovariantTriads,
  loadLessonDepthIsovariantDataset,
  parseLessonDepthIsovariantDataset,
} from './lessonDepthIsovariantBenchmark.js';
import {
  buildLessonTuneExecutionPlan,
  LESSON_TUNE_EXTENSION_VERSION,
} from './lessonTuneQualityBenchmark.js';
import { LESSON_MANUAL_QUALITY_RUBRIC_VERSION } from './lessonManualQualityBenchmark.js';

/**
 * LESSON-DEPTH-03 — il dataset a variabile singola.
 *
 * Il valore di questo dataset sta tutto nel suo **disegno**: dentro una terna
 * può cambiare soltanto il numero di concetti chiave. Un dataset che perdesse
 * quell'invariante continuerebbe a caricarsi e a produrre numeri, ma i numeri
 * non significherebbero più quello che diciamo che significano — ed è
 * esattamente il difetto di LESSON-DEPTH-02 che qui viene corretto. I test
 * difendono perciò il disegno prima di ogni altra cosa.
 */

async function rawDataset(): Promise<Record<string, unknown>> {
  const { readFile } = await import('node:fs/promises');
  return JSON.parse(await readFile(DEFAULT_LESSON_DEPTH_ISOVARIANT_PATH, 'utf8'));
}

/** Copia profonda del JSON reale: i casi negativi partono da un dataset valido. */
async function mutated(
  mutate: (raw: Record<string, unknown>) => void,
): Promise<Record<string, unknown>> {
  const raw = JSON.parse(JSON.stringify(await rawDataset()));
  mutate(raw);
  return raw;
}

describe('dataset isovariante', () => {
  it('si carica dal percorso canonico e dichiara le versioni accoppiate', async () => {
    const dataset = await loadLessonDepthIsovariantDataset();
    expect(dataset.datasetVersion).toBe(LESSON_DEPTH_ISOVARIANT_DATASET_VERSION);
    expect(dataset.rubricVersion).toBe(LESSON_MANUAL_QUALITY_RUBRIC_VERSION);
    expect(dataset.extensionVersion).toBe(LESSON_TUNE_EXTENSION_VERSION);
    expect(dataset.generatedSamplesIncluded).toBe(false);
    expect(DEFAULT_LESSON_DEPTH_ISOVARIANT_PATH).toContain('lesson-depth-03-isovariant.json');
  });

  it('esplora esattamente le arità 1, 2 e 3 in ogni terna', async () => {
    const dataset = await loadLessonDepthIsovariantDataset();
    for (const triad of isovariantTriads(dataset)) {
      expect(triad.map(isovariantConceptArity)).toEqual([1, 2, 3]);
    }
  });

  it('dentro una terna cambia solo il numero di concetti chiave', async () => {
    const dataset = await loadLessonDepthIsovariantDataset();
    for (const triad of isovariantTriads(dataset)) {
      const [primo] = triad;
      for (const scenario of triad) {
        expect(scenario.titolo, scenario.id).toBe(primo!.titolo);
        expect(scenario.difficolta, scenario.id).toBe(primo!.difficolta);
        expect(scenario.obiettivi, scenario.id).toEqual(primo!.obiettivi);
        expect(scenario.udaContext, scenario.id).toEqual(primo!.udaContext);
        expect(scenario.depth, scenario.id).toBe(primo!.depth);
        expect(scenario.teacherGuidance, scenario.id).toBeNull();
      }
    }
  });

  it('i concetti chiave sono annidati come prefisso', async () => {
    const dataset = await loadLessonDepthIsovariantDataset();
    for (const triad of isovariantTriads(dataset)) {
      expect(triad[1]!.concettiChiave.slice(0, 1)).toEqual(triad[0]!.concettiChiave);
      expect(triad[2]!.concettiChiave.slice(0, 2)).toEqual(triad[1]!.concettiChiave);
    }
  });

  it('copre almeno due discipline: una terna sola non basterebbe', async () => {
    const dataset = await loadLessonDepthIsovariantDataset();
    const triads = isovariantTriads(dataset);
    expect(triads.length).toBeGreaterThanOrEqual(2);
    expect(new Set(triads.map((triad) => triad[0]!.titolo)).size).toBe(triads.length);
  });

  it('è interamente in tuning: diagnostica, non certifica', async () => {
    const { scenarios } = await loadLessonDepthIsovariantDataset();
    expect(scenarios.every((scenario) => scenario.split === 'tuning')).toBe(true);
  });

  it('resta eseguibile dal pianificatore esistente senza traduzioni', async () => {
    const dataset = await loadLessonDepthIsovariantDataset();
    const plan = buildLessonTuneExecutionPlan(dataset, 'tuning', dataset.primaryModelProfile);
    expect(plan.scenarios.length).toBe(dataset.scenarios.length);
  });
});

describe('difese del disegno', () => {
  it('rifiuta uno scenario con arità fuori posto', async () => {
    const raw = await mutated((data) => {
      const scenarios = data.scenarios as Record<string, unknown>[];
      scenarios[0]!.concettiChiave = ['macchina a vapore', 'fabbrica'];
    });
    expect(() => parseLessonDepthIsovariantDataset(raw)).toThrow(/esattamente 1 concetti/);
  });

  it('rifiuta una terna in cui cambia anche il titolo della lezione', async () => {
    const raw = await mutated((data) => {
      const scenarios = data.scenarios as Record<string, unknown>[];
      scenarios[1]!.titolo = 'Un altro argomento';
    });
    expect(() => parseLessonDepthIsovariantDataset(raw)).toThrow(/solo il numero di concetti/);
  });

  it('rifiuta una terna in cui cambiano gli obiettivi', async () => {
    const raw = await mutated((data) => {
      const scenarios = data.scenarios as Record<string, unknown>[];
      scenarios[2]!.obiettivi = ['Un obiettivo diverso dagli altri della terna'];
    });
    expect(() => parseLessonDepthIsovariantDataset(raw)).toThrow(/solo il numero di concetti/);
  });

  it('rifiuta una terna in cui cambia la profondità richiesta', async () => {
    const raw = await mutated((data) => {
      const scenarios = data.scenarios as Record<string, unknown>[];
      scenarios[2]!.depth = 'in_depth';
    });
    expect(() => parseLessonDepthIsovariantDataset(raw)).toThrow(/solo il numero di concetti/);
  });

  it('rifiuta concetti non annidati: sarebbero due variabili', async () => {
    const raw = await mutated((data) => {
      const scenarios = data.scenarios as Record<string, unknown>[];
      scenarios[1]!.concettiChiave = ['telaio meccanico', 'fabbrica'];
    });
    expect(() => parseLessonDepthIsovariantDataset(raw)).toThrow(/devono estendere/);
  });

  it('rifiuta le indicazioni docente: il caso misurato è quello povero', async () => {
    const raw = await mutated((data) => {
      const scenarios = data.scenarios as Record<string, unknown>[];
      scenarios[0]!.teacherGuidance = 'Insisti sulle cause economiche.';
    });
    expect(() => parseLessonDepthIsovariantDataset(raw)).toThrow(/indicazioni docente/);
  });

  it('rifiuta terne incomplete', async () => {
    const raw = await mutated((data) => {
      data.scenarios = (data.scenarios as unknown[]).slice(0, 5);
    });
    expect(() => parseLessonDepthIsovariantDataset(raw)).toThrow(/terne complete/);
  });

  it('rifiuta una sola terna: non distinguerebbe il prompt dalla materia', async () => {
    const raw = await mutated((data) => {
      data.scenarios = (data.scenarios as unknown[]).slice(0, 3);
    });
    expect(() => parseLessonDepthIsovariantDataset(raw)).toThrow(/almeno due terne/);
  });

  it('rifiuta lo split holdout', async () => {
    const raw = await mutated((data) => {
      const scenarios = data.scenarios as Record<string, unknown>[];
      scenarios[0]!.split = 'holdout';
    });
    expect(() => parseLessonDepthIsovariantDataset(raw)).toThrow(/holdout/);
  });

  it('rifiuta una rubrica non accoppiata', async () => {
    const raw = await mutated((data) => {
      data.rubricVersion = 'altra-rubrica-v9';
    });
    expect(() => parseLessonDepthIsovariantDataset(raw)).toThrow(/Rubrica non accoppiata/);
  });

  it('rifiuta output generati nel dataset', async () => {
    const raw = await mutated((data) => {
      data.generatedSamplesIncluded = true;
    });
    expect(() => parseLessonDepthIsovariantDataset(raw)).toThrow(/output generati/);
  });

  it('rifiuta una versione non supportata', async () => {
    const raw = await mutated((data) => {
      data.datasetVersion = 'lesson-depth-03-isovariant-v2';
    });
    expect(() => parseLessonDepthIsovariantDataset(raw)).toThrow(/non supportata/);
  });

  it('la dimensione della terna è la costante dichiarata', () => {
    expect(ISOVARIANT_TRIAD_SIZE).toBe(3);
  });
});
