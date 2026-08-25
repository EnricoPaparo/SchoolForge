/**
 * MULTI-VISUAL-01 — piano visivo coordinato (roadmap §5.5, §8) e vincolo di
 * diversità didattica (§7.4).
 *
 * Validatori strutturali **puri**: nessuna lettura di `LessonDoc`, nessuna
 * transazione, nessun ledger di budget reale. La persistenza, il lease
 * (§10.3), la promozione (§8.6) e l'autorizzazione unica (§8) sono runtime e
 * restano fuori dallo scope di MULTI-VISUAL-01 — qui si verifica solo che un
 * `VisualPlanRun`/`VisualPlanSlot` **come dato** abbia la forma e le
 * relazioni interne che il contratto promette.
 *
 * Riusa `VisualAnchorSelector` di `aiVisualMultiAnchor.ts` e `VisualTimestampLike`
 * / `timestampToMillis` di VE — nessuna seconda definizione di «cos'è un
 * Timestamp».
 *
 * Puro: nessuna rete, nessun I/O, nessuna dipendenza Firebase.
 */

import { timestampToMillis } from './aiContentCore.js';
import type { VisualTimestampLike } from './aiContentVisualProposal.js';
import { validateVisualAnchorSelector, type VisualAnchorSelector } from './aiVisualMultiAnchor.js';
import {
  VISUAL_PLAN_CONTRACT_VERSION,
  AiVisualMultiError,
  asRecord,
  assertExactKeys,
} from './aiVisualMultiCore.js';

// ─── Quantità (roadmap §8.2) ────────────────────────────────────────────────────

export type VisualPlanQuantitySelection =
  | { mode: 'auto'; ceiling: 1 | 2 | 3 }
  | { mode: 'exact'; ceiling: 1 | 2 | 3 };

const QUANTITY_KEYS = ['mode', 'ceiling'] as const;

export function validateVisualPlanQuantitySelection(value: unknown): VisualPlanQuantitySelection {
  const root = asRecord(value, 'Selezione di quantità non valida.', 'corrupted_state');
  assertExactKeys(root, QUANTITY_KEYS, 'Selezione di quantità', 'corrupted_state');
  if (root.mode !== 'auto' && root.mode !== 'exact') {
    throw new AiVisualMultiError('corrupted_state', 'mode della quantità non valido.');
  }
  if (root.ceiling !== 1 && root.ceiling !== 2 && root.ceiling !== 3) {
    throw new AiVisualMultiError('corrupted_state', 'ceiling della quantità non valido.');
  }
  return { mode: root.mode, ceiling: root.ceiling };
}

// ─── Slot del piano (roadmap §5.5) ─────────────────────────────────────────────

export type VisualPlanSlotState =
  | 'pending'
  | 'generating'
  | 'ready'
  | 'failed'
  | 'promoted'
  | 'abandoned';

export type VisualPlanSlotDecision = 'image' | 'none';

export type VisualPlanSlotLastError =
  | 'visual_too_large'
  | 'provider_invalid_output'
  | 'transient_error';

export interface VisualPlanSlotStaged {
  storageRef: string;
  width: number;
  height: number;
  byteLength: number;
  sha256: string;
}

export interface VisualPlanSlot {
  slotIndex: number;
  state: VisualPlanSlotState;
  decision: VisualPlanSlotDecision;
  subject: string | null;
  rationale: string | null;
  anchor: VisualAnchorSelector | null;
  caption: string | null;
  altText: string | null;
  attempts: number;
  lastError: VisualPlanSlotLastError | null;
  staged: VisualPlanSlotStaged | null;
  promotedAssetId: string | null;
}

const SLOT_STATES: readonly VisualPlanSlotState[] = [
  'pending',
  'generating',
  'ready',
  'failed',
  'promoted',
  'abandoned',
];
const SLOT_LAST_ERRORS: readonly VisualPlanSlotLastError[] = [
  'visual_too_large',
  'provider_invalid_output',
  'transient_error',
];

const SLOT_KEYS = [
  'slotIndex',
  'state',
  'decision',
  'subject',
  'rationale',
  'anchor',
  'caption',
  'altText',
  'attempts',
  'lastError',
  'staged',
  'promotedAssetId',
] as const;

