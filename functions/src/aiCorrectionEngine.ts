/**
 * M5-02 — motore server-side della correzione assistita da IA.
 *
 * Orchestrazione pura (nessuna dipendenza `firebase-admin`/`firebase-functions`):
 * eleggibilità per consegna, scoring **deterministico** delle domande chiuse,
 * valutazione delle aperte tramite l'interfaccia `AiGrader`, validazione
 * rigorosa dell'output, merge nelle `evaluations`
 * senza sovrascrivere valutazioni esistenti, idempotenza via
 * `aiCorrectionRuns/{requestId}`. Tutti gli accessi Firestore passano da un
 * insieme di **porte** iniettate (implementate con l'Admin SDK nel wiring),
 * così il motore è testabile in isolamento senza rete né emulatore.
 *
 * Il motore resta provider-agnostic e non effettua **nessun** completamento o
 * restituzione automatica. Non si fida mai di testi/dati del client: il client invia solo
 * `verificationId`/`submissionIds`/`requestId`; domande, risposte e soluzioni
 * sono rilette server-side dalle porte.
 */

import { createHash, randomUUID } from 'node:crypto';
import {
  authorizeAndValidate,
  AiGatewayError,
  AiGraderFailure,
  AiGraderInvalidOutputError,
  buildMockGeneralFeedback,
  validateGeneralFeedback,
  MAX_GENERAL_FEEDBACK_CHARS,
  MAX_QUESTION_FEEDBACK_CHARS,
  type AiCorrectionAuthDeps,
  type AiCorrectionRequest,
  type AiEnabledFeatureMode,
  type AiGrader,
  type AiGraderAttemptStats,
  type AiGraderInput,
  type GradingMode,
} from './aiCorrectionGatewayCore.js';
import { isRealProviderEnabled, type AiRuntimeConfig } from './aiCorrectionRuntimeConfig.js';
import { enforceOperationLimits, type OperationLimitInput } from './aiCorrectionLimits.js';
import {
  estimateCostBreakdown,
  actualCostMicroUsd,
  normalizeUsageActual,
  microUsdToUsd,
} from './aiCorrectionCost.js';
import { dayKeyFromMs, monthKeyFromMs } from './aiCorrectionBudget.js';

// ── Limiti prudenti (guardie tecniche, non budget definitivi HG-M5-2/3) ──────

/** Max domande aperte inviate al grader per singola consegna. */
export const MAX_OPEN_QUESTIONS_PER_SUBMISSION = 50;
/** Max caratteri di una singola risposta aperta. */
export const MAX_ANSWER_CHARS = 20_000;
/** Max caratteri totali (domande+soluzioni+risposte) delle aperte di una consegna. */
export const MAX_TOTAL_OPEN_CHARS = 200_000;
/** Stima token: caratteri per token (approssimazione deterministica). */
export const CHARS_PER_TOKEN = 4;
/** Overhead fisso di token per domanda aperta (prompt/struttura). */
export const OPEN_QUESTION_TOKEN_OVERHEAD = 8;
/**
 * Quota di token stimata per l'**output del feedback generale** (M5-04B),
 * aggiunta una volta per consegna elaborabile. Deriva dal limite di lunghezza
 * (≤ 700 caratteri) diviso per {@link CHARS_PER_TOKEN}. Aggiunta **identica** in
 * preview e run, così le due stime coincidono.
 */
export const GENERAL_FEEDBACK_TOKEN_ESTIMATE = Math.ceil(
  MAX_GENERAL_FEEDBACK_CHARS / CHARS_PER_TOKEN,
);
/** Quota output stimata per ciascun feedback di domanda aperta. */
export const QUESTION_FEEDBACK_TOKEN_ESTIMATE = Math.ceil(
  MAX_QUESTION_FEEDBACK_CHARS / CHARS_PER_TOKEN,
);
/**
 * M5-05D2B-2 — timeout esplicito della Function `aiCorrectionRun` (s). Un batch
 * con retry (fino a 2 tentativi × 60 s + backoff) e concorrenza 3 può durare a
 * lungo: il timeout **non** è lasciato al default. Coerente con deadline/lease.
 */
export const AI_RUN_TIMEOUT_SECONDS = 540;
/**
 * Deadline **complessiva** monotona dell'invocazione (ms da inizio run): oltre
 * questa non si inizia alcun nuovo tentativo provider. Lascia margine, entro il
 * timeout della Function, per riconciliazione budget e finalizzazione del run.
 */
export const RUN_OVERALL_DEADLINE_MS = 500_000;
/** Margine finale riservato a reconcileBudget + finishRun dopo la deadline. */
export const RUN_FINALIZE_MARGIN_MS = 20_000;
/**
 * Durata della **lease** su `aiCorrectionRuns/{requestId}` (ms). Deve **coprire
 * l'intera invocazione autorizzata** (fino al timeout della Function) così la
 * lease non scade mentre il worker titolare sta ancora eseguendo un tentativo
 * consentito; una lease scaduta abilita il takeover di run abbandonati (crash).
 * M5-05D2B-2 la porta da 2 a 9 minuti perché il retry può allungare il run.
 */
export const RUN_LEASE_MS = AI_RUN_TIMEOUT_SECONDS * 1000;
/** Contratto privacy-minimal dei nuovi `aiCorrectionRuns`. */
export const AI_RUN_CONTRACT_VERSION = 2 as const;
/** Retention approvata da HG-M5-4; la policy TTL reale resta separata. */
export const AI_RUN_RETENTION_DAYS = 30;
export const RUN_RETENTION_MS = AI_RUN_RETENTION_DAYS * 24 * 60 * 60 * 1000;

// ── Tipi di dominio (locali al package functions, no dipendenze da apps/web) ──

export type QuestionTipo = 'aperta' | 'chiusa_singola' | 'chiusa_multipla';

/** POOL-SIMPLE v2 difficulty: integer 1–5. `maxPoints === difficolta`, no `peso`. */
export type PoolDifficultyV2 = 1 | 2 | 3 | 4 | 5;

export function isPoolDifficultyV2(value: unknown): value is PoolDifficultyV2 {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 5;
}

/**
 * Fail-closed POOL-SIMPLE v2 invariant on a frozen teacher-snapshot question:
 * `difficolta` must be an integer 1–5 and `maxPoints` must be finite and
 * exactly equal to it. Throws (never repairs) on an incoherent snapshot, so an
 * inconsistent delivery is never graded with wrong data — the provider is not
 * called and no correction is written.
 */
export function assertTeacherQuestionV2Invariant(q: {
  order: number;
  difficolta: unknown;
  maxPoints: unknown;
}): void {
  if (
    !isPoolDifficultyV2(q.difficolta) ||
    typeof q.maxPoints !== 'number' ||
    !Number.isFinite(q.maxPoints) ||
    q.maxPoints !== q.difficolta
  ) {
    throw new Error(
      `Snapshot incoerente per la domanda ${q.order}: richiesti difficoltà intera 1–5 e maxPoints === difficoltà (POOL-SIMPLE v2).`,
    );
  }
}

export interface TeacherQuestion {
  order: number;
  tipo: QuestionTipo;
  /** POOL-SIMPLE v2: integer 1–5, frozen at activation. `maxPoints === difficolta`. */
  difficolta: PoolDifficultyV2;
  maxPoints: number;
  testo: string;
  /**
   * Formato canonico (lesson-contract): **array** — `["id"]` per chiusa_singola,
   * `["id", ...]` per chiusa_multipla. Formato **legacy** tollerato: stringa
   * singola per chiusa_singola. La normalizzazione avviene nello scoring; i dati
   * persistiti **non** vengono mai modificati (nessuna migrazione automatica).
   */
  soluzione: string | string[];
  /**
   * ID di **tutte** le opzioni (dal `teacherSnapshot` congelato), necessari allo
   * scoring parziale delle chiuse multiple (M5-04C). Assente per le aperte.
   */
  optionIds?: string[];
}

/**
 * Maps one frozen `teacherSnapshot.questions[i]` document into a
 * `TeacherQuestion`, reading the POOL-SIMPLE v2 `difficolta` (1–5) alongside
 * `maxPoints` — no `peso`/`weight`. Fail-closed: an incoherent snapshot
 * (missing/invalid difficoltà, or `maxPoints !== difficolta`) throws, so the
 * gateway's `loadVerification` propagates it and the delivery is never graded
 * (no provider call, no correction write). No V1 tolerance. Pure — exported so
 * tests can exercise the real snapshot → TeacherQuestion → grader-input chain.
 */
export function mapSnapshotQuestionToTeacher(question: Record<string, unknown>): TeacherQuestion {
  // M5-04C: gli ID delle opzioni (dal teacherSnapshot congelato) servono allo
  // scoring parziale delle chiuse multiple. Nessuna lettura in più.
  const rawOptions = Array.isArray(question.opzioni) ? question.opzioni : null;
  const optionIds = rawOptions
    ? rawOptions
        .map((o) => (o as Record<string, unknown>)?.id)
        .filter((id): id is string => typeof id === 'string')
    : undefined;
  assertTeacherQuestionV2Invariant({
    order: question.order as number,
    difficolta: question.difficolta,
    maxPoints: question.maxPoints,
  });
  return {
    order: question.order as number,
    tipo: question.tipo as TeacherQuestion['tipo'],
    difficolta: question.difficolta as PoolDifficultyV2,
    maxPoints: question.maxPoints as number,
    testo: (question.testo as string) ?? '',
    soluzione: question.soluzione as string | string[],
    ...(optionIds ? { optionIds } : {}),
  };
}

export type SubmissionAnswer =
  | { tipo: 'aperta'; testo: string }
  | { tipo: 'chiusa_singola'; selectedId: string | null }
  | { tipo: 'chiusa_multipla'; selectedIds: string[] };

export interface VerificationData {
  ownerUid: string;
  status: string;
  /** teacherSnapshot.questions congelate; `null` se lo snapshot non è disponibile. */
  teacherQuestions: TeacherQuestion[] | null;
}

export interface SubmissionData {
  ownerUid: string;
  verificationId: string;
  studentUid: string;
  status: string;
  answers: Record<string, SubmissionAnswer | undefined>;
  /**
   * VEX-02B: presente solo in `equivalent_variants`. Gli `order` assegnati a
   * QUESTA consegna: la correzione IA usa esclusivamente queste domande dello
   * snapshot. Assente ⇒ `same_questions` (tutte le domande, invariato).
   */
  assignedQuestionOrders?: number[];
}

export interface ExistingEvaluation {
  order: number;
  points: number | null;
  maxPoints: number;
  feedback?: string;
}

export interface CorrectionData {
  status: 'in_progress' | 'completed' | 'returned';
  evaluations: Record<string, ExistingEvaluation>;
  reopenCount: number;
}

// ── Esiti / codici ────────────────────────────────────────────────────────────

export type ExclusionCode =
  | 'not_found'
  | 'wrong_owner'
  | 'wrong_verification'
  | 'not_submitted'
  | 'snapshot_unavailable'
  | 'correction_not_in_progress'
  | 'nothing_to_grade'
  | 'too_large'
  | 'changed_since_preview'
  | 'write_error'
  // VEX-02B — assegnazione della variante mancante/malformata: la consegna è
  // esclusa (nessuna chiamata provider, nessuna prenotazione budget, nessun
  // punteggio), le altre proseguono.
  | 'invalid_variant'
  // M5-05D2B-2 — esiti tecnici del provider reale (retry/deadline), privacy-safe.
  | 'deadline_exceeded'
  | 'rate_limited'
  | 'provider_timeout'
  | 'provider_unavailable'
  | 'retry_after_exceeded';

