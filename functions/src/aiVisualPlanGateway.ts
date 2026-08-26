/**
 * MULTI-VISUAL-03A — autorizzazione, persistenza e proposta coordinata del
 * piano visivo multi-immagine (roadmap `multi-visual-roadmap.md` §8.1–§8.4,
 * §10.1, §10.3, §12.1). Nessuna UI, nessuna generazione per slot (§8.5),
 * nessuna promozione (§8.6), nessun upload-adoption, nessun riordino/
 * rimozione, nessun cleanup: quello resta MULTI-VISUAL-03B/03C.
 *
 * Riusa senza reimplementare:
 * - `requireOwner`/`readAuthoritativeLesson` (`aiVisualIdentity.ts`, VE) per
 *   identità/owner, mai una seconda rilettura autorevole;
 * - `readLegacyLessonVisuals` (`aiVisualMultiManifest.ts`, MULTI-VISUAL-01)
 *   per il controllo di co-presenza §6.1, fail-closed su
 *   `visual_legacy_conflict`/malformato;
 * - `validateVisualPlanRun`/`validateVisualPlanLease` per leggere record
 *   persistiti fail-closed (`corrupted_state` su qualunque divergenza);
 * - `createPorts`/`generateContent` (`aiContentGateway.ts`/`aiContentEngine.ts`,
 *   AIGEN) per la fase testuale `visual_plan_proposal` — stessa disciplina
 *   `aiContentRuns`+ledger già in vigore per lesson/pool/concept_map/
 *   visual_proposal, mai una seconda macchina a stati per la stessa cosa;
 * - `reserve` (`aiCorrectionBudget.ts`) per la prenotazione unica del tetto
 *   del piano, sullo stesso ledger mensile che `generateContent` riconcilia
 *   internamente al costo reale della proposta (nessuna riconciliazione
 *   duplicata in questo file).
 */

import { randomUUID } from 'node:crypto';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import type { Firestore, Transaction } from 'firebase-admin/firestore';
import * as logger from 'firebase-functions/logger';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import type { CallableRequest, FunctionsErrorCode } from 'firebase-functions/v2/https';
import {
  AiContentError,
  computeBudgetReservationKey,
  resolveAiContentMode,
  resolveContentModel,
  timestampToMillis,
  validateAiContentRequest,
  type AiContentMode,
  type VisualPlanProposalRequest,
} from './aiContentCore.js';
import { estimateContentCost } from './aiContentCost.js';
import {
  computeContentLeaseTtlMs,
  generateContent,
  maxAttemptsFromConfig,
  type AiContentContext,
} from './aiContentEngine.js';
import {
  createPorts,
  loadRuntimeConfig,
  retryPolicyFromConfig,
  OPENAI_API_KEY,
} from './aiContentGateway.js';
import {
  validateStoredVisualPlanProposalOutput,
  type VisualPlanProposalDecision,
} from './aiContentVisualPlanProposal.js';
import { MAX_VISUAL_SUBJECT_CHARS, VISUAL_STAGING_TTL_MS } from './aiContentVisualProposal.js';
import type { AiRuntimeConfig } from './aiCorrectionRuntimeConfig.js';
import {
  emptyLedger,
  monthKeyFromMs,
  reserve as reserveLedger,
  type BudgetLedgerState,
  type BudgetReservation,
} from './aiCorrectionBudget.js';
import {
  AiVisualError,
  estimateVisualCost,
  resolveAiVisualMode,
  sha256Hex,
  type AiVisualMode,
} from './aiVisualCore.js';
import { lessonPath, readAuthoritativeLesson, requireOwner } from './aiVisualIdentity.js';
import { readLegacyLessonVisuals } from './aiVisualMultiManifest.js';
import {
  AiVisualMultiError,
  MAX_VISUALS_PER_LESSON,
  VISUAL_PLAN_CONTRACT_VERSION,
  VISUAL_PLAN_MAX_ATTEMPTS_PER_SLOT,
  computeOpaqueVisualPlanId,
  computeVisualPlanHash,
} from './aiVisualMultiCore.js';
import {
  computeVisualPlanTotalReserved,
  validateVisualPlanAuthorizeInput,
  validateVisualPlanRun,
  type VisualPlanAuthorizeInput,
  type VisualPlanBudgetCeiling,
  type VisualPlanRun,
  type VisualPlanSlot,
} from './aiVisualMultiPlan.js';
import {
  computeVisualPlanLeaseId,
  validateVisualPlanLease,
  VISUAL_PLAN_LEASE_CONTRACT_VERSION,
  type VisualPlanLease,
} from './aiVisualPlanLease.js';
import { SCHOOLFORGE_FUNCTION_REGION } from './deploymentRegion.js';

