import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { computeBudgetReservationKey } from './aiContentCore.js';
import { VISUAL_STAGING_TTL_MS } from './aiContentVisualProposal.js';
import {
  LESSON_VISUALS_CONTRACT_VERSION,
  VISUAL_PLAN_CONTRACT_VERSION,
  VISUAL_PLAN_MAX_ATTEMPTS_PER_SLOT,
  VISUAL_PLAN_PROMOTION_CONTRACT_VERSION,
  VISUAL_PLAN_PROMOTION_RECOVERY_CONTRACT_VERSION,
  VISUAL_PLAN_SLOT_RUN_CONTRACT_VERSION,
  computeOpaqueVisualPlanId,
  computeOpaqueVisualPlanSlotRunId,
  computeVisualPlanHash,
} from './aiVisualMultiCore.js';
import {
  computeExpectedLiveAssetIds,
  remainingGenerationReservation,
  replaceSlot,
  upsertSlotSettlement,
  validateStoredVisualPlanPromotion,
  validateStoredVisualPlanPromotionRecovery,
  validateStoredVisualPlanSlotRun,
  validateVisualPlanPromoteInput,
  validateVisualPlanSlotInput,
  visualPlanSlotStagingRef,
} from './aiVisualPlanExecution.js';
import { validatePublicLessonVisualBytesDoc } from './aiVisualMultiPublicBytes.js';
import { validateVisualPlanRun, type VisualPlanRun } from './aiVisualMultiPlan.js';

const OWNER = 'owner-uid';
const REQUEST = '11111111-2222-4333-8444-555555555555';
const PROMOTION_REQUEST = '99999999-2222-4333-8444-555555555555';
const PLAN_ID = computeOpaqueVisualPlanId(OWNER, REQUEST);
const CREATED = { toMillis: () => 1_700_000_000_000 };
const EXPIRE = { toMillis: () => 1_700_000_000_000 + VISUAL_STAGING_TTL_MS };

function slot(index: number, over: Record<string, unknown> = {}) {
  return {
    slotIndex: index,
    state: 'pending',
    decision: 'image',
    subject: `Soggetto ${index}`,
    rationale: `Ragione ${index}`,
    anchor: { anchorHeadingIndex: index, anchorHeadingText: `Titolo ${index}` },
    caption: `Didascalia ${index}`,
    altText: `Alt ${index}`,
    attempts: 0,
    lastError: null,
    staged: null,
    promotedAssetId: null,
    ...over,
  };
}

function plan(slots = [slot(0), slot(1), slot(2)]): VisualPlanRun {
  const identity = {
    ownerUid: OWNER,
    programId: 'program',
    importId: 'import',
    lessonId: 'lesson',
    publicLessonId: 'public',
    sourceBodyHash: 'c'.repeat(64),
    existingItemAssetIds: [] as string[],
    replacementAssetId: null,
    quantity: { mode: 'auto' as const, ceiling: 3 as const },
  };
  const value = {
    contractVersion: VISUAL_PLAN_CONTRACT_VERSION,
    ...identity,
    udaDir: 'uda-01',
    requestId: REQUEST,
    planHash: computeVisualPlanHash(identity),
    status: 'proposed',
    budgetCeiling: {
      reservationKey: computeBudgetReservationKey(OWNER, REQUEST),
      reservationMonthKey: '2023-11',
      proposalCap: 10,
      generationCap: 100,
      maxAttemptsPerSlot: 2,
      totalReserved: 610,
    },
    slots,
    settlement: { proposalActualCost: 0, slots: [] },
    createdAt: CREATED,
    updatedAt: CREATED,
    expireAt: EXPIRE,
  };
  return validateVisualPlanRun(value);
}

