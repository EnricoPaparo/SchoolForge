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
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import { afterAll, afterEach, beforeAll, describe, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIRESTORE_RULES = resolve(__dirname, '../../../../firestore.rules');

const OWNER_UID = 'owner-uid';
const STUDENT_UID = 'student-uid';
const OTHER_STUDENT_UID = 'other-student-uid';
const LESSON_ID = 'i1_lesson-1';
const NOTE_PATH = `students/${STUDENT_UID}/lessonNotes/${LESSON_ID}`;
const INDEX_PATH = `students/${STUDENT_UID}/lessonNoteIndexes/p1`;

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-schoolforge-annot-01',
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
function otherStudentDb() {
  return testEnv.authenticatedContext(OTHER_STUDENT_UID).firestore() as unknown as Firestore;
}
function anonDb() {
  return testEnv.unauthenticatedContext().firestore() as unknown as Firestore;
}

interface SeedOptions {
  studentStatus?: 'approved' | 'pending' | 'blocked';
  studentClassId?: string | null;
  portalEnabled?: boolean;
  examMode?: Record<string, unknown> | null;
  programClassIds?: string[];
  programActiveImportId?: string | null;
  lessonImportId?: string;
  includeProgram?: boolean;
  includeLesson?: boolean;
  /** Seed an already-existing note (owned by STUDENT_UID) for update/delete tests. */
  seedNote?: boolean;
}

async function seed(options: SeedOptions = {}) {
  const {
    studentStatus = 'approved',
    studentClassId = 'class-a',
    portalEnabled = true,
    examMode = null,
    programClassIds = ['class-a'],
    programActiveImportId = 'i1',
    lessonImportId = 'i1',
    includeProgram = true,
    includeLesson = true,
    seedNote = false,
  } = options;

  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'settings/owner'), { ownerUid: OWNER_UID });
    await setDoc(doc(db, 'settings/ownerPublic'), { ownerUid: OWNER_UID });
    await setDoc(doc(db, 'settings/studentAccess'), {
      ownerUid: OWNER_UID,
      studentPortalEnabled: portalEnabled,
      newStudentRequestsEnabled: false,
      ...(examMode !== null ? { examMode } : {}),
    });
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
      email: 'other@example.com',
      displayName: null,
      status: 'approved',
      classId: 'class-a',
    });
    if (includeProgram) {
      await setDoc(doc(db, 'programs/p1'), {
        ownerUid: OWNER_UID,
        title: 'Informatica',
        activeImportId: programActiveImportId,
        classIds: programClassIds,
        createdAt: null,
        updatedAt: null,
      });
    }
    if (includeLesson) {
      await setDoc(doc(db, 'publicLessons', LESSON_ID), {
        ownerUid: OWNER_UID,
        programId: 'p1',
        importId: lessonImportId,
        udaDir: 'uda-01-reti',
        filename: 'lezione-001.md',
        contentPath: 'repository/owner-uid/imports/i1/uda-01-reti/lezione-001.md',
        createdAt: null,
      });
    }
    if (seedNote) {
      await setDoc(doc(db, NOTE_PATH), {
        studentUid: STUDENT_UID,
        publicLessonId: LESSON_ID,
        programId: 'p1',
        importId: 'i1',
        content: 'appunti iniziali',
        createdAt: null,
        updatedAt: null,
      });
    }
  });
}

/** A valid create payload for the owning student. */
function validCreate(overrides: Record<string, unknown> = {}) {
  return {
    studentUid: STUDENT_UID,
    publicLessonId: LESSON_ID,
    programId: 'p1',
    importId: 'i1',
    content: 'appunti',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    ...overrides,
  };
}

function validIndex(overrides: Record<string, unknown> = {}) {
  return {
    studentUid: STUDENT_UID,
    programId: 'p1',
    importId: 'i1',
    lessonIds: [LESSON_ID],
    updatedAt: serverTimestamp(),
    ...overrides,
  };
}

