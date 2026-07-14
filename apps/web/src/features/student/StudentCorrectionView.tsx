import { useState } from 'react';
import type { Firestore } from 'firebase/firestore';
import type { AnswerValue, CorrectionReturnQuestionView } from '../../types/firestore.js';
import {
  loadStudentCorrectionReturn,
  type StudentCorrectionReturnItem,
} from './studentCorrectionReturnsService.js';
import styles from './StudentCorrectionView.module.css';

type StudentCorrectionViewProps = {
  submissionId: string;
  /** Already loaded by the list view — no extra read on open. */
  initialData: StudentCorrectionReturnItem;
  db: Firestore;
  onBack: () => void;
};

/** it-IT date+time from a Firestore Timestamp-like value, or '—' if absent. */
function formatTimestamp(ts: unknown): string {
  if (!ts || typeof ts !== 'object' || !('seconds' in ts)) return '—';
  const seconds = (ts as { seconds: number }).seconds;
  return new Date(seconds * 1000).toLocaleString('it-IT', {
    dateStyle: 'short',
    timeStyle: 'short',
  });
}

function isAnswerFilled(answer: AnswerValue | null): boolean {
  if (!answer) return false;
  if (answer.tipo === 'aperta') return answer.testo.trim() !== '';
  if (answer.tipo === 'chiusa_singola') return answer.selectedId != null;
  return answer.selectedIds.length > 0;
}

function renderAnswer(question: CorrectionReturnQuestionView) {
  const answer = question.studentAnswer;
  if (!isAnswerFilled(answer)) {
    return <p className={`${styles.answerBox} ${styles.answerEmpty}`}>Nessuna risposta.</p>;
  }
  if (!answer) return null;

  if (answer.tipo === 'aperta') {
    return <p className={styles.answerBox}>{answer.testo}</p>;
  }

  if (!question.opzioni) {
    const selectedIds = answer.tipo === 'chiusa_singola' ? [answer.selectedId] : answer.selectedIds;
    return <p className={styles.answerBox}>{selectedIds.filter(Boolean).join(', ')}</p>;
  }

  // No colour signals correctness here — the only certainty is which
  // option the student picked, never whether it was right, unless the
  // docente has explicitly revealed the solution (rendered separately
  // below, only when `correctAnswer` is actually present).
  return (
    <div className={styles.optionsList}>
      {question.opzioni.map((o) => {
        const isSelected =
          answer.tipo === 'chiusa_singola'
            ? answer.selectedId === o.id
            : answer.tipo === 'chiusa_multipla'
              ? answer.selectedIds.includes(o.id)
              : false;
        return (
          <div
            key={o.id}
            className={`${styles.optionRow}${isSelected ? ` ${styles.optionSelected}` : ''}`}
          >
            {o.testo}
          </div>
        );
      })}
    </div>
  );
}

