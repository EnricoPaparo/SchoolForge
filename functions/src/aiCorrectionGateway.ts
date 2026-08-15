import { onCall, HttpsError } from 'firebase-functions/v2/https';
import type { CallableRequest, FunctionsErrorCode } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import { defineSecret } from 'firebase-functions/params';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import type { Firestore, Transaction } from 'firebase-admin/firestore';
import {
  AiGatewayError,
  resolveAiFeatureMode,
  type AiCorrectionAuthDeps,
  type AiGatewayErrorCode,
} from './aiCorrectionGatewayCore.js';
import { createConfiguredAiGrader } from './aiCorrectionProvider.js';
import { parseAiRuntimeConfig, type AiRuntimeConfig } from './aiCorrectionRuntimeConfig.js';
import {
  AI_RUN_CONTRACT_VERSION,
  AI_RUN_TIMEOUT_SECONDS,
  mapSnapshotQuestionToTeacher,
  runExecution,
  runPreview,
  type CommitSubmissionInput,
  type CommitSubmissionResult,
  type CorrectionData,
  type EngineWritePorts,
  type ExclusionCode,
  type ExistingEvaluation,
  type PersistedRun,
  type PersistedSubmissionResult,
  type RunRetryTelemetry,
  type SubmissionData,
  type SubmissionOutcome,
  type ReconcileBudgetInput,
  type ReserveBudgetInput,
  type ReserveBudgetResult,
  type TeacherQuestion,
  type ValidatedScore,
  type VerificationData,
} from './aiCorrectionEngine.js';
import {
  emptyLedger,
  markPending as markPendingLedger,
  reconcile as reconcileLedger,
  reserve as reserveLedger,
  type BudgetLedgerState,
  type BudgetReservation,
  type ReservationStatus,
} from './aiCorrectionBudget.js';
import { SCHOOLFORGE_FUNCTION_REGION } from './deploymentRegion.js';

/**
 * M5-02 — wiring runtime del motore della correzione assistita da IA.
 *
 * Due Cloud Functions v2 `onCall`, scale-to-zero, che montano il motore puro di
 * `aiCorrectionEngine.ts` sull'Admin SDK: preflight reale (`aiCorrectionPreview`)
 * ed esecuzione con scritture atomiche per consegna e idempotenza
 * (`aiCorrectionRun`). M5-05C mantiene il default `disabled`, conserva il mock
 * e predispone OpenAI con configurazione fail-closed e secret binding non
 * valorizzato. Nessuna API key, chiamata reale o deploy in questa PR.
 */

export const AI_GATEWAY_REGION = SCHOOLFORGE_FUNCTION_REGION;
export const OPENAI_API_KEY = defineSecret('OPENAI_API_KEY');

if (getApps().length === 0) initializeApp();

// ── Porte Admin SDK ───────────────────────────────────────────────────────────

async function getOwnerUid(db: Firestore): Promise<string | null> {
  const snap = await db.doc('settings/owner').get();
  return snap.exists ? ((snap.data()?.ownerUid as string | undefined) ?? null) : null;
}

/**
 * M5-05D1 — porta di lettura della configurazione runtime `settings/aiConfig`
 * (Admin SDK, **una `get` puntuale** per operazione, nessun listener/polling). Il
 * documento è validato fail-closed: assente/malformato ⇒ `null` ⇒ provider reale
 * disabilitato. Non è mai esposto al client (regole Firestore server-only).
 */
function loadRuntimeConfig(db: Firestore) {
  return async (): Promise<AiRuntimeConfig | null> => {
    const snap = await db.doc('settings/aiConfig').get();
    return snap.exists ? parseAiRuntimeConfig(snap.data()) : null;
  };
}

