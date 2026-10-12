// @vitest-environment node
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, serverTimestamp, setDoc, Timestamp } from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  completeCorrection,
  reopenCorrection,
  openOrLoadCorrection,
  returnCorrection,
  saveCorrection,
} from '../features/repository/corrections/correctionsService.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIRESTORE_RULES = resolve(__dirname, '../../../../firestore.rules');

const OWNER_UID = 'owner-uid';
const STUDENT_UID = 'student-uid';
const VERIFICATION_ID = 'v1';
const SUBMISSION_ID = `${VERIFICATION_ID}_${STUDENT_UID}`;

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-schoolforge-m4-correction-save',
    firestore: {
      rules: readFileSync(FIRESTORE_RULES, 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });
});

afterEach(async () => {
  await testEnv.clearFirestore();
});

afterAll(async () => {
  await testEnv.cleanup();
});

function ownerDb() {
  return testEnv.authenticatedContext(OWNER_UID).firestore() as unknown as Firestore;
}

async function seedBase() {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'settings/owner'), { ownerUid: OWNER_UID });
    await setDoc(doc(db, 'verifications', VERIFICATION_ID), {
      ownerUid: OWNER_UID,
      status: 'closed',
      teacherSnapshot: {
        title: 'Verifica 1',
        classId: 'class-a',
        className: 'Classe A',
        programId: 'program-1',
        importId: 'import-1',
        questionRefs: [
          {
            questionIndexEntryId: 'question-index-1',
            questionLocalId: 'q-1',
            udaDir: 'UDA-1',
            lessonFilename: 'lezione-1.md',
            poolStorageRef: 'imports/import-1/UDA-1/lezione-1.pool.md',
            tipo: 'aperta',
            difficolta: 5,
            maxPoints: 5,
          },
          {
            questionIndexEntryId: 'question-index-2',
            questionLocalId: 'q-2',
            udaDir: 'UDA-1',
            lessonFilename: 'lezione-1.md',
            poolStorageRef: 'imports/import-1/UDA-1/lezione-1.pool.md',
            tipo: 'aperta',
            difficolta: 4,
            maxPoints: 4,
          },
        ],
        distributionMode: 'same_questions',
        questions: [
          {
            order: 0,
            tipo: 'aperta',
            difficolta: 5,
            maxPoints: 5,
            testo: 'D1',
            soluzione: 'Soluzione congelata D1',
          },
          {
            order: 1,
            tipo: 'aperta',
            difficolta: 4,
            maxPoints: 4,
            testo: 'D2',
            soluzione: 'Soluzione congelata D2',
          },
        ],
        activatedAt: Timestamp.now(),
      },
    });
    await setDoc(doc(db, `verifications/${VERIFICATION_ID}/publishedProjection/data`), {
      ownerUid: OWNER_UID,
      title: 'Verifica 1',
      className: 'Classe A',
      classId: 'class-a',
      visibility: 'public',
      onlineEnabled: true,
      questions: [
        { order: 0, tipo: 'aperta', maxPoints: 5, testo: 'D1' },
        { order: 1, tipo: 'aperta', maxPoints: 4, testo: 'D2' },
      ],
      activatedAt: Timestamp.now(),
    });
    await setDoc(doc(db, 'submissions', SUBMISSION_ID), {
      submissionId: SUBMISSION_ID,
      verificationId: VERIFICATION_ID,
      studentUid: STUDENT_UID,
      ownerUid: OWNER_UID,
      status: 'submitted',
      answers: {
        '0': { tipo: 'aperta', testo: 'risposta 1' },
        '1': { tipo: 'aperta', testo: 'risposta 2' },
      },
      flagged: {},
      attentionEvents: [],
      deliveryCode: 'SF-2026-AAAA',
      verificationTitle: 'Verifica 1',
      className: 'Classe A',
      startedAt: Timestamp.now(),
      lastSavedAt: serverTimestamp(),
      submittedAt: Timestamp.now(),
    });
    await setDoc(doc(db, 'submissionReceipts', SUBMISSION_ID), {
      submissionId: SUBMISSION_ID,
      verificationId: VERIFICATION_ID,
      studentUid: STUDENT_UID,
      ownerUid: OWNER_UID,
      verificationTitle: 'Verifica 1',
      className: 'Classe A',
      deliveryCode: 'SF-2026-AAAA',
      submittedAt: Timestamp.now(),
    });
  });
}

describe('M4 correction save — real service against the emulator', () => {
  it('creates, saves scores + feedback, and re-reads the persisted values', async () => {
    await seedBase();
    const db = ownerDb();

    // Opening the workspace creates the in_progress correction.
    const { correction } = await openOrLoadCorrection(SUBMISSION_ID, OWNER_UID, db);
    expect(correction.status).toBe('in_progress');

    // Save exactly what the workspace would send.
    await saveCorrection(
      {
        submissionId: SUBMISSION_ID,
        evaluations: {
          '0': { points: 4.5, feedback: 'Buono' },
          '1': { points: 2 },
        },
        generalFeedback: 'Nel complesso ok',
      },
      db,
    );

    const snap = await getDoc(doc(db, 'corrections', SUBMISSION_ID));
    const saved = snap.data()!;
    expect(saved.evaluations['0'].points).toBe(4.5);
    expect(saved.evaluations['0'].feedback).toBe('Buono');
    expect(saved.evaluations['1'].points).toBe(2);
    expect(saved.generalFeedback).toBe('Nel complesso ok');
    expect(saved.totalPoints).toBe(6.5);
  });

  it('completes and returns through the real service batch under the deployed rules shape', async () => {
    await seedBase();
    const db = ownerDb();

    await openOrLoadCorrection(SUBMISSION_ID, OWNER_UID, db);
    await saveCorrection(
      {
        submissionId: SUBMISSION_ID,
        evaluations: {
          '0': { points: 4.5, feedback: 'Buono' },
          '1': { points: 2 },
        },
        generalFeedback: 'Nel complesso ok',
      },
      db,
    );
    await completeCorrection(SUBMISSION_ID, db);
    await returnCorrection(SUBMISSION_ID, db);

    const correction = await getDoc(doc(db, 'corrections', SUBMISSION_ID));
    const returned = await getDoc(doc(db, 'correctionReturns', SUBMISSION_ID));
    expect(correction.data()?.status).toBe('returned');
    expect(returned.data()?.visibleToStudent).toBe(true);
    expect(returned.data()?.solutionsVisible).toBe(true);
    expect(returned.data()?.questions).toEqual([
      expect.objectContaining({ order: 0, correctAnswer: 'Soluzione congelata D1' }),
      expect.objectContaining({ order: 1, correctAnswer: 'Soluzione congelata D2' }),
    ]);
  });
});