export type SubmissionOutcome = 'succeeded' | 'partial' | 'excluded' | 'failed';

export interface SubmissionResult {
  submissionId: string;
  outcome: SubmissionOutcome;
  closedGraded: number;
  openGraded: number;
  openSkipped: number;
  /** Chiuse non valutate perché soluzione/opzioni malformate (M5-04C). */
  closedSkipped: number;
  alreadyIgnored: number;
  reason?: ExclusionCode;
}

export interface AiCorrectionCounts {
  selected: number;
  eligible: number;
  excluded: number;
  closedToGrade: number;
  openToGrade: number;
  closedOnlySubmissions: number;
  alreadyGradedIgnored: number;
}

/**
 * M5-05D2B-1 — ripartizione **stimata** dei token e costo stimato in micro-USD
 * interi. `tokensEstimated` (totale) è mantenuto per compatibilità e coincide con
 * `totalTokensEstimated`. `costEstimated` (USD) è la comodità di
 * visualizzazione, derivata da `costEstimatedMicroUsd`. Mock e sole-chiuse: 0.
 */
export interface CostEstimateFields {
  inputTokensEstimated: number;
  outputTokensEstimated: number;
  totalTokensEstimated: number;
  costEstimatedMicroUsd: number;
}

/** M5-05D2B-1 — ripartizione **effettiva** dei token e costo reale in micro-USD. */
export interface CostActualFields {
  inputTokensActual: number;
  outputTokensActual: number;
  totalTokensActual: number;
  costActualMicroUsd: number;
}

export interface AiCorrectionPreviewResponse extends CostEstimateFields {
  mode: AiEnabledFeatureMode;
  phase: 'preview';
  requestId: string;
  verificationId: string;
  counts: AiCorrectionCounts;
  tokensEstimated: number;
  /** USD (compat dialog); micro-USD è la fonte autoritativa. */
  costEstimated: number;
  excluded: { submissionId: string; reason: ExclusionCode }[];
}

export interface AiCorrectionRunResponse extends CostEstimateFields, CostActualFields {
  mode: AiEnabledFeatureMode;
  phase: 'run';
  requestId: string;
  verificationId: string;
  status: RunStatus;
  idempotentReplay: boolean;
  counts: AiCorrectionCounts & {
    succeeded: number;
    partial: number;
    failed: number;
  };
  tokensEstimated: number;
  tokensActual: number;
  /** USD (compat dialog); micro-USD è la fonte autoritativa. */
  costEstimated: number;
  costActual: number;
  /**
   * M5-05D2B-1 — tetto **conservativo** realmente prenotato sul ledger (micro-USD).
   * Distinto da `costEstimatedMicroUsd` (stima informativa UI): garantisce
   * `costActualMicroUsd ≤ costReservationMicroUsd`. 0 su mock/sole-chiuse.
   */
  costReservationMicroUsd: number;
  /**
   * M5-05D2B-2 — costo **contabilizzato prudenziale** in micro-USD: costo
   * effettivo noto + tetto prudente dei tentativi dal costo **incerto** (timeout/
   * abort/5xx dopo l'invio senza usage noto). È il valore addebitato al ledger.
   * Invariante: `costActualMicroUsd ≤ costSettledMicroUsd ≤ costReservationMicroUsd`.
   */
  costSettledMicroUsd: number;
  /** M5-05D2B-2 — telemetria tecnica aggregata dei retry (privacy-safe). */
  retry: RunRetryTelemetry;
  results: SubmissionResult[];
}

/** Telemetria aggregata dei tentativi/retry di un'operazione (nessun dato personale). */
export interface RunRetryTelemetry {
  attemptsTotal: number;
  retriesTotal: number;
  retryReasonCodes: string[];
  retryDelayTotalMs: number;
  unknownBillingAttempts: number;
}

export type RunStatus = 'running' | 'completed' | 'partial' | 'failed';

// ── Helpers puri: scoring chiuse, quarti, insiemi ────────────────────────────

/** Multiplo esatto di 0,25 (confronto nel dominio intero per evitare rumore FP). */
export function isQuarterStep(points: number): boolean {
  if (!Number.isFinite(points)) return false;
  const quarters = points * 4;
  return Math.abs(quarters - Math.round(quarters)) < 1e-9;
}

/** Uguaglianza insiemistica (indipendente da ordine e duplicati). */
export function sameIdSet(a: readonly string[], b: readonly string[]): boolean {
  const sa = new Set(a);
  const sb = new Set(b);
  if (sa.size !== sb.size) return false;
  for (const x of sa) if (!sb.has(x)) return false;
  return true;
}

/** Arrotonda al multiplo di 0,25 più vicino e clampa in `[0, max]`. */
function roundToQuarterClamped(value: number, max: number): number {
  const quarters = Math.round(value * 4);
  const points = quarters / 4;
  return Math.min(Math.max(points, 0), max);
}

/**
 * Normalizza la soluzione di una **chiusa singola** (M5-04C, root cause):
 * - canonico `["id"]` → `"id"`;
 * - legacy `"id"` (stringa non vuota) → `"id"`;
 * - assente, vuota, con più di un elemento o malformata → `null` (**non
 *   valutabile**: mai uno zero ingiusto). Non modifica i dati persistiti.
 */
export function normalizeSingleSolution(soluzione: unknown): string | null {
  if (typeof soluzione === 'string') return soluzione.length > 0 ? soluzione : null;
  if (
    Array.isArray(soluzione) &&
    soluzione.length === 1 &&
    typeof soluzione[0] === 'string' &&
    soluzione[0].length > 0
  ) {
    return soluzione[0];
  }
  return null;
}

/**
 * Normalizza la soluzione di una **chiusa multipla**: array di ID non vuoti
 * (deduplicati). Formato non-array, vuoto o con elementi non stringa → `null`
 * (**non valutabile**). Non modifica i dati persistiti.
 */
export function normalizeMultiSolution(soluzione: unknown): string[] | null {
  if (!Array.isArray(soluzione)) return null;
  if (!soluzione.every((s) => typeof s === 'string')) return null;
  const ids = [...new Set((soluzione as string[]).filter((s) => s.length > 0))];
  return ids.length > 0 ? ids : null;
}

/**
 * Esito dello scoring di una domanda chiusa (M5-04C): valutabile con punti +
 * feedback deterministico, oppure **non valutabile** (soluzione/opzioni
 * malformate) → la domanda resta `points: null`, mai uno zero ingiusto.
 */
export type ClosedScoreResult =
  | { evaluable: true; points: number; feedback: string }
  | { evaluable: false };

/**
 * Scoring **deterministico** delle domande chiuse (M5-04C), **zero** grader/
 * token/costo, sempre `points ∈ [0, maxPoints]` e multiplo di 0,25, con
 * **feedback** sintetico basato solo sui conteggi (mai ID o testi di soluzione).
 *
 * - **chiusa_singola** (tutto-o-niente): `selectedId` = soluzione normalizzata →
 *   `maxPoints`; diverso → `0`; non compilata → `0`. Soluzione malformata → non
 *   valutabile.
 * - **chiusa_multipla con UNA sola risposta canonica**: si comporta come una
 *   scelta singola (tutto-o-niente), anche se il tipo tecnico è multiplo. Solo
 *   la selezione della sola opzione corretta → `maxPoints`; qualsiasi altra
 *   selezione (errata, corretta + una o più extra, o più di un'opzione) → `0`.
 * - **chiusa_multipla con DUE o più risposte canoniche** (punteggio **parziale**
 *   equo): premia le corrette e penalizza le errate —
 *   `reward = correctSelected/correctTotal`,
 *   `penalty = wrongTotal>0 ? wrongSelected/wrongTotal : 0`,
 *   `raw = clamp(reward − penalty, 0, 1)`, `points = round₀.₂₅(maxPoints·raw)`.
 *   ID sconosciuti/duplicati/ordine non danno vantaggi. Soluzione/opzioni
 *   incoerenti → non valutabile.
 */
export function scoreClosedQuestion(
  question: TeacherQuestion,
  answer: SubmissionAnswer | undefined,
): ClosedScoreResult {
  if (question.tipo === 'chiusa_singola') {
    const solution = normalizeSingleSolution(question.soluzione);
    if (solution === null) return { evaluable: false };
    const selected = answer && answer.tipo === 'chiusa_singola' ? answer.selectedId : null;
    if (selected === null) return { evaluable: true, points: 0, feedback: 'Risposta non fornita.' };
    return selected === solution
      ? { evaluable: true, points: question.maxPoints, feedback: 'Risposta corretta.' }
      : { evaluable: true, points: 0, feedback: 'Risposta non corretta.' };
  }

  if (question.tipo === 'chiusa_multipla') {
    const correctIds = normalizeMultiSolution(question.soluzione);
    const optionIds = normalizeMultiSolution(question.optionIds);
    // Opzioni assenti/malformate, o soluzione non contenuta nelle opzioni →
    // dati incoerenti → non valutabile (mai uno zero ingiusto).
    if (correctIds === null || optionIds === null) return { evaluable: false };
    const optionSet = new Set(optionIds);
    if (!correctIds.every((id) => optionSet.has(id))) return { evaluable: false };

    const selected = new Set(answer && answer.tipo === 'chiusa_multipla' ? answer.selectedIds : []);
    if (selected.size === 0)
      return { evaluable: true, points: 0, feedback: 'Risposta non fornita.' };

    // Una sola risposta canonica: comportamento tutto-o-niente anche se il
    // tipo tecnico è multiplo. «Corretta + extra» non riceve credito parziale.
    if (correctIds.length === 1) {
      const onlyCorrect = correctIds[0];
      const hasCorrect = selected.has(onlyCorrect);
      if (selected.size === 1 && hasCorrect) {
        return { evaluable: true, points: question.maxPoints, feedback: 'Risposta corretta.' };
      }
      const feedback =
        hasCorrect && selected.size > 1
          ? 'La risposta corretta è stata selezionata insieme a una o più opzioni errate; la selezione non è quindi valida.'
          : 'Risposta non corretta.';
      return { evaluable: true, points: 0, feedback };
    }

    const correctSet = new Set(correctIds);
    let correctSelected = 0;
    let wrongSelected = 0;
    for (const id of selected) {
      if (correctSet.has(id)) correctSelected++;
      else wrongSelected++; // ID errati, sconosciuti o manipolati: selezione errata
    }
    const correctTotal = correctSet.size;
    const wrongTotal = optionSet.size - correctTotal;
    const rewardRatio = correctSelected / correctTotal;
    const penaltyRatio = wrongTotal > 0 ? wrongSelected / wrongTotal : 0;
    const rawRatio = Math.min(Math.max(rewardRatio - penaltyRatio, 0), 1);
    const points = roundToQuarterClamped(question.maxPoints * rawRatio, question.maxPoints);

    const feedback =
      correctSelected === correctTotal && wrongSelected === 0
        ? 'Tutte le risposte corrette sono state selezionate.'
        : `${correctSelected} ${correctSelected === 1 ? 'risposta corretta' : 'risposte corrette'} su ${correctTotal}; ${wrongSelected} ${wrongSelected === 1 ? 'selezione errata' : 'selezioni errate'}.`;
    return { evaluable: true, points, feedback };
  }

  return { evaluable: false };
}

// ── Eleggibilità ──────────────────────────────────────────────────────────────

