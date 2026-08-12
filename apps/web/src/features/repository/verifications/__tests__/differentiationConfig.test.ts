import { describe, expect, it } from 'vitest';
import {
  DifferentiationConfigError,
  parseDifferentiationConfig,
  reconcileDifferentiationWithSelection,
  referencedDifferentiationLabelIds,
  setDifferentiatedQuestion,
  variantCountForBase,
} from '../differentiationConfig.js';

const VALID = {
  version: 1 as const,
  questions: [
    {
      baseQuestionIndexEntryId: 'q-base',
      choices: {
        'label-a': { kind: 'alternative' as const, questionIndexEntryId: 'q-alt' },
        'label-b': { kind: 'none' as const },
      },
    },
  ],
};

describe('differentiationConfig', () => {
  it('accetta il contratto chiuso e ricava etichette e conteggio', () => {
    expect(parseDifferentiationConfig(VALID)).toEqual(VALID);
    expect([...referencedDifferentiationLabelIds(VALID)].sort()).toEqual(['label-a', 'label-b']);
    expect(variantCountForBase(VALID, 'q-base')).toBe(2);
  });

  it.each([
    { ...VALID, extra: true },
    { version: 2, questions: [] },
    { version: 1, questions: [] },
    {
      version: 1,
      questions: [{ baseQuestionIndexEntryId: 'q', choices: { l: { kind: 'base' } } }],
    },
    {
      version: 1,
      questions: [{ baseQuestionIndexEntryId: 'q', choices: { l: { kind: 'none', extra: true } } }],
    },
  ])('rifiuta forma, versione o contenuto non canonici', (value) => {
    expect(() => parseDifferentiationConfig(value)).toThrow(DifferentiationConfigError);
  });

  it('rifiuta il riuso della stessa alternativa per la stessa etichetta', () => {
    expect(() =>
      parseDifferentiationConfig({
        version: 1,
        questions: [
          {
            baseQuestionIndexEntryId: 'a',
            choices: { l: { kind: 'alternative', questionIndexEntryId: 'x' } },
          },
          {
            baseQuestionIndexEntryId: 'b',
            choices: { l: { kind: 'alternative', questionIndexEntryId: 'x' } },
          },
        ],
      }),
    ).toThrow(/stessa alternativa/);
  });

  it('non persiste le scelte base e rimuove la domanda quando torna tutta base', () => {
    const created = setDifferentiatedQuestion(undefined, 'q', {
      a: { kind: 'base' },
      b: { kind: 'none' },
    });
    expect(created?.questions[0]?.choices).toEqual({ b: { kind: 'none' } });
    expect(setDifferentiatedQuestion(created, 'q', { a: { kind: 'base' } })).toBeUndefined();
  });

  it('riconcilia solo le basi rimosse e dichiara quante configurazioni elimina', () => {
    expect(reconcileDifferentiationWithSelection(VALID, new Set())).toEqual({
      config: undefined,
      removedQuestions: 1,
    });
    expect(reconcileDifferentiationWithSelection(VALID, new Set(['q-base']))).toEqual({
      config: VALID,
      removedQuestions: 0,
    });
  });
});
