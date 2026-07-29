// @vitest-environment node
/**
 * FORCE-SUBMIT-02 — chiusura programmata con preavviso di 60 secondi.
 *
 * I marcatori `forceCloseRequestId` / `forceCloseDeadline` /
 * `forceCloseRequestedAt` sono scritti **solo** dalla callable
 * `scheduleForceCloseSubmissions` con l'Admin SDK, che bypassa le Rules.
 * Questi test dimostrano che il perimetro client resta fail-closed grazie ai
 * key-set chiusi **già presenti** (nessuna modifica alle Rules è stata
 * necessaria):
 *
 *  - lo studente **legge** la propria richiesta mentre la consegna è in bozza;
 *  - un altro studente e un client anonimo non la leggono;
 *  - il client non può creare, modificare né rimuovere i campi server-only;
 *  - durante il preavviso il normale salvataggio è ammesso e **conserva** i
 *    marcatori;
 *  - durante il preavviso la consegna normale resta possibile;
 *  - dopo la chiusura ogni scrittura dello studente è negata;
 *  - nessuna regressione su FORCE-SUBMIT-01.
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
import {
  deleteField,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
} from 'firebase/firestore';
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
    projectId: 'demo-schoolforge-force-submit-02',
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

const REQUEST_ID = 'abcdefghijklmnopqrstuvwx';
const DEADLINE = Timestamp.fromMillis(1_800_000_060_000);

/** Bozza con la chiusura già programmata, come la scrive la callable (Admin). */
async function seedScheduledDraft(over: Record<string, unknown> = {}) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(
      doc(ctx.firestore(), 'submissions', SUBMISSION_ID),
      draftPayload({
        forceCloseRequestId: REQUEST_ID,
        forceCloseDeadline: DEADLINE,
        forceCloseRequestedAt: Timestamp.fromMillis(1_800_000_000_000),
        ...over,
      }),
    );
  });
}

describe('FORCE-SUBMIT-02 — lettura della propria richiesta', () => {
  it('lo studente legge la propria chiusura programmata mentre è in bozza', async () => {
    await seed();
    await seedScheduledDraft();

    const snap = await assertSucceeds(getDoc(doc(studentDb(), 'submissions', SUBMISSION_ID)));
    expect(snap.data()?.forceCloseRequestId).toBe(REQUEST_ID);
    expect((snap.data()?.forceCloseDeadline as Timestamp).toMillis()).toBe(DEADLINE.toMillis());
  });

  it('un altro studente non legge la richiesta altrui', async () => {
    await seed();
    await seedScheduledDraft();
    await assertFails(getDoc(doc(studentDb(OTHER_STUDENT_UID), 'submissions', SUBMISSION_ID)));
  });

  it('nessun accesso anonimo alla richiesta', async () => {
    await seed();
    await seedScheduledDraft();
    await assertFails(getDoc(doc(anonDb(), 'submissions', SUBMISSION_ID)));
  });

  it('il docente proprietario la legge', async () => {
    await seed();
    await seedScheduledDraft();
    const snap = await assertSucceeds(getDoc(doc(ownerDb(), 'submissions', SUBMISSION_ID)));
    expect(snap.data()?.forceCloseRequestId).toBe(REQUEST_ID);
  });
});

describe('FORCE-SUBMIT-02 — i marcatori sono server-only', () => {
  it('lo studente non può crearli su una bozza', async () => {
    await seed();
    await seedDraft();
    for (const patch of [
      { forceCloseRequestId: REQUEST_ID },
      { forceCloseDeadline: DEADLINE },
      { forceCloseRequestedAt: DEADLINE },
      { forceCloseRequestId: REQUEST_ID, forceCloseDeadline: DEADLINE },
    ]) {
      await assertFails(
        updateDoc(doc(studentDb(), 'submissions', SUBMISSION_ID), {
          lastSavedAt: serverTimestamp(),
          ...patch,
        }),
      );
    }
  });

  it('lo studente non può modificarli né spostare la scadenza', async () => {
    await seed();
    await seedScheduledDraft();
    for (const patch of [
      { forceCloseRequestId: 'z'.repeat(24) },
      { forceCloseDeadline: Timestamp.fromMillis(9_000_000_000_000) },
      { forceCloseRequestedAt: Timestamp.fromMillis(1) },
    ]) {
      await assertFails(
        updateDoc(doc(studentDb(), 'submissions', SUBMISSION_ID), {
          lastSavedAt: serverTimestamp(),
          ...patch,
        }),
      );
    }
  });

  it('lo studente non può rimuoverli per sottrarsi alla chiusura', async () => {
    await seed();
    await seedScheduledDraft();
    await assertFails(
      updateDoc(doc(studentDb(), 'submissions', SUBMISSION_ID), {
        lastSavedAt: serverTimestamp(),
        forceCloseRequestId: deleteField(),
        forceCloseDeadline: deleteField(),
      }),
    );
  });

  it('lo studente non può creare una bozza che nasce già programmata', async () => {
    await seed();
    await assertFails(
      setDoc(
        doc(studentDb(), 'submissions', SUBMISSION_ID),
        draftPayload({
          lastSavedAt: serverTimestamp(),
          forceCloseRequestId: REQUEST_ID,
          forceCloseDeadline: DEADLINE,
        }),
      ),
    );
  });

  it('nemmeno il docente può scriverli con una scrittura diretta', async () => {
    await seed();
    await seedDraft();
    await assertFails(
      updateDoc(doc(ownerDb(), 'submissions', SUBMISSION_ID), {
        forceCloseRequestId: REQUEST_ID,
        forceCloseDeadline: DEADLINE,
      }),
    );
  });
});

