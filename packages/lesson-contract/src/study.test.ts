import { describe, expect, it } from 'vitest';
import { validateStudyPlan } from './study.js';
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