function renderSolution(question: CorrectionReturnQuestionView) {
  if (question.correctAnswer === undefined) return null;
  if (!question.opzioni) {
    return <p className={styles.solutionBox}>{String(question.correctAnswer)}</p>;
  }
  const correctIds = Array.isArray(question.correctAnswer)
    ? question.correctAnswer
    : [question.correctAnswer];
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

/**
 * Read-only view of a returned correction (M4-02B) — the student-facing
 * counterpart to the docente's `CorrectionWorkspace`. Reads exclusively
 * `correctionReturns/{submissionId}` (self-sufficient projection, see
 * `types/firestore.ts`): never `corrections`, `correctionEvents`, the
 * submitted submission, or the verification's `teacherSnapshot`. No
 * writes, no realtime listener, no polling — "Ricarica" is the only way
 * this view re-reads, in case the docente has just returned an update or
 * hidden the result (`loadStudentCorrectionReturn` resolves to `null` on
 * either "no longer exists" or "no longer visible", handled the same way
 * here: a clean unavailable state, never a crash).
 */
export function StudentCorrectionView({
  submissionId,
  initialData,
  db,
  onBack,
}: StudentCorrectionViewProps) {
  const [data, setData] = useState<StudentCorrectionReturnItem | null>(initialData);
  const [reloading, setReloading] = useState(false);
  const [reloadError, setReloadError] = useState<string | null>(null);
  const orders = (data ?? initialData).questions.map((q) => q.order).sort((a, b) => a - b);
  const [currentOrder, setCurrentOrder] = useState(orders[0] ?? 0);

  /**
   * `loadStudentCorrectionReturn` resolves to `null` only for the two cases
   * that genuinely mean "no longer available" (missing doc, permission
   * denied) — that transitions this view to the unavailable state below. A
   * thrown error (network/offline/etc.) means something else entirely: it
   * must never be treated as "hidden", so `data` is left untouched and only
   * a dismissible error message is shown — the student keeps looking at
   * whatever was last successfully loaded.
   */
  async function handleReload() {
    setReloading(true);
    setReloadError(null);
    try {
      const next = await loadStudentCorrectionReturn(submissionId, db);
      setData(next);
      if (next) {
        const nextOrders = next.questions.map((q) => q.order).sort((a, b) => a - b);
        if (!nextOrders.includes(currentOrder)) {
          setCurrentOrder(nextOrders[0] ?? 0);
        }
      }
    } catch {
      setReloadError('Impossibile ricaricare la correzione. Riprova.');
    } finally {
      setReloading(false);
    }
  }

  if (!data) {
    return (
      <section aria-label="Correzione" className={styles.container}>
        <div className={styles.controlPanel}>
          <div className={styles.controlRow}>
            <button type="button" className={styles.backBtn} onClick={onBack}>
              ← Torna alle verifiche
            </button>
            <button
              type="button"
              className={styles.reloadBtn}
              disabled={reloading}
              onClick={() => void handleReload()}
            >
              {reloading ? 'Ricaricamento…' : 'Ricarica'}
            </button>
          </div>
        </div>
        <p className="state-empty">
          Questa correzione non è più disponibile: potrebbe essere stata nascosta o messa in
          revisione dal docente.
        </p>
        {reloadError && (
          <p role="alert" className="text-error">
            {reloadError}
          </p>
        )}
      </section>
    );
  }

  const currentQuestion = data.questions.find((q) => q.order === currentOrder) ?? data.questions[0];
  const currentIndex = orders.indexOf(currentOrder);

  function goTo(order: number) {
    if (orders.includes(order)) setCurrentOrder(order);
  }

  return (
    <section aria-label={`Correzione — ${data.verificationTitle}`} className={styles.container}>
      <div className={styles.controlPanel}>
        <div className={styles.controlRow}>
          <div className={styles.headerInfo}>
            <button type="button" className={styles.backBtn} onClick={onBack}>
              ← Torna alle verifiche
            </button>
            <h2 className={styles.title}>{data.verificationTitle}</h2>
            {data.className && <span className={styles.meta}>{data.className}</span>}
            <span className={styles.meta}>Consegnata il {formatTimestamp(data.submittedAt)}</span>
            <span className={styles.meta}>Restituita il {formatTimestamp(data.returnedAt)}</span>
          </div>
          <button
            type="button"
            className={styles.reloadBtn}
            disabled={reloading}
            onClick={() => void handleReload()}
          >
            {reloading ? 'Ricaricamento…' : 'Ricarica'}
          </button>
        </div>

        <div className={styles.headerStats}>
          <div className={styles.statBox}>
            <span className={styles.statLabel}>Punteggio</span>
            <span className={styles.statValue}>
              {data.totalPoints}/{data.maxPoints}
            </span>
          </div>
          <div className={styles.statBox}>
            <span className={styles.statLabel}>Percentuale</span>
            <span className={styles.statValue}>
              {data.percentage === null ? '—' : `${data.percentage}%`}
            </span>
          </div>
        </div>

        {data.generalFeedback && (
          <div className={styles.block}>
            <span className={styles.blockLabel}>Feedback generale</span>
            <p className={styles.generalFeedbackBox}>{data.generalFeedback}</p>
          </div>
        )}

        <nav aria-label="Navigatore domande" className={styles.questionNav}>
          {orders.map((order) => {
            const isCurrent = order === currentOrder;
            return (
              <button
                key={order}
                type="button"
                className={`${styles.navItem}${isCurrent ? ` ${styles.navItemCurrent}` : ''}`}
                title={`Domanda ${order + 1}`}
                aria-label={`Vai alla domanda ${order + 1}`}
                aria-current={isCurrent ? 'true' : undefined}
                onClick={() => goTo(order)}
              >
                {order + 1}
              </button>
            );
          })}
        </nav>
      </div>

      {reloadError && (
        <p role="alert" className="text-error">
          {reloadError}
        </p>
      )}

      {currentQuestion && (
        <article className={styles.questionCard}>
          <div className={styles.questionHeader}>
            <span className={styles.questionNumber}>Domanda {currentOrder + 1}</span>
            <span className={styles.questionScore}>
              {currentQuestion.points}/{currentQuestion.maxPoints} punti
            </span>
          </div>

          <p className={styles.questionText}>{currentQuestion.testo}</p>

          <div className={styles.block}>
            <span className={styles.blockLabel}>La tua risposta</span>
            {renderAnswer(currentQuestion)}
          </div>

          {currentQuestion.correctAnswer !== undefined && (
            <div className={styles.block}>
              <span className={styles.blockLabel}>Soluzione</span>
              {renderSolution(currentQuestion)}
            </div>
          )}

          {currentQuestion.feedback && (
            <div className={styles.block}>
              <span className={styles.blockLabel}>Feedback del docente</span>
              <p className={styles.feedbackBox}>{currentQuestion.feedback}</p>
            </div>
          )}

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
      )}
    </section>
  );
}
