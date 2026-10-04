import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
  computeInputHash,
  resolveContentModelForRequest,
  validateAiContentRequest,
  type LessonReviewRequest,
} from './aiContentCore.js';
import { estimateContentCost } from './aiContentCost.js';
import { AI_LESSON_REVIEW_PROMPT_VERSION } from './aiContentPrompt.js';
import type { ModelProfile } from './aiCorrectionModelProfile.js';

export const LESSON_REVIEW_BENCHMARK_VERSION = 'lesson-review-benchmark-v2' as const;
export const LESSON_REVIEW_DATASET_VERSION = 'lesson-review-frozen-01-v1' as const;
export const LESSON_REVIEW_RUBRIC_VERSION = 'lesson-manual-02-rubric-v1' as const;
export const LESSON_REVIEW_SPLITS = ['tuning', 'holdout'] as const;
export const LESSON_REVIEW_PROFILES = ['economy', 'quality'] as const;
export type LessonReviewSplit = (typeof LESSON_REVIEW_SPLITS)[number];

const REQUEST_KEYS = [
  'kind',
  'requestId',
  'modelProfile',
  'teacherGuidance',
  'depth',
  'titolo',
  'sottotitolo',
  'difficolta',
  'concettiChiave',
  'obiettivi',
  'udaTitle',
  'udaContext',
] as const;

export interface RawLessonReviewSample {
  id: string;
  split: LessonReviewSplit;
  profile: ModelProfile;
  fixturePath: string;
  candidateBodySha256: string;
  request: Record<string, unknown>;
}

export interface RawLessonReviewManifest {
  version: typeof LESSON_REVIEW_BENCHMARK_VERSION;
  dataset: typeof LESSON_REVIEW_DATASET_VERSION;
  rubric: typeof LESSON_REVIEW_RUBRIC_VERSION;
  samples: RawLessonReviewSample[];
}

export type LoadedLessonReviewSample = Omit<RawLessonReviewSample, 'request'> & {
  request: LessonReviewRequest;
};

export interface LoadedLessonReviewManifest {
  version: typeof LESSON_REVIEW_BENCHMARK_VERSION;
  dataset: typeof LESSON_REVIEW_DATASET_VERSION;
  rubric: typeof LESSON_REVIEW_RUBRIC_VERSION;
  manifestHash: string;
  samples: LoadedLessonReviewSample[];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertExactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
): void {
  const keys = Object.keys(value);
  if (keys.length !== allowed.length || keys.some((key) => !allowed.includes(key))) {
    throw new Error(`${label}: proprietà mancanti o non ammesse.`);
  }
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function assertPathSafe(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !/^candidates\/[a-z0-9][a-z0-9-]*\.md$/.test(value)) {
    throw new Error(`${label}: percorso fixture non valido.`);
  }
}

export function parseLessonReviewManifestStructure(value: unknown): RawLessonReviewManifest {
  if (!isObject(value)) throw new Error('Manifest benchmark lesson review non valido.');
  assertExactKeys(value, ['version', 'dataset', 'rubric', 'samples'], 'Manifest');
  if (value.version !== LESSON_REVIEW_BENCHMARK_VERSION) throw new Error('Versione non valida.');
  if (value.dataset !== LESSON_REVIEW_DATASET_VERSION) throw new Error('Dataset non valido.');
  if (value.rubric !== LESSON_REVIEW_RUBRIC_VERSION) throw new Error('Rubrica non valida.');
  if (!Array.isArray(value.samples) || value.samples.length !== 24) {
    throw new Error('Il manifest deve dichiarare 24 sample (12 per profilo).');
  }
  const samples = value.samples.map((candidate, index): RawLessonReviewSample => {
    if (!isObject(candidate)) throw new Error(`Sample ${index + 1} non valido.`);
    assertExactKeys(
      candidate,
      ['id', 'split', 'profile', 'fixturePath', 'candidateBodySha256', 'request'],
      `Sample ${index + 1}`,
    );
    if (
      typeof candidate.id !== 'string' ||
      !/^lr-(economy|quality)-(tuning|holdout)-[a-z0-9][a-z0-9-]*$/.test(candidate.id)
    ) {
      throw new Error(`Sample ${index + 1}: id non path-safe.`);
    }
    if (!LESSON_REVIEW_SPLITS.includes(candidate.split as LessonReviewSplit))
      throw new Error(`${candidate.id}: split non valido.`);
    if (!LESSON_REVIEW_PROFILES.includes(candidate.profile as ModelProfile))
      throw new Error(`${candidate.id}: profilo non valido.`);
    if (!candidate.id.startsWith(`lr-${String(candidate.profile)}-${String(candidate.split)}-`)) {
      throw new Error(`${candidate.id}: id incoerente con split/profilo.`);
    }
    assertPathSafe(candidate.fixturePath, candidate.id);
    if (
      typeof candidate.candidateBodySha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(candidate.candidateBodySha256)
    ) {
      throw new Error(`${candidate.id}: SHA-256 non valido.`);
    }
    if (!isObject(candidate.request)) throw new Error(`${candidate.id}: richiesta non valida.`);
    assertExactKeys(candidate.request, REQUEST_KEYS, `${candidate.id} richiesta`);
    return candidate as unknown as RawLessonReviewSample;
  });
  if (new Set(samples.map((sample) => sample.id)).size !== samples.length)
    throw new Error('Gli ID dei sample devono essere univoci.');
  for (const profile of LESSON_REVIEW_PROFILES) {
    if (
      samples.filter((sample) => sample.profile === profile && sample.split === 'tuning').length !==
      8
    )
      throw new Error(`${profile}: servono 8 sample tuning.`);
    if (
      samples.filter((sample) => sample.profile === profile && sample.split === 'holdout')
        .length !== 4
    )
      throw new Error(`${profile}: servono 4 sample holdout.`);
  }
  return {
    version: LESSON_REVIEW_BENCHMARK_VERSION,
    dataset: LESSON_REVIEW_DATASET_VERSION,
    rubric: LESSON_REVIEW_RUBRIC_VERSION,
    samples,
  };
}

