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
import { deleteDoc, doc, getDoc, setDoc } from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import { afterAll, afterEach, beforeAll, describe, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIRESTORE_RULES = resolve(__dirname, '../../../../firestore.rules');

const OWNER_UID = 'owner-uid';
const OTHER_UID = 'other-uid';

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-schoolforge-m3l',
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

function studentDb() {
  return testEnv.authenticatedContext(OTHER_UID).firestore() as unknown as Firestore;
}

function anonDb() {
  return testEnv.unauthenticatedContext().firestore() as unknown as Firestore;
}

const BASE_CONFIG = {
  title: 'Verifica 1',
  classId: null,
  programId: 'p1',
  importId: 'i1',
  questionRefs: [],
};

/**
 * Seeds settings/owner, settings/ownerPublic, the verification and
 * (optionally) its publishedProjection, settings/studentAccess and
 * students/{OTHER_UID} in a single admin-context callback. Splitting this
 * across multiple separate `withSecurityRulesDisabled` calls within one
 * test intermittently trips the JS SDK's "Firestore has already been
 * started" guard against re-configuring an already-connected instance — a
 * single callback avoids re-touching the same admin Firestore handle.
 *
 * `studentPortalEnabled`/`studentStatus` are both omitted by default, which
 * exercises the safe default of the approved-student model (M3-lite): no
 * settings/studentAccess and no students/{uid} => every student read denied,
 * regardless of the verification's own status/visibility.
 */
async function seedVerification(
  overrides: Record<string, unknown>,
  options: {
    withProjection?: boolean;
    studentPortalEnabled?: boolean;
    studentStatus?: 'pending' | 'approved' | 'blocked';
  } = {},
) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'settings/owner'), { ownerUid: OWNER_UID });
    await setDoc(doc(db, 'settings/ownerPublic'), { ownerUid: OWNER_UID });
    if (options.studentPortalEnabled !== undefined) {
      await setDoc(doc(db, 'settings/studentAccess'), {
        ownerUid: OWNER_UID,
        studentPortalEnabled: options.studentPortalEnabled,
        newStudentRequestsEnabled: false,
      });
    }
    if (options.studentStatus !== undefined) {
      await setDoc(doc(db, 'students', OTHER_UID), {
        uid: OTHER_UID,
        ownerUid: OWNER_UID,
        email: 'student@example.com',
        displayName: null,
        status: options.studentStatus,
        classId: null,
      });
    }
    await setDoc(doc(db, 'verifications/v1'), {
      ownerUid: OWNER_UID,
      status: 'draft',
      visibility: 'hidden',
      config: BASE_CONFIG,
      teacherSnapshot: null,
      activatedAt: null,
      closedAt: null,
      ...overrides,
    });
    if (options.withProjection) {
      await setDoc(doc(db, 'verifications/v1/publishedProjection/data'), {
        ownerUid: OWNER_UID,
        title: 'Verifica 1',
        className: null,
        questions: [{ order: 0, tipo: 'aperta', maxPoints: 3, testo: 'Domanda?' }],
        activatedAt: null,
      });
    }
  });
}

// ─── settings/studentAccess and students/{uid} (M3-lite approval model) ──────

async function seedOwnerOnly() {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'settings/owner'), { ownerUid: OWNER_UID });
    await setDoc(doc(db, 'settings/ownerPublic'), { ownerUid: OWNER_UID });
  });
}

describe('Firestore rules — settings/studentAccess', () => {
  it('owner can write settings/studentAccess', async () => {
    await seedOwnerOnly();

    await assertSucceeds(
      setDoc(doc(ownerDb(), 'settings/studentAccess'), {
        ownerUid: OWNER_UID,
        studentPortalEnabled: true,
        newStudentRequestsEnabled: false,
      }),
    );
  });

  it('owner can read settings/studentAccess', async () => {
    await seedOwnerOnly();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'settings/studentAccess'), {
        ownerUid: OWNER_UID,
        studentPortalEnabled: true,
        newStudentRequestsEnabled: false,
      });
    });

    await assertSucceeds(getDoc(doc(ownerDb(), 'settings/studentAccess')));
  });

  it('a non-owner (student) can read settings/studentAccess (needed by RoleGate)', async () => {
    await seedOwnerOnly();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'settings/studentAccess'), {
        ownerUid: OWNER_UID,
        studentPortalEnabled: true,
        newStudentRequestsEnabled: false,
      });
    });

    // Deliberate deviation from "students never read this directly": RoleGate
    // must show a disabled/pending/requests-closed screen to a candidate
    // student without waiting on an owner-only read, and neither flag
    // authorizes any content on its own — isApprovedStudent() re-reads this
    // document itself via get() for the real authorization decision.
    await assertSucceeds(getDoc(doc(studentDb(), 'settings/studentAccess')));
  });

  it('a non-owner (student) cannot write settings/studentAccess', async () => {
    await seedOwnerOnly();

    await assertFails(
      setDoc(doc(studentDb(), 'settings/studentAccess'), {
        ownerUid: OWNER_UID,
        studentPortalEnabled: true,
        newStudentRequestsEnabled: true,
      }),
    );
  });

  it('an unauthenticated user cannot read settings/studentAccess', async () => {
    await seedOwnerOnly();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'settings/studentAccess'), {
        ownerUid: OWNER_UID,
        studentPortalEnabled: true,
        newStudentRequestsEnabled: false,
      });
    });

    await assertFails(getDoc(doc(anonDb(), 'settings/studentAccess')));
  });
});

