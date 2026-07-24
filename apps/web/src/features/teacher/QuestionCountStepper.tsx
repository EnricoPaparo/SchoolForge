import { useState, type ReactNode } from 'react';
import styles from './QuestionCountStepper.module.css';

/**
 * AIGEN-UI-01/02 — stepper compatti riusabili dei dialog AIGEN. `CompactStepper`
 * è il **nucleo condiviso** (presentazione + `−`/valore/`+`, nessuno spinner
 * nativo del browser); `QuestionCountStepper` e `BoundedStepper` sono i due soli
 * wrapper, così la logica non è duplicata.
 *
 * Regola comune: i pulsanti operano sul valore già validato e sono disabilitati
 * ai limiti; l'input manuale è **sempre** modificabile da tastiera e non viene
 * mai corretto silenziosamente — un valore vuoto/fuori range resta tale, marcato
 * `aria-invalid`, e viene intercettato dalla validazione esistente.
 */
function CompactStepper({
  label,
  value,
  ariaLabel,
  invalid,
  canDecrement,
  canIncrement,
  decrementLabel,
  incrementLabel,
  onDecrement,
  onIncrement,
  onInputChange,
}: {
  /** Etichetta visibile sopra il controllo; assente per gli stepper inline. */
  label?: ReactNode;
  value: string;
  ariaLabel: string;
  invalid: boolean;
  canDecrement: boolean;
  canIncrement: boolean;
  decrementLabel: string;
  incrementLabel: string;
  onDecrement: () => void;
  onIncrement: () => void;
  onInputChange: (raw: string) => void;
}) {
  return (
    <div className={label === undefined ? styles.stepperInline : styles.stepper}>
      {label !== undefined && <span className={styles.label}>{label}</span>}
      <div className={styles.control}>
        <button
          type="button"
          className={styles.button}
          aria-label={decrementLabel}
          disabled={!canDecrement}
          onClick={onDecrement}
        >
          −
        </button>
        <input
          type="text"
          inputMode="numeric"
          className={styles.input}
          value={value}
          aria-label={ariaLabel}
          aria-invalid={invalid}
          onChange={(e) => onInputChange(e.target.value)}
        />
        <button
          type="button"
          className={styles.button}
          aria-label={incrementLabel}
          disabled={!canIncrement}
          onClick={onIncrement}
        >
          +
        </button>
      </div>
    </div>
  );
}

/**
 * Quantità di domande del pool (aperte / chiuse singole / chiuse multiple). Il
 * valore resta una **stringa grezza** nello stato del dialog: `−`/`+` operano sul
 * valore parsato e delegano al genitore la nuova stringa, così l'invalidazione
 * della stima e della `requestId` non cambia.
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
  rawValue: string;
  /** Valore intero ≥ 0 se valido, altrimenti `null` (fail-closed). */
  parsedValue: number | null;
  onChange: (next: string) => void;
  /** `false` quando il totale ha raggiunto il massimo o la config non è valida. */
  canIncrement: boolean;
  decrementLabel: string;
  incrementLabel: string;
}) {
  const base = parsedValue ?? 0;
  return (
    <CompactStepper
      label={label}
      value={rawValue}
      ariaLabel={label}
      invalid={parsedValue === null}
      canDecrement={parsedValue !== null && parsedValue > 0}
      canIncrement={canIncrement}
      decrementLabel={decrementLabel}
      incrementLabel={incrementLabel}
      onDecrement={() => onChange(String(base - 1))}
      onIncrement={() => onChange(String(base + 1))}
      onInputChange={onChange}
    />
  );
}

/**
 * AIGEN-UI-02 — stepper **inline** per un intero vincolato a `[min, max]`
 * (difficoltà 1–5, caratteri massimi della risposta aperta). Usato nella riga
 * metadati della revisione bozza: nessuna etichetta visibile, solo `aria-label`
 * riferita alla domanda.
 *
 * Il testo digitato è tenuto localmente per non ostacolare la modifica manuale
 * (stati intermedi come stringa vuota); al genitore è propagato il numero
 * parsato — `NaN` se non parsabile — che la validazione esistente rifiuta
 * fail-closed. `−`/`+` restano dentro il range: mai un valore fuori limite.
 */
export function BoundedStepper({
  value,
  min,
  max,
  step = 1,
  ariaLabel,
  decrementLabel,
  incrementLabel,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  ariaLabel: string;
  decrementLabel: string;
  incrementLabel: string;
  onChange: (next: number) => void;
}) {
  const [raw, setRaw] = useState(() => String(value));
  const [propagated, setPropagated] = useState(value);

  // Riallinea il testo solo quando il valore cambia **dall'esterno** (non per un
  // giro di andata/ritorno di ciò che il docente sta digitando): così "0012" o
  // una stringa vuota restano come sono, senza riscritture silenziose.
  // `Object.is` perché il valore propagato può essere `NaN`.
  if (!Object.is(value, propagated)) {
    setPropagated(value);
    setRaw(String(value));
  }

  function push(next: number, text = String(next)) {
    setRaw(text);
    setPropagated(next);
    onChange(next);
  }

  const valid = Number.isInteger(value) && value >= min && value <= max;
  const clamp = (n: number) => Math.min(max, Math.max(min, n));

  return (
    <CompactStepper
      value={raw}
      ariaLabel={ariaLabel}
      invalid={!valid}
      canDecrement={valid && value > min}
      canIncrement={valid && value < max}
      decrementLabel={decrementLabel}
      incrementLabel={incrementLabel}
      onDecrement={() => push(clamp(value - step))}
      onIncrement={() => push(clamp(value + step))}
      // Nessuna correzione silenziosa: si propaga il valore digitato così com'è
      // (NaN se non numerico) e la validazione esistente decide.
      onInputChange={(text) => push(Number.parseInt(text, 10), text)}
    />
  );
}
