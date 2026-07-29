// @vitest-environment node
/**
 * FORCE-SUBMIT-01 — chiusura e consegna forzata di una verifica iniziata.
 *
 * La transizione draft → submitted forzata è eseguita **solo** dalla callable
 * `forceSubmitSubmission` con l'Admin SDK, che bypassa le Rules. Questi test
 * dimostrano che il perimetro client resta fail-closed grazie ai key-set chiusi
 * già presenti (nessuna modifica alle Rules è stata necessaria):
 *
 *  - lo studente non può scrivere `forcedByTeacher` (né `true`, né altro);
 *  - dopo la chiusura lo studente non può più modificare la submission;
 *  - un altro studente non può leggere la ricevuta forzata;
 *  - lo studente proprietario può leggere la propria ricevuta forzata;
 *  - nessun accesso anonimo, né alla submission né alla ricevuta;
 *  - la consegna normale (batch atomico submission + receipt) non regredisce.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, serverTimestamp, setDoc, Timestamp, updateDoc } from 'firebase/firestore';
import { writeBatch } from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIRESTORE_RULES = resolve(__dirname, '../../../../firestore.rules');

const OWNER_UID = 'owner-uid';
const STUDENT_UID = 'student-uid';
const OTHER_STUDENT_UID = 'other-student-uid';
const VERIFICATION_ID = 'v1';
const SUBMISSION_ID = `${VERIFICATION_ID}_${STUDENT_UID}`;
const FORCED_CODE = 'SF-2026-QRST';

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-schoolforge-force-submit-01',
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

function studentDb(uid: string = STUDENT_UID) {
  return testEnv.authenticatedContext(uid).firestore() as unknown as Firestore;
}
function ownerDb() {
  return testEnv.authenticatedContext(OWNER_UID).firestore() as unknown as Firestore;
}
function anonDb() {
  return testEnv.unauthenticatedContext().firestore() as unknown as Firestore;
}

async function seed() {
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
        email: `${uid}@example.com`,
        displayName: null,
        status: 'approved',
        classId: 'class-a',
      });
    }
    await setDoc(doc(db, `verifications/${VERIFICATION_ID}`), {
      ownerUid: OWNER_UID,
      status: 'active',
      visibility: 'public',
      onlineEnabled: true,
      config: {
        title: 'Verifica 1',
        classId: 'class-a',
        programId: 'p1',
        importId: 'i1',
        questionRefs: [],
      },
      teacherSnapshot: {
        title: 'Verifica 1',
        classId: 'class-a',
        className: 'Classe A',
        programId: 'p1',
        importId: 'i1',
        questionRefs: [],
        activatedAt: Timestamp.now(),
      },
      activatedAt: Timestamp.now(),
      closedAt: null,
    });
  });
}

function draftPayload(overrides: Record<string, unknown> = {}) {
  return {
    submissionId: SUBMISSION_ID,
    verificationId: VERIFICATION_ID,
    studentUid: STUDENT_UID,
    ownerUid: OWNER_UID,
    status: 'draft',
    answers: {},
    flagged: {},
    attentionEvents: [],
    deliveryCode: null,
    verificationTitle: 'Verifica 1',
    className: 'Classe A',
    startedAt: Timestamp.now(),
    lastSavedAt: Timestamp.now(),
    submittedAt: null,
    ...overrides,
  };
}

async function seedDraft() {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'submissions', SUBMISSION_ID), draftPayload());
  });
}

/**
 * Riproduce esattamente ciò che scrive la callable (Admin SDK): stato chiuso +
 * marcatore `forcedByTeacher: true` sulla submission e sulla ricevuta.
 * `lastSavedAt` resta quello dell'ultimo salvataggio reale dello studente.
 */
const STUDENT_LAST_SAVED = Timestamp.fromMillis(1_700_000_000_000);

