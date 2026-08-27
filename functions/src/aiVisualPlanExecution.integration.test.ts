import { randomUUID } from 'node:crypto';
import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { emptyLedger, monthKeyFromMs, reserve } from './aiCorrectionBudget.js';
import {
  OPENAI_RUNTIME_LUNA_MODEL,
  OPENAI_RUNTIME_LUNA_PRICE_LIST_VERSION,
} from './aiCorrectionCost.js';
import { computeBudgetReservationKey } from './aiContentCore.js';
import { VISUAL_STAGING_TTL_MS } from './aiContentVisualProposal.js';
import { sha256Hex } from './aiVisualCore.js';
import {
  LESSON_VISUALS_CONTRACT_VERSION,
  VISUAL_PLAN_CONTRACT_VERSION,
  computeOpaqueVisualPlanId,
  computeVisualPlanHash,
} from './aiVisualMultiCore.js';
import {
  generateVisualPlanSlotForOwner,
  promoteVisualPlanSlotForOwner,
} from './aiVisualPlanExecutionGateway.js';
import { validateVisualPlanRun, type VisualPlanRun } from './aiVisualMultiPlan.js';
import {
  computeVisualPlanLeaseId,
  VISUAL_PLAN_LEASE_CONTRACT_VERSION,
} from './aiVisualPlanLease.js';
import type { BucketLike, FileLike } from './repositoryGatewayCore.js';

const emulatorDescribe = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;
const OWNER = 'mv03b-owner';
const PROGRAM = 'mv03b-program';
const IMPORT = 'mv03b-import';
const LESSON = 'mv03b-lesson';
const PUBLIC = 'mv03b-public';
const BODY = '## Primo\n\nTesto.\n\n## Secondo\n\nAltro testo.';

class MemoryFile implements FileLike {
  constructor(
    private readonly path: string,
    private readonly data: Map<string, Uint8Array>,
  ) {}
  async download(): Promise<[Uint8Array]> {
    const value = this.data.get(this.path);
    if (!value) throw Object.assign(new Error('not found'), { code: 404 });
    return [value];
  }
  async save(value: Uint8Array): Promise<void> {
    this.data.set(this.path, Buffer.from(value));
  }
  async delete(): Promise<void> {
    this.data.delete(this.path);
  }
}

class MemoryBucket implements BucketLike {
  readonly data = new Map<string, Uint8Array>();
  file(path: string): FileLike {
    return new MemoryFile(path, this.data);
  }
  async deleteFiles(): Promise<void> {
    throw new Error('prefix delete vietato');
  }
}

function slot(index: number) {
  return {
    slotIndex: index,
    state: 'pending' as const,
    decision: 'image' as const,
    subject: `Schema didattico ${index}`,
    rationale: `Motivo distinto ${index}`,
    anchor: {
      anchorHeadingIndex: index % 2,
      anchorHeadingText: index % 2 === 0 ? 'Primo' : 'Secondo',
    },
    caption: `Didascalia ${index}`,
    altText: `Testo alternativo ${index}`,
    attempts: 0,
    lastError: null,
    staged: null,
    promotedAssetId: null,
  };
}

