import { useEffect, useRef, useState } from 'react';
import { db } from '../../lib/firebase.js';
import {
  isValidQuestionPoints,
  computeCorrectionTotals,
  type CorrectionUiStatus,
  deriveCorrectionUiStatus,
} from '../repository/corrections/correctionContract.js';
import {
  loadCorrectionWorkspace,
  type CorrectionWorkspaceData,
} from '../repository/corrections/correctionWorkspaceLoader.js';
import {
  completeCorrection,
  reopenCorrection,
  returnCorrection,
  saveCorrection,
  setReturnVisibleToStudent,
  setSolutionsVisible,
} from '../repository/corrections/correctionsService.js';
import type {
  AnswerValue,
  QuestionEvaluation,
  VerificationTeacherQuestionSnapshot,
} from '../../types/firestore.js';
import styles from './CorrectionWorkspace.module.css';

export type CorrectionWorkspaceProps = {
  submissionId: string;
  ownerUid: string;
  studentName: string;
  onClose: () => void;
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

function parsePoints(pointsText: string): number | null {
  const trimmed = pointsText.trim();
  if (trimmed === '') return null;
  const parsed = Number(trimmed);
  return Number.isNaN(parsed) ? Number.NaN : parsed;
}

function isAnswerFilled(answer: AnswerValue | undefined): boolean {
  if (!answer) return false;
  if (answer.tipo === 'aperta') return answer.testo.trim() !== '';
  if (answer.tipo === 'chiusa_singola') return answer.selectedId != null;
  return answer.selectedIds.length > 0;
}

function formatTimestamp(ts: unknown): string {
  if (!ts || typeof ts !== 'object' || !('seconds' in ts)) return '—';
  const seconds = (ts as { seconds: number }).seconds;
  return new Date(seconds * 1000).toLocaleString('it-IT', {
    dateStyle: 'short',
    timeStyle: 'short',
  });
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
  const [confirmComplete, setConfirmComplete] = useState(false);
  const [confirmReopen, setConfirmReopen] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const mountedRef = useRef(true);

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
      return `Deve essere un numero tra 0 e ${maxPoints}.`;
    }
    return null;
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
    if (!data || !edit || hasAnyPointsError || busy) return;
    setBusy('save');
    setActionError(null);
    try {
      const evaluations: Record<string, { points: number | null; feedback?: string }> = {};
      for (const key of Object.keys(data.correction.evaluations)) {
        const entry = edit.evaluations[key]!;
        const points = parsePoints(entry.pointsText);
        const feedback = entry.feedback.trim();
        evaluations[key] = {
          points: points === null || Number.isNaN(points) ? null : points,
          ...(feedback !== '' ? { feedback } : {}),
        };
      }
      const generalFeedback = edit.generalFeedback.trim();
      await saveCorrection(
        {
          submissionId,
          evaluations,
          generalFeedback: generalFeedback === '' ? null : generalFeedback,
        },
        db,
      );
      await refresh();
    } catch (err) {
      if (mountedRef.current) setActionError(saveErrorMessage(err));
    } finally {
      if (mountedRef.current) setBusy(null);
    }
  }

  async function handleComplete() {
    setBusy('complete');
    setActionError(null);
    try {
      await completeCorrection(submissionId, db);
      await refresh();
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
      await reopenCorrection(submissionId, db);
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
    setBusy('solutions');
    setActionError(null);
    try {
      await setSolutionsVisible(submissionId, visible, db);
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

  const teacherQuestions: VerificationTeacherQuestionSnapshot[] =
    verification.teacherSnapshot?.questions ?? [];
  const currentQuestion = teacherQuestions.find((q) => q.order === currentOrder);
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

        <nav aria-label="Navigatore domande" className={styles.questionNav}>
          {orders.map((order) => {
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
                className={`${styles.navItem}${evaluated ? ` ${styles.navItemEvaluated}` : ''}${
                  invalid ? ` ${styles.navItemInvalid}` : ''
                }${isCurrent ? ` ${styles.navItemCurrent}` : ''}`}
                title={`Domanda ${order + 1} — ${statusLabel}`}
                aria-label={`Vai alla domanda ${order + 1} — ${statusLabel}`}
                aria-current={isCurrent ? 'true' : undefined}
                onClick={() => goTo(order)}
              >
                {order + 1}
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
            <span className={styles.questionNumber}>Domanda {currentOrder + 1}</span>
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
            {currentQuestion ? (
              renderSolution(currentQuestion)
            ) : (
              <span className={styles.solutionUnavailable}>Soluzione non disponibile.</span>
            )}
          </div>

          <div className={styles.block}>
            <span className={styles.blockLabel}>Valutazione</span>
            <div className={styles.scoreRow}>
              <input
                type="number"
                inputMode="decimal"
                className={styles.pointsInput}
                aria-label={`Punteggio per la domanda ${currentOrder + 1}`}
                value={currentEdit?.pointsText ?? ''}
                placeholder="—"
                min={0}
                max={currentMaxPoints}
                disabled={correction.status !== 'in_progress' || busy !== null}
                onChange={(e) => updatePoints(currentOrder, e.target.value)}
              />
              <span className={styles.maxPoints}>/ {currentMaxPoints} punti</span>
            </div>
            {currentPointsError && (
              <span role="alert" className={styles.pointsError}>
                {currentPointsError}
              </span>
            )}
            <textarea
              className={styles.feedbackTextarea}
              rows={2}
              aria-label={`Feedback per la domanda ${currentOrder + 1}`}
              placeholder="Feedback per questa domanda (opzionale)"
              value={currentEdit?.feedback ?? ''}
              disabled={correction.status !== 'in_progress' || busy !== null}
              onChange={(e) => updateFeedback(currentOrder, e.target.value)}
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
              className={styles.feedbackTextarea}
              rows={3}
              aria-label="Feedback generale"
              placeholder="Feedback generale per lo studente (opzionale)"
              value={edit.generalFeedback}
              disabled={correction.status !== 'in_progress' || busy !== null}
              onChange={(e) => updateGeneralFeedback(e.target.value)}
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
  question: VerificationTeacherQuestionSnapshot | undefined,
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

  return (
    <div className={styles.optionsList}>
      {question.opzioni.map((o) => {
        const isSelected =
          answer.tipo === 'chiusa_singola'
            ? answer.selectedId === o.id
            : answer.tipo === 'chiusa_multipla'
              ? answer.selectedIds.includes(o.id)
              : false;
        const isCorrect =
          question.tipo === 'chiusa_singola'
            ? question.soluzione === o.id
            : Array.isArray(question.soluzione) && question.soluzione.includes(o.id);
        const cls = [styles.optionRow];
        if (isSelected && isCorrect) cls.push(styles.optionCorrect, styles.optionSelected);
        else if (isSelected && !isCorrect) cls.push(styles.optionSelectedWrong);
        else if (isCorrect) cls.push(styles.optionCorrect);
        return (
          <div key={o.id} className={cls.join(' ')}>
            {o.testo}
            {isSelected && ' — selezionata'}
            {isCorrect && ' (corretta)'}
          </div>
        );
      })}
    </div>
  );
}

function renderSolution(question: VerificationTeacherQuestionSnapshot) {
  if (question.tipo === 'aperta') {
    return <p className={styles.solutionBox}>{question.soluzione as string}</p>;
  }
  if (!question.opzioni) {
    return <p className={styles.solutionBox}>{String(question.soluzione)}</p>;
  }
  const correctIds = Array.isArray(question.soluzione) ? question.soluzione : [question.soluzione];
  const correctTexts = question.opzioni
    .filter((o) => correctIds.includes(o.id))
    .map((o) => o.testo);
  return <p className={styles.solutionBox}>{correctTexts.join(', ')}</p>;
}
