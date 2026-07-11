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
import type { Firestore } from 'firebase/firestore';
import { afterAll, afterEach, beforeAll, describe, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIRESTORE_RULES = resolve(__dirname, '../../../../firestore.rules');

const OWNER_UID = 'owner-uid';
const OTHER_UID = 'other-uid';

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-schoolforge-m3f-05',
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

const ACTIVE_DOC_WITH_CLASS = {
  ownerUid: OWNER_UID,
  status: 'active',
  visibility: 'hidden',
  onlineEnabled: false,
  config: { title: 'V1', classId: 'cls-1', programId: 'p1', importId: 'i1', questionRefs: [] },
  teacherSnapshot: {
    title: 'V1',
    classId: 'cls-1',
    className: 'Classe 3A',
    programId: 'p1',
    importId: 'i1',
    questionRefs: [],
    activatedAt: null,
  },
  activatedAt: null,
  closedAt: null,
};

const ACTIVE_DOC_NO_CLASS = {
  ...ACTIVE_DOC_WITH_CLASS,
  config: { ...ACTIVE_DOC_WITH_CLASS.config, classId: null },
  teacherSnapshot: { ...ACTIVE_DOC_WITH_CLASS.teacherSnapshot, classId: null, className: null },
};

describe('Firestore rules — verifications onlineEnabled toggle (M3F-05)', () => {
  it('owner can enable onlineEnabled on an active verification with a class', async () => {
    await seedOwner();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'verifications/v1'), ACTIVE_DOC_WITH_CLASS);
    });
    await assertSucceeds(
      setDoc(doc(ownerDb(), 'verifications/v1'), {
        ...ACTIVE_DOC_WITH_CLASS,
        onlineEnabled: true,
        updatedAt: null,
      }),
    );
  });

  it('owner can disable onlineEnabled on an active verification', async () => {
    await seedOwner();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'verifications/v1'), {
        ...ACTIVE_DOC_WITH_CLASS,
        onlineEnabled: true,
      });
    });
    await assertSucceeds(
      setDoc(doc(ownerDb(), 'verifications/v1'), {
        ...ACTIVE_DOC_WITH_CLASS,
        onlineEnabled: false,
        updatedAt: null,
      }),
    );
  });

  it('owner cannot enable onlineEnabled when the verification has no class assigned', async () => {
    await seedOwner();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'verifications/v1'), ACTIVE_DOC_NO_CLASS);
    });
    await assertFails(
      setDoc(doc(ownerDb(), 'verifications/v1'), {
        ...ACTIVE_DOC_NO_CLASS,
        onlineEnabled: true,
        updatedAt: null,
      }),
    );
  });

  it('non-owner cannot toggle onlineEnabled', async () => {
    await seedOwner();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'verifications/v1'), ACTIVE_DOC_WITH_CLASS);
    });
    await assertFails(
      setDoc(doc(otherDb(), 'verifications/v1'), {
        ...ACTIVE_DOC_WITH_CLASS,
        onlineEnabled: true,
        updatedAt: null,
      }),
    );
  });

  it('owner cannot toggle onlineEnabled while simultaneously changing config', async () => {
    await seedOwner();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'verifications/v1'), ACTIVE_DOC_WITH_CLASS);
    });
    await assertFails(
      setDoc(doc(ownerDb(), 'verifications/v1'), {
        ...ACTIVE_DOC_WITH_CLASS,
        onlineEnabled: true,
        updatedAt: null,
        config: { ...ACTIVE_DOC_WITH_CLASS.config, title: 'Cambiato' },
      }),
    );
  });

  it('owner cannot toggle onlineEnabled while simultaneously changing ownerUid', async () => {
    await seedOwner();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'verifications/v1'), ACTIVE_DOC_WITH_CLASS);
    });
    await assertFails(
      setDoc(doc(ownerDb(), 'verifications/v1'), {
        ...ACTIVE_DOC_WITH_CLASS,
        onlineEnabled: true,
        updatedAt: null,
        ownerUid: OTHER_UID,
      }),
    );
  });

  it('owner cannot toggle onlineEnabled while simultaneously changing status', async () => {
    await seedOwner();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'verifications/v1'), ACTIVE_DOC_WITH_CLASS);
    });
    await assertFails(
      setDoc(doc(ownerDb(), 'verifications/v1'), {
        ...ACTIVE_DOC_WITH_CLASS,
        onlineEnabled: true,
        updatedAt: null,
        status: 'closed',
      }),
    );
  });

  it('cannot toggle onlineEnabled on a closed verification', async () => {
    await seedOwner();
    const CLOSED_DOC = { ...ACTIVE_DOC_WITH_CLASS, status: 'closed' };
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'verifications/v1'), CLOSED_DOC);
    });
    await assertFails(
      setDoc(doc(ownerDb(), 'verifications/v1'), {
        ...CLOSED_DOC,
        onlineEnabled: true,
        updatedAt: null,
      }),
    );
  });

  it.each([null, 'true', 1, {}, []])(
    'rejects a non-boolean onlineEnabled value (%j)',
    async (nonBoolValue) => {
      await seedOwner();
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        await setDoc(doc(ctx.firestore(), 'verifications/v1'), ACTIVE_DOC_WITH_CLASS);
      });
      await assertFails(
        setDoc(doc(ownerDb(), 'verifications/v1'), {
          ...ACTIVE_DOC_WITH_CLASS,
          onlineEnabled: nonBoolValue,
          updatedAt: null,
        }),
      );
    },
  );
});
