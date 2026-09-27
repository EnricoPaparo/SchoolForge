import { randomUUID } from 'node:crypto';
import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  finalizeReturnToDraft,
  installReturnToDraftFence,
  returnVerificationToDraftWithDb,
} from './verificationReturnToDraftGateway.js';
import { persistAssignment, persistPdfAssignment } from './verificationVariantGateway.js';
import type { ResolvableSnapshot } from './verificationVariantCore.js';

const OWNER = 'return-draft-owner';
const emulatorDescribe = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;

const oldSnapshot: ResolvableSnapshot = {
  questions: [{ order: 0, tipo: 'aperta', maxPoints: 1, difficolta: 1, testo: 'Versione A' }],
  commonQuestionOrders: [],
  equivalentGroups: [{ id: 'g1', alternativeOrders: [0] }],
  differentiation: null,
  labelAssignments: null,
};

function activationId(value: Timestamp): string {
  return `${value.seconds}:${value.nanoseconds}`;
}

function verification(status: 'active' | 'closed', labelId?: string) {
  const now = Timestamp.now();
  return {
    ownerUid: OWNER,
    status,
    visibility: 'public',
    onlineEnabled: true,
    studentPdfEnabled: true,
    config: {
      title: 'Verifica prova',
      classId: 'class-1',
      programId: 'program-1',
      importId: 'import-1',
      questionRefs: [{ questionIndexEntryId: 'q-1' }],
      ...(labelId
        ? {
            differentiation: {
              version: 1,
              questions: [
                {
                  baseQuestionIndexEntryId: 'q-1',
                  choices: { [labelId]: { kind: 'none' } },
                },
              ],
            },
          }
        : {}),
    },
    teacherSnapshot: { title: 'Verifica prova', questions: [], activatedAt: now },
    createdAt: now,
    updatedAt: now,
    activatedAt: now,
    closedAt: status === 'closed' ? now : null,
  };
}

