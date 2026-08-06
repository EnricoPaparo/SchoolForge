import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  buildLessonTuneExecutionPlan,
  buildLessonTuneRequest,
  DEFAULT_LESSON_TUNE_EXTENSION_PATH,
  loadLessonTuneDataset,
  parseLessonTuneExtension,
  selectLessonTuneScenarios,
} from './lessonTuneQualityBenchmark.js';

async function rawExtension(): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(DEFAULT_LESSON_TUNE_EXTENSION_PATH, 'utf8')) as Record<
    string,
    unknown
  >;
}

describe('LESSON-TUNE-01 dataset e piano', () => {
  it('combina senza mutarlo il dataset storico con sei scenari nuovi', async () => {
    const dataset = await loadLessonTuneDataset();
    expect(dataset.datasetVersion).toBe('lesson-tune-01-combined-v1');
    expect(dataset.baseDatasetVersion).toBe('lesson-manual-02-scenarios-v1');
    expect(dataset.extensionVersion).toBe('lesson-tune-01-extension-v1');
    expect(dataset.scenarios).toHaveLength(12);
    expect(dataset.scenarios.map((scenario) => scenario.id)).toEqual([
      'LM02-01',
      'LM02-02',
      'LM02-03',
      'LM02-04',
      'LM02-05',
      'LM02-06',
      'LT01-07',
      'LT01-08',
      'LT01-09',
      'LT01-10',
      'LT01-11',
      'LT01-12',
    ]);
  });

  it('congela otto scenari tuning e quattro holdout', async () => {
    const dataset = await loadLessonTuneDataset();
    expect(selectLessonTuneScenarios(dataset, 'tuning').map((scenario) => scenario.id)).toEqual([
      'LM02-01',
      'LM02-02',
      'LM02-03',
      'LM02-04',
      'LT01-07',
      'LT01-08',
      'LT01-09',
      'LT01-10',
    ]);
    expect(selectLessonTuneScenarios(dataset, 'holdout').map((scenario) => scenario.id)).toEqual([
      'LM02-05',
      'LM02-06',
      'LT01-11',
      'LT01-12',
    ]);
  });

  it('produce piani economici separati e un riepilogo completo', async () => {
    const dataset = await loadLessonTuneDataset();
    const all = buildLessonTuneExecutionPlan(dataset);
    const tuning = buildLessonTuneExecutionPlan(dataset, 'tuning');
    const holdout = buildLessonTuneExecutionPlan(dataset, 'holdout');
    expect(all.plannedCalls).toBe(12);
    expect(tuning.plannedCalls).toBe(8);
    expect(holdout.plannedCalls).toBe(4);
    expect(all.maximumProviderAttempts).toBe(
      tuning.maximumProviderAttempts + holdout.maximumProviderAttempts,
    );
    expect(all.estimatedCostMicroUsd).toBe(
      tuning.estimatedCostMicroUsd + holdout.estimatedCostMicroUsd,
    );
    expect(all.costUpperBoundMicroUsd).toBe(
      tuning.costUpperBoundMicroUsd + holdout.costUpperBoundMicroUsd,
    );
  });

  it('produce un piano quality separato con Luna e listino server-side accoppiato', async () => {
    const dataset = await loadLessonTuneDataset();
    const economy = buildLessonTuneExecutionPlan(dataset, 'tuning', 'economy');
    const quality = buildLessonTuneExecutionPlan(dataset, 'tuning', 'quality');
    const economyHoldout = buildLessonTuneExecutionPlan(dataset, 'holdout', 'economy');
    const qualityHoldout = buildLessonTuneExecutionPlan(dataset, 'holdout', 'quality');
    expect(quality.modelProfile).toBe('quality');
    expect(quality.model).toBe('gpt-5.6-luna');
    expect(quality.priceListVersion).toBe('v5-2026-07-20-luna-dev');
    expect(quality.plannedCalls).toBe(8);
    expect(quality.maximumProviderAttempts).toBe(economy.maximumProviderAttempts);
    expect(quality.costUpperBoundMicroUsd).toBeGreaterThan(economy.costUpperBoundMicroUsd);
    expect(qualityHoldout.modelProfile).toBe('quality');
    expect(qualityHoldout.model).toBe('gpt-5.6-luna');
    expect(qualityHoldout.priceListVersion).toBe('v5-2026-07-20-luna-dev');
    expect(qualityHoldout.plannedCalls).toBe(4);
    expect(qualityHoldout.maximumProviderAttempts).toBe(8);
    expect(qualityHoldout.estimatedCostMicroUsd).toBe(328_037);
    // STRUCTURE-IMPORT-03: il limite superiore è calcolato sui byte della
    // richiesta realmente trasmessa, e il preambolo di sicurezza della lezione
    // ora nomina anche CONTESTO_GENERALE_UDA. La stima resta invariata perché
    // gli scenari sono UDA legacy, prive dei tre campi nuovi.
    expect(qualityHoldout.costUpperBoundMicroUsd).toBe(741_512);
    expect(qualityHoldout.scenarios.map((scenario) => scenario.id)).toEqual([
      'LM02-05',
      'LM02-06',
      'LT01-11',
      'LT01-12',
    ]);
    expect(qualityHoldout.maximumProviderAttempts).toBe(economyHoldout.maximumProviderAttempts);
    expect(qualityHoldout.costUpperBoundMicroUsd).toBeGreaterThan(
      economyHoldout.costUpperBoundMicroUsd,
    );
  });

  it('costruisce richieste lezione chiuse con requestId stabile per scenario', async () => {
    const dataset = await loadLessonTuneDataset();
    const first = buildLessonTuneRequest(dataset.scenarios[0]!);
    const last = buildLessonTuneRequest(dataset.scenarios[11]!);
    expect(first.requestId).toBe('00000000-0000-4000-9000-000000000001');
    expect(last.requestId).toBe('00000000-0000-4000-9000-000000000012');
    expect(last.kind).toBe('lesson');
    expect(last.hasCurrentContent).toBe(false);
    expect(buildLessonTuneRequest(dataset.scenarios[0]!, 'quality').modelProfile).toBe('quality');
  });

  it('rifiuta proprietà extra, versioni e split modificati', async () => {
    const extra = await rawExtension();
    extra.extra = true;
    expect(() => parseLessonTuneExtension(extra)).toThrow(/proprietà/);

    const version = await rawExtension();
    version.extensionVersion = 'lesson-tune-01-extension-v2';
    expect(() => parseLessonTuneExtension(version)).toThrow(/Versione/);

    const split = await rawExtension();
    const scenarios = split.scenarios as Array<Record<string, unknown>>;
    scenarios[0]!.split = 'holdout';
    expect(() => parseLessonTuneExtension(split)).toThrow(/split non canonico/);
  });
});
