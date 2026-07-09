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
import { collection, doc, getDoc, getDocs, query, setDoc, where } from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import { ref, uploadBytes, getBytes, getMetadata } from 'firebase/storage';
import type { FirebaseStorage } from 'firebase/storage';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { importRepository } from '../features/repository/import/importRepository.js';
import type { RawFile } from '../features/repository/validation/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIRESTORE_RULES = resolve(__dirname, '../../../../firestore.rules');
const STORAGE_RULES = resolve(__dirname, '../../../../storage.rules');

const OWNER_UID = 'owner-uid';
const OTHER_UID = 'other-uid';

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    // Must match the emulator suite's --project flag (see package.json
    // test:rules): Storage Rules' cross-service firestore.get()/exists()
    // (used by isApprovedStudent() in storage.rules) resolve documents
    // against the emulator's single configured default project, regardless
    // of the projectId this specific RulesTestEnvironment declares. A
    // mismatched projectId here would make every cross-service Firestore
    // lookup 404, silently denying every approved-student Storage read.
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

async function seedOwner() {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'settings/owner'), { ownerUid: OWNER_UID });
    // Real bootstrap (OwnerSetup) writes both docs in the same batch — tests
    // that exercise publicLessons student-read access need ownerPublic too.
    await setDoc(doc(db, 'settings/ownerPublic'), { ownerUid: OWNER_UID });
  });
}

// Approved-student model (M3-lite): a Google-authenticated non-owner is only
// a candidate student until both of these are true — the portal is globally
// enabled AND their own students/{uid} document says 'approved'. Neither
// helper is called by seedOwner() itself, so any test that doesn't call them
// exercises the safe default (no settings/studentAccess, no students/{uid} =>
// every student read denied).
async function seedStudentAccess(studentPortalEnabled: boolean) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'settings/studentAccess'), {
      ownerUid: OWNER_UID,
      studentPortalEnabled,
      newStudentRequestsEnabled: false,
    });
  });
}

async function seedStudent(
  status: 'pending' | 'approved' | 'blocked',
  classId: string | null = null,
) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'students', OTHER_UID), {
      uid: OTHER_UID,
      ownerUid: OWNER_UID,
      email: 'student@example.com',
      displayName: null,
      status,
      classId,
    });
  });
}

// M3L-C: importRepository itself doesn't set classIds (a program is not
// assigned to any class at import time — that's a separate teacher action,
// see programsService.setProgramClassIds), so tests that need a
// class-compatible student must assign the program to a class explicitly.
async function seedProgramClassIds(programId: string, classIds: string[]) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'programs', programId), { classIds }, { merge: true });
  });
}

function ownerDb() {
  return testEnv.authenticatedContext(OWNER_UID).firestore() as unknown as Firestore;
}

function ownerStorage() {
  return testEnv.authenticatedContext(OWNER_UID).storage() as unknown as FirebaseStorage;
}

function otherDb() {
  return testEnv.authenticatedContext(OTHER_UID).firestore() as unknown as Firestore;
}

function otherStorage() {
  return testEnv.authenticatedContext(OTHER_UID).storage() as unknown as FirebaseStorage;
}

