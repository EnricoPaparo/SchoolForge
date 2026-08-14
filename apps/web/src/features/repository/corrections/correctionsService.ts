import {
  collection,
  doc,
  getDoc,
  runTransaction,
  serverTimestamp,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import type {
  CorrectionDoc,
  CorrectionEventDoc,
  CorrectionReturnDoc,
  CorrectionReturnQuestionView,
  PublicVerificationQuestion,
  PublishedProjectionDoc,
  QuestionEvaluation,
  SubmissionDoc,
  SubmissionCorrectionStatus,
  SubmissionCorrectionSummary,
  VerificationDoc,
  VerificationTeacherQuestionSnapshot,
} from '../../../types/firestore.js';
import {
  assertValidCorrectionStatusTransition,
  assertValidQuestionPoints,
  computeCorrectionTotals,
  computeGeneralFeedbackDelta,
  computeQuestionEvaluationDeltas,
  INITIAL_CORRECTION_REOPEN_COUNT,
  INITIAL_CORRECTION_STATUS,
  isCorrectionComplete,
  isReopenedCorrection,
  normalizeQuestionPoints,
} from './correctionContract.js';
import { assertCorrectionReturnWithinLimit } from './correctionReturnSize.js';
import { correctionProgressFromEvaluations } from './submissionCorrectionStatus.js';
import {
  isServerResolvedSnapshot,
  resolveAssignedQuestions,
} from '../verifications/assignedVariant.js';
import { assertCopyableVerificationDate } from '../verifications/verificationDate.js';
import { assertCopyableTopicOutline } from '../verifications/topicOutline.js';

function mirrorCorrectionProgress(
  batch: ReturnType<typeof writeBatch>,
  submissionId: string,
  db: Firestore,
  options: {
    status?: SubmissionCorrectionStatus;
    summary?: SubmissionCorrectionSummary;
  },
): void {
  const updatedAt = serverTimestamp();
  const submissionUpdate: Record<string, unknown> = {};
  if (options.status) {
    submissionUpdate.correctionStatus = options.status;
    submissionUpdate.correctionStatusUpdatedAt = updatedAt;
  }
  if (options.summary) {
    submissionUpdate.correctionSummary = options.summary;
    submissionUpdate.correctionSummaryUpdatedAt = updatedAt;
  }
  batch.update(doc(db, 'submissions', submissionId), submissionUpdate);
  if (options.status) {
    batch.update(doc(db, 'submissionReceipts', submissionId), {
      correctionStatus: options.status,
      correctionStatusUpdatedAt: updatedAt,
    });
  }
}

function correctionSummary(
  totals: Pick<SubmissionCorrectionSummary, 'totalPoints' | 'maxPoints' | 'percentage'>,
): SubmissionCorrectionSummary {
  return {
    totalPoints: totals.totalPoints,
    maxPoints: totals.maxPoints,
    percentage: totals.percentage,
  };
}

// ─── Frozen snapshot reads (never the live pool) ────────────────────────────

/**
 * Reads the student-safe published projection for a verification —
 * `order`/`tipo`/`maxPoints`/`testo`/`opzioni`, never a solution. This is
 * always the source of `maxPoints` and question text for a correction
 * (D-M4-07 in `m4-correzione-ux-concept.md`), never `teacherSnapshot`,
 * which may be absent on verifications activated before the SEC-02 fix.
 */
export async function loadPublishedProjectionQuestions(
  verificationId: string,
  db: Firestore,
): Promise<PublicVerificationQuestion[]> {
  const snap = await getDoc(
    doc(db, 'verifications', verificationId, 'publishedProjection', 'data'),
  );
  if (!snap.exists()) {
    throw new Error(
      'Impossibile correggere: nessuno snapshot pubblicato disponibile per questa verifica.',
    );
  }
  return (snap.data() as PublishedProjectionDoc).questions;
}

/**
 * Reads the owner-only teacher snapshot with solutions — only ever needed
 * by `setSolutionsVisible(true)`, never by the rest of this service. Throws
 * explicitly for a verification that predates the SEC-02 immutable-snapshot
 * fix (no `teacherSnapshot.questions`): there is no frozen solution to show
 * in that case, and this service never falls back to the live pool.
 */
/** Legge il documento verifica (teacherSnapshot owner-only). Mai il pool. */
async function loadVerificationForCorrection(
  verificationId: string,
  db: Firestore,
): Promise<VerificationDoc> {
  const snap = await getDoc(doc(db, 'verifications', verificationId));
  if (!snap.exists()) {
    throw new Error('Impossibile correggere: verifica non trovata.');
  }
  return snap.data() as VerificationDoc;
}

type CorrectionVariantSubmission = Pick<
  SubmissionDoc,
  'submissionId' | 'verificationId' | 'assignedQuestionOrders' | 'assignedAnswerKeys'
>;

export type CorrectionVariantContext = {
  submission: CorrectionVariantSubmission;
  verification: VerificationDoc;
  questions?: readonly { order: number; maxPoints: number }[];
};

async function loadCorrectionVariantContext(
  submissionId: string,
  verificationId: string,
  db: Firestore,
  context?: CorrectionVariantContext,
): Promise<CorrectionVariantContext> {
  if (context) {
    if (
      context.submission.submissionId !== submissionId ||
      context.submission.verificationId !== verificationId
    ) {
      throw new Error('Impossibile correggere: contesto della variante incoerente.');
    }
    return context;
  }
  const [submissionSnap, verificationSnap] = await Promise.all([
    getDoc(doc(db, 'submissions', submissionId)),
    getDoc(doc(db, 'verifications', verificationId)),
  ]);
  if (!submissionSnap.exists()) throw new Error('Impossibile correggere: consegna non trovata.');
  if (!verificationSnap.exists()) throw new Error('Impossibile correggere: verifica non trovata.');
  return {
    submission: submissionSnap.data() as SubmissionDoc,
    verification: verificationSnap.data() as VerificationDoc,
  };
}

function resolveSnapshotQuestions(
  context: CorrectionVariantContext,
  includeSameQuestions = false,
): VerificationTeacherQuestionSnapshot[] | null {
  const snapshot = context.verification.teacherSnapshot;
  if (!snapshot) return null; // snapshot legacy: modalita assente => same_questions
  if (isServerResolvedSnapshot(snapshot)) {
    if (!Array.isArray(snapshot.questions) || snapshot.questions.length === 0) {
      throw new Error('Impossibile correggere: snapshot della variante non disponibile.');
    }
    return resolveAssignedQuestions(snapshot, context.submission);
  }
  // same_questions conserva il percorso storico sulla publishedProjection,
  // salvo i flussi che richiedono esplicitamente le soluzioni congelate.
  return includeSameQuestions && Array.isArray(snapshot.questions) && snapshot.questions.length > 0
    ? [...snapshot.questions].sort((a, b) => a.order - b.order)
    : null;
}

function hasValidFrozenSolution(question: VerificationTeacherQuestionSnapshot): boolean {
  const optionIds = new Set(question.opzioni?.map((option) => option.id) ?? []);
  if (question.tipo === 'chiusa_multipla') {
    return (
      Array.isArray(question.soluzione) &&
      question.soluzione.length > 0 &&
      new Set(question.soluzione).size === question.soluzione.length &&
      question.soluzione.every(
        (value) => typeof value === 'string' && value.trim().length > 0 && optionIds.has(value),
      )
    );
  }
  if (question.tipo === 'chiusa_singola') {
    const solutionId =
      typeof question.soluzione === 'string'
        ? question.soluzione
        : Array.isArray(question.soluzione) && question.soluzione.length === 1
          ? question.soluzione[0]
          : null;
    return (
      typeof solutionId === 'string' && solutionId.trim().length > 0 && optionIds.has(solutionId)
    );
  }
  return typeof question.soluzione === 'string' && question.soluzione.trim().length > 0;
}

function assertCorrectionMatchesQuestions(
  correction: CorrectionDoc,
  questions: readonly { order: number; maxPoints: number }[],
  action: string,
): void {
  const expected = new Map(questions.map((question) => [question.order.toString(), question]));
  const actualKeys = Object.keys(correction.evaluations);
  if (actualKeys.length !== expected.size) {
    throw new Error(`Impossibile ${action}: insieme delle domande della correzione incoerente.`);
  }
  for (const key of actualKeys) {
    const evaluation = correction.evaluations[key];
    const question = expected.get(key);
    if (
      !evaluation ||
      !question ||
      evaluation.order !== question.order ||
      evaluation.maxPoints !== question.maxPoints
    ) {
      throw new Error(`Impossibile ${action}: domanda ${key} estranea o incoerente.`);
    }
  }
}

async function loadAuthoritativeCorrectionQuestions(
  correction: Pick<CorrectionDoc, 'submissionId' | 'verificationId'>,
  db: Firestore,
  context?: CorrectionVariantContext,
): Promise<readonly { order: number; maxPoints: number }[]> {
  const resolvedContext = await loadCorrectionVariantContext(
    correction.submissionId,
    correction.verificationId,
    db,
    context,
  );
  const snapshotQuestions = resolveSnapshotQuestions(resolvedContext);
  const questions =
    snapshotQuestions ??
    resolvedContext.questions ??
    (await loadPublishedProjectionQuestions(correction.verificationId, db));
  return questions;
}

async function assertCorrectionMatchesAuthoritativeVariant(
  correction: CorrectionDoc,
  db: Firestore,
  action: string,
  context?: CorrectionVariantContext,
): Promise<void> {
  const questions = await loadAuthoritativeCorrectionQuestions(correction, db, context);
  assertCorrectionMatchesQuestions(correction, questions, action);
}

// ─── openOrLoadCorrection ────────────────────────────────────────────────────

/**
 * Opens the correction workspace for a submitted submission: returns the
 * existing `corrections/{submissionId}` document if one already exists
 * (never rewriting it — no data loss, no reset of `reopenCount`/evaluations
 * on a second open), or creates exactly one `'in_progress'` correction,
 * initialized with one `QuestionEvaluation` per question in the verification's
 * published projection (`points: null`, `maxPoints` frozen from the
 * projection).
 *
 * Idempotent and resistant to two near-simultaneous opens (e.g. two browser
 * tabs): the creation path re-checks existence inside a `runTransaction`, so
 * only the first of two concurrent calls actually creates the document —
 * the second transparently returns what the first just wrote.
 *
 * Never reads the current pool — only `submissions/{submissionId}` (for
 * `status`/`ownerUid`/`verificationId`/`studentUid`) and the verification's
 * `publishedProjection` (frozen at activation).
 */
export type OpenCorrectionResult = {
  correction: CorrectionDoc;
  /**
   * The published projection questions read while creating the correction, or
   * `null` when an existing correction was returned via the fast path (no
   * projection read happened). Lets the workspace loader reuse this single
   * read for legacy question text instead of reading the projection twice on
   * the first open (Task 2.8 — no duplicate projection read per open).
   */
  projectionQuestions: PublicVerificationQuestion[] | null;
};

export async function openOrLoadCorrection(
  submissionId: string,
  ownerUid: string,
  db: Firestore,
  /**
   * Verifica già letta dal workspace: riusata senza nuove letture e fonte
   * esclusiva del `distributionMode` autorevole.
   */
  verification?: VerificationDoc,
  loadedSubmission?: SubmissionDoc,
): Promise<OpenCorrectionResult> {
  const ref = doc(db, 'corrections', submissionId);

  // Anche l'esistente viene validato; il workspace riusa i documenti caricati.
  const existing = await getDoc(ref);
  let submission = loadedSubmission;
  if (!submission) {
    const submissionSnap = await getDoc(doc(db, 'submissions', submissionId));
    if (!submissionSnap.exists()) {
      throw new Error('Impossibile correggere: consegna non trovata.');
    }
    submission = submissionSnap.data() as SubmissionDoc;
  }
  if (submission.status !== 'submitted') {
    throw new Error('Impossibile correggere: la consegna non è ancora stata inviata.');
  }
  if (submission.ownerUid !== ownerUid) {
    throw new Error('Impossibile correggere: la consegna non appartiene a questo docente.');
  }

  // VEX-02B: la modalità viene sempre normalizzata dal teacherSnapshot prima
  // di leggere l'assegnazione. I campi assigned non scelgono mai il percorso.
  const loadedVerification =
    verification ?? (await loadVerificationForCorrection(submission.verificationId, db));
  const snapshotQuestions = resolveSnapshotQuestions({
    submission,
    verification: loadedVerification,
  });
  if (existing.exists()) {
    const correction = existing.data() as CorrectionDoc;
    const applicable =
      snapshotQuestions ?? (await loadPublishedProjectionQuestions(submission.verificationId, db));
    assertCorrectionMatchesQuestions(correction, applicable, 'aprire');
    return { correction, projectionQuestions: null };
  }

  const evaluations: Record<string, QuestionEvaluation> = {};
  let projectionQuestions: PublicVerificationQuestion[] | null = null;
  if (snapshotQuestions) {
    for (const question of snapshotQuestions) {
      evaluations[question.order.toString()] = {
        order: question.order,
        points: null,
        maxPoints: question.maxPoints,
      };
    }
  } else {
    projectionQuestions = await loadPublishedProjectionQuestions(submission.verificationId, db);
    for (const question of projectionQuestions) {
      evaluations[question.order.toString()] = {
        order: question.order,
        points: null,
        maxPoints: question.maxPoints,
      };
    }
  }
  const totals = computeCorrectionTotals(evaluations);

  return runTransaction(db, async (transaction) => {
    const snap = await transaction.get(ref);
    if (snap.exists()) {
      return { correction: snap.data() as CorrectionDoc, projectionQuestions };
    }
    const payload: CorrectionDoc = {
      submissionId,
      verificationId: submission.verificationId,
      studentUid: submission.studentUid,
      ownerUid,
      status: INITIAL_CORRECTION_STATUS,
      evaluations,
      generalFeedback: null,
      totalPoints: totals.totalPoints,
      maxPoints: totals.maxPoints,
      percentage: totals.percentage,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      completedAt: null,
      returnedAt: null,
      reopenCount: INITIAL_CORRECTION_REOPEN_COUNT,
    };
    transaction.set(ref, payload);
    return { correction: payload, projectionQuestions };
  });
}

// ─── saveCorrection ──────────────────────────────────────────────────────────

export type SaveCorrectionQuestionInput = {
  points: number | null;
  feedback?: string;
};

export type SaveCorrectionInput = {
  submissionId: string;
  /** Keyed by `order.toString()` — must cover exactly the same question set already on the correction. */
  evaluations: Record<string, SaveCorrectionQuestionInput>;
  generalFeedback: string | null;
};

/**
 * Persists scores/feedback on an `'in_progress'` correction. Explicit save
 * only — no autosave, no listener, no write on every keystroke.
 *
 * - Rejects a question set that doesn't match the correction's frozen
 *   evaluations exactly (missing, duplicate/extra, or unknown `order` keys)
 *   — the caller can only re-score what was already frozen at
 *   `openOrLoadCorrection`, never add or drop a question.
 * - Validates every non-null score with `assertValidQuestionPoints`
 *   (explicit rejection, never a silent clamp).
 * - No write at all if nothing actually changed (same points and feedback
 *   for every question, same `generalFeedback`).
 * - First pass (`reopenCount === 0`): a single `updateDoc`, never an event —
 *   however many times the docente saves.
 * - After at least one reopen (`reopenCount > 0`): if the change is real,
 *   the correction update and a `'scoreAdjusted'` `correctionEvents` entry
 *   (delta-only, via `computeQuestionEvaluationDeltas`/
 *   `computeGeneralFeedbackDelta`) are written atomically in one `writeBatch`.
 */
/**
 * The normalized, persisted correction state `saveCorrection` returns, so the
 * caller can update its baseline/dirty/totals/navigator from exactly what was
 * written — no post-save Firestore re-read. Contains only workflow/scoring
 * fields the workspace already renders; never a solution, answer or PII.
 */
export type SaveCorrectionResult = {
  evaluations: Record<string, QuestionEvaluation>;
  generalFeedback: string | null;
  totalPoints: number;
  maxPoints: number;
  percentage: number | null;
};

export async function saveCorrection(
  input: SaveCorrectionInput,
  db: Firestore,
  context?: CorrectionVariantContext,
): Promise<SaveCorrectionResult> {
  const { submissionId, evaluations: incoming, generalFeedback } = input;
  const ref = doc(db, 'corrections', submissionId);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    throw new Error('Impossibile salvare: correzione non trovata.');
  }
  const correction = snap.data() as CorrectionDoc;
  if (correction.status !== 'in_progress') {
    throw new Error('Impossibile salvare: la correzione non è in corso.');
  }
  await assertCorrectionMatchesAuthoritativeVariant(correction, db, 'salvare', context);

  const existingKeys = Object.keys(correction.evaluations);
  const incomingKeys = Object.keys(incoming);
  const sameKeySet =
    existingKeys.length === incomingKeys.length &&
    existingKeys.every((key) => Object.prototype.hasOwnProperty.call(incoming, key));
  if (!sameKeySet) {
    throw new Error(
      'Impossibile salvare: le domande valutate non corrispondono esattamente a quelle congelate per questa correzione.',
    );
  }

  const nextEvaluations: Record<string, QuestionEvaluation> = {};
  for (const key of existingKeys) {
    const previous = correction.evaluations[key]!;
    const next = incoming[key]!;
    // Validate (quarter-point multiple in range) then snap to the exact
    // quarter, clearing any floating-point noise before it is persisted.
    let points = next.points;
    if (points !== null) {
      assertValidQuestionPoints(points, previous.maxPoints);
      points = normalizeQuestionPoints(points);
    }
    nextEvaluations[key] = {
      order: previous.order,
      points,
      maxPoints: previous.maxPoints,
      ...(next.feedback !== undefined ? { feedback: next.feedback } : {}),
    };
  }

  const totals = computeCorrectionTotals(nextEvaluations);
  const result: SaveCorrectionResult = {
    evaluations: nextEvaluations,
    generalFeedback,
    totalPoints: totals.totalPoints,
    maxPoints: totals.maxPoints,
    percentage: totals.percentage,
  };

  const questionDeltas = computeQuestionEvaluationDeltas(correction.evaluations, nextEvaluations);
  const generalFeedbackDelta = computeGeneralFeedbackDelta(
    correction.generalFeedback,
    generalFeedback,
  );

  if (questionDeltas.length === 0 && !generalFeedbackDelta) {
    // Nothing actually changed — no write at all. The already-persisted state
    // is exactly `result`, so the caller can still refresh its baseline.
    return result;
  }

  const update: Record<string, unknown> = {
    evaluations: nextEvaluations,
    generalFeedback,
    totalPoints: totals.totalPoints,
    maxPoints: totals.maxPoints,
    percentage: totals.percentage,
    updatedAt: serverTimestamp(),
  };

  const previousPublicStatus = correctionProgressFromEvaluations(correction.evaluations);
  const nextPublicStatus = correctionProgressFromEvaluations(nextEvaluations);
  const publicStatusChanged = previousPublicStatus !== nextPublicStatus;

  const batch = writeBatch(db);
  batch.update(ref, update);
  mirrorCorrectionProgress(batch, submissionId, db, {
    ...(publicStatusChanged ? { status: nextPublicStatus } : {}),
    summary: correctionSummary(totals),
  });
  if (isReopenedCorrection(correction)) {
    const event: CorrectionEventDoc = {
      correctionId: submissionId,
      ownerUid: correction.ownerUid,
      type: 'scoreAdjusted',
      actorUid: correction.ownerUid,
      previousStatus: correction.status,
      nextStatus: correction.status,
      reason: null,
      ...(questionDeltas.length > 0 ? { questionDeltas } : {}),
      ...(generalFeedbackDelta ? { generalFeedbackDelta } : {}),
      timestamp: serverTimestamp(),
    };
    batch.set(doc(collection(db, 'correctionEvents')), event);
  }
  await batch.commit();
  return result;
}