function loadVerification(db: Firestore) {
  return async (verificationId: string): Promise<VerificationData | null> => {
    const snap = await db.doc(`verifications/${verificationId}`).get();
    if (!snap.exists) return null;
    const data = snap.data() as Record<string, unknown>;
    const teacherSnapshot = data.teacherSnapshot as
      | {
          questions?: unknown[];
          distributionMode?: unknown;
          commonQuestionOrders?: unknown;
          equivalentGroups?: unknown;
        }
      | null
      | undefined;
    const rawQuestions = Array.isArray(teacherSnapshot?.questions)
      ? teacherSnapshot!.questions
      : null;
    const teacherQuestions: TeacherQuestion[] | null = rawQuestions
      ? rawQuestions.map((q) => mapSnapshotQuestionToTeacher(q as Record<string, unknown>))
      : null;
    return {
      ownerUid: (data.ownerUid as string) ?? '',
      status: (data.status as string) ?? '',
      teacherQuestions,
      distributionMode: teacherSnapshot?.distributionMode,
      commonQuestionOrders: teacherSnapshot?.commonQuestionOrders,
      equivalentGroups: teacherSnapshot?.equivalentGroups,
      // VDIF-05 — resta confinato al motore: serve a validare l'assegnazione
      // congelata, non viene mai serializzato nel run né inoltrato al provider.
      resolvableSnapshot: teacherSnapshot,
    };
  };
}

function loadSubmission(db: Firestore) {
  return async (submissionId: string): Promise<SubmissionData | null> => {
    const snap = await db.doc(`submissions/${submissionId}`).get();
    if (!snap.exists) return null;
    const data = snap.data() as Record<string, unknown>;
    return {
      ownerUid: (data.ownerUid as string) ?? '',
      verificationId: (data.verificationId as string) ?? '',
      studentUid: (data.studentUid as string) ?? '',
      status: (data.status as string) ?? '',
      answers: (data.answers as SubmissionData['answers']) ?? {},
      // Conserva anche valori malformati: la classificazione basata sullo
      // snapshot li rifiuta, senza trasformarli in assenza/same_questions.
      ...(Object.prototype.hasOwnProperty.call(data, 'assignedQuestionOrders')
        ? { assignedQuestionOrders: data.assignedQuestionOrders }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(data, 'assignedAnswerKeys')
        ? { assignedAnswerKeys: data.assignedAnswerKeys }
        : {}),
    };
  };
}

function toCorrectionData(data: Record<string, unknown>): CorrectionData {
  return {
    status: data.status as CorrectionData['status'],
    evaluations: (data.evaluations as Record<string, ExistingEvaluation>) ?? {},
    reopenCount: (data.reopenCount as number) ?? 0,
  };
}

function loadCorrection(db: Firestore) {
  return async (submissionId: string): Promise<CorrectionData | null> => {
    const snap = await db.doc(`corrections/${submissionId}`).get();
    if (!snap.exists) return null;
    return toCorrectionData(snap.data() as Record<string, unknown>);
  };
}

function computeTotals(evaluations: Record<string, ExistingEvaluation>): {
  totalPoints: number;
  maxPoints: number;
  percentage: number | null;
} {
  let totalPoints = 0;
  let maxPoints = 0;
  for (const e of Object.values(evaluations)) {
    if (e.points !== null) totalPoints += e.points;
    maxPoints += e.maxPoints;
  }
  return {
    totalPoints,
    maxPoints,
    percentage: maxPoints > 0 ? Math.round((totalPoints / maxPoints) * 100) : null,
  };
}

function progressStatus(
  evaluations: Record<string, ExistingEvaluation>,
): 'submitted' | 'in_progress' {
  return Object.values(evaluations).some((e) => e.points !== null) ? 'in_progress' : 'submitted';
}

/** `true` quando la consegna ha almeno una domanda e tutte sono valutate. */
function isFullyEvaluated(evaluations: Record<string, ExistingEvaluation>): boolean {
  const values = Object.values(evaluations);
  return values.length > 0 && values.every((e) => e.points !== null);
}

/**
 * Decide il feedback generale da scrivere (M5-04B): il candidato **solo se** la
 * consegna è ora interamente valutata **e** il testo docente esistente è vuoto
 * (mai sovrascritto). Altrimenti mantiene il valore esistente (o `null`).
 */
function resolveGeneralFeedback(
  evaluations: Record<string, ExistingEvaluation>,
  existing: string | null,
  candidate: string | null,
): string | null {
  const docenteHasText = typeof existing === 'string' && existing.trim().length > 0;
  if (docenteHasText) return existing;
  if (candidate !== null && isFullyEvaluated(evaluations)) return candidate;
  return existing;
}

