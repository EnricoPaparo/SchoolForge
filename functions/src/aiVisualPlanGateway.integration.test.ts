import { randomUUID } from 'node:crypto';
import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  OPENAI_RUNTIME_LUNA_MODEL,
  OPENAI_RUNTIME_LUNA_PRICE_LIST_VERSION,
} from './aiCorrectionCost.js';
import { AiContentError, computeBudgetReservationKey, timestampToMillis } from './aiContentCore.js';
import { monthKeyFromMs } from './aiCorrectionBudget.js';
import { AiVisualMultiError, computeVisualPlanHash } from './aiVisualMultiCore.js';
import {
  computeVisualPlanTotalReserved,
  validateVisualPlanRun,
  validateVisualPlanAuthorizeInput,
  type VisualPlanRun,
} from './aiVisualMultiPlan.js';
import { computeOpaqueVisualPlanId, VISUAL_PLAN_CONTRACT_VERSION } from './aiVisualMultiCore.js';
import {
  computeVisualPlanLeaseId,
  validateVisualPlanLease,
  VISUAL_PLAN_LEASE_CONTRACT_VERSION,
  type VisualPlanLease,
} from './aiVisualPlanLease.js';

const { authorizeVisualPlanForOwner, createVisualPlanForOwner, resumeCoordinatedProposal } =
  await import('./aiVisualPlanGateway.js');

const emulatorDescribe = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;

const OWNER_UID = 'emulator-plan-owner';
const PROGRAM_ID = 'plan-program-1';
const IMPORT_ID = 'plan-import-1';
const UDA_DIR = 'uda-1';
const LESSON_FILENAME = 'lezione-1.md';
const LESSON_PATH_FIELD = `${UDA_DIR}/${LESSON_FILENAME}`;
const LESSON_BODY = '## Introduzione\n\nTesto introduttivo.\n\n## Reti\n\nContenuto sulle reti.';

function singularVisual(assetId: string): Record<string, unknown> {
  return {
    assetId,
    storageRef: `repository/${OWNER_UID}/${IMPORT_ID}/${UDA_DIR}/visuals/${assetId}.webp`,
    anchor: { headingSlug: 'reti', headingText: 'Reti', placement: 'after-heading' },
    caption: 'Didascalia.',
    altText: 'Testo alternativo.',
    width: 800,
    height: 600,
    byteLength: 12_345,
    sha256: 'd'.repeat(64),
    mimeType: 'image/webp',
    styleVersion: 'schoolforge-sketch/v1',
    sourceBodyHash: 'e'.repeat(64),
    approvedAt: Timestamp.now(),
  };
}

function multiVisualItem(assetId: string): Record<string, unknown> {
  return { ...singularVisual(assetId), source: 'generated' };
}

const AI_CONFIG = {
  enabled: true,
  provider: 'openai' as const,
  model: OPENAI_RUNTIME_LUNA_MODEL,
  environment: 'dev' as const,
  limits: {
    maxSubmissionsPerOperation: 30,
    maxOpenQuestionsPerSubmission: 20,
    maxEstimatedTokensPerSubmission: 10_000,
    maxEstimatedTokensPerOperation: 300_000,
    maxProviderConcurrency: 3,
    attemptTimeoutMs: 60_000,
    maxApplicationRetries: 1,
  },
  maxOperationCostMicroUsd: 250_000,
  dailyBudgetMicroUsd: 1_000_000,
  monthlyBudgetMicroUsd: 5_000_000,
  configVersion: 'v1',
  priceListVersion: OPENAI_RUNTIME_LUNA_PRICE_LIST_VERSION,
};

function authorizePayload(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    requestId: randomUUID(),
    programId: PROGRAM_ID,
    importId: IMPORT_ID,
    lessonId: 'lesson-1',
    quantity: { mode: 'auto', ceiling: 2 },
    replacementAssetId: null,
    titolo: 'Le reti',
    sottotitolo: null,
    difficolta: 'base',
    concettiChiave: ['reti'],
    obiettivi: ['comprendere le reti'],
    udaTitle: 'UDA 1',
    udaContext: {
      title: 'UDA 1',
      descrizione: null,
      competenze: [],
      obiettivi: [],
      currentLessonPosition: 1,
      lessons: [{ position: 1, titolo: 'Le reti', sottotitolo: null }],
    },
    ...over,
  };
}

