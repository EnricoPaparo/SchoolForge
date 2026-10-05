import type {
  AiContentCallables,
  AiPoolContentRequest,
  AiPoolGenerateResult,
  AiPoolReviewResult,
} from './aiContentClient.js';
import type {
  AiConceptMapCallables,
  AiConceptMapRequest,
  AiConceptMapGenerateResult,
  AiConceptMapReviewResult,
} from './aiConceptMapClient.js';
import { validateConceptMapResult } from './aiConceptMapClient.js';

export type ArtifactReviewStatus = 'disabled' | 'improved' | 'unchanged';

/** Separate stable request IDs let a completed generator replay when only review failed. */
export async function reviewPoolCandidate(
  callables: AiContentCallables,
  base: AiPoolContentRequest,
  candidate: AiPoolGenerateResult,
  requestId: string,
): Promise<AiPoolReviewResult> {
  if (!callables.previewReview || !callables.generateReview)
    throw new Error('Il revisore delle domande non è disponibile.');
  const request = {
    ...base,
    kind: 'pool_review' as const,
    requestId,
    candidateQuestions: candidate.output.questions,
  };
  await callables.previewReview(request);
  const reviewed = await callables.generateReview(request);
  if (
    reviewed.kind !== 'pool_review' ||
    !['improved', 'unchanged'].includes(reviewed.output?.reviewOutcome)
  )
    throw new Error('La revisione delle domande non è valida.');
  return reviewed.output.reviewOutcome === 'unchanged'
    ? { ...reviewed, output: { ...reviewed.output, questions: candidate.output.questions } }
    : reviewed;
}

export async function reviewMapCandidate(
  callables: AiConceptMapCallables,
  base: AiConceptMapRequest,
  candidate: AiConceptMapGenerateResult,
  requestId: string,
): Promise<AiConceptMapReviewResult> {
  if (!callables.previewReview || !callables.generateReview)
    throw new Error('Il revisore della mappa non è disponibile.');
  const request = {
    ...base,
    kind: 'concept_map_review' as const,
    requestId,
    candidateMarkdown: candidate.output.conceptMapMarkdown,
  };
  await callables.previewReview(request);
  const reviewed = await callables.generateReview(request);
  if (
    reviewed.kind !== 'concept_map_review' ||
    typeof reviewed.output?.sourceIssue !== 'boolean' ||
    !['improved', 'unchanged'].includes(reviewed.output.reviewOutcome)
  )
    throw new Error('La revisione della mappa non è valida.');
  if (reviewed.output.sourceIssue)
    throw Object.assign(new Error('source_issue'), { details: { code: 'source_issue' } });
  const final =
    reviewed.output.reviewOutcome === 'unchanged'
      ? {
          ...reviewed,
          output: { ...reviewed.output, conceptMapMarkdown: candidate.output.conceptMapMarkdown },
        }
      : reviewed;
  const validation = validateConceptMapResult({ ...final, kind: 'concept_map' });
  if (!validation.ok) throw new Error(validation.error);
  return final;
}
