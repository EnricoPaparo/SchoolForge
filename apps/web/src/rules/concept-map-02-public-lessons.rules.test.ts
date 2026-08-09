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
import { afterAll, afterEach, beforeAll, describe, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIRESTORE_RULES = resolve(__dirname, '../../../../firestore.rules');

const OWNER_UID = 'owner-uid';
const STUDENT_UID = 'student-uid';
const OTHER_UID = 'other-uid';

const MAP = '## Ossatura della lezione\n\n- densità\n';

/**
 * CONCEPT-MAP-02 — l'invariante di visibilità difeso dalle Rules: una
 * proiezione `publicLessons` con `completed != true` **non può contenere**
 * `conceptMapMarkdown`. La UI non è il confine di sicurezza; queste regole lo
 * sono.
 *
 * CONFINE DICHIARATO: le Rules verificano tipo, non-vuotezza, tetto in
 * **caratteri** e la condizione su `completed`. Non verificano la struttura
 * canonica dell'artefatto né il cap in **byte** UTF-8 — `size()` conta
 * caratteri — che restano applicativi (`conceptMapContract.ts` e, per la
 * generazione, `functions/src/aiContentConceptMap.ts`).
 */

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-schoolforge-concept-map-02',
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
function otherDb() {
  return testEnv.authenticatedContext(OTHER_UID).firestore() as unknown as Firestore;
}
function anonDb() {
  return testEnv.unauthenticatedContext().firestore() as unknown as Firestore;
}

function projection(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ownerUid: OWNER_UID,
    programId: 'p1',
    importId: 'i1',
    udaId: 'uda-1',
    udaDir: 'uda-01-reti',
    path: 'uda-01-reti/lezione-001.md',
    filename: 'lezione-001.md',
    contentPath: 'repository/owner-uid/imports/i1/uda-01-reti/lezione-001.md',
    createdAt: null,
    ...over,
  };
}

/** Semina owner, portale studente, uno studente approvato, programma e proiezione. */
async function seed(publicLesson: Record<string, unknown> | null = projection()) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'settings/owner'), { ownerUid: OWNER_UID });
    await setDoc(doc(db, 'settings/ownerPublic'), { ownerUid: OWNER_UID });
    await setDoc(doc(db, 'settings/studentAccess'), {
      ownerUid: OWNER_UID,
      studentPortalEnabled: true,
      newStudentRequestsEnabled: false,
    });
    await setDoc(doc(db, 'students', STUDENT_UID), {
      uid: STUDENT_UID,
      ownerUid: OWNER_UID,
      email: 'student@example.com',
      displayName: null,
      status: 'approved',
      classId: 'class-a',
    });
    await setDoc(doc(db, 'programs/p1'), {
      ownerUid: OWNER_UID,
      title: 'Informatica',
      activeImportId: 'i1',
      classIds: ['class-a'],
      createdAt: null,
      updatedAt: null,
    });
    if (publicLesson) await setDoc(doc(db, 'publicLessons/l1'), publicLesson);
  });
}

describe('publicLessons.conceptMapMarkdown — invariante di visibilità', () => {
  it('il docente può scrivere la mappa su una proiezione svolta', async () => {
    await seed(projection({ completed: true }));

    await assertSucceeds(
      updateDoc(doc(ownerDb(), 'publicLessons/l1'), { conceptMapMarkdown: MAP }),
    );
  });

  it('il docente NON può scrivere la mappa su una proiezione non svolta', async () => {
    await seed(projection({ completed: false }));

    await assertFails(updateDoc(doc(ownerDb(), 'publicLessons/l1'), { conceptMapMarkdown: MAP }));
  });

  it('il docente NON può scrivere la mappa su una proiezione senza campo completed', async () => {
    // Legacy: assenza di `completed` significa «non svolta», non «ignora il
    // vincolo».
    await seed(projection());

    await assertFails(updateDoc(doc(ownerDb(), 'publicLessons/l1'), { conceptMapMarkdown: MAP }));
  });

  it('il docente NON può conservare la mappa smarcando la lezione', async () => {
    await seed(projection({ completed: true, conceptMapMarkdown: MAP }));

    // Porta `completed` a false lasciando il campo: è esattamente lo stato che
    // renderebbe la mappa leggibile a uno studente su una lezione non svolta.
    await assertFails(updateDoc(doc(ownerDb(), 'publicLessons/l1'), { completed: false }));
  });

  it('il docente può smarcare la lezione rimuovendo la mappa nello stesso update', async () => {
    await seed(projection({ completed: true, conceptMapMarkdown: MAP }));

    await assertSucceeds(
      setDoc(doc(ownerDb(), 'publicLessons/l1'), projection({ completed: false })),
    );
  });

  it('la creazione di una proiezione non svolta con la mappa è negata', async () => {
    await seed(null);

    await assertFails(
      setDoc(doc(ownerDb(), 'publicLessons/l1'), projection({ conceptMapMarkdown: MAP })),
    );
    await assertSucceeds(
      setDoc(
        doc(ownerDb(), 'publicLessons/l1'),
        projection({ completed: true, conceptMapMarkdown: MAP }),
      ),
    );
  });
});

