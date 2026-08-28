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
import { computeBudgetReservationKey } from './aiContentCore.js';
import {
  ACCEPTED_VISUAL_UPLOAD_MIME_TYPES,
  AiVisualMultiError,
  MAX_VISUALS_PER_LESSON,
  MAX_VISUAL_UPLOAD_INPUT_BYTES,
  VISUAL_PLAN_CONTRACT_VERSION,
  VISUAL_PLAN_MAX_ATTEMPTS_PER_SLOT,
  computeOpaqueVisualPlanId,
  computeVisualPlanHash,
} from './aiVisualMultiCore.js';

/**
 * MULTI-VISUAL-01 — piano coordinato (roadmap §5.5, §8) e vincolo di
 * diversità (§7.4): quantità, stati/decisioni coerenti, tentativi, tetto di
 * budget e consuntivo relazionali, chiavi extra rifiutate.
 *
 * **Review fix round 1 (Codex, PR #425, SHA c196ccf).** Identità/path
 * canonici, limiti editoriali VE, staging legato al piano, relazioni
 * interne del piano, tassonomia d'errore alla lettura di un piano
 * persistito.
 *
 * **Review fix round 2 (Codex, PR #425, SHA 1a8837a).** Tre correzioni
 * residue: `failed` terminale solo dopo il tetto di tentativi (blocker 1),
 * coerenza completa stato/decisione/tentativi e completezza del consuntivo
 * (blocker 2), ordine dei timestamp specifico per `expired` (blocker 3).
 * `validateVisualPlanSlot` non accetta più un tetto esterno: legge sempre
 * `VISUAL_PLAN_MAX_ATTEMPTS_PER_SLOT`.
 */

const OWNER = 'owner-uid';
// **Review fix (Codex, blocker P1/5).** `validateVisualPlanRun` ora
// ricalcola e verifica `planHash`/`budgetCeiling.reservationKey` contro gli
// altri campi persistiti (mai più solo «forma di SHA-256»): questi due non
// possono più essere costanti arbitrarie: sono derivate dagli stessi campi
// del fixture con le funzioni canoniche del contratto.
const REQUEST_ID = '11111111-2222-4333-8444-555555555555';
const SOURCE_BODY_HASH = 'c'.repeat(64);
const CREATED_AT_MS = 1_700_000_000_000;
const CREATED_AT = { toMillis: () => CREATED_AT_MS };
const UPDATED_AT = { toMillis: () => CREATED_AT_MS };
const EXPIRE_AT_MS = CREATED_AT_MS + VISUAL_STAGING_TTL_MS;
const EXPIRE_AT = { toMillis: () => EXPIRE_AT_MS };
const OPAQUE_PLAN_ID = computeOpaqueVisualPlanId(OWNER, REQUEST_ID);
const ASSET_ID = '11111111-2222-4333-8444-555555555555';
const RESERVATION_MONTH_KEY = '2023-11';

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

/** Slot "image" di default: `pending`, zero tentativi — la sola combinazione
 * valida per quello stato (review fix round 2, blocker 2). Chi vuole un
 * altro `state` deve fornire `attempts` coerenti nel proprio `over`. */
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

/** Slot "none": l'unica combinazione valida è `state: 'abandoned'`, zero
 * tentativi (review fix round 2, blocker 2). */
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

function budgetCeilingFor(
  ceiling: 1 | 2 | 3,
  params: { ownerUid: string; requestId: string },
  over: Partial<Record<string, unknown>> = {},
) {
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
    reservationKey: computeBudgetReservationKey(params.ownerUid, params.requestId),
    reservationMonthKey: RESERVATION_MONTH_KEY,
    proposalCap,
    generationCap,
    maxAttemptsPerSlot,
    totalReserved,
    ...over,
  };
}

/**
 * **Review fix (Codex, blocker P1/5).** `planHash`/`budgetCeiling.
 * reservationKey` sono ora ricalcolati e verificati da `validateVisualPlanRun`
 * contro gli altri campi persistiti — non possono più essere costanti
 * arbitrarie. Le identità effettive (comprese eventuali `over` che le
 * toccano) vengono risolte **prima** di calcolare gli hash, così un test che
 * vuole un fixture internamente coerente lo ottiene per costruzione; un test
 * che vuole invece un hash/chiave esplicitamente sbagliati può ancora
 * sovrascriverli via `over` (applicato per ultimo, vince sempre).
 */
