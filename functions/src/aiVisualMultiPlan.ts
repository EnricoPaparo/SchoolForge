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
 * Riusa `VisualAnchorSelector` di `aiVisualMultiAnchor.ts`, `VisualTimestampLike`
 * / `timestampToMillis` di VE, `isValidDocumentIdInput` di `firestoreDocumentId.ts`
 * e i validatori di testo editoriale di VE (`assertValidVisualSubject`,
 * `assertProposalField`) — nessuna seconda definizione di questi vincoli
 * (review fix, blocker 1 e 2).
 *
 * Puro: nessuna rete, nessun I/O, nessuna dipendenza Firebase.
 */

import { AiContentError, timestampToMillis } from './aiContentCore.js';
import {
  MAX_VISUAL_ALT_TEXT_CHARS,
  MAX_VISUAL_BYTES,
  MAX_VISUAL_CAPTION_CHARS,
  MAX_VISUAL_LONG_EDGE,
  MAX_VISUAL_RATIONALE_CHARS,
  VISUAL_STAGING_TTL_MS,
  assertProposalField,
  assertValidVisualSubject,
  type VisualTimestampLike,
} from './aiContentVisualProposal.js';
import { AiVisualError } from './aiVisualCore.js';
import { isValidDocumentIdInput } from './firestoreDocumentId.js';
import { validateVisualAnchorSelector, type VisualAnchorSelector } from './aiVisualMultiAnchor.js';
import {
  MAX_VISUALS_PER_LESSON,
  VISUAL_PLAN_CONTRACT_VERSION,
  VISUAL_PLAN_MAX_ATTEMPTS_PER_SLOT,
  AiVisualMultiError,
  asRecord,
  assertExactKeys,
  computeOpaqueVisualPlanId,
  isSha256Hex,
  isUuidV4,
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

/**
 * Stati terminali di uno slot — usati solo per derivare lo status del piano
 * (§8.7, blocker 4). `ready` **non** è terminale: è «generato, in attesa di
 * promozione», ancora in corso.
 */
const TERMINAL_SLOT_STATES: ReadonlySet<VisualPlanSlotState> = new Set([
  'promoted',
  'failed',
  'abandoned',
]);

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

function invalidSlot(message: string): never {
  throw new AiVisualMultiError('corrupted_state', message);
}

function assertNonNegativeInt(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    invalidSlot(`${label} non valido.`);
  }
  return value;
}

/** Intero positivo, entro `max` incluso — usato per i cap binari (blocker 3). */
function assertBoundedPositiveInt(value: unknown, label: string, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0 || value > max) {
    invalidSlot(`${label} non valida.`);
  }
  return value;
}

/**
 * Forma del percorso di staging del piano:
 * `staging/{ownerUid}/{opaquePlanId}/{slotIndex}.webp` (roadmap §5.5).
 *
 * **Review fix (blocker 3), livello slot.** Verifica ciò che uno slot può
 * verificare da solo, senza conoscere l'identità del piano: quattro segmenti
 * non vuoti, nessun `.`/`..`, prefisso `staging`, `ownerUid` nella stessa
 * forma di un id Firestore (`isValidDocumentIdInput`, §1 del blocker),
 * `opaquePlanId` in forma SHA-256, e **il proprio** `slotIndex` come nome
 * file esatto — uno slot 0 non può dichiarare `.../2.webp`. Il legame con
 * l'`ownerUid`/`opaquePlanId` *reali* del piano è verificato a un livello
 * più alto, in `validateVisualPlanRun`, l'unico punto che conosce entrambi.
 */
function assertStagedStorageRefShape(value: unknown, slotIndex: number): string {
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim()) {
    invalidSlot('storageRef di staging non valido.');
  }
  const segments = value.split('/');
  if (
    segments.length !== 4 ||
    segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')
  ) {
    invalidSlot('storageRef di staging non ha la forma canonica.');
  }
  if (segments[0] !== 'staging') {
    invalidSlot('storageRef di staging non parte dal prefisso "staging".');
  }
  if (!isValidDocumentIdInput(segments[1])) {
    invalidSlot('storageRef di staging: ownerUid non valido.');
  }
  if (!isSha256Hex(segments[2])) {
    invalidSlot('storageRef di staging: opaquePlanId non valido.');
  }
  if (segments[3] !== `${slotIndex}.webp`) {
    invalidSlot('storageRef di staging non corrisponde al proprio slotIndex.');
  }
  return value;
}

