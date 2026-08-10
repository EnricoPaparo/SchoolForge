import { useEffect, useRef, useState } from 'react';
import { DialogShell } from '../../components/DialogShell.js';
import { MarkdownRenderer } from '../../components/MarkdownRenderer.js';
import { IconPencil, IconSparkles } from '../../components/icons.js';
import {
  buildConceptMapRequest,
  validateConceptMapResult,
  type AiConceptMapCallables,
  type AiConceptMapPreviewResult,
  type AiConceptMapRequest,
} from '../repository/pools/aiConceptMapClient.js';
import {
  describeAiContentError,
  formatMicroUsd,
  newRequestId,
} from '../repository/pools/aiContentClient.js';
import styles from './ConceptMapEditor.module.css';

/**
 * CONCEPT-MAP-04 — la mappa concettuale come **superficie della lezione**, non
 * come finestra.
 *
 * La mappa è una parte della lezione quanto il corpo: viverne dentro un dialog
 * la faceva sembrare un'operazione occasionale, e costringeva il docente a
 * uscire dalla lezione per vederla. Qui la macchina a stati verificata in
 * CONCEPT-MAP-03 resta identica — stessa `requestId` fra stima e generazione,
 * stessa validazione autorevole del risultato, stesse conferme prima di
 * distruggere del lavoro — ma vive dentro il pannello della scheda.
 *
 * Restano modali soltanto le **conferme distruttive**: rigenerare sopra una
 * mappa esistente e abbandonare modifiche non salvate. Sono gli unici due
 * momenti in cui una risposta sbagliata perde del lavoro, e un `alertdialog`
 * è ciò che impedisce di darla per sbaglio.
 *
 * Due modalità, perché sono due intenzioni diverse:
 * - **lettura** — la mappa salvata resa come la legge lo studente;
 * - **modifica** — editor e anteprima, con salvataggio esplicito.
 *
 * Nessun autosave: «Salva mappa» è l'unica azione che scrive. Nessuna callable
 * parte all'apertura o alla semplice selezione della scheda.
 *
 * **Perché non c'è più alcuna scelta del profilo (CONCEPT-MAP-05).** Il selettore
 * viveva soltanto nella modalità modifica, mentre il pulsante di generazione
 * esisteva in entrambe e leggeva comunque lo stato interno: generando dalla
 * lettura il docente non vedeva alcuna scelta ma un profilo veniva usato lo
 * stesso, e una scelta fatta in modifica restava appiccicata anche dopo
 * «Annulla». Il profilo non è però una preferenza: `economy` produceva mappe
 * insufficienti, quindi la risposta giusta non era mostrare il selettore anche
 * in lettura ma toglierlo del tutto. La mappa è **quality-only**, deciso dal
 * contratto del client e imposto fail-closed dal server.
 */

type Phase = 'idle' | 'previewing' | 'confirm' | 'generating' | 'saving' | 'error';
type Mode = 'view' | 'edit';

export interface ConceptMapEditorProps {
  /**
   * Corpo **salvato** della lezione: l'unico input della generazione. `null`
   * quando il contenuto non è disponibile.
   */
  lessonBody: string | null;
  /** Mappa già salvata, o `null` se non esiste ancora. */
  initialConceptMap: string | null;
  /**
   * Motivo per cui la generazione non è possibile, o `null`. Deciso dal
   * workspace, che è l'unico a sapere se il corpo ha modifiche pendenti.
   */
  blockedReason: string | null;
  callables: AiConceptMapCallables;
  /** Persistenza: una sola invocazione per click, gestita qui. */
  onSave: (conceptMapMarkdown: string) => Promise<void>;
  /** Notifica il workspace, che integra la mappa nella sua dirty guard. */
  onDirtyChange?: (dirty: boolean) => void;
}

