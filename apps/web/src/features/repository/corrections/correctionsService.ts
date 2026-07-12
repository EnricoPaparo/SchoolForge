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
} from './correctionContract.js';
import { assertCorrectionReturnWithinLimit } from './correctionReturnSize.js';

// ─── Frozen snapshot reads (never the live pool) ────────────────────────────

/**
 * Reads the student-safe published projection for a verification —
 * `order`/`tipo`/`maxPoints`/`testo`/`opzioni`, never a solution. This is
 * always the source of `maxPoints` and question text for a correction
 * (D-M4-07 in `m4-correzione-ux-concept.md`), never `teacherSnapshot`,
 * which may be absent on verifications activated before the SEC-02 fix.
 */
async function loadPublishedProjectionQuestions(
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
async function loadTeacherSnapshotQuestions(
  verificationId: string,
  db: Firestore,
): Promise<VerificationTeacherQuestionSnapshot[]> {
  const snap = await getDoc(doc(db, 'verifications', verificationId));
  if (!snap.exists()) {
    throw new Error('Impossibile mostrare le soluzioni: verifica non trovata.');
  }
  const questions = (snap.data() as VerificationDoc).teacherSnapshot?.questions;
  if (!questions) {
    throw new Error(
      'Impossibile mostrare le soluzioni: questa verifica non ha uno snapshot con soluzioni ' +
        'congelate (attivata prima del fix dello snapshot immutabile).',
    );
  }
  return questions;
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
export async function openOrLoadCorrection(
  submissionId: string,
  ownerUid: string,
  db: Firestore,
): Promise<CorrectionDoc> {
  const ref = doc(db, 'corrections', submissionId);

  // Fast path: already exists — pure read, no write attempted at all.
  const existing = await getDoc(ref);
  if (existing.exists()) {
    return existing.data() as CorrectionDoc;
  }

  const submissionSnap = await getDoc(doc(db, 'submissions', submissionId));
  if (!submissionSnap.exists()) {
    throw new Error('Impossibile correggere: consegna non trovata.');
  }
  const submission = submissionSnap.data() as SubmissionDoc;
  if (submission.status !== 'submitted') {
    throw new Error('Impossibile correggere: la consegna non è ancora stata inviata.');
  }
  if (submission.ownerUid !== ownerUid) {
    throw new Error('Impossibile correggere: la consegna non appartiene a questo docente.');
  }

  const projectionQuestions = await loadPublishedProjectionQuestions(submission.verificationId, db);

  const evaluations: Record<string, QuestionEvaluation> = {};
  for (const question of projectionQuestions) {
    evaluations[question.order.toString()] = {
      order: question.order,
      points: null,
      maxPoints: question.maxPoints,
    };
  }
  const totals = computeCorrectionTotals(evaluations);

  return runTransaction(db, async (transaction) => {
    const snap = await transaction.get(ref);
    if (snap.exists()) {
      return snap.data() as CorrectionDoc;
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
    return payload;
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
export async function saveCorrection(input: SaveCorrectionInput, db: Firestore): Promise<void> {
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
    if (next.points !== null) {
      assertValidQuestionPoints(next.points, previous.maxPoints);
    }
    nextEvaluations[key] = {
      order: previous.order,
      points: next.points,
      maxPoints: previous.maxPoints,
      ...(next.feedback !== undefined ? { feedback: next.feedback } : {}),
    };
  }

  const questionDeltas = computeQuestionEvaluationDeltas(correction.evaluations, nextEvaluations);
  const generalFeedbackDelta = computeGeneralFeedbackDelta(
    correction.generalFeedback,
    generalFeedback,
  );

  if (questionDeltas.length === 0 && !generalFeedbackDelta) {
    return; // nothing actually changed — no write at all
  }

  const totals = computeCorrectionTotals(nextEvaluations);
  const update: Record<string, unknown> = {
    evaluations: nextEvaluations,
    generalFeedback,
    totalPoints: totals.totalPoints,
    maxPoints: totals.maxPoints,
    percentage: totals.percentage,
    updatedAt: serverTimestamp(),
  };

  if (!isReopenedCorrection(correction)) {
    await updateDoc(ref, update);
    return;
  }

  const batch = writeBatch(db);
  batch.update(ref, update);
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
  await batch.commit();
}

// ─── completeCorrection ──────────────────────────────────────────────────────

/**
 * Transitions `'in_progress' → 'completed'`. Rejects an empty or
 * partially-evaluated `evaluations` map (`isCorrectionComplete`) — a
 * correction can never become `'completed'` while any question still has
 * `points: null`. Does not create/touch `correctionReturns` — completing
 * and returning are two distinct docente actions (D-M4-08/D-M4-09).
 */
export async function completeCorrection(submissionId: string, db: Firestore): Promise<void> {
  const ref = doc(db, 'corrections', submissionId);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    throw new Error('Impossibile completare: correzione non trovata.');
  }
  const correction = snap.data() as CorrectionDoc;
  assertValidCorrectionStatusTransition(correction.status, 'completed');
  if (!isCorrectionComplete(correction.evaluations)) {
    throw new Error('Impossibile completare: una o più domande non sono ancora state valutate.');
  }
  await updateDoc(ref, {
    status: 'completed',
    completedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

// ─── returnCorrection ────────────────────────────────────────────────────────

/**
 * Transitions `'completed' → 'returned'` and builds the self-sufficient
 * `correctionReturns/{submissionId}` projection entirely from already-frozen
 * data — the submitted submission's answers and the verification's
 * published projection (question text/options, never the live pool) —
 * plus the completed correction's own scores/feedback. Never reads or
 * writes the submission itself.
 *
 * `visibleToStudent` starts `true` and `solutionsVisible` starts `false`:
 * no solution is ever present on first return. Checked against
 * `assertCorrectionReturnWithinLimit` before writing — a projection that
 * would be too large fails loudly, never silently truncated.
 *
 * Correction update, projection create/overwrite, and the `'returned'`
 * `correctionEvents` entry are written atomically in a single `writeBatch`.
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

  const projectionQuestions = await loadPublishedProjectionQuestions(correction.verificationId, db);
  const projectionByOrder = new Map(projectionQuestions.map((q) => [q.order, q]));

  const questions: CorrectionReturnQuestionView[] = Object.keys(correction.evaluations)
    .map((key) => Number(key))
    .sort((a, b) => a - b)
    .map((order) => {
      const evaluation = correction.evaluations[order.toString()]!;
      const question = projectionByOrder.get(order);
      if (!question) {
        throw new Error(
          `Impossibile restituire: domanda ${order} assente dallo snapshot pubblicato.`,
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
      };
    });

  const correctionReturn: CorrectionReturnDoc = {
    correctionId: submissionId,
    verificationId: correction.verificationId,
    studentUid: correction.studentUid,
    ownerUid: correction.ownerUid,
    verificationTitle: verification.teacherSnapshot?.title ?? submission.verificationTitle,
    className: verification.teacherSnapshot?.className ?? submission.className,
    submittedAt: submission.submittedAt,
    returnedAt: serverTimestamp(),
    questions,
    generalFeedback: correction.generalFeedback,
    totalPoints: correction.totalPoints,
    maxPoints: correction.maxPoints,
    percentage: correction.percentage,
    visibleToStudent: true,
    solutionsVisible: false,
    updatedAt: serverTimestamp(),
  };
  assertCorrectionReturnWithinLimit(correctionReturn);

  const batch = writeBatch(db);
  batch.update(ref, {
    status: 'returned',
    returnedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
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
export async function reopenCorrection(submissionId: string, db: Firestore): Promise<void> {
  const ref = doc(db, 'corrections', submissionId);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    throw new Error('Impossibile riaprire: correzione non trovata.');
  }
  const correction = snap.data() as CorrectionDoc;
  assertValidCorrectionStatusTransition(correction.status, 'in_progress');
  const wasReturned = correction.status === 'returned';

  const batch = writeBatch(db);
  batch.update(ref, {
    status: 'in_progress',
    completedAt: null,
    returnedAt: null,
    reopenCount: correction.reopenCount + 1,
    updatedAt: serverTimestamp(),
  });
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

// ─── Return-projection visibility toggles ───────────────────────────────────

/**
 * Shows/hides an existing returned correction to the student without
 * touching `corrections` or the scoring data. No-ops (no write at all) if
 * the value is already what was requested.
 */
export async function setReturnVisibleToStudent(
  submissionId: string,
  visible: boolean,
  db: Firestore,
): Promise<void> {
  const ref = doc(db, 'correctionReturns', submissionId);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    throw new Error('Impossibile aggiornare la visibilità: nessuna correzione restituita trovata.');
  }
  const current = snap.data() as CorrectionReturnDoc;
  if (current.visibleToStudent === visible) return;
  await updateDoc(ref, { visibleToStudent: visible, updatedAt: serverTimestamp() });
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
 * No-ops (no write at all) if `solutionsVisible` already matches the
 * requested value.
 */
export async function setSolutionsVisible(
  submissionId: string,
  visible: boolean,
  db: Firestore,
): Promise<void> {
  const ref = doc(db, 'correctionReturns', submissionId);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    throw new Error('Impossibile aggiornare le soluzioni: nessuna correzione restituita trovata.');
  }
  const current = snap.data() as CorrectionReturnDoc;
  if (current.solutionsVisible === visible) return;

  if (visible) {
    const teacherQuestions = await loadTeacherSnapshotQuestions(current.verificationId, db);
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
    return;
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
}