/**
 * **Review fix (blocker 3).** I cap binari canonici (`MAX_VISUAL_LONG_EDGE`,
 * `MAX_VISUAL_BYTES`, VE §4) si applicano anche ai byte in staging del
 * piano: sono gli stessi byte che, promossi, diventeranno un
 * `LessonVisualItem` soggetto agli stessi limiti — uno staging fuori
 * contratto non deve poter esistere anche solo transitoriamente.
 */
function validateStaged(value: unknown, slotIndex: number): VisualPlanSlotStaged {
  const root = asRecord(value, 'Byte in staging dello slot non validi.', 'corrupted_state');
  assertExactKeys(root, STAGED_KEYS, 'Byte in staging dello slot', 'corrupted_state');
  const storageRef = assertStagedStorageRefShape(root.storageRef, slotIndex);
  const sha256 = root.sha256;
  if (!isSha256Hex(sha256)) invalidSlot('sha256 di staging non valido.');
  const width = assertBoundedPositiveInt(root.width, 'Larghezza di staging', MAX_VISUAL_LONG_EDGE);
  const height = assertBoundedPositiveInt(root.height, 'Altezza di staging', MAX_VISUAL_LONG_EDGE);
  if (Math.max(width, height) > MAX_VISUAL_LONG_EDGE) {
    invalidSlot(`Il lato lungo dello staging supera ${MAX_VISUAL_LONG_EDGE} pixel.`);
  }
  const byteLength = assertBoundedPositiveInt(
    root.byteLength,
    'Dimensione di staging',
    MAX_VISUAL_BYTES,
  );
  return { storageRef, width, height, byteLength, sha256 };
}

/**
 * **Review fix (blocker 2).** Un campo editoriale nullo è ammesso solo con
 * `decision === 'none'` — usato per `subject`/`rationale`/`caption`/`altText`/
 * `anchor` quando la decisione dello slot non prevede immagine.
 */
function assertNullEditorialField(value: unknown, label: string): null {
  if (value !== null) {
    invalidSlot(`${label} deve essere nullo quando decision è "none".`);
  }
  return null;
}

