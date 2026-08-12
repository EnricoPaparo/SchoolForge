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
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import { afterAll, afterEach, beforeAll, beforeEach, describe, it } from 'vitest';

/**
 * VDIF-02 — Rules dell'assegnazione privata studente → etichetta.
 *
 * Che cosa queste regole garantiscono davvero, e che perciò va verificato qui:
 *
 * - **owner-only in ogni direzione**: lo studente non legge la propria
 *   assegnazione, e nemmeno la scrive. È il punto per cui l'assegnazione non sta
 *   su `students/{uid}`: là lo studente legge il documento intero;
 * - **identità dal path**: `studentUid` deve coincidere con l'id, quindi
 *   «una sola etichetta per studente» non dipende da una query;
 * - **forma chiusa** a cinque chiavi, timestamp del server, immutabilità di
 *   identità, ownership e `createdAt`;
 * - **integrità referenziale**: l'etichetta puntata deve esistere ed essere
 *   dello stesso docente, e lo studente deve esistere **alla fine del commit**.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIRESTORE_RULES = resolve(__dirname, '../../../../firestore.rules');

const OWNER_UID = 'owner-uid';
const OTHER_UID = 'other-owner-uid';
const STUDENT_UID = 'student-uid';
const OTHER_STUDENT_UID = 'student-2';
const LABEL_ID = 'label-1';
const OTHER_LABEL_ID = 'label-2';

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-schoolforge-vdif-02-assignments',
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

async function seedWorld() {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'settings/owner'), { ownerUid: OWNER_UID });
    await setDoc(doc(db, 'settings/ownerPublic'), { ownerUid: OWNER_UID });
    await setDoc(doc(db, 'settings/studentAccess'), {
      ownerUid: OWNER_UID,
      studentPortalEnabled: true,
      newStudentRequestsEnabled: false,
    });
    for (const uid of [STUDENT_UID, OTHER_STUDENT_UID]) {
      await setDoc(doc(db, 'students', uid), {
        uid,
        ownerUid: OWNER_UID,
        email: `${uid}@test.com`,
        displayName: uid,
        status: 'approved',
        classId: 'class-1',
      });
    }
    for (const labelId of [LABEL_ID, OTHER_LABEL_ID]) {
      await setDoc(doc(db, 'differentiationLabels', labelId), {
        labelId,
        ownerUid: OWNER_UID,
        name: labelId,
        nameKey: labelId,
        assignedCount: 0,
        draftUsageCount: 0,
        createdAt: new Date('2026-08-01'),
        updatedAt: new Date('2026-08-01'),
      });
    }
  });
}

async function seedAssignment(over: Record<string, unknown> = {}) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'studentLabelAssignments', STUDENT_UID), {
      studentUid: STUDENT_UID,
      ownerUid: OWNER_UID,
      labelId: LABEL_ID,
      createdAt: new Date('2026-08-01'),
      updatedAt: new Date('2026-08-01'),
      ...over,
    });
  });
}

const validAssignment = (over: Record<string, unknown> = {}) => ({
  studentUid: STUDENT_UID,
  ownerUid: OWNER_UID,
  labelId: LABEL_ID,
  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp(),
  ...over,
});

// Ogni test parte da un mondo completo: owner, due studenti, due etichette.
// L'integrità referenziale delle Rules dipende da questi documenti, quindi
// seminarli è parte del setup, non un dettaglio del singolo test.
beforeEach(seedWorld);

describe('Rules — studentLabelAssignments: owner-only in ogni direzione (VDIF-02)', () => {
  it('l’owner crea un’assegnazione valida', async () => {
    await assertSucceeds(
      setDoc(doc(ownerDb(), 'studentLabelAssignments', STUDENT_UID), validAssignment()),
    );
  });

  it('l’owner rilegge e interroga le proprie assegnazioni filtrando su ownerUid', async () => {
    await seedAssignment();
    await assertSucceeds(getDoc(doc(ownerDb(), 'studentLabelAssignments', STUDENT_UID)));
    await assertSucceeds(
      getDocs(
        query(collection(ownerDb(), 'studentLabelAssignments'), where('ownerUid', '==', OWNER_UID)),
      ),
    );
  });

  it('una query senza il filtro su ownerUid è negata: la Rule non è dimostrabile', async () => {
    await seedAssignment();
    await assertFails(getDocs(collection(ownerDb(), 'studentLabelAssignments')));
  });

  it('lo studente NON legge la propria assegnazione', async () => {
    await seedAssignment();
    await assertFails(getDoc(doc(studentDb(), 'studentLabelAssignments', STUDENT_UID)));
  });

  it('lo studente NON scrive né elimina la propria assegnazione', async () => {
    await seedAssignment();
    await assertFails(
      setDoc(doc(studentDb(), 'studentLabelAssignments', STUDENT_UID), validAssignment()),
    );
    await assertFails(
      updateDoc(doc(studentDb(), 'studentLabelAssignments', STUDENT_UID), {
        labelId: OTHER_LABEL_ID,
        updatedAt: serverTimestamp(),
      }),
    );
    await assertFails(deleteDoc(doc(studentDb(), 'studentLabelAssignments', STUDENT_UID)));
  });

  it('un altro utente autenticato non legge né scrive nulla', async () => {
    await seedAssignment();
    await assertFails(getDoc(doc(otherDb(), 'studentLabelAssignments', STUDENT_UID)));
    await assertFails(
      setDoc(doc(otherDb(), 'studentLabelAssignments', OTHER_STUDENT_UID), {
        ...validAssignment(),
        studentUid: OTHER_STUDENT_UID,
        ownerUid: OTHER_UID,
      }),
    );
    await assertFails(deleteDoc(doc(otherDb(), 'studentLabelAssignments', STUDENT_UID)));
  });

  it('un anonimo non legge né scrive nulla', async () => {
    await seedAssignment();
    await assertFails(getDoc(doc(anonDb(), 'studentLabelAssignments', STUDENT_UID)));
    await assertFails(
      setDoc(doc(anonDb(), 'studentLabelAssignments', STUDENT_UID), validAssignment()),
    );
    await assertFails(deleteDoc(doc(anonDb(), 'studentLabelAssignments', STUDENT_UID)));
  });
});

describe('Rules — studentLabelAssignments: forma chiusa e identità (VDIF-02)', () => {
  it('rifiuta una chiave in più', async () => {
    await assertFails(
      setDoc(
        doc(ownerDb(), 'studentLabelAssignments', STUDENT_UID),
        validAssignment({ note: 'x' }),
      ),
    );
  });

  it('rifiuta una chiave in meno', async () => {
    await assertFails(
      setDoc(doc(ownerDb(), 'studentLabelAssignments', STUDENT_UID), {
        studentUid: STUDENT_UID,
        ownerUid: OWNER_UID,
        labelId: LABEL_ID,
        updatedAt: serverTimestamp(),
      }),
    );
  });

  it('rifiuta un studentUid diverso dall’id del documento', async () => {
    await assertFails(
      setDoc(
        doc(ownerDb(), 'studentLabelAssignments', STUDENT_UID),
        validAssignment({ studentUid: OTHER_STUDENT_UID }),
      ),
    );
  });

  it('rifiuta un ownerUid diverso dal chiamante', async () => {
    await assertFails(
      setDoc(
        doc(ownerDb(), 'studentLabelAssignments', STUDENT_UID),
        validAssignment({ ownerUid: OTHER_UID }),
      ),
    );
  });

  it('rifiuta un labelId vuoto o non stringa', async () => {
    await assertFails(
      setDoc(
        doc(ownerDb(), 'studentLabelAssignments', STUDENT_UID),
        validAssignment({ labelId: '' }),
      ),
    );
    await assertFails(
      setDoc(
        doc(ownerDb(), 'studentLabelAssignments', STUDENT_UID),
        validAssignment({ labelId: 7 }),
      ),
    );
  });

  it('rifiuta timestamp che non siano quelli del server', async () => {
    await assertFails(
      setDoc(
        doc(ownerDb(), 'studentLabelAssignments', STUDENT_UID),
        validAssignment({ updatedAt: new Date('2020-01-01') }),
      ),
    );
    await assertFails(
      setDoc(
        doc(ownerDb(), 'studentLabelAssignments', STUDENT_UID),
        validAssignment({ createdAt: new Date('2020-01-01') }),
      ),
    );
  });
});

describe('Rules — studentLabelAssignments: immutabilità e cambio etichetta (VDIF-02)', () => {
  it('il cambio A→B muove solo labelId e updatedAt', async () => {
    await seedAssignment();
    await assertSucceeds(
      updateDoc(doc(ownerDb(), 'studentLabelAssignments', STUDENT_UID), {
        labelId: OTHER_LABEL_ID,
        updatedAt: serverTimestamp(),
      }),
    );
  });

  it('rifiuta un update che non aggiorna updatedAt al tempo del server', async () => {
    await seedAssignment();
    await assertFails(
      updateDoc(doc(ownerDb(), 'studentLabelAssignments', STUDENT_UID), {
        labelId: OTHER_LABEL_ID,
      }),
    );
  });

  it('rifiuta la riscrittura di createdAt, studentUid e ownerUid', async () => {
    await seedAssignment();
    for (const patch of [
      { createdAt: serverTimestamp() },
      { studentUid: OTHER_STUDENT_UID },
      { ownerUid: OTHER_UID },
    ]) {
      await assertFails(
        updateDoc(doc(ownerDb(), 'studentLabelAssignments', STUDENT_UID), {
          ...patch,
          updatedAt: serverTimestamp(),
        }),
      );
    }
  });

  it('l’owner elimina l’assegnazione', async () => {
    await seedAssignment();
    await assertSucceeds(deleteDoc(doc(ownerDb(), 'studentLabelAssignments', STUDENT_UID)));
  });
});

describe('Rules — studentLabelAssignments: integrità referenziale (VDIF-02)', () => {
  it('rifiuta un’assegnazione verso un’etichetta inesistente', async () => {
    await assertFails(
      setDoc(
        doc(ownerDb(), 'studentLabelAssignments', STUDENT_UID),
        validAssignment({ labelId: 'label-che-non-esiste' }),
      ),
    );
  });

  it('rifiuta un’assegnazione verso un’etichetta di un altro docente', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'differentiationLabels', 'label-altrui'), {
        labelId: 'label-altrui',
        ownerUid: OTHER_UID,
        name: 'Altrui',
        nameKey: 'altrui',
        assignedCount: 0,
        draftUsageCount: 0,
        createdAt: new Date('2026-08-01'),
        updatedAt: new Date('2026-08-01'),
      });
    });
    await assertFails(
      setDoc(
        doc(ownerDb(), 'studentLabelAssignments', STUDENT_UID),
        validAssignment({ labelId: 'label-altrui' }),
      ),
    );
  });

  it('rifiuta un’assegnazione verso uno studente inesistente', async () => {
    await assertFails(
      setDoc(doc(ownerDb(), 'studentLabelAssignments', 'fantasma'), {
        ...validAssignment(),
        studentUid: 'fantasma',
      }),
    );
  });

  it('rifiuta un’assegnazione verso uno studente di un altro docente', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'students', 'studente-altrui'), {
        uid: 'studente-altrui',
        ownerUid: OTHER_UID,
        email: 'x@test.com',
        displayName: 'X',
        status: 'approved',
        classId: null,
      });
    });
    await assertFails(
      setDoc(doc(ownerDb(), 'studentLabelAssignments', 'studente-altrui'), {
        ...validAssignment(),
        studentUid: 'studente-altrui',
      }),
    );
  });

  /**
   * `existsAfter` e non `exists`: un commit che assegna un'etichetta e nello
   * stesso istante rimuove lo studente lascerebbe un'assegnazione orfana, e con
   * `exists` passerebbe.
   */
  it('rifiuta un commit che crea l’assegnazione e rimuove lo studente insieme', async () => {
    const db = ownerDb();
    const batch = writeBatch(db);
    batch.set(doc(db, 'studentLabelAssignments', STUDENT_UID), validAssignment());
    batch.delete(doc(db, 'students', STUDENT_UID));
    await assertFails(batch.commit());
  });

  it('rifiuta create assegnazione + delete etichetta nello stesso commit', async () => {
    const db = ownerDb();
    const batch = writeBatch(db);
    batch.set(doc(db, 'studentLabelAssignments', STUDENT_UID), validAssignment());
    batch.delete(doc(db, 'differentiationLabels', LABEL_ID));
    await assertFails(batch.commit());
  });

  it('rifiuta cambio A→B + delete B nello stesso commit', async () => {
    await seedAssignment();
    const db = ownerDb();
    const batch = writeBatch(db);
    batch.update(doc(db, 'studentLabelAssignments', STUDENT_UID), {
      labelId: OTHER_LABEL_ID,
      updatedAt: serverTimestamp(),
    });
    batch.delete(doc(db, 'differentiationLabels', OTHER_LABEL_ID));
    await assertFails(batch.commit());
  });

  it('consente assegnazione e aggiornamento coerente del contatore nello stesso commit', async () => {
    const db = ownerDb();
    const batch = writeBatch(db);
    batch.set(doc(db, 'studentLabelAssignments', STUDENT_UID), validAssignment());
    batch.update(doc(db, 'differentiationLabels', LABEL_ID), {
      assignedCount: 1,
      updatedAt: serverTimestamp(),
    });
    await assertSucceeds(batch.commit());
  });

  /**
   * È l'operazione inversa, e deve **riuscire**: è esattamente la transazione
   * con cui il service rimuove uno studente insieme alla sua assegnazione.
   */
  it('consente un commit che elimina insieme assegnazione e studente', async () => {
    await seedAssignment();
    const db = ownerDb();
    const batch = writeBatch(db);
    batch.delete(doc(db, 'studentLabelAssignments', STUDENT_UID));
    batch.delete(doc(db, 'students', STUDENT_UID));
    await assertSucceeds(batch.commit());
  });
});

describe('Rules — differentiationLabels: difesa a livello di Rules sulla delete (VDIF-02)', () => {
  it('un’etichetta con assignedCount > 0 non è eliminabile nemmeno aggirando il service', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'differentiationLabels', LABEL_ID), {
        labelId: LABEL_ID,
        ownerUid: OWNER_UID,
        name: LABEL_ID,
        nameKey: LABEL_ID,
        assignedCount: 1,
        draftUsageCount: 0,
        createdAt: new Date('2026-08-01'),
        updatedAt: new Date('2026-08-01'),
      });
    });
    await assertFails(deleteDoc(doc(ownerDb(), 'differentiationLabels', LABEL_ID)));
  });
});