function planOf(params: {
  ceiling: 1 | 2 | 3;
  slots: Record<string, unknown>[];
  over?: Partial<Record<string, unknown>>;
}) {
  const identity = {
    ownerUid: OWNER,
    programId: 'prog-1',
    importId: 'imp-1',
    lessonId: 'lesson-1',
    publicLessonId: 'imp-1_lesson-1',
    requestId: REQUEST_ID,
    sourceBodyHash: SOURCE_BODY_HASH,
    existingItemAssetIds: [] as string[],
    replacementAssetId: null,
    quantity: { mode: 'auto' as const, ceiling: params.ceiling },
    ...params.over,
  };
  const planHash = computeVisualPlanHash({
    ownerUid: identity.ownerUid,
    programId: identity.programId,
    importId: identity.importId,
    lessonId: identity.lessonId,
    publicLessonId: identity.publicLessonId,
    sourceBodyHash: identity.sourceBodyHash,
    existingItemAssetIds: identity.existingItemAssetIds,
    replacementAssetId: identity.replacementAssetId as string | null,
    quantity: identity.quantity,
  });
  const budgetCeiling = budgetCeilingFor(params.ceiling, {
    ownerUid: identity.ownerUid,
    requestId: identity.requestId,
  });
  return {
    contractVersion: VISUAL_PLAN_CONTRACT_VERSION,
    udaDir: 'uda-01',
    status: 'awaiting_review',
    ...identity,
    planHash,
    budgetCeiling,
    slots: params.slots,
    settlement: {
      proposalActualCost: null,
      // Review fix round 2 (blocker 2): il consuntivo non ammette una voce
      // per uno slot senza tentativi — il default lo riflette filtrando.
      slots: params.slots
        .filter((slot) => (slot.attempts as number) > 0)
        .map((slot) => ({
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

// ─── Blocker 1 (round 1) — identità: id Firestore canonici, UUID, path ────────

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
      over: { planHash: 'B'.repeat(64) },
    });
    expect(() => validateVisualPlanRun(plan)).toThrow(AiVisualMultiError);
  });

  it('rifiuta un promotedAssetId UUID in maiuscolo', () => {
    const slot = imageSlot(0, {
      state: 'promoted',
      attempts: 1,
      promotedAssetId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'.toUpperCase(),
    });
    expect(() => validateVisualPlanSlot(slot)).toThrow(AiVisualMultiError);
  });
});

// ─── Blocker 2 (round 1) — limiti editoriali VE sugli slot (roadmap §8.3) ─────

describe('blocker 2 (round 1) — limiti editoriali VE sui campi dello slot', () => {
  it(`accetta subject esattamente a ${MAX_VISUAL_SUBJECT_CHARS} code point`, () => {
    const subject = 'a'.repeat(MAX_VISUAL_SUBJECT_CHARS);
    expect(validateVisualPlanSlot(imageSlot(0, { subject })).subject).toBe(subject);
  });

  it(`rifiuta subject a ${MAX_VISUAL_SUBJECT_CHARS + 1} code point`, () => {
    const subject = 'a'.repeat(MAX_VISUAL_SUBJECT_CHARS + 1);
    expect(() => validateVisualPlanSlot(imageSlot(0, { subject }))).toThrow();
  });

  it(`accetta rationale esattamente a ${MAX_VISUAL_RATIONALE_CHARS} code point`, () => {
    const rationale = 'a'.repeat(MAX_VISUAL_RATIONALE_CHARS);
    expect(validateVisualPlanSlot(imageSlot(0, { rationale })).rationale).toBe(rationale);
  });

  it(`rifiuta rationale a ${MAX_VISUAL_RATIONALE_CHARS + 1} code point`, () => {
    const rationale = 'a'.repeat(MAX_VISUAL_RATIONALE_CHARS + 1);
    expect(() => validateVisualPlanSlot(imageSlot(0, { rationale }))).toThrow();
  });

  it(`accetta caption esattamente a ${MAX_VISUAL_CAPTION_CHARS} code point`, () => {
    const caption = 'a'.repeat(MAX_VISUAL_CAPTION_CHARS);
    expect(validateVisualPlanSlot(imageSlot(0, { caption })).caption).toBe(caption);
  });

  it(`rifiuta caption a ${MAX_VISUAL_CAPTION_CHARS + 1} code point`, () => {
    const caption = 'a'.repeat(MAX_VISUAL_CAPTION_CHARS + 1);
    expect(() => validateVisualPlanSlot(imageSlot(0, { caption }))).toThrow();
  });

  it(`accetta altText esattamente a ${MAX_VISUAL_ALT_TEXT_CHARS} code point`, () => {
    const altText = 'a'.repeat(MAX_VISUAL_ALT_TEXT_CHARS);
    expect(validateVisualPlanSlot(imageSlot(0, { altText })).altText).toBe(altText);
  });

  it(`rifiuta altText a ${MAX_VISUAL_ALT_TEXT_CHARS + 1} code point`, () => {
    const altText = 'a'.repeat(MAX_VISUAL_ALT_TEXT_CHARS + 1);
    expect(() => validateVisualPlanSlot(imageSlot(0, { altText }))).toThrow();
  });

  it('rifiuta un subject vietato (imitazione di stile)', () => {
    expect(() =>
      validateVisualPlanSlot(
        imageSlot(0, { subject: 'Un disegno in the style of un noto illustratore' }),
      ),
    ).toThrow();
  });

  it('rifiuta rationale con caratteri di controllo', () => {
    expect(() =>
      validateVisualPlanSlot(imageSlot(0, { rationale: 'Motivo concontrollo' })),
    ).toThrow();
  });

  it('rifiuta caption con markup HTML', () => {
    expect(() => validateVisualPlanSlot(imageSlot(0, { caption: '<b>Didascalia</b>' }))).toThrow();
  });

  it('rifiuta altText con blocco di codice (fence)', () => {
    expect(() => validateVisualPlanSlot(imageSlot(0, { altText: '```codice```' }))).toThrow();
  });

  it('accetta apostrofi italiani legittimi in subject e rationale', () => {
    const slot = validateVisualPlanSlot(
      imageSlot(0, {
        subject: "L'acqua e il suo ciclo naturale",
        rationale: "Mostra com'è distribuita l'acqua sulla superficie",
      }),
    );
    expect(slot.subject).toContain("L'acqua");
    expect(slot.rationale).toContain("com'è");
  });
});

