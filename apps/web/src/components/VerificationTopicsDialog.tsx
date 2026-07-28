import { DialogShell } from './DialogShell.js';
import type { VerificationTopicUda } from '../types/firestore.js';
import styles from './VerificationTopicsDialog.module.css';

export type VerificationTopicsDialogProps = {
  /** Titolo della verifica, mostrato come sottotitolo per contestualizzare. */
  verificationTitle: string;
  /**
   * Perimetro già in memoria (config/snapshot docente o proiezione pubblica
   * studente). Aprire questa popup non esegue **alcuna** lettura: il dato è
   * esattamente quello che la lista ha già caricato.
   */
  topicOutline: VerificationTopicUda[];
  onClose: () => void;
};

/**
 * UI-VERIFICHE-06B — «Argomenti della verifica», condivisa da docente e
 * studente. Mostra solo titoli UDA e titoli di lezione: nessun id, nessun
 * ordine, nessun testo di domanda, nessuna soluzione, nessun riferimento
 * tecnico — il contratto del dato lo garantisce già a monte
 * (`topicOutline.ts`), qui non viene aggiunto nulla.
 *
 * Lo stesso componente per entrambi i ruoli è deliberato: se docente e studente
 * vedessero renderer diversi dello stesso dato, una divergenza futura potrebbe
 * mostrare a uno dei due qualcosa che l'altro non deve vedere.
 */
export function VerificationTopicsDialog({
  verificationTitle,
  topicOutline,
  onClose,
}: VerificationTopicsDialogProps) {
  return (
    <DialogShell title="Argomenti della verifica" onCancel={onClose} variant="wide-scroll">
      <p className={styles.subtitle}>{verificationTitle}</p>

      <div className={styles.scroll}>
        <ul className={styles.udaList} aria-label="Argomenti della verifica">
          {topicOutline.map((uda) => (
            <li key={uda.udaTitle} className={styles.uda}>
              <p className={styles.udaTitle}>
                <span className={styles.udaTag}>UDA</span> {uda.udaTitle}
              </p>
              <ul className={styles.lessonList} aria-label={`Lezioni — ${uda.udaTitle}`}>
                {uda.lessonTitles.map((lesson) => (
                  <li key={lesson} className={styles.lesson}>
                    {lesson}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </div>

      <div className={styles.actions}>
        <button type="button" onClick={onClose}>
          Chiudi
        </button>
      </div>
    </DialogShell>
  );
}
