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
import {
  attachDeterrenceListeners,
  capAttentionEvents,
  requestFullscreenBestEffort,
} from './examDeterrence.js';
import { countFilled, isAnswerFilled } from './examAnswers.js';
import { shuffleWithRng } from './examShuffle.js';
import { effectiveMaxCharacters } from '@schoolforge/lesson-contract';
import styles from './OnlineExamView.module.css';

/** Dirty-only autosave: at most one write every two minutes, never per keystroke. */
const AUTOSAVE_INTERVAL_MS = 120_000;

type OnlineExamViewProps = {
  verificationId: string;
  title: string;
  className: string | null;
  ownerUid: string;
  studentUid: string;
  questions: PublicVerificationQuestion[];
  /** The draft submission as loaded/created before this view mounted. */
  submission: SubmissionDoc;
  onSubmitted: (receipt: SubmissionReceiptDoc) => void;
  /**
   * EXAM-UX-03 — RNG per lo shuffle locale delle domande. Seam iniettabile per
   * test deterministici; in produzione è `Math.random` (default), quindi
   * l'ordine cambia liberamente a ogni mount e non è mai persistito.
   */
  rng?: () => number;
};

function saveErrorMessage(err: unknown): string {
  const code = (err as { code?: string } | null)?.code;
  if (code === 'permission-denied') {
    return 'Impossibile salvare: la verifica potrebbe essere stata chiusa o disabilitata dal docente.';
  }
  return 'Errore durante il salvataggio. Riprova.';
}

/**
 * Single-page online exam (M3F-04/M3F-06). All questions on one page; reuses
 * submissionsService exclusively for every write (no ad-hoc Firestore
 * calls here). Fullscreen is requested by the caller (a click handler in
 * StudentVerificationsView, or a best-effort attempt on session resume),
 * not here — this component only attaches the deterrence listeners
 * (attachDeterrenceListeners) for as long as it is mounted.
 *
 * M3F-06: a draft is a mandatory session (D-M3F-14/15) — there is no exit
 * button here. The only ways out are a successful delivery (this
 * component detaches its own listeners and exits fullscreen itself, see
 * `handleConfirmSubmit`) or the parent unmounting this view for its own
 * reasons, which still runs the deterrence cleanup via the effect below.
 */
