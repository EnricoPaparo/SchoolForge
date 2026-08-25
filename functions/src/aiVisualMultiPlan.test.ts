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
  MAX_VISUAL_ALT_TEXT_CHARS,
  MAX_VISUAL_CAPTION_CHARS,
  MAX_VISUAL_RATIONALE_CHARS,
  MAX_VISUAL_SUBJECT_CHARS,
  VISUAL_STAGING_TTL_MS,
} from './aiContentVisualProposal.js';
import {
  ACCEPTED_VISUAL_UPLOAD_MIME_TYPES,
  AiVisualMultiError,
  MAX_VISUALS_PER_LESSON,
  MAX_VISUAL_UPLOAD_INPUT_BYTES,
  VISUAL_PLAN_CONTRACT_VERSION,
  VISUAL_PLAN_MAX_ATTEMPTS_PER_SLOT,
  computeOpaqueVisualPlanId,
} from './aiVisualMultiCore.js';

/**
 * MULTI-VISUAL-01 — piano coordinato (roadmap §5.5, §8) e vincolo di
 * diversità (§7.4): quantità, stati/decisioni coerenti, tentativi, tetto di
 * budget e consuntivo relazionali, chiavi extra rifiutate.
 *
 * **Review fix (Codex, PR #425, SHA c196ccf).** Sezioni aggiuntive per i
 * cinque blocker: identità/path canonici (1), limiti editoriali VE sugli
 * slot (2), staging legato al piano con cap binari (3), relazioni interne
 * complete del `VisualPlanRun` (4), tassonomia d'errore alla lettura di un
 * piano persistito (5).
 */

const OWNER = 'owner-uid';
const RESERVATION_KEY = 'a'.repeat(64);
const REQUEST_ID = '11111111-2222-4333-8444-555555555555';
const PLAN_HASH = 'b'.repeat(64);
const SOURCE_BODY_HASH = 'c'.repeat(64);
const CREATED_AT_MS = 1_700_000_000_000;
const CREATED_AT = { toMillis: () => CREATED_AT_MS };
const UPDATED_AT = { toMillis: () => CREATED_AT_MS };
const EXPIRE_AT = { toMillis: () => CREATED_AT_MS + VISUAL_STAGING_TTL_MS };
const OPAQUE_PLAN_ID = computeOpaqueVisualPlanId(OWNER, REQUEST_ID);

function stagedFor(slotIndex: number, over: Partial<Record<string, unknown>> = {}) {
  return {
    storageRef: `staging/${OWNER}/${OPAQUE_PLAN_ID}/${slotIndex}.webp`,
    width: 8,
    height: 6,
    byteLength: 100,
    sha256: 'a'.repeat(64),
    ...over,
  };
}

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
    settlement: {
      proposalActualCost: null,
      slots: params.slots.map((slot) => ({
        slotIndex: slot.slotIndex as number,
        attempts: slot.attempts as number,
        actualCost: null,
      })),
    },
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
    expireAt: EXPIRE_AT,
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

// ─── Blocker 1 — identità: id Firestore canonici, UUID, path ──────────────────