function anonDb() {
  return testEnv.unauthenticatedContext().firestore() as unknown as Firestore;
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

const UDA_FILE: RawFile = {
  path: 'uda-01-reti/uda-01-reti.md',
  content: `---
titolo: Reti di computer
competenze:
  - Comprendere ISO/OSI
obiettivi:
  - Descrivere HTTP
---
`,
};

const LESSON: RawFile = {
  path: 'uda-01-reti/lezione-001-http.md',
  content: '# HTTP\n\nContenuto.',
};

const VALID_POOL: RawFile = {
  path: 'uda-01-reti/lezione-001-http.pool.md',
  content: `---
schema: schoolforge-pool/v1
questions:
  - id: q-001
    tipo: aperta
    difficolta: 2
    peso: 3
    testo: Spiega HTTP.
    soluzione: HTTP è un protocollo applicativo.
  - id: q-002
    tipo: chiusa_singola
    difficolta: 1
    peso: 1
    testo: Porta HTTP?
    opzioni:
      - id: a
        testo: "80"
      - id: b
        testo: "443"
    soluzione: [a]
---`,
};

const LESSON_NO_POOL: RawFile = {
  path: 'uda-01-reti/lezione-002-https.md',
  content: '# HTTPS',
};

const INVALID_POOL_FILE: RawFile = {
  path: 'uda-01-reti/lezione-002-https.pool.md',
  content: `---
schema: schoolforge-pool/v1
questions:
  - id: q-001
    tipo: aperta
    testo: Domanda senza difficolta e peso.
---`,
};

const VALID_FILES = [UDA_FILE, LESSON, VALID_POOL, LESSON_NO_POOL];
const INVALID_POOL_FILES = [UDA_FILE, LESSON, LESSON_NO_POOL, INVALID_POOL_FILE];

// ─── Security Rules — Firestore paths ────────────────────────────────────────

describe('Firestore rules — programs/{id}/imports/{id} owner-scoped', () => {
  it('allows owner to write import metadata', async () => {
    await seedOwner();
    const db = ownerDb();
    await assertSucceeds(
      setDoc(doc(db, 'programs/p1/imports/imp-1'), { status: 'committed', ownerUid: OWNER_UID }),
    );
  });

  it('allows owner to read import metadata', async () => {
    await seedOwner();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'programs/p1/imports/imp-1'), { status: 'committed' });
    });
    const db = ownerDb();
    await assertSucceeds(getDoc(doc(db, 'programs/p1/imports/imp-1')));
  });

  it('denies other authenticated user from reading import', async () => {
    await seedOwner();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'programs/p1/imports/imp-1'), { status: 'committed' });
    });
    const other = testEnv.authenticatedContext(OTHER_UID);
    await assertFails(getDoc(doc(other.firestore(), 'programs/p1/imports/imp-1')));
  });

  it('allows owner to write questionIndex subcollection', async () => {
    await seedOwner();
    const db = ownerDb();
    await assertSucceeds(
      setDoc(doc(db, 'programs/p1/imports/imp-1/questionIndex/q-01'), {
        tipo: 'aperta',
        difficolta: 1,
        peso: 1,
      }),
    );
  });

  it('denies other user from reading questionIndex', async () => {
    await seedOwner();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'programs/p1/imports/imp-1/questionIndex/q-01'), {
        tipo: 'aperta',
      });
    });
    const other = testEnv.authenticatedContext(OTHER_UID);
    await assertFails(
      getDoc(doc(other.firestore(), 'programs/p1/imports/imp-1/questionIndex/q-01')),
    );
  });
});

// ─── Integration — importRepository ──────────────────────────────────────────