// ─── completeCorrection ──────────────────────────────────────────────────────

/**
 * Transitions `'in_progress' → 'completed'`. Rejects an empty or
 * partially-evaluated `evaluations` map (`isCorrectionComplete`) — a
 * correction can never become `'completed'` while any question still has
 * `points: null`. Does not create/touch `correctionReturns` — completing
 * and returning are two distinct docente actions (D-M4-08/D-M4-09).
 */
export async function completeCorrection(
  submissionId: string,
  db: Firestore,
  context?: CorrectionVariantContext,
): Promise<void> {
  const ref = doc(db, 'corrections', submissionId);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    throw new Error('Impossibile completare: correzione non trovata.');
  }
  const correction = snap.data() as CorrectionDoc;
  await assertCorrectionMatchesAuthoritativeVariant(correction, db, 'completare', context);
  assertValidCorrectionStatusTransition(correction.status, 'completed');
  if (!isCorrectionComplete(correction.evaluations)) {
    throw new Error('Impossibile completare: una o più domande non sono ancora state valutate.');
  }
  const batch = writeBatch(db);
  batch.update(ref, {
    status: 'completed',
    completedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  mirrorCorrectionProgress(batch, submissionId, db, {
    status: 'completed',
  });
  await batch.commit();
}

// ─── returnCorrection ────────────────────────────────────────────────────────

/**
 * Transitions `'completed' → 'returned'` and builds the self-sufficient
 * `correctionReturns/{submissionId}` projection entirely from already-frozen
 * data — the submitted submission's answers and the verification's immutable
 * teacher snapshot — plus the completed correction's own scores/feedback.
 * Never reads the live pool, Storage, or the published projection and never
 * writes the submission itself.
 *
 * `visibleToStudent` and `solutionsVisible` both start `true`; every returned
 * question carries its frozen `correctAnswer`. The complete projection is
 * checked against `assertCorrectionReturnWithinLimit` before writing — a
 * projection that would be too large fails loudly, never silently truncated.
 *
 * Correction update, submission/receipt status mirrors, projection
 * create/overwrite, and the `'returned'` `correctionEvents` entry are written
 * atomically in a single `writeBatch`.
 */
export async function returnCorrection(submissionId: string, db: Firestore): Promise<void> {
  const ref = doc(db, 'corrections', submissionId);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    throw new Error('Impossibile restituire: correzione non trovata.');
  }
  const correction = snap.data() as CorrectionDoc;
  assertValidCorrectionStatusTransition(correction.status, 'returned');

  const submissionSnap = await getDoc(doc(db, 'submissions', submissionId));
  if (!submissionSnap.exists()) {
    throw new Error('Impossibile restituire: consegna non trovata.');
  }
  const submission = submissionSnap.data() as SubmissionDoc;
  if (!submission.submittedAt) {
    throw new Error('Impossibile restituire: la consegna non risulta ancora inviata.');
  }

  const verificationSnap = await getDoc(doc(db, 'verifications', correction.verificationId));
  if (!verificationSnap.exists()) {
    throw new Error('Impossibile restituire: verifica non trovata.');
  }
  const verification = verificationSnap.data() as VerificationDoc;

  // TWU-03B: teacherSnapshot è l'unica fonte autorevole della proiezione
  // restituita, incluse le soluzioni. Nessun fallback al pool live, Storage o
  // publishedProjection. Per VEX il resolver canonico limita lo snapshot alla
  // sola variante assegnata.
  const snapshotQuestions = resolveSnapshotQuestions({ submission, verification }, true);
  if (!snapshotQuestions) {
    throw new Error('Impossibile restituire: snapshot docente con soluzioni non disponibile.');
  }
  const invalidSolution = snapshotQuestions.find((question) => !hasValidFrozenSolution(question));
  if (invalidSolution) {
    throw new Error(
      `Impossibile restituire: soluzione congelata mancante o non valida per la domanda ${invalidSolution.order}.`,
    );
  }
  const questionByOrder = new Map(snapshotQuestions.map((question) => [question.order, question]));

  assertCorrectionMatchesQuestions(
    correction,
    [...questionByOrder.entries()].map(([order, question]) => ({
      order,
      maxPoints: question.maxPoints,
    })),
    'restituire',
  );

  const questions: CorrectionReturnQuestionView[] = Object.keys(correction.evaluations)
    .map((key) => Number(key))
    .sort((a, b) => a - b)
    .map((order) => {
      const evaluation = correction.evaluations[order.toString()]!;
      const question = questionByOrder.get(order);
      if (!question) {
        throw new Error(
          `Impossibile restituire: domanda ${order} assente dalla variante assegnata.`,
        );
      }
      if (evaluation.points === null) {
        // Should be unreachable: 'returned' requires 'completed' first, and
        // completeCorrection already rejects an unevaluated question — this
        // is a defensive guard, not a reachable product state.
        throw new Error(`Impossibile restituire: la domanda ${order} non è ancora valutata.`);
      }
      return {
        order,
        tipo: question.tipo,
        testo: question.testo,
        ...(question.opzioni ? { opzioni: question.opzioni } : {}),
        studentAnswer: submission.answers[order.toString()] ?? null,
        points: evaluation.points,
        maxPoints: evaluation.maxPoints,
        ...(evaluation.feedback !== undefined ? { feedback: evaluation.feedback } : {}),
        correctAnswer: question.soluzione,
      };
    });

  // UI-VERIFICHE-06B — data e perimetro didattico copiati dallo **snapshot
  // congelato** (unica fonte autorevole, come titolo/classe e soluzioni). Mai
  // dalla `publishedProjection`, mai da valori forniti dallo studente, mai
  // dedotti da titoli o domande. Validati qui: assenti ⇒ omessi (snapshot
  // legacy), presenti ma malformati ⇒ errore **prima** di qualunque write.
  const returnedVerificationDate = assertCopyableVerificationDate(
    verification.teacherSnapshot?.verificationDate,
  );
  const returnedTopicOutline = assertCopyableTopicOutline(
    verification.teacherSnapshot?.topicOutline,
  );

  const correctionReturn: CorrectionReturnDoc = {
    correctionId: submissionId,
    verificationId: correction.verificationId,
    studentUid: correction.studentUid,
    ownerUid: correction.ownerUid,
    verificationTitle: verification.teacherSnapshot?.title ?? submission.verificationTitle,
    className: verification.teacherSnapshot?.className ?? submission.className,
    ...(returnedVerificationDate === null ? {} : { verificationDate: returnedVerificationDate }),
    ...(returnedTopicOutline === null ? {} : { topicOutline: returnedTopicOutline }),
    submittedAt: submission.submittedAt,
    returnedAt: serverTimestamp(),
    questions,
    generalFeedback: correction.generalFeedback,
    totalPoints: correction.totalPoints,
    maxPoints: correction.maxPoints,
    percentage: correction.percentage,
    visibleToStudent: true,
    solutionsVisible: true,
    updatedAt: serverTimestamp(),
  };
  assertCorrectionReturnWithinLimit(correctionReturn);

  const batch = writeBatch(db);
  batch.update(ref, {
    status: 'returned',
    returnedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  // completeCorrection already persisted the final score summary. Rewriting
  // that identical map here would leave only correctionSummaryUpdatedAt in
  // Firestore's affectedKeys(), which the paired-field Rules correctly deny.
  // Returning changes only the public workflow status.
  mirrorCorrectionProgress(batch, submissionId, db, {
    status: 'returned',
  });
  batch.set(doc(db, 'correctionReturns', submissionId), correctionReturn);
  const event: CorrectionEventDoc = {
    correctionId: submissionId,
    ownerUid: correction.ownerUid,
    type: 'returned',
    actorUid: correction.ownerUid,
    previousStatus: correction.status,
    nextStatus: 'returned',
    reason: null,
    timestamp: serverTimestamp(),
  };
  batch.set(doc(collection(db, 'correctionEvents')), event);
  await batch.commit();
}

// ─── reopenCorrection ────────────────────────────────────────────────────────

/**
 * Transitions `'completed' | 'returned' → 'in_progress'`: clears
 * `completedAt`/`returnedAt`, increments `reopenCount` by exactly one, and
 * appends a `'reopened'` `correctionEvents` entry — all in one atomic
 * `writeBatch`. If the correction was `'returned'`, the existing
 * `correctionReturns` projection is flipped to `visibleToStudent: false`
 * in the **same** batch, so the student can never keep reading a result
 * that is actively being rectified. The projection's scoring data is left
 * untouched (not deleted) — `returnCorrection` will overwrite it wholesale
 * the next time this correction is returned.
 */
export async function reopenCorrection(
  submissionId: string,
  db: Firestore,
  context?: CorrectionVariantContext,
): Promise<void> {
  const ref = doc(db, 'corrections', submissionId);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    throw new Error('Impossibile riaprire: correzione non trovata.');
  }
  const correction = snap.data() as CorrectionDoc;
  assertValidCorrectionStatusTransition(correction.status, 'in_progress');
  await assertCorrectionMatchesAuthoritativeVariant(correction, db, 'riaprire', context);
  const wasReturned = correction.status === 'returned';

  const batch = writeBatch(db);
  batch.update(ref, {
    status: 'in_progress',
    completedAt: null,
    returnedAt: null,
    reopenCount: correction.reopenCount + 1,
    updatedAt: serverTimestamp(),
  });
  mirrorCorrectionProgress(batch, submissionId, db, { status: 'in_progress' });
  if (wasReturned) {
    batch.update(doc(db, 'correctionReturns', submissionId), {
      visibleToStudent: false,
      updatedAt: serverTimestamp(),
    });
  }
  const event: CorrectionEventDoc = {
    correctionId: submissionId,
    ownerUid: correction.ownerUid,
    type: 'reopened',
    actorUid: correction.ownerUid,
    previousStatus: correction.status,
    nextStatus: 'in_progress',
    reason: null,
    timestamp: serverTimestamp(),
  };
  batch.set(doc(collection(db, 'correctionEvents')), event);
  await batch.commit();
}

// ─── clearCorrection (M5-04C) ────────────────────────────────────────────────

export interface ClearCorrectionResult {
  /** `false` = no-op: non c'era nulla da azzerare (nessuna scrittura). */
  cleared: boolean;
  /** Stato invariato: la correzione resta `in_progress`. */
  status: 'in_progress';
  /** Summary normalizzato appena scritto (nessuna rilettura post-write). */
  summary: SubmissionCorrectionSummary;
}

/** `true` se la correzione contiene qualcosa da azzerare (punti/feedback). */
function hasSomethingToClear(correction: CorrectionDoc): boolean {
  const evaluations = Object.values(correction.evaluations ?? {});
  const hasPoints = evaluations.some((e) => e.points !== null);
  const hasQuestionFeedback = evaluations.some(
    (e) => typeof e.feedback === 'string' && e.feedback.length > 0,
  );
  const hasGeneral =
    typeof correction.generalFeedback === 'string' && correction.generalFeedback.trim().length > 0;
  return hasPoints || hasQuestionFeedback || hasGeneral;
}

/**
 * M5-04C — «Azzera correzione»: riporta una correzione `in_progress` allo stato
 * non valutato, **atomicamente**. Azzera tutti i `points` (a `null`), rimuove i
 * feedback per domanda e il `generalFeedback`, ricalcola i totali con l'helper
 * canonico e aggiorna il mirror `correctionSummary`/`correctionStatus` della
 * submission e del receipt, **mantenendo** `status: 'in_progress'`. Non tocca la
 * consegna dello studente, le `answers`, il receipt (oltre al mirror), gli
 * attentionEvents né alcuna `CorrectionReturnDoc`; non cancella documenti; non
 * riapre automaticamente. Scrive **un solo** evento `correctionCleared`
 * (metadata) nella stessa transazione. Se non c'è nulla da azzerare è un
 * **no-op** leggibile: nessuna scrittura, nessun evento. Rifiuta senza scritture
 * parziali se la correzione non esiste o non è più `in_progress` (transazione).
 */
export async function clearCorrection(
  submissionId: string,
  db: Firestore,
  context?: CorrectionVariantContext,
): Promise<ClearCorrectionResult> {
  const ref = doc(db, 'corrections', submissionId);
  let correctionIdentity: Pick<CorrectionDoc, 'submissionId' | 'verificationId'>;
  if (context) {
    correctionIdentity = {
      submissionId,
      verificationId: context.submission.verificationId,
    };
  } else {
    const preflight = await getDoc(ref);
    if (!preflight.exists()) {
      throw new Error('Impossibile azzerare: correzione non trovata.');
    }
    correctionIdentity = preflight.data() as CorrectionDoc;
  }
  const authoritativeQuestions = await loadAuthoritativeCorrectionQuestions(
    correctionIdentity,
    db,
    context,
  );
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) {
      throw new Error('Impossibile azzerare: correzione non trovata.');
    }
    const correction = snap.data() as CorrectionDoc;
    if (correction.status !== 'in_progress') {
      throw new Error('Impossibile azzerare: riapri prima la correzione.');
    }
    assertCorrectionMatchesQuestions(correction, authoritativeQuestions, 'azzerare');

    if (!hasSomethingToClear(correction)) {
      // No-op: nulla da azzerare → nessuna scrittura, nessun evento.
      return {
        cleared: false,
        status: 'in_progress',
        summary: correctionSummary(computeCorrectionTotals(correction.evaluations)),
      };
    }

    const cleared: Record<string, QuestionEvaluation> = {};
    for (const [key, evaluation] of Object.entries(correction.evaluations)) {
      // Preserva order e maxPoints; azzera points e rimuove il feedback.
      cleared[key] = { order: evaluation.order, points: null, maxPoints: evaluation.maxPoints };
    }
    const totals = computeCorrectionTotals(cleared);
    const summary = correctionSummary(totals);
    const status = correctionProgressFromEvaluations(cleared); // 'submitted' (nessun points)
    const now = serverTimestamp();

    tx.update(ref, {
      evaluations: cleared,
      generalFeedback: null,
      totalPoints: totals.totalPoints,
      maxPoints: totals.maxPoints,
      percentage: totals.percentage,
      updatedAt: now,
    });
    tx.update(doc(db, 'submissions', submissionId), {
      correctionStatus: status,
      correctionStatusUpdatedAt: now,
      correctionSummary: summary,
      correctionSummaryUpdatedAt: now,
    });
    tx.update(doc(db, 'submissionReceipts', submissionId), {
      correctionStatus: status,
      correctionStatusUpdatedAt: now,
    });

    const event: CorrectionEventDoc = {
      correctionId: submissionId,
      ownerUid: correction.ownerUid,
      type: 'correctionCleared',
      actorUid: correction.ownerUid,
      previousStatus: 'in_progress',
      nextStatus: 'in_progress',
      reason: null,
      timestamp: now,
    };
    tx.set(doc(collection(db, 'correctionEvents')), event);

    return { cleared: true, status: 'in_progress', summary };
  });
}

