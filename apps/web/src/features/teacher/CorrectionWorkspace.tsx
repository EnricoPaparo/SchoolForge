import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { db } from '../../lib/firebase.js';
import {
  isValidQuestionPoints,
  computeCorrectionTotals,
  normalizeQuestionPoints,
  parseQuestionPointsInput,
  QUESTION_POINTS_STEP,
  type CorrectionUiStatus,
  deriveCorrectionUiStatus,
} from '../repository/corrections/correctionContract.js';
import {
  loadCorrectionWorkspace,
  type CorrectionWorkspaceData,
  type CorrectionWorkspaceQuestion,
} from '../repository/corrections/correctionWorkspaceLoader.js';
import {
  completeCorrection,
  reopenCorrection,
  returnCorrection,
  saveCorrection,
  setReturnVisibleToStudent,
  setSolutionsVisible,
  type SaveCorrectionResult,
} from '../repository/corrections/correctionsService.js';
import type { AnswerValue, QuestionEvaluation } from '../../types/firestore.js';
import styles from './CorrectionWorkspace.module.css';
import questionNavigatorStyles from '../../components/QuestionNavigator.module.css';

export type CorrectionWorkspaceProps = {
  submissionId: string;
  ownerUid: string;
  studentName: string;
  onClose: () => void;
  onReturned?: (submissionId: string) => void;
};

type EditableEvaluation = {
  /** Raw input text. Empty string = not evaluated (points: null); otherwise parsed as a number. */
  pointsText: string;
  feedback: string;
};

type EditableState = {
  evaluations: Record<string, EditableEvaluation>;
  generalFeedback: string;
};

function toEditableState(correction: CorrectionWorkspaceData['correction']): EditableState {
  const evaluations: Record<string, EditableEvaluation> = {};
  for (const [key, evaluation] of Object.entries(correction.evaluations)) {
    evaluations[key] = {
      pointsText: evaluation.points === null ? '' : String(evaluation.points),
      feedback: evaluation.feedback ?? '',
    };
  }
  return { evaluations, generalFeedback: correction.generalFeedback ?? '' };
}

/**
 * Score input → number, accepting both `1,25` and `1.25` (shared contract
 * helper). Empty = `null` (not evaluated); unparseable = `NaN` (flagged
 * invalid). Replaces the old `Number(text)` that turned `"1,25"` into `NaN`
 * and made normally-typed Italian scores unsavable.
 */
const parsePoints = parseQuestionPointsInput;

/** Formats a normalized quarter score for the input field (dot separator, no trailing zeros). */
function formatPoints(points: number): string {
  return String(normalizeQuestionPoints(points));
}

/**
 * Builds the editable state from the normalized result `saveCorrection` just
 * persisted — so the workspace refreshes its baseline/points-text from exactly
 * what Firestore now holds, without a re-read. `points` is already normalized
 * (e.g. a `"7,5"` input comes back as `7.5`).
 */
function editableFromResult(result: SaveCorrectionResult): EditableState {
  const evaluations: Record<string, EditableEvaluation> = {};
  for (const [key, evaluation] of Object.entries(result.evaluations)) {
    evaluations[key] = {
      pointsText: evaluation.points === null ? '' : formatPoints(evaluation.points),
      feedback: evaluation.feedback ?? '',
    };
  }
  return { evaluations, generalFeedback: result.generalFeedback ?? '' };
}

function isAnswerFilled(answer: AnswerValue | undefined): boolean {
  if (!answer) return false;
  if (answer.tipo === 'aperta') return answer.testo.trim() !== '';
  if (answer.tipo === 'chiusa_singola') return answer.selectedId != null;
  return answer.selectedIds.length > 0;
}

/**
 * Normalizes the frozen solution of a single-choice question for UI rendering.
 * Accepts the canonical one-item array and the legacy non-empty string; every
 * unavailable or malformed shape stays unknown so the renderer never invents
 * correctness. This is display-only and does not alter scoring or persistence.
 */
export function normalizeSingleChoiceSolutionId(solution: unknown): string | null {
  if (typeof solution === 'string') return solution.length > 0 ? solution : null;
  if (
    Array.isArray(solution) &&
    solution.length === 1 &&
    typeof solution[0] === 'string' &&
    solution[0].length > 0
  ) {
    return solution[0];
  }
  return null;
}

function formatTimestamp(ts: unknown): string {
  if (!ts || typeof ts !== 'object' || !('seconds' in ts)) return '—';
  const seconds = (ts as { seconds: number }).seconds;
  return new Date(seconds * 1000).toLocaleString('it-IT', {
    dateStyle: 'short',
    timeStyle: 'short',
  });
}

