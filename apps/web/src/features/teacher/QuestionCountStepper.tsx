import styles from './QuestionCountStepper.module.css';

/**
 * AIGEN-UI-01 — stepper riusabile per le quantità di domande del pool. Sostituisce
 * l'aspetto nativo dell'`input[type=number]` (niente spinner del browser) senza
 * cambiare la logica di stato: il valore resta una **stringa grezza** editabile
 * (fail-closed a monte). `−`/`+` operano sul valore già parsato e delegano al
 * genitore la nuova stringa, così l'invalidazione della stima/`requestId` e la
 * validazione esistente non cambiano.
 *
 * `−` è disabilitato quando il valore è 0 (o non parsabile); `+` è disabilitato
 * quando `canIncrement` è falso (totale al massimo o configurazione non valida).
 * L'input manuale oltre il massimo **non** viene corretto silenziosamente: resta
 * segnalato dalla validazione esistente.
 */
export function QuestionCountStepper({
  label,
  rawValue,
  parsedValue,
  onChange,
  canIncrement,
  decrementLabel,
  incrementLabel,
}: {
  label: string;
  /** Valore grezzo mostrato nell'input (preserva stato vuoto/malformato). */
  rawValue: string;
  /** Valore intero ≥ 0 se valido, altrimenti `null` (fail-closed). */
  parsedValue: number | null;
  /** Riceve la nuova stringa grezza, come l'onChange nativo precedente. */
  onChange: (next: string) => void;
  /** `false` quando il totale ha raggiunto il massimo o la config non è valida. */
  canIncrement: boolean;
  decrementLabel: string;
  incrementLabel: string;
}) {
  const invalid = parsedValue === null;
  const canDecrement = parsedValue !== null && parsedValue > 0;
  const base = parsedValue ?? 0;

  return (
    <div className={styles.stepper}>
      <span className={styles.label}>{label}</span>
      <div className={styles.control}>
        <button
          type="button"
          className={styles.button}
          aria-label={decrementLabel}
          disabled={!canDecrement}
          onClick={() => onChange(String(base - 1))}
        >
          −
        </button>
        <input
          type="text"
          inputMode="numeric"
          className={styles.input}
          value={rawValue}
          aria-label={label}
          aria-invalid={invalid}
          onChange={(e) => onChange(e.target.value)}
        />
        <button
          type="button"
          className={styles.button}
          aria-label={incrementLabel}
          disabled={!canIncrement}
          onClick={() => onChange(String(base + 1))}
        >
          +
        </button>
      </div>
    </div>
  );
}