/**
 * Valida uno slot del piano, fail-closed, con le relazioni dichiarate dal
 * roadmap: `subject`/`rationale`/`anchor`/`caption`/`altText` popolati se e
 * solo se `decision === 'image'`, e in quel caso soggetti agli **stessi
 * limiti VE** della proposta coordinata (§8.3, review fix blocker 2):
 * `subject` tramite `assertValidVisualSubject` (≤400 code point, filtro
 * subject), `rationale`/`caption`/`altText` tramite `assertProposalField`
 * (≤800/≤500/≤1000, niente controllo/markup/fence, nessuna correzione) —
 * `none` resta tutto nullo. `staged` presente solo quando `state === 'ready'`;
 * `promotedAssetId` non nullo solo quando `state === 'promoted'`;
 * `lastError` non nullo se e solo se `state === 'failed'` (review fix,
 * blocker 4); `attempts` entro `maxAttemptsPerSlot`.
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
  const isImage = decision === 'image';

  const subject = isImage
    ? assertValidVisualSubject(root.subject)
    : assertNullEditorialField(root.subject, 'subject');
  const rationale = isImage
    ? assertProposalField(root.rationale, 'Utilità didattica', MAX_VISUAL_RATIONALE_CHARS)
    : assertNullEditorialField(root.rationale, 'rationale');
  const caption = isImage
    ? assertProposalField(root.caption, 'Didascalia', MAX_VISUAL_CAPTION_CHARS)
    : assertNullEditorialField(root.caption, 'caption');
  const altText = isImage
    ? assertProposalField(root.altText, 'Testo alternativo', MAX_VISUAL_ALT_TEXT_CHARS)
    : assertNullEditorialField(root.altText, 'altText');
  const anchor = isImage
    ? validateVisualAnchorSelector(root.anchor)
    : assertNullEditorialField(root.anchor, 'anchor');

  const attempts = assertNonNegativeInt(root.attempts, 'attempts');
  if (attempts > maxAttemptsPerSlot) invalidSlot('attempts oltre il tetto consentito per slot.');

  const lastErrorRaw = root.lastError;
  if (
    lastErrorRaw !== null &&
    !SLOT_LAST_ERRORS.includes(lastErrorRaw as VisualPlanSlotLastError)
  ) {
    invalidSlot('lastError non valido.');
  }
  if ((lastErrorRaw !== null) !== (state === 'failed')) {
    invalidSlot('lastError deve essere presente se e solo se lo stato è "failed".');
  }
  const lastError = lastErrorRaw as VisualPlanSlotLastError | null;

  const stagedRaw = root.staged;
  if ((stagedRaw !== null) !== (state === 'ready')) {
    invalidSlot('staged deve essere presente se e solo se lo stato è "ready".');
  }
  const staged = stagedRaw === null ? null : validateStaged(stagedRaw, slotIndex);

  const promotedAssetIdRaw = root.promotedAssetId;
  if ((promotedAssetIdRaw !== null) !== (state === 'promoted')) {
    invalidSlot('promotedAssetId deve essere presente se e solo se lo stato è "promoted".');
  }
  let promotedAssetId: string | null = null;
  if (promotedAssetIdRaw !== null) {
    if (!isUuidV4(promotedAssetIdRaw)) invalidSlot('promotedAssetId non valido.');
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
 *
 * **Confine (blocker 5).** Questa funzione resta fuori da
 * `validateVisualPlanRun`: è la validazione di una proposta **prima** della
 * persistenza, non la lettura di un piano già scritto. Il suo
 * `provider_invalid_output` non deve mai diventare `corrupted_state`.
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

/**
 * **Review fix (blocker 4).** `maxAttemptsPerSlot` non è più un intero
 * positivo arbitrario coerente solo con la propria formula: nel contratto
 * v1 dev'essere **esattamente** `VISUAL_PLAN_MAX_ATTEMPTS_PER_SLOT` (2). Un
 * valore diverso (per esempio 999) permetterebbe ad `attempts` di superare
 * il tetto reale del prodotto. Se una versione futura del contratto
 * introducesse un tetto diverso per piano, questo controllo — e non un
 * secondo posto — è quello da aggiornare.
 */
