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
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import { afterAll, afterEach, beforeAll, describe, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIRESTORE_RULES = resolve(__dirname, '../../../../firestore.rules');

const OWNER_UID = 'owner-uid';
const STUDENT_UID = 'student-uid';

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-schoolforge-m3f-07',
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
 * Seeds owner/ownerPublic, an approved student in `studentClassId`,
 * settings/studentAccess (with an optional examMode block), one program +
 * publicLessons pair assigned to `studentClassId`, an active+online
 * verification for the same class with its publishedProjection, and a draft
 * submission for the student — everything a single test might need, seeded
 * in one admin-context callback (see m3l-student-lessons.rules.test.ts for
 * why: splitting this across multiple withSecurityRulesDisabled calls
 * within one test intermittently trips the JS SDK's re-configuration guard).
 */
async function seed(options: {
  examMode?: Record<string, unknown> | null;
  studentClassId?: string | null;
}) {
  const { examMode = null, studentClassId = 'class-a' } = options;

  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'settings/owner'), { ownerUid: OWNER_UID });
    await setDoc(doc(db, 'settings/ownerPublic'), { ownerUid: OWNER_UID });
    await setDoc(doc(db, 'settings/studentAccess'), {
      ownerUid: OWNER_UID,
      studentPortalEnabled: true,
      newStudentRequestsEnabled: false,
      ...(examMode !== null ? { examMode } : {}),
    });
    await setDoc(doc(db, 'students', STUDENT_UID), {
      uid: STUDENT_UID,
      ownerUid: OWNER_UID,
      email: 'student@example.com',
      displayName: null,
      status: 'approved',
      classId: studentClassId,
    });
    await setDoc(doc(db, 'programs/p1'), {
      ownerUid: OWNER_UID,
      title: 'Informatica',
      activeImportId: 'i1',
      classIds: ['class-a'],
      createdAt: null,
      updatedAt: null,
    });
    await setDoc(doc(db, 'publicLessons/l1'), {
      ownerUid: OWNER_UID,
      programId: 'p1',
      importId: 'i1',
      udaDir: 'uda-01-reti',
      filename: 'lezione-001.md',
      contentPath: 'repository/owner-uid/imports/i1/uda-01-reti/lezione-001.md',
      createdAt: null,
    });
    await setDoc(doc(db, 'verifications/v1'), {
      ownerUid: OWNER_UID,
      status: 'active',
      visibility: 'public',
      onlineEnabled: true,
      config: {
        title: 'V1',
        classId: 'class-a',
        programId: 'p1',
        importId: 'i1',
        questionRefs: [],
      },
      teacherSnapshot: {
        title: 'V1',
        classId: 'class-a',
        className: 'Classe A',
        programId: 'p1',
        importId: 'i1',
        questionRefs: [],
        activatedAt: null,
      },
      activatedAt: null,
      closedAt: null,
    });
    await setDoc(doc(db, 'verifications/v1/publishedProjection/data'), {
      ownerUid: OWNER_UID,
      title: 'V1',
      className: 'Classe A',
      visibility: 'public',
      classId: 'class-a',
      onlineEnabled: true,
      questions: [],
      activatedAt: null,
    });
    await setDoc(doc(db, 'submissions/v1_student-uid'), {
      submissionId: 'v1_student-uid',
      verificationId: 'v1',
      studentUid: STUDENT_UID,
      ownerUid: OWNER_UID,
      status: 'draft',
      answers: {},
      flagged: {},
      attentionEvents: [],
      deliveryCode: null,
      verificationTitle: 'V1',
      className: 'Classe A',
      startedAt: null,
      lastSavedAt: null,
      submittedAt: null,
    });
  });
}

