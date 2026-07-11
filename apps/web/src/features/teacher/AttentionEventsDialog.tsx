import { useEffect, useRef } from 'react';
import type { KeyboardEvent } from 'react';
import type { AttentionEvent, AttentionEventType } from '../../types/firestore.js';
import styles from './AttentionEventsDialog.module.css';

/**
 * Short "Evento" column label for each known `AttentionEventType` (see
 * `types/firestore.ts`).
 */
const EVENT_SHORT_LABELS: Record<AttentionEventType, string> = {
  fullscreen_exit: 'Uscita schermo intero',
  visibility_hidden: 'Scheda/finestra nascosta',
  tab_blur: 'Cambio scheda',
  window_blur: 'Cambio finestra',
  copy_attempt: 'Copia',
  cut_attempt: 'Taglio',
  paste_attempt: 'Incolla',
  context_menu_attempt: 'Menu contestuale',
  drag_attempt: 'Trascinamento',
};

/**
 * Longer "Dettaglio" column description for each known `AttentionEventType`.
 * A type this codebase doesn't know about yet (future event, or a stale
 * build reading a newer document) falls back to a generic message rather
 * than crashing or rendering nothing.
 */
const EVENT_DETAILS: Record<AttentionEventType, string> = {
  fullscreen_exit: 'Lo studente è uscito dalla modalità schermo intero.',
  visibility_hidden: 'La scheda o finestra è stata nascosta o ridotta a icona.',
  tab_blur: 'Lo studente è passato ad un’altra scheda del browser.',
  window_blur: 'Lo studente è passato ad un’altra finestra.',
  copy_attempt: 'Tentativo di copiare del testo dalla pagina.',
  cut_attempt: 'Tentativo di tagliare del testo dalla pagina.',
  paste_attempt: 'Tentativo di incollare del testo nella pagina.',
  context_menu_attempt: 'Tentativo di apertura del menu contestuale (tasto destro).',
  drag_attempt: 'Tentativo di trascinamento di un elemento della pagina.',
};

function shortEventLabel(type: string): string {
  return EVENT_SHORT_LABELS[type as AttentionEventType] ?? 'Evento non riconosciuto';
}

function eventDetail(type: string): string {
  return EVENT_DETAILS[type as AttentionEventType] ?? `Tipo non riconosciuto (${type}).`;
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
          <div>
            <h2 id="attention-events-dialog-title" className={styles.title}>
              Eventi di attenzione ({sortedEvents.length})
            </h2>
            <p className={styles.subtitle}>{studentName}</p>
          </div>
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

        {sortedEvents.length === 0 ? (
          <p className="state-empty">Nessun evento registrato.</p>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th className={styles.th}>Ora</th>
                  <th className={styles.th}>Evento</th>
                  <th className={styles.th}>Dettaglio</th>
                </tr>
              </thead>
              <tbody>
                {sortedEvents.map((event, index) => (
                  <tr key={`${event.type}-${event.ts}-${index}`}>
                    <td className={`${styles.td} ${styles.tdTime}`}>
                      {formatEventTimestamp(event.ts)}
                    </td>
                    <td className={`${styles.td} ${styles.tdEvent}`}>
                      {shortEventLabel(event.type)}
                    </td>
                    <td className={styles.td}>{eventDetail(event.type)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