describe('publicLessons.conceptMapMarkdown — forma del valore', () => {
  it('rifiuta stringa vuota, tipo errato e superamento del tetto', async () => {
    await seed(projection({ completed: true }));

    await assertFails(updateDoc(doc(ownerDb(), 'publicLessons/l1'), { conceptMapMarkdown: '' }));
    await assertFails(updateDoc(doc(ownerDb(), 'publicLessons/l1'), { conceptMapMarkdown: 42 }));
    await assertFails(
      updateDoc(doc(ownerDb(), 'publicLessons/l1'), { conceptMapMarkdown: ['- voce'] }),
    );
    await assertFails(
      updateDoc(doc(ownerDb(), 'publicLessons/l1'), {
        conceptMapMarkdown: 'x'.repeat(32_001),
      }),
    );
  });

  it('accetta un valore esattamente al tetto in caratteri', async () => {
    await seed(projection({ completed: true }));

    await assertSucceeds(
      updateDoc(doc(ownerDb(), 'publicLessons/l1'), { conceptMapMarkdown: 'x'.repeat(32_000) }),
    );
  });

  it('una proiezione legacy senza il campo resta scrivibile', async () => {
    await seed(projection({ completed: true }));

    await assertSucceeds(updateDoc(doc(ownerDb(), 'publicLessons/l1'), { completed: false }));
  });
});

describe('publicLessons.conceptMapMarkdown — chi non è il docente', () => {
  it('lo studente della classe legge la proiezione ma non può scrivere la mappa', async () => {
    await seed(projection({ completed: true, conceptMapMarkdown: MAP }));

    await assertSucceeds(getDoc(doc(studentDb(), 'publicLessons/l1')));
    await assertFails(
      updateDoc(doc(studentDb(), 'publicLessons/l1'), { conceptMapMarkdown: 'mia mappa' }),
    );
  });

  it('un altro utente autenticato non può scriverla né leggerla', async () => {
    await seed(projection({ completed: true, conceptMapMarkdown: MAP }));

    await assertFails(getDoc(doc(otherDb(), 'publicLessons/l1')));
    await assertFails(
      updateDoc(doc(otherDb(), 'publicLessons/l1'), { conceptMapMarkdown: 'mia mappa' }),
    );
  });

  it('un anonimo non può scriverla né leggerla', async () => {
    await seed(projection({ completed: true, conceptMapMarkdown: MAP }));

    await assertFails(getDoc(doc(anonDb(), 'publicLessons/l1')));
    await assertFails(
      updateDoc(doc(anonDb(), 'publicLessons/l1'), { conceptMapMarkdown: 'mia mappa' }),
    );
  });
});

describe('nessuna regressione sulle publicLessons ordinarie', () => {
  it('il docente aggiorna una proiezione senza mappa come prima', async () => {
    await seed(projection());

    await assertSucceeds(
      updateDoc(doc(ownerDb(), 'publicLessons/l1'), { completed: true, titolo: 'Le reti' }),
    );
  });

  it('lo studente della classe continua a leggere la proiezione attiva', async () => {
    await seed(projection({ completed: true }));

    await assertSucceeds(getDoc(doc(studentDb(), 'publicLessons/l1')));
  });

  it('il docente può eliminare la proiezione', async () => {
    await seed(projection({ completed: true, conceptMapMarkdown: MAP }));

    const { deleteDoc } = await import('firebase/firestore');
    await assertSucceeds(deleteDoc(doc(ownerDb(), 'publicLessons/l1')));
  });
});
