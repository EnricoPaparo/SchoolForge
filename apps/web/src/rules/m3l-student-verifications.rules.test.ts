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
import { collectionGroup, doc, getDoc, getDocs, query, setDoc, where } from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import { afterAll, afterEach, beforeAll, describe, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIRESTORE_RULES = resolve(__dirname, '../../../../firestore.rules');

const OWNER_UID = 'owner-uid';
const STUDENT_UID = 'student-uid';

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-schoolforge-m3l-student-verifications',
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
  return testEnv.authenticatedContext(STUDENT_UID).firestore() as unknown as Firestore;
}

/**
 * Seeds settings/owner, settings/ownerPublic, settings/studentAccess
 * (portal enabled unless overridden), an optional students/{STUDENT_UID}
 * document, one verification and (optionally) its publishedProjection — all
 * in a single admin-context callback (see m3l-data-projections.rules.test.ts
 * for why a single callback is used).
 */
async function seed(options: {
  portalEnabled?: boolean;
  studentStatus?: 'pending' | 'approved' | 'blocked';
  studentClassId?: string | null;
  verificationStatus?: 'draft' | 'active' | 'closed';
  visibility?: 'hidden' | 'public';
  projectionClassId?: string | null;
  omitProjectionClassId?: boolean;
  omitProjectionVisibility?: boolean;
}) {
  const {
    portalEnabled = true,
    studentStatus,
    studentClassId = null,
    verificationStatus = 'active',
    visibility = 'public',
    projectionClassId = null,
    omitProjectionClassId = false,
    omitProjectionVisibility = false,
  } = options;
  // Mirrors the real write paths (activateVerification/setVerificationVisibility/
  // closeVerification): the projection's own `visibility` can only ever be
  // 'public' while the parent is 'active' AND toggled public — draft and
  // closed always force it back to 'hidden'.
  const projectionVisibility = verificationStatus === 'active' ? visibility : 'hidden';

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
    }
    await setDoc(doc(db, 'verifications/v1'), {
      ownerUid: OWNER_UID,
      status: verificationStatus,
      visibility,
      config: {
        title: 'Verifica 1',
        classId: projectionClassId,
        programId: 'p1',
        importId: 'i1',
        questionRefs: [],
      },
      teacherSnapshot: null,
      activatedAt: null,
      closedAt: null,
    });
    const projectionData: Record<string, unknown> = {
      ownerUid: OWNER_UID,
      title: 'Verifica 1',
      className: null,
      questions: [{ order: 0, tipo: 'aperta', maxPoints: 3, testo: 'Domanda?' }],
      activatedAt: null,
    };
    if (!omitProjectionClassId) {
      projectionData.classId = projectionClassId;
    }
    if (!omitProjectionVisibility) {
      projectionData.visibility = projectionVisibility;
    }
    await setDoc(doc(db, 'verifications/v1/publishedProjection/data'), projectionData);
  });
}