/** Espande una textarea al contenuto senza scrollbar verticale interna. */
export function resizeTextareaToContent(textarea: HTMLTextAreaElement | null): void {
  if (!textarea) return;
  textarea.style.height = 'auto';
  textarea.style.overflowY = 'hidden';
  if (textarea.scrollHeight > 0) textarea.style.height = `${textarea.scrollHeight}px`;
}

const STATUS_LABELS: Record<CorrectionUiStatus, string> = {
  to_correct: 'Da correggere',
  in_progress: 'In correzione',
  completed: 'Corretta',
  returned: 'Restituita',
};

const STATUS_CLASSES: Record<CorrectionUiStatus, string> = {
  to_correct: styles.statusInProgress,
  in_progress: styles.statusInProgress,
  completed: styles.statusCompleted,
  returned: styles.statusReturned,
};

function saveErrorMessage(err: unknown): string {
  const code = (err as { code?: string } | null)?.code;
  if (code === 'permission-denied') {
    return 'Operazione non consentita da Firebase. Ricarica la pagina; se il problema persiste, verifica le autorizzazioni del progetto.';
  }
  return err instanceof Error ? err.message : "Errore durante l'operazione. Riprova.";
}

/**
 * Docente correction workspace (M4-02). Loads once on mount via
 * `loadCorrectionWorkspace` (submission + teacherSnapshot + correction +
 * return projection, never the live pool), edits scores/feedback locally,
 * and persists exclusively through the M4-01 service functions — every
 * mutating action re-reads afterwards (`refresh`) instead of guessing the
 * new state locally, so the UI can never drift from what Firestore
 * actually holds. No realtime listener: this is a single load-then-act
 * workspace, matching the "loading solo quando il workspace viene aperto"
 * constraint.
 */
