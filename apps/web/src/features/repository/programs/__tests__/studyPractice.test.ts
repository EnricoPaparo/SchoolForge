import { describe, expect, it } from 'vitest';
import {
  currentStudyPractice,
  practicePoolContext,
  validateStudyPractice,
} from '../studyPractice.js';
import { STUDY_BODY, studyFixture } from './studyFixture.js';
describe('practice public contract', () => {
  it('invalidates the entire artifact when the final body changes', () => {
    expect(currentStudyPractice(studyFixture(), STUDY_BODY)).not.toBeNull();
    expect(currentStudyPractice(studyFixture(), STUDY_BODY + ' Nuovo contenuto')).toBeNull();
  });
  it('rejects private metadata, invalid closed answers and excessive payload before saving', () => {
    const p = studyFixture();
    expect(() => validateStudyPractice({ ...p, poolId: 'private' }, STUDY_BODY)).toThrow();
    p.questions[2] = {
      ...p.questions[2]!,
      tipo: 'chiusa_singola',
      opzioni: ['A', 'B'],
      soluzioneIndici: [7],
    } as (typeof p.questions)[number];
    expect(() => validateStudyPractice(p, STUDY_BODY)).toThrow();
    const large = studyFixture();
    large.questions[0] = { ...large.questions[0]!, tipo: 'aperta', soluzione: 'x'.repeat(16001) };
    expect(() => validateStudyPractice(large, STUDY_BODY)).toThrow();
  });
  it('sends only capabilities and activity stems to pool, without solutions', () => {
    const context = practicePoolContext(studyFixture())!;
    expect(context).toContain('Tracciare un ciclo');
    expect(context).not.toContain('soluzioneIndici');
    expect(context).not.toContain('Controllo, esecuzione');
  });
});

describe('bounded practice pool context', () => {
  it('deduplicates repeated objectives and stems without exposing hints or solutions', () => {
    const practice = studyFixture();
    practice.plan.objectives.push({ ...practice.plan.objectives[0]! });
    practice.plan.steps.push({ ...practice.plan.steps[0]!, objectiveIndex: 1 });
    const parsed = JSON.parse(practicePoolContext(practice)!);
    expect(parsed.objectives).toHaveLength(1);
    expect(parsed.activities).toHaveLength(practice.questions.length);
    expect(JSON.stringify(parsed)).not.toContain('hints');
    expect(JSON.stringify(parsed)).not.toContain('soluzione');
    expect(parsed.objectives[0].method).toBe(practice.plan.objectives[0]!.method);
    expect(parsed.coverage).toEqual(
      practice.plan.plannedCoverage.map(({ objective, status }) => ({ objective, status })),
    );
  });
  it('keeps all capabilities, methods, coverage and stages for long Unicode stems', () => {
    const practice = studyFixture();
    practice.questions.forEach((q, index) => {
      q.testo = String(index) + '界😀'.repeat(8000);
    });
    const context = practicePoolContext(practice)!;
    expect(new TextEncoder().encode(context).length).toBeLessThanOrEqual(50000);
    const parsed = JSON.parse(context);
    expect(parsed.representation).toBe('capabilities_methods_stages');
    expect(parsed.activities.reduce((n: number, a: { count: number }) => n + a.count, 0)).toBe(
      practice.plan.steps.length,
    );
    expect(parsed.objectives[0].capability).toBe(practice.plan.objectives[0]!.capability);
    expect(practicePoolContext(practice)).toBe(context);
  });
  it('fails explicitly when essential semantics cannot fit, never dropping an existing practice', () => {
    const practice = studyFixture();
    practice.plan.objectives[0]!.method = '界'.repeat(20000);
    expect(() => practicePoolContext(practice)).toThrow('limite');
    expect(practicePoolContext(null)).toBeUndefined();
  });
});