describe('Firestore rules — Modalità verifica (M3F-07): programs blocked', () => {
  it('denies programs read when scope=classes includes the student class', async () => {
    await seed({ examMode: { enabled: true, scope: 'classes', classIds: ['class-a'] } });

    await assertFails(getDoc(doc(studentDb(), 'programs/p1')));
  });

  it('allows programs read for a class not covered by scope=classes', async () => {
    await seed({
      examMode: { enabled: true, scope: 'classes', classIds: ['class-z'] },
      studentClassId: 'class-a',
    });

    await assertSucceeds(getDoc(doc(studentDb(), 'programs/p1')));
  });

  it('denies programs read for every class when scope=all', async () => {
    await seed({ examMode: { enabled: true, scope: 'all', classIds: [] } });

    await assertFails(getDoc(doc(studentDb(), 'programs/p1')));
  });

  it('allows programs read when examMode is absent (backward compatible default)', async () => {
    await seed({ examMode: null });

    await assertSucceeds(getDoc(doc(studentDb(), 'programs/p1')));
  });

  it('allows programs read when examMode.enabled is false', async () => {
    await seed({ examMode: { enabled: false, scope: 'all', classIds: [] } });

    await assertSucceeds(getDoc(doc(studentDb(), 'programs/p1')));
  });

  it('the owner can still read/write programs while exam mode is globally active', async () => {
    await seed({ examMode: { enabled: true, scope: 'all', classIds: [] } });

    await assertSucceeds(getDoc(doc(ownerDb(), 'programs/p1')));
    await assertSucceeds(
      setDoc(doc(ownerDb(), 'programs/p1'), { title: 'Aggiornato' }, { merge: true }),
    );
  });
});

describe('Firestore rules — Modalità verifica (M3F-07): publicLessons blocked', () => {
  it('denies publicLessons read when scope=classes includes the student class', async () => {
    await seed({ examMode: { enabled: true, scope: 'classes', classIds: ['class-a'] } });

    await assertFails(getDoc(doc(studentDb(), 'publicLessons/l1')));
  });

  it('allows publicLessons read for a class not covered by scope=classes', async () => {
    await seed({
      examMode: { enabled: true, scope: 'classes', classIds: ['class-z'] },
      studentClassId: 'class-a',
    });

    await assertSucceeds(getDoc(doc(studentDb(), 'publicLessons/l1')));
  });

  it('denies publicLessons read for every class when scope=all', async () => {
    await seed({ examMode: { enabled: true, scope: 'all', classIds: [] } });

    await assertFails(getDoc(doc(studentDb(), 'publicLessons/l1')));
  });

  it('the owner can still read publicLessons while exam mode is globally active', async () => {
    await seed({ examMode: { enabled: true, scope: 'all', classIds: [] } });

    await assertSucceeds(getDoc(doc(ownerDb(), 'publicLessons/l1')));
  });
});

describe('Firestore rules — Modalità verifica (M3F-07): never touches verifications/submissions', () => {
  it('publishedProjection stays readable for the blocked class', async () => {
    await seed({ examMode: { enabled: true, scope: 'all', classIds: [] } });

    await assertSucceeds(getDoc(doc(studentDb(), 'verifications/v1/publishedProjection/data')));
  });

  it("the student's own in-progress draft submission stays readable", async () => {
    await seed({ examMode: { enabled: true, scope: 'all', classIds: [] } });

    await assertSucceeds(getDoc(doc(studentDb(), 'submissions/v1_student-uid')));
  });

  it('the student can still autosave the in-progress draft submission', async () => {
    await seed({ examMode: { enabled: true, scope: 'classes', classIds: ['class-a'] } });

    await assertSucceeds(
      setDoc(doc(studentDb(), 'submissions/v1_student-uid'), {
        submissionId: 'v1_student-uid',
        verificationId: 'v1',
        studentUid: STUDENT_UID,
        ownerUid: OWNER_UID,
        status: 'draft',
        answers: { '0': { tipo: 'aperta', testo: 'risposta' } },
        flagged: {},
        attentionEvents: [],
        deliveryCode: null,
        verificationTitle: 'V1',
        className: 'Classe A',
        startedAt: null,
        lastSavedAt: serverTimestamp(),
        submittedAt: null,
      }),
    );
  });

  it('the owner monitor read on submissions is unaffected', async () => {
    await seed({ examMode: { enabled: true, scope: 'all', classIds: [] } });

    await assertSucceeds(getDoc(doc(ownerDb(), 'submissions/v1_student-uid')));
  });
});
