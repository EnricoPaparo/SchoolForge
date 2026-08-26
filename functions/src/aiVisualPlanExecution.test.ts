import { describe, expect, it } from 'vitest';
import { computeBudgetReservationKey } from './aiContentCore.js';
import { VISUAL_STAGING_TTL_MS } from './aiContentVisualProposal.js';
import {
  LESSON_VISUALS_CONTRACT_VERSION,
  VISUAL_PLAN_CONTRACT_VERSION,
  VISUAL_PLAN_MAX_ATTEMPTS_PER_SLOT,
  VISUAL_PLAN_PROMOTION_CONTRACT_VERSION,
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
    let value = validateVisualPlanRun({
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
});

describe('insieme live dopo add/replace', () => {
  it('applica in ordine le sostituzioni già dichiarate', () => {
    const oldA = REQUEST;
    const newA = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    const added = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';
    const base = validateVisualPlanRun({
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