emulatorDescribe('aiVisualPlanAuthorize — Firestore Emulator reale (MULTI-VISUAL-03A)', () => {
  let app: App;
  let db: Firestore;
  const touchedRefs: FirebaseFirestore.DocumentReference[] = [];

  beforeAll(async () => {
    app = initializeApp(
      { projectId: process.env.GCLOUD_PROJECT ?? 'demo-schoolforge' },
      `ai-visual-plan-${randomUUID()}`,
    );
    db = getFirestore(app);
    await db.doc('settings/owner').set({ ownerUid: OWNER_UID });
    await db.doc('settings/aiConfig').set(AI_CONFIG);
  });

  afterEach(async () => {
    await Promise.all(touchedRefs.splice(0).map((ref) => ref.delete().catch(() => undefined)));
    const monthKey = new Date().toISOString().slice(0, 7);
    await db
      .doc(`aiBudgetLedger/${monthKey}`)
      .delete()
      .catch(() => undefined);
  });

  afterAll(async () => {
    await db
      .doc('settings/owner')
      .delete()
      .catch(() => undefined);
    await db
      .doc('settings/aiConfig')
      .delete()
      .catch(() => undefined);
    await deleteApp(app);
  });

  async function seedLesson(
    lessonId: string,
    publicLessonId: string,
    body = LESSON_BODY,
  ): Promise<void> {
    const lessonRef = db.doc(`programs/${PROGRAM_ID}/imports/${IMPORT_ID}/lessons/${lessonId}`);
    const publicRef = db.doc(`publicLessons/${publicLessonId}`);
    await lessonRef.set({
      ownerUid: OWNER_UID,
      importId: IMPORT_ID,
      udaDir: UDA_DIR,
      path: LESSON_PATH_FIELD,
      filename: LESSON_FILENAME,
      publicLessonId,
      completed: false,
    });
    await publicRef.set({
      ownerUid: OWNER_UID,
      programId: PROGRAM_ID,
      importId: IMPORT_ID,
      udaDir: UDA_DIR,
      path: LESSON_PATH_FIELD,
      filename: LESSON_FILENAME,
      content: body,
      completed: false,
    });
    touchedRefs.push(lessonRef, publicRef);
  }

  function call(
    payload: Record<string, unknown>,
    nowMs = Date.now(),
    overrides: Partial<Parameters<typeof authorizeVisualPlanForOwner>[0]> = {},
  ) {
    const input = validateVisualPlanAuthorizeInput(payload);
    return authorizeVisualPlanForOwner({
      db,
      ownerUid: OWNER_UID,
      input,
      clock: () => nowMs,
      mode: 'mock',
      visualMode: 'mock',
      secret: undefined,
      ...overrides,
    });
  }

  function planRef(requestId: string): FirebaseFirestore.DocumentReference {
    return db.doc(`visualPlanRuns/${computeOpaqueVisualPlanId(OWNER_UID, requestId)}`);
  }

  function leaseRef(lessonId: string): FirebaseFirestore.DocumentReference {
    return db.doc(`visualPlanLeases/${computeVisualPlanLeaseId(OWNER_UID, lessonId)}`);
  }

  async function ledgerReservationCount(): Promise<number> {
    const monthKey = new Date().toISOString().slice(0, 7);
    const snap = await db.doc(`aiBudgetLedger/${monthKey}`).get();
    if (!snap.exists) return 0;
    const reservations = (snap.data()?.reservations ?? {}) as Record<string, unknown>;
    return Object.keys(reservations).length;
  }

  it('crea il piano, prenota il budget una sola volta e propone: mock ⇒ zero decisioni ⇒ abandoned, lease rilasciato subito', async () => {
    const lessonId = `lesson-${randomUUID()}`;
    const publicLessonId = `public-${lessonId}`;
    await seedLesson(lessonId, publicLessonId);
    const requestId = randomUUID();
    touchedRefs.push(planRef(requestId), leaseRef(lessonId));

    const plan = await call(authorizePayload({ requestId, lessonId }));

    expect(plan.status).toBe('abandoned');
    expect(plan.slots).toEqual([]);
    expect(plan.settlement.proposalActualCost).toBe(0);
    expect(plan.budgetCeiling.totalReserved).toBe(
      computeVisualPlanTotalReserved({
        proposalCap: plan.budgetCeiling.proposalCap,
        generationCap: plan.budgetCeiling.generationCap,
        ceiling: plan.quantity.ceiling,
        maxAttemptsPerSlot: plan.budgetCeiling.maxAttemptsPerSlot,
      }),
    );

    // Rilascio immediato del lease su stato terminale (§10.3, §8.7).
    const leaseSnap = await leaseRef(lessonId).get();
    expect(leaseSnap.exists).toBe(false);

    // Il piano persistito supera anche il validatore fail-closed.
    expect(() => validateVisualPlanRun(plan)).not.toThrow();

    // Nessuna prenotazione residua sul ledger: rilasciata dalla riconciliazione
    // interna di `generateContent` allo stesso costo reale (§12.1).
    expect(await ledgerReservationCount()).toBe(0);
  });

  it('replay con lo stesso requestId: nessuna nuova prenotazione né una seconda proposta', async () => {
    const lessonId = `lesson-${randomUUID()}`;
    const publicLessonId = `public-${lessonId}`;
    await seedLesson(lessonId, publicLessonId);
    const requestId = randomUUID();
    touchedRefs.push(planRef(requestId), leaseRef(lessonId));

    const first = await call(authorizePayload({ requestId, lessonId }));
    const second = await call(authorizePayload({ requestId, lessonId }));

    expect(second.status).toBe(first.status);
    expect(second.updatedAt).toEqual(first.updatedAt);
    expect(second.planHash).toBe(first.planHash);
    expect(await ledgerReservationCount()).toBe(0);
  });

  it('costo proposta non-zero con slot image usa la prenotazione master e conserva solo la quota generation', async () => {
    const lessonId = `lesson-${randomUUID()}`;
    const publicLessonId = `public-${lessonId}`;
    await seedLesson(lessonId, publicLessonId);
    const requestId = randomUUID();
    touchedRefs.push(planRef(requestId), leaseRef(lessonId));

    const plan = await call(authorizePayload({ requestId, lessonId }), Date.now(), {
      visualMode: 'openai',
      callProviderOverride: async () => ({
        status: 'ok',
        output: {
          decisions: [
            {
              decision: 'image',
              subject: 'Schema di una rete di computer con nodi e collegamenti',
              rationale: 'Rende visibile la topologia descritta nel testo della lezione.',
              anchor: { anchorHeadingIndex: 1, anchorHeadingText: 'Reti' },
              caption: 'Nodi e collegamenti in una rete.',
              altText: 'Schema di computer collegati fra loro in una rete.',
            },
          ],
        },
        usage: { inputTokens: 100, outputTokens: 100 },
        metered: true,
        priorBillingRisk: false,
      }),
    });

    expect(plan.status).toBe('proposed');
    expect(plan.slots).toHaveLength(1);
    expect(plan.slots[0]?.decision).toBe('image');
    expect(plan.settlement.proposalActualCost).toBeGreaterThan(0);
    // Il provider resta simulato; solo la stima del costo immagini è reale.
    expect(plan.budgetCeiling.generationCap).toBeGreaterThan(0);
    const ledger = await db.doc(`aiBudgetLedger/${plan.budgetCeiling.reservationMonthKey}`).get();
    const reservation = ledger.data()?.reservations?.[plan.budgetCeiling.reservationKey];
    expect(reservation?.microUsd).toBe(
      plan.budgetCeiling.generationCap * plan.budgetCeiling.maxAttemptsPerSlot,
    );
  });

  it('fallimento provider fatturabile chiude il piano e non può richiamare la proposta', async () => {
    const lessonId = `lesson-${randomUUID()}`;
    const publicLessonId = `public-${lessonId}`;
    await seedLesson(lessonId, publicLessonId);
    const requestId = randomUUID();
    touchedRefs.push(planRef(requestId), leaseRef(lessonId));
    let providerCalls = 0;
    const payload = authorizePayload({ requestId, lessonId });

    await expect(
      call(payload, Date.now(), {
        callProviderOverride: async () => {
          providerCalls += 1;
          return { status: 'error', phase: 'invocation_unknown', reason: 'other' };
        },
      }),
    ).rejects.toMatchObject({ code: 'provider_unavailable' });

    const failedPlan = validateVisualPlanRun((await planRef(requestId).get()).data());
    expect(failedPlan.status).toBe('abandoned');
    expect(failedPlan.settlement.proposalActualCost).toBeNull();
    expect((await leaseRef(lessonId).get()).exists).toBe(false);
    expect(await ledgerReservationCount()).toBe(0);

    await expect(
      call(payload, Date.now(), {
        mode: 'disabled',
        callProviderOverride: async () => {
          providerCalls += 1;
          throw new Error('provider non deve essere richiamato');
        },
      }),
    ).rejects.toMatchObject({ code: 'provider_unavailable' });
    expect(providerCalls).toBe(1);
  });

  it('replay terminale precede config, LessonDoc, lease, budget e provider anche se assenti o malformati', async () => {
    const lessonId = `lesson-${randomUUID()}`;
    const publicLessonId = `public-${lessonId}`;
    await seedLesson(lessonId, publicLessonId);
    const requestId = randomUUID();
    const payload = authorizePayload({ requestId, lessonId });
    touchedRefs.push(planRef(requestId), leaseRef(lessonId));
    const first = await call(payload);

    const lessonRef = db.doc(`programs/${PROGRAM_ID}/imports/${IMPORT_ID}/lessons/${lessonId}`);
    const publicRef = db.doc(`publicLessons/${publicLessonId}`);
    const ledgerRef = db.doc(`aiBudgetLedger/${first.budgetCeiling.reservationMonthKey}`);
    await Promise.all([
      db.doc('settings/aiConfig').delete(),
      lessonRef.delete(),
      publicRef.set({ malformed: true }),
      leaseRef(lessonId).set({ malformed: true }),
      ledgerRef.set({ malformed: true }),
    ]);

    let configReads = 0;
    let providerCalls = 0;
    try {
      const replay = await call(payload, Date.now(), {
        mode: 'disabled',
        loadConfigOverride: async () => {
          configReads += 1;
          return null;
        },
        callProviderOverride: async () => {
          providerCalls += 1;
          throw new Error('provider non deve essere chiamato');
        },
      });
      expect(replay.status).toBe(first.status);
      expect(replay.updatedAt).toEqual(first.updatedAt);
      expect(configReads).toBe(0);
      expect(providerCalls).toBe(0);
    } finally {
      await db.doc('settings/aiConfig').set(AI_CONFIG);
    }
  });

  it("due autorizzazioni concorrenti sulla stessa lezione: una sola vince il lease, l'altra riceve visual_plan_already_active", async () => {
    const lessonId = `lesson-${randomUUID()}`;
    const publicLessonId = `public-${lessonId}`;
    await seedLesson(lessonId, publicLessonId);
    const requestIdA = randomUUID();
    const requestIdB = randomUUID();
    const inputA = validateVisualPlanAuthorizeInput(
      authorizePayload({ requestId: requestIdA, lessonId }),
    );
    const inputB = validateVisualPlanAuthorizeInput(
      authorizePayload({ requestId: requestIdB, lessonId }),
    );
    const nowMs = Date.now();
    touchedRefs.push(planRef(requestIdA), planRef(requestIdB), leaseRef(lessonId));

    // Sola acquisizione: la proposta mock vuota rilascerebbe subito il lease,
    // consentendo correttamente a entrambe le richieste di riuscire in sequenza.
    const results = await Promise.allSettled([
      createVisualPlanForOwner({
        db,
        ownerUid: OWNER_UID,
        input: inputA,
        opaquePlanId: computeOpaqueVisualPlanId(OWNER_UID, requestIdA),
        config: AI_CONFIG,
        visualMode: 'mock',
        nowMs,
      }),
      createVisualPlanForOwner({
        db,
        ownerUid: OWNER_UID,
        input: inputB,
        opaquePlanId: computeOpaqueVisualPlanId(OWNER_UID, requestIdB),
        config: AI_CONFIG,
        visualMode: 'mock',
        nowMs,
      }),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    const rejection = (rejected[0] as PromiseRejectedResult).reason;
    expect(rejection).toBeInstanceOf(AiVisualMultiError);
    expect((rejection as AiVisualMultiError).code).toBe('visual_plan_already_active');
    expect((rejection as AiVisualMultiError).details).toMatchObject({
      opaquePlanId: expect.any(String),
    });

    const leaseSnap = await leaseRef(lessonId).get();
    expect(leaseSnap.exists).toBe(true);
    const lease = validateVisualPlanLease(leaseSnap.data());
    expect(timestampToMillis(lease.expireAt)).toBeGreaterThan(nowMs);
  });

  it('risposta persa dopo completed AIGEN viene ripresa come replay senza seconda chiamata provider', async () => {
    const lessonId = `lesson-${randomUUID()}`;
    const publicLessonId = `public-${lessonId}`;
    await seedLesson(lessonId, publicLessonId);
    const requestId = randomUUID();
    const input = validateVisualPlanAuthorizeInput(authorizePayload({ requestId, lessonId }));
    const startedAt = Date.now();
    touchedRefs.push(planRef(requestId), leaseRef(lessonId));
    const plan = await createVisualPlanForOwner({
      db,
      ownerUid: OWNER_UID,
      input,
      opaquePlanId: computeOpaqueVisualPlanId(OWNER_UID, requestId),
      config: AI_CONFIG,
      visualMode: 'mock',
      nowMs: startedAt,
    });
    let providerCalls = 0;
    const providerResult = {
      status: 'ok' as const,
      output: {
        decisions: [
          {
            decision: 'image',
            subject: 'Schema coordinato dei nodi principali della rete',
            rationale: 'Mostra le relazioni spaziali fra i nodi descritte nel testo.',
            anchor: { anchorHeadingIndex: 1, anchorHeadingText: 'Reti' },
            caption: 'Nodi principali della rete.',
            altText: 'Schema di più nodi collegati in una rete.',
          },
        ],
      },
      usage: { inputTokens: 0, outputTokens: 0 },
      metered: false,
      priorBillingRisk: false,
    };

    await expect(
      resumeCoordinatedProposal({
        db,
        plan,
        input,
        config: AI_CONFIG,
        mode: 'mock',
        secret: undefined,
        clock: () => startedAt + 1,
        callProviderOverride: async () => {
          providerCalls += 1;
          return providerResult;
        },
        afterProposalResult: async () => {
          throw new Error('simulated response loss');
        },
      }),
    ).rejects.toThrow('simulated response loss');

    const replayed = await resumeCoordinatedProposal({
      db,
      plan,
      input,
      config: AI_CONFIG,
      mode: 'mock',
      secret: undefined,
      clock: () => startedAt + 2,
      callProviderOverride: async () => {
        providerCalls += 1;
        throw new Error('provider non deve essere richiamato');
      },
    });
    expect(replayed.status).toBe('proposed');
    expect(replayed.slots[0]?.decision).toBe('image');
    expect(providerCalls).toBe(1);
  });

  it('race A lenta/B takeover: A perde ownership e la finalizzazione produce zero scritture sul piano', async () => {
    const lessonId = `lesson-${randomUUID()}`;
    const publicLessonId = `public-${lessonId}`;
    await seedLesson(lessonId, publicLessonId);
    const requestIdA = randomUUID();
    const requestIdB = randomUUID();
    const inputA = validateVisualPlanAuthorizeInput(
      authorizePayload({ requestId: requestIdA, lessonId }),
    );
    const startedAt = Date.now();
    touchedRefs.push(planRef(requestIdA), planRef(requestIdB), leaseRef(lessonId));
    const planA = await createVisualPlanForOwner({
      db,
      ownerUid: OWNER_UID,
      input: inputA,
      opaquePlanId: computeOpaqueVisualPlanId(OWNER_UID, requestIdA),
      config: AI_CONFIG,
      visualMode: 'mock',
      nowMs: startedAt,
    });

    let raceNowMs = startedAt + 1;
    let releaseProvider!: () => void;
    let signalProviderStarted!: () => void;
    const providerStarted = new Promise<void>((resolve) => {
      signalProviderStarted = resolve;
    });
    const providerRelease = new Promise<void>((resolve) => {
      releaseProvider = resolve;
    });
    const slowA = resumeCoordinatedProposal({
      db,
      plan: planA,
      input: inputA,
      config: AI_CONFIG,
      mode: 'mock',
      secret: undefined,
      clock: () => raceNowMs,
      callProviderOverride: async () => {
        signalProviderStarted();
        await providerRelease;
        return {
          status: 'ok',
          output: {
            decisions: [
              {
                decision: 'image',
                subject: 'Schema dei nodi principali della rete',
                rationale: 'Rende visibili i collegamenti descritti nella lezione.',
                anchor: { anchorHeadingIndex: 1, anchorHeadingText: 'Reti' },
                caption: 'Nodi collegati nella rete.',
                altText: 'Schema di più nodi collegati in una rete.',
              },
            ],
          },
          usage: { inputTokens: 0, outputTokens: 0 },
          metered: false,
          priorBillingRisk: false,
        };
      },
    });
    await providerStarted;
    const beforeTakeover = validateVisualPlanRun((await planRef(requestIdA).get()).data());
    expect(beforeTakeover.status).toBe('proposing');

    raceNowMs = startedAt + 6 * 60 * 60 * 1_000;
    await call(authorizePayload({ requestId: requestIdB, lessonId }), raceNowMs);
    releaseProvider();
    await expect(slowA).rejects.toMatchObject({ code: 'visual_plan_already_active' });

    const afterLostOwnership = validateVisualPlanRun((await planRef(requestIdA).get()).data());
    expect(afterLostOwnership).toEqual(beforeTakeover);
    const ledger = await db.doc(`aiBudgetLedger/${planA.budgetCeiling.reservationMonthKey}`).get();
    expect(
      ledger.data()?.reservations?.[computeBudgetReservationKey(OWNER_UID, requestIdA)],
    ).toBeUndefined();
  });

  it('piano o lease scaduto viene chiuso prima di LessonDoc/provider e non viene rinnovato', async () => {
    const lessonId = `lesson-${randomUUID()}`;
    const publicLessonId = `public-${lessonId}`;
    await seedLesson(lessonId, publicLessonId);
    const requestId = randomUUID();
    const input = validateVisualPlanAuthorizeInput(authorizePayload({ requestId, lessonId }));
    const startedAt = Date.now();
    touchedRefs.push(planRef(requestId), leaseRef(lessonId));
    const plan = await createVisualPlanForOwner({
      db,
      ownerUid: OWNER_UID,
      input,
      opaquePlanId: computeOpaqueVisualPlanId(OWNER_UID, requestId),
      config: AI_CONFIG,
      visualMode: 'mock',
      nowMs: startedAt,
    });
    await db.doc(`programs/${PROGRAM_ID}/imports/${IMPORT_ID}/lessons/${lessonId}`).delete();
    let providerCalls = 0;

    const expired = await resumeCoordinatedProposal({
      db,
      plan,
      input,
      config: AI_CONFIG,
      mode: 'mock',
      secret: undefined,
      clock: () => startedAt + 86_400_000,
      callProviderOverride: async () => {
        providerCalls += 1;
        throw new Error('provider non deve essere chiamato');
      },
    });
    expect(expired.status).toBe('abandoned');
    expect(providerCalls).toBe(0);
    expect((await leaseRef(lessonId).get()).exists).toBe(false);
    const persisted = await planRef(requestId).get();
    expect(() => validateVisualPlanRun(persisted.data())).not.toThrow();
    const ledger = await db.doc(`aiBudgetLedger/${plan.budgetCeiling.reservationMonthKey}`).get();
    expect(ledger.data()?.reservations?.[plan.budgetCeiling.reservationKey]).toBeUndefined();
  });

  it('lease scaduto con piano vivo rilascia una reservation reserved senza addebito', async () => {
    const lessonId = `lesson-${randomUUID()}`;
    const publicLessonId = `public-${lessonId}`;
    await seedLesson(lessonId, publicLessonId);
    const requestId = randomUUID();
    const input = validateVisualPlanAuthorizeInput(authorizePayload({ requestId, lessonId }));
    const startedAt = Date.now();
    touchedRefs.push(planRef(requestId), leaseRef(lessonId));
    const plan = await createVisualPlanForOwner({
      db,
      ownerUid: OWNER_UID,
      input,
      opaquePlanId: computeOpaqueVisualPlanId(OWNER_UID, requestId),
      config: AI_CONFIG,
      visualMode: 'mock',
      nowMs: startedAt,
    });
    const leaseDocument = validateVisualPlanLease((await leaseRef(lessonId).get()).data());
    await leaseRef(lessonId).set({
      ...leaseDocument,
      expireAt: Timestamp.fromMillis(startedAt + 1_000),
    });

    const closed = await resumeCoordinatedProposal({
      db,
      plan,
      input,
      config: AI_CONFIG,
      mode: 'mock',
      secret: undefined,
      clock: () => startedAt + 2_000,
    });

    expect(closed.status).toBe('abandoned');
    const ledger = await db.doc(`aiBudgetLedger/${plan.budgetCeiling.reservationMonthKey}`).get();
    expect(ledger.data()?.reservations?.[plan.budgetCeiling.reservationKey]).toBeUndefined();
    expect(ledger.data()?.spentMicroUsd).toBe(0);
  });

  it('lease scaduto con reservation pending liquida solo proposalCap, mai totalReserved', async () => {
    const lessonId = `lesson-${randomUUID()}`;
    const publicLessonId = `public-${lessonId}`;
    await seedLesson(lessonId, publicLessonId);
    const requestId = randomUUID();
    const input = validateVisualPlanAuthorizeInput(authorizePayload({ requestId, lessonId }));
    const startedAt = Date.now();
    touchedRefs.push(planRef(requestId), leaseRef(lessonId));
    const plan = await createVisualPlanForOwner({
      db,
      ownerUid: OWNER_UID,
      input,
      opaquePlanId: computeOpaqueVisualPlanId(OWNER_UID, requestId),
      config: AI_CONFIG,
      // Stima positiva delle immagini, senza alcuna invocazione provider.
      visualMode: 'openai',
      nowMs: startedAt,
    });
    const leaseDocument = validateVisualPlanLease((await leaseRef(lessonId).get()).data());
    await leaseRef(lessonId).set({
      ...leaseDocument,
      expireAt: Timestamp.fromMillis(startedAt + 1_000),
    });
    const ledgerRef = db.doc(`aiBudgetLedger/${plan.budgetCeiling.reservationMonthKey}`);
    const ledgerData = (await ledgerRef.get()).data() ?? {};
    await ledgerRef.set({
      ...ledgerData,
      reservations: {
        ...(ledgerData.reservations ?? {}),
        [plan.budgetCeiling.reservationKey]: {
          ...ledgerData.reservations[plan.budgetCeiling.reservationKey],
          status: 'pending',
        },
      },
    });

    const closed = await resumeCoordinatedProposal({
      db,
      plan,
      input,
      config: AI_CONFIG,
      mode: 'mock',
      secret: undefined,
      clock: () => startedAt + 2_000,
    });

    expect(closed.status).toBe('abandoned');
    const ledger = await ledgerRef.get();
    expect(ledger.data()?.reservations?.[plan.budgetCeiling.reservationKey]).toBeUndefined();
    expect(ledger.data()?.spentMicroUsd).toBe(plan.budgetCeiling.proposalCap);
    expect(plan.budgetCeiling.totalReserved).toBeGreaterThan(plan.budgetCeiling.proposalCap);
  });

  it('lease scaduto è riacquisibile nella stessa transazione', async () => {
    const lessonId = `lesson-${randomUUID()}`;
    const publicLessonId = `public-${lessonId}`;
    await seedLesson(lessonId, publicLessonId);
    const staleRequestId = randomUUID();
    // Il lease stantio è internamente coerente (il proprio opaquePlanId
    // deriva dal proprio requestId) ma appartiene a una richiesta DIVERSA
    // da quella che tenterà la riacquisizione: altrimenti l'invariante che
    // rifiuta un lease il cui opaquePlanId coincide con quello corrente in
    // assenza di un piano persistito (lease e piano sono scritti in modo
    // atomico) scatterebbe a torto su questa fixture, che non ha mai
    // persistito un piano.
    const staleLease: VisualPlanLease = {
      contractVersion: VISUAL_PLAN_LEASE_CONTRACT_VERSION,
      ownerUid: OWNER_UID,
      programId: PROGRAM_ID,
      importId: IMPORT_ID,
      lessonId,
      opaquePlanId: computeOpaqueVisualPlanId(OWNER_UID, staleRequestId),
      requestId: staleRequestId,
      createdAt: Timestamp.fromMillis(Date.now() - 100_000),
      updatedAt: Timestamp.fromMillis(Date.now() - 100_000),
      expireAt: Timestamp.fromMillis(Date.now() - 1_000),
    };
    expect(() => validateVisualPlanLease(staleLease)).not.toThrow();
    await leaseRef(lessonId).set(staleLease);
    touchedRefs.push(leaseRef(lessonId));

    const requestId = randomUUID();
    touchedRefs.push(planRef(requestId));
    const plan = await call(authorizePayload({ requestId, lessonId }));
    expect(plan.status).toBe('abandoned'); // mock ⇒ zero decisioni ⇒ terminale, lease già rilasciato di nuovo
  });

  it('lease presente ma malformato ⇒ corrupted_state, zero scritture', async () => {
    const lessonId = `lesson-${randomUUID()}`;
    const publicLessonId = `public-${lessonId}`;
    await seedLesson(lessonId, publicLessonId);
    await leaseRef(lessonId).set({ contractVersion: 'visual-plan-lease/v1' }); // chiavi mancanti
    touchedRefs.push(leaseRef(lessonId));

    const requestId = randomUUID();
    await expect(call(authorizePayload({ requestId, lessonId }))).rejects.toMatchObject({
      code: 'corrupted_state',
    });

    const planSnap = await planRef(requestId).get();
    expect(planSnap.exists).toBe(false);
    expect(await ledgerReservationCount()).toBe(0);
  });

  it('record di piano persistito ma malformato ⇒ corrupted_state', async () => {
    const lessonId = `lesson-${randomUUID()}`;
    const publicLessonId = `public-${lessonId}`;
    await seedLesson(lessonId, publicLessonId);
    const requestId = randomUUID();
    await planRef(requestId).set({ contractVersion: VISUAL_PLAN_CONTRACT_VERSION }); // chiavi mancanti
    touchedRefs.push(planRef(requestId));

    await expect(call(authorizePayload({ requestId, lessonId }))).rejects.toMatchObject({
      code: 'corrupted_state',
    });
  });

  it('identità persistita divergente dalla richiesta corrente ⇒ corrupted_state, mai un piano duplicato', async () => {
    const lessonId = `lesson-${randomUUID()}`;
    const otherLessonId = `lesson-other-${randomUUID()}`;
    const publicLessonId = `public-${lessonId}`;
    const otherPublicLessonId = `public-${otherLessonId}`;
    await seedLesson(lessonId, publicLessonId);
    await seedLesson(otherLessonId, otherPublicLessonId);
    const requestId = randomUUID();
    touchedRefs.push(planRef(requestId));

    // Un record valido ma per un'ALTRA lezione, sotto lo stesso opaquePlanId
    // (stesso ownerUid+requestId): l'identità persistita non coincide con
    // quella della richiesta corrente.
    const divergentCreatedAtMs = Date.now() - 1_000;
    const divergentSourceHash = 'b'.repeat(64);
    const divergentQuantity = { mode: 'auto' as const, ceiling: 1 as const };
    const divergent: VisualPlanRun = {
      contractVersion: VISUAL_PLAN_CONTRACT_VERSION,
      ownerUid: OWNER_UID,
      programId: PROGRAM_ID,
      importId: IMPORT_ID,
      lessonId: otherLessonId,
      publicLessonId: otherPublicLessonId,
      udaDir: UDA_DIR,
      requestId,
      planHash: computeVisualPlanHash({
        ownerUid: OWNER_UID,
        programId: PROGRAM_ID,
        importId: IMPORT_ID,
        lessonId: otherLessonId,
        publicLessonId: otherPublicLessonId,
        sourceBodyHash: divergentSourceHash,
        existingItemAssetIds: [],
        replacementAssetId: null,
        quantity: divergentQuantity,
      }),
      status: 'abandoned',
      quantity: divergentQuantity,
      sourceBodyHash: divergentSourceHash,
      existingItemAssetIds: [],
      replacementAssetId: null,
      budgetCeiling: {
        reservationKey: computeBudgetReservationKey(OWNER_UID, requestId),
        reservationMonthKey: monthKeyFromMs(divergentCreatedAtMs),
        proposalCap: 1,
        generationCap: 1,
        maxAttemptsPerSlot: 2,
        totalReserved: 1 + 1 * 1 * 2,
      },
      slots: [],
      settlement: { proposalActualCost: 0, slots: [] },
      createdAt: Timestamp.fromMillis(divergentCreatedAtMs),
      updatedAt: Timestamp.fromMillis(divergentCreatedAtMs),
      expireAt: Timestamp.fromMillis(divergentCreatedAtMs + 86_400_000),
    };
    await planRef(requestId).set(divergent);

    await expect(call(authorizePayload({ requestId, lessonId }))).rejects.toMatchObject({
      code: 'corrupted_state',
    });
  });

  it("replay dopo promozioni simulate: nessuna rilettura del mondo, il record torna così com'è", async () => {
    const lessonId = `lesson-${randomUUID()}`;
    const publicLessonId = `public-${lessonId}`;
    await seedLesson(lessonId, publicLessonId);
    const requestId = randomUUID();
    touchedRefs.push(planRef(requestId), leaseRef(lessonId));

    // Simula un piano il cui slot 0 è già stato promosso (fuori scope 03A, ma
    // deve poter esistere sotto una lettura futura di 03B) e il cui lease è
    // già stato rilasciato (stato terminale).
    const promotedAssetId = randomUUID();
    const simulatedCreatedAtMs = Date.now() - 10_000;
    const simulatedSourceHash = 'b'.repeat(64);
    const simulatedQuantity = { mode: 'exact' as const, ceiling: 1 as const };
    const simulated: VisualPlanRun = {
      contractVersion: VISUAL_PLAN_CONTRACT_VERSION,
      ownerUid: OWNER_UID,
      programId: PROGRAM_ID,
      importId: IMPORT_ID,
      lessonId,
      publicLessonId,
      udaDir: UDA_DIR,
      requestId,
      planHash: computeVisualPlanHash({
        ownerUid: OWNER_UID,
        programId: PROGRAM_ID,
        importId: IMPORT_ID,
        lessonId,
        publicLessonId,
        sourceBodyHash: simulatedSourceHash,
        existingItemAssetIds: [],
        replacementAssetId: null,
        quantity: simulatedQuantity,
      }),
      status: 'completed',
      quantity: simulatedQuantity,
      sourceBodyHash: simulatedSourceHash, // corpo "originale", ormai diverso da quello live
      existingItemAssetIds: [],
      replacementAssetId: null,
      budgetCeiling: {
        reservationKey: computeBudgetReservationKey(OWNER_UID, requestId),
        reservationMonthKey: monthKeyFromMs(simulatedCreatedAtMs),
        proposalCap: 1000,
        generationCap: 1000,
        maxAttemptsPerSlot: 2,
        totalReserved: computeVisualPlanTotalReserved({
          proposalCap: 1000,
          generationCap: 1000,
          ceiling: 1,
          maxAttemptsPerSlot: 2,
        }),
      },
      slots: [
        {
          slotIndex: 0,
          state: 'promoted',
          decision: 'image',
          subject: 'Un diagramma di rete',
          rationale: 'Chiarisce la topologia.',
          anchor: { anchorHeadingIndex: 1, anchorHeadingText: 'Reti' },
          caption: 'Diagramma di rete.',
          altText: 'Diagramma che mostra una rete di computer.',
          attempts: 1,
          lastError: null,
          staged: null,
          promotedAssetId,
        },
      ],
      settlement: {
        proposalActualCost: 500,
        slots: [{ slotIndex: 0, attempts: 1, actualCost: 1000 }],
      },
      createdAt: Timestamp.fromMillis(simulatedCreatedAtMs),
      updatedAt: Timestamp.fromMillis(simulatedCreatedAtMs + 5_000),
      expireAt: Timestamp.fromMillis(simulatedCreatedAtMs + 86_400_000),
    };
    // Autoverifica del fixture prima di persisterlo: deve essere un record
    // realmente valido secondo lo stesso validatore che il gateway userà.
    expect(() => validateVisualPlanRun(simulated)).not.toThrow();
    await planRef(requestId).set(simulated);
    // Nessun lease: coerente con "rilascio immediato su stato terminale".

    // Cambia il corpo live DOPO la scrittura del piano simulato — se il
    // replay rileggesse il mondo, romperebbe l'identità/il corpo congelato.
    await seedLesson(
      lessonId,
      publicLessonId,
      `${LESSON_BODY}\n\n## Nuova sezione\n\nAggiunta dopo.`,
    );

    const replayed = await call(
      authorizePayload({ requestId, lessonId, quantity: { mode: 'exact', ceiling: 1 } }),
    );

    expect(replayed.status).toBe('completed');
    expect(replayed.slots[0]?.promotedAssetId).toBe(promotedAssetId);
    expect(replayed.sourceBodyHash).toBe('b'.repeat(64)); // MAI ricalcolato
    expect(replayed.updatedAt).toEqual(simulated.updatedAt);
    expect(await ledgerReservationCount()).toBe(0); // nessuna nuova prenotazione
  });

  it('visual_legacy_conflict: visual e visuals co-presenti ⇒ fail-closed, zero scritture', async () => {
    const lessonId = `lesson-${randomUUID()}`;
    const publicLessonId = `public-${lessonId}`;
    await seedLesson(lessonId, publicLessonId);
    const lessonRef = db.doc(`programs/${PROGRAM_ID}/imports/${IMPORT_ID}/lessons/${lessonId}`);
    await lessonRef.update({
      visual: { assetId: randomUUID() },
      visuals: { contractVersion: 'lesson-visuals/v1', items: [] },
    });

    const requestId = randomUUID();
    await expect(call(authorizePayload({ requestId, lessonId }))).rejects.toMatchObject({
      code: 'visual_legacy_conflict',
    });
    const planSnap = await planRef(requestId).get();
    expect(planSnap.exists).toBe(false);
    const leaseSnap = await leaseRef(lessonId).get();
    expect(leaseSnap.exists).toBe(false);
    expect(await ledgerReservationCount()).toBe(0);
  });

  it('visuals malformato ⇒ fail-closed, zero scritture', async () => {
    const lessonId = `lesson-${randomUUID()}`;
    const publicLessonId = `public-${lessonId}`;
    await seedLesson(lessonId, publicLessonId);
    const lessonRef = db.doc(`programs/${PROGRAM_ID}/imports/${IMPORT_ID}/lessons/${lessonId}`);
    await lessonRef.update({ visuals: { contractVersion: 'lesson-visuals/v1' } }); // items mancante

    const requestId = randomUUID();
    await expect(call(authorizePayload({ requestId, lessonId }))).rejects.toMatchObject({
      code: 'visuals_malformed',
    });
    expect((await planRef(requestId).get()).exists).toBe(false);
  });

  it('adozione singolare atomica: converte ogni manifest privato legacy una sola volta', async () => {
    const cases = [
      { lessonId: `legacy-a-${randomUUID()}`, assetId: randomUUID() },
      { lessonId: `legacy-b-${randomUUID()}`, assetId: randomUUID() },
      { lessonId: `legacy-c-${randomUUID()}`, assetId: randomUUID() },
    ];
    for (const { lessonId, assetId } of cases) {
      const publicLessonId = `public-${lessonId}`;
      await seedLesson(lessonId, publicLessonId);
      const lessonRef = db.doc(`programs/${PROGRAM_ID}/imports/${IMPORT_ID}/lessons/${lessonId}`);
      await lessonRef.update({ visual: singularVisual(assetId) });

      const requestId = randomUUID();
      touchedRefs.push(planRef(requestId), leaseRef(lessonId));
      // ceiling 1: 1 slot libero già presente (existingItemAssetIds.length===1) + ceiling 1 === 2 ≤ 3.
      const plan = await call(
        authorizePayload({ requestId, lessonId, quantity: { mode: 'exact', ceiling: 1 } }),
      );
      expect(plan.existingItemAssetIds).toEqual([assetId]);

      // Idempotente: una seconda lettura usa il manifest plurale già adottato.
      const secondRequestId = randomUUID();
      touchedRefs.push(planRef(secondRequestId));
      const plan2 = await call(
        authorizePayload({
          requestId: secondRequestId,
          lessonId,
          quantity: { mode: 'exact', ceiling: 1 },
        }),
      );
      expect(plan2.existingItemAssetIds).toEqual([assetId]);
      const rawSnap = await lessonRef.get();
      expect(rawSnap.data()?.visual).toBeUndefined();
      expect(rawSnap.data()?.visuals?.items?.[0]?.assetId).toBe(assetId);
    }
  });

  it('adozione singolare su lezione completed aggiorna privato e PublicLessonDoc nella stessa transazione', async () => {
    const lessonId = `legacy-completed-${randomUUID()}`;
    const publicLessonId = `public-${lessonId}`;
    const assetId = randomUUID();
    await seedLesson(lessonId, publicLessonId);
    const lessonRef = db.doc(`programs/${PROGRAM_ID}/imports/${IMPORT_ID}/lessons/${lessonId}`);
    const publicRef = db.doc(`publicLessons/${publicLessonId}`);
    const privateVisual = singularVisual(assetId);
    await Promise.all([
      lessonRef.update({ completed: true, visual: privateVisual }),
      publicRef.update({
        completed: true,
        visual: {
          assetId,
          anchor: privateVisual.anchor,
          caption: privateVisual.caption,
          altText: privateVisual.altText,
          width: privateVisual.width,
          height: privateVisual.height,
        },
      }),
    ]);

    const requestId = randomUUID();
    touchedRefs.push(planRef(requestId), leaseRef(lessonId));
    await call(authorizePayload({ requestId, lessonId, quantity: { mode: 'exact', ceiling: 1 } }));

    const [privateSnap, publicSnap] = await Promise.all([lessonRef.get(), publicRef.get()]);
    expect(privateSnap.data()?.visual).toBeUndefined();
    expect(privateSnap.data()?.visuals?.items?.[0]?.assetId).toBe(assetId);
    expect(publicSnap.data()?.visual).toBeUndefined();
    expect(publicSnap.data()?.visuals).toEqual({
      contractVersion: 'lesson-visuals/v1',
      items: [
        {
          assetId,
          anchor: privateVisual.anchor,
          caption: privateVisual.caption,
          altText: privateVisual.altText,
          width: privateVisual.width,
          height: privateVisual.height,
        },
      ],
    });
  });

  it('race lettura→commit: un abort simulato dopo la lettura autoritativa e una mutazione reale tra i tentativi impediscono piano, lease e budget', async () => {
    const lessonId = `lesson-race-${randomUUID()}`;
    const publicLessonId = `public-${lessonId}`;
    await seedLesson(lessonId, publicLessonId);
    const requestId = randomUUID();
    touchedRefs.push(planRef(requestId), leaseRef(lessonId));

    let callbackCount = 0;
    let mutated = false;
    const originalRunTransaction = db.runTransaction.bind(db);
    const spy = vi.spyOn(db, 'runTransaction').mockImplementation((updateFunction, options) =>
      originalRunTransaction(async (transaction) => {
        callbackCount += 1;
        if (callbackCount === 2) {
          // Il primo tentativo è già stato annullato (rollback completato):
          // nessun lock è attivo quando applichiamo questa mutazione reale,
          // prima che il secondo tentativo esegua le proprie letture.
          mutated = true;
          await db.doc(`publicLessons/${publicLessonId}`).update({ completed: true });
        }
        return updateFunction(transaction);
      }, options),
    );

    try {
      await expect(
        call(authorizePayload({ requestId, lessonId }), Date.now(), {
          afterAuthoritativeRead: async () => {
            if (callbackCount === 1) {
              // Iniezione deliberata di un ABORTED (code 10) DOPO che il
              // primo tentativo ha realmente eseguito le proprie letture
              // autoritative, per innescare il retry genuino del client
              // Firestore.
              throw Object.assign(new Error('simulated contention'), { code: 10 });
            }
          },
        }),
      ).rejects.toMatchObject({ code: 'invalid_input' });

      expect(callbackCount).toBe(2);
      expect(mutated).toBe(true);
      const publicSnap = await db.doc(`publicLessons/${publicLessonId}`).get();
      expect(publicSnap.data()?.completed).toBe(true);
      expect((await planRef(requestId).get()).exists).toBe(false);
      expect((await leaseRef(lessonId).get()).exists).toBe(false);
      expect(await ledgerReservationCount()).toBe(0);
    } finally {
      spy.mockRestore();
    }
  });

  it('cap pieno: autorizza soltanto la sostituzione esatta, senza nuova capacità', async () => {
    const lessonId = `lesson-full-${randomUUID()}`;
    const publicLessonId = `public-${lessonId}`;
    const assetIds = [randomUUID(), randomUUID(), randomUUID()];
    await seedLesson(lessonId, publicLessonId);
    await db.doc(`programs/${PROGRAM_ID}/imports/${IMPORT_ID}/lessons/${lessonId}`).update({
      visuals: {
        contractVersion: 'lesson-visuals/v1',
        items: assetIds.map(multiVisualItem),
      },
    });

    const replaceRequestId = randomUUID();
    touchedRefs.push(planRef(replaceRequestId), leaseRef(lessonId));
    const plan = await call(
      authorizePayload({
        requestId: replaceRequestId,
        lessonId,
        quantity: { mode: 'exact', ceiling: 1 },
        replacementAssetId: assetIds[1],
      }),
    );
    expect(plan.existingItemAssetIds).toEqual(assetIds);
    expect(plan.replacementAssetId).toBe(assetIds[1]);

    const addRequestId = randomUUID();
    touchedRefs.push(planRef(addRequestId));
    await expect(
      call(
        authorizePayload({
          requestId: addRequestId,
          lessonId,
          quantity: { mode: 'exact', ceiling: 1 },
          replacementAssetId: null,
        }),
      ),
    ).rejects.toMatchObject({ code: 'invalid_input' });
    expect((await planRef(addRequestId).get()).exists).toBe(false);
  });

  it('target di sostituzione stale: se è già sparito non crea piano né budget', async () => {
    const lessonId = `lesson-replace-race-${randomUUID()}`;
    const publicLessonId = `public-${lessonId}`;
    const assetIds = [randomUUID(), randomUUID(), randomUUID()];
    const lessonRef = db.doc(`programs/${PROGRAM_ID}/imports/${IMPORT_ID}/lessons/${lessonId}`);
    await seedLesson(lessonId, publicLessonId);
    await lessonRef.update({
      visuals: {
        contractVersion: 'lesson-visuals/v1',
        items: [multiVisualItem(randomUUID()), ...assetIds.slice(1).map(multiVisualItem)],
      },
    });
    const requestId = randomUUID();
    touchedRefs.push(planRef(requestId), leaseRef(lessonId));

    await expect(
      call(
        authorizePayload({
          requestId,
          lessonId,
          quantity: { mode: 'exact', ceiling: 1 },
          replacementAssetId: assetIds[0],
        }),
      ),
    ).rejects.toMatchObject({ code: 'invalid_input' });

    expect((await planRef(requestId).get()).exists).toBe(false);
    expect((await leaseRef(lessonId).get()).exists).toBe(false);
    expect(await ledgerReservationCount()).toBe(0);
  });

  it('quantità richiesta oltre gli slot liberi ⇒ invalid_input, zero scritture', async () => {
    const lessonId = `lesson-${randomUUID()}`;
    const publicLessonId = `public-${lessonId}`;
    await seedLesson(lessonId, publicLessonId);
    const lessonRef = db.doc(`programs/${PROGRAM_ID}/imports/${IMPORT_ID}/lessons/${lessonId}`);
    await lessonRef.update({
      visuals: {
        contractVersion: 'lesson-visuals/v1',
        items: [randomUUID(), randomUUID()].map(multiVisualItem),
      },
    });

    const requestId = randomUUID();
    // 2 esistenti + ceiling 2 = 4 > 3.
    await expect(
      call(authorizePayload({ requestId, lessonId, quantity: { mode: 'auto', ceiling: 2 } })),
    ).rejects.toMatchObject({ code: 'invalid_input' });
    expect((await planRef(requestId).get()).exists).toBe(false);
  });

  it('feature_disabled quando AI_CONTENT_MODE è disabled', async () => {
    const lessonId = `lesson-${randomUUID()}`;
    const publicLessonId = `public-${lessonId}`;
    await seedLesson(lessonId, publicLessonId);
    const input = validateVisualPlanAuthorizeInput(authorizePayload({ lessonId }));
    await expect(
      authorizeVisualPlanForOwner({
        db,
        ownerUid: OWNER_UID,
        input,
        clock: Date.now,
        mode: 'disabled',
        visualMode: 'mock',
        secret: undefined,
      }),
    ).rejects.toBeInstanceOf(AiContentError);
  });
});