// ─── Return-projection visibility toggles ───────────────────────────────────

/**
 * Guards both toggles below against a stale `correctionReturns` document:
 * `reopenCorrection` hides the projection (`visibleToStudent: false`) but
 * deliberately does not delete it, so its mere *existence* is never
 * sufficient to authorize a visibility/solutions change — only the
 * `corrections` document's own canonical `status` is. Throws explicitly
 * when the correction is missing or not currently `'returned'` (i.e. a
 * rectification is in progress after a reopen): no toggle may re-surface
 * or grow a projection that is being actively corrected.
 */
async function assertCorrectionCurrentlyReturned(
  submissionId: string,
  db: Firestore,
  action: string,
): Promise<CorrectionDoc> {
  const snap = await getDoc(doc(db, 'corrections', submissionId));
  if (!snap.exists()) {
    throw new Error(`Impossibile ${action}: correzione non trovata.`);
  }
  const correction = snap.data() as CorrectionDoc;
  if (correction.status !== 'returned') {
    throw new Error(
      `Impossibile ${action}: la correzione non è attualmente restituita (stato '${correction.status}').`,
    );
  }
  return correction;
}

/**
 * Shows/hides an existing returned correction to the student without
 * touching `corrections` or the scoring data. Requires the correction to be
 * currently `'returned'` — see `assertCorrectionCurrentlyReturned`: a
 * projection left over from before a reopen must never be toggled while a
 * rectification is in progress. No-ops (no write at all) if the value is
 * already what was requested.
 */