describe('importRepository — valid import', () => {
  it('returns status committed with correct counts', async () => {
    await seedOwner();
    const db = ownerDb();
    const storage = ownerStorage();

    const result = await importRepository(
      { ownerUid: OWNER_UID, programmaTitle: 'Informatica', files: VALID_FILES },
      { db, storage },
    );

    expect(result.status).toBe('committed');
    if (result.status !== 'committed') return;
    expect(result.udaCount).toBe(1);
    expect(result.lessonCount).toBe(2);
    expect(result.questionCount).toBe(2);
    expect(result.programId).toBeTruthy();
    expect(result.importId).toBeTruthy();
  });

  it('sets activeImportId on the program document', async () => {
    await seedOwner();
    const db = ownerDb();
    const storage = ownerStorage();

    const result = await importRepository(
      { ownerUid: OWNER_UID, programmaTitle: 'Informatica', files: VALID_FILES },
      { db, storage },
    );

    if (result.status !== 'committed') throw new Error('expected committed');

    const programSnap = await getDoc(doc(db, 'programs', result.programId));
    expect(programSnap.exists()).toBe(true);
    expect(programSnap.data()?.activeImportId).toBe(result.importId);
    expect(programSnap.data()?.ownerUid).toBe(OWNER_UID);
  });

  it('creates import metadata document in Firestore', async () => {
    await seedOwner();
    const db = ownerDb();
    const storage = ownerStorage();

    const result = await importRepository(
      { ownerUid: OWNER_UID, programmaTitle: 'Informatica', files: VALID_FILES },
      { db, storage },
    );

    if (result.status !== 'committed') throw new Error('expected committed');

    const importSnap = await getDoc(
      doc(db, 'programs', result.programId, 'imports', result.importId),
    );
    expect(importSnap.exists()).toBe(true);
    const data = importSnap.data()!;
    expect(data.status).toBe('committed');
    expect(data.udaCount).toBe(1);
    expect(data.lessonCount).toBe(2);
    expect(data.questionCount).toBe(2);
  });

  it('uploads files to Storage under repository/{ownerUid}/imports/{importId}/...', async () => {
    await seedOwner();
    const db = ownerDb();
    const storage = ownerStorage();

    const result = await importRepository(
      { ownerUid: OWNER_UID, programmaTitle: 'Informatica', files: VALID_FILES },
      { db, storage },
    );

    if (result.status !== 'committed') throw new Error('expected committed');

    const udaRef = ref(
      storage,
      `repository/${OWNER_UID}/imports/${result.importId}/${UDA_FILE.path}`,
    );
    await expect(getBytes(udaRef)).resolves.toBeDefined();
  });

  it('creates questionIndex entries for valid pool only', async () => {
    await seedOwner();
    const db = ownerDb();
    const storage = ownerStorage();

    const result = await importRepository(
      { ownerUid: OWNER_UID, programmaTitle: 'Informatica', files: VALID_FILES },
      { db, storage },
    );

    if (result.status !== 'committed') throw new Error('expected committed');

    const qiSnap = await getDocs(
      collection(db, 'programs', result.programId, 'imports', result.importId, 'questionIndex'),
    );
    expect(qiSnap.size).toBe(2);
    for (const d of qiSnap.docs) {
      const data = d.data();
      expect(data).toHaveProperty('tipo');
      expect(data).toHaveProperty('difficolta');
      expect(data).toHaveProperty('peso');
      expect(data).toHaveProperty('maxPoints');
      expect(data).not.toHaveProperty('testo');
      expect(data).not.toHaveProperty('soluzione');
    }
  });

  it('creates an auditEvent for the committed import', async () => {
    await seedOwner();
    const db = ownerDb();
    const storage = ownerStorage();

    const result = await importRepository(
      { ownerUid: OWNER_UID, programmaTitle: 'Informatica', files: VALID_FILES },
      { db, storage },
    );

    if (result.status !== 'committed') throw new Error('expected committed');

    const auditSnap = await getDocs(collection(db, 'auditEvents'));
    const events = auditSnap.docs.map((d) => d.data());
    const importEvent = events.find(
      (e) => e.action === 'import.committed' && e.targetId === result.importId,
    );
    expect(importEvent).toBeDefined();
    expect(importEvent?.actorUid).toBe(OWNER_UID);
    expect(importEvent?.outcome).toBe('success');
  });

  it('reuses provided programId and updates activeImportId', async () => {
    await seedOwner();
    const db = ownerDb();
    const storage = ownerStorage();

    // First import
    const r1 = await importRepository(
      { ownerUid: OWNER_UID, programmaTitle: 'Informatica', files: VALID_FILES },
      { db, storage },
    );
    if (r1.status !== 'committed') throw new Error('expected committed');

    // Second import to the same programId
    const r2 = await importRepository(
      {
        ownerUid: OWNER_UID,
        programmaTitle: 'Informatica v2',
        programId: r1.programId,
        files: VALID_FILES,
      },
      { db, storage },
    );
    if (r2.status !== 'committed') throw new Error('expected committed');

    expect(r2.programId).toBe(r1.programId);
    expect(r2.importId).not.toBe(r1.importId);

    const programSnap = await getDoc(doc(db, 'programs', r1.programId));
    expect(programSnap.data()?.activeImportId).toBe(r2.importId);
  });
});