emulatorDescribe('MULTI-VISUAL-03B — Firestore e Storage fake fedele', () => {
  let app: App;
  let db: Firestore;
  const bucket = new MemoryBucket();
  const requestId = randomUUID();
  const opaquePlanId = computeOpaqueVisualPlanId(OWNER, requestId);
  const now = Date.now();
  const monthKey = monthKeyFromMs(now);
  const generationCap = 1000;
  const reservationKey = computeBudgetReservationKey(OWNER, requestId);

  beforeAll(async () => {
    app = initializeApp(
      { projectId: process.env.GCLOUD_PROJECT ?? 'demo-schoolforge' },
      `mv03b-${randomUUID()}`,
    );
    db = getFirestore(app);
    await db.doc('settings/aiConfig').set({
      enabled: true,
      provider: 'openai',
      model: OPENAI_RUNTIME_LUNA_MODEL,
      environment: 'dev',
      limits: {
        maxSubmissionsPerOperation: 30,
        maxOpenQuestionsPerSubmission: 20,
        maxEstimatedTokensPerSubmission: 10000,
        maxEstimatedTokensPerOperation: 300000,
        maxProviderConcurrency: 3,
        attemptTimeoutMs: 60000,
        maxApplicationRetries: 1,
      },
      maxOperationCostMicroUsd: 250000,
      dailyBudgetMicroUsd: 1000000,
      monthlyBudgetMicroUsd: 5000000,
      configVersion: 'v1',
      priceListVersion: OPENAI_RUNTIME_LUNA_PRICE_LIST_VERSION,
    });
    await db.doc(`programs/${PROGRAM}/imports/${IMPORT}/lessons/${LESSON}`).set({
      ownerUid: OWNER,
      importId: IMPORT,
      udaDir: 'uda-01',
      path: 'uda-01/lezione-1.md',
      filename: 'lezione-1.md',
      publicLessonId: PUBLIC,
      completed: false,
    });
    await db.doc(`publicLessons/${PUBLIC}`).set({
      ownerUid: OWNER,
      programId: PROGRAM,
      importId: IMPORT,
      udaDir: 'uda-01',
      path: 'uda-01/lezione-1.md',
      filename: 'lezione-1.md',
      content: BODY,
      completed: false,
    });
    const quantity = { mode: 'exact' as const, ceiling: 3 as const };
    const planHash = computeVisualPlanHash({
      ownerUid: OWNER,
      programId: PROGRAM,
      importId: IMPORT,
      lessonId: LESSON,
      publicLessonId: PUBLIC,
      sourceBodyHash: sha256Hex(BODY),
      existingItemAssetIds: [],
      quantity,
    });
    const plan: VisualPlanRun = {
      contractVersion: VISUAL_PLAN_CONTRACT_VERSION,
      ownerUid: OWNER,
      programId: PROGRAM,
      importId: IMPORT,
      lessonId: LESSON,
      publicLessonId: PUBLIC,
      udaDir: 'uda-01',
      requestId,
      planHash,
      status: 'proposed',
      quantity,
      sourceBodyHash: sha256Hex(BODY),
      existingItemAssetIds: [],
      budgetCeiling: {
        reservationKey,
        reservationMonthKey: monthKey,
        proposalCap: 10,
        generationCap,
        maxAttemptsPerSlot: 2,
        totalReserved: 6010,
      },
      slots: [slot(0), slot(1), slot(2)],
      settlement: { proposalActualCost: 0, slots: [] },
      createdAt: Timestamp.fromMillis(now),
      updatedAt: Timestamp.fromMillis(now),
      expireAt: Timestamp.fromMillis(now + VISUAL_STAGING_TTL_MS),
    };
    validateVisualPlanRun(plan);
    await db.doc(`visualPlanRuns/${opaquePlanId}`).set(plan);
    await db.doc(`visualPlanLeases/${computeVisualPlanLeaseId(OWNER, LESSON)}`).set({
      contractVersion: VISUAL_PLAN_LEASE_CONTRACT_VERSION,
      ownerUid: OWNER,
      programId: PROGRAM,
      importId: IMPORT,
      lessonId: LESSON,
      opaquePlanId,
      requestId,
      createdAt: Timestamp.fromMillis(now),
      updatedAt: Timestamp.fromMillis(now),
      expireAt: Timestamp.fromMillis(now + VISUAL_STAGING_TTL_MS),
    });
    const reserved = reserve(
      emptyLedger(monthKey, 5000000, 1000000),
      reservationKey,
      6000,
      now + VISUAL_STAGING_TTL_MS,
      now,
    );
    if (!reserved.ok) throw new Error('fixture budget');
    await db.doc(`aiBudgetLedger/${monthKey}`).set(reserved.state);
  });

  afterAll(async () => {
    for (const collection of [
      'visualPlanRuns',
      'visualPlanLeases',
      'visualPlanSlotRuns',
      'visualPlanPromotions',
      'visualPlanPromotionRecoveries',
      'auditEvents',
    ]) {
      const docs = await db.collection(collection).get();
      await Promise.all(docs.docs.map((doc) => doc.ref.delete()));
    }
    await Promise.all([
      db.doc(`programs/${PROGRAM}/imports/${IMPORT}/lessons/${LESSON}`).delete(),
      db.doc(`publicLessons/${PUBLIC}`).delete(),
      db.doc(`aiBudgetLedger/${monthKey}`).delete(),
      db.doc('settings/aiConfig').delete(),
    ]);
    await deleteApp(app);
  });

  it('retry di uno slot non tocca gli altri e non supera due tentativi', async () => {
    const raw = await sharp({
      create: { width: 64, height: 48, channels: 3, background: '#f7f5f0' },
    })
      .webp()
      .toBuffer();
    let providerCalls = 0;
    const generate = (slotIndex: number, outcome: 'success' | 'pre') =>
      generateVisualPlanSlotForOwner({
        db,
        bucket,
        ownerUid: OWNER,
        input: { requestId, programId: PROGRAM, importId: IMPORT, lessonId: LESSON, slotIndex },
        mode: 'mock',
        nowMs: now + 1000 + providerCalls,
        deps: {
          executionId: () => randomUUID(),
          callProvider: async () => {
            providerCalls += 1;
            return outcome === 'success'
              ? {
                  status: 'success',
                  bytes: raw,
                  usage: null,
                  priorBillingRisk: false,
                  metered: false,
                }
              : { status: 'pre_invocation' };
          },
        },
      });
    const failed = await generate(0, 'pre');
    expect(failed.plan.slots.map((entry) => [entry.state, entry.attempts])).toEqual([
      ['failed', 1],
      ['pending', 0],
      ['pending', 0],
    ]);
    const retried = await generate(0, 'success');
    expect(retried.plan.slots.map((entry) => [entry.state, entry.attempts])).toEqual([
      ['ready', 2],
      ['pending', 0],
      ['pending', 0],
    ]);
    const replay = await generate(0, 'success');
    expect(replay.replayed).toBe(true);
    expect(providerCalls).toBe(2);
    const ledger = (await db.doc(`aiBudgetLedger/${monthKey}`).get()).data()!;
    expect(ledger.reservations[reservationKey].microUsd).toBe(4000);
  });

  it('promuove add atomicamente, conserva gli altri slot e replaya senza ricopiare', async () => {
    const before = validateVisualPlanRun(
      (await db.doc(`visualPlanRuns/${opaquePlanId}`).get()).data(),
    );
    const promotedAsset = randomUUID();
    const input = {
      requestId,
      programId: PROGRAM,
      importId: IMPORT,
      lessonId: LESSON,
      slotIndex: 0,
      promotionRequestId: randomUUID(),
      mode: { mode: 'add' as const },
    };
    const first = await promoteVisualPlanSlotForOwner({
      db,
      bucket,
      ownerUid: OWNER,
      input,
      nowMs: now + 5000,
      generateAssetId: () => promotedAsset,
    });
    expect(first.replayed).toBe(false);
    expect(first.plan.slots[0]?.state).toBe('promoted');
    expect(first.plan.slots[1]?.state).toBe(before.slots[1]?.state);
    const lesson = (
      await db.doc(`programs/${PROGRAM}/imports/${IMPORT}/lessons/${LESSON}`).get()
    ).data()!;
    expect(lesson.visuals.contractVersion).toBe(LESSON_VISUALS_CONTRACT_VERSION);
    expect(lesson.visuals.items.map((item: { assetId: string }) => item.assetId)).toEqual([
      promotedAsset,
    ]);
    expect(
      bucket.data.has(`repository/${OWNER}/${IMPORT}/uda-01/visuals/${promotedAsset}.webp`),
    ).toBe(true);
    const size = bucket.data.size;
    const replay = await promoteVisualPlanSlotForOwner({
      db,
      bucket,
      ownerUid: OWNER,
      input,
      nowMs: now + 6000,
      generateAssetId: randomUUID,
    });
    expect(replay.replayed).toBe(true);
    expect(replay.assetId).toBe(promotedAsset);
    expect(bucket.data.size).toBe(size);
  });

  it('promuove replace sul mondo fresco e rimuove il canonico sostituito solo dopo il commit', async () => {
    const previousPlan = validateVisualPlanRun(
      (await db.doc(`visualPlanRuns/${opaquePlanId}`).get()).data(),
    );
    const previousAssetId = previousPlan.slots[0]?.promotedAssetId;
    expect(previousAssetId).toMatch(/^[0-9a-f-]{36}$/);
    const raw = await sharp({
      create: { width: 80, height: 60, channels: 3, background: '#dfe8f1' },
    })
      .webp()
      .toBuffer();
    const generated = await generateVisualPlanSlotForOwner({
      db,
      bucket,
      ownerUid: OWNER,
      input: { requestId, programId: PROGRAM, importId: IMPORT, lessonId: LESSON, slotIndex: 1 },
      mode: 'mock',
      nowMs: now + 7000,
      deps: {
        executionId: () => randomUUID(),
        callProvider: async () => ({
          status: 'success',
          bytes: raw,
          usage: null,
          priorBillingRisk: false,
          metered: false,
        }),
      },
    });
    expect(generated.plan.slots[1]?.state).toBe('ready');
    const replacementId = randomUUID();
    const replaced = await promoteVisualPlanSlotForOwner({
      db,
      bucket,
      ownerUid: OWNER,
      input: {
        requestId,
        programId: PROGRAM,
        importId: IMPORT,
        lessonId: LESSON,
        slotIndex: 1,
        promotionRequestId: randomUUID(),
        mode: { mode: 'replace', replaceAssetId: previousAssetId! },
      },
      nowMs: now + 8000,
      generateAssetId: () => replacementId,
    });
    expect(replaced.plan.slots[1]?.promotedAssetId).toBe(replacementId);
    const lesson = (
      await db.doc(`programs/${PROGRAM}/imports/${IMPORT}/lessons/${LESSON}`).get()
    ).data()!;
    expect(lesson.visuals.items.map((item: { assetId: string }) => item.assetId)).toEqual([
      replacementId,
    ]);
    expect(
      bucket.data.has(`repository/${OWNER}/${IMPORT}/uda-01/visuals/${previousAssetId}.webp`),
    ).toBe(false);
    expect(
      bucket.data.has(`repository/${OWNER}/${IMPORT}/uda-01/visuals/${replacementId}.webp`),
    ).toBe(true);
  });
});
