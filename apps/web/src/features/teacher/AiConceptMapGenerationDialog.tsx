import { useEffect, useRef, useState } from 'react';
import { DialogShell } from './workspaceDialogs.js';
import { MarkdownRenderer } from '../../components/MarkdownRenderer.js';
import { AiReviewExitConfirm } from './AiReviewExitConfirm.js';
import styles from './AiPoolGenerationDialog.module.css';
import editorStyles from './ConceptMapEditor.module.css';
import {
  buildConceptMapRequest,
  validateConceptMapResult,
  type AiConceptMapCallables,
  type AiConceptMapGenerateResult,
  type AiConceptMapPreviewResult,
  type AiConceptMapRequest,
} from '../repository/pools/aiConceptMapClient.js';
import {
  DEFAULT_POOL_MODEL_PROFILE,
  POOL_MODEL_PROFILE_OPTIONS,
  describeAiContentError,
  formatMicroUsd,
  newRequestId,
  type PoolModelProfile,
} from '../repository/pools/aiContentClient.js';

type Phase = 'configure' | 'previewing' | 'confirm' | 'generating' | 'review' | 'error';

/**
 * Dialog di generazione della mappa allineato al flusso della bozza lezione:
 * configurazione → stima → conferma → generazione → review → uso della bozza.
 *
 * La proposta non scrive e non sostituisce il draft della scheda finché il
 * docente non preme «Usa questa bozza». Profilo e requestId appartengono alla
 * singola apertura: generare e rigenerare mostrano sempre la stessa scelta.
 */