describe('MULTI-VISUAL-03B — input chiusi', () => {
  const base = {
    requestId: REQUEST,
    programId: 'program',
    importId: 'import',
    lessonId: 'lesson',
    slotIndex: 1,
  };
  it('accetta la richiesta di slot canonica e rifiuta extra/indice/tipo', () => {
    expect(validateVisualPlanSlotInput(base)).toEqual(base);
    for (const bad of [
      { ...base, extra: true },
      { ...base, slotIndex: 3 },
      { ...base, slotIndex: '1' },
      { ...base, requestId: 'x' },
    ]) {
      expect(() => validateVisualPlanSlotInput(bad)).toThrow();
    }
  });
  it('accetta add/replace e rifiuta unioni sovrapposte', () => {
    expect(
      validateVisualPlanPromoteInput({
        ...base,
        promotionRequestId: PROMOTION_REQUEST,
        mode: { mode: 'add' },
      }).mode,
    ).toEqual({ mode: 'add' });
    expect(
      validateVisualPlanPromoteInput({
        ...base,
        promotionRequestId: PROMOTION_REQUEST,
        mode: { mode: 'replace', replaceAssetId: REQUEST },
      }).mode,
    ).toEqual({ mode: 'replace', replaceAssetId: REQUEST });
    expect(() =>
      validateVisualPlanPromoteInput({
        ...base,
        promotionRequestId: PROMOTION_REQUEST,
        mode: { mode: 'add', replaceAssetId: REQUEST },
      }),
    ).toThrow();
  });
});

describe('record slot e promozione', () => {
  it('lega run a owner/piano/slot/path/timestamp', () => {
    const run = {
      contractVersion: VISUAL_PLAN_SLOT_RUN_CONTRACT_VERSION,
      ownerUid: OWNER,
      opaquePlanId: PLAN_ID,
      planHash: 'a'.repeat(64),
      slotIndex: 1,
      subjectHash: 'b'.repeat(64),
      status: 'pending',
      attempts: 1,
      executionId: PROMOTION_REQUEST,
      settledCostMicroUsd: 0,
      stagingRef: visualPlanSlotStagingRef(OWNER, PLAN_ID, 1),
      createdAt: CREATED,
      updatedAt: CREATED,
      expireAt: EXPIRE,
    };
    expect(validateStoredVisualPlanSlotRun(run)).toEqual(run);
    for (const bad of [
      { ...run, stagingRef: visualPlanSlotStagingRef(OWNER, PLAN_ID, 2) },
      { ...run, attempts: 3 },
      { ...run, extra: true },
    ])
      expect(() => validateStoredVisualPlanSlotRun(bad)).toThrow();
  });
  it('la promozione replace conserva il target sostituito', () => {
    const record = {
      contractVersion: VISUAL_PLAN_PROMOTION_CONTRACT_VERSION,
      ownerUid: OWNER,
      opaquePlanId: PLAN_ID,
      planHash: 'a'.repeat(64),
      slotIndex: 0,
      sequence: 0,
      promotionRequestId: PROMOTION_REQUEST,
      mode: 'replace',
      replacedAssetId: REQUEST,
      assetId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      storageRef: 'repository/owner/import/uda/visuals/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.webp',
      createdAt: CREATED,
    };
    expect(validateStoredVisualPlanPromotion(record).replacedAssetId).toBe(REQUEST);
    expect(() => validateStoredVisualPlanPromotion({ ...record, replacedAssetId: null })).toThrow();
  });
});