describe('ANNOT-03B rules — private per-course lesson-note index', () => {
  it('allows the approved owning student to create, read and update the own index', async () => {
    await seed();
    await assertSucceeds(setDoc(doc(studentDb(), INDEX_PATH), validIndex()));
    await assertSucceeds(getDoc(doc(studentDb(), INDEX_PATH)));
    await assertSucceeds(
      updateDoc(doc(studentDb(), INDEX_PATH), {
        lessonIds: [],
        updatedAt: serverTimestamp(),
      }),
    );
  });

  it('denies another student and the teacher every index access', async () => {
    await seed();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), INDEX_PATH), {
        ...validIndex(),
        updatedAt: null,
      });
    });
    await assertFails(getDoc(doc(otherStudentDb(), INDEX_PATH)));
    await assertFails(getDoc(doc(ownerDb(), INDEX_PATH)));
    await assertFails(setDoc(doc(otherStudentDb(), INDEX_PATH), validIndex()));
    await assertFails(setDoc(doc(ownerDb(), INDEX_PATH), validIndex()));
  });

  it('denies pending students and every operation during Modalità verifica', async () => {
    await seed({ studentStatus: 'pending' });
    await assertFails(setDoc(doc(studentDb(), INDEX_PATH), validIndex()));

    await testEnv.clearFirestore();
    await seed({ examMode: { enabled: true, scope: 'all', classIds: [] } });
    await assertFails(setDoc(doc(studentDb(), INDEX_PATH), validIndex()));
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), INDEX_PATH), { ...validIndex(), updatedAt: null });
    });
    await assertFails(getDoc(doc(studentDb(), INDEX_PATH)));
  });

  it('denies path/body identity mismatches and inactive imports', async () => {
    await seed();
    await assertFails(
      setDoc(doc(studentDb(), INDEX_PATH), validIndex({ studentUid: OTHER_STUDENT_UID })),
    );
    await assertFails(setDoc(doc(studentDb(), INDEX_PATH), validIndex({ programId: 'p2' })));
    await assertFails(setDoc(doc(studentDb(), INDEX_PATH), validIndex({ importId: 'i2' })));
  });

  it('denies extra keys, arbitrary timestamps and more than 500 lesson ids', async () => {
    await seed();
    await assertFails(setDoc(doc(studentDb(), INDEX_PATH), validIndex({ email: 'x@y.test' })));
    await assertFails(
      setDoc(
        doc(studentDb(), INDEX_PATH),
        validIndex({ updatedAt: new Date('2020-01-01T00:00:00Z') }),
      ),
    );
    await assertFails(
      setDoc(
        doc(studentDb(), INDEX_PATH),
        validIndex({ lessonIds: Array.from({ length: 501 }, (_, index) => `lesson-${index}`) }),
      ),
    );
  });

  it('never allows direct deletion, including by the owning student', async () => {
    await seed();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), INDEX_PATH), { ...validIndex(), updatedAt: null });
    });
    await assertFails(deleteDoc(doc(studentDb(), INDEX_PATH)));
  });
});

// ─── Read surface: get-only (no query/list) ──────────────────────────────────

describe('ANNOT-01 rules — read is get-only (no query/list)', () => {
  it('allows the authorized owning student to getDoc their own note', async () => {
    await seed({ seedNote: true });
    await assertSucceeds(getDoc(doc(studentDb(), NOTE_PATH)));
  });

  it('denies the same student a query/list over students/{uid}/lessonNotes', async () => {
    await seed({ seedNote: true });
    await assertFails(
      getDocs(query(collection(studentDb(), 'students', STUDENT_UID, 'lessonNotes'))),
    );
  });

  it('denies teacher/owner, another student and anonymous a getDoc of the note', async () => {
    await seed({ seedNote: true });
    await assertFails(getDoc(doc(ownerDb(), NOTE_PATH)));
    await assertFails(getDoc(doc(otherStudentDb(), NOTE_PATH)));
    await assertFails(getDoc(doc(anonDb(), NOTE_PATH)));
  });
});

// ─── Authorization matrix ────────────────────────────────────────────────────

