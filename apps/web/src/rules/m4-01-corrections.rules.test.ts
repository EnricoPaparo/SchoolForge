// @vitest-environment node
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import { afterAll, afterEach, beforeAll, describe, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIRESTORE_RULES = resolve(__dirname, '../../../../firestore.rules');

const OWNER_UID = 'owner-uid';
const OTHER_OWNER_UID = 'other-owner-uid';
const STUDENT_UID = 'student-uid';
const OTHER_STUDENT_UID = 'other-student-uid';
const VERIFICATION_ID = 'v1';
const SUBMISSION_ID = `${VERIFICATION_ID}_${STUDENT_UID}`;

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-schoolforge-m4-01-corrections',
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

function studentDb(uid: string = STUDENT_UID) {
  return testEnv.authenticatedContext(uid).firestore() as unknown as Firestore;
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

async function seedBase(
  options: {
    studentStatus?: 'pending' | 'approved' | 'blocked';
    verificationOwnerUid?: string;
  } = {},
) {
  const { studentStatus = 'approved', verificationOwnerUid = OWNER_UID } = options;
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'settings/owner'), { ownerUid: OWNER_UID });
    await setDoc(doc(db, 'settings/ownerPublic'), { ownerUid: OWNER_UID });
    await setDoc(doc(db, 'settings/studentAccess'), {
      ownerUid: OWNER_UID,
      studentPortalEnabled: true,
      newStudentRequestsEnabled: false,
    });
    await setDoc(doc(db, 'students', STUDENT_UID), {
      uid: STUDENT_UID,
      ownerUid: OWNER_UID,
      email: 'student@example.com',
      displayName: null,
      status: studentStatus,
      classId: 'class-a',
    });
    await setDoc(doc(db, 'students', OTHER_STUDENT_UID), {
      uid: OTHER_STUDENT_UID,
      ownerUid: OWNER_UID,
      email: 'other-student@example.com',
      displayName: null,
      status: 'approved',
      classId: 'class-a',
    });
    await setDoc(doc(db, `verifications/${VERIFICATION_ID}`), {
      ownerUid: verificationOwnerUid,
      status: 'active',
      visibility: 'public',
      onlineEnabled: true,
      config: {
        title: 'Verifica 1',
        classId: 'class-a',
        programId: 'p1',
        importId: 'i1',
        questionRefs: [],
      },
      teacherSnapshot: {
        title: 'Verifica 1',
        classId: 'class-a',
        className: 'Classe A',
        programId: 'p1',
        importId: 'i1',
        questionRefs: [],
        questions: [
          { order: 0, tipo: 'aperta', maxPoints: 10, testo: 'D1', soluzione: 'sol0' },
          { order: 1, tipo: 'aperta', maxPoints: 5, testo: 'D2', soluzione: 'sol1' },
        ],
        activatedAt: Timestamp.now(),
      },
      activatedAt: Timestamp.now(),
      closedAt: null,
    });
    await setDoc(doc(db, `verifications/${VERIFICATION_ID}/publishedProjection/data`), {
      ownerUid: verificationOwnerUid,
      title: 'Verifica 1',
      className: 'Classe A',
      classId: 'class-a',
      visibility: 'public',
      onlineEnabled: true,
      questions: [
        { order: 0, tipo: 'aperta', maxPoints: 10, testo: 'D1' },
        { order: 1, tipo: 'aperta', maxPoints: 5, testo: 'D2' },
      ],
      activatedAt: Timestamp.now(),
    });
  });
}

async function seedSubmittedSubmission(
  options: { status?: 'draft' | 'submitted'; ownerUid?: string } = {},
) {
  const { status = 'submitted', ownerUid = OWNER_UID } = options;
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'submissions', SUBMISSION_ID), {
      submissionId: SUBMISSION_ID,
      verificationId: VERIFICATION_ID,
      studentUid: STUDENT_UID,
      ownerUid,
      status,
      answers: {
        '0': { tipo: 'aperta', testo: 'risposta 1' },
        '1': { tipo: 'aperta', testo: 'risposta 2' },
      },
      flagged: {},
      attentionEvents: [],
      deliveryCode: status === 'submitted' ? 'SF-2026-AAAA' : null,
      verificationTitle: 'Verifica 1',
      className: 'Classe A',
      startedAt: Timestamp.now(),
      lastSavedAt: serverTimestamp(),
      submittedAt: status === 'submitted' ? Timestamp.now() : null,
    });
  });
}

async function seedSubmissionReceipt() {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'submissionReceipts', SUBMISSION_ID), {
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

function correctionPayload(overrides: Record<string, unknown> = {}) {
  return {
    submissionId: SUBMISSION_ID,
    verificationId: VERIFICATION_ID,
    studentUid: STUDENT_UID,
    ownerUid: OWNER_UID,
    status: 'in_progress',
    evaluations: {
      '0': { order: 0, points: null, maxPoints: 10 },
      '1': { order: 1, points: null, maxPoints: 5 },
    },
    generalFeedback: null,
    totalPoints: 0,
    maxPoints: 15,
    percentage: 0,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    completedAt: null,
    returnedAt: null,
    reopenCount: 0,
    ...overrides,
  };
}

async function seedCorrection(overrides: Record<string, unknown> = {}) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'corrections', SUBMISSION_ID), correctionPayload(overrides));
  });
}

async function seedCompletedCorrection() {
  await seedCorrection({
    status: 'completed',
    evaluations: {
      '0': { order: 0, points: 8, maxPoints: 10 },
      '1': { order: 1, points: 4, maxPoints: 5 },
    },
    totalPoints: 12,
    maxPoints: 15,
    percentage: 80,
    completedAt: Timestamp.now(),
  });
}

