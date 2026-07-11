import { describe, expect, it } from 'vitest';
import { countFilled, isAnswerFilled } from '../examAnswers.js';

describe('isAnswerFilled', () => {
  it('is false when no answer is present', () => {
    expect(isAnswerFilled(undefined)).toBe(false);
  });

  it('aperta: false for blank/whitespace-only text, true otherwise', () => {
    expect(isAnswerFilled({ tipo: 'aperta', testo: '' })).toBe(false);
    expect(isAnswerFilled({ tipo: 'aperta', testo: '   ' })).toBe(false);
    expect(isAnswerFilled({ tipo: 'aperta', testo: '  risposta  ' })).toBe(true);
  });

  it('chiusa_singola: false when no option is selected', () => {
    expect(isAnswerFilled({ tipo: 'chiusa_singola', selectedId: null })).toBe(false);
    expect(isAnswerFilled({ tipo: 'chiusa_singola', selectedId: 'a' })).toBe(true);
  });

  it('chiusa_multipla: false when no option is selected, true with at least one', () => {
    expect(isAnswerFilled({ tipo: 'chiusa_multipla', selectedIds: [] })).toBe(false);
    expect(isAnswerFilled({ tipo: 'chiusa_multipla', selectedIds: ['a'] })).toBe(true);
  });
});

describe('countFilled', () => {
  it('counts only filled questions among the given orders', () => {
    const answers = {
      '0': { tipo: 'aperta' as const, testo: 'risposta' },
      '1': { tipo: 'aperta' as const, testo: '' },
      '2': { tipo: 'chiusa_singola' as const, selectedId: 'a' },
    };
    expect(countFilled([0, 1, 2, 3], answers)).toBe(2);
  });

  it('returns 0 for an empty answers map', () => {
    expect(countFilled([0, 1], {})).toBe(0);
  });
});