export async function loadLessonReviewManifest(path: string): Promise<LoadedLessonReviewManifest> {
  const rawText = await readFile(path, 'utf8');
  const raw = parseLessonReviewManifestStructure(JSON.parse(rawText) as unknown);
  const manifestDirectory = dirname(path);
  const samples = await Promise.all(
    raw.samples.map(async (sample): Promise<LoadedLessonReviewSample> => {
      const candidateBody = await readFile(resolve(manifestDirectory, sample.fixturePath), 'utf8');
      if (sha256(candidateBody) !== sample.candidateBodySha256)
        throw new Error(`${sample.id}: hash della fixture non corrispondente.`);
      const request = validateAiContentRequest({ ...sample.request, candidateBody });
      if (request.kind !== 'lesson_review') throw new Error(`${sample.id}: kind non valido.`);
      if (request.modelProfile !== sample.profile)
        throw new Error(`${sample.id}: profilo incoerente con la richiesta.`);
      return { ...sample, request };
    }),
  );
  if (new Set(samples.map((sample) => sample.request.requestId)).size !== samples.length) {
    throw new Error('Le requestId congelate devono essere univoche.');
  }
  for (const split of LESSON_REVIEW_SPLITS) {
    const corpus = (profile: ModelProfile) =>
      samples
        .filter((sample) => sample.profile === profile && sample.split === split)
        .map((sample) => `${sample.fixturePath}:${sample.candidateBodySha256}`)
        .sort();
    const economyCorpus = corpus('economy');
    const qualityCorpus = corpus('quality');
    if (new Set(economyCorpus).size !== economyCorpus.length) {
      throw new Error(`${split}: il corpus contiene fixture duplicate.`);
    }
    if (JSON.stringify(economyCorpus) !== JSON.stringify(qualityCorpus))
      throw new Error(`${split}: i profili devono usare lo stesso corpus congelato.`);
  }
  return { ...raw, manifestHash: sha256(rawText), samples };
}

export function buildLessonReviewPlan(
  manifest: LoadedLessonReviewManifest,
  selection: { split: LessonReviewSplit; profile: ModelProfile },
) {
  const samples = manifest.samples
    .filter((sample) => sample.split === selection.split && sample.profile === selection.profile)
    .map((sample) => {
      const resolved = resolveContentModelForRequest(sample.request);
      const cost = estimateContentCost(
        sample.request,
        resolved.model,
        resolved.priceListVersion,
        1,
      );
      return {
        id: sample.id,
        split: sample.split,
        profile: sample.profile,
        fixturePath: sample.fixturePath,
        candidateBodySha256: sample.candidateBodySha256,
        request: sample.request,
        inputHash: computeInputHash(sample.request),
        ...resolved,
        estimatedCostMicroUsd: cost.estimatedCostMicroUsd,
        costUpperBoundMicroUsd: cost.reservationCostMicroUsd,
      };
    });
  const expected = selection.split === 'tuning' ? 8 : 4;
  if (samples.length !== expected) throw new Error('Lotto benchmark incompleto.');
  return {
    dryRun: true as const,
    version: manifest.version,
    dataset: manifest.dataset,
    rubric: manifest.rubric,
    manifestHash: manifest.manifestHash,
    promptContractVersion: AI_LESSON_REVIEW_PROMPT_VERSION,
    split: selection.split,
    profile: selection.profile,
    plannedCalls: samples.length,
    maximumProviderAttempts: 1 as const,
    estimatedCostMicroUsd: samples.reduce((n, sample) => n + sample.estimatedCostMicroUsd, 0),
    costUpperBoundMicroUsd: samples.reduce((n, sample) => n + sample.costUpperBoundMicroUsd, 0),
    samples,
  };
}

export type PlannedLessonReview = ReturnType<typeof buildLessonReviewPlan>['samples'][number];
