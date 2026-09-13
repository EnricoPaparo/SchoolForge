import { DialogShell } from '../../components/DialogShell.js';
import styles from './AiReviewExitConfirm.module.css';

/**
 * Conferma condivisa per l'uscita dalla review di una proposta IA.
 *
 * Usa la stessa primitiva modale del resto del portale. Backdrop ed Escape
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
  return (
    <DialogShell
      title="Abbandonare la proposta?"
      role="alertdialog"
      onCancel={onKeepReviewing}
      variant="review-confirm"
    >
      <p>Le modifiche non applicate andranno perse.</p>
      <div className={`dialog-actions ${styles.actions}`}>
        <button type="button" onClick={onKeepReviewing}>
          <span className={styles.desktopLabel}>Continua</span>
          <span className={styles.mobileLabel}>Continua la revisione</span>
        </button>
        <button type="button" onClick={onBackToConfigure}>
          Modifica configurazione
        </button>
        <button type="button" className="btn-danger" onClick={onAbandon}>
          Abbandona e chiudi
        </button>
      </div>
    </DialogShell>
  );
}