export async function setReturnVisibleToStudent(
  submissionId: string,
  visible: boolean,
  db: Firestore,
): Promise<'changed' | 'noop'> {
  await assertCorrectionCurrentlyReturned(submissionId, db, 'aggiornare la visibilità');

  const ref = doc(db, 'correctionReturns', submissionId);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    throw new Error('Impossibile aggiornare la visibilità: nessuna correzione restituita trovata.');
  }
  const current = snap.data() as CorrectionReturnDoc;
  if (current.visibleToStudent === visible) return 'noop';
  await updateDoc(ref, { visibleToStudent: visible, updatedAt: serverTimestamp() });
  return 'changed';
}

/**
 * Shows/hides solutions on an existing returned correction.
 *
 * - `true`: reads the owner-only teacher snapshot (frozen solutions, never
 *   the live pool) and rewrites every `questions[i].correctAnswer` from it,
 *   then re-checks `assertCorrectionReturnWithinLimit` (solutions can grow
 *   the document significantly).
 * - `false`: **physically removes** `correctAnswer` from every question —
 *   never a client-side-only hide, so Security Rules never need to inspect
 *   `questions[*]` to decide what a student may read.
 *
 * Requires the correction to be currently `'returned'` — see
 * `assertCorrectionCurrentlyReturned`: never reveals/removes solutions on a
 * projection left over from before a reopen while a rectification is in
 * progress. No-ops (no write at all) if `solutionsVisible` already matches
 * the requested value.
 */
