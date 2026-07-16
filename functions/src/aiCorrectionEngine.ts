/**
 * M5-02 — motore server-side della correzione assistita da IA.
 *
 * Orchestrazione pura (nessuna dipendenza `firebase-admin`/`firebase-functions`):
 * eleggibilità per consegna, scoring **deterministico** delle domande chiuse,
 * valutazione delle aperte tramite l'interfaccia `AiGrader` (in M5-02 solo
 * `MockAiGrader`), validazione rigorosa dell'output, merge nelle `evaluations`
 * senza sovrascrivere valutazioni esistenti, idempotenza via
 * `aiCorrectionRuns/{requestId}`. Tutti gli accessi Firestore passano da un
 * insieme di **porte** iniettate (implementate con l'Admin SDK nel wiring),
 * così il motore è testabile in isolamento senza rete né emulatore.
 *
 * Vincoli M5-02: solo provider mock, **zero token reali**, **costo 0**,
 * **nessuna chiamata esterna**, **nessun** completamento/restituzione
 * automatici. Non si fida mai di testi/dati del client: il client invia solo
 * `verificationId`/`submissionIds`/`requestId`; domande, risposte e soluzioni
 * sono rilette server-side dalle porte.
 */

import {
  authorizeAndValidate,
  AiGatewayError,
  type AiCorrectionAuthDeps,
  type AiCorrectionRequest,
  type AiGrader,
  type AiGraderInput,
} from './aiCorrectionGatewayCore.js';

// ── Limiti prudenti (guardie tecniche, non budget definitivi HG-M5-2/3) ──────

/** Max domande aperte inviate al grader per singola consegna. */
export const MAX_OPEN_QUESTIONS_PER_SUBMISSION = 50;
/** Max caratteri di una singola risposta aperta. */
export const MAX_ANSWER_CHARS = 20_000;
/** Max caratteri totali (domande+soluzioni+risposte) delle aperte di una consegna. */
export const MAX_TOTAL_OPEN_CHARS = 200_000;
/** Max caratteri ammessi in un feedback prodotto dal grader. */
export const MAX_MOCK_FEEDBACK_CHARS = 2_000;
/** Stima token: caratteri per token (approssimazione deterministica). */
export const CHARS_PER_TOKEN = 4;
/** Overhead fisso di token per domanda aperta (prompt/struttura). */
export const OPEN_QUESTION_TOKEN_OVERHEAD = 8;

// ── Tipi di dominio (locali al package functions, no dipendenze da apps/web) ──

export type QuestionTipo = 'aperta' | 'chiusa_singola' | 'chiusa_multipla';

