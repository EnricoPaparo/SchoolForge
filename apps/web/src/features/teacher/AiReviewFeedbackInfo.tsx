import { useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { AiReviewFeedback } from '../repository/pools/aiContentClient.js';
import styles from './AiAdvancedReviewControl.module.css';

/** Transient, read-only provider summary; not independent proof of correctness. */
export function AiReviewFeedbackInfo({
  status,
  feedback,
  replayed = false,
}: {
  status: 'improved' | 'unchanged';
  feedback?: AiReviewFeedback;
  replayed?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 12, top: 12 });
  function close() {
    setOpen(false);
    triggerRef.current?.focus({ preventScroll: true });
  }
  useLayoutEffect(() => {
    if (!open) return;
    function reposition() {
      const anchor = triggerRef.current?.getBoundingClientRect();
      const panel = panelRef.current?.getBoundingClientRect();
      if (!anchor || !panel) return;
      const width = Math.min(352, Math.max(0, window.innerWidth - 24));
      const height = Math.min(panel.height, Math.max(0, window.innerHeight - 24));
      const below = anchor.bottom + 8;
      const preferredTop =
        below + height <= window.innerHeight - 12 ? below : anchor.top - height - 8;
      setPosition({
        left: Math.max(12, Math.min(anchor.right - width, window.innerWidth - width - 12)),
        top: Math.max(12, Math.min(preferredTop, window.innerHeight - height - 12)),
      });
    }
    function dismissOnEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      close();
    }
    reposition();
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    document.addEventListener('keydown', dismissOnEscape, true);
    return () => {
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
      document.removeEventListener('keydown', dismissOnEscape, true);
    };
  }, [open]);
  const id = useId();
  const changes = Array.isArray(feedback?.changes)
    ? feedback.changes
        .filter(
          (item): item is string =>
            typeof item === 'string' && item.length <= 240 && item.trim().length > 0,
        )
        .slice(0, 3)
    : [];
  return (
    <div
      className={styles.feedbackInfo}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          event.stopPropagation();
          close();
        }
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        className={styles.infoButton}
        aria-label="Resoconto del revisore"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
      >
        i
      </button>
      {open &&
        createPortal(
          <div
            className={styles.feedbackOverlay}
            onPointerDown={(event) => {
              if (event.target !== event.currentTarget) return;
              event.preventDefault();
              event.stopPropagation();
            }}
            onClick={(event) => {
              event.stopPropagation();
              if (event.target === event.currentTarget) close();
            }}
          >
            <div
              ref={panelRef}
              id={id}
              role="note"
              tabIndex={-1}
              className={styles.feedbackPopover}
              style={{ left: position.left, top: position.top }}
            >
              <strong>Resoconto del revisore</strong>
              {status === 'unchanged' ? (
                <p>Nessuna modifica necessaria rilevata.</p>
              ) : changes.length ? (
                <ul>
                  {changes.map((change, i) => (
                    <li key={i}>{change}</li>
                  ))}
                </ul>
              ) : (
                <p>
                  {replayed
                    ? 'Il dettaglio non è disponibile per questa operazione ripristinata.'
                    : 'Il dettaglio degli interventi non è disponibile per questa operazione.'}
                </p>
              )}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
