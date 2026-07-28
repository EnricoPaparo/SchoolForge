import { describe, expect, it } from 'vitest';
import {
  assertValidVerificationDate,
  buildVerificationHeadline,
  formatQuestionCountLabel,
  formatVerificationDateIt,
  isValidVerificationDate,
} from '../verificationDate.js';

describe('verificationDate — contratto YYYY-MM-DD (UI-VERIFICHE-06B)', () => {
  it('accetta un giorno di calendario reale', () => {
    for (const value of ['2026-02-02', '2024-02-29', '2026-12-31', '2026-01-01']) {
      expect(isValidVerificationDate(value)).toBe(true);
    }
  });

  it('rifiuta date impossibili', () => {
    for (const value of ['2026-02-30', '2026-13-01', '2026-00-10', '2026-04-31', '2025-02-29']) {
      expect(isValidVerificationDate(value)).toBe(false);
    }
  });

  it('rifiuta ogni forma diversa senza normalizzarla', () => {
    for (const value of [
      '2026-2-3',
      '02/02/2026',
      ' 2026-02-02',
      '2026-02-02 ',
      '2026-02-02T00:00:00Z',
      '20260202',
      '',
      null,
      undefined,
      20260202,
      new Date('2026-02-02'),
    ]) {
      expect(isValidVerificationDate(value)).toBe(false);
    }
  });

  it('non normalizza silenziosamente: assertValidVerificationDate lancia o restituisce l’identico valore', () => {
    expect(assertValidVerificationDate('2026-02-02')).toBe('2026-02-02');
    expect(() => assertValidVerificationDate(' 2026-02-02')).toThrow(/AAAA-MM-GG/);
    expect(() => assertValidVerificationDate('2026-2-2')).toThrow(/AAAA-MM-GG/);
    expect(() => assertValidVerificationDate(undefined)).toThrow(/AAAA-MM-GG/);
  });

  it('non impone alcun limite a passato o futuro', () => {
    expect(isValidVerificationDate('1999-09-09')).toBe(true);
    expect(isValidVerificationDate('2099-09-09')).toBe(true);
  });

  it('formatta in italiano DD/MM/YYYY, e non formatta nulla di malformato', () => {
    expect(formatVerificationDateIt('2026-02-02')).toBe('02/02/2026');
    expect(formatVerificationDateIt('2026-12-31')).toBe('31/12/2026');
    expect(formatVerificationDateIt('2026-02-30')).toBeNull();
    expect(formatVerificationDateIt(undefined)).toBeNull();
    expect(formatVerificationDateIt(null)).toBeNull();
  });

  it('usa il singolare solo per una domanda, con la D maiuscola', () => {
    expect(formatQuestionCountLabel(0)).toBe('0 Domande');
    expect(formatQuestionCountLabel(1)).toBe('1 Domanda');
    expect(formatQuestionCountLabel(2)).toBe('2 Domande');
    expect(formatQuestionCountLabel(6)).toBe('6 Domande');
  });

  it('omette del tutto la data sulle verifiche legacy, senza separatore residuo', () => {
    expect(buildVerificationHeadline({ verificationDate: '2026-02-02', questionCount: 6 })).toEqual(
      {
        datePrefix: '02/02/2026',
        questionLabel: '6 Domande',
      },
    );
    expect(buildVerificationHeadline({ questionCount: 6 })).toEqual({
      datePrefix: null,
      questionLabel: '6 Domande',
    });
    expect(buildVerificationHeadline({ verificationDate: null, questionCount: 1 })).toEqual({
      datePrefix: null,
      questionLabel: '1 Domanda',
    });
  });
});
