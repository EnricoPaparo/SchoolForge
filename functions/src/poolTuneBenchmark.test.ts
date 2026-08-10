import { describe, expect, it } from 'vitest';
import { AI_POOL_PROMPT_VERSION, buildPoolPrompt } from './aiContentPrompt.js';
import {
  POOL_TUNE_BLOCKERS,
  POOL_TUNE_DATASET_VERSION,
  POOL_TUNE_PROFILE_PROBE_IDS,
  POOL_TUNE_RUBRIC_DIMENSIONS,
  POOL_TUNE_RUBRIC_VERSION,
  buildPoolTuneExecutionPlan,
  buildPoolTuneRequest,
  loadPoolTuneDataset,
  selectPoolTuneRuns,
} from './poolTuneBenchmark.js';

describe('POOL-TUNE-00 — dataset congelato', () => {
  it('carica 12 fonti reali con 8 tuning e 4 holdout', async () => {
    const dataset = await loadPoolTuneDataset();
    expect(dataset.datasetVersion).toBe(POOL_TUNE_DATASET_VERSION);
    expect(dataset.rubricVersion).toBe(POOL_TUNE_RUBRIC_VERSION);
    expect(dataset.generatedSamplesIncluded).toBe(false);
    expect(dataset.scenarios).toHaveLength(12);
    expect(dataset.scenarios.filter((scenario) => scenario.split === 'tuning')).toHaveLength(8);
    expect(dataset.scenarios.filter((scenario) => scenario.split === 'holdout')).toHaveLength(4);
  });

  it('congela id, file, hash e categorie senza duplicati', async () => {
    const dataset = await loadPoolTuneDataset();
    expect(dataset.scenarios.map((scenario) => scenario.id)).toEqual(
      Array.from({ length: 12 }, (_, index) => `PT00-${String(index + 1).padStart(2, '0')}`),
    );
    expect(new Set(dataset.scenarios.map((scenario) => scenario.sourceFile)).size).toBe(12);
    expect(new Set(dataset.scenarios.map((scenario) => scenario.sourceSha256)).size).toBe(12);
    expect(new Set(dataset.scenarios.map((scenario) => scenario.category)).size).toBe(12);
  });

  it('usa sorgenti sostanziali, UTF-8 e sotto il cap applicativo', async () => {
    const dataset = await loadPoolTuneDataset();
    for (const scenario of dataset.scenarios) {
      expect(Buffer.byteLength(scenario.lessonSource, 'utf8')).toBeGreaterThan(5_000);
      expect(Buffer.byteLength(scenario.lessonSource, 'utf8')).toBeLessThanOrEqual(200_000);
      expect(scenario.lessonSource).not.toContain('\uFFFD');
    }
  });

  it('copre teoria, diagnosi, esercizi, misconcezioni e ragionamento', async () => {
    const categories = (await loadPoolTuneDataset()).scenarios.map((scenario) => scenario.category);
    expect(categories).toEqual(
      expect.arrayContaining([
        'introductory_theory',
        'technical_diagnosis',
        'worked_mathematics',
        'historical_source_reasoning',
        'misconception_correction',
        'programming_debugging',
        'argumentative_reasoning',
        'stoichiometric_problem',
      ]),
    );
  });

  it('ogni scenario ha bersagli di copertura e ragionamento separati dal prompt', async () => {
    const dataset = await loadPoolTuneDataset();
    for (const scenario of dataset.scenarios) {
      expect(scenario.coverageTargets.length).toBeGreaterThanOrEqual(4);
      expect(scenario.reasoningTargets.length).toBeGreaterThanOrEqual(2);
      const request = buildPoolTuneRequest(scenario, 'quality');
      const serializedRequest = JSON.stringify(request);
      for (const target of [...scenario.coverageTargets, ...scenario.reasoningTargets]) {
        // I target sono l'oracolo della valutazione, non suggerimenti al modello.
        if (!scenario.lessonSource.includes(target))
          expect(serializedRequest).not.toContain(target);
      }
    }
  });

  it('attraversa il validatore reale per entrambi i profili', async () => {
    const dataset = await loadPoolTuneDataset();
    for (const scenario of dataset.scenarios) {
      for (const profile of ['economy', 'quality'] as const) {
        const request = buildPoolTuneRequest(scenario, profile);
        expect(request.kind).toBe('pool');
        expect(request.modelProfile).toBe(profile);
        expect(request.existingPoolQuestionCount).toBe(0);
        expect(request.lessonSource).toBe(scenario.lessonSource);
      }
    }
  });

  it('copre tutti i livelli e tutti i tipi di domanda in ogni scenario', async () => {
    const dataset = await loadPoolTuneDataset();
    expect(new Set(dataset.scenarios.map((scenario) => scenario.level))).toEqual(
      new Set(['base', 'balanced', 'advanced']),
    );
    for (const scenario of dataset.scenarios) {
      expect(scenario.counts.aperta).toBeGreaterThan(0);
      expect(scenario.counts.chiusa_singola).toBeGreaterThan(0);
      expect(scenario.counts.chiusa_multipla).toBeGreaterThan(0);
    }
  });
});

