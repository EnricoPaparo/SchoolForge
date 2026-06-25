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
import { collection, doc, getDoc, getDocs, setDoc } from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import { ref, uploadBytes, getBytes } from 'firebase/storage';
import type { FirebaseStorage } from 'firebase/storage';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { importRepository } from '../features/repository/import/importRepository.js';
import type { RawFile } from '../features/repository/validation/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIRESTORE_RULES = resolve(__dirname, '../../../../firestore.rules');
const STORAGE_RULES = resolve(__dirname, '../../../../storage.rules');

const OWNER_UID = 'owner-uid';
const OTHER_UID = 'other-uid';

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-schoolforge-import',
    firestore: {
      rules: readFileSync(FIRESTORE_RULES, 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
    storage: {
      rules: readFileSync(STORAGE_RULES, 'utf8'),
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

async function seedOwner() {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'settings/owner'), { ownerUid: OWNER_UID });
  });
}

function ownerDb() {
  return testEnv.authenticatedContext(OWNER_UID).firestore() as unknown as Firestore;
}

function ownerStorage() {
  return testEnv.authenticatedContext(OWNER_UID).storage() as unknown as FirebaseStorage;
}

function otherDb() {
  return testEnv.authenticatedContext(OTHER_UID).firestore() as unknown as Firestore;
}

function otherStorage() {
  return testEnv.authenticatedContext(OTHER_UID).storage() as unknown as FirebaseStorage;
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

const UDA_FILE: RawFile = {
  path: 'uda-01-reti/uda-01-reti.md',
  content: `---
titolo: Reti di computer
competenze:
  - Comprendere ISO/OSI
obiettivi:
  - Descrivere HTTP
---
`,
};

const LESSON: RawFile = {
  path: 'uda-01-reti/lezione-001-http.md',
  content: '# HTTP\n\nContenuto.',
};

const VALID_POOL: RawFile = {
  path: 'uda-01-reti/lezione-001-http.pool.md',
  content: `---
schema: schoolforge-pool/v1
questions:
  - id: q-001
    tipo: aperta
    difficolta: 2
    peso: 3
    testo: Spiega HTTP.
    soluzione: HTTP è un protocollo applicativo.
  - id: q-002
    tipo: chiusa_singola
    difficolta: 1
    peso: 1
    testo: Porta HTTP?
    opzioni:
      - id: a
        testo: "80"
      - id: b
        testo: "443"
    soluzione: [a]
---`,
};

const LESSON_NO_POOL: RawFile = {
  path: 'uda-01-reti/lezione-002-https.md',
  content: '# HTTPS',
};

const INVALID_POOL_FILE: RawFile = {
  path: 'uda-01-reti/lezione-002-https.pool.md',
  content: `---
schema: schoolforge-pool/v1
questions:
  - id: q-001
    tipo: aperta
    testo: Domanda senza difficolta e peso.
---`,
};

const VALID_FILES = [UDA_FILE, LESSON, VALID_POOL, LESSON_NO_POOL];
const INVALID_POOL_FILES = [UDA_FILE, LESSON, LESSON_NO_POOL, INVALID_POOL_FILE];

// ─── Security Rules — Firestore paths ────────────────────────────────────────

describe('Firestore rules — programs/{id}/imports/{id} owner-scoped', () => {
  it('allows owner to write import metadata', async () => {
    await seedOwner();
    const db = ownerDb();
    await assertSucceeds(
      setDoc(doc(db, 'programs/p1/imports/imp-1'), { status: 'committed', ownerUid: OWNER_UID }),
    );
  });

  it('allows owner to read import metadata', async () => {
    await seedOwner();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'programs/p1/imports/imp-1'), { status: 'committed' });
    });
    const db = ownerDb();
    await assertSucceeds(getDoc(doc(db, 'programs/p1/imports/imp-1')));
  });

  it('denies other authenticated user from reading import', async () => {
    await seedOwner();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'programs/p1/imports/imp-1'), { status: 'committed' });
    });
    const other = testEnv.authenticatedContext(OTHER_UID);
    await assertFails(getDoc(doc(other.firestore(), 'programs/p1/imports/imp-1')));
  });

  it('allows owner to write questionIndex subcollection', async () => {
    await seedOwner();
    const db = ownerDb();
    await assertSucceeds(
      setDoc(doc(db, 'programs/p1/imports/imp-1/questionIndex/q-01'), {
        tipo: 'aperta',
        difficolta: 1,
        peso: 1,
      }),
    );
  });

  it('denies other user from reading questionIndex', async () => {
    await seedOwner();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'programs/p1/imports/imp-1/questionIndex/q-01'), {
        tipo: 'aperta',
      });
    });
    const other = testEnv.authenticatedContext(OTHER_UID);
    await assertFails(
      getDoc(doc(other.firestore(), 'programs/p1/imports/imp-1/questionIndex/q-01')),
    );
  });
});

