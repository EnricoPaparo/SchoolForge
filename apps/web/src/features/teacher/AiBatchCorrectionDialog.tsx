import { useEffect, useRef, useState } from 'react';
import { DialogShell } from './workspaceDialogs.js';
import {
  buildRequest,
  describeAiError,
  describeExclusion,
  newRequestId,
  type AiCorrectionCallables,
  type AiPreviewResult,
  type AiRunResult,
} from '../repository/corrections/aiCorrectionClient.js';

/**
 * M5-03/M5-05 — dialog batch «Correggi con IA» (mock o OpenAI reale).
 *
 * Flusso: al montaggio chiama `aiCorrectionPreview` (nessuna scrittura); mostra
 * un riepilogo di conferma con conteggi, esclusioni e stima token/costo, e il
 * banner coerente con la modalità restituita dal server; alla conferma chiama
 * `aiCorrectionRun` con lo **stesso** `requestId` e la **stessa** selezione, e
 * mostra il risultato. Preview e run inviano **solo** `verificationId`,
 * `submissionIds`, `requestId`. Il dialog **non** si chiude da solo finché il
 * risultato non è leggibile; nessun polling, nessun listener.
 */

type Phase = 'previewing' | 'confirm' | 'running' | 'result' | 'error';

export function AiBatchCorrectionDialog({
  verificationId,
  submissionIds,
  callables,
  onClose,
  onApplied,
}: {
  verificationId: string;
  submissionIds: string[];
  callables: AiCorrectionCallables;
  onClose: () => void;
  onApplied: (result: AiRunResult) => void;
}) {
  const [phase, setPhase] = useState<Phase>('previewing');
  const [preview, setPreview] = useState<AiPreviewResult | null>(null);
  const [result, setResult] = useState<AiRunResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  // requestId stabile per l'intera operazione (idempotenza server-side).
  const requestIdRef = useRef<string>(newRequestId());
  // Guardia anti doppio-invio del run.
  const runStartedRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    let cancelled = false;
    void (async () => {
      try {
        const res = await callables.preview(
          buildRequest(verificationId, submissionIds, requestIdRef.current),
        );
        if (cancelled || !mountedRef.current) return;
        setPreview(res);
        setPhase('confirm');
      } catch (err) {
        if (cancelled || !mountedRef.current) return;
        setError(describeAiError(err));
        setPhase('error');
      }
    })();
    return () => {
      cancelled = true;
      mountedRef.current = false;
    };
    // Eseguito una sola volta: la selezione è congelata all'apertura del dialog.
  }, []);

  async function confirmRun() {
    if (runStartedRef.current) return; // anti doppio-click / doppia invocazione
    runStartedRef.current = true;
    setPhase('running');
    try {
      const res = await callables.run(
        buildRequest(verificationId, submissionIds, requestIdRef.current),
      );
      if (!mountedRef.current) return;
      setResult(res);
      setPhase('result');
      onApplied(res);
    } catch (err) {
      if (!mountedRef.current) return;
      setError(describeAiError(err));
      setPhase('error');
      // Consenti un nuovo tentativo dopo un errore di rete (stesso requestId →
      // idempotente lato server).
      runStartedRef.current = false;
    }
  }

  const busy = phase === 'previewing' || phase === 'running';
  const activeMode = result?.mode ?? preview?.mode;

  return (
    <DialogShell title="Correggi con IA" onCancel={onClose} busy={busy}>
      {activeMode && (
        <p role="status" style={{ fontWeight: 700 }}>
          {activeMode === 'openai'
            ? 'Modalità OpenAI — il costo reale sarà registrato dopo l’esecuzione'
            : 'Modalità mock — costo reale 0'}
        </p>
      )}

      {phase === 'previewing' && (
        <p aria-busy="true" className="state-loading">
          Analisi delle consegne selezionate…
        </p>
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
          </div>
        </>
      )}

      {phase === 'confirm' && preview && (
        <>
          <ul>
            <li>Consegne selezionate: {preview.counts.selected}</li>
            <li>Elaborabili: {preview.counts.eligible}</li>
            <li>Escluse: {preview.counts.excluded}</li>
            <li>Domande chiuse (valutazione deterministica): {preview.counts.closedToGrade}</li>
            <li>Domande aperte (valutazione IA): {preview.counts.openToGrade}</li>
            <li>Consegne con sole domande chiuse: {preview.counts.closedOnlySubmissions}</li>
            <li>Domande già valutate (ignorate): {preview.counts.alreadyGradedIgnored}</li>
            <li>Token stimati: {preview.tokensEstimated}</li>
            <li>
              Costo stimato: {preview.costEstimated}
              {preview.mode === 'mock' ? ' (mock)' : ' USD'}
            </li>
          </ul>
          {preview.excluded.length > 0 && (
            <details>
              <summary>Consegne escluse ({preview.excluded.length})</summary>
              <ul>
                {preview.excluded.map((e) => (
                  <li key={e.submissionId}>{describeExclusion(e.reason)}</li>
                ))}
              </ul>
            </details>
          )}
          <div className="dialog-actions">
            <button type="button" onClick={onClose}>
              Annulla
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={preview.counts.eligible === 0}
              onClick={() => void confirmRun()}
            >
              Correggi {preview.counts.eligible} consegne con IA
            </button>
          </div>
        </>
      )}

      {phase === 'running' && (
        <p aria-busy="true" className="state-loading">
          Correzione in corso…
        </p>
      )}

      {phase === 'result' && result && (
        <>
          {result.status === 'running' ? (
            <p role="status">
              Un’operazione di correzione IA per questa selezione è già in corso. Nessuna nuova
              elaborazione avviata.
            </p>
          ) : (
            <>
              <p role="status">
                {result.idempotentReplay
                  ? 'Operazione già eseguita: risultato ripristinato.'
                  : 'Correzione completata.'}
              </p>
              <ul>
                <li>Riuscite: {result.counts.succeeded}</li>
                <li>Parziali: {result.counts.partial}</li>
                <li>Escluse: {result.counts.excluded}</li>
                <li>Fallite: {result.counts.failed}</li>
                <li>Token stimati: {result.tokensEstimated}</li>
                <li>
                  Token reali: {result.tokensActual}
                  {result.mode === 'mock' ? ' (mock)' : ''}
                </li>
                <li>
                  Costo reale: {result.costActual}
                  {result.mode === 'mock' ? ' (mock)' : ' USD'}
                </li>
              </ul>
              {result.results.some((r) => r.reason) && (
                <details>
                  <summary>Dettaglio consegne non elaborate</summary>
                  <ul>
                    {result.results
                      .filter((r) => r.reason)
                      .map((r) => (
                        <li key={r.submissionId}>{describeExclusion(r.reason!)}</li>
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
