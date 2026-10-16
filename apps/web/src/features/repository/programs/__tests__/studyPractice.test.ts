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
