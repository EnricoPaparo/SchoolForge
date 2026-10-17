import { describe, expect, it } from 'vitest';
import {
  buildProviderStudyPlanSchema,
  practiceSourceExcerpts,
  practiceSourcePrompt,
  resolvePracticeSourceReferences,
} from './aiStudyPracticeSource.js';
import { validateAiContentRequest } from './aiContentCore.js';
import { studyPracticeConstraint } from './aiContentValidation.js';
const source =
  '# Ciclo 😀\r\n```python\nwhile x < 4:\n  x += 1\n```\nLa condizione si controlla prima di eseguire il corpo.';
const raw = (status = 'preparato', reference: unknown = 0) => ({
  studyPlan: {
    objectives: [{ capability: 'c', prerequisites: 'p', method: 'm', sourceExcerptId: 0 }],
    plannedCoverage: [{ objective: 'Obiettivo', status, sourceExcerptId: reference }],
    steps: [],
  },
});
describe('provider-only source references', () => {
  it.each([20, 1099, 1100, 1101, 1119, 1120, 2201, 200000])(
    'covers all %i source units without losing or inventing characters',
    (n) => {
      const s = 'x'.repeat(n);
      const chunks = practiceSourceExcerpts(s);
      expect(chunks.join('')).toBe(s);
      expect(chunks.every((c) => c.length >= 20 && c.length <= 1200)).toBe(true);
    },
  );
  it('preserves Unicode, Markdown, CRLF and code exactly, including surrogate boundaries', () => {
    for (const s of [source, 'x'.repeat(1099) + '😀' + source]) {
      expect(practiceSourceExcerpts(s).join('')).toBe(s);
      expect(practiceSourcePrompt(s)).toContain('<<<ESTRATTO 0>>>');
    }
    const result = resolvePracticeSourceReferences(raw(), source) as {
      studyPlan: { objectives: { sourceQuote: string }[] };
    };
    expect(result.studyPlan.objectives[0]!.sourceQuote).toBe(source);
    expect(JSON.stringify(result)).not.toContain('sourceExcerptId');
  });
  it.each([
    ['preparato', null, 'coverage_reference_status'],
    ['parziale', null, 'coverage_reference_status'],
    ['non_sviluppato', 0, 'coverage_reference_status'],
    ['preparato', 999, 'source_reference_unknown'],
    ['preparato', -1, 'source_reference_unknown'],
  ])('fails closed for %s/%s', (status, ref, constraint) => {
    try {
      resolvePracticeSourceReferences(raw(String(status), ref), source);
      throw new Error('unexpected');
    } catch (e) {
      expect(studyPracticeConstraint(e)).toBe(constraint);
      expect(String(e)).not.toContain(source);
    }
  });
  it('allows missing coverage only with null and refuses canonical quotes in fresh provider output', () => {
    expect(resolvePracticeSourceReferences(raw('non_sviluppato', null), source)).toMatchObject({
      studyPlan: { plannedCoverage: [{ sourceQuote: null }] },
    });
    const o = raw();
    Object.assign(o.studyPlan.objectives[0]!, { sourceQuote: source });
    expect(() => resolvePracticeSourceReferences(o, source)).toThrow();
  });
  it('discriminates status and reference in schema without regex, copying quotes or extra source', () => {
    const schema = buildProviderStudyPlanSchema({
      counts: { aperta: 5, chiusa_singola: 1, chiusa_multipla: 0 },
      plannedObjectives: ['Obiettivo'],
      lessonSource: source,
    });
    expect(schema.properties.plannedCoverage.items.anyOf[0]!.properties.sourceExcerptId).toEqual({
      type: 'integer',
      enum: [0],
    });
    expect(schema.properties.plannedCoverage.items.anyOf[1]!.properties.sourceExcerptId).toEqual({
      type: 'null',
    });
    expect(JSON.stringify(schema)).not.toContain('sourceQuote');
    expect(JSON.stringify(schema)).not.toContain('pattern');
  });
  it('rejects too-short source before provider or lease', () => {
    expect(() =>
      validateAiContentRequest({
        kind: 'pool',
        purpose: 'practice',
        requestId: '11111111-2222-4333-8444-555555555555',
        modelProfile: 'economy',
        level: 'balanced',
        counts: { aperta: 3, chiusa_singola: 0, chiusa_multipla: 0 },
        lessonSource: 'Fonte corta',
      }),
    ).toThrow(expect.objectContaining({ code: 'invalid_input' }));
  });
});
