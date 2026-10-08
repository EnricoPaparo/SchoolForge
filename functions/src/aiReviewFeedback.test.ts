import { describe, expect, it } from 'vitest';
import { splitReviewFeedback } from './aiReviewFeedback.js';

describe('accessory reviewer feedback', () => {
  const content = { body: 'Contenuto valido', reviewOutcome: 'improved', issueCodes: [] };
  it('extracts feedback without adding metadata to canonical persisted content', () => {
    expect(
      splitReviewFeedback({ ...content, reviewChanges: [' Corretto il risultato. '] }),
    ).toEqual({
      output: content,
      feedback: { changes: ['Corretto il risultato.'] },
    });
  });
  it.each([undefined, null, 'invalid', [''], ['x'.repeat(241)], ['a', 'b', 'c', 'd'], ['a\nb']])(
    'drops missing or malformed accessory metadata without dropping content: %s',
    (reviewChanges) => {
      expect(splitReviewFeedback({ ...content, reviewChanges })).toEqual({ output: content });
    },
  );
  it('leaves other unknown keys for the closed content validator', () => {
    expect(splitReviewFeedback({ ...content, unexpected: true, reviewChanges: [] }).output).toEqual(
      {
        ...content,
        unexpected: true,
      },
    );
  });
});
