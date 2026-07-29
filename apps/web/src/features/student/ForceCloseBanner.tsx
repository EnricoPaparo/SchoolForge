import { useEffect, useState } from 'react';
import styles from './ForceCloseBanner.module.css';
import { formatRemaining, isUrgent, remainingSeconds } from './forceCloseWatch.js';

/**
 * FORCE-SUBMIT-02 — banner fisso mostrato allo studente quando il docente
 * programma la chiusura della sua verifica.
 *
 * Non è chiudibile: comunica un fatto, non una preferenza. Fino alla scadenza
 * lo studente continua a compilare, può salvare e può consegnare normalmente.
 */

export interface ForceCloseBannerProps {
  /** Scadenza server-side, in millisecondi epoch. */
  deadlineMs: number;
  /** Etichetta dell'ultimo salvataggio riuscito (`HH:mm`), o `null`. */
  lastSavedLabel: string | null;
  /** Un salvataggio è in corso. */
  saving: boolean;
  onSaveNow: () => void;
  /** Orologio iniettabile: i test non dipendono dal tempo reale. */
  nowMs?: () => number;
}

export function ForceCloseBanner({
  deadlineMs,
  lastSavedLabel,
  saving,
  onSaveNow,
  nowMs = () => Date.now(),
}: ForceCloseBannerProps) {
  const [remaining, setRemaining] = useState(() => remainingSeconds(deadlineMs, nowMs()));

  /*
   * Il countdown è **ricalcolato** dalla deadline a ogni tick, mai decrementato:
   * dopo una scheda sospesa o un tick perso mostrerebbe più tempo di quello che
   * resta davvero — e quel tempo è una promessa fatta allo studente.
   */
  useEffect(() => {
    setRemaining(remainingSeconds(deadlineMs, nowMs()));
    const id = setInterval(() => {
      setRemaining(remainingSeconds(deadlineMs, nowMs()));
    }, 1000);
    return () => clearInterval(id);
  }, [deadlineMs, nowMs]);

  const expired = remaining <= 0;

  return (
    <>
      {/*
       * `role="alert"` annuncia il banner **una volta**, alla comparsa. Il
       * countdown vive in un elemento `aria-hidden`: annunciarlo ogni secondo
       * renderebbe la pagina inutilizzabile con uno screen reader.
       */}
      <div className={styles.banner} role="alert">
        <div className={styles.texts}>
          <p className={styles.title}>Chiusura richiesta dal docente</p>
          <p className={styles.deadline}>
            {expired ? (
              'Chiusura in corso…'
            ) : (
              <>
                Salva il lavoro entro{' '}
                <span
                  className={`${styles.countdown} ${isUrgent(remaining) ? styles.countdownUrgent : ''}`}
                  aria-hidden="true"
                >
                  {formatRemaining(remaining)}
                </span>
              </>
            )}
          </p>
          <p className={styles.lastSaved}>
            {lastSavedLabel ? `Ultimo salvataggio: ${lastSavedLabel}` : 'Nessun salvataggio ancora'}
          </p>
        </div>
        <button
          type="button"
          className={`btn-primary ${styles.saveBtn}`}
          disabled={saving || expired}
          onClick={onSaveNow}
        >
          {saving ? 'Salvataggio…' : 'Salva ora'}
        </button>
      </div>
      {/* Spazio equivalente nel flusso: il banner non copre mai il contenuto. */}
      <div className={styles.spacer} aria-hidden="true" />
    </>
  );
}