function applyProposed(
  evaluations: Record<string, ExistingEvaluation>,
  proposed: Map<number, ValidatedScore>,
): number[] {
  const written: number[] = [];
  for (const [order, score] of proposed) {
    const key = order.toString();
    const current = evaluations[key];
    if (!current || current.points !== null) continue; // mai sovrascrivere
    evaluations[key] = {
      order: current.order,
      maxPoints: current.maxPoints,
      points: score.points,
      ...(score.feedback !== undefined ? { feedback: score.feedback } : {}),
    };
    written.push(order);
  }
  return written;
}

function commitSubmission(db: Firestore) {
  return async (input: CommitSubmissionInput): Promise<CommitSubmissionResult> => {
    const correctionRef = db.doc(`corrections/${input.submissionId}`);
    const submissionRef = db.doc(`submissions/${input.submissionId}`);
    const receiptRef = db.doc(`submissionReceipts/${input.submissionId}`);

    return db.runTransaction(async (tx: Transaction): Promise<CommitSubmissionResult> => {
      const snap = await tx.get(correctionRef);
      const now = FieldValue.serverTimestamp();

      if (!snap.exists) {
        // Crea in_progress con lo scheletro congelato, poi applica le proposte.
        const evaluations: Record<string, ExistingEvaluation> = {};
        for (const q of input.skeleton) {
          evaluations[q.order.toString()] = {
            order: q.order,
            points: null,
            maxPoints: q.maxPoints,
          };
        }
        const written = applyProposed(evaluations, input.proposed);
        const totals = computeTotals(evaluations);
        // M5-04B: nuovo doc → nessun testo docente; scrivi il feedback generale
        // candidato solo se la consegna è già interamente valutata.
        const generalFeedback = resolveGeneralFeedback(
          evaluations,
          null,
          input.proposedGeneralFeedback,
        );
        tx.set(correctionRef, {
          submissionId: input.submissionId,
          verificationId: input.verificationId,
          studentUid: input.studentUid,
          ownerUid: input.ownerUid,
          status: 'in_progress',
          evaluations,
          generalFeedback,
          totalPoints: totals.totalPoints,
          maxPoints: totals.maxPoints,
          percentage: totals.percentage,
          createdAt: now,
          updatedAt: now,
          completedAt: null,
          returnedAt: null,
          reopenCount: 0,
        });
        writeMirror(tx, {
          submissionRef,
          receiptRef,
          totals,
          status: progressStatus(evaluations),
          now,
        });
        return { result: 'written', writtenOrders: written };
      }

      const rawCorrection = snap.data() as Record<string, unknown>;
      const correction = toCorrectionData(rawCorrection);
      if (correction.status !== 'in_progress') {
        return { result: 'changed', writtenOrders: [] };
      }

      const evaluations: Record<string, ExistingEvaluation> = { ...correction.evaluations };
      const written = applyProposed(evaluations, input.proposed);
      const totals = computeTotals(evaluations);
      // M5-04B: applica il feedback generale candidato solo se la consegna è ora
      // interamente valutata e il docente non ne ha già scritto uno. Il campo è
      // incluso nell'update solo quando cambia davvero, così non genera scritture
      // superflue né sovrascrive il testo docente.
      const existingGeneralFeedback =
        typeof rawCorrection.generalFeedback === 'string' ? rawCorrection.generalFeedback : null;
      const nextGeneralFeedback = resolveGeneralFeedback(
        evaluations,
        existingGeneralFeedback,
        input.proposedGeneralFeedback,
      );
      tx.update(correctionRef, {
        evaluations,
        totalPoints: totals.totalPoints,
        maxPoints: totals.maxPoints,
        percentage: totals.percentage,
        updatedAt: now,
        ...(nextGeneralFeedback !== existingGeneralFeedback
          ? { generalFeedback: nextGeneralFeedback }
          : {}),
      });
      writeMirror(tx, {
        submissionRef,
        receiptRef,
        totals,
        status: progressStatus(evaluations),
        now,
      });

      // Semantica M4: su correction riaperta (reopenCount > 0), un cambiamento
      // reale scrive un evento append-only 'scoreAdjusted' con delta minimale.
      if (correction.reopenCount > 0 && written.length > 0) {
        const eventRef = db.collection('correctionEvents').doc();
        tx.set(eventRef, {
          correctionId: input.submissionId,
          ownerUid: input.ownerUid,
          type: 'scoreAdjusted',
          actorUid: input.actorUid,
          previousStatus: 'in_progress',
          nextStatus: 'in_progress',
          reason: null,
          questionDeltas: written.map((order) => ({
            order,
            previousPoints: null,
            nextPoints: evaluations[order.toString()]!.points,
          })),
          timestamp: now,
        });
      }

      return { result: 'written', writtenOrders: written };
    });
  };
}

