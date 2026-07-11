import type { SubmissionReceiptDoc } from '../../types/firestore.js';
import styles from './ConfirmationView.module.css';

/** it-IT "gg/mm/aaaa HH:MM" from a Firestore Timestamp-like value, or null if absent. */
function formatSubmittedAt(ts: unknown): string | null {
  if (!ts || typeof ts !== 'object' || !('seconds' in ts)) return null;
  const date = new Date((ts as { seconds: number }).seconds * 1000);
  const datePart = date.toLocaleDateString('it-IT', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
  const timePart = date.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  return `${datePart} ${timePart}`;
}

type ConfirmationViewProps = {
  receipt: SubmissionReceiptDoc;
  onBackToList: () => void;
};

/**
 * Post-delivery confirmation screen (D-M3F-05/§7.3). Shows only what the
 * receipt itself carries: title, className, delivery timestamp and code —
 * never questions or answers, which live only on the (now student-unreadable)
 * SubmissionDoc. Rendered whenever the student's submission is already
 * `submitted`, including after a page refresh — there is no separate "form"
 * to reopen, only this screen or the list.
 */
export function ConfirmationView({ receipt, onBackToList }: ConfirmationViewProps) {
  const submittedLabel = formatSubmittedAt(receipt.submittedAt);

  return (
    <section aria-label="Consegna effettuata" className={styles.container}>
      <div className={styles.card}>
        <p className={styles.badge}>✓ Consegna effettuata</p>
        <h2 className={styles.title}>{receipt.verificationTitle}</h2>
        {receipt.className && <p className={styles.className}>{receipt.className}</p>}

        <dl className={styles.meta}>
          {submittedLabel && (
            <div className={styles.metaItem}>
              <dt>Consegnata il</dt>
              <dd>{submittedLabel}</dd>
            </div>
          )}
          <div className={styles.metaItem}>
            <dt>Codice consegna</dt>
            <dd className={styles.code}>{receipt.deliveryCode}</dd>
          </div>
        </dl>

        <p className={styles.immutableNotice}>
          La tua consegna è stata registrata. Non è possibile modificarla.
        </p>

        <button type="button" className={styles.backBtn} onClick={onBackToList}>
          Torna alle verifiche
        </button>
      </div>
    </section>
  );
}