// ─── Blocker 3 (round 1) — staging legato al piano, con cap binari ────────────

describe('blocker 3 (round 1) — staging legato al piano e cap binari', () => {
  it('accetta il path di staging ricostruito correttamente (caso positivo)', () => {
    const plan = planOf({
      ceiling: 1,
      slots: [imageSlot(0, { state: 'ready', attempts: 1, staged: stagedFor(0) })],
    });
    expect(() => validateVisualPlanRun(plan)).not.toThrow();
  });

  it('rifiuta storageRef di staging di un altro owner (a livello di piano)', () => {
    const plan = planOf({
      ceiling: 1,
      slots: [
        imageSlot(0, {
          state: 'ready',
          attempts: 1,
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
          attempts: 1,
          staged: stagedFor(0, { storageRef: `staging/${OWNER}/${'f'.repeat(64)}/0.webp` }),
        }),
      ],
    });
    expect(() => validateVisualPlanRun(plan)).toThrow(AiVisualMultiError);
  });

  it('rifiuta storageRef di staging con indice sbagliato (slot 0 che dichiara 2.webp)', () => {
    expect(() =>
      validateVisualPlanSlot(imageSlot(0, { state: 'ready', attempts: 1, staged: stagedFor(2) })),
    ).toThrow(AiVisualMultiError);
  });

  it('rifiuta storageRef di staging con estensione sbagliata', () => {
    expect(() =>
      validateVisualPlanSlot(
        imageSlot(0, {
          state: 'ready',
          attempts: 1,
          staged: stagedFor(0, { storageRef: `staging/${OWNER}/${OPAQUE_PLAN_ID}/0.png` }),
        }),
      ),
    ).toThrow(AiVisualMultiError);
  });

  it('rifiuta storageRef di staging con traversal', () => {
    expect(() =>
      validateVisualPlanSlot(
        imageSlot(0, {
          state: 'ready',
          attempts: 1,
          staged: stagedFor(0, { storageRef: `staging/../${OPAQUE_PLAN_ID}/0.webp` }),
        }),
      ),
    ).toThrow(AiVisualMultiError);
  });

  it('rifiuta storageRef di staging con doppio slash', () => {
    expect(() =>
      validateVisualPlanSlot(
        imageSlot(0, {
          state: 'ready',
          attempts: 1,
          staged: stagedFor(0, { storageRef: `staging//${OPAQUE_PLAN_ID}/0.webp` }),
        }),
      ),
    ).toThrow(AiVisualMultiError);
  });

  it('rifiuta width/height 1201 in staging', () => {
    expect(() =>
      validateVisualPlanSlot(
        imageSlot(0, { state: 'ready', attempts: 1, staged: stagedFor(0, { width: 1201 }) }),
      ),
    ).toThrow(AiVisualMultiError);
    expect(() =>
      validateVisualPlanSlot(
        imageSlot(0, { state: 'ready', attempts: 1, staged: stagedFor(0, { height: 1201 }) }),
      ),
    ).toThrow(AiVisualMultiError);
  });

  it('rifiuta byteLength 204801 in staging', () => {
    expect(() =>
      validateVisualPlanSlot(
        imageSlot(0, {
          state: 'ready',
          attempts: 1,
          staged: stagedFor(0, { byteLength: 204_801 }),
        }),
      ),
    ).toThrow(AiVisualMultiError);
  });

  it('accetta width/height 1200 e byteLength 204800 in staging (limite esatto)', () => {
    const slot = validateVisualPlanSlot(
      imageSlot(0, {
        state: 'ready',
        attempts: 1,
        staged: stagedFor(0, { width: 1200, height: 1200, byteLength: 204_800 }),
      }),
    );
    expect(slot.staged?.width).toBe(1200);
  });
});