function writeMirror(
  tx: Transaction,
  args: {
    submissionRef: FirebaseFirestore.DocumentReference;
    receiptRef: FirebaseFirestore.DocumentReference;
    totals: { totalPoints: number; maxPoints: number; percentage: number | null };
    status: 'submitted' | 'in_progress';
    now: FirebaseFirestore.FieldValue;
  },
): void {
  tx.update(args.submissionRef, {
    correctionStatus: args.status,
    correctionStatusUpdatedAt: args.now,
    correctionSummary: {
      totalPoints: args.totals.totalPoints,
      maxPoints: args.totals.maxPoints,
      percentage: args.totals.percentage,
    },
    correctionSummaryUpdatedAt: args.now,
  });
  tx.set(
    args.receiptRef,
    { correctionStatus: args.status, correctionStatusUpdatedAt: args.now },
    { merge: true },
  );
}

const RUN_STATUSES = new Set(['completed', 'partial', 'failed']);
const SUBMISSION_OUTCOMES = new Set<SubmissionOutcome>([
  'succeeded',
  'partial',
  'excluded',
  'failed',
]);
const EXCLUSION_CODES = new Set<ExclusionCode>([
  'not_found',
  'wrong_owner',
  'wrong_verification',
  'not_submitted',
  'snapshot_unavailable',
  'correction_not_in_progress',
  'nothing_to_grade',
  'too_large',
  'changed_since_preview',
  'write_error',
]);
const COUNT_KEYS = [
  'selected',
  'eligible',
  'excluded',
  'closedToGrade',
  'openToGrade',
  'closedOnlySubmissions',
  'alreadyGradedIgnored',
  'succeeded',
  'partial',
  'failed',
] as const;

/** Legge soltanto il contratto privacy-minimal; qualunque forma dubbia è legacy. */
function readPersistedRun(data: Record<string, unknown>): PersistedRun | null {
  if (data.runContractVersion !== AI_RUN_CONTRACT_VERSION) return null;
  if (typeof data.selectionHash !== 'string' || !/^[a-f0-9]{64}$/.test(data.selectionHash)) {
    return null;
  }
  if (!RUN_STATUSES.has(data.status as string)) return null;
  if (data.mode !== 'mock' && data.mode !== 'openai') return null;
  if (typeof data.counts !== 'object' || data.counts === null) return null;
  const rawCounts = data.counts as Record<string, unknown>;
  if (COUNT_KEYS.some((key) => !Number.isInteger(rawCounts[key]) || Number(rawCounts[key]) < 0)) {
    return null;
  }
  const counts = Object.fromEntries(
    COUNT_KEYS.map((key) => [key, Number(rawCounts[key])]),
  ) as unknown as PersistedRun['counts'];
  if (
    !Number.isInteger(data.tokensEstimated) ||
    Number(data.tokensEstimated) < 0 ||
    !Number.isInteger(data.tokensActual) ||
    Number(data.tokensActual) < 0 ||
    !Number.isInteger(data.cost) ||
    Number(data.cost) < 0 ||
    !Array.isArray(data.resultOrdinals)
  ) {
    return null;
  }
  const resultOrdinals: PersistedSubmissionResult[] = [];
  for (const raw of data.resultOrdinals) {
    if (typeof raw !== 'object' || raw === null) return null;
    const result = raw as Record<string, unknown>;
    if (!Number.isInteger(result.ordinal) || Number(result.ordinal) < 0) return null;
    if (!SUBMISSION_OUTCOMES.has(result.status as SubmissionOutcome)) return null;
    if (
      result.reasonCode !== undefined &&
      !EXCLUSION_CODES.has(result.reasonCode as ExclusionCode)
    ) {
      return null;
    }
    resultOrdinals.push({
      ordinal: Number(result.ordinal),
      status: result.status as SubmissionOutcome,
      ...(result.reasonCode ? { reasonCode: result.reasonCode as ExclusionCode } : {}),
    });
  }
  const num = (value: unknown): number => (typeof value === 'number' ? value : 0);
  return {
    runContractVersion: AI_RUN_CONTRACT_VERSION,
    status: data.status as PersistedRun['status'],
    selectionHash: data.selectionHash,
    mode: data.mode,
    counts,
    inputTokensEstimated: num(data.inputTokensEstimated),
    outputTokensEstimated: num(data.outputTokensEstimated),
    tokensEstimated: num(data.tokensEstimated),
    costEstimatedMicroUsd: num(data.costEstimatedMicroUsd),
    inputTokensActual: num(data.inputTokensActual),
    outputTokensActual: num(data.outputTokensActual),
    tokensActual: num(data.tokensActual),
    costActualMicroUsd: num(data.costActualMicroUsd),
    costReservationMicroUsd: num(data.costReservationMicroUsd),
    costSettledMicroUsd: num(data.costSettledMicroUsd),
    retry: readRetryTelemetry(data.retry),
    resultOrdinals,
  };
}

