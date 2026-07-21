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
import { doc, serverTimestamp, setDoc, Timestamp, updateDoc, writeBatch } from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import { afterAll, afterEach, beforeAll, describe, it } from 'vitest';

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
    projectId: 'demo-schoolforge-vex-02a-subset',
    firestore: { rules: readFileSync(FIRESTORE_RULES, 'utf8'), host: '127.0.0.1', port: 8080 },
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
        email: `${uid}@x.it`,
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

/** Seeds a VEX draft (as the callable would write it) assigned to orders 0,1,3. */
async function seedVexDraft() {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'submissions', SUBMISSION_ID), base(true));
  });
}
async function seedSameDraft() {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'submissions', SUBMISSION_ID), base(false));
  });
}

function base(vex: boolean) {
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
    ...(vex ? { assignedQuestionOrders: [0, 1, 3], assignedAnswerKeys: ['0', '1', '3'] } : {}),
  };
}

const aperta = (t: string) => ({ tipo: 'aperta', testo: t });

describe('VEX-02A — answers restricted to the assigned variant', () => {
  it('rejects a create carrying assignedAnswerKeys', async () => {
    await seed('equivalent_variants');
    await assertFails(
      setDoc(doc(studentDb(), 'submissions', SUBMISSION_ID), {
        ...base(false),
        assignedAnswerKeys: ['0'],
      }),
    );
  });

  it('rejects changing/removing assignedAnswerKeys', async () => {
    await seed('equivalent_variants');
    await seedVexDraft();
    await assertFails(
      updateDoc(doc(studentDb(), 'submissions', SUBMISSION_ID), {
        assignedAnswerKeys: ['0', '2'],
        lastSavedAt: serverTimestamp(),
      }),
    );
  });

  it('rejects an answer for an order NOT in the variant', async () => {
    await seed('equivalent_variants');
    await seedVexDraft();
    await assertFails(
      updateDoc(doc(studentDb(), 'submissions', SUBMISSION_ID), {
        answers: { '2': aperta('x') },
        lastSavedAt: serverTimestamp(),
      }),
    );
  });

  it('allows an answer for an assigned order', async () => {
    await seed('equivalent_variants');
    await seedVexDraft();
    await assertSucceeds(
      updateDoc(doc(studentDb(), 'submissions', SUBMISSION_ID), {
        answers: { '1': aperta('ok') },
        lastSavedAt: serverTimestamp(),
      }),
    );
  });

  it('allows multiple answers, all assigned', async () => {
    await seed('equivalent_variants');
    await seedVexDraft();
    await assertSucceeds(
      updateDoc(doc(studentDb(), 'submissions', SUBMISSION_ID), {
        answers: { '0': aperta('a'), '1': aperta('b'), '3': aperta('c') },
        flagged: { '3': true },
        lastSavedAt: serverTimestamp(),
      }),
    );
  });

  it('rejects a mixed set (assigned + non-assigned)', async () => {
    await seed('equivalent_variants');
    await seedVexDraft();
    await assertFails(
      updateDoc(doc(studentDb(), 'submissions', SUBMISSION_ID), {
        answers: { '0': aperta('a'), '4': aperta('bad') },
        lastSavedAt: serverTimestamp(),
      }),
    );
  });

  it('allows a legitimate delivery (submit + receipt in one batch)', async () => {
    await seed('equivalent_variants');
    await seedVexDraft();
    const db = studentDb();
    const batch = writeBatch(db);
    const now = serverTimestamp();
    batch.update(doc(db, 'submissions', SUBMISSION_ID), {
      status: 'submitted',
      answers: { '0': aperta('a') },
      deliveryCode: 'SF-2026-ZZZZ',
      submittedAt: now,
      lastSavedAt: now,
    });
    batch.set(doc(db, 'submissionReceipts', SUBMISSION_ID), {
      submissionId: SUBMISSION_ID,
      verificationId: VERIFICATION_ID,
      studentUid: STUDENT_UID,
      ownerUid: OWNER_UID,
      verificationTitle: 'V',
      className: 'Classe A',
      deliveryCode: 'SF-2026-ZZZZ',
      submittedAt: now,
    });
    await assertSucceeds(batch.commit());
  });

  it('denies another student writing this submission', async () => {
    await seed('equivalent_variants');
    await seedVexDraft();
    await assertFails(
      updateDoc(doc(studentDb(OTHER_STUDENT_UID), 'submissions', SUBMISSION_ID), {
        answers: { '0': aperta('x') },
        lastSavedAt: serverTimestamp(),
      }),
    );
  });

  it('same_questions autosave is unaffected (any order key allowed)', async () => {
    await seed('same_questions');
    await seedSameDraft();
    await assertSucceeds(
      updateDoc(doc(studentDb(), 'submissions', SUBMISSION_ID), {
        answers: { '7': aperta('anything') },
        lastSavedAt: serverTimestamp(),
      }),
    );
  });
});