const VISUAL_PLAN_CALLABLE_OPTIONS = {
  region: SCHOOLFORGE_FUNCTION_REGION,
  invoker: 'public' as const,
  secrets: [OPENAI_API_KEY],
};

function database(): Firestore {
  if (getApps().length === 0) initializeApp();
  return getFirestore();
}

// ─── Stima del tetto (roadmap §12.1) ───────────────────────────────────────────

/**
 * Soggetto sintetico usato **solo** per stimare il tetto di prenotazione
 * per-slot **prima** che la proposta coordinata scelga un soggetto reale
 * (roadmap §8.3 avviene dopo la prenotazione, §12.1). Un carattere astrale a
 * 4 byte UTF-8 ripetuto fino al limite di lunghezza (`MAX_VISUAL_SUBJECT_CHARS`,
 * `aiContentVisualProposal.ts`) è il caso peggiore genuino di
 * `estimateVisualCost` per un soggetto ammesso dal contratto — mai un valore
 * sotto-stimato (stessa disciplina "mai sotto contabilizzare" del resto del
 * cost model).
 */
const WORST_CASE_VISUAL_SUBJECT = '\u{1F600}'.repeat(MAX_VISUAL_SUBJECT_CHARS);

function computeGenerationCapMicroUsd(visualMode: AiVisualMode): number {
  return estimateVisualCost(WORST_CASE_VISUAL_SUBJECT, visualMode).reservationCostMicroUsd;
}

function contentModeFromEnv(): AiContentMode {
  return resolveAiContentMode({ AI_CONTENT_MODE: process.env.AI_CONTENT_MODE });
}

function visualModeFromEnv(): AiVisualMode {
  return resolveAiVisualMode({ AI_VISUAL_MODE: process.env.AI_VISUAL_MODE });
}

function readOpenAiSecret(): string | undefined {
  try {
    return OPENAI_API_KEY.value();
  } catch {
    return undefined;
  }
}

// ─── Costruzione della richiesta di proposta coordinata sintetica ─────────────

/**
 * Costruisce e valida (riusando `validateAiContentRequest`, nessuna seconda
 * definizione dei limiti di campo) la richiesta `visual_plan_proposal`
 * sintetica per QUESTO piano. `lessonBody` è **sempre** il valore
 * server-autorevole (mai il payload client, roadmap §8.3/`aiContentCore.ts`
 * §351-366) e `requestId` è **sempre** quello del piano — è ciò che fa
 * coincidere `computeBudgetReservationKey(ownerUid, requestId)` con
 * `budgetCeiling.reservationKey`, così la prenotazione che `generateContent`
 * tenta internamente riusa idempotentemente la prenotazione già fatta
 * dall'autorizzazione invece di aprirne una seconda (`aiCorrectionBudget.ts`
 * `reserve`: stesso `requestId` ⇒ nessun doppio addebito).
 */
function buildVisualPlanProposalRequest(params: {
  requestId: string;
  quantity: { mode: 'auto' | 'exact'; ceiling: 1 | 2 | 3 };
  lessonBody: string;
  titolo: unknown;
  sottotitolo: unknown;
  difficolta: unknown;
  concettiChiave: unknown;
  obiettivi: unknown;
  udaTitle: unknown;
  udaContext: unknown;
}): VisualPlanProposalRequest {
  const request = validateAiContentRequest({
    kind: 'visual_plan_proposal',
    requestId: params.requestId,
    modelProfile: 'quality',
    titolo: params.titolo,
    sottotitolo: params.sottotitolo,
    difficolta: params.difficolta,
    concettiChiave: params.concettiChiave,
    obiettivi: params.obiettivi,
    udaTitle: params.udaTitle,
    udaContext: params.udaContext,
    lessonBody: params.lessonBody,
    quantity: {
      mode: params.quantity.mode,
      requested: params.quantity.mode === 'exact' ? params.quantity.ceiling : null,
      ceiling: params.quantity.ceiling,
    },
  });
  // `validateAiContentRequest` restituisce l'unione `AiContentRequest`: il
  // solo `kind` passato sopra garantisce staticamente questo ramo.
  return request as VisualPlanProposalRequest;
}