export interface EligibleSubmission {
  submissionId: string;
  studentUid: string;
  /** order delle chiuse ancora da valutare (points === null). */
  closedOrders: number[];
  /** order delle aperte ancora da valutare (points === null). */
  openOrders: number[];
  /** Quante domande hanno già `points !== null` (ignorate, mai sovrascritte). */
  alreadyGraded: number;
  /** Somma dei punti delle domande già valutate (per il totale finale, M5-04B). */
  alreadyGradedPoints: number;
  /** Punteggio massimo totale della consegna (tutte le domande, M5-04B). */
  totalMaxPoints: number;
  /** Scheletro completo (tutte le domande) per creare la correction se assente. */
  skeleton: { order: number; maxPoints: number }[];
}

export type Classification =
  | { status: 'eligible'; eligible: EligibleSubmission }
  | { status: 'excluded'; code: ExclusionCode };

/**
 * Classifica una consegna come **elaborabile** o **esclusa** con codice. Non
 * scrive nulla, non chiama il grader. Le consegne con **sole chiuse** non
 * valutate sono elaborabili. Una consegna è esclusa quando: non esiste, owner
 * diverso, verifica diversa, non `submitted`, snapshot assente, correction
 * esistente non `in_progress`, nessuna domanda ancora valutabile, o oltre i
 * limiti prudenti.
 */
export function classifySubmission(params: {
  submissionId: string;
  expectedOwner: string;
  expectedVerificationId: string;
  teacherQuestions: TeacherQuestion[] | null;
  submission: SubmissionData | null;
  correction: CorrectionData | null;
}): Classification {
  const { submissionId, expectedOwner, expectedVerificationId, teacherQuestions } = params;
  const { submission, correction } = params;

  if (!submission) return { status: 'excluded', code: 'not_found' };
  if (submission.ownerUid !== expectedOwner) return { status: 'excluded', code: 'wrong_owner' };
  if (submission.verificationId !== expectedVerificationId) {
    return { status: 'excluded', code: 'wrong_verification' };
  }
  if (submission.status !== 'submitted') return { status: 'excluded', code: 'not_submitted' };
  if (!teacherQuestions || teacherQuestions.length === 0) {
    return { status: 'excluded', code: 'snapshot_unavailable' };
  }
  if (correction && correction.status !== 'in_progress') {
    return { status: 'excluded', code: 'correction_not_in_progress' };
  }

  // VEX-02B — restringe le domande alla SOLA variante assegnata alla consegna.
  // Fail-closed: order assegnato mancante nello snapshot o duplicato ⇒ esclusa
  // (`invalid_variant`), così non arriva mai al grader né alla prenotazione
  // budget, e le altre consegne del batch proseguono. `same_questions` (campo
  // assente) usa tutte le domande, invariato.
  let applicableQuestions = teacherQuestions;
  if (submission.assignedQuestionOrders !== undefined) {
    const assignedOrders = submission.assignedQuestionOrders;
    const byOrderAll = new Map(teacherQuestions.map((q) => [q.order, q]));
    const seen = new Set<number>();
    const filtered: TeacherQuestion[] = [];
    for (const order of assignedOrders) {
      if (!Number.isInteger(order) || !byOrderAll.has(order) || seen.has(order)) {
        return { status: 'excluded', code: 'invalid_variant' };
      }
      seen.add(order);
      filtered.push(byOrderAll.get(order)!);
    }
    if (filtered.length === 0) return { status: 'excluded', code: 'invalid_variant' };
    applicableQuestions = filtered;
  }

  const skeleton = applicableQuestions.map((q) => ({ order: q.order, maxPoints: q.maxPoints }));
  const totalMaxPoints = applicableQuestions.reduce((sum, q) => sum + q.maxPoints, 0);
  const closedOrders: number[] = [];
  const openOrders: number[] = [];
  let alreadyGraded = 0;
  let alreadyGradedPoints = 0;
  let openCharTotal = 0;

  for (const q of applicableQuestions) {
    const key = q.order.toString();
    const existing = correction?.evaluations[key];
    if (existing && existing.points !== null) {
      alreadyGraded++;
      alreadyGradedPoints += existing.points;
      continue; // già valutata: mai sovrascritta
    }
    if (q.tipo === 'aperta') {
      const answer = submission.answers[key];
      const answerText = answer && answer.tipo === 'aperta' ? answer.testo : '';
      if (answerText.length > MAX_ANSWER_CHARS) return { status: 'excluded', code: 'too_large' };
      const sol = typeof q.soluzione === 'string' ? q.soluzione : '';
      openCharTotal += q.testo.length + sol.length + answerText.length;
      openOrders.push(q.order);
    } else {
      closedOrders.push(q.order);
    }
  }

  if (openOrders.length > MAX_OPEN_QUESTIONS_PER_SUBMISSION) {
    return { status: 'excluded', code: 'too_large' };
  }
  if (openCharTotal > MAX_TOTAL_OPEN_CHARS) {
    return { status: 'excluded', code: 'too_large' };
  }
  if (closedOrders.length === 0 && openOrders.length === 0) {
    return { status: 'excluded', code: 'nothing_to_grade' };
  }

  return {
    status: 'eligible',
    eligible: {
      submissionId,
      studentUid: submission.studentUid,
      closedOrders,
      openOrders,
      alreadyGraded,
      alreadyGradedPoints,
      totalMaxPoints,
      skeleton,
    },
  };
}

/**
 * Stima **deterministica** dei token per le sole domande aperte di una consegna.
 * Include **domanda + soluzione di riferimento + risposta dello studente** +
 * overhead fisso per domanda. È la **stessa** formula usata da preview e run
 * (`tokensEstimated`), così la stima è identica a parità di selezione e dati.
 */
export function estimateOpenTokensForSubmission(
  questions: TeacherQuestion[],
  openOrders: number[],
  answers: Record<string, SubmissionAnswer | undefined>,
): number {
  const byOrder = new Map(questions.map((q) => [q.order, q]));
  let tokens = 0;
  for (const order of openOrders) {
    const q = byOrder.get(order);
    if (!q) continue;
    const sol = typeof q.soluzione === 'string' ? q.soluzione : '';
    const answer = answers[order.toString()];
    const answerText = answer && answer.tipo === 'aperta' ? answer.testo : '';
    const chars = q.testo.length + sol.length + answerText.length;
    tokens += Math.ceil(chars / CHARS_PER_TOKEN) + OPEN_QUESTION_TOKEN_OVERHEAD;
  }
  return tokens;
}

/** Quota input della guida docente, ripetuta una volta per chiamata/consegna. */
export function estimateTeacherGuidanceTokens(teacherGuidance?: string): number {
  return teacherGuidance ? Math.ceil(teacherGuidance.length / CHARS_PER_TOKEN) : 0;
}

/**
 * Quota input dello `gradingMode` (M5-QUALITY-01): piccola stringa costante
 * inviata una volta per chiamata/consegna. Inclusa in modo identico in preview e
 * run così la stima resta coerente col piccolo testo aggiuntivo realmente inviato.
 */
export function estimateGradingModeTokens(gradingMode: GradingMode): number {
  return Math.ceil(gradingMode.length / CHARS_PER_TOKEN);
}

// ── Validazione output del grader ─────────────────────────────────────────────

export interface ValidatedScore {
  points: number;
  feedback?: string;
}

/**
 * Valida **server-side** l'output del grader senza fidarsene mai. Scarta le
 * singole domande invalide (restano `points: null`), ignora order estranei e
 * duplicati, non corrompe mai la correction. Se il `requestId` non combacia,
 * l'intero output è scartato (mappa vuota).
 */
export function validateGraderOutput(
  output: { requestId: string; results: { order: number; points: number; feedback?: string }[] },
  requestId: string,
  eligibleOpenOrders: Set<number>,
  maxPointsByOrder: Map<number, number>,
): Map<number, ValidatedScore> {
  const valid = new Map<number, ValidatedScore>();
  if (!output || output.requestId !== requestId || !Array.isArray(output.results)) {
    return valid;
  }
  const seen = new Set<number>();
  for (const r of output.results) {
    if (typeof r !== 'object' || r === null) continue;
    const { order, points, feedback } = r;
    if (typeof order !== 'number' || !eligibleOpenOrders.has(order)) continue; // estraneo
    if (seen.has(order)) continue; // duplicato
    seen.add(order);
    const maxPoints = maxPointsByOrder.get(order);
    if (maxPoints === undefined) continue;
    if (typeof points !== 'number' || !Number.isFinite(points)) continue;
    if (points < 0 || points > maxPoints) continue;
    if (!isQuarterStep(points)) continue;
    if (feedback !== undefined) {
      if (typeof feedback !== 'string' || feedback.length > MAX_QUESTION_FEEDBACK_CHARS) continue;
    }
    valid.set(order, { points, ...(feedback !== undefined ? { feedback } : {}) });
  }
  return valid;
}

// ── Selezione canonica e hash (per idempotenza, non contenuti) ───────────────

