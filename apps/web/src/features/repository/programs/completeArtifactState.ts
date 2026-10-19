import { validatePoolCoverage } from '@schoolforge/lesson-contract';
import { type PoolCounts, type PoolLevel } from '../pools/aiContentClient.js';
import type {
  AiPoolGenerateResult,
  AiPoolReviewResult,
  AiProposalQuestion,
} from '../pools/aiContentClient.js';
import type {
  AiConceptMapGenerateResult,
  AiConceptMapReviewResult,
} from '../pools/aiConceptMapClient.js';
import { validateConceptMapResult } from '../pools/aiConceptMapClient.js';
import { buildPoolFromProposal, proposalToLocalQuestions } from '../pools/aiPoolMapper.js';

export interface ArtifactState<Base, Review> {
  base: Base | null;
  reviewed: Review | null;
  costUnknown: boolean;
}
export type MapArtifactState = ArtifactState<AiConceptMapGenerateResult, AiConceptMapReviewResult>;
export type PoolArtifactState = ArtifactState<AiPoolGenerateResult, AiPoolReviewResult>;
export const emptyArtifactState = () => ({ base: null, reviewed: null, costUnknown: false });

/** Bounded canonical whitelist. No prompts, raw responses, source body, feedback or private metadata. */
export function parseArtifactState(
  raw: unknown,
  kind: 'map',
  expected?: { counts: PoolCounts; level: PoolLevel; modelProfile?: string },
): MapArtifactState;
export function parseArtifactState(
  raw: unknown,
  kind: 'pool',
  expected?: { counts: PoolCounts; level: PoolLevel; modelProfile?: string },
): PoolArtifactState;
export function parseArtifactState(
  raw: unknown,
  kind: 'map' | 'pool',
  expected?: { counts: PoolCounts; level: PoolLevel; modelProfile?: string },
): MapArtifactState | PoolArtifactState {
  if (
    !raw ||
    typeof raw !== 'object' ||
    new TextEncoder().encode(JSON.stringify(raw)).length > 700000
  )
    throw new Error('Checkpoint artefatto non valido.');
  const state = raw as MapArtifactState | PoolArtifactState;
  if (typeof state.costUnknown !== 'boolean' || (state.reviewed && !state.base))
    throw new Error('Checkpoint artefatto incoerente.');
  function result(
    value:
      | MapArtifactState['base']
      | MapArtifactState['reviewed']
      | PoolArtifactState['base']
      | PoolArtifactState['reviewed'],
    review: boolean,
  ) {
    if (value === null) return null;
    const expectedKind =
      kind === 'map'
        ? review
          ? 'concept_map_review'
          : 'concept_map'
        : review
          ? 'pool_review'
          : 'pool';
    if (
      !value ||
      value.kind !== expectedKind ||
      value.status !== 'completed' ||
      !['economy', 'quality'].includes(value.modelProfile) ||
      (expected?.modelProfile !== undefined && value.modelProfile !== expected.modelProfile) ||
      (value.actualCostMicroUsd !== null &&
        (!Number.isSafeInteger(value.actualCostMicroUsd) || value.actualCostMicroUsd < 0))
    )
      throw new Error('Risultato artefatto non valido.');
    let output: Record<string, unknown>;
    if (kind === 'map') {
      if (!('conceptMapMarkdown' in value.output)) throw new Error('Output mappa mancante.');
      const validation = validateConceptMapResult({
        ...value,
        kind: 'concept_map',
        output: { conceptMapMarkdown: value.output.conceptMapMarkdown },
      });
      if (!validation.ok) throw new Error(validation.error);
      output = { conceptMapMarkdown: validation.conceptMapMarkdown };
    } else {
      if (!('questions' in value.output) || !Array.isArray(value.output.questions))
        throw new Error('Domande mancanti.');
      const questions = value.output.questions.map(
        (q: AiProposalQuestion): AiProposalQuestion => ({
          order: q.order,
          testo: q.testo,
          difficolta: q.difficolta,
          ...(q.tipo === 'aperta'
            ? { tipo: 'aperta' as const, soluzione: q.soluzione }
            : { tipo: q.tipo, opzioni: [...q.opzioni], soluzioneIndici: [...q.soluzioneIndici] }),
        }),
      );
      const mapped = buildPoolFromProposal(null, proposalToLocalQuestions({ questions }));
      if (!mapped.ok || !questions.length || questions.length > 30)
        throw new Error('Domande checkpoint non valide.');
      if (expected) {
        const range = {
          base: { min: 1, max: 3 },
          balanced: { min: 1, max: 5 },
          advanced: { min: 3, max: 5 },
        }[expected.level];
        if (
          questions.some(
            (q, i) => q.order !== i || q.difficolta < range.min || q.difficolta > range.max,
          ) ||
          Object.entries(expected.counts).some(
            ([type, count]) => questions.filter((q) => q.tipo === type).length !== count,
          )
        )
          throw new Error('Conteggi o livello checkpoint non validi.');
      }
      output = {
        questions,
        ...(value.output.coverageSummary === undefined
          ? {}
          : {
              coverageSummary: validatePoolCoverage(value.output.coverageSummary, questions.length),
            }),
      };
    }
    if (review) {
      const reviewed = value.output as AiPoolReviewResult['output'];
      const allowedCodes =
        kind === 'map'
          ? [
              'unsupported_content',
              'incorrect_relation',
              'missing_relation',
              'misleading_simplification',
              'accessibility',
            ]
          : [
              'unsupported_content',
              'duplicate',
              'ambiguity',
              'incomplete_solution',
              'incorrect_solution',
              'weak_distractor',
              'coverage',
              'difficulty',
            ];
      if (
        !['improved', 'unchanged'].includes(reviewed.reviewOutcome) ||
        !Array.isArray(reviewed.issueCodes) ||
        reviewed.issueCodes.length > 20 ||
        reviewed.issueCodes.some((code) => !allowedCodes.includes(code)) ||
        new Set(reviewed.issueCodes).size !== reviewed.issueCodes.length ||
        (reviewed.reviewOutcome === 'unchanged'
          ? reviewed.issueCodes.length !== 0
          : reviewed.issueCodes.length === 0)
      )
        throw new Error('Revisione checkpoint non valida.');
      output.reviewOutcome = reviewed.reviewOutcome;
      output.issueCodes = [...reviewed.issueCodes];
      if (kind === 'map') {
        if ((value.output as AiConceptMapReviewResult['output']).sourceIssue !== false)
          throw new Error('Fonte mappa non valida.');
        output.sourceIssue = false;
      }
    }
    return {
      status: 'completed',
      kind: value.kind,
      modelProfile: value.modelProfile,
      actualCostMicroUsd: value.actualCostMicroUsd,
      replayed: !!value.replayed,
      output,
    };
  }
  return {
    base: result(state.base, false),
    reviewed: result(state.reviewed, true),
    costUnknown:
      state.costUnknown ||
      state.base?.actualCostMicroUsd === null ||
      state.reviewed?.actualCostMicroUsd === null,
  } as MapArtifactState | PoolArtifactState;
}
