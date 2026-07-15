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

async function seedOwnerPublic() {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'settings/ownerPublic'), { ownerUid: OWNER_UID });
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

  it('denies non-owner authenticated user from reading settings/owner', async () => {
    await seedOwner();
    const ctx = testEnv.authenticatedContext(OTHER_UID);
    await assertFails(getDoc(doc(ctx.firestore(), 'settings/owner')));
  });

  it('denies unauthenticated read of settings/owner', async () => {
    await seedOwner();
    const ctx = testEnv.unauthenticatedContext();
    await assertFails(getDoc(doc(ctx.firestore(), 'settings/owner')));
  });
});

// ─── settings/ownerPublic (M3-lite role resolution) ─────────────────────────

describe('settings/ownerPublic — create (first-time setup)', () => {
  it('allows authenticated user to create ownerPublic with their own uid when no owner exists', async () => {
    const ctx = testEnv.authenticatedContext(OWNER_UID);
    await assertSucceeds(
      setDoc(doc(ctx.firestore(), 'settings/ownerPublic'), { ownerUid: OWNER_UID }),
    );
  });

  it('denies creating ownerPublic with a different uid than the caller', async () => {
    const ctx = testEnv.authenticatedContext(OWNER_UID);
    await assertFails(
      setDoc(doc(ctx.firestore(), 'settings/ownerPublic'), { ownerUid: OTHER_UID }),
    );
  });

  it('denies creating ownerPublic once settings/owner already exists', async () => {
    await seedOwner();
    const ctx = testEnv.authenticatedContext(OTHER_UID);
    await assertFails(
      setDoc(doc(ctx.firestore(), 'settings/ownerPublic'), { ownerUid: OTHER_UID }),
    );
  });

  it('denies unauthenticated create of ownerPublic', async () => {
    const ctx = testEnv.unauthenticatedContext();
    await assertFails(
      setDoc(doc(ctx.firestore(), 'settings/ownerPublic'), { ownerUid: OWNER_UID }),
    );
  });

  it('denies extra fields on ownerPublic', async () => {
    const ctx = testEnv.authenticatedContext(OWNER_UID);
    await assertFails(
      setDoc(doc(ctx.firestore(), 'settings/ownerPublic'), {
        ownerUid: OWNER_UID,
        email: 'owner@test.com',
      }),
    );
  });
});

describe('settings/ownerPublic — read', () => {
  it('allows the owner to read ownerPublic', async () => {
    await seedOwnerPublic();
    const ctx = testEnv.authenticatedContext(OWNER_UID);
    await assertSucceeds(getDoc(doc(ctx.firestore(), 'settings/ownerPublic')));
  });

  it('allows any other authenticated user (student) to read ownerPublic', async () => {
    await seedOwnerPublic();
    const ctx = testEnv.authenticatedContext(OTHER_UID);
    await assertSucceeds(getDoc(doc(ctx.firestore(), 'settings/ownerPublic')));
  });

  it('denies unauthenticated read of ownerPublic', async () => {
    await seedOwnerPublic();
    const ctx = testEnv.unauthenticatedContext();
    await assertFails(getDoc(doc(ctx.firestore(), 'settings/ownerPublic')));
  });
});

describe('settings/ownerPublic — update', () => {
  it('denies a non-owner from updating ownerPublic', async () => {
    await seedOwner();
    await seedOwnerPublic();
    const ctx = testEnv.authenticatedContext(OTHER_UID);
    await assertFails(
      setDoc(doc(ctx.firestore(), 'settings/ownerPublic'), { ownerUid: OTHER_UID }),
    );
  });
});

// ─── settings/publicLessonsMigration (M3F-08 backfill marker) ────────────────