/** Legge in modo difensivo la telemetria retry persistita (aggregati non negativi). */
function readRetryTelemetry(raw: unknown): RunRetryTelemetry {
  const empty: RunRetryTelemetry = {
    attemptsTotal: 0,
    retriesTotal: 0,
    retryReasonCodes: [],
    retryDelayTotalMs: 0,
    unknownBillingAttempts: 0,
  };
  if (typeof raw !== 'object' || raw === null) return empty;
  const r = raw as Record<string, unknown>;
  const n = (v: unknown): number => (typeof v === 'number' && v >= 0 ? v : 0);
  return {
    attemptsTotal: n(r.attemptsTotal),
    retriesTotal: n(r.retriesTotal),
    retryReasonCodes: Array.isArray(r.retryReasonCodes)
      ? r.retryReasonCodes.filter((c): c is string => typeof c === 'string')
      : [],
    retryDelayTotalMs: n(r.retryDelayTotalMs),
    unknownBillingAttempts: n(r.unknownBillingAttempts),
  };
}

function beginRun(db: Firestore): EngineWritePorts['beginRun'] {
  return async (requestId, meta) => {
    const ref = db.doc(`aiCorrectionRuns/${requestId}`);
    return db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const now = FieldValue.serverTimestamp();
      const acquire = () => {
        // Acquisisce/rinnova la lease per questo executionId.
        const lease = {
          status: 'running',
          executionId: meta.executionId,
          leaseExpiresAt: meta.nowMs + meta.leaseMs,
          updatedAt: now,
        };
        if (snap.exists) {
          tx.update(ref, lease);
        } else {
          tx.create(ref, {
            runContractVersion: AI_RUN_CONTRACT_VERSION,
            mode: meta.provider,
            provider: meta.provider,
            ...(meta.model ? { model: meta.model } : {}),
            ...(meta.configVersion ? { configVersion: meta.configVersion } : {}),
            ...(meta.priceListVersion ? { priceListVersion: meta.priceListVersion } : {}),
            selectionHash: meta.selectionHash,
            submissionCount: meta.submissionCount,
            ...lease,
            createdAt: now,
            expireAt: Timestamp.fromMillis(meta.expireAtMs),
            tokensEstimated: 0,
            tokensActual: 0,
            cost: 0,
          });
        }
        return { state: 'acquired' as const, executionId: meta.executionId };
      };

      if (!snap.exists) return acquire();

      const data = snap.data() as Record<string, unknown>;
      // Nessuna migrazione o takeover del formato legacy: potrebbe contenere ID
      // o una response non ricostruibile senza rischiare associazioni errate.
      if (data.runContractVersion !== AI_RUN_CONTRACT_VERSION) {
        return { state: 'legacy' as const };
      }
      if (data.selectionHash !== meta.selectionHash) return { state: 'conflict' as const };

      const status = data.status as PersistedRun['status'];
      const terminal = status === 'completed' || status === 'partial' || status === 'failed';
      if (terminal) {
        const existing = readPersistedRun(data);
        if (!existing) return { state: 'legacy' as const };
        return {
          state: 'completed' as const,
          existing,
        };
      }
      if (status !== 'running') return { state: 'legacy' as const };

      // status === 'running': lease valida → locked;
      // lease scaduta o assente → takeover.
      const leaseExpiresAt = typeof data.leaseExpiresAt === 'number' ? data.leaseExpiresAt : 0;
      if (status === 'running' && leaseExpiresAt > meta.nowMs) {
        return { state: 'locked' as const };
      }
      return acquire();
    });
  };
}