describe('importRepository — invalid pool does not block import', () => {
  it('returns committed even with invalid pool', async () => {
    await seedOwner();
    const db = ownerDb();
    const storage = ownerStorage();

    const result = await importRepository(
      { ownerUid: OWNER_UID, programmaTitle: 'Informatica', files: INVALID_POOL_FILES },
      { db, storage },
    );

    expect(result.status).toBe('committed');
    if (result.status !== 'committed') return;
    expect(result.questionCount).toBe(0);
    const poolIssues = result.validationIssues.filter(
      (i) => i.level === 'pool' || i.level === 'question',
    );
    expect(poolIssues.length).toBeGreaterThan(0);
  });

  it('invalid pool lesson has no questionIndex entries', async () => {
    await seedOwner();
    const db = ownerDb();
    const storage = ownerStorage();

    const result = await importRepository(
      { ownerUid: OWNER_UID, programmaTitle: 'Informatica', files: INVALID_POOL_FILES },
      { db, storage },
    );

    if (result.status !== 'committed') throw new Error('expected committed');

    const qiSnap = await getDocs(
      collection(db, 'programs', result.programId, 'imports', result.importId, 'questionIndex'),
    );
    expect(qiSnap.size).toBe(0);
  });
});

describe('importRepository — structural validation failure', () => {
  it('returns validation_failed and writes nothing to Firestore', async () => {
    await seedOwner();
    const db = ownerDb();
    const storage = ownerStorage();

    // Empty file list → NO_UDAS
    const result = await importRepository(
      { ownerUid: OWNER_UID, programmaTitle: 'Informatica', files: [] },
      { db, storage },
    );

    expect(result.status).toBe('validation_failed');

    // programs collection should be empty
    const programsSnap = await getDocs(collection(db, 'programs'));
    expect(programsSnap.empty).toBe(true);
  });

  it('empty title returns validation_failed', async () => {
    await seedOwner();
    const db = ownerDb();
    const storage = ownerStorage();

    const result = await importRepository(
      { ownerUid: OWNER_UID, programmaTitle: '   ', files: VALID_FILES },
      { db, storage },
    );

    expect(result.status).toBe('validation_failed');
    if (result.status !== 'validation_failed') return;
    expect(result.validationIssues.find((i) => i.code === 'MISSING_FIELD')).toBeDefined();
  });

  it('does not update activeImportId on failure', async () => {
    await seedOwner();
    const db = ownerDb();
    const storage = ownerStorage();

    // First valid import
    const r1 = await importRepository(
      { ownerUid: OWNER_UID, programmaTitle: 'Informatica', files: VALID_FILES },
      { db, storage },
    );
    if (r1.status !== 'committed') throw new Error('expected committed');

    // Second import with structural failure using same programId
    const r2 = await importRepository(
      { ownerUid: OWNER_UID, programmaTitle: 'Informatica', programId: r1.programId, files: [] },
      { db, storage },
    );

    expect(r2.status).toBe('validation_failed');

    // activeImportId still points to first import
    const programSnap = await getDoc(doc(db, 'programs', r1.programId));
    expect(programSnap.data()?.activeImportId).toBe(r1.importId);
  });
});

describe('importRepository — owner isolation', () => {
  it('other authenticated user cannot read owner programs', async () => {
    await seedOwner();
    const db = ownerDb();
    const storage = ownerStorage();

    const result = await importRepository(
      { ownerUid: OWNER_UID, programmaTitle: 'Informatica', files: VALID_FILES },
      { db, storage },
    );
    if (result.status !== 'committed') throw new Error('expected committed');

    const other = otherDb();
    await assertFails(getDoc(doc(other, 'programs', result.programId)));
  });

  it('other user cannot upload to owner Storage path', async () => {
    const st = otherStorage();
    await assertFails(
      uploadBytes(
        ref(st, `repository/${OWNER_UID}/imports/imp-x/file.md`),
        new Uint8Array([1, 2, 3]),
      ),
    );
  });
});

