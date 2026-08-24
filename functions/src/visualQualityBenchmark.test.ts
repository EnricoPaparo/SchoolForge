import { describe, expect, it } from 'vitest';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DEFAULT_VISUAL_QUALITY_DATASET_PATH,
  DEFAULT_VISUAL_QUALITY_SOURCES_DIR,
  VISUAL_IMAGE_RUBRIC_DIMENSIONS,
  VISUAL_PROPOSAL_RUBRIC_DIMENSIONS,
  benchmarkVerdict,
  buildVisualQualityExecutionPlan,
  loadVisualQualityDataset,
  selectVisualQualityScenarios,
} from './visualQualityBenchmark.js';
import { MAX_VISUAL_BYTES } from './aiContentVisualProposal.js';

describe('VISUAL-ENRICHMENT-05A dataset e piano', () => {
  it('congela 8 tuning e 4 holdout con sorgenti SHA-256 verificate', async () => {
    const dataset = await loadVisualQualityDataset();
    expect(selectVisualQualityScenarios(dataset, 'tuning')).toHaveLength(8);
    expect(selectVisualQualityScenarios(dataset, 'holdout')).toHaveLength(4);
    expect(
      dataset.scenarios.every((scenario) => /^[a-f0-9]{64}$/.test(scenario.sourceSha256)),
    ).toBe(true);
    expect(dataset.scenarios.every((scenario) => scenario.lessonBody.includes('\n## '))).toBe(true);
  });

  it('non espone gli scenari holdout al tuning', async () => {
    const tuning = selectVisualQualityScenarios(await loadVisualQualityDataset(), 'tuning');
    expect(tuning.every((scenario) => scenario.split === 'tuning')).toBe(true);
    expect(tuning.some((scenario) => scenario.id === 'VE05A-09')).toBe(false);
  });

  it('rifiuta una sorgente mutata rispetto allo SHA-256 congelato', async () => {
    const root = await mkdtemp(join(tmpdir(), 've05a-'));
    const datasetPath = join(root, 'dataset.json');
    const sourcesDir = join(root, 'sources');
    try {
      await writeFile(datasetPath, await readFile(DEFAULT_VISUAL_QUALITY_DATASET_PATH));
      await cp(DEFAULT_VISUAL_QUALITY_SOURCES_DIR, sourcesDir, { recursive: true });
      await writeFile(join(sourcesDir, 'VE05A-01.md'), '# sorgente mutata\n');
      await expect(loadVisualQualityDataset(datasetPath, sourcesDir)).rejects.toThrow(
        /sorgente mutata/,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('usa rubriche separate 6+10 e calcola chiamate/costi dai contratti runtime', async () => {
    expect(VISUAL_PROPOSAL_RUBRIC_DIMENSIONS).toHaveLength(6);
    expect(VISUAL_IMAGE_RUBRIC_DIMENSIONS).toHaveLength(10);
    const plan = buildVisualQualityExecutionPlan(await loadVisualQualityDataset(), 'tuning');
    expect(plan.maximumProviderCalls).toBe(16);
    expect(plan.maximumProviderAttempts).toBeGreaterThanOrEqual(16);
    expect(plan.costUpperBoundMicroUsd).toBeGreaterThan(plan.estimatedCostMicroUsd);
    expect(plan.imageCostUpperBoundMicroUsd).toBeGreaterThan(0);
  });

  it('non dichiara PASS per report incompleto, blocker o astensione nulla', () => {
    expect(
      benchmarkVerdict({
        complete: false,
        blockers: [],
        proposalScores: [],
        imageScores: [],
        noneRate: null,
      }),
    ).toBe('REVIEW');
    expect(
      benchmarkVerdict({
        complete: true,
        blockers: ['errore_concettuale'],
        proposalScores: [4],
        imageScores: [4],
        noneRate: 0.25,
      }),
    ).toBe('REVIEW');
    expect(
      benchmarkVerdict({
        complete: true,
        blockers: [],
        proposalScores: [4],
        imageScores: [4],
        noneRate: 0,
      }),
    ).toBe('REVIEW');
  });

  it('riusa il cap runtime di 204.800 byte', () => {
    expect(MAX_VISUAL_BYTES).toBe(204_800);
  });
});
