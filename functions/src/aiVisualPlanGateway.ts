/**
 * MULTI-VISUAL-03A — autorizzazione, persistenza e proposta coordinata del
 * piano visivo multi-immagine (roadmap `multi-visual-roadmap.md` §8.1–§8.4,
 * §10.1, §10.3, §12.1). Nessuna UI, nessuna generazione per slot (§8.5),
 * nessuna promozione (§8.6), nessun upload-adoption, nessun riordino/
 * rimozione, nessun cleanup: quello resta MULTI-VISUAL-03B/03C.
 *
 * **Review fix (Codex, round 2).** Riscrittura strutturale rispetto al primo
 * WIP, sui blocker:
 * - P0 budget: porte `AiContentPorts` **plan-aware** (`createVisualPlanProposalPorts`)
 *   al posto delle porte generiche di `aiContentGateway.ts` — una sola
 *   prenotazione master, mai due, con la quota per la generazione futura
 *   **preservata** (ricalcolata dalle decisioni, non azzerata) alla
 *   riconciliazione;
 * - P0 lease: transazione di preparazione (`authorized`/`proposing` →
 *   `proposing`, lease rinnovato) **prima** della chiamata al motore, e
 *   riverifica dell'ownership (piano+lease riletti, orologio fresco) **dopo**
 *   — un tentativo che perde la corsa sul lease non sovrascrive mai il
 *   vincitore;
 * - P1 replay: percorso rapido che legge **solo** il piano per `opaquePlanId`
 *   prima di qualunque altro I/O — un piano già risolto torna così com'è
 *   senza toccare config/LessonDoc/lease/budget;
 * - P1 atomicità: lettura e parsing autorevole di `LessonDoc` dentro la
 *   stessa transazione di creazione, con adozione singolare atomica quando
 *   la lezione ha ancora `visual` (singolare) e non `visuals`;
 * - P1 coerenza: `planHash`/`reservationKey`/lease `opaquePlanId` ricalcolati
 *   e verificati alla lettura (`aiVisualMultiPlan.ts`, `aiVisualPlanLease.ts`);
 * - P2: `existingItemAssetIds` non più ordinato prima dell'hash.
 *
 * Riusa senza reimplementare:
 * - `requireOwner` (`aiVisualIdentity.ts`, VE) per l'owner;
 * - `checkLessonForVisual`/`checkProjectionForVisual`/`describeVisualBindingFailure`
 *   (`aiVisualLessonBinding.ts`, VE) — funzioni **pure**, chiamate qui
 *   direttamente sulle snapshot lette dentro le transazioni di questo
 *   gateway, per poter fare la lettura autorevole **dentro** la transazione
 *   (blocker P1) senza duplicare `readAuthoritativeLesson`;
 * - `readLegacyLessonVisuals`/`adaptSingular` (`aiVisualMultiManifest.ts`,
 *   MULTI-VISUAL-01) per il controllo di co-presenza §6.1 e l'adozione;
 * - `validateVisualPlanRun`/`validateVisualPlanLease` per leggere record
 *   persistiti fail-closed;
 * - `generateContent` (`aiContentEngine.ts`, AIGEN) per la fase testuale
 *   `visual_plan_proposal` — stessa macchina a stati di lesson/pool/
 *   concept_map/visual_proposal, con porte **plan-aware** iniettate;
 * - `reserve`/`reconcile`/`markPending` (`aiCorrectionBudget.ts`) per la
 *   prenotazione/riconciliazione del tetto del piano.
 */