/** Ordine canonico server-side, indipendente dall'ordine delle checkbox. */
export function canonicalizeSubmissionIds(submissionIds: readonly string[]): string[] {
  return [...submissionIds].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * SHA-256 di verifica, selezione canonica e criteri pedagogici (`gradingMode` +
 * `teacherGuidance`); nessun testo è persistito, solo il digest. Includere
 * `gradingMode` e la guidance rende l'idempotenza sensibile ai criteri: stesso
 * `requestId` con stile o indicazioni diversi ⇒ hash diverso ⇒ conflitto
 * (`invalid_input`), mai un replay silenzioso con criteri differenti (M5-QUALITY-01).
 */
export function computeSelectionHash(
  verificationId: string,
  submissionIds: string[],
  gradingMode: GradingMode,
  teacherGuidance?: string,
): string {
  const canonical = JSON.stringify([
    verificationId,
    canonicalizeSubmissionIds(submissionIds),
    gradingMode,
    teacherGuidance ?? '',
  ]);
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

// ── Porte (implementate con Admin SDK nel wiring) ─────────────────────────────

export interface CommitSubmissionInput {
  submissionId: string;
  ownerUid: string;
  verificationId: string;
  studentUid: string;
  actorUid: string;
  skeleton: { order: number; maxPoints: number }[];
  /** order → punteggio proposto (chiuse + aperte validate). */
  proposed: Map<number, ValidatedScore>;
  /**
   * Feedback generale candidato (M5-04B), o `null`. La porta lo scrive nel campo
   * `generalFeedback` **solo se**, dopo il merge, la consegna risulta interamente
   * valutata **e** il docente non ne ha già scritto uno (mai sovrascritto).
   */
  proposedGeneralFeedback: string | null;
}

export interface CommitSubmissionResult {
  result: 'written' | 'changed';
  /** order effettivamente scritti in questa esecuzione (erano null → valorizzati). */
  writtenOrders: number[];
}

export interface EngineReadPorts {
  loadVerification: (verificationId: string) => Promise<VerificationData | null>;
  loadSubmission: (submissionId: string) => Promise<SubmissionData | null>;
  loadCorrection: (submissionId: string) => Promise<CorrectionData | null>;
}

export interface PersistedSubmissionResult {
  ordinal: number;
  status: SubmissionOutcome;
  reasonCode?: ExclusionCode;
}

export interface PersistedRun {
  runContractVersion: typeof AI_RUN_CONTRACT_VERSION;
  status: RunStatus;
  selectionHash: string;
  mode: AiEnabledFeatureMode;
  counts: AiCorrectionRunResponse['counts'];
  // M5-05D2B-1 — solo metadata aggregati di costo. Nessun ID/UID/PII/contenuto.
  inputTokensEstimated: number;
  outputTokensEstimated: number;
  tokensEstimated: number;
  costEstimatedMicroUsd: number;
  inputTokensActual: number;
  outputTokensActual: number;
  tokensActual: number;
  costActualMicroUsd: number;
  costReservationMicroUsd: number;
  // M5-05D2B-2 — costo prudenziale contabilizzato + telemetria retry aggregata.
  costSettledMicroUsd: number;
  retry: RunRetryTelemetry;
  resultOrdinals: PersistedSubmissionResult[];
}

/** Metadata (solo) scritti alla creazione del run doc. */
export interface BeginRunMeta {
  selectionHash: string;
  submissionCount: number;
  provider: string;
  model?: string;
  configVersion?: string;
  priceListVersion?: string;
  /** Identificatore del tentativo che prova ad acquisire la lease. */
  executionId: string;
  /** Durata della lease (ms) da applicare in caso di acquisizione. */
  leaseMs: number;
  /** Clock server-side iniettato per lease e retention deterministiche nei test. */
  nowMs: number;
  /** Scadenza tecnica DEV; non implica cancellazione finché TTL non è configurato. */
  expireAtMs: number;
}

/**
 * Esito **atomico** di `beginRun` (transazione su `aiCorrectionRuns/{requestId}`):
 * - `acquired`: questo tentativo possiede ora la lease (`executionId`) — può
 *   elaborare. Avviene quando il run è assente **o** era `running` con lease
 *   **scaduta** (takeover di un run abbandonato).
 * - `completed`: run già concluso con risultato ordinale → replay idempotente.
 * - `locked`: run `running` con lease **valida** posseduta da un altro
 *   tentativo → NON elaborare (niente grader, niente commit).
 * - `conflict`: stesso `requestId`, selezione diversa.
 */
export type BeginRunResult =
  | { state: 'acquired'; executionId: string }
  | { state: 'completed'; existing: PersistedRun }
  | { state: 'locked' }
  | { state: 'conflict' }
  | { state: 'legacy' };

export interface EngineWritePorts extends EngineReadPorts {
  /**
   * Acquisisce/riconosce `aiCorrectionRuns/{requestId}` in **una transazione**
   * atomica, applicando la semantica di lease descritta in `BeginRunResult`.
   */
  beginRun: (requestId: string, meta: BeginRunMeta) => Promise<BeginRunResult>;
  /**
   * Finalizza `aiCorrectionRuns/{requestId}` con stato + risultato (solo
   * metadata) **solo se** `executionId` è ancora il proprietario della lease.
   * Un worker vecchio (lease già presa da un altro tentativo) è un **no-op** e
   * non può sovrascrivere il risultato del tentativo successivo.
   */
  finishRun: (requestId: string, run: PersistedRun & { executionId: string }) => Promise<void>;
  /**
   * Scrive la correction (create se assente, merge non distruttivo se
   * `in_progress`) e il mirror `submissions/{id}.correctionSummary` in **una
   * transazione atomica** per consegna. Rilegge la correction dentro la
   * transazione: se non è più assente/`in_progress` → `changed`.
   */
  commitSubmission: (input: CommitSubmissionInput) => Promise<CommitSubmissionResult>;
  /**
   * M5-05D2B-1 — prenota atomicamente `amountMicroUsd` sul ledger mensile
   * `aiBudgetLedger/{monthKey}` **prima** della chiamata provider. Idempotente su
   * `requestId` (retry/replay/concorrenza non raddoppiano). Rifiuta
   * `budget_exceeded` se la disponibilità è insufficiente (hard stop 100%). La
   * prenotazione scade a `expiresAtMs` (recovery senza scheduler). Richiesta solo
   * sul percorso provider reale con importo positivo.
   */
  reserveBudget?: (input: ReserveBudgetInput) => Promise<ReserveBudgetResult>;
  /**
   * M5-05D2B-1 — transizione `reserved → pending` per `requestId`, **subito prima**
   * della prima chiamata provider, in **una transazione** gated dalla titolarità
   * della lease (`executionId`). Ritorna `true` se questo worker è ancora il
   * titolare (può procedere), `false` altrimenti (takeover avvenuto ⇒ non
   * elaborare). Da qui la prenotazione non è più liberabile per sola scadenza.
   */
  markBudgetInvoked?: (input: MarkBudgetInvokedInput) => Promise<boolean>;
  /**
   * M5-05D2B-1 — riconcilia la prenotazione di `requestId` col costo **effettivo**
   * (libera l'eccedenza) in **una transazione** che verifica prima la titolarità
   * della lease (`executionId`): un worker vecchio dopo un takeover è un **no-op**
   * e non tocca la prenotazione del nuovo worker. Idempotente.
   */
  reconcileBudget?: (input: ReconcileBudgetInput) => Promise<void>;
}

/** Input di prenotazione budget (transazione su `aiBudgetLedger/{monthKey}`). */
export interface ReserveBudgetInput {
  requestId: string;
  amountMicroUsd: number;
  budgetMicroUsd: number;
  dailyBudgetMicroUsd: number;
  monthKey: string;
  dayKey: string;
  nowMs: number;
  expiresAtMs: number;
}

export type ReserveBudgetResult =
  | { ok: true; reservedMicroUsd: number }
  | { ok: false; reason: 'daily_budget_exceeded' | 'budget_exceeded' };

/** Input della transizione `reserved → pending` (gated dall'`executionId`). */
export interface MarkBudgetInvokedInput {
  requestId: string;
  budgetMicroUsd: number;
  dailyBudgetMicroUsd: number;
  monthKey: string;
  nowMs: number;
  executionId: string;
}

/** Input di riconciliazione budget, con `executionId` per il gate di titolarità. */
export interface ReconcileBudgetInput {
  requestId: string;
  actualMicroUsd: number;
  budgetMicroUsd: number;
  dailyBudgetMicroUsd: number;
  monthKey: string;
  nowMs: number;
  executionId: string;
}

// ── Concorrenza limitata ──────────────────────────────────────────────────────

/** Grado di parallelismo prudente sul processing delle consegne. */
export const SUBMISSION_CONCURRENCY = 3;

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]!, i);
    }
  });
  await Promise.all(workers);
  return results;
}

// ── Guardrail server-side del provider reale (M5-05D1) ────────────────────────

/**
 * Porta che legge la configurazione runtime `settings/aiConfig` (Admin SDK, una
 * `get` puntuale per operazione, nessun listener). È iniettata: il motore resta
 * puro. Ritorna `null` se il documento è assente/malformato (fail-closed).
 */
export type LoadRuntimeConfig = () => Promise<AiRuntimeConfig | null>;

/** Conteggi/stime per consegna eleggibile, per l'enforcement dei limiti DEV. */
interface EligiblePreflightItem {
  openQuestionCount: number;
  estimatedTokens: number;
}

interface ClassifiedPreflightItem {
  submissionId: string;
  submission: SubmissionData | null;
  classification: Classification;
  openTokens: number;
}

interface OperationPreflight {
  teacherQuestions: TeacherQuestion[] | null;
  classifications: ClassifiedPreflightItem[];
  eligibleLimits: EligiblePreflightItem[];
  /**
   * Ripartizione token **stimata** aggregata sulle consegne eleggibili (input =
   * prompt: domanda+soluzione+risposta; output = quota feedback generale). Base
   * **conservativa** della prenotazione budget, calcolata prima della lease.
   */
  estimate: { inputTokens: number; outputTokens: number };
}

/**
 * Guardrail **obbligatorio** eseguito solo sul percorso del provider **reale**
 * (`featureMode === 'openai'`), nel preflight, **prima** di lease/grader/scrittura:
 *
 * 1. **Kill switch senza deploy**: legge `settings/aiConfig`; se assente,
 *    malformato o `enabled=false` ⇒ `feature_disabled` (nessun fallback silente
 *    al mock). Nessuna configurazione sensibile è mai esposta al client.
 * 2. **Limiti prudenziali DEV** applicati server-side sulla selezione eleggibile.
 *
 * Mock e modalità `disabled` non passano di qui: restano a costo zero e
 * deterministiche, con comportamento invariato.
 */
async function loadEnabledRealProviderConfig(
  loadRuntimeConfig: LoadRuntimeConfig | undefined,
): Promise<AiRuntimeConfig> {
  const config = (await loadRuntimeConfig?.()) ?? null;
  if (!isRealProviderEnabled(config)) {
    throw new AiGatewayError(
      'feature_disabled',
      'Il provider IA reale non è abilitato dalla configurazione runtime.',
    );
  }
  return config;
}

function enforceRealProviderLimits(
  config: AiRuntimeConfig,
  eligible: EligiblePreflightItem[],
): void {
  const input: OperationLimitInput = {
    eligibleSubmissionCount: eligible.length,
    perSubmission: eligible.map((e) => ({
      openQuestionCount: e.openQuestionCount,
      estimatedTokens: e.estimatedTokens,
    })),
    totalEstimatedTokens: eligible.reduce((sum, e) => sum + e.estimatedTokens, 0),
  };
  enforceOperationLimits(config.limits, input);
}

async function buildOperationPreflight(
  request: AiCorrectionRequest,
  ownerUid: string,
  ports: EngineReadPorts,
): Promise<OperationPreflight> {
  const verification = await ports.loadVerification(request.verificationId);
  const teacherQuestions = resolveTeacherQuestions(verification, ownerUid);
  const classifications = await mapWithConcurrency(
    request.submissionIds,
    SUBMISSION_CONCURRENCY,
    async (submissionId): Promise<ClassifiedPreflightItem> => {
      const [submission, correction] = await Promise.all([
        ports.loadSubmission(submissionId),
        ports.loadCorrection(submissionId),
      ]);
      const classification = classifySubmission({
        submissionId,
        expectedOwner: ownerUid,
        expectedVerificationId: request.verificationId,
        teacherQuestions,
        submission,
        correction,
      });
      const openTokens =
        classification.status === 'eligible'
          ? estimateOpenTokensForSubmission(
              teacherQuestions ?? [],
              classification.eligible.openOrders,
              submission?.answers ?? {},
            )
          : 0;
      return { submissionId, submission, classification, openTokens };
    },
  );
  const eligibleLimits: EligiblePreflightItem[] = [];
  let inputTokens = 0;
  let outputTokens = 0;
  for (const item of classifications) {
    if (item.classification.status !== 'eligible') continue;
    const eligible = item.classification.eligible;
    const hasOpen = eligible.openOrders.length > 0;
    const criteriaTokens = hasOpen
      ? estimateTeacherGuidanceTokens(request.teacherGuidance) +
        estimateGradingModeTokens(request.gradingMode)
      : 0;
    const outputEstimate = hasOpen
      ? eligible.openOrders.length * QUESTION_FEEDBACK_TOKEN_ESTIMATE +
        GENERAL_FEEDBACK_TOKEN_ESTIMATE
      : 0;
    inputTokens += item.openTokens + criteriaTokens;
    outputTokens += outputEstimate;
    eligibleLimits.push({
      openQuestionCount: eligible.openOrders.length,
      estimatedTokens: item.openTokens + criteriaTokens + outputEstimate,
    });
  }
  return {
    teacherQuestions,
    classifications,
    eligibleLimits,
    estimate: { inputTokens, outputTokens },
  };
}

/**
 * Costruisce l'`AiGraderInput` per le aperte di una consegna. **Unico** punto di
 * costruzione, riusato sia per il payload reale (grading) sia per il calcolo del
 * tetto di prenotazione, così il bound stima **l'esatto** payload inviato.
 */
