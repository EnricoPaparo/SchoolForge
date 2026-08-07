import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LESSON_DEPTH_SPARSE_PATH,
  LESSON_DEPTH_SPARSE_DATASET_VERSION,
  loadLessonDepthSparseDataset,
  parseLessonDepthSparseDataset,
  sparseConceptCount,
} from './lessonDepthSparseBenchmark.js';
import {
  buildLessonTuneExecutionPlan,
  LESSON_TUNE_EXTENSION_VERSION,
} from './lessonTuneQualityBenchmark.js';
import { LESSON_MANUAL_QUALITY_RUBRIC_VERSION } from './lessonManualQualityBenchmark.js';

/**
 * LESSON-DEPTH-02 — il dataset del caso povero.
 *
 * Serve a rispondere a una domanda che il benchmark esistente non può porre:
 * una lezione con due concetti chiave e nessuna indicazione docente esce
 * scarna? Il valore del dataset sta tutto nella sua **povertà**, quindi i test
 * difendono soprattutto quella: uno scenario che si arricchisse tornerebbe a
 * misurare il caso già coperto, e un confronto tutto verde direbbe molto meno
 * di quanto sembra.
 */

describe('dataset del caso povero', () => {
  it('si carica dal percorso canonico e dichiara le versioni accoppiate', async () => {
    const dataset = await loadLessonDepthSparseDataset();
    expect(dataset.datasetVersion).toBe(LESSON_DEPTH_SPARSE_DATASET_VERSION);
    expect(dataset.rubricVersion).toBe(LESSON_MANUAL_QUALITY_RUBRIC_VERSION);
    expect(dataset.extensionVersion).toBe(LESSON_TUNE_EXTENSION_VERSION);
    expect(dataset.generatedSamplesIncluded).toBe(false);
    expect(DEFAULT_LESSON_DEPTH_SPARSE_PATH).toContain('lesson-depth-02-sparse.json');
  });

  it('è povero per costruzione: pochi concetti, nessuna indicazione docente', async () => {
    const { scenarios } = await loadLessonDepthSparseDataset();
    expect(scenarios.length).toBeGreaterThanOrEqual(6);
    for (const scenario of scenarios) {
      expect(sparseConceptCount(scenario), scenario.id).toBeLessThanOrEqual(3);
      expect(scenario.teacherGuidance, scenario.id).toBeNull();
      expect(scenario.split).toBe('tuning');
    }
  });

  it('copre uno, due e tre concetti chiave', async () => {
    const { scenarios } = await loadLessonDepthSparseDataset();
    const counts = scenarios.map(sparseConceptCount);
    // Uno è il caso estremo, due è quello segnalato dal docente, tre la soglia.
    expect(counts).toContain(1);
    expect(counts).toContain(2);
    expect(counts).toContain(3);
  });

  it('ogni scenario è di una disciplina diversa: un solo esempio non basterebbe', async () => {
    const { scenarios } = await loadLessonDepthSparseDataset();
    const categorie = new Set(scenarios.map((s) => s.category));
    expect(categorie.size).toBe(scenarios.length);
  });

  it('include una coppia a profondità approfondita, per separare le due variabili', async () => {
    // Se tutti gli scenari fossero `complete`, un miglioramento non direbbe se
    // viene dalla nuova regola sui concetti o dal livello richiesto.
    const { scenarios } = await loadLessonDepthSparseDataset();
    expect(scenarios.some((s) => s.depth === 'in_depth')).toBe(true);
    expect(scenarios.some((s) => s.depth === 'complete')).toBe(true);
  });

  it('non contiene output generati né soluzioni: è solo input', async () => {
    const raw = JSON.parse(
      await import('node:fs/promises').then((fs) =>
        fs.readFile(DEFAULT_LESSON_DEPTH_SPARSE_PATH, 'utf8'),
      ),
    ) as Record<string, unknown>;
    const serialized = JSON.stringify(raw);
    for (const vietato of ['markdown', 'content', 'output', 'soluzione', 'generated']) {
      expect(serialized.toLowerCase()).not.toContain(`"${vietato}"`);
    }
  });
});