function returnPayload(overrides: Record<string, unknown> = {}) {
  return {
    correctionId: SUBMISSION_ID,
    verificationId: VERIFICATION_ID,
    studentUid: STUDENT_UID,
    ownerUid: OWNER_UID,
    verificationTitle: 'Verifica 1',
    className: 'Classe A',
    submittedAt: Timestamp.now(),
    returnedAt: serverTimestamp(),
    questions: [
      {
        order: 0,
        tipo: 'aperta',
        testo: 'D1',
        studentAnswer: { tipo: 'aperta', testo: 'r1' },
        points: 8,
        maxPoints: 10,
      },
      {
        order: 1,
        tipo: 'aperta',
        testo: 'D2',
        studentAnswer: { tipo: 'aperta', testo: 'r2' },
        points: 4,
        maxPoints: 5,
      },
    ],
    generalFeedback: null,
    totalPoints: 12,
    maxPoints: 15,
    percentage: 80,
    visibleToStudent: true,
    solutionsVisible: false,
    updatedAt: serverTimestamp(),
    ...overrides,
  };
}

async function seedReturn(overrides: Record<string, unknown> = {}) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(
      doc(ctx.firestore(), 'correctionReturns', SUBMISSION_ID),
      returnPayload(overrides),
    );
  });
}

// ─── corrections: create ─────────────────────────────────────────────────────

describe('Firestore rules — corrections create', () => {
  it('allows the owner to read a not-yet-created deterministic correction path', async () => {
    await seedBase();
    await assertSucceeds(getDoc(doc(ownerDb(), 'corrections', SUBMISSION_ID)));
  });

  it('never allows a student to probe a missing correction path', async () => {
    await seedBase();
    await assertFails(getDoc(doc(studentDb(), 'corrections', SUBMISSION_ID)));
  });

  it('the owner can create a correction for their own submitted submission', async () => {
    await seedBase();
    await seedSubmittedSubmission();

    await assertSucceeds(setDoc(doc(ownerDb(), 'corrections', SUBMISSION_ID), correctionPayload()));
  });

  it('rejects create when the submission is still draft', async () => {
    await seedBase();
    await seedSubmittedSubmission({ status: 'draft' });

    await assertFails(setDoc(doc(ownerDb(), 'corrections', SUBMISSION_ID), correctionPayload()));
  });

  it('rejects create when the submission does not exist', async () => {
    await seedBase();

    await assertFails(setDoc(doc(ownerDb(), 'corrections', SUBMISSION_ID), correctionPayload()));
  });

  it("rejects create for a submission belonging to a different owner's verification", async () => {
    await seedBase();
    await seedSubmittedSubmission({ ownerUid: OTHER_OWNER_UID });

    await assertFails(setDoc(doc(ownerDb(), 'corrections', SUBMISSION_ID), correctionPayload()));
  });

  it('rejects create with a non-in_progress initial status', async () => {
    await seedBase();
    await seedSubmittedSubmission();

    await assertFails(
      setDoc(
        doc(ownerDb(), 'corrections', SUBMISSION_ID),
        correctionPayload({ status: 'completed' }),
      ),
    );
  });

  it('rejects create with a non-zero initial reopenCount', async () => {
    await seedBase();
    await seedSubmittedSubmission();

    await assertFails(
      setDoc(doc(ownerDb(), 'corrections', SUBMISSION_ID), correctionPayload({ reopenCount: 1 })),
    );
  });

  it('rejects create with a non-null completedAt/returnedAt', async () => {
    await seedBase();
    await seedSubmittedSubmission();

    await assertFails(
      setDoc(
        doc(ownerDb(), 'corrections', SUBMISSION_ID),
        correctionPayload({ completedAt: Timestamp.now() }),
      ),
    );
  });

  it('rejects create with an extra unexpected field', async () => {
    await seedBase();
    await seedSubmittedSubmission();

    await assertFails(
      setDoc(doc(ownerDb(), 'corrections', SUBMISSION_ID), correctionPayload({ hacked: true })),
    );
  });

  it('rejects create from a different owner', async () => {
    await seedBase();
    await seedSubmittedSubmission();

    const otherOwnerDb = testEnv
      .authenticatedContext(OTHER_OWNER_UID)
      .firestore() as unknown as Firestore;
    await assertFails(setDoc(doc(otherOwnerDb, 'corrections', SUBMISSION_ID), correctionPayload()));
  });

  it('a student can never create a correction', async () => {
    await seedBase();
    await seedSubmittedSubmission();

    await assertFails(setDoc(doc(studentDb(), 'corrections', SUBMISSION_ID), correctionPayload()));
  });
});

// ─── corrections: update / transitions ──────────────────────────────────────