export function buildGraderInput(
  requestId: string,
  openOrders: number[],
  byOrder: Map<number, TeacherQuestion>,
  answers: Record<string, SubmissionAnswer | undefined>,
  priorPoints: number,
  totalMaxPoints: number,
  gradingMode: GradingMode,
  teacherGuidance?: string,
): AiGraderInput {
  return {
    requestId,
    questions: openOrders.map((order) => {
      const q = byOrder.get(order)!;
      const answer = answers[order.toString()];
      return {
        order,
        // POOL-SIMPLE v2: difficoltà 1–5 propagated to the payload; maxPoints === difficolta.
        // The V2 invariant is enforced fail-closed upstream, when the gateway maps
        // the frozen teacher snapshot (mapSnapshotQuestionToTeacher).
        difficulty: q.difficolta,
        maxPoints: q.maxPoints,
        questionText: q.testo,
        referenceSolution: typeof q.soluzione === 'string' ? q.soluzione : '',
        studentAnswer: answer && answer.tipo === 'aperta' ? answer.testo : '',
      };
    }),
    submissionContext: { priorPoints, totalMaxPoints },
    gradingMode,
    ...(teacherGuidance ? { teacherGuidance } : {}),
  };
}

/**
 * Tetto di prenotazione **conservativo** in micro-USD sul percorso reale: per
 * ogni consegna con aperte (una chiamata provider) somma il **massimo output**
 * ammesso dal grader e un **upper bound provabile dell'input** dell'esatto
 * payload. Arrotondamento `ceil`. Poiché output effettivo ≤ max e input effettivo
 * ≤ bound, vale sempre `costActualMicroUsd ≤ reservedMicroUsd` per ogni risposta
 * valida entro i limiti consentiti.
 */
/** Tetto **per singolo tentativo** (input upper bound + max output) di una consegna. */
function perAttemptBoundTokens(
  grader: AiGrader,
  graderInput: AiGraderInput,
): { inputTokens: number; outputTokens: number } {
  return {
    inputTokens: grader.reservationInputTokenUpperBound?.(graderInput) ?? 0,
    outputTokens: grader.maxOutputTokensPerCall ?? 0,
  };
}

/**
 * M5-05D2B-2 — il tetto di prenotazione copre **tutti** i tentativi potenzialmente
 * fatturabili: `maxAttemptsPerCall = maxApplicationRetries + 1`. Con retry=1 la
 * prenotazione iniziale copre già i due tentativi; non si prenota altro tra primo
 * e secondo tentativo. Invariante: costo contabilizzato ≤ prenotazione.
 */
function computeReservationBoundMicroUsd(
  runtimeConfig: AiRuntimeConfig,
  eligibleWithOpen: ClassifiedPreflightItem[],
  byOrder: Map<number, TeacherQuestion>,
  request: AiCorrectionRequest,
  grader: AiGrader,
  maxAttemptsPerCall: number,
): number {
  let inputTokens = 0;
  let outputTokens = 0;
  for (const item of eligibleWithOpen) {
    if (item.classification.status !== 'eligible') continue;
    const eligible = item.classification.eligible;
    // priorPoints al massimo (numero più lungo) ⇒ resta un upper bound del payload.
    const graderInput = buildGraderInput(
      request.requestId,
      eligible.openOrders,
      byOrder,
      item.submission?.answers ?? {},
      eligible.totalMaxPoints,
      eligible.totalMaxPoints,
      request.gradingMode,
      request.teacherGuidance,
    );
    const bound = perAttemptBoundTokens(grader, graderInput);
    inputTokens += bound.inputTokens * maxAttemptsPerCall;
    outputTokens += bound.outputTokens * maxAttemptsPerCall;
  }
  return (
    estimateCostBreakdown(
      inputTokens,
      outputTokens,
      runtimeConfig.priceListVersion,
      runtimeConfig.model,
    )?.costMicroUsd ?? 0
  );
}

// ── Preview ───────────────────────────────────────────────────────────────────

export interface PreviewDeps extends AiCorrectionAuthDeps {
  ports: EngineReadPorts;
  /**
   * M5-05D1 — lettura della config runtime `settings/aiConfig` (kill switch +
   * limiti). Richiesta **solo** sul percorso provider reale; assente ⇒ trattata
   * come config assente ⇒ provider reale disabilitato (fail-closed).
   */
  loadRuntimeConfig?: LoadRuntimeConfig;
}

/**
 * Preflight reale: rilegge server-side verifica/snapshot/submission/correction,
 * classifica ogni consegna, conta e stima i token delle sole aperte. **Nessuna
 * scrittura**, **nessuna** invocazione del grader, **costo 0**.
 */
export async function runPreview(
  rawInput: unknown,
  deps: PreviewDeps,
): Promise<AiCorrectionPreviewResponse> {
  const request = await authorizeAndValidate(rawInput, deps);
  // Dopo auth/owner, la config runtime è la prima autorità del provider reale.
  // Config assente/invalida/disabilitata termina qui, prima di classificazione.
  const runtimeConfig =
    deps.featureMode === 'openai'
      ? await loadEnabledRealProviderConfig(deps.loadRuntimeConfig)
      : null;
  const preflight = await buildOperationPreflight(request, deps.callerUid!, deps.ports);

  const counts: AiCorrectionCounts = emptyCounts(request.submissionIds.length);
  const excluded: { submissionId: string; reason: ExclusionCode }[] = [];

  for (const { submissionId, classification } of preflight.classifications) {
    if (classification.status === 'excluded') {
      counts.excluded++;
      excluded.push({ submissionId, reason: classification.code });
      continue;
    }
    const e = classification.eligible;
    counts.eligible++;
    counts.closedToGrade += e.closedOrders.length;
    counts.openToGrade += e.openOrders.length;
    counts.alreadyGradedIgnored += e.alreadyGraded;
    if (e.openOrders.length === 0 && e.closedOrders.length > 0) counts.closedOnlySubmissions++;
  }

  // M5-05D1 — solo provider reale: kill switch da config runtime + limiti DEV
  // applicati nel preflight, prima di qualsiasi elaborazione. Mock: nessun gate.
  if (runtimeConfig) {
    enforceRealProviderLimits(runtimeConfig, preflight.eligibleLimits);
  }

  // M5-05D2B-1 — stima costo con lo **stesso** contratto del run (ripartizione
  // input/output della sola selezione eleggibile). Mock: 0 (nessun costo, nessuna
  // prenotazione, nessuna chiamata provider). La preview **non** dichiara un costo
  // effettivo. A parità di selezione/config coincide col run.
  const cost = buildCostEstimateFields(runtimeConfig, preflight.estimate);

  return {
    mode: deps.featureMode === 'openai' ? 'openai' : 'mock',
    phase: 'preview',
    requestId: request.requestId,
    verificationId: request.verificationId,
    counts,
    tokensEstimated: cost.totalTokensEstimated,
    costEstimated: microUsdToUsd(cost.costEstimatedMicroUsd),
    ...cost,
    excluded,
  };
}

/**
 * Costruisce i campi di stima costo. Sul percorso reale (`runtimeConfig`
 * presente) usa esclusivamente `model` + `priceListVersion` validati e il listino
 * versionato; l'arrotondamento è `ceil` (conservativo). Mock/config assente: 0.
 */
function buildCostEstimateFields(
  runtimeConfig: AiRuntimeConfig | null,
  estimate: { inputTokens: number; outputTokens: number },
): CostEstimateFields {
  if (runtimeConfig) {
    const breakdown = estimateCostBreakdown(
      estimate.inputTokens,
      estimate.outputTokens,
      runtimeConfig.priceListVersion,
      runtimeConfig.model,
    );
    if (breakdown) {
      return {
        inputTokensEstimated: breakdown.inputTokens,
        outputTokensEstimated: breakdown.outputTokens,
        totalTokensEstimated: breakdown.totalTokens,
        costEstimatedMicroUsd: breakdown.costMicroUsd,
      };
    }
  }
  // Mock / sole-chiuse / config assente: token stimati senza costo.
  return {
    inputTokensEstimated: estimate.inputTokens,
    outputTokensEstimated: estimate.outputTokens,
    totalTokensEstimated: estimate.inputTokens + estimate.outputTokens,
    costEstimatedMicroUsd: 0,
  };
}

// ── Run ─────────────────────────────────────────────────────────────────────

export interface RunDeps extends AiCorrectionAuthDeps {
  ports: EngineWritePorts;
  /**
   * Factory lazy: sul percorso reale riceve l'unica config runtime già
   * validata, ed è invocata solo dopo kill switch, classificazione e limiti.
   */
  grader: AiGrader | ((runtimeConfig: AiRuntimeConfig | null) => AiGrader);
  /**
   * M5-05D1 — lettura della config runtime `settings/aiConfig` (kill switch +
   * limiti). Richiesta **solo** sul percorso provider reale; assente ⇒ trattata
   * come config assente ⇒ provider reale disabilitato (fail-closed).
   */
  loadRuntimeConfig?: LoadRuntimeConfig;
  /** Clock server-side iniettabile; default `Date.now`. */
  now?: () => number;
  /**
   * M5-05D2B-2 — segnale di annullamento opzionale dell'intera operazione
   * (deadline della Function / perdita lease): propagato al grader reale, che non
   * inizia nuovi tentativi se abortito.
   */
  abortSignal?: AbortSignal;
}

function persistRunResponse(
  response: AiCorrectionRunResponse,
  selectionHash: string,
  ordinalBySubmissionId: ReadonlyMap<string, number>,
): PersistedRun {
  return {
    runContractVersion: AI_RUN_CONTRACT_VERSION,
    status: response.status,
    selectionHash,
    mode: response.mode,
    counts: response.counts,
    inputTokensEstimated: response.inputTokensEstimated,
    outputTokensEstimated: response.outputTokensEstimated,
    tokensEstimated: response.totalTokensEstimated,
    costEstimatedMicroUsd: response.costEstimatedMicroUsd,
    inputTokensActual: response.inputTokensActual,
    outputTokensActual: response.outputTokensActual,
    tokensActual: response.totalTokensActual,
    costActualMicroUsd: response.costActualMicroUsd,
    costReservationMicroUsd: response.costReservationMicroUsd,
    costSettledMicroUsd: response.costSettledMicroUsd,
    retry: response.retry,
    resultOrdinals: response.results.map((result) => {
      const ordinal = ordinalBySubmissionId.get(result.submissionId);
      if (ordinal === undefined) {
        throw new AiGatewayError('invalid_input', 'Risultato non associabile alla selezione.');
      }
      return {
        ordinal,
        status: result.outcome,
        ...(result.reason ? { reasonCode: result.reason } : {}),
      };
    }),
  };
}

