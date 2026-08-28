import { randomUUID } from 'node:crypto';
import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { computeBudgetReservationKey } from './aiContentCore.js';
import { sha256Hex } from './aiVisualCore.js';
import {
  computeOpaqueVisualPlanId,
  computeVisualPlanHash,
  VISUAL_PLAN_CONTRACT_VERSION,
  VISUAL_PLAN_MAX_ATTEMPTS_PER_SLOT,
} from './aiVisualMultiCore.js';
import { validateVisualPlanEditSlotInput, visualPlanSlotEditId } from './aiVisualPlanEditorial.js';
import { editVisualPlanSlotForOwner } from './aiVisualPlanEditorialGateway.js';
import {
  computeVisualPlanTotalReserved,
  validateVisualPlanRun,
  type VisualPlanRun,
} from './aiVisualMultiPlan.js';
import {
  computeVisualPlanLeaseId,
  VISUAL_PLAN_LEASE_CONTRACT_VERSION,
} from './aiVisualPlanLease.js';

const emulatorDescribe = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;
const OWNER = 'owner-plan-editorial';
const PROGRAM = 'program-plan-editorial';
const IMPORT = 'import-plan-editorial';
const LESSON = 'lesson-plan-editorial';
const PUBLIC = 'public-plan-editorial';
const BODY = '## A\n\nTesto A.\n\n## B\n\nTesto B.';
const NOW = Date.UTC(2026, 7, 27, 12);