function finishRun(db: Firestore): EngineWritePorts['finishRun'] {
  return async (requestId, run) => {
    const ref = db.doc(`aiCorrectionRuns/${requestId}`);
    // Finalizza in transazione SOLO se questo executionId possiede ancora la
    // lease: un worker vecchio (lease già presa da un tentativo successivo) è un
    // no-op e non può sovrascrivere il risultato del tentativo corrente.
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return;
      const data = snap.data() as Record<string, unknown>;
      if (
        data.runContractVersion !== AI_RUN_CONTRACT_VERSION ||
        data.selectionHash !== run.selectionHash
      ) {
        return;
      }
      if (data.executionId !== run.executionId) return; // takeover avvenuto → no-op
      tx.set(
        ref,
        {
          status: run.status,
          updatedAt: FieldValue.serverTimestamp(),
          // Rilascia la lease: lo stato terminale rende il run non riacquisibile.
          leaseExpiresAt: 0,
          // Solo metadata aggregati + esito ordinale. Nessun ID/UID/contenuto.
          mode: run.mode,
          counts: run.counts,
          // M5-05D2B-1 — token e costo aggregati in micro-USD interi. `cost` resta
          // per compatibilità storica, allineato a `costActualMicroUsd`.
          inputTokensEstimated: run.inputTokensEstimated,
          outputTokensEstimated: run.outputTokensEstimated,
          tokensEstimated: run.tokensEstimated,
          costEstimatedMicroUsd: run.costEstimatedMicroUsd,
          inputTokensActual: run.inputTokensActual,
          outputTokensActual: run.outputTokensActual,
          tokensActual: run.tokensActual,
          costActualMicroUsd: run.costActualMicroUsd,
          costReservationMicroUsd: run.costReservationMicroUsd,
          // M5-05D2B-2 — costo prudenziale contabilizzato + telemetria retry.
          costSettledMicroUsd: run.costSettledMicroUsd,
          retry: run.retry,
          cost: run.costActualMicroUsd,
          resultOrdinals: run.resultOrdinals,
        },
        { merge: true },
      );
    });
  };
}

// ── Ledger di budget mensile (M5-05D2B-1) ─────────────────────────────────────

/**
 * Ricostruisce lo stato **puro** del ledger dal documento `aiBudgetLedger/{mese}`
 * (o vuoto se assente). Il `budgetMicroUsd` autoritativo viene sempre dalla config
 * runtime, non dal documento. Le prenotazioni sono mappe `requestId → importo`:
 * il `requestId` è un UUID opaco, mai un ID/UID/PII.
 */
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
        // `status` assente ⇒ trattata come `reserved` (documenti storici).
        const status: ReservationStatus = r.status === 'pending' ? 'pending' : 'reserved';
        reservations[id] = {
          microUsd: r.microUsd,
          expiresAtMs: r.expiresAtMs,
          ...(typeof r.dayKey === 'string' ? { dayKey: r.dayKey } : {}),
          status,
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

function writeLedgerState(
  tx: Transaction,
  ref: FirebaseFirestore.DocumentReference,
  state: BudgetLedgerState,
): void {
  // Sovrascrittura completa (no merge): rimuove davvero le prenotazioni scadute o
  // riconciliate. Solo importi tecnici aggregati + prenotazioni per requestId.
  tx.set(ref, {
    monthKey: state.monthKey,
    budgetMicroUsd: state.budgetMicroUsd,
    dailyBudgetMicroUsd: state.dailyBudgetMicroUsd,
    spentMicroUsd: state.spentMicroUsd,
    dailySpentMicroUsd: state.dailySpentMicroUsd,
    reservations: state.reservations,
    updatedAt: FieldValue.serverTimestamp(),
  });
}

/**
 * Prenotazione **atomica** su singolo documento mensile: la transazione Firestore
 * serializza le operazioni concorrenti, così due run in parallelo non possono
 * superare insieme il budget. Idempotente su `requestId` (la logica pura riusa una
 * prenotazione attiva senza raddoppiare) e con recovery via scadenza.
 */
function reserveBudget(db: Firestore): NonNullable<EngineWritePorts['reserveBudget']> {
  return async (input: ReserveBudgetInput): Promise<ReserveBudgetResult> => {
    const ref = db.doc(`aiBudgetLedger/${input.monthKey}`);
    return db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const state = readLedgerState(
        snap,
        input.monthKey,
        input.budgetMicroUsd,
        input.dailyBudgetMicroUsd,
      );
      const result = reserveLedger(
        state,
        input.requestId,
        input.amountMicroUsd,
        input.expiresAtMs,
        input.nowMs,
        input.dayKey,
      );
      if (!result.ok) return { ok: false, reason: result.reason };
      writeLedgerState(tx, ref, result.state);
      return { ok: true, reservedMicroUsd: result.reservedMicroUsd };
    });
  };
}