describe('Firestore rules — corrections update and transitions', () => {
  it('allows a plain in_progress save (evaluations/generalFeedback/totals change, status unchanged)', async () => {
    await seedBase();
    await seedSubmittedSubmission();
    await seedCorrection();

    await assertSucceeds(
      updateDoc(doc(ownerDb(), 'corrections', SUBMISSION_ID), {
        evaluations: {
          '0': { order: 0, points: 7, maxPoints: 10 },
          '1': { order: 1, points: null, maxPoints: 5 },
        },
        totalPoints: 7,
        maxPoints: 15,
        percentage: 47,
        updatedAt: serverTimestamp(),
      }),
    );
  });

  it('allows in_progress -> completed with completedAt set to now', async () => {
    await seedBase();
    await seedSubmittedSubmission();
    await seedCorrection({
      evaluations: {
        '0': { order: 0, points: 8, maxPoints: 10 },
        '1': { order: 1, points: 4, maxPoints: 5 },
      },
      totalPoints: 12,
      maxPoints: 15,
      percentage: 80,
    });

    await assertSucceeds(
      updateDoc(doc(ownerDb(), 'corrections', SUBMISSION_ID), {
        status: 'completed',
        completedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }),
    );
  });

  it('allows completed -> returned with returnedAt set to now', async () => {
    await seedBase();
    await seedSubmittedSubmission();
    await seedCompletedCorrection();

    await assertSucceeds(
      updateDoc(doc(ownerDb(), 'corrections', SUBMISSION_ID), {
        status: 'returned',
        returnedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }),
    );
  });

  it('allows completed -> in_progress (reopen), incrementing reopenCount by exactly 1 and clearing timestamps', async () => {
    await seedBase();
    await seedSubmittedSubmission();
    await seedCompletedCorrection();

    await assertSucceeds(
      updateDoc(doc(ownerDb(), 'corrections', SUBMISSION_ID), {
        status: 'in_progress',
        completedAt: null,
        returnedAt: null,
        reopenCount: 1,
        updatedAt: serverTimestamp(),
      }),
    );
  });

  it('rejects completed -> in_progress that increments reopenCount by more than 1', async () => {
    await seedBase();
    await seedSubmittedSubmission();
    await seedCompletedCorrection();

    await assertFails(
      updateDoc(doc(ownerDb(), 'corrections', SUBMISSION_ID), {
        status: 'in_progress',
        completedAt: null,
        returnedAt: null,
        reopenCount: 2,
        updatedAt: serverTimestamp(),
      }),
    );
  });

  it('allows returned -> in_progress (reopen)', async () => {
    await seedBase();
    await seedSubmittedSubmission();
    await seedCorrection({
      status: 'returned',
      evaluations: {
        '0': { order: 0, points: 8, maxPoints: 10 },
        '1': { order: 1, points: 4, maxPoints: 5 },
      },
      totalPoints: 12,
      maxPoints: 15,
      percentage: 80,
      completedAt: Timestamp.now(),
      returnedAt: Timestamp.now(),
    });

    await assertSucceeds(
      updateDoc(doc(ownerDb(), 'corrections', SUBMISSION_ID), {
        status: 'in_progress',
        completedAt: null,
        returnedAt: null,
        reopenCount: 1,
        updatedAt: serverTimestamp(),
      }),
    );
  });

  it('rejects returned -> completed directly', async () => {
    await seedBase();
    await seedSubmittedSubmission();
    await seedCorrection({
      status: 'returned',
      evaluations: {
        '0': { order: 0, points: 8, maxPoints: 10 },
        '1': { order: 1, points: 4, maxPoints: 5 },
      },
      completedAt: Timestamp.now(),
      returnedAt: Timestamp.now(),
    });

    await assertFails(
      updateDoc(doc(ownerDb(), 'corrections', SUBMISSION_ID), {
        status: 'completed',
        updatedAt: serverTimestamp(),
      }),
    );
  });

  it('rejects in_progress -> returned directly', async () => {
    await seedBase();
    await seedSubmittedSubmission();
    await seedCorrection();

    await assertFails(
      updateDoc(doc(ownerDb(), 'corrections', SUBMISSION_ID), {
        status: 'returned',
        returnedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }),
    );
  });

  it('rejects a plain save that also changes status away from in_progress incoherently mid-save (same-status branch requires status unchanged)', async () => {
    await seedBase();
    await seedSubmittedSubmission();
    await seedCompletedCorrection();

    // status stays 'completed' but reopenCount/timestamps are touched as if reopening — invalid same-status write.
    await assertFails(
      updateDoc(doc(ownerDb(), 'corrections', SUBMISSION_ID), {
        reopenCount: 1,
        updatedAt: serverTimestamp(),
      }),
    );
  });

  it.each([
    ['submissionId', { submissionId: 'other_id' }],
    ['verificationId', { verificationId: 'other-verification' }],
    ['studentUid', { studentUid: OTHER_STUDENT_UID }],
    ['ownerUid', { ownerUid: OTHER_OWNER_UID }],
    ['createdAt', { createdAt: Timestamp.now() }],
  ])('rejects an update that tries to change the immutable field %s', async (_field, patch) => {
    await seedBase();
    await seedSubmittedSubmission();
    await seedCorrection();

    await assertFails(
      updateDoc(doc(ownerDb(), 'corrections', SUBMISSION_ID), {
        ...patch,
        updatedAt: serverTimestamp(),
      }),
    );
  });

  it('rejects an update from a different owner', async () => {
    await seedBase();
    await seedSubmittedSubmission();
    await seedCorrection();

    const otherOwnerDb = testEnv
      .authenticatedContext(OTHER_OWNER_UID)
      .firestore() as unknown as Firestore;
    await assertFails(
      updateDoc(doc(otherOwnerDb, 'corrections', SUBMISSION_ID), {
        generalFeedback: 'intruso',
        updatedAt: serverTimestamp(),
      }),
    );
  });

  it('a student can never update a correction', async () => {
    await seedBase();
    await seedSubmittedSubmission();
    await seedCorrection();

    await assertFails(
      updateDoc(doc(studentDb(), 'corrections', SUBMISSION_ID), {
        generalFeedback: 'intruso',
        updatedAt: serverTimestamp(),
      }),
    );
  });

  it('the owner can delete a correction (M4-LIFE-02); a student cannot', async () => {
    await seedBase();
    await seedSubmittedSubmission();
    await seedCorrection();

    await assertFails(deleteDoc(doc(studentDb(), 'corrections', SUBMISSION_ID)));
    await assertSucceeds(deleteDoc(doc(ownerDb(), 'corrections', SUBMISSION_ID)));
  });
});

