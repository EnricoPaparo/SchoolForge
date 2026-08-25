import { describe, expect, it } from 'vitest';
import {
  computeVisualPlanTotalReserved,
  validateVisualPlanDiversity,
  validateVisualPlanQuantitySelection,
  validateVisualPlanRun,
  validateVisualPlanSlot,
  type VisualPlanSlot,
} from './aiVisualMultiPlan.js';
import {
  ACCEPTED_VISUAL_UPLOAD_MIME_TYPES,
  AiVisualMultiError,
  MAX_VISUALS_PER_LESSON,
  MAX_VISUAL_UPLOAD_INPUT_BYTES,
  VISUAL_PLAN_CONTRACT_VERSION,
  VISUAL_PLAN_MAX_ATTEMPTS_PER_SLOT,
} from './aiVisualMultiCore.js';

/**
 * MULTI-VISUAL-01 — piano coordinato (roadmap §5.5, §8) e vincolo di
 * diversità (§7.4): quantità, stati/decisioni coerenti, tentativi, tetto di
 * budget e consuntivo relazionali, chiavi extra rifiutate.
 */

const OWNER = 'owner-uid';
const RESERVATION_KEY = 'a'.repeat(64);
const REQUEST_ID = '11111111-2222-4333-8444-555555555555';
const PLAN_HASH = 'b'.repeat(64);
const SOURCE_BODY_HASH = 'c'.repeat(64);
const NOW = { toMillis: () => 1_700_000_000_000 };

function imageSlot(slotIndex: number, over: Partial<Record<string, unknown>> = {}) {
  return {
    slotIndex,
    state: 'pending',
    decision: 'image',
    subject: `Soggetto distintivo ${slotIndex}`,
    rationale: `Motivo didattico ${slotIndex}`,
    anchor: { anchorHeadingIndex: 0, anchorHeadingText: 'Introduzione' },
    caption: 'Didascalia',
    altText: 'Alt',
    attempts: 0,
    lastError: null,
    staged: null,
    promotedAssetId: null,
    ...over,
  };
}

function noneSlot(slotIndex: number, over: Partial<Record<string, unknown>> = {}) {
  return {
    slotIndex,
    state: 'abandoned',
    decision: 'none',
    subject: null,
    rationale: null,
    anchor: null,
    caption: null,
    altText: null,
    attempts: 0,
    lastError: null,
    staged: null,
    promotedAssetId: null,
    ...over,
  };
}

function budgetCeilingFor(ceiling: 1 | 2 | 3, over: Partial<Record<string, unknown>> = {}) {
  const proposalCap = 1;
  const generationCap = 1;
  const maxAttemptsPerSlot = VISUAL_PLAN_MAX_ATTEMPTS_PER_SLOT;
  const totalReserved = computeVisualPlanTotalReserved({
    proposalCap,
    generationCap,
    ceiling,
    maxAttemptsPerSlot,
  });
  return {
    reservationKey: RESERVATION_KEY,
    proposalCap,
    generationCap,
    maxAttemptsPerSlot,
    totalReserved,
    ...over,
  };
}

function planOf(params: {
  ceiling: 1 | 2 | 3;
  slots: Record<string, unknown>[];
  over?: Partial<Record<string, unknown>>;
}) {
  const budgetCeiling = budgetCeilingFor(params.ceiling);
  return {
    contractVersion: VISUAL_PLAN_CONTRACT_VERSION,
    ownerUid: OWNER,
    programId: 'prog-1',
    importId: 'imp-1',
    lessonId: 'lesson-1',
    publicLessonId: 'imp-1_lesson-1',
    udaDir: 'uda-01',
    requestId: REQUEST_ID,
    planHash: PLAN_HASH,
    status: 'awaiting_review',
    quantity: { mode: 'auto', ceiling: params.ceiling },
    sourceBodyHash: SOURCE_BODY_HASH,
    existingItemAssetIds: [],
    budgetCeiling,
    slots: params.slots,
    settlement: { proposalActualCost: null, slots: [] },
    createdAt: NOW,
    updatedAt: NOW,
    expireAt: NOW,
    ...params.over,
  };
}

// ─── Costanti (roadmap §5.6, §9) ───────────────────────────────────────────────