// ─── Integration — importRepository ──────────────────────────────────────────

describe('importRepository — valid import', () => {
  it('returns status committed with correct counts', async () => {
    await seedOwner();
    const db = ownerDb();
    const storage = ownerStorage();

    const result = await importRepository(
      { ownerUid: OWNER_UID, programmaTitle: 'Informatica', files: VALID_FILES },
      { db, storage },
    );

    expect(result.status).toBe('committed');
    if (result.status !== 'committed') return;
    expect(result.udaCount).toBe(1);
    expect(result.lessonCount).toBe(2);
    expect(result.questionCount).toBe(2);
    expect(result.programId).toBeTruthy();
    expect(result.importId).toBeTruthy();
  });

  it('sets activeImportId on the program document', async () => {
    await seedOwner();
    const db = ownerDb();
    const storage = ownerStorage();

    const result = await importRepository(
      { ownerUid: OWNER_UID, programmaTitle: 'Informatica', files: VALID_FILES },
      { db, storage },
    );

    if (result.status !== 'committed') throw new Error('expected committed');

    const programSnap = await getDoc(doc(db, 'programs', result.programId));
    expect(programSnap.exists()).toBe(true);
    expect(programSnap.data()?.activeImportId).toBe(result.importId);
    expect(programSnap.data()?.ownerUid).toBe(OWNER_UID);
  });

  it('creates import metadata document in Firestore', async () => {
    await seedOwner();
    const db = ownerDb();
    const storage = ownerStorage();

    const result = await importRepository(
      { ownerUid: OWNER_UID, programmaTitle: 'Informatica', files: VALID_FILES },
      { db, storage },
    );

    if (result.status !== 'committed') throw new Error('expected committed');

    const importSnap = await getDoc(
      doc(db, 'programs', result.programId, 'imports', result.importId),
    );
    expect(importSnap.exists()).toBe(true);
    const data = importSnap.data()!;
    expect(data.status).toBe('committed');
    expect(data.udaCount).toBe(1);
    expect(data.lessonCount).toBe(2);
    expect(data.questionCount).toBe(2);
  });

  it('uploads files to Storage under repository/{ownerUid}/imports/{importId}/...', async () => {
    await seedOwner();
    const db = ownerDb();
    const storage = ownerStorage();

    const result = await importRepository(
      { ownerUid: OWNER_UID, programmaTitle: 'Informatica', files: VALID_FILES },
      { db, storage },
    );

    if (result.status !== 'committed') throw new Error('expected committed');

    const udaRef = ref(
      storage,
      `repository/${OWNER_UID}/imports/${result.importId}/${UDA_FILE.path}`,
    );
    await expect(getBytes(udaRef)).resolves.toBeDefined();
  });

  it('creates questionIndex entries for valid pool only', async () => {
    await seedOwner();
    const db = ownerDb();
    const storage = ownerStorage();

    const result = await importRepository(
      { ownerUid: OWNER_UID, programmaTitle: 'Informatica', files: VALID_FILES },
      { db, storage },
    );

    if (result.status !== 'committed') throw new Error('expected committed');

    const qiSnap = await getDocs(
      collection(db, 'programs', result.programId, 'imports', result.importId, 'questionIndex'),
    );
    expect(qiSnap.size).toBe(2);
    for (const d of qiSnap.docs) {
      const data = d.data();
      expect(data).toHaveProperty('tipo');
      expect(data).toHaveProperty('difficolta');
      expect(data).toHaveProperty('peso');
      expect(data).toHaveProperty('maxPoints');
      expect(data).not.toHaveProperty('testo');
      expect(data).not.toHaveProperty('soluzione');
    }
  });

  it('creates an auditEvent for the committed import', async () => {
    await seedOwner();
    const db = ownerDb();
    const storage = ownerStorage();

    const result = await importRepository(
      { ownerUid: OWNER_UID, programmaTitle: 'Informatica', files: VALID_FILES },
      { db, storage },
    );

    if (result.status !== 'committed') throw new Error('expected committed');

    const auditSnap = await getDocs(collection(db, 'auditEvents'));
    const events = auditSnap.docs.map((d) => d.data());
    const importEvent = events.find(
      (e) => e.action === 'import.committed' && e.targetId === result.importId,
    );
    expect(importEvent).toBeDefined();
    expect(importEvent?.actorUid).toBe(OWNER_UID);
    expect(importEvent?.outcome).toBe('success');
  });

  it('reuses provided programId and updates activeImportId', async () => {
    await seedOwner();
    const db = ownerDb();
    const storage = ownerStorage();

    // First import
    const r1 = await importRepository(
      { ownerUid: OWNER_UID, programmaTitle: 'Informatica', files: VALID_FILES },
      { db, storage },
    );
    if (r1.status !== 'committed') throw new Error('expected committed');

    // Second import to the same programId
    const r2 = await importRepository(
      {
        ownerUid: OWNER_UID,
        programmaTitle: 'Informatica v2',
        programId: r1.programId,
        files: VALID_FILES,
      },
      { db, storage },
    );
    if (r2.status !== 'committed') throw new Error('expected committed');

    expect(r2.programId).toBe(r1.programId);
    expect(r2.importId).not.toBe(r1.importId);

    const programSnap = await getDoc(doc(db, 'programs', r1.programId));
    expect(programSnap.data()?.activeImportId).toBe(r2.importId);
  });
});

