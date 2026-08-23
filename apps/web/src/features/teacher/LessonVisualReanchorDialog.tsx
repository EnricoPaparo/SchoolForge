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
  /** Indice zero-based fra gli heading ancorabili: **è** l'identità dell'opzione. */
  index: number;
  /** Testo canonico dell'heading: conferma, non identificatore. */
  text: string;
  /** Slug che quell'heading avrà nel DOM, suffisso dei duplicati compreso. */
  slug: string;
  level: 2 | 3;
}

const ORDINALS = ['prima', 'seconda', 'terza', 'quarta', 'quinta'];

/**
 * Etichetta di disambiguazione per gli heading omonimi.
 *
 * `null` quando il titolo è unico: aggiungere «prima occorrenza» a una sezione
 * che non ha gemelle sarebbe rumore, e il docente si chiederebbe dove sia la
 * seconda.
 */
function occurrenceLabel(
  headings: ReanchorHeadingOption[],
  heading: ReanchorHeadingOption,
): string | null {
  const sameText = headings.filter((other) => other.text === heading.text);
  if (sameText.length < 2) return null;
  const position = sameText.findIndex((other) => other.index === heading.index);
  const ordinal = ORDINALS[position] ?? `${position + 1}ª`;
  return `${ordinal} occorrenza`;
}

export function LessonVisualReanchorDialog({
  headings,
  currentAnchorSlug,
  onCancel,
  onConfirm,
}: {
  headings: ReanchorHeadingOption[];
  /**
   * **Slug** dell'ancora attuale, non il testo.
   *
   * Con due `## Reti` il testo indicherebbe entrambe le righe come «ancora
   * attuale»; lo slug ne indica una sola, che è quella vera.
   */
  currentAnchorSlug: string;
  onCancel: () => void;
  onConfirm: (choice: ReanchorHeadingOption) => Promise<void>;
}) {
  const groupId = useId();
  // La selezione è l'**indice**: due heading omonimi devono essere scegliibili
  // separatamente, e con il testo come chiave risulterebbero selezionati
  // entrambi.
  const [selected, setSelected] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const choice = headings.find((heading) => heading.index === selected) ?? null;

  async function confirm() {
    if (choice === null || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm(choice);
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
            {headings.map((heading) => {
              const id = `${groupId}-${heading.index}`;
              return (
                <li key={id}>
                  <label className={styles.option} htmlFor={id}>
                    <input
                      id={id}
                      type="radio"
                      name={groupId}
                      value={String(heading.index)}
                      checked={selected === heading.index}
                      onChange={() => setSelected(heading.index)}
                      disabled={busy}
                    />
                    <span className={heading.level === 3 ? styles.nested : undefined}>
                      {heading.text}
                      {/*
                       * Due sezioni con lo stesso titolo sono indistinguibili a
                       * occhio: senza questa nota il docente sceglierebbe a
                       * caso fra due righe identiche.
                       */}
                      {occurrenceLabel(headings, heading) && (
                        <span className={styles.occurrence}>
                          {' '}
                          — {occurrenceLabel(headings, heading)}
                        </span>
                      )}
                    </span>
                    {heading.slug === currentAnchorSlug && (
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
          disabled={busy || choice === null}
        >
          {busy ? 'Riancoraggio…' : 'Riancora'}
        </button>
      </div>
    </DialogShell>
  );
}
