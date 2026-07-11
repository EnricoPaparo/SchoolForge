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
  deleteDoc,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
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
    projectId: 'demo-schoolforge-m3f-03-submissions',
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

/**
 * Seeds settings/owner, settings/ownerPublic, settings/studentAccess, an
 * optional students/{STUDENT_UID} doc, and verifications/{VERIFICATION_ID}
 * with a full teacherSnapshot (matching what activateVerification always
 * writes together with status:'active' — see verificationsService.ts) so
 * create-time cross-checks against teacherSnapshot.title/className exercise
 * the real invariant instead of a null placeholder.
 */
async function seed(
  options: {
    portalEnabled?: boolean;
    studentStatus?: 'pending' | 'approved' | 'blocked';
    studentClassId?: string | null;
    verificationStatus?: 'draft' | 'active' | 'closed';
    visibility?: 'hidden' | 'public';
    onlineEnabled?: boolean;
    verificationClassId?: string | null;
    verificationOwnerUid?: string;
  } = {},
) {
  const {
    portalEnabled = true,
    studentStatus,
    studentClassId = 'class-a',
    verificationStatus = 'active',
    visibility = 'public',
    onlineEnabled = true,
    verificationClassId = 'class-a',
    verificationOwnerUid = OWNER_UID,
  } = options;

  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'settings/owner'), { ownerUid: OWNER_UID });
    await setDoc(doc(db, 'settings/ownerPublic'), { ownerUid: OWNER_UID });
    await setDoc(doc(db, 'settings/studentAccess'), {
      ownerUid: OWNER_UID,
      studentPortalEnabled: portalEnabled,
      newStudentRequestsEnabled: false,
    });
    if (studentStatus !== undefined) {
      await setDoc(doc(db, 'students', STUDENT_UID), {
        uid: STUDENT_UID,
        ownerUid: OWNER_UID,
        email: 'student@example.com',
        displayName: null,
        status: studentStatus,
        classId: studentClassId,
      });
      await setDoc(doc(db, 'students', OTHER_STUDENT_UID), {
        uid: OTHER_STUDENT_UID,
        ownerUid: OWNER_UID,
        email: 'other-student@example.com',
        displayName: null,
        status: 'approved',
        classId: studentClassId,
      });
    }
    await setDoc(doc(db, `verifications/${VERIFICATION_ID}`), {
      ownerUid: verificationOwnerUid,
      status: verificationStatus,
      visibility,
      onlineEnabled,
      config: {
        title: 'Verifica 1',
        classId: verificationClassId,
        programId: 'p1',
        importId: 'i1',
        questionRefs: [],
      },
      teacherSnapshot: {
        title: 'Verifica 1',
        classId: verificationClassId,
        className: 'Classe A',
        programId: 'p1',
        importId: 'i1',
        questionRefs: [],
        activatedAt: Timestamp.now(),
      },
      activatedAt: Timestamp.now(),
      closedAt: null,
    });
  });
}

/** A submissionId that doesn't correspond to STUDENT_UID/VERIFICATION_ID. */
const FAKE_SUBMISSION_ID = 'v1_someone-else';

type DraftOverrides = {
  submissionId?: string;
  verificationId?: string;
  studentUid?: string;
  ownerUid?: string;
  status?: string;
  answers?: Record<string, unknown>;
  flagged?: Record<string, unknown>;
  attentionEvents?: unknown[];
  deliveryCode?: string | null;
  verificationTitle?: string;
  className?: string | null;
  extraField?: unknown;
};

/** Matches exactly what submissionsService.startSubmission() writes. */
function draftPayload(overrides: DraftOverrides = {}) {
  const { extraField, ...rest } = overrides;
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
    verificationTitle: 'Verifica 1',
    className: 'Classe A',
    startedAt: Timestamp.now(),
    lastSavedAt: serverTimestamp(),
    submittedAt: null,
    ...rest,
    ...(extraField !== undefined ? { extraField } : {}),
  };
}

/** Seeds an existing draft submission directly (bypassing rules). */
async function seedDraft(overrides: DraftOverrides = {}) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'submissions', SUBMISSION_ID), draftPayload(overrides));
  });
}

