import { useEffect, useRef, useState } from 'react';
import { db } from '../../lib/firebase.js';
import type {
  AnswerValue,
  AttentionEvent,
  AttentionEventType,
  PublicVerificationQuestion,
  SubmissionDoc,
  SubmissionReceiptDoc,
} from '../../types/firestore.js';
import { loadReceipt, saveDraft, submitSubmission } from './submissionsService.js';
import { attachDeterrenceListeners, capAttentionEvents } from './examDeterrence.js';
import { countFilled, isAnswerFilled } from './examAnswers.js';
import styles from './OnlineExamView.module.css';

const AUTOSAVE_INTERVAL_MS = 30_000;

type OnlineExamViewProps = {
  verificationId: string;
  title: string;
  className: string | null;
  ownerUid: string;
  studentUid: string;
  questions: PublicVerificationQuestion[];
  /** The draft submission as loaded/created before this view mounted. */
  submission: SubmissionDoc;
  onExit: () => void;
  onSubmitted: (receipt: SubmissionReceiptDoc) => void;
};

function saveErrorMessage(err: unknown): string {
  const code = (err as { code?: string } | null)?.code;
  if (code === 'permission-denied') {
    return 'Impossibile salvare: la verifica potrebbe essere stata chiusa o disabilitata dal docente.';
  }
  return 'Errore durante il salvataggio. Riprova.';
}

/**
 * Single-page online exam (M3F-04). All questions on one page; reuses
 * submissionsService exclusively for every write (no ad-hoc Firestore
 * calls here). Fullscreen is requested by the caller's click handler
 * (StudentVerificationsView), not here — this component only attaches the
 * deterrence listeners (attachDeterrenceListeners) for as long as it is
 * mounted and always removes them on unmount, submit, or exit.
 */
