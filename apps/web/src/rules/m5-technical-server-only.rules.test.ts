// @vitest-environment node
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertFails,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { afterAll, afterEach, beforeAll, describe, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RULES_PATH = resolve(__dirname, '../../../../firestore.rules');
const OWNER_UID = 'owner-uid';
const OTHER_UID = 'other-uid';

const TECHNICAL_DOCUMENTS = [
  'settings/aiConfig',
  'aiCorrectionRuns/run-1',
  'aiBudgetLedger/2026-07',
  // AIGEN-01 — run tecnici della generazione contenuti IA, server-only.
  'aiContentRuns/opaque-run-1',
] as const;

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-schoolforge-m5-technical-server-only',
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

async function seed(path: string): Promise<void> {
  // Fixture setup con Rules disabilitate, non simulazione dell'Admin SDK.
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), path), { technical: true });
  });
}

describe.each(TECHNICAL_DOCUMENTS)('%s — server-only', (path) => {
  it.each([
    ['owner', OWNER_UID],
    ['non-owner', OTHER_UID],
  ] as const)('nega read/create/update/delete al client %s', async (_label, uid) => {
    const db = testEnv.authenticatedContext(uid).firestore();
    const ref = doc(db, path);

    await assertFails(setDoc(ref, { technical: true }));

    await seed(path);
    await assertFails(getDoc(ref));
    await assertFails(updateDoc(ref, { technical: false }));
    await assertFails(deleteDoc(ref));
  });

  it('nega read/create/update/delete al client anonimo', async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    const ref = doc(db, path);
    await assertFails(setDoc(ref, { technical: true }));
    await seed(path);
    await assertFails(getDoc(ref));
    await assertFails(updateDoc(ref, { technical: false }));
    await assertFails(deleteDoc(ref));
  });
});
