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
import { ref, uploadBytes } from 'firebase/storage';
import { afterAll, beforeAll, describe, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RULES_PATH = resolve(__dirname, '../../../../storage.rules');
const OWNER_UID = 'owner-uid';
const OTHER_UID = 'other-uid';
const PAYLOAD = new Uint8Array([1, 2, 3]);

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-schoolforge',
    storage: {
      rules: readFileSync(RULES_PATH, 'utf8'),
      host: '127.0.0.1',
      port: 9199,
    },
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

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
