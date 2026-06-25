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
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { afterAll, afterEach, beforeAll, describe, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RULES_PATH = resolve(__dirname, '../../../../firestore.rules');
const OWNER_UID = 'owner-uid';
const OTHER_UID = 'other-uid';

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-schoolforge',
    firestore: {
      rules: readFileSync(RULES_PATH, 'utf8'),
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

async function seedOwner() {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'settings/owner'), { ownerUid: OWNER_UID });
  });
}

// ─── settings/owner ──────────────────────────────────────────────────────────

describe('settings/owner — create (first-time setup)', () => {
  it('allows authenticated user to create settings/owner with their own uid', async () => {
    const ctx = testEnv.authenticatedContext(OWNER_UID);
    await assertSucceeds(setDoc(doc(ctx.firestore(), 'settings/owner'), { ownerUid: OWNER_UID }));
  });

  it('denies creating settings/owner with a different uid than the caller', async () => {
    const ctx = testEnv.authenticatedContext(OWNER_UID);
    await assertFails(setDoc(doc(ctx.firestore(), 'settings/owner'), { ownerUid: OTHER_UID }));
  });

  it('denies unauthenticated create of settings/owner', async () => {
    const ctx = testEnv.unauthenticatedContext();
    await assertFails(setDoc(doc(ctx.firestore(), 'settings/owner'), { ownerUid: OWNER_UID }));
  });
});

describe('settings/owner — read', () => {
  it('allows owner to read settings/owner', async () => {
    await seedOwner();
    const ctx = testEnv.authenticatedContext(OWNER_UID);
    await assertSucceeds(getDoc(doc(ctx.firestore(), 'settings/owner')));
  });

  it('denies unauthenticated read of settings/owner', async () => {
    await seedOwner();
    const ctx = testEnv.unauthenticatedContext();
    await assertFails(getDoc(doc(ctx.firestore(), 'settings/owner')));
  });
});

// ─── programs (owner data) ───────────────────────────────────────────────────

describe('programs', () => {
  it('allows owner to write and read programs', async () => {
    await seedOwner();
    const ctx = testEnv.authenticatedContext(OWNER_UID);
    await assertSucceeds(setDoc(doc(ctx.firestore(), 'programs/p1'), { title: 'Test' }));
    await assertSucceeds(getDoc(doc(ctx.firestore(), 'programs/p1')));
  });

  it('denies a different authenticated user from reading programs', async () => {
    await seedOwner();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'programs/p1'), { title: 'Test' });
    });
    const other = testEnv.authenticatedContext(OTHER_UID);
    await assertFails(getDoc(doc(other.firestore(), 'programs/p1')));
  });

  it('denies unauthenticated user from reading programs', async () => {
    await seedOwner();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'programs/p1'), { title: 'Test' });
    });
    const unauth = testEnv.unauthenticatedContext();
    await assertFails(getDoc(doc(unauth.firestore(), 'programs/p1')));
  });

  it('allows owner to write subcollections of programs', async () => {
    await seedOwner();
    const ctx = testEnv.authenticatedContext(OWNER_UID);
    await assertSucceeds(
      setDoc(doc(ctx.firestore(), 'programs/p1/imports/imp-1'), { status: 'pending' }),
    );
  });
});

// ─── auditEvents ─────────────────────────────────────────────────────────────

describe('auditEvents', () => {
  it('allows owner to write and read audit events', async () => {
    await seedOwner();
    const ctx = testEnv.authenticatedContext(OWNER_UID);
    await assertSucceeds(
      setDoc(doc(ctx.firestore(), 'auditEvents/evt-1'), { action: 'auth.signIn' }),
    );
    await assertSucceeds(getDoc(doc(ctx.firestore(), 'auditEvents/evt-1')));
  });

  it('denies other authenticated user from writing audit events', async () => {
    await seedOwner();
    const ctx = testEnv.authenticatedContext(OTHER_UID);
    await assertFails(setDoc(doc(ctx.firestore(), 'auditEvents/evt-1'), { action: 'auth.signIn' }));
  });
});

// ─── deliveryAttempts (writes denied — Cloud Functions only in M3) ────────────

describe('deliveryAttempts', () => {
  it('denies owner from writing deliveryAttempts directly (M3 Cloud Functions only)', async () => {
    await seedOwner();
    const ctx = testEnv.authenticatedContext(OWNER_UID);
    await assertFails(
      setDoc(doc(ctx.firestore(), 'deliveryAttempts/att-1'), { status: 'in_corso' }),
    );
  });

  it('allows owner to read deliveryAttempts (for corrections)', async () => {
    await seedOwner();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'deliveryAttempts/att-1'), { status: 'consegnato' });
    });
    const ctx = testEnv.authenticatedContext(OWNER_UID);
    await assertSucceeds(getDoc(doc(ctx.firestore(), 'deliveryAttempts/att-1')));
  });
});

// ─── Default deny ─────────────────────────────────────────────────────────────

describe('default deny', () => {
  it('denies owner access to unknown collections', async () => {
    await seedOwner();
    const ctx = testEnv.authenticatedContext(OWNER_UID);
    await assertFails(getDoc(doc(ctx.firestore(), 'unknown/doc-1')));
  });

  it('denies unauthenticated access to any path', async () => {
    const ctx = testEnv.unauthenticatedContext();
    await assertFails(getDoc(doc(ctx.firestore(), 'programs/p1')));
    await assertFails(getDoc(doc(ctx.firestore(), 'anything/doc-1')));
  });
});
