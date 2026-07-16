import { useRef, useState } from 'react';
import type { Firestore } from 'firebase/firestore';
import { DialogShell } from './workspaceDialogs.js';
import { clearCorrection } from '../repository/corrections/correctionsService.js';

/**
 * M5-04C — dialog di conferma «Azzera correzione».
 *
 * Riporta una correzione `in_progress` allo stato non valutato: rimuove punteggi
 * e feedback (per domanda e generale) **senza** toccare la consegna dello
 * studente. Riuso di `DialogShell` (focus trap/Escape/focus restore/busy);
 * pulsanti spaziati da `dialog-actions`; conferma distruttiva (rosso); guardia
 * anti doppio-click; feedback persistente di successo/errore.
 */

type Phase = 'confirm' | 'running' | 'done' | 'error';

export function ClearCorrectionDialog({
  submissionId,
  studentName,
  db,
  onClose,
  onCleared,
}: {
  submissionId: string;
  studentName: string;
  db: Firestore;
  onClose: () => void;
  onCleared: () => void;
}) {
  const [phase, setPhase] = useState<Phase>('confirm');
  const [error, setError] = useState<string | null>(null);
  const startedRef = useRef(false);

  async function confirm() {
    if (startedRef.current) return; // anti doppio-click
    startedRef.current = true;
    setPhase('running');
    try {
      await clearCorrection(submissionId, db);
      setPhase('done');
      onCleared();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossibile azzerare la correzione. Riprova.');
      setPhase('error');
      startedRef.current = false; // consenti un nuovo tentativo
    }
  }

  const busy = phase === 'running';

  return (
    <DialogShell title="Azzera correzione" onCancel={onClose} busy={busy}>
      {(phase === 'confirm' || phase === 'running') && (
        <>
          <p>
            Verranno rimossi <strong>tutti i punteggi e i feedback</strong> della correzione di{' '}
            <strong>{studentName}</strong> (per domanda e generale). La consegna dello studente e le
            sue risposte <strong>non</strong> vengono toccate. La correzione resta «In corso» e
            potrà essere rifatta, anche con «Correggi con IA».
          </p>
          <div className="dialog-actions">
            <button type="button" onClick={onClose} disabled={busy}>
              Annulla
            </button>
            <button
              type="button"
              className="btn-danger"
              disabled={busy}
              onClick={() => void confirm()}
            >
              {busy ? 'Azzeramento…' : 'Azzera correzione'}
            </button>
          </div>
        </>
      )}

      {phase === 'error' && (
        <>
          <p role="alert" className="text-error">
            {error}
          </p>
          <div className="dialog-actions">
            <button type="button" onClick={onClose}>
              Chiudi
            </button>
            <button type="button" className="btn-danger" onClick={() => void confirm()}>
              Riprova
            </button>
          </div>
        </>
      )}

      {phase === 'done' && (
        <>
          <p role="status">Correzione azzerata. Ora puoi rifarla, anche con «Correggi con IA».</p>
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