export function AiConceptMapGenerationDialog({
  lessonBody,
  callables,
  onUseDraft,
  onClose,
  defaultModelProfile = DEFAULT_POOL_MODEL_PROFILE,
}: {
  lessonBody: string;
  callables: AiConceptMapCallables;
  onUseDraft: (markdown: string) => void;
  onClose: () => void;
  defaultModelProfile?: PoolModelProfile;
}) {
  const [phase, setPhase] = useState<Phase>('configure');
  const [modelProfile, setModelProfile] = useState<PoolModelProfile>(defaultModelProfile);
  const [preview, setPreview] = useState<AiConceptMapPreviewResult | null>(null);
  const [previewRequest, setPreviewRequest] = useState<AiConceptMapRequest | null>(null);
  const [result, setResult] = useState<AiConceptMapGenerateResult | null>(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [showAbandonConfirm, setShowAbandonConfirm] = useState(false);

  const requestIdRef = useRef(newRequestId());
  const previewStartedRef = useRef(false);
  const generateStartedRef = useRef(false);
  const abandonStartedRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  function invalidateEstimate() {
    setPreview(null);
    setPreviewRequest(null);
    setResult(null);
    setDraft('');
    setError(null);
    generateStartedRef.current = false;
    requestIdRef.current = newRequestId();
    setPhase('configure');
  }

  function updateModelProfile(next: PoolModelProfile) {
    if (next === modelProfile) return;
    setModelProfile(next);
    invalidateEstimate();
  }

  function currentRequest(): AiConceptMapRequest {
    return buildConceptMapRequest({
      requestId: requestIdRef.current,
      modelProfile,
      lessonBody,
    });
  }

  async function requestPreview() {
    if (previewStartedRef.current || lessonBody.trim().length === 0) return;
    previewStartedRef.current = true;
    setError(null);
    setPhase('previewing');
    const request = currentRequest();
    try {
      const response = await callables.preview(request);
      if (!mountedRef.current) return;
      setPreview(response);
      setPreviewRequest(request);
      setPhase('confirm');
    } catch (err) {
      if (!mountedRef.current) return;
      setError(describeAiContentError(err));
      setPhase('error');
    } finally {
      previewStartedRef.current = false;
    }
  }

  async function confirmGenerate() {
    if (generateStartedRef.current || !previewRequest) return;
    generateStartedRef.current = true;
    setError(null);
    setPhase('generating');
    try {
      const response = await callables.generate(previewRequest);
      if (!mountedRef.current) return;
      const validated = validateConceptMapResult(response);
      if (!validated.ok) {
        setError(validated.error);
        setPhase('error');
        generateStartedRef.current = false;
        return;
      }
      setResult(response);
      setDraft(validated.conceptMapMarkdown);
      setPhase('review');
    } catch (err) {
      if (!mountedRef.current) return;
      setError(describeAiContentError(err));
      setPhase('error');
      generateStartedRef.current = false;
    }
  }

  function useDraft() {
    onUseDraft(draft);
    onClose();
  }

  const busy = phase === 'previewing' || phase === 'generating';
  const protectedPhase = phase === 'generating' || phase === 'review';

  function requestClose() {
    if (busy) return;
    if (phase === 'review') {
      setShowAbandonConfirm(true);
      return;
    }
    onClose();
  }

  function abandonDraft() {
    if (abandonStartedRef.current) return;
    abandonStartedRef.current = true;
    setShowAbandonConfirm(false);
    onClose();
  }

  return (
    <DialogShell
      title="Genera mappa concettuale con IA"
      onCancel={requestClose}
      busy={busy}
      variant="wide-scroll"
      closeOnBackdrop={!protectedPhase}
      closeOnEscape={!protectedPhase}
    >
      {phase === 'configure' && (
        <div className={styles.config}>
          <div className={styles.field}>
            <span className={styles.fieldLabel} id="ai-concept-map-profile-label">
              Profilo modello
            </span>
            <div
              className={styles.optionRow}
              role="radiogroup"
              aria-labelledby="ai-concept-map-profile-label"
            >
              {POOL_MODEL_PROFILE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={modelProfile === option.value}
                  className={`${styles.choice} ${modelProfile === option.value ? styles.choiceSelected : ''}`}
                  onClick={() => updateModelProfile(option.value)}
                >
                  <span className={styles.choiceLabel}>{option.label}</span>
                  <span className={styles.choiceMeta}>{option.description}</span>
                  <span className={styles.choiceMeta}>Modello: {option.modelId}</span>
                </button>
              ))}
            </div>
          </div>

          <div className={`dialog-actions ${editorStyles.actions}`}>
            <button type="button" onClick={onClose}>
              Annulla
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={lessonBody.trim().length === 0}
              onClick={() => void requestPreview()}
            >
              Calcola stima
            </button>
          </div>
        </div>
      )}

      {phase === 'previewing' && (
        <div role="status" aria-live="polite" aria-busy="true" className="loading-row">
          <span className="spinner" aria-hidden="true" />
          <span>Calcolo della stima…</span>
        </div>
      )}

      {phase === 'confirm' && preview && (
        <div className={styles.estimate}>
          <ul className={styles.estimateList}>
            <li>
              Profilo: {POOL_MODEL_PROFILE_OPTIONS.find((o) => o.value === modelProfile)?.label}
            </li>
            <li>Token stimati: {preview.estimatedInputTokens + preview.maxOutputTokens}</li>
            <li>Costo stimato: {formatMicroUsd(preview.estimatedCostMicroUsd)}</li>
            <li>Tetto massimo prenotabile: {formatMicroUsd(preview.reservationCostMicroUsd)}</li>
          </ul>
          <div className={`dialog-actions ${editorStyles.actions}`}>
            <button type="button" onClick={invalidateEstimate}>
              Modifica configurazione
            </button>
            <button type="button" className="btn-primary" onClick={() => void confirmGenerate()}>
              Genera bozza
            </button>
          </div>
        </div>
      )}

      {phase === 'generating' && (
        <div role="status" aria-live="polite" aria-busy="true" className="loading-row">
          <span className="spinner" aria-hidden="true" />
          <span>Generazione della mappa in corso…</span>
        </div>
      )}

      {phase === 'review' && result && (
        <>
          <p role="status">
            {result.replayed ? 'Bozza già generata: ripristinata.' : 'Bozza generata.'} Profilo:{' '}
            {result.modelProfile}.{' '}
            {result.actualCostMicroUsd === null
              ? 'Consumo esatto non disponibile; è stato contabilizzato prudenzialmente il tetto indicato.'
              : `Costo reale: ${formatMicroUsd(result.actualCostMicroUsd)}.`}
          </p>
          <p>
            <strong>
              La bozza sostituirà il testo nell’editor della mappa. Non verrà salvata finché non
              premi Salva mappa.
            </strong>
          </p>
          <div className={styles.reviewItem}>
            <MarkdownRenderer markdown={draft} variant="lesson" />
          </div>
          <div className={`dialog-actions ${editorStyles.actions}`}>
            <button type="button" onClick={() => setShowAbandonConfirm(true)}>
              Annulla
            </button>
            <button type="button" className="btn-primary" onClick={useDraft}>
              Usa questa bozza
            </button>
          </div>

          {showAbandonConfirm && (
            <AiReviewExitConfirm
              onKeepReviewing={() => setShowAbandonConfirm(false)}
              onBackToConfigure={invalidateEstimate}
              onAbandon={abandonDraft}
            />
          )}
        </>
      )}

      {phase === 'error' && (
        <>
          <p role="alert" className="text-error">
            {error}
          </p>
          <div className={`dialog-actions ${editorStyles.actions}`}>
            <button type="button" onClick={onClose}>
              Chiudi
            </button>
            <button type="button" className="btn-primary" onClick={() => void requestPreview()}>
              Riprova stima
            </button>
          </div>
        </>
      )}
    </DialogShell>
  );
}
