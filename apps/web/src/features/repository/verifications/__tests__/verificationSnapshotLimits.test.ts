import { describe, expect, it } from 'vitest';
import type { VerificationTeacherQuestionSnapshot } from '../../../../types/firestore.js';
import {
  assertTeacherSnapshotQuestionsWithinLimit,
  estimateTeacherSnapshotQuestionsBytes,
  TEACHER_SNAPSHOT_QUESTIONS_MAX_BYTES,
} from '../verificationSnapshotLimits.js';

const SMALL_QUESTION: VerificationTeacherQuestionSnapshot = {
  order: 0,
  tipo: 'aperta',
  maxPoints: 4,
  testo: 'Spiega HTTP.',
  soluzione: 'HTTP è un protocollo applicativo.',
};

describe('estimateTeacherSnapshotQuestionsBytes', () => {
  it('returns a positive byte count for a non-empty array', () => {
    expect(estimateTeacherSnapshotQuestionsBytes([SMALL_QUESTION])).toBeGreaterThan(0);
  });

  it('returns a small count for an empty array', () => {
    expect(estimateTeacherSnapshotQuestionsBytes([])).toBeLessThan(10);
  });

  it('grows with the size of the content', () => {
    const big: VerificationTeacherQuestionSnapshot = { ...SMALL_QUESTION, testo: 'x'.repeat(1000) };
    expect(estimateTeacherSnapshotQuestionsBytes([big])).toBeGreaterThan(
      estimateTeacherSnapshotQuestionsBytes([SMALL_QUESTION]),
    );
  });
});

describe('assertTeacherSnapshotQuestionsWithinLimit', () => {
  it('does not throw for a small snapshot', () => {
    expect(() => assertTeacherSnapshotQuestionsWithinLimit([SMALL_QUESTION])).not.toThrow();
  });

  it('throws a readable error when the snapshot exceeds the threshold', () => {
    const huge: VerificationTeacherQuestionSnapshot = {
      ...SMALL_QUESTION,
      testo: 'x'.repeat(TEACHER_SNAPSHOT_QUESTIONS_MAX_BYTES + 1),
    };
    expect(() => assertTeacherSnapshotQuestionsWithinLimit([huge])).toThrow(/troppo grande/i);
  });

  it('does not throw right at a size comfortably under the threshold', () => {
    const nearLimit: VerificationTeacherQuestionSnapshot = {
      ...SMALL_QUESTION,
      testo: 'x'.repeat(TEACHER_SNAPSHOT_QUESTIONS_MAX_BYTES - 1000),
    };
    expect(() => assertTeacherSnapshotQuestionsWithinLimit([nearLimit])).not.toThrow();
  });
});
