import { useEffect, useRef, useState } from 'react';
import { DialogShell } from './workspaceDialogs.js';
import { MarkdownRenderer } from './MarkdownRenderer.js';
import styles from './AiPoolGenerationDialog.module.css';
import {
  buildLessonContentRequest,
  describeAiContentError,
  formatMicroUsd,
  newRequestId,
  DEFAULT_LESSON_DEPTH,
  DEFAULT_POOL_MODEL_PROFILE,
  LESSON_DEPTH_OPTIONS,
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

/**
 * AIGEN-03 — dialog «Genera con IA» della bozza di **lezione**. Coerente con
 * `AiPoolGenerationDialog` (stessi stili e pattern), fasi in-place (il dialog non
 * si chiude fra stima e generazione): configurazione → stima → conferma →
 * generazione → anteprima Markdown → «Usa questa bozza».
 *
 * «Usa questa bozza» sostituisce **solo** il valore locale del `MarkdownBodyEditor`
 * (via `onUseDraft`): nessun salvataggio, nessuna write Firestore/Storage/
 * publicLessons. Il salvataggio avviene solo col normale «Salva» dell'editor.
 * Preview e generate usano la **stessa** `requestId` e lo **stesso** payload
 * normalizzato; ogni modifica di profilo/profondità/indicazioni invalida la stima
 * e genera una nuova `requestId`.
 */

type Phase = 'configure' | 'previewing' | 'confirm' | 'generating' | 'review' | 'error';

export function AiLessonGenerationDialog({
  context,
  callables,
  onUseDraft,
  onClose,
  defaultModelProfile = DEFAULT_POOL_MODEL_PROFILE,
}: {
  context: LessonAiContext;
  callables: AiLessonCallables;
  /** Sostituisce **solo** il draft locale dell'editor. Nessun salvataggio. */
  onUseDraft: (body: string) => void;
  onClose: () => void;
  defaultModelProfile?: PoolModelProfile;
}) {
  const hasCurrentContent = context.currentBody.trim().length > 0;
  const concettiChiave = (context.concettiChiave ?? []).filter((c) => c.trim().length > 0);
  const obiettivi = (context.obiettivi ?? []).filter((o) => o.trim().length > 0);

  const [phase, setPhase] = useState<Phase>('configure');
  const [modelProfile, setModelProfile] = useState<PoolModelProfile>(defaultModelProfile);
  const [depth, setDepth] = useState<LessonDepth>(DEFAULT_LESSON_DEPTH);
  const [guidance, setGuidance] = useState('');
  const [preview, setPreview] = useState<AiLessonPreviewResult | null>(null);
  const [previewRequest, setPreviewRequest] = useState<AiLessonContentRequest | null>(null);
  const [result, setResult] = useState<AiLessonGenerateResult | null>(null);
  const [draftBody, setDraftBody] = useState('');
  const [error, setError] = useState<string | null>(null);

  const requestIdRef = useRef<string>(newRequestId());
  const previewStartedRef = useRef(false);
  const generateStartedRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const guidanceValid = guidance.length <= MAX_TEACHER_GUIDANCE_CHARS;

  function invalidateEstimate() {
    setPreview(null);
    setPreviewRequest(null);
    setError(null);
    generateStartedRef.current = false;
    requestIdRef.current = newRequestId();
    setPhase('configure');
  }
  function updateModelProfile(next: PoolModelProfile) {
    setModelProfile(next);
    invalidateEstimate();
  }
  function updateDepth(next: LessonDepth) {
    setDepth(next);
    invalidateEstimate();
  }
  function updateGuidance(value: string) {
    setGuidance(value);
    invalidateEstimate();
  }

  function currentRequest(): AiLessonContentRequest {
    return buildLessonContentRequest({
      requestId: requestIdRef.current,
      modelProfile,
      depth,
      context,
      teacherGuidance: guidance,
    });
  }

  async function requestPreview() {
    if (previewStartedRef.current || !guidanceValid) return;
    previewStartedRef.current = true;
    setError(null);
    setPhase('previewing');
    const request = currentRequest();
    try {
      const res = await callables.preview(request);
      if (!mountedRef.current) return;
      setPreview(res);
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
    if (generateStartedRef.current || !preview || !previewRequest) return;
    generateStartedRef.current = true;
    setError(null);
    setPhase('generating');
    try {
      const res = await callables.generate(previewRequest);
      if (!mountedRef.current) return;
      const validated = validateLessonDraftResult(res);
      if (!validated.ok) {
        // Output malformato: non tocca il draft, mostra errore leggibile.
        setError(validated.error);
        setPhase('error');
        generateStartedRef.current = false;
        return;
      }
      setResult(res);
      setDraftBody(validated.body);
      setPhase('review');
    } catch (err) {
      if (!mountedRef.current) return;
      setError(describeAiContentError(err));
      setPhase('error');
      generateStartedRef.current = false;
    }
  }

  function useDraft() {
    // Sostituisce SOLO il valore locale dell'editor; nessun salvataggio.
    onUseDraft(draftBody);
    onClose();
  }

  const busy = phase === 'previewing' || phase === 'generating';

  return (
    <DialogShell title="Genera bozza lezione con IA" onCancel={onClose} busy={busy}>
      {phase === 'configure' && (
        <div className={styles.config}>
          <p className={styles.intro}>
            L’IA propone una bozza completa del corpo Markdown della lezione. La bozza è solo
            locale: potrai modificarla e verrà applicata solo con «Usa questa bozza». Nessun costo
            viene generato prima della conferma.
          </p>

          {/* Profilo modello */}
          <div className={styles.field}>
            <span className={styles.fieldLabel} id="ai-lesson-profile-label">
              Profilo modello
            </span>
            <div
              className={styles.optionRow}
              role="radiogroup"
              aria-labelledby="ai-lesson-profile-label"
            >
              {POOL_MODEL_PROFILE_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  role="radio"
                  aria-checked={modelProfile === o.value}
                  className={`${styles.choice} ${modelProfile === o.value ? styles.choiceSelected : ''}`}
                  onClick={() => updateModelProfile(o.value)}
                >
                  <span className={styles.choiceLabel}>{o.label}</span>
                  <span className={styles.choiceMeta}>{o.description}</span>
                  <span className={styles.choiceMeta}>Modello: {o.modelId}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Profondità */}
          <div className={styles.field}>
            <span className={styles.fieldLabel} id="ai-lesson-depth-label">
              Profondità
            </span>
            <div
              className={styles.optionRow}
              role="radiogroup"
              aria-labelledby="ai-lesson-depth-label"
            >
              {LESSON_DEPTH_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  role="radio"
                  aria-checked={depth === o.value}
                  className={`${styles.choice} ${depth === o.value ? styles.choiceSelected : ''}`}
                  onClick={() => updateDepth(o.value)}
                >
                  <span className={styles.choiceLabel}>{o.label}</span>
                  <span className={styles.choiceMeta}>{o.description}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Indicazioni del docente */}
          <div className={styles.field}>
            <label className={styles.fieldLabel} htmlFor="ai-lesson-guidance">
              Indicazioni aggiuntive (facoltative)
            </label>
            <textarea
              id="ai-lesson-guidance"
              rows={3}
              maxLength={MAX_TEACHER_GUIDANCE_CHARS}
              value={guidance}
              onChange={(e) => updateGuidance(e.target.value)}
              aria-describedby="ai-lesson-guidance-counter"
            />
            <span id="ai-lesson-guidance-counter" className={styles.counter}>
              {guidance.length}/{MAX_TEACHER_GUIDANCE_CHARS}
            </span>
          </div>

          {/* Contesto in sola lettura (già in memoria; nessuna nuova query) */}
          <div className={styles.field}>
            <span className={styles.fieldLabel}>Contesto della lezione</span>
            <ul className={styles.estimateList}>
              <li>Titolo: {context.titolo?.trim() || '—'}</li>
              {context.sottotitolo?.trim() && <li>Sottotitolo: {context.sottotitolo.trim()}</li>}
              {context.udaTitle?.trim() && <li>UDA: {context.udaTitle.trim()}</li>}
              <li>Concetti chiave: {concettiChiave.length ? concettiChiave.join(', ') : '—'}</li>
              <li>Obiettivi: {obiettivi.length ? obiettivi.join(', ') : '—'}</li>
              <li>{hasCurrentContent ? 'Contenuto attuale presente' : 'Editor vuoto'}</li>
            </ul>
          </div>

          <div className="dialog-actions">
            <button type="button" onClick={onClose}>
              Annulla
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={!guidanceValid}
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
            <li>Profondità: {LESSON_DEPTH_OPTIONS.find((o) => o.value === depth)?.label}</li>
            <li>Token stimati: {preview.estimatedInputTokens + preview.maxOutputTokens}</li>
            <li>Costo stimato: {formatMicroUsd(preview.estimatedCostMicroUsd)}</li>
            <li>Tetto massimo prenotabile: {formatMicroUsd(preview.reservationCostMicroUsd)}</li>
          </ul>
          <p className={styles.noCostNote}>Nessun costo è stato ancora generato.</p>
          <div className="dialog-actions">
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
          <span>Generazione della bozza in corso…</span>
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
              La bozza generata sostituirà il testo nell’editor. La lezione non verrà salvata finché
              non premi Salva.
            </strong>
          </p>
          <div className={styles.reviewItem}>
            <MarkdownRenderer markdown={draftBody} />
          </div>
          <div className="dialog-actions">
            <button type="button" onClick={onClose}>
              Annulla
            </button>
            <button type="button" className="btn-primary" onClick={useDraft}>
              Usa questa bozza
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
            <button type="button" className="btn-primary" onClick={() => void requestPreview()}>
              Riprova stima
            </button>
          </div>
        </>
      )}
    </DialogShell>
  );
}
