import { useEffect, useRef } from 'react';
import type { KeyboardEvent } from 'react';
import type { AttentionEvent, AttentionEventType } from '../../types/firestore.js';
import styles from './AttentionEventsDialog.module.css';

/**
 * Human-readable label for each known `AttentionEventType` (see
 * `types/firestore.ts`). A type this codebase doesn't know about yet
 * (future event, or a stale build reading a newer document) falls back to
 * `describeUnknownEvent` below rather than crashing or rendering nothing.
 */
const EVENT_LABELS: Record<AttentionEventType, string> = {
  fullscreen_exit: 'Uscita dalla modalità schermo intero',
  visibility_hidden: 'Scheda/finestra nascosta o ridotta a icona',
  tab_blur: 'Passaggio ad un’altra scheda',
  window_blur: 'Passaggio ad un’altra finestra',
  copy_attempt: 'Tentativo di copia',
  cut_attempt: 'Tentativo di taglio',
  paste_attempt: 'Tentativo di incolla',
  context_menu_attempt: 'Tentativo di apertura menu contestuale',
  drag_attempt: 'Tentativo di trascinamento',
};

function describeEvent(type: string): string {
  return EVENT_LABELS[type as AttentionEventType] ?? `Evento non riconosciuto (${type})`;
}

function formatEventTimestamp(ts: number): string {
  return new Date(ts).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'medium' });
}

function focusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((el) => !el.hasAttribute('disabled'));
}

export type AttentionEventsDialogProps = {
  studentName: string;
  events: AttentionEvent[];
  onClose: () => void;
};

/**
 * Read-only dialog listing every attention event already delivered by the
 * monitor's single `submissions` listener (`watchSubmissions` /
 * `SubmissionMonitorItem.attentionEvents`, sanitized to `type`+`ts` only —
 * see `submissionsMonitorService.ts`). Opening this dialog never opens a
 * new listener or issues a new Firestore read: `events` is exactly the
 * array already held in the parent's state.
 *
 * These are attention *signals*, not proof of misconduct — the dialog says
 * so explicitly, and never renders `answers`/`flagged` (which this
 * component never even receives).
 */
export function AttentionEventsDialog({
  studentName,
  events,
  onClose,
}: AttentionEventsDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const sortedEvents = [...events].sort((a, b) => a.ts - b.ts);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const focusables = focusableElements(dialog);
    (focusables[0] ?? dialog).focus();
  }, []);

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape') {
      onClose();
      return;
    }
    if (e.key !== 'Tab') return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const focusables = focusableElements(dialog);
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div
        ref={dialogRef}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="attention-events-dialog-title"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className={styles.header}>
          <h2 id="attention-events-dialog-title" className={styles.title}>
            Eventi di attenzione — {studentName}
          </h2>
          <button
            type="button"
            className={styles.closeBtn}
            aria-label="Chiudi finestra eventi di attenzione"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        <p className={styles.notice}>
          Questi eventi sono segnalazioni di attenzione registrate dal browser dello studente, non
          prova di un comportamento scorretto.
        </p>

        <p className={styles.total}>Totale eventi: {sortedEvents.length}</p>

        {sortedEvents.length === 0 ? (
          <p className="state-empty">Nessun evento registrato.</p>
        ) : (
          <ul className={styles.list}>
            {sortedEvents.map((event, index) => (
              <li key={`${event.type}-${event.ts}-${index}`} className={styles.item}>
                <span className={styles.itemTime}>{formatEventTimestamp(event.ts)}</span>
                <span className={styles.itemLabel}>{describeEvent(event.type)}</span>
              </li>
            ))}
          </ul>
        )}

        <div className={styles.actions}>
          <button type="button" onClick={onClose}>
            Chiudi
          </button>
        </div>
      </div>
    </div>
  );
}
