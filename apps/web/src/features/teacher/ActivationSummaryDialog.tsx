import { useEffect, useRef } from 'react';
import { DialogShell } from '../../components/DialogShell.js';
import type { ActivationSummary } from '../repository/verifications/activationSummary.js';
import styles from './ActivationSummaryDialog.module.css';

/**
 * VDIF-04 — conferma di attivazione, con il riepilogo owner-only di ciò che
 * verrà congelato.
 *
 * Il riepilogo è **derivato puro** dal preflight già eseguito: non legge nulla,
 * non scrive nulla, non viene persistito in alcuna proiezione e non cambia
 * mentre il dialog è aperto — è una fotografia degli stessi dati che
 * l'attivazione congelerà, non una seconda interrogazione che potrebbe
 * raccontare una storia diversa.
 *
 * Mostra i **nomi che il docente ha scelto**, congelati al momento
 * dell'attivazione, e nessun esempio diagnostico: qui non compare mai un nome
 * che SchoolForge non abbia ricevuto dal docente.
 */

export type ActivationSummaryDialogProps = {
  /** `null` su una verifica senza varianti: resta la sola conferma. */
  summary: ActivationSummary | null;
  /** Numero di domande della verifica base, mostrato anche senza varianti. */
  questionCount: number;
  /**
   * Contratto esplicito del chiamante: `true` **solo** quando esiste un piano di
   * attivazione valido, senza errore di preflight. Il dialog non può dedurlo:
   * `summary === null` è legittimo su una verifica senza varianti, e non
   * distingue «nessuna differenziazione» da «il preflight è fallito».
   *
   * Senza questo contratto il pulsante resterebbe abilitato dopo un errore di
   * preflight e non farebbe nulla al click — un pulsante che sembra funzionare
   * ed è inerte è peggio di un pulsante disabilitato.
   */
  canConfirm: boolean;
  busy: boolean;
  error: string | null;
  /**
   * Deve restituire la Promise dell'attivazione: la guardia anti doppio click
   * la attende, e senza di essa non avrebbe nulla da attendere.
   */
  onConfirm: () => Promise<void>;
  onCancel: () => void;
};