describe('Firestore rules — students/{uid} approval roster', () => {
  it('owner can create a students/{uid} document', async () => {
    await seedOwnerOnly();

    await assertSucceeds(
      setDoc(doc(ownerDb(), 'students', OTHER_UID), {
        uid: OTHER_UID,
        ownerUid: OWNER_UID,
        email: 'student@example.com',
        displayName: null,
        status: 'pending',
        classId: null,
      }),
    );
  });

  it('owner can approve a pending student (update status)', async () => {
    await seedOwnerOnly();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'students', OTHER_UID), {
        uid: OTHER_UID,
        ownerUid: OWNER_UID,
        email: 'student@example.com',
        displayName: null,
        status: 'pending',
        classId: null,
      });
    });

    await assertSucceeds(
      setDoc(doc(ownerDb(), 'students', OTHER_UID), { status: 'approved' }, { merge: true }),
    );
  });

  it('a student can read their own students/{uid} document (needed by RoleGate)', async () => {
    await seedOwnerOnly();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'students', OTHER_UID), {
        uid: OTHER_UID,
        ownerUid: OWNER_UID,
        email: 'student@example.com',
        displayName: null,
        status: 'approved',
        classId: null,
      });
    });

    await assertSucceeds(getDoc(doc(studentDb(), 'students', OTHER_UID)));
  });

  it('a student cannot read another student’s students/{uid} document', async () => {
    const ANOTHER_UID = 'another-uid';
    await seedOwnerOnly();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'students', ANOTHER_UID), {
        uid: ANOTHER_UID,
        ownerUid: OWNER_UID,
        email: 'other-student@example.com',
        displayName: null,
        status: 'approved',
        classId: null,
      });
    });

    await assertFails(getDoc(doc(studentDb(), 'students', ANOTHER_UID)));
  });

  it('a student cannot self-approve by writing their own students/{uid} document', async () => {
    await seedOwnerOnly();

    await assertFails(
      setDoc(doc(studentDb(), 'students', OTHER_UID), {
        uid: OTHER_UID,
        ownerUid: OWNER_UID,
        email: 'student@example.com',
        displayName: null,
        status: 'approved',
        classId: null,
      }),
    );
  });

  it('an unauthenticated user cannot read a students/{uid} document', async () => {
    await seedOwnerOnly();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'students', OTHER_UID), {
        uid: OTHER_UID,
        ownerUid: OWNER_UID,
        email: 'student@example.com',
        displayName: null,
        status: 'approved',
        classId: null,
      });
    });

    await assertFails(getDoc(doc(anonDb(), 'students', OTHER_UID)));
  });
});

// ─── students/{uid} self-request (M3L-A3, newStudentRequestsEnabled) ─────────

function pendingRequestPayload(overrides: Record<string, unknown> = {}) {
  return {
    uid: OTHER_UID,
    ownerUid: OWNER_UID,
    email: 'student@example.com',
    displayName: 'Studente Test',
    status: 'pending',
    classId: null,
    createdAt: null,
    updatedAt: null,
    lastLoginAt: null,
    ...overrides,
  };
}

async function seedRequestsToggle(enabled: boolean) {
  await seedOwnerOnly();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'settings/studentAccess'), {
      ownerUid: OWNER_UID,
      studentPortalEnabled: false,
      newStudentRequestsEnabled: enabled,
    });
  });
}

