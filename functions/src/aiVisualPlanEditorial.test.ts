import { Timestamp } from 'firebase-admin/firestore';
import { describe, expect, it } from 'vitest';
import { computeBudgetReservationKey } from './aiContentCore.js';
import { sha256Hex } from './aiVisualCore.js';
import {
  computeVisualPlanHash,
  VISUAL_PLAN_CONTRACT_VERSION,
  VISUAL_PLAN_MAX_ATTEMPTS_PER_SLOT,
} from './aiVisualMultiCore.js';
import {
  applyVisualPlanSlotEdit,
  validateVisualPlanEditSlotInput,
  visualPlanSlotEditId,
  visualPlanSlotEditInputHash,
} from './aiVisualPlanEditorial.js';
import {
  computeVisualPlanTotalReserved,
  validateVisualPlanRun,
  type VisualPlanRun,
} from './aiVisualMultiPlan.js';

const OWNER = 'owner-editorial';
const REQUEST = '11111111-1111-4111-8111-111111111111';
const EDIT = '22222222-2222-4222-8222-222222222222';
const CREATED = Date.UTC(2026, 7, 27, 12);

function plan(): VisualPlanRun {
  const quantity = { mode: 'exact' as const, ceiling: 2 as const };
  const identity = {
    ownerUid: OWNER,
    programId: 'program',
    importId: 'import',
    lessonId: 'lesson',
    publicLessonId: 'public',
    sourceBodyHash: sha256Hex('## A\n\nTesto\n\n## B\n\nTesto'),
    existingItemAssetIds: [] as string[],
    replacementAssetId: null,
    quantity,
  };
  return validateVisualPlanRun({
    contractVersion: VISUAL_PLAN_CONTRACT_VERSION,
    ...identity,
    udaDir: 'uda-1',
    requestId: REQUEST,
    planHash: computeVisualPlanHash(identity),
    status: 'proposed',
    budgetCeiling: {
      reservationKey: computeBudgetReservationKey(OWNER, REQUEST),
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
    slots: [
      {
        slotIndex: 0,
        state: 'pending',
        decision: 'image',
        subject: 'Schema A',
        rationale: 'Mostra la relazione A.',
        anchor: { anchorHeadingIndex: 0, anchorHeadingText: 'A' },
        caption: 'Didascalia A',
        altText: 'Descrizione A',
        attempts: 0,
        lastError: null,
        staged: null,
        promotedAssetId: null,
      },
      {
        slotIndex: 1,
        state: 'pending',
        decision: 'image',
        subject: 'Schema B',
        rationale: 'Mostra la relazione B.',
        anchor: { anchorHeadingIndex: 1, anchorHeadingText: 'B' },
        caption: 'Didascalia B',
        altText: 'Descrizione B',
        attempts: 0,
        lastError: null,
        staged: null,
        promotedAssetId: null,
      },
    ],
    settlement: { proposalActualCost: 10, slots: [] },
    createdAt: Timestamp.fromMillis(CREATED),
    updatedAt: Timestamp.fromMillis(CREATED),
    expireAt: Timestamp.fromMillis(CREATED + 24 * 60 * 60 * 1000),
  });
}

function update(over: Record<string, unknown> = {}) {
  return {
    requestId: REQUEST,
    editRequestId: EDIT,
    programId: 'program',
    importId: 'import',
    lessonId: 'lesson',
    slotIndex: 0,
    abandon: false,
    subject: 'Schema A aggiornato',
    caption: 'Didascalia aggiornata',
    altText: 'Descrizione aggiornata',
    anchorHeadingIndex: 1,
    anchorHeadingText: 'B',
    ...over,
  };
}

describe('MULTI-VISUAL-04 — revisione gratuita pura §8.4', () => {
  it('accetta solo i due payload chiusi update/abandon', () => {
    expect(validateVisualPlanEditSlotInput(update()).abandon).toBe(false);
    expect(
      validateVisualPlanEditSlotInput({
        requestId: REQUEST,
        editRequestId: EDIT,
        programId: 'program',
        importId: 'import',
        lessonId: 'lesson',
        slotIndex: 0,
        abandon: true,
      }).abandon,
    ).toBe(true);
    expect(() => validateVisualPlanEditSlotInput(update({ extra: true }))).toThrow();
    expect(() => validateVisualPlanEditSlotInput({ ...update(), abandon: true })).toThrow();
  });

  it('modifica solo editoriale/ancora e conserva costo, rationale e attempts', () => {
    const before = plan();
    const input = validateVisualPlanEditSlotInput(update());
    const after = applyVisualPlanSlotEdit(before, input);
    expect(after.slots[0]).toMatchObject({
      subject: 'Schema A aggiornato',
      caption: 'Didascalia aggiornata',
      altText: 'Descrizione aggiornata',
      rationale: 'Mostra la relazione A.',
      attempts: 0,
      state: 'pending',
    });
    expect(after.settlement).toEqual(before.settlement);
    expect(after.budgetCeiling).toEqual(before.budgetCeiling);
  });

  it('rifiuta duplicati fra slot e qualunque stato già avviato/terminale', () => {
    expect(() =>
      applyVisualPlanSlotEdit(
        plan(),
        validateVisualPlanEditSlotInput(update({ subject: 'Schema B' })),
      ),
    ).toThrow();
    for (const state of ['generating', 'ready', 'promoted', 'abandoned'] as const) {
      const base = plan();
      const slot = { ...base.slots[0], state } as VisualPlanRun['slots'][number];
      expect(() =>
        applyVisualPlanSlotEdit(
          {
            ...base,
            status: state === 'abandoned' ? 'awaiting_review' : 'generating',
            slots: [slot, base.slots[1]],
          },
          validateVisualPlanEditSlotInput(update()),
        ),
      ).toThrow();
    }
  });

  it('abbandona senza consuntivo e deriva abandoned solo sull’ultimo pending', () => {
    const first = applyVisualPlanSlotEdit(
      plan(),
      validateVisualPlanEditSlotInput({
        requestId: REQUEST,
        editRequestId: EDIT,
        programId: 'program',
        importId: 'import',
        lessonId: 'lesson',
        slotIndex: 0,
        abandon: true,
      }),
    );
    expect(first.status).toBe('proposed');
    expect(first.slots[0].state).toBe('abandoned');
    const second = applyVisualPlanSlotEdit(
      first,
      validateVisualPlanEditSlotInput({
        requestId: REQUEST,
        editRequestId: '33333333-3333-4333-8333-333333333333',
        programId: 'program',
        importId: 'import',
        lessonId: 'lesson',
        slotIndex: 1,
        abandon: true,
      }),
    );
    expect(second.status).toBe('abandoned');
    expect(second.settlement.slots).toEqual([]);
  });

  it('lega id e hash idempotenti a owner, request e contenuto esatto', () => {
    const parsed = validateVisualPlanEditSlotInput(update());
    expect(visualPlanSlotEditId(OWNER, EDIT)).toHaveLength(64);
    expect(visualPlanSlotEditId('other-owner', EDIT)).not.toBe(visualPlanSlotEditId(OWNER, EDIT));
    expect(visualPlanSlotEditInputHash(parsed)).not.toBe(
      visualPlanSlotEditInputHash(validateVisualPlanEditSlotInput(update({ caption: 'Altra' }))),
    );
  });
});