export async function setSolutionsVisible(
  submissionId: string,
  visible: boolean,
  db: Firestore,
  context?: CorrectionVariantContext,
): Promise<'changed' | 'noop'> {
  const correction = await assertCorrectionCurrentlyReturned(
    submissionId,
    db,
    'aggiornare le soluzioni',
  );

  const ref = doc(db, 'correctionReturns', submissionId);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    throw new Error('Impossibile aggiornare le soluzioni: nessuna correzione restituita trovata.');
  }
  const current = snap.data() as CorrectionReturnDoc;
  if (current.solutionsVisible === visible) return 'noop';

  if (visible) {
    const resolvedContext = await loadCorrectionVariantContext(
      submissionId,
      current.verificationId,
      db,
      context,
    );
    const teacherQuestions = resolveSnapshotQuestions(resolvedContext, true);
    if (!teacherQuestions) {
      throw new Error(
        'Impossibile mostrare le soluzioni: snapshot docente con soluzioni non disponibile.',
      );
    }
    assertCorrectionMatchesQuestions(correction, teacherQuestions, 'mostrare le soluzioni');
    const returnOrders = current.questions.map((question) => question.order.toString());
    const expectedOrders = teacherQuestions.map((question) => question.order.toString());
    if (
      returnOrders.length !== expectedOrders.length ||
      expectedOrders.some((key) => !returnOrders.includes(key))
    ) {
      throw new Error(
        'Impossibile mostrare le soluzioni: restituzione incoerente con la variante assegnata.',
      );
    }
    const byOrder = new Map(teacherQuestions.map((q) => [q.order, q]));
    const nextQuestions: CorrectionReturnQuestionView[] = current.questions.map((question) => {
      const teacherQuestion = byOrder.get(question.order);
      if (!teacherQuestion) {
        throw new Error(
          `Impossibile mostrare le soluzioni: domanda ${question.order} assente dallo snapshot docente.`,
        );
      }
      return { ...question, correctAnswer: teacherQuestion.soluzione };
    });
    assertCorrectionReturnWithinLimit({ ...current, questions: nextQuestions });
    await updateDoc(ref, {
      questions: nextQuestions,
      solutionsVisible: true,
      updatedAt: serverTimestamp(),
    });
    return 'changed';
  }

  const nextQuestions: CorrectionReturnQuestionView[] = current.questions.map((question) => {
    if (!('correctAnswer' in question)) return question;
    const withoutSolution: CorrectionReturnQuestionView = { ...question };
    delete withoutSolution.correctAnswer;
    return withoutSolution;
  });
  await updateDoc(ref, {
    questions: nextQuestions,
    solutionsVisible: false,
    updatedAt: serverTimestamp(),
  });
  return 'changed';
}