describe('Firestore rules — verifications publishedProjection student read (M3L-D)', () => {
  it('owner can always read publishedProjection, regardless of status/visibility/classId', async () => {
    await seed({ verificationStatus: 'draft', visibility: 'hidden', omitProjectionClassId: true });

    await assertSucceeds(getDoc(doc(ownerDb(), 'verifications/v1/publishedProjection/data')));
  });

  it('an approved student with a compatible classId can read publishedProjection when active + public', async () => {
    await seed({
      studentStatus: 'approved',
      studentClassId: 'class-a',
      verificationStatus: 'active',
      visibility: 'public',
      projectionClassId: 'class-a',
    });

    await assertSucceeds(getDoc(doc(studentDb(), 'verifications/v1/publishedProjection/data')));
  });

  it('an approved student can list matching verifications via a collectionGroup query on classId + visibility', async () => {
    await seed({
      studentStatus: 'approved',
      studentClassId: 'class-a',
      verificationStatus: 'active',
      visibility: 'public',
      projectionClassId: 'class-a',
    });

    await assertSucceeds(
      getDocs(
        query(
          collectionGroup(studentDb(), 'publishedProjection'),
          where('classId', '==', 'class-a'),
          where('visibility', '==', 'public'),
        ),
      ),
    );
  });

  it('denies a collectionGroup list that filters only on classId, without the visibility filter', async () => {
    await seed({
      studentStatus: 'approved',
      studentClassId: 'class-a',
      verificationStatus: 'active',
      visibility: 'public',
      projectionClassId: 'class-a',
    });

    // The query itself must filter on every field the rule authorizes on —
    // dropping the visibility filter makes the list unprovable, even though
    // the one real matching document would otherwise be readable.
    await assertFails(
      getDocs(
        query(
          collectionGroup(studentDb(), 'publishedProjection'),
          where('classId', '==', 'class-a'),
        ),
      ),
    );
  });

  it('a pending student is denied, even with a compatible classId', async () => {
    await seed({
      studentStatus: 'pending',
      studentClassId: 'class-a',
      projectionClassId: 'class-a',
    });

    await assertFails(getDoc(doc(studentDb(), 'verifications/v1/publishedProjection/data')));
  });

  it('a blocked student is denied, even with a compatible classId', async () => {
    await seed({
      studentStatus: 'blocked',
      studentClassId: 'class-a',
      projectionClassId: 'class-a',
    });

    await assertFails(getDoc(doc(studentDb(), 'verifications/v1/publishedProjection/data')));
  });

  it('a Google non-owner with no students/{uid} document is denied', async () => {
    await seed({ projectionClassId: 'class-a' });

    await assertFails(getDoc(doc(studentDb(), 'verifications/v1/publishedProjection/data')));
  });

  it('an approved student with no classId of their own is denied', async () => {
    await seed({
      studentStatus: 'approved',
      studentClassId: null,
      projectionClassId: 'class-a',
    });

    await assertFails(getDoc(doc(studentDb(), 'verifications/v1/publishedProjection/data')));
  });

  it('an approved student with an incompatible classId is denied', async () => {
    await seed({
      studentStatus: 'approved',
      studentClassId: 'class-z',
      projectionClassId: 'class-a',
    });

    await assertFails(getDoc(doc(studentDb(), 'verifications/v1/publishedProjection/data')));
  });

  it('an approved student is denied when the verification has classId: null (never assigned to a class)', async () => {
    await seed({
      studentStatus: 'approved',
      studentClassId: 'class-a',
      projectionClassId: null,
    });

    await assertFails(getDoc(doc(studentDb(), 'verifications/v1/publishedProjection/data')));
  });

  it('an approved student is denied when the projection has no classId field at all (legacy doc)', async () => {
    await seed({
      studentStatus: 'approved',
      studentClassId: 'class-a',
      omitProjectionClassId: true,
    });

    await assertFails(getDoc(doc(studentDb(), 'verifications/v1/publishedProjection/data')));
  });

  it('an approved student is denied when the projection has no visibility field at all (legacy doc)', async () => {
    await seed({
      studentStatus: 'approved',
      studentClassId: 'class-a',
      projectionClassId: 'class-a',
      omitProjectionVisibility: true,
    });

    await assertFails(getDoc(doc(studentDb(), 'verifications/v1/publishedProjection/data')));
  });

  it('an approved student with a compatible classId is denied when the student portal is disabled', async () => {
    await seed({
      portalEnabled: false,
      studentStatus: 'approved',
      studentClassId: 'class-a',
      projectionClassId: 'class-a',
    });

    await assertFails(getDoc(doc(studentDb(), 'verifications/v1/publishedProjection/data')));
  });

  it('an approved student with a compatible classId is denied when the verification is active but hidden', async () => {
    await seed({
      studentStatus: 'approved',
      studentClassId: 'class-a',
      verificationStatus: 'active',
      visibility: 'hidden',
      projectionClassId: 'class-a',
    });

    await assertFails(getDoc(doc(studentDb(), 'verifications/v1/publishedProjection/data')));
  });

  it('an approved student with a compatible classId is denied when the verification is draft', async () => {
    await seed({
      studentStatus: 'approved',
      studentClassId: 'class-a',
      verificationStatus: 'draft',
      visibility: 'public',
      projectionClassId: 'class-a',
    });

    await assertFails(getDoc(doc(studentDb(), 'verifications/v1/publishedProjection/data')));
  });

  it('an approved student with a compatible classId is denied when the verification is closed', async () => {
    await seed({
      studentStatus: 'approved',
      studentClassId: 'class-a',
      verificationStatus: 'closed',
      visibility: 'public',
      projectionClassId: 'class-a',
    });

    await assertFails(getDoc(doc(studentDb(), 'verifications/v1/publishedProjection/data')));
  });

  it('an approved student can never read the parent verification document, even active + public + compatible class', async () => {
    await seed({
      studentStatus: 'approved',
      studentClassId: 'class-a',
      projectionClassId: 'class-a',
    });

    await assertFails(getDoc(doc(studentDb(), 'verifications/v1')));
  });

  it('an approved student can never read a hypothetical publishedSnapshot subpath', async () => {
    await seed({
      studentStatus: 'approved',
      studentClassId: 'class-a',
      projectionClassId: 'class-a',
    });
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'verifications/v1/publishedSnapshot/data'), {
        ownerUid: OWNER_UID,
      });
    });

    await assertFails(getDoc(doc(studentDb(), 'verifications/v1/publishedSnapshot/data')));
  });

  it('an approved student cannot write publishedProjection, even with a compatible classId', async () => {
    await seed({
      studentStatus: 'approved',
      studentClassId: 'class-a',
      projectionClassId: 'class-a',
    });

    await assertFails(
      setDoc(
        doc(studentDb(), 'verifications/v1/publishedProjection/data'),
        { title: 'Hacked' },
        { merge: true },
      ),
    );
  });
});