export function CorrectionWorkspace({
  submissionId,
  ownerUid,
  studentName,
  onClose,
  onReturned,
}: CorrectionWorkspaceProps) {
  const [data, setData] = useState<CorrectionWorkspaceData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [edit, setEdit] = useState<EditableState | null>(null);
  const baselineRef = useRef<EditableState | null>(null);
  const [currentOrder, setCurrentOrder] = useState(0);
  const [busy, setBusy] = useState<
    'save' | 'complete' | 'return' | 'reopen' | 'visibility' | 'solutions' | null
  >(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved'>('idle');
  const [confirmComplete, setConfirmComplete] = useState(false);
  const [confirmReopen, setConfirmReopen] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const mountedRef = useRef(true);
  // Synchronous re-entrancy guard: two rapid clicks both pass the `busy` check
  // before React re-renders, so a ref (set before the first await) is what
  // actually prevents a concurrent second write.
  const savingRef = useRef(false);
  const questionFeedbackRef = useRef<HTMLTextAreaElement>(null);
  const generalFeedbackRef = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    resizeTextareaToContent(questionFeedbackRef.current);
  }, [currentOrder, edit?.evaluations[String(currentOrder)]?.feedback]);

  useLayoutEffect(() => {
    resizeTextareaToContent(generalFeedbackRef.current);
  }, [edit?.generalFeedback]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  async function refresh() {
    const next = await loadCorrectionWorkspace(submissionId, ownerUid, db);
    if (!mountedRef.current) return;
    setData(next);
    const editable = toEditableState(next.correction);
    baselineRef.current = editable;
    setEdit(editable);
  }

  useEffect(() => {
    setLoadError(null);
    loadCorrectionWorkspace(submissionId, ownerUid, db)
      .then((next) => {
        if (!mountedRef.current) return;
        setData(next);
        const editable = toEditableState(next.correction);
        baselineRef.current = editable;
        setEdit(editable);
      })
      .catch((err) => {
        if (mountedRef.current) setLoadError(saveErrorMessage(err));
      });
  }, [submissionId, ownerUid]);

  const dirty =
    edit !== null &&
    baselineRef.current !== null &&
    JSON.stringify(edit) !== JSON.stringify(baselineRef.current);

  function updatePoints(order: number, pointsText: string) {
    setEdit((prev) => {
      if (!prev) return prev;
      const key = String(order);
      return {
        ...prev,
        evaluations: { ...prev.evaluations, [key]: { ...prev.evaluations[key]!, pointsText } },
      };
    });
  }

  function updateFeedback(order: number, feedback: string) {
    setEdit((prev) => {
      if (!prev) return prev;
      const key = String(order);
      return {
        ...prev,
        evaluations: { ...prev.evaluations, [key]: { ...prev.evaluations[key]!, feedback } },
      };
    });
  }

  function updateGeneralFeedback(generalFeedback: string) {
    setEdit((prev) => (prev ? { ...prev, generalFeedback } : prev));
  }

  function pointsError(order: number): string | null {
    if (!data || !edit) return null;
    const key = String(order);
    const maxPoints = data.correction.evaluations[key]?.maxPoints ?? 0;
    const parsed = parsePoints(edit.evaluations[key]?.pointsText ?? '');
    if (parsed === null) return null;
    if (Number.isNaN(parsed) || !isValidQuestionPoints(parsed, maxPoints)) {
      return `Deve essere un multiplo di ${QUESTION_POINTS_STEP} tra 0 e ${maxPoints}.`;
    }
    return null;
  }

  /**
   * Increment/decrement the current score by a quarter point, clamped to
   * `[0, maxPoints]` and snapped to an exact quarter. An empty or invalid
   * field starts from 0 so the stepper always lands on a valid value.
   */
  function stepPoints(order: number, direction: 1 | -1) {
    const key = String(order);
    const maxPoints = data?.correction.evaluations[key]?.maxPoints ?? 0;
    const parsed = parsePoints(edit?.evaluations[key]?.pointsText ?? '');
    const base = parsed === null || Number.isNaN(parsed) ? 0 : parsed;
    const nextRaw = normalizeQuestionPoints(base) + direction * QUESTION_POINTS_STEP;
    const clamped = Math.min(Math.max(nextRaw, 0), maxPoints);
    updatePoints(order, formatPoints(clamped));
  }

  const orders = data
    ? Object.values(data.correction.evaluations)
        .map((e) => e.order)
        .sort((a, b) => a - b)
    : [];
  const hasAnyPointsError = orders.some((order) => pointsError(order) !== null);

  // Selects the first question in `orders` whenever a fresh correction is
  // loaded (initial open or after a refresh whose question set changed) —
  // never assumes order 0 exists, since `order` is whatever was frozen in
  // the published projection at activation. Only resets when the currently
  // selected order is no longer part of the loaded question set, so normal
  // navigation (Prev/Next, nav squares) is never overridden mid-edit.
  useEffect(() => {
    if (orders.length === 0) return;
    if (!orders.includes(currentOrder)) {
      setCurrentOrder(orders[0]!);
    }
  }, [data]);

  function requestClose() {
    if (dirty) {
      setConfirmLeave(true);
    } else {
      onClose();
    }
  }

  async function handleSave() {
    if (!data || !edit || hasAnyPointsError) return;
    // Synchronous guard: prevents a second concurrent write from a double click
    // (the `busy` state check alone can be raced before the re-render).
    if (savingRef.current) return;
    savingRef.current = true;
    // The exact edit we are persisting. If the docente keeps typing while the
    // write is in flight, `edit` becomes a new object (updatePoints/Feedback
    // create fresh state), so we can tell afterwards whether to adopt the
    // normalized persisted text or keep their newer, unsaved changes.
    const editToSave = edit;
    setBusy('save');
    setActionError(null);
    try {
      const evaluations: Record<string, { points: number | null; feedback?: string }> = {};
      for (const key of Object.keys(data.correction.evaluations)) {
        const entry = editToSave.evaluations[key]!;
        const points = parsePoints(entry.pointsText);
        const feedback = entry.feedback.trim();
        evaluations[key] = {
          points: points === null || Number.isNaN(points) ? null : points,
          ...(feedback !== '' ? { feedback } : {}),
        };
      }
      const generalFeedback = editToSave.generalFeedback.trim();
      // A successful write is a successful save — full stop. We update baseline,
      // totals and the navigator from the NORMALIZED result the service returns,
      // never a second Firestore read (which, if slow or failing, used to leave
      // the button stuck on "Salvataggio…" even though the write had succeeded).
      const saved = await saveCorrection(
        {
          submissionId,
          evaluations,
          generalFeedback: generalFeedback === '' ? null : generalFeedback,
        },
        db,
        {
          submission: data.submission,
          verification: data.verification,
          questions: data.questions,
        },
      );
      if (!mountedRef.current) return;
      const persisted = editableFromResult(saved);
      baselineRef.current = persisted;
      // Reflect persisted scores in totals/navigator without a re-read.
      setData((prev) =>
        prev
          ? {
              ...prev,
              correction: {
                ...prev.correction,
                evaluations: saved.evaluations,
                generalFeedback: saved.generalFeedback,
                totalPoints: saved.totalPoints,
                maxPoints: saved.maxPoints,
                percentage: saved.percentage,
              },
            }
          : prev,
      );
      // Adopt the normalized text only if nothing was typed during the save; a
      // newer edit is never clobbered by this now-stale result.
      setEdit((current) => (current === editToSave ? persisted : current));
      setSaveStatus('saved');
    } catch (err) {
      // A failed write keeps every local edit intact — nothing is reset here.
      if (mountedRef.current) setActionError(saveErrorMessage(err));
    } finally {
      savingRef.current = false;
      if (mountedRef.current) setBusy(null);
    }
  }

  async function handleComplete() {
    setBusy('complete');
    setActionError(null);
    try {
      if (!data) return;
      await completeCorrection(submissionId, db, {
        submission: data.submission,
        verification: data.verification,
        questions: data.questions,
      });
      // The atomic write is the source of truth for this deterministic
      // transition. Do not turn a successful completion into a false error
      // because a second, unrelated workspace reload is slow or denied.
      // Scores/feedback are unchanged; only the local workflow status moves.
      if (mountedRef.current) {
        setData((current) =>
          current
            ? {
                ...current,
                correction: { ...current.correction, status: 'completed' },
              }
            : current,
        );
      }
      setConfirmComplete(false);
    } catch (err) {
      if (mountedRef.current) setActionError(saveErrorMessage(err));
    } finally {
      if (mountedRef.current) setBusy(null);
    }
  }

  async function handleReturn() {
    setBusy('return');
    setActionError(null);
    try {
      await returnCorrection(submissionId, db);
      if (mountedRef.current) onReturned?.(submissionId);
      await refresh();
    } catch (err) {
      if (mountedRef.current) setActionError(saveErrorMessage(err));
    } finally {
      if (mountedRef.current) setBusy(null);
    }
  }

  async function handleReopen() {
    setBusy('reopen');
    setActionError(null);
    try {
      await reopenCorrection(
        submissionId,
        db,
        data
          ? {
              submission: data.submission,
              verification: data.verification,
              questions: data.questions,
            }
          : undefined,
      );
      await refresh();
      setConfirmReopen(false);
    } catch (err) {
      if (mountedRef.current) setActionError(saveErrorMessage(err));
    } finally {
      if (mountedRef.current) setBusy(null);
    }
  }

  async function handleToggleVisible(visible: boolean) {
    setBusy('visibility');
    setActionError(null);
    try {
      await setReturnVisibleToStudent(submissionId, visible, db);
      await refresh();
    } catch (err) {
      if (mountedRef.current) setActionError(saveErrorMessage(err));
    } finally {
      if (mountedRef.current) setBusy(null);
    }
  }

  async function handleToggleSolutions(visible: boolean) {
    if (!data) return;
    setBusy('solutions');
    setActionError(null);
    try {
      await setSolutionsVisible(submissionId, visible, db, {
        submission: data.submission,
        verification: data.verification,
      });
      await refresh();
    } catch (err) {
      if (mountedRef.current) setActionError(saveErrorMessage(err));
    } finally {
      if (mountedRef.current) setBusy(null);
    }
  }

  if (loadError) {
    return (
      <section aria-label="Correzione" className={styles.container}>
        <p role="alert" className="text-error">
          {loadError}
        </p>
        <button type="button" onClick={onClose}>
          Torna alle consegne
        </button>
      </section>
    );
  }

  if (!data || !edit) {
    return (
      <section aria-label="Correzione" className={styles.container}>
        <p aria-busy="true" className="state-loading">
          Caricamento correzione…
        </p>
      </section>
    );
  }

  const { submission, verification, correction, correctionReturn } = data;
  const title = verification.teacherSnapshot?.title ?? submission.verificationTitle;
  const className = verification.teacherSnapshot?.className ?? submission.className;
  const uiStatus = deriveCorrectionUiStatus(correction);
  const evaluatedCount = orders.filter((order) => {
    const parsed = parsePoints(edit.evaluations[String(order)]?.pointsText ?? '');
    const maxPoints = correction.evaluations[String(order)]?.maxPoints ?? 0;
    return parsed !== null && !Number.isNaN(parsed) && isValidQuestionPoints(parsed, maxPoints);
  }).length;
  const allEvaluated = orders.length > 0 && evaluatedCount === orders.length;
  const canComplete =
    correction.status === 'in_progress' && !dirty && !hasAnyPointsError && allEvaluated && !busy;

  // Live riepilogo: derived from the locally edited scores (via the same
  // computeCorrectionTotals used by correctionsService.ts, never
  // reimplemented here), not from the last-persisted correction.totalPoints/
  // maxPoints/percentage — so the summary panel reflects what "Salva
  // correzione" would actually write, updating as the docente types. A
  // question whose current input is out of range (invalid state) is
  // treated as not-yet-evaluated for this computation — its own field
  // shows an explicit error (see currentPointsError below) rather than
  // silently contributing a wrong total.
  const liveEvaluations: Record<string, QuestionEvaluation> = {};
  for (const key of Object.keys(correction.evaluations)) {
    const previous = correction.evaluations[key]!;
    const parsed = parsePoints(edit.evaluations[key]?.pointsText ?? '');
    const invalid =
      parsed !== null &&
      (Number.isNaN(parsed) || !isValidQuestionPoints(parsed, previous.maxPoints));
    liveEvaluations[key] = {
      order: previous.order,
      maxPoints: previous.maxPoints,
      points: parsed === null || invalid ? null : parsed,
    };
  }
  const liveTotals = computeCorrectionTotals(liveEvaluations);

  const currentQuestion = data.questions.find((q) => q.order === currentOrder);
  const currentAnswer = submission.answers[String(currentOrder)];
  const currentIndex = orders.indexOf(currentOrder);
  const currentEdit = edit.evaluations[String(currentOrder)];
  const currentMaxPoints = correction.evaluations[String(currentOrder)]?.maxPoints ?? 0;
  const currentPointsError = pointsError(currentOrder);

  function goTo(order: number) {
    if (orders.includes(order)) setCurrentOrder(order);
  }

  return (
    <section aria-label={`Correzione — ${title}`} className={styles.container}>
      <div className={styles.controlPanel}>
        <div className={styles.controlRow}>
          <div className={styles.headerInfo}>
            <button type="button" className={styles.backBtn} onClick={requestClose}>
              ← Torna alle consegne
            </button>
            <h2 className={styles.title}>{title}</h2>
            <span className={styles.meta}>{studentName}</span>
            {className && <span className={styles.meta}>{className}</span>}
            <span className={styles.meta}>
              Consegnata il {formatTimestamp(submission.submittedAt)}
            </span>
            <span className={`${styles.statusBadge} ${STATUS_CLASSES[uiStatus]}`}>
              {STATUS_LABELS[uiStatus]}
            </span>
            {dirty && <span className={styles.dirtyBadge}>Modifiche non salvate</span>}
          </div>
        </div>

        <nav
          aria-label="Navigatore domande"
          className={`${styles.questionNav} ${questionNavigatorStyles.nav}`}
        >
          {orders.map((order, index) => {
            const displayNumber = index + 1;
            const parsed = parsePoints(edit.evaluations[String(order)]?.pointsText ?? '');
            const maxPoints = correction.evaluations[String(order)]?.maxPoints ?? 0;
            const invalid = parsed !== null && !isValidQuestionPoints(parsed, maxPoints);
            const evaluated = parsed !== null && !invalid;
            const isCurrent = order === currentOrder;
            const statusLabel = invalid
              ? 'punteggio non valido'
              : evaluated
                ? 'valutata'
                : 'non valutata';
            return (
              <button
                key={order}
                type="button"
                className={`${questionNavigatorStyles.item}${
                  evaluated ? ` ${styles.navItemEvaluated}` : ''
                }${invalid ? ` ${styles.navItemInvalid}` : ''}${
                  isCurrent ? ` ${questionNavigatorStyles.current}` : ''
                }`}
                title={`Domanda ${displayNumber} — ${statusLabel}`}
                aria-label={`Vai alla domanda ${displayNumber} — ${statusLabel}`}
                aria-current={isCurrent ? 'true' : undefined}
                onClick={() => goTo(order)}
              >
                {displayNumber}
              </button>
            );
          })}
        </nav>
      </div>

      {actionError && (
        <p role="alert" className={styles.actionError}>
          {actionError}
        </p>
      )}

      <div className={styles.body}>
        <article className={styles.questionCard}>
          <div className={styles.questionHeader}>
            <span className={styles.questionNumber}>Domanda {currentIndex + 1}</span>
            <span className={styles.questionType}>
              {currentQuestion
                ? currentQuestion.tipo === 'aperta'
                  ? 'Risposta aperta'
                  : currentQuestion.tipo === 'chiusa_singola'
                    ? 'Scelta singola'
                    : 'Scelta multipla'
                : 'Tipo non disponibile'}
            </span>
          </div>

          <p className={styles.questionMeta}>
            Difficoltà {currentQuestion?.difficolta ?? '—'} · Max {currentMaxPoints} punti
          </p>

          <p className={styles.questionText}>
            {currentQuestion?.testo ??
              'Contenuto della domanda non disponibile (verifica precedente allo snapshot con soluzioni).'}
          </p>

          <div className={styles.block}>
            <span className={styles.blockLabel}>Risposta consegnata</span>
            {renderAnswer(currentQuestion, currentAnswer)}
          </div>

          <div className={styles.block}>
            <span className={styles.blockLabel}>Soluzione (visibile solo al docente)</span>
            {currentQuestion && !currentQuestion.solutionUnavailable ? (
              renderSolution(currentQuestion)
            ) : (
              <span className={styles.solutionUnavailable}>
                Soluzione non disponibile per questa verifica precedente allo snapshot con
                soluzioni.
              </span>
            )}
          </div>

          <div className={styles.block}>
            <span className={styles.blockLabel}>Valutazione</span>
            <div className={styles.scoreRow}>
              <div className={styles.pointsControl}>
                <button
                  type="button"
                  className={styles.stepBtn}
                  aria-label={`Diminuisci di ${QUESTION_POINTS_STEP} il punteggio della domanda ${currentIndex + 1}`}
                  disabled={correction.status !== 'in_progress' || busy !== null}
                  onClick={() => stepPoints(currentOrder, -1)}
                >
                  −
                </button>
                <input
                  type="text"
                  inputMode="decimal"
                  className={styles.pointsInput}
                  aria-label={`Punteggio per la domanda ${currentIndex + 1}`}
                  value={currentEdit?.pointsText ?? ''}
                  placeholder="—"
                  disabled={correction.status !== 'in_progress' || busy !== null}
                  onChange={(e) => updatePoints(currentOrder, e.target.value)}
                />
                <button
                  type="button"
                  className={styles.stepBtn}
                  aria-label={`Aumenta di ${QUESTION_POINTS_STEP} il punteggio della domanda ${currentIndex + 1}`}
                  disabled={correction.status !== 'in_progress' || busy !== null}
                  onClick={() => stepPoints(currentOrder, 1)}
                >
                  +
                </button>
              </div>
              <span className={styles.maxPoints}>/ {currentMaxPoints} punti</span>
            </div>
            {currentPointsError && (
              <span role="alert" className={styles.pointsError}>
                {currentPointsError}
              </span>
            )}
            <textarea
              ref={questionFeedbackRef}
              className={styles.feedbackTextarea}
              rows={2}
              aria-label={`Correzione per la domanda ${currentIndex + 1} (opzionale)`}
              placeholder="Correzione (opzionale)"
              value={currentEdit?.feedback ?? ''}
              disabled={correction.status !== 'in_progress' || busy !== null}
              onChange={(e) => {
                resizeTextareaToContent(e.currentTarget);
                updateFeedback(currentOrder, e.target.value);
              }}
            />
          </div>

          <div className={styles.questionFooterNav}>
            <button
              type="button"
              onClick={() => currentIndex > 0 && goTo(orders[currentIndex - 1]!)}
              disabled={currentIndex <= 0}
            >
              ← Precedente
            </button>
            <button
              type="button"
              onClick={() => currentIndex < orders.length - 1 && goTo(orders[currentIndex + 1]!)}
              disabled={currentIndex >= orders.length - 1}
            >
              Successiva →
            </button>
          </div>
        </article>

        <aside className={styles.summary} aria-label="Riepilogo correzione">
          <div className={styles.summaryRow}>
            <span className={styles.summaryLabel}>Valutate</span>
            <span className={styles.summaryValue}>
              {evaluatedCount}/{orders.length}
            </span>
          </div>
          <div className={styles.summaryRow}>
            <span className={styles.summaryLabel}>Punteggio</span>
            <span className={styles.summaryValue}>
              {liveTotals.totalPoints}/{liveTotals.maxPoints}
            </span>
          </div>
          <div className={styles.summaryRow}>
            <span className={styles.summaryLabel}>Percentuale</span>
            <span className={styles.summaryValue}>
              {liveTotals.percentage === null ? '—' : `${liveTotals.percentage}%`}
            </span>
          </div>
          {hasAnyPointsError && (
            <p role="alert" className={styles.actionError}>
              Uno o più punteggi non sono validi: correggili prima di salvare o completare.
            </p>
          )}

          <div className={styles.block}>
            <span className={styles.generalFeedbackLabel}>Feedback generale</span>
            <textarea
              ref={generalFeedbackRef}
              className={styles.feedbackTextarea}
              rows={3}
              aria-label="Feedback generale"
              placeholder="Feedback generale per lo studente (opzionale)"
              value={edit.generalFeedback}
              disabled={correction.status !== 'in_progress' || busy !== null}
              onChange={(e) => {
                resizeTextareaToContent(e.currentTarget);
                updateGeneralFeedback(e.target.value);
              }}
            />
          </div>

          <div className={styles.summaryActions}>
            {correction.status === 'in_progress' && (
              <>
                <button
                  type="button"
                  className="btn-success"
                  onClick={() => void handleSave()}
                  disabled={!dirty || hasAnyPointsError || busy !== null}
                >
                  {busy === 'save' ? 'Salvataggio…' : 'Salva correzione'}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmComplete(true)}
                  disabled={!canComplete}
                  title={
                    hasAnyPointsError
                      ? 'Correggi i punteggi non validi prima di completare'
                      : !allEvaluated
                        ? 'Valuta tutte le domande per completare'
                        : dirty
                          ? 'Salva le modifiche prima di completare'
                          : undefined
                  }
                >
                  Completa correzione
                </button>
                <p className={styles.saveStatus} aria-live="polite" role="status">
                  {busy === 'save'
                    ? 'Salvataggio…'
                    : saveStatus === 'saved' && !dirty
                      ? '✓ Correzione salvata'
                      : ''}
                </p>
              </>
            )}

            {correction.status === 'completed' && (
              <>
                <button
                  type="button"
                  onClick={() => setConfirmReopen(true)}
                  disabled={busy !== null}
                >
                  Riapri
                </button>
                <button
                  type="button"
                  className="btn-success"
                  onClick={() => void handleReturn()}
                  disabled={busy !== null}
                >
                  {busy === 'return' ? 'Restituzione…' : 'Restituisci allo studente'}
                </button>
              </>
            )}

            {correction.status === 'returned' && (
              <>
                <button
                  type="button"
                  onClick={() => setConfirmReopen(true)}
                  disabled={busy !== null}
                >
                  Riapri
                </button>
                <p className={styles.reopenWarning}>
                  Riaprire nasconderà subito la restituzione attuale allo studente.
                </p>
                <div className={styles.toggleRow}>
                  <span>Visibile allo studente</span>
                  <input
                    type="checkbox"
                    aria-label="Visibile allo studente"
                    checked={correctionReturn?.visibleToStudent ?? false}
                    disabled={busy !== null}
                    onChange={(e) => void handleToggleVisible(e.target.checked)}
                  />
                </div>
                <div className={styles.toggleRow}>
                  <span>Mostra soluzioni</span>
                  <input
                    type="checkbox"
                    aria-label="Mostra soluzioni"
                    checked={correctionReturn?.solutionsVisible ?? false}
                    disabled={busy !== null}
                    onChange={(e) => void handleToggleSolutions(e.target.checked)}
                  />
                </div>
              </>
            )}
          </div>
        </aside>
      </div>

      {confirmComplete && (
        <div className={styles.confirmOverlay}>
          <div className={styles.confirmBox} role="alertdialog" aria-label="Conferma completamento">
            <p>Completare la correzione? Potrai comunque riaprirla in seguito.</p>
            <div className={styles.confirmActions}>
              <button
                type="button"
                onClick={() => setConfirmComplete(false)}
                disabled={busy !== null}
              >
                Annulla
              </button>
              <button
                type="button"
                className="btn-success"
                onClick={() => void handleComplete()}
                disabled={busy !== null}
              >
                {busy === 'complete' ? 'Completamento…' : 'Conferma'}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmReopen && (
        <div className={styles.confirmOverlay}>
          <div className={styles.confirmBox} role="alertdialog" aria-label="Conferma riapertura">
            <p>
              Riaprire la correzione la riporta in corso.
              {correction.status === 'returned' &&
                ' La restituzione attuale diventa subito invisibile allo studente.'}
            </p>
            <div className={styles.confirmActions}>
              <button
                type="button"
                onClick={() => setConfirmReopen(false)}
                disabled={busy !== null}
              >
                Annulla
              </button>
              <button
                type="button"
                className="btn-success"
                onClick={() => void handleReopen()}
                disabled={busy !== null}
              >
                {busy === 'reopen' ? 'Riapertura…' : 'Conferma'}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmLeave && (
        <div className={styles.confirmOverlay}>
          <div className={styles.confirmBox} role="alertdialog" aria-label="Modifiche non salvate">
            <p>Hai modifiche non salvate. Uscire senza salvare?</p>
            <div className={styles.confirmActions}>
              <button type="button" onClick={() => setConfirmLeave(false)}>
                Annulla
              </button>
              <button type="button" className="btn-success" onClick={onClose}>
                Esci senza salvare
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function renderAnswer(
  question: CorrectionWorkspaceQuestion | undefined,
  answer: AnswerValue | undefined,
) {
  if (!isAnswerFilled(answer)) {
    return <p className={`${styles.answerBox} ${styles.answerEmpty}`}>Nessuna risposta.</p>;
  }
  if (!answer) return null;

  if (answer.tipo === 'aperta') {
    return <p className={styles.answerBox}>{answer.testo}</p>;
  }

  if (!question?.opzioni) {
    const selectedIds = answer.tipo === 'chiusa_singola' ? [answer.selectedId] : answer.selectedIds;
    return <p className={styles.answerBox}>{selectedIds.filter(Boolean).join(', ')}</p>;
  }

  const singleSolutionId =
    question.tipo === 'chiusa_singola' ? normalizeSingleChoiceSolutionId(question.soluzione) : null;

  // Single option list with icon-based status (never colour alone): the
  // student's selection is highlighted in blue; correctness is shown by a
  // green ✓ or red ✕, each carrying screen-reader text. All correct options
  // are marked, not just the first — `soluzione` is the full string[] for
  // chiusa_multipla.
  return (
    <ul className={styles.optionsList}>
      {question.opzioni.map((o) => {
        const isSelected =
          answer.tipo === 'chiusa_singola'
            ? answer.selectedId === o.id
            : answer.tipo === 'chiusa_multipla'
              ? answer.selectedIds.includes(o.id)
              : false;
        const isCorrect =
          question.tipo === 'chiusa_singola'
            ? singleSolutionId === o.id
            : Array.isArray(question.soluzione) && question.soluzione.includes(o.id);
        const cls = [styles.optionRow];
        if (isSelected) cls.push(styles.optionSelected);
        let icon: string | null = null;
        let statusText = '';
        if (isCorrect) {
          icon = '✓';
          statusText = isSelected ? 'selezionata, corretta' : 'corretta, non selezionata';
        } else if (isSelected) {
          if (question.tipo === 'chiusa_singola' && singleSolutionId === null) {
            icon = '?';
            statusText = 'selezionata, correttezza non disponibile';
          } else {
            icon = '✕';
            statusText = 'selezionata, errata';
            cls.push(styles.optionSelectedWrong);
          }
        }
        return (
          <li key={o.id} className={cls.join(' ')}>
            <span
              className={`${styles.optionIcon} ${
                icon === '✓'
                  ? styles.optionIconCorrect
                  : icon === '✕'
                    ? styles.optionIconWrong
                    : icon === '?'
                      ? styles.optionIconUnavailable
                      : ''
              }`}
              aria-hidden="true"
            >
              {icon}
            </span>
            <span className={styles.optionText}>{o.testo}</span>
            {statusText && <span className={styles.srOnly}> — {statusText}</span>}
          </li>
        );
      })}
    </ul>
  );
}

function renderSolution(question: CorrectionWorkspaceQuestion) {
  const soluzione = question.soluzione ?? '';
  if (question.tipo === 'aperta') {
    return <p className={styles.solutionBox}>{soluzione as string}</p>;
  }
  if (question.tipo === 'chiusa_singola') {
    const correctId = normalizeSingleChoiceSolutionId(question.soluzione);
    if (correctId === null) {
      return <span className={styles.solutionUnavailable}>Soluzione non disponibile.</span>;
    }
    if (!question.opzioni) {
      return <p className={styles.solutionBox}>{correctId}</p>;
    }
    const correctOption = question.opzioni.find((option) => option.id === correctId);
    if (!correctOption) {
      return <span className={styles.solutionUnavailable}>Soluzione non disponibile.</span>;
    }
    return (
      <ul className={`${styles.solutionBox} ${styles.solutionList}`}>
        <li>{correctOption.testo}</li>
      </ul>
    );
  }
  if (!question.opzioni) {
    return <p className={styles.solutionBox}>{String(soluzione)}</p>;
  }
  const correctIds = Array.isArray(soluzione) ? soluzione : [soluzione];
  const correctTexts = question.opzioni
    .filter((o) => correctIds.includes(o.id))
    .map((o) => o.testo);
  return (
    <ul className={`${styles.solutionBox} ${styles.solutionList}`}>
      {correctTexts.map((text, index) => (
        <li key={`${index}-${text}`}>{text}</li>
      ))}
    </ul>
  );
}
