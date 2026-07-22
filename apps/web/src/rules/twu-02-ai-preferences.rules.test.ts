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
import { doc, getDoc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import { afterAll, afterEach, beforeAll, describe, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIRESTORE_RULES = resolve(__dirname, '../../../../firestore.rules');

const OWNER_UID = 'owner-uid';
const OTHER_UID = 'other-uid';
const STUDENT_UID = 'student-uid';

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-schoolforge-twu-02-prefs',
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
function otherDb() {
  return testEnv.authenticatedContext(OTHER_UID).firestore() as unknown as Firestore;
}
function studentDb() {
  return testEnv.authenticatedContext(STUDENT_UID).firestore() as unknown as Firestore;
}
function anonDb() {
  return testEnv.unauthenticatedContext().firestore() as unknown as Firestore;
}

async function seedOwner() {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'settings/owner'), { ownerUid: OWNER_UID });
    await setDoc(doc(db, 'settings/ownerPublic'), { ownerUid: OWNER_UID });
    // A pre-existing valid document, for update/read tests.
    await setDoc(doc(db, 'teacherAiPreferences', OWNER_UID), {
      ownerUid: OWNER_UID,
      modelProfile: 'quality',
      gradingMode: 'balanced',
      updatedAt: new Date('2026-07-20'),
    });
  });
}

const validPrefs = (over: Record<string, unknown> = {}) => ({
  ownerUid: OWNER_UID,
  modelProfile: 'economy',
  gradingMode: 'rigorous',
  updatedAt: serverTimestamp(),
  ...over,
});

describe('Firestore rules — teacherAiPreferences/{ownerUid} (TWU-02)', () => {
  it('owner can create a valid document (id == ownerUid)', async () => {
    await seedOwner();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      // start from empty for a clean create
      await ctx.firestore().doc(`teacherAiPreferences/${OWNER_UID}`).delete();
    });
    await assertSucceeds(setDoc(doc(ownerDb(), 'teacherAiPreferences', OWNER_UID), validPrefs()));
  });

  it('owner can read and update their own document', async () => {
    await seedOwner();
    await assertSucceeds(getDoc(doc(ownerDb(), 'teacherAiPreferences', OWNER_UID)));
    await assertSucceeds(
      updateDoc(doc(ownerDb(), 'teacherAiPreferences', OWNER_UID), {
        modelProfile: 'economy',
        gradingMode: 'compassionate',
        updatedAt: serverTimestamp(),
      }),
    );
  });

  it('owner can save a valid teacherGuidance within the 500-char limit', async () => {
    await seedOwner();
    await assertSucceeds(
      setDoc(
        doc(ownerDb(), 'teacherAiPreferences', OWNER_UID),
        validPrefs({ teacherGuidance: 'Premia il ragionamento.' }),
      ),
    );
  });

  it('another authenticated user cannot read or write the owner document', async () => {
    await seedOwner();
    await assertFails(getDoc(doc(otherDb(), 'teacherAiPreferences', OWNER_UID)));
    await assertFails(setDoc(doc(otherDb(), 'teacherAiPreferences', OWNER_UID), validPrefs()));
    // Nor their own path (they are not the owner).
    await assertFails(
      setDoc(
        doc(otherDb(), 'teacherAiPreferences', OTHER_UID),
        validPrefs({ ownerUid: OTHER_UID }),
      ),
    );
  });

  it('a student cannot read or write the preferences', async () => {
    await seedOwner();
    await assertFails(getDoc(doc(studentDb(), 'teacherAiPreferences', OWNER_UID)));
    await assertFails(setDoc(doc(studentDb(), 'teacherAiPreferences', OWNER_UID), validPrefs()));
  });

  it('an anonymous user cannot read or write the preferences', async () => {
    await seedOwner();
    await assertFails(getDoc(doc(anonDb(), 'teacherAiPreferences', OWNER_UID)));
    await assertFails(setDoc(doc(anonDb(), 'teacherAiPreferences', OWNER_UID), validPrefs()));
  });

  it('rejects a wrong or mismatched ownerUid', async () => {
    await seedOwner();
    await assertFails(
      setDoc(
        doc(ownerDb(), 'teacherAiPreferences', OWNER_UID),
        validPrefs({ ownerUid: OTHER_UID }),
      ),
    );
  });

  it('rejects unknown enum values', async () => {
    await seedOwner();
    await assertFails(
      setDoc(
        doc(ownerDb(), 'teacherAiPreferences', OWNER_UID),
        validPrefs({ modelProfile: 'premium' }),
      ),
    );
    await assertFails(
      setDoc(
        doc(ownerDb(), 'teacherAiPreferences', OWNER_UID),
        validPrefs({ gradingMode: 'strict' }),
      ),
    );
  });

  it('rejects extra keys (closed contract)', async () => {
    await seedOwner();
    await assertFails(
      setDoc(
        doc(ownerDb(), 'teacherAiPreferences', OWNER_UID),
        validPrefs({ model: 'gpt-5.6-luna' }),
      ),
    );
  });

  it('rejects a client-supplied updatedAt (must be request.time)', async () => {
    await seedOwner();
    await assertFails(
      setDoc(
        doc(ownerDb(), 'teacherAiPreferences', OWNER_UID),
        validPrefs({ updatedAt: new Date('2020-01-01') }),
      ),
    );
  });

  it('rejects a teacherGuidance over the 500-char limit', async () => {
    await seedOwner();
    await assertFails(
      setDoc(
        doc(ownerDb(), 'teacherAiPreferences', OWNER_UID),
        validPrefs({ teacherGuidance: 'x'.repeat(501) }),
      ),
    );
  });
});