/**
 * Transizione `reserved → pending` in **una** transazione gated dalla titolarità
 * della lease: legge prima il run doc e procede solo se `executionId` è ancora il
 * titolare. Ritorna `true` se il worker può procedere alla chiamata provider.
 */
function markBudgetInvoked(db: Firestore): NonNullable<EngineWritePorts['markBudgetInvoked']> {
  return async (input): Promise<boolean> => {
    const runRef = db.doc(`aiCorrectionRuns/${input.requestId}`);
    const ledgerRef = db.doc(`aiBudgetLedger/${input.monthKey}`);
    return db.runTransaction(async (tx) => {
      const runSnap = await tx.get(runRef);
      if (!runSnap.exists || runSnap.data()?.executionId !== input.executionId) {
        return false; // lease persa (takeover) → non elaborare
      }
      const ledgerSnap = await tx.get(ledgerRef);
      const state = readLedgerState(
        ledgerSnap,
        input.monthKey,
        input.budgetMicroUsd,
        input.dailyBudgetMicroUsd,
      );
      writeLedgerState(tx, ledgerRef, markPendingLedger(state, input.requestId, input.nowMs));
      return true;
    });
  };
}

/**
 * Riconciliazione in **una** transazione che legge prima il run doc e procede
 * **solo** se `executionId` possiede ancora la lease: un worker vecchio dopo un
 * takeover è un no-op e non tocca la prenotazione del nuovo worker. Idempotente.
 */
function reconcileBudget(db: Firestore): NonNullable<EngineWritePorts['reconcileBudget']> {
  return async (input: ReconcileBudgetInput): Promise<void> => {
    const runRef = db.doc(`aiCorrectionRuns/${input.requestId}`);
    const ledgerRef = db.doc(`aiBudgetLedger/${input.monthKey}`);
    await db.runTransaction(async (tx) => {
      const runSnap = await tx.get(runRef);
      if (!runSnap.exists || runSnap.data()?.executionId !== input.executionId) {
        return; // worker non più titolare della lease → no-op
      }
      const ledgerSnap = await tx.get(ledgerRef);
      const state = readLedgerState(
        ledgerSnap,
        input.monthKey,
        input.budgetMicroUsd,
        input.dailyBudgetMicroUsd,
      );
      const next = reconcileLedger(state, input.requestId, input.actualMicroUsd, input.nowMs);
      writeLedgerState(tx, ledgerRef, next);
    });
  };
}

function buildWritePorts(db: Firestore): EngineWritePorts {
  return {
    loadVerification: loadVerification(db),
    loadSubmission: loadSubmission(db),
    loadCorrection: loadCorrection(db),
    beginRun: beginRun(db),
    finishRun: finishRun(db),
    commitSubmission: commitSubmission(db),
    reserveBudget: reserveBudget(db),
    markBudgetInvoked: markBudgetInvoked(db),
    reconcileBudget: reconcileBudget(db),
  };
}

// ── Errori → HttpsError ───────────────────────────────────────────────────────

