import { describe, expect, it } from 'vitest';
import type { VerificationTeacherQuestionSnapshot } from '../../../../types/firestore.js';
import type { LoadedQuestionWithSolution } from '../loadSelectedQuestionsWithSolutions.js';
import {
  toPdfQuestion,
  toPdfQuestionWithSolution,
  toPublicVerificationQuestion,
  toTeacherQuestionSnapshot,
} from '../verificationSnapshotMappers.js';

const REF = {
  questionIndexEntryId: 'qi-1',
  questionLocalId: 'q1',
  udaDir: 'UDA1',
  lessonFilename: 'lezione1.md',
  poolStorageRef: 'gs://bucket/lezione1.pool.md',
  tipo: 'chiusa_singola' as const,
  difficolta: 2 as const,
  peso: 1 as const,
  maxPoints: 3,
};

const LOADED: LoadedQuestionWithSolution = {
  ref: REF,
  testo: 'Domanda?',
  tipo: 'chiusa_singola',
  opzioni: [
    { id: 'a', testo: 'A' },
    { id: 'b', testo: 'B' },
  ],
  soluzione: 'a',
};

describe('toTeacherQuestionSnapshot', () => {
  it('maps a LoadedQuestionWithSolution into the frozen snapshot shape, including soluzione', () => {
    const snap = toTeacherQuestionSnapshot(LOADED, 2);
    expect(snap).toEqual({
      order: 2,
      tipo: 'chiusa_singola',
      maxPoints: 3,
      testo: 'Domanda?',
      opzioni: [
        { id: 'a', testo: 'A' },
        { id: 'b', testo: 'B' },
      ],
      soluzione: 'a',
    });
  });

  it('omits opzioni for an aperta question', () => {
    const aperta: LoadedQuestionWithSolution = {
      ref: { ...REF, tipo: 'aperta' },
      testo: 'Spiega.',
      tipo: 'aperta',
      soluzione: 'Risposta libera.',
    };
    const snap = toTeacherQuestionSnapshot(aperta, 0);
    expect(snap).not.toHaveProperty('opzioni');
  });
});

describe('toPublicVerificationQuestion', () => {
  const snap: VerificationTeacherQuestionSnapshot = {
    order: 1,
    tipo: 'chiusa_singola',
    maxPoints: 3,
    testo: 'Domanda?',
    opzioni: [{ id: 'a', testo: 'A' }],
    soluzione: 'a',
  };

  it('strips soluzione and any technical reference', () => {
    const pub = toPublicVerificationQuestion(snap);
    expect(pub).toEqual({
      order: 1,
      tipo: 'chiusa_singola',
      maxPoints: 3,
      testo: 'Domanda?',
      opzioni: [{ id: 'a', testo: 'A' }],
    });
    expect(pub).not.toHaveProperty('soluzione');
    expect(JSON.stringify(pub)).not.toMatch(/poolStorageRef|questionLocalId|questionIndexEntryId/);
  });
});

describe('toPdfQuestion / toPdfQuestionWithSolution', () => {
  const snap: VerificationTeacherQuestionSnapshot = {
    order: 0,
    tipo: 'aperta',
    maxPoints: 5,
    testo: 'Spiega.',
    soluzione: 'Risposta.',
  };

  it('toPdfQuestion produces the minimal shape downloadStudentPdf needs, no soluzione', () => {
    const pdfQ = toPdfQuestion(snap);
    expect(pdfQ).toEqual({ ref: { maxPoints: 5 }, testo: 'Spiega.', tipo: 'aperta' });
    expect(pdfQ).not.toHaveProperty('soluzione');
  });

  it('toPdfQuestionWithSolution includes soluzione', () => {
    const pdfQ = toPdfQuestionWithSolution(snap);
    expect(pdfQ).toEqual({
      ref: { maxPoints: 5 },
      testo: 'Spiega.',
      tipo: 'aperta',
      soluzione: 'Risposta.',
    });
  });
});