describe('Firestore rules — students/{uid} self-request (newStudentRequestsEnabled)', () => {
  it('a Google non-owner can create their own pending request when requests are enabled', async () => {
    await seedRequestsToggle(true);

    await assertSucceeds(setDoc(doc(studentDb(), 'students', OTHER_UID), pendingRequestPayload()));
  });

  it('denies the self-request when newStudentRequestsEnabled is false', async () => {
    await seedRequestsToggle(false);

    await assertFails(setDoc(doc(studentDb(), 'students', OTHER_UID), pendingRequestPayload()));
  });

  it('denies the self-request when settings/studentAccess does not exist at all', async () => {
    await seedOwnerOnly();
    // seedRequestsToggle() never called — default-safe: no document means
    // requests are treated as closed.

    await assertFails(setDoc(doc(studentDb(), 'students', OTHER_UID), pendingRequestPayload()));
  });

  it('denies creating a request at a different uid than the caller', async () => {
    await seedRequestsToggle(true);

    await assertFails(
      setDoc(
        doc(studentDb(), 'students', 'someone-else-uid'),
        pendingRequestPayload({ uid: 'someone-else-uid' }),
      ),
    );
  });

  it('denies the self-request when the uid field does not match the caller', async () => {
    await seedRequestsToggle(true);

    await assertFails(
      setDoc(
        doc(studentDb(), 'students', OTHER_UID),
        pendingRequestPayload({ uid: 'someone-else-uid' }),
      ),
    );
  });

  it('denies the self-request when ownerUid does not match settings/ownerPublic', async () => {
    await seedRequestsToggle(true);

    await assertFails(
      setDoc(
        doc(studentDb(), 'students', OTHER_UID),
        pendingRequestPayload({ ownerUid: 'not-the-real-owner' }),
      ),
    );
  });

  it('denies the self-request when status is not pending', async () => {
    await seedRequestsToggle(true);

    await assertFails(
      setDoc(
        doc(studentDb(), 'students', OTHER_UID),
        pendingRequestPayload({ status: 'approved' }),
      ),
    );
  });

  it('denies the self-request when classId is not null', async () => {
    await seedRequestsToggle(true);

    await assertFails(
      setDoc(
        doc(studentDb(), 'students', OTHER_UID),
        pendingRequestPayload({ classId: 'class-1' }),
      ),
    );
  });

  it('denies the self-request when an extra field is present', async () => {
    await seedRequestsToggle(true);

    await assertFails(
      setDoc(
        doc(studentDb(), 'students', OTHER_UID),
        pendingRequestPayload({ notAllowed: 'anything' }),
      ),
    );
  });

  it('denies an unauthenticated user from creating a request, even when requests are enabled', async () => {
    await seedRequestsToggle(true);

    await assertFails(setDoc(doc(anonDb(), 'students', OTHER_UID), pendingRequestPayload()));
  });

  it('denies a second write to an already-created request (create only fires once)', async () => {
    await seedRequestsToggle(true);
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'students', OTHER_UID), pendingRequestPayload());
    });

    // The document now exists, so this becomes an `update`, which is
    // owner-only — even though the payload is a harmless no-op resend.
    await assertFails(setDoc(doc(studentDb(), 'students', OTHER_UID), pendingRequestPayload()));
  });

  it('a student can never update their own document after creation', async () => {
    await seedRequestsToggle(true);
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'students', OTHER_UID), pendingRequestPayload());
    });

    await assertFails(
      setDoc(doc(studentDb(), 'students', OTHER_UID), { status: 'approved' }, { merge: true }),
    );
  });

  it('a student can never delete their own document', async () => {
    await seedRequestsToggle(true);
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'students', OTHER_UID), pendingRequestPayload());
    });

    await assertFails(deleteDoc(doc(studentDb(), 'students', OTHER_UID)));
  });
});

// ─── visibility toggle ───────────────────────────────────────────────────────

describe('Firestore rules — verification visibility toggle', () => {
  it('owner can toggle hidden -> public on an active verification', async () => {
    await seedVerification({ status: 'active', visibility: 'hidden' });

    await assertSucceeds(
      setDoc(
        doc(ownerDb(), 'verifications/v1'),
        { visibility: 'public', updatedAt: null },
        { merge: true },
      ),
    );
  });

  it('owner can toggle public -> hidden on an active verification', async () => {
    await seedVerification({ status: 'active', visibility: 'public' });

    await assertSucceeds(
      setDoc(
        doc(ownerDb(), 'verifications/v1'),
        { visibility: 'hidden', updatedAt: null },
        { merge: true },
      ),
    );
  });

  it('owner cannot change config while toggling visibility', async () => {
    await seedVerification({ status: 'active', visibility: 'hidden' });

    await assertFails(
      setDoc(
        doc(ownerDb(), 'verifications/v1'),
        { visibility: 'public', config: { ...BASE_CONFIG, title: 'Cambiato' } },
        { merge: true },
      ),
    );
  });

  it('owner cannot change status while toggling visibility', async () => {
    await seedVerification({ status: 'active', visibility: 'hidden' });

    await assertFails(
      setDoc(
        doc(ownerDb(), 'verifications/v1'),
        { visibility: 'public', status: 'closed' },
        { merge: true },
      ),
    );
  });

  it('owner cannot toggle visibility on a closed verification', async () => {
    await seedVerification({ status: 'closed', visibility: 'hidden' });

    await assertFails(
      setDoc(
        doc(ownerDb(), 'verifications/v1'),
        { visibility: 'public', updatedAt: null },
        { merge: true },
      ),
    );
  });

  it('a non-owner cannot toggle visibility', async () => {
    await seedVerification({ status: 'active', visibility: 'hidden' });

    await assertFails(
      setDoc(
        doc(studentDb(), 'verifications/v1'),
        { visibility: 'public', updatedAt: null },
        { merge: true },
      ),
    );
  });
});

