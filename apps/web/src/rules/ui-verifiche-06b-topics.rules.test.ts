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
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

/**
 * UI-VERIFICHE-06B — `verificationDate` e `topicOutline`.
 *
 * Le Rules **non** sono state modificate: il documento verifica è già
 * owner-only in lettura e scrittura, e la proiezione pubblica è già leggibile
 * solo da un compagno di classe autorizzato e scrivibile solo dall'owner. Questi
 * test fissano quel contratto sui nuovi campi, così una futura apertura
 * accidentale (o l'aggiunta dei campi al posto sbagliato) fallisce qui.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIRESTORE_RULES = resolve(__dirname, '../../../../firestore.rules');

const OWNER_UID = 'owner-uid';
const STUDENT_UID = 'student-uid';
const OTHER_STUDENT_UID = 'other-student-uid';

const TOPIC_OUTLINE = [
  { udaTitle: 'Il Web', lessonTitles: ['Come funziona Internet'] },
  { udaTitle: 'Intelligenza artificiale', lessonTitles: ['Introduzione ai modelli linguistici'] },
];

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-schoolforge-ui-verifiche-06b',
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
  return testEnv.authenticatedContext(STUDENT_UID).firestore() as unknown as Firestore;
}

function otherStudentDb() {
  return testEnv.authenticatedContext(OTHER_STUDENT_UID).firestore() as unknown as Firestore;
}

const PROJECTION = {
  ownerUid: OWNER_UID,
  title: 'V1',
  className: 'Classe 3A',
  classId: 'cls-1',
  visibility: 'public',
  status: 'active',
  onlineEnabled: false,
  studentPdfEnabled: false,
  distributionMode: 'same_questions',
  verificationDate: '2026-02-02',
  topicOutline: TOPIC_OUTLINE,
  questions: [{ order: 0, tipo: 'aperta', maxPoints: 2, testo: 'Domanda?' }],
  activatedAt: null,
};

async function seed() {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'settings/owner'), { ownerUid: OWNER_UID });
    await setDoc(doc(db, 'settings/studentAccess'), {
      ownerUid: OWNER_UID,
      studentPortalEnabled: true,
      newStudentRequestsEnabled: false,
    });
    for (const [uid, classId] of [
      [STUDENT_UID, 'cls-1'],
      [OTHER_STUDENT_UID, 'cls-2'],
    ] as const) {
      await setDoc(doc(db, 'students', uid), {
        uid,
        ownerUid: OWNER_UID,
        email: `${uid}@example.com`,
        displayName: null,
        status: 'approved',
        classId,
      });
    }
    await setDoc(doc(db, 'verifications/v1'), {
      ownerUid: OWNER_UID,
      status: 'active',
      visibility: 'public',
      onlineEnabled: false,
      studentPdfEnabled: false,
      config: {
        title: 'V1',
        classId: 'cls-1',
        programId: 'p1',
        importId: 'i1',
        verificationDate: '2026-02-02',
        topicOutline: TOPIC_OUTLINE,
        questionRefs: [],
      },
      teacherSnapshot: {
        title: 'V1',
        classId: 'cls-1',
        className: 'Classe 3A',
        programId: 'p1',
        importId: 'i1',
        verificationDate: '2026-02-02',
        topicOutline: TOPIC_OUTLINE,
        questionRefs: [],
        activatedAt: null,
      },
      activatedAt: null,
      closedAt: null,
    });
    await setDoc(doc(db, 'verifications/v1/publishedProjection/data'), PROJECTION);
  });
}

describe('Firestore rules — verificationDate e topicOutline (UI-VERIFICHE-06B)', () => {
  it('lo studente della classe legge data e argomenti dalla sola proiezione pubblica', async () => {
    await seed();
    const snap = await getDoc(doc(studentDb(), 'verifications/v1/publishedProjection/data'));
    expect(snap.exists()).toBe(true);
    expect(snap.data()?.verificationDate).toBe('2026-02-02');
    expect(snap.data()?.topicOutline).toEqual(TOPIC_OUTLINE);
  });

  it('lo studente non può leggere il documento verifica, quindi mai il teacherSnapshot', async () => {
    await seed();
    await assertFails(getDoc(doc(studentDb(), 'verifications/v1')));
  });

  it('uno studente di un’altra classe non vede la proiezione, argomenti inclusi', async () => {
    await seed();
    await assertFails(getDoc(doc(otherStudentDb(), 'verifications/v1/publishedProjection/data')));
  });

  it('lo studente non può scrivere data o argomenti nella proiezione', async () => {
    await seed();
    await assertFails(
      updateDoc(doc(studentDb(), 'verifications/v1/publishedProjection/data'), {
        verificationDate: '2030-01-01',
      }),
    );
    await assertFails(
      updateDoc(doc(studentDb(), 'verifications/v1/publishedProjection/data'), {
        topicOutline: [{ udaTitle: 'Falso', lessonTitles: ['Falso'] }],
      }),
    );
  });

  it('lo studente non può scriverli nemmeno sul documento verifica', async () => {
    await seed();
    await assertFails(
      updateDoc(doc(studentDb(), 'verifications/v1'), {
        'config.verificationDate': '2030-01-01',
      }),
    );
  });

  it('l’owner scrive data e argomenti nella proiezione e nella bozza', async () => {
    await seed();
    await assertSucceeds(
      updateDoc(doc(ownerDb(), 'verifications/v1/publishedProjection/data'), {
        topicOutline: TOPIC_OUTLINE,
        verificationDate: '2026-02-02',
      }),
    );
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), 'verifications/v1'), { status: 'draft' });
    });
    await assertSucceeds(
      updateDoc(doc(ownerDb(), 'verifications/v1'), {
        'config.verificationDate': '2026-03-01',
      }),
    );
  });

  it('la proiezione resta illeggibile quando non è pubblica, anche con gli argomenti presenti', async () => {
    await seed();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), 'verifications/v1/publishedProjection/data'), {
        visibility: 'hidden',
      });
    });
    await assertFails(getDoc(doc(studentDb(), 'verifications/v1/publishedProjection/data')));
  });
});