export function OnlineExamView({
  verificationId,
  title,
  className,
  ownerUid,
  studentUid,
  questions,
  submission,
  onExit,
  onSubmitted,
}: OnlineExamViewProps) {
  const [answers, setAnswersState] = useState<Record<string, AnswerValue>>(submission.answers);
  const [flagged, setFlaggedState] = useState<Record<string, boolean>>(submission.flagged);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [lastSavedLabel, setLastSavedLabel] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Refs mirror the state above so the 30s autosave interval (set up once)
  // and the deterrence event handlers (also set up once) always see the
  // latest values without needing to be re-created on every keystroke.
  const answersRef = useRef(answers);
  const flaggedRef = useRef(flagged);
  const dirtyRef = useRef(false);
  const savingRef = useRef(false);
  const knownEventCountRef = useRef(submission.attentionEvents.length);
  const bufferedEventsRef = useRef<AttentionEvent[]>([]);

  function setAnswer(order: number, value: AnswerValue) {
    const key = String(order);
    const next = { ...answersRef.current, [key]: value };
    answersRef.current = next;
    setAnswersState(next);
    dirtyRef.current = true;
  }

  function toggleFlag(order: number) {
    const key = String(order);
    const next = { ...flaggedRef.current, [key]: !flaggedRef.current[key] };
    flaggedRef.current = next;
    setFlaggedState(next);
    dirtyRef.current = true;
  }

  async function persistDraft(): Promise<void> {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setSaveError(null);
    const eventsToSend = capAttentionEvents(knownEventCountRef.current, bufferedEventsRef.current);
    try {
      await saveDraft(
        {
          verificationId,
          studentUid,
          answers: answersRef.current,
          flagged: flaggedRef.current,
          newAttentionEvents: eventsToSend,
        },
        db,
      );
      knownEventCountRef.current += eventsToSend.length;
      bufferedEventsRef.current = bufferedEventsRef.current.slice(eventsToSend.length);
      dirtyRef.current = false;
      setLastSavedLabel(
        new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }),
      );
    } catch (err) {
      setSaveError(saveErrorMessage(err));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  // Autosave: only when dirty, at most once every 30s — never on every
  // keystroke. A single interval set up once; refs keep it reading current
  // data without needing to be torn down and recreated.
  useEffect(() => {
    const interval = setInterval(() => {
      if (dirtyRef.current) void persistDraft();
    }, AUTOSAVE_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  // Deterrence listeners for the lifetime of this view only — always removed
  // on unmount (covers exit, submit-success, and the browser back button).
  useEffect(() => {
    const cleanup = attachDeterrenceListeners((type: AttentionEventType) => {
      if (knownEventCountRef.current + bufferedEventsRef.current.length >= 200) return;
      bufferedEventsRef.current = [...bufferedEventsRef.current, { type, ts: Date.now() }];
    });
    return cleanup;
  }, []);

  const orders = questions.map((q) => q.order);
  const filledCount = countFilled(orders, answers);
  const totalCount = questions.length;

  function handleExit() {
    if (dirtyRef.current) {
      const proceed = window.confirm('Hai modifiche non salvate. Uscire comunque?');
      if (!proceed) return;
    }
    onExit();
  }

  async function handleConfirmSubmit() {
    if (submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    const eventsToSend = capAttentionEvents(knownEventCountRef.current, bufferedEventsRef.current);
    try {
      await submitSubmission(
        {
          verificationId,
          studentUid,
          ownerUid,
          answers: answersRef.current,
          flagged: flaggedRef.current,
          newAttentionEvents: eventsToSend,
          verificationTitle: title,
          className,
        },
        db,
      );
      const receipt = await loadReceipt(verificationId, studentUid, db);
      if (receipt) {
        setConfirmOpen(false);
        onSubmitted(receipt);
        return;
      }
      setSubmitError(
        'Consegna registrata ma non è stato possibile caricare la ricevuta. Ricarica la pagina.',
      );
    } catch (err) {
      setSubmitError(saveErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section aria-label={`Verifica online — ${title}`} className={styles.container}>
      <header className={styles.examHeader}>
        <div className={styles.examHeaderInfo}>
          <h2 className={styles.examTitle}>{title}</h2>
          {className && <span className={styles.examClass}>{className}</span>}
          <span className={styles.examBadge}>Modalità verifica</span>
        </div>

        <div className={styles.examStatus}>
          <span className={styles.examProgress}>
            {filledCount}/{totalCount} compilate
          </span>
          {saveError ? (
            <span role="alert" className={styles.saveError}>
              {saveError}
            </span>
          ) : (
            lastSavedLabel && (
              <span className={styles.saveStatus}>Bozza salvata alle {lastSavedLabel}</span>
            )
          )}
        </div>

        <div className={styles.examActions}>
          <button type="button" onClick={handleExit}>
            Torna alla lista
          </button>
          <button type="button" onClick={() => void persistDraft()} disabled={saving}>
            {saving ? 'Salvataggio…' : 'Salva bozza'}
          </button>
          <button type="button" className="btn-success" onClick={() => setConfirmOpen(true)}>
            Consegna
          </button>
        </div>
      </header>

      <div className={styles.questionList}>
        {questions.map((q) => {
          const key = String(q.order);
          const answer = answers[key];
          const filled = isAnswerFilled(answer);
          const isFlagged = !!flagged[key];

          return (
            <article key={q.order} className={styles.questionCard}>
              <div className={styles.questionHeader}>
                <span className={styles.questionNumber}>#{q.order + 1}</span>
                <span className={filled ? styles.statusFilled : styles.statusEmpty}>
                  {filled ? '● Compilata' : '○ Non compilata'}
                </span>
                {isFlagged && <span className={styles.statusFlagged}>⚑ Da rivedere</span>}
                <button
                  type="button"
                  className={styles.flagBtn}
                  aria-pressed={isFlagged}
                  aria-label={
                    isFlagged
                      ? `Rimuovi "da rivedere" dalla domanda ${q.order + 1}`
                      : `Segna la domanda ${q.order + 1} come "da rivedere"`
                  }
                  onClick={() => toggleFlag(q.order)}
                >
                  {isFlagged ? 'Rimuovi "da rivedere"' : 'Da rivedere'}
                </button>
              </div>

              <p className={styles.questionText}>{q.testo}</p>

              {q.tipo === 'aperta' && (
                <textarea
                  className={styles.answerTextarea}
                  value={answer?.tipo === 'aperta' ? answer.testo : ''}
                  onChange={(e) => setAnswer(q.order, { tipo: 'aperta', testo: e.target.value })}
                  rows={4}
                  aria-label={`Risposta alla domanda ${q.order + 1}`}
                />
              )}

              {q.tipo === 'chiusa_singola' && (
                <div
                  className={styles.optionsList}
                  role="radiogroup"
                  aria-label={`Opzioni della domanda ${q.order + 1}`}
                >
                  {q.opzioni?.map((o) => (
                    <label key={o.id} className={styles.optionRow}>
                      <input
                        type="radio"
                        name={`q-${verificationId}-${q.order}`}
                        checked={answer?.tipo === 'chiusa_singola' && answer.selectedId === o.id}
                        onChange={() =>
                          setAnswer(q.order, { tipo: 'chiusa_singola', selectedId: o.id })
                        }
                      />
                      {o.testo}
                    </label>
                  ))}
                </div>
              )}

              {q.tipo === 'chiusa_multipla' && (
                <div className={styles.optionsList}>
                  {q.opzioni?.map((o) => {
                    const selectedIds =
                      answer?.tipo === 'chiusa_multipla' ? answer.selectedIds : [];
                    const checked = selectedIds.includes(o.id);
                    return (
                      <label key={o.id} className={styles.optionRow}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => {
                            const next = checked
                              ? selectedIds.filter((id) => id !== o.id)
                              : [...selectedIds, o.id];
                            setAnswer(q.order, { tipo: 'chiusa_multipla', selectedIds: next });
                          }}
                        />
                        {o.testo}
                      </label>
                    );
                  })}
                </div>
              )}
            </article>
          );
        })}
      </div>

      {confirmOpen && (
        <div className={styles.confirmOverlay}>
          <div className={styles.confirmBox} role="alertdialog" aria-label="Conferma consegna">
            <p>
              Hai compilato {filledCount}/{totalCount} domande. {totalCount - filledCount} sono
              vuote.
            </p>
            {submitError && (
              <p role="alert" className="text-error">
                {submitError}
              </p>
            )}
            <div className={styles.confirmActions}>
              <button type="button" onClick={() => setConfirmOpen(false)} disabled={submitting}>
                Annulla
              </button>
              <button
                type="button"
                className="btn-success"
                onClick={() => void handleConfirmSubmit()}
                disabled={submitting}
              >
                {submitting ? 'Consegna in corso…' : 'Conferma consegna'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
