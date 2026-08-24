import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
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
  it('congela 8 tuning e 4 holdout B con sorgenti SHA-256 verificate', async () => {
    const dataset = await loadVisualQualityDataset();
    expect(selectVisualQualityScenarios(dataset, 'tuning')).toHaveLength(8);
    expect(selectVisualQualityScenarios(dataset, 'holdout')).toHaveLength(4);
    expect(
      dataset.scenarios.every((scenario) => /^[a-f0-9]{64}$/.test(scenario.sourceSha256)),
    ).toBe(true);
    expect(dataset.scenarios.every((scenario) => scenario.lessonBody.includes('\n## '))).toBe(true);
    expect(
      selectVisualQualityScenarios(dataset, 'holdout').map((scenario) => scenario.titolo),
    ).toEqual([
      'Le forbici come due leve',
      'Come i dati vengono incapsulati in rete',
      'Scegliere il registro linguistico',
      'Citare una fonte in modo responsabile',
    ]);
  });

  it('conserva byte e hash del holdout A fuori dal dataset attivo', async () => {
    const archive = new URL(
      '../../documentazione/evidenze/visual-enrichment-05a-holdout-a-sources/',
      import.meta.url,
    );
    const expected = [
      'efbfc19b1fd2b650167ddb6726733d7be314a046c1b6a74ed4c2533e667c2911',
      '008ab1cfe5b3f02757f6723a54f7c9a2fd12ebc078de986d4842184da9e75ce6',
      '289af4039894148c8ff4f9d712abeaed2c1d54c441b17e4fbe9ea130d087847f',
      '86fe81d7c2c60df7d51d61de5597f582b115e750ab02ce0ab9fe7d11030af78f',
    ];
    for (let index = 0; index < expected.length; index += 1) {
      const id = `VE05A-${String(index + 9).padStart(2, '0')}.md`;
      const bytes = await readFile(new URL(id, archive));
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(expected[index]);
    }
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