emulatorDescribe('MULTI-VISUAL-04 — Firestore Emulator revisione slot §8.4', () => {
  let app: App;
  let db: Firestore;
  const requests = new Set<string>();

  beforeAll(async () => {
    app = initializeApp(
      { projectId: process.env.GCLOUD_PROJECT ?? 'demo-schoolforge' },
      `visual-plan-editorial-${randomUUID()}`,
    );
    db = getFirestore(app);
    await db.doc('settings/owner').set({ ownerUid: OWNER });
  });

  afterEach(async () => {
    const refs: FirebaseFirestore.DocumentReference[] = [
      db.doc(`programs/${PROGRAM}/imports/${IMPORT}/lessons/${LESSON}`),
      db.doc(`publicLessons/${PUBLIC}`),
      db.doc('aiBudgetLedger/2026-08'),
    ];
    for (const requestId of requests) {
      const opaque = computeOpaqueVisualPlanId(OWNER, requestId);
      refs.push(db.doc(`visualPlanRuns/${opaque}`));
      refs.push(db.doc(`visualPlanLeases/${computeVisualPlanLeaseId(OWNER, LESSON)}`));
    }
    const [edits, audits] = await Promise.all([
      db.collection('visualPlanSlotEdits').get(),
      db.collection('auditEvents').get(),
    ]);
    refs.push(...edits.docs.map((doc) => doc.ref), ...audits.docs.map((doc) => doc.ref));
    await Promise.all(refs.map((ref) => ref.delete().catch(() => undefined)));
    requests.clear();
  });

  afterAll(async () => {
    await db
      .doc('settings/owner')
      .delete()
      .catch(() => undefined);
    await deleteApp(app);
  });

  async function seed(): Promise<VisualPlanRun> {
    const requestId = randomUUID();
    requests.add(requestId);
    const quantity = { mode: 'exact' as const, ceiling: 2 as const };
    const sourceBodyHash = sha256Hex(BODY);
    const identity = {
      ownerUid: OWNER,
      programId: PROGRAM,
      importId: IMPORT,
      lessonId: LESSON,
      publicLessonId: PUBLIC,
      sourceBodyHash,
      existingItemAssetIds: [] as string[],
      replacementAssetId: null,
      quantity,
    };
    const reservationKey = computeBudgetReservationKey(OWNER, requestId);
    const plan = validateVisualPlanRun({
      contractVersion: VISUAL_PLAN_CONTRACT_VERSION,
      ...identity,
      udaDir: 'uda-1',
      requestId,
      planHash: computeVisualPlanHash(identity),
      status: 'proposed',
      budgetCeiling: {
        reservationKey,
        reservationMonthKey: '2026-08',
        proposalCap: 20,
        generationCap: 100,
        maxAttemptsPerSlot: VISUAL_PLAN_MAX_ATTEMPTS_PER_SLOT,
        totalReserved: computeVisualPlanTotalReserved({
          proposalCap: 20,
          generationCap: 100,
          ceiling: 2,
          maxAttemptsPerSlot: VISUAL_PLAN_MAX_ATTEMPTS_PER_SLOT,
        }),
      },
      slots: [0, 1].map((slotIndex) => ({
        slotIndex,
        state: 'pending',
        decision: 'image',
        subject: `Schema ${slotIndex === 0 ? 'A' : 'B'}`,
        rationale: `Utilità distinta ${slotIndex}.`,
        anchor: {
          anchorHeadingIndex: slotIndex,
          anchorHeadingText: slotIndex === 0 ? 'A' : 'B',
        },
        caption: `Didascalia ${slotIndex}`,
        altText: `Descrizione ${slotIndex}`,
        attempts: 0,
        lastError: null,
        staged: null,
        promotedAssetId: null,
      })),
      settlement: { proposalActualCost: 10, slots: [] },
      createdAt: Timestamp.fromMillis(NOW),
      updatedAt: Timestamp.fromMillis(NOW),
      expireAt: Timestamp.fromMillis(NOW + 24 * 60 * 60 * 1000),
    });
    const opaque = computeOpaqueVisualPlanId(OWNER, requestId);
    await Promise.all([
      db.doc(`programs/${PROGRAM}/imports/${IMPORT}/lessons/${LESSON}`).set({
        ownerUid: OWNER,
        importId: IMPORT,
        udaDir: 'uda-1',
        path: 'uda-1/lezione.md',
        filename: 'lezione.md',
        publicLessonId: PUBLIC,
        completed: false,
      }),
      db.doc(`publicLessons/${PUBLIC}`).set({
        ownerUid: OWNER,
        programId: PROGRAM,
        importId: IMPORT,
        udaDir: 'uda-1',
        path: 'uda-1/lezione.md',
        filename: 'lezione.md',
        content: BODY,
        completed: false,
      }),
      db.doc(`visualPlanRuns/${opaque}`).set(plan),
      db.doc(`visualPlanLeases/${computeVisualPlanLeaseId(OWNER, LESSON)}`).set({
        contractVersion: VISUAL_PLAN_LEASE_CONTRACT_VERSION,
        ownerUid: OWNER,
        programId: PROGRAM,
        importId: IMPORT,
        lessonId: LESSON,
        opaquePlanId: opaque,
        requestId,
        createdAt: Timestamp.fromMillis(NOW),
        updatedAt: Timestamp.fromMillis(NOW),
        expireAt: Timestamp.fromMillis(NOW + 24 * 60 * 60 * 1000),
      }),
      db.doc('aiBudgetLedger/2026-08').set({
        monthKey: '2026-08',
        budgetMicroUsd: 5_000_000,
        dailyBudgetMicroUsd: 1_000_000,
        spentMicroUsd: 10,
        dailySpentMicroUsd: { '2026-08-27': 10 },
        reservations: {
          [reservationKey]: {
            microUsd: 400,
            expiresAtMs: NOW + 24 * 60 * 60 * 1000,
            dayKey: '2026-08-27',
            status: 'reserved',
          },
        },
      }),
    ]);
    return plan;
  }

  function input(
    plan: VisualPlanRun,
    editRequestId = randomUUID(),
    over: Record<string, unknown> = {},
  ) {
    return validateVisualPlanEditSlotInput({
      requestId: plan.requestId,
      editRequestId,
      programId: PROGRAM,
      importId: IMPORT,
      lessonId: LESSON,
      slotIndex: 0,
      abandon: false,
      subject: 'Schema A rivisto',
      caption: 'Didascalia rivista',
      altText: 'Descrizione rivista',
      anchorHeadingIndex: 1,
      anchorHeadingText: 'B',
      ...over,
    });
  }

  it('scrive piano+chiave idempotente+audit, senza toccare budget o consuntivo', async () => {
    const plan = await seed();
    const beforeLedger = (await db.doc('aiBudgetLedger/2026-08').get()).data();
    const edit = input(plan);
    const result = await editVisualPlanSlotForOwner({
      db,
      ownerUid: OWNER,
      input: edit,
      nowMs: NOW + 100,
    });
    expect(result.replayed).toBe(false);
    expect(result.plan.slots[0].subject).toBe('Schema A rivisto');
    expect(result.plan.settlement).toEqual(plan.settlement);
    expect((await db.doc('aiBudgetLedger/2026-08').get()).data()).toEqual(beforeLedger);
    expect(
      (await db.doc(`visualPlanSlotEdits/${visualPlanSlotEditId(OWNER, edit.editRequestId)}`).get())
        .exists,
    ).toBe(true);
    expect((await db.collection('auditEvents').get()).size).toBe(1);
  });

  it('replay identico produce zero scritture; editRequestId divergente fallisce chiuso', async () => {
    const plan = await seed();
    const editId = randomUUID();
    const edit = input(plan, editId);
    await editVisualPlanSlotForOwner({ db, ownerUid: OWNER, input: edit, nowMs: NOW + 100 });
    const planRef = db.doc(`visualPlanRuns/${computeOpaqueVisualPlanId(OWNER, plan.requestId)}`);
    const editRef = db.doc(`visualPlanSlotEdits/${visualPlanSlotEditId(OWNER, editId)}`);
    const beforePlan = (await planRef.get()).data();
    const beforeEdit = (await editRef.get()).data();
    const replay = await editVisualPlanSlotForOwner({
      db,
      ownerUid: OWNER,
      input: edit,
      nowMs: NOW + 200,
    });
    expect(replay.replayed).toBe(true);
    expect((await planRef.get()).data()).toEqual(beforePlan);
    expect((await editRef.get()).data()).toEqual(beforeEdit);
    expect((await db.collection('auditEvents').get()).size).toBe(1);
    await expect(
      editVisualPlanSlotForOwner({
        db,
        ownerUid: OWNER,
        input: input(plan, editId, { caption: 'Contenuto divergente' }),
        nowMs: NOW + 300,
      }),
    ).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('race stesso editRequestId con payload diversi: un solo commit e nessuna sovrascrittura', async () => {
    const plan = await seed();
    const editId = randomUUID();
    const outcomes = await Promise.allSettled([
      editVisualPlanSlotForOwner({
        db,
        ownerUid: OWNER,
        input: input(plan, editId),
        nowMs: NOW + 100,
      }),
      editVisualPlanSlotForOwner({
        db,
        ownerUid: OWNER,
        input: input(plan, editId, { subject: 'Schema A concorrente' }),
        nowMs: NOW + 100,
      }),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(1);
    expect((await db.collection('visualPlanSlotEdits').get()).size).toBe(1);
    expect((await db.collection('auditEvents').get()).size).toBe(1);
  });

  it('abandon libera esattamente lo slot, conserva settlement e chiude lease sull’ultimo', async () => {
    const plan = await seed();
    const abandon = (slotIndex: number) =>
      validateVisualPlanEditSlotInput({
        requestId: plan.requestId,
        editRequestId: randomUUID(),
        programId: PROGRAM,
        importId: IMPORT,
        lessonId: LESSON,
        slotIndex,
        abandon: true,
      });
    const first = await editVisualPlanSlotForOwner({
      db,
      ownerUid: OWNER,
      input: abandon(0),
      nowMs: NOW + 100,
    });
    expect(first.plan.status).toBe('proposed');
    expect(first.plan.settlement.slots).toEqual([]);
    expect(
      (await db.doc('aiBudgetLedger/2026-08').get()).data()?.reservations[
        plan.budgetCeiling.reservationKey
      ].microUsd,
    ).toBe(200);
    const second = await editVisualPlanSlotForOwner({
      db,
      ownerUid: OWNER,
      input: abandon(1),
      nowMs: NOW + 200,
    });
    expect(second.plan.status).toBe('abandoned');
    expect(
      (await db.doc('aiBudgetLedger/2026-08').get()).data()?.reservations[
        plan.budgetCeiling.reservationKey
      ],
    ).toBeUndefined();
    expect(
      (await db.doc(`visualPlanLeases/${computeVisualPlanLeaseId(OWNER, LESSON)}`).get()).exists,
    ).toBe(false);
  });

  it('fallisce chiuso su owner, body/heading freschi e slot già generating senza scritture', async () => {
    const plan = await seed();
    const edit = input(plan);
    await expect(
      editVisualPlanSlotForOwner({
        db,
        ownerUid: OWNER,
        input: input(plan, randomUUID(), {
          anchorHeadingIndex: 0,
          anchorHeadingText: 'B',
        }),
        nowMs: NOW + 50,
      }),
    ).rejects.toMatchObject({ code: 'visual_promotion_anchor_stale' });
    expect((await db.collection('visualPlanSlotEdits').get()).size).toBe(0);
    await db.doc(`publicLessons/${PUBLIC}`).update({ content: '## C\n\nMutato.' });
    await expect(
      editVisualPlanSlotForOwner({ db, ownerUid: OWNER, input: edit, nowMs: NOW + 100 }),
    ).rejects.toMatchObject({ code: 'visual_plan_proposal_body_changed' });
    expect((await db.collection('visualPlanSlotEdits').get()).size).toBe(0);
    await db.doc(`publicLessons/${PUBLIC}`).update({ content: BODY });
    await db.doc('settings/owner').set({ ownerUid: 'other-owner' });
    await expect(
      editVisualPlanSlotForOwner({ db, ownerUid: OWNER, input: edit, nowMs: NOW + 100 }),
    ).rejects.toMatchObject({ code: 'not_owner' });
    await db.doc('settings/owner').set({ ownerUid: OWNER });
    const planRef = db.doc(`visualPlanRuns/${computeOpaqueVisualPlanId(OWNER, plan.requestId)}`);
    const fresh = validateVisualPlanRun({
      ...plan,
      status: 'generating',
      slots: plan.slots.map((slot) =>
        slot.slotIndex === 0 ? { ...slot, state: 'generating', attempts: 1 } : slot,
      ),
      settlement: {
        ...plan.settlement,
        slots: [{ slotIndex: 0, attempts: 1, actualCost: 0 }],
      },
    });
    await planRef.set(fresh);
    await expect(
      editVisualPlanSlotForOwner({ db, ownerUid: OWNER, input: edit, nowMs: NOW + 100 }),
    ).rejects.toBeTruthy();
    expect(fresh.status).toBe('generating');
    expect((await db.collection('visualPlanSlotEdits').get()).size).toBe(0);
  });
});
