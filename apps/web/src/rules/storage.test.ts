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
import { getBytes, ref, uploadBytes } from 'firebase/storage';
import { afterAll, afterEach, beforeAll, describe, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RULES_PATH = resolve(__dirname, '../../../../storage.rules');
const FIRESTORE_RULES_PATH = resolve(__dirname, '../../../../firestore.rules');
const OWNER_UID = 'owner-uid';
const OTHER_UID = 'other-uid';
const PAYLOAD = new Uint8Array([1, 2, 3]);

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    // Must match the emulator suite's --project flag (see package.json
    // test:rules). storage.rules itself no longer reads Firestore at all
    // (see the "no class gate" model below) — Firestore is still spun up
    // here only so tests can seed students/programs and prove that Storage
    // reads succeed *regardless* of that Firestore state.
    projectId: 'demo-schoolforge',
    firestore: {
      rules: readFileSync(FIRESTORE_RULES_PATH, 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
    storage: {
      rules: readFileSync(RULES_PATH, 'utf8'),
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

// Student discovery remains gated in Firestore (portal enabled, approved
// student, assigned class, compatible program). Storage is the second hop:
// once a lesson Markdown contentPath is known, it only verifies authenticated
// read of imported .md files and keeps pool/assets/write/anon denied.
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

// M3L-C: class compatibility is enforced by Firestore discovery rules for
// programs/publicLessons. Storage does not repeat cross-service reads.
const PROGRAM_ID = 'prog-1';

async function seedProgram(classIds: string[]) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'programs', PROGRAM_ID), {
      ownerUid: OWNER_UID,
      title: 'Informatica',
      activeImportId: 'imp-1',
      classIds,
      createdAt: null,
      updatedAt: null,
    });
  });
}

// ─── repository/{ownerUid}/ — owner-scoped access ────────────────────────────

describe('Storage — owner reads/writes own path', () => {
  it('allows owner to upload to repository/{ownerUid}/imports/...', async () => {
    const st = testEnv.authenticatedContext(OWNER_UID).storage();
    await assertSucceeds(
      uploadBytes(ref(st, `repository/${OWNER_UID}/imports/prog-1/lesson.md`), PAYLOAD),
    );
  });

  it('allows owner to upload to repository/{ownerUid} root', async () => {
    const st = testEnv.authenticatedContext(OWNER_UID).storage();
    await assertSucceeds(uploadBytes(ref(st, `repository/${OWNER_UID}/test.md`), PAYLOAD));
  });
});

// ─── repository/{ownerUid}/ — other authenticated user denied ────────────────

describe('Storage — other authenticated user denied on owner path', () => {
  it('denies other authenticated user from uploading to repository/{ownerUid}/...', async () => {
    const st = testEnv.authenticatedContext(OTHER_UID).storage();
    await assertFails(
      uploadBytes(ref(st, `repository/${OWNER_UID}/imports/prog-1/lesson.md`), PAYLOAD),
    );
  });
});

// ─── repository/{ownerUid}/ — student read denied (M3F-08) ───────────────────

