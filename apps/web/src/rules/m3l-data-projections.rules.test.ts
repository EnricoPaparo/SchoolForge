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
    projectId: 'demo-schoolforge-m3l',
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

function studentDb() {
  return testEnv.authenticatedContext(OTHER_UID).firestore() as unknown as Firestore;
}

function anonDb() {
  return testEnv.unauthenticatedContext().firestore() as unknown as Firestore;
}

const BASE_CONFIG = {
  title: 'Verifica 1',
  classId: null,
  programId: 'p1',
  importId: 'i1',
  questionRefs: [],
};

/**
 * Seeds settings/owner, settings/ownerPublic, the verification and
 * (optionally) its publishedProjection in a single admin-context callback.
 * Splitting this across multiple separate `withSecurityRulesDisabled` calls
 * within one test intermittently trips the JS SDK's "Firestore has already
 * been started" guard against re-configuring an already-connected instance
 * — a single callback avoids re-touching the same admin Firestore handle.
 */
async function seedVerification(
  overrides: Record<string, unknown>,
  options: { withProjection?: boolean } = {},
) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'settings/owner'), { ownerUid: OWNER_UID });
    await setDoc(doc(db, 'settings/ownerPublic'), { ownerUid: OWNER_UID });
    await setDoc(doc(db, 'verifications/v1'), {
      ownerUid: OWNER_UID,
      status: 'draft',
      visibility: 'hidden',
      config: BASE_CONFIG,
      teacherSnapshot: null,
      activatedAt: null,
      closedAt: null,
      ...overrides,
    });
    if (options.withProjection) {
      await setDoc(doc(db, 'verifications/v1/publishedProjection/data'), {
        ownerUid: OWNER_UID,
        title: 'Verifica 1',
        className: null,
        questions: [{ order: 0, tipo: 'aperta', maxPoints: 3, testo: 'Domanda?' }],
        activatedAt: null,
      });
    }
  });
}

// ─── visibility toggle ───────────────────────────────────────────────────────

describe('Firestore rules — verification visibility toggle', () => {
  it('owner can toggle hidden -> public on an active verification', async () => {
    await seedVerification({ status: 'active', visibility: 'hidden' });

    await assertSucceeds(
      setDoc(
        doc(ownerDb(), 'verifications/v1'),
        { visibility: 'public', updatedAt: null },
        { merge: true },
      ),
    );
  });

  it('owner can toggle public -> hidden on an active verification', async () => {
    await seedVerification({ status: 'active', visibility: 'public' });

    await assertSucceeds(
      setDoc(
        doc(ownerDb(), 'verifications/v1'),
        { visibility: 'hidden', updatedAt: null },
        { merge: true },
      ),
    );
  });

  it('owner cannot change config while toggling visibility', async () => {
    await seedVerification({ status: 'active', visibility: 'hidden' });

    await assertFails(
      setDoc(
        doc(ownerDb(), 'verifications/v1'),
        { visibility: 'public', config: { ...BASE_CONFIG, title: 'Cambiato' } },
        { merge: true },
      ),
    );
  });

  it('owner cannot change status while toggling visibility', async () => {
    await seedVerification({ status: 'active', visibility: 'hidden' });

    await assertFails(
      setDoc(
        doc(ownerDb(), 'verifications/v1'),
        { visibility: 'public', status: 'closed' },
        { merge: true },
      ),
    );
  });

  it('owner cannot toggle visibility on a closed verification', async () => {
    await seedVerification({ status: 'closed', visibility: 'hidden' });

    await assertFails(
      setDoc(
        doc(ownerDb(), 'verifications/v1'),
        { visibility: 'public', updatedAt: null },
        { merge: true },
      ),
    );
  });

  it('a non-owner cannot toggle visibility', async () => {
    await seedVerification({ status: 'active', visibility: 'hidden' });

    await assertFails(
      setDoc(
        doc(studentDb(), 'verifications/v1'),
        { visibility: 'public', updatedAt: null },
        { merge: true },
      ),
    );
  });
});

// ─── publishedProjection read access ─────────────────────────────────────────

describe('Firestore rules — verifications/{id}/publishedProjection', () => {
  it('owner can always read publishedProjection, regardless of status/visibility', async () => {
    await seedVerification({ status: 'draft', visibility: 'hidden' }, { withProjection: true });

    await assertSucceeds(getDoc(doc(ownerDb(), 'verifications/v1/publishedProjection/data')));
  });

  it('a student can read publishedProjection when the verification is active + public', async () => {
    await seedVerification({ status: 'active', visibility: 'public' }, { withProjection: true });

    await assertSucceeds(getDoc(doc(studentDb(), 'verifications/v1/publishedProjection/data')));
  });

  it('a student cannot read publishedProjection when active but hidden', async () => {
    await seedVerification({ status: 'active', visibility: 'hidden' }, { withProjection: true });

    await assertFails(getDoc(doc(studentDb(), 'verifications/v1/publishedProjection/data')));
  });

  it('a student cannot read publishedProjection when the verification is draft', async () => {
    await seedVerification({ status: 'draft', visibility: 'public' }, { withProjection: true });

    await assertFails(getDoc(doc(studentDb(), 'verifications/v1/publishedProjection/data')));
  });

  it('a student cannot read publishedProjection when the verification is closed', async () => {
    await seedVerification({ status: 'closed', visibility: 'public' }, { withProjection: true });

    await assertFails(getDoc(doc(studentDb(), 'verifications/v1/publishedProjection/data')));
  });

  it('an unauthenticated user can never read publishedProjection, even active + public', async () => {
    await seedVerification({ status: 'active', visibility: 'public' }, { withProjection: true });

    await assertFails(getDoc(doc(anonDb(), 'verifications/v1/publishedProjection/data')));
  });

  it('a student can never write publishedProjection, even when active + public', async () => {
    await seedVerification({ status: 'active', visibility: 'public' }, { withProjection: true });

    await assertFails(
      setDoc(
        doc(studentDb(), 'verifications/v1/publishedProjection/data'),
        { questions: [] },
        { merge: true },
      ),
    );
  });

  it('a student can never read the parent verification document, even active + public', async () => {
    await seedVerification({ status: 'active', visibility: 'public' });

    await assertFails(getDoc(doc(studentDb(), 'verifications/v1')));
  });
});
