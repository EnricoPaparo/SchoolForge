import { useEffect, useRef } from 'react';
import type { ChangeEvent, KeyboardEvent } from 'react';
import styles from './ImportZipModal.module.css';

export type ImportZipResult = {
  udaCount: number;
  lessonCount: number;
  questionCount: number;
};

type Props = {
  programTitle: string;
  hasActiveImport: boolean;
  file: File | null;
  importing: boolean;
  error: string | null;
  result: ImportZipResult | null;
  onFileChange: (file: File | null) => void;
  onImport: () => void;
  onClose: () => void;
};

function focusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((el) => !el.hasAttribute('disabled'));
}

export function ImportZipModal({
  programTitle,
  hasActiveImport,
  file,
  importing,
  error,
  result,
  onFileChange,
  onImport,
  onClose,
}: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const focusables = focusableElements(dialog);
    (focusables[0] ?? dialog).focus();
  }, []);

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape') {
      onClose();
      return;
    }
    if (e.key !== 'Tab') return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const focusables = focusableElements(dialog);
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  function handleFileInputChange(e: ChangeEvent<HTMLInputElement>) {
    onFileChange(e.target.files?.[0] ?? null);
  }

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div
        ref={dialogRef}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-zip-dialog-title"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className={styles.header}>
          <h2 id="import-zip-dialog-title" className={styles.title}>
            Importa ZIP — {programTitle}
          </h2>
          <button type="button" className={styles.closeBtn} aria-label="Chiudi" onClick={onClose}>
            ✕
          </button>
        </div>

        <p className={styles.help}>
          Lo ZIP deve contenere cartelle <code>uda-NN-slug/</code>, ciascuna con un file UDA (front
          matter + contenuto) e una o più lezioni <code>lezione-NNN-slug.md</code>. Per ogni lezione
          è possibile allegare un pool domande opzionale <code>lezione-NNN-slug.pool.md</code>. Un
          file <code>programma.md</code> nella radice dello ZIP è opzionale: se presente, i suoi
          metadati (anno scolastico, docente, materia, classe) compaiono nel pannello info del
          corso.
        </p>

        <p className={styles.replaceNotice}>
          {hasActiveImport
            ? 'Questo import sostituirà il contenuto attivo del corso. Le verifiche future useranno il nuovo contenuto.'
            : "Un nuovo import sostituisce sempre l'eventuale import attivo del corso: non viene fatto accodamento o merge automatico. Un Corso corrisponde a un programma — per gestire due programmi diversi crea due Corsi separati."}
        </p>

        <div className={styles.fileRow}>
          <label htmlFor="import-zip-input">File ZIP</label>
          <input
            id="import-zip-input"
            type="file"
            accept=".zip"
            disabled={importing}
            onChange={handleFileInputChange}
          />
        </div>

        {error && (
          <p role="alert" className="text-error">
            {error}
          </p>
        )}

        {result && (
          <p className={styles.success} aria-live="polite">
            Import completato: {result.udaCount} UDA, {result.lessonCount} lezioni,{' '}
            {result.questionCount} domande.
          </p>
        )}

        <div className={styles.actions}>
          <button type="button" onClick={onClose}>
            {result ? 'Chiudi' : 'Annulla'}
          </button>
          <button type="button" onClick={onImport} disabled={importing || !file}>
            {importing ? 'Importazione…' : 'Importa ZIP'}
          </button>
        </div>
      </div>
    </div>
  );
}
