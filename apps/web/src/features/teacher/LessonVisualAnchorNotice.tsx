import styles from './LessonVisualReanchorDialog.module.css';

/**
 * VE-04A — l'avviso che il docente vede quando l'ancora non esiste più.
 *
 * Dice **cosa è successo** e **dove è finita l'immagine**, e offre l'unica
 * azione sensata. Non è un errore e non è colorato come tale: il docente ha
 * riscritto la sua lezione, cosa che ha tutto il diritto di fare.
 *
 * Lo studente non vede nulla di tutto questo: per lui la figura è
 * semplicemente in fondo alla lezione.
 */
export function LessonVisualAnchorNotice({
  headingText,
  onReanchor,
}: {
  headingText: string;
  onReanchor: () => void;
}) {
  return (
    <div className={styles.notice} role="status">
      <p className={styles.noticeText}>
        L’immagine non è più ancorata a «{headingText}» ed è mostrata in fondo alla lezione.
      </p>
      <button type="button" className={styles.action} onClick={onReanchor}>
        Riancora
      </button>
    </div>
  );
}
