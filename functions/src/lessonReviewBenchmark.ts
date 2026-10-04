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

export const LESSON_REVIEW_FIXTURE_PROVENANCE = {
  'candidates/lm02-01.md': [
    'tuning',
    'lesson-tune-01-tuning-2026-08-04T13-17-19-871Z',
    'lesson-tune-01-LM02-01-economy.md',
    'b4be84bc9192c5f7bf618540221f9ef5c64253112d90c824e6c0abd23d82002c',
    'b4be84bc9192c5f7bf618540221f9ef5c64253112d90c824e6c0abd23d82002c',
    ['missing_self_check_solutions'],
  ],
  'candidates/lm02-02.md': [
    'tuning',
    'lesson-tune-01-tuning-2026-08-04T13-17-19-871Z',
    'lesson-tune-01-LM02-02-economy.md',
    '9910dba8b187907b47e72d2814a5680679b1f0b99ea8cb3d8981d1d86fb4f63a',
    '9910dba8b187907b47e72d2814a5680679b1f0b99ea8cb3d8981d1d86fb4f63a',
    ['blocker_ipv4_false_causal_diagnosis', 'excess_horizontal_rules'],
  ],
  'candidates/lm02-03.md': [
    'tuning',
    'lesson-tune-01-tuning-2026-08-04T13-17-19-871Z',
    'lesson-tune-01-LM02-03-economy.md',
    '819da4eab66d3d3b4c47e2b22cfb7ba912a2895b7ffb0e29fcd3db35d382640b',
    '819da4eab66d3d3b4c47e2b22cfb7ba912a2895b7ffb0e29fcd3db35d382640b',
    ['blocker_refrigerator_heat_transfer'],
  ],
  'candidates/lm02-04.md': [
    'tuning',
    'lesson-tune-01-tuning-2026-08-04T13-17-19-871Z',
    'lesson-tune-01-LM02-04-economy.md',
    '49b4a9156d0cc8004c84c46f2cfb138afb885b19e83c11c09420a304f27400b1',
    '49b4a9156d0cc8004c84c46f2cfb138afb885b19e83c11c09420a304f27400b1',
    ['minor_parenti_typo'],
  ],
  'candidates/lt01-07.md': [
    'tuning',
    'lesson-tune-01-tuning-2026-08-04T13-17-19-871Z',
    'lesson-tune-01-LT01-07-economy.md',
    '602b78dc708b0931cdc6bfc3f2ddd33c293c1978ebdadc0f5e369c350ad857e1',
    '602b78dc708b0931cdc6bfc3f2ddd33c293c1978ebdadc0f5e369c350ad857e1',
    [],
  ],
  'candidates/lt01-08.md': [
    'tuning',
    'lesson-tune-01-tuning-2026-08-04T13-17-19-871Z',
    'lesson-tune-01-LT01-08-economy.md',
    '82fd1527bf3038c56e9579cebe9c9919ce1eaacd61d46baa573e3e2f02dbffff',
    '82fd1527bf3038c56e9579cebe9c9919ce1eaacd61d46baa573e3e2f02dbffff',
    [],
  ],
  'candidates/lt01-09.md': [
    'tuning',
    'lesson-tune-01-tuning-2026-08-04T13-17-19-871Z',
    'lesson-tune-01-LT01-09-economy.md',
    'c93775ded0bc8ae3c2fb3122e00e9648763acaee77d001ed4defd7b5d882d5a3',
    'c93775ded0bc8ae3c2fb3122e00e9648763acaee77d001ed4defd7b5d882d5a3',
    ['minor_python_nameerror_misclassified'],
  ],
  'candidates/lt01-10.md': [
    'tuning',
    'lesson-tune-01-tuning-2026-08-04T13-17-19-871Z',
    'lesson-tune-01-LT01-10-economy.md',
    'f15855faf295f8992f7199fdf46bc788ceb4f416ac77a0d1ec70a0643a5d2b54',
    'f15855faf295f8992f7199fdf46bc788ceb4f416ac77a0d1ec70a0643a5d2b54',
    ['minor_solution_callout_nesting'],
  ],
  'candidates/lm02-05.md': [
    'holdout',
    'lesson-tune-01-holdout-2026-08-15T15-15-18-593Z',
    'lesson-tune-01-LM02-05-quality.md',
    'e6d543f568f35431d68fe007119c9f47f3cc4c799887a5e1d5e1920af3d7b4b5',
    'e6d543f568f35431d68fe007119c9f47f3cc4c799887a5e1d5e1920af3d7b4b5',
    [],
  ],
  'candidates/lm02-06.md': [
    'holdout',
    'lesson-tune-01-holdout-2026-08-15T15-15-18-593Z',
    'lesson-tune-01-LM02-06-quality.md',
    '59e2dfb26ba6d428d77099117b2337710863e92db3695496ee65f5401edaf001',
    '59e2dfb26ba6d428d77099117b2337710863e92db3695496ee65f5401edaf001',
    ['minor_markdown_table_stray_pipe'],
  ],
  'candidates/lt01-11.md': [
    'holdout',
    'lesson-tune-01-holdout-2026-08-15T15-15-18-593Z',
    'lesson-tune-01-LT01-11-quality.md',
    '7a833314aa0b08c192128c090acd73f4d2c1c37c06f795b2f6b7780fef2440eb',
    '74882aef16567ae53330fd669bdde83107a298ae539d42c6f20f51e2db6868c3',
    [],
  ],
  'candidates/lt01-12.md': [
    'holdout',
    'lesson-tune-01-holdout-2026-08-15T15-15-18-593Z',
    'lesson-tune-01-LT01-12-quality.md',
    '628f5f3d0c25541f248342352bb47217ced55f80a300bc37ea811d5fe72bd6ff',
    '628f5f3d0c25541f248342352bb47217ced55f80a300bc37ea811d5fe72bd6ff',
    [],
  ],
} as const;

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
  sourceCorpusId: string;
  sourceFileName: string;
  sourceSha256: string;
  expectedDefects: string[];
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
      [
        'id',
        'split',
        'profile',
        'fixturePath',
        'candidateBodySha256',
        'sourceCorpusId',
        'sourceFileName',
        'sourceSha256',
        'expectedDefects',
        'request',
      ],
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
    const provenance =
      LESSON_REVIEW_FIXTURE_PROVENANCE[
        candidate.fixturePath as keyof typeof LESSON_REVIEW_FIXTURE_PROVENANCE
      ];
    if (!provenance) throw new Error(`${candidate.id}: fixture priva di provenienza.`);
    if (
      typeof candidate.candidateBodySha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(candidate.candidateBodySha256)
    ) {
      throw new Error(`${candidate.id}: SHA-256 non valido.`);
    }
    const [
      expectedSplit,
      expectedSourceCorpusId,
      expectedSourceFileName,
      expectedSourceSha256,
      expectedCandidateSha256,
      expectedDefects,
    ] = provenance;
    if (
      candidate.split !== expectedSplit ||
      candidate.candidateBodySha256 !== expectedCandidateSha256 ||
      candidate.sourceCorpusId !== expectedSourceCorpusId ||
      candidate.sourceFileName !== expectedSourceFileName ||
      candidate.sourceSha256 !== expectedSourceSha256 ||
      JSON.stringify(candidate.expectedDefects) !== JSON.stringify(expectedDefects)
    ) {
      throw new Error(`${candidate.id}: provenienza congelata non corrispondente.`);
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
        sourceCorpusId: sample.sourceCorpusId,
        sourceFileName: sample.sourceFileName,
        sourceSha256: sample.sourceSha256,
        expectedDefects: sample.expectedDefects,
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
