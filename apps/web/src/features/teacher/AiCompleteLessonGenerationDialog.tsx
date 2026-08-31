import { useEffect, useRef, useState } from 'react';
import { DialogShell } from './workspaceDialogs.js';
import { MarkdownRenderer } from './MarkdownRenderer.js';
import {
  buildLessonContentRequest,
  describeAiContentError,
  formatMicroUsd,
  newRequestId,
  missingLessonRequirements,
  DEFAULT_LESSON_DEPTH,
  DEFAULT_POOL_MODEL_PROFILE,
  LESSON_DEPTH_OPTIONS,
  LESSON_REQUIRED_FIELD_LABELS,
  MAX_TEACHER_GUIDANCE_CHARS,
  POOL_MODEL_PROFILE_OPTIONS,
  type AiLessonCallables,
  type AiLessonContentRequest,
  type AiLessonGenerateResult,
  type AiLessonPreviewResult,
  type LessonAiContext,
  type LessonDepth,
  type PoolModelProfile,
} from '../repository/pools/aiContentClient.js';
import { validateLessonDraftResult } from '../repository/pools/aiLessonDraft.js';
import styles from './AiCompleteLessonGenerationDialog.module.css';

export type CompleteLessonProgress =
  | { stage: 'content'; label?: string }
  | { stage: 'analysis'; label?: string }
  | { stage: 'images'; current: number; total: number; label?: string }
  | { stage: 'finalizing'; label?: string };

export type CompleteLessonRetry = (
  onProgress: (progress: CompleteLessonProgress) => void,
) => Promise<CompleteLessonCompletionSummary>;

export interface CompleteLessonCompletionSummary {
  imagesApplied: number;
  imagesSkipped: number;
  imagesFailed: number;
  /** Costo della sola fase di completamento; il costo del testo è già nel risultato contenuto. */
  actualCostMicroUsd?: number | null;
  message?: string;
  /** Se presente ritenta soltanto gli elementi rimasti, senza rigenerare il contenuto. */
  retry?: CompleteLessonRetry;
}

type Phase =
  | 'configure'
  | 'previewing'
  | 'confirm'
  | 'generating'
  | 'review'
  | 'completing'
  | 'summary'
  | 'error';

type ErrorStage = 'preview' | 'generate' | 'complete';

function progressLabel(progress: CompleteLessonProgress): string {
  if (progress.label?.trim()) return progress.label.trim();
  switch (progress.stage) {
    case 'content':
      return 'Preparazione del contenuto…';
    case 'analysis':
      return 'Analisi dei concetti e scelta delle immagini…';
    case 'images':
      return `Generazione immagine ${progress.current} di ${progress.total}…`;
    case 'finalizing':
      return 'Completamento della lezione…';
  }
}

