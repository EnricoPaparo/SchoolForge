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
    // test:rules): Storage Rules' cross-service firestore.get()/exists()
    // (isApprovedStudent() in storage.rules) resolve documents against the
    // emulator's single configured default project, regardless of the
    // projectId a RulesTestEnvironment declares for itself.
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

// Approved-student model (M3-lite): a Google-authenticated non-owner is only
// a candidate student until the portal is globally enabled AND their own
// students/{uid} document says 'approved'. Neither is seeded unless a test
// calls these helpers, so the default (no settings/studentAccess, no
// students/{uid}) exercises the safe default: every student read denied.
async function seedStudentAccess(studentPortalEnabled: boolean) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'settings/studentAccess'), {
      ownerUid: OWNER_UID,
      studentPortalEnabled,
      newStudentRequestsEnabled: false,
    });
  });
}

async function seedStudent(status: 'pending' | 'approved' | 'blocked') {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'students', OTHER_UID), {
      uid: OTHER_UID,
      ownerUid: OWNER_UID,
      email: 'student@example.com',
      displayName: null,
      status,
      classId: null,
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

// ─── repository/{ownerUid}/ — student read (M3-lite) ─────────────────────────

describe('Storage — student (other authenticated user) read access — approved-student gate (M3-lite)', () => {
  async function seedLessonFile() {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await uploadBytes(
        ref(ctx.storage(), `repository/${OWNER_UID}/imports/imp-1/uda-01/lezione-001.md`),
        PAYLOAD,
        { customMetadata: { kind: 'lesson' } },
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

  it('allows an approved student to read a file tagged kind=lesson when the portal is enabled', async () => {
    await seedStudentAccess(true);
    await seedStudent('approved');
    await seedLessonFile();
    const st = testEnv.authenticatedContext(OTHER_UID).storage();
    await assertSucceeds(
      getBytes(ref(st, `repository/${OWNER_UID}/imports/imp-1/uda-01/lezione-001.md`)),
    );
  });

  it('allows an approved student to read an asset file tagged kind=lesson', async () => {
    await seedStudentAccess(true);
    await seedStudent('approved');
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await uploadBytes(
        ref(ctx.storage(), `repository/${OWNER_UID}/imports/imp-1/uda-01/assets/diagram.png`),
        PAYLOAD,
        { customMetadata: { kind: 'lesson' } },
      );
    });
    const st = testEnv.authenticatedContext(OTHER_UID).storage();
    await assertSucceeds(
      getBytes(ref(st, `repository/${OWNER_UID}/imports/imp-1/uda-01/assets/diagram.png`)),
    );
  });

  it('denies a Google non-owner with no students/{uid} document, even with the portal enabled', async () => {
    await seedStudentAccess(true);
    // No students/{uid} document — being Google-authenticated is never
    // sufficient on its own.
    await seedLessonFile();
    const st = testEnv.authenticatedContext(OTHER_UID).storage();
    await assertFails(
      getBytes(ref(st, `repository/${OWNER_UID}/imports/imp-1/uda-01/lezione-001.md`)),
    );
  });

  it('denies a pending student', async () => {
    await seedStudentAccess(true);
    await seedStudent('pending');
    await seedLessonFile();
    const st = testEnv.authenticatedContext(OTHER_UID).storage();
    await assertFails(
      getBytes(ref(st, `repository/${OWNER_UID}/imports/imp-1/uda-01/lezione-001.md`)),
    );
  });

  it('denies a blocked student', async () => {
    await seedStudentAccess(true);
    await seedStudent('blocked');
    await seedLessonFile();
    const st = testEnv.authenticatedContext(OTHER_UID).storage();
    await assertFails(
      getBytes(ref(st, `repository/${OWNER_UID}/imports/imp-1/uda-01/lezione-001.md`)),
    );
  });

  it('denies an approved student when the student portal is disabled', async () => {
    await seedStudentAccess(false);
    await seedStudent('approved');
    await seedLessonFile();
    const st = testEnv.authenticatedContext(OTHER_UID).storage();
    await assertFails(
      getBytes(ref(st, `repository/${OWNER_UID}/imports/imp-1/uda-01/lezione-001.md`)),
    );
  });

  it('denies an approved student when settings/studentAccess does not exist at all', async () => {
    await seedStudent('approved');
    // seedStudentAccess() never called — default-safe: no portal doc means
    // the portal is treated as disabled.
    await seedLessonFile();
    const st = testEnv.authenticatedContext(OTHER_UID).storage();
    await assertFails(
      getBytes(ref(st, `repository/${OWNER_UID}/imports/imp-1/uda-01/lezione-001.md`)),
    );
  });

  it('denies an approved student from reading a file tagged kind=pool (a .pool.md file), even with the portal enabled', async () => {
    await seedStudentAccess(true);
    await seedStudent('approved');
    await seedPoolFile();
    const st = testEnv.authenticatedContext(OTHER_UID).storage();
    await assertFails(
      getBytes(ref(st, `repository/${OWNER_UID}/imports/imp-1/uda-01/lezione-001.pool.md`)),
    );
  });

  it('denies an approved student from reading a file with no kind metadata (fail-safe default)', async () => {
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

  it('denies an unauthenticated user from reading a file tagged kind=lesson, even with the portal enabled', async () => {
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