// ─── Ledger (stesso adapter di aiContentGateway.ts, nessuna seconda copia) ────

function readLedgerState(
  snap: FirebaseFirestore.DocumentSnapshot,
  monthKey: string,
  budgetMicroUsd: number,
  dailyBudgetMicroUsd: number,
): BudgetLedgerState {
  if (!snap.exists) return emptyLedger(monthKey, budgetMicroUsd, dailyBudgetMicroUsd);
  const data = snap.data() as Record<string, unknown>;
  const spentMicroUsd = typeof data.spentMicroUsd === 'number' ? data.spentMicroUsd : 0;
  const dailySpentMicroUsd: Record<string, number> = {};
  if (data.dailySpentMicroUsd && typeof data.dailySpentMicroUsd === 'object') {
    for (const [dayKey, value] of Object.entries(data.dailySpentMicroUsd as Record<string, unknown>)) {
      if (typeof value === 'number' && Number.isInteger(value) && value >= 0) {
        dailySpentMicroUsd[dayKey] = value;
      }
    }
  }
  const reservations: Record<string, BudgetReservation> = {};
  const raw = data.reservations;
  if (raw && typeof raw === 'object') {
    for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
      const r = value as {
        microUsd?: unknown;
        expiresAtMs?: unknown;
        dayKey?: unknown;
        status?: unknown;
      };
      if (typeof r?.microUsd === 'number' && typeof r?.expiresAtMs === 'number') {
        reservations[id] = {
          microUsd: r.microUsd,
          expiresAtMs: r.expiresAtMs,
          ...(typeof r.dayKey === 'string' ? { dayKey: r.dayKey } : {}),
          status: r.status === 'pending' ? 'pending' : 'reserved',
        };
      }
    }
  }
  return { monthKey, budgetMicroUsd, dailyBudgetMicroUsd, spentMicroUsd, dailySpentMicroUsd, reservations };
}

function writeLedgerState(
  tx: Transaction,
  ref: FirebaseFirestore.DocumentReference,
  state: BudgetLedgerState,
): void {
  tx.set(ref, {
    monthKey: state.monthKey,
    budgetMicroUsd: state.budgetMicroUsd,
    dailyBudgetMicroUsd: state.dailyBudgetMicroUsd,
    spentMicroUsd: state.spentMicroUsd,
    dailySpentMicroUsd: state.dailySpentMicroUsd,
    reservations: state.reservations,
    updatedAt: Timestamp.now(),
  });
}

// ─── Autorizzazione (roadmap §8.3, §10.1, §10.3) ──────────────────────────────

type AuthorizeTxOutcome =
  | { kind: 'replay'; plan: VisualPlanRun }
  | { kind: 'created'; plan: VisualPlanRun }
  | { kind: 'corrupted_state' }
  | { kind: 'already_active'; opaquePlanId: string; requestId: string }
  | { kind: 'budget'; reason: 'budget_exceeded' | 'daily_budget_exceeded' };

/**
 * Autorizza (o riprende) il piano per il chiamante owner. Orchestrazione
 * completa di un'unica invocazione callable: identità → co-presenza legacy
 * (§6.1) → lease+prenotazione+creazione in una transazione (§10.3, §8.3) →
 * se il piano è ancora `authorized`, la proposta coordinata (§8.3 passo 3),
 * mai una seconda volta su un piano già `proposed`/terminale (§10.1).
 */
