import { describe, expect, it } from 'vitest';
import { numericEqualityDiagnostics, numericDiagnosticsBlock } from './didacticSpecialist.js';
import {
  canonicalRequest,
  computeInputHash,
  validateAiContentRequest,
  MAX_LESSON_LIST_ITEMS,
  MAX_LESSON_ITEM_CHARS,
} from './aiContentCore.js';
import { buildLessonPrompt, buildLessonReviewPrompt, buildPoolPrompt } from './aiContentPrompt.js';
const raw = {
  kind: 'lesson',
  requestId: '11111111-1111-4111-8111-111111111111',
  modelProfile: 'quality',
  depth: 'in_depth',
  titolo: 'Le frazioni',
  sottotitolo: null,
  difficolta: 'intermedia',
  concettiChiave: ['frazioni'],
  obiettivi: ['Sommare frazioni'],
  udaTitle: 'Numeri',
  udaContext: {
    title: 'Numeri',
    descrizione: 'Calcolo',
    competenze: [],
    obiettivi: [],
    currentLessonPosition: 2,
    lessons: [
      { position: 1, titolo: 'Le frazioni', sottotitolo: null },
      { position: 2, titolo: 'Le frazioni', sottotitolo: null },
    ],
  },
  hasCurrentContent: false,
  currentBody: '',
};
function payload(metadata: Record<string, unknown>) {
  return {
    ...raw,
    udaContext: {
      ...raw.udaContext,
      lessons: [{ ...raw.udaContext.lessons[0], ...metadata }, raw.udaContext.lessons[1]],
    },
  };
}
describe('bounded independent numeric diagnostics', () => {
  it('recomputes faults, precedence, signed powers and decimal comma', () => {
    expect(
      numericEqualityDiagnostics('2+3*4=20\n(2+3)*4=20\n-2^2=-4\n2^3^2=512\n1,5+0,5=2').map(
        (d) => d.status,
      ),
    ).toEqual([
      'different',
      'consistent_with_tolerance',
      'consistent_with_tolerance',
      'consistent_with_tolerance',
      'consistent_with_tolerance',
    ]);
    expect(numericEqualityDiagnostics('0.1+0.2=0.3')[0]?.status).toBe('consistent_with_tolerance');
  });
  it('skips ambiguous grammar, prose, chains, units and fenced code', () => {
    const input = [
      'x+2=3',
      '2 m=3 m',
      '1=2=3',
      '2<=3',
      '2!=3',
      '2==2',
      '1..3=2',
      'Risultato: 2+2=5',
      '```js',
      '2+2=5',
      '```',
      '$2+2=5$',
      '2e3=2000',
      '- 2+2=4',
      '+ 2+2=4',
      '* 2+2=4',
      '1/0=0',
      '2^100=1',
      '2^(1/2)=1',
      '1 2=12',
      '2(3)=6',
    ].join('\n');
    expect(numericEqualityDiagnostics(input)).toEqual([]);
    expect(numericEqualityDiagnostics('~~~\n```\n2+2=5\n~~~\n    2+2=5')).toEqual([]);
    expect(numericEqualityDiagnostics('999999999999+0.01-999999999999=0.01')[0]?.status).toBe(
      'consistent_with_tolerance',
    );
  });
  it('caps nesting, magnitude, line count and emitted diagnostics', () => {
    expect(numericEqualityDiagnostics('('.repeat(30) + '1' + ')'.repeat(30) + '=1')).toEqual([]);
    expect(numericEqualityDiagnostics('999999999999999999=1')).toEqual([]);
    expect(numericEqualityDiagnostics(Array(100).fill('1+1=2').join('\n'))).toHaveLength(24);
    expect(numericEqualityDiagnostics(Array(1000).fill('prosa').join('\n') + '\n2+2=5')).toEqual(
      [],
    );
  });
  it('provides contextual repair guidance without automatic rejection', () => {
    const block = numericDiagnosticsBlock({ fonte: '2+2=5' });
    expect(block).toContain('different');
    expect(block).toContain('opzione volutamente falsa');
    expect(block).toContain('nessun rifiuto globale');
  });
});
describe('planned UDA coverage metadata', () => {
  it('omits absent/empty arrays but hashes substantive metadata in each relevant request', () => {
    const legacy = validateAiContentRequest(payload({}));
    const empty = validateAiContentRequest(payload({ concettiChiave: [], obiettivi: [] }));
    const enriched = validateAiContentRequest(
      payload({ concettiChiave: ['interi'], obiettivi: ['Sommare'] }),
    );
    expect(canonicalRequest(empty)).toBe(canonicalRequest(legacy));
    expect(computeInputHash(enriched)).not.toBe(computeInputHash(legacy));
    for (const fields of [{ concettiChiave: ['interi'] }, { obiettivi: ['Sommare'] }]) {
      expect(computeInputHash(validateAiContentRequest(payload(fields)))).not.toBe(
        computeInputHash(legacy),
      );
    }
  });
  it('rejects malformed and oversized optional metadata', () => {
    for (const field of ['concettiChiave', 'obiettivi']) {
      for (const value of [
        'text',
        [1],
        Array(MAX_LESSON_LIST_ITEMS + 1).fill('x'),
        ['x'.repeat(MAX_LESSON_ITEM_CHARS + 1)],
      ]) {
        expect(() => validateAiContentRequest(payload({ [field]: value }))).toThrow();
      }
    }
  });
  it('generator and reviewer identify current position even with duplicate titles and planned coverage', () => {
    const generated = validateAiContentRequest(
      payload({ concettiChiave: ['interi'], obiettivi: ['Sommare'] }),
    );
    if (generated.kind !== 'lesson') throw new Error('request');
    const prompt = buildLessonPrompt(generated);
    expect(prompt.user).toContain('Concetti pianificati: interi');
    expect(prompt.user).toContain('non prova contenuti già studiati');
    const reviewRaw = {
      ...payload({ concettiChiave: ['interi'] }),
      kind: 'lesson_review',
      candidateBody: '2+2=5',
    };
    const { hasCurrentContent: _has, currentBody: _body, ...reviewPayload } = reviewRaw;
    void _has;
    void _body;
    const reviewed = validateAiContentRequest(reviewPayload);
    if (reviewed.kind !== 'lesson_review') throw new Error('request');
    const review = buildLessonReviewPrompt(reviewed);
    expect(review.user).toContain('"currentLessonPosition":2');
    expect(review.user).toContain('interi');
    expect(review.user).toContain('Calcolo');
    expect(review.user).toContain('different');
    expect(review.user).toContain('non prova di studio');
    expect(canonicalRequest(reviewed)).toContain('lesson-review-v2');
  });
  it('pool blueprint is conditioned on source with plausible misconception distractors', () => {
    const request = validateAiContentRequest({
      kind: 'pool',
      requestId: raw.requestId,
      modelProfile: 'quality',
      level: 'balanced',
      counts: { aperta: 1, chiusa_singola: 0, chiusa_multipla: 0 },
      lessonSource: 'Frazioni',
    });
    if (request.kind !== 'pool') throw new Error('request');
    expect(buildPoolPrompt(request).user).toContain('misconcezione plausibile');
    expect(buildPoolPrompt(request).user).toContain('Non produrre domande-trabocchetto');
    expect(canonicalRequest(request)).toContain('pool-specialist-v1');
  });
});