describe('budget e stati per slot', () => {
  it('rilascia il secondo tentativo di uno slot ready senza toccare gli altri', () => {
    let value = plan();
    expect(remainingGenerationReservation(value)).toBe(600);
    const first = {
      ...value.slots[0]!,
      state: 'ready' as const,
      attempts: 1,
      staged: {
        storageRef: visualPlanSlotStagingRef(OWNER, PLAN_ID, 0),
        width: 10,
        height: 10,
        byteLength: 10,
        sha256: 'a'.repeat(64),
      },
    };
    value = replaceSlot({ ...value, settlement: upsertSlotSettlement(value, 0, 1, 40) }, 0, first);
    expect(remainingGenerationReservation(value)).toBe(400);
    expect(value.slots.slice(1).map((item) => item.state)).toEqual(['pending', 'pending']);
  });
  it('un failed al primo tentativo conserva un solo cap; al secondo è terminale', () => {
    const initial = plan([slot(0)]);
    const value = validateVisualPlanRun({
      ...initial,
      status: 'generating',
      slots: [slot(0, { state: 'failed', attempts: 1, lastError: 'transient_error' })],
      settlement: {
        proposalActualCost: 0,
        slots: [{ slotIndex: 0, attempts: 1, actualCost: null }],
      },
    });
    expect(remainingGenerationReservation(value)).toBe(100);
    const exhausted = { ...value.slots[0]!, attempts: VISUAL_PLAN_MAX_ATTEMPTS_PER_SLOT };
    const done = replaceSlot(
      { ...value, settlement: upsertSlotSettlement(value, 0, 2, null) },
      0,
      exhausted,
    );
    expect(done.status).toBe('abandoned');
    expect(remainingGenerationReservation(done)).toBe(0);
  });
  it.each(['uncertain_outcome', 'staging_conflict'] as const)(
    '%s è terminale al primo tentativo e non conserva cap ritentabili',
    (lastError) => {
      const initial = plan([slot(0)]);
      const failed = slot(0, { state: 'failed', attempts: 1, lastError });
      const value = replaceSlot(
        {
          ...initial,
          settlement: {
            proposalActualCost: 0,
            slots: [{ slotIndex: 0, attempts: 1, actualCost: null }],
          },
        },
        0,
        failed,
      );
      expect(value.status).toBe('abandoned');
      expect(remainingGenerationReservation(value)).toBe(0);
    },
  );
  it('deriva partial/completed dalla stessa semantica terminale condivisa', () => {
    const promoted0 = slot(0, {
      state: 'promoted',
      attempts: 1,
      promotedAssetId: REQUEST,
    });
    const uncertain1 = slot(1, {
      state: 'failed',
      attempts: 1,
      lastError: 'uncertain_outcome',
    });
    let partial = plan([slot(0), slot(1)]);
    partial = replaceSlot(
      { ...partial, settlement: upsertSlotSettlement(partial, 0, 1, 0) },
      0,
      promoted0,
    );
    partial = replaceSlot(
      { ...partial, settlement: upsertSlotSettlement(partial, 1, 1, null) },
      1,
      uncertain1,
    );
    expect(partial.status).toBe('partially_completed');

    let completed = plan([slot(0), slot(1)]);
    completed = replaceSlot(
      { ...completed, settlement: upsertSlotSettlement(completed, 0, 1, 0) },
      0,
      promoted0,
    );
    completed = replaceSlot(
      { ...completed, settlement: upsertSlotSettlement(completed, 1, 1, 0) },
      1,
      slot(1, {
        state: 'promoted',
        attempts: 1,
        promotedAssetId: PROMOTION_REQUEST,
      }),
    );
    expect(completed.status).toBe('completed');
  });
});

