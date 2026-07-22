import { useEffect, useRef, useState } from 'react';
import type { Firestore } from 'firebase/firestore';
import type { VerificationDoc } from '../../types/firestore.js';
import {
  describeBatchReturnVisibilityExclusion,
  loadBatchReturnVisibilityEligibility,
  runBatchReturnVisibilityAction,
  type BatchReturnVisibilityAction,
  type BatchReturnVisibilityEligibility,
  type BatchReturnVisibilityResult,
} from '../repository/corrections/batchReturnVisibility.js';
import type { BatchSelectedRow } from '../repository/corrections/batchCorrectionActions.js';
import { DialogShell } from './workspaceDialogs.js';

type Phase = 'loading' | 'confirm' | 'running' | 'result';

const META: Record<
  BatchReturnVisibilityAction,
  { name: string; question: string; consequence: string; confirmLabel: string }
> = {
  show_return: {
    name: 'Rendi visibili',
    question: 'Rendere visibili le restituzioni selezionate agli studenti?',
    consequence: 'Le restituzioni diventeranno consultabili dagli studenti.',
    confirmLabel: 'Rendi visibili',
  },
  hide_return: {
    name: 'Nascondi allo studente',
    question: 'Nascondere le restituzioni selezionate agli studenti?',
    consequence: 'Le restituzioni non saranno consultabili finché non verranno rese visibili.',
    confirmLabel: 'Nascondi allo studente',
  },
  show_solutions: {
    name: 'Mostra soluzioni',
    question: 'Mostrare le soluzioni nelle restituzioni selezionate?',
    consequence: 'Verranno aggiunte soltanto le soluzioni delle domande assegnate.',
    confirmLabel: 'Mostra soluzioni',
  },
  hide_solutions: {
    name: 'Nascondi soluzioni',
    question: 'Nascondere le soluzioni nelle restituzioni selezionate?',
    consequence: 'Le soluzioni verranno rimosse fisicamente dalle restituzioni.',
    confirmLabel: 'Nascondi soluzioni',
  },
};

export function BatchReturnVisibilityDialog({
  action,
  rows,
  ownerUid,
  verificationId,
  verification,
  db,
  onClose,
}: {
  action: BatchReturnVisibilityAction;
  rows: BatchSelectedRow[];
  ownerUid: string;
  verificationId: string;
  verification: VerificationDoc;
  db: Firestore;
  onClose: () => void;
}) {
  const meta = META[action];
  const [phase, setPhase] = useState<Phase>('loading');
  const [eligibility, setEligibility] = useState<BatchReturnVisibilityEligibility | null>(null);
  const [results, setResults] = useState<BatchReturnVisibilityResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const startedRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    void loadBatchReturnVisibilityEligibility({ rows, ownerUid, verificationId, verification, db })
      .then((value) => {
        if (!mountedRef.current) return;
        setEligibility(value);
        setPhase('confirm');
      })
      .catch(() => {
        if (!mountedRef.current) return;
        setError('Impossibile verificare le restituzioni selezionate. Riprova.');
        setPhase('result');
      });
    return () => {
      mountedRef.current = false;
    };
  }, [rows, ownerUid, verificationId, verification, db]);

  async function confirm() {
    if (startedRef.current || !eligibility || eligibility.eligible.length === 0) return;
    startedRef.current = true;
    setPhase('running');
    try {
      const value = await runBatchReturnVisibilityAction({
        action,
        rows: eligibility.eligible,
        db,
        verificationId,
        verification,
      });
      if (!mountedRef.current) return;
      setResults(value);
      setPhase('result');
    } catch {
      if (!mountedRef.current) return;
      setError('Impossibile completare l\u2019operazione. Riprova.');
      setPhase('result');
    }
  }

  const busy = phase === 'running';
  const succeeded = results?.filter((result) => result.outcome === 'succeeded') ?? [];
  const noops = results?.filter((result) => result.outcome === 'noop') ?? [];
  const failed = results?.filter((result) => result.outcome === 'failed') ?? [];

  return (
    <DialogShell title={meta.name} onCancel={onClose} busy={busy}>
      {phase === 'loading' && (
        <p aria-busy="true" className="state-loading">
          Verifica consegne…
        </p>
      )}

      {phase === 'confirm' && eligibility && (
        <>
          <p>{meta.question}</p>
          <ul>
            <li>Consegne selezionate: {rows.length}</li>
            <li>Elaborabili: {eligibility.eligible.length}</li>
            <li>Escluse: {eligibility.excluded.length}</li>
          </ul>
          <p>{meta.consequence}</p>
          {eligibility.excluded.length > 0 && (
            <details>
              <summary>Consegne escluse ({eligibility.excluded.length})</summary>
              <ul>
                {eligibility.excluded.map((entry) => (
                  <li key={entry.studentUid}>
                    {entry.studentName} — {describeBatchReturnVisibilityExclusion(entry.reason)}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {eligibility.eligible.length === 0 && (
            <p role="alert" className="text-error">
              Nessuna restituzione selezionata è elaborabile per questa azione.
            </p>
          )}
          <div className="dialog-actions">
            <button type="button" onClick={onClose}>
              Annulla
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={eligibility.eligible.length === 0}
              onClick={() => void confirm()}
            >
              {meta.confirmLabel}
            </button>
          </div>
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
                <li>Già nello stato richiesto: {noops.length}</li>
                <li>Escluse: {eligibility?.excluded.length ?? 0}</li>
                <li>Fallite: {failed.length}</li>
              </ul>
              {failed.length > 0 && (
                <details open>
                  <summary>Consegne non riuscite ({failed.length})</summary>
                  <ul>
                    {failed.map((result) => (
                      <li key={result.studentUid}>
                        {rows.find((row) => row.studentUid === result.studentUid)?.studentName ??
                          'Consegna selezionata'}{' '}
                        — {result.error}
                      </li>
                    ))}
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
