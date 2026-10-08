import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import {
  canonicalRequest,
  computeInputHash,
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
    expect(canonicalRequest(request)).toContain('lesson-review-v6');
    const resolved = resolveContentModelForRequest(request);
    expect(resolved.model).toBe('gpt-6.1-sol');
    const payload = buildContentStructuredRequest(request, resolved.model);
    expect(payload.reasoning).toEqual({ effort: 'high' });
    expect(payload.text.verbosity).toBe('high');
    expect(JSON.stringify(payload.text.format.schema)).toContain('reviewOutcome');
  });

  it('keeps Quality lesson generation on 6.1 Sol but uses 6.1 Sol for both reviewers', () => {
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
      model: 'gpt-6.1-sol',
      priceListVersion: 'v12-2026-09-29-gpt61-sol-standard',
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

  it('keeps depth caps and uses native Sol reasoning independently of profile', () => {
    for (const profile of ['economy', 'quality']) {
      for (const [depth, cap, effort, verbosity] of [
        ['synthetic', 8_000, 'medium', 'low'],
        ['complete', 14_000, 'medium', 'medium'],
        ['in_depth', 18_000, 'high', 'high'],
      ] as const) {
        const request = validateAiContentRequest({ ...raw, modelProfile: profile, depth });
        const payload = buildContentStructuredRequest(
          request,
          resolveContentModelForRequest(request).model,
        );
        expect(payload.max_output_tokens).toBe(cap);
        expect(payload.reasoning).toEqual({ effort });
        expect(payload.text.verbosity).toBe(verbosity);
      }
    }
  });

  it('separates defective examples from preservation of a valid draft in the real payload', () => {
    const request = validateAiContentRequest(raw);
    const payload = buildContentStructuredRequest(
      request,
      resolveContentModelForRequest(request).model,
    );
    const serialized = JSON.stringify(payload);
    expect(serialized).toContain(
      'rispetto ai principi della disciplina, non soltanto al resto della bozza',
    );
    expect(serialized).toContain('body identico alla BOZZA');
    expect(serialized).toContain('mai per una preferenza stilistica');
    expect(serialized).not.toContain('unchanged solo se la bozza era già ottimale');
    expect(serialized).toContain(raw.candidateBody.replace(/\n/g, '\\n'));
  });

  it('hashes resolved review policy so a previous Luna run cannot replay under Sol', () => {
    const request = validateAiContentRequest(raw);
    const current = JSON.parse(canonicalRequest(request));
    expect(current.reviewPolicy).toEqual(resolveContentModelForRequest(request));
    const previous = { ...current };
    delete previous.reviewPolicy;
    const previousHash = createHash('sha256').update(JSON.stringify(previous)).digest('hex');
    expect(computeInputHash(request)).not.toBe(previousHash);
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
