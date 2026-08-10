import { useEffect, useRef, useState } from 'react';
import { DialogShell } from '../../components/DialogShell.js';
import { MarkdownRenderer } from '../../components/MarkdownRenderer.js';
import { IconSparkles } from '../../components/icons.js';
import {
  buildConceptMapRequest,
  validateConceptMapResult,
  type AiConceptMapCallables,
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
import styles from './ConceptMapDialog.module.css';

/**
 * CONCEPT-MAP-03 — finestra unica della mappa concettuale: generazione,
 * modifica manuale e salvataggio.
 *
 * **Perché una finestra sola.** La mappa non ha una fase di configurazione: il
 * payload è il corpo della lezione e basta. Separare «genera» da «modifica»
 * avrebbe prodotto due dialog che si passano un testo, con due punti in cui
 * perderlo; qui il testo vive in un solo stato e ogni transizione dichiara che
 * cosa ne fa.
 *
 * **Il testo non viene mai perso senza una conferma esplicita.** Una proposta
 * generata costa denaro reale e una modifica manuale costa lavoro del docente:
 * backdrop ed Escape non le scartano mai, e ogni percorso che le sostituirebbe
 * passa da una conferma modale — mai da controlli che compaiono spostando il
 * layout.
 *
 * Nessun autosave: «Salva mappa» è l'unica azione che scrive.
 */

type Phase = 'idle' | 'previewing' | 'confirm' | 'generating' | 'saving' | 'error';

export interface ConceptMapDialogProps {
  /** Titolo della lezione, solo per l'intestazione. */
  lessonTitle: string;
  /** Corpo **salvato** della lezione: l'unico input della generazione. */
  lessonBody: string;
  /** Mappa già salvata, o `null` se non esiste ancora. */
  initialConceptMap: string | null;
  callables: AiConceptMapCallables;
  /** Persistenza: una sola invocazione per click, gestita qui. */
  onSave: (conceptMapMarkdown: string) => Promise<void>;
  onClose: () => void;
}

export function ConceptMapDialog({
  lessonTitle,
  lessonBody,
  initialConceptMap,
  callables,
  onSave,
  onClose,
}: ConceptMapDialogProps) {
  const [draft, setDraft] = useState(initialConceptMap ?? '');
  const [tab, setTab] = useState<'editor' | 'preview'>(initialConceptMap ? 'preview' : 'editor');
  const [phase, setPhase] = useState<Phase>('idle');
  const [preview, setPreview] = useState<AiConceptMapPreviewResult | null>(null);
  const [previewRequest, setPreviewRequest] = useState<AiConceptMapRequest | null>(null);
  const [lastCost, setLastCost] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<null | 'regenerate' | 'abandon'>(null);
  const [modelProfile, setModelProfile] = useState<PoolModelProfile>(DEFAULT_POOL_MODEL_PROFILE);

  /**
   * Baseline del testo salvato: `dirty` confronta con questa, non con la
   * proposta generata — altrimenti una generazione non ancora salvata
   * sembrerebbe «già salvata» appena accettata.
   */
  const savedRef = useRef(initialConceptMap ?? '');
  const requestIdRef = useRef(newRequestId());
  const previewStartedRef = useRef(false);
  const generateStartedRef = useRef(false);
  const saveStartedRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const dirty = draft !== savedRef.current;
  const busy = phase === 'previewing' || phase === 'generating' || phase === 'saving';
  /**
   * Dal momento in cui c'è qualcosa da perdere, il dialog è
   * «explicit-dismiss only»: un click fuori o un Escape non buttano via una
   * proposta pagata né una modifica manuale.
   */
  const protectedState = busy || dirty;

  function resetEstimate() {
    setPreview(null);
    setPreviewRequest(null);
    generateStartedRef.current = false;
    requestIdRef.current = newRequestId();
  }

  /** Passo 1: stima. Nessuna chiamata parte all'apertura del dialog. */
  async function requestPreview() {
    if (previewStartedRef.current || lessonBody.trim().length === 0) return;
    previewStartedRef.current = true;
    setError(null);
    setPhase('previewing');
    // Preview e generate condividono **la stessa** requestId e lo stesso
    // payload: è ciò che rende la generazione idempotente lato server.
    const request = buildConceptMapRequest({
      requestId: requestIdRef.current,
      modelProfile,
      lessonBody,
    });
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

  /** Passo 2: generazione. Sostituisce il testo **solo** a esito valido. */
  async function confirmGenerate() {
    if (generateStartedRef.current || !previewRequest) return;
    generateStartedRef.current = true;
    setError(null);
    setPhase('generating');
    try {
      const res = await callables.generate(previewRequest);
      if (!mountedRef.current) return;
      const validated = validateConceptMapResult(res);
      if (!validated.ok) {
        // Output malformato: il testo corrente resta intatto.
        setError(validated.error);
        setPhase('error');
        generateStartedRef.current = false;
        return;
      }
      setDraft(validated.conceptMapMarkdown);
      setTab('preview');
      setLastCost(
        res.actualCostMicroUsd === null
          ? 'consumo esatto non disponibile'
          : formatMicroUsd(res.actualCostMicroUsd),
      );
      setPhase('idle');
      resetEstimate();
    } catch (err) {
      if (!mountedRef.current) return;
      // Errore o annullamento non cancellano il testo precedente.
      setError(describeAiContentError(err));
      setPhase('error');
      generateStartedRef.current = false;
    }
  }

  /**
   * «Rigenera con IA»: se c'è qualcosa da perdere — una mappa salvata o una
   * modifica manuale — chiede conferma **prima** di iniziare la stima.
   */
  function startGeneration() {
    if (draft.trim().length > 0) {
      setConfirm('regenerate');
      return;
    }
    void requestPreview();
  }

  async function save() {
    if (saveStartedRef.current || draft.trim().length === 0) return;
    saveStartedRef.current = true;
    setError(null);
    setPhase('saving');
    try {
      await onSave(draft);
      if (!mountedRef.current) return;
      savedRef.current = draft;
      onClose();
    } catch (err) {
      if (!mountedRef.current) return;
      // Il testo resta e il dialog resta aperto: si riprova senza riscrivere.
      setError(err instanceof Error ? err.message : 'Impossibile salvare la mappa. Riprova.');
      setPhase('error');
    } finally {
      saveStartedRef.current = false;
    }
  }

  /** Uscita esplicita: con modifiche non salvate passa dalla conferma modale. */
  function requestClose() {
    if (busy) return;
    if (dirty) {
      setConfirm('abandon');
      return;
    }
    onClose();
  }

  const canGenerate = lessonBody.trim().length > 0 && !busy;
  const canSave = draft.trim().length > 0 && !busy && dirty;

  return (
    <DialogShell
      title={`Mappa concettuale — ${lessonTitle}`}
      onCancel={requestClose}
      busy={busy}
      variant="wide-scroll"
      closeOnBackdrop={!protectedState}
      closeOnEscape={!protectedState}
    >
      {phase === 'confirm' && preview ? (
        <div className={styles.estimate}>
          <p>
            La mappa viene generata dal <strong>contenuto salvato</strong> di questa lezione.
          </p>
          <ul className={styles.estimateList}>
            <li>
              Profilo:{' '}
              {POOL_MODEL_PROFILE_OPTIONS.find((option) => option.value === modelProfile)?.label}
            </li>
            <li>Token stimati: {preview.estimatedInputTokens + preview.maxOutputTokens}</li>
            <li>Costo stimato: {formatMicroUsd(preview.estimatedCostMicroUsd)}</li>
            <li>Tetto massimo prenotabile: {formatMicroUsd(preview.reservationCostMicroUsd)}</li>
          </ul>
          <div className={`dialog-actions ${styles.actions}`}>
            <button
              type="button"
              onClick={() => {
                resetEstimate();
                setPhase('idle');
              }}
            >
              Annulla
            </button>
            <button type="button" className="btn-primary" onClick={() => void confirmGenerate()}>
              Genera mappa
            </button>
          </div>
        </div>
      ) : phase === 'previewing' || phase === 'generating' ? (
        <div role="status" aria-live="polite" aria-busy="true" className="loading-row">
          <span className="spinner" aria-hidden="true" />
          <span>{phase === 'previewing' ? 'Calcolo della stima…' : 'Generazione in corso…'}</span>
        </div>
      ) : (
        <>
          <div className={styles.profileField}>
            <span className={styles.profileLabel} id="concept-map-profile-label">
              Profilo modello
            </span>
            <div
              className={styles.profileOptions}
              role="radiogroup"
              aria-labelledby="concept-map-profile-label"
            >
              {POOL_MODEL_PROFILE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={modelProfile === option.value}
                  className={`${styles.profileChoice}${modelProfile === option.value ? ` ${styles.profileChoiceSelected}` : ''}`}
                  disabled={busy}
                  onClick={() => {
                    if (modelProfile === option.value) return;
                    setModelProfile(option.value);
                    resetEstimate();
                  }}
                >
                  <span className={styles.profileChoiceLabel}>{option.label}</span>
                  <span className={styles.profileChoiceMeta}>{option.description}</span>
                  <span className={styles.profileChoiceMeta}>Modello: {option.modelId}</span>
                </button>
              ))}
            </div>
          </div>
          <div className={styles.tabs} role="tablist" aria-label="Editor mappa concettuale">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'editor'}
              className={`${styles.tab}${tab === 'editor' ? ` ${styles.tabActive}` : ''}`}
              onClick={() => setTab('editor')}
            >
              Editor
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'preview'}
              className={`${styles.tab}${tab === 'preview' ? ` ${styles.tabActive}` : ''}`}
              onClick={() => setTab('preview')}
            >
              Anteprima
            </button>
          </div>

          {tab === 'editor' ? (
            <textarea
              className={styles.textarea}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={16}
              aria-label="Markdown della mappa concettuale"
              disabled={busy}
            />
          ) : (
            <div className={styles.preview}>
              {draft.trim().length > 0 ? (
                // Stessa pipeline sanificata del corpo lezione: la variante
                // `lesson` è l'unica che rende i callout, e l'avvertenza della
                // mappa è un callout. Nessun HTML inserito dopo `sanitize()`.
                <MarkdownRenderer markdown={draft} variant="lesson" />
              ) : (
                <p className={styles.empty}>
                  Nessuna mappa: generala con l’IA oppure scrivila nell’editor.
                </p>
              )}
            </div>
          )}

          {lastCost && (
            <p role="status" className={styles.cost}>
              Mappa generata. Costo: {lastCost}. Non è ancora salvata.
            </p>
          )}
          {error && phase === 'error' && (
            <p role="alert" className="text-error">
              {error}
            </p>
          )}

          <div className={`dialog-actions ${styles.actions}`}>
            <button type="button" onClick={requestClose} disabled={busy}>
              Chiudi
            </button>
            <button type="button" onClick={startGeneration} disabled={!canGenerate}>
              <IconSparkles size={14} />{' '}
              {draft.trim().length > 0 ? 'Rigenera con IA' : 'Genera con IA'}
            </button>
            <button
              type="button"
              className="btn-success"
              onClick={() => void save()}
              disabled={!canSave}
            >
              {phase === 'saving' ? 'Salvataggio…' : 'Salva mappa'}
            </button>
          </div>
        </>
      )}

      {confirm === 'regenerate' && (
        <DialogShell
          title="Rigenerare la mappa?"
          role="alertdialog"
          onCancel={() => setConfirm(null)}
        >
          <p>
            La mappa attuale verrà sostituita da una nuova generazione. Il testo di adesso resta
            intatto finché la nuova mappa non è pronta.
          </p>
          <div className={`dialog-actions ${styles.actions}`}>
            <button type="button" onClick={() => setConfirm(null)}>
              Continua la modifica
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={() => {
                setConfirm(null);
                void requestPreview();
              }}
            >
              Rigenera
            </button>
          </div>
        </DialogShell>
      )}

      {confirm === 'abandon' && (
        <DialogShell
          title="Chiudere senza salvare?"
          role="alertdialog"
          onCancel={() => setConfirm(null)}
        >
          <p>Le modifiche alla mappa non salvate andranno perse.</p>
          <div className={`dialog-actions ${styles.actions}`}>
            <button type="button" onClick={() => setConfirm(null)}>
              Continua la modifica
            </button>
            <button
              type="button"
              className="btn-danger"
              onClick={() => {
                setConfirm(null);
                onClose();
              }}
            >
              Chiudi senza salvare
            </button>
          </div>
        </DialogShell>
      )}
    </DialogShell>
  );
}