function replayPersistedRun(
  request: AiCorrectionRequest,
  persisted: PersistedRun,
): AiCorrectionRunResponse | null {
  if (persisted.resultOrdinals.length !== request.submissionIds.length) return null;
  const seen = new Set<number>();
  const results: SubmissionResult[] = [];
  for (const result of persisted.resultOrdinals) {
    if (
      !Number.isInteger(result.ordinal) ||
      result.ordinal < 0 ||
      result.ordinal >= request.submissionIds.length ||
      seen.has(result.ordinal)
    ) {
      return null;
    }
    seen.add(result.ordinal);
    results.push({
      submissionId: request.submissionIds[result.ordinal]!,
      outcome: result.status,
      closedGraded: 0,
      openGraded: 0,
      openSkipped: 0,
      closedSkipped: 0,
      alreadyIgnored: 0,
      ...(result.reasonCode ? { reason: result.reasonCode } : {}),
    });
  }
  results.sort(
    (a, b) =>
      request.submissionIds.indexOf(a.submissionId) - request.submissionIds.indexOf(b.submissionId),
  );
  return {
    mode: persisted.mode,
    phase: 'run',
    requestId: request.requestId,
    verificationId: request.verificationId,
    status: persisted.status,
    idempotentReplay: true,
    counts: persisted.counts,
    tokensEstimated: persisted.tokensEstimated,
    inputTokensEstimated: persisted.inputTokensEstimated,
    outputTokensEstimated: persisted.outputTokensEstimated,
    totalTokensEstimated: persisted.tokensEstimated,
    costEstimatedMicroUsd: persisted.costEstimatedMicroUsd,
    costEstimated: microUsdToUsd(persisted.costEstimatedMicroUsd),
    tokensActual: persisted.tokensActual,
    inputTokensActual: persisted.inputTokensActual,
    outputTokensActual: persisted.outputTokensActual,
    totalTokensActual: persisted.tokensActual,
    costActualMicroUsd: persisted.costActualMicroUsd,
    costActual: microUsdToUsd(persisted.costActualMicroUsd),
    costReservationMicroUsd: persisted.costReservationMicroUsd,
    costSettledMicroUsd: persisted.costSettledMicroUsd,
    retry: persisted.retry,
    results,
  };
}

/**
 * Esecuzione: ripete tutte le verifiche del preview (nessuna autorizzazione
 * persistente), applica lo scoring deterministico delle chiuse e la valutazione
 * mock delle aperte (una chiamata `grader.grade()` per consegna con aperte),
 * scrive atomicamente per consegna senza sovrascrivere valutazioni esistenti,
 * ed è **idempotente** su `requestId` via `aiCorrectionRuns`.
 */
export async function runExecution(
  rawInput: unknown,
  deps: RunDeps,
): Promise<AiCorrectionRunResponse> {
  const validatedRequest = await authorizeAndValidate(rawInput, deps);
  const request: AiCorrectionRequest = {
    ...validatedRequest,
    submissionIds: canonicalizeSubmissionIds(validatedRequest.submissionIds),
  };
  const mode: AiEnabledFeatureMode = deps.featureMode === 'openai' ? 'openai' : 'mock';
  const ownerUid = deps.callerUid!;
  const selectionHash = computeSelectionHash(
    request.verificationId,
    request.submissionIds,
    request.gradingMode,
    request.teacherGuidance,
  );
  const ordinalBySubmissionId = new Map(
    request.submissionIds.map((submissionId, ordinal) => [submissionId, ordinal]),
  );
  const executionId = randomUUID();

  // M5-05D1 — guardrail del provider **reale** eseguito nel preflight, **prima**
  // di acquisire la lease, chiamare il grader o scrivere: kill switch da
  // `settings/aiConfig` (fail-closed, nessun fallback silente al mock) + limiti
  // prudenziali DEV sulla selezione eleggibile. Solo per `openai`: mock e
  // `disabled` non entrano qui e restano a costo zero, invariati. Il costo di
  // questa classificazione anticipata (una lettura per consegna) è limitato al
  // percorso provider reale, non al mock.
  // Ordine fail-closed reale: auth/owner → config/kill switch → classificazione
  // e limiti → secret/grader → lease. Il risultato della classificazione viene
  // riusato dopo la lease; commitSubmission mantiene la rilettura transazionale
  // della correction per proteggere dalle race.
  const runtimeConfig =
    mode === 'openai' ? await loadEnabledRealProviderConfig(deps.loadRuntimeConfig) : null;
  const preflight =
    mode === 'openai' ? await buildOperationPreflight(request, ownerUid, deps.ports) : null;
  if (runtimeConfig && preflight) {
    enforceRealProviderLimits(runtimeConfig, preflight.eligibleLimits);
  }
  const grader = typeof deps.grader === 'function' ? deps.grader(runtimeConfig) : deps.grader;

  // M5-05E-1: calcola e applica il tetto prudenziale prima della lease.
  const preflightTeacherQuestions = preflight?.teacherQuestions ?? null;
  const preflightByOrder = new Map(
    (preflightTeacherQuestions ?? []).map((question) => [question.order, question]),
  );
  const eligibleWithOpen = (preflight?.classifications ?? []).filter(
    (item) =>
      item.classification.status === 'eligible' &&
      item.classification.eligible.openOrders.length > 0,
  );
  const maxAttemptsPerCall = runtimeConfig ? runtimeConfig.limits.maxApplicationRetries + 1 : 1;
  let reservationCostMicroUsd = 0;
  if (runtimeConfig && eligibleWithOpen.length > 0) {
    if (!deps.ports.reserveBudget || !deps.ports.reconcileBudget || !deps.ports.markBudgetInvoked) {
      throw new AiGatewayError(
        'budget_unavailable',
        'Ledger di budget non disponibile: correzione IA reale non eseguibile.',
      );
    }
    if (!grader.maxOutputTokensPerCall || !grader.reservationInputTokenUpperBound) {
      throw new AiGatewayError(
        'budget_unavailable',
        'Il grader non espone un tetto di costo verificabile: prenotazione impossibile.',
      );
    }
    reservationCostMicroUsd = computeReservationBoundMicroUsd(
      runtimeConfig,
      eligibleWithOpen,
      preflightByOrder,
      request,
      grader,
      maxAttemptsPerCall,
    );
    if (reservationCostMicroUsd > runtimeConfig.maxOperationCostMicroUsd) {
      throw new AiGatewayError(
        'operation_budget_exceeded',
        'La prenotazione prudenziale supera il limite di costo della singola operazione.',
      );
    }
  }

  // Clock della lease letto **qui**, immediatamente prima di `beginRun`, dopo
  // config/kill switch, preflight, limiti e costruzione lazy del grader: se il
  // preflight è lento, `leaseExpiresAt` deve comunque basarsi sull'istante
  // effettivo di acquisizione (`acquisitionTime + RUN_LEASE_MS`), non sull'inizio
  // della request — altrimenti la lease nascerebbe già parzialmente consumata,
  // aprendo a un takeover prematuro e a una doppia elaborazione. Per un nuovo run
  // anche `expireAt` deriva dallo stesso istante; un takeover successivo non
  // estende né riscrive l'`expireAt` del documento originale (lo imposta solo la
  // create). Il clock resta iniettabile per test deterministici.
  const nowMs = (deps.now ?? Date.now)();

  // Idempotenza concorrente: acquisisci la lease sul run doc (transazione).
  const begin = await deps.ports.beginRun(request.requestId, {
    selectionHash,
    submissionCount: request.submissionIds.length,
    provider: grader.id,
    ...(grader.model ? { model: grader.model } : {}),
    ...(runtimeConfig?.configVersion ? { configVersion: runtimeConfig.configVersion } : {}),
    ...(runtimeConfig?.priceListVersion
      ? { priceListVersion: runtimeConfig.priceListVersion }
      : {}),
    executionId,
    leaseMs: RUN_LEASE_MS,
    nowMs,
    expireAtMs: nowMs + RUN_RETENTION_MS,
  });
  if (begin.state === 'conflict') {
    throw new AiGatewayError('invalid_input', 'requestId già usato con una selezione diversa.');
  }
  if (begin.state === 'legacy') {
    throw new AiGatewayError(
      'invalid_input',
      'requestId associato a un run legacy non ricostruibile: genera un nuovo requestId.',
    );
  }
  if (begin.state === 'completed') {
    // Ricostruisce ordinal → submissionId esclusivamente dalla selezione corrente.
    const replay = replayPersistedRun(request, begin.existing);
    if (!replay) {
      throw new AiGatewayError(
        'invalid_input',
        'Run persistito non ricostruibile in sicurezza: genera un nuovo requestId.',
      );
    }
    return replay;
  }
  if (begin.state === 'locked') {
    // Un altro tentativo possiede una lease valida: NON richiamare grader né
    // commitSubmission. Ritorna un esito "in corso" senza rielaborare.
    return lockedResponse(request, mode);
  }
  // begin.state === 'acquired' → questo executionId possiede la lease.

  const verification = preflight ? null : await deps.ports.loadVerification(request.verificationId);
  const teacherQuestions = preflight
    ? preflightTeacherQuestions
    : resolveTeacherQuestions(verification, ownerUid);
  const byOrder = preflight
    ? preflightByOrder
    : new Map((teacherQuestions ?? []).map((q) => [q.order, q]));
  const preflightBySubmission = new Map(
    preflight?.classifications.map((item) => [item.submissionId, item]) ?? [],
  );

  // ── M5-05D2B-1 — contratto economico del percorso provider reale ────────────
  const reservationMonthKey = monthKeyFromMs(nowMs);
  const reservationDayKey = dayKeyFromMs(nowMs);
  const budgetMicroUsd = runtimeConfig?.monthlyBudgetMicroUsd ?? 0;
  const dailyBudgetMicroUsd = runtimeConfig?.dailyBudgetMicroUsd ?? 0;
  // Consegne che genereranno **una chiamata provider** (hanno aperte). Le
  // sole-chiuse non chiamano il provider → costo 0 → nessuna prenotazione.
  // M5-05D2B-2 — tentativi massimi per chiamata (retry incluso) e deadline
  // complessiva monotona: nessun tentativo provider inizia oltre la deadline, che
  // lascia margine a reconcile/finish entro il timeout della Function.
  const runDeadlineMs = nowMs + RUN_OVERALL_DEADLINE_MS - RUN_FINALIZE_MARGIN_MS;

  let budgetReserved = false;
  if (runtimeConfig && eligibleWithOpen.length > 0) {
    const reservation = await deps.ports.reserveBudget!({
      requestId: request.requestId,
      amountMicroUsd: reservationCostMicroUsd,
      budgetMicroUsd,
      dailyBudgetMicroUsd,
      monthKey: reservationMonthKey,
      dayKey: reservationDayKey,
      nowMs,
      // La prenotazione scade con la finestra di lease: un crash **prima** del
      // provider (stato `reserved`) la rende recuperabile senza job esterni.
      expiresAtMs: nowMs + RUN_LEASE_MS,
    });
    if (!reservation.ok) {
      if (reservation.reason === 'daily_budget_exceeded') {
        throw new AiGatewayError(
          'daily_budget_exceeded',
          'Budget giornaliero della correzione IA esaurito.',
        );
      }
      throw new AiGatewayError('budget_exceeded', 'Budget mensile della correzione IA esaurito.');
    }
    budgetReserved = true;
    // Transizione `reserved → pending` **prima** di qualsiasi chiamata provider:
    // da qui in poi la prenotazione non è più liberabile silenziosamente per
    // scadenza (un crash dopo il provider la addebiterà al tetto). Gated
    // dall'`executionId`: se abbiamo perso la lease non elaboriamo.
    const stillOwner = await deps.ports.markBudgetInvoked!({
      requestId: request.requestId,
      budgetMicroUsd,
      dailyBudgetMicroUsd,
      monthKey: reservationMonthKey,
      nowMs,
      executionId,
    });
    if (!stillOwner) return lockedResponse(request, mode);
  }

  const outcomes = await mapWithConcurrency(
    request.submissionIds,
    SUBMISSION_CONCURRENCY,
    async (submissionId): Promise<GradeOutcome> => {
      const cached = preflightBySubmission.get(submissionId);
      const [submission, classification] = cached
        ? [cached.submission, cached.classification]
        : await (async (): Promise<[SubmissionData | null, Classification]> => {
            const [loadedSubmission, correction] = await Promise.all([
              deps.ports.loadSubmission(submissionId),
              deps.ports.loadCorrection(submissionId),
            ]);
            return [
              loadedSubmission,
              classifySubmission({
                submissionId,
                expectedOwner: ownerUid,
                expectedVerificationId: request.verificationId,
                teacherQuestions,
                submission: loadedSubmission,
                correction,
              }),
            ];
          })();
      if (classification.status === 'excluded') {
        return {
          result: {
            submissionId,
            outcome: 'excluded',
            closedGraded: 0,
            openGraded: 0,
            openSkipped: 0,
            closedSkipped: 0,
            alreadyIgnored: 0,
            reason: classification.code,
          },
          estimate: { inputTokens: 0, outputTokens: 0 },
          actual: { inputTokens: 0, outputTokens: 0 },
          settledBound: { inputTokens: 0, outputTokens: 0 },
          attempts: EMPTY_ATTEMPT_STATS,
        };
      }
      return gradeEligible(submissionId, classification.eligible, {
        request,
        ownerUid,
        submission: submission!,
        teacherQuestions: teacherQuestions ?? [],
        byOrder,
        grader,
        commit: deps.ports.commitSubmission,
        deadlineMs: runtimeConfig ? runDeadlineMs : undefined,
        signal: deps.abortSignal,
      });
    },
  );

  // Aggregazione.
  const counts = emptyCounts(request.submissionIds.length) as AiCorrectionRunResponse['counts'];
  counts.succeeded = 0;
  counts.partial = 0;
  counts.failed = 0;
  let inputTokensEstimated = 0;
  let outputTokensEstimated = 0;
  let inputTokensActual = 0;
  let outputTokensActual = 0;
  // M5-05D2B-2 — token dal costo **incerto** (bound prudente) + telemetria retry.
  let settledInputTokens = 0;
  let settledOutputTokens = 0;
  const retry: RunRetryTelemetry = {
    attemptsTotal: 0,
    retriesTotal: 0,
    retryReasonCodes: [],
    retryDelayTotalMs: 0,
    unknownBillingAttempts: 0,
  };
  const results: SubmissionResult[] = [];
  for (const o of outcomes) {
    const r = o.result;
    results.push(r);
    switch (r.outcome) {
      case 'excluded':
        counts.excluded++;
        break;
      case 'succeeded':
        counts.eligible++;
        counts.succeeded++;
        break;
      case 'partial':
        counts.eligible++;
        counts.partial++;
        break;
      case 'failed':
        counts.eligible++;
        counts.failed++;
        break;
    }
    counts.closedToGrade += r.closedGraded;
    counts.openToGrade += r.openGraded + r.openSkipped;
    counts.alreadyGradedIgnored += r.alreadyIgnored;
    if (r.outcome !== 'excluded' && r.openGraded === 0 && r.closedGraded > 0) {
      counts.closedOnlySubmissions++;
    }
    // Stima: formula deterministica (input=prompt, output=quota feedback).
    // Effettivo: usage REALE del provider — 0 in modalità mock / senza usage.
    inputTokensEstimated += o.estimate.inputTokens;
    outputTokensEstimated += o.estimate.outputTokens;
    inputTokensActual += o.actual.inputTokens;
    outputTokensActual += o.actual.outputTokens;
    settledInputTokens += o.settledBound.inputTokens;
    settledOutputTokens += o.settledBound.outputTokens;
    retry.attemptsTotal += o.attempts.attemptsTotal;
    retry.retriesTotal += o.attempts.retriesTotal;
    retry.retryReasonCodes.push(...o.attempts.retryReasonCodes);
    retry.retryDelayTotalMs += o.attempts.retryDelayTotalMs;
    retry.unknownBillingAttempts += o.attempts.unknownBillingAttempts;
  }

  const status: RunStatus =
    counts.failed > 0 && counts.succeeded === 0 && counts.partial === 0
      ? 'failed'
      : counts.partial > 0 || counts.failed > 0
        ? 'partial'
        : 'completed';

  // M5-05D2B-1 — costo **effettivo** dai token realmente riportati dal provider,
  // `nearest`. Mock/sole-chiuse: 0/0/0 → costo 0 (mai un actual inventato).
  const totalTokensEstimated = inputTokensEstimated + outputTokensEstimated;
  const totalTokensActual = inputTokensActual + outputTokensActual;
  const costEstimatedMicroUsd = runtimeConfig
    ? (estimateCostBreakdown(
        inputTokensEstimated,
        outputTokensEstimated,
        runtimeConfig.priceListVersion,
        runtimeConfig.model,
      )?.costMicroUsd ?? 0)
    : 0;
  const costActualMicroUsd = runtimeConfig
    ? (actualCostMicroUsd(
        inputTokensActual,
        outputTokensActual,
        runtimeConfig.priceListVersion,
        runtimeConfig.model,
      ) ?? 0)
    : 0;
  // M5-05D2B-2 — costo **contabilizzato prudenziale**: effettivo noto + tetto
  // (`ceil`, conservativo) dei tentativi dal costo incerto, mai oltre la
  // prenotazione. È il valore che verrà addebitato al ledger.
  const uncertainBoundMicroUsd = runtimeConfig
    ? (estimateCostBreakdown(
        settledInputTokens,
        settledOutputTokens,
        runtimeConfig.priceListVersion,
        runtimeConfig.model,
      )?.costMicroUsd ?? 0)
    : 0;
  const rawSettledMicroUsd = costActualMicroUsd + uncertainBoundMicroUsd;
  const costSettledMicroUsd =
    reservationCostMicroUsd > 0
      ? Math.min(rawSettledMicroUsd, reservationCostMicroUsd)
      : rawSettledMicroUsd;

  const response: AiCorrectionRunResponse = {
    mode,
    phase: 'run',
    requestId: request.requestId,
    verificationId: request.verificationId,
    status,
    idempotentReplay: false,
    counts,
    tokensEstimated: totalTokensEstimated,
    inputTokensEstimated,
    outputTokensEstimated,
    totalTokensEstimated,
    costEstimatedMicroUsd,
    costEstimated: microUsdToUsd(costEstimatedMicroUsd),
    tokensActual: totalTokensActual,
    inputTokensActual,
    outputTokensActual,
    totalTokensActual,
    costActualMicroUsd,
    costActual: microUsdToUsd(costActualMicroUsd),
    costReservationMicroUsd: reservationCostMicroUsd,
    costSettledMicroUsd,
    retry,
    results,
  };

  // M5-05D2B-1 — ordine sicuro finale: commit già avvenuti per consegna →
  // **riconciliazione** budget (libera l'eccedenza prenotata, addebita l'effettivo)
  // → **finalizzazione** run. Entrambe verificano la titolarità della lease
  // (`executionId`): un worker vecchio dopo un takeover è un no-op su entrambe e
  // non tocca la prenotazione/finalizzazione del nuovo worker. La riconciliazione
  // usa il clock corrente (non un timestamp catturato prima di preflight lenti).
  if (budgetReserved && deps.ports.reconcileBudget) {
    await deps.ports.reconcileBudget({
      // M5-05D2B-2 — addebita il costo **prudenziale** (effettivo noto + tetto dei
      // tentativi incerti), mai oltre la prenotazione: mai sottocontabilizzare.
      requestId: request.requestId,
      actualMicroUsd: costSettledMicroUsd,
      budgetMicroUsd,
      dailyBudgetMicroUsd,
      monthKey: reservationMonthKey,
      nowMs: (deps.now ?? Date.now)(),
      executionId,
    });
  }

  // Finalizza solo se questo executionId possiede ancora la lease.
  await deps.ports.finishRun(request.requestId, {
    ...persistRunResponse(response, selectionHash, ordinalBySubmissionId),
    executionId,
  });
  return response;
}

