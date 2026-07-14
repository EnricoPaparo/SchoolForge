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
import { deleteDoc, doc, setDoc, Timestamp } from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import { afterAll, afterEach, beforeAll, describe, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIRESTORE_RULES = resolve(__dirname, '../../../../firestore.rules');

const OWNER_UID = 'owner-uid';
const OTHER_OWNER_UID = 'other-owner-uid';
const STUDENT_UID = 'student-uid';
const VERIFICATION_ID = 'v1';
const SUBMISSION_ID = `${VERIFICATION_ID}_${STUDENT_UID}`;

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-schoolforge-m4-life-02-delete',
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
function otherOwnerDb() {
  return testEnv.authenticatedContext(OTHER_OWNER_UID).firestore() as unknown as Firestore;
}
function studentDb() {
  return testEnv.authenticatedContext(STUDENT_UID).firestore() as unknown as Firestore;
}

async function seedAll() {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'settings/owner'), { ownerUid: OWNER_UID });
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
      status: 'approved',
      classId: 'class-a',
    });
    const base = { ownerUid: OWNER_UID, verificationId: VERIFICATION_ID, studentUid: STUDENT_UID };
    await setDoc(doc(db, 'submissions', SUBMISSION_ID), {
      ...base,
      submissionId: SUBMISSION_ID,
      status: 'submitted',
      answers: {},
      flagged: {},
      attentionEvents: [],
      deliveryCode: 'SF-2026-AAAA',
      verificationTitle: 'V',
      className: 'C',
      startedAt: Timestamp.now(),
      lastSavedAt: Timestamp.now(),
      submittedAt: Timestamp.now(),
    });
    await setDoc(doc(db, 'submissionReceipts', SUBMISSION_ID), {
      ...base,
      submissionId: SUBMISSION_ID,
      verificationTitle: 'V',
      className: 'C',
      deliveryCode: 'SF-2026-AAAA',
      submittedAt: Timestamp.now(),
    });
    await setDoc(doc(db, 'corrections', SUBMISSION_ID), {
      ...base,
      submissionId: SUBMISSION_ID,
      status: 'in_progress',
      evaluations: {},
      generalFeedback: null,
      totalPoints: 0,
      maxPoints: 0,
      percentage: null,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
      completedAt: null,
      returnedAt: null,
      reopenCount: 0,
    });
    await setDoc(doc(db, 'correctionReturns', SUBMISSION_ID), {
      correctionId: SUBMISSION_ID,
      ...base,
      verificationTitle: 'V',
      className: 'C',
      submittedAt: Timestamp.now(),
      returnedAt: Timestamp.now(),
      questions: [],
      generalFeedback: null,
      totalPoints: 0,
      maxPoints: 0,
      percentage: null,
      visibleToStudent: true,
      solutionsVisible: false,
      updatedAt: Timestamp.now(),
    });
    await setDoc(doc(db, 'correctionEvents', 'evt-1'), {
      correctionId: SUBMISSION_ID,
      ownerUid: OWNER_UID,
      type: 'reopened',
      actorUid: OWNER_UID,
      previousStatus: 'completed',
      nextStatus: 'in_progress',
      reason: null,
      timestamp: Timestamp.now(),
    });
  });
}

const PATHS: [string, string][] = [
  ['submissions', SUBMISSION_ID],
  ['submissionReceipts', SUBMISSION_ID],
  ['corrections', SUBMISSION_ID],
  ['correctionReturns', SUBMISSION_ID],
  ['correctionEvents', 'evt-1'],
];

describe('M4-LIFE-02 — owner-only deletion of submission data', () => {
  for (const [collection, id] of PATHS) {
    it(`owner can delete ${collection}/{id}`, async () => {
      await seedAll();
      await assertSucceeds(deleteDoc(doc(ownerDb(), collection, id)));
    });

    it(`a student can NEVER delete ${collection}/{id}`, async () => {
      await seedAll();
      await assertFails(deleteDoc(doc(studentDb(), collection, id)));
    });

    it(`a different owner can NEVER delete ${collection}/{id}`, async () => {
      await seedAll();
      await assertFails(deleteDoc(doc(otherOwnerDb(), collection, id)));
    });
  }
});