export async function authorizeVisualPlanForOwner(params: {
  db: Firestore;
  ownerUid: string;
  input: VisualPlanAuthorizeInput;
  nowMs: number;
  mode: AiContentMode;
  visualMode: AiVisualMode;
  secret: string | undefined;
}): Promise<VisualPlanRun> {
  const { db, ownerUid, input, nowMs, mode, visualMode, secret } = params;

  if (mode === 'disabled') {
    throw new AiContentError('feature_disabled', 'La generazione IA è disattivata.');
  }
  const config = await loadRuntimeConfig(db);
  if (!config || !config.enabled) {
    throw new AiContentError('feature_disabled', 'La generazione IA è disattivata.');
  }

  // ── Identità autorevole: mai dal payload (roadmap §5.5) ──────────────────
  const lesson = await readAuthoritativeLesson(db, {
    ownerUid,
    programId: input.programId,
    importId: input.importId,
    lessonId: input.lessonId,
  });

  // ── Co-presenza legacy (§6.1) — fail-closed, zero scritture ──────────────
  const rawLessonSnap = await db.doc(lessonPath(input.programId, input.importId, input.lessonId)).get();
  const rawLessonData = (rawLessonSnap.exists ? rawLessonSnap.data() : {}) as Record<string, unknown>;
  const legacy = readLegacyLessonVisuals({ visual: rawLessonData.visual, visuals: rawLessonData.visuals });
  if (
    legacy.status === 'visual_legacy_conflict' ||
    legacy.status === 'visuals_malformed' ||
    legacy.status === 'visual_legacy_malformed'
  ) {
    throw new AiVisualMultiError(legacy.status, 'Manifest visivo della lezione in stato incoerente.');
  }
  const existingItemAssetIds = legacy.status === 'ok' ? legacy.manifest.items.map((item) => item.assetId) : [];
  if (existingItemAssetIds.length + input.quantity.ceiling > MAX_VISUALS_PER_LESSON) {
    throw new AiVisualMultiError(
      'invalid_input',
      'La quantità richiesta supera gli slot liberi per questa lezione.',
    );
  }

  const sourceBodyHash = sha256Hex(lesson.body);
  const opaquePlanId = computeOpaqueVisualPlanId(ownerUid, input.requestId);
  const leaseId = computeVisualPlanLeaseId(ownerUid, input.lessonId);
  const reservationKey = computeBudgetReservationKey(ownerUid, input.requestId);
  const planHash = computeVisualPlanHash({
    ownerUid,
    programId: input.programId,
    importId: input.importId,
    lessonId: input.lessonId,
    publicLessonId: lesson.publicLessonId,
    sourceBodyHash,
    existingItemAssetIds,
    quantity: input.quantity,
  });

  // ── Tetto di prenotazione (§12.1) — proposalCap con la STESSA richiesta
  // che verrà davvero inviata al motore, generationCap sul caso peggiore ───
  const proposalRequest = buildVisualPlanProposalRequest({
    requestId: input.requestId,
    quantity: input.quantity,
    lessonBody: lesson.body,
    titolo: input.titolo,
    sottotitolo: input.sottotitolo,
    difficolta: input.difficolta,
    concettiChiave: input.concettiChiave,
    obiettivi: input.obiettivi,
    udaTitle: input.udaTitle,
    udaContext: input.udaContext,
  });
  const { model, priceListVersion } = resolveContentModel('quality');
  const proposalCap = estimateContentCost(
    proposalRequest,
    model,
    priceListVersion,
    maxAttemptsFromConfig(config),
  ).reservationCostMicroUsd;
  const generationCap = computeGenerationCapMicroUsd(visualMode);
  const totalReserved = computeVisualPlanTotalReserved({
    proposalCap,
    generationCap,
    ceiling: input.quantity.ceiling,
    maxAttemptsPerSlot: VISUAL_PLAN_MAX_ATTEMPTS_PER_SLOT,
  });
  const budgetCeiling: VisualPlanBudgetCeiling = {
    reservationKey,
    proposalCap,
    generationCap,
    maxAttemptsPerSlot: VISUAL_PLAN_MAX_ATTEMPTS_PER_SLOT,
    totalReserved,
  };

  const planRef = db.doc(`visualPlanRuns/${opaquePlanId}`);
  const leaseRef = db.doc(`visualPlanLeases/${leaseId}`);
  const monthKey = monthKeyFromMs(nowMs);
  const ledgerRef = db.doc(`aiBudgetLedger/${monthKey}`);
  const expireAt = Timestamp.fromMillis(nowMs + VISUAL_STAGING_TTL_MS);
  const nowTs = Timestamp.fromMillis(nowMs);

  const outcome = await db.runTransaction<AuthorizeTxOutcome>(async (tx) => {
    const [planSnap, leaseSnap] = await Promise.all([tx.get(planRef), tx.get(leaseRef)]);

    if (planSnap.exists) {
      let existingPlan: VisualPlanRun;
      try {
        existingPlan = validateVisualPlanRun(planSnap.data());
      } catch {
        return { kind: 'corrupted_state' };
      }
      const identityMatches =
        existingPlan.ownerUid === ownerUid &&
        existingPlan.programId === input.programId &&
        existingPlan.importId === input.importId &&
        existingPlan.lessonId === input.lessonId &&
        existingPlan.publicLessonId === lesson.publicLessonId &&
        existingPlan.requestId === input.requestId;
      if (!identityMatches) return { kind: 'corrupted_state' };
      // Replay legittimo (§10.1): nessuna rilettura del mondo oltre questa,
      // nessuna nuova prenotazione, nessuna nuova scrittura.
      return { kind: 'replay', plan: existingPlan };
    }

    let existingLease: VisualPlanLease | null = null;
    if (leaseSnap.exists) {
      try {
        existingLease = validateVisualPlanLease(leaseSnap.data());
      } catch {
        return { kind: 'corrupted_state' };
      }
      if (existingLease.opaquePlanId === opaquePlanId) {
        // Invariante violato: lease e piano sono scritti nella stessa
        // transazione (sotto), quindi un lease già nostro senza un piano
        // corrispondente non è uno stato raggiungibile dal flusso normale.
        return { kind: 'corrupted_state' };
      }
      const leaseExpiresMs = timestampToMillis(existingLease.expireAt);
      if (leaseExpiresMs === null) return { kind: 'corrupted_state' };
      if (leaseExpiresMs > nowMs) {
        return { kind: 'already_active', opaquePlanId: existingLease.opaquePlanId, requestId: existingLease.requestId };
      }
      // Scaduto: riacquisizione condizionata, stessa transazione (§10.3).
    }

    const ledgerSnap = await tx.get(ledgerRef);
    const ledgerState = readLedgerState(ledgerSnap, monthKey, config.monthlyBudgetMicroUsd, config.dailyBudgetMicroUsd);
    const reserved = reserveLedger(ledgerState, reservationKey, totalReserved, nowMs + VISUAL_STAGING_TTL_MS, nowMs);
    if (!reserved.ok) return { kind: 'budget', reason: reserved.reason };

    const newLease: VisualPlanLease = {
      contractVersion: VISUAL_PLAN_LEASE_CONTRACT_VERSION,
      ownerUid,
      programId: input.programId,
      importId: input.importId,
      lessonId: input.lessonId,
      opaquePlanId,
      requestId: input.requestId,
      createdAt: nowTs,
      updatedAt: nowTs,
      expireAt,
    };
    tx.set(leaseRef, newLease);

    const newPlan: VisualPlanRun = {
      contractVersion: VISUAL_PLAN_CONTRACT_VERSION,
      ownerUid,
      programId: input.programId,
      importId: input.importId,
      lessonId: input.lessonId,
      publicLessonId: lesson.publicLessonId,
      udaDir: lesson.udaDir,
      requestId: input.requestId,
      planHash,
      status: 'authorized',
      quantity: input.quantity,
      sourceBodyHash,
      existingItemAssetIds,
      budgetCeiling,
      slots: [],
      settlement: { proposalActualCost: null, slots: [] },
      createdAt: nowTs,
      updatedAt: nowTs,
      expireAt,
    };
    tx.set(planRef, newPlan);
    writeLedgerState(tx, ledgerRef, reserved.state);

    return { kind: 'created', plan: newPlan };
  });

  if (outcome.kind === 'corrupted_state') {
    throw new AiVisualMultiError('corrupted_state', 'Piano o lease del piano visivo in stato incoerente.');
  }
  if (outcome.kind === 'already_active') {
    throw new AiVisualMultiError(
      'visual_plan_already_active',
      'Un piano visivo è già attivo su questa lezione.',
      { opaquePlanId: outcome.opaquePlanId, requestId: outcome.requestId },
    );
  }
  if (outcome.kind === 'budget') {
    throw new AiContentError(outcome.reason, 'Budget insufficiente per autorizzare il piano.');
  }

  let plan = outcome.plan;

  if (plan.status === 'authorized') {
    // La proposta non è mai stata completata (piano appena creato, oppure
    // una risposta persa/crash fra la creazione e questo punto). Il corpo va
    // riletto per eseguirla davvero (non è mai stato persistito prima
    // d'ora) — ma un corpo diverso da quello congelato in `sourceBodyHash`
    // invalida la richiesta sintetica già costruita: fail-closed, mai una
    // proposta silenziosamente ricalcolata su un corpo diverso da quello
    // autorizzato.
    if (sourceBodyHash !== plan.sourceBodyHash) {
      throw new AiVisualMultiError(
        'visual_plan_proposal_body_changed',
        'Il corpo della lezione è cambiato dopo l\'autorizzazione del piano.',
      );
    }
    plan = await runCoordinatedProposal({
      db,
      plan,
      proposalRequest,
      config,
      mode,
      secret,
      nowMs,
    });
  }

  return plan;
}

