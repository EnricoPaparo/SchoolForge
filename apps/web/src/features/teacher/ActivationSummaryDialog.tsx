import { useRef } from 'react';
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
  busy: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
};

export function ActivationSummaryDialog({
  summary,
  questionCount,
  busy,
  error,
  onConfirm,
  onCancel,
}: ActivationSummaryDialogProps) {
  /*
   * Guardia **sincrona** contro il doppio click: lo stato `busy` arriva al
   * prossimo render, cioè troppo tardi per il secondo click di un doppio click
   * reale. Attivare due volte non produrrebbe due verifiche (G17 blocca la
   * seconda), ma produrrebbe un secondo errore inspiegabile a schermo.
   */
  const confirmingRef = useRef(false);
  const blocked = (summary?.blockers.length ?? 0) > 0;

  function handleConfirm() {
    if (confirmingRef.current || busy || blocked) return;
    confirmingRef.current = true;
    try {
      onConfirm();
    } finally {
      confirmingRef.current = false;
    }
  }

  return (
    <DialogShell
      title="Conferma attivazione"
      onCancel={onCancel}
      busy={busy}
      variant={summary ? 'wide-scroll' : 'default'}
      role="alertdialog"
    >
      <p className={styles.intro}>
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
          disabled={busy || blocked}
          onClick={handleConfirm}
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