describe('insieme live dopo add/replace', () => {
  it('applica in ordine le sostituzioni già dichiarate', () => {
    const oldA = REQUEST;
    const newA = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    const added = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';
    const initial = validateVisualPlanRun({
      ...plan([slot(0), slot(1)]),
      existingItemAssetIds: [oldA],
      quantity: { mode: 'auto', ceiling: 2 },
      planHash: computeVisualPlanHash({
        ownerUid: OWNER,
        programId: 'program',
        importId: 'import',
        lessonId: 'lesson',
        publicLessonId: 'public',
        sourceBodyHash: 'c'.repeat(64),
        existingItemAssetIds: [oldA],
        quantity: { mode: 'auto', ceiling: 2 },
      }),
      budgetCeiling: {
        reservationKey: computeBudgetReservationKey(OWNER, REQUEST),
        reservationMonthKey: '2023-11',
        proposalCap: 10,
        generationCap: 100,
        maxAttemptsPerSlot: 2,
        totalReserved: 410,
      },
    });
    const base = validateVisualPlanRun({
      ...initial,
      status: 'completed',
      slots: [
        slot(0, { state: 'promoted', attempts: 1, promotedAssetId: newA }),
        slot(1, { state: 'promoted', attempts: 1, promotedAssetId: added }),
      ],
      settlement: {
        proposalActualCost: 0,
        slots: [
          { slotIndex: 0, attempts: 1, actualCost: 0 },
          { slotIndex: 1, attempts: 1, actualCost: 0 },
        ],
      },
    });
    const promotion = (
      slotIndex: number,
      mode: 'add' | 'replace',
      assetId: string,
      replacedAssetId: string | null,
    ) =>
      validateStoredVisualPlanPromotion({
        contractVersion: VISUAL_PLAN_PROMOTION_CONTRACT_VERSION,
        ownerUid: OWNER,
        opaquePlanId: PLAN_ID,
        planHash: base.planHash,
        slotIndex,
        sequence: slotIndex,
        promotionRequestId:
          slotIndex === 0 ? PROMOTION_REQUEST : '88888888-2222-4333-8444-555555555555',
        mode,
        replacedAssetId,
        assetId,
        storageRef: `repository/owner/import/uda/visuals/${assetId}.webp`,
        createdAt: CREATED,
      });
    expect(
      computeExpectedLiveAssetIds(base, [
        promotion(0, 'replace', newA, oldA),
        promotion(1, 'add', added, null),
      ]),
    ).toEqual([newA, added]);
  });
  it('segue la sequenza di commit persistita, non lo slotIndex', () => {
    const first = REQUEST;
    const second = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    const third = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';
    const initial = validateVisualPlanRun({
      ...plan([slot(0), slot(1)]),
      existingItemAssetIds: [first],
      quantity: { mode: 'auto', ceiling: 2 },
      planHash: computeVisualPlanHash({
        ownerUid: OWNER,
        programId: 'program',
        importId: 'import',
        lessonId: 'lesson',
        publicLessonId: 'public',
        sourceBodyHash: 'c'.repeat(64),
        existingItemAssetIds: [first],
        quantity: { mode: 'auto', ceiling: 2 },
      }),
      budgetCeiling: {
        reservationKey: computeBudgetReservationKey(OWNER, REQUEST),
        reservationMonthKey: '2023-11',
        proposalCap: 10,
        generationCap: 100,
        maxAttemptsPerSlot: 2,
        totalReserved: 410,
      },
    });
    const base = validateVisualPlanRun({
      ...initial,
      status: 'completed',
      slots: [
        slot(0, { state: 'promoted', attempts: 1, promotedAssetId: third }),
        slot(1, { state: 'promoted', attempts: 1, promotedAssetId: second }),
      ],
      settlement: {
        proposalActualCost: 0,
        slots: [
          { slotIndex: 0, attempts: 1, actualCost: 0 },
          { slotIndex: 1, attempts: 1, actualCost: 0 },
        ],
      },
    });
    const record = (
      slotIndex: number,
      sequence: number,
      replacedAssetId: string,
      assetId: string,
    ) =>
      validateStoredVisualPlanPromotion({
        contractVersion: VISUAL_PLAN_PROMOTION_CONTRACT_VERSION,
        ownerUid: OWNER,
        opaquePlanId: PLAN_ID,
        planHash: base.planHash,
        slotIndex,
        sequence,
        promotionRequestId:
          sequence === 0 ? PROMOTION_REQUEST : '88888888-2222-4333-8444-555555555555',
        mode: 'replace',
        replacedAssetId,
        assetId,
        storageRef: `repository/owner/import/uda/visuals/${assetId}.webp`,
        createdAt: CREATED,
      });
    expect(
      computeExpectedLiveAssetIds(base, [record(0, 1, second, third), record(1, 0, first, second)]),
    ).toEqual([third]);
  });
});

describe('byte doc multi', () => {
  it('rifiuta chiavi extra e più di tre asset prima del rendering', () => {
    expect(() =>
      validatePublicLessonVisualBytesDoc({
        contractVersion: LESSON_VISUALS_CONTRACT_VERSION,
        publicLessonId: 'p',
        programId: 'p',
        importId: 'i',
        bytes: {},
        extra: true,
      }),
    ).toThrow();
    const bytes = Object.fromEntries(
      [
        REQUEST,
        PROMOTION_REQUEST,
        'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
        'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff',
      ].map((id) => [id, {}]),
    );
    expect(() =>
      validatePublicLessonVisualBytesDoc({
        contractVersion: LESSON_VISUALS_CONTRACT_VERSION,
        publicLessonId: 'p',
        programId: 'p',
        importId: 'i',
        bytes,
      }),
    ).toThrow();
  });
});

