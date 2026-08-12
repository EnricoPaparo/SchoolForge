import type {
  EquivalentGroupConfig,
  VerificationDifferentiationConfig,
} from '../../../types/firestore.js';

export type QuestionParticipation =
  | 'common_free'
  | 'vex_member'
  | 'differentiated_base'
  | 'differentiated_alternative';

export class QuestionParticipationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QuestionParticipationError';
  }
}

/**
 * Unica classificazione autorevole condivisa da picker, builder VEX e builder
 * delle varianti. Ogni sovrapposizione vietata fallisce chiusa.
 */
export function classifyQuestionParticipation(input: {
  selectedEntryIds: readonly string[];
  equivalentGroups: readonly EquivalentGroupConfig[];
  differentiation?: VerificationDifferentiationConfig;
}): Map<string, QuestionParticipation> {
  const result = new Map<string, QuestionParticipation>();
  const selected = new Set(input.selectedEntryIds);
  for (const id of selected) result.set(id, 'common_free');

  for (const group of input.equivalentGroups) {
    for (const id of group.questionIndexEntryIds) {
      if (!selected.has(id)) {
        throw new QuestionParticipationError(
          'Un gruppo equivalente contiene una domanda non selezionata.',
        );
      }
      if (result.get(id) === 'vex_member') {
        throw new QuestionParticipationError('Una domanda appartiene a più gruppi equivalenti.');
      }
      result.set(id, 'vex_member');
    }
  }

  for (const question of input.differentiation?.questions ?? []) {
    const base = question.baseQuestionIndexEntryId;
    if (!selected.has(base) || result.get(base) === 'vex_member') {
      throw new QuestionParticipationError(
        'Una domanda con varianti non può essere assente o appartenere a un gruppo equivalente.',
      );
    }
    result.set(base, 'differentiated_base');
    for (const choice of Object.values(question.choices)) {
      if (choice.kind !== 'alternative') continue;
      const id = choice.questionIndexEntryId;
      if (
        selected.has(id) ||
        result.get(id) === 'vex_member' ||
        result.get(id) === 'differentiated_base'
      ) {
        throw new QuestionParticipationError(
          'Una domanda alternativa non può essere comune, VEX o base di altre varianti.',
        );
      }
      result.set(id, 'differentiated_alternative');
    }
  }
  return result;
}