function validateVisualPlanBudgetCeiling(
  value: unknown,
  ceiling: 1 | 2 | 3,
): VisualPlanBudgetCeiling {
  const root = asRecord(value, 'Tetto di budget del piano non valido.', 'corrupted_state');
  assertExactKeys(root, BUDGET_CEILING_KEYS, 'Tetto di budget del piano', 'corrupted_state');

  const reservationKey = root.reservationKey;
  if (!isSha256Hex(reservationKey)) {
    throw new AiVisualMultiError('corrupted_state', 'reservationKey non valida.');
  }
  const proposalCap = assertNonNegativeInt(root.proposalCap, 'proposalCap');
  const generationCap = assertNonNegativeInt(root.generationCap, 'generationCap');
  const maxAttemptsPerSlot = root.maxAttemptsPerSlot;
  if (maxAttemptsPerSlot !== VISUAL_PLAN_MAX_ATTEMPTS_PER_SLOT) {
    invalidSlot(
      `maxAttemptsPerSlot deve essere esattamente ${VISUAL_PLAN_MAX_ATTEMPTS_PER_SLOT} (contratto v1).`,
    );
  }
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

/**
 * **Review fix (blocker 4).** `attempts` non è più libero entro il tetto per
 * slot: deve coincidere **esattamente** con gli `attempts` dello slot
 * corrispondente del piano — un consuntivo che dichiara un numero di
 * tentativi diverso da quello che lo slot stesso riporta è una
 * contraddizione interna del documento, non un valore "anche plausibile".
 * E se `attempts === 0`, `actualCost` non può che essere `null`: non si può
 * aver speso senza aver tentato.
 */
function validateSettlementSlot(
  value: unknown,
  slotAttemptsByIndex: ReadonlyMap<number, number>,
): VisualPlanSettlementSlot {
  const root = asRecord(value, 'Consuntivo dello slot non valido.', 'corrupted_state');
  assertExactKeys(root, SETTLEMENT_SLOT_KEYS, 'Consuntivo dello slot', 'corrupted_state');
  const slotIndex = assertNonNegativeInt(root.slotIndex, 'slotIndex del consuntivo');
  const expectedAttempts = slotAttemptsByIndex.get(slotIndex);
  if (expectedAttempts === undefined) {
    invalidSlot('Il consuntivo referenzia uno slotIndex che non esiste nel piano.');
  }
  const attempts = assertNonNegativeInt(root.attempts, 'attempts del consuntivo');
  if (attempts !== expectedAttempts) {
    invalidSlot('attempts del consuntivo non corrisponde agli attempts dello slot.');
  }
  const actualCost = assertNullableNonNegativeInt(root.actualCost, 'actualCost dello slot');
  if (attempts === 0 && actualCost !== null) {
    invalidSlot('actualCost deve essere nullo quando lo slot non ha tentativi.');
  }
  return { slotIndex, attempts, actualCost };
}

/**
 * Invariante relazionale (roadmap §5.5): la somma dei costi reali — proposta
 * più ciascuno slot — non supera mai `budgetCeiling.totalReserved`.
 */
function validateVisualPlanSettlement(
  value: unknown,
  params: { slotAttemptsByIndex: ReadonlyMap<number, number>; totalReserved: number },
): VisualPlanSettlement {
  const root = asRecord(value, 'Consuntivo del piano non valido.', 'corrupted_state');
  assertExactKeys(root, SETTLEMENT_KEYS, 'Consuntivo del piano', 'corrupted_state');

  const proposalActualCost = assertNullableNonNegativeInt(
    root.proposalActualCost,
    'proposalActualCost',
  );
  if (!Array.isArray(root.slots)) invalidSlot('slots del consuntivo non valido.');
  const slots = root.slots.map((slot: unknown) =>
    validateSettlementSlot(slot, params.slotAttemptsByIndex),
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

/**
 * **Review fix (blocker 1).** Sostituisce l'`assertIdSegment` locale — più
 * debole del contratto canonico — con `isValidDocumentIdInput`
 * (`firestoreDocumentId.ts`): stessa forma di id già in vigore altrove nel
 * repository, senza una seconda definizione più permissiva (accettava la
 * forma riservata `__…__` e caratteri di controllo).
 */
function assertPlanIdSegment(value: unknown, label: string): string {
  if (!isValidDocumentIdInput(value)) invalidSlot(`${label} non valido.`);
  return value;
}

function assertTimestampLike(value: unknown, label: string): VisualTimestampLike {
  if (timestampToMillis(value) === null) invalidSlot(`${label} non valido.`);
  return value as VisualTimestampLike;
}

/**
 * **Review fix (blocker 4).** Un solo helper per la relazione dei tre
 * timestamp del piano: `createdAt ≤ updatedAt ≤ expireAt`, e
 * `expireAt === createdAt + TTL` — lo stesso TTL di 24 h dello staging VE
 * (roadmap §5.5: «TTL 24 h come lo staging di VE»), riusato da
 * `VISUAL_STAGING_TTL_MS` e non ridichiarato come costante propria.
 */
function assertVisualPlanTimestampOrder(params: {
  createdAt: VisualTimestampLike;
  updatedAt: VisualTimestampLike;
  expireAt: VisualTimestampLike;
}): void {
  const createdMs = timestampToMillis(params.createdAt);
  const updatedMs = timestampToMillis(params.updatedAt);
  const expireMs = timestampToMillis(params.expireAt);
  if (createdMs === null || updatedMs === null || expireMs === null) {
    invalidSlot('Timestamp del piano non validi.');
  }
  if (!(createdMs <= updatedMs && updatedMs <= expireMs)) {
    invalidSlot('I timestamp del piano non rispettano createdAt ≤ updatedAt ≤ expireAt.');
  }
  if (expireMs !== createdMs + VISUAL_STAGING_TTL_MS) {
    invalidSlot('expireAt non corrisponde a createdAt + TTL 24h (contratto v1).');
  }
}

function validateExistingItemAssetIds(value: unknown): string[] {
  if (!Array.isArray(value)) invalidSlot('existingItemAssetIds non valido.');
  if (value.length > MAX_VISUALS_PER_LESSON) {
    invalidSlot('existingItemAssetIds supera il tetto di tre immagini.');
  }
  const ids = value.map((id: unknown) => {
    if (!isUuidV4(id)) invalidSlot('existingItemAssetIds contiene un id non valido.');
    return id;
  });
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) invalidSlot('existingItemAssetIds contiene un id duplicato.');
    seen.add(id);
  }
  return ids;
}

/**
 * **Review fix (blocker 4).** Le tre sole conclusioni di §8.7 derivabili
 * strutturalmente dagli stati degli slot, senza inventare relazioni per gli
 * stati intermedi (`authorized`…`awaiting_review`) che il roadmap non
 * determina qui:
 *
 * - `completed`: ogni slot è terminale e ogni slot "image" è `promoted`;
 * - `partially_completed`: ogni slot è terminale, almeno uno slot "image" è
 *   `promoted` e almeno uno slot "image" non lo è;
 * - `abandoned`: ogni slot è terminale e nessuno slot "image" è `promoted`.
 */
function assertVisualPlanStatusMatchesSlots(
  status: VisualPlanStatus,
  slots: readonly VisualPlanSlot[],
): void {
  if (status !== 'completed' && status !== 'partially_completed' && status !== 'abandoned') return;

  const allTerminal = slots.every((slot) => TERMINAL_SLOT_STATES.has(slot.state));
  if (!allTerminal) {
    invalidSlot(`status "${status}" richiede che ogni slot sia in uno stato terminale.`);
  }

  const imageSlots = slots.filter((slot) => slot.decision === 'image');
  const promotedCount = imageSlots.filter((slot) => slot.state === 'promoted').length;
  const nonPromotedCount = imageSlots.length - promotedCount;

  if (status === 'completed' && nonPromotedCount > 0) {
    invalidSlot('status "completed" richiede che ogni slot immagine sia promosso.');
  }
  if (status === 'partially_completed' && (promotedCount === 0 || nonPromotedCount === 0)) {
    invalidSlot(
      'status "partially_completed" richiede almeno uno slot immagine promosso e almeno uno non promosso.',
    );
  }
  if (status === 'abandoned' && promotedCount > 0) {
    invalidSlot('status "abandoned" richiede che nessuno slot immagine sia stato promosso.');
  }
}

/**
 * Valida un `VisualPlanRun` persistito, fail-closed. Un record presente ma
 * strutturalmente divergente è sempre `corrupted_state` (roadmap §5.5): non
 * è compito di questo validatore decidere se il record è un replay legittimo
 * o un conflitto d'identità — quel giudizio confronta i campi identità con la
 * richiesta corrente ed è competenza del chiamante (§10.1), che non ha I/O da
 * fare qui.
 *
 * **Review fix (blocker 5).** «La porta autorevole del run» — questa
 * funzione — traduce **qualunque** errore strutturale annidato (ancora,
 * slot, quantità, consuntivo — di qualunque codice, `invalid_input` o
 * `provider_invalid_output` compreso) in `corrupted_state`: un
 * `VisualPlanRun` letto da uno storage persistito non lascia mai trapelare
 * la tassonomia d'errore di una fase diversa (la validazione di un output
 * provider fresco, mai persistito, che resta `provider_invalid_output` —
 * vedi `validateVisualPlanDiversity`, non chiamata da qui). Un errore **non**
 * riconosciuto (un bug reale, non un dato malformato) non viene
 * silenziato: si ripropaga inalterato.
 */
export function validateVisualPlanRun(value: unknown): VisualPlanRun {
  const root = asRecord(value, 'Piano visivo non valido.', 'corrupted_state');
  assertExactKeys(root, PLAN_KEYS, 'Piano visivo', 'corrupted_state');

  if (root.contractVersion !== VISUAL_PLAN_CONTRACT_VERSION) {
    throw new AiVisualMultiError('corrupted_state', 'contractVersion del piano non valida.');
  }

  try {
    return parsePersistedVisualPlanRun(root);
  } catch (error) {
    if (
      error instanceof AiVisualMultiError ||
      error instanceof AiContentError ||
      error instanceof AiVisualError
    ) {
      throw new AiVisualMultiError('corrupted_state', error.message);
    }
    throw error;
  }
}

function parsePersistedVisualPlanRun(root: Record<string, unknown>): VisualPlanRun {
  const ownerUid = assertPlanIdSegment(root.ownerUid, 'ownerUid');
  const programId = assertPlanIdSegment(root.programId, 'programId');
  const importId = assertPlanIdSegment(root.importId, 'importId');
  const lessonId = assertPlanIdSegment(root.lessonId, 'lessonId');
  const publicLessonId = assertPlanIdSegment(root.publicLessonId, 'publicLessonId');
  const udaDir = assertPlanIdSegment(root.udaDir, 'udaDir');

  const requestId = root.requestId;
  if (!isUuidV4(requestId)) {
    throw new AiVisualMultiError('corrupted_state', 'requestId del piano non valido.');
  }
  const planHash = root.planHash;
  if (!isSha256Hex(planHash)) {
    throw new AiVisualMultiError('corrupted_state', 'planHash del piano non valido.');
  }

  const status = root.status;
  if (typeof status !== 'string' || !PLAN_STATUSES.includes(status as VisualPlanStatus)) {
    throw new AiVisualMultiError('corrupted_state', 'status del piano non valido.');
  }

  const quantity = validateVisualPlanQuantitySelection(root.quantity);

  const sourceBodyHash = root.sourceBodyHash;
  if (!isSha256Hex(sourceBodyHash)) {
    throw new AiVisualMultiError('corrupted_state', 'sourceBodyHash del piano non valido.');
  }

  const existingItemAssetIds = validateExistingItemAssetIds(root.existingItemAssetIds);
  if (existingItemAssetIds.length + quantity.ceiling > MAX_VISUALS_PER_LESSON) {
    invalidSlot(
      'existingItemAssetIds e quantity.ceiling superano insieme il tetto di tre immagini.',
    );
  }

  const budgetCeiling = validateVisualPlanBudgetCeiling(root.budgetCeiling, quantity.ceiling);

  if (!Array.isArray(root.slots)) invalidSlot('slots del piano non valido.');
  if (root.slots.length > quantity.ceiling) {
    invalidSlot('slots supera il tetto di quantità del piano.');
  }
  // Allineamento posizionale (blocker 4): `slots[i].slotIndex === i`, la
  // stessa assunzione che il runtime fa indicizzando `slots[slotIndex]`.
  // Implica di per sé unicità e range — non servono due controlli separati.
  const slots = root.slots.map((slot: unknown, index: number) => {
    const parsed = validateVisualPlanSlot(slot, budgetCeiling.maxAttemptsPerSlot);
    if (parsed.slotIndex !== index) {
      invalidSlot("slotIndex non corrisponde alla propria posizione nell'array slots.");
    }
    return parsed;
  });

  const opaquePlanId = computeOpaqueVisualPlanId(ownerUid, requestId);
  for (const slot of slots) {
    if (slot.staged === null) continue;
    const expectedStorageRef = `staging/${ownerUid}/${opaquePlanId}/${slot.slotIndex}.webp`;
    if (slot.staged.storageRef !== expectedStorageRef) {
      invalidSlot('Lo staging dello slot non appartiene a questo piano (owner/opaquePlanId).');
    }
  }

  assertVisualPlanStatusMatchesSlots(status as VisualPlanStatus, slots);

  const slotAttemptsByIndex = new Map(slots.map((slot) => [slot.slotIndex, slot.attempts]));
  const settlement = validateVisualPlanSettlement(root.settlement, {
    slotAttemptsByIndex,
    totalReserved: budgetCeiling.totalReserved,
  });

  const createdAt = assertTimestampLike(root.createdAt, 'createdAt');
  const updatedAt = assertTimestampLike(root.updatedAt, 'updatedAt');
  const expireAt = assertTimestampLike(root.expireAt, 'expireAt');
  assertVisualPlanTimestampOrder({ createdAt, updatedAt, expireAt });

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