export interface TeacherQuestion {
  order: number;
  tipo: QuestionTipo;
  maxPoints: number;
  testo: string;
  /** string per aperta/chiusa_singola, string[] per chiusa_multipla. */
  soluzione: string | string[];
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
  | 'write_error';

export type SubmissionOutcome = 'succeeded' | 'partial' | 'excluded' | 'failed';

export interface SubmissionResult {
  submissionId: string;
  outcome: SubmissionOutcome;
  closedGraded: number;
  openGraded: number;
  openSkipped: number;
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

export interface AiCorrectionPreviewResponse {
  mode: 'mock';
  phase: 'preview';
  requestId: string;
  verificationId: string;
  counts: AiCorrectionCounts;
  tokensEstimated: number;
  costEstimated: 0;
  excluded: { submissionId: string; reason: ExclusionCode }[];
}

export interface AiCorrectionRunResponse {
  mode: 'mock';
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
  costActual: 0;
  results: SubmissionResult[];
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

/**
 * Scoring **deterministico** delle domande chiuse (regola M5, tutto-o-niente):
 * - `chiusa_singola`: `selectedId` esattamente uguale alla soluzione →
 *   `maxPoints`; errata, `null` o risposta di tipo incoerente → `0`.
 * - `chiusa_multipla`: confronto insiemistico esatto con la soluzione →
 *   `maxPoints`; insieme diverso (incompleto, con extra, errato o vuoto) → `0`.
 * **Nessun** punteggio parziale, **nessuna** penalità, **zero** chiamate al
 * grader. Ritorna sempre un valore in `[0, maxPoints]`.
 */
export function scoreClosedQuestion(
  question: TeacherQuestion,
  answer: SubmissionAnswer | undefined,
): number {
  if (question.tipo === 'chiusa_singola') {
    const solution = typeof question.soluzione === 'string' ? question.soluzione : null;
    const selected = answer && answer.tipo === 'chiusa_singola' ? answer.selectedId : null;
    return solution !== null && selected !== null && selected === solution ? question.maxPoints : 0;
  }
  if (question.tipo === 'chiusa_multipla') {
    const solution = Array.isArray(question.soluzione) ? question.soluzione : [];
    const selected = answer && answer.tipo === 'chiusa_multipla' ? answer.selectedIds : [];
    return solution.length > 0 && sameIdSet(solution, selected) ? question.maxPoints : 0;
  }
  return 0;
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

  const skeleton = teacherQuestions.map((q) => ({ order: q.order, maxPoints: q.maxPoints }));
  const closedOrders: number[] = [];
  const openOrders: number[] = [];
  let alreadyGraded = 0;
  let openCharTotal = 0;

  for (const q of teacherQuestions) {
    const key = q.order.toString();
    const existing = correction?.evaluations[key];
    if (existing && existing.points !== null) {
      alreadyGraded++;
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
      skeleton,
    },
  };
}

/** Stima deterministica dei token per le sole domande aperte di una consegna. */
export function estimateOpenTokens(questions: TeacherQuestion[], openOrders: number[]): number {
  const byOrder = new Map(questions.map((q) => [q.order, q]));
  let tokens = 0;
  for (const order of openOrders) {
    const q = byOrder.get(order);
    if (!q) continue;
    const sol = typeof q.soluzione === 'string' ? q.soluzione : '';
    const chars = q.testo.length + sol.length;
    tokens += Math.ceil(chars / CHARS_PER_TOKEN) + OPEN_QUESTION_TOKEN_OVERHEAD;
  }
  return tokens;
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
      if (typeof feedback !== 'string' || feedback.length > MAX_MOCK_FEEDBACK_CHARS) continue;
    }
    valid.set(order, { points, ...(feedback !== undefined ? { feedback } : {}) });
  }
  return valid;
}

// ── Hash deterministico della selezione (per idempotenza, non contenuti) ──────

/** FNV-1a 32-bit in hex — deterministico, puro, nessuna dipendenza. */
export function computeSelectionHash(verificationId: string, submissionIds: string[]): string {
  const canonical = `${verificationId}\n${[...submissionIds].sort().join('\n')}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < canonical.length; i++) {
    hash ^= canonical.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
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

export interface PersistedRun {
  status: RunStatus;
  selectionHash: string;
  response?: AiCorrectionRunResponse;
}

export interface EngineWritePorts extends EngineReadPorts {
  /**
   * Crea `aiCorrectionRuns/{requestId}` in stato `running` se assente
   * (transazione). Se esiste con selectionHash diverso → `conflict`. Se esiste
   * → `existing` con il documento persistito (per la risposta idempotente).
   */
  beginRun: (
    requestId: string,
    meta: {
      ownerUid: string;
      actorUid: string;
      verificationId: string;
      selectionHash: string;
      submissionCount: number;
    },
  ) => Promise<{ state: 'created' | 'existing' | 'conflict'; existing?: PersistedRun }>;
  /** Aggiorna `aiCorrectionRuns/{requestId}` con stato finale + risultato (solo metadata). */
  finishRun: (requestId: string, run: PersistedRun) => Promise<void>;
  /**
   * Scrive la correction (create se assente, merge non distruttivo se
   * `in_progress`) e il mirror `submissions/{id}.correctionSummary` in **una
   * transazione atomica** per consegna. Rilegge la correction dentro la
   * transazione: se non è più assente/`in_progress` → `changed`.
   */
  commitSubmission: (input: CommitSubmissionInput) => Promise<CommitSubmissionResult>;
}

// ── Concorrenza limitata ──────────────────────────────────────────────────────

/** Grado di parallelismo prudente sul processing delle consegne. */
export const SUBMISSION_CONCURRENCY = 5;

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

// ── Preview ───────────────────────────────────────────────────────────────────

export interface PreviewDeps extends AiCorrectionAuthDeps {
  ports: EngineReadPorts;
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
  const verification = await deps.ports.loadVerification(request.verificationId);
  const teacherQuestions = resolveTeacherQuestions(verification, deps.callerUid);

  const counts: AiCorrectionCounts = emptyCounts(request.submissionIds.length);
  const excluded: { submissionId: string; reason: ExclusionCode }[] = [];
  let tokensEstimated = 0;

  const classifications = await mapWithConcurrency(
    request.submissionIds,
    SUBMISSION_CONCURRENCY,
    async (submissionId) => {
      const [submission, correction] = await Promise.all([
        deps.ports.loadSubmission(submissionId),
        deps.ports.loadCorrection(submissionId),
      ]);
      return {
        submissionId,
        classification: classifySubmission({
          submissionId,
          expectedOwner: deps.callerUid!,
          expectedVerificationId: request.verificationId,
          teacherQuestions,
          submission,
          correction,
        }),
      };
    },
  );

  for (const { submissionId, classification } of classifications) {
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
    tokensEstimated += estimateOpenTokens(teacherQuestions ?? [], e.openOrders);
  }

  return {
    mode: 'mock',
    phase: 'preview',
    requestId: request.requestId,
    verificationId: request.verificationId,
    counts,
    tokensEstimated,
    costEstimated: 0,
    excluded,
  };
}

// ── Run ─────────────────────────────────────────────────────────────────────

export interface RunDeps extends AiCorrectionAuthDeps {
  ports: EngineWritePorts;
  grader: AiGrader;
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
  const request = await authorizeAndValidate(rawInput, deps);
  const ownerUid = deps.callerUid!;
  const selectionHash = computeSelectionHash(request.verificationId, request.submissionIds);

  // Idempotenza: crea/riconosci il run doc.
  const begin = await deps.ports.beginRun(request.requestId, {
    ownerUid,
    actorUid: ownerUid,
    verificationId: request.verificationId,
    selectionHash,
    submissionCount: request.submissionIds.length,
  });
  if (begin.state === 'conflict') {
    throw new AiGatewayError('invalid_input', 'requestId già usato con una selezione diversa.');
  }
  if (
    begin.state === 'existing' &&
    begin.existing &&
    begin.existing.response &&
    (begin.existing.status === 'completed' ||
      begin.existing.status === 'partial' ||
      begin.existing.status === 'failed')
  ) {
    // Run già concluso → risultato idempotente senza rielaborare.
    return { ...begin.existing.response, idempotentReplay: true };
  }

  const verification = await deps.ports.loadVerification(request.verificationId);
  const teacherQuestions = resolveTeacherQuestions(verification, ownerUid);
  const byOrder = new Map((teacherQuestions ?? []).map((q) => [q.order, q]));

  const results = await mapWithConcurrency(
    request.submissionIds,
    SUBMISSION_CONCURRENCY,
    async (submissionId): Promise<SubmissionResult> => {
      const [submission, correction] = await Promise.all([
        deps.ports.loadSubmission(submissionId),
        deps.ports.loadCorrection(submissionId),
      ]);
      const classification = classifySubmission({
        submissionId,
        expectedOwner: ownerUid,
        expectedVerificationId: request.verificationId,
        teacherQuestions,
        submission,
        correction,
      });
      if (classification.status === 'excluded') {
        return {
          submissionId,
          outcome: 'excluded',
          closedGraded: 0,
          openGraded: 0,
          openSkipped: 0,
          alreadyIgnored: 0,
          reason: classification.code,
        };
      }
      return gradeEligible(submissionId, classification.eligible, {
        request,
        ownerUid,
        submission: submission!,
        byOrder,
        grader: deps.grader,
        commit: deps.ports.commitSubmission,
      });
    },
  );

  // Aggregazione.
  const counts = emptyCounts(request.submissionIds.length) as AiCorrectionRunResponse['counts'];
  counts.succeeded = 0;
  counts.partial = 0;
  counts.failed = 0;
  let tokensActual = 0;
  for (const r of results) {
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
    tokensActual += estimateOpenTokensForResult(r);
  }

  const status: RunStatus =
    counts.failed > 0 && counts.succeeded === 0 && counts.partial === 0
      ? 'failed'
      : counts.partial > 0 || counts.failed > 0
        ? 'partial'
        : 'completed';

  const response: AiCorrectionRunResponse = {
    mode: 'mock',
    phase: 'run',
    requestId: request.requestId,
    verificationId: request.verificationId,
    status,
    idempotentReplay: false,
    counts,
    tokensEstimated: tokensActual,
    tokensActual,
    costActual: 0,
    results,
  };

  await deps.ports.finishRun(request.requestId, { status, selectionHash, response });
  return response;
}

// Il conteggio token effettivo (mock) è deterministico e pari alla stima delle
// aperte effettivamente inviate al grader (grezze o valutate); qui lo ricaviamo
// dal risultato per consegna in modo semplice e stabile.
function estimateOpenTokensForResult(r: SubmissionResult): number {
  // Mock: nessun token reale; l'accounting deterministico conta le aperte
  // inviate (valutate + scartate) con l'overhead fisso per domanda.
  return (r.openGraded + r.openSkipped) * OPEN_QUESTION_TOKEN_OVERHEAD;
}

async function gradeEligible(
  submissionId: string,
  eligible: EligibleSubmission,
  ctx: {
    request: AiCorrectionRequest;
    ownerUid: string;
    submission: SubmissionData;
    byOrder: Map<number, TeacherQuestion>;
    grader: AiGrader;
    commit: EngineWritePorts['commitSubmission'];
  },
): Promise<SubmissionResult> {
  const proposed = new Map<number, ValidatedScore>();

  // 1) Chiuse: scoring deterministico.
  for (const order of eligible.closedOrders) {
    const q = ctx.byOrder.get(order);
    if (!q) continue;
    proposed.set(order, {
      points: scoreClosedQuestion(q, ctx.submission.answers[order.toString()]),
    });
  }

  // 2) Aperte: una sola chiamata grader per consegna, poi validazione.
  let openSkipped = 0;
  if (eligible.openOrders.length > 0) {
    const graderInput: AiGraderInput = {
      requestId: ctx.request.requestId,
      questions: eligible.openOrders.map((order) => {
        const q = ctx.byOrder.get(order)!;
        const answer = ctx.submission.answers[order.toString()];
        return {
          order,
          maxPoints: q.maxPoints,
          questionText: q.testo,
          referenceSolution: typeof q.soluzione === 'string' ? q.soluzione : '',
          studentAnswer: answer && answer.tipo === 'aperta' ? answer.testo : '',
        };
      }),
    };
    let validated = new Map<number, ValidatedScore>();
    try {
      const output = await ctx.grader.grade(graderInput);
      validated = validateGraderOutput(
        output,
        ctx.request.requestId,
        new Set(eligible.openOrders),
        new Map(eligible.openOrders.map((o) => [o, ctx.byOrder.get(o)!.maxPoints])),
      );
    } catch {
      validated = new Map(); // output non ottenibile → tutte le aperte restano null
    }
    for (const order of eligible.openOrders) {
      const score = validated.get(order);
      if (score) proposed.set(order, score);
      else openSkipped++;
    }
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
    });
  } catch {
    return {
      submissionId,
      outcome: 'failed',
      closedGraded: 0,
      openGraded: 0,
      openSkipped,
      alreadyIgnored: eligible.alreadyGraded,
      reason: 'write_error',
    };
  }

  if (commit.result === 'changed') {
    return {
      submissionId,
      outcome: 'excluded',
      closedGraded: 0,
      openGraded: 0,
      openSkipped: 0,
      alreadyIgnored: eligible.alreadyGraded,
      reason: 'changed_since_preview',
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
    submissionId,
    outcome,
    closedGraded,
    openGraded,
    openSkipped,
    alreadyIgnored: eligible.alreadyGraded,
  };
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
