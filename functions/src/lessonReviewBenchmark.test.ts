import { cp, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  buildLessonReviewPlan,
  loadLessonReviewManifest,
  parseLessonReviewManifestStructure,
} from './lessonReviewBenchmark.js';

const manifestPath = fileURLToPath(
  new URL(
    '../../documentazione/evidenze/lesson-review-benchmark-v1/manifest.json',
    import.meta.url,
  ),
);
const candidatesPath = fileURLToPath(
  new URL('../../documentazione/evidenze/lesson-review-benchmark-v1/candidates/', import.meta.url),
);

describe('lesson review frozen benchmark', () => {
  it('loads the hashed corpus and builds four independently capped batches', async () => {
    const manifest = await loadLessonReviewManifest(manifestPath);
    const batches = [
      buildLessonReviewPlan(manifest, { split: 'tuning', profile: 'economy' }),
      buildLessonReviewPlan(manifest, { split: 'holdout', profile: 'economy' }),
      buildLessonReviewPlan(manifest, { split: 'tuning', profile: 'quality' }),
      buildLessonReviewPlan(manifest, { split: 'holdout', profile: 'quality' }),
    ];
    expect(batches.map((batch) => batch.plannedCalls)).toEqual([8, 4, 8, 4]);
    expect(batches.every((batch) => batch.maximumProviderAttempts === 1)).toBe(true);
    expect(batches.every((batch) => batch.costUpperBoundMicroUsd > 0)).toBe(true);
    expect(batches[0]?.samples.every((sample) => sample.model === 'gpt-5.6-luna')).toBe(true);
    expect(batches[2]?.samples.every((sample) => sample.model === 'gpt-6.1-sol')).toBe(true);
    expect(batches[0]?.manifestHash).toMatch(/^[a-f0-9]{64}$/);
    expect(batches[0]?.samples[0]?.inputHash).toMatch(/^[a-f0-9]{64}$/);
    const tuning = manifest.samples.filter((sample) => sample.split === 'tuning');
    expect(tuning).toHaveLength(16);
    expect(
      tuning.every(
        (sample) =>
          sample.sourceCorpusId === 'lesson-tune-01-tuning-2026-08-04T13-17-19-871Z' &&
          sample.sourceFileName.endsWith('-economy.md') &&
          sample.sourceSha256 === sample.candidateBodySha256,
      ),
    ).toBe(true);
    expect(
      tuning.find((sample) => sample.id === 'lr-economy-tuning-lm02-02')?.expectedDefects,
    ).toContain('blocker_ipv4_false_causal_diagnosis');
    expect(
      tuning.find((sample) => sample.id === 'lr-economy-tuning-lm02-03')?.expectedDefects,
    ).toContain('blocker_refrigerator_heat_transfer');
    expect(
      tuning.find((sample) => sample.id === 'lr-economy-tuning-lt01-09')?.expectedDefects,
    ).toContain('minor_python_nameerror_misclassified');
  });

  it('rejects unknown keys and duplicate IDs before reading any fixture', async () => {
    const raw = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>;
    expect(() => parseLessonReviewManifestStructure({ ...raw, extra: true })).toThrow(/proprietà/);
    const samples = structuredClone(raw.samples) as Array<Record<string, unknown>>;
    samples[1]!.id = samples[0]!.id;
    expect(() => parseLessonReviewManifestStructure({ ...raw, samples })).toThrow(/univoci/);
    const provenanceTampered = structuredClone(raw.samples) as Array<Record<string, unknown>>;
    provenanceTampered[0]!.sourceSha256 = '0'.repeat(64);
    expect(() =>
      parseLessonReviewManifestStructure({ ...raw, samples: provenanceTampered }),
    ).toThrow(/provenienza congelata/);
  });

  it('rejects a candidate whose frozen SHA-256 does not match', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'lesson-review-manifest-'));
    await cp(candidatesPath, join(directory, 'candidates'), { recursive: true });
    const raw = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>;
    await writeFile(join(directory, 'candidates', 'lm02-01.md'), 'fixture alterata', 'utf8');
    const corruptedPath = join(directory, 'manifest.json');
    await writeFile(corruptedPath, JSON.stringify(raw), 'utf8');
    await expect(loadLessonReviewManifest(corruptedPath)).rejects.toThrow(/hash/);
  });
});