describe('costanti', () => {
  it('corrispondono esattamente al mandato', () => {
    expect(MAX_VISUALS_PER_LESSON).toBe(3);
    expect(MAX_VISUAL_UPLOAD_INPUT_BYTES).toBe(2_000_000);
    expect(ACCEPTED_VISUAL_UPLOAD_MIME_TYPES).toEqual(['image/png', 'image/jpeg', 'image/webp']);
    expect(VISUAL_PLAN_MAX_ATTEMPTS_PER_SLOT).toBe(2);
  });
});

// ─── Quantità ───────────────────────────────────────────────────────────────────

describe('validateVisualPlanQuantitySelection', () => {
  it.each([1, 2, 3] as const)('accetta ceiling %i in modalità auto ed exact', (ceiling) => {
    expect(validateVisualPlanQuantitySelection({ mode: 'auto', ceiling })).toEqual({
      mode: 'auto',
      ceiling,
    });
    expect(validateVisualPlanQuantitySelection({ mode: 'exact', ceiling })).toEqual({
      mode: 'exact',
      ceiling,
    });
  });

  it('rifiuta ceiling 0 o 4', () => {
    expect(() => validateVisualPlanQuantitySelection({ mode: 'auto', ceiling: 0 })).toThrow();
    expect(() => validateVisualPlanQuantitySelection({ mode: 'auto', ceiling: 4 })).toThrow();
  });

  it('rifiuta un mode non ammesso', () => {
    expect(() => validateVisualPlanQuantitySelection({ mode: 'max', ceiling: 1 })).toThrow();
  });
});

// ─── Slot ─────────────────────────────────────────────────────────────────────

describe('validateVisualPlanSlot', () => {
  it('accetta uno slot "image" completo', () => {
    const slot = validateVisualPlanSlot(imageSlot(0), 2);
    expect(slot.decision).toBe('image');
    expect(slot.subject).not.toBeNull();
  });

  it('accetta uno slot "none" con tutti i campi editoriali nulli', () => {
    const slot = validateVisualPlanSlot(noneSlot(0), 2);
    expect(slot.decision).toBe('none');
    expect(slot.subject).toBeNull();
    expect(slot.anchor).toBeNull();
  });

  it('rifiuta decision "image" con subject nullo', () => {
    expect(() => validateVisualPlanSlot(imageSlot(0, { subject: null }), 2)).toThrow(
      AiVisualMultiError,
    );
  });

  it('rifiuta decision "none" con subject valorizzato', () => {
    expect(() => validateVisualPlanSlot(noneSlot(0, { subject: 'Qualcosa' }), 2)).toThrow(
      AiVisualMultiError,
    );
  });

  it('rifiuta attempts oltre VISUAL_PLAN_MAX_ATTEMPTS_PER_SLOT', () => {
    expect(() => validateVisualPlanSlot(imageSlot(0, { attempts: 3 }), 2)).toThrow(
      AiVisualMultiError,
    );
  });

  it('accetta attempts fino al tetto', () => {
    expect(validateVisualPlanSlot(imageSlot(0, { attempts: 2 }), 2).attempts).toBe(2);
  });

  it('rifiuta staged presente con state diverso da "ready"', () => {
    expect(() =>
      validateVisualPlanSlot(
        imageSlot(0, {
          staged: {
            storageRef: 'staging/owner-uid/' + 'f'.repeat(64) + '/0.webp',
            width: 8,
            height: 6,
            byteLength: 100,
            sha256: 'a'.repeat(64),
          },
        }),
        2,
      ),
    ).toThrow(AiVisualMultiError);
  });

  it('accetta staged presente con state "ready"', () => {
    const slot = validateVisualPlanSlot(
      imageSlot(0, {
        state: 'ready',
        staged: {
          storageRef: `staging/${OWNER}/${'f'.repeat(64)}/0.webp`,
          width: 8,
          height: 6,
          byteLength: 100,
          sha256: 'a'.repeat(64),
        },
      }),
      2,
    );
    expect(slot.staged).not.toBeNull();
  });

  it('rifiuta state "ready" senza staged', () => {
    expect(() => validateVisualPlanSlot(imageSlot(0, { state: 'ready' }), 2)).toThrow(
      AiVisualMultiError,
    );
  });

  it('rifiuta promotedAssetId presente con state diverso da "promoted"', () => {
    expect(() =>
      validateVisualPlanSlot(
        imageSlot(0, { promotedAssetId: '11111111-2222-4333-8444-555555555555' }),
        2,
      ),
    ).toThrow(AiVisualMultiError);
  });

  it('accetta promotedAssetId presente con state "promoted"', () => {
    const slot = validateVisualPlanSlot(
      imageSlot(0, { state: 'promoted', promotedAssetId: '11111111-2222-4333-8444-555555555555' }),
      2,
    );
    expect(slot.promotedAssetId).toBe('11111111-2222-4333-8444-555555555555');
  });

  it('rifiuta state "promoted" senza promotedAssetId', () => {
    expect(() => validateVisualPlanSlot(imageSlot(0, { state: 'promoted' }), 2)).toThrow(
      AiVisualMultiError,
    );
  });

  it('rifiuta chiavi extra', () => {
    expect(() => validateVisualPlanSlot(imageSlot(0, { extra: true }), 2)).toThrow(
      AiVisualMultiError,
    );
  });
});

