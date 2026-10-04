import { readFile } from 'node:fs/promises';
import {
  validateAiContentRequest,
  resolveContentModelForRequest,
  type LessonReviewRequest,
} from './aiContentCore.js';
import { estimateContentCost } from './aiContentCost.js';

export const LESSON_REVIEW_BENCHMARK_VERSION = 'lesson-review-benchmark-v1' as const;
export interface LessonReviewBenchmarkManifest {
  version: typeof LESSON_REVIEW_BENCHMARK_VERSION;
  samples: Array<{ id: string; request: unknown }>;
}

export async function loadLessonReviewManifest(
  path: string,
): Promise<LessonReviewBenchmarkManifest> {
  const raw = JSON.parse(await readFile(path, 'utf8')) as LessonReviewBenchmarkManifest;
  if (
    raw.version !== LESSON_REVIEW_BENCHMARK_VERSION ||
    !Array.isArray(raw.samples) ||
    raw.samples.length === 0
  ) {
    throw new Error('Manifest benchmark lesson review non valido.');
  }
  return raw;
}

export function buildLessonReviewPlan(manifest: LessonReviewBenchmarkManifest) {
  const samples = manifest.samples.map(({ id, request: value }) => {
    const request = validateAiContentRequest(value);
    if (request.kind !== 'lesson_review') throw new Error(`${id}: kind non valido.`);
    const resolved = resolveContentModelForRequest(request);
    const cost = estimateContentCost(request, resolved.model, resolved.priceListVersion, 1);
    return {
      id,
      request,
      ...resolved,
      estimatedCostMicroUsd: cost.estimatedCostMicroUsd,
      costUpperBoundMicroUsd: cost.reservationCostMicroUsd,
    };
  });
  return {
    dryRun: true as const,
    version: manifest.version,
    plannedCalls: samples.length,
    estimatedCostMicroUsd: samples.reduce((n, s) => n + s.estimatedCostMicroUsd, 0),
    costUpperBoundMicroUsd: samples.reduce((n, s) => n + s.costUpperBoundMicroUsd, 0),
    samples,
  };
}

export type PlannedLessonReview = ReturnType<typeof buildLessonReviewPlan>['samples'][number] & {
  request: LessonReviewRequest;
};