describe('blocker 1 — identità canoniche (isValidDocumentIdInput, UUID, SHA-256)', () => {
  function planWithOwner(ownerUid: string) {
    return planOf({ ceiling: 1, slots: [noneSlot(0)], over: { ownerUid } });
  }

  it('accetta un ownerUid esattamente a 1500 byte UTF-8', () => {
    const ownerUid = 'é'.repeat(750); // 750 × 2 byte = 1500 byte esatti
    expect(() => validateVisualPlanRun(planWithOwner(ownerUid))).not.toThrow();
  });

  it('rifiuta un ownerUid a 1501 byte UTF-8', () => {
    const ownerUid = 'é'.repeat(750) + 'a'; // 1500 + 1 = 1501 byte
    expect(() => validateVisualPlanRun(planWithOwner(ownerUid))).toThrow(AiVisualMultiError);
  });

  it('rifiuta un ownerUid nella forma riservata __x__', () => {
    expect(() => validateVisualPlanRun(planWithOwner('__x__'))).toThrow(AiVisualMultiError);
  });

  it('rifiuta un ownerUid con carattere di controllo', () => {
    expect(() => validateVisualPlanRun(planWithOwner('owneruid'))).toThrow(AiVisualMultiError);
  });

  it('rifiuta un ownerUid di traversal ("." o "..")', () => {
    expect(() => validateVisualPlanRun(planWithOwner('.'))).toThrow(AiVisualMultiError);
    expect(() => validateVisualPlanRun(planWithOwner('..'))).toThrow(AiVisualMultiError);
  });

  it('rifiuta un ownerUid con slash incorporato', () => {
    expect(() => validateVisualPlanRun(planWithOwner('a/b'))).toThrow(AiVisualMultiError);
  });

  it('rifiuta un ownerUid con spazi esterni', () => {
    expect(() => validateVisualPlanRun(planWithOwner(' owner-uid '))).toThrow(AiVisualMultiError);
  });

  it('rifiuta un requestId in maiuscolo (case sensitivity canonica)', () => {
    const hexLetterUuid = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    const plan = planOf({
      ceiling: 1,
      slots: [noneSlot(0)],
      over: { requestId: hexLetterUuid.toUpperCase() },
    });
    expect(() => validateVisualPlanRun(plan)).toThrow(AiVisualMultiError);
  });

  it('rifiuta un planHash SHA-256 in maiuscolo', () => {
    const plan = planOf({
      ceiling: 1,
      slots: [noneSlot(0)],
      over: { planHash: PLAN_HASH.toUpperCase() },
    });
    expect(() => validateVisualPlanRun(plan)).toThrow(AiVisualMultiError);
  });

  it('rifiuta un promotedAssetId UUID in maiuscolo', () => {
    const slot = imageSlot(0, {
      state: 'promoted',
      promotedAssetId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'.toUpperCase(),
    });
    expect(() => validateVisualPlanSlot(slot, 2)).toThrow(AiVisualMultiError);
  });
});

// ─── Blocker 2 — limiti editoriali VE sugli slot (roadmap §8.3) ───────────────

describe('blocker 2 — limiti editoriali VE sui campi dello slot', () => {
  it(`accetta subject esattamente a ${MAX_VISUAL_SUBJECT_CHARS} code point`, () => {
    const subject = 'a'.repeat(MAX_VISUAL_SUBJECT_CHARS);
    expect(validateVisualPlanSlot(imageSlot(0, { subject }), 2).subject).toBe(subject);
  });

  it(`rifiuta subject a ${MAX_VISUAL_SUBJECT_CHARS + 1} code point`, () => {
    const subject = 'a'.repeat(MAX_VISUAL_SUBJECT_CHARS + 1);
    expect(() => validateVisualPlanSlot(imageSlot(0, { subject }), 2)).toThrow();
  });

  it(`accetta rationale esattamente a ${MAX_VISUAL_RATIONALE_CHARS} code point`, () => {
    const rationale = 'a'.repeat(MAX_VISUAL_RATIONALE_CHARS);
    expect(validateVisualPlanSlot(imageSlot(0, { rationale }), 2).rationale).toBe(rationale);
  });

  it(`rifiuta rationale a ${MAX_VISUAL_RATIONALE_CHARS + 1} code point`, () => {
    const rationale = 'a'.repeat(MAX_VISUAL_RATIONALE_CHARS + 1);
    expect(() => validateVisualPlanSlot(imageSlot(0, { rationale }), 2)).toThrow();
  });

  it(`accetta caption esattamente a ${MAX_VISUAL_CAPTION_CHARS} code point`, () => {
    const caption = 'a'.repeat(MAX_VISUAL_CAPTION_CHARS);
    expect(validateVisualPlanSlot(imageSlot(0, { caption }), 2).caption).toBe(caption);
  });

  it(`rifiuta caption a ${MAX_VISUAL_CAPTION_CHARS + 1} code point`, () => {
    const caption = 'a'.repeat(MAX_VISUAL_CAPTION_CHARS + 1);
    expect(() => validateVisualPlanSlot(imageSlot(0, { caption }), 2)).toThrow();
  });

  it(`accetta altText esattamente a ${MAX_VISUAL_ALT_TEXT_CHARS} code point`, () => {
    const altText = 'a'.repeat(MAX_VISUAL_ALT_TEXT_CHARS);
    expect(validateVisualPlanSlot(imageSlot(0, { altText }), 2).altText).toBe(altText);
  });

  it(`rifiuta altText a ${MAX_VISUAL_ALT_TEXT_CHARS + 1} code point`, () => {
    const altText = 'a'.repeat(MAX_VISUAL_ALT_TEXT_CHARS + 1);
    expect(() => validateVisualPlanSlot(imageSlot(0, { altText }), 2)).toThrow();
  });

  it('rifiuta un subject vietato (imitazione di stile)', () => {
    expect(() =>
      validateVisualPlanSlot(
        imageSlot(0, { subject: 'Un disegno in the style of un noto illustratore' }),
        2,
      ),
    ).toThrow();
  });

  it('rifiuta rationale con caratteri di controllo', () => {
    expect(() =>
      validateVisualPlanSlot(imageSlot(0, { rationale: 'Motivo concontrollo' }), 2),
    ).toThrow();
  });

  it('rifiuta caption con markup HTML', () => {
    expect(() =>
      validateVisualPlanSlot(imageSlot(0, { caption: '<b>Didascalia</b>' }), 2),
    ).toThrow();
  });

  it('rifiuta altText con blocco di codice (fence)', () => {
    expect(() => validateVisualPlanSlot(imageSlot(0, { altText: '```codice```' }), 2)).toThrow();
  });

  it('accetta apostrofi italiani legittimi in subject e rationale', () => {
    const slot = validateVisualPlanSlot(
      imageSlot(0, {
        subject: "L'acqua e il suo ciclo naturale",
        rationale: "Mostra com'è distribuita l'acqua sulla superficie",
      }),
      2,
    );
    expect(slot.subject).toContain("L'acqua");
    expect(slot.rationale).toContain("com'è");
  });
});

