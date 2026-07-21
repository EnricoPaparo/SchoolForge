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
import { doc, getDoc, serverTimestamp, setDoc, Timestamp, updateDoc } from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIRESTORE_RULES = resolve(__dirname, '../../../../firestore.rules');

const OWNER_UID = 'owner-uid';
const STUDENT_UID = 'student-uid';
const OTHER_STUDENT_UID = 'other-student-uid';
const VERIFICATION_ID = 'v1';
const SUBMISSION_ID = `${VERIFICATION_ID}_${STUDENT_UID}`;

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-schoolforge-vex-01b-assigned',
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

function studentDb(uid: string = STUDENT_UID) {
  return testEnv.authenticatedContext(uid).firestore() as unknown as Firestore;
}
function ownerDb() {
  return testEnv.authenticatedContext(OWNER_UID).firestore() as unknown as Firestore;
}

async function seed(distributionMode: 'same_questions' | 'equivalent_variants') {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'settings/owner'), { ownerUid: OWNER_UID });
    await setDoc(doc(db, 'settings/ownerPublic'), { ownerUid: OWNER_UID });
    await setDoc(doc(db, 'settings/studentAccess'), {
      ownerUid: OWNER_UID,
      studentPortalEnabled: true,
      newStudentRequestsEnabled: false,
    });
    for (const uid of [STUDENT_UID, OTHER_STUDENT_UID]) {
      await setDoc(doc(db, 'students', uid), {
        uid,
        ownerUid: OWNER_UID,
        email: `${uid}@example.com`,
        displayName: null,
        status: 'approved',
        classId: 'class-a',
      });
    }
    await setDoc(doc(db, `verifications/${VERIFICATION_ID}`), {
      ownerUid: OWNER_UID,
      status: 'active',
      visibility: 'public',
      onlineEnabled: true,
      config: { title: 'V', classId: 'class-a', programId: 'p1', importId: 'i1', questionRefs: [] },
      teacherSnapshot: {
        title: 'V',
        classId: 'class-a',
        className: 'Classe A',
        programId: 'p1',
        importId: 'i1',
        questionRefs: [],
        distributionMode,
        activatedAt: Timestamp.now(),
      },
      activatedAt: Timestamp.now(),
      closedAt: null,
    });
  });
}

/** Seeds a submission created by the callable (Admin) WITH assignedQuestionOrders. */
async function seedAssignedDraft(assignedQuestionOrders: number[] = [0, 1, 3]) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'submissions', SUBMISSION_ID), {
      submissionId: SUBMISSION_ID,
      verificationId: VERIFICATION_ID,
      studentUid: STUDENT_UID,
      ownerUid: OWNER_UID,
      status: 'draft',
      answers: {},
      flagged: {},
      attentionEvents: [],
      deliveryCode: null,
      verificationTitle: 'V',
      className: 'Classe A',
      assignedQuestionOrders,
      startedAt: Timestamp.now(),
      lastSavedAt: serverTimestamp(),
      submittedAt: null,
    });
  });
}

function createPayload(extra: Record<string, unknown> = {}) {
  return {
    submissionId: SUBMISSION_ID,
    verificationId: VERIFICATION_ID,
    studentUid: STUDENT_UID,
    ownerUid: OWNER_UID,
    status: 'draft',
    answers: {},
    flagged: {},
    attentionEvents: [],
    deliveryCode: null,
    verificationTitle: 'V',
    className: 'Classe A',
    startedAt: Timestamp.now(),
    lastSavedAt: serverTimestamp(),
    submittedAt: null,
    ...extra,
  };
}

describe('VEX-01B — assignedQuestionOrders is server-only', () => {
  it('the owning student reads their own assigned draft', async () => {
    await seed('equivalent_variants');
    await seedAssignedDraft();
    await assertSucceeds(getDoc(doc(studentDb(), 'submissions', SUBMISSION_ID)));
  });

  it('another student cannot read it', async () => {
    await seed('equivalent_variants');
    await seedAssignedDraft();
    await assertFails(getDoc(doc(studentDb(OTHER_STUDENT_UID), 'submissions', SUBMISSION_ID)));
  });

  it('a student cannot create a submission that already carries assignedQuestionOrders', async () => {
    await seed('equivalent_variants');
    await assertFails(
      setDoc(
        doc(studentDb(), 'submissions', SUBMISSION_ID),
        createPayload({ assignedQuestionOrders: [0, 1, 3] }),
      ),
    );
  });

  it('a student cannot add assignedQuestionOrders via update', async () => {
    await seed('equivalent_variants');
    // Seed a normal draft (no assignment) as the student would create it.
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'submissions', SUBMISSION_ID), createPayload());
    });
    await assertFails(
      updateDoc(doc(studentDb(), 'submissions', SUBMISSION_ID), {
        assignedQuestionOrders: [0, 1, 3],
        lastSavedAt: serverTimestamp(),
      }),
    );
  });

  it('a student cannot change assignedQuestionOrders via update', async () => {
    await seed('equivalent_variants');
    await seedAssignedDraft([0, 1, 3]);
    await assertFails(
      updateDoc(doc(studentDb(), 'submissions', SUBMISSION_ID), {
        assignedQuestionOrders: [0, 2, 4],
        lastSavedAt: serverTimestamp(),
      }),
    );
  });

  it('a normal autosave succeeds and leaves assignedQuestionOrders untouched', async () => {
    await seed('equivalent_variants');
    await seedAssignedDraft([0, 1, 3]);
    await assertSucceeds(
      updateDoc(doc(studentDb(), 'submissions', SUBMISSION_ID), {
        answers: { '0': { tipo: 'aperta', testo: 'ciao' } },
        lastSavedAt: serverTimestamp(),
      }),
    );
    let after: Record<string, unknown> | undefined;
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const snap = await getDoc(doc(ctx.firestore(), 'submissions', SUBMISSION_ID));
      after = snap.data();
    });
    expect(after?.assignedQuestionOrders).toEqual([0, 1, 3]);
  });

  it('the owner reads the submission (including its assignment)', async () => {
    await seed('equivalent_variants');
    await seedAssignedDraft();
    await assertSucceeds(getDoc(doc(ownerDb(), 'submissions', SUBMISSION_ID)));
  });

  it('same_questions autosave is unaffected (no regression)', async () => {
    await seed('same_questions');
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'submissions', SUBMISSION_ID), createPayload());
    });
    await assertSucceeds(
      updateDoc(doc(studentDb(), 'submissions', SUBMISSION_ID), {
        answers: { '0': { tipo: 'aperta', testo: 'x' } },
        lastSavedAt: serverTimestamp(),
      }),
    );
  });
});