const STAGED_KEYS = ['storageRef', 'width', 'height', 'byteLength', 'sha256'] as const;

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA256_HEX_RE = /^[0-9a-f]{64}$/;
/**
 * Percorso di staging del piano: `staging/{ownerUid}/{opaquePlanId}/{slotIndex}.webp`
 * (roadmap §5.5). Forma nuova, distinta da `staging/{ownerUid}/{opaqueRunId}.webp`
 * di VE (`visualStagingRef` in `aiVisualCore.ts`) — non un'estensione dello
 * stesso formato, uno slot in più nel percorso: una regex propria, non una
 * duplicazione di quella di VE che descrive un'altra cosa.
 */
const PLAN_STAGING_REF_RE = /^staging\/[^/]+\/[a-f0-9]{64}\/[0-9]+\.webp$/;

function invalidSlot(message: string): never {
  throw new AiVisualMultiError('corrupted_state', message);
}

function assertNonNegativeInt(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    invalidSlot(`${label} non valido.`);
  }
  return value;
}

function assertPositiveInt(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    invalidSlot(`${label} non valido.`);
  }
  return value;
}

function validateStaged(value: unknown): VisualPlanSlotStaged {
  const root = asRecord(value, 'Byte in staging dello slot non validi.', 'corrupted_state');
  assertExactKeys(root, STAGED_KEYS, 'Byte in staging dello slot', 'corrupted_state');
  const storageRef = root.storageRef;
  if (typeof storageRef !== 'string' || !PLAN_STAGING_REF_RE.test(storageRef)) {
    invalidSlot('storageRef di staging non valido.');
  }
  const sha256 = root.sha256;
  if (typeof sha256 !== 'string' || !SHA256_HEX_RE.test(sha256))
    invalidSlot('sha256 di staging non valido.');
  return {
    storageRef,
    width: assertPositiveInt(root.width, 'Larghezza di staging'),
    height: assertPositiveInt(root.height, 'Altezza di staging'),
    byteLength: assertPositiveInt(root.byteLength, 'Dimensione di staging'),
    sha256,
  };
}

function assertNullableSlotText(value: unknown, label: string): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim()) {
    invalidSlot(`${label} non valido.`);
  }
  return value as string;
}

/**
 * Valida uno slot del piano, fail-closed, con le relazioni dichiarate dal
 * roadmap: `subject`/`rationale`/`anchor`/`caption`/`altText` popolati se e
 * solo se `decision === 'image'` (per `subject` il roadmap lo dichiara
 * esplicitamente — «null se decision === 'none'» — e la stessa disciplina si
 * applica agli altri campi editoriali della stessa proposta coordinata,
 * §8.3–§8.4); `staged` presente solo quando `state === 'ready'`;
 * `promotedAssetId` non nullo solo quando `state === 'promoted'`; `attempts`
 * entro `VISUAL_PLAN_MAX_ATTEMPTS_PER_SLOT`.
 */