describe('settings/publicLessonsMigration', () => {
  it('allows the owner to write the marker', async () => {
    await seedOwner();
    const db = testEnv.authenticatedContext(OWNER_UID).firestore();
    await assertSucceeds(
      setDoc(doc(db, 'settings/publicLessonsMigration'), {
        publicLessonsContentVersion: 1,
        completedAt: new Date(),
      }),
    );
  });

  it('allows the owner to read the marker', async () => {
    await seedOwner();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'settings/publicLessonsMigration'), {
        publicLessonsContentVersion: 1,
        completedAt: new Date(),
      });
    });
    const db = testEnv.authenticatedContext(OWNER_UID).firestore();
    await assertSucceeds(getDoc(doc(db, 'settings/publicLessonsMigration')));
  });

  it('denies a different authenticated user from reading the marker', async () => {
    await seedOwner();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'settings/publicLessonsMigration'), {
        publicLessonsContentVersion: 1,
        completedAt: new Date(),
      });
    });
    const other = testEnv.authenticatedContext(OTHER_UID);
    await assertFails(getDoc(doc(other.firestore(), 'settings/publicLessonsMigration')));
  });

  it('denies a different authenticated user from writing the marker', async () => {
    await seedOwner();
    const other = testEnv.authenticatedContext(OTHER_UID);
    await assertFails(
      setDoc(doc(other.firestore(), 'settings/publicLessonsMigration'), {
        publicLessonsContentVersion: 1,
        completedAt: new Date(),
      }),
    );
  });

  it('denies an unauthenticated user from reading the marker', async () => {
    await seedOwner();
    const unauth = testEnv.unauthenticatedContext();
    await assertFails(getDoc(doc(unauth.firestore(), 'settings/publicLessonsMigration')));
  });

  it('denies an unauthenticated user from writing the marker', async () => {
    await seedOwner();
    const unauth = testEnv.unauthenticatedContext();
    await assertFails(
      setDoc(doc(unauth.firestore(), 'settings/publicLessonsMigration'), {
        publicLessonsContentVersion: 1,
        completedAt: new Date(),
      }),
    );
  });
});

// ─── settings/verificationProjectionMigration (orphan cleanup marker) ───────

describe('settings/verificationProjectionMigration', () => {
  it('allows the owner to write and read the marker', async () => {
    await seedOwner();
    const db = testEnv.authenticatedContext(OWNER_UID).firestore();
    const ref = doc(db, 'settings/verificationProjectionMigration');
    await assertSucceeds(
      setDoc(ref, {
        cleanupVersion: 1,
        completedAt: new Date(),
      }),
    );
    await assertSucceeds(getDoc(ref));
  });

  it('denies a different authenticated user from reading or writing the marker', async () => {
    await seedOwner();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'settings/verificationProjectionMigration'), {
        cleanupVersion: 1,
        completedAt: new Date(),
      });
    });
    const db = testEnv.authenticatedContext(OTHER_UID).firestore();
    const ref = doc(db, 'settings/verificationProjectionMigration');
    await assertFails(getDoc(ref));
    await assertFails(setDoc(ref, { cleanupVersion: 1, completedAt: new Date() }));
  });

  it('denies an unauthenticated user from reading or writing the marker', async () => {
    await seedOwner();
    const db = testEnv.unauthenticatedContext().firestore();
    const ref = doc(db, 'settings/verificationProjectionMigration');
    await assertFails(getDoc(ref));
    await assertFails(setDoc(ref, { cleanupVersion: 1, completedAt: new Date() }));
  });
});

// ─── programs (owner data) ───────────────────────────────────────────────────

describe('programs', () => {
  it('allows owner to write and read programs', async () => {
    await seedOwner();
    const db = testEnv.authenticatedContext(OWNER_UID).firestore();
    await assertSucceeds(setDoc(doc(db, 'programs/p1'), { title: 'Test' }));
    await assertSucceeds(getDoc(doc(db, 'programs/p1')));
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
    const db = testEnv.authenticatedContext(OWNER_UID).firestore();
    await assertSucceeds(setDoc(doc(db, 'auditEvents/evt-1'), { action: 'auth.signIn' }));
    await assertSucceeds(getDoc(doc(db, 'auditEvents/evt-1')));
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
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, 'programs/p1')));
    await assertFails(getDoc(doc(db, 'anything/doc-1')));
  });
});
