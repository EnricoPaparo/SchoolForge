import { useEffect, useRef, useState } from 'react';
import { DialogShell } from '../../components/DialogShell.js';
import { MarkdownRenderer } from '../../components/MarkdownRenderer.js';
import { IconPencil, IconSparkles } from '../../components/icons.js';
import type { AiConceptMapCallables } from '../repository/pools/aiConceptMapClient.js';
import { AiConceptMapGenerationDialog } from './AiConceptMapGenerationDialog.js';
import styles from './ConceptMapEditor.module.css';

type Phase = 'idle' | 'saving' | 'error';
type Mode = 'view' | 'edit';

export interface ConceptMapEditorProps {
  /** Corpo salvato della lezione: unica fonte della generazione. */
  lessonBody: string | null;
  /** Mappa già salvata, o null se non esiste. */
  initialConceptMap: string | null;
  /** Motivo per cui la generazione è bloccata, deciso dal workspace. */
  blockedReason: string | null;
  callables: AiConceptMapCallables;
  /** Unica persistenza: il dialog IA non chiama mai questo callback. */
  onSave: (conceptMapMarkdown: string) => Promise<void>;
  /** Integra la mappa nella dirty guard condivisa del workspace. */
  onDirtyChange?: (dirty: boolean) => void;
}

/**
 * Superficie stabile della mappa: lettura, modifica e salvataggio restano nella
 * scheda. Soltanto la generazione vive in un dialog dedicato, con lo stesso
 * contratto della generazione lezione. «Usa questa bozza» aggiorna il draft
 * locale; «Salva mappa» resta l'unica scrittura.
 */
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
  const [error, setError] = useState<string | null>(null);
  const [confirmAbandon, setConfirmAbandon] = useState(false);
  const [generationOpen, setGenerationOpen] = useState(false);

  const savedRef = useRef(initialConceptMap ?? '');
  const saveStartedRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const dirty = draft !== savedRef.current;
  const busy = phase === 'saving';

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => {
    return () => onDirtyChange?.(false);
  }, [onDirtyChange]);

  async function save() {
    if (saveStartedRef.current || draft.trim().length === 0) return;
    saveStartedRef.current = true;
    setError(null);
    setPhase('saving');
    try {
      await onSave(draft);
      if (!mountedRef.current) return;
      savedRef.current = draft;
      setPhase('idle');
      setMode('view');
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err instanceof Error ? err.message : 'Impossibile salvare la mappa. Riprova.');
      setPhase('error');
    } finally {
      saveStartedRef.current = false;
    }
  }

  function requestCancel() {
    if (busy) return;
    if (dirty) {
      setConfirmAbandon(true);
      return;
    }
    leaveEdit();
  }

  function leaveEdit() {
    setDraft(savedRef.current);
    setMode('view');
    setPhase('idle');
    setError(null);
  }

  function useGeneratedDraft(markdown: string) {
    // Nessuna write: la proposta diventa una normale modifica locale e passa
    // dalla stessa dirty guard e dallo stesso pulsante Salva mappa.
    setDraft(markdown);
    setMode('edit');
    setTab('preview');
    setPhase('idle');
    setError(null);
  }

  const canGenerate =
    blockedReason === null && !busy && lessonBody !== null && lessonBody.trim().length > 0;
  const canSave = draft.trim().length > 0 && !busy && dirty;
  const savedMap = savedRef.current;

  const generateButton = (
    <button
      type="button"
      onClick={() => setGenerationOpen(true)}
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
      {mode === 'view' ? (
        <>
          {savedMap.trim().length > 0 ? (
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
              onChange={(event) => setDraft(event.target.value)}
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

      {generationOpen && lessonBody !== null && (
        <AiConceptMapGenerationDialog
          lessonBody={lessonBody}
          callables={callables}
          onUseDraft={useGeneratedDraft}
          onClose={() => setGenerationOpen(false)}
        />
      )}

      {confirmAbandon && (
        <DialogShell
          title="Annullare le modifiche?"
          role="alertdialog"
          onCancel={() => setConfirmAbandon(false)}
        >
          <p>Le modifiche alla mappa non salvate andranno perse.</p>
          <div className={`dialog-actions ${styles.actions}`}>
            <button type="button" onClick={() => setConfirmAbandon(false)}>
              Continua la modifica
            </button>
            <button
              type="button"
              className="btn-danger"
              onClick={() => {
                setConfirmAbandon(false);
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