export function validateVisualPlanSlot(value: unknown, maxAttemptsPerSlot: number): VisualPlanSlot {
  const root = asRecord(value, 'Slot del piano visivo non valido.', 'corrupted_state');
  assertExactKeys(root, SLOT_KEYS, 'Slot del piano visivo', 'corrupted_state');

  const slotIndex = assertNonNegativeInt(root.slotIndex, 'slotIndex');

  const state = root.state;
  if (typeof state !== 'string' || !SLOT_STATES.includes(state as VisualPlanSlotState)) {
    invalidSlot('Stato dello slot non valido.');
  }

  const decision = root.decision;
  if (decision !== 'image' && decision !== 'none') {
    invalidSlot('Decisione dello slot non valida.');
  }

  const subject = assertNullableSlotText(root.subject, 'subject');
  const rationale = assertNullableSlotText(root.rationale, 'rationale');
  const caption = assertNullableSlotText(root.caption, 'caption');
  const altText = assertNullableSlotText(root.altText, 'altText');
  const anchor = root.anchor === null ? null : validateVisualAnchorSelector(root.anchor);

  const isImage = decision === 'image';
  if (
    (subject === null) === isImage ||
    (rationale === null) === isImage ||
    (caption === null) === isImage ||
    (altText === null) === isImage ||
    (anchor === null) === isImage
  ) {
    invalidSlot(
      'Lo slot non è coerente: i campi editoriali devono essere tutti presenti con decision "image" e tutti assenti con decision "none".',
    );
  }

  const attempts = assertNonNegativeInt(root.attempts, 'attempts');
  if (attempts > maxAttemptsPerSlot) invalidSlot('attempts oltre il tetto consentito per slot.');

  const lastErrorRaw = root.lastError;
  if (
    lastErrorRaw !== null &&
    !SLOT_LAST_ERRORS.includes(lastErrorRaw as VisualPlanSlotLastError)
  ) {
    invalidSlot('lastError non valido.');
  }
  const lastError = lastErrorRaw as VisualPlanSlotLastError | null;

  const stagedRaw = root.staged;
  if ((stagedRaw !== null) !== (state === 'ready')) {
    invalidSlot('staged deve essere presente se e solo se lo stato è "ready".');
  }
  const staged = stagedRaw === null ? null : validateStaged(stagedRaw);

  const promotedAssetIdRaw = root.promotedAssetId;
  if ((promotedAssetIdRaw !== null) !== (state === 'promoted')) {
    invalidSlot('promotedAssetId deve essere presente se e solo se lo stato è "promoted".');
  }
  let promotedAssetId: string | null = null;
  if (promotedAssetIdRaw !== null) {
    if (typeof promotedAssetIdRaw !== 'string' || !UUID_V4_RE.test(promotedAssetIdRaw)) {
      invalidSlot('promotedAssetId non valido.');
    }
    promotedAssetId = promotedAssetIdRaw;
  }

  return {
    slotIndex,
    state: state as VisualPlanSlotState,
    decision,
    subject,
    rationale,
    anchor,
    caption,
    altText,
    attempts,
    lastError,
    staged,
    promotedAssetId,
  };
}

// ─── Vincolo di diversità (roadmap §7.4) ───────────────────────────────────────

/**
 * Normalizzazione lessicale: trim, minuscolo, spazi collassati — esattamente
 * ciò che il roadmap chiama «normalizzazione» al §7.4, nient'altro (nessuno
 * stemming, nessuna rimozione di punteggiatura: un confronto più aggressivo
 * di questo non è ciò che il documento chiede).
 */
function normalizeForDiversity(value: string): string {
  return value.trim().toLocaleLowerCase('it').replace(/\s+/g, ' ');
}

/**
 * `anchorHeadingIndex` NON è più, da solo, un blocco (correzione rispetto
 * alla revisione 2, roadmap §7.4): due slot possono legittimamente condividere
 * la stessa ancora. `subject` e `rationale` devono essere a due a due
 * distinti dopo normalizzazione, **indipendentemente dall'ancora** — la
 * violazione produce `provider_invalid_output`, mai una struttura diversa.
 * Si applica solo agli slot con `decision === 'image'`: un caricamento del
 * docente (fuori dalla proposta coordinata) non è soggetto a questo vincolo
 * (§7.4, ultimo paragrafo) e comunque non produce mai slot con `decision ===
 * 'image'` di questo piano.
 */
export function validateVisualPlanDiversity(slots: readonly VisualPlanSlot[]): void {
  const seenSubjects = new Set<string>();
  const seenRationales = new Set<string>();
  for (const slot of slots) {
    if (slot.decision !== 'image') continue;
    // La forma dello slot garantisce già subject/rationale non nulli qui
    // (validateVisualPlanSlot); il controllo resta per sicurezza tipica.
    if (slot.subject === null || slot.rationale === null) {
      throw new AiVisualMultiError(
        'provider_invalid_output',
        'Uno slot "image" è privo di soggetto o utilità didattica.',
      );
    }
    const subjectKey = normalizeForDiversity(slot.subject);
    const rationaleKey = normalizeForDiversity(slot.rationale);
    if (seenSubjects.has(subjectKey)) {
      throw new AiVisualMultiError(
        'provider_invalid_output',
        'Due immagini del piano propongono lo stesso soggetto.',
      );
    }
    if (seenRationales.has(rationaleKey)) {
      throw new AiVisualMultiError(
        'provider_invalid_output',
        'Due immagini del piano dichiarano la stessa utilità didattica.',
      );
    }
    seenSubjects.add(subjectKey);
    seenRationales.add(rationaleKey);
  }
}