async function seedForcedClosed() {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(
      doc(db, 'submissions', SUBMISSION_ID),
      draftPayload({
        status: 'submitted',
        deliveryCode: FORCED_CODE,
        submittedAt: Timestamp.now(),
        lastSavedAt: STUDENT_LAST_SAVED,
        forcedByTeacher: true,
      }),
    );
    await setDoc(doc(db, 'submissionReceipts', SUBMISSION_ID), {
      submissionId: SUBMISSION_ID,
      verificationId: VERIFICATION_ID,
      studentUid: STUDENT_UID,
      ownerUid: OWNER_UID,
      verificationTitle: 'Verifica 1',
      className: 'Classe A',
      deliveryCode: FORCED_CODE,
      submittedAt: Timestamp.now(),
      forcedByTeacher: true,
    });
  });
}

describe('FORCE-SUBMIT-01 — lo studente non può scrivere forcedByTeacher', () => {
  it('nega un autosave che introduce forcedByTeacher: true', async () => {
    await seed();
    await seedDraft();
    await assertFails(
      updateDoc(doc(studentDb(), 'submissions', SUBMISSION_ID), {
        answers: { '0': 'x' },
        lastSavedAt: serverTimestamp(),
        forcedByTeacher: true,
      }),
    );
  });

  it('nega qualunque altro valore del marcatore (false o arbitrario)', async () => {
    await seed();
    await seedDraft();
    for (const value of [false, 'true', 1, null]) {
      await assertFails(
        updateDoc(doc(studentDb(), 'submissions', SUBMISSION_ID), {
          lastSavedAt: serverTimestamp(),
          forcedByTeacher: value,
        }),
      );
    }
  });

  it('nega la creazione di una bozza che nasce già marcata', async () => {
    await seed();
    await assertFails(
      setDoc(
        doc(studentDb(), 'submissions', SUBMISSION_ID),
        draftPayload({ lastSavedAt: serverTimestamp(), forcedByTeacher: true }),
      ),
    );
  });

  it('nega la creazione di una ricevuta marcata dallo studente', async () => {
    await seed();
    await seedDraft();
    const db = studentDb();
    const batch = writeBatch(db);
    const now = serverTimestamp();
    batch.update(doc(db, 'submissions', SUBMISSION_ID), {
      status: 'submitted',
      deliveryCode: 'SF-2026-BBBB',
      lastSavedAt: now,
      submittedAt: now,
    });
    batch.set(doc(db, 'submissionReceipts', SUBMISSION_ID), {
      submissionId: SUBMISSION_ID,
      verificationId: VERIFICATION_ID,
      studentUid: STUDENT_UID,
      ownerUid: OWNER_UID,
      verificationTitle: 'Verifica 1',
      className: 'Classe A',
      deliveryCode: 'SF-2026-BBBB',
      submittedAt: now,
      forcedByTeacher: true,
    });
    await assertFails(batch.commit());
  });
});

describe('FORCE-SUBMIT-01 — dopo la chiusura la consegna è immutabile per lo studente', () => {
  it('nega un autosave successivo alla chiusura forzata', async () => {
    await seed();
    await seedForcedClosed();
    await assertFails(
      updateDoc(doc(studentDb(), 'submissions', SUBMISSION_ID), {
        answers: { '0': 'tardivo' },
        lastSavedAt: serverTimestamp(),
      }),
    );
  });

  it('nega il tentativo di riportare la consegna a draft o di togliere il marcatore', async () => {
    await seed();
    await seedForcedClosed();
    const ref = doc(studentDb(), 'submissions', SUBMISSION_ID);
    await assertFails(updateDoc(ref, { status: 'draft', lastSavedAt: serverTimestamp() }));
    await assertFails(updateDoc(ref, { forcedByTeacher: false, lastSavedAt: serverTimestamp() }));
  });

  it('nega allo studente anche la sola lettura della submission ormai chiusa', async () => {
    await seed();
    await seedForcedClosed();
    await assertFails(getDoc(doc(studentDb(), 'submissions', SUBMISSION_ID)));
  });

  it('nega la modifica della ricevuta forzata da parte dello studente', async () => {
    await seed();
    await seedForcedClosed();
    await assertFails(
      updateDoc(doc(studentDb(), 'submissionReceipts', SUBMISSION_ID), {
        forcedByTeacher: false,
      }),
    );
  });
});