// ─── Vincolo di diversità (roadmap §7.4) ───────────────────────────────────────

describe('validateVisualPlanDiversity', () => {
  it('accetta due slot sulla stessa ancora con soggetto e utilità distinti (prototipo page-teacher-2)', () => {
    const slots: VisualPlanSlot[] = [
      validateVisualPlanSlot(
        imageSlot(0, {
          subject: 'Precipitazione sul rilievo',
          rationale: 'Mostra da dove viene l’acqua',
        }),
        2,
      ),
      validateVisualPlanSlot(
        imageSlot(1, {
          subject: 'Ruscellamento superficiale reale',
          rationale: 'Mostra dove va l’acqua',
        }),
        2,
      ),
    ];
    expect(() => validateVisualPlanDiversity(slots)).not.toThrow();
  });

  it('rifiuta due subject normalizzati identici, con la stessa ancora', () => {
    const slots: VisualPlanSlot[] = [
      validateVisualPlanSlot(imageSlot(0, { subject: 'Il Bilancio idrico' }), 2),
      validateVisualPlanSlot(imageSlot(1, { subject: 'il bilancio   idrico' }), 2),
    ];
    expect(() => validateVisualPlanDiversity(slots)).toThrow(AiVisualMultiError);
  });

  it('rifiuta due subject normalizzati identici, con ancore diverse', () => {
    const slots: VisualPlanSlot[] = [
      validateVisualPlanSlot(
        imageSlot(0, {
          subject: 'Stesso soggetto',
          anchor: { anchorHeadingIndex: 0, anchorHeadingText: 'A' },
        }),
        2,
      ),
      validateVisualPlanSlot(
        imageSlot(1, {
          subject: 'stesso   soggetto',
          anchor: { anchorHeadingIndex: 1, anchorHeadingText: 'B' },
        }),
        2,
      ),
    ];
    expect(() => validateVisualPlanDiversity(slots)).toThrow(AiVisualMultiError);
  });

  it('rifiuta due rationale normalizzati identici anche con subject diversi', () => {
    const slots: VisualPlanSlot[] = [
      validateVisualPlanSlot(
        imageSlot(0, { subject: 'Soggetto uno', rationale: 'Mostra il ciclo dell’acqua' }),
        2,
      ),
      validateVisualPlanSlot(
        imageSlot(1, { subject: 'Soggetto due', rationale: 'mostra   il ciclo dell’acqua' }),
        2,
      ),
    ];
    expect(() => validateVisualPlanDiversity(slots)).toThrow(AiVisualMultiError);
  });

  it('la sola uguaglianza di anchorHeadingIndex, con subject/rationale distinti, non produce mai un rifiuto', () => {
    const sameAnchor = { anchorHeadingIndex: 2, anchorHeadingText: 'Stessa sezione' };
    const slots: VisualPlanSlot[] = [
      validateVisualPlanSlot(
        imageSlot(0, { anchor: sameAnchor, subject: 'A', rationale: 'Motivo A' }),
        2,
      ),
      validateVisualPlanSlot(
        imageSlot(1, { anchor: sameAnchor, subject: 'B', rationale: 'Motivo B' }),
        2,
      ),
      validateVisualPlanSlot(
        imageSlot(2, { anchor: sameAnchor, subject: 'C', rationale: 'Motivo C' }),
        2,
      ),
    ];
    expect(() => validateVisualPlanDiversity(slots)).not.toThrow();
  });
});