async function seedSubmitted() {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(
      doc(db, 'submissions', SUBMISSION_ID),
      draftPayload({ status: 'submitted', deliveryCode: 'SF-2026-AAAA' }),
    );
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

/** Runs the real atomic-submit write batch (mirrors submissionsService.submitSubmission). */
async function submitBatch(
  db: Firestore,
  options: {
    submissionPath?: string;
    receiptPath?: string;
    deliveryCode?: string;
    skipReceipt?: boolean;
    receiptOverrides?: Record<string, unknown>;
  } = {},
) {
  const {
    submissionPath = `submissions/${SUBMISSION_ID}`,
    receiptPath = `submissionReceipts/${SUBMISSION_ID}`,
    deliveryCode = 'SF-2026-BBBB',
    skipReceipt = false,
    receiptOverrides = {},
  } = options;
  const batch = writeBatch(db);
  const now = serverTimestamp();
  batch.update(doc(db, submissionPath), {
    status: 'submitted',
    answers: {},
    flagged: {},
    deliveryCode,
    lastSavedAt: now,
    submittedAt: now,
  });
  if (!skipReceipt) {
    batch.set(doc(db, receiptPath), {
      submissionId: SUBMISSION_ID,
      verificationId: VERIFICATION_ID,
      studentUid: STUDENT_UID,
      ownerUid: OWNER_UID,
      verificationTitle: 'Verifica 1',
      className: 'Classe A',
      deliveryCode,
      submittedAt: now,
      ...receiptOverrides,
    });
  }
  await batch.commit();
}

// ─── Create ──────────────────────────────────────────────────────────────────

describe('Firestore rules — submissions create', () => {
  it('an approved student can create a valid initial draft on the deterministic path', async () => {
    await seed({ studentStatus: 'approved' });

    await assertSucceeds(setDoc(doc(studentDb(), 'submissions', SUBMISSION_ID), draftPayload()));
  });

  it('rejects a create whose doc id does not match verificationId_studentUid', async () => {
    await seed({ studentStatus: 'approved' });

    await assertFails(setDoc(doc(studentDb(), 'submissions', FAKE_SUBMISSION_ID), draftPayload()));
  });

  it('rejects a create whose studentUid field does not match the caller', async () => {
    await seed({ studentStatus: 'approved' });

    await assertFails(
      setDoc(
        doc(studentDb(), 'submissions', SUBMISSION_ID),
        draftPayload({ studentUid: OTHER_STUDENT_UID }),
      ),
    );
  });

  it('rejects a create for a non-approved student', async () => {
    await seed({ studentStatus: 'pending' });

    await assertFails(setDoc(doc(studentDb(), 'submissions', SUBMISSION_ID), draftPayload()));
  });

  it('rejects a create when the student portal is disabled', async () => {
    await seed({ studentStatus: 'approved', portalEnabled: false });

    await assertFails(setDoc(doc(studentDb(), 'submissions', SUBMISSION_ID), draftPayload()));
  });

  it('rejects a create when the student is in a different class than the verification', async () => {
    await seed({ studentStatus: 'approved', studentClassId: 'class-b' });

    await assertFails(setDoc(doc(studentDb(), 'submissions', SUBMISSION_ID), draftPayload()));
  });

  it.each([
    ['hidden', { visibility: 'hidden' as const }],
    ['not online-enabled', { onlineEnabled: false }],
    ['draft', { verificationStatus: 'draft' as const }],
    ['closed', { verificationStatus: 'closed' as const }],
  ])('rejects a create when the verification is %s', async (_label, seedOverrides) => {
    await seed({ studentStatus: 'approved', ...seedOverrides });

    await assertFails(setDoc(doc(studentDb(), 'submissions', SUBMISSION_ID), draftPayload()));
  });

  it.each([
    ['status is not draft', { status: 'submitted' }],
    ['deliveryCode is pre-filled', { deliveryCode: 'SF-2026-FAKE' }],
    ['answers is pre-filled', { answers: { '1': { tipo: 'aperta', testo: 'x' } } }],
    ['an arbitrary extra field is present', { extraField: 'hacked' }],
    ['ownerUid does not match the verification', { ownerUid: 'someone-else' }],
    ['verificationTitle does not match the verification snapshot', { verificationTitle: 'Fake' }],
  ] satisfies [string, DraftOverrides][])(
    'rejects a create where %s',
    async (_label, overrides) => {
      await seed({ studentStatus: 'approved' });

      await assertFails(
        setDoc(doc(studentDb(), 'submissions', SUBMISSION_ID), draftPayload(overrides)),
      );
    },
  );
});

// ─── Update (draft autosave) ────────────────────────────────────────────────

describe('Firestore rules — submissions update (draft autosave)', () => {
  it('an approved student can save a draft update to their own submission', async () => {
    await seed({ studentStatus: 'approved' });
    await seedDraft();

    await assertSucceeds(
      updateDoc(doc(studentDb(), 'submissions', SUBMISSION_ID), {
        answers: { '1': { tipo: 'aperta', testo: 'risposta' } },
        flagged: { '1': true },
        lastSavedAt: serverTimestamp(),
      }),
    );
  });

  it('accepts a draft update with exactly 200 attention events', async () => {
    await seed({ studentStatus: 'approved' });
    await seedDraft();

    const attentionEvents = Array.from({ length: 200 }, (_, index) => ({
      type: 'tab_blur',
      ts: index,
    }));
    await assertSucceeds(
      updateDoc(doc(studentDb(), 'submissions', SUBMISSION_ID), {
        attentionEvents,
        lastSavedAt: serverTimestamp(),
      }),
    );
  });

  it('rejects a draft update with more than 200 attention events', async () => {
    await seed({ studentStatus: 'approved' });
    await seedDraft();

    const attentionEvents = Array.from({ length: 201 }, (_, index) => ({
      type: 'tab_blur',
      ts: index,
    }));
    await assertFails(
      updateDoc(doc(studentDb(), 'submissions', SUBMISSION_ID), {
        attentionEvents,
        lastSavedAt: serverTimestamp(),
      }),
    );
  });

  it.each([
    ['verificationId', { verificationId: 'other-verification' }],
    ['studentUid', { studentUid: OTHER_STUDENT_UID }],
    ['ownerUid', { ownerUid: 'someone-else' }],
    ['verificationTitle', { verificationTitle: 'Changed title' }],
    ['className', { className: 'Changed class' }],
    ['submissionId', { submissionId: FAKE_SUBMISSION_ID }],
  ])(
    'rejects a draft update that tries to change the immutable field %s',
    async (_field, patch) => {
      await seed({ studentStatus: 'approved' });
      await seedDraft();

      await assertFails(
        updateDoc(doc(studentDb(), 'submissions', SUBMISSION_ID), {
          ...patch,
          lastSavedAt: serverTimestamp(),
        }),
      );
    },
  );

  it('rejects a draft update that tries to backdate startedAt', async () => {
    await seed({ studentStatus: 'approved' });
    await seedDraft();

    await assertFails(
      updateDoc(doc(studentDb(), 'submissions', SUBMISSION_ID), {
        startedAt: Timestamp.now(),
        lastSavedAt: serverTimestamp(),
      }),
    );
  });

  it('rejects a draft autosave once the verification has been closed', async () => {
    await seed({ studentStatus: 'approved', verificationStatus: 'closed' });
    await seedDraft();

    await assertFails(
      updateDoc(doc(studentDb(), 'submissions', SUBMISSION_ID), {
        answers: { '1': { tipo: 'aperta', testo: 'risposta' } },
        lastSavedAt: serverTimestamp(),
      }),
    );
  });

  it('rejects any update from a different student', async () => {
    await seed({ studentStatus: 'approved' });
    await seedDraft();

    await assertFails(
      updateDoc(doc(studentDb(OTHER_STUDENT_UID), 'submissions', SUBMISSION_ID), {
        answers: { '1': { tipo: 'aperta', testo: 'risposta' } },
        lastSavedAt: serverTimestamp(),
      }),
    );
  });

  it('rejects the owner attempting to write a submission directly (no correction path in M3F-03)', async () => {
    await seed({ studentStatus: 'approved' });
    await seedDraft();

    await assertFails(
      updateDoc(doc(ownerDb(), 'submissions', SUBMISSION_ID), {
        answers: { '1': { tipo: 'aperta', testo: 'graded' } },
      }),
    );
  });
});

// ─── Atomic submit (submission + receipt) ───────────────────────────────────

describe('Firestore rules — atomic submit (submissions + submissionReceipts)', () => {
  it('an approved student can submit atomically: submission -> submitted + matching receipt created', async () => {
    await seed({ studentStatus: 'approved' });
    await seedDraft();

    await assertSucceeds(submitBatch(studentDb()));
  });

  it('rejects submitting the submission without creating the matching receipt in the same batch', async () => {
    await seed({ studentStatus: 'approved' });
    await seedDraft();

    await assertFails(submitBatch(studentDb(), { skipReceipt: true }));
  });

  it('rejects creating a receipt whose deliveryCode does not match the submission being submitted', async () => {
    await seed({ studentStatus: 'approved' });
    await seedDraft();

    await assertFails(
      submitBatch(studentDb(), {
        deliveryCode: 'SF-2026-REAL',
        receiptOverrides: { deliveryCode: 'SF-2026-FAKE' },
      }),
    );
  });

  it('rejects creating a receipt whose studentUid does not match the caller', async () => {
    await seed({ studentStatus: 'approved' });
    await seedDraft();

    await assertFails(
      submitBatch(studentDb(), { receiptOverrides: { studentUid: OTHER_STUDENT_UID } }),
    );
  });

  it('rejects fabricating a bare receipt with no real draft -> submitted transition alongside it', async () => {
    await seed({ studentStatus: 'approved' });
    await seedDraft();

    await assertFails(
      setDoc(doc(studentDb(), 'submissionReceipts', SUBMISSION_ID), {
        submissionId: SUBMISSION_ID,
        verificationId: VERIFICATION_ID,
        studentUid: STUDENT_UID,
        ownerUid: OWNER_UID,
        verificationTitle: 'Verifica 1',
        className: 'Classe A',
        deliveryCode: 'SF-2026-FAKE',
        submittedAt: serverTimestamp(),
      }),
    );
  });

  it('rejects submitting once the verification has been closed mid-draft', async () => {
    await seed({ studentStatus: 'approved', verificationStatus: 'closed' });
    await seedDraft();

    await assertFails(submitBatch(studentDb()));
  });

  it('rejects any further modification after submission (immutability)', async () => {
    await seed({ studentStatus: 'approved' });
    await seedSubmitted();

    await assertFails(
      updateDoc(doc(studentDb(), 'submissions', SUBMISSION_ID), {
        answers: { '1': { tipo: 'aperta', testo: 'changed after submit' } },
      }),
    );
  });

  it('rejects re-submitting an already-submitted submission (no submitted -> draft, no double delivery)', async () => {
    await seed({ studentStatus: 'approved' });
    await seedSubmitted();

    await assertFails(submitBatch(studentDb(), { deliveryCode: 'SF-2026-SECOND' }));
  });

  it('rejects modifying an existing receipt', async () => {
    await seed({ studentStatus: 'approved' });
    await seedSubmitted();

    await assertFails(
      updateDoc(doc(studentDb(), 'submissionReceipts', SUBMISSION_ID), {
        deliveryCode: 'SF-2026-TAMPERED',
      }),
    );
  });

  it('rejects deleting an existing receipt', async () => {
    await seed({ studentStatus: 'approved' });
    await seedSubmitted();

    await assertFails(deleteDoc(doc(studentDb(), 'submissionReceipts', SUBMISSION_ID)));
  });
});

// ─── Reads and isolation ─────────────────────────────────────────────────────

describe('Firestore rules — submissions/receipts reads and isolation', () => {
  it('a student can read their own submission while it is draft', async () => {
    await seed({ studentStatus: 'approved' });
    await seedDraft();

    await assertSucceeds(getDoc(doc(studentDb(), 'submissions', SUBMISSION_ID)));
  });

  it('a student cannot read their own submission once submitted (receipt only)', async () => {
    await seed({ studentStatus: 'approved' });
    await seedSubmitted();

    await assertFails(getDoc(doc(studentDb(), 'submissions', SUBMISSION_ID)));
    await assertSucceeds(getDoc(doc(studentDb(), 'submissionReceipts', SUBMISSION_ID)));
  });

  it("a different student cannot read another student's draft submission", async () => {
    await seed({ studentStatus: 'approved' });
    await seedDraft();

    await assertFails(getDoc(doc(studentDb(OTHER_STUDENT_UID), 'submissions', SUBMISSION_ID)));
  });

  it("a different student cannot read another student's receipt", async () => {
    await seed({ studentStatus: 'approved' });
    await seedSubmitted();

    await assertFails(
      getDoc(doc(studentDb(OTHER_STUDENT_UID), 'submissionReceipts', SUBMISSION_ID)),
    );
  });

  it("a different student cannot write into another student's submission document", async () => {
    await seed({ studentStatus: 'approved' });
    await seedDraft();

    await assertFails(
      updateDoc(doc(studentDb(OTHER_STUDENT_UID), 'submissions', SUBMISSION_ID), {
        answers: { '1': { tipo: 'aperta', testo: 'intruso' } },
        lastSavedAt: serverTimestamp(),
      }),
    );
  });

  it('the owner can read a draft submission for their own verification', async () => {
    await seed({ studentStatus: 'approved' });
    await seedDraft();

    await assertSucceeds(getDoc(doc(ownerDb(), 'submissions', SUBMISSION_ID)));
  });

  it('the owner can read a submitted submission and its receipt for their own verification', async () => {
    await seed({ studentStatus: 'approved' });
    await seedSubmitted();

    await assertSucceeds(getDoc(doc(ownerDb(), 'submissions', SUBMISSION_ID)));
    await assertSucceeds(getDoc(doc(ownerDb(), 'submissionReceipts', SUBMISSION_ID)));
  });

  it("a non-owner teacher cannot read another owner's submission or receipt", async () => {
    await seed({ studentStatus: 'approved' });
    await seedSubmitted();

    const otherOwnerDb = testEnv
      .authenticatedContext(OTHER_OWNER_UID)
      .firestore() as unknown as Firestore;
    await assertFails(getDoc(doc(otherOwnerDb, 'submissions', SUBMISSION_ID)));
    await assertFails(getDoc(doc(otherOwnerDb, 'submissionReceipts', SUBMISSION_ID)));
  });

  it('nobody can delete a submission, not even the owner', async () => {
    await seed({ studentStatus: 'approved' });
    await seedSubmitted();

    await assertFails(deleteDoc(doc(ownerDb(), 'submissions', SUBMISSION_ID)));
    await assertFails(deleteDoc(doc(studentDb(), 'submissions', SUBMISSION_ID)));
  });
});
