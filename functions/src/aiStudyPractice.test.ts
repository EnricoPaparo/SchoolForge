import { describe, expect, it } from 'vitest';
import {
  AiContentError,
  canonicalRequest,
  computeInputHash,
  validateAiContentRequest,
  type PoolRequest,
} from './aiContentCore.js';
import { buildContentStructuredRequest, resolveMaxOutputTokens } from './aiContentPayload.js';
import {
  studyPracticeConstraint,
  validateStudyPoolProposal,
  validatePoolProposal,
} from './aiContentValidation.js';
import { buildPoolPrompt } from './aiContentPrompt.js';
const source =
  'Per seguire un ciclo annota il valore iniziale, valuta la condizione, esegui il corpo e aggiorna la variabile prima della nuova condizione.';
const payload = {
  kind: 'pool',
  requestId: '11111111-2222-4333-8444-555555555555',
  modelProfile: 'economy',
  level: 'balanced',
  counts: { aperta: 3, chiusa_singola: 0, chiusa_multipla: 0 },
  lessonSource: source,
};
const request = (extra: Record<string, unknown> = {}) =>
  validateAiContentRequest({ ...payload, ...extra }) as PoolRequest;
const output = () => ({
  questions: Array.from({ length: 3 }, (_, i) => ({
    tipo: 'aperta',
    testo: `Caso ${i}`,
    difficolta: 2,
    soluzione: 'Valuta prima la condizione e annota ogni aggiornamento.',
  })),
  studyPlan: {
    plannedCoverage: [{ objective: 'Prevedere output', status: 'preparato', sourceQuote: source }],
    objectives: [
      {
        capability: 'Tracciare un ciclo',
        prerequisites: 'Conoscere variabile e condizione',
        method: 'Tabella di evoluzione delle variabili',
        sourceQuote: source,
      },
    ],
    steps: ['esempio', 'guidato', 'autonomo'].map((stage, i) => ({
      questionOrder: i,
      objectiveIndex: 0,
      stage,
      hints: ['Annota prima il valore iniziale.', 'Valuta la condizione prima di ogni iterazione.'],
    })),
  },
});
describe('didactic study contract', () => {
  it('validates the teacher coverage summary without treating it as a cognitive proof', () => {
    const r = request();
    const raw = {
      questions: output().questions,
      coverageSummary: {
        coveredCapabilities: ['Tracciare un ciclo'],
        gaps: ['Confronto non preparato'],
        advancedOrdinals: [2],
      },
    };
    expect(validatePoolProposal(raw, r.counts, r.level).coverageSummary?.gaps).toEqual([
      'Confronto non preparato',
    ]);
    expect(() =>
      validatePoolProposal(
        { ...raw, coverageSummary: { ...raw.coverageSummary, advancedOrdinals: [3] } },
        r.counts,
        r.level,
      ),
    ).toThrow();
  });

  it('declares insufficient preparation without materializing invented questions', () => {
    expect(() =>
      validatePoolProposal(
        { sourceInsufficient: true, questions: [] },
        request().counts,
        'balanced',
      ),
    ).toThrow(expect.objectContaining({ code: 'source_insufficient' }));
  });
  it('binds purpose, final source, planned objectives and approved practice to identity', () => {
    const base = request();
    for (const extra of [
      { purpose: 'practice' },
      { lessonSource: source + ' Modifica' },
      { plannedObjectives: ['Prevedere output'] },
      { approvedPractice: 'Attività approvata' },
    ])
      expect(computeInputHash(request(extra))).not.toBe(computeInputHash(base));
    expect(canonicalRequest(base)).toContain('pool-alignment-v4');
  });
  it('rejects unknown purposes and unbounded/untyped practice inputs', () => {
    for (const extra of [
      { purpose: 'exam' },
      { approvedPractice: 7 },
      { approvedPractice: 'x'.repeat(50001) },
      { plannedObjectives: [{}] },
    ])
      expect(() => request(extra)).toThrow();
  });
  it('includes cognitive alignment in ordinary generation and subordinates approved practice to source', () => {
    const p = buildPoolPrompt(request({ approvedPractice: 'Caso svolto' }));
    expect(p.user).toContain('Citare un argomento non insegna il metodo');
    expect(p.user).toContain('niente tutorial, nuove assunzioni operative');
    expect(p.user).toContain('La pratica non autorizza contenuti o metodi assenti');
  });
  it('uses an explicitly budgeted strict study schema and validates actual source evidence', () => {
    const r = request({ purpose: 'practice', plannedObjectives: ['Prevedere output'] });
    expect(resolveMaxOutputTokens(r)).toBeGreaterThan(resolveMaxOutputTokens(request()));
    const schema = buildContentStructuredRequest(r, 'gpt-6-luna').text.format.schema as {
      required: string[];
    };
    expect(schema.required).toContain('studyPlan');
    expect(
      validateStudyPoolProposal(output(), r.counts, r.level, source, r.plannedObjectives).studyPlan
        ?.steps,
    ).toHaveLength(3);
    expect(() =>
      validateStudyPoolProposal(
        output(),
        r.counts,
        r.level,
        'Un while ripete istruzioni.',
        r.plannedObjectives,
      ),
    ).toThrow();
  });
  it('rejects missing training stages and omitted planned objectives', () => {
    const o = output();
    o.studyPlan.steps[1]!.stage = 'autonomo';
    expect(() =>
      validateStudyPoolProposal(o, request().counts, 'balanced', source, ['Prevedere output']),
    ).toThrow();
    expect(() =>
      validateStudyPoolProposal(output(), request().counts, 'balanced', source, [
        'Altro obiettivo',
      ]),
    ).toThrow();
  });
});