// ─── Blocker 3 — staging legato al piano, con cap binari (roadmap §5.5) ───────

describe('blocker 3 — staging legato al piano e cap binari', () => {
  it('accetta il path di staging ricostruito correttamente (caso positivo)', () => {
    const plan = planOf({
      ceiling: 1,
      slots: [imageSlot(0, { state: 'ready', staged: stagedFor(0) })],
    });
    expect(() => validateVisualPlanRun(plan)).not.toThrow();
  });

  it('rifiuta storageRef di staging di un altro owner (a livello di piano)', () => {
    const plan = planOf({
      ceiling: 1,
      slots: [
        imageSlot(0, {
          state: 'ready',
          staged: stagedFor(0, { storageRef: `staging/altro-owner/${OPAQUE_PLAN_ID}/0.webp` }),
        }),
      ],
    });
    expect(() => validateVisualPlanRun(plan)).toThrow(AiVisualMultiError);
  });

  it('rifiuta storageRef di staging con opaquePlanId sbagliato (a livello di piano)', () => {
    const plan = planOf({
      ceiling: 1,
      slots: [
        imageSlot(0, {
          state: 'ready',
          staged: stagedFor(0, { storageRef: `staging/${OWNER}/${'f'.repeat(64)}/0.webp` }),
        }),
      ],
    });
    expect(() => validateVisualPlanRun(plan)).toThrow(AiVisualMultiError);
  });

  it('rifiuta storageRef di staging con indice sbagliato (slot 0 che dichiara 2.webp)', () => {
    expect(() =>
      validateVisualPlanSlot(imageSlot(0, { state: 'ready', staged: stagedFor(2) }), 2),
    ).toThrow(AiVisualMultiError);
  });

  it('rifiuta storageRef di staging con estensione sbagliata', () => {
    expect(() =>
      validateVisualPlanSlot(
        imageSlot(0, {
          state: 'ready',
          staged: stagedFor(0, { storageRef: `staging/${OWNER}/${OPAQUE_PLAN_ID}/0.png` }),
        }),
        2,
      ),
    ).toThrow(AiVisualMultiError);
  });

  it('rifiuta storageRef di staging con traversal', () => {
    expect(() =>
      validateVisualPlanSlot(
        imageSlot(0, {
          state: 'ready',
          staged: stagedFor(0, { storageRef: `staging/../${OPAQUE_PLAN_ID}/0.webp` }),
        }),
        2,
      ),
    ).toThrow(AiVisualMultiError);
  });

  it('rifiuta storageRef di staging con doppio slash', () => {
    expect(() =>
      validateVisualPlanSlot(
        imageSlot(0, {
          state: 'ready',
          staged: stagedFor(0, { storageRef: `staging//${OPAQUE_PLAN_ID}/0.webp` }),
        }),
        2,
      ),
    ).toThrow(AiVisualMultiError);
  });

  it('rifiuta width/height 1201 in staging', () => {
    expect(() =>
      validateVisualPlanSlot(
        imageSlot(0, { state: 'ready', staged: stagedFor(0, { width: 1201 }) }),
        2,
      ),
    ).toThrow(AiVisualMultiError);
    expect(() =>
      validateVisualPlanSlot(
        imageSlot(0, { state: 'ready', staged: stagedFor(0, { height: 1201 }) }),
        2,
      ),
    ).toThrow(AiVisualMultiError);
  });

  it('rifiuta byteLength 204801 in staging', () => {
    expect(() =>
      validateVisualPlanSlot(
        imageSlot(0, { state: 'ready', staged: stagedFor(0, { byteLength: 204_801 }) }),
        2,
      ),
    ).toThrow(AiVisualMultiError);
  });

  it('accetta width/height 1200 e byteLength 204800 in staging (limite esatto)', () => {
    const slot = validateVisualPlanSlot(
      imageSlot(0, {
        state: 'ready',
        staged: stagedFor(0, { width: 1200, height: 1200, byteLength: 204_800 }),
      }),
      2,
    );
    expect(slot.staged?.width).toBe(1200);
  });
});

