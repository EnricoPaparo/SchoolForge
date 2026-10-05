import { describe, expect, it } from 'vitest';
import {
  canonicalRequest,
  resolveContentModelForRequest,
  validateAiContentRequest,
} from './aiContentCore.js';
import { buildContentStructuredRequest } from './aiContentPayload.js';
import { validateLessonReviewProposal } from './aiContentValidation.js';

const raw = {
  kind: 'lesson_review',
  requestId: '11111111-1111-4111-8111-111111111111',
  modelProfile: 'quality',
  teacherGuidance: null,
  depth: 'in_depth',
  titolo: 'La memoria',
  sottotitolo: null,
  difficolta: 'intermedia',
  concettiChiave: ['RAM', 'memoria di massa'],
  obiettivi: ['Distinguere memoria volatile e persistente'],
  udaTitle: 'Il computer',
  udaContext: {
    title: 'Il computer',
    descrizione: null,
    competenze: [],
    obiettivi: [],
    currentLessonPosition: 1,
    lessons: [{ position: 1, titolo: 'La memoria', sottotitolo: null }],
  },
  candidateBody: '## Memoria\n\nLa RAM è una memoria volatile.',
};

describe('lesson advanced review', () => {
  it('has a closed request and dedicated prompt identity', () => {
    const request = validateAiContentRequest(raw);
    expect(request.kind).toBe('lesson_review');
    expect(canonicalRequest(request)).toContain('lesson-review-v2');
    const resolved = resolveContentModelForRequest(request);
    expect(resolved.model).toBe('gpt-5.6-luna');
    const payload = buildContentStructuredRequest(request, resolved.model);
    expect(payload.reasoning).toBeUndefined();
    expect(payload.text.verbosity).toBeUndefined();
    expect(JSON.stringify(payload.text.format.schema)).toContain('reviewOutcome');
  });

  it('keeps Quality lesson generation on 6.1 Sol but pins both reviewers to 5.6 Luna', () => {
    const lessonInput: Record<string, unknown> = {
      ...raw,
      kind: 'lesson',
      currentBody: '',
      hasCurrentContent: false,
    };
    delete lessonInput.candidateBody;
    const lesson = validateAiContentRequest(lessonInput);
    const qualityReview = validateAiContentRequest(raw);
    const economyReview = validateAiContentRequest({
      ...raw,
      requestId: '22222222-2222-4222-8222-222222222222',
      modelProfile: 'economy',
    });
    expect(resolveContentModelForRequest(lesson).model).toBe('gpt-6.1-sol');
    expect(resolveContentModelForRequest(qualityReview)).toEqual(
      resolveContentModelForRequest(economyReview),
    );
    expect(resolveContentModelForRequest(qualityReview)).toEqual({
      model: 'gpt-5.6-luna',
      priceListVersion: 'v8-2026-09-26-luna-cache-standard',
    });
    expect(canonicalRequest(qualityReview)).not.toBe(canonicalRequest(economyReview));
  });

  it('builds the same reviewer provider payload for both profiles at equal content', () => {
    const qualityReview = validateAiContentRequest(raw);
    const economyReview = validateAiContentRequest({
      ...raw,
      requestId: '22222222-2222-4222-8222-222222222222',
      modelProfile: 'economy',
    });
    const model = resolveContentModelForRequest(qualityReview).model;
    expect(buildContentStructuredRequest(qualityReview, model)).toEqual(
      buildContentStructuredRequest(economyReview, model),
    );
  });

  it('validates the revised body and closed issue codes', () => {
    expect(
      validateLessonReviewProposal({
        body: '## Finale',
        reviewOutcome: 'improved',
        issueCodes: ['logical_gap'],
      }),
    ).toEqual({ body: '## Finale', reviewOutcome: 'improved', issueCodes: ['logical_gap'] });
    expect(() =>
      validateLessonReviewProposal({
        body: 'x',
        reviewOutcome: 'improved',
        issueCodes: ['invented'],
      }),
    ).toThrow('Codice della revisione non valido');
    expect(() =>
      validateLessonReviewProposal({
        body: 'x',
        reviewOutcome: 'unchanged',
        issueCodes: [],
        commentary: 'campo inatteso',
      }),
    ).toThrow('proprietà mancanti o non ammesse');
  });
});