// ─── publicLessons (M3-lite student projection) ──────────────────────────────

describe('importRepository — publicLessons projection', () => {
  it('creates one publicLessons doc per lesson, matching the technical lessons count', async () => {
    await seedOwner();
    const db = ownerDb();
    const storage = ownerStorage();

    const result = await importRepository(
      { ownerUid: OWNER_UID, programmaTitle: 'Informatica', files: VALID_FILES },
      { db, storage },
    );
    if (result.status !== 'committed') throw new Error('expected committed');

    const publicLessonsSnap = await getDocs(
      query(collection(db, 'publicLessons'), where('programId', '==', result.programId)),
    );
    expect(publicLessonsSnap.size).toBe(result.lessonCount);
  });

  it('publicLessons never carry poolStatus, poolStorageRef, questionCount or a .pool.md path', async () => {
    await seedOwner();
    const db = ownerDb();
    const storage = ownerStorage();

    const result = await importRepository(
      { ownerUid: OWNER_UID, programmaTitle: 'Informatica', files: VALID_FILES },
      { db, storage },
    );
    if (result.status !== 'committed') throw new Error('expected committed');

    const publicLessonsSnap = await getDocs(
      query(collection(db, 'publicLessons'), where('programId', '==', result.programId)),
    );
    for (const d of publicLessonsSnap.docs) {
      const data = d.data();
      expect(data).not.toHaveProperty('poolStatus');
      expect(data).not.toHaveProperty('poolStorageRef');
      expect(data).not.toHaveProperty('questionCount');
      expect(JSON.stringify(data)).not.toContain('.pool.md');
      expect(data.contentPath).toMatch(/\.md$/);
    }
  });

  it('an approved student in the program’s class can read publicLessons when the portal is enabled', async () => {
    await seedOwner();
    const db = ownerDb();
    const storage = ownerStorage();

    const result = await importRepository(
      { ownerUid: OWNER_UID, programmaTitle: 'Informatica', files: VALID_FILES },
      { db, storage },
    );
    if (result.status !== 'committed') throw new Error('expected committed');

    await seedStudentAccess(true);
    await seedStudent('approved', 'class-a');
    await seedProgramClassIds(result.programId, ['class-a']);

    const publicLessonsSnap = await getDocs(collection(ownerDb(), 'publicLessons'));
    const someLessonId = publicLessonsSnap.docs[0]!.id;

    const studentDb = otherDb();
    await assertSucceeds(getDoc(doc(studentDb, 'publicLessons', someLessonId)));
  });

  it('denies an approved student when the program is not assigned to their class', async () => {
    await seedOwner();
    const db = ownerDb();
    const storage = ownerStorage();

    const result = await importRepository(
      { ownerUid: OWNER_UID, programmaTitle: 'Informatica', files: VALID_FILES },
      { db, storage },
    );
    if (result.status !== 'committed') throw new Error('expected committed');

    await seedStudentAccess(true);
    // Approved, but the freshly-imported program carries no classIds at all
    // (importRepository doesn't assign a class) — never visible by omission.
    await seedStudent('approved', 'class-a');

    const publicLessonsSnap = await getDocs(collection(ownerDb(), 'publicLessons'));
    const someLessonId = publicLessonsSnap.docs[0]!.id;

    await assertFails(getDoc(doc(otherDb(), 'publicLessons', someLessonId)));
  });

  it('denies a Google non-owner with no students/{uid} document, even with the portal enabled', async () => {
    await seedOwner();
    const db = ownerDb();
    const storage = ownerStorage();

    const result = await importRepository(
      { ownerUid: OWNER_UID, programmaTitle: 'Informatica', files: VALID_FILES },
      { db, storage },
    );
    if (result.status !== 'committed') throw new Error('expected committed');

    await seedStudentAccess(true);
    // No students/{uid} document created — being Google-authenticated is
    // never sufficient on its own.

    const publicLessonsSnap = await getDocs(collection(ownerDb(), 'publicLessons'));
    const someLessonId = publicLessonsSnap.docs[0]!.id;

    await assertFails(getDoc(doc(otherDb(), 'publicLessons', someLessonId)));
  });

  it('denies a pending student from reading publicLessons', async () => {
    await seedOwner();
    const db = ownerDb();
    const storage = ownerStorage();

    const result = await importRepository(
      { ownerUid: OWNER_UID, programmaTitle: 'Informatica', files: VALID_FILES },
      { db, storage },
    );
    if (result.status !== 'committed') throw new Error('expected committed');

    await seedStudentAccess(true);
    await seedStudent('pending');

    const publicLessonsSnap = await getDocs(collection(ownerDb(), 'publicLessons'));
    const someLessonId = publicLessonsSnap.docs[0]!.id;

    await assertFails(getDoc(doc(otherDb(), 'publicLessons', someLessonId)));
  });

  it('denies a blocked student from reading publicLessons', async () => {
    await seedOwner();
    const db = ownerDb();
    const storage = ownerStorage();

    const result = await importRepository(
      { ownerUid: OWNER_UID, programmaTitle: 'Informatica', files: VALID_FILES },
      { db, storage },
    );
    if (result.status !== 'committed') throw new Error('expected committed');

    await seedStudentAccess(true);
    await seedStudent('blocked');

    const publicLessonsSnap = await getDocs(collection(ownerDb(), 'publicLessons'));
    const someLessonId = publicLessonsSnap.docs[0]!.id;

    await assertFails(getDoc(doc(otherDb(), 'publicLessons', someLessonId)));
  });

  it('denies an approved student from reading publicLessons when the portal is disabled', async () => {
    await seedOwner();
    const db = ownerDb();
    const storage = ownerStorage();

    const result = await importRepository(
      { ownerUid: OWNER_UID, programmaTitle: 'Informatica', files: VALID_FILES },
      { db, storage },
    );
    if (result.status !== 'committed') throw new Error('expected committed');

    await seedStudentAccess(false);
    await seedStudent('approved');

    const publicLessonsSnap = await getDocs(collection(ownerDb(), 'publicLessons'));
    const someLessonId = publicLessonsSnap.docs[0]!.id;

    await assertFails(getDoc(doc(otherDb(), 'publicLessons', someLessonId)));
  });

  it('an unauthenticated user cannot read publicLessons', async () => {
    await seedOwner();
    const db = ownerDb();
    const storage = ownerStorage();

    const result = await importRepository(
      { ownerUid: OWNER_UID, programmaTitle: 'Informatica', files: VALID_FILES },
      { db, storage },
    );
    if (result.status !== 'committed') throw new Error('expected committed');

    const publicLessonsSnap = await getDocs(collection(ownerDb(), 'publicLessons'));
    const someLessonId = publicLessonsSnap.docs[0]!.id;

    await assertFails(getDoc(doc(anonDb(), 'publicLessons', someLessonId)));
  });

  it('a student cannot write to publicLessons', async () => {
    await seedOwner();
    const db = ownerDb();
    const storage = ownerStorage();

    const result = await importRepository(
      { ownerUid: OWNER_UID, programmaTitle: 'Informatica', files: VALID_FILES },
      { db, storage },
    );
    if (result.status !== 'committed') throw new Error('expected committed');

    const publicLessonsSnap = await getDocs(collection(ownerDb(), 'publicLessons'));
    const someLessonId = publicLessonsSnap.docs[0]!.id;

    const studentDb = otherDb();
    await assertFails(
      setDoc(doc(studentDb, 'publicLessons', someLessonId), { title: 'Hacked' }, { merge: true }),
    );
  });

  it('a student cannot read the technical lessons subcollection', async () => {
    await seedOwner();
    const db = ownerDb();
    const storage = ownerStorage();

    const result = await importRepository(
      { ownerUid: OWNER_UID, programmaTitle: 'Informatica', files: VALID_FILES },
      { db, storage },
    );
    if (result.status !== 'committed') throw new Error('expected committed');

    const lessonsSnap = await getDocs(
      collection(db, 'programs', result.programId, 'imports', result.importId, 'lessons'),
    );
    const someLessonId = lessonsSnap.docs[0]!.id;

    const studentDb = otherDb();
    await assertFails(
      getDoc(
        doc(
          studentDb,
          'programs',
          result.programId,
          'imports',
          result.importId,
          'lessons',
          someLessonId,
        ),
      ),
    );
  });

  it('re-importing the same program deletes the stale publicLessons from the previous import', async () => {
    await seedOwner();
    const db = ownerDb();
    const storage = ownerStorage();

    const r1 = await importRepository(
      { ownerUid: OWNER_UID, programmaTitle: 'Informatica', files: VALID_FILES },
      { db, storage },
    );
    if (r1.status !== 'committed') throw new Error('expected committed');

    const firstImportPublicLessons = await getDocs(
      query(collection(db, 'publicLessons'), where('importId', '==', r1.importId)),
    );
    expect(firstImportPublicLessons.size).toBe(r1.lessonCount);

    const r2 = await importRepository(
      {
        ownerUid: OWNER_UID,
        programmaTitle: 'Informatica v2',
        programId: r1.programId,
        files: VALID_FILES,
      },
      { db, storage },
    );
    if (r2.status !== 'committed') throw new Error('expected committed');

    const staleAfterReimport = await getDocs(
      query(collection(db, 'publicLessons'), where('importId', '==', r1.importId)),
    );
    expect(staleAfterReimport.size).toBe(0);

    const currentPublicLessons = await getDocs(
      query(collection(db, 'publicLessons'), where('importId', '==', r2.importId)),
    );
    expect(currentPublicLessons.size).toBe(r2.lessonCount);
  });

  it('uploads lesson files to Storage tagged with customMetadata.programId (M3L-C)', async () => {
    await seedOwner();
    const db = ownerDb();
    const storage = ownerStorage();

    const result = await importRepository(
      { ownerUid: OWNER_UID, programmaTitle: 'Informatica', files: VALID_FILES },
      { db, storage },
    );
    if (result.status !== 'committed') throw new Error('expected committed');

    const meta = await getMetadata(
      ref(storage, `repository/${OWNER_UID}/imports/${result.importId}/${LESSON.path}`),
    );
    expect(meta.customMetadata?.kind).toBe('lesson');
    expect(meta.customMetadata?.programId).toBe(result.programId);
  });

  it('an approved student in the program’s class can read the lesson file from Storage, but never the pool', async () => {
    await seedOwner();
    const db = ownerDb();
    const storage = ownerStorage();

    const result = await importRepository(
      { ownerUid: OWNER_UID, programmaTitle: 'Informatica', files: VALID_FILES },
      { db, storage },
    );
    if (result.status !== 'committed') throw new Error('expected committed');

    await seedStudentAccess(true);
    await seedStudent('approved', 'class-a');
    await seedProgramClassIds(result.programId, ['class-a']);

    const studentSt = otherStorage();
    await assertSucceeds(
      getBytes(ref(studentSt, `repository/${OWNER_UID}/imports/${result.importId}/${LESSON.path}`)),
    );
    await assertFails(
      getBytes(
        ref(studentSt, `repository/${OWNER_UID}/imports/${result.importId}/${VALID_POOL.path}`),
      ),
    );
  });

  it('denies a non-approved student (no students/{uid} document) from reading the lesson file via Storage', async () => {
    await seedOwner();
    const db = ownerDb();
    const storage = ownerStorage();

    const result = await importRepository(
      { ownerUid: OWNER_UID, programmaTitle: 'Informatica', files: VALID_FILES },
      { db, storage },
    );
    if (result.status !== 'committed') throw new Error('expected committed');

    await seedStudentAccess(true);
    await seedProgramClassIds(result.programId, ['class-a']);
    // No students/{uid} document — merely being a different Google-
    // authenticated uid is never enough.

    const studentSt = otherStorage();
    await assertFails(
      getBytes(ref(studentSt, `repository/${OWNER_UID}/imports/${result.importId}/${LESSON.path}`)),
    );
  });

  it('denies an approved student from reading the lesson file via Storage when the portal is disabled', async () => {
    await seedOwner();
    const db = ownerDb();
    const storage = ownerStorage();

    const result = await importRepository(
      { ownerUid: OWNER_UID, programmaTitle: 'Informatica', files: VALID_FILES },
      { db, storage },
    );
    if (result.status !== 'committed') throw new Error('expected committed');

    await seedStudentAccess(false);
    await seedStudent('approved', 'class-a');
    await seedProgramClassIds(result.programId, ['class-a']);

    const studentSt = otherStorage();
    await assertFails(
      getBytes(ref(studentSt, `repository/${OWNER_UID}/imports/${result.importId}/${LESSON.path}`)),
    );
  });

  it('denies an approved student from reading the lesson file when the program is not assigned to their class (M3L-C)', async () => {
    await seedOwner();
    const db = ownerDb();
    const storage = ownerStorage();

    const result = await importRepository(
      { ownerUid: OWNER_UID, programmaTitle: 'Informatica', files: VALID_FILES },
      { db, storage },
    );
    if (result.status !== 'committed') throw new Error('expected committed');

    await seedStudentAccess(true);
    await seedStudent('approved', 'class-a');
    // importRepository doesn't assign a class by itself — the freshly
    // imported program carries no classIds at all, never visible by
    // omission — no seedProgramClassIds() call here.

    const studentSt = otherStorage();
    await assertFails(
      getBytes(ref(studentSt, `repository/${OWNER_UID}/imports/${result.importId}/${LESSON.path}`)),
    );
  });

  it('denies an approved student with an incompatible classId from reading the lesson file (M3L-C)', async () => {
    await seedOwner();
    const db = ownerDb();
    const storage = ownerStorage();

    const result = await importRepository(
      { ownerUid: OWNER_UID, programmaTitle: 'Informatica', files: VALID_FILES },
      { db, storage },
    );
    if (result.status !== 'committed') throw new Error('expected committed');

    await seedStudentAccess(true);
    await seedStudent('approved', 'class-z');
    await seedProgramClassIds(result.programId, ['class-a', 'class-b']);

    const studentSt = otherStorage();
    await assertFails(
      getBytes(ref(studentSt, `repository/${OWNER_UID}/imports/${result.importId}/${LESSON.path}`)),
    );
  });

  it('denies an approved student with no classId of their own from reading the lesson file (M3L-C)', async () => {
    await seedOwner();
    const db = ownerDb();
    const storage = ownerStorage();

    const result = await importRepository(
      { ownerUid: OWNER_UID, programmaTitle: 'Informatica', files: VALID_FILES },
      { db, storage },
    );
    if (result.status !== 'committed') throw new Error('expected committed');

    await seedStudentAccess(true);
    await seedStudent('approved', null);
    await seedProgramClassIds(result.programId, ['class-a']);

    const studentSt = otherStorage();
    await assertFails(
      getBytes(ref(studentSt, `repository/${OWNER_UID}/imports/${result.importId}/${LESSON.path}`)),
    );
  });

  it('denies a class-compatible approved student from reading a legacy lesson file with no programId metadata (M3L-C)', async () => {
    await seedOwner();
    const db = ownerDb();
    const storage = ownerStorage();

    const result = await importRepository(
      { ownerUid: OWNER_UID, programmaTitle: 'Informatica', files: VALID_FILES },
      { db, storage },
    );
    if (result.status !== 'committed') throw new Error('expected committed');

    await seedStudentAccess(true);
    await seedStudent('approved', 'class-a');
    await seedProgramClassIds(result.programId, ['class-a']);

    const legacyPath = `repository/${OWNER_UID}/imports/${result.importId}/${LESSON.path}`;
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await uploadBytes(ref(ctx.storage(), legacyPath), new Uint8Array([1]), {
        customMetadata: { kind: 'lesson' },
      });
    });

    const studentSt = otherStorage();
    await assertFails(getBytes(ref(studentSt, legacyPath)));
  });
});
