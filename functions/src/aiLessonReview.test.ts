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
  it('has a closed request, dedicated prompt identity and quality policy', () => {
    const request = validateAiContentRequest(raw);
    expect(request.kind).toBe('lesson_review');
    expect(canonicalRequest(request)).toContain('lesson-review-v1');
    const resolved = resolveContentModelForRequest(request);
    expect(resolved.model).toBe('gpt-6.1-sol');
    const payload = buildContentStructuredRequest(request, resolved.model);
    expect(payload.reasoning).toEqual({ effort: 'high' });
    expect(payload.text.verbosity).toBe('high');
    expect(JSON.stringify(payload.text.format.schema)).toContain('reviewOutcome');
  });

  it('keeps Economy lessons on the qualified GPT-5.6 Luna rollback', () => {
    const request = validateAiContentRequest({ ...raw, modelProfile: 'economy' });
    expect(resolveContentModelForRequest(request).model).toBe('gpt-5.6-luna');
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
  });
});
