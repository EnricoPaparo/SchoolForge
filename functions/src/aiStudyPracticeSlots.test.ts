import { describe, expect, it } from 'vitest';
import {
  validateAiContentRequest,
  type PoolRequest,
  type PoolReviewRequest,
} from './aiContentCore.js';
import {
  practiceLayouts,
  materializePracticeSlots,
  encodePracticeSlots,
} from './aiStudyPracticeSlots.js';
import { resolvePracticeSourceReferences } from './aiStudyPracticeSource.js';
import { validateStudyPoolProposal } from './aiContentValidation.js';
import { buildContentStructuredRequest } from './aiContentPayload.js';
import { validatePracticeReview, providerPracticePlan } from './aiStudyPracticeReview.js';
import { validateStudyPlan } from '@schoolforge/lesson-contract';
const source =
  'Per tracciare un ciclo annota ogni valore, controlla la condizione, esegui il corpo e aggiorna la variabile prima del controllo successivo.';
function request(n = 9, open = n - 1, multiple = 0): PoolRequest {
  return validateAiContentRequest({
    kind: 'pool',
    purpose: 'practice',
    requestId: '11111111-2222-4333-8444-555555555555',
    modelProfile: 'economy',
    level: 'balanced',
    counts: { aperta: open, chiusa_singola: n - open - multiple, chiusa_multipla: multiple },
    lessonSource: source,
    plannedObjectives: [],
    existingPoolQuestionCount: 0,
  }) as PoolRequest;
}
function rawFor(r: PoolRequest | PoolReviewRequest, layout = practiceLayouts(r)[0]!) {
  return {
    sourceInsufficient: false,
    practice: {
      layout: layout.id,
      objectives: Object.fromEntries(
        Array.from({ length: layout.objectiveCount }, (_, i) => [
          `capability_${i}`,
          {
            capability: `Capacità ${i}`,
            prerequisites: 'Variabili e condizioni',
            method: 'Annota e verifica ogni passaggio',
            sourceExcerptId: 0,
          },
        ]),
      ),
      plannedCoverage: [],
      activities: Object.fromEntries(
        layout.slots.map((slot, i) => [
          slot.name,
          {
            question: {
              tipo: slot.tipo,
              testo: `Caso ${i}: ruolo ${slot.stage}, capacità ${slot.objectiveIndex}`,
              difficolta: slot.difficulty ?? 2,
              ...(slot.tipo === 'aperta'
                ? { soluzione: `Svolgimento ${i} motivato.` }
                : {
                    opzioni: ['A', 'B', 'C'],
                    soluzione: slot.tipo === 'chiusa_singola' ? [0] : [0, 1],
                  }),
            },
            hints: [`Aiuto concettuale ${i}`, `Passaggio operativo ${i}`],
          },
        ]),
      ),
    },
  };
}
function canonical(r: PoolRequest, raw: unknown) {
  return validateStudyPoolProposal(
    resolvePracticeSourceReferences(materializePracticeSlots(raw, r), source),
    r.counts,
    r.level,
    source,
    [],
  );
}
describe('practice roles fixed before generation', () => {
  it.each([3, 6, 9])(
    'materializes every supported %i-activity layout with complete monotone triads and exact question/hint association',
    (n) => {
      const r = request(n);
      for (const layout of practiceLayouts(r)) {
        const raw = rawFor(r, layout);
        const result = canonical(r, raw);
        expect(result.questions).toHaveLength(n);
        result.studyPlan!.steps.forEach((step, i) => {
          expect(result.questions[i]!.testo).toBe(
            `Caso ${i}: ruolo ${step.stage}, capacità ${step.objectiveIndex}`,
          );
          expect(step.hints).toEqual([`Aiuto concettuale ${i}`, `Passaggio operativo ${i}`]);
        });
      }
    },
  );
  it('balances nine activities for one capacity, and makes three independent triads for three capacities', () => {
    const layouts = practiceLayouts(request());
    expect(layouts.find((l) => l.id === 'capabilities_1')!.slots.map((s) => s.stage)).toEqual([
      'esempio',
      'esempio',
      'esempio',
      'guidato',
      'guidato',
      'guidato',
      'autonomo',
      'autonomo',
      'autonomo',
    ]);
    const three = layouts.find((l) => l.id === 'capabilities_3')!;
    expect(three.slots.map((s) => s.objectiveIndex)).toEqual([0, 0, 0, 1, 1, 1, 2, 2, 2]);
    expect(three.slots.map((s) => s.stage)).toEqual([
      'esempio',
      'guidato',
      'autonomo',
      'esempio',
      'guidato',
      'autonomo',
      'esempio',
      'guidato',
      'autonomo',
    ]);
  });
  it('respects generic 3..12 counts, limited open examples and multiple closed questions without relaxing canonical validation', () => {
    for (let n = 3; n <= 12; n++)
      for (let open = 1; open <= n; open++) {
        const r = request(n, open, Math.min(1, n - open));
        for (const layout of practiceLayouts(r))
          expect(() => canonical(r, rawFor(r, layout))).not.toThrow();
      }
  });
  it('rejects EGAEGAEGA for the same capacity and missing triads, never fixing by sorting or relabeling', () => {
    const r = request(9, 9),
      one = canonical(r, rawFor(r));
    for (const stages of [
      [
        'esempio',
        'guidato',
        'autonomo',
        'esempio',
        'guidato',
        'autonomo',
        'esempio',
        'guidato',
        'autonomo',
      ],
      Array(9).fill('autonomo'),
    ]) {
      const invalid = {
        ...one.studyPlan,
        steps: one.studyPlan!.steps.map((s, i) => ({ ...s, stage: stages[i] })),
      };
      expect(() => validateStudyPlan(invalid, source, 9, [])).toThrow(
        expect.objectContaining({ constraint: 'progression' }),
      );
      expect(() =>
        encodePracticeSlots({ questions: one.questions, studyPlan: invalid }, r),
      ).toThrow();
      expect(() =>
        materializePracticeSlots(
          { sourceInsufficient: false, questions: one.questions, studyPlan: invalid },
          r,
        ),
      ).toThrow();
    }
  });
  it('rejects missing, renamed or extra slots and a wrong example type before canonical materialization', () => {
    const r = request(),
      raw = rawFor(r);
    const key = Object.keys(raw.practice.activities)[0]!;
    const missing = structuredClone(raw);
    delete missing.practice.activities[key];
    expect(() => materializePracticeSlots(missing, r)).toThrow();
    const renamed = structuredClone(raw);
    renamed.practice.activities['activity_0_autonomo_capability_0'] =
      renamed.practice.activities[key]!;
    delete renamed.practice.activities[key];
    expect(() => materializePracticeSlots(renamed, r)).toThrow();
    const wrong = structuredClone(raw);
    wrong.practice.activities[key]!.question.tipo = 'chiusa_singola';
    expect(() => materializePracticeSlots(wrong, r)).toThrow();
    expect(() => materializePracticeSlots({ ...raw, questions: [] }, r)).toThrow();
  });
  it('uses closed named objects in the actual payload with no free steps or tuple schema', () => {
    const r = request();
    const text = JSON.stringify(buildContentStructuredRequest(r, 'gpt-6-luna').text.format.schema);
    expect(text).toContain('activity_0_esempio_capability_0');
    expect(text).toContain('capabilities_3');
    for (const forbidden of ['questionOrder', 'objectiveIndex', 'prefixItems', '"steps"'])
      expect(text).not.toContain(forbidden);
  });
  it('derives review slots from valid legacy interleaving and preserves unchanged canonical output exactly', () => {
    const r = request(9, 9),
      layout = practiceLayouts(r).find((l) => l.id === 'capabilities_3')!;
    const valid = canonical(r, rawFor(r, layout));
    const permutation = [0, 3, 6, 1, 4, 7, 2, 5, 8];
    const candidateQuestions = permutation.map((at, i) => ({ ...valid.questions[at]!, order: i }));
    const candidateStudyPlan = {
      ...valid.studyPlan!,
      steps: permutation.map((at, i) => ({ ...valid.studyPlan!.steps[at]!, questionOrder: i })),
    };
    const review = validateAiContentRequest({
      ...r,
      kind: 'pool_review',
      candidateQuestions,
      candidateStudyPlan,
    }) as PoolReviewRequest;
    const raw = encodePracticeSlots(
      {
        sourceInsufficient: false,
        questions: candidateQuestions.map(({ order, ...q }) => {
          void order;
          return q;
        }),
        studyPlan: providerPracticePlan(candidateStudyPlan, source),
        reviewOutcome: 'unchanged',
        issueCodes: [],
      },
      review,
    );
    const result = validatePracticeReview(raw, review);
    expect(result.questions).toEqual(candidateQuestions);
    expect(result.studyPlan).toEqual(candidateStudyPlan);
    expect(practiceLayouts(review)[0]!.slots.map((s) => s.stage)).toEqual([
      'esempio',
      'esempio',
      'esempio',
      'guidato',
      'guidato',
      'guidato',
      'autonomo',
      'autonomo',
      'autonomo',
    ]);
    expect(validatePracticeReview(result, review, true)).toEqual(result);
  });
});
