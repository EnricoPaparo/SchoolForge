import { useEffect, useId, useRef, useState } from 'react';
import type { VexBuilderQuestion } from './VexBuilder.js';
import styles from './VexBuilder.module.css';

/**
 * VEX-02C — selettore **leggibile** e accessibile per aggiungere una domanda a
 * un gruppo equivalente. Sostituisce l'etichetta criptica (`q1 · tipo · diff`)
 * con due righe: metadati (`#id · Tipo · Diff. N · UDA x`) e **preview reale**
 * del testo (`questionPreview` già caricato nel questionIndex, mai persistita).
 *
 * Listbox accessibile senza dipendenze: tastiera (frecce/Home/End), selezione
 * con Enter/Space, chiusura con Escape (focus al trigger) e click esterno,
 * `aria-activedescendant`, nome accessibile per gruppo. Nessuna nuova lettura.
 */

export interface VexQuestionSelectProps {
  /** Nome accessibile (per gruppo), es. «Aggiungi alternativa al gruppo 1». */
  label: string;
  options: VexBuilderQuestion[];
  onSelect: (entryId: string) => void;
  disabled?: boolean;
}

function tipoHuman(tipo: VexBuilderQuestion['tipo']): string {
  return tipo === 'aperta'
    ? 'Aperta'
    : tipo === 'chiusa_singola'
      ? 'Scelta singola'
      : 'Scelta multipla';
}

/** Preview leggibile: testo reale se presente, altrimenti l'ID come fallback. */
function optionPreview(q: VexBuilderQuestion): string {
  const p = q.questionPreview?.trim();
  return p && p.length > 0 ? p : q.questionLocalId;
}

function optionMeta(q: VexBuilderQuestion): string {
  return `#${q.questionLocalId} · ${tipoHuman(q.tipo)} · Diff. ${q.difficolta} · UDA ${q.udaDir}`;
}

export function VexQuestionSelect({ label, options, onSelect, disabled }: VexQuestionSelectProps) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const baseId = useId();
  const listId = `${baseId}-list`;

  const isDisabled = disabled || options.length === 0;

  // Chiusura su click esterno.
  useEffect(() => {
    if (!open) return;
    function onDocPointer(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocPointer);
    return () => document.removeEventListener('mousedown', onDocPointer);
  }, [open]);

  // Porta il focus nella lista all'apertura; mantiene l'indice attivo in range.
  useEffect(() => {
    if (open) {
      setActiveIndex((i) => Math.min(Math.max(i, 0), Math.max(options.length - 1, 0)));
      listRef.current?.focus();
    }
  }, [open, options.length]);

  function close(focusTrigger = true) {
    setOpen(false);
    if (focusTrigger) triggerRef.current?.focus();
  }

  function choose(index: number) {
    const opt = options[index];
    if (!opt) return;
    onSelect(opt.questionIndexEntryId);
    close();
  }

  function onListKeyDown(e: React.KeyboardEvent<HTMLUListElement>) {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, options.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
        break;
      case 'Home':
        e.preventDefault();
        setActiveIndex(0);
        break;
      case 'End':
        e.preventDefault();
        setActiveIndex(options.length - 1);
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        choose(activeIndex);
        break;
      case 'Escape':
        e.preventDefault();
        close();
        break;
      case 'Tab':
        setOpen(false); // consenti la naturale uscita del focus
        break;
    }
  }

  return (
    <div className={styles.select} ref={rootRef}>
      <button
        type="button"
        ref={triggerRef}
        className={styles.selectTrigger}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        disabled={isDisabled}
        onClick={() => setOpen((o) => !o)}
      >
        {options.length === 0 ? 'Nessuna domanda disponibile' : '+ Aggiungi alternativa…'}
      </button>

      {open && options.length > 0 && (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label={label}
          tabIndex={-1}
          className={styles.selectList}
          aria-activedescendant={`${listId}-opt-${activeIndex}`}
          onKeyDown={onListKeyDown}
        >
          {options.map((opt, index) => {
            const preview = optionPreview(opt);
            const meta = optionMeta(opt);
            return (
              <li
                key={opt.questionIndexEntryId}
                id={`${listId}-opt-${index}`}
                role="option"
                aria-selected={index === activeIndex}
                className={`${styles.selectOption} ${index === activeIndex ? styles.selectOptionActive : ''}`}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => choose(index)}
              >
                <span className={styles.selectOptionMeta}>{meta}</span>
                <span className={styles.selectOptionPreview} title={preview}>
                  {preview}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
