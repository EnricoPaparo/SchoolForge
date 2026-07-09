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
  setDoc,
  where,
} from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import { afterAll, afterEach, beforeAll, describe, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIRESTORE_RULES = resolve(__dirname, '../../../../firestore.rules');

const OWNER_UID = 'owner-uid';
const STUDENT_UID = 'student-uid';

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-schoolforge-m3l-student-lessons',
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
 * document, one program and one publicLessons doc pointing at it — all in a
 * single admin-context callback (see m3l-data-projections.rules.test.ts for
 * why: splitting this across multiple withSecurityRulesDisabled calls within
 * one test intermittently trips the JS SDK's re-configuration guard).
 */
async function seed(options: {
  portalEnabled?: boolean;
  studentStatus?: 'pending' | 'approved' | 'blocked';
  studentClassId?: string | null;
  programClassIds?: string[];
  omitProgramClassIds?: boolean;
}) {
  const {
    portalEnabled = true,
    studentStatus,
    studentClassId = null,
    programClassIds = [],
    omitProgramClassIds = false,
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
    }
    const programData: Record<string, unknown> = {
      ownerUid: OWNER_UID,
      title: 'Informatica',
      activeImportId: 'i1',
      createdAt: null,
      updatedAt: null,
    };
    if (!omitProgramClassIds) {
      programData.classIds = programClassIds;
    }
    await setDoc(doc(db, 'programs/p1'), programData);
    await setDoc(doc(db, 'publicLessons/l1'), {
      ownerUid: OWNER_UID,
      programId: 'p1',
      importId: 'i1',
      udaId: 'uda-1',
      udaDir: 'uda-01-reti',
      path: 'uda-01-reti/lezione-001.md',
      filename: 'lezione-001.md',
      contentPath: 'repository/owner-uid/imports/i1/uda-01-reti/lezione-001.md',
      createdAt: null,
    });
  });
}

describe('Firestore rules — programs/{docId} student read (M3L-C)', () => {
  it('owner can always read the program, regardless of classIds', async () => {
    await seed({ programClassIds: [] });

    await assertSucceeds(getDoc(doc(ownerDb(), 'programs/p1')));
  });

  it('an approved student with a compatible classId can read the program', async () => {
    await seed({
      studentStatus: 'approved',
      studentClassId: 'class-a',
      programClassIds: ['class-a', 'class-b'],
    });

    await assertSucceeds(getDoc(doc(studentDb(), 'programs/p1')));
  });

  it('an approved student can list programs matching their classId via array-contains', async () => {
    await seed({
      studentStatus: 'approved',
      studentClassId: 'class-a',
      programClassIds: ['class-a'],
    });

    await assertSucceeds(
      getDocs(
        query(collection(studentDb(), 'programs'), where('classIds', 'array-contains', 'class-a')),
      ),
    );
  });

  it('a pending student is denied, even with a compatible classId', async () => {
    await seed({
      studentStatus: 'pending',
      studentClassId: 'class-a',
      programClassIds: ['class-a'],
    });

    await assertFails(getDoc(doc(studentDb(), 'programs/p1')));
  });

  it('a blocked student is denied, even with a compatible classId', async () => {
    await seed({
      studentStatus: 'blocked',
      studentClassId: 'class-a',
      programClassIds: ['class-a'],
    });

    await assertFails(getDoc(doc(studentDb(), 'programs/p1')));
  });

  it('a Google non-owner with no students/{uid} document is denied', async () => {
    await seed({ programClassIds: ['class-a'] });

    await assertFails(getDoc(doc(studentDb(), 'programs/p1')));
  });

  it('an approved student with no classId of their own is denied', async () => {
    await seed({
      studentStatus: 'approved',
      studentClassId: null,
      programClassIds: ['class-a'],
    });

    await assertFails(getDoc(doc(studentDb(), 'programs/p1')));
  });

  it('an approved student with an incompatible classId is denied', async () => {
    await seed({
      studentStatus: 'approved',
      studentClassId: 'class-z',
      programClassIds: ['class-a', 'class-b'],
    });

    await assertFails(getDoc(doc(studentDb(), 'programs/p1')));
  });

  it('an approved student is denied when the program has an empty classIds array', async () => {
    await seed({
      studentStatus: 'approved',
      studentClassId: 'class-a',
      programClassIds: [],
    });

    await assertFails(getDoc(doc(studentDb(), 'programs/p1')));
  });

  it('an approved student is denied when the program has no classIds field at all (legacy doc)', async () => {
    await seed({
      studentStatus: 'approved',
      studentClassId: 'class-a',
      omitProgramClassIds: true,
    });

    await assertFails(getDoc(doc(studentDb(), 'programs/p1')));
  });

  it('an approved student with a compatible classId is denied when the student portal is disabled', async () => {
    await seed({
      portalEnabled: false,
      studentStatus: 'approved',
      studentClassId: 'class-a',
      programClassIds: ['class-a'],
    });

    await assertFails(getDoc(doc(studentDb(), 'programs/p1')));
  });

  it('an approved student can never read a program subcollection (imports/technical data)', async () => {
    await seed({
      studentStatus: 'approved',
      studentClassId: 'class-a',
      programClassIds: ['class-a'],
    });
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'programs/p1/imports/i1'), { ownerUid: OWNER_UID });
    });

    await assertFails(getDoc(doc(studentDb(), 'programs/p1/imports/i1')));
  });
});