// ─── Tetto di budget (roadmap §5.5, §12.1) ─────────────────────────────────────

export interface VisualPlanBudgetCeiling {
  reservationKey: string;
  proposalCap: number;
  generationCap: number;
  maxAttemptsPerSlot: number;
  totalReserved: number;
}

const BUDGET_CEILING_KEYS = [
  'reservationKey',
  'proposalCap',
  'generationCap',
  'maxAttemptsPerSlot',
  'totalReserved',
] as const;

/** `proposalCap + generationCap × ceiling × maxAttemptsPerSlot` (roadmap §12.1). */
export function computeVisualPlanTotalReserved(params: {
  proposalCap: number;
  generationCap: number;
  ceiling: 1 | 2 | 3;
  maxAttemptsPerSlot: number;
}): number {
  return params.proposalCap + params.generationCap * params.ceiling * params.maxAttemptsPerSlot;
}

function validateVisualPlanBudgetCeiling(
  value: unknown,
  ceiling: 1 | 2 | 3,
): VisualPlanBudgetCeiling {
  const root = asRecord(value, 'Tetto di budget del piano non valido.', 'corrupted_state');
  assertExactKeys(root, BUDGET_CEILING_KEYS, 'Tetto di budget del piano', 'corrupted_state');

  const reservationKey = root.reservationKey;
  if (typeof reservationKey !== 'string' || !SHA256_HEX_RE.test(reservationKey)) {
    throw new AiVisualMultiError('corrupted_state', 'reservationKey non valida.');
  }
  const proposalCap = assertNonNegativeInt(root.proposalCap, 'proposalCap');
  const generationCap = assertNonNegativeInt(root.generationCap, 'generationCap');
  const maxAttemptsPerSlot = assertPositiveInt(root.maxAttemptsPerSlot, 'maxAttemptsPerSlot');
  const totalReserved = assertNonNegativeInt(root.totalReserved, 'totalReserved');

  const expected = computeVisualPlanTotalReserved({
    proposalCap,
    generationCap,
    ceiling,
    maxAttemptsPerSlot,
  });
  if (totalReserved !== expected) {
    invalidSlot('totalReserved non coerente con la formula del tetto.');
  }

  return { reservationKey, proposalCap, generationCap, maxAttemptsPerSlot, totalReserved };
}

// ─── Consuntivo (roadmap §5.5, §12) ────────────────────────────────────────────

export interface VisualPlanSettlementSlot {
  slotIndex: number;
  attempts: number;
  actualCost: number | null;
}

export interface VisualPlanSettlement {
  proposalActualCost: number | null;
  slots: VisualPlanSettlementSlot[];
}

const SETTLEMENT_KEYS = ['proposalActualCost', 'slots'] as const;
const SETTLEMENT_SLOT_KEYS = ['slotIndex', 'attempts', 'actualCost'] as const;

function assertNullableNonNegativeInt(value: unknown, label: string): number | null {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    invalidSlot(`${label} non valido.`);
  }
  return value as number;
}

function validateSettlementSlot(
  value: unknown,
  knownSlotIndexes: ReadonlySet<number>,
  maxAttemptsPerSlot: number,
): VisualPlanSettlementSlot {
  const root = asRecord(value, 'Consuntivo dello slot non valido.', 'corrupted_state');
  assertExactKeys(root, SETTLEMENT_SLOT_KEYS, 'Consuntivo dello slot', 'corrupted_state');
  const slotIndex = assertNonNegativeInt(root.slotIndex, 'slotIndex del consuntivo');
  if (!knownSlotIndexes.has(slotIndex)) {
    invalidSlot('Il consuntivo referenzia uno slotIndex che non esiste nel piano.');
  }
  const attempts = assertNonNegativeInt(root.attempts, 'attempts del consuntivo');
  if (attempts > maxAttemptsPerSlot)
    invalidSlot('attempts del consuntivo oltre il tetto per slot.');
  const actualCost = assertNullableNonNegativeInt(root.actualCost, 'actualCost dello slot');
  return { slotIndex, attempts, actualCost };
}

/**
 * Invariante relazionale (roadmap §5.5): la somma dei costi reali — proposta
 * più ciascuno slot — non supera mai `budgetCeiling.totalReserved`.
 */
