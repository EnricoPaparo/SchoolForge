import { type KeyboardEvent, useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import styles from './AiReviewExitConfirm.module.css';

/**
 * Conferma modale condivisa per l'uscita dalla review di una proposta IA.
 *
 * È renderizzata in un portal separato: la review sottostante non viene
 * sostituita e il suo footer non cambia dimensione. Backdrop ed Escape
 * equivalgono a «Continua la revisione» e non scartano mai la proposta.
 */
export function AiReviewExitConfirm({
  onKeepReviewing,
  onBackToConfigure,
  onAbandon,
}: {
  onKeepReviewing: () => void;
  onBackToConfigure: () => void;
  onAbandon: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const keepReviewingRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    keepReviewingRef.current?.focus();

    return () => {
      previousFocusRef.current?.focus();
    };
  }, []);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    event.stopPropagation();

    if (event.key === 'Escape') {
      event.preventDefault();
      onKeepReviewing();
      return;
    }

    if (event.key !== 'Tab') return;

    const focusable = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled])') ?? [],
    );
    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      className={styles.backdrop}
      onClick={(event) => {
        event.stopPropagation();
        onKeepReviewing();
      }}
    >
      <div
        ref={dialogRef}
        className={styles.dialog}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <h3 id={titleId}>Abbandonare la proposta?</h3>
        <p id={descriptionId}>Le modifiche non applicate andranno perse.</p>
        <div className={`dialog-actions ${styles.actions}`}>
          <button ref={keepReviewingRef} type="button" onClick={onKeepReviewing}>
            Continua la revisione
          </button>
          <button type="button" onClick={onBackToConfigure}>
            Modifica configurazione
          </button>
          <button type="button" className="btn-danger" onClick={onAbandon}>
            Abbandona e chiudi
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
