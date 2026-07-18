import { useEffect, useRef, useState } from 'react';
import { DialogShell } from './workspaceDialogs.js';
import styles from './AiBatchCorrectionDialog.module.css';
import {
  buildRequest,
  describeAiError,
  describeExclusion,
  gradingModeDescription,
  DEFAULT_GRADING_MODE,
  GRADING_MODE_OPTIONS,
  MAX_TEACHER_GUIDANCE_CHARS,
  newRequestId,
  type AiCorrectionCallables,
  type AiCorrectionRequest,
  type AiPreviewResult,
  type AiRunResult,
  type GradingMode,
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
  const [gradingMode, setGradingMode] = useState<GradingMode>(DEFAULT_GRADING_MODE);
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

  // Ogni modifica ai criteri (stile o indicazioni) invalida la preview e genera
  // una NUOVA requestId: la run successiva non può mai entrare in conflitto
  // (stessa requestId con criteri diversi ⇒ invalid_input lato server, M5-QUALITY-01).
  function invalidatePreview() {
    setPreview(null);
    setPreviewRequest(null);
    setError(null);
    runStartedRef.current = false;
    requestIdRef.current = newRequestId();
    setPhase('configure');
  }

  function changeGradingMode(value: GradingMode) {
    setGradingMode(value);
    invalidatePreview();
  }

  function changeTeacherGuidance(value: string) {
    setTeacherGuidance(value);
    invalidatePreview();
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
      gradingMode,
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

  // «Modifica impostazioni» dalla schermata di stima: torna alla configurazione,
  // invalida la preview e forza una nuova preview + nuova requestId.
  function editSettings() {
    invalidatePreview();
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
        <div className={styles.config}>
          {/* 1) Titolo (DialogShell) + breve spiegazione. */}
          <p className={styles.configIntro}>
            L’IA propone punteggio e feedback per le domande aperte; le chiuse restano
            deterministiche. Potrai rivedere la stima prima di confermare.
          </p>

          {/* 2) Numero di consegne selezionate. */}
          <p className={styles.selectedCount}>
            Consegne selezionate: <strong>{submissionIds.length}</strong>
          </p>

          {/* 3) Stile di valutazione. */}
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Stile di valutazione</span>
            <select
              aria-label="Stile di valutazione"
              aria-describedby="grading-mode-desc"
              value={gradingMode}
              disabled={busy}
              onChange={(event) => changeGradingMode(event.target.value as GradingMode)}
            >
              {GRADING_MODE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          {/* 4) Descrizione dinamica dello stile selezionato. */}
          <p id="grading-mode-desc" className={styles.modeDescription}>
            {gradingModeDescription(gradingMode)}
          </p>

          {/* 5) Indicazioni aggiuntive. */}
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Indicazioni aggiuntive per la correzione</span>
            <textarea
              aria-label="Indicazioni aggiuntive per la correzione"
              aria-describedby="teacher-guidance-help"
              rows={3}
              maxLength={MAX_TEACHER_GUIDANCE_CHARS}
              value={teacherGuidance}
              disabled={busy}
              onChange={(event) => changeTeacherGuidance(event.target.value)}
            />
          </label>

          {/* 6) Contatore caratteri. */}
          <small id="teacher-guidance-help" className={styles.counter}>
            {teacherGuidance.length}/{MAX_TEACHER_GUIDANCE_CHARS} caratteri
          </small>

          {/* 7) Footer. */}
          <div className="dialog-actions">
            <button type="button" onClick={onClose}>
              Annulla
            </button>
            <button type="button" className="btn-primary" onClick={() => void requestPreview()}>
              Calcola stima
            </button>
          </div>
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
        <div role="status" aria-live="polite" aria-busy="true" className="loading-row">
          <span className="spinner" aria-hidden="true" />
          <span>Calcolo della stima…</span>
        </div>
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
          {/* Impostazioni applicate, sola lettura: nessuna seconda textarea. */}
          <div className={styles.appliedGuidance}>
            <strong>Stile di valutazione</strong>
            <p>
              {GRADING_MODE_OPTIONS.find((o) => o.value === previewRequest?.gradingMode)?.label ??
                'Equilibrato'}
            </p>
          </div>
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
            <button type="button" onClick={editSettings}>
              Modifica impostazioni
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
          <span className="spinner" aria-hidden="true" />
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
