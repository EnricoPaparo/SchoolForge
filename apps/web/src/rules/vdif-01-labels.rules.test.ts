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
} from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import { afterAll, afterEach, beforeAll, describe, it } from 'vitest';

/**
 * VDIF-01 — Rules del registro etichette e delle prenotazioni del nome.
 *
 * Il perimetro che queste regole garantiscono davvero: ownership, forma chiusa,
 * tipi, non-negatività dei contatori, immutabilità dell'identità e movimento di
 * **una sola unità** per scrittura. CEL non calcola SHA-256 e non normalizza
 * Unicode, quindi la coerenza fra `name`, `nameKey` e id della prenotazione
 * resta responsabilità del service owner-only — ed è dichiarata come tale.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIRESTORE_RULES = resolve(__dirname, '../../../../firestore.rules');

const OWNER_UID = 'owner-uid';
const OTHER_UID = 'other-owner-uid';
const STUDENT_UID = 'student-uid';
const LABEL_ID = 'label-1';
const RESERVATION_ID = 'a'.repeat(64);

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-schoolforge-vdif-01-labels',
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
    await setDoc(doc(db, 'settings/studentAccess'), {
      ownerUid: OWNER_UID,
      studentPortalEnabled: true,
      newStudentRequestsEnabled: false,
    });
    await setDoc(doc(db, 'students', STUDENT_UID), {
      uid: STUDENT_UID,
      ownerUid: OWNER_UID,
      email: 's@test.com',
      displayName: 'Studente',
      status: 'approved',
      classId: 'class-1',
    });
  });
}

async function seedLabel(over: Record<string, unknown> = {}) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'differentiationLabels', LABEL_ID), {
      labelId: LABEL_ID,
      ownerUid: OWNER_UID,
      name: 'Percorso A',
      nameKey: 'percorso a',
      assignedCount: 0,
      draftUsageCount: 0,
      createdAt: new Date('2026-08-01'),
      updatedAt: new Date('2026-08-01'),
      ...over,
    });
  });
}

async function seedReservation(over: Record<string, unknown> = {}) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'differentiationLabelNames', RESERVATION_ID), {
      ownerUid: OWNER_UID,
      labelId: LABEL_ID,
      nameKey: 'percorso a',
      createdAt: new Date('2026-08-01'),
      ...over,
    });
  });
}

const validLabel = (over: Record<string, unknown> = {}) => ({
  labelId: LABEL_ID,
  ownerUid: OWNER_UID,
  name: 'Percorso A',
  nameKey: 'percorso a',
  assignedCount: 0,
  draftUsageCount: 0,
  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp(),
  ...over,
});

const validReservation = (over: Record<string, unknown> = {}) => ({
  ownerUid: OWNER_UID,
  labelId: LABEL_ID,
  nameKey: 'percorso a',
  createdAt: serverTimestamp(),
  ...over,
});

describe('Firestore rules — differentiationLabels (VDIF-01)', () => {
  it('l’owner crea un documento valido', async () => {
    await seedOwner();
    await assertSucceeds(setDoc(doc(ownerDb(), 'differentiationLabels', LABEL_ID), validLabel()));
  });

  it('l’owner legge, aggiorna ed elimina i propri documenti', async () => {
    await seedOwner();
    await seedLabel();
    const db = ownerDb();
    await assertSucceeds(getDoc(doc(db, 'differentiationLabels', LABEL_ID)));
    await assertSucceeds(
      updateDoc(doc(db, 'differentiationLabels', LABEL_ID), {
        name: 'Percorso B',
        nameKey: 'percorso b',
        updatedAt: serverTimestamp(),
      }),
    );
    await assertSucceeds(deleteDoc(doc(db, 'differentiationLabels', LABEL_ID)));
  });

  it('la query filtrata su ownerUid è consentita', async () => {
    await seedOwner();
    await seedLabel();
    await assertSucceeds(
      getDocs(
        query(collection(ownerDb(), 'differentiationLabels'), where('ownerUid', '==', OWNER_UID)),
      ),
    );
  });

  it('una query senza il filtro ownerUid è negata', async () => {
    await seedOwner();
    await seedLabel();
    await assertFails(getDocs(collection(ownerDb(), 'differentiationLabels')));
  });

  it('una query filtrata sull’owner sbagliato è negata', async () => {
    await seedOwner();
    await seedLabel();
    await assertFails(
      getDocs(
        query(collection(ownerDb(), 'differentiationLabels'), where('ownerUid', '==', OTHER_UID)),
      ),
    );
  });

  it('lo studente è sempre negato: lettura, query e scrittura', async () => {
    await seedOwner();
    await seedLabel();
    const db = studentDb();
    await assertFails(getDoc(doc(db, 'differentiationLabels', LABEL_ID)));
    await assertFails(
      getDocs(query(collection(db, 'differentiationLabels'), where('ownerUid', '==', STUDENT_UID))),
    );
    await assertFails(
      setDoc(doc(db, 'differentiationLabels', 'x'), validLabel({ ownerUid: STUDENT_UID })),
    );
    await assertFails(deleteDoc(doc(db, 'differentiationLabels', LABEL_ID)));
  });

  it('un altro utente autenticato non-owner è sempre negato', async () => {
    await seedOwner();
    await seedLabel();
    const db = otherDb();
    await assertFails(getDoc(doc(db, 'differentiationLabels', LABEL_ID)));
    await assertFails(deleteDoc(doc(db, 'differentiationLabels', LABEL_ID)));
  });

  it('l’anonimo è sempre negato', async () => {
    await seedOwner();
    await seedLabel();
    const db = anonDb();
    await assertFails(getDoc(doc(db, 'differentiationLabels', LABEL_ID)));
    await assertFails(setDoc(doc(db, 'differentiationLabels', 'x'), validLabel()));
  });

  it('una chiave in più è negata', async () => {
    await seedOwner();
    await assertFails(
      setDoc(doc(ownerDb(), 'differentiationLabels', LABEL_ID), validLabel({ color: 'rosso' })),
    );
  });

  it('una chiave mancante è negata', async () => {
    await seedOwner();
    const incomplete = validLabel();
    delete (incomplete as Record<string, unknown>).draftUsageCount;
    await assertFails(setDoc(doc(ownerDb(), 'differentiationLabels', LABEL_ID), incomplete));
  });

  it('labelId diverso dal document id è negato', async () => {
    await seedOwner();
    await assertFails(
      setDoc(
        doc(ownerDb(), 'differentiationLabels', LABEL_ID),
        validLabel({ labelId: 'altro-id' }),
      ),
    );
  });

  it('ownerUid diverso dall’utente autenticato è negato', async () => {
    await seedOwner();
    await assertFails(
      setDoc(
        doc(ownerDb(), 'differentiationLabels', LABEL_ID),
        validLabel({ ownerUid: OTHER_UID }),
      ),
    );
  });

  it('la creazione con contatori diversi da zero è negata', async () => {
    await seedOwner();
    await assertFails(
      setDoc(doc(ownerDb(), 'differentiationLabels', LABEL_ID), validLabel({ assignedCount: 1 })),
    );
    await assertFails(
      setDoc(doc(ownerDb(), 'differentiationLabels', LABEL_ID), validLabel({ draftUsageCount: 2 })),
    );
  });

  it('contatori non interi o negativi sono negati', async () => {
    await seedOwner();
    for (const bad of [-1, 1.5, '0', null]) {
      await assertFails(
        setDoc(
          doc(ownerDb(), 'differentiationLabels', LABEL_ID),
          validLabel({ assignedCount: bad }),
        ),
      );
      await assertFails(
        setDoc(
          doc(ownerDb(), 'differentiationLabels', LABEL_ID),
          validLabel({ draftUsageCount: bad }),
        ),
      );
    }
  });

  it('un nome vuoto o non stringa è negato', async () => {
    await seedOwner();
    await assertFails(
      setDoc(doc(ownerDb(), 'differentiationLabels', LABEL_ID), validLabel({ name: '' })),
    );
    await assertFails(
      setDoc(doc(ownerDb(), 'differentiationLabels', LABEL_ID), validLabel({ nameKey: 42 })),
    );
  });

  it('createdAt e updatedAt devono essere l’orologio del server', async () => {
    await seedOwner();
    await assertFails(
      setDoc(
        doc(ownerDb(), 'differentiationLabels', LABEL_ID),
        validLabel({ createdAt: new Date('2020-01-01') }),
      ),
    );
    await assertFails(
      setDoc(
        doc(ownerDb(), 'differentiationLabels', LABEL_ID),
        validLabel({ updatedAt: new Date('2020-01-01') }),
      ),
    );
  });

  it('labelId, ownerUid e createdAt sono immutabili', async () => {
    await seedOwner();
    await seedLabel();
    const db = ownerDb();
    await assertFails(
      updateDoc(doc(db, 'differentiationLabels', LABEL_ID), {
        labelId: 'altro',
        updatedAt: serverTimestamp(),
      }),
    );
    await assertFails(
      updateDoc(doc(db, 'differentiationLabels', LABEL_ID), {
        ownerUid: OTHER_UID,
        updatedAt: serverTimestamp(),
      }),
    );
    await assertFails(
      updateDoc(doc(db, 'differentiationLabels', LABEL_ID), {
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }),
    );
  });

  it('un contatore può muoversi di una unità, non di più', async () => {
    await seedOwner();
    await seedLabel({ assignedCount: 2, draftUsageCount: 2 });
    const db = ownerDb();
    await assertSucceeds(
      updateDoc(doc(db, 'differentiationLabels', LABEL_ID), {
        assignedCount: 3,
        updatedAt: serverTimestamp(),
      }),
    );
    await assertFails(
      updateDoc(doc(db, 'differentiationLabels', LABEL_ID), {
        draftUsageCount: 9,
        updatedAt: serverTimestamp(),
      }),
    );
  });

  it('un contatore non può scendere sotto zero', async () => {
    await seedOwner();
    await seedLabel();
    await assertFails(
      updateDoc(doc(ownerDb(), 'differentiationLabels', LABEL_ID), {
        assignedCount: -1,
        updatedAt: serverTimestamp(),
      }),
    );
  });
});

describe('Firestore rules — differentiationLabelNames (VDIF-01)', () => {
  it('l’owner crea, legge ed elimina una prenotazione valida', async () => {
    await seedOwner();
    const db = ownerDb();
    await assertSucceeds(
      setDoc(doc(db, 'differentiationLabelNames', RESERVATION_ID), validReservation()),
    );
    await assertSucceeds(getDoc(doc(db, 'differentiationLabelNames', RESERVATION_ID)));
    await assertSucceeds(deleteDoc(doc(db, 'differentiationLabelNames', RESERVATION_ID)));
  });

  it('l’update di una prenotazione è SEMPRE negato', async () => {
    await seedOwner();
    await seedReservation();
    await assertFails(
      updateDoc(doc(ownerDb(), 'differentiationLabelNames', RESERVATION_ID), {
        labelId: 'altra-etichetta',
      }),
    );
  });

  it('chiavi extra o mancanti sono negate', async () => {
    await seedOwner();
    await assertFails(
      setDoc(
        doc(ownerDb(), 'differentiationLabelNames', RESERVATION_ID),
        validReservation({ note: 'x' }),
      ),
    );
    const incomplete = validReservation();
    delete (incomplete as Record<string, unknown>).nameKey;
    await assertFails(
      setDoc(doc(ownerDb(), 'differentiationLabelNames', RESERVATION_ID), incomplete),
    );
  });

  it('ownerUid diverso dall’utente autenticato è negato', async () => {
    await seedOwner();
    await assertFails(
      setDoc(
        doc(ownerDb(), 'differentiationLabelNames', RESERVATION_ID),
        validReservation({ ownerUid: OTHER_UID }),
      ),
    );
  });

  it('createdAt deve essere l’orologio del server', async () => {
    await seedOwner();
    await assertFails(
      setDoc(
        doc(ownerDb(), 'differentiationLabelNames', RESERVATION_ID),
        validReservation({ createdAt: new Date('2020-01-01') }),
      ),
    );
  });

  it('studente, altro utente e anonimo sono sempre negati', async () => {
    await seedOwner();
    await seedReservation();
    for (const db of [studentDb(), otherDb(), anonDb()]) {
      await assertFails(getDoc(doc(db, 'differentiationLabelNames', RESERVATION_ID)));
      await assertFails(deleteDoc(doc(db, 'differentiationLabelNames', RESERVATION_ID)));
      await assertFails(
        setDoc(doc(db, 'differentiationLabelNames', 'b'.repeat(64)), validReservation()),
      );
    }
  });
});
