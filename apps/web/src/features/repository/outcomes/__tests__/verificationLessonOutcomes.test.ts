import { describe, expect, it } from 'vitest';
import {
  deriveVerificationLessonOutcomes,
  VerificationLessonOutcomesError,
  type VerificationOutcomeCorrection,
  type VerificationOutcomeSource,
} from '../verificationLessonOutcomes.js';

const sources: VerificationOutcomeSource[] = [
  {
    order: 0,
    udaDir: 'uda-01',
    lessonFilename: 'lezione-001.md',
    udaTitle: 'Reti',
    lessonTitle: 'Indirizzi IP',
  },
  {
    order: 1,
    udaDir: 'uda-01',
    lessonFilename: 'lezione-002.md',
    udaTitle: 'Reti',
    lessonTitle: 'Trasporto',
  },
  {
    order: 2,
    udaDir: 'uda-02',
    lessonFilename: 'lezione-001.md',
    udaTitle: 'Sistemi',
    lessonTitle: 'Processi',
  },
];

function correction(
  studentUid: string,
  status: VerificationOutcomeCorrection['status'],
  values: Array<[order: number, points: number | null, maxPoints: number]>,
): VerificationOutcomeCorrection {
  return {
    correctionId: `ver-${studentUid}`,
    studentUid,
    status,
    evaluations: Object.fromEntries(
      values.map(([order, points, maxPoints]) => [String(order), { order, points, maxPoints }]),
    ),
  };
}

describe('deriveVerificationLessonOutcomes (ESITI-01)', () => {
  it('deriva copertura, UDA e lezioni dalla più debole', () => {
    const report = deriveVerificationLessonOutcomes({
      submittedCount: 3,
      sources,
      corrections: [
        correction('a', 'completed', [
          [0, 1, 2],
          [1, 4, 4],
          [2, 1, 4],
        ]),
        correction('b', 'returned', [
          [0, 2, 2],
          [1, 2, 4],
          [2, 3, 4],
        ]),
        correction('c', 'in_progress', [[0, 2, 2]]),
      ],
    });

    expect(report.finalizedCorrections).toBe(2);
    expect(report.submittedCount).toBe(3);
    expect(report.udas.map((uda) => uda.udaTitle)).toEqual(['Sistemi', 'Reti']);
    expect(report.udas[0]).toMatchObject({
      masteryPercentage: 50,
      questionCount: 1,
      evaluationCount: 2,
    });
    expect(
      report.udas[1]!.lessons.map((lesson) => [lesson.lessonTitle, lesson.masteryPercentage]),
    ).toEqual([
      ['Indirizzi IP', 75],
      ['Trasporto', 75],
    ]);
  });

  it('pesa ogni valutazione, non il punteggio massimo della domanda', () => {
    const report = deriveVerificationLessonOutcomes({
      submittedCount: 1,
      sources: [sources[0]!, { ...sources[0]!, order: 1 }],
      corrections: [
        correction('a', 'completed', [
          [0, 1, 1],
          [1, 0, 4],
        ]),
      ],
    });
    expect(report.udas[0]!.masteryPercentage).toBe(50);
    expect(report.udas[0]!.lessons[0]).toMatchObject({
      masteryPercentage: 50,
      questionCount: 2,
      evaluationCount: 2,
    });
  });

  it('una domanda risposta da meno studenti pesa meno', () => {
    const report = deriveVerificationLessonOutcomes({
      submittedCount: 2,
      sources: [sources[0]!, { ...sources[0]!, order: 1 }],
      corrections: [
        correction('a', 'completed', [
          [0, 1, 1],
          [1, 0, 1],
        ]),
        correction('b', 'completed', [[0, 1, 1]]),
      ],
    });
    expect(report.udas[0]!.masteryPercentage).toBe(67);
    expect(report.udas[0]!.evaluationCount).toBe(3);
    expect(report.udas[0]!.questionCount).toBe(2);
  });

  it('mantiene gli zeri come valutazioni reali', () => {
    const report = deriveVerificationLessonOutcomes({
      submittedCount: 1,
      sources: [sources[0]!],
      corrections: [correction('a', 'completed', [[0, 0, 2]])],
    });
    expect(report.udas[0]!.masteryPercentage).toBe(0);
    expect(report.udas[0]!.evaluationCount).toBe(1);
  });

  it('restituisce un report vuoto quando non ci sono correzioni definitive', () => {
    expect(
      deriveVerificationLessonOutcomes({
        submittedCount: 2,
        sources,
        corrections: [correction('a', 'in_progress', [[0, null, 2]])],
      }),
    ).toEqual({ finalizedCorrections: 0, submittedCount: 2, udas: [] });
  });

  it.each([
    ['origine mancante', [correction('a', 'completed', [[8, 1, 1]])], sources],
    ['punteggio nullo', [correction('a', 'completed', [[0, null, 1]])], sources],
    ['punteggio fuori range', [correction('a', 'completed', [[0, 2, 1]])], sources],
    ['passo non valido', [correction('a', 'completed', [[0, 0.1, 1]])], sources],
    ['massimo nullo', [correction('a', 'completed', [[0, 0, 0]])], sources],
    [
      'ordine sorgente duplicato',
      [correction('a', 'completed', [[0, 1, 1]])],
      [sources[0]!, sources[0]!],
    ],
  ])('rifiuta fail-closed: %s', (_label, corrections, sourceList) => {
    expect(() =>
      deriveVerificationLessonOutcomes({
        submittedCount: 1,
        sources: sourceList as VerificationOutcomeSource[],
        corrections: corrections as VerificationOutcomeCorrection[],
      }),
    ).toThrow(VerificationLessonOutcomesError);
  });

  it.each([
    ['stato sconosciuto', { ...correction('a', 'completed', [[0, 1, 1]]), status: 'unknown' }],
    [
      'mappa valutazioni assente',
      { ...correction('a', 'completed', [[0, 1, 1]]), evaluations: null },
    ],
    [
      'chiave diversa dall’order',
      {
        ...correction('a', 'completed', [[0, 1, 1]]),
        evaluations: { 4: { order: 0, points: 1, maxPoints: 1 } },
      },
    ],
  ])('rifiuta un documento correzione malformato: %s', (_label, malformed) => {
    expect(() =>
      deriveVerificationLessonOutcomes({
        submittedCount: 1,
        sources,
        corrections: [malformed as VerificationOutcomeCorrection],
      }),
    ).toThrow(VerificationLessonOutcomesError);
  });

  it('rifiuta più correzioni definitive dello stesso studente', () => {
    expect(() =>
      deriveVerificationLessonOutcomes({
        submittedCount: 2,
        sources,
        corrections: [
          correction('a', 'completed', [[0, 1, 1]]),
          correction('a', 'returned', [[0, 1, 1]]),
        ],
      }),
    ).toThrow(/stesso studente/);
  });

  it('rifiuta una copertura impossibile', () => {
    expect(() =>
      deriveVerificationLessonOutcomes({
        submittedCount: 0,
        sources,
        corrections: [correction('a', 'completed', [[0, 1, 1]])],
      }),
    ).toThrow(/superano/);
  });
});