// ─── publishedProjection read access ─────────────────────────────────────────

describe('Firestore rules — verifications/{id}/publishedProjection', () => {
  it('owner can always read publishedProjection, regardless of status/visibility', async () => {
    await seedVerification({ status: 'draft', visibility: 'hidden' }, { withProjection: true });

    await assertSucceeds(getDoc(doc(ownerDb(), 'verifications/v1/publishedProjection/data')));
  });

  it('an approved student can read publishedProjection when active + public and the portal is enabled', async () => {
    await seedVerification(
      { status: 'active', visibility: 'public' },
      { withProjection: true, studentPortalEnabled: true, studentStatus: 'approved' },
    );

    await assertSucceeds(getDoc(doc(studentDb(), 'verifications/v1/publishedProjection/data')));
  });

  it('denies a Google non-owner with no students/{uid} document, even active + public + portal enabled', async () => {
    await seedVerification(
      { status: 'active', visibility: 'public' },
      { withProjection: true, studentPortalEnabled: true },
    );

    await assertFails(getDoc(doc(studentDb(), 'verifications/v1/publishedProjection/data')));
  });

  it('denies a pending student, even active + public + portal enabled', async () => {
    await seedVerification(
      { status: 'active', visibility: 'public' },
      { withProjection: true, studentPortalEnabled: true, studentStatus: 'pending' },
    );

    await assertFails(getDoc(doc(studentDb(), 'verifications/v1/publishedProjection/data')));
  });

  it('denies a blocked student, even active + public + portal enabled', async () => {
    await seedVerification(
      { status: 'active', visibility: 'public' },
      { withProjection: true, studentPortalEnabled: true, studentStatus: 'blocked' },
    );

    await assertFails(getDoc(doc(studentDb(), 'verifications/v1/publishedProjection/data')));
  });

  it('denies an approved student when the student portal is disabled', async () => {
    await seedVerification(
      { status: 'active', visibility: 'public' },
      { withProjection: true, studentPortalEnabled: false, studentStatus: 'approved' },
    );

    await assertFails(getDoc(doc(studentDb(), 'verifications/v1/publishedProjection/data')));
  });

  it('a student cannot read publishedProjection when active but hidden, even if approved', async () => {
    await seedVerification(
      { status: 'active', visibility: 'hidden' },
      { withProjection: true, studentPortalEnabled: true, studentStatus: 'approved' },
    );

    await assertFails(getDoc(doc(studentDb(), 'verifications/v1/publishedProjection/data')));
  });

  it('a student cannot read publishedProjection when the verification is draft, even if approved', async () => {
    await seedVerification(
      { status: 'draft', visibility: 'public' },
      { withProjection: true, studentPortalEnabled: true, studentStatus: 'approved' },
    );

    await assertFails(getDoc(doc(studentDb(), 'verifications/v1/publishedProjection/data')));
  });

  it('a student cannot read publishedProjection when the verification is closed, even if approved', async () => {
    await seedVerification(
      { status: 'closed', visibility: 'public' },
      { withProjection: true, studentPortalEnabled: true, studentStatus: 'approved' },
    );

    await assertFails(getDoc(doc(studentDb(), 'verifications/v1/publishedProjection/data')));
  });

  it('an unauthenticated user can never read publishedProjection, even active + public + portal enabled', async () => {
    await seedVerification(
      { status: 'active', visibility: 'public' },
      { withProjection: true, studentPortalEnabled: true, studentStatus: 'approved' },
    );

    await assertFails(getDoc(doc(anonDb(), 'verifications/v1/publishedProjection/data')));
  });

  it('an approved student can never write publishedProjection, even when active + public', async () => {
    await seedVerification(
      { status: 'active', visibility: 'public' },
      { withProjection: true, studentPortalEnabled: true, studentStatus: 'approved' },
    );

    await assertFails(
      setDoc(
        doc(studentDb(), 'verifications/v1/publishedProjection/data'),
        { questions: [] },
        { merge: true },
      ),
    );
  });

  it('an approved student can never read the parent verification document, even active + public', async () => {
    await seedVerification(
      { status: 'active', visibility: 'public' },
      { studentPortalEnabled: true, studentStatus: 'approved' },
    );

    await assertFails(getDoc(doc(studentDb(), 'verifications/v1')));
  });
});
