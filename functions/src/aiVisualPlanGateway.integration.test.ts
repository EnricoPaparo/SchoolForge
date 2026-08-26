import { randomUUID } from 'node:crypto';
import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { OPENAI_RUNTIME_LUNA_MODEL, OPENAI_RUNTIME_LUNA_PRICE_LIST_VERSION } from './aiCorrectionCost.js';
import { AiContentError } from './aiContentCore.js';
import { AiVisualMultiError } from './aiVisualMultiCore.js';
import {
  computeVisualPlanTotalReserved,
  validateVisualPlanRun,
  validateVisualPlanAuthorizeInput,
  type VisualPlanRun,
} from './aiVisualMultiPlan.js';
import { computeOpaqueVisualPlanId, VISUAL_PLAN_CONTRACT_VERSION } from './aiVisualMultiCore.js';
import {
  computeVisualPlanLeaseId,
  VISUAL_PLAN_LEASE_CONTRACT_VERSION,
  type VisualPlanLease,
} from './aiVisualPlanLease.js';

const { authorizeVisualPlanForOwner } = await import('./aiVisualPlanGateway.js');

const emulatorDescribe = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;

const OWNER_UID = 'emulator-plan-owner';
const PROGRAM_ID = 'plan-program-1';
const IMPORT_ID = 'plan-import-1';
const UDA_DIR = 'uda-1';
const LESSON_FILENAME = 'lezione-1.md';
const LESSON_PATH_FIELD = `${UDA_DIR}/${LESSON_FILENAME}`;
const LESSON_BODY = '## Introduzione\n\nTesto introduttivo.\n\n## Reti\n\nContenuto sulle reti.';

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
    await db.doc(`aiBudgetLedger/${monthKey}`).delete().catch(() => undefined);
  });

  afterAll(async () => {
    await db.doc('settings/owner').delete().catch(() => undefined);
    await db.doc('settings/aiConfig').delete().catch(() => undefined);
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

  function call(payload: Record<string, unknown>, nowMs = Date.now()) {
    const input = validateVisualPlanAuthorizeInput(payload);
    return authorizeVisualPlanForOwner({
      db,
      ownerUid: OWNER_UID,
      input,
      nowMs,
      mode: 'mock',
      visualMode: 'mock',
      secret: undefined,
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

  it('due autorizzazioni concorrenti sulla stessa lezione: una sola vince il lease, l\'altra riceve visual_plan_already_active', async () => {
    const lessonId = `lesson-${randomUUID()}`;
    const publicLessonId = `public-${lessonId}`;
    await seedLesson(lessonId, publicLessonId);
    const requestIdA = randomUUID();
    const requestIdB = randomUUID();
    touchedRefs.push(planRef(requestIdA), planRef(requestIdB), leaseRef(lessonId));

    const results = await Promise.allSettled([
      call(authorizePayload({ requestId: requestIdA, lessonId })),
      call(authorizePayload({ requestId: requestIdB, lessonId })),
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
  });

  it('lease scaduto è riacquisibile nella stessa transazione', async () => {
    const lessonId = `lesson-${randomUUID()}`;
    const publicLessonId = `public-${lessonId}`;
    await seedLesson(lessonId, publicLessonId);
    const staleLease: VisualPlanLease = {
      contractVersion: VISUAL_PLAN_LEASE_CONTRACT_VERSION,
      ownerUid: OWNER_UID,
      programId: PROGRAM_ID,
      importId: IMPORT_ID,
      lessonId,
      opaquePlanId: computeOpaqueVisualPlanId(OWNER_UID, randomUUID()),
      requestId: randomUUID(),
      createdAt: Timestamp.fromMillis(Date.now() - 100_000),
      updatedAt: Timestamp.fromMillis(Date.now() - 100_000),
      expireAt: Timestamp.fromMillis(Date.now() - 1_000),
    };
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
    const divergent: VisualPlanRun = {
      contractVersion: VISUAL_PLAN_CONTRACT_VERSION,
      ownerUid: OWNER_UID,
      programId: PROGRAM_ID,
      importId: IMPORT_ID,
      lessonId: otherLessonId,
      publicLessonId: otherPublicLessonId,
      udaDir: UDA_DIR,
      requestId,
      planHash: 'a'.repeat(64),
      status: 'abandoned',
      quantity: { mode: 'auto', ceiling: 1 },
      sourceBodyHash: 'b'.repeat(64),
      existingItemAssetIds: [],
      budgetCeiling: {
        reservationKey: 'c'.repeat(64),
        proposalCap: 1,
        generationCap: 1,
        maxAttemptsPerSlot: 2,
        totalReserved: 1 + 1 * 1 * 2,
      },
      slots: [],
      settlement: { proposalActualCost: 0, slots: [] },
      createdAt: Timestamp.fromMillis(Date.now() - 1_000),
      updatedAt: Timestamp.fromMillis(Date.now() - 1_000),
      expireAt: Timestamp.fromMillis(Date.now() + 86_400_000 - 1_000),
    };
    await planRef(requestId).set(divergent);

    await expect(call(authorizePayload({ requestId, lessonId }))).rejects.toMatchObject({
      code: 'corrupted_state',
    });
  });

  it('replay dopo promozioni simulate: nessuna rilettura del mondo, il record torna così com\'è', async () => {
    const lessonId = `lesson-${randomUUID()}`;
    const publicLessonId = `public-${lessonId}`;
    await seedLesson(lessonId, publicLessonId);
    const requestId = randomUUID();
    touchedRefs.push(planRef(requestId), leaseRef(lessonId));

    // Simula un piano il cui slot 0 è già stato promosso (fuori scope 03A, ma
    // deve poter esistere sotto una lettura futura di 03B) e il cui lease è
    // già stato rilasciato (stato terminale).
    const promotedAssetId = randomUUID();
    const simulated: VisualPlanRun = {
      contractVersion: VISUAL_PLAN_CONTRACT_VERSION,
      ownerUid: OWNER_UID,
      programId: PROGRAM_ID,
      importId: IMPORT_ID,
      lessonId,
      publicLessonId,
      udaDir: UDA_DIR,
      requestId,
      planHash: 'a'.repeat(64),
      status: 'completed',
      quantity: { mode: 'exact', ceiling: 1 },
      sourceBodyHash: 'b'.repeat(64), // corpo "originale", ormai diverso da quello live
      existingItemAssetIds: [],
      budgetCeiling: {
        reservationKey: 'c'.repeat(64),
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
      settlement: { proposalActualCost: 500, slots: [{ slotIndex: 0, attempts: 1, actualCost: 1000 }] },
      createdAt: Timestamp.fromMillis(Date.now() - 10_000),
      updatedAt: Timestamp.fromMillis(Date.now() - 5_000),
      expireAt: Timestamp.fromMillis(Date.now() + 86_400_000 - 10_000),
    };
    // Autoverifica del fixture prima di persisterlo: deve essere un record
    // realmente valido secondo lo stesso validatore che il gateway userà.
    expect(() => validateVisualPlanRun(simulated)).not.toThrow();
    await planRef(requestId).set(simulated);
    // Nessun lease: coerente con "rilascio immediato su stato terminale".

    // Cambia il corpo live DOPO la scrittura del piano simulato — se il
    // replay rileggesse il mondo, romperebbe l'identità/il corpo congelato.
    await seedLesson(lessonId, publicLessonId, `${LESSON_BODY}\n\n## Nuova sezione\n\nAggiunta dopo.`);

    const replayed = await call(authorizePayload({ requestId, lessonId, quantity: { mode: 'exact', ceiling: 1 } }));

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

  it('adozione singolare — dataset legacy variegato: manifest singolare distinto per lezione, letto senza scrittura', async () => {
    const cases = [
      { lessonId: `legacy-a-${randomUUID()}`, assetId: randomUUID() },
      { lessonId: `legacy-b-${randomUUID()}`, assetId: randomUUID() },
      { lessonId: `legacy-c-${randomUUID()}`, assetId: randomUUID() },
    ];
    for (const { lessonId, assetId } of cases) {
      const publicLessonId = `public-${lessonId}`;
      await seedLesson(lessonId, publicLessonId);
      const lessonRef = db.doc(`programs/${PROGRAM_ID}/imports/${IMPORT_ID}/lessons/${lessonId}`);
      await lessonRef.update({
        visual: {
          contractVersion: 'visual-enrichment/v1',
          assetId,
          storageRef: `repository/${OWNER_UID}/${IMPORT_ID}/${UDA_DIR}/visuals/${assetId}.webp`,
          anchor: { headingSlug: 'reti', headingText: 'Reti', placement: 'after' },
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
        },
      });

      const requestId = randomUUID();
      touchedRefs.push(planRef(requestId), leaseRef(lessonId));
      // ceiling 1: 1 slot libero già presente (existingItemAssetIds.length===1) + ceiling 1 === 2 ≤ 3.
      const plan = await call(
        authorizePayload({ requestId, lessonId, quantity: { mode: 'exact', ceiling: 1 } }),
      );
      expect(plan.existingItemAssetIds).toEqual([assetId]);

      // Idempotente: una seconda lettura sulla stessa lezione (piano diverso,
      // dopo che il primo si è già chiuso e ha rilasciato il lease) continua a
      // leggere lo stesso assetId, senza alcuna scrittura di adozione.
      const secondRequestId = randomUUID();
      touchedRefs.push(planRef(secondRequestId));
      const plan2 = await call(
        authorizePayload({ requestId: secondRequestId, lessonId, quantity: { mode: 'exact', ceiling: 1 } }),
      );
      expect(plan2.existingItemAssetIds).toEqual([assetId]);
      const rawSnap = await lessonRef.get();
      expect(rawSnap.data()?.visuals).toBeUndefined(); // nessuna adozione scritta
    }
  });

  it('quantità richiesta oltre gli slot liberi ⇒ invalid_input, zero scritture', async () => {
    const lessonId = `lesson-${randomUUID()}`;
    const publicLessonId = `public-${lessonId}`;
    await seedLesson(lessonId, publicLessonId);
    const lessonRef = db.doc(`programs/${PROGRAM_ID}/imports/${IMPORT_ID}/lessons/${lessonId}`);
    await lessonRef.update({
      visuals: {
        contractVersion: 'lesson-visuals/v1',
        items: [1, 2].map((n) => ({
          assetId: randomUUID(),
          storageRef: `repository/${OWNER_UID}/${IMPORT_ID}/${UDA_DIR}/visuals/asset-${n}.webp`,
          anchor: { headingSlug: `reti-${n}`, headingText: 'Reti', placement: 'after' },
          caption: 'Didascalia.',
          altText: 'Testo alternativo.',
          width: 800,
          height: 600,
          byteLength: 12_345,
          sha256: 'd'.repeat(64),
          mimeType: 'image/webp',
          source: 'generated',
          styleVersion: 'schoolforge-sketch/v1',
          sourceBodyHash: 'e'.repeat(64),
          approvedAt: Timestamp.now(),
        })),
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
        nowMs: Date.now(),
        mode: 'disabled',
        visualMode: 'mock',
        secret: undefined,
      }),
    ).rejects.toBeInstanceOf(AiContentError);
  });
});
