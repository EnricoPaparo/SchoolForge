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

  it('a non-owner (student) cannot read settings/studentAccess directly', async () => {
    await seedOwnerOnly();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'settings/studentAccess'), {
        ownerUid: OWNER_UID,
        studentPortalEnabled: true,
        newStudentRequestsEnabled: false,
      });
    });

    await assertFails(getDoc(doc(studentDb(), 'settings/studentAccess')));
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

  it('a student cannot read their own students/{uid} document', async () => {
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

    await assertFails(getDoc(doc(studentDb(), 'students', OTHER_UID)));
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
