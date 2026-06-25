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

// ─── repository/ — authenticated access ──────────────────────────────────────

describe('Storage — repository path (authenticated)', () => {
  it('allows authenticated user to upload to repository/imports', async () => {
    const ctx = testEnv.authenticatedContext(OWNER_UID);
    const fileRef = ref(ctx.storage(), 'repository/imports/prog-1/imp-1/lesson.md');
    await assertSucceeds(uploadBytes(fileRef, PAYLOAD));
  });

  it('allows authenticated user to upload to repository root', async () => {
    const ctx = testEnv.authenticatedContext(OWNER_UID);
    const fileRef = ref(ctx.storage(), 'repository/test.md');
    await assertSucceeds(uploadBytes(fileRef, PAYLOAD));
  });
});

// ─── repository/ — unauthenticated denied ────────────────────────────────────

describe('Storage — repository path (unauthenticated)', () => {
  it('denies unauthenticated upload to repository/imports', async () => {
    const ctx = testEnv.unauthenticatedContext();
    const fileRef = ref(ctx.storage(), 'repository/imports/prog-1/imp-1/lesson.md');
    await assertFails(uploadBytes(fileRef, PAYLOAD));
  });

  it('denies unauthenticated read from repository', async () => {
    const ctx = testEnv.unauthenticatedContext();
    const fileRef = ref(ctx.storage(), 'repository/test.md');
    await assertFails(uploadBytes(fileRef, PAYLOAD));
  });
});

// ─── other paths — default deny ──────────────────────────────────────────────

describe('Storage — other paths (default deny)', () => {
  it('denies authenticated upload to path outside repository', async () => {
    const ctx = testEnv.authenticatedContext(OWNER_UID);
    await assertFails(uploadBytes(ref(ctx.storage(), 'private/secret.txt'), PAYLOAD));
  });

  it('denies unauthenticated upload to path outside repository', async () => {
    const ctx = testEnv.unauthenticatedContext();
    await assertFails(uploadBytes(ref(ctx.storage(), 'private/secret.txt'), PAYLOAD));
  });
});