export function ActivationSummaryDialog({
  summary,
  questionCount,
  canConfirm,
  busy,
  error,
  onConfirm,
  onCancel,
}: ActivationSummaryDialogProps) {
  /*
   * Guardia **sincrona all'ingresso, asincrona in uscita**: si alza prima di
   * chiamare e si abbassa solo quando l'attivazione è davvero finita.
   *
   * Lo stato `busy` non basta: arriva al render successivo, cioè troppo tardi
   * per il secondo click di un doppio click reale. Rilasciare la guardia
   * subito dopo la chiamata non basta a sua volta, perché l'attivazione è
   * asincrona e la seconda invocazione partirebbe mentre la prima è ancora in
   * volo. Attivare due volte non produrrebbe due verifiche (G17 blocca la
   * seconda) ma produrrebbe un secondo errore inspiegabile a schermo.
   */
  const confirmingRef = useRef(false);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  /**
   * Focus iniziale sull'introduzione invece che sul primo pulsante: su uno
   * schermo stretto il focus sul footer farebbe aprire il dialog già scorso
   * fino in fondo. `tabIndex={-1}` lo rende focalizzabile a programma **senza**
   * inserirlo nell'ordine di Tab.
   */
  const introRef = useRef<HTMLParagraphElement>(null);

  const blocked = (summary?.blockers.length ?? 0) > 0;
  const confirmDisabled = !canConfirm || busy || blocked;

  async function handleConfirm() {
    if (confirmingRef.current || confirmDisabled) return;
    confirmingRef.current = true;
    try {
      await onConfirm();
    } catch {
      /*
       * Il chiamante possiede la segnalazione dell'errore (prop `error`): qui
       * interessa solo che un rifiuto non lasci il dialog bloccato per sempre.
       * Rilanciare produrrebbe una unhandled rejection senza dire nulla di più
       * a nessuno.
       */
    } finally {
      // Dopo lo smontaggio non c'è più nulla da liberare, e nulla da
      // aggiornare: l'attivazione riuscita chiude il dialog.
      if (mountedRef.current) confirmingRef.current = false;
    }
  }

  return (
    <DialogShell
      title="Conferma attivazione"
      onCancel={onCancel}
      busy={busy}
      variant={summary ? 'wide-scroll' : 'default'}
      role="alertdialog"
      initialFocusRef={introRef}
    >
      <p className={styles.intro} ref={introRef} tabIndex={-1}>
        Dopo l&apos;attivazione la configurazione non sarà più modificabile.
        {summary ? ' Le etichette sono congelate con il nome attuale.' : ''}
      </p>

      {summary ? (
        <>
          <dl className={styles.metrics} aria-label="Riepilogo della differenziazione">
            <Metric label="Verifica base" value={summary.baseStudents} unit="studenti" />
            <Metric
              label="Percorso differenziato"
              value={summary.differentiatedStudents}
              unit="studenti"
            />
            <Metric label="Senza etichetta" value={summary.unlabelledStudents} unit="studenti" />
            <Metric label="Etichette coinvolte" value={summary.labelCount} unit="" />
            <Metric label="Sostituzioni" value={summary.substitutions} unit="" />
            <Metric label="Omissioni" value={summary.omissions} unit="" />
          </dl>

          <div className={styles.rows} role="list" aria-label="Domande per percorso">
            {summary.rows.map((row) => (
              <div
                key={row.labelId ?? '__base__'}
                role="listitem"
                className={`${styles.row} ${row.blocker ? styles.rowBlocked : ''}`}
              >
                <span className={styles.rowName}>{row.labelName}</span>
                <span className={styles.rowCounts}>
                  <span className={styles.rowCount}>
                    {row.questionCount} {row.questionCount === 1 ? 'domanda' : 'domande'}
                  </span>
                  <span className={styles.rowPoints}>{row.maxPoints} punti</span>
                  <span className={styles.rowStudents}>
                    {row.studentCount} {row.studentCount === 1 ? 'studente' : 'studenti'}
                  </span>
                </span>
                {row.blocker ? (
                  <p className={styles.rowBlocker} role="alert">
                    {row.blocker}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        </>
      ) : (
        <p className={styles.intro}>
          {questionCount} {questionCount === 1 ? 'domanda' : 'domande'} verranno congelate.
        </p>
      )}

      {error ? (
        <p role="alert" className="text-error">
          {error}
        </p>
      ) : null}

      {/*
       * Nessun separatore orizzontale sopra il footer: la spaziatura di
       * `DialogShell` basta a distinguerlo, e una riga in più su un dialog che
       * scorre sembra la fine del contenuto quando non lo è.
       */}
      <div className={styles.footer}>
        <button
          type="button"
          className="btn-success"
          disabled={confirmDisabled}
          onClick={() => void handleConfirm()}
          aria-describedby={blocked ? 'activation-blocked-reason' : undefined}
        >
          {busy ? 'Attivazione…' : 'Conferma attivazione'}
        </button>
        <button type="button" onClick={onCancel} disabled={busy}>
          Annulla
        </button>
      </div>
      {blocked ? (
        <p id="activation-blocked-reason" className={styles.blockedReason}>
          Correggi le varianti indicate in rosso prima di attivare.
        </p>
      ) : null}
    </DialogShell>
  );
}

function Metric({ label, value, unit }: { label: string; value: number; unit: string }) {
  return (
    <div className={styles.metric}>
      <dt className={styles.metricLabel}>{label}</dt>
      <dd className={styles.metricValue}>
        {value}
        {unit ? <span className={styles.metricUnit}>{unit}</span> : null}
      </dd>
    </div>
  );
}