// ─── corrections: reads and isolation ───────────────────────────────────────

describe('Firestore rules — corrections reads and isolation', () => {
  it('the owner can read their own correction', async () => {
    await seedBase();
    await seedSubmittedSubmission();
    await seedCorrection();

    await assertSucceeds(getDoc(doc(ownerDb(), 'corrections', SUBMISSION_ID)));
  });

  it("a different owner cannot read another owner's correction", async () => {
    await seedBase();
    await seedSubmittedSubmission();
    await seedCorrection();

    const otherOwnerDb = testEnv
      .authenticatedContext(OTHER_OWNER_UID)
      .firestore() as unknown as Firestore;
    await assertFails(getDoc(doc(otherOwnerDb, 'corrections', SUBMISSION_ID)));
  });

  it('a student, even the one being corrected, can never read a correction', async () => {
    await seedBase();
    await seedSubmittedSubmission();
    await seedCorrection();

    await assertFails(getDoc(doc(studentDb(), 'corrections', SUBMISSION_ID)));
  });
});

// ─── correctionEvents ────────────────────────────────────────────────────────

describe('Firestore rules — correctionEvents', () => {
  function eventPayload(overrides: Record<string, unknown> = {}) {
    return {
      correctionId: SUBMISSION_ID,
      ownerUid: OWNER_UID,
      type: 'reopened',
      actorUid: OWNER_UID,
      previousStatus: 'completed',
      nextStatus: 'in_progress',
      reason: null,
      timestamp: serverTimestamp(),
      ...overrides,
    };
  }

  it('the owner can append an event tied to their own correction', async () => {
    await seedBase();
    await seedSubmittedSubmission();
    await seedCorrection();

    await assertSucceeds(setDoc(doc(ownerDb(), 'correctionEvents', 'event-1'), eventPayload()));
  });

  it('rejects an event whose correctionId does not point to an existing correction', async () => {
    await seedBase();

    await assertFails(setDoc(doc(ownerDb(), 'correctionEvents', 'event-1'), eventPayload()));
  });

  it("rejects an event tied to another owner's correction", async () => {
    await seedBase();
    await seedSubmittedSubmission();
    await seedCorrection();

    const otherOwnerDb = testEnv
      .authenticatedContext(OTHER_OWNER_UID)
      .firestore() as unknown as Firestore;
    await assertFails(setDoc(doc(otherOwnerDb, 'correctionEvents', 'event-1'), eventPayload()));
  });

  it('rejects an event with an unrecognized type', async () => {
    await seedBase();
    await seedSubmittedSubmission();
    await seedCorrection();

    await assertFails(
      setDoc(doc(ownerDb(), 'correctionEvents', 'event-1'), eventPayload({ type: 'hidden' })),
    );
  });

  it('rejects an event whose actorUid does not match the caller', async () => {
    await seedBase();
    await seedSubmittedSubmission();
    await seedCorrection();

    await assertFails(
      setDoc(
        doc(ownerDb(), 'correctionEvents', 'event-1'),
        eventPayload({ actorUid: OTHER_OWNER_UID }),
      ),
    );
  });

  it('a student can never read or create a correctionEvents entry', async () => {
    await seedBase();
    await seedSubmittedSubmission();
    await seedCorrection();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'correctionEvents', 'event-1'), eventPayload());
    });

    await assertFails(setDoc(doc(studentDb(), 'correctionEvents', 'event-2'), eventPayload()));
    await assertFails(getDoc(doc(studentDb(), 'correctionEvents', 'event-1')));
  });

  it('append-only: an event can never be updated; the owner may delete it (M4-LIFE-02), a student cannot', async () => {
    await seedBase();
    await seedSubmittedSubmission();
    await seedCorrection();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'correctionEvents', 'event-1'), eventPayload());
    });

    await assertFails(
      updateDoc(doc(ownerDb(), 'correctionEvents', 'event-1'), { reason: 'tampered' }),
    );
    await assertFails(deleteDoc(doc(studentDb(), 'correctionEvents', 'event-1')));
    await assertSucceeds(deleteDoc(doc(ownerDb(), 'correctionEvents', 'event-1')));
  });

  it('rejects an event with an arbitrary (non-server) timestamp', async () => {
    await seedBase();
    await seedSubmittedSubmission();
    await seedCorrection(); // in_progress

    await assertFails(
      setDoc(
        doc(ownerDb(), 'correctionEvents', 'event-1'),
        eventPayload({ timestamp: Timestamp.now() }),
      ),
    );
  });

  it('allows a scoreAdjusted event when previousStatus/nextStatus are both in_progress', async () => {
    await seedBase();
    await seedSubmittedSubmission();
    await seedCorrection({ status: 'in_progress', reopenCount: 1 });

    await assertSucceeds(
      setDoc(
        doc(ownerDb(), 'correctionEvents', 'event-1'),
        eventPayload({
          type: 'scoreAdjusted',
          previousStatus: 'in_progress',
          nextStatus: 'in_progress',
        }),
      ),
    );
  });

  // ─── M5-04C: correctionCleared ─────────────────────────────────────────────
  it('allows a correctionCleared event (in_progress → in_progress) on an in_progress correction', async () => {
    await seedBase();
    await seedSubmittedSubmission();
    await seedCorrection({ status: 'in_progress' });

    await assertSucceeds(
      setDoc(
        doc(ownerDb(), 'correctionEvents', 'event-1'),
        eventPayload({
          type: 'correctionCleared',
          previousStatus: 'in_progress',
          nextStatus: 'in_progress',
        }),
      ),
    );
  });

  it('rejects a correctionCleared event from a non-owner', async () => {
    await seedBase();
    await seedSubmittedSubmission();
    await seedCorrection({ status: 'in_progress' });
    const otherOwnerDb = testEnv
      .authenticatedContext(OTHER_OWNER_UID)
      .firestore() as unknown as Firestore;

    await assertFails(
      setDoc(
        doc(otherOwnerDb, 'correctionEvents', 'event-1'),
        eventPayload({
          type: 'correctionCleared',
          previousStatus: 'in_progress',
          nextStatus: 'in_progress',
        }),
      ),
    );
  });

  it('rejects a correctionCleared event with an arbitrary (non-server) timestamp', async () => {
    await seedBase();
    await seedSubmittedSubmission();
    await seedCorrection({ status: 'in_progress' });

    await assertFails(
      setDoc(
        doc(ownerDb(), 'correctionEvents', 'event-1'),
        eventPayload({
          type: 'correctionCleared',
          previousStatus: 'in_progress',
          nextStatus: 'in_progress',
          timestamp: Timestamp.fromMillis(0),
        }),
      ),
    );
  });

  it.each([
    [
      'scoreAdjusted claiming a status change',
      { type: 'scoreAdjusted', previousStatus: 'in_progress', nextStatus: 'completed' },
    ],
    [
      'reopened with an invalid previousStatus',
      { type: 'reopened', previousStatus: 'in_progress', nextStatus: 'in_progress' },
    ],
    [
      'returned with an invalid previousStatus',
      { type: 'returned', previousStatus: 'in_progress', nextStatus: 'returned' },
    ],
    [
      'reopened whose nextStatus is not in_progress',
      { type: 'reopened', previousStatus: 'completed', nextStatus: 'completed' },
    ],
    [
      'correctionCleared with a non-in_progress previousStatus',
      { type: 'correctionCleared', previousStatus: 'completed', nextStatus: 'in_progress' },
    ],
    [
      'correctionCleared claiming a status change',
      { type: 'correctionCleared', previousStatus: 'in_progress', nextStatus: 'completed' },
    ],
  ])(
    'rejects an incoherent type/previousStatus/nextStatus combination (%s)',
    async (_label, overrides) => {
      await seedBase();
      await seedSubmittedSubmission();
      await seedCorrection(); // in_progress

      await assertFails(
        setDoc(doc(ownerDb(), 'correctionEvents', 'event-1'), eventPayload(overrides)),
      );
    },
  );

  it("rejects a 'returned' event whose nextStatus does not match the correction's actual status", async () => {
    await seedBase();
    await seedSubmittedSubmission();
    await seedCorrection(); // in_progress, not 'returned'

    await assertFails(
      setDoc(
        doc(ownerDb(), 'correctionEvents', 'event-1'),
        eventPayload({ type: 'returned', previousStatus: 'completed', nextStatus: 'returned' }),
      ),
    );
  });

  it("accepts a 'returned' event when nextStatus matches the correction's actual (already returned) status", async () => {
    await seedBase();
    await seedSubmittedSubmission();
    await seedCorrection({
      status: 'returned',
      evaluations: {
        '0': { order: 0, points: 8, maxPoints: 10 },
        '1': { order: 1, points: 4, maxPoints: 5 },
      },
      completedAt: Timestamp.now(),
      returnedAt: Timestamp.now(),
    });

    await assertSucceeds(
      setDoc(
        doc(ownerDb(), 'correctionEvents', 'event-1'),
        eventPayload({ type: 'returned', previousStatus: 'completed', nextStatus: 'returned' }),
      ),
    );
  });
});