describe('ANNOT-01 rules — authorization matrix', () => {
  it('allows the owning student to read/create/update/delete in an authorized context', async () => {
    await seed();
    await assertSucceeds(setDoc(doc(studentDb(), NOTE_PATH), validCreate()));
    await assertSucceeds(getDoc(doc(studentDb(), NOTE_PATH)));
    await assertSucceeds(
      updateDoc(doc(studentDb(), NOTE_PATH), { content: 'v2', updatedAt: serverTimestamp() }),
    );
    await assertSucceeds(deleteDoc(doc(studentDb(), NOTE_PATH)));
  });

  it('denies the teacher/owner every operation', async () => {
    await seed({ seedNote: true });
    await assertFails(getDoc(doc(ownerDb(), NOTE_PATH)));
    await assertFails(setDoc(doc(ownerDb(), NOTE_PATH), validCreate()));
    await assertFails(
      updateDoc(doc(ownerDb(), NOTE_PATH), { content: 'v2', updatedAt: serverTimestamp() }),
    );
    await assertFails(deleteDoc(doc(ownerDb(), NOTE_PATH)));
  });

  it("denies another student reading/writing this student's note", async () => {
    await seed({ seedNote: true });
    await assertFails(getDoc(doc(otherStudentDb(), NOTE_PATH)));
    await assertFails(setDoc(doc(otherStudentDb(), NOTE_PATH), validCreate()));
    await assertFails(deleteDoc(doc(otherStudentDb(), NOTE_PATH)));
  });

  it('denies an anonymous caller', async () => {
    await seed({ seedNote: true });
    await assertFails(getDoc(doc(anonDb(), NOTE_PATH)));
    await assertFails(setDoc(doc(anonDb(), NOTE_PATH), validCreate()));
  });

  it('denies a pending student', async () => {
    await seed({ studentStatus: 'pending' });
    await assertFails(getDoc(doc(studentDb(), NOTE_PATH)));
    await assertFails(setDoc(doc(studentDb(), NOTE_PATH), validCreate()));
  });

  it('denies a blocked student', async () => {
    await seed({ studentStatus: 'blocked' });
    await assertFails(getDoc(doc(studentDb(), NOTE_PATH)));
    await assertFails(setDoc(doc(studentDb(), NOTE_PATH), validCreate()));
  });

  it('denies a student with no class', async () => {
    await seed({ studentClassId: null });
    await assertFails(getDoc(doc(studentDb(), NOTE_PATH)));
    await assertFails(setDoc(doc(studentDb(), NOTE_PATH), validCreate()));
  });

  it('denies when the student portal is disabled', async () => {
    await seed({ portalEnabled: false });
    await assertFails(getDoc(doc(studentDb(), NOTE_PATH)));
    await assertFails(setDoc(doc(studentDb(), NOTE_PATH), validCreate()));
  });

  it("denies when the student's class is not assigned to the program", async () => {
    await seed({ programClassIds: ['class-z'] });
    await assertFails(getDoc(doc(studentDb(), NOTE_PATH)));
    await assertFails(setDoc(doc(studentDb(), NOTE_PATH), validCreate()));
  });

  it('denies when the lesson belongs to an inactive import', async () => {
    await seed({ programActiveImportId: 'i2', lessonImportId: 'i1' });
    await assertFails(getDoc(doc(studentDb(), NOTE_PATH)));
    await assertFails(setDoc(doc(studentDb(), NOTE_PATH), validCreate()));
  });

  it('denies when the publicLesson is missing', async () => {
    await seed({ includeLesson: false });
    await assertFails(getDoc(doc(studentDb(), NOTE_PATH)));
    await assertFails(setDoc(doc(studentDb(), NOTE_PATH), validCreate()));
  });

  it('denies when the program is missing', async () => {
    await seed({ includeProgram: false });
    await assertFails(getDoc(doc(studentDb(), NOTE_PATH)));
    await assertFails(setDoc(doc(studentDb(), NOTE_PATH), validCreate()));
  });
});

// ─── Modalità verifica ───────────────────────────────────────────────────────

describe('ANNOT-01 rules — Modalità verifica denies every operation', () => {
  it('global exam mode denies read/create/update/delete', async () => {
    await seed({ examMode: { enabled: true, scope: 'all', classIds: [] }, seedNote: true });
    await assertFails(getDoc(doc(studentDb(), NOTE_PATH)));
    await assertFails(
      updateDoc(doc(studentDb(), NOTE_PATH), { content: 'v2', updatedAt: serverTimestamp() }),
    );
    await assertFails(deleteDoc(doc(studentDb(), NOTE_PATH)));
  });

  it('class-scoped exam mode denies read/create/update/delete', async () => {
    await seed({
      examMode: { enabled: true, scope: 'classes', classIds: ['class-a'] },
      seedNote: true,
    });
    await assertFails(getDoc(doc(studentDb(), NOTE_PATH)));
    await assertFails(setDoc(doc(studentDb(), NOTE_PATH), validCreate()));
    await assertFails(
      updateDoc(doc(studentDb(), NOTE_PATH), { content: 'v2', updatedAt: serverTimestamp() }),
    );
    await assertFails(deleteDoc(doc(studentDb(), NOTE_PATH)));
  });

  it('exam mode scoped to a different class does not block the student', async () => {
    await seed({ examMode: { enabled: true, scope: 'classes', classIds: ['class-z'] } });
    await assertSucceeds(setDoc(doc(studentDb(), NOTE_PATH), validCreate()));
  });
});