/**
 * Fase 3 di §8.3: una sola chiamata `AiContentRequest{kind:
 * 'visual_plan_proposal'}`, tramite il motore generico esistente
 * (`generateContent`) — stessa disciplina `aiContentRuns`+ledger già in
 * vigore per lesson/pool/concept_map/visual_proposal (§12.1). La prenotazione
 * che questa chiamata tenta internamente (via `computeBudgetReservationKey`
 * sullo stesso `requestId` del piano) riusa idempotentemente quella già
 * fatta dall'autorizzazione; la riconciliazione al costo reale rilascia
 * l'eccedenza non usata **nella stessa scrittura** (roadmap §12.1: «incluso
 * nell'aggiornamento sopra — nessuna scrittura aggiuntiva»).
 */
async function runCoordinatedProposal(params: {
  db: Firestore;
  plan: VisualPlanRun;
  proposalRequest: VisualPlanProposalRequest;
  config: AiRuntimeConfig;
  mode: AiContentMode;
  secret: string | undefined;
  nowMs: number;
}): Promise<VisualPlanRun> {
  const { db, plan, proposalRequest, config, mode, secret, nowMs } = params;
  const ports = createPorts(db, config, mode, secret, true);
  const ctx: AiContentContext = {
    authenticatedOwnerUid: plan.ownerUid,
    nowMs,
    executionId: randomUUID(),
    mode,
    leaseMs: computeContentLeaseTtlMs(retryPolicyFromConfig(config)),
  };

  // Propaga fedelmente qualunque `AiContentError` (budget/provider/output):
  // il piano resta `authorized`, ritentabile a un replay successivo con lo
  // stesso `requestId` — nessun costo aggiuntivo, nessuna seconda proposta.
  const result = await generateContent(proposalRequest, ctx, ports);
  const decisions = validateStoredVisualPlanProposalOutput(result.output, plan.quantity.ceiling);

  const slots = decisions.map((decision, index) => buildSlotFromDecision(decision, index));
  const hasImageSlot = slots.some((slot) => slot.decision === 'image');
  const nextStatus: VisualPlanRun['status'] = hasImageSlot ? 'proposed' : 'abandoned';

  const updated: VisualPlanRun = {
    ...plan,
    status: nextStatus,
    slots,
    settlement: { proposalActualCost: result.actualCostMicroUsd, slots: [] },
    updatedAt: Timestamp.fromMillis(nowMs),
  };
  // Autoverifica prima di scrivere: qualunque incoerenza qui è un bug di
  // questo gateway, non un caso di business — deve fallire rumorosamente
  // prima di toccare Firestore, non dopo.
  validateVisualPlanRun(updated);

  const planRef = db.doc(`visualPlanRuns/${computeOpaqueVisualPlanId(plan.ownerUid, plan.requestId)}`);
  const leaseRef = db.doc(`visualPlanLeases/${computeVisualPlanLeaseId(plan.ownerUid, plan.lessonId)}`);
  await db.runTransaction(async (tx) => {
    tx.set(planRef, updated);
    if (nextStatus === 'abandoned') {
      // Stato terminale raggiunto senza intervento del docente (§8.7, §10.3):
      // rilascio immediato del lease, non atteso il TTL.
      tx.delete(leaseRef);
    } else {
      tx.set(
        leaseRef,
        {
          contractVersion: VISUAL_PLAN_LEASE_CONTRACT_VERSION,
          ownerUid: plan.ownerUid,
          programId: plan.programId,
          importId: plan.importId,
          lessonId: plan.lessonId,
          opaquePlanId: computeOpaqueVisualPlanId(plan.ownerUid, plan.requestId),
          requestId: plan.requestId,
          createdAt: plan.createdAt,
          updatedAt: Timestamp.fromMillis(nowMs),
          expireAt: Timestamp.fromMillis(nowMs + VISUAL_STAGING_TTL_MS),
        } satisfies VisualPlanLease,
        { merge: false },
      );
    }
  });

  return updated;
}