/** Statistiche tentativi "vuote" (mock/sole-chiuse/escluse: nessun provider). */
const EMPTY_ATTEMPT_STATS: AiGraderAttemptStats = {
  attemptsTotal: 0,
  retriesTotal: 0,
  retryReasonCodes: [],
  retryDelayTotalMs: 0,
  unknownBillingAttempts: 0,
};

/** Esito interno per consegna: risultato pubblico + accounting token stima/effettivo. */
interface GradeOutcome {
  result: SubmissionResult;
  /** Stima deterministica dei token (input=prompt, output=quota feedback). */
  estimate: { inputTokens: number; outputTokens: number };
  /** Token REALI consumati dal provider (0/0 in modalità mock o senza usage). */
  actual: { inputTokens: number; outputTokens: number };
  /**
   * M5-05D2B-2 — tetto prudente dei tentativi dal costo **incerto** di questa
   * consegna (0/0 se nessun tentativo incerto): `unknownBillingAttempts × bound`.
   */
  settledBound: { inputTokens: number; outputTokens: number };
  /** Statistiche aggregate dei tentativi di questa consegna. */
  attempts: AiGraderAttemptStats;
}

/**
 * Risposta usata quando il run è già posseduto da un tentativo con lease valida:
 * nessuna rielaborazione, nessuna scrittura. `idempotentReplay: true` segnala al
 * chiamante che questa invocazione non ha elaborato.
 */
function lockedResponse(
  request: AiCorrectionRequest,
  mode: AiEnabledFeatureMode,
): AiCorrectionRunResponse {
  return {
    mode,
    phase: 'run',
    requestId: request.requestId,
    verificationId: request.verificationId,
    status: 'running',
    idempotentReplay: true,
    counts: {
      ...emptyCounts(request.submissionIds.length),
      succeeded: 0,
      partial: 0,
      failed: 0,
    },
    tokensEstimated: 0,
    inputTokensEstimated: 0,
    outputTokensEstimated: 0,
    totalTokensEstimated: 0,
    costEstimatedMicroUsd: 0,
    costEstimated: 0,
    tokensActual: 0,
    inputTokensActual: 0,
    outputTokensActual: 0,
    totalTokensActual: 0,
    costActualMicroUsd: 0,
    costActual: 0,
    costReservationMicroUsd: 0,
    costSettledMicroUsd: 0,
    retry: {
      attemptsTotal: 0,
      retriesTotal: 0,
      retryReasonCodes: [],
      retryDelayTotalMs: 0,
      unknownBillingAttempts: 0,
    },
    results: [],
  };
}