describe('identità slot run', () => {
  it('è deterministica e separa slot adiacenti', () => {
    expect(computeOpaqueVisualPlanSlotRunId(OWNER, PLAN_ID, 0)).toBe(
      computeOpaqueVisualPlanSlotRunId(OWNER, PLAN_ID, 0),
    );
    expect(computeOpaqueVisualPlanSlotRunId(OWNER, PLAN_ID, 0)).not.toBe(
      computeOpaqueVisualPlanSlotRunId(OWNER, PLAN_ID, 1),
    );
  });
});

describe('recovery di promozione', () => {
  it('è chiuso, lega request/mode/asset e rifiuta timestamp o campi divergenti', () => {
    const recovery = {
      contractVersion: VISUAL_PLAN_PROMOTION_RECOVERY_CONTRACT_VERSION,
      ownerUid: OWNER,
      opaquePlanId: PLAN_ID,
      planHash: plan().planHash,
      slotIndex: 0,
      promotionRequestId: PROMOTION_REQUEST,
      mode: 'add',
      replacedAssetId: null,
      assetId: REQUEST,
      storageRef: `repository/${OWNER}/import/uda-01/visuals/${REQUEST}.webp`,
      status: 'prepared',
      createdAt: CREATED,
      updatedAt: CREATED,
      expireAt: EXPIRE,
    };
    expect(validateStoredVisualPlanPromotionRecovery(recovery)).toEqual(recovery);
    expect(() => validateStoredVisualPlanPromotionRecovery({ ...recovery, extra: true })).toThrow();
    expect(() =>
      validateStoredVisualPlanPromotionRecovery({
        ...recovery,
        mode: 'replace',
        replacedAssetId: null,
      }),
    ).toThrow();
    expect(() =>
      validateStoredVisualPlanPromotionRecovery({
        ...recovery,
        updatedAt: { toMillis: () => EXPIRE.toMillis() + 1 },
      }),
    ).toThrow();
  });
});

describe('guardie strutturali 03B', () => {
  const gateway = readFileSync(
    new URL('./aiVisualPlanExecutionGateway.ts', import.meta.url),
    'utf8',
  );
  it('isola la normalizzazione immagini con memoria sufficiente e concorrenza singola', () => {
    expect(gateway).toContain("memory: '512MiB' as const");
    expect(gateway).toContain('concurrency: 1');
    expect(gateway).toContain('timeoutSeconds: 120');
  });
  it('separa il cap di fase dal master e ricampiona il clock dopo il provider', () => {
    expect(gateway).toContain('markPending(withPhase, phaseKey, nowMs)');
    expect(gateway).not.toContain('markPending(ledger, current.budgetCeiling.reservationKey');
    expect(gateway.indexOf('const finalizeNowMs')).toBeGreaterThan(gateway.indexOf('callProvider'));
    expect(gateway).toContain("status: staged ? 'completed' : uncertainOutcome ? 'uncertain'");
  });
  it('congela create-only, proprietà del tentativo e riconciliazione dei byte', () => {
    expect(gateway).toContain('preconditionOpts: { ifGenerationMatch: 0 }');
    expect(gateway).toContain('attempt: String(slot.attempts)');
    expect(gateway).toContain('executionId,');
    expect(gateway).toContain('sha256Hex(existing) !== normalized.sha256');
    expect(gateway).toContain("stagingFailure = 'uncertain_outcome'");
    expect(gateway).toContain("stagingFailure = 'staging_conflict'");
  });
  it('solo pre_invocation esplicito è ritentabile; le eccezioni diventano invocation_unknown', () => {
    expect(gateway).toContain("outcome = { status: 'invocation_unknown' }");
    expect(gateway).toContain(
      "errorCode = outcome.status === 'invocation_unknown' ? 'uncertain_outcome' : 'transient_error'",
    );
  });
  it('congela replay relazionale, ordine promozioni e byte pubblici esatti', () => {
    for (const guard of [
      'existing.ownerUid !== ownerUid',
      'existing.planHash !== fastPlan.planHash',
      "replaySlot?.state !== 'promoted'",
      'replaySlot.promotedAssetId !== existing.assetId',
      'sequence: previousPromotions.length',
      "throw new AiVisualMultiError('corrupted_state', 'Byte pubblici divergenti dal manifest.')",
      'assertPromotionReplayIsLive',
      'assertPublicManifestMatchesPrivate',
      'assertPublicBytesMatchPrivate',
    ])
      expect(gateway).toContain(guard);
  });
});
