import { useRef, useState } from 'react';
import type { Firestore } from 'firebase/firestore';
import type { VerificationDoc } from '../../types/firestore.js';
import { DialogShell } from './workspaceDialogs.js';
import {
  computeEligibility,
  describeBatchExclusion,
  runBatchCorrectionAction,
  type BatchAction,
  type BatchRowResult,
  type BatchSelectedRow,
} from '../repository/corrections/batchCorrectionActions.js';

/**
 * M5-04 — dialog di conferma per le azioni massive
 * Completa/Riapri/Restituisci/Azzera.
 *
 * Calcola un riepilogo preliminare di eleggibilità (funzioni pure su dati già
 * letti), mostra la conseguenza dell'azione, e alla conferma invoca il service
 * M4 **una volta per consegna eleggibile** con concorrenza limitata. Un errore
 * su una consegna non blocca le altre; i risultati sono per-riga. Riuso di
 * `DialogShell` (focus trap/Escape/focus restore/busy); guardia anti doppio-invio.
 * Se non ci sono righe eleggibili, **nessun** service viene invocato.
 */

type Phase = 'confirm' | 'running' | 'result';

const META: Record<
  BatchAction,
  {
    title: string;
    confirmLabel: (n: number) => string;
    consequence: string;
    zeroEligible: string;
    destructive?: boolean;
  }
> = {
  complete: {
    title: 'Completa correzioni',
    confirmLabel: (n) => `Completa ${n} correzioni`,
    consequence:
      'Le consegne selezionate passeranno a «Corretta». I punteggi non vengono modificati.',
    zeroEligible: 'Nessuna consegna selezionata è eleggibile per questa azione.',
  },
  reopen: {
    title: 'Riapri correzioni',
    confirmLabel: (n) => `Riapri ${n} correzioni`,
    consequence:
      'Le consegne torneranno «In correzione». Una correzione già restituita sarà temporaneamente nascosta allo studente finché non verrà restituita di nuovo.',
    zeroEligible: 'Nessuna consegna selezionata è eleggibile per questa azione.',
  },
  return: {
    title: 'Restituisci correzioni',
    confirmLabel: (n) => `Restituisci ${n} correzioni`,
    consequence:
      'Le consegne e le relative soluzioni diventeranno immediatamente visibili allo studente.',
    zeroEligible: 'Nessuna consegna selezionata è eleggibile per questa azione.',
  },
  clear: {
    title: 'Azzera correzioni',
    confirmLabel: (n) => `Azzera ${n} correzioni`,
    consequence:
      'Verranno rimossi punteggi, correzioni delle singole domande e feedback generale. Le consegne e le risposte degli studenti non verranno modificate.',
    zeroEligible: 'Nessuna correzione selezionata può essere azzerata.',
    destructive: true,
  },
};

export function BatchCorrectionActionsDialog({
  action,
  rows,
  db,
  verificationId,
  verification,
  onClose,
  onApplied,
}: {
  action: BatchAction;
  rows: BatchSelectedRow[];
  db: Firestore;
  verificationId?: string;
  verification?: VerificationDoc;
  onClose: () => void;
  /**
   * Notifica il risultato server-confirmed. Gli identificatori permettono al
   * chiamante di aggiornare proiezioni locali senza riletture aggiuntive; la
   * selezione resta persistente e cambia solo manualmente dal docente.
   */
  onApplied: (action: BatchAction, results: BatchRowResult[]) => void;
}) {
  const meta = META[action];
  // Congela il preflight all'apertura del dialog. Dopo un batch riuscito il
  // refresh del chiamante cambia intenzionalmente lo stato delle righe (per
  // esempio in_progress → completed): ricalcolare qui l'eleggibilità farebbe
  // ricontare la stessa consegna sia tra le riuscite sia tra le escluse.
  const [eligibility] = useState(() => computeEligibility(action, rows, verification));
  const [phase, setPhase] = useState<Phase>('confirm');
  const [results, setResults] = useState<BatchRowResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const startedRef = useRef(false);

  async function confirm() {
    if (startedRef.current) return; // anti doppio-click / doppia invocazione
    if (eligibility.eligible.length === 0) return; // nessun service se zero eleggibili
    startedRef.current = true;
    setPhase('running');
    try {
      const res = await runBatchCorrectionAction(
        action,
        eligibility.eligible,
        db,
        verificationId && verification ? { verificationId, verification } : undefined,
      );
      setResults(res);
      setPhase('result');
      onApplied(action, res);
    } catch (err) {
      // runBatchCorrectionAction non rilancia per-riga; un throw qui è
      // eccezionale (es. errore interno). Consenti un nuovo tentativo.
      setError(err instanceof Error ? err.message : 'Operazione non riuscita.');
      setPhase('result');
      startedRef.current = false;
    }
  }

  const busy = phase === 'running';
  const succeeded = results?.filter((r) => r.outcome === 'succeeded') ?? [];
  const failed = results?.filter((r) => r.outcome === 'failed') ?? [];

  return (
    <DialogShell title={meta.title} onCancel={onClose} busy={busy}>
      {phase === 'confirm' && (
        <>
          <ul>
            <li>Consegne selezionate: {rows.length}</li>
            <li>Eleggibili: {eligibility.eligible.length}</li>
            <li>Escluse: {eligibility.excluded.length}</li>
          </ul>
          <p>{meta.consequence}</p>
          {eligibility.excluded.length > 0 && (
            <details>
              <summary>Consegne escluse ({eligibility.excluded.length})</summary>
              <ul>
                {eligibility.excluded.map((e) => (
                  <li key={e.studentUid}>
                    {e.studentName} — {describeBatchExclusion(e.reason)}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {eligibility.eligible.length === 0 ? (
            <>
              <p role="alert" className="text-error">
                {meta.zeroEligible}
              </p>
              <div className="dialog-actions">
                <button type="button" onClick={onClose}>
                  Chiudi
                </button>
              </div>
            </>
          ) : (
            <div className="dialog-actions">
              <button type="button" onClick={onClose}>
                Annulla
              </button>
              <button
                type="button"
                className={meta.destructive ? 'btn-danger' : 'btn-primary'}
                onClick={() => void confirm()}
              >
                {meta.confirmLabel(eligibility.eligible.length)}
              </button>
            </div>
          )}
        </>
      )}

      {phase === 'running' && (
        <p aria-busy="true" className="state-loading">
          Operazione in corso…
        </p>
      )}

      {phase === 'result' && (
        <>
          {error ? (
            <p role="alert" className="text-error">
              {error}
            </p>
          ) : (
            <>
              <p role="status">Operazione completata.</p>
              <ul>
                <li>Riuscite: {succeeded.length}</li>
                <li>Escluse: {eligibility.excluded.length}</li>
                <li>Fallite: {failed.length}</li>
              </ul>
              {failed.length > 0 && (
                <details open>
                  <summary>Consegne non riuscite ({failed.length})</summary>
                  <ul>
                    {failed.map((r) => {
                      const name =
                        rows.find((row) => row.studentUid === r.studentUid)?.studentName ??
                        r.studentUid;
                      return (
                        <li key={r.studentUid}>
                          {name} — {r.error ?? 'Operazione non riuscita.'}
                        </li>
                      );
                    })}
                  </ul>
                </details>
              )}
            </>
          )}
          <div className="dialog-actions">
            <button type="button" className="btn-primary" onClick={onClose}>
              Chiudi
            </button>
          </div>
        </>
      )}
    </DialogShell>
  );
}
