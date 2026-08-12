import { describe, expect, it } from 'vitest';
import {
  classifyQuestionParticipation,
  QuestionParticipationError,
} from '../questionParticipation.js';

describe('classifyQuestionParticipation', () => {
  it('classifica comuni, VEX, basi e alternative in una sola mappa', () => {
    const result = classifyQuestionParticipation({
      selectedEntryIds: ['free', 'vex', 'base'],
      equivalentGroups: [{ id: 'g', questionIndexEntryIds: ['vex'] }],
      differentiation: {
        version: 1,
        questions: [
          {
            baseQuestionIndexEntryId: 'base',
            choices: { label: { kind: 'alternative', questionIndexEntryId: 'alt' } },
          },
        ],
      },
    });
    expect(Object.fromEntries(result)).toEqual({
      free: 'common_free',
      vex: 'vex_member',
      base: 'differentiated_base',
      alt: 'differentiated_alternative',
    });
  });

  it.each([
    {
      selectedEntryIds: ['q'],
      equivalentGroups: [{ id: 'g', questionIndexEntryIds: ['q'] }],
      differentiation: {
        version: 1 as const,
        questions: [{ baseQuestionIndexEntryId: 'q', choices: { l: { kind: 'none' as const } } }],
      },
    },
    {
      selectedEntryIds: ['q', 'alt'],
      equivalentGroups: [],
      differentiation: {
        version: 1 as const,
        questions: [
          {
            baseQuestionIndexEntryId: 'q',
            choices: { l: { kind: 'alternative' as const, questionIndexEntryId: 'alt' } },
          },
        ],
      },
    },
    {
      selectedEntryIds: ['q'],
      equivalentGroups: [{ id: 'g', questionIndexEntryIds: ['missing'] }],
      differentiation: undefined,
    },
  ])('rifiuta ogni sovrapposizione VEX/varianti/comuni', (input) => {
    expect(() => classifyQuestionParticipation(input)).toThrow(QuestionParticipationError);
  });
});