describe('importRepository — invalid pool does not block import', () => {
  it('returns committed even with invalid pool', async () => {
    await seedOwner();
    const db = ownerDb();
    const storage = ownerStorage();

    const result = await importRepository(
      { ownerUid: OWNER_UID, programmaTitle: 'Informatica', files: INVALID_POOL_FILES },
      { db, storage },
    );

    expect(result.status).toBe('committed');
    if (result.status !== 'committed') return;
    expect(result.questionCount).toBe(0);
    const poolIssues = result.validationIssues.filter(
      (i) => i.level === 'pool' || i.level === 'question',
    );
    expect(poolIssues.length).toBeGreaterThan(0);
  });

  it('invalid pool lesson has no questionIndex entries', async () => {
    await seedOwner();
    const db = ownerDb();
    const storage = ownerStorage();

    const result = await importRepository(
      { ownerUid: OWNER_UID, programmaTitle: 'Informatica', files: INVALID_POOL_FILES },
      { db, storage },
    );

    if (result.status !== 'committed') throw new Error('expected committed');

    const qiSnap = await getDocs(
      collection(db, 'programs', result.programId, 'imports', result.importId, 'questionIndex'),
    );
    expect(qiSnap.size).toBe(0);
  });
});

describe('importRepository — structural validation failure', () => {
  it('returns validation_failed and writes nothing to Firestore', async () => {
    await seedOwner();
    const db = ownerDb();
    const storage = ownerStorage();

    // Empty file list → NO_UDAS
    const result = await importRepository(
      { ownerUid: OWNER_UID, programmaTitle: 'Informatica', files: [] },
      { db, storage },
    );

    expect(result.status).toBe('validation_failed');

    // programs collection should be empty
    const programsSnap = await getDocs(collection(db, 'programs'));
    expect(programsSnap.empty).toBe(true);
  });

  it('empty title returns validation_failed', async () => {
    await seedOwner();
    const db = ownerDb();
    const storage = ownerStorage();

    const result = await importRepository(
      { ownerUid: OWNER_UID, programmaTitle: '   ', files: VALID_FILES },
      { db, storage },
    );

    expect(result.status).toBe('validation_failed');
    if (result.status !== 'validation_failed') return;
    expect(result.validationIssues.find((i) => i.code === 'MISSING_FIELD')).toBeDefined();
  });

  it('does not update activeImportId on failure', async () => {
    await seedOwner();
    const db = ownerDb();
    const storage = ownerStorage();

    // First valid import
    const r1 = await importRepository(
      { ownerUid: OWNER_UID, programmaTitle: 'Informatica', files: VALID_FILES },
      { db, storage },
    );
    if (r1.status !== 'committed') throw new Error('expected committed');

    // Second import with structural failure using same programId
    const r2 = await importRepository(
      { ownerUid: OWNER_UID, programmaTitle: 'Informatica', programId: r1.programId, files: [] },
      { db, storage },
    );

    expect(r2.status).toBe('validation_failed');

    // activeImportId still points to first import
    const programSnap = await getDoc(doc(db, 'programs', r1.programId));
    expect(programSnap.data()?.activeImportId).toBe(r1.importId);
  });
});

describe('importRepository — owner isolation', () => {
  it('other authenticated user cannot read owner programs', async () => {
    await seedOwner();
    const db = ownerDb();
    const storage = ownerStorage();

    const result = await importRepository(
      { ownerUid: OWNER_UID, programmaTitle: 'Informatica', files: VALID_FILES },
      { db, storage },
    );
    if (result.status !== 'committed') throw new Error('expected committed');

    const other = otherDb();
    await assertFails(getDoc(doc(other, 'programs', result.programId)));
  });

  it('other user cannot upload to owner Storage path', async () => {
    const st = otherStorage();
    await assertFails(
      uploadBytes(
        ref(st, `repository/${OWNER_UID}/imports/imp-x/file.md`),
        new Uint8Array([1, 2, 3]),
      ),
    );
  });
});