describe('POOL-TUNE-00 — disegno sperimentale', () => {
  it('il profile probe accoppia economy e quality sugli stessi quattro scenari', async () => {
    const dataset = await loadPoolTuneDataset();
    const runs = selectPoolTuneRuns(dataset, 'profile_probe');
    expect(runs).toHaveLength(8);
    expect(runs.map((run) => run.scenario.id)).toEqual(
      POOL_TUNE_PROFILE_PROBE_IDS.flatMap((id) => [id, id]),
    );
    for (let index = 0; index < runs.length; index += 2) {
      expect(runs[index]?.scenario).toBe(runs[index + 1]?.scenario);
      expect([runs[index]?.modelProfile, runs[index + 1]?.modelProfile]).toEqual([
        'economy',
        'quality',
      ]);
    }
  });

  it('tuning non espone mai l’holdout e holdout non riusa il tuning', async () => {
    const dataset = await loadPoolTuneDataset();
    const tuning = selectPoolTuneRuns(dataset, 'tuning', 'quality');
    const holdout = selectPoolTuneRuns(dataset, 'holdout', 'quality');
    expect(tuning).toHaveLength(8);
    expect(holdout).toHaveLength(4);
    expect(tuning.every((run) => run.scenario.split === 'tuning')).toBe(true);
    expect(holdout.every((run) => run.scenario.split === 'holdout')).toBe(true);
    expect(new Set(tuning.map((run) => run.scenario.id))).not.toEqual(
      new Set(holdout.map((run) => run.scenario.id)),
    );
  });

  it('produce piani dry-run con costi, tentativi e conteggi verificabili', async () => {
    const dataset = await loadPoolTuneDataset();
    for (const [phase, calls] of [
      ['profile_probe', 8],
      ['tuning', 8],
      ['holdout', 4],
    ] as const) {
      const plan = buildPoolTuneExecutionPlan(dataset, phase, 'quality');
      expect(plan.dryRun).toBe(true);
      expect(plan.plannedCalls).toBe(calls);
      expect(plan.maximumProviderAttempts).toBeGreaterThanOrEqual(calls);
      expect(plan.estimatedCostMicroUsd).toBeGreaterThan(0);
      expect(plan.costUpperBoundMicroUsd).toBeGreaterThanOrEqual(plan.estimatedCostMicroUsd);
      expect(plan.scenarios.every((scenario) => scenario.totalQuestions >= 6)).toBe(true);
    }
  });

  it('congela una rubrica a dieci dimensioni e blocker espliciti', () => {
    expect(POOL_TUNE_RUBRIC_DIMENSIONS).toHaveLength(10);
    expect(new Set(POOL_TUNE_RUBRIC_DIMENSIONS).size).toBe(10);
    expect(POOL_TUNE_BLOCKERS).toContain('risposta_corretta_errata');
    expect(POOL_TUNE_BLOCKERS).toContain('soluzione_aperta_materialmente_incompleta');
    expect(POOL_TUNE_BLOCKERS).toContain('riferimento_alla_posizione_nella_lezione');
  });

  it('non modifica il prompt e usa la versione attualmente congelata', async () => {
    const request = buildPoolTuneRequest((await loadPoolTuneDataset()).scenarios[0]!, 'quality');
    const prompt = buildPoolPrompt(request);
    expect(AI_POOL_PROMPT_VERSION).toBe('aigen-prompt-01-pool-v1');
    expect(prompt.user).toContain('MATERIALE_LEZIONE');
    expect(prompt.user).toContain(request.lessonSource);
  });
});
