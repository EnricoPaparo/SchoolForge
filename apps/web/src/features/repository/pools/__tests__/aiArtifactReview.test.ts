import { describe, expect, it, vi } from 'vitest';
import { reviewMapCandidate, reviewPoolCandidate } from '../aiArtifactReview.js';
import type {
  AiContentCallables,
  AiPoolContentRequest,
  AiPoolGenerateResult,
  AiPoolReviewRequest,
} from '../aiContentClient.js';
import type {
  AiConceptMapCallables,
  AiConceptMapRequest,
  AiConceptMapGenerateResult,
} from '../aiConceptMapClient.js';

const poolRequest: AiPoolContentRequest = {
  kind: 'pool',
  requestId: 'base',
  modelProfile: 'quality',
  level: 'balanced',
  counts: { aperta: 1, chiusa_singola: 0, chiusa_multipla: 0 },
  lessonSource: 'La RAM è volatile.',
  existingPoolQuestionCount: 1,
  existingQuestionStems: ['Che cosa perde la RAM senza alimentazione?'],
};
const pool: AiPoolGenerateResult = {
  status: 'completed',
  kind: 'pool',
  modelProfile: 'quality',
  output: {
    questions: [
      {
        order: 0,
        tipo: 'aperta',
        testo: 'Spiega la volatilità.',
        difficolta: 2,
        soluzione: 'I dati si perdono senza alimentazione.',
      },
    ],
  },
  actualCostMicroUsd: 50,
  replayed: false,
};
const mapRequest: AiConceptMapRequest = {
  kind: 'concept_map',
  requestId: 'base-map',
  modelProfile: 'quality',
  lessonBody: poolRequest.lessonSource,
};
const map: AiConceptMapGenerateResult = {
  status: 'completed',
  kind: 'concept_map',
  modelProfile: 'quality',
  output: { conceptMapMarkdown: '## Sintesi\n\nLa RAM è volatile.' },
  actualCostMicroUsd: 50,
  replayed: false,
};

describe('artifact review safety', () => {
  it('passes exact source and existing stems to a separate stage and preserves unchanged questions', async () => {
    const generateReview = vi.fn(async (_request: AiPoolReviewRequest) => ({
      ...pool,
      kind: 'pool_review' as const,
      output: { questions: [], reviewOutcome: 'unchanged' as const, issueCodes: [] },
    }));
    const api: AiContentCallables = {
      preview: vi.fn(),
      generate: vi.fn(),
      previewReview: vi.fn(),
      generateReview,
    };
    const result = await reviewPoolCandidate(api, poolRequest, pool, 'review-id');
    expect(result.output.questions).toEqual(pool.output.questions);
    expect(generateReview.mock.calls[0][0]).toEqual({
      ...poolRequest,
      kind: 'pool_review',
      requestId: 'review-id',
      candidateQuestions: pool.output.questions,
    });
    expect(api.generate).not.toHaveBeenCalled();
  });
  it('does not accept a source issue or silently use the base map', async () => {
    const api: AiConceptMapCallables = {
      preview: vi.fn(),
      generate: vi.fn(),
      previewReview: vi.fn(),
      generateReview: vi.fn(async () => ({
        ...map,
        kind: 'concept_map_review' as const,
        output: {
          ...map.output,
          reviewOutcome: 'unchanged' as const,
          issueCodes: ['source_error'],
          sourceIssue: true,
        },
      })),
    };
    await expect(reviewMapCandidate(api, mapRequest, map, 'review-id')).rejects.toMatchObject({
      details: { code: 'source_issue' },
    });
    expect(api.generate).not.toHaveBeenCalled();
  });
  it('retains base Markdown byte for byte when unchanged and rejects invalid improved output', async () => {
    const generateReview = vi.fn(async () => ({
      ...map,
      kind: 'concept_map_review' as const,
      output: {
        conceptMapMarkdown: 'different',
        reviewOutcome: 'unchanged' as 'unchanged' | 'improved',
        issueCodes: [],
        sourceIssue: false,
      },
    }));
    const api: AiConceptMapCallables = {
      preview: vi.fn(),
      generate: vi.fn(),
      previewReview: vi.fn(),
      generateReview,
    };
    expect((await reviewMapCandidate(api, mapRequest, map, 'id')).output.conceptMapMarkdown).toBe(
      map.output.conceptMapMarkdown,
    );
    generateReview.mockResolvedValueOnce({
      ...map,
      kind: 'concept_map_review',
      output: {
        conceptMapMarkdown: '',
        reviewOutcome: 'improved',
        issueCodes: [],
        sourceIssue: false,
      },
    });
    await expect(reviewMapCandidate(api, mapRequest, map, 'id')).rejects.toThrow('non è valida');
  });
});
