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
  computeOpaqueVisualPlanSlotRunId,
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
    private readonly failDownloads: Set<string>,
    private readonly writeThenFail: Set<string>,
  ) {}
  async download(): Promise<[Uint8Array]> {
    if (this.failDownloads.has(this.path)) throw Object.assign(new Error('timeout'), { code: 504 });
    const value = this.data.get(this.path);
    if (!value) throw Object.assign(new Error('not found'), { code: 404 });
    return [value];
  }
  async save(
    value: Uint8Array,
    options?: { preconditionOpts?: { ifGenerationMatch?: number } },
  ): Promise<void> {
    if (options?.preconditionOpts?.ifGenerationMatch === 0 && this.data.has(this.path))
      throw Object.assign(new Error('precondition'), { code: 412 });
    this.data.set(this.path, Buffer.from(value));
    if (this.writeThenFail.has(this.path)) throw Object.assign(new Error('timeout'), { code: 504 });
  }
  async delete(): Promise<void> {
    this.data.delete(this.path);
  }
}

class MemoryBucket implements BucketLike {
  readonly data = new Map<string, Uint8Array>();
  readonly failDownloads = new Set<string>();
  readonly writeThenFail = new Set<string>();
  file(path: string): FileLike {
    return new MemoryFile(path, this.data, this.failDownloads, this.writeThenFail);
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

async function seedIndependentPlan(params: {
  db: Firestore;
  now: number;
  slotCount?: 1 | 2 | 3;
  completed?: boolean;
  replacementAssetId?: string;
}) {
  const ownerUid = `owner-${randomUUID()}`;
  const programId = `program-${randomUUID()}`;
  const importId = `import-${randomUUID()}`;
  const lessonId = `lesson-${randomUUID()}`;
  const publicLessonId = `public-${randomUUID()}`;
  const requestId = randomUUID();
  const opaquePlanId = computeOpaqueVisualPlanId(ownerUid, requestId);
  const quantity = { mode: 'exact' as const, ceiling: (params.slotCount ?? 2) as 1 | 2 | 3 };
  const slots = Array.from({ length: quantity.ceiling }, (_, index) => slot(index));
  const monthKey = monthKeyFromMs(params.now);
  const reservationKey = computeBudgetReservationKey(ownerUid, requestId);
  const generationCap = 1000;
  const existingItemAssetIds = params.replacementAssetId ? [params.replacementAssetId] : [];
  const planHash = computeVisualPlanHash({
    ownerUid,
    programId,
    importId,
    lessonId,
    publicLessonId,
    sourceBodyHash: sha256Hex(BODY),
    existingItemAssetIds,
    replacementAssetId: params.replacementAssetId ?? null,
    quantity,
  });
  const plan: VisualPlanRun = {
    contractVersion: VISUAL_PLAN_CONTRACT_VERSION,
    ownerUid,
    programId,
    importId,
    lessonId,
    publicLessonId,
    udaDir: 'uda-01',
    requestId,
    planHash,
    status: 'proposed',
    quantity,
    sourceBodyHash: sha256Hex(BODY),
    existingItemAssetIds,
    replacementAssetId: params.replacementAssetId ?? null,
    budgetCeiling: {
      reservationKey,
      reservationMonthKey: monthKey,
      proposalCap: 10,
      generationCap,
      maxAttemptsPerSlot: 2,
      totalReserved: 10 + quantity.ceiling * 2 * generationCap,
    },
    slots,
    settlement: { proposalActualCost: 0, slots: [] },
    createdAt: Timestamp.fromMillis(params.now),
    updatedAt: Timestamp.fromMillis(params.now),
    expireAt: Timestamp.fromMillis(params.now + VISUAL_STAGING_TTL_MS),
  };
  await Promise.all([
    params.db.doc(`programs/${programId}/imports/${importId}/lessons/${lessonId}`).set({
      ownerUid,
      importId,
      udaDir: 'uda-01',
      path: 'uda-01/lezione-1.md',
      filename: 'lezione-1.md',
      publicLessonId,
      completed: params.completed ?? false,
      ...(params.replacementAssetId
        ? {
            visuals: {
              contractVersion: LESSON_VISUALS_CONTRACT_VERSION,
              items: [
                {
                  assetId: params.replacementAssetId,
                  storageRef: `repository/${ownerUid}/${importId}/uda-01/visuals/${params.replacementAssetId}.webp`,
                  anchor: {
                    headingSlug: 'primo',
                    headingText: 'Primo',
                    placement: 'after-heading',
                  },
                  caption: 'Immagine da sostituire',
                  altText: 'Schema precedente',
                  width: 80,
                  height: 60,
                  byteLength: 100,
                  sha256: 'a'.repeat(64),
                  mimeType: 'image/webp',
                  source: 'generated',
                  styleVersion: 'schoolforge-sketch/v1',
                  sourceBodyHash: sha256Hex(BODY),
                  approvedAt: Timestamp.fromMillis(params.now - 1000),
                },
              ],
            },
          }
        : {}),
    }),
    params.db.doc(`publicLessons/${publicLessonId}`).set({
      ownerUid,
      programId,
      importId,
      udaDir: 'uda-01',
      path: 'uda-01/lezione-1.md',
      filename: 'lezione-1.md',
      content: BODY,
      completed: params.completed ?? false,
      ...(params.replacementAssetId && params.completed
        ? {
            visuals: {
              contractVersion: LESSON_VISUALS_CONTRACT_VERSION,
              items: [
                {
                  assetId: params.replacementAssetId,
                  anchor: {
                    headingSlug: 'primo',
                    headingText: 'Primo',
                    placement: 'after-heading',
                  },
                  caption: 'Immagine da sostituire',
                  altText: 'Schema precedente',
                  width: 80,
                  height: 60,
                },
              ],
            },
          }
        : {}),
    }),
    params.db.doc(`visualPlanRuns/${opaquePlanId}`).set(plan),
    params.db.doc(`visualPlanLeases/${computeVisualPlanLeaseId(ownerUid, lessonId)}`).set({
      contractVersion: VISUAL_PLAN_LEASE_CONTRACT_VERSION,
      ownerUid,
      programId,
      importId,
      lessonId,
      opaquePlanId,
      requestId,
      createdAt: Timestamp.fromMillis(params.now),
      updatedAt: Timestamp.fromMillis(params.now),
      expireAt: Timestamp.fromMillis(params.now + VISUAL_STAGING_TTL_MS),
    }),
  ]);
  const reserved = reserve(
    emptyLedger(monthKey, 5000000, 1000000),
    reservationKey,
    quantity.ceiling * 2 * generationCap,
    params.now + VISUAL_STAGING_TTL_MS,
    params.now,
  );
  if (!reserved.ok) throw new Error('fixture budget');
  await params.db.doc(`aiBudgetLedger/${monthKey}`).set(reserved.state);
  return {
    ownerUid,
    programId,
    importId,
    lessonId,
    publicLessonId,
    requestId,
    opaquePlanId,
    monthKey,
    reservationKey,
    generationCap,
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
      replacementAssetId: null,
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
      replacementAssetId: null,
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
          now: () => now + 2000 + providerCalls,
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

  it('rifiuta un replace deciso dopo authorize e conserva il canonico esistente', async () => {
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
        now: () => now + 7500,
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
    await expect(
      promoteVisualPlanSlotForOwner({
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
      }),
    ).rejects.toMatchObject({ code: 'invalid_input' });
    const lesson = (
      await db.doc(`programs/${PROGRAM}/imports/${IMPORT}/lessons/${LESSON}`).get()
    ).data()!;
    expect(lesson.visuals.items.map((item: { assetId: string }) => item.assetId)).toEqual([
      previousAssetId,
    ]);
    expect(
      bucket.data.has(`repository/${OWNER}/${IMPORT}/uda-01/visuals/${previousAssetId}.webp`),
    ).toBe(true);
    expect(
      bucket.data.has(`repository/${OWNER}/${IMPORT}/uda-01/visuals/${replacementId}.webp`),
    ).toBe(false);
  });

  it('invocation_unknown consuma solo il cap della fase e vieta una nuova chiamata provider', async () => {
    let providerCalls = 0;
    const call = () =>
      generateVisualPlanSlotForOwner({
        db,
        bucket,
        ownerUid: OWNER,
        input: { requestId, programId: PROGRAM, importId: IMPORT, lessonId: LESSON, slotIndex: 2 },
        mode: 'mock',
        nowMs: now + 9000,
        deps: {
          executionId: () => randomUUID(),
          now: () => now + 9100,
          callProvider: async () => {
            providerCalls += 1;
            return { status: 'invocation_unknown' as const };
          },
        },
      });
    await expect(call()).rejects.toMatchObject({ code: 'uncertain_state' });
    const first = validateVisualPlanRun(
      (await db.doc(`visualPlanRuns/${opaquePlanId}`).get()).data(),
    );
    expect(first.slots[2]?.state).toBe('failed');
    await expect(call()).rejects.toMatchObject({ code: 'uncertain_state' });
    expect(providerCalls).toBe(1);
    const ledger = (await db.doc(`aiBudgetLedger/${monthKey}`).get()).data()!;
    expect(ledger.reservations[reservationKey]).toBeUndefined();
    expect(ledger.spentMicroUsd).toBe(generationCap);
  });
});

emulatorDescribe('MULTI-VISUAL-03B — recovery indipendenti e fail-closed', () => {
  let app: App;
  let db: Firestore;
  let raw: Buffer;

  beforeAll(async () => {
    app = initializeApp(
      { projectId: process.env.GCLOUD_PROJECT ?? 'demo-schoolforge' },
      `mv03b-independent-${randomUUID()}`,
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
    raw = await sharp({
      create: { width: 72, height: 54, channels: 3, background: '#e8edf2' },
    })
      .webp()
      .toBuffer();
  });

  afterAll(async () => {
    await db.doc('settings/aiConfig').delete();
    await deleteApp(app);
  });

  const generate = (
    fixture: Awaited<ReturnType<typeof seedIndependentPlan>>,
    bucket: MemoryBucket,
    slotIndex: number,
    nowMs: number,
    callProvider: () => Promise<
      | { status: 'invocation_unknown' }
      | {
          status: 'success';
          bytes: Buffer;
          usage: null;
          priorBillingRisk: false;
          metered: false;
        }
    >,
  ) =>
    generateVisualPlanSlotForOwner({
      db,
      bucket,
      ownerUid: fixture.ownerUid,
      input: {
        requestId: fixture.requestId,
        programId: fixture.programId,
        importId: fixture.importId,
        lessonId: fixture.lessonId,
        slotIndex,
      },
      mode: 'mock',
      nowMs,
      deps: { executionId: randomUUID, now: () => nowMs + 1, callProvider },
    });

  it('eccezione provider è terminale incerta, consuma un cap e lascia generare un altro slot fuori ordine', async () => {
    const now = Date.now();
    const fixture = await seedIndependentPlan({ db, now, slotCount: 2 });
    const bucket = new MemoryBucket();
    let calls = 0;
    await expect(
      generate(fixture, bucket, 1, now + 100, async () => {
        calls += 1;
        throw new Error('transport unknown');
      }),
    ).rejects.toMatchObject({ code: 'uncertain_state' });
    const afterUnknown = validateVisualPlanRun(
      (await db.doc(`visualPlanRuns/${fixture.opaquePlanId}`).get()).data(),
    );
    expect(afterUnknown.slots[1]).toMatchObject({
      state: 'failed',
      attempts: 1,
      lastError: 'uncertain_outcome',
    });
    await expect(
      generate(fixture, bucket, 1, now + 200, async () => {
        calls += 1;
        return { status: 'invocation_unknown' };
      }),
    ).rejects.toMatchObject({ code: 'uncertain_state' });
    const other = await generate(fixture, bucket, 0, now + 300, async () => {
      calls += 1;
      return {
        status: 'success',
        bytes: raw,
        usage: null,
        priorBillingRisk: false,
        metered: false,
      };
    });
    expect(other.plan.slots.map((entry) => entry.state)).toEqual(['ready', 'failed']);
    expect(calls).toBe(2);
    const ledger = (await db.doc(`aiBudgetLedger/${fixture.monthKey}`).get()).data()!;
    expect(ledger.spentMicroUsd).toBe(fixture.generationCap);
    expect(ledger.reservations[fixture.reservationKey]).toBeUndefined();
  });

  it('save forse riuscita ma rilettura fallita chiude lo slot uncertain senza secondo provider', async () => {
    const now = Date.now();
    const fixture = await seedIndependentPlan({ db, now, slotCount: 1 });
    const bucket = new MemoryBucket();
    const stagingRef = `staging/${fixture.ownerUid}/${fixture.opaquePlanId}/0.webp`;
    bucket.writeThenFail.add(stagingRef);
    bucket.failDownloads.add(stagingRef);
    let calls = 0;
    const call = () =>
      generate(fixture, bucket, 0, now + 100, async () => {
        calls += 1;
        return {
          status: 'success',
          bytes: raw,
          usage: null,
          priorBillingRisk: false,
          metered: false,
        };
      });
    await expect(call()).rejects.toMatchObject({ code: 'uncertain_state' });
    await expect(call()).rejects.toMatchObject({ code: 'uncertain_state' });
    expect(calls).toBe(1);
    const plan = validateVisualPlanRun(
      (await db.doc(`visualPlanRuns/${fixture.opaquePlanId}`).get()).data(),
    );
    expect(plan.status).toBe('abandoned');
    expect(
      (
        await db
          .doc(`visualPlanLeases/${computeVisualPlanLeaseId(fixture.ownerUid, fixture.lessonId)}`)
          .get()
      ).exists,
    ).toBe(false);
  });

  it('invocation_unknown su piano singolo chiude il piano, rilascia la lease e non ritenta', async () => {
    const now = Date.now();
    const fixture = await seedIndependentPlan({ db, now, slotCount: 1 });
    const bucket = new MemoryBucket();
    let calls = 0;
    const call = () =>
      generate(fixture, bucket, 0, now + 100, async () => {
        calls += 1;
        return { status: 'invocation_unknown' };
      });
    await expect(call()).rejects.toMatchObject({ code: 'uncertain_state' });
    const plan = validateVisualPlanRun(
      (await db.doc(`visualPlanRuns/${fixture.opaquePlanId}`).get()).data(),
    );
    expect(plan).toMatchObject({
      status: 'abandoned',
      slots: [{ state: 'failed', attempts: 1, lastError: 'uncertain_outcome' }],
    });
    expect(
      (
        await db
          .doc(`visualPlanLeases/${computeVisualPlanLeaseId(fixture.ownerUid, fixture.lessonId)}`)
          .get()
      ).exists,
    ).toBe(false);
    await expect(call()).rejects.toMatchObject({ code: 'uncertain_state' });
    expect(calls).toBe(1);
  });

  it('412 con byte divergenti è terminale corrupted e non ritenta il provider', async () => {
    const now = Date.now();
    const fixture = await seedIndependentPlan({ db, now, slotCount: 1 });
    const bucket = new MemoryBucket();
    const stagingRef = `staging/${fixture.ownerUid}/${fixture.opaquePlanId}/0.webp`;
    bucket.data.set(stagingRef, Buffer.from('byte estranei'));
    let calls = 0;
    const call = () =>
      generate(fixture, bucket, 0, now + 100, async () => {
        calls += 1;
        return {
          status: 'success',
          bytes: raw,
          usage: null,
          priorBillingRisk: false,
          metered: false,
        };
      });
    await expect(call()).rejects.toMatchObject({ code: 'corrupted_state' });
    await expect(call()).rejects.toMatchObject({ code: 'corrupted_state' });
    expect(calls).toBe(1);
    const plan = validateVisualPlanRun(
      (await db.doc(`visualPlanRuns/${fixture.opaquePlanId}`).get()).data(),
    );
    expect(plan.status).toBe('abandoned');
    expect(plan.slots[0]).toMatchObject({ state: 'failed', lastError: 'staging_conflict' });
    expect(
      (
        await db
          .doc(`visualPlanLeases/${computeVisualPlanLeaseId(fixture.ownerUid, fixture.lessonId)}`)
          .get()
      ).exists,
    ).toBe(false);
  });

  it('replay promozione rilegge manifest e byte live e rifiuta una mutazione editoriale', async () => {
    const now = Date.now();
    const fixture = await seedIndependentPlan({ db, now, slotCount: 1 });
    const bucket = new MemoryBucket();
    await generate(fixture, bucket, 0, now + 100, async () => ({
      status: 'success',
      bytes: raw,
      usage: null,
      priorBillingRisk: false,
      metered: false,
    }));
    const input = {
      requestId: fixture.requestId,
      programId: fixture.programId,
      importId: fixture.importId,
      lessonId: fixture.lessonId,
      slotIndex: 0,
      promotionRequestId: randomUUID(),
      mode: { mode: 'add' as const },
    };
    await promoteVisualPlanSlotForOwner({
      db,
      bucket,
      ownerUid: fixture.ownerUid,
      input,
      nowMs: now + 200,
      generateAssetId: randomUUID,
    });
    const validReplay = await promoteVisualPlanSlotForOwner({
      db,
      bucket,
      ownerUid: fixture.ownerUid,
      input,
      nowMs: now + 300,
      generateAssetId: randomUUID,
    });
    expect(validReplay.replayed).toBe(true);
    const lessonRef = db.doc(
      `programs/${fixture.programId}/imports/${fixture.importId}/lessons/${fixture.lessonId}`,
    );
    const lesson = (await lessonRef.get()).data()!;
    await lessonRef.update({
      visuals: {
        ...lesson.visuals,
        items: [{ ...lesson.visuals.items[0], caption: 'Didascalia alterata' }],
      },
    });
    await expect(
      promoteVisualPlanSlotForOwner({
        db,
        bucket,
        ownerUid: fixture.ownerUid,
        input,
        nowMs: now + 400,
      }),
    ).rejects.toMatchObject({ code: 'corrupted_state' });
  });

  it('una proiezione pubblica divergente blocca add senza ripararla silenziosamente', async () => {
    const now = Date.now();
    const fixture = await seedIndependentPlan({ db, now, slotCount: 2, completed: true });
    const bucket = new MemoryBucket();
    const success = async () => ({
      status: 'success' as const,
      bytes: raw,
      usage: null,
      priorBillingRisk: false as const,
      metered: false as const,
    });
    await generate(fixture, bucket, 0, now + 100, success);
    await promoteVisualPlanSlotForOwner({
      db,
      bucket,
      ownerUid: fixture.ownerUid,
      input: {
        requestId: fixture.requestId,
        programId: fixture.programId,
        importId: fixture.importId,
        lessonId: fixture.lessonId,
        slotIndex: 0,
        promotionRequestId: randomUUID(),
        mode: { mode: 'add' },
      },
      nowMs: now + 200,
      generateAssetId: randomUUID,
    });
    const publicRef = db.doc(`publicLessons/${fixture.publicLessonId}`);
    const publicBefore = (await publicRef.get()).data()!;
    const divergent = {
      ...publicBefore.visuals,
      items: [{ ...publicBefore.visuals.items[0], caption: 'Proiezione divergente' }],
    };
    await publicRef.update({ visuals: divergent });
    await generate(fixture, bucket, 1, now + 300, success);
    const secondPromotionInput = {
      requestId: fixture.requestId,
      programId: fixture.programId,
      importId: fixture.importId,
      lessonId: fixture.lessonId,
      slotIndex: 1,
      promotionRequestId: randomUUID(),
      mode: { mode: 'add' as const },
    };
    await expect(
      promoteVisualPlanSlotForOwner({
        db,
        bucket,
        ownerUid: fixture.ownerUid,
        input: secondPromotionInput,
        nowMs: now + 400,
        generateAssetId: randomUUID,
      }),
    ).rejects.toMatchObject({ code: 'corrupted_state' });
    expect((await publicRef.get()).data()!.visuals).toEqual(divergent);
    const privateLesson = (
      await db
        .doc(
          `programs/${fixture.programId}/imports/${fixture.importId}/lessons/${fixture.lessonId}`,
        )
        .get()
    ).data()!;
    expect(privateLesson.visuals.items).toHaveLength(1);
    await publicRef.update({ visuals: publicBefore.visuals });
    const publicBytesRef = db.doc(`publicLessonVisuals/${fixture.publicLessonId}`);
    await publicBytesRef.update({ programId: 'programma-divergente' });
    await expect(
      promoteVisualPlanSlotForOwner({
        db,
        bucket,
        ownerUid: fixture.ownerUid,
        input: secondPromotionInput,
        nowMs: now + 500,
      }),
    ).rejects.toMatchObject({ code: 'corrupted_state' });
    expect((await publicBytesRef.get()).data()!.programId).toBe('programma-divergente');
  });

  it.each(['slotIndex', 'assetId'] as const)(
    'registro storico con %s divergente blocca nuova promozione e replay senza scritture',
    async (mutation) => {
      const now = Date.now();
      const fixture = await seedIndependentPlan({ db, now, slotCount: 2 });
      const bucket = new MemoryBucket();
      const success = async () => ({
        status: 'success' as const,
        bytes: raw,
        usage: null,
        priorBillingRisk: false as const,
        metered: false as const,
      });
      await generate(fixture, bucket, 0, now + 100, success);
      const firstInput = {
        requestId: fixture.requestId,
        programId: fixture.programId,
        importId: fixture.importId,
        lessonId: fixture.lessonId,
        slotIndex: 0,
        promotionRequestId: randomUUID(),
        mode: { mode: 'add' as const },
      };
      await promoteVisualPlanSlotForOwner({
        db,
        bucket,
        ownerUid: fixture.ownerUid,
        input: firstInput,
        nowMs: now + 200,
        generateAssetId: randomUUID,
      });
      await generate(fixture, bucket, 1, now + 300, success);
      const recordRef = db.doc(
        `visualPlanPromotions/${computeOpaqueVisualPlanSlotRunId(
          fixture.ownerUid,
          fixture.opaquePlanId,
          0,
        )}`,
      );
      if (mutation === 'slotIndex') {
        await recordRef.update({ slotIndex: 1 });
      } else {
        const alienAssetId = randomUUID();
        await recordRef.update({
          assetId: alienAssetId,
          storageRef: `repository/${fixture.ownerUid}/${fixture.importId}/uda-01/visuals/${alienAssetId}.webp`,
        });
      }
      const planRef = db.doc(`visualPlanRuns/${fixture.opaquePlanId}`);
      const lessonRef = db.doc(
        `programs/${fixture.programId}/imports/${fixture.importId}/lessons/${fixture.lessonId}`,
      );
      const beforePlan = (await planRef.get()).data();
      const beforeLesson = (await lessonRef.get()).data();
      const beforeAudits = await db
        .collection('auditEvents')
        .where('targetId', '==', fixture.lessonId)
        .get();
      await expect(
        promoteVisualPlanSlotForOwner({
          db,
          bucket,
          ownerUid: fixture.ownerUid,
          input: firstInput,
          nowMs: now + 400,
        }),
      ).rejects.toMatchObject({ code: 'corrupted_state' });
      const secondAssetId = randomUUID();
      await expect(
        promoteVisualPlanSlotForOwner({
          db,
          bucket,
          ownerUid: fixture.ownerUid,
          input: {
            requestId: fixture.requestId,
            programId: fixture.programId,
            importId: fixture.importId,
            lessonId: fixture.lessonId,
            slotIndex: 1,
            promotionRequestId: randomUUID(),
            mode: { mode: 'add' },
          },
          nowMs: now + 500,
          generateAssetId: () => secondAssetId,
        }),
      ).rejects.toMatchObject({ code: 'corrupted_state' });
      expect((await planRef.get()).data()).toEqual(beforePlan);
      expect((await lessonRef.get()).data()).toEqual(beforeLesson);
      expect(
        (await db.collection('auditEvents').where('targetId', '==', fixture.lessonId).get()).size,
      ).toBe(beforeAudits.size);
      expect(
        bucket.data.has(
          `repository/${fixture.ownerUid}/${fixture.importId}/uda-01/visuals/${secondAssetId}.webp`,
        ),
      ).toBe(false);
    },
  );

  it('una race dopo le letture forza il retry Firestore e committa una sola promozione coerente', async () => {
    const now = Date.now();
    const fixture = await seedIndependentPlan({ db, now, slotCount: 1 });
    const bucket = new MemoryBucket();
    await generate(fixture, bucket, 0, now + 100, async () => ({
      status: 'success',
      bytes: raw,
      usage: null,
      priorBillingRisk: false,
      metered: false,
    }));
    const lessonRef = db.doc(
      `programs/${fixture.programId}/imports/${fixture.importId}/lessons/${fixture.lessonId}`,
    );
    let callbacks = 0;
    let raced = false;
    const result = await promoteVisualPlanSlotForOwner({
      db,
      bucket,
      ownerUid: fixture.ownerUid,
      input: {
        requestId: fixture.requestId,
        programId: fixture.programId,
        importId: fixture.importId,
        lessonId: fixture.lessonId,
        slotIndex: 0,
        promotionRequestId: randomUUID(),
        mode: { mode: 'add' },
      },
      nowMs: now + 200,
      generateAssetId: randomUUID,
      afterPromotionReads: async () => {
        callbacks += 1;
        if (!raced) {
          raced = true;
          // Firestore usa ABORTED (gRPC 10) per una race ottimistica. L'errore
          // iniettato attraversa lo stesso retry del client Admin senza
          // introdurre una scrittura fuori transazione che, col lock
          // pessimista dell'Emulator, produrrebbe un deadlock artificiale.
          throw Object.assign(new Error('forced transaction contention'), { code: 10 });
        }
      },
    });
    expect(result.replayed).toBe(false);
    expect(callbacks).toBeGreaterThanOrEqual(2);
    expect((await lessonRef.get()).data()!.visuals.items).toHaveLength(1);
    const audits = await db
      .collection('auditEvents')
      .where('targetId', '==', fixture.lessonId)
      .get();
    expect(audits.size).toBe(1);
  }, 15_000);

  it('replace autorizzato usa soltanto il target congelato nel piano', async () => {
    const now = Date.now();
    const target = randomUUID();
    const fixture = await seedIndependentPlan({
      db,
      now,
      slotCount: 1,
      replacementAssetId: target,
    });
    const bucket = new MemoryBucket();
    await generate(fixture, bucket, 0, now + 100, async () => ({
      status: 'success',
      bytes: raw,
      usage: null,
      priorBillingRisk: false,
      metered: false,
    }));
    const replacement = randomUUID();
    const result = await promoteVisualPlanSlotForOwner({
      db,
      bucket,
      ownerUid: fixture.ownerUid,
      input: {
        requestId: fixture.requestId,
        programId: fixture.programId,
        importId: fixture.importId,
        lessonId: fixture.lessonId,
        slotIndex: 0,
        promotionRequestId: randomUUID(),
        mode: { mode: 'replace', replaceAssetId: target },
      },
      nowMs: now + 200,
      generateAssetId: () => replacement,
    });
    expect(result.plan.slots[0]?.promotedAssetId).toBe(replacement);
    const lesson = (
      await db
        .doc(
          `programs/${fixture.programId}/imports/${fixture.importId}/lessons/${fixture.lessonId}`,
        )
        .get()
    ).data()!;
    expect(lesson.visuals.items.map((item: { assetId: string }) => item.assetId)).toEqual([
      replacement,
    ]);
  });
});