// ─── correctionReturns ───────────────────────────────────────────────────────

/** A completed correction's evaluations, matching seedCompletedCorrection(). */
const COMPLETED_EVALUATIONS = {
  '0': { order: 0, points: 8, maxPoints: 10 },
  '1': { order: 1, points: 4, maxPoints: 5 },
};

async function seedReturnedCorrection() {
  await seedCorrection({
    status: 'returned',
    evaluations: COMPLETED_EVALUATIONS,
    totalPoints: 12,
    maxPoints: 15,
    percentage: 80,
    completedAt: Timestamp.now(),
    returnedAt: Timestamp.now(),
  });
}

/** Mirrors returnCorrection(): correction completed -> returned + correctionReturns create/set, atomically. */
async function returnBatch(
  db: Firestore,
  options: { returnOverrides?: Record<string, unknown> } = {},
) {
  const batch = writeBatch(db);
  batch.update(doc(db, 'corrections', SUBMISSION_ID), {
    status: 'returned',
    returnedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  batch.set(doc(db, 'correctionReturns', SUBMISSION_ID), returnPayload(options.returnOverrides));
  await batch.commit();
}

describe('Firestore rules — correctionReturns', () => {
  it('allows the owner to read a return projection that does not exist yet', async () => {
    await seedBase();
    await assertSucceeds(getDoc(doc(ownerDb(), 'correctionReturns', SUBMISSION_ID)));
  });

  it('never allows a student to probe a missing return projection', async () => {
    await seedBase();
    await assertFails(getDoc(doc(studentDb(), 'correctionReturns', SUBMISSION_ID)));
  });

  it('the owner can create a return projection atomically with the completed -> returned transition (returnCorrection)', async () => {
    await seedBase();
    await seedSubmittedSubmission();
    await seedCompletedCorrection();

    await assertSucceeds(returnBatch(ownerDb()));
  });

  it('rejects creating a return projection without transitioning the correction to returned in the same operation', async () => {
    await seedBase();
    await seedSubmittedSubmission();
    await seedCompletedCorrection();

    await assertFails(setDoc(doc(ownerDb(), 'correctionReturns', SUBMISSION_ID), returnPayload()));
  });

  it('rejects create when no matching correction exists', async () => {
    await seedBase();

    await assertFails(setDoc(doc(ownerDb(), 'correctionReturns', SUBMISSION_ID), returnPayload()));
  });

  it("rejects create tied to another owner's correction", async () => {
    await seedBase();
    await seedSubmittedSubmission();
    await seedCompletedCorrection();

    const otherOwnerDb = testEnv
      .authenticatedContext(OTHER_OWNER_UID)
      .firestore() as unknown as Firestore;
    await assertFails(
      setDoc(doc(otherOwnerDb, 'correctionReturns', SUBMISSION_ID), returnPayload()),
    );
  });

  it('a student can never create a return projection', async () => {
    await seedBase();
    await seedSubmittedSubmission();
    await seedCompletedCorrection();

    await assertFails(
      setDoc(doc(studentDb(), 'correctionReturns', SUBMISSION_ID), returnPayload()),
    );
  });

  it('the owner can flip visibleToStudent on an existing projection while the correction is returned', async () => {
    await seedBase();
    await seedSubmittedSubmission();
    await seedReturnedCorrection();
    await seedReturn();

    await assertSucceeds(
      updateDoc(doc(ownerDb(), 'correctionReturns', SUBMISSION_ID), {
        visibleToStudent: false,
        updatedAt: serverTimestamp(),
      }),
    );
  });

  it('the owner can rewrite questions when revealing solutions while the correction is returned', async () => {
    await seedBase();
    await seedSubmittedSubmission();
    await seedReturnedCorrection();
    await seedReturn();

    await assertSucceeds(
      updateDoc(doc(ownerDb(), 'correctionReturns', SUBMISSION_ID), {
        questions: [
          {
            order: 0,
            tipo: 'aperta',
            testo: 'D1',
            studentAnswer: { tipo: 'aperta', testo: 'r1' },
            points: 8,
            maxPoints: 10,
            correctAnswer: 'sol0',
          },
        ],
        solutionsVisible: true,
        updatedAt: serverTimestamp(),
      }),
    );
  });

  it('rejects a plain update to correctionReturns while the correction is in_progress (stale projection after reopen)', async () => {
    await seedBase();
    await seedSubmittedSubmission();
    await seedCorrection({ status: 'in_progress', reopenCount: 1 });
    await seedReturn({ visibleToStudent: false });

    await assertFails(
      updateDoc(doc(ownerDb(), 'correctionReturns', SUBMISSION_ID), {
        visibleToStudent: true,
        updatedAt: serverTimestamp(),
      }),
    );
  });

  it('rejects a plain update to correctionReturns while the correction is completed (not yet returned again)', async () => {
    await seedBase();
    await seedSubmittedSubmission();
    await seedCompletedCorrection();
    await seedReturn({ visibleToStudent: false });

    await assertFails(
      updateDoc(doc(ownerDb(), 'correctionReturns', SUBMISSION_ID), {
        visibleToStudent: true,
        updatedAt: serverTimestamp(),
      }),
    );
  });

  it('allows reopenCorrection to atomically hide the projection when the correction leaves returned -> in_progress', async () => {
    await seedBase();
    await seedSubmittedSubmission();
    await seedReturnedCorrection();
    await seedReturn({ visibleToStudent: true });

    const db = ownerDb();
    const batch = writeBatch(db);
    batch.update(doc(db, 'corrections', SUBMISSION_ID), {
      status: 'in_progress',
      completedAt: null,
      returnedAt: null,
      reopenCount: 1,
      updatedAt: serverTimestamp(),
    });
    batch.update(doc(db, 'correctionReturns', SUBMISSION_ID), {
      visibleToStudent: false,
      updatedAt: serverTimestamp(),
    });
    await assertSucceeds(batch.commit());
  });

  it('rejects the reopen-hide batch if it also touches scoring content, not just visibleToStudent/updatedAt', async () => {
    await seedBase();
    await seedSubmittedSubmission();
    await seedReturnedCorrection();
    await seedReturn({ visibleToStudent: true });

    const db = ownerDb();
    const batch = writeBatch(db);
    batch.update(doc(db, 'corrections', SUBMISSION_ID), {
      status: 'in_progress',
      completedAt: null,
      returnedAt: null,
      reopenCount: 1,
      updatedAt: serverTimestamp(),
    });
    batch.update(doc(db, 'correctionReturns', SUBMISSION_ID), {
      visibleToStudent: false,
      generalFeedback: 'tampered during reopen',
      updatedAt: serverTimestamp(),
    });
    await assertFails(batch.commit());
  });

  it('rejects the reopen-hide batch if visibleToStudent is not set to false', async () => {
    await seedBase();
    await seedSubmittedSubmission();
    await seedReturnedCorrection();
    await seedReturn({ visibleToStudent: true });

    const db = ownerDb();
    const batch = writeBatch(db);
    batch.update(doc(db, 'corrections', SUBMISSION_ID), {
      status: 'in_progress',
      completedAt: null,
      returnedAt: null,
      reopenCount: 1,
      updatedAt: serverTimestamp(),
    });
    batch.update(doc(db, 'correctionReturns', SUBMISSION_ID), {
      visibleToStudent: true,
      updatedAt: serverTimestamp(),
    });
    await assertFails(batch.commit());
  });

  it.each([
    ['correctionId', { correctionId: 'other-id' }],
    ['verificationId', { verificationId: 'other-verification' }],
    ['studentUid', { studentUid: OTHER_STUDENT_UID }],
    ['ownerUid', { ownerUid: OTHER_OWNER_UID }],
  ])('rejects an update that tries to change the immutable field %s', async (_field, patch) => {
    await seedBase();
    await seedSubmittedSubmission();
    await seedReturnedCorrection();
    await seedReturn();

    await assertFails(
      updateDoc(doc(ownerDb(), 'correctionReturns', SUBMISSION_ID), {
        ...patch,
        updatedAt: serverTimestamp(),
      }),
    );
  });

  it('a student can never write a return projection, including their own visible one', async () => {
    await seedBase();
    await seedSubmittedSubmission();
    await seedCompletedCorrection();
    await seedReturn();

    await assertFails(
      updateDoc(doc(studentDb(), 'correctionReturns', SUBMISSION_ID), {
        visibleToStudent: false,
        updatedAt: serverTimestamp(),
      }),
    );
  });

  it('nobody can delete a return projection (M5-06B): neither student nor owner', async () => {
    await seedBase();
    await seedSubmittedSubmission();
    await seedCompletedCorrection();
    await seedReturn();

    // M5-06B — a returned projection is permanent evidence and is never deleted
    // by the normal flow; deletion is denied outright (see firestore.rules).
    await assertFails(deleteDoc(doc(studentDb(), 'correctionReturns', SUBMISSION_ID)));
    await assertFails(deleteDoc(doc(ownerDb(), 'correctionReturns', SUBMISSION_ID)));
  });

  it('the owner can always read the return projection', async () => {
    await seedBase();
    await seedSubmittedSubmission();
    await seedCompletedCorrection();
    await seedReturn();

    await assertSucceeds(getDoc(doc(ownerDb(), 'correctionReturns', SUBMISSION_ID)));
  });

  it('the student can read their own return projection when visible', async () => {
    await seedBase();
    await seedSubmittedSubmission();
    await seedCompletedCorrection();
    await seedReturn({ visibleToStudent: true });

    await assertSucceeds(getDoc(doc(studentDb(), 'correctionReturns', SUBMISSION_ID)));
  });

  it('the student cannot read their own return projection when hidden', async () => {
    await seedBase();
    await seedSubmittedSubmission();
    await seedCompletedCorrection();
    await seedReturn({ visibleToStudent: false });

    await assertFails(getDoc(doc(studentDb(), 'correctionReturns', SUBMISSION_ID)));
  });

  it("a different student cannot read another student's return projection, even when visible", async () => {
    await seedBase();
    await seedSubmittedSubmission();
    await seedCompletedCorrection();
    await seedReturn({ visibleToStudent: true });

    await assertFails(
      getDoc(doc(studentDb(OTHER_STUDENT_UID), 'correctionReturns', SUBMISSION_ID)),
    );
  });

  it("a different owner cannot read another owner's return projection", async () => {
    await seedBase();
    await seedSubmittedSubmission();
    await seedCompletedCorrection();
    await seedReturn();

    const otherOwnerDb = testEnv
      .authenticatedContext(OTHER_OWNER_UID)
      .firestore() as unknown as Firestore;
    await assertFails(getDoc(doc(otherOwnerDb, 'correctionReturns', SUBMISSION_ID)));
  });
});

// ─── correctionReturns: student list query (M4-02B) ─────────────────────────

describe('Firestore rules — correctionReturns student list query', () => {
  it(
    'allows the exact query studentCorrectionReturnsService uses: ' +
      'studentUid == uid AND visibleToStudent == true (ordering is done in JS, not on the query)',
    async () => {
      await seedBase();
      await seedSubmittedSubmission();
      await seedCompletedCorrection();
      await seedReturn({ visibleToStudent: true });

      await assertSucceeds(
        getDocs(
          query(
            collection(studentDb(), 'correctionReturns'),
            where('studentUid', '==', STUDENT_UID),
            where('visibleToStudent', '==', true),
          ),
        ),
      );
    },
  );

  it('rejects a query missing the visibleToStudent filter', async () => {
    await seedBase();
    await seedSubmittedSubmission();
    await seedCompletedCorrection();
    await seedReturn({ visibleToStudent: true });

    await assertFails(
      getDocs(
        query(collection(studentDb(), 'correctionReturns'), where('studentUid', '==', STUDENT_UID)),
      ),
    );
  });

  it('rejects a query missing the studentUid filter', async () => {
    await seedBase();
    await seedSubmittedSubmission();
    await seedCompletedCorrection();
    await seedReturn({ visibleToStudent: true });

    await assertFails(
      getDocs(
        query(collection(studentDb(), 'correctionReturns'), where('visibleToStudent', '==', true)),
      ),
    );
  });

  it("does not return another student's visible return in the caller's own query", async () => {
    await seedBase();
    await seedSubmittedSubmission();
    await seedCompletedCorrection();
    await seedReturn({ visibleToStudent: true });

    const otherStudentSnap = await getDocs(
      query(
        collection(studentDb(OTHER_STUDENT_UID), 'correctionReturns'),
        where('studentUid', '==', OTHER_STUDENT_UID),
        where('visibleToStudent', '==', true),
      ),
    );
    // Not a rules failure (the query itself is well-formed and allowed) —
    // simply no documents belong to this student, matching the isolation
    // already covered by the single-doc get() tests above.
    await assertSucceeds(Promise.resolve(otherStudentSnap));
    if (otherStudentSnap.size !== 0) {
      throw new Error('expected no results for a different student');
    }
  });

  it("rejects a query with the caller's own studentUid but visibleToStudent left unfiltered (would leak hidden returns)", async () => {
    await seedBase();
    await seedSubmittedSubmission();
    await seedCompletedCorrection();
    await seedReturn({ visibleToStudent: false });

    await assertFails(
      getDocs(
        query(collection(studentDb(), 'correctionReturns'), where('studentUid', '==', STUDENT_UID)),
      ),
    );
  });
});

describe('Firestore rules — public correction status mirrors', () => {
  it('allows the exact completeCorrection batch without a redundant score-summary rewrite', async () => {
    await seedBase();
    await seedSubmittedSubmission();
    await seedSubmissionReceipt();
    await seedCorrection({
      evaluations: {
        '0': { order: 0, points: 8, maxPoints: 10 },
        '1': { order: 1, points: 4, maxPoints: 5 },
      },
      totalPoints: 12,
      maxPoints: 15,
      percentage: 80,
    });

    const db = ownerDb();
    const batch = writeBatch(db);
    const statusUpdatedAt = serverTimestamp();
    batch.update(doc(db, 'corrections', SUBMISSION_ID), {
      status: 'completed',
      completedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    batch.update(doc(db, 'submissions', SUBMISSION_ID), {
      correctionStatus: 'completed',
      correctionStatusUpdatedAt: statusUpdatedAt,
    });
    batch.update(doc(db, 'submissionReceipts', SUBMISSION_ID), {
      correctionStatus: 'completed',
      correctionStatusUpdatedAt: statusUpdatedAt,
    });

    await assertSucceeds(batch.commit());
  });

  it('allows the owner to update submission and receipt atomically to the same valid state', async () => {
    await seedBase();
    await seedSubmittedSubmission();
    await seedSubmissionReceipt();
    await seedCorrection();

    const db = ownerDb();
    const batch = writeBatch(db);
    const update = {
      correctionStatus: 'in_progress',
      correctionStatusUpdatedAt: serverTimestamp(),
    };
    batch.update(doc(db, 'submissions', SUBMISSION_ID), update);
    batch.update(doc(db, 'submissionReceipts', SUBMISSION_ID), update);
    await assertSucceeds(batch.commit());
  });

  it('rejects updating only one of the two mirrors', async () => {
    await seedBase();
    await seedSubmittedSubmission();
    await seedSubmissionReceipt();
    await seedCorrection();

    await assertFails(
      updateDoc(doc(ownerDb(), 'submissions', SUBMISSION_ID), {
        correctionStatus: 'in_progress',
        correctionStatusUpdatedAt: serverTimestamp(),
      }),
    );
  });

  it('never lets the student alter the correction-state mirror', async () => {
    await seedBase();
    await seedSubmittedSubmission();
    await seedSubmissionReceipt();
    await seedCorrection();

    await assertFails(
      updateDoc(doc(studentDb(), 'submissionReceipts', SUBMISSION_ID), {
        correctionStatus: 'returned',
        correctionStatusUpdatedAt: serverTimestamp(),
      }),
    );
  });

  it('allows the owner to write a valid score summary only on the submitted submission', async () => {
    await seedBase();
    await seedSubmittedSubmission();

    await assertSucceeds(
      updateDoc(doc(ownerDb(), 'submissions', SUBMISSION_ID), {
        correctionSummary: { totalPoints: 7.25, maxPoints: 10, percentage: 73 },
        correctionSummaryUpdatedAt: serverTimestamp(),
      }),
    );
  });

  it('allows one atomic submission update to combine status and summary while the receipt mirrors only status', async () => {
    await seedBase();
    await seedSubmittedSubmission();
    await seedSubmissionReceipt();
    await seedCorrection();

    const db = ownerDb();
    const batch = writeBatch(db);
    const statusUpdate = {
      correctionStatus: 'in_progress',
      correctionStatusUpdatedAt: serverTimestamp(),
    };
    batch.update(doc(db, 'submissions', SUBMISSION_ID), {
      ...statusUpdate,
      correctionSummary: { totalPoints: 7.25, maxPoints: 15, percentage: 48 },
      correctionSummaryUpdatedAt: serverTimestamp(),
    });
    batch.update(doc(db, 'submissionReceipts', SUBMISSION_ID), statusUpdate);
    await assertSucceeds(batch.commit());
  });

  it.each([
    [{ totalPoints: -1, maxPoints: 10, percentage: 0 }],
    [{ totalPoints: 11, maxPoints: 10, percentage: 100 }],
    [{ totalPoints: 1, maxPoints: -1, percentage: 0 }],
    [{ totalPoints: 1, maxPoints: 10, percentage: -1 }],
    [{ totalPoints: 1, maxPoints: 10, percentage: 101 }],
    [{ totalPoints: 0, maxPoints: 0, percentage: 0 }],
    [{ totalPoints: '1', maxPoints: 10, percentage: 10 }],
    [{ totalPoints: 1, maxPoints: 10, percentage: null }],
  ])('rejects an invalid score summary %#', async (correctionSummary) => {
    await seedBase();
    await seedSubmittedSubmission();

    await assertFails(
      updateDoc(doc(ownerDb(), 'submissions', SUBMISSION_ID), {
        correctionSummary,
        correctionSummaryUpdatedAt: serverTimestamp(),
      }),
    );
  });

  it('rejects summary writes from the student, another account, or with unrelated fields', async () => {
    await seedBase();
    await seedSubmittedSubmission();
    const patch = {
      correctionSummary: { totalPoints: 5, maxPoints: 10, percentage: 50 },
      correctionSummaryUpdatedAt: serverTimestamp(),
    };

    await assertFails(updateDoc(doc(studentDb(), 'submissions', SUBMISSION_ID), patch));
    const otherOwnerDb = testEnv.authenticatedContext(OTHER_OWNER_UID).firestore();
    await assertFails(updateDoc(doc(otherOwnerDb, 'submissions', SUBMISSION_ID), patch));
    await assertFails(
      updateDoc(doc(ownerDb(), 'submissions', SUBMISSION_ID), {
        ...patch,
        deliveryCode: 'tampered',
      }),
    );
  });
});
