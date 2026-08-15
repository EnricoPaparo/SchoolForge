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
import { doc, getDoc, setDoc } from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIRESTORE_RULES = resolve(__dirname, '../../../../firestore.rules');

const OWNER_UID = 'owner-uid';
const OTHER_UID = 'other-uid';
const STUDENT_UID = 'student-uid';

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-schoolforge-m3f-09',
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

function otherDb() {
  return testEnv.authenticatedContext(OTHER_UID).firestore() as unknown as Firestore;
}

function studentDb() {
  return testEnv.authenticatedContext(STUDENT_UID).firestore() as unknown as Firestore;
}

async function seedOwner() {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'settings/owner'), { ownerUid: OWNER_UID });
  });
}

function verificationDoc(
  status: 'draft' | 'active' | 'closed',
  overrides: Record<string, unknown> = {},
) {
  return {
    ownerUid: OWNER_UID,
    status,
    visibility: 'hidden',
    onlineEnabled: false,
    studentPdfEnabled: false,
    config: { title: 'V1', classId: 'cls-1', programId: 'p1', importId: 'i1', questionRefs: [] },
    teacherSnapshot: {
      title: 'V1',
      classId: 'cls-1',
      className: 'Classe 3A',
      programId: 'p1',
      importId: 'i1',
      questionRefs: [],
      activatedAt: null,
    },
    activatedAt: null,
    closedAt: null,
    ...overrides,
  };
}