describe('legacy audit recommendations and unchanged submission summaries', () => {
  it.each([false, true])(
    'saves feedback-only with identical scores after reopen=%s',
    async (reopened) => {
      await seedBase();
      const db = ownerDb();
      await openOrLoadCorrection(SUBMISSION_ID, OWNER_UID, db);
      const input = {
        submissionId: SUBMISSION_ID,
        evaluations: { '0': { points: 4.5, feedback: 'Buono' }, '1': { points: 2 } },
        generalFeedback: 'Nel complesso ok',
      };
      await saveCorrection(input, db);
      if (reopened) {
        await completeCorrection(SUBMISSION_ID, db);
        await reopenCorrection(SUBMISSION_ID, db);
      }
      const before = (await getDoc(doc(db, 'submissions', SUBMISSION_ID))).data()!;
      await saveCorrection(
        {
          ...input,
          evaluations: {
            ...input.evaluations,
            '0': { points: 4.5, feedback: 'Feedback aggiornato' },
          },
          generalFeedback: 'Solo feedback aggiornato',
        },
        db,
      );
      const after = (await getDoc(doc(db, 'submissions', SUBMISSION_ID))).data()!;
      expect(after.correctionSummary).toEqual(before.correctionSummary);
      expect(after.correctionSummaryUpdatedAt).toEqual(before.correctionSummaryUpdatedAt);
      expect(
        (await getDoc(doc(db, 'corrections', SUBMISSION_ID))).data()?.evaluations['0'].feedback,
      ).toBe('Feedback aggiornato');
    },
  );
  it('saves legacy acknowledgement alone and completes recommendations without forcing it', async () => {
    await seedBase();
    const db = ownerDb();
    await openOrLoadCorrection(SUBMISSION_ID, OWNER_UID, db);
    const input = {
      submissionId: SUBMISSION_ID,
      evaluations: { '0': { points: 4.5 }, '1': { points: 2 } },
      generalFeedback: 'Feedback manuale',
    };
    await saveCorrection(input, db);
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const ref = doc(ctx.firestore(), 'corrections', SUBMISSION_ID);
      const data = (await getDoc(ref)).data()!;
      data.evaluations['0'].aiReview = {
        status: 'review_recommended',
        reasons: ['score_disagreement'],
      };
      data.evaluations['1'].aiReview = {
        status: 'review_recommended',
        reasons: ['evidence_disagreement'],
      };
      await setDoc(ref, data);
    });
    const before = (await getDoc(doc(db, 'submissions', SUBMISSION_ID))).data()!;
    await saveCorrection({ ...input, reviewAcknowledgedOrders: [0] }, db);
    expect(
      (await getDoc(doc(db, 'submissions', SUBMISSION_ID))).data()?.correctionSummaryUpdatedAt,
    ).toEqual(before.correctionSummaryUpdatedAt);
    await completeCorrection(SUBMISSION_ID, db);
    const final = (await getDoc(doc(db, 'corrections', SUBMISSION_ID))).data()!;
    expect(final.status).toBe('completed');
    expect(final.evaluations['0'].points).toBe(4.5);
    expect(final.evaluations['1'].points).toBe(2);
    expect(final.evaluations['1'].aiReview.status).toBe('review_recommended');
    expect(final.generalFeedback).toBe('Feedback manuale');
  });
});

it.each([4.5, 4.25, 3.75, 2.5])(
  'completes an old pending recommendation preserving manual score %s',
  async (manualScore) => {
    await seedBase();
    const db = ownerDb();
    await openOrLoadCorrection(SUBMISSION_ID, OWNER_UID, db);
    await saveCorrection(
      {
        submissionId: SUBMISSION_ID,
        evaluations: {
          '0': { points: manualScore, feedback: 'Feedback manuale da preservare' },
          '1': { points: 2 },
        },
        generalFeedback: 'Giudizio manuale',
      },
      db,
    );
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const ref = doc(ctx.firestore(), 'corrections', SUBMISSION_ID);
      const data = (await getDoc(ref)).data()!;
      data.evaluations['0'].aiReview = {
        status: 'review_recommended',
        reasons: ['score_disagreement'],
      };
      await setDoc(ref, data);
    });
    const before = (await getDoc(doc(db, 'corrections', SUBMISSION_ID))).data()!;
    await completeCorrection(SUBMISSION_ID, db);
    const after = (await getDoc(doc(db, 'corrections', SUBMISSION_ID))).data()!;
    expect(after.status).toBe('completed');
    expect(after.evaluations).toEqual(before.evaluations);
    expect(after.generalFeedback).toEqual(before.generalFeedback);
  },
);
