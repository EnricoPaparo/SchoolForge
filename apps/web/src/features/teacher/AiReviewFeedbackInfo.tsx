import { useId, useState } from 'react';
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
          setOpen(false);
        }
      }}
    >
      <button
        type="button"
        className={styles.infoButton}
        aria-label="Resoconto del revisore"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
      >
        i
      </button>
      {open && (
        <div id={id} role="note" className={styles.feedbackPopover}>
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
          <p className={styles.description}>Disponibile finché questa finestra resta aperta.</p>
          <button type="button" onClick={() => setOpen(false)}>
            Chiudi resoconto
          </button>
        </div>
      )}
    </div>
  );
}
