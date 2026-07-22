import { useEffect, useRef, useState } from 'react';
import { PdfModuleLoadError } from '../../lib/pdfModuleLoader.js';
import {
  describeCorrectionArchiveExclusion,
  type CorrectionArchiveEligibility,
  type CorrectionArchiveExportResult,
} from '../repository/corrections/correctionArchiveExport.js';
import { DialogShell } from './workspaceDialogs.js';

type Phase = 'confirm' | 'running' | 'result';

export function CorrectionArchiveExportDialog({
  selectedCount,
  eligibility,
  run,
  onClose,
  onReload,
}: {
  selectedCount: number;
  eligibility: CorrectionArchiveEligibility;
  run: () => Promise<CorrectionArchiveExportResult>;
  onClose: () => void;
  onReload: () => void;
}) {
  const [phase, setPhase] = useState<Phase>('confirm');
  const [result, setResult] = useState<CorrectionArchiveExportResult | null>(null);
  const [error, setError] = useState<'stale_chunk' | 'generic' | null>(null);
  const startedRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

  function close(): void {
    mountedRef.current = false;
    onClose();
  }

  async function confirm(): Promise<void> {
    if (startedRef.current || eligibility.eligible.length === 0) return;
    startedRef.current = true;
    setPhase('running');
    try {
      const value = await run();
      if (!mountedRef.current) return;
      setResult(value);
      setPhase('result');
    } catch (cause) {
      if (!mountedRef.current) return;
      setError(
        cause instanceof PdfModuleLoadError && cause.category === 'stale_chunk'
          ? 'stale_chunk'
          : 'generic',
      );
      setPhase('result');
    }
  }

  return (
    <DialogShell title="PDF correzioni" onCancel={close} busy={phase === 'running'}>
      {phase === 'confirm' && (
        <>
          <ul>
            <li>Consegne selezionate: {selectedCount}</li>
            <li>Esportabili: {eligibility.eligible.length}</li>
            <li>Escluse: {eligibility.excluded.length}</li>
          </ul>
          {eligibility.eligible.length > 1 && (
            <p>Verrà creato uno ZIP con {eligibility.eligible.length} PDF separati.</p>
          )}
          {eligibility.excluded.length > 0 && (
            <details>
              <summary>Consegne escluse ({eligibility.excluded.length})</summary>
              <ul>
                {eligibility.excluded.map((entry, index) => (
                  <li key={`${entry.studentName}-${index}`}>
                    {entry.studentName} — {describeCorrectionArchiveExclusion(entry.reason)}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {eligibility.eligible.length === 0 && (
            <p role="alert" className="text-error">
              Nessuna correzione selezionata è esportabile.
            </p>
          )}
          <div className="dialog-actions">
            <button type="button" onClick={close}>
              Annulla
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={eligibility.eligible.length === 0}
              onClick={() => void confirm()}
            >
              Genera
            </button>
          </div>
        </>
      )}

      {phase === 'running' && (
        <div role="status" aria-live="polite" aria-busy="true" className="state-loading">
          <span className="spinner" aria-hidden="true" />
          <span>Preparazione PDF…</span>
        </div>
      )}

      {phase === 'result' && (
        <>
          {error === 'stale_chunk' ? (
            <>
              <p role="alert" className="text-error">
                SchoolForge è stato aggiornato. Ricarica la pagina e riprova.
              </p>
              <button type="button" onClick={onReload}>
                Ricarica pagina
              </button>
            </>
          ) : error === 'generic' ? (
            <p role="alert" className="text-error">
              Impossibile generare i PDF. Riprova.
            </p>
          ) : result?.ok ? (
            <p role="status">
              {result.kind === 'pdf'
                ? 'PDF preparato.'
                : `ZIP preparato con ${result.filenames.length} PDF.`}
            </p>
          ) : (
            <>
              <p role="alert" className="text-error">
                Nessun file è stato scaricato: una o più correzioni non sono coerenti.
              </p>
              {result && !result.ok && result.failures.length > 0 && (
                <ul>
                  {result.failures.map((failure, index) => (
                    <li key={`${failure.candidate.studentName}-${index}`}>
                      {failure.candidate.studentName} — {failure.message}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
          <div className="dialog-actions">
            <button type="button" className="btn-primary" onClick={close}>
              Chiudi
            </button>
          </div>
        </>
      )}
    </DialogShell>
  );
}
