import { useId, useState } from 'react';
import { DialogShell } from '../../components/DialogShell.js';
import styles from './LessonVisualReanchorDialog.module.css';

/**
 * VISUAL-ENRICHMENT-04A — riancorare senza rigenerare.
 *
 * Il dialog è deliberatamente minuscolo: il docente sceglie **una** sezione fra
 * quelle che nella lezione esistono davvero. Non c'è un campo di testo libero, e
 * non è una semplificazione dell'interfaccia — un heading digitato a mano
 * verrebbe rifiutato dal server, e proporre di scriverlo significherebbe
 * invitare a un errore.
 *
 * L'elenco arriva dal Markdown corrente, nell'ordine della lezione: niente
 * heading inventati, niente sezioni «vicine» suggerite. La figura si sposta
 * dove il docente dice, o non si sposta.
 */

export interface ReanchorHeadingOption {
  /** Testo esatto dell'heading: è ciò che il server risolverà. */
  text: string;
  level: 2 | 3;
}

export function LessonVisualReanchorDialog({
  headings,
  currentHeadingText,
  onCancel,
  onConfirm,
}: {
  headings: ReanchorHeadingOption[];
  /** Heading a cui l'immagine era ancorata, se ancora presente. */
  currentHeadingText: string;
  onCancel: () => void;
  onConfirm: (headingText: string) => Promise<void>;
}) {
  const groupId = useId();
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    if (selected === null || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm(selected);
    } catch (err) {
      // L'errore resta **dentro** il dialog: il docente non deve cercare
      // altrove perché la sua azione non è andata a buon fine.
      setError(err instanceof Error ? err.message : 'Riancoraggio non riuscito. Riprova.');
      setBusy(false);
    }
  }

  return (
    <DialogShell title="Riancora l’immagine" onCancel={onCancel} busy={busy}>
      <div className={styles.body}>
        <p className={styles.intro}>
          Scegli la sezione a cui ancorare l’immagine. L’immagine non viene rigenerata: resta
          esattamente quella che hai approvato.
        </p>

        {headings.length === 0 ? (
          <p role="status" className={styles.empty}>
            Questa lezione non ha sezioni a cui ancorare l’immagine. Aggiungi un titolo di sezione e
            riprova.
          </p>
        ) : (
          <ul className={styles.list} role="radiogroup" aria-labelledby={groupId}>
            <li className={styles.legend} id={groupId}>
              Sezioni della lezione
            </li>
            {headings.map((heading, index) => {
              const id = `${groupId}-${index}`;
              return (
                <li key={id}>
                  <label className={styles.option} htmlFor={id}>
                    <input
                      id={id}
                      type="radio"
                      name={groupId}
                      value={heading.text}
                      checked={selected === heading.text}
                      onChange={() => setSelected(heading.text)}
                      disabled={busy}
                    />
                    <span className={heading.level === 3 ? styles.nested : undefined}>
                      {heading.text}
                    </span>
                    {heading.text === currentHeadingText && (
                      <span className={styles.badge}>ancora attuale</span>
                    )}
                  </label>
                </li>
              );
            })}
          </ul>
        )}

        {error !== null && (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        )}
      </div>

      <div className="dialog-actions">
        <button type="button" className={styles.action} onClick={onCancel} disabled={busy}>
          Annulla
        </button>
        <button
          type="button"
          className={`${styles.action} ${styles.primary}`}
          onClick={confirm}
          disabled={busy || selected === null}
        >
          {busy ? 'Riancoraggio…' : 'Riancora'}
        </button>
      </div>
    </DialogShell>
  );
}