describe('Storage — student (other authenticated user) read access — denied unconditionally (M3F-08)', () => {
  async function seedLessonFile(programId?: string) {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await uploadBytes(
        ref(ctx.storage(), `repository/${OWNER_UID}/imports/imp-1/uda-01/lezione-001.md`),
        PAYLOAD,
        { customMetadata: programId ? { kind: 'lesson', programId } : { kind: 'lesson' } },
      );
    });
  }

  async function seedPoolFile() {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await uploadBytes(
        ref(ctx.storage(), `repository/${OWNER_UID}/imports/imp-1/uda-01/lezione-001.pool.md`),
        PAYLOAD,
        { customMetadata: { kind: 'pool' } },
      );
    });
  }

  it('denies an approved student in the program’s class from reading a lesson file, even with the portal enabled — publicLessons.content is the only student-facing source now', async () => {
    await seedStudentAccess(true);
    await seedStudent('approved', 'class-a');
    await seedProgram(['class-a']);
    await seedLessonFile(PROGRAM_ID);
    const st = testEnv.authenticatedContext(OTHER_UID).storage();
    await assertFails(
      getBytes(ref(st, `repository/${OWNER_UID}/imports/imp-1/uda-01/lezione-001.md`)),
    );
  });

  it('denies assets for an approved student in the program class', async () => {
    await seedStudentAccess(true);
    await seedStudent('approved', 'class-a');
    await seedProgram(['class-a']);
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await uploadBytes(
        ref(ctx.storage(), `repository/${OWNER_UID}/imports/imp-1/uda-01/assets/diagram.png`),
        PAYLOAD,
        { customMetadata: { kind: 'lesson', programId: PROGRAM_ID } },
      );
    });
    const st = testEnv.authenticatedContext(OTHER_UID).storage();
    await assertFails(
      getBytes(ref(st, `repository/${OWNER_UID}/imports/imp-1/uda-01/assets/diagram.png`)),
    );
  });

  it('denies a known contentPath even without a students/{uid} document', async () => {
    await seedStudentAccess(true);
    await seedLessonFile();
    const st = testEnv.authenticatedContext(OTHER_UID).storage();
    await assertFails(
      getBytes(ref(st, `repository/${OWNER_UID}/imports/imp-1/uda-01/lezione-001.md`)),
    );
  });

  it('denies a pending student account', async () => {
    await seedStudentAccess(true);
    await seedStudent('pending');
    await seedLessonFile();
    const st = testEnv.authenticatedContext(OTHER_UID).storage();
    await assertFails(
      getBytes(ref(st, `repository/${OWNER_UID}/imports/imp-1/uda-01/lezione-001.md`)),
    );
  });

  it('denies a blocked student account', async () => {
    await seedStudentAccess(true);
    await seedStudent('blocked');
    await seedLessonFile();
    const st = testEnv.authenticatedContext(OTHER_UID).storage();
    await assertFails(
      getBytes(ref(st, `repository/${OWNER_UID}/imports/imp-1/uda-01/lezione-001.md`)),
    );
  });

  it('denies even when the student portal is enabled and the student is approved in-class (no bypass exists)', async () => {
    await seedStudentAccess(true);
    await seedStudent('approved', 'class-a');
    await seedProgram(['class-a']);
    await seedLessonFile();
    const st = testEnv.authenticatedContext(OTHER_UID).storage();
    await assertFails(
      getBytes(ref(st, `repository/${OWNER_UID}/imports/imp-1/uda-01/lezione-001.md`)),
    );
  });

  it('denies when settings/studentAccess does not exist', async () => {
    await seedStudent('approved');
    await seedLessonFile();
    const st = testEnv.authenticatedContext(OTHER_UID).storage();
    await assertFails(
      getBytes(ref(st, `repository/${OWNER_UID}/imports/imp-1/uda-01/lezione-001.md`)),
    );
  });

  it('denies an approved student from reading a file tagged kind=pool (a .pool.md file)', async () => {
    await seedStudentAccess(true);
    await seedStudent('approved');
    await seedPoolFile();
    const st = testEnv.authenticatedContext(OTHER_UID).storage();
    await assertFails(
      getBytes(ref(st, `repository/${OWNER_UID}/imports/imp-1/uda-01/lezione-001.pool.md`)),
    );
  });

  it('denies a legacy Markdown file even when custom metadata is missing', async () => {
    await seedStudentAccess(true);
    await seedStudent('approved');
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await uploadBytes(
        ref(ctx.storage(), `repository/${OWNER_UID}/imports/imp-1/uda-01/untagged.md`),
        PAYLOAD,
      );
    });
    const st = testEnv.authenticatedContext(OTHER_UID).storage();
    await assertFails(
      getBytes(ref(st, `repository/${OWNER_UID}/imports/imp-1/uda-01/untagged.md`)),
    );
  });

  it('denies an approved student from writing under the owner path', async () => {
    await seedStudentAccess(true);
    await seedStudent('approved');
    const st = testEnv.authenticatedContext(OTHER_UID).storage();
    await assertFails(
      uploadBytes(ref(st, `repository/${OWNER_UID}/imports/imp-1/uda-01/lezione-001.md`), PAYLOAD, {
        customMetadata: { kind: 'lesson' },
      }),
    );
  });

  it('denies an unauthenticated user from reading a lesson file, even with the portal enabled', async () => {
    await seedStudentAccess(true);
    await seedLessonFile();
    const st = testEnv.unauthenticatedContext().storage();
    await assertFails(
      getBytes(ref(st, `repository/${OWNER_UID}/imports/imp-1/uda-01/lezione-001.md`)),
    );
  });

  it('allows the owner to still read a file tagged kind=pool, independent of the student-access model', async () => {
    await seedPoolFile();
    const st = testEnv.authenticatedContext(OWNER_UID).storage();
    await assertSucceeds(
      getBytes(ref(st, `repository/${OWNER_UID}/imports/imp-1/uda-01/lezione-001.pool.md`)),
    );
  });

  it('allows the owner to still read a lesson file, independent of the student-access model', async () => {
    await seedLessonFile();
    const st = testEnv.authenticatedContext(OWNER_UID).storage();
    await assertSucceeds(
      getBytes(ref(st, `repository/${OWNER_UID}/imports/imp-1/uda-01/lezione-001.md`)),
    );
  });
});

// ─── repository/{otherUid}/ — owner denied on another uid's path ─────────────

describe('Storage — owner denied on other uid path', () => {
  it('denies owner from accessing repository/{otherUid}/...', async () => {
    const st = testEnv.authenticatedContext(OWNER_UID).storage();
    await assertFails(uploadBytes(ref(st, `repository/${OTHER_UID}/secret.md`), PAYLOAD));
  });
});

// ─── unauthenticated — always denied ─────────────────────────────────────────

describe('Storage — unauthenticated denied', () => {
  it('denies unauthenticated upload to repository/{ownerUid}/...', async () => {
    const st = testEnv.unauthenticatedContext().storage();
    await assertFails(
      uploadBytes(ref(st, `repository/${OWNER_UID}/imports/prog-1/lesson.md`), PAYLOAD),
    );
  });
});

// ─── paths outside repository/{ownerUid}/ — default deny ─────────────────────

describe('Storage — other paths (default deny)', () => {
  it('denies owner upload to path outside repository/{ownerUid}', async () => {
    const st = testEnv.authenticatedContext(OWNER_UID).storage();
    await assertFails(uploadBytes(ref(st, 'private/secret.txt'), PAYLOAD));
  });

  it('denies unauthenticated upload to path outside repository', async () => {
    const st = testEnv.unauthenticatedContext().storage();
    await assertFails(uploadBytes(ref(st, 'private/secret.txt'), PAYLOAD));
  });

  it('denies upload to repository root (no uid segment)', async () => {
    const st = testEnv.authenticatedContext(OWNER_UID).storage();
    await assertFails(uploadBytes(ref(st, 'repository/file.md'), PAYLOAD));
  });
});