describe('practice generation contract alignment', () => {
  it.each([3, 6, 9])(
    'validates a monotone %i-activity plan and binds schema/prompt/identity',
    (n) => {
      const r = request({
        purpose: 'practice',
        plannedObjectives: [],
        counts: { aperta: n, chiusa_singola: 0, chiusa_multipla: 0 },
      });
      const o = output();
      o.studyPlan.plannedCoverage = [];
      o.questions = Array.from({ length: n }, (_, i) => ({
        ...o.questions[0]!,
        testo: `Caso ${i}`,
      }));
      o.studyPlan.steps = Array.from({ length: n }, (_, i) => ({
        ...o.studyPlan.steps[0]!,
        questionOrder: i,
        stage: ['esempio', 'guidato', 'autonomo'][Math.floor(i / (n / 3))]!,
      }));
      expect(
        validateStudyPoolProposal(o, r.counts, r.level, source, []).studyPlan!.steps,
      ).toHaveLength(n);
      expect(canonicalRequest(r)).toContain('study-practice-v3');
      expect(buildPoolPrompt(r).user).toContain(`${n} attivita richiedono esattamente ${n} steps`);
      expect(buildPoolPrompt(r).user).toContain('EGAEGA');
      expect(buildPoolPrompt(r).user).toContain('nomi ESATTI');
      const schema = buildContentStructuredRequest(r, 'gpt-6-luna').text.format.schema as {
        properties: {
          studyPlan: {
            anyOf: {
              properties: {
                objectives: { maxItems: number };
                steps: { minItems: number; maxItems: number };
              };
            }[];
          };
        };
      };
      expect(schema.properties.studyPlan.anyOf[0]!.properties.objectives.maxItems).toBe(n / 3);
      expect(schema.properties.studyPlan.anyOf[0]!.properties.steps).toMatchObject({
        minItems: n,
        maxItems: n,
      });
    },
  );
  it('accepts empty or absent planned objectives only, retaining types and metadata limits', () => {
    expect(request({ purpose: 'practice', plannedObjectives: [] }).plannedObjectives).toEqual([]);
    expect(request({ purpose: 'practice' }).plannedObjectives).toBeUndefined();
    expect(request({ plannedObjectives: ['  Esatto  '] }).plannedObjectives).toEqual(['Esatto']);
    for (const plannedObjectives of [null, 3, 'x', [{}], Array(41).fill('x'), ['x'.repeat(301)]])
      expect(() => request({ plannedObjectives })).toThrow();
  });
  it('rejects impossible practice counts or closed-only examples before any provider, preserving normal pools', () => {
    for (const n of [1, 2, 13, 30])
      expect(() =>
        request({
          purpose: 'practice',
          counts: { aperta: n, chiusa_singola: 0, chiusa_multipla: 0 },
        }),
      ).toThrow();
    expect(() =>
      request({
        purpose: 'practice',
        counts: { aperta: 0, chiusa_singola: 3, chiusa_multipla: 0 },
      }),
    ).toThrow();
    for (const n of [4, 5, 7, 8, 10, 11, 12])
      expect(() =>
        request({
          purpose: 'practice',
          counts: { aperta: n, chiusa_singola: 0, chiusa_multipla: 0 },
        }),
      ).not.toThrow();
    expect(
      request({ counts: { aperta: 30, chiusa_singola: 0, chiusa_multipla: 0 } }).counts.aperta,
    ).toBe(30);
    expect(canonicalRequest(request())).toContain('pool-alignment-v4');
    expect(buildPoolPrompt(request()).user).not.toContain('study-practice-v3');
  });
  it.each([
    [
      'method_text',
      (o: ReturnType<typeof output>) => {
        o.studyPlan.objectives[0]!.method = 'x'.repeat(1501);
      },
    ],
    [
      'quote_text',
      (o: ReturnType<typeof output>) => {
        o.studyPlan.objectives[0]!.sourceQuote = 'x'.repeat(19);
      },
    ],
    [
      'coverage_objectives',
      (o: ReturnType<typeof output>) => {
        o.studyPlan.plannedCoverage[0]!.objective = 'Parafrasi';
      },
    ],
    [
      'step_count',
      (o: ReturnType<typeof output>) => {
        o.studyPlan.steps.pop();
      },
    ],
    [
      'objective_count',
      (o: ReturnType<typeof output>) => {
        o.studyPlan.objectives.push({ ...o.studyPlan.objectives[0]! });
      },
    ],
    [
      'hint_text',
      (o: ReturnType<typeof output>) => {
        o.studyPlan.steps[0]!.hints[0] = '';
      },
    ],
  ] as const)(
    'reports stable sanitized %s diagnostics without relaxing validation',
    (constraint, mutate) => {
      const o = output();
      mutate(o);
      try {
        validateStudyPoolProposal(o, request().counts, 'balanced', source, ['Prevedere output']);
        throw new Error('Expected rejection');
      } catch (error) {
        expect(error).toMatchObject({ code: 'provider_invalid_output', constraint });
        expect(studyPracticeConstraint(error)).toBe(constraint);
      }
    },
  );
});

it('never logs arbitrary exception text as a practice constraint', () => {
  expect(studyPracticeConstraint(new Error('PRIVATE_TEXT'))).toBe('unknown');
  expect(
    studyPracticeConstraint(
      Object.assign(new AiContentError('provider_invalid_output', 'PRIVATE_TEXT'), {
        constraint: 'PRIVATE_TEXT',
      }),
    ),
  ).toBe('unknown');
});

it('sanitizes an unexpected study-plan exception instead of exposing raw text', () => {
  const o = output();
  Object.defineProperty(o, 'studyPlan', {
    get() {
      throw new Error('PRIVATE_SOURCE_TEXT');
    },
    enumerable: true,
  });
  expect(() => validateStudyPoolProposal(o, request().counts, 'balanced', source)).toThrow(
    expect.objectContaining({
      code: 'provider_invalid_output',
      constraint: 'unknown',
      message: 'Esercitazione o riferimenti alla lezione non validi.',
    }),
  );
});