export function OnlineExamView({
  verificationId,
  title,
  className,
  ownerUid,
  studentUid,
  questions,
  submission,
  onSubmitted,
  rng = Math.random,
}: OnlineExamViewProps) {
  const [answers, setAnswersState] = useState<Record<string, AnswerValue>>(submission.answers);
  const [flagged, setFlaggedState] = useState<Record<string, boolean>>(submission.flagged);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [lastSavedLabel, setLastSavedLabel] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [sessionEnded, setSessionEnded] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(() => Boolean(document.fullscreenElement));
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Refs mirror the state above so the 60s autosave interval (set up once)
  // and the deterrence event handlers (also set up once) always see the
  // latest values without needing to be re-created on every keystroke.
  const answersRef = useRef(answers);
  const flaggedRef = useRef(flagged);
  const dirtyRef = useRef(false);
  const savingRef = useRef(false);
  const savePromiseRef = useRef<Promise<void> | null>(null);
  const submittingRef = useRef(false);
  const sessionEndedRef = useRef(false);
  const mountedRef = useRef(true);
  const knownEventCountRef = useRef(submission.attentionEvents.length);
  const bufferedEventsRef = useRef<AttentionEvent[]>([]);
  // Bumped on every change to answers/flagged/attentionEvents. A save
  // captures the revision it started with; if the revision has moved on by
  // the time the write resolves, a change happened *during* the write and
  // must not be discarded as "already saved" — dirty stays true so the next
  // autosave tick (or a manual save) picks it up.
  const revisionRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  function setAnswer(order: number, value: AnswerValue) {
    if (submittingRef.current || sessionEndedRef.current) return;
    const key = String(order);
    const next = { ...answersRef.current, [key]: value };
    answersRef.current = next;
    setAnswersState(next);
    dirtyRef.current = true;
    revisionRef.current += 1;
  }

  function toggleFlag(order: number) {
    if (submittingRef.current || sessionEndedRef.current) return;
    const key = String(order);
    const next = { ...flaggedRef.current, [key]: !flaggedRef.current[key] };
    flaggedRef.current = next;
    setFlaggedState(next);
    dirtyRef.current = true;
    revisionRef.current += 1;
  }

  async function persistDraft(): Promise<void> {
    if (savingRef.current || submittingRef.current || sessionEndedRef.current) return;
    savingRef.current = true;
    if (mountedRef.current) {
      setSaving(true);
      setSaveError(null);
    }
    const startRevision = revisionRef.current;
    const eventsToSend = capAttentionEvents(knownEventCountRef.current, bufferedEventsRef.current);
    const savePromise = (async () => {
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
        // Only clear dirty if nothing changed while this write was in flight —
        // otherwise the newer change would be silently treated as saved.
        if (revisionRef.current === startRevision) {
          dirtyRef.current = false;
        }
        if (mountedRef.current && !sessionEndedRef.current) {
          setLastSavedLabel(
            new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }),
          );
        }
      } catch (err) {
        if (mountedRef.current && !sessionEndedRef.current) {
          setSaveError(saveErrorMessage(err));
        }
      } finally {
        savingRef.current = false;
        if (mountedRef.current) setSaving(false);
      }
    })();
    savePromiseRef.current = savePromise;
    try {
      await savePromise;
    } finally {
      if (savePromiseRef.current === savePromise) savePromiseRef.current = null;
    }
  }

  // Autosave: only when dirty, at most once every 120s — never on every
  // keystroke. A single interval set up once; refs keep it reading current
  // data without needing to be torn down and recreated.
  useEffect(() => {
    const interval = setInterval(() => {
      if (dirtyRef.current && !submittingRef.current && !sessionEndedRef.current) {
        void persistDraft();
      }
    }, AUTOSAVE_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  // Deterrence listeners for the lifetime of this view — removed on unmount
  // (covers submit-success and the browser back button) AND explicitly on a
  // successful delivery (see handleConfirmSubmit), so the code-driven
  // exitFullscreen() call that follows a successful submit is never itself
  // logged as a fullscreen_exit attention event.
  const deterrenceCleanupRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    const cleanup = attachDeterrenceListeners((type: AttentionEventType) => {
      // Once the 200-event cap is reached, ignored events have nothing new
      // to save.
      if (knownEventCountRef.current + bufferedEventsRef.current.length >= 200) return;
      // M3F-11B: an attention event alone must never mark the draft dirty
      // or trigger an autosave — it is only buffered here. `persistDraft`
      // always includes whatever is buffered (see `eventsToSend` below and
      // in `handleConfirmSubmit`), so the event still reaches Firestore on
      // the next save caused by an answer/flag change, the next manual
      // "Salva bozza" click, or the final delivery — never dropped, just
      // not itself a reason to write.
      bufferedEventsRef.current = [...bufferedEventsRef.current, { type, ts: Date.now() }];
    }, setIsFullscreen);
    deterrenceCleanupRef.current = cleanup;
    return () => {
      cleanup();
      deterrenceCleanupRef.current = null;
    };
  }, []);

  const orders = questions.map((q) => q.order);
  const filledCount = countFilled(orders, answers);
  const flaggedCount = orders.filter((o) => flagged[String(o)]).length;
  const totalCount = questions.length;
  const controlsLocked = submitting || sessionEnded;

  // EXAM-UX-03 — ordine casuale LOCALE delle domande (deterrente leggero).
  // Calcolato una sola volta per (mount, verificationId) e memorizzato in un ref:
  // resta stabile durante render/autosave/flag/fullscreen/navigazione, e si
  // rigenera solo se cambia il verificationId senza remount. Non viene MAI
  // persistito (Firestore/session/localStorage). Riordina soltanto la vista: le
  // risposte e i flag restano legati all'`order` ORIGINALE di ogni domanda.
  const shuffleRef = useRef<{ id: string; ordered: PublicVerificationQuestion[] } | null>(null);
  if (!shuffleRef.current || shuffleRef.current.id !== verificationId) {
    shuffleRef.current = { id: verificationId, ordered: shuffleWithRng(questions, rng) };
  }
  const displayQuestions = shuffleRef.current.ordered;

  /**
   * Detaches the deterrence listeners first, then exits fullscreen — in
   * that order, and only after a successful delivery — so the resulting
   * `fullscreenchange` is never observed as a `fullscreen_exit` attention
   * event. Non-blocking: a rejected/unsupported exitFullscreen is ignored,
   * same spirit as requestFullscreenBestEffort.
   */
  function endSessionAfterDelivery() {
    deterrenceCleanupRef.current?.();
    deterrenceCleanupRef.current = null;
    if (document.fullscreenElement && typeof document.exitFullscreen === 'function') {
      document.exitFullscreen().catch(() => {
        // Ignored — fullscreen is deterrence only, never blocking.
      });
    }
  }

  async function handleConfirmSubmit() {
    // Ref guard is synchronous: two clicks in the same React render cannot
    // start two deliveries while the `submitting` state is still stale.
    if (submittingRef.current || sessionEndedRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    setSubmitError(null);
    setSaveError(null);

    // Serialize delivery after any draft write already in flight. The final
    // submission below still uses the latest refs, so changes made while that
    // save was pending are included and no stale draft write can finish after
    // a successful `submitted` transition.
    await savePromiseRef.current;

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
    } catch (err) {
      // Delivery itself failed: resume autosave, stay in fullscreen and leave
      // the form editable with its dirty revision intact.
      submittingRef.current = false;
      if (mountedRef.current) {
        setSubmitting(false);
        setSubmitError(saveErrorMessage(err));
      }
      return;
    }

    // From here delivery is irreversible. Stop every future draft write even
    // if receipt read-back fails, then detach deterrence before fullscreen exit.
    sessionEndedRef.current = true;
    dirtyRef.current = false;
    bufferedEventsRef.current = [];
    if (mountedRef.current) setSessionEnded(true);
    endSessionAfterDelivery();

    try {
      const receipt = await loadReceipt(verificationId, studentUid, db);
      if (receipt) {
        if (mountedRef.current) setConfirmOpen(false);
        onSubmitted(receipt);
        return;
      }
      if (mountedRef.current) {
        setSubmitError(
          'Consegna registrata ma non è stato possibile caricare la ricevuta. Ricarica la pagina.',
        );
      }
    } catch {
      if (mountedRef.current) {
        setSubmitError(
          'Consegna registrata ma non è stato possibile caricare la ricevuta. Ricarica la pagina.',
        );
      }
    } finally {
      // Keep controls locked after a successful delivery. The receipt view (or
      // a refresh that resolves it from Firestore) is the only next screen.
      if (mountedRef.current && !sessionEndedRef.current) setSubmitting(false);
    }
  }

  return (
    <section aria-label={`Verifica online — ${title}`} className={styles.container}>
      {/* Header and navigator stay unified, but scroll in normal page flow. */}
      <div className={styles.controlPanel}>
        <div className={styles.controlRow}>
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
            {!isFullscreen && !sessionEnded && (
              <button
                type="button"
                className={styles.fullscreenBtn}
                onClick={requestFullscreenBestEffort}
                disabled={submitting}
              >
                Torna a schermo intero
              </button>
            )}
            <button
              type="button"
              onClick={() => void persistDraft()}
              disabled={saving || controlsLocked}
            >
              {saving ? 'Salvataggio…' : 'Salva bozza'}
            </button>
            <button
              type="button"
              className="btn-success"
              onClick={() => setConfirmOpen(true)}
              disabled={controlsLocked}
            >
              Consegna
            </button>
          </div>
        </div>

        <nav aria-label="Navigatore domande" className={styles.questionNav}>
          {displayQuestions.map((q, displayIndex) => {
            const key = String(q.order);
            const displayNumber = displayIndex + 1;
            const isFlagged = !!flagged[key];
            const filled = isAnswerFilled(answers[key]);
            const navState = isFlagged ? 'flagged' : filled ? 'filled' : 'empty';
            const navLabel = isFlagged ? 'da rivedere' : filled ? 'compilata' : 'vuota';
            const navClass =
              navState === 'flagged'
                ? styles.navItemFlagged
                : navState === 'filled'
                  ? styles.navItemFilled
                  : styles.navItemEmpty;
            return (
              <button
                key={q.order}
                type="button"
                className={`${styles.navItem} ${navClass}`}
                title={`Domanda ${displayNumber} — ${navLabel}`}
                aria-label={`Vai alla domanda ${displayNumber} — ${navLabel}`}
                onClick={() =>
                  document
                    .getElementById(`question-${q.order}`)
                    ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                }
              >
                {displayNumber}
              </button>
            );
          })}
        </nav>
      </div>

      <div className={styles.questionList}>
        {displayQuestions.map((q, displayIndex) => {
          const key = String(q.order);
          const displayNumber = displayIndex + 1;
          const answer = answers[key];
          const filled = isAnswerFilled(answer);
          const isFlagged = !!flagged[key];

          return (
            <article key={q.order} id={`question-${q.order}`} className={styles.questionCard}>
              <div className={styles.questionHeader}>
                <span className={styles.questionNumber}>#{displayNumber}</span>
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
                      ? `Rimuovi "da rivedere" dalla domanda ${displayNumber}`
                      : `Segna la domanda ${displayNumber} come "da rivedere"`
                  }
                  onClick={() => toggleFlag(q.order)}
                  disabled={controlsLocked}
                >
                  {isFlagged ? 'Rimuovi "da rivedere"' : 'Da rivedere'}
                </button>
              </div>

              <p className={styles.questionText}>{q.testo}</p>

              {q.tipo === 'aperta' &&
                (() => {
                  // EXAM-UX-03 — limite caratteri effettivo (default 2000 se
                  // assente/legacy). maxLength è il tetto del browser; lo slice in
                  // onChange è una difesa minimale contro paste/IME che aggirano
                  // maxLength. Un dato legacy già salvato oltre il limite resta
                  // visibile: il nuovo input non può però aumentarlo ulteriormente.
                  const limit = effectiveMaxCharacters(q.maxCharacters);
                  const current = answer?.tipo === 'aperta' ? answer.testo : '';
                  const counterId = `answer-counter-${q.order}`;
                  return (
                    <>
                      <textarea
                        className={styles.answerTextarea}
                        value={current}
                        onChange={(e) =>
                          setAnswer(q.order, {
                            tipo: 'aperta',
                            testo: e.target.value.slice(0, limit),
                          })
                        }
                        rows={4}
                        maxLength={limit}
                        aria-label={`Risposta alla domanda ${displayNumber}`}
                        aria-describedby={counterId}
                        disabled={controlsLocked}
                      />
                      <span id={counterId} className={styles.answerCounter}>
                        {current.length} / {limit} caratteri
                      </span>
                    </>
                  );
                })()}

              {q.tipo === 'chiusa_singola' && (
                <>
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
                          disabled={controlsLocked}
                        />
                        {o.testo}
                      </label>
                    ))}
                  </div>
                  <button
                    type="button"
                    className={styles.clearAnswerBtn}
                    disabled={
                      controlsLocked ||
                      !(answer?.tipo === 'chiusa_singola' && answer.selectedId != null)
                    }
                    onClick={() => setAnswer(q.order, { tipo: 'chiusa_singola', selectedId: null })}
                  >
                    Cancella risposta
                  </button>
                </>
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
                          disabled={controlsLocked}
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
              vuote. {flaggedCount} sono segnate da rivedere.
            </p>
            {submitError && (
              <p role="alert" className="text-error">
                {submitError}
              </p>
            )}
            <div className={styles.confirmActions}>
              <button type="button" onClick={() => setConfirmOpen(false)} disabled={controlsLocked}>
                Annulla
              </button>
              <button
                type="button"
                className="btn-success"
                onClick={() => void handleConfirmSubmit()}
                disabled={controlsLocked}
              >
                {sessionEnded
                  ? 'Consegna registrata'
                  : submitting
                    ? 'Consegna in corso…'
                    : 'Conferma consegna'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
