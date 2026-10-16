import { describe, expect, it } from 'vitest';
import { buildStudyPlanSchema, STUDY_TEXT_LIMITS, validateStudyPlan } from './study.js';
const source =
  'La proporzionalità diretta mantiene costante il rapporto y/x. Calcola k=y/x e usa y=kx.';
const plan = () => ({
  plannedCoverage: [
    { objective: 'Confrontare fonti storiche', status: 'non_sviluppato', sourceQuote: null },
  ],
  objectives: [
    {
      capability: 'Applicare y=kx',
      prerequisites: 'Rapporti',
      method: 'Calcolo della costante',
      sourceQuote: source,
    },
  ],
  steps: ['esempio', 'guidato', 'autonomo'].map((stage, i) => ({
    questionOrder: i,
    objectiveIndex: 0,
    stage,
    hints: ['Calcola il rapporto.', 'Usa la stessa costante.'],
  })),
});
describe('study evidence and progression', () => {
  it('reports undeveloped planned objectives without authorizing new capabilities', () => {
    expect(
      validateStudyPlan(plan(), source, 3, ['Confrontare fonti storiche']).plannedCoverage[0]
        ?.status,
    ).toBe('non_sviluppato');
  });
  it('rejects source changes and forged quotations', () => {
    expect(() => validateStudyPlan(plan(), source + 'x', 3)).not.toThrow();
    const p = plan();
    p.objectives[0]!.sourceQuote = 'Questo metodo non compare nella fonte.';
    expect(() => validateStudyPlan(p, source, 3)).toThrow();
  });
  it('requires distinct teaching stages for every capability', () => {
    const p = plan();
    p.steps[0]!.stage = 'trasferimento';
    expect(() => validateStudyPlan(p, source, 3)).toThrow();
  });
});

describe('request-specific study schema', () => {
  it.each([3, 6, 9])('binds %i questions to feasible capabilities, steps and indices', (n) => {
    const schema = buildStudyPlanSchema(n, ['Esatto', 'Esatto', 'Secondo'], n - 1).properties;
    expect(schema.objectives.maxItems).toBe(Math.floor(n / 3));
    expect(schema.steps.minItems).toBe(n);
    expect(schema.steps.maxItems).toBe(n);
    expect(schema.steps.items.properties.questionOrder.maximum).toBe(n - 1);
    expect(schema.steps.items.properties.objectiveIndex.maximum).toBe(Math.floor(n / 3) - 1);
    expect(schema.plannedCoverage.minItems).toBe(2);
    expect(schema.plannedCoverage.maxItems).toBe(2);
    expect(schema.plannedCoverage.items.properties.objective.enum).toEqual(['Esatto', 'Secondo']);
  });
  it('bounds capabilities by available open examples and planned coverage by exact unique names', () => {
    expect(buildStudyPlanSchema(9, [], 1).properties.objectives.maxItems).toBe(1);
    const schema = buildStudyPlanSchema(6, []).properties;
    expect(schema.plannedCoverage.maxItems).toBe(0);
    expect(schema.plannedCoverage.items.properties.objective).not.toHaveProperty('enum');
    const fields = schema.objectives.items.properties;
    expect(fields.capability.maxLength).toBe(STUDY_TEXT_LIMITS.capability);
    expect(fields.prerequisites.maxLength).toBe(STUDY_TEXT_LIMITS.prerequisites);
    expect(fields.method.maxLength).toBe(STUDY_TEXT_LIMITS.method);
    expect(fields.sourceQuote).toMatchObject({ minLength: 20, maxLength: 1200 });
    expect(schema.steps.items.properties.hints.items).toMatchObject({
      minLength: 1,
      maxLength: 1500,
    });
    expect(new RegExp(schema.steps.items.properties.hints.items.pattern).test('   ')).toBe(false);
  });
  it('keeps relational checks authoritative, including duplicate coverage and stage regression', () => {
    const p = plan();
    p.steps = [...p.steps, ...p.steps.map((s, i) => ({ ...s, questionOrder: i + 3 }))];
    expect(() => validateStudyPlan(p, source, 6)).toThrow(
      expect.objectContaining({ constraint: 'progression' }),
    );
    const duplicate = plan();
    duplicate.plannedCoverage.push({ ...duplicate.plannedCoverage[0]! });
    expect(() => validateStudyPlan(duplicate, source, 3)).toThrow(
      expect.objectContaining({ constraint: 'coverage_objectives' }),
    );
    const forged = plan();
    forged.objectives[0]!.sourceQuote = 'invented quotation missing from the source';
    expect(() => validateStudyPlan(forged, source, 3)).toThrow(
      expect.objectContaining({ constraint: 'quote_not_found' }),
    );
  });
});