emulatorDescribe('returnVerificationToDraft — Firestore transaction fence', () => {
  let app: App;
  let db: Firestore;
  const ids: string[] = [];

  beforeAll(() => {
    app = initializeApp(
      { projectId: process.env.GCLOUD_PROJECT ?? 'demo-schoolforge' },
      `return-draft-${randomUUID()}`,
    );
    db = getFirestore(app);
  });

  afterEach(async () => {
    await Promise.all(
      ids.splice(0).map(async (id) => {
        await db.recursiveDelete(db.doc(`verifications/${id}`));
        const submissions = await db
          .collection('submissions')
          .where('verificationId', '==', id)
          .get();
        await Promise.all(submissions.docs.map((item) => item.ref.delete()));
        const audits = await db.collection('auditEvents').where('targetId', '==', id).get();
        await Promise.all(audits.docs.map((item) => item.ref.delete()));
      }),
    );
  });

  afterAll(async () => deleteApp(app));

  async function seed(status: 'active' | 'closed', labelId?: string): Promise<string> {
    const id = `verification-${randomUUID()}`;
    ids.push(id);
    await db.doc(`verifications/${id}`).set(verification(status, labelId));
    await db.doc(`verifications/${id}/publishedProjection/data`).set({
      ownerUid: OWNER,
      visibility: 'public',
      onlineEnabled: true,
      studentPdfEnabled: true,
      status,
    });
    return id;
  }

  it.each(['active', 'closed'] as const)(
    'returns a %s verification to an editable hidden draft and removes derived data',
    async (status) => {
      const labelId = `label-${randomUUID()}`;
      const id = await seed(status, labelId);
      await db.doc(`differentiationLabels/${labelId}`).set({
        ownerUid: OWNER,
        draftUsageCount: 0,
      });
      await db.doc(`verifications/${id}/studentAssignments/student-1`).set({ order: [0] });

      await returnVerificationToDraftWithDb(db, id, OWNER);

      expect((await db.doc(`verifications/${id}`).get()).data()).toMatchObject({
        status: 'draft',
        visibility: 'hidden',
        onlineEnabled: false,
        studentPdfEnabled: false,
        teacherSnapshot: null,
        activatedAt: null,
        closedAt: null,
      });
      expect((await db.doc(`verifications/${id}`).get()).data()?.config).toEqual(
        verification(status, labelId).config,
      );
      expect((await db.doc(`verifications/${id}`).get()).data()).not.toHaveProperty(
        'returnToDraftPending',
      );
      expect((await db.doc(`verifications/${id}/publishedProjection/data`).get()).exists).toBe(
        false,
      );
      expect((await db.doc(`verifications/${id}/studentAssignments/student-1`).get()).exists).toBe(
        false,
      );
      expect((await db.doc(`differentiationLabels/${labelId}`).get()).data()?.draftUsageCount).toBe(
        1,
      );
      expect(
        (await db.collection('auditEvents').where('targetId', '==', id).count().get()).data().count,
      ).toBe(1);
      await db.doc(`differentiationLabels/${labelId}`).delete();
    },
    15_000,
  );

  it('rejects any existing submission without changing the verification', async () => {
    const id = await seed('active');
    await db.doc(`submissions/${id}_student-1`).set({
      verificationId: id,
      ownerUid: OWNER,
      status: 'draft',
    });

    await expect(returnVerificationToDraftWithDb(db, id, OWNER)).rejects.toThrow(
      'Elimina prima tutte le consegne associate alla verifica.',
    );

    expect((await db.doc(`verifications/${id}`).get()).data()).toMatchObject({
      status: 'active',
      visibility: 'public',
      onlineEnabled: true,
    });
  });

  it('never finalizes draft if a submission appears after the phase-one fence', async () => {
    const id = await seed('active');
    await installReturnToDraftFence(db, id, OWNER);
    await db.doc(`submissions/${id}_late-student`).set({
      verificationId: id,
      ownerUid: OWNER,
      status: 'draft',
    });

    await expect(finalizeReturnToDraft(db, id, OWNER)).rejects.toThrow(
      'Elimina prima tutte le consegne associate alla verifica.',
    );

    expect((await db.doc(`verifications/${id}`).get()).data()).toMatchObject({
      status: 'active',
      visibility: 'hidden',
      onlineEnabled: false,
      studentPdfEnabled: false,
      returnToDraftPending: true,
    });
    expect(
      (await db.doc(`verifications/${id}/publishedProjection/data`).get()).data(),
    ).toMatchObject({
      visibility: 'hidden',
      onlineEnabled: false,
      studentPdfEnabled: false,
    });

    // Il fence è recuperabile: eliminata la consegna anomala, lo stesso comando
    // riprende la pulizia e conclude senza riaprire accessi nel mezzo.
    await db.doc(`submissions/${id}_late-student`).delete();
    await returnVerificationToDraftWithDb(db, id, OWNER);
    expect((await db.doc(`verifications/${id}`).get()).data()?.status).toBe('draft');
  });

  it('preserves the complete editable config when a label was deleted while active', async () => {
    const missingLabelId = `deleted-label-${randomUUID()}`;
    const id = await seed('active', missingLabelId);

    await returnVerificationToDraftWithDb(db, id, OWNER);

    const data = (await db.doc(`verifications/${id}`).get()).data();
    expect(data?.status).toBe('draft');
    expect(data?.config.questionRefs).toEqual([{ questionIndexEntryId: 'q-1' }]);
    expect(data?.config).toEqual(verification('active', missingLabelId).config);
  });

  it('serializes a concurrent student start: draft and a new submission can never both win', async () => {
    const id = await seed('active');
    const studentStart = db.runTransaction(async (tx) => {
      const verificationRef = db.doc(`verifications/${id}`);
      const snap = await tx.get(verificationRef);
      const data = snap.data();
      if (data?.status !== 'active' || data.onlineEnabled !== true) {
        throw new Error('student-blocked');
      }
      tx.create(db.doc(`submissions/${id}_student-race`), {
        verificationId: id,
        ownerUid: OWNER,
        status: 'draft',
      });
    });

    await Promise.allSettled([returnVerificationToDraftWithDb(db, id, OWNER), studentStart]);

    const [verificationSnap, submissionSnap] = await Promise.all([
      db.doc(`verifications/${id}`).get(),
      db.doc(`submissions/${id}_student-race`).get(),
    ]);
    expect(verificationSnap.data()?.status === 'draft' && submissionSnap.exists).toBe(false);
  });

  it('rejects online assignment if the verification was reactivated after preflight', async () => {
    const id = await seed('active');
    const oldActivation = Timestamp.fromMillis(1_000);
    const newActivation = Timestamp.fromMillis(2_000);
    await db.doc(`verifications/${id}`).update({ activatedAt: oldActivation });
    const preflightActivationId = activationId(oldActivation);
    await db.doc(`verifications/${id}`).update({ activatedAt: newActivation });

    await expect(
      persistAssignment(db)({
        submissionId: `${id}_student-reactivated-online`,
        verificationId: id,
        studentUid: 'student-reactivated-online',
        ownerUid: OWNER,
        activationId: preflightActivationId,
        verificationTitle: 'Versione A',
        className: 'Classe A',
        snapshot: oldSnapshot,
        randomIntBelow: () => 0,
      }),
    ).rejects.toThrow('La verifica non è più disponibile.');

    expect((await db.doc(`submissions/${id}_student-reactivated-online`).get()).exists).toBe(false);
  });

  it('rejects a personal PDF if the verification was reactivated after preflight', async () => {
    const id = await seed('active');
    const oldActivation = Timestamp.fromMillis(3_000);
    const newActivation = Timestamp.fromMillis(4_000);
    await db.doc(`verifications/${id}`).update({ activatedAt: oldActivation });
    const preflightActivationId = activationId(oldActivation);
    await db.doc(`verifications/${id}`).update({ activatedAt: newActivation });

    await expect(
      persistPdfAssignment(db)({
        submissionId: `${id}_student-reactivated-pdf`,
        verificationId: id,
        studentUid: 'student-reactivated-pdf',
        ownerUid: OWNER,
        activationId: preflightActivationId,
        verificationTitle: 'Versione A',
        className: 'Classe A',
        snapshot: oldSnapshot,
        randomIntBelow: () => 0,
      }),
    ).rejects.toThrow('PDF non disponibile.');

    expect(
      (await db.doc(`verifications/${id}/studentAssignments/student-reactivated-pdf`).get()).exists,
    ).toBe(false);
  });
});