describe('Firestore rules — publicLessons student read (M3L-C)', () => {
  it('owner can always read publicLessons, regardless of classIds', async () => {
    await seed({ programClassIds: [] });

    await assertSucceeds(getDoc(doc(ownerDb(), 'publicLessons/l1')));
  });

  it('owner can delete publicLessons during program cleanup', async () => {
    await seed({ programClassIds: [] });

    await assertSucceeds(deleteDoc(doc(ownerDb(), 'publicLessons/l1')));
  });

  it('an approved student with a compatible classId can read publicLessons', async () => {
    await seed({
      studentStatus: 'approved',
      studentClassId: 'class-a',
      programClassIds: ['class-a'],
    });

    await assertSucceeds(getDoc(doc(studentDb(), 'publicLessons/l1')));
  });

  it('an approved student can list publicLessons for a compatible program', async () => {
    await seed({
      studentStatus: 'approved',
      studentClassId: 'class-a',
      programClassIds: ['class-a'],
    });

    await assertSucceeds(
      getDocs(query(collection(studentDb(), 'publicLessons'), where('programId', '==', 'p1'))),
    );
  });

  it('a pending student is denied, even with a compatible classId', async () => {
    await seed({
      studentStatus: 'pending',
      studentClassId: 'class-a',
      programClassIds: ['class-a'],
    });

    await assertFails(getDoc(doc(studentDb(), 'publicLessons/l1')));
  });

  it('a blocked student is denied, even with a compatible classId', async () => {
    await seed({
      studentStatus: 'blocked',
      studentClassId: 'class-a',
      programClassIds: ['class-a'],
    });

    await assertFails(getDoc(doc(studentDb(), 'publicLessons/l1')));
  });

  it('a Google non-owner with no students/{uid} document is denied', async () => {
    await seed({ programClassIds: ['class-a'] });

    await assertFails(getDoc(doc(studentDb(), 'publicLessons/l1')));
  });

  it('an approved student with no classId of their own is denied', async () => {
    await seed({
      studentStatus: 'approved',
      studentClassId: null,
      programClassIds: ['class-a'],
    });

    await assertFails(getDoc(doc(studentDb(), 'publicLessons/l1')));
  });

  it('an approved student with an incompatible classId is denied', async () => {
    await seed({
      studentStatus: 'approved',
      studentClassId: 'class-z',
      programClassIds: ['class-a', 'class-b'],
    });

    await assertFails(getDoc(doc(studentDb(), 'publicLessons/l1')));
  });

  it('an approved student is denied when the parent program has an empty classIds array', async () => {
    await seed({
      studentStatus: 'approved',
      studentClassId: 'class-a',
      programClassIds: [],
    });

    await assertFails(getDoc(doc(studentDb(), 'publicLessons/l1')));
  });

  it('an approved student is denied when the parent program has no classIds field at all (legacy doc)', async () => {
    await seed({
      studentStatus: 'approved',
      studentClassId: 'class-a',
      omitProgramClassIds: true,
    });

    await assertFails(getDoc(doc(studentDb(), 'publicLessons/l1')));
  });

  it('an approved student with a compatible classId is denied when the student portal is disabled', async () => {
    await seed({
      portalEnabled: false,
      studentStatus: 'approved',
      studentClassId: 'class-a',
      programClassIds: ['class-a'],
    });

    await assertFails(getDoc(doc(studentDb(), 'publicLessons/l1')));
  });

  it('an approved student cannot write publicLessons, even with a compatible classId', async () => {
    await seed({
      studentStatus: 'approved',
      studentClassId: 'class-a',
      programClassIds: ['class-a'],
    });

    await assertFails(
      setDoc(doc(studentDb(), 'publicLessons/l1'), { filename: 'hacked.md' }, { merge: true }),
    );
  });

  it('an approved student cannot delete publicLessons, even with a compatible classId', async () => {
    await seed({
      studentStatus: 'approved',
      studentClassId: 'class-a',
      programClassIds: ['class-a'],
    });

    await assertFails(deleteDoc(doc(studentDb(), 'publicLessons/l1')));
  });
});