function validateVisualPlanSettlement(
  value: unknown,
  params: {
    knownSlotIndexes: ReadonlySet<number>;
    maxAttemptsPerSlot: number;
    totalReserved: number;
  },
): VisualPlanSettlement {
  const root = asRecord(value, 'Consuntivo del piano non valido.', 'corrupted_state');
  assertExactKeys(root, SETTLEMENT_KEYS, 'Consuntivo del piano', 'corrupted_state');

  const proposalActualCost = assertNullableNonNegativeInt(
    root.proposalActualCost,
    'proposalActualCost',
  );
  if (!Array.isArray(root.slots)) invalidSlot('slots del consuntivo non valido.');
  const slots = root.slots.map((slot: unknown) =>
    validateSettlementSlot(slot, params.knownSlotIndexes, params.maxAttemptsPerSlot),
  );
  const seenSlotIndexes = new Set<number>();
  for (const slot of slots) {
    if (seenSlotIndexes.has(slot.slotIndex)) invalidSlot('slotIndex duplicato nel consuntivo.');
    seenSlotIndexes.add(slot.slotIndex);
  }

  const spent =
    (proposalActualCost ?? 0) + slots.reduce((sum, slot) => sum + (slot.actualCost ?? 0), 0);
  if (spent > params.totalReserved) {
    invalidSlot('Il consuntivo supera il tetto di budget riservato dal piano.');
  }

  return { proposalActualCost, slots };
}

// ─── Piano visivo (roadmap §5.5) ───────────────────────────────────────────────

export type VisualPlanStatus =
  | 'authorized'
  | 'proposing'
  | 'proposed'
  | 'generating'
  | 'awaiting_review'
  | 'completed'
  | 'partially_completed'
  | 'abandoned'
  | 'expired';

const PLAN_STATUSES: readonly VisualPlanStatus[] = [
  'authorized',
  'proposing',
  'proposed',
  'generating',
  'awaiting_review',
  'completed',
  'partially_completed',
  'abandoned',
  'expired',
];

export interface VisualPlanRun {
  contractVersion: typeof VISUAL_PLAN_CONTRACT_VERSION;
  ownerUid: string;
  programId: string;
  importId: string;
  lessonId: string;
  publicLessonId: string;
  udaDir: string;
  requestId: string;
  planHash: string;
  status: VisualPlanStatus;
  quantity: VisualPlanQuantitySelection;
  sourceBodyHash: string;
  existingItemAssetIds: string[];
  budgetCeiling: VisualPlanBudgetCeiling;
  slots: VisualPlanSlot[];
  settlement: VisualPlanSettlement;
  createdAt: VisualTimestampLike;
  updatedAt: VisualTimestampLike;
  expireAt: VisualTimestampLike;
}

const PLAN_KEYS = [
  'contractVersion',
  'ownerUid',
  'programId',
  'importId',
  'lessonId',
  'publicLessonId',
  'udaDir',
  'requestId',
  'planHash',
  'status',
  'quantity',
  'sourceBodyHash',
  'existingItemAssetIds',
  'budgetCeiling',
  'slots',
  'settlement',
  'createdAt',
  'updatedAt',
  'expireAt',
] as const;

function assertIdSegment(value: unknown, label: string): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value !== value.trim() ||
    value.includes('/') ||
    value === '.' ||
    value === '..'
  ) {
    invalidSlot(`${label} non valido.`);
  }
  return value as string;
}

function assertTimestampLike(value: unknown, label: string): VisualTimestampLike {
  if (timestampToMillis(value) === null) invalidSlot(`${label} non valido.`);
  return value as VisualTimestampLike;
}

function validateExistingItemAssetIds(value: unknown): string[] {
  if (!Array.isArray(value)) invalidSlot('existingItemAssetIds non valido.');
  if (value.length > 3) invalidSlot('existingItemAssetIds supera il tetto di tre immagini.');
  const ids = value.map((id: unknown) => {
    if (typeof id !== 'string' || !UUID_V4_RE.test(id))
      invalidSlot('existingItemAssetIds contiene un id non valido.');
    return id as string;
  });
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) invalidSlot('existingItemAssetIds contiene un id duplicato.');
    seen.add(id);
  }
  return ids;
}