describe('il dataset si difende dall’arricchimento', () => {
  const base = {
    datasetVersion: LESSON_DEPTH_SPARSE_DATASET_VERSION,
    baseDatasetVersion: 'lesson-manual-02-scenarios-v1',
    rubricVersion: LESSON_MANUAL_QUALITY_RUBRIC_VERSION,
    generatedSamplesIncluded: false,
  };
  const scenario = (over: Record<string, unknown> = {}) => ({
    id: 'LD02-01',
    split: 'tuning',
    category: 'grammar_single_concept',
    titolo: 'Il complemento oggetto',
    sottotitolo: null,
    difficolta: '2 — base',
    concettiChiave: ['complemento oggetto'],
    obiettivi: ['Riconoscere il complemento oggetto'],
    udaTitle: 'Analisi logica',
    udaContext: {
      title: 'Analisi logica',
      currentLessonPosition: 1,
      lessons: [{ position: 1, titolo: 'Il complemento oggetto', sottotitolo: null }],
    },
    depth: 'complete',
    teacherGuidance: null,
    ...over,
  });

  it('rifiuta uno scenario con troppi concetti chiave', () => {
    expect(() =>
      parseLessonDepthSparseDataset({
        ...base,
        scenarios: [scenario({ concettiChiave: ['a', 'b', 'c', 'd'] })],
      }),
    ).toThrow(/tre concetti chiave/);
  });

  it('rifiuta uno scenario con le indicazioni docente compilate', () => {
    expect(() =>
      parseLessonDepthSparseDataset({
        ...base,
        scenarios: [scenario({ teacherGuidance: 'parti da un esempio' })],
      }),
    ).toThrow(/indicazioni docente/);
  });

  it('rifiuta una rubrica non accoppiata: il confronto sarebbe illeggibile', () => {
    expect(() =>
      parseLessonDepthSparseDataset({
        ...base,
        rubricVersion: 'altra-rubrica',
        scenarios: [scenario()],
      }),
    ).toThrow(/[Rr]ubrica/);
  });

  it('rifiuta output generati dentro il dataset', () => {
    expect(() =>
      parseLessonDepthSparseDataset({
        ...base,
        generatedSamplesIncluded: true,
        scenarios: [scenario()],
      }),
    ).toThrow(/output generati/);
  });

  it('rifiuta uno split holdout: qui si diagnostica, non si certifica', () => {
    expect(() =>
      parseLessonDepthSparseDataset({ ...base, scenarios: [scenario({ split: 'holdout' })] }),
    ).toThrow(/holdout/);
  });

  it('esige la copertura di uno e due concetti', () => {
    expect(() =>
      parseLessonDepthSparseDataset({
        ...base,
        scenarios: [scenario({ concettiChiave: ['solo', 'due'] })],
      }),
    ).toThrow(/almeno uno scenario con 1 concetti/);
  });
});

describe('il dataset attraversa il pianificatore esistente', () => {
  it('produce un piano eseguibile senza una macchina nuova', async () => {
    // Il valore di riusare il tipo `LessonTuneDataset` è tutto qui: il piano, il
    // runner e il calcolo dei costi sono quelli già validati.
    const dataset = await loadLessonDepthSparseDataset();
    const plan = buildLessonTuneExecutionPlan(dataset, 'tuning', 'quality');
    expect(plan.dryRun).toBe(true);
    expect(plan.plannedCalls).toBe(dataset.scenarios.length);
    expect(plan.scenarios.map((s) => s.id)).toEqual(dataset.scenarios.map((s) => s.id));
    expect(plan.estimatedCostMicroUsd).toBeGreaterThan(0);
  });

  it('il costo del ciclo resta trascurabile', async () => {
    const dataset = await loadLessonDepthSparseDataset();
    const plan = buildLessonTuneExecutionPlan(dataset, 'tuning', 'quality');
    // Sei lezioni: l'ordine di grandezza è di centesimi, non di euro. Se questo
    // limite saltasse, qualcuno ha cambiato i tetti senza accorgersene.
    expect(plan.costUpperBoundMicroUsd).toBeLessThan(1_500_000);
  });
});