// ─── Create validation ───────────────────────────────────────────────────────

describe('ANNOT-01 rules — create validation', () => {
  it('denies an incoherent studentUid in the body', async () => {
    await seed();
    await assertFails(
      setDoc(doc(studentDb(), NOTE_PATH), validCreate({ studentUid: OTHER_STUDENT_UID })),
    );
  });

  it('denies an incoherent publicLessonId', async () => {
    await seed();
    await assertFails(
      setDoc(doc(studentDb(), NOTE_PATH), validCreate({ publicLessonId: 'other-lesson' })),
    );
  });

  it('denies an incoherent programId', async () => {
    await seed();
    await assertFails(setDoc(doc(studentDb(), NOTE_PATH), validCreate({ programId: 'p2' })));
  });

  it('denies an incoherent importId', async () => {
    await seed();
    await assertFails(setDoc(doc(studentDb(), NOTE_PATH), validCreate({ importId: 'i2' })));
  });

  it('denies an extra field', async () => {
    await seed();
    await assertFails(setDoc(doc(studentDb(), NOTE_PATH), validCreate({ title: 'hack' })));
  });

  it('denies non-string content', async () => {
    await seed();
    await assertFails(setDoc(doc(studentDb(), NOTE_PATH), validCreate({ content: 123 })));
  });

  it('allows content of exactly 20 000 characters', async () => {
    await seed();
    await assertSucceeds(
      setDoc(doc(studentDb(), NOTE_PATH), validCreate({ content: 'x'.repeat(20000) })),
    );
  });

  it('denies content of 20 001 characters', async () => {
    await seed();
    await assertFails(
      setDoc(doc(studentDb(), NOTE_PATH), validCreate({ content: 'x'.repeat(20001) })),
    );
  });

  it('denies an arbitrary (non request.time) createdAt', async () => {
    await seed();
    await assertFails(
      setDoc(
        doc(studentDb(), NOTE_PATH),
        validCreate({ createdAt: new Date('2020-01-01T00:00:00Z') }),
      ),
    );
  });

  it('denies an arbitrary (non request.time) updatedAt', async () => {
    await seed();
    await assertFails(
      setDoc(
        doc(studentDb(), NOTE_PATH),
        validCreate({ updatedAt: new Date('2020-01-01T00:00:00Z') }),
      ),
    );
  });
});

// ─── Update validation ───────────────────────────────────────────────────────

describe('ANNOT-01 rules — update validation', () => {
  it('allows changing only content + updatedAt', async () => {
    await seed({ seedNote: true });
    await assertSucceeds(
      updateDoc(doc(studentDb(), NOTE_PATH), {
        content: 'aggiornato',
        updatedAt: serverTimestamp(),
      }),
    );
  });

  it('denies modifying an identity field', async () => {
    await seed({ seedNote: true });
    await assertFails(
      updateDoc(doc(studentDb(), NOTE_PATH), {
        content: 'v2',
        programId: 'p2',
        updatedAt: serverTimestamp(),
      }),
    );
  });

  it('denies modifying createdAt', async () => {
    await seed({ seedNote: true });
    await assertFails(
      updateDoc(doc(studentDb(), NOTE_PATH), {
        content: 'v2',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }),
    );
  });

  it('denies an updatedAt that is not request.time', async () => {
    await seed({ seedNote: true });
    await assertFails(
      updateDoc(doc(studentDb(), NOTE_PATH), {
        content: 'v2',
        updatedAt: new Date('2020-01-01T00:00:00Z'),
      }),
    );
  });

  it('denies content over the limit on update', async () => {
    await seed({ seedNote: true });
    await assertFails(
      updateDoc(doc(studentDb(), NOTE_PATH), {
        content: 'x'.repeat(20001),
        updatedAt: serverTimestamp(),
      }),
    );
  });
});