describe('FORCE-SUBMIT-01 — visibilità della ricevuta forzata', () => {
  it('lo studente proprietario legge la propria ricevuta forzata', async () => {
    await seed();
    await seedForcedClosed();
    const snap = await assertSucceeds(
      getDoc(doc(studentDb(), 'submissionReceipts', SUBMISSION_ID)),
    );
    expect(snap.data()?.forcedByTeacher).toBe(true);
    expect(snap.data()?.deliveryCode).toBe(FORCED_CODE);
  });

  it('un altro studente non legge la ricevuta', async () => {
    await seed();
    await seedForcedClosed();
    await assertFails(
      getDoc(doc(studentDb(OTHER_STUDENT_UID), 'submissionReceipts', SUBMISSION_ID)),
    );
  });

  it('il docente proprietario legge submission e ricevuta forzate', async () => {
    await seed();
    await seedForcedClosed();
    const submission = await assertSucceeds(getDoc(doc(ownerDb(), 'submissions', SUBMISSION_ID)));
    expect(submission.data()?.forcedByTeacher).toBe(true);
    // `lastSavedAt` resta l'ultimo salvataggio REALE dello studente.
    expect((submission.data()?.lastSavedAt as Timestamp).toMillis()).toBe(
      STUDENT_LAST_SAVED.toMillis(),
    );
    await assertSucceeds(getDoc(doc(ownerDb(), 'submissionReceipts', SUBMISSION_ID)));
  });

  it('nessun accesso anonimo a submission o ricevuta', async () => {
    await seed();
    await seedForcedClosed();
    await assertFails(getDoc(doc(anonDb(), 'submissions', SUBMISSION_ID)));
    await assertFails(getDoc(doc(anonDb(), 'submissionReceipts', SUBMISSION_ID)));
    await assertFails(
      updateDoc(doc(anonDb(), 'submissions', SUBMISSION_ID), { forcedByTeacher: true }),
    );
  });
});

describe('FORCE-SUBMIT-01 — nessuna regressione sulla consegna normale', () => {
  it('la consegna normale resta possibile e non porta il marcatore', async () => {
    await seed();
    await seedDraft();
    const db = studentDb();
    const batch = writeBatch(db);
    const now = serverTimestamp();
    batch.update(doc(db, 'submissions', SUBMISSION_ID), {
      status: 'submitted',
      answers: {},
      flagged: {},
      deliveryCode: 'SF-2026-BBBB',
      lastSavedAt: now,
      submittedAt: now,
    });
    batch.set(doc(db, 'submissionReceipts', SUBMISSION_ID), {
      submissionId: SUBMISSION_ID,
      verificationId: VERIFICATION_ID,
      studentUid: STUDENT_UID,
      ownerUid: OWNER_UID,
      verificationTitle: 'Verifica 1',
      className: 'Classe A',
      deliveryCode: 'SF-2026-BBBB',
      submittedAt: now,
    });
    await assertSucceeds(batch.commit());

    const receipt = await assertSucceeds(
      getDoc(doc(studentDb(), 'submissionReceipts', SUBMISSION_ID)),
    );
    // Consegna normale: il marcatore è assente, non `false`.
    expect('forcedByTeacher' in (receipt.data() ?? {})).toBe(false);
  });

  it('un autosave normale in bozza continua a funzionare', async () => {
    await seed();
    await seedDraft();
    await assertSucceeds(
      updateDoc(doc(studentDb(), 'submissions', SUBMISSION_ID), {
        answers: { '0': 'risposta' },
        lastSavedAt: serverTimestamp(),
      }),
    );
  });
});
