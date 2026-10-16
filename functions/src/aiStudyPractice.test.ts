import { describe, expect, it } from 'vitest';
import {
  canonicalRequest,
  computeInputHash,
  validateAiContentRequest,
  type PoolRequest,
} from './aiContentCore.js';
import { buildContentStructuredRequest, resolveMaxOutputTokens } from './aiContentPayload.js';
import { validateStudyPoolProposal, validatePoolProposal } from './aiContentValidation.js';
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