async function gradeEligible(
  submissionId: string,
  eligible: EligibleSubmission,
  ctx: {
    request: AiCorrectionRequest;
    ownerUid: string;
    submission: SubmissionData;
    teacherQuestions: TeacherQuestion[];
    byOrder: Map<number, TeacherQuestion>;
    grader: AiGrader;
    commit: EngineWritePorts['commitSubmission'];
    deadlineMs?: number;
    signal?: AbortSignal;
  },
): Promise<GradeOutcome> {
  const proposed = new Map<number, ValidatedScore>();
  // M5-05D2B-2 — telemetria tentativi + tetto prudente dei tentativi incerti.
  let attempts: AiGraderAttemptStats = EMPTY_ATTEMPT_STATS;
  let settledBound = { inputTokens: 0, outputTokens: 0 };
  // Token aperte + quota per il feedback generale (M5-04B) **solo** se ci sono
  // domande aperte (il feedback delle consegne con sole chiuse è deterministico,
  // non passa dal provider → 0 token). Identica a preview.
  const hasOpen = eligible.openOrders.length > 0;
  // Stima ripartita: input = prompt (domanda+soluzione+risposta), output = quota
  // feedback generale (solo se ci sono aperte). Identica a preview.
  const estimate = {
    inputTokens:
      estimateOpenTokensForSubmission(
        ctx.teacherQuestions,
        eligible.openOrders,
        ctx.submission.answers,
      ) +
      (hasOpen
        ? estimateTeacherGuidanceTokens(ctx.request.teacherGuidance) +
          estimateGradingModeTokens(ctx.request.gradingMode)
        : 0),
    outputTokens: hasOpen
      ? eligible.openOrders.length * QUESTION_FEEDBACK_TOKEN_ESTIMATE +
        GENERAL_FEEDBACK_TOKEN_ESTIMATE
      : 0,
  };
  // Token REALI (0/0 col mock o senza usage). Aggiornati dall'usage del provider,
  // **anche** se l'output viene poi rifiutato (costo comunque contabilizzato).
  let actualInput = 0;
  let actualOutput = 0;
  const billUsage = (usage: Parameters<typeof normalizeUsageActual>[0]) => {
    const normalized = normalizeUsageActual(usage);
    if (normalized) {
      actualInput = normalized.inputTokens;
      actualOutput = normalized.outputTokens;
    }
  };

  // 1) Chiuse: scoring deterministico con feedback (M5-04C), zero grader.
  //    Accumula i punti chiusi per il totale finale del feedback generale.
  //    Una chiusa con soluzione/opzioni malformate è **non valutabile**: resta
  //    `points: null` (mai zero ingiusto) e conta come `closedSkipped`.
  let closedPoints = 0;
  let closedSkipped = 0;
  for (const order of eligible.closedOrders) {
    const q = ctx.byOrder.get(order);
    if (!q) continue;
    const res = scoreClosedQuestion(q, ctx.submission.answers[order.toString()]);
    if (!res.evaluable) {
      closedSkipped++;
      continue;
    }
    closedPoints += res.points;
    proposed.set(order, { points: res.points, feedback: res.feedback });
  }

  // Punti già fissati prima della valutazione delle aperte (M5-04B): domande già
  // valutate + chiuse appena assegnate. Il grader ci somma i punti delle aperte
  // per ottenere il totale finale, senza una seconda chiamata.
  const priorPoints = eligible.alreadyGradedPoints + closedPoints;

  // 2) Aperte: una sola chiamata grader per consegna, poi validazione. Il grader
  //    produce anche il feedback generale (M5-04B) nella STESSA chiamata.
  let openSkipped = 0;
  let generalFeedback: string | null = null;
  if (eligible.openOrders.length > 0) {
    // Stesso costruttore usato per il tetto di prenotazione: il payload reale è
    // ≤ quello usato per il bound (priorPoints reale ≤ totalMaxPoints), quindi
    // l'input effettivo non eccede mai il tetto prenotato per la chiamata.
    const graderInput: AiGraderInput = buildGraderInput(
      ctx.request.requestId,
      eligible.openOrders,
      ctx.byOrder,
      ctx.submission.answers,
      priorPoints,
      eligible.totalMaxPoints,
      ctx.request.gradingMode,
      ctx.request.teacherGuidance,
    );
    // Tetto **per tentativo** (input upper bound + max output) di questa consegna:
    // base per contabilizzare in modo prudente i tentativi dal costo incerto.
    const attemptBound = perAttemptBoundTokens(ctx.grader, graderInput);
    const applyAttempts = (stats: AiGraderAttemptStats | undefined): void => {
      attempts = stats ?? SINGLE_ATTEMPT_STATS;
      settledBound = {
        inputTokens: attempts.unknownBillingAttempts * attemptBound.inputTokens,
        outputTokens: attempts.unknownBillingAttempts * attemptBound.outputTokens,
      };
    };
    let validated = new Map<number, ValidatedScore>();
    try {
      const output = await ctx.grader.grade(graderInput, {
        ...(ctx.deadlineMs !== undefined ? { deadlineMs: ctx.deadlineMs } : {}),
        ...(ctx.signal ? { signal: ctx.signal } : {}),
      });
      applyAttempts(output.attempts);
      // Usage REALE del provider, se riportato e coerente (0/0 col mock).
      billUsage(output.usage);
      // M5-04B (validazione ATOMICA): con domande aperte il feedback generale è
      // **richiesto**. Se è assente, non stringa, vuoto o supera i 700 caratteri
      // l'**intero** output del grader per questa consegna è invalido: nessun
      // punteggio IA, nessun feedback, **nessun** commitSubmission → la consegna
      // è riportata `failed` (contratto batch esistente) senza scritture parziali.
      // L'usage già consumato resta contabilizzato (billUsage sopra).
      // Le altre consegne proseguono; le valutazioni già presenti restano intatte.
      generalFeedback = validateGeneralFeedback(output.generalFeedback);
      if (generalFeedback === null) {
        return {
          result: {
            submissionId,
            outcome: 'failed',
            closedGraded: 0,
            openGraded: 0,
            openSkipped: eligible.openOrders.length,
            closedSkipped: 0,
            alreadyIgnored: eligible.alreadyGraded,
            reason: 'write_error',
          },
          estimate,
          actual: { inputTokens: actualInput, outputTokens: actualOutput },
          settledBound,
          attempts,
        };
      }
      validated = validateGraderOutput(
        output,
        ctx.request.requestId,
        new Set(eligible.openOrders),
        new Map(eligible.openOrders.map((o) => [o, ctx.byOrder.get(o)!.maxPoints])),
      );
    } catch (error) {
      // Output invalido con usage **già fatturabile**: il costo va contabilizzato
      // anche se non salviamo punteggi/feedback. Un fallimento finale del provider
      // (dopo l'eventuale retry) porta usage noto + tentativi incerti prudenziali.
      // In ogni caso fail atomico: nemmeno le chiuse calcolate vengono persistite.
      let reason: ExclusionCode = 'write_error';
      if (error instanceof AiGraderInvalidOutputError) {
        billUsage(error.usage);
        applyAttempts(error.attempts);
      } else if (error instanceof AiGraderFailure) {
        billUsage(error.usage);
        applyAttempts(error.attempts);
        reason = mapGraderFailureReason(error.reasonCode);
      }
      return {
        result: {
          submissionId,
          outcome: 'failed',
          closedGraded: 0,
          openGraded: 0,
          openSkipped: eligible.openOrders.length,
          closedSkipped: 0,
          alreadyIgnored: eligible.alreadyGraded,
          reason,
        },
        estimate,
        actual: { inputTokens: actualInput, outputTokens: actualOutput },
        settledBound,
        attempts,
      };
    }
    for (const order of eligible.openOrders) {
      const score = validated.get(order);
      if (score) proposed.set(order, score);
      else openSkipped++;
    }
  } else {
    // Consegna con SOLE domande chiuse: nessuna chiamata al grader. Il feedback
    // generale è costruito in modo deterministico dai totali finali (stessa
    // funzione pura del mock), a token/costo reali 0.
    generalFeedback = buildMockGeneralFeedback(priorPoints, eligible.totalMaxPoints);
  }

  // 3) Scrittura atomica per consegna (merge non distruttivo).
  let commit: CommitSubmissionResult;
  try {
    commit = await ctx.commit({
      submissionId,
      ownerUid: ctx.ownerUid,
      verificationId: ctx.request.verificationId,
      studentUid: eligible.studentUid,
      actorUid: ctx.ownerUid,
      skeleton: eligible.skeleton,
      proposed,
      proposedGeneralFeedback: generalFeedback,
    });
  } catch {
    return {
      result: {
        submissionId,
        outcome: 'failed',
        closedGraded: 0,
        openGraded: 0,
        openSkipped,
        closedSkipped,
        alreadyIgnored: eligible.alreadyGraded,
        reason: 'write_error',
      },
      estimate,
      actual: { inputTokens: actualInput, outputTokens: actualOutput },
      settledBound,
      attempts,
    };
  }

  if (commit.result === 'changed') {
    return {
      result: {
        submissionId,
        outcome: 'excluded',
        closedGraded: 0,
        openGraded: 0,
        openSkipped: 0,
        closedSkipped: 0,
        alreadyIgnored: eligible.alreadyGraded,
        reason: 'changed_since_preview',
      },
      // Dati cambiati dopo il preflight: nessuna scrittura, ma se il grader era già
      // stato chiamato l'usage consumato resta contabilizzato (mai un costo perso).
      estimate,
      actual: { inputTokens: actualInput, outputTokens: actualOutput },
      settledBound,
      attempts,
    };
  }

  const writtenSet = new Set(commit.writtenOrders);
  const closedSet = new Set(eligible.closedOrders);
  let closedGraded = 0;
  let openGraded = 0;
  for (const order of writtenSet) {
    if (closedSet.has(order)) closedGraded++;
    else openGraded++;
  }
  // Aperte proposte ma non scritte (concorrenza) contano come skipped.
  const openProposedNotWritten = eligible.openOrders.filter(
    (o) => proposed.has(o) && !writtenSet.has(o),
  ).length;
  openSkipped += openProposedNotWritten;

  const totalGradable = eligible.closedOrders.length + eligible.openOrders.length;
  const totalWritten = closedGraded + openGraded;
  const outcome: SubmissionOutcome = totalWritten === totalGradable ? 'succeeded' : 'partial';

  return {
    result: {
      submissionId,
      outcome,
      closedGraded,
      openGraded,
      openSkipped,
      closedSkipped,
      alreadyIgnored: eligible.alreadyGraded,
    },
    estimate,
    actual: { inputTokens: actualInput, outputTokens: actualOutput },
    settledBound,
    attempts,
  };
}

/** Statistiche di un singolo tentativo riuscito (nessun retry, nessun costo incerto). */
const SINGLE_ATTEMPT_STATS: AiGraderAttemptStats = {
  attemptsTotal: 1,
  retriesTotal: 0,
  retryReasonCodes: [],
  retryDelayTotalMs: 0,
  unknownBillingAttempts: 0,
};

/** Mappa il codice tecnico del fallimento grader in un `ExclusionCode` leggibile. */
function mapGraderFailureReason(reasonCode: string): ExclusionCode {
  switch (reasonCode) {
    case 'deadline_exceeded':
    case 'aborted':
      return 'deadline_exceeded';
    case 'rate_limited':
      return 'rate_limited';
    case 'timeout':
      return 'provider_timeout';
    case 'retry_after_exceeded':
      return 'retry_after_exceeded';
    default:
      return 'provider_unavailable';
  }
}

// ── Utility ───────────────────────────────────────────────────────────────────

function emptyCounts(selected: number): AiCorrectionCounts {
  return {
    selected,
    eligible: 0,
    excluded: 0,
    closedToGrade: 0,
    openToGrade: 0,
    closedOnlySubmissions: 0,
    alreadyGradedIgnored: 0,
  };
}

/**
 * Restituisce le domande congelate del docente **solo** se la verifica esiste,
 * appartiene all'owner e ha uno snapshot con domande. In caso contrario `null`
 * (le consegne verranno escluse con `snapshot_unavailable`). Non si fida di
 * alcun dato del client.
 */
function resolveTeacherQuestions(
  verification: VerificationData | null,
  ownerUid: string | null,
): TeacherQuestion[] | null {
  if (!verification) return null;
  if (!ownerUid || verification.ownerUid !== ownerUid) return null;
  if (!verification.teacherQuestions || verification.teacherQuestions.length === 0) return null;
  return verification.teacherQuestions;
}