import { randomUUID } from 'node:crypto';
import { getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore';
import type { Firestore, Transaction } from 'firebase-admin/firestore';
import * as logger from 'firebase-functions/logger';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import type { CallableRequest, FunctionsErrorCode } from 'firebase-functions/v2/https';
import {
  AiContentError,
  computeBudgetReservationKey,
  computeOpaqueRunId,
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
  type AiContentPorts,
  type ReserveOutcome,
} from './aiContentEngine.js';
import { loadRuntimeConfig, retryPolicyFromConfig, OPENAI_API_KEY } from './aiContentGateway.js';
import type { MarkPendingCheck } from './aiContentPending.js';
import { selectContentProvider } from './aiContentProvider.js';
import { parseStoredRunDocument, serializeRun } from './aiContentRunDoc.js';
import {
  validateStoredVisualPlanProposalOutput,
  type VisualPlanProposalDecision,
} from './aiContentVisualPlanProposal.js';
import { MAX_VISUAL_SUBJECT_CHARS, VISUAL_STAGING_TTL_MS } from './aiContentVisualProposal.js';
import type { AiRuntimeConfig } from './aiCorrectionRuntimeConfig.js';
import {
  emptyLedger,
  monthKeyFromMs,
  markPending as markPendingLedger,
  reconcile as reconcileLedger,
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
import { lessonPath, requireOwner } from './aiVisualIdentity.js';
import {
  checkLessonForVisual,
  checkProjectionForVisual,
  describeVisualBindingFailure,
} from './aiVisualLessonBinding.js';
import { projectLessonVisualsManifest, readLegacyLessonVisuals } from './aiVisualMultiManifest.js';
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
 * per-slot **prima** che la proposta coordinata scelga un soggetto reale.
 * Un carattere astrale a 4 byte UTF-8 ripetuto fino al limite di lunghezza
 * (`MAX_VISUAL_SUBJECT_CHARS`) è il caso peggiore genuino di
 * `estimateVisualCost` per un soggetto ammesso dal contratto — mai un valore
 * sotto-stimato.
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
 * server-autorevole (mai il payload client) e `requestId` è **sempre** quello
 * del piano — è ciò che fa coincidere `computeBudgetReservationKey(ownerUid,
 * requestId)` con `budgetCeiling.reservationKey`.
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
  return request as VisualPlanProposalRequest;
}

// ─── Ledger — adapter locale (stesso schema di aiContentGateway.ts) ───────────

export function readVisualPlanLedgerState(
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
    for (const [dayKey, value] of Object.entries(
      data.dailySpentMicroUsd as Record<string, unknown>,
    )) {
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
  return {
    monthKey,
    budgetMicroUsd,
    dailyBudgetMicroUsd,
    spentMicroUsd,
    dailySpentMicroUsd,
    reservations,
  };
}

export function writeVisualPlanLedgerState(
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

/**
 * Chiude la prenotazione master di un piano che non può più proseguire.
 *
 * Se la reservation è ancora `pending`, il provider della **sola proposta**
 * può essere stato invocato: si liquida quindi al relativo cap, mai al
 * `totalReserved` che comprende generazioni per-slot mai partite. Per evitare
 * che il settlement generico trasformi prima una pending appena scaduta
 * nell'intero tetto, la riconciliazione avviene all'ultimo istante in cui la
 * reservation risultava attiva. Una reservation `reserved` viene invece
 * rilasciata a costo zero.
 */
function closeVisualPlanReservation(
  state: BudgetLedgerState,
  plan: VisualPlanRun,
  nowMs: number,
): BudgetLedgerState {
  const reservationKey = plan.budgetCeiling.reservationKey;
  const reservation = state.reservations[reservationKey];
  if (!reservation) return state;
  const pending = reservation.status === 'pending';
  const reconciliationNowMs = pending
    ? Math.min(nowMs, Math.max(0, reservation.expiresAtMs - 1))
    : nowMs;
  return reconcileLedger(
    state,
    reservationKey,
    pending ? plan.budgetCeiling.proposalCap : 0,
    reconciliationNowMs,
  );
}

async function releaseVisualPlanReservationAfterLostOwnership(params: {
  db: Firestore;
  plan: VisualPlanRun;
  config: AiRuntimeConfig;
  nowMs: number;
}): Promise<void> {
  const { db, plan, config, nowMs } = params;
  const ledgerRef = db.doc(`aiBudgetLedger/${plan.budgetCeiling.reservationMonthKey}`);
  await db.runTransaction(async (tx) => {
    const ledgerSnap = await tx.get(ledgerRef);
    const state = readVisualPlanLedgerState(
      ledgerSnap,
      plan.budgetCeiling.reservationMonthKey,
      config.monthlyBudgetMicroUsd,
      config.dailyBudgetMicroUsd,
    );
    if (!state.reservations[plan.budgetCeiling.reservationKey]) return;
    writeVisualPlanLedgerState(tx, ledgerRef, closeVisualPlanReservation(state, plan, nowMs));
  });
}

// ─── Porte plan-aware (roadmap §12.1 — review fix Codex, blocker P0-1/P0-7) ───

/**
 * Numero di slot "image" dichiarati da un `output` di proposta coordinata già
 * validato — o il caso peggiore (`ceiling`) se `output` non è ancora
 * decodificabile (mai sotto-riservare).
 */
function countImageSlotsFromOutput(output: unknown, ceiling: 1 | 2 | 3): number {
  try {
    return validateStoredVisualPlanProposalOutput(output, ceiling).filter(
      (d) => d.decision === 'image',
    ).length;
  } catch {
    return ceiling;
  }
}

/**
 * Guardia plan-aware per la transizione `reserved → pending` (roadmap §12.1
 * — review fix Codex, blocker P0-1).
 *
 * `canMarkProviderPending` generico (`aiContentPending.ts`) confronta
 * `reservation.microUsd` con `run.reservedCostMicroUsd` per **uguaglianza**:
 * corretto quando la prenotazione copre **solo** il costo di quella singola
 * richiesta — non quando, come qui, la prenotazione master copre l'intero
 * `budgetCeiling.totalReserved` del piano (proposta **e** generazione futura
 * degli slot immagine, roadmap §12.1), sempre **maggiore o uguale** al costo
 * della sola proposta non appena `generationCap > 0`. Un confronto per
 * uguaglianza rifiuta quindi **ogni** piano con costi visuali non nulli — il
 * provider non viene mai invocato. Stessa disciplina fail-closed del
 * generico, un solo confronto sostituito: la prenotazione master dev'essere
 * **sufficiente** (`>=`), non identica.
 */
function canMarkVisualPlanProviderPending(check: MarkPendingCheck): boolean {
  const { run, reservation, executionId, nowMs } = check;
  if (!run) return false;
  if (run.status !== 'running') return false;
  if (run.leaseExecutionId !== executionId) return false;
  if (run.leaseExpiresAtMs <= nowMs) return false;
  if (!reservation) return false;
  const status = reservation.status ?? 'reserved';
  if (status !== 'reserved') return false;
  if (reservation.expiresAtMs <= nowMs) return false;
  if (reservation.microUsd < run.reservedCostMicroUsd) return false;
  return true;
}

/**
 * Porte `AiContentPorts` **plan-aware**: al posto delle porte generiche di
 * `aiContentGateway.ts`, che alla `finalizeRun`/`failRun` rilasciano
 * **l'intera** prenotazione al solo costo della singola operazione
 * (`reconcile`, `aiCorrectionBudget.ts`) — corretto per un `AiContentRequest`
 * a sé stante, ma qui cancellerebbe la quota riservata per la generazione
 * futura degli slot immagine (blocker P0-1, review Codex).
 *
 * - `reserveRunAndBudget`/`markProviderPending`: **non** creano una seconda
 *   prenotazione — verificano che la prenotazione master (piazzata alla
 *   creazione del piano, stessa `reservationKey`) esista ancora ed è
 *   `reserved`/`pending`; l'unica scrittura è il documento run
 *   `aiContentRuns/{opaqueRunId}` stesso.
 * - `finalizeRun`/`failRun`: riconciliano la prenotazione master al costo
 *   **reale** della sola proposta (`reconcile`) e **ri-prenotano nella
 *   stessa transazione** la quota residua per gli slot immagine ancora da
 *   generare (`generationCap × slot immagine × maxAttemptsPerSlot`, o —su
 *   fallimento— l'intero residuo `totalReserved - settledMicroUsd`, mai
 *   sotto-stimato) — «rilascio della quota non usata... nessuna scrittura
 *   aggiuntiva» (roadmap §12.1) è esattamente questa composizione in
 *   un'unica scrittura del ledger.
 * - Ogni operazione sul ledger usa `budgetCeiling.reservationMonthKey`,
 *   **congelato alla creazione del piano** — mai `monthKeyFromMs(nowMs)`
 *   ricalcolato al momento della chiamata (blocker P2/7: un piano con TTL
 *   24h può attraversare un cambio di mese UTC).
 */
function createVisualPlanProposalPorts(params: {
  db: Firestore;
  config: AiRuntimeConfig;
  mode: AiContentMode;
  secret: string | undefined;
  plan: VisualPlanRun;
}): AiContentPorts {
  const { db, config, mode, secret, plan } = params;
  const reservationKey = plan.budgetCeiling.reservationKey;
  const ledgerRef = db.doc(`aiBudgetLedger/${plan.budgetCeiling.reservationMonthKey}`);
  const opaquePlanId = computeOpaqueVisualPlanId(plan.ownerUid, plan.requestId);
  const planRef = db.doc(`visualPlanRuns/${opaquePlanId}`);
  const planLeaseRef = db.doc(
    `visualPlanLeases/${computeVisualPlanLeaseId(plan.ownerUid, plan.lessonId)}`,
  );
  const planExpireAtMs = timestampToMillis(plan.expireAt);
  // Validato a monte da `validateVisualPlanRun`: sempre risolvibile.
  const reservationExpiresAtMs = planExpireAtMs ?? Date.now() + VISUAL_STAGING_TTL_MS;
  const provider = selectContentProvider({
    mode,
    withProvider: true,
    openAiApiKey: secret,
    runnerDeps: { policy: retryPolicyFromConfig(config) },
  });

  function loadLedgerState(snap: FirebaseFirestore.DocumentSnapshot): BudgetLedgerState {
    return readVisualPlanLedgerState(
      snap,
      plan.budgetCeiling.reservationMonthKey,
      config.monthlyBudgetMicroUsd,
      config.dailyBudgetMicroUsd,
    );
  }

  /** Riconcilia al costo reale e ri-prenota la quota residua, in un'unica scrittura. */
  function reconcileAndPreserveRemaining(
    state: BudgetLedgerState,
    settledMicroUsd: number,
    remainingMicroUsd: number,
    nowMs: number,
  ): BudgetLedgerState {
    const reconciled = reconcileLedger(state, reservationKey, settledMicroUsd, nowMs);
    if (remainingMicroUsd <= 0) return reconciled;
    const reReserved = reserveLedger(
      reconciled,
      reservationKey,
      remainingMicroUsd,
      reservationExpiresAtMs,
      nowMs,
    );
    // `reserve` fallisce solo per budget insufficiente: la quota residua è
    // per costruzione ≤ quella già coperta dal tetto autorizzato del piano,
    // quindi qui non deve mai accadere — ma un fallimento non deve mai far
    // perdere la riconciliazione già effettuata (mai sotto-contabilizzare).
    return reReserved.ok ? reReserved.state : reconciled;
  }

  return {
    async loadRuntimeConfig() {
      return config;
    },
    async readAvailableBudgetMicroUsd() {
      const snap = await ledgerRef.get();
      const state = loadLedgerState(snap);
      return Math.max(
        0,
        state.budgetMicroUsd -
          state.spentMicroUsd -
          Object.values(state.reservations).reduce((sum, r) => sum + r.microUsd, 0),
      );
    },
    async loadRun(opaqueRunId) {
      const snap = await db.doc(`aiContentRuns/${opaqueRunId}`).get();
      return snap.exists ? parseStoredRunDocument(snap.data()) : null;
    },
    async reserveRunAndBudget(reqParams): Promise<ReserveOutcome> {
      const runRef = db.doc(`aiContentRuns/${reqParams.opaqueRunId}`);
      return db.runTransaction(async (tx): Promise<ReserveOutcome> => {
        const [runSnap, ledgerSnap] = await Promise.all([tx.get(runRef), tx.get(ledgerRef)]);
        if (runSnap.exists) {
          const existing = parseStoredRunDocument(runSnap.data());
          if (!existing) return { kind: 'conflict' };
          if (existing.inputHash !== reqParams.inputHash) return { kind: 'conflict' };
          if (existing.status === 'completed') return { kind: 'replay_completed', run: existing };
          // Un fallimento già fatturato (o a costo ignoto, liquidato al cap)
          // ha consumato l'unica quota di proposta autorizzata. Non può fare
          // takeover usando la riserva destinata agli slot immagine.
          if (existing.status === 'failed' && (existing.settledCostMicroUsd ?? 0) > 0) {
            return { kind: 'budget', code: 'budget_unavailable' };
          }
          if (existing.status === 'running' && existing.leaseExpiresAtMs > reqParams.nowMs) {
            return { kind: 'running' };
          }
          // failed o lease scaduta → takeover consentito (stessa disciplina generica).
        }
        const state = loadLedgerState(ledgerSnap);
        const master = state.reservations[reservationKey];
        // La prenotazione master è già stata piazzata dalla transazione di
        // creazione del piano (o preservata dal finalize precedente): questa
        // porta non ne crea mai una seconda. Assente/non "reserved" ⇒ stato
        // del ledger incoerente col piano — fail-closed, mai una nuova
        // prenotazione silenziosa.
        if (!master || (master.status ?? 'reserved') !== 'reserved') {
          return { kind: 'budget', code: 'budget_unavailable' };
        }
        tx.set(runRef, serializeRun(reqParams.run));
        return { kind: 'reserved', reservedMicroUsd: master.microUsd };
      });
    },
    async markProviderPending(reqParams) {
      const runRef = db.doc(`aiContentRuns/${reqParams.opaqueRunId}`);
      return db.runTransaction(async (tx) => {
        const [runSnap, ledgerSnap] = await Promise.all([tx.get(runRef), tx.get(ledgerRef)]);
        if (!runSnap.exists) return false;
        const run = parseStoredRunDocument(runSnap.data());
        const state = loadLedgerState(ledgerSnap);
        if (
          !canMarkVisualPlanProviderPending({
            run,
            reservation: state.reservations[reservationKey],
            executionId: reqParams.executionId,
            nowMs: reqParams.nowMs,
          })
        ) {
          return false;
        }
        writeVisualPlanLedgerState(
          tx,
          ledgerRef,
          markPendingLedger(state, reservationKey, reqParams.nowMs),
        );
        return true;
      });
    },
    async callProvider({ request, model }) {
      if (!provider) {
        throw new AiContentError('feature_disabled', 'La generazione IA è disattivata.');
      }
      return provider.generate(request, model);
    },
    async finalizeRun(reqParams) {
      const runRef = db.doc(`aiContentRuns/${reqParams.opaqueRunId}`);
      return db.runTransaction(async (tx): Promise<'finalized' | 'lost_lease'> => {
        const [runSnap, ledgerSnap] = await Promise.all([tx.get(runRef), tx.get(ledgerRef)]);
        if (!runSnap.exists) return 'lost_lease';
        const run = parseStoredRunDocument(runSnap.data());
        if (!run || run.leaseExecutionId !== reqParams.executionId) return 'lost_lease';
        const state = loadLedgerState(ledgerSnap);
        const imageSlotCount = countImageSlotsFromOutput(reqParams.output, plan.quantity.ceiling);
        const remainingMicroUsd =
          plan.budgetCeiling.generationCap * imageSlotCount * plan.budgetCeiling.maxAttemptsPerSlot;
        writeVisualPlanLedgerState(
          tx,
          ledgerRef,
          reconcileAndPreserveRemaining(
            state,
            reqParams.settledMicroUsd,
            remainingMicroUsd,
            reqParams.nowMs,
          ),
        );
        tx.set(
          runRef,
          {
            status: 'completed',
            output: reqParams.output,
            actualInputTokens: reqParams.actualInputTokens,
            actualOutputTokens: reqParams.actualOutputTokens,
            actualCostMicroUsd: reqParams.actualCostMicroUsd,
            settledCostMicroUsd: reqParams.settledMicroUsd,
            updatedAt: Timestamp.fromMillis(reqParams.nowMs),
          },
          { merge: true },
        );
        return 'finalized';
      });
    },
    async failRun(reqParams) {
      const runRef = db.doc(`aiContentRuns/${reqParams.opaqueRunId}`);
      await db.runTransaction(async (tx) => {
        const [runSnap, ledgerSnap, planSnap, leaseSnap] = await Promise.all([
          tx.get(runRef),
          tx.get(ledgerRef),
          tx.get(planRef),
          tx.get(planLeaseRef),
        ]);
        if (!runSnap.exists) return;
        const run = parseStoredRunDocument(runSnap.data());
        if (!run || run.leaseExecutionId !== reqParams.executionId) return;
        const state = loadLedgerState(ledgerSnap);
        const billableFailure = reqParams.settledMicroUsd > 0;
        if (billableFailure) {
          // La proposta è stata fatturata o il suo costo è ignoto: chiusura
          // terminale e rilascio dell'intero residuo. Una nuova proposta
          // richiederà un nuovo piano/autorizzazione, mai la quota generation.
          writeVisualPlanLedgerState(
            tx,
            ledgerRef,
            reconcileLedger(state, reservationKey, reqParams.settledMicroUsd, reqParams.nowMs),
          );
        } else {
          // Errore certamente pre-invocazione: nessuna nuova spesa. La quota
          // master resta interamente disponibile per un retry dello stesso run.
          writeVisualPlanLedgerState(
            tx,
            ledgerRef,
            reconcileAndPreserveRemaining(
              state,
              0,
              plan.budgetCeiling.totalReserved,
              reqParams.nowMs,
            ),
          );
        }
        tx.set(
          runRef,
          {
            status: 'failed',
            actualInputTokens: reqParams.actualInputTokens,
            actualOutputTokens: reqParams.actualOutputTokens,
            actualCostMicroUsd: reqParams.actualCostMicroUsd,
            settledCostMicroUsd: reqParams.settledMicroUsd,
            updatedAt: Timestamp.fromMillis(reqParams.nowMs),
          },
          { merge: true },
        );

        if (billableFailure && planSnap.exists && leaseSnap.exists) {
          try {
            const currentPlan = validateVisualPlanRun(planSnap.data());
            const currentLease = validateVisualPlanLease(leaseSnap.data());
            if (
              currentPlan.status === 'proposing' &&
              leaseMatchesPlan(currentLease, currentPlan, opaquePlanId)
            ) {
              const expireMs = timestampToMillis(currentPlan.expireAt);
              if (expireMs === null) return;
              const abandoned: VisualPlanRun = {
                ...currentPlan,
                status: 'abandoned',
                settlement: {
                  proposalActualCost: reqParams.actualCostMicroUsd,
                  slots: [],
                },
                updatedAt: Timestamp.fromMillis(Math.min(reqParams.nowMs, expireMs)),
              };
              validateVisualPlanRun(abandoned);
              tx.set(planRef, abandoned);
              tx.delete(planLeaseRef);
            }
          } catch {
            // Il run/ledger devono comunque essere liquidati in modo
            // conservativo. Un piano/lease corrotto non viene mai riscritto.
          }
        }
      });
    },
  };
}

// ─── Lettura autorevole di LessonDoc, dentro una transazione (blocker P1-4) ───

interface AuthoritativeLessonInTx {
  publicLessonId: string;
  udaDir: string;
  body: string;
  /** roadmap §6.2 passo 5: l'adozione tocca `publicLessons` solo se svolta. */
  completed: boolean;
  lessonData: Record<string, unknown>;
  /** Snapshot pubblico già letto in questa transazione — mai una seconda lettura. */
  publicData: Record<string, unknown> | null;
}

/**
 * Equivalente transazionale di `readAuthoritativeLesson` (`aiVisualIdentity.ts`),
 * costruito qui direttamente sulle funzioni **pure** di
 * `aiVisualLessonBinding.ts` (`checkLessonForVisual`/`checkProjectionForVisual`)
 * invece di duplicare/estendere quel modulo condiviso da VE. Tutte le letture
 * passano da `tx.get`, cosicché la creazione del piano possa leggere
 * `LessonDoc` **nella stessa transazione** in cui scrive (roadmap, blocker
 * P1-4) invece che in un preflight fuori transazione soggetto a corsa.
 */
async function readAuthoritativeLessonInTx(
  tx: Transaction,
  db: Firestore,
  params: { ownerUid: string; programId: string; importId: string; lessonId: string },
): Promise<AuthoritativeLessonInTx> {
  const { ownerUid, programId, importId, lessonId } = params;
  const lessonRef = db.doc(lessonPath(programId, importId, lessonId));
  const lessonSnap = await tx.get(lessonRef);
  const lessonData = lessonSnap.exists ? (lessonSnap.data() as Record<string, unknown>) : null;
  const gate = checkLessonForVisual({ lesson: lessonData, lessonId, ownerUid, importId });
  if (!gate.ok) {
    throw new AiVisualError('invalid_input', describeVisualBindingFailure(gate.failure));
  }
  const publicRef = db.doc(`publicLessons/${gate.publicLessonId}`);
  const publicSnap = await tx.get(publicRef);
  const publicData = publicSnap.exists ? (publicSnap.data() as Record<string, unknown>) : null;
  const projectionGate = checkProjectionForVisual({
    lesson: lessonData as Record<string, unknown>,
    publicLesson: publicData,
    programId,
    importId,
    ownerUid,
  });
  if (!projectionGate.ok) {
    throw new AiVisualError('invalid_input', describeVisualBindingFailure(projectionGate.failure));
  }
  return {
    publicLessonId: gate.publicLessonId,
    udaDir: gate.udaDir,
    body: projectionGate.body,
    completed: projectionGate.completed,
    lessonData: lessonData as Record<string, unknown>,
    publicData,
  };
}

// ─── Identità (roadmap §10.1) ──────────────────────────────────────────────────

function identityMatchesInput(
  plan: VisualPlanRun,
  ownerUid: string,
  input: VisualPlanAuthorizeInput,
): boolean {
  return (
    plan.ownerUid === ownerUid &&
    plan.programId === input.programId &&
    plan.importId === input.importId &&
    plan.lessonId === input.lessonId &&
    plan.requestId === input.requestId &&
    plan.replacementAssetId === input.replacementAssetId
  );
}

function isUnsettled(status: VisualPlanRun['status']): boolean {
  return status === 'authorized' || status === 'proposing';
}

function leaseMatchesPlan(
  lease: VisualPlanLease,
  plan: VisualPlanRun,
  opaquePlanId: string,
): boolean {
  return (
    lease.ownerUid === plan.ownerUid &&
    lease.programId === plan.programId &&
    lease.importId === plan.importId &&
    lease.lessonId === plan.lessonId &&
    lease.requestId === plan.requestId &&
    lease.opaquePlanId === opaquePlanId
  );
}

// ─── Autorizzazione — orchestrazione (roadmap §8.3, §10.1, §10.3) ─────────────

/**
 * Autorizza (o riprende) il piano per il chiamante owner.
 *
 * **Review fix (Codex, blocker P1-3).** Il percorso di replay è ora la prima
 * cosa che accade dopo la validazione del payload: legge **solo**
 * `visualPlanRuns/{opaquePlanId}` e, se il record è valido, l'identità
 * coincide con l'input e lo stato non è più `authorized`/`proposing`, lo
 * restituisce **immediatamente** — nessuna lettura di config, `LessonDoc`,
 * lease o budget.
 */
export async function authorizeVisualPlanForOwner(params: {
  db: Firestore;
  ownerUid: string;
  input: VisualPlanAuthorizeInput;
  mode: AiContentMode;
  visualMode: AiVisualMode;
  secret: string | undefined;
  /** Iniettabile nei test per rendere deterministica la corsa sul lease (blocker P0-2). */
  clock?: () => number;
  /** Solo test: provider finto, mai rete reale. */
  callProviderOverride?: AiContentPorts['callProvider'];
  /** Solo test: rende osservabile che il replay non carica la configurazione. */
  loadConfigOverride?: typeof loadRuntimeConfig;
  /** Solo test: barriera dopo le letture autorevoli, prima delle scritture. */
  afterAuthoritativeRead?: () => Promise<void>;
}): Promise<VisualPlanRun> {
  const { db, ownerUid, input, mode, visualMode, secret } = params;
  const clock = params.clock ?? Date.now;

  const opaquePlanId = computeOpaqueVisualPlanId(ownerUid, input.requestId);
  const planRef = db.doc(`visualPlanRuns/${opaquePlanId}`);

  const fastSnap = await planRef.get();
  let plan: VisualPlanRun | null = null;
  if (fastSnap.exists) {
    let existing: VisualPlanRun;
    try {
      existing = validateVisualPlanRun(fastSnap.data());
    } catch {
      throw new AiVisualMultiError('corrupted_state', 'Piano visivo in stato incoerente.');
    }
    if (!identityMatchesInput(existing, ownerUid, input)) {
      throw new AiVisualMultiError(
        'corrupted_state',
        "L'identità persistita del piano non corrisponde alla richiesta corrente.",
      );
    }
    if (!isUnsettled(existing.status)) {
      // Un fallimento fatturabile della proposta chiude il piano come
      // `abandoned` per liberare lease e budget. Senza questo controllo, il
      // replay di quel record sarebbe indistinguibile da una decisione valida
      // "nessuna immagine" e la UI mentirebbe. La lettura aggiuntiva avviene
      // soltanto per l'ambiguo `abandoned` senza slot, prima di config, lezione,
      // lease o provider.
      if (existing.status === 'abandoned' && existing.slots.length === 0) {
        const proposalRunSnap = await db
          .doc(`aiContentRuns/${computeOpaqueRunId(ownerUid, input.requestId)}`)
          .get();
        if (proposalRunSnap.exists) {
          const proposalRun = parseStoredRunDocument(proposalRunSnap.data());
          if (!proposalRun || proposalRun.kind !== 'visual_plan_proposal') {
            throw new AiVisualMultiError(
              'corrupted_state',
              'Run della proposta visiva in stato incoerente.',
            );
          }
          if (proposalRun.status === 'failed') {
            throw new AiContentError(
              'provider_unavailable',
              'La proposta visiva precedente non è stata completata.',
            );
          }
        }
      }
      // Percorso rapido: il piano è già risolto, restituito byte-per-byte.
      return existing;
    }
    plan = existing;
  }

  if (mode === 'disabled') {
    throw new AiContentError('feature_disabled', 'La generazione IA è disattivata.');
  }

  const config = await (params.loadConfigOverride ?? loadRuntimeConfig)(db);
  if (!config || !config.enabled) {
    throw new AiContentError('feature_disabled', 'La generazione IA è disattivata.');
  }

  if (!plan) {
    plan = await createVisualPlanForOwner({
      db,
      ownerUid,
      input,
      opaquePlanId,
      config,
      visualMode,
      nowMs: clock(),
      afterAuthoritativeRead: params.afterAuthoritativeRead,
    });
    if (!isUnsettled(plan.status)) {
      // Corsa fra il percorso rapido (sopra) e questa transazione: un altro
      // tentativo ha già completato l'intero ciclo. Nessun ulteriore I/O.
      return plan;
    }
  }

  return resumeCoordinatedProposal({
    db,
    plan,
    input,
    config,
    mode,
    secret,
    clock,
    callProviderOverride: params.callProviderOverride,
  });
}

/**
 * Crea il piano: lease + prenotazione + `VisualPlanRun` in un'unica
 * transazione, con lettura/parsing autorevole di `LessonDoc` **dentro** la
 * stessa transazione (blocker P1-4) — mai un preflight fuori transazione i
 * cui risultati potrebbero essere scaduti al commit. Quando la lezione ha
 * ancora un manifest singolare (`visual`, non `visuals`), la stessa
 * transazione esegue l'adozione atomica (roadmap §6.2, applicata qui: la
 * creazione del primo piano coordinato su quella lezione è la prima
 * scrittura sotto il contratto MULTI-VISUAL).
 */
export async function createVisualPlanForOwner(params: {
  db: Firestore;
  ownerUid: string;
  input: VisualPlanAuthorizeInput;
  opaquePlanId: string;
  config: AiRuntimeConfig;
  visualMode: AiVisualMode;
  nowMs: number;
  afterAuthoritativeRead?: () => Promise<void>;
}): Promise<VisualPlanRun> {
  const { db, ownerUid, input, opaquePlanId, config, visualMode, nowMs } = params;
  const leaseId = computeVisualPlanLeaseId(ownerUid, input.lessonId);
  const planRef = db.doc(`visualPlanRuns/${opaquePlanId}`);
  const leaseRef = db.doc(`visualPlanLeases/${leaseId}`);
  const lessonRef = db.doc(lessonPath(input.programId, input.importId, input.lessonId));
  const reservationMonthKey = monthKeyFromMs(nowMs);
  const ledgerRef = db.doc(`aiBudgetLedger/${reservationMonthKey}`);
  const expireAt = Timestamp.fromMillis(nowMs + VISUAL_STAGING_TTL_MS);
  const nowTs = Timestamp.fromMillis(nowMs);
  const reservationKey = computeBudgetReservationKey(ownerUid, input.requestId);

  type TxOutcome =
    | { kind: 'replay'; plan: VisualPlanRun }
    | { kind: 'created'; plan: VisualPlanRun }
    | { kind: 'corrupted_state' }
    | { kind: 'lesson_error'; error: AiVisualError | AiVisualMultiError }
    | { kind: 'already_active'; opaquePlanId: string; requestId: string }
    | { kind: 'budget'; reason: 'budget_exceeded' | 'daily_budget_exceeded' };

  const outcome = await db.runTransaction<TxOutcome>(async (tx) => {
    const [planSnap, leaseSnap] = await Promise.all([tx.get(planRef), tx.get(leaseRef)]);

    if (planSnap.exists) {
      // Corsa fra il percorso rapido (fuori transazione) e questa
      // transazione: un altro tentativo concorrente con lo stesso
      // `requestId` ha già creato il piano.
      let existingPlan: VisualPlanRun;
      try {
        existingPlan = validateVisualPlanRun(planSnap.data());
      } catch {
        return { kind: 'corrupted_state' };
      }
      if (!identityMatchesInput(existingPlan, ownerUid, input)) {
        return { kind: 'corrupted_state' };
      }
      return { kind: 'replay', plan: existingPlan };
    }

    let lesson: AuthoritativeLessonInTx;
    try {
      lesson = await readAuthoritativeLessonInTx(tx, db, {
        ownerUid,
        programId: input.programId,
        importId: input.importId,
        lessonId: input.lessonId,
      });
    } catch (error) {
      if (error instanceof AiVisualError) return { kind: 'lesson_error', error };
      throw error;
    }
    await params.afterAuthoritativeRead?.();

    const legacy = readLegacyLessonVisuals({
      visual: lesson.lessonData.visual,
      visuals: lesson.lessonData.visuals,
    });
    if (
      legacy.status === 'visual_legacy_conflict' ||
      legacy.status === 'visuals_malformed' ||
      legacy.status === 'visual_legacy_malformed'
    ) {
      return {
        kind: 'lesson_error',
        error: new AiVisualMultiError(
          legacy.status,
          'Manifest visivo della lezione in stato incoerente.',
        ),
      };
    }
    const existingItemAssetIds =
      legacy.status === 'ok' ? legacy.manifest.items.map((item) => item.assetId) : [];
    if (
      input.replacementAssetId !== null &&
      !existingItemAssetIds.includes(input.replacementAssetId)
    ) {
      return {
        kind: 'lesson_error',
        error: new AiVisualMultiError(
          'invalid_input',
          'L’immagine richiesta per la sostituzione non è presente.',
        ),
      };
    }
    if (
      existingItemAssetIds.length +
        input.quantity.ceiling -
        (input.replacementAssetId === null ? 0 : 1) >
      MAX_VISUALS_PER_LESSON
    ) {
      return {
        kind: 'lesson_error',
        error: new AiVisualMultiError(
          'invalid_input',
          'La quantità richiesta supera gli slot liberi per questa lezione.',
        ),
      };
    }

    const sourceBodyHash = sha256Hex(lesson.body);
    const planHash = computeVisualPlanHash({
      ownerUid,
      programId: input.programId,
      importId: input.importId,
      lessonId: input.lessonId,
      publicLessonId: lesson.publicLessonId,
      sourceBodyHash,
      existingItemAssetIds,
      replacementAssetId: input.replacementAssetId,
      quantity: input.quantity,
    });

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
      reservationMonthKey,
      proposalCap,
      generationCap,
      maxAttemptsPerSlot: VISUAL_PLAN_MAX_ATTEMPTS_PER_SLOT,
      totalReserved,
    };

    if (leaseSnap.exists) {
      let existingLease: VisualPlanLease;
      try {
        existingLease = validateVisualPlanLease(leaseSnap.data());
      } catch {
        return { kind: 'corrupted_state' };
      }
      if (existingLease.opaquePlanId === opaquePlanId) {
        // Invariante violato: lease e piano sono scritti nella stessa
        // transazione (sotto); un lease già nostro senza un piano
        // corrispondente non è raggiungibile dal flusso normale.
        return { kind: 'corrupted_state' };
      }
      const leaseExpiresMs = timestampToMillis(existingLease.expireAt);
      if (leaseExpiresMs === null) return { kind: 'corrupted_state' };
      if (leaseExpiresMs > nowMs) {
        return {
          kind: 'already_active',
          opaquePlanId: existingLease.opaquePlanId,
          requestId: existingLease.requestId,
        };
      }
      // Scaduto: riacquisizione condizionata, stessa transazione (§10.3).
    }

    const ledgerSnap = await tx.get(ledgerRef);
    const ledgerState = readVisualPlanLedgerState(
      ledgerSnap,
      reservationMonthKey,
      config.monthlyBudgetMicroUsd,
      config.dailyBudgetMicroUsd,
    );
    const reserved = reserveLedger(
      ledgerState,
      reservationKey,
      totalReserved,
      nowMs + VISUAL_STAGING_TTL_MS,
      nowMs,
    );
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
      replacementAssetId: input.replacementAssetId,
      budgetCeiling,
      slots: [],
      settlement: { proposalActualCost: null, slots: [] },
      createdAt: nowTs,
      updatedAt: nowTs,
      expireAt,
    };
    tx.set(planRef, newPlan);
    writeVisualPlanLedgerState(tx, ledgerRef, reserved.state);

    // Adozione singolare atomica (roadmap §6.2): solo se questa lettura ha
    // davvero adottato un `visual` singolare, nella stessa transazione della
    // prima scrittura MULTI-VISUAL su questa lezione — mai un passo separato.
    if (legacy.status === 'ok' && legacy.adoptedFromSingular) {
      tx.update(lessonRef, { visuals: legacy.manifest, visual: FieldValue.delete() });
      if (lesson.completed) {
        tx.update(db.doc(`publicLessons/${lesson.publicLessonId}`), {
          visuals: projectLessonVisualsManifest(legacy.manifest),
          visual: FieldValue.delete(),
        });
      }
    }

    return { kind: 'created', plan: newPlan };
  });

  if (outcome.kind === 'corrupted_state') {
    throw new AiVisualMultiError(
      'corrupted_state',
      'Piano o lease del piano visivo in stato incoerente.',
    );
  }
  if (outcome.kind === 'lesson_error') throw outcome.error;
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
  return outcome.plan;
}

/**
 * Esegue (o riprende) la proposta coordinata di un piano `authorized`/
 * `proposing` (roadmap §8.3 passo 3).
 *
 * **Review fix (Codex, blocker P0-2).** Tre fasi, con l'ownership del lease
 * riverificata fra la seconda e la terza:
 * 1. transazione di preparazione: legge piano+lease, verifica che il lease
 *    sia ancora il nostro, scrive `status: 'proposing'` e rinnova il lease
 *    (finestra pari alla durata massima della chiamata al motore) — **prima**
 *    di chiamare il provider;
 * 2. chiamata al motore generico (`generateContent`, porte plan-aware);
 * 3. transazione di finalizzazione, con un orologio **fresco** (dopo la
 *    chiamata, mai lo stesso istante della fase 1): rilegge piano+lease e
 *    scrive l'esito **solo se** il lease è ancora nostro, coerente e valido.
 *    Se nel frattempo un altro tentativo lo ha acquisito (o il lease è
 *    scaduto), restituisce `lost_ownership` con **zero scritture** — né piano
 *    né lease del vincitore vengono toccati.
 */
export async function resumeCoordinatedProposal(params: {
  db: Firestore;
  plan: VisualPlanRun;
  input: VisualPlanAuthorizeInput;
  config: AiRuntimeConfig;
  mode: AiContentMode;
  secret: string | undefined;
  clock: () => number;
  /** Solo test: sostituisce `callProvider` mantenendo intatta la contabilità del ledger. */
  callProviderOverride?: AiContentPorts['callProvider'];
  /** Solo test: simula la perdita della risposta dopo il commit AIGEN. */
  afterProposalResult?: () => Promise<void>;
}): Promise<VisualPlanRun> {
  const { db, input, config, mode, secret, clock } = params;
  const plan = params.plan;
  const opaquePlanId = computeOpaqueVisualPlanId(plan.ownerUid, plan.requestId);
  const leaseId = computeVisualPlanLeaseId(plan.ownerUid, plan.lessonId);
  const planRef = db.doc(`visualPlanRuns/${opaquePlanId}`);
  const leaseRef = db.doc(`visualPlanLeases/${leaseId}`);

  const leaseWindowMs = computeContentLeaseTtlMs(retryPolicyFromConfig(config));

  // ── Fase 1: preparazione, prima del provider ──────────────────────────────
  //
  // **Review fix (Codex, blocker P1-3).** Un piano/lease scaduto non può
  // essere rinnovato né raggiungere il provider: `plan.expireAt` (TTL fisso
  // di 24h dalla creazione, mai rinnovato) e il proprio `lease.expireAt`
  // (rinnovabile, ma qui trovato già superato — un piano attivo non lo
  // lascia mai scadere, §10.3) sono verificati **contro l'orologio, prima**
  // di qualunque rinnovo o chiamata al motore. In questa funzione il piano
  // ha sempre zero slot (autorizza solo `authorized`/`proposing` →
  // `proposed`/`abandoned`, mai la generazione per slot, fuori scope 03A):
  // con zero slot lo stato derivabile da `assertVisualPlanStatusMatchesSlots`
  // non è mai `expired` (richiede almeno uno slot non terminale), è sempre
  // `abandoned` — stessa transizione terminale già usata altrove in questo
  // file quando un piano si chiude senza produrre alcuna immagine, con
  // rilascio immediato del lease (§8.7, §10.3).
  const prepareNowMs = clock();
  type PrepareOutcome =
    | { kind: 'prepared' }
    | { kind: 'plan_expired'; plan: VisualPlanRun }
    | { kind: 'lost_ownership' }
    | { kind: 'corrupted_state' };
  const prepared = await db.runTransaction<PrepareOutcome>(async (tx) => {
    const [planSnap, leaseSnap] = await Promise.all([tx.get(planRef), tx.get(leaseRef)]);
    if (!planSnap.exists) return { kind: 'corrupted_state' };
    let currentPlan: VisualPlanRun;
    try {
      currentPlan = validateVisualPlanRun(planSnap.data());
    } catch {
      return { kind: 'corrupted_state' };
    }
    if (!isUnsettled(currentPlan.status)) return { kind: 'corrupted_state' };
    if (!leaseSnap.exists) return { kind: 'corrupted_state' };
    let currentLease: VisualPlanLease;
    try {
      currentLease = validateVisualPlanLease(leaseSnap.data());
    } catch {
      return { kind: 'corrupted_state' };
    }
    if (!leaseMatchesPlan(currentLease, currentPlan, opaquePlanId)) {
      return { kind: 'lost_ownership' };
    }

    const planExpireMs = timestampToMillis(currentPlan.expireAt);
    const leaseExpireMs = timestampToMillis(currentLease.expireAt);
    if (planExpireMs === null || leaseExpireMs === null) return { kind: 'corrupted_state' };
    if (planExpireMs <= prepareNowMs || leaseExpireMs <= prepareNowMs) {
      const ledgerRef = db.doc(`aiBudgetLedger/${currentPlan.budgetCeiling.reservationMonthKey}`);
      const ledgerSnap = await tx.get(ledgerRef);
      const ledgerState = readVisualPlanLedgerState(
        ledgerSnap,
        currentPlan.budgetCeiling.reservationMonthKey,
        config.monthlyBudgetMicroUsd,
        config.dailyBudgetMicroUsd,
      );
      // `updatedAt` è fissato a `expireAt`, non a `prepareNowMs`: il
      // validatore fail-closed (`assertVisualPlanTimestampOrder`) richiede
      // `updatedAt <= expireAt` per ogni status diverso da `expired` (che qui
      // è irraggiungibile a zero slot, §8.7) — il piano non ha fatto nulla
      // *dopo* la propria scadenza, si sta solo formalizzando ora una
      // chiusura già avvenuta silenziosamente.
      const expiredPlan: VisualPlanRun = {
        ...currentPlan,
        status: 'abandoned',
        updatedAt: Timestamp.fromMillis(Math.min(prepareNowMs, planExpireMs)),
      };
      validateVisualPlanRun(expiredPlan);
      writeVisualPlanLedgerState(
        tx,
        ledgerRef,
        closeVisualPlanReservation(ledgerState, currentPlan, prepareNowMs),
      );
      tx.set(planRef, expiredPlan);
      tx.delete(leaseRef);
      return { kind: 'plan_expired', plan: expiredPlan };
    }

    const updatedPlan: VisualPlanRun = {
      ...currentPlan,
      status: 'proposing',
      updatedAt: Timestamp.fromMillis(prepareNowMs),
    };
    validateVisualPlanRun(updatedPlan);
    tx.set(planRef, updatedPlan);
    const renewedLease: VisualPlanLease = {
      ...currentLease,
      updatedAt: Timestamp.fromMillis(prepareNowMs),
      expireAt: Timestamp.fromMillis(prepareNowMs + leaseWindowMs),
    };
    validateVisualPlanLease(renewedLease);
    tx.set(leaseRef, renewedLease);
    return { kind: 'prepared' };
  });

  if (prepared.kind === 'corrupted_state') {
    throw new AiVisualMultiError(
      'corrupted_state',
      'Piano o lease del piano visivo in stato incoerente.',
    );
  }
  if (prepared.kind === 'lost_ownership') {
    throw new AiVisualMultiError(
      'visual_plan_already_active',
      'Il lease di questo piano è scaduto ed è stato acquisito da un altro tentativo.',
    );
  }
  if (prepared.kind === 'plan_expired') {
    return prepared.plan;
  }

  // Solo dopo avere dimostrato che piano e lease sono vivi e coerenti si
  // rilegge il corpo autorevole necessario alla proposta. Un piano scaduto
  // non arriva neppure a questo I/O, tanto meno al provider.
  const lessonRef = db.doc(lessonPath(plan.programId, plan.importId, plan.lessonId));
  const lessonSnap = await lessonRef.get();
  const lessonData = lessonSnap.exists ? (lessonSnap.data() as Record<string, unknown>) : null;
  const lessonGate = checkLessonForVisual({
    lesson: lessonData,
    lessonId: plan.lessonId,
    ownerUid: plan.ownerUid,
    importId: plan.importId,
  });
  if (!lessonGate.ok) {
    throw new AiVisualError('invalid_input', describeVisualBindingFailure(lessonGate.failure));
  }
  const publicLessonSnap = await db.doc(`publicLessons/${lessonGate.publicLessonId}`).get();
  const projectionGate = checkProjectionForVisual({
    lesson: lessonData as Record<string, unknown>,
    publicLesson: publicLessonSnap.exists
      ? (publicLessonSnap.data() as Record<string, unknown>)
      : null,
    programId: plan.programId,
    importId: plan.importId,
    ownerUid: plan.ownerUid,
  });
  if (!projectionGate.ok) {
    throw new AiVisualError('invalid_input', describeVisualBindingFailure(projectionGate.failure));
  }
  if (sha256Hex(projectionGate.body) !== plan.sourceBodyHash) {
    throw new AiVisualMultiError(
      'visual_plan_proposal_body_changed',
      "Il corpo della lezione è cambiato dopo l'autorizzazione del piano.",
    );
  }
  const proposalRequest = buildVisualPlanProposalRequest({
    requestId: plan.requestId,
    quantity: plan.quantity,
    lessonBody: projectionGate.body,
    titolo: input.titolo,
    sottotitolo: input.sottotitolo,
    difficolta: input.difficolta,
    concettiChiave: input.concettiChiave,
    obiettivi: input.obiettivi,
    udaTitle: input.udaTitle,
    udaContext: input.udaContext,
  });

  // ── Fase 2: motore generico, porte plan-aware ─────────────────────────────
  const basePorts = createVisualPlanProposalPorts({ db, config, mode, secret, plan });
  const ports = params.callProviderOverride
    ? { ...basePorts, callProvider: params.callProviderOverride }
    : basePorts;
  const ctx: AiContentContext = {
    authenticatedOwnerUid: plan.ownerUid,
    nowMs: prepareNowMs,
    executionId: randomUUID(),
    mode,
    leaseMs: leaseWindowMs,
  };
  const result = await generateContent(proposalRequest, ctx, ports);
  const decisions = validateStoredVisualPlanProposalOutput(result.output, plan.quantity.ceiling);
  await params.afterProposalResult?.();
  const slots = decisions.map((decision, index) => buildSlotFromDecision(decision, index));
  const hasImageSlot = slots.some((slot) => slot.decision === 'image');
  const nextStatus: VisualPlanRun['status'] = hasImageSlot ? 'proposed' : 'abandoned';

  // ── Fase 3: finalizzazione, orologio fresco, ownership riverificata ───────
  //
  // **Review fix (Codex, blocker P0-2).** L'ownership del lease è verificata
  // **prima** di qualunque `tx.set`/`tx.delete`: dentro una transazione
  // Firestore, una scrittura accodata con `tx.set` viene comunque committata
  // al termine del callback, indipendentemente dal valore restituito — non
  // esiste un modo per "annullarla" restituendo un esito diverso. Il primo
  // WIP accodava `tx.set(planRef, updated)` e **solo dopo** controllava il
  // lease, cosicché un esito `lost_ownership` scrivesse comunque il piano.
  // Qui il giudizio precede ogni scrittura: `lost_ownership` produce **zero**
  // scritture, il piano resta `proposing` fino a un tentativo successivo (che
  // troverà di nuovo il lease altrui e si fermerà allo stesso modo, senza mai
  // richiamare il provider — l'esecuzione AIGEN sottostante è già stata
  // liquidata da `finalizeRun`, indipendentemente da questa transazione).
  const finalizeNowMs = clock();
  type FinalizeOutcome =
    | { kind: 'written'; plan: VisualPlanRun }
    | { kind: 'plan_expired'; plan: VisualPlanRun }
    | { kind: 'lost_ownership' }
    | { kind: 'corrupted_state' };
  const finalized = await db.runTransaction<FinalizeOutcome>(async (tx) => {
    const [planSnap, leaseSnap] = await Promise.all([tx.get(planRef), tx.get(leaseRef)]);
    if (!planSnap.exists) return { kind: 'corrupted_state' };
    let currentPlan: VisualPlanRun;
    try {
      currentPlan = validateVisualPlanRun(planSnap.data());
    } catch {
      return { kind: 'corrupted_state' };
    }
    // Solo questo flusso scrive `proposing` per questo piano: uno stato
    // diverso qui è un bug (scrittura fuori disciplina), non un caso di
    // business — fail-closed.
    if (currentPlan.status !== 'proposing' || currentPlan.requestId !== plan.requestId) {
      return { kind: 'corrupted_state' };
    }

    let ownsLease = false;
    let currentLease: VisualPlanLease | null = null;
    if (leaseSnap.exists) {
      try {
        currentLease = validateVisualPlanLease(leaseSnap.data());
        const leaseExpireMs = timestampToMillis(currentLease.expireAt);
        ownsLease =
          leaseExpireMs !== null &&
          leaseExpireMs > finalizeNowMs &&
          leaseMatchesPlan(currentLease, currentPlan, opaquePlanId);
      } catch {
        ownsLease = false;
      }
    }
    if (!ownsLease) {
      // Il lease è stato acquisito da un altro tentativo mentre il nostro
      // era in corso (il nostro è scaduto durante la chiamata al motore):
      // zero scritture, né sul piano né sul lease del vincitore.
      return { kind: 'lost_ownership' };
    }

    const planExpireMs = timestampToMillis(currentPlan.expireAt);
    if (planExpireMs === null) return { kind: 'corrupted_state' };
    if (planExpireMs <= finalizeNowMs) {
      const ledgerSnap = await tx.get(
        db.doc(`aiBudgetLedger/${currentPlan.budgetCeiling.reservationMonthKey}`),
      );
      const state = readVisualPlanLedgerState(
        ledgerSnap,
        currentPlan.budgetCeiling.reservationMonthKey,
        config.monthlyBudgetMicroUsd,
        config.dailyBudgetMicroUsd,
      );
      const expiredPlan: VisualPlanRun = {
        ...currentPlan,
        status: 'abandoned',
        settlement: { proposalActualCost: result.actualCostMicroUsd, slots: [] },
        updatedAt: Timestamp.fromMillis(planExpireMs),
      };
      validateVisualPlanRun(expiredPlan);
      writeVisualPlanLedgerState(
        tx,
        db.doc(`aiBudgetLedger/${currentPlan.budgetCeiling.reservationMonthKey}`),
        reconcileLedger(state, currentPlan.budgetCeiling.reservationKey, 0, finalizeNowMs),
      );
      tx.set(planRef, expiredPlan);
      tx.delete(leaseRef);
      return { kind: 'plan_expired', plan: expiredPlan };
    }

    const updated: VisualPlanRun = {
      ...currentPlan,
      status: nextStatus,
      slots,
      settlement: { proposalActualCost: result.actualCostMicroUsd, slots: [] },
      updatedAt: Timestamp.fromMillis(finalizeNowMs),
    };
    validateVisualPlanRun(updated);
    tx.set(planRef, updated);

    if (nextStatus === 'abandoned') {
      // Stato terminale raggiunto senza intervento del docente (§8.7,
      // §10.3): rilascio immediato del lease, non atteso il TTL.
      tx.delete(leaseRef);
    } else {
      const renewedLease: VisualPlanLease = {
        contractVersion: VISUAL_PLAN_LEASE_CONTRACT_VERSION,
        ownerUid: plan.ownerUid,
        programId: plan.programId,
        importId: plan.importId,
        lessonId: plan.lessonId,
        opaquePlanId,
        requestId: plan.requestId,
        createdAt: plan.createdAt,
        updatedAt: Timestamp.fromMillis(finalizeNowMs),
        expireAt: Timestamp.fromMillis(finalizeNowMs + VISUAL_STAGING_TTL_MS),
      };
      validateVisualPlanLease(renewedLease);
      tx.set(leaseRef, renewedLease);
    }
    return { kind: 'written', plan: updated };
  });

  if (finalized.kind === 'corrupted_state') {
    throw new AiVisualMultiError(
      'corrupted_state',
      'Piano o lease del piano visivo in stato incoerente dopo la proposta.',
    );
  }
  if (finalized.kind === 'lost_ownership') {
    // `generateContent.finalizeRun` può avere già ri-prenotato la quota
    // generation residua sotto la reservationKey di questo piano. Il piano
    // vincitore usa una chiave diversa: rilasciare la nostra quota non tocca
    // né il suo lease né il suo budget. Piano e lease restano byte-identici.
    await releaseVisualPlanReservationAfterLostOwnership({
      db,
      plan,
      config,
      nowMs: finalizeNowMs,
    });
    throw new AiVisualMultiError(
      'visual_plan_already_active',
      'Il lease di questo piano è scaduto ed è stato acquisito da un altro tentativo durante la proposta.',
    );
  }
  if (finalized.kind === 'plan_expired') return finalized.plan;
  return finalized.plan;
}

function buildSlotFromDecision(
  decision: VisualPlanProposalDecision,
  slotIndex: number,
): VisualPlanSlot {
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
  return new HttpsError(OWNER_ERROR_MAP[error.code] ?? 'internal', error.message, {
    code: error.code,
  });
}

async function handleAuthorizeVisualPlan(
  request: CallableRequest<unknown>,
): Promise<VisualPlanRun> {
  const db = database();
  try {
    const ownerUid = await requireOwner(request, db);
    // Payload chiuso e identità autenticata vengono sempre validati prima del
    // replay. Il kill switch riguarda soltanto nuovo lavoro: un risultato già
    // persistito deve restare leggibile anche a generazione disattivata.
    const input = validateVisualPlanAuthorizeInput(request.data);
    const mode = contentModeFromEnv();
    const visualMode = visualModeFromEnv();
    const secret = mode === 'openai' ? readOpenAiSecret() : undefined;
    return await authorizeVisualPlanForOwner({
      db,
      ownerUid,
      input,
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
export const aiVisualPlanAuthorize = onCall(
  VISUAL_PLAN_CALLABLE_OPTIONS,
  handleAuthorizeVisualPlan,
);