export function ConceptMapEditor({
  lessonBody,
  initialConceptMap,
  blockedReason,
  callables,
  onSave,
  onDirtyChange,
}: ConceptMapEditorProps) {
  const [draft, setDraft] = useState(initialConceptMap ?? '');
  const [mode, setMode] = useState<Mode>('view');
  const [tab, setTab] = useState<'editor' | 'preview'>('editor');
  const [phase, setPhase] = useState<Phase>('idle');
  const [preview, setPreview] = useState<AiConceptMapPreviewResult | null>(null);
  const [previewRequest, setPreviewRequest] = useState<AiConceptMapRequest | null>(null);
  const [lastCost, setLastCost] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<null | 'regenerate' | 'abandon'>(null);

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

  // Il workspace deve sapere che c'è del lavoro da perdere: la mappa entra
  // nella stessa guardia di corpo, metadati e pool, senza una seconda.
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => {
    return () => onDirtyChange?.(false);
  }, [onDirtyChange]);

  function resetEstimate() {
    setPreview(null);
    setPreviewRequest(null);
    generateStartedRef.current = false;
    requestIdRef.current = newRequestId();
  }

  /** Passo 1: stima. Nessuna chiamata parte alla selezione della scheda. */
  async function requestPreview() {
    if (previewStartedRef.current || !lessonBody || lessonBody.trim().length === 0) return;
    previewStartedRef.current = true;
    setError(null);
    setPhase('previewing');
    // Preview e generate condividono **la stessa** requestId e lo stesso
    // payload: è ciò che rende la generazione idempotente lato server.
    const request = buildConceptMapRequest({
      requestId: requestIdRef.current,
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
      // La proposta arriva in modifica, non in lettura: non è ancora salvata,
      // e la scheda non deve far credere il contrario.
      setMode('edit');
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
   * «Genera/Rigenera con IA»: se c'è qualcosa da perdere — una mappa salvata o
   * una modifica manuale — chiede conferma **prima** di iniziare la stima.
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
      setLastCost(null);
      setPhase('idle');
      setMode('view');
    } catch (err) {
      if (!mountedRef.current) return;
      // Il testo resta e la scheda resta in modifica: si riprova senza
      // riscrivere nulla.
      setError(err instanceof Error ? err.message : 'Impossibile salvare la mappa. Riprova.');
      setPhase('error');
    } finally {
      saveStartedRef.current = false;
    }
  }

  /** «Annulla»: ripristina l'ultima mappa salvata, con conferma se serve. */
  function requestCancel() {
    if (busy) return;
    if (dirty) {
      setConfirm('abandon');
      return;
    }
    leaveEdit();
  }

  function leaveEdit() {
    setDraft(savedRef.current);
    setMode('view');
    setPhase('idle');
    setError(null);
    setLastCost(null);
    resetEstimate();
  }

  const canGenerate = blockedReason === null && !busy;
  const canSave = draft.trim().length > 0 && !busy && dirty;
  const savedMap = savedRef.current;

  const generateButton = (
    <button
      type="button"
      onClick={startGeneration}
      disabled={!canGenerate}
      aria-describedby={blockedReason ? 'concept-map-blocked-reason' : undefined}
    >
      <IconSparkles size={14} /> {draft.trim().length > 0 ? 'Rigenera con IA' : 'Genera con IA'}
    </button>
  );

  const blockedNote = blockedReason && (
    <p id="concept-map-blocked-reason" className={styles.blocked}>
      {blockedReason}
    </p>
  );

  return (
    <div className={styles.root}>
      {phase === 'confirm' && preview ? (
        <div className={styles.estimate}>
          <p>
            La mappa viene generata dal <strong>contenuto salvato</strong> di questa lezione.
          </p>
          <ul className={styles.estimateList}>
            <li>Profilo: Quality</li>
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
      ) : mode === 'view' ? (
        <>
          {savedMap.trim().length > 0 ? (
            // Stessa pipeline sanificata del corpo lezione: la variante
            // `lesson` è l'unica che rende i callout, e l'avvertenza della
            // mappa è un callout. Nessun HTML inserito dopo `sanitize()`.
            <div className={styles.reading}>
              <MarkdownRenderer markdown={savedMap} variant="lesson" />
            </div>
          ) : (
            <p className="state-empty">
              Nessuna mappa concettuale per questa lezione: generala con l’IA oppure scrivila a
              mano.
            </p>
          )}
          {blockedNote}
          {error && phase === 'error' && (
            <p role="alert" className="text-error">
              {error}
            </p>
          )}
          <div className={`dialog-actions ${styles.actions}`}>
            {generateButton}
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                setMode('edit');
                setTab('editor');
              }}
            >
              <IconPencil size={14} /> Modifica
            </button>
          </div>
        </>
      ) : (
        <>
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
          {blockedNote}
          {error && phase === 'error' && (
            <p role="alert" className="text-error">
              {error}
            </p>
          )}

          <div className={`dialog-actions ${styles.actions}`}>
            <button type="button" onClick={requestCancel} disabled={busy}>
              Annulla
            </button>
            {generateButton}
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
          title="Annullare le modifiche?"
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
                leaveEdit();
              }}
            >
              Annulla le modifiche
            </button>
          </div>
        </DialogShell>
      )}
    </div>
  );
}