describe('Firestore rules — verifications studentPdfEnabled toggle (M3F-09)', () => {
  it('owner can toggle studentPdfEnabled on a draft verification (any-owner-update rule)', async () => {
    await seedOwner();
    const draftDoc = verificationDoc('draft');
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'verifications/v1'), draftDoc);
    });
    await assertSucceeds(
      setDoc(doc(ownerDb(), 'verifications/v1'), {
        ...draftDoc,
        studentPdfEnabled: true,
        updatedAt: null,
      }),
    );
  });

  it('owner can toggle studentPdfEnabled on an active verification', async () => {
    await seedOwner();
    const activeDoc = verificationDoc('active');
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'verifications/v1'), activeDoc);
    });
    await assertSucceeds(
      setDoc(doc(ownerDb(), 'verifications/v1'), {
        ...activeDoc,
        studentPdfEnabled: true,
        updatedAt: null,
      }),
    );
  });

  it('owner can toggle studentPdfEnabled on a closed verification, without reopening it', async () => {
    await seedOwner();
    const closedDoc = verificationDoc('closed');
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'verifications/v1'), closedDoc);
    });
    await assertSucceeds(
      setDoc(doc(ownerDb(), 'verifications/v1'), {
        ...closedDoc,
        studentPdfEnabled: true,
        updatedAt: null,
      }),
    );
  });

  it('non-owner cannot toggle studentPdfEnabled', async () => {
    await seedOwner();
    const activeDoc = verificationDoc('active');
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'verifications/v1'), activeDoc);
    });
    await assertFails(
      setDoc(doc(otherDb(), 'verifications/v1'), {
        ...activeDoc,
        studentPdfEnabled: true,
        updatedAt: null,
      }),
    );
  });

  it('a student cannot toggle studentPdfEnabled', async () => {
    await seedOwner();
    const activeDoc = verificationDoc('active');
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, 'verifications/v1'), activeDoc);
      await setDoc(doc(db, 'students', STUDENT_UID), {
        uid: STUDENT_UID,
        ownerUid: OWNER_UID,
        email: 's@example.com',
        displayName: null,
        status: 'approved',
        classId: 'cls-1',
      });
      await setDoc(doc(db, 'settings/studentAccess'), {
        ownerUid: OWNER_UID,
        studentPortalEnabled: true,
        newStudentRequestsEnabled: false,
      });
    });
    await assertFails(
      setDoc(doc(studentDb(), 'verifications/v1'), {
        ...activeDoc,
        studentPdfEnabled: true,
        updatedAt: null,
      }),
    );
  });

  it('owner cannot toggle studentPdfEnabled while simultaneously changing config (active)', async () => {
    await seedOwner();
    const activeDoc = verificationDoc('active');
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'verifications/v1'), activeDoc);
    });
    await assertFails(
      setDoc(doc(ownerDb(), 'verifications/v1'), {
        ...activeDoc,
        studentPdfEnabled: true,
        updatedAt: null,
        config: { ...activeDoc.config, title: 'Cambiato' },
      }),
    );
  });

  it('owner cannot toggle studentPdfEnabled while simultaneously changing status (active -> closed)', async () => {
    await seedOwner();
    const activeDoc = verificationDoc('active');
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'verifications/v1'), activeDoc);
    });
    await assertFails(
      setDoc(doc(ownerDb(), 'verifications/v1'), {
        ...activeDoc,
        studentPdfEnabled: true,
        updatedAt: null,
        status: 'closed',
      }),
    );
  });

  it('owner cannot toggle studentPdfEnabled while simultaneously changing visibility (active)', async () => {
    await seedOwner();
    const activeDoc = verificationDoc('active');
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'verifications/v1'), activeDoc);
    });
    await assertFails(
      setDoc(doc(ownerDb(), 'verifications/v1'), {
        ...activeDoc,
        studentPdfEnabled: true,
        updatedAt: null,
        visibility: 'public',
      }),
    );
  });

  it('owner cannot toggle studentPdfEnabled while simultaneously changing ownerUid', async () => {
    await seedOwner();
    const activeDoc = verificationDoc('active');
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'verifications/v1'), activeDoc);
    });
    await assertFails(
      setDoc(doc(ownerDb(), 'verifications/v1'), {
        ...activeDoc,
        studentPdfEnabled: true,
        updatedAt: null,
        ownerUid: OTHER_UID,
      }),
    );
  });

  it.each([null, 'true', 1, {}, []])(
    'rejects a non-boolean studentPdfEnabled value on an active verification (%j)',
    async (nonBoolValue) => {
      await seedOwner();
      const activeDoc = verificationDoc('active');
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        await setDoc(doc(ctx.firestore(), 'verifications/v1'), activeDoc);
      });
      await assertFails(
        setDoc(doc(ownerDb(), 'verifications/v1'), {
          ...activeDoc,
          studentPdfEnabled: nonBoolValue,
          updatedAt: null,
        }),
      );
    },
  );

  it('publishedProjection mirror stays owner-writable and coherent (studentPdfEnabled toggled independently of visibility)', async () => {
    await seedOwner();
    const activeDoc = verificationDoc('active', { visibility: 'hidden' });
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, 'verifications/v1'), activeDoc);
      await setDoc(doc(db, 'verifications/v1/publishedProjection/data'), {
        ownerUid: OWNER_UID,
        title: 'V1',
        className: 'Classe 3A',
        classId: 'cls-1',
        visibility: 'hidden',
        studentPdfEnabled: false,
        questions: [],
        activatedAt: null,
      });
    });
    await assertSucceeds(
      setDoc(
        doc(ownerDb(), 'verifications/v1/publishedProjection/data'),
        { studentPdfEnabled: true },
        { merge: true },
      ),
    );
    const snap = await getDoc(doc(ownerDb(), 'verifications/v1/publishedProjection/data'));
    expect(snap.data()?.studentPdfEnabled).toBe(true);
    expect(snap.data()?.visibility).toBe('hidden');
  });

  it('studentPdfEnabled true never makes a hidden/draft/closed verification readable to a student', async () => {
    await seedOwner();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, 'students', STUDENT_UID), {
        uid: STUDENT_UID,
        ownerUid: OWNER_UID,
        email: 's@example.com',
        displayName: null,
        status: 'approved',
        classId: 'cls-1',
      });
      await setDoc(doc(db, 'settings/studentAccess'), {
        ownerUid: OWNER_UID,
        studentPortalEnabled: true,
        newStudentRequestsEnabled: false,
      });
      // Active, but hidden — studentPdfEnabled: true does not override visibility.
      await setDoc(doc(db, 'verifications/v1'), verificationDoc('active'));
      await setDoc(doc(db, 'verifications/v1/publishedProjection/data'), {
        ownerUid: OWNER_UID,
        title: 'V1',
        className: 'Classe 3A',
        classId: 'cls-1',
        visibility: 'hidden',
        studentPdfEnabled: true,
        questions: [],
        activatedAt: null,
      });
      // Closed — projection visibility forced back to hidden already, same guarantee.
      await setDoc(doc(db, 'verifications/v2'), verificationDoc('closed'));
      await setDoc(doc(db, 'verifications/v2/publishedProjection/data'), {
        ownerUid: OWNER_UID,
        title: 'V2',
        className: 'Classe 3A',
        classId: 'cls-1',
        visibility: 'hidden',
        studentPdfEnabled: true,
        questions: [],
        activatedAt: null,
      });
    });
    await assertFails(getDoc(doc(studentDb(), 'verifications/v1/publishedProjection/data')));
    await assertFails(getDoc(doc(studentDb(), 'verifications/v2/publishedProjection/data')));
    // The parent verification document itself is never readable by a student, regardless.
    await assertFails(getDoc(doc(studentDb(), 'verifications/v1')));
  });
});

describe('Firestore rules — assegnazione personale del PDF', () => {
  async function seedAssignment() {
    await seedOwner();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), `verifications/v1/studentAssignments/${STUDENT_UID}`), {
        verificationId: 'v1',
        studentUid: STUDENT_UID,
        ownerUid: OWNER_UID,
        assignedQuestionOrders: [0, 2],
        createdAt: new Date(),
      });
    });
  }

  it('the owner can read the server-only assignment', async () => {
    await seedAssignment();
    await assertSucceeds(
      getDoc(doc(ownerDb(), `verifications/v1/studentAssignments/${STUDENT_UID}`)),
    );
  });

  it('the student cannot read their server-only assignment directly', async () => {
    await seedAssignment();
    await assertFails(
      getDoc(doc(studentDb(), `verifications/v1/studentAssignments/${STUDENT_UID}`)),
    );
  });

  it('the student cannot forge or overwrite a server-only assignment', async () => {
    await seedAssignment();
    await assertFails(
      setDoc(doc(studentDb(), `verifications/v1/studentAssignments/${STUDENT_UID}`), {
        verificationId: 'v1',
        studentUid: STUDENT_UID,
        ownerUid: OWNER_UID,
        assignedQuestionOrders: [1],
        createdAt: new Date(),
      }),
    );
  });
});
