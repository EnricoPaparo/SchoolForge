import { useEffect, useRef, useState } from 'react';
import { DialogShell } from './workspaceDialogs.js';
import styles from './AiBatchCorrectionDialog.module.css';
import {
  buildRequest,
  describeAiError,
  describeExclusion,
  MAX_TEACHER_GUIDANCE_CHARS,
  newRequestId,
  type AiCorrectionCallables,
  type AiCorrectionRequest,
  type AiPreviewResult,
  type AiRunResult,
} from '../repository/corrections/aiCorrectionClient.js';

/**
 * M5-03/M5-05 — dialog batch «Correggi con IA» (mock o OpenAI reale).
 *
 * Flusso: il docente può inserire un'indicazione pedagogica, poi avvia
 * `aiCorrectionPreview` (nessuna scrittura); il dialog mostra
 * un riepilogo di conferma con conteggi, esclusioni e stima token/costo, e il
 * banner coerente con la modalità restituita dal server; alla conferma chiama
 * `aiCorrectionRun` con lo **stesso** `requestId` e la **stessa** selezione, e
 * mostra il risultato. Preview e run inviano gli stessi ID e la stessa
 * indicazione. Il dialog **non** si chiude da solo finché il
 * risultato non è leggibile; nessun polling, nessun listener.
 */

type Phase = 'configure' | 'previewing' | 'confirm' | 'running' | 'result' | 'error';

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
  const [phase, setPhase] = useState<Phase>('configure');
  const [teacherGuidance, setTeacherGuidance] = useState('');
  const [preview, setPreview] = useState<AiPreviewResult | null>(null);
  const [result, setResult] = useState<AiRunResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewRequest, setPreviewRequest] = useState<AiCorrectionRequest | null>(null);
  // requestId stabile per l'intera operazione (idempotenza server-side).
  const requestIdRef = useRef<string>(newRequestId());
  // Guardia anti doppio-invio del run.
  const runStartedRef = useRef(false);
  const previewStartedRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  function changeTeacherGuidance(value: string) {
    setTeacherGuidance(value);
    setPreview(null);
    setPreviewRequest(null);
    setError(null);
    runStartedRef.current = false;
    requestIdRef.current = newRequestId();
    setPhase('configure');
  }

  async function requestPreview() {
    if (previewStartedRef.current) return;
    previewStartedRef.current = true;
    setError(null);
    setPhase('previewing');
    const request = buildRequest(
      verificationId,
      submissionIds,
      requestIdRef.current,
      teacherGuidance,
    );
    try {
      const res = await callables.preview(request);
      if (!mountedRef.current) return;
      setPreviewRequest(request);
      setPreview(res);
      setPhase('confirm');
    } catch (err) {
      if (!mountedRef.current) return;
      setError(describeAiError(err));
      setPhase('error');
    } finally {
      previewStartedRef.current = false;
    }
  }

  function editTeacherGuidance() {
    setPreview(null);
    setPreviewRequest(null);
    setError(null);
    runStartedRef.current = false;
    requestIdRef.current = newRequestId();
    setPhase('configure');
  }

  async function confirmRun() {
    if (runStartedRef.current || !preview || !previewRequest) return;
    runStartedRef.current = true;
    setPhase('running');
    try {
      const res = await callables.run(previewRequest);
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
      {phase === 'configure' && (
        <label style={{ display: 'grid', gap: '0.375rem' }}>
          <span style={{ fontWeight: 700 }}>Indicazioni per questa correzione (opzionali)</span>
          <textarea
            aria-label="Indicazioni per questa correzione (opzionali)"
            aria-describedby="teacher-guidance-help"
            rows={3}
            maxLength={MAX_TEACHER_GUIDANCE_CHARS}
            value={teacherGuidance}
            disabled={busy}
            onChange={(event) => changeTeacherGuidance(event.target.value)}
          />
          <small id="teacher-guidance-help" style={{ color: 'var(--color-text-muted)' }}>
            Es. Valuta soprattutto la capacità di applicare il concetto, non la terminologia esatta.
            {' · '}
            {teacherGuidance.length}/{MAX_TEACHER_GUIDANCE_CHARS}
          </small>
        </label>
      )}

      {phase === 'configure' && (
        <div className="dialog-actions">
          <button type="button" onClick={onClose}>
            Annulla
          </button>
          <button type="button" className="btn-primary" onClick={() => void requestPreview()}>
            Calcola anteprima
          </button>
        </div>
      )}

      {activeMode && phase !== 'running' && (
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
              Annulla
            </button>
            <button type="button" className="btn-primary" onClick={() => void requestPreview()}>
              Riprova anteprima
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
          <div className={styles.appliedGuidance}>
            <strong>Indicazioni applicate</strong>
            <p>{previewRequest?.teacherGuidance || 'Nessuna indicazione aggiuntiva'}</p>
          </div>
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
            <button type="button" onClick={editTeacherGuidance}>
              Modifica indicazioni
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={preview.counts.eligible === 0}
              onClick={() => void confirmRun()}
            >
              Conferma correzione
            </button>
          </div>
        </>
      )}

      {phase === 'running' && (
        <div role="status" aria-live="polite" aria-busy="true" className={styles.runningStatus}>
          <span className={styles.spinner} aria-hidden="true" />
          <div>
            <strong>Correzione in corso…</strong>
            <p>
              Sto elaborando {preview?.counts.eligible ?? 0} consegne. Non chiudere questa finestra.
            </p>
          </div>
        </div>
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