function buildSlotFromDecision(decision: VisualPlanProposalDecision, slotIndex: number): VisualPlanSlot {
  if (decision.decision === 'none') {
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
    };
  }
  return {
    slotIndex,
    state: 'pending',
    decision: 'image',
    subject: decision.subject,
    rationale: decision.rationale,
    anchor: decision.anchor,
    caption: decision.caption,
    altText: decision.altText,
    attempts: 0,
    lastError: null,
    staged: null,
    promotedAssetId: null,
  };
}

// ─── Callable ───────────────────────────────────────────────────────────────

const OWNER_ERROR_MAP: Partial<Record<AiVisualError['code'], FunctionsErrorCode>> = {
  unauthenticated: 'unauthenticated',
  not_owner: 'permission-denied',
  invalid_input: 'invalid-argument',
};

const MULTI_ERROR_MAP: Partial<Record<AiVisualMultiError['code'], FunctionsErrorCode>> = {
  invalid_input: 'invalid-argument',
  corrupted_state: 'data-loss',
  visuals_malformed: 'data-loss',
  visual_legacy_malformed: 'data-loss',
  visual_legacy_conflict: 'data-loss',
  provider_invalid_output: 'data-loss',
  visual_promotion_anchor_stale: 'failed-precondition',
  visual_plan_already_active: 'already-exists',
  visual_plan_proposal_body_changed: 'failed-precondition',
  visual_upload_too_large: 'resource-exhausted',
  visual_upload_unsupported_format: 'invalid-argument',
  visual_upload_conflict: 'invalid-argument',
};