// ─── Slot — forma e relazioni generali ─────────────────────────────────────────

describe('validateVisualPlanSlot', () => {
  it('accetta uno slot "image" completo (pending, zero tentativi)', () => {
    const slot = validateVisualPlanSlot(imageSlot(0));
    expect(slot.decision).toBe('image');
    expect(slot.subject).not.toBeNull();
  });

  it('accetta uno slot "none" con tutti i campi editoriali nulli', () => {
    const slot = validateVisualPlanSlot(noneSlot(0));
    expect(slot.decision).toBe('none');
    expect(slot.subject).toBeNull();
    expect(slot.anchor).toBeNull();
  });

  it('rifiuta decision "image" con subject nullo (provider_invalid_output)', () => {
    let thrown: unknown;
    try {
      validateVisualPlanSlot(imageSlot(0, { subject: null }));
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeTruthy();
    expect((thrown as { code?: string }).code).toBe('provider_invalid_output');
  });

  it('rifiuta decision "none" con subject valorizzato', () => {
    expect(() => validateVisualPlanSlot(noneSlot(0, { subject: 'Qualcosa' }))).toThrow(
      AiVisualMultiError,
    );
  });

  it('rifiuta attempts oltre VISUAL_PLAN_MAX_ATTEMPTS_PER_SLOT, indipendentemente da qualunque tetto esterno', () => {
    expect(() => validateVisualPlanSlot(imageSlot(0, { attempts: 3 }))).toThrow(AiVisualMultiError);
    expect(() => validateVisualPlanSlot(imageSlot(0, { attempts: 500 }))).toThrow(
      AiVisualMultiError,
    );
  });

  it('accetta attempts fino al tetto (state "failed", terminale)', () => {
    const slot = validateVisualPlanSlot(
      imageSlot(0, { state: 'failed', lastError: 'transient_error', attempts: 2 }),
    );
    expect(slot.attempts).toBe(2);
  });

  it('rifiuta staged presente con state diverso da "ready"', () => {
    expect(() => validateVisualPlanSlot(imageSlot(0, { staged: stagedFor(0) }))).toThrow(
      AiVisualMultiError,
    );
  });

  it('accetta staged presente con state "ready"', () => {
    const slot = validateVisualPlanSlot(
      imageSlot(0, { state: 'ready', attempts: 1, staged: stagedFor(0) }),
    );
    expect(slot.staged).not.toBeNull();
  });

  it('rifiuta state "ready" senza staged', () => {
    expect(() => validateVisualPlanSlot(imageSlot(0, { state: 'ready', attempts: 1 }))).toThrow(
      AiVisualMultiError,
    );
  });

  it('rifiuta promotedAssetId presente con state diverso da "promoted"', () => {
    expect(() =>
      validateVisualPlanSlot(
        imageSlot(0, { promotedAssetId: '11111111-2222-4333-8444-555555555555' }),
      ),
    ).toThrow(AiVisualMultiError);
  });

  it('accetta promotedAssetId presente con state "promoted"', () => {
    const slot = validateVisualPlanSlot(
      imageSlot(0, { state: 'promoted', attempts: 1, promotedAssetId: ASSET_ID }),
    );
    expect(slot.promotedAssetId).toBe(ASSET_ID);
  });

  it('rifiuta state "promoted" senza promotedAssetId', () => {
    expect(() => validateVisualPlanSlot(imageSlot(0, { state: 'promoted', attempts: 1 }))).toThrow(
      AiVisualMultiError,
    );
  });

  it('rifiuta chiavi extra', () => {
    expect(() => validateVisualPlanSlot(imageSlot(0, { extra: true }))).toThrow(AiVisualMultiError);
  });

  it('rifiuta state "failed" con lastError nullo', () => {
    expect(() =>
      validateVisualPlanSlot(imageSlot(0, { state: 'failed', attempts: 1, lastError: null })),
    ).toThrow(AiVisualMultiError);
  });

  it('accetta state "failed" con lastError tipizzato', () => {
    const slot = validateVisualPlanSlot(
      imageSlot(0, { state: 'failed', attempts: 1, lastError: 'transient_error' }),
    );
    expect(slot.lastError).toBe('transient_error');
  });

  it('rifiuta lastError presente con state diverso da "failed"', () => {
    expect(() =>
      validateVisualPlanSlot(imageSlot(0, { state: 'pending', lastError: 'transient_error' })),
    ).toThrow(AiVisualMultiError);
  });
});

// ─── Blocker 2 (round 2) — coerenza completa decision/state/attempts ──────────

describe('blocker 2 (round 2) — coerenza decision/state/attempts (§8.4–§8.5)', () => {
  it('rifiuta decision "none" con state diverso da "abandoned"', () => {
    expect(() => validateVisualPlanSlot(noneSlot(0, { state: 'pending' }))).toThrow(
      AiVisualMultiError,
    );
  });

  it('rifiuta decision "none" con attempts diverso da zero', () => {
    expect(() => validateVisualPlanSlot(noneSlot(0, { attempts: 1 }))).toThrow(AiVisualMultiError);
  });

  it('rifiuta decision "image", state "pending" con attempts diverso da zero', () => {
    expect(() => validateVisualPlanSlot(imageSlot(0, { state: 'pending', attempts: 1 }))).toThrow(
      AiVisualMultiError,
    );
  });

  it.each(['generating', 'ready', 'failed', 'promoted'] as const)(
    'rifiuta decision "image", state "%s" con attempts a zero',
    (state) => {
      const over: Record<string, unknown> = { state, attempts: 0 };
      if (state === 'failed') over.lastError = 'transient_error';
      if (state === 'ready') over.staged = stagedFor(0);
      if (state === 'promoted') over.promotedAssetId = ASSET_ID;
      expect(() => validateVisualPlanSlot(imageSlot(0, over))).toThrow(AiVisualMultiError);
    },
  );

  it('accetta decision "image", state "abandoned" con attempts a zero (mai tentato)', () => {
    const slot = validateVisualPlanSlot(imageSlot(0, { state: 'abandoned', attempts: 0 }));
    expect(slot.state).toBe('abandoned');
  });

  it('accetta decision "image", state "abandoned" dopo tentativi falliti (attempts 1 o 2)', () => {
    expect(validateVisualPlanSlot(imageSlot(0, { state: 'abandoned', attempts: 1 })).attempts).toBe(
      1,
    );
    expect(validateVisualPlanSlot(imageSlot(0, { state: 'abandoned', attempts: 2 })).attempts).toBe(
      2,
    );
  });

  it('validateVisualPlanSlot non accetta più un secondo argomento di tetto: legge sempre la costante', () => {
    // @ts-expect-error — il parametro è stato rimosso deliberatamente (review fix round 2).
    expect(() => validateVisualPlanSlot(imageSlot(0, { attempts: 500 }), 999)).toThrow(
      AiVisualMultiError,
    );
  });

  describe('completezza del consuntivo rispetto ai tentativi', () => {
    it('rifiuta un piano con uno slot ad attempts > 0 privo di voce nel consuntivo', () => {
      const plan = planOf({
        ceiling: 1,
        slots: [imageSlot(0, { state: 'generating', attempts: 1 })],
        over: { settlement: { proposalActualCost: null, slots: [] } },
      });
      expect(() => validateVisualPlanRun(plan)).toThrow(AiVisualMultiError);
    });

    it('rifiuta una voce di consuntivo per uno slot con attempts a zero', () => {
      const plan = planOf({
        ceiling: 1,
        slots: [imageSlot(0, { state: 'pending', attempts: 0 })],
        over: {
          settlement: {
            proposalActualCost: null,
            slots: [{ slotIndex: 0, attempts: 0, actualCost: null }],
          },
        },
      });
      expect(() => validateVisualPlanRun(plan)).toThrow(AiVisualMultiError);
    });

    it('accetta actualCost: null per uno slot con attempts > 0 (costo inconoscibile)', () => {
      const plan = planOf({
        ceiling: 1,
        slots: [imageSlot(0, { state: 'generating', attempts: 1 })],
      });
      expect(() => validateVisualPlanRun(plan)).not.toThrow();
    });

    it('verifica per mutazione: rimuovere il controllo di completezza rende rosso il test di sopra', () => {
      // Prova diretta: uno slot con attempts=1 e un consuntivo vuoto (nessuna
      // voce) deve fallire. Se la guardia venisse rimossa, questo stesso
      // scenario passerebbe silenziosamente — è esattamente il test che lo
      // impedisce, eseguito qui una seconda volta con un piano a due slot per
      // isolare quale slot manca.
      const plan = planOf({
        ceiling: 2,
        slots: [
          imageSlot(0, { state: 'generating', attempts: 1 }),
          imageSlot(1, { state: 'generating', attempts: 1 }),
        ],
        over: {
          settlement: {
            proposalActualCost: null,
            slots: [{ slotIndex: 0, attempts: 1, actualCost: null }],
          },
        },
      });
      expect(() => validateVisualPlanRun(plan)).toThrow(AiVisualMultiError);
    });
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
      ),
      validateVisualPlanSlot(
        imageSlot(1, {
          subject: 'Ruscellamento superficiale reale',
          rationale: 'Mostra dove va l’acqua',
        }),
      ),
    ];
    expect(() => validateVisualPlanDiversity(slots)).not.toThrow();
  });

  it('rifiuta due subject normalizzati identici, con la stessa ancora', () => {
    const slots: VisualPlanSlot[] = [
      validateVisualPlanSlot(imageSlot(0, { subject: 'Il Bilancio idrico' })),
      validateVisualPlanSlot(imageSlot(1, { subject: 'il bilancio   idrico' })),
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
      ),
      validateVisualPlanSlot(
        imageSlot(1, {
          subject: 'stesso   soggetto',
          anchor: { anchorHeadingIndex: 1, anchorHeadingText: 'B' },
        }),
      ),
    ];
    expect(() => validateVisualPlanDiversity(slots)).toThrow(AiVisualMultiError);
  });

  it('rifiuta due rationale normalizzati identici anche con subject diversi', () => {
    const slots: VisualPlanSlot[] = [
      validateVisualPlanSlot(
        imageSlot(0, { subject: 'Soggetto uno', rationale: 'Mostra il ciclo dell’acqua' }),
      ),
      validateVisualPlanSlot(
        imageSlot(1, { subject: 'Soggetto due', rationale: 'mostra   il ciclo dell’acqua' }),
      ),
    ];
    expect(() => validateVisualPlanDiversity(slots)).toThrow(AiVisualMultiError);
  });

  it('la sola uguaglianza di anchorHeadingIndex, con subject/rationale distinti, non produce mai un rifiuto', () => {
    const sameAnchor = { anchorHeadingIndex: 2, anchorHeadingText: 'Stessa sezione' };
    const slots: VisualPlanSlot[] = [
      validateVisualPlanSlot(
        imageSlot(0, { anchor: sameAnchor, subject: 'A', rationale: 'Motivo A' }),
      ),
      validateVisualPlanSlot(
        imageSlot(1, { anchor: sameAnchor, subject: 'B', rationale: 'Motivo B' }),
      ),
      validateVisualPlanSlot(
        imageSlot(2, { anchor: sameAnchor, subject: 'C', rationale: 'Motivo C' }),
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

// ─── Blocker 4 (round 1) — relazioni interne del VisualPlanRun ────────────────

describe('blocker 4 (round 1) — relazioni interne complete del piano', () => {
  it('rifiuta un piano con maxAttemptsPerSlot diverso da 2 (contratto v1)', () => {
    const plan = planOf({ ceiling: 1, slots: [imageSlot(0)] });
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

  it('accetta un solo slot replace a galleria piena e lega il target alla fotografia iniziale', () => {
    const first = '11111111-2222-4333-8444-555555555555';
    const plan = planOf({
      ceiling: 1,
      slots: [imageSlot(0)],
      over: {
        existingItemAssetIds: [
          first,
          '22222222-2222-4333-8444-555555555555',
          '33333333-2222-4333-8444-555555555555',
        ],
        replacementAssetId: first,
      },
    });
    expect(() => validateVisualPlanRun(plan)).not.toThrow();
    expect(() =>
      validateVisualPlanRun({
        ...plan,
        replacementAssetId: '99999999-2222-4333-8444-555555555555',
      }),
    ).toThrow(AiVisualMultiError);
  });

  it('rifiuta uno slot il cui slotIndex non corrisponde alla propria posizione', () => {
    const plan = planOf({ ceiling: 2, slots: [imageSlot(1), noneSlot(0)] });
    expect(() => validateVisualPlanRun(plan)).toThrow(AiVisualMultiError);
  });

  it('rifiuta un consuntivo con attempts diverso da quello dello slot', () => {
    const plan = planOf({
      ceiling: 1,
      slots: [imageSlot(0, { state: 'generating', attempts: 1 })],
      over: {
        settlement: {
          proposalActualCost: null,
          slots: [{ slotIndex: 0, attempts: 2, actualCost: null }],
        },
      },
    });
    expect(() => validateVisualPlanRun(plan)).toThrow(AiVisualMultiError);
  });

  it('rifiuta una voce di consuntivo per uno slot senza tentativi (attempts zero)', () => {
    const plan = planOf({
      ceiling: 1,
      slots: [imageSlot(0, { state: 'pending', attempts: 0 })],
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
    const budgetCeiling = budgetCeilingFor(1, { ownerUid: OWNER, requestId: REQUEST_ID });
    const plan = planOf({
      ceiling: 1,
      slots: [imageSlot(0, { state: 'generating', attempts: 1 })],
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
    const budgetCeiling = budgetCeilingFor(1, { ownerUid: OWNER, requestId: REQUEST_ID });
    const plan = planOf({
      ceiling: 1,
      slots: [imageSlot(0, { state: 'generating', attempts: 1 })],
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
          slots: [{ slotIndex: 5, attempts: 1, actualCost: null }],
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

  it('rifiuta reservationMonthKey diverso dal mese UTC di createdAt', () => {
    const plan = planOf({ ceiling: 1, slots: [imageSlot(0)] });
    (plan.budgetCeiling as Record<string, unknown>).reservationMonthKey = '2023-12';
    expect(() => validateVisualPlanRun(plan)).toThrow(AiVisualMultiError);
  });
});

// ─── Blocker 1 (round 2) — status derivato, failed terminale solo a tetto ─────

describe('blocker 1 (round 2) — status del piano derivato correttamente dagli slot (§8.7)', () => {
  it('rifiuta status "completed" con uno slot ancora "pending"', () => {
    const plan = planOf({
      ceiling: 1,
      slots: [imageSlot(0, { state: 'pending' })],
      over: { status: 'completed' },
    });
    expect(() => validateVisualPlanRun(plan)).toThrow(AiVisualMultiError);
  });

  it('accetta status "completed" quando ogni slot immagine è promosso', () => {
    const plan = planOf({
      ceiling: 1,
      slots: [imageSlot(0, { state: 'promoted', attempts: 1, promotedAssetId: ASSET_ID })],
      over: { status: 'completed' },
    });
    expect(() => validateVisualPlanRun(plan)).not.toThrow();
  });

  it('rifiuta status "completed" con zero slot immagine (solo "none")', () => {
    const plan = planOf({ ceiling: 1, slots: [noneSlot(0)], over: { status: 'completed' } });
    expect(() => validateVisualPlanRun(plan)).toThrow(AiVisualMultiError);
  });

  it('accetta status "abandoned" con zero slot immagine (solo "none")', () => {
    const plan = planOf({ ceiling: 1, slots: [noneSlot(0)], over: { status: 'abandoned' } });
    expect(() => validateVisualPlanRun(plan)).not.toThrow();
  });

  it('rifiuta status "partially_completed"/"abandoned" con uno slot "failed" ad attempts 0 (non terminale)', () => {
    const plan = planOf({
      ceiling: 2,
      slots: [
        imageSlot(0, { state: 'failed', lastError: 'transient_error', attempts: 0 }),
        noneSlot(1),
      ],
      over: { status: 'abandoned' },
    });
    expect(() => validateVisualPlanRun(plan)).toThrow(AiVisualMultiError);
  });

  it('rifiuta status "partially_completed"/"abandoned" con uno slot "failed" ad attempts 1 (non terminale)', () => {
    const plan = planOf({
      ceiling: 2,
      slots: [
        imageSlot(0, { state: 'failed', lastError: 'transient_error', attempts: 1 }),
        noneSlot(1),
      ],
      over: { status: 'abandoned' },
    });
    expect(() => validateVisualPlanRun(plan)).toThrow(AiVisualMultiError);
  });

  it('rifiuta status "partially_completed" senza alcuno slot promosso (con failed terminale)', () => {
    const plan = planOf({
      ceiling: 2,
      slots: [
        imageSlot(0, { state: 'failed', lastError: 'transient_error', attempts: 2 }),
        noneSlot(1),
      ],
      over: { status: 'partially_completed' },
    });
    expect(() => validateVisualPlanRun(plan)).toThrow(AiVisualMultiError);
  });

  it('accetta status "partially_completed" con un misto promosso/non promosso, entrambi terminali', () => {
    const plan = planOf({
      ceiling: 2,
      slots: [
        imageSlot(0, { state: 'promoted', attempts: 1, promotedAssetId: ASSET_ID }),
        imageSlot(1, { state: 'failed', lastError: 'transient_error', attempts: 2 }),
      ],
      over: { status: 'partially_completed' },
    });
    expect(() => validateVisualPlanRun(plan)).not.toThrow();
  });

  it('rifiuta status "abandoned" con uno slot promosso', () => {
    const plan = planOf({
      ceiling: 1,
      slots: [imageSlot(0, { state: 'promoted', attempts: 1, promotedAssetId: ASSET_ID })],
      over: { status: 'abandoned' },
    });
    expect(() => validateVisualPlanRun(plan)).toThrow(AiVisualMultiError);
  });

  it('accetta status "abandoned" quando nessuno slot immagine è promosso', () => {
    const plan = planOf({
      ceiling: 1,
      slots: [imageSlot(0, { state: 'abandoned', attempts: 0 })],
      over: { status: 'abandoned' },
    });
    expect(() => validateVisualPlanRun(plan)).not.toThrow();
  });

  it('rifiuta status "expired" quando ogni slot è già terminale', () => {
    const plan = planOf({
      ceiling: 1,
      slots: [imageSlot(0, { state: 'promoted', attempts: 1, promotedAssetId: ASSET_ID })],
      over: { status: 'expired', updatedAt: { toMillis: () => EXPIRE_AT_MS } },
    });
    expect(() => validateVisualPlanRun(plan)).toThrow(AiVisualMultiError);
  });

  it('accetta status "expired" quando almeno uno slot resta non terminale', () => {
    const plan = planOf({
      ceiling: 1,
      slots: [imageSlot(0, { state: 'generating', attempts: 1 })],
      over: { status: 'expired', updatedAt: { toMillis: () => EXPIRE_AT_MS } },
    });
    expect(() => validateVisualPlanRun(plan)).not.toThrow();
  });
});

// ─── Blocker 3 (round 2) — ordine dei timestamp specifico per "expired" ───────

describe('blocker 3 (round 2) — ordine dei timestamp e "expired"', () => {
  function expiredPlanWithUpdatedAt(updatedAtMs: number) {
    return planOf({
      ceiling: 1,
      slots: [imageSlot(0, { state: 'generating', attempts: 1 })],
      over: { status: 'expired', updatedAt: { toMillis: () => updatedAtMs } },
    });
  }

  it('rifiuta "expired" con updatedAt precedente a expireAt', () => {
    expect(() => validateVisualPlanRun(expiredPlanWithUpdatedAt(EXPIRE_AT_MS - 1))).toThrow(
      AiVisualMultiError,
    );
  });

  it('accetta "expired" con updatedAt esattamente uguale a expireAt', () => {
    expect(() => validateVisualPlanRun(expiredPlanWithUpdatedAt(EXPIRE_AT_MS))).not.toThrow();
  });

  it('accetta "expired" con updatedAt successivo a expireAt', () => {
    expect(() => validateVisualPlanRun(expiredPlanWithUpdatedAt(EXPIRE_AT_MS + 1))).not.toThrow();
  });

  it('rifiuta uno status non-expired con updatedAt successivo a expireAt', () => {
    const plan = planOf({
      ceiling: 1,
      slots: [noneSlot(0)],
      over: { status: 'awaiting_review', updatedAt: { toMillis: () => EXPIRE_AT_MS + 1 } },
    });
    expect(() => validateVisualPlanRun(plan)).toThrow(AiVisualMultiError);
  });

  it('rifiuta updatedAt precedente a createdAt (status non-expired)', () => {
    const plan = planOf({
      ceiling: 1,
      slots: [noneSlot(0)],
      over: { updatedAt: { toMillis: () => CREATED_AT_MS - 1 } },
    });
    expect(() => validateVisualPlanRun(plan)).toThrow(AiVisualMultiError);
  });

  it('rifiuta expireAt diverso da createdAt + TTL 24h, in ogni status', () => {
    const nonExpired = planOf({
      ceiling: 1,
      slots: [noneSlot(0)],
      over: { expireAt: { toMillis: () => EXPIRE_AT_MS - 1 } },
    });
    expect(() => validateVisualPlanRun(nonExpired)).toThrow(AiVisualMultiError);

    const expired = planOf({
      ceiling: 1,
      slots: [imageSlot(0, { state: 'generating', attempts: 1 })],
      over: {
        status: 'expired',
        expireAt: { toMillis: () => EXPIRE_AT_MS - 1 },
        updatedAt: { toMillis: () => EXPIRE_AT_MS },
      },
    });
    expect(() => validateVisualPlanRun(expired)).toThrow(AiVisualMultiError);
  });

  it('accetta expireAt esattamente createdAt + TTL 24h (status non-expired)', () => {
    expect(() => validateVisualPlanRun(planOf({ ceiling: 1, slots: [noneSlot(0)] }))).not.toThrow();
  });
});

// ─── Blocker 5 (round 1) — tassonomia d'errore alla lettura di un piano ───────

describe('blocker 5 (round 1) — corrupted_state per qualunque errore annidato in validateVisualPlanRun', () => {
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
      validateVisualPlanSlot(imageSlot(0, { subject: 'Stesso soggetto' })),
      validateVisualPlanSlot(imageSlot(1, { subject: 'stesso   soggetto' })),
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