function toHttpsError(err: AiGatewayError): HttpsError {
  const map: Record<AiGatewayErrorCode, FunctionsErrorCode> = {
    unauthenticated: 'unauthenticated',
    not_owner: 'permission-denied',
    feature_disabled: 'failed-precondition',
    provider_config_invalid: 'failed-precondition',
    invalid_input: 'invalid-argument',
    batch_limit_exceeded: 'resource-exhausted',
    limit_exceeded: 'resource-exhausted',
    operation_budget_exceeded: 'resource-exhausted',
    daily_budget_exceeded: 'resource-exhausted',
    budget_exceeded: 'resource-exhausted',
    budget_unavailable: 'unavailable',
  };
  return new HttpsError(map[err.code], err.message, { code: err.code });
}

function authDeps(request: CallableRequest, db: Firestore): AiCorrectionAuthDeps {
  return {
    callerUid: request.auth?.uid ?? null,
    getOwnerUid: () => getOwnerUid(db),
    featureMode: resolveAiFeatureMode(process.env),
  };
}

function readOpenAiSecret(): string | undefined {
  try {
    return OPENAI_API_KEY.value();
  } catch {
    return undefined;
  }
}

async function run<T>(
  phase: 'preview' | 'run',
  request: CallableRequest,
  handler: (db: Firestore) => Promise<T>,
): Promise<T> {
  const started = Date.now();
  const db = getFirestore();
  const featureMode = resolveAiFeatureMode(process.env);
  try {
    const result = await handler(db);
    // Log minimale e NON sensibile: nessun id di verifica/consegna/studente,
    // nessun contenuto. Solo fase, modalità, esito, durata.
    logger.info('aiCorrectionGateway', {
      phase,
      mode: featureMode,
      outcome: 'ok',
      durationMs: Date.now() - started,
    });
    return result;
  } catch (err) {
    if (err instanceof AiGatewayError) {
      logger.info('aiCorrectionGateway', {
        phase,
        mode: featureMode,
        outcome: err.code,
        durationMs: Date.now() - started,
      });
      throw toHttpsError(err);
    }
    logger.error('aiCorrectionGateway', {
      phase,
      outcome: 'internal',
      durationMs: Date.now() - started,
    });
    throw new HttpsError('internal', 'Errore interno del gateway IA.');
  }
}

export const aiCorrectionPreview = onCall(
  { region: AI_GATEWAY_REGION, minInstances: 0, maxInstances: 3 },
  (request) =>
    run('preview', request, (db) =>
      runPreview(request.data, {
        ...authDeps(request, db),
        ports: buildWritePorts(db),
        loadRuntimeConfig: loadRuntimeConfig(db),
      }),
    ),
);

export const aiCorrectionRun = onCall(
  {
    region: AI_GATEWAY_REGION,
    minInstances: 0,
    maxInstances: 3,
    // M5-05D2B-2 — timeout **esplicito** coerente con deadline/lease: il retry può
    // allungare il run, non lo si lascia al default della piattaforma.
    timeoutSeconds: AI_RUN_TIMEOUT_SECONDS,
    secrets: [OPENAI_API_KEY],
  },
  (request) =>
    run('run', request, (db) => {
      const auth = authDeps(request, db);
      return runExecution(request.data, {
        ...auth,
        ports: buildWritePorts(db),
        loadRuntimeConfig: loadRuntimeConfig(db),
        grader: (runtimeConfig) => {
          const mode = auth.featureMode;
          return createConfiguredAiGrader({
            mode,
            // `settings/aiConfig.model` è l'unica fonte autoritativa. Nessun
            // fallback o override da OPENAI_MODEL/process.env.
            openAiModel: runtimeConfig?.model,
            // Questa lettura avviene solo quando il motore invoca la factory,
            // dopo config/kill switch/classificazione/limiti.
            openAiApiKey: mode === 'openai' ? readOpenAiSecret() : undefined,
            // M5-05D2B-2 — retry/timeout dalla config runtime validata (unica fonte
            // del numero di retry; ceiling DEV: retry ≤ 1, timeout ≤ 60 s).
            ...(runtimeConfig
              ? {
                  retry: {
                    maxRetries: runtimeConfig.limits.maxApplicationRetries,
                    attemptTimeoutMs: runtimeConfig.limits.attemptTimeoutMs,
                  },
                }
              : {}),
          });
        },
      });
    }),
);