const CONTENT_ERROR_MAP: Partial<Record<AiContentError['code'], FunctionsErrorCode>> = {
  unauthenticated: 'unauthenticated',
  not_owner: 'permission-denied',
  feature_disabled: 'failed-precondition',
  invalid_input: 'invalid-argument',
  content_too_large: 'invalid-argument',
  limit_exceeded: 'resource-exhausted',
  operation_budget_exceeded: 'resource-exhausted',
  budget_exceeded: 'resource-exhausted',
  daily_budget_exceeded: 'resource-exhausted',
  budget_unavailable: 'unavailable',
  running: 'aborted',
  run_conflict: 'invalid-argument',
  provider_config_invalid: 'failed-precondition',
  provider_unavailable: 'unavailable',
  provider_invalid_output: 'internal',
  output_incomplete: 'resource-exhausted',
  output_too_large: 'resource-exhausted',
  internal: 'internal',
};

function toHttpsError(error: AiVisualError | AiVisualMultiError | AiContentError): HttpsError {
  if (error instanceof AiVisualMultiError) {
    return new HttpsError(MULTI_ERROR_MAP[error.code] ?? 'internal', error.message, {
      code: error.code,
      ...(error.details ?? {}),
    });
  }
  if (error instanceof AiContentError) {
    return new HttpsError(CONTENT_ERROR_MAP[error.code] ?? 'internal', error.message, {
      code: error.code,
    });
  }
  return new HttpsError(OWNER_ERROR_MAP[error.code] ?? 'internal', error.message, { code: error.code });
}

async function handleAuthorizeVisualPlan(request: CallableRequest<unknown>): Promise<VisualPlanRun> {
  const db = database();
  try {
    const ownerUid = await requireOwner(request, db);
    const mode = contentModeFromEnv();
    if (mode === 'disabled') {
      throw new AiContentError('feature_disabled', 'La generazione IA è disattivata.');
    }
    const input = validateVisualPlanAuthorizeInput(request.data);
    const visualMode = visualModeFromEnv();
    const secret = mode === 'openai' ? readOpenAiSecret() : undefined;
    return await authorizeVisualPlanForOwner({
      db,
      ownerUid,
      input,
      nowMs: Date.now(),
      mode,
      visualMode,
      secret,
    });
  } catch (error) {
    if (
      error instanceof AiVisualMultiError ||
      error instanceof AiVisualError ||
      error instanceof AiContentError
    ) {
      throw toHttpsError(error);
    }
    logger.error('aiVisualPlanAuthorize internal error', { name: (error as Error)?.name });
    throw new HttpsError('internal', 'Errore interno del piano visivo.');
  }
}

/** MULTI-VISUAL-03A — autorizza (o riprende) il piano coordinato multi-immagine. */
export const aiVisualPlanAuthorize = onCall(VISUAL_PLAN_CALLABLE_OPTIONS, handleAuthorizeVisualPlan);