export function AiCompleteLessonGenerationDialog({
  context,
  callables,
  onCompleteDraft,
  onClose,
  defaultModelProfile = DEFAULT_POOL_MODEL_PROFILE,
}: {
  context: LessonAiContext;
  callables: AiLessonCallables;
  onCompleteDraft: (
    body: string,
    onProgress: (progress: CompleteLessonProgress) => void,
  ) => Promise<CompleteLessonCompletionSummary>;
  onClose: () => void;
  defaultModelProfile?: PoolModelProfile;
}) {
  const [phase, setPhase] = useState<Phase>('configure');
  const [modelProfile, setModelProfile] = useState<PoolModelProfile>(defaultModelProfile);
  const [depth, setDepth] = useState<LessonDepth>(DEFAULT_LESSON_DEPTH);
  const [guidance, setGuidance] = useState('');
  const [preview, setPreview] = useState<AiLessonPreviewResult | null>(null);
  const [previewRequest, setPreviewRequest] = useState<AiLessonContentRequest | null>(null);
  const [contentResult, setContentResult] = useState<AiLessonGenerateResult | null>(null);
  const [draftBody, setDraftBody] = useState('');
  const [progress, setProgress] = useState<CompleteLessonProgress | null>(null);
  const [summary, setSummary] = useState<CompleteLessonCompletionSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorStage, setErrorStage] = useState<ErrorStage>('preview');

  const requestIdRef = useRef(newRequestId());
  const runningRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const missingRequirements = missingLessonRequirements(context);
  const preflightOk = missingRequirements.length === 0;
  const guidanceValid = guidance.length <= MAX_TEACHER_GUIDANCE_CHARS;
  const canEstimate = preflightOk && guidanceValid;
  const busy = phase === 'previewing' || phase === 'generating' || phase === 'completing';

  function currentRequest(): AiLessonContentRequest {
    return buildLessonContentRequest({
      requestId: requestIdRef.current,
      modelProfile,
      depth,
      context,
      teacherGuidance: guidance,
    });
  }

  function invalidateEstimate() {
    setPreview(null);
    setPreviewRequest(null);
    setContentResult(null);
    setDraftBody('');
    setSummary(null);
    setProgress(null);
    setError(null);
    requestIdRef.current = newRequestId();
    runningRef.current = false;
    setPhase('configure');
  }

  async function requestPreview() {
    if (runningRef.current || !canEstimate) return;
    runningRef.current = true;
    setError(null);
    setErrorStage('preview');
    setPhase('previewing');
    const request = currentRequest();
    try {
      const next = await callables.preview(request);
      if (!mountedRef.current) return;
      setPreview(next);
      setPreviewRequest(request);
      // Modalità pilota automatico: la preview è un preflight tecnico senza
      // una seconda conferma. Dopo la stima parte subito il percorso completo.
      await generateAndComplete(request);
    } catch (cause) {
      if (!mountedRef.current) return;
      setError(describeAiContentError(cause));
      setPhase('error');
    } finally {
      runningRef.current = false;
    }
  }

  async function generateContent() {
    if (runningRef.current || !previewRequest) return;
    runningRef.current = true;
    setError(null);
    setErrorStage('generate');
    try {
      await generateAndComplete(previewRequest);
    } catch (cause) {
      if (!mountedRef.current) return;
      setError(describeAiContentError(cause));
      setPhase('error');
    } finally {
      runningRef.current = false;
    }
  }

  async function generateAndComplete(request: AiLessonContentRequest) {
    setErrorStage('generate');
    setPhase('generating');
    const next = await callables.generate(request);
    if (!mountedRef.current) return;
    const validated = validateLessonDraftResult(next);
    if (!validated.ok) {
      setError(validated.error);
      setPhase('error');
      return;
    }
    setContentResult(next);
    setDraftBody(validated.body);
    setErrorStage('complete');
    setProgress({ stage: 'content', label: 'Salvataggio del contenuto…' });
    setPhase('completing');
    try {
      const completed = await onCompleteDraft(validated.body, updateProgress);
      if (!mountedRef.current) return;
      setSummary(completed);
      setProgress(null);
      setPhase('summary');
    } catch {
      if (!mountedRef.current) return;
      setProgress(null);
      setError(
        'Completamento interrotto. Il contenuto non verrà rigenerato: puoi riprovare gli elementi mancanti.',
      );
      setPhase('error');
    }
  }

  function updateProgress(next: CompleteLessonProgress) {
    if (mountedRef.current) setProgress(next);
  }

  async function completeDraft() {
    if (runningRef.current || !draftBody) return;
    runningRef.current = true;
    setError(null);
    setErrorStage('complete');
    setProgress({ stage: 'content' });
    setPhase('completing');
    try {
      const next = await onCompleteDraft(draftBody, updateProgress);
      if (!mountedRef.current) return;
      setSummary(next);
      setProgress(null);
      setPhase('summary');
    } catch {
      if (!mountedRef.current) return;
      setProgress(null);
      setError(
        'Completamento interrotto. Il contenuto non verrà rigenerato: puoi riprovare gli elementi mancanti.',
      );
      setPhase('error');
    } finally {
      runningRef.current = false;
    }
  }

  async function retryMissing() {
    if (runningRef.current || !summary?.retry) return;
    runningRef.current = true;
    setError(null);
    setErrorStage('complete');
    setProgress({ stage: 'analysis', label: 'Ripresa degli elementi mancanti…' });
    setPhase('completing');
    try {
      const next = await summary.retry(updateProgress);
      if (!mountedRef.current) return;
      setSummary(next);
      setProgress(null);
      setPhase('summary');
    } catch {
      if (!mountedRef.current) return;
      setProgress(null);
      setError('Non è stato possibile completare gli elementi mancanti. Puoi riprovare.');
      setPhase('summary');
    } finally {
      runningRef.current = false;
    }
  }

  function retryError() {
    if (errorStage === 'preview') void requestPreview();
    else if (errorStage === 'generate') void generateContent();
    else void completeDraft();
  }

  return (
    <DialogShell
      title="Genera lezione completa con IA"
      onCancel={onClose}
      busy={busy}
      variant="wide-scroll"
      closeOnBackdrop={!busy}
      closeOnEscape={!busy}
    >
      {phase === 'configure' && (
        <div className={styles.config}>
          <div className={styles.field}>
            <span className={styles.fieldLabel} id="ai-complete-profile-label">
              Profilo modello
            </span>
            <div
              className={styles.optionRow}
              role="radiogroup"
              aria-labelledby="ai-complete-profile-label"
            >
              {POOL_MODEL_PROFILE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={modelProfile === option.value}
                  className={`${styles.choice} ${modelProfile === option.value ? styles.choiceSelected : ''}`}
                  onClick={() => {
                    setModelProfile(option.value);
                    invalidateEstimate();
                  }}
                >
                  <span className={styles.choiceLabel}>{option.label}</span>
                  <span className={styles.choiceMeta}>{option.description}</span>
                  <span className={styles.choiceMeta}>Modello: {option.modelId}</span>
                </button>
              ))}
            </div>
          </div>

          <div className={styles.field}>
            <span className={styles.fieldLabel} id="ai-complete-depth-label">
              Profondità
            </span>
            <div
              className={styles.optionRow}
              role="radiogroup"
              aria-labelledby="ai-complete-depth-label"
            >
              {LESSON_DEPTH_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={depth === option.value}
                  className={`${styles.choice} ${depth === option.value ? styles.choiceSelected : ''}`}
                  onClick={() => {
                    setDepth(option.value);
                    invalidateEstimate();
                  }}
                >
                  <span className={styles.choiceLabel}>{option.label}</span>
                  <span className={styles.choiceMeta}>{option.description}</span>
                </button>
              ))}
            </div>
          </div>

          <div className={styles.field}>
            <label className={styles.fieldLabel} htmlFor="ai-complete-guidance">
              Indicazioni aggiuntive (facoltative)
            </label>
            <textarea
              id="ai-complete-guidance"
              className={styles.guidanceTextarea}
              rows={3}
              maxLength={MAX_TEACHER_GUIDANCE_CHARS}
              value={guidance}
              onChange={(event) => {
                setGuidance(event.target.value);
                invalidateEstimate();
              }}
              aria-describedby="ai-complete-guidance-counter"
            />
            <span id="ai-complete-guidance-counter" className={styles.counter}>
              {guidance.length}/{MAX_TEACHER_GUIDANCE_CHARS}
            </span>
          </div>

          <div className={styles.field}>
            <span className={styles.fieldLabel}>Contesto della lezione</span>
            <ul className={styles.estimateList}>
              <li>Titolo: {context.titolo?.trim() || '—'}</li>
              <li>Difficoltà: {context.difficolta?.trim() || '—'}</li>
              <li>UDA: {context.udaTitle?.trim() || '—'}</li>
              <li>
                Concetti chiave:{' '}
                {(context.concettiChiave ?? []).filter((item) => item.trim()).join(', ') || '—'}
              </li>
              <li>
                Obiettivi:{' '}
                {(context.obiettivi ?? []).filter((item) => item.trim()).join(', ') || '—'}
              </li>
            </ul>
          </div>

          {!preflightOk && (
            <p role="alert" className="text-error">
              Completa prima le informazioni fondamentali della lezione:{' '}
              {missingRequirements.map((field) => LESSON_REQUIRED_FIELD_LABELS[field]).join(', ')}.
            </p>
          )}

          <div className="dialog-actions">
            <button type="button" onClick={onClose}>
              Annulla
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={!canEstimate}
              onClick={() => void requestPreview()}
            >
              Genera tutto
            </button>
          </div>
        </div>
      )}

      {phase === 'previewing' && <BusyStatus label="Calcolo della stima…" />}

      {phase === 'confirm' && preview && (
        <div className={styles.estimate}>
          <p>
            Dopo questa conferma verrà generato il contenuto. Le immagini saranno scelte
            automaticamente dal modello, senza passaggi intermedi.
          </p>
          <ul className={styles.estimateList}>
            <li>
              Profilo:{' '}
              {POOL_MODEL_PROFILE_OPTIONS.find((item) => item.value === modelProfile)?.label}
            </li>
            <li>Profondità: {LESSON_DEPTH_OPTIONS.find((item) => item.value === depth)?.label}</li>
            <li>
              Token stimati contenuto: {preview.estimatedInputTokens + preview.maxOutputTokens}
            </li>
            <li>Costo stimato contenuto: {formatMicroUsd(preview.estimatedCostMicroUsd)}</li>
            <li>Tetto massimo contenuto: {formatMicroUsd(preview.reservationCostMicroUsd)}</li>
          </ul>
          <p className={styles.costNote}>
            Il riepilogo finale mostrerà anche il costo delle immagini effettivamente necessarie.
          </p>
          <div className="dialog-actions">
            <button type="button" onClick={invalidateEstimate}>
              Modifica configurazione
            </button>
            <button type="button" className="btn-primary" onClick={() => void generateContent()}>
              Genera contenuto
            </button>
          </div>
        </div>
      )}

      {phase === 'generating' && <BusyStatus label="Generazione del contenuto…" />}

      {phase === 'review' && contentResult && (
        <>
          <p role="status">
            Contenuto generato.{' '}
            {contentResult.actualCostMicroUsd === null
              ? 'Il costo esatto del contenuto non è disponibile.'
              : `Costo reale contenuto: ${formatMicroUsd(contentResult.actualCostMicroUsd)}.`}
          </p>
          <p>
            Controlla il testo. Con il comando finale il modello sceglierà automaticamente se e dove
            aggiungere fino a tre immagini.
          </p>
          <div className={styles.reviewItem}>
            <MarkdownRenderer markdown={draftBody} />
          </div>
          <div className="dialog-actions">
            <button type="button" onClick={onClose}>
              Annulla
            </button>
            <button type="button" className="btn-primary" onClick={() => void completeDraft()}>
              Usa e completa la lezione
            </button>
          </div>
        </>
      )}

      {phase === 'completing' && progress && <BusyStatus label={progressLabel(progress)} />}

      {phase === 'summary' && summary && (
        <>
          <section className={styles.summary} aria-labelledby="ai-complete-summary-title">
            <h4 id="ai-complete-summary-title">Lezione completata</h4>
            {summary.imagesApplied === 0 && summary.imagesFailed === 0 ? (
              <p>Il modello non ha individuato immagini didatticamente necessarie.</p>
            ) : (
              <p>
                {summary.imagesApplied === 1
                  ? 'È stata applicata 1 immagine.'
                  : `Sono state applicate ${summary.imagesApplied} immagini.`}
              </p>
            )}
            {summary.imagesSkipped > 0 && (
              <p>
                {summary.imagesSkipped === 1
                  ? 'Una proposta è stata esclusa perché non utile.'
                  : `${summary.imagesSkipped} proposte sono state escluse perché non utili.`}
              </p>
            )}
            {summary.imagesFailed > 0 && (
              <p role="alert">
                {summary.imagesFailed === 1
                  ? 'Un’immagine non è stata completata.'
                  : `${summary.imagesFailed} immagini non sono state completate.`}
              </p>
            )}
            {summary.actualCostMicroUsd !== undefined && (
              <p>
                {summary.actualCostMicroUsd === null
                  ? 'Costo esatto del completamento non disponibile.'
                  : `Costo reale completamento: ${formatMicroUsd(summary.actualCostMicroUsd)}.`}
              </p>
            )}
            {summary.message && <p>{summary.message}</p>}
          </section>
          {error && (
            <p role="alert" className="text-error">
              {error}
            </p>
          )}
          <div className="dialog-actions">
            {summary.retry && summary.imagesFailed > 0 && (
              <button type="button" className="btn-primary" onClick={() => void retryMissing()}>
                Riprova elementi mancanti
              </button>
            )}
            <button type="button" onClick={onClose}>
              Chiudi
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
            <button type="button" className="btn-primary" onClick={retryError}>
              {errorStage === 'complete' ? 'Riprova completamento' : 'Riprova'}
            </button>
          </div>
        </>
      )}
    </DialogShell>
  );
}

function BusyStatus({ label }: { label: string }) {
  return (
    <div role="status" aria-live="polite" aria-busy="true" className="loading-row">
      <span className="spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}
