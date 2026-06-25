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
import type { Firestore } from 'firebase/firestore';
import { afterAll, afterEach, beforeAll, describe, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIRESTORE_RULES = resolve(__dirname, '../../../../firestore.rules');

const OWNER_UID = 'owner-uid';
const OTHER_UID = 'other-uid';

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-schoolforge-m2a',
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

async function seedOwner() {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'settings/owner'), { ownerUid: OWNER_UID });
  });
}

function ownerDb() {
  return testEnv.authenticatedContext(OWNER_UID).firestore() as unknown as Firestore;
}

function otherDb() {
  return testEnv.authenticatedContext(OTHER_UID).firestore() as unknown as Firestore;
}

function anonDb() {
  return testEnv.unauthenticatedContext().firestore() as unknown as Firestore;
}

// ─── Classes ──────────────────────────────────────────────────────────────────

describe('Firestore rules — /classes/{classId}', () => {
  it('authenticated owner can create a class', async () => {
    await seedOwner();
    const db = ownerDb();
    await assertSucceeds(
      setDoc(doc(db, 'classes/c1'), {
        ownerUid: OWNER_UID,
        name: 'Classe 3A',
        description: null,
      }),
    );
  });

  it('authenticated owner can read their class', async () => {
    await seedOwner();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'classes/c1'), { ownerUid: OWNER_UID, name: 'Classe 3A' });
    });
    await assertSucceeds(getDoc(doc(ownerDb(), 'classes/c1')));
  });

  it('authenticated owner can update their class', async () => {
    await seedOwner();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'classes/c1'), { ownerUid: OWNER_UID, name: 'Classe 3A' });
    });
    await assertSucceeds(
      setDoc(doc(ownerDb(), 'classes/c1'), { ownerUid: OWNER_UID, name: 'Classe 3B' }),
    );
  });

  it('non-owner authenticated user cannot read another owner class', async () => {
    await seedOwner();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'classes/c1'), { ownerUid: OWNER_UID, name: 'Classe 3A' });
    });
    await assertFails(getDoc(doc(otherDb(), 'classes/c1')));
  });

  it('unauthenticated user cannot read classes', async () => {
    await seedOwner();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'classes/c1'), { ownerUid: OWNER_UID, name: 'Classe 3A' });
    });
    await assertFails(getDoc(doc(anonDb(), 'classes/c1')));
  });

  it('non-owner cannot create a class with their own ownerUid', async () => {
    await seedOwner();
    await assertFails(
      setDoc(doc(otherDb(), 'classes/c2'), {
        ownerUid: OTHER_UID,
        name: 'Classe 4A',
        description: null,
      }),
    );
  });

  it("non-owner cannot create a class with the owner's ownerUid", async () => {
    await seedOwner();
    await assertFails(
      setDoc(doc(otherDb(), 'classes/c3'), {
        ownerUid: OWNER_UID,
        name: 'Classe 4A',
        description: null,
      }),
    );
  });
});

// ─── Verifications ────────────────────────────────────────────────────────────

describe('Firestore rules — /verifications/{verificationId}', () => {
  it('authenticated owner can create a verification', async () => {
    await seedOwner();
    const db = ownerDb();
    await assertSucceeds(
      setDoc(doc(db, 'verifications/v1'), {
        ownerUid: OWNER_UID,
        status: 'draft',
        config: {
          title: 'Verifica 1',
          classId: null,
          programId: 'p1',
          importId: 'i1',
          questionRefs: [],
        },
        teacherSnapshot: null,
        activatedAt: null,
        closedAt: null,
      }),
    );
  });

  it('authenticated owner can read their verification', async () => {
    await seedOwner();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'verifications/v1'), {
        ownerUid: OWNER_UID,
        status: 'draft',
      });
    });
    await assertSucceeds(getDoc(doc(ownerDb(), 'verifications/v1')));
  });

  it('non-owner cannot read another owner verification', async () => {
    await seedOwner();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'verifications/v1'), {
        ownerUid: OWNER_UID,
        status: 'draft',
      });
    });
    await assertFails(getDoc(doc(otherDb(), 'verifications/v1')));
  });

  it('unauthenticated user cannot read verifications', async () => {
    await seedOwner();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'verifications/v1'), {
        ownerUid: OWNER_UID,
        status: 'draft',
      });
    });
    await assertFails(getDoc(doc(anonDb(), 'verifications/v1')));
  });
});

// ─── Verification immutability ────────────────────────────────────────────────

describe('Firestore rules — verification immutability', () => {
  const DRAFT_DOC = {
    ownerUid: OWNER_UID,
    status: 'draft',
    config: { title: 'V1', classId: null, programId: 'p1', importId: 'i1', questionRefs: [] },
    teacherSnapshot: null,
    activatedAt: null,
    closedAt: null,
  };

  const ACTIVE_DOC = {
    ...DRAFT_DOC,
    status: 'active',
    teacherSnapshot: {
      title: 'V1',
      classId: null,
      className: null,
      programId: 'p1',
      importId: 'i1',
      questionRefs: [],
      activatedAt: null,
    },
  };

  it('owner can update config when status is draft', async () => {
    await seedOwner();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'verifications/v1'), DRAFT_DOC);
    });
    await assertSucceeds(
      setDoc(doc(ownerDb(), 'verifications/v1'), {
        ...DRAFT_DOC,
        config: { ...DRAFT_DOC.config, title: 'V1 aggiornata' },
      }),
    );
  });

  it('owner cannot update config when status is active', async () => {
    await seedOwner();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'verifications/v1'), ACTIVE_DOC);
    });
    await assertFails(
      setDoc(doc(ownerDb(), 'verifications/v1'), {
        ...ACTIVE_DOC,
        config: { ...ACTIVE_DOC.config, title: 'Modificata' },
      }),
    );
  });

  it('owner cannot modify teacherSnapshot when status is active', async () => {
    await seedOwner();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'verifications/v1'), ACTIVE_DOC);
    });
    await assertFails(
      setDoc(doc(ownerDb(), 'verifications/v1'), {
        ...ACTIVE_DOC,
        teacherSnapshot: { ...ACTIVE_DOC.teacherSnapshot, title: 'Hacked' },
      }),
    );
  });

  it('owner can close an active verification (status active -> closed)', async () => {
    await seedOwner();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'verifications/v1'), ACTIVE_DOC);
    });
    await assertSucceeds(
      setDoc(doc(ownerDb(), 'verifications/v1'), {
        ...ACTIVE_DOC,
        status: 'closed',
        closedAt: null,
      }),
    );
  });

  it('non-owner cannot update a verification in any status', async () => {
    await seedOwner();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'verifications/v1'), DRAFT_DOC);
    });
    await assertFails(
      setDoc(doc(otherDb(), 'verifications/v1'), {
        ...DRAFT_DOC,
        config: { ...DRAFT_DOC.config, title: 'X' },
      }),
    );
  });
});

// ─── Default deny ─────────────────────────────────────────────────────────────

describe('Firestore rules — default deny', () => {
  it('authenticated user cannot read an unrelated collection path', async () => {
    await seedOwner();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'unrelatedCollection/doc1'), { data: 'secret' });
    });
    await assertFails(getDoc(doc(ownerDb(), 'unrelatedCollection/doc1')));
  });
});