// ─── Slot — forma e relazioni generali ─────────────────────────────────────────

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

  it('rifiuta decision "image" con subject nullo (provider_invalid_output)', () => {
    let thrown: unknown;
    try {
      validateVisualPlanSlot(imageSlot(0, { subject: null }), 2);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeTruthy();
    expect((thrown as { code?: string }).code).toBe('provider_invalid_output');
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
    expect(() => validateVisualPlanSlot(imageSlot(0, { staged: stagedFor(0) }), 2)).toThrow(
      AiVisualMultiError,
    );
  });

  it('accetta staged presente con state "ready"', () => {
    const slot = validateVisualPlanSlot(imageSlot(0, { state: 'ready', staged: stagedFor(0) }), 2);
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

  it('rifiuta state "failed" con lastError nullo', () => {
    expect(() =>
      validateVisualPlanSlot(imageSlot(0, { state: 'failed', lastError: null }), 2),
    ).toThrow(AiVisualMultiError);
  });

  it('accetta state "failed" con lastError tipizzato', () => {
    const slot = validateVisualPlanSlot(
      imageSlot(0, { state: 'failed', lastError: 'transient_error' }),
      2,
    );
    expect(slot.lastError).toBe('transient_error');
  });

  it('rifiuta lastError presente con state diverso da "failed"', () => {
    expect(() =>
      validateVisualPlanSlot(imageSlot(0, { state: 'pending', lastError: 'transient_error' }), 2),
    ).toThrow(AiVisualMultiError);
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

// ─── Blocker 4 — relazioni interne del VisualPlanRun ───────────────────────────

describe('blocker 4 — relazioni interne complete del piano', () => {
  it('rifiuta maxAttemptsPerSlot arbitrario (es. 999) anche se attempts resterebbe entro quel tetto', () => {
    const plan = planOf({ ceiling: 1, slots: [imageSlot(0, { attempts: 500 })] });
    (plan.budgetCeiling as Record<string, unknown>).maxAttemptsPerSlot = 999;
    (plan.budgetCeiling as Record<string, unknown>).totalReserved = computeVisualPlanTotalReserved({
      proposalCap: 1,
      generationCap: 1,
      ceiling: 1,
      maxAttemptsPerSlot: 999,
    });
    expect(() => validateVisualPlanRun(plan)).toThrow(AiVisualMultiError);
  });

  it('rifiuta existingItemAssetIds.length + quantity.ceiling oltre il tetto di tre', () => {
    const plan = planOf({
      ceiling: 2,
      slots: [imageSlot(0), imageSlot(1)],
      over: {
        existingItemAssetIds: [
          '11111111-2222-4333-8444-555555555555',
          '22222222-2222-4333-8444-555555555555',
        ],
      },
    });
    expect(() => validateVisualPlanRun(plan)).toThrow(AiVisualMultiError);
  });

  it('accetta existingItemAssetIds.length + quantity.ceiling esattamente pari a tre', () => {
    const plan = planOf({
      ceiling: 1,
      slots: [imageSlot(0)],
      over: {
        existingItemAssetIds: [
          '11111111-2222-4333-8444-555555555555',
          '22222222-2222-4333-8444-555555555555',
        ],
      },
    });
    expect(() => validateVisualPlanRun(plan)).not.toThrow();
  });

  it('rifiuta uno slot il cui slotIndex non corrisponde alla propria posizione', () => {
    const plan = planOf({ ceiling: 2, slots: [imageSlot(1), noneSlot(0)] });
    expect(() => validateVisualPlanRun(plan)).toThrow(AiVisualMultiError);
  });

  it('rifiuta un consuntivo con attempts diverso da quello dello slot', () => {
    const plan = planOf({
      ceiling: 1,
      slots: [imageSlot(0, { attempts: 1 })],
      over: {
        settlement: {
          proposalActualCost: null,
          slots: [{ slotIndex: 0, attempts: 2, actualCost: null }],
        },
      },
    });
    expect(() => validateVisualPlanRun(plan)).toThrow(AiVisualMultiError);
  });

  it('rifiuta un consuntivo con actualCost non nullo quando attempts è zero', () => {
    const plan = planOf({
      ceiling: 1,
      slots: [imageSlot(0, { attempts: 0 })],
      over: {
        settlement: {
          proposalActualCost: null,
          slots: [{ slotIndex: 0, attempts: 0, actualCost: 10 }],
        },
      },
    });
    expect(() => validateVisualPlanRun(plan)).toThrow(AiVisualMultiError);
  });

  it('accetta un consuntivo entro il tetto riservato, con attempts coerenti', () => {
    const budgetCeiling = budgetCeilingFor(1);
    const plan = planOf({
      ceiling: 1,
      slots: [imageSlot(0, { attempts: 1 })],
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

  it('rifiuta un consuntivo che supera il tetto riservato, con attempts coerenti', () => {
    const budgetCeiling = budgetCeilingFor(1);
    const plan = planOf({
      ceiling: 1,
      slots: [imageSlot(0, { attempts: 1 })],
      over: {
        budgetCeiling,
        settlement: {
          proposalActualCost: 1,
          slots: [{ slotIndex: 0, attempts: 1, actualCost: budgetCeiling.totalReserved as number }],
        },
      },
    });
    expect(() => validateVisualPlanRun(plan)).toThrow(AiVisualMultiError);
  });

  it('rifiuta un consuntivo che referenzia uno slotIndex inesistente', () => {
    const plan = planOf({
      ceiling: 1,
      slots: [imageSlot(0)],
      over: {
        settlement: {
          proposalActualCost: null,
          slots: [{ slotIndex: 5, attempts: 0, actualCost: null }],
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

  it('rifiuta totalReserved non coerente con la formula del tetto', () => {
    const plan = planOf({ ceiling: 1, slots: [imageSlot(0)] });
    (plan.budgetCeiling as Record<string, unknown>).totalReserved = 999;
    expect(() => validateVisualPlanRun(plan)).toThrow(AiVisualMultiError);
  });

  describe('status derivato dagli stati degli slot (§8.7)', () => {
    it('rifiuta status "completed" con uno slot ancora "pending"', () => {
      const plan = planOf({
        ceiling: 1,
        slots: [imageSlot(0, { state: 'pending' })],
        over: { status: 'completed' },
      });
      expect(() => validateVisualPlanRun(plan)).toThrow(AiVisualMultiError);
    });

    it('accetta status "completed" quando ogni slot immagine è promosso', () => {
      const assetId = '11111111-2222-4333-8444-555555555555';
      const plan = planOf({
        ceiling: 1,
        slots: [imageSlot(0, { state: 'promoted', promotedAssetId: assetId })],
        over: {
          status: 'completed',
          settlement: {
            proposalActualCost: null,
            slots: [{ slotIndex: 0, attempts: 0, actualCost: null }],
          },
        },
      });
      expect(() => validateVisualPlanRun(plan)).not.toThrow();
    });

    it('rifiuta status "partially_completed" senza alcuno slot promosso', () => {
      const plan = planOf({
        ceiling: 2,
        slots: [imageSlot(0, { state: 'failed', lastError: 'transient_error' }), noneSlot(1)],
        over: { status: 'partially_completed' },
      });
      expect(() => validateVisualPlanRun(plan)).toThrow(AiVisualMultiError);
    });

    it('accetta status "partially_completed" con un misto promosso/non promosso', () => {
      const assetId = '11111111-2222-4333-8444-555555555555';
      const plan = planOf({
        ceiling: 2,
        slots: [
          imageSlot(0, { state: 'promoted', promotedAssetId: assetId }),
          imageSlot(1, { state: 'failed', lastError: 'transient_error' }),
        ],
        over: { status: 'partially_completed' },
      });
      expect(() => validateVisualPlanRun(plan)).not.toThrow();
    });

    it('rifiuta status "abandoned" con uno slot promosso', () => {
      const assetId = '11111111-2222-4333-8444-555555555555';
      const plan = planOf({
        ceiling: 1,
        slots: [imageSlot(0, { state: 'promoted', promotedAssetId: assetId })],
        over: { status: 'abandoned' },
      });
      expect(() => validateVisualPlanRun(plan)).toThrow(AiVisualMultiError);
    });

    it('accetta status "abandoned" quando nessuno slot immagine è promosso', () => {
      const plan = planOf({
        ceiling: 1,
        slots: [imageSlot(0, { state: 'abandoned' })],
        over: { status: 'abandoned' },
      });
      expect(() => validateVisualPlanRun(plan)).not.toThrow();
    });
  });

  describe('ordine e TTL dei timestamp', () => {
    it('rifiuta updatedAt precedente a createdAt', () => {
      const plan = planOf({
        ceiling: 1,
        slots: [noneSlot(0)],
        over: { updatedAt: { toMillis: () => CREATED_AT_MS - 1 } },
      });
      expect(() => validateVisualPlanRun(plan)).toThrow(AiVisualMultiError);
    });

    it('rifiuta expireAt diverso da createdAt + TTL 24h', () => {
      const plan = planOf({
        ceiling: 1,
        slots: [noneSlot(0)],
        over: { expireAt: { toMillis: () => CREATED_AT_MS + VISUAL_STAGING_TTL_MS - 1 } },
      });
      expect(() => validateVisualPlanRun(plan)).toThrow(AiVisualMultiError);
    });

    it('accetta expireAt esattamente createdAt + TTL 24h', () => {
      expect(() =>
        validateVisualPlanRun(planOf({ ceiling: 1, slots: [noneSlot(0)] })),
      ).not.toThrow();
    });
  });
});

// ─── Blocker 5 — tassonomia d'errore alla lettura di un piano persistito ──────

describe('blocker 5 — corrupted_state per qualunque errore annidato in validateVisualPlanRun', () => {
  it('ancora malformata in uno slot ⇒ corrupted_state, non invalid_input', () => {
    const plan = planOf({
      ceiling: 1,
      slots: [imageSlot(0, { anchor: { anchorHeadingIndex: -1, anchorHeadingText: 'X' } })],
    });
    let thrown: unknown;
    try {
      validateVisualPlanRun(plan);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(AiVisualMultiError);
    expect((thrown as AiVisualMultiError).code).toBe('corrupted_state');
  });

  it('subject vietato in uno slot ⇒ corrupted_state, non provider_invalid_output', () => {
    const plan = planOf({
      ceiling: 1,
      slots: [imageSlot(0, { subject: 'Un disegno in the style of un noto illustratore' })],
    });
    let thrown: unknown;
    try {
      validateVisualPlanRun(plan);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(AiVisualMultiError);
    expect((thrown as AiVisualMultiError).code).toBe('corrupted_state');
  });

  it('quantity malformata ⇒ corrupted_state', () => {
    const plan = planOf({
      ceiling: 1,
      slots: [noneSlot(0)],
      over: { quantity: { mode: 'auto', ceiling: 9 } },
    });
    let thrown: unknown;
    try {
      validateVisualPlanRun(plan);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(AiVisualMultiError);
    expect((thrown as AiVisualMultiError).code).toBe('corrupted_state');
  });

  it('settlement malformato (chiave extra) ⇒ corrupted_state', () => {
    const plan = planOf({
      ceiling: 1,
      slots: [imageSlot(0)],
      over: { settlement: { proposalActualCost: null, slots: [], extra: true } },
    });
    let thrown: unknown;
    try {
      validateVisualPlanRun(plan);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(AiVisualMultiError);
    expect((thrown as AiVisualMultiError).code).toBe('corrupted_state');
  });

  it('validateVisualPlanDiversity resta provider_invalid_output — non è chiamata da validateVisualPlanRun', () => {
    const slots: VisualPlanSlot[] = [
      validateVisualPlanSlot(imageSlot(0, { subject: 'Stesso soggetto' }), 2),
      validateVisualPlanSlot(imageSlot(1, { subject: 'stesso   soggetto' }), 2),
    ];
    let thrown: unknown;
    try {
      validateVisualPlanDiversity(slots);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(AiVisualMultiError);
    expect((thrown as AiVisualMultiError).code).toBe('provider_invalid_output');
  });
});
