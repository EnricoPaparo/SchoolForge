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
import { doc, setDoc } from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import { getBytes, ref, uploadBytes } from 'firebase/storage';
import type { FirebaseStorage } from 'firebase/storage';
import { afterAll, afterEach, beforeAll, describe, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIRESTORE_RULES = resolve(__dirname, '../../../../firestore.rules');
const STORAGE_RULES = resolve(__dirname, '../../../../storage.rules');

const OWNER_UID = 'owner-uid';
const STUDENT_UID = 'student-uid';
const PROGRAM_ID = 'p1';
const LESSON_PATH = `repository/${OWNER_UID}/imports/imp-1/uda-01-reti/lezione-001.md`;
const POOL_PATH = `repository/${OWNER_UID}/imports/imp-1/uda-01-reti/lezione-001.pool.md`;

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    // Must match the emulator suite's --project flag (see package.json
    // test:rules): Storage Rules' cross-service firestore.get()/exists()
    // resolve documents against the emulator's single configured default
    // project, regardless of the projectId this environment declares.
    projectId: 'demo-schoolforge',
    firestore: {
      rules: readFileSync(FIRESTORE_RULES, 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
    storage: {
      rules: readFileSync(STORAGE_RULES, 'utf8'),
      host: '127.0.0.1',
      port: 9199,
    },
  });
});

afterEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.clearStorage();
});

afterAll(async () => {
  await testEnv.cleanup();
});

function ownerStorage() {
  return testEnv.authenticatedContext(OWNER_UID).storage() as unknown as FirebaseStorage;
}

function studentStorage() {
  return testEnv.authenticatedContext(STUDENT_UID).storage() as unknown as FirebaseStorage;
}

/**
 * Seeds settings/owner, settings/studentAccess (portal enabled unless
 * overridden), an optional students/{STUDENT_UID} document, and one
 * `programs/{PROGRAM_ID}` document — then uploads the lesson + pool files
 * to Storage (as the owner, through the real rules) tagged exactly like
 * importRepository tags them, unless a custom upload is requested.
 */
async function seed(options: {
  portalEnabled?: boolean;
  studentStatus?: 'pending' | 'approved' | 'blocked';
  studentClassId?: string | null;
  programClassIds?: string[];
  omitProgramClassIds?: boolean;
  omitLessonProgramIdMetadata?: boolean;
}) {
  const {
    portalEnabled = true,
    studentStatus,
    studentClassId = null,
    programClassIds = [],
    omitProgramClassIds = false,
    omitLessonProgramIdMetadata = false,
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
      activeImportId: 'imp-1',
      createdAt: null,
      updatedAt: null,
    };
    if (!omitProgramClassIds) {
      programData.classIds = programClassIds;
    }
    await setDoc(doc(db, 'programs', PROGRAM_ID), programData);

    const st = ctx.storage();
    await uploadBytes(ref(st, LESSON_PATH), new Uint8Array([1]), {
      customMetadata: omitLessonProgramIdMetadata
        ? { kind: 'lesson' }
        : { kind: 'lesson', programId: PROGRAM_ID },
    });
    await uploadBytes(ref(st, POOL_PATH), new Uint8Array([1]), {
      customMetadata: { kind: 'pool', programId: PROGRAM_ID },
    });
  });
}

describe('Storage rules — lesson file class gate (M3L-C)', () => {
  it('owner can always read the lesson and pool files, regardless of classIds', async () => {
    await seed({ programClassIds: [] });

    await assertSucceeds(getBytes(ref(ownerStorage(), LESSON_PATH)));
    await assertSucceeds(getBytes(ref(ownerStorage(), POOL_PATH)));
  });

  it('an approved student with a compatible classId can read the lesson file', async () => {
    await seed({
      studentStatus: 'approved',
      studentClassId: 'class-a',
      programClassIds: ['class-a', 'class-b'],
    });

    await assertSucceeds(getBytes(ref(studentStorage(), LESSON_PATH)));
  });

  it('denies the pool file even for a class-compatible approved student', async () => {
    await seed({
      studentStatus: 'approved',
      studentClassId: 'class-a',
      programClassIds: ['class-a'],
    });

    await assertFails(getBytes(ref(studentStorage(), POOL_PATH)));
  });

  it('a pending student is denied, even with a compatible classId', async () => {
    await seed({
      studentStatus: 'pending',
      studentClassId: 'class-a',
      programClassIds: ['class-a'],
    });

    await assertFails(getBytes(ref(studentStorage(), LESSON_PATH)));
  });

  it('a blocked student is denied, even with a compatible classId', async () => {
    await seed({
      studentStatus: 'blocked',
      studentClassId: 'class-a',
      programClassIds: ['class-a'],
    });

    await assertFails(getBytes(ref(studentStorage(), LESSON_PATH)));
  });

  it('a Google non-owner with no students/{uid} document is denied', async () => {
    await seed({ programClassIds: ['class-a'] });

    await assertFails(getBytes(ref(studentStorage(), LESSON_PATH)));
  });

  it('an approved student with no classId of their own is denied', async () => {
    await seed({
      studentStatus: 'approved',
      studentClassId: null,
      programClassIds: ['class-a'],
    });

    await assertFails(getBytes(ref(studentStorage(), LESSON_PATH)));
  });

  it('an approved student with an incompatible classId is denied', async () => {
    await seed({
      studentStatus: 'approved',
      studentClassId: 'class-z',
      programClassIds: ['class-a', 'class-b'],
    });

    await assertFails(getBytes(ref(studentStorage(), LESSON_PATH)));
  });

  it('an approved student is denied when the program has an empty classIds array', async () => {
    await seed({
      studentStatus: 'approved',
      studentClassId: 'class-a',
      programClassIds: [],
    });

    await assertFails(getBytes(ref(studentStorage(), LESSON_PATH)));
  });

  it('an approved student is denied when the program has no classIds field at all (legacy doc)', async () => {
    await seed({
      studentStatus: 'approved',
      studentClassId: 'class-a',
      omitProgramClassIds: true,
    });

    await assertFails(getBytes(ref(studentStorage(), LESSON_PATH)));
  });

  it('an approved student with a compatible classId is denied when the student portal is disabled', async () => {
    await seed({
      portalEnabled: false,
      studentStatus: 'approved',
      studentClassId: 'class-a',
      programClassIds: ['class-a'],
    });

    await assertFails(getBytes(ref(studentStorage(), LESSON_PATH)));
  });

  it('denies a class-compatible approved student when the lesson file has no programId metadata (legacy upload)', async () => {
    await seed({
      studentStatus: 'approved',
      studentClassId: 'class-a',
      programClassIds: ['class-a'],
      omitLessonProgramIdMetadata: true,
    });

    await assertFails(getBytes(ref(studentStorage(), LESSON_PATH)));
  });

  it('an approved student cannot write the lesson file, even with a compatible classId', async () => {
    await seed({
      studentStatus: 'approved',
      studentClassId: 'class-a',
      programClassIds: ['class-a'],
    });

    await assertFails(
      uploadBytes(ref(studentStorage(), LESSON_PATH), new Uint8Array([9]), {
        customMetadata: { kind: 'lesson', programId: PROGRAM_ID },
      }),
    );
  });
});