describe('FORCE-SUBMIT-02 — durante il preavviso lo studente lavora normalmente', () => {
  it('il salvataggio della bozza è ammesso e conserva i marcatori', async () => {
    await seed();
    await seedScheduledDraft();

    await assertSucceeds(
      updateDoc(doc(studentDb(), 'submissions', SUBMISSION_ID), {
        answers: { '0': 'risposta durante il preavviso' },
        lastSavedAt: serverTimestamp(),
      }),
    );

    const snap = await assertSucceeds(getDoc(doc(studentDb(), 'submissions', SUBMISSION_ID)));
    expect(snap.data()?.forceCloseRequestId).toBe(REQUEST_ID);
    expect((snap.data()?.forceCloseDeadline as Timestamp).toMillis()).toBe(DEADLINE.toMillis());
    expect(snap.data()?.answers).toEqual({ '0': 'risposta durante il preavviso' });
  });

  it('la consegna normale resta possibile durante il preavviso', async () => {
    await seed();
    await seedScheduledDraft();

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
    // Consegna normale: nessun marcatore di chiusura forzata.
    expect('forcedByTeacher' in (receipt.data() ?? {})).toBe(false);
  });

  it('la consegna normale non può ripulire i marcatori nello stesso commit', async () => {
    await seed();
    await seedScheduledDraft();

    const db = studentDb();
    const batch = writeBatch(db);
    const now = serverTimestamp();
    batch.update(doc(db, 'submissions', SUBMISSION_ID), {
      status: 'submitted',
      deliveryCode: 'SF-2026-BBBB',
      lastSavedAt: now,
      submittedAt: now,
      forceCloseRequestId: deleteField(),
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
    await assertFails(batch.commit());
  });
});

describe('FORCE-SUBMIT-02 — dopo la chiusura', () => {
  /** Stato prodotto dalla task: consegnata, marcata, senza marcatori residui. */
  async function seedClosedByTask() {
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

  it('ogni scrittura dello studente è negata', async () => {
    await seed();
    await seedClosedByTask();
    const ref = doc(studentDb(), 'submissions', SUBMISSION_ID);
    await assertFails(
      updateDoc(ref, { answers: { '0': 'tardiva' }, lastSavedAt: serverTimestamp() }),
    );
    await assertFails(updateDoc(ref, { status: 'draft', lastSavedAt: serverTimestamp() }));
    await assertFails(
      updateDoc(ref, { forceCloseRequestId: REQUEST_ID, lastSavedAt: serverTimestamp() }),
    );
  });

  it('lo studente legge la propria ricevuta acquisita', async () => {
    await seed();
    await seedClosedByTask();
    const snap = await assertSucceeds(
      getDoc(doc(studentDb(), 'submissionReceipts', SUBMISSION_ID)),
    );
    expect(snap.data()?.forcedByTeacher).toBe(true);
  });

  it('un altro studente e un anonimo non leggono nulla', async () => {
    await seed();
    await seedClosedByTask();
    await assertFails(
      getDoc(doc(studentDb(OTHER_STUDENT_UID), 'submissionReceipts', SUBMISSION_ID)),
    );
    await assertFails(getDoc(doc(anonDb(), 'submissionReceipts', SUBMISSION_ID)));
  });
});
