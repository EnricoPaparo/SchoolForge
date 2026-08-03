import { describe, expect, it } from 'vitest';
import {
  buildLessonManualQualityExecutionPlan,
  loadLessonManualQualityDataset,
  parseLessonManualQualityDataset,
  LESSON_MANUAL_SCENARIO_CATEGORIES,
} from './lessonManualQualityBenchmark.js';

function validRawDataset(): Record<string, unknown> {
  return {
    datasetVersion: 'lesson-manual-02-scenarios-v1',
    rubricVersion: 'lesson-manual-02-rubric-v1',
    generatedSamplesIncluded: false,
    primaryModelProfile: 'economy',
    scenarios: LESSON_MANUAL_SCENARIO_CATEGORIES.map((category, index) => ({
      id: `LM02-${String(index + 1).padStart(2, '0')}`,
      category,
      titolo: `Titolo ${index + 1}`,
      sottotitolo: null,
      difficolta: `${index + 1}`,
      concettiChiave: ['Concetto'],
      obiettivi: ['Obiettivo'],
      udaTitle: 'UDA test',
      udaContext: {
        title: 'UDA test',
        currentLessonPosition: 1,
        lessons: [{ position: 1, titolo: `Titolo ${index + 1}`, sottotitolo: null }],
      },
      depth: index === 0 ? 'synthetic' : index < 4 ? 'complete' : 'in_depth',
      teacherGuidance: null,
    })),
  };
}

describe('LESSON-MANUAL-03 dataset e piano', () => {
  it('carica il dataset reale congelato con sei scenari canonici', async () => {
    const dataset = await loadLessonManualQualityDataset();
    expect(dataset.scenarios).toHaveLength(6);
    expect(dataset.scenarios.map((scenario) => scenario.category)).toEqual(
      LESSON_MANUAL_SCENARIO_CATEGORIES,
    );
    expect(dataset.generatedSamplesIncluded).toBe(false);
    expect(dataset.primaryModelProfile).toBe('economy');
  });

  it('rifiuta proprietà extra al top-level e negli scenari', () => {
    const top = { ...validRawDataset(), extra: true };
    expect(() => parseLessonManualQualityDataset(top)).toThrow(/proprietà/);

    const nested = validRawDataset();
    const scenarios = nested.scenarios as Array<Record<string, unknown>>;
    scenarios[0] = { ...scenarios[0], lessonId: 'vietato' };
    expect(() => parseLessonManualQualityDataset(nested)).toThrow(/proprietà/);
  });

  it('rifiuta versioni, profilo, campioni e numero scenari diversi', () => {
    expect(() =>
      parseLessonManualQualityDataset({
        ...validRawDataset(),
        datasetVersion: 'lesson-manual-02-scenarios-v2',
      }),
    ).toThrow(/Versione dataset/);
    expect(() =>
      parseLessonManualQualityDataset({ ...validRawDataset(), primaryModelProfile: 'quality' }),
    ).toThrow(/economy/);
    expect(() =>
      parseLessonManualQualityDataset({ ...validRawDataset(), generatedSamplesIncluded: true }),
    ).toThrow(/campioni/);
    expect(() => parseLessonManualQualityDataset({ ...validRawDataset(), scenarios: [] })).toThrow(
      /esattamente 6/,
    );
  });

  it('riusa la validazione autorevole del payload lezione', () => {
    const raw = validRawDataset();
    const scenarios = raw.scenarios as Array<Record<string, unknown>>;
    scenarios[0] = { ...scenarios[0], concettiChiave: [] };
    expect(() => parseLessonManualQualityDataset(raw)).toThrow(/almeno un elemento/);
  });

  it('costruisce un piano economy di sei chiamate e massimo dodici tentativi', () => {
    const dataset = parseLessonManualQualityDataset(validRawDataset());
    const plan = buildLessonManualQualityExecutionPlan(dataset);
    expect(plan.dryRun).toBe(true);
    expect(plan.modelProfile).toBe('economy');
    expect(plan.plannedCalls).toBe(6);
    expect(plan.maximumProviderAttempts).toBe(12);
    expect(plan.scenarios).toHaveLength(6);
    expect(plan.estimatedCostMicroUsd).toBeGreaterThan(0);
    expect(plan.costUpperBoundMicroUsd).toBeGreaterThanOrEqual(plan.estimatedCostMicroUsd);
    expect(plan.scenarios.map((scenario) => scenario.maxOutputTokens)).toEqual([
      5_000, 9_000, 9_000, 9_000, 15_000, 15_000,
    ]);
  });
});