/**
 * Valida un `VisualPlanRun` persistito, fail-closed. Un record presente ma
 * strutturalmente divergente è sempre `corrupted_state` (roadmap §5.5): non
 * è compito di questo validatore decidere se il record è un replay legittimo
 * o un conflitto d'identità — quel giudizio confronta i campi identità con la
 * richiesta corrente ed è competenza del chiamante (§10.1), che non ha I/O da
 * fare qui.
 */
export function validateVisualPlanRun(value: unknown): VisualPlanRun {
  const root = asRecord(value, 'Piano visivo non valido.', 'corrupted_state');
  assertExactKeys(root, PLAN_KEYS, 'Piano visivo', 'corrupted_state');

  if (root.contractVersion !== VISUAL_PLAN_CONTRACT_VERSION) {
    throw new AiVisualMultiError('corrupted_state', 'contractVersion del piano non valida.');
  }

  const ownerUid = assertIdSegment(root.ownerUid, 'ownerUid');
  const programId = assertIdSegment(root.programId, 'programId');
  const importId = assertIdSegment(root.importId, 'importId');
  const lessonId = assertIdSegment(root.lessonId, 'lessonId');
  const publicLessonId = assertIdSegment(root.publicLessonId, 'publicLessonId');
  const udaDir = assertIdSegment(root.udaDir, 'udaDir');

  const requestId = root.requestId;
  if (typeof requestId !== 'string' || !UUID_V4_RE.test(requestId)) {
    throw new AiVisualMultiError('corrupted_state', 'requestId del piano non valido.');
  }
  const planHash = root.planHash;
  if (typeof planHash !== 'string' || !SHA256_HEX_RE.test(planHash)) {
    throw new AiVisualMultiError('corrupted_state', 'planHash del piano non valido.');
  }

  const status = root.status;
  if (typeof status !== 'string' || !PLAN_STATUSES.includes(status as VisualPlanStatus)) {
    throw new AiVisualMultiError('corrupted_state', 'status del piano non valido.');
  }

  const quantity = validateVisualPlanQuantitySelection(root.quantity);

  const sourceBodyHash = root.sourceBodyHash;
  if (typeof sourceBodyHash !== 'string' || !SHA256_HEX_RE.test(sourceBodyHash)) {
    throw new AiVisualMultiError('corrupted_state', 'sourceBodyHash del piano non valido.');
  }

  const existingItemAssetIds = validateExistingItemAssetIds(root.existingItemAssetIds);
  const budgetCeiling = validateVisualPlanBudgetCeiling(root.budgetCeiling, quantity.ceiling);

  if (!Array.isArray(root.slots)) invalidSlot('slots del piano non valido.');
  if (root.slots.length > quantity.ceiling) {
    invalidSlot('slots supera il tetto di quantità del piano.');
  }
  const slots = root.slots.map((slot: unknown) =>
    validateVisualPlanSlot(slot, budgetCeiling.maxAttemptsPerSlot),
  );
  const seenSlotIndexes = new Set<number>();
  for (const slot of slots) {
    if (slot.slotIndex >= quantity.ceiling) {
      invalidSlot('slotIndex di uno slot fuori dal tetto di quantità del piano.');
    }
    if (seenSlotIndexes.has(slot.slotIndex))
      invalidSlot('slotIndex duplicato fra gli slot del piano.');
    seenSlotIndexes.add(slot.slotIndex);
  }

  const settlement = validateVisualPlanSettlement(root.settlement, {
    knownSlotIndexes: seenSlotIndexes,
    maxAttemptsPerSlot: budgetCeiling.maxAttemptsPerSlot,
    totalReserved: budgetCeiling.totalReserved,
  });

  const createdAt = assertTimestampLike(root.createdAt, 'createdAt');
  const updatedAt = assertTimestampLike(root.updatedAt, 'updatedAt');
  const expireAt = assertTimestampLike(root.expireAt, 'expireAt');

  return {
    contractVersion: VISUAL_PLAN_CONTRACT_VERSION,
    ownerUid,
    programId,
    importId,
    lessonId,
    publicLessonId,
    udaDir,
    requestId,
    planHash,
    status: status as VisualPlanStatus,
    quantity,
    sourceBodyHash,
    existingItemAssetIds,
    budgetCeiling,
    slots,
    settlement,
    createdAt,
    updatedAt,
    expireAt,
  };
}