// ─── Tetto di budget (roadmap §12.1) ────────────────────────────────────────────

describe('computeVisualPlanTotalReserved', () => {
  it.each([1, 2, 3] as const)('include il fattore maxAttemptsPerSlot per ceiling %i', (ceiling) => {
    const total = computeVisualPlanTotalReserved({
      proposalCap: 5,
      generationCap: 7,
      ceiling,
      maxAttemptsPerSlot: 2,
    });
    expect(total).toBe(5 + 7 * ceiling * 2);
  });
});

// ─── Piano completo — cardinalità, relazioni, chiavi extra ─────────────────────

describe('validateVisualPlanRun', () => {
  it('accetta un piano con 1, 2 o 3 slot coerenti', () => {
    expect(validateVisualPlanRun(planOf({ ceiling: 1, slots: [imageSlot(0)] })).slots).toHaveLength(
      1,
    );
    expect(
      validateVisualPlanRun(planOf({ ceiling: 2, slots: [imageSlot(0), noneSlot(1)] })).slots,
    ).toHaveLength(2);
    expect(
      validateVisualPlanRun(
        planOf({ ceiling: 3, slots: [imageSlot(0), imageSlot(1), noneSlot(2)] }),
      ).slots,
    ).toHaveLength(3);
  });

  it('rifiuta chiavi extra al livello del piano', () => {
    expect(() =>
      validateVisualPlanRun(planOf({ ceiling: 1, slots: [imageSlot(0)], over: { extra: true } })),
    ).toThrow(AiVisualMultiError);
  });

  it('rifiuta slots.length oltre quantity.ceiling', () => {
    expect(() =>
      validateVisualPlanRun(planOf({ ceiling: 1, slots: [imageSlot(0), noneSlot(1)] })),
    ).toThrow(AiVisualMultiError);
  });

  it('rifiuta slotIndex duplicati', () => {
    expect(() =>
      validateVisualPlanRun(planOf({ ceiling: 2, slots: [imageSlot(0), imageSlot(0)] })),
    ).toThrow(AiVisualMultiError);
  });

  it('rifiuta totalReserved non coerente con la formula del tetto', () => {
    const plan = planOf({ ceiling: 1, slots: [imageSlot(0)] });
    (plan.budgetCeiling as Record<string, unknown>).totalReserved = 999;
    expect(() => validateVisualPlanRun(plan)).toThrow(AiVisualMultiError);
  });

  it('rifiuta un consuntivo che supera il tetto riservato', () => {
    const plan = planOf({
      ceiling: 1,
      slots: [imageSlot(0)],
      over: {
        settlement: {
          proposalActualCost: 1_000_000,
          slots: [{ slotIndex: 0, attempts: 1, actualCost: 1_000_000 }],
        },
      },
    });
    expect(() => validateVisualPlanRun(plan)).toThrow(AiVisualMultiError);
  });

  it('accetta un consuntivo entro il tetto riservato', () => {
    const budgetCeiling = budgetCeilingFor(1);
    const plan = planOf({
      ceiling: 1,
      slots: [imageSlot(0)],
      over: {
        budgetCeiling,
        settlement: {
          proposalActualCost: 0,
          slots: [{ slotIndex: 0, attempts: 1, actualCost: budgetCeiling.totalReserved as number }],
        },
      },
    });
    expect(() => validateVisualPlanRun(plan)).not.toThrow();
  });

  it('rifiuta un consuntivo che referenzia uno slotIndex inesistente', () => {
    const plan = planOf({
      ceiling: 1,
      slots: [imageSlot(0)],
      over: {
        settlement: {
          proposalActualCost: null,
          slots: [{ slotIndex: 5, attempts: 1, actualCost: 0 }],
        },
      },
    });
    expect(() => validateVisualPlanRun(plan)).toThrow(AiVisualMultiError);
  });

  it('rifiuta existingItemAssetIds duplicati', () => {
    const plan = planOf({
      ceiling: 1,
      slots: [imageSlot(0)],
      over: {
        existingItemAssetIds: [
          '11111111-2222-4333-8444-555555555555',
          '11111111-2222-4333-8444-555555555555',
        ],
      },
    });
    expect(() => validateVisualPlanRun(plan)).toThrow(AiVisualMultiError);
  });
});
