import { type FormEvent, useRef, useState } from 'react';
import { DialogShell } from '../../components/DialogShell.js';
import {
  LESSON_METADATA_TEMPLATE,
  LESSON_TEMPLATE_FILENAME,
  validateLessonMetadataFile,
} from '../repository/structureImport/index.js';
import type { NormalizedLessonMetadata } from '../repository/structureImport/index.js';
import styles from './DidatticaView.module.css';

/**
 * STRUCTURE-IMPORT-02B — «Importa lezioni».
 *
 * Aggiunge lezioni **vuote** alla UDA da cui il docente ha aperto il menu: il
 * file non contiene alcun riferimento alla destinazione, quindi la UDA è
 * mostrata esplicitamente nel riepilogo — è l'unico modo che il docente ha per
 * accorgersi di aver aperto il menu sbagliato prima di confermare.
 *
 * Stesso linguaggio UX di «Importa struttura UDA»: lettura byte-first con
 * `file.arrayBuffer()` (mai `File.text()`, che riparerebbe i byte UTF-8 non
 * validi), validazione locale prima di qualunque operazione Firebase, download
 * del modello canonico interamente lato client.
 */

type DialogState =
  | { phase: 'select' }
  | { phase: 'validating' }
  | { phase: 'summary'; bytes: Uint8Array; filename: string; lessons: NormalizedLessonMetadata[] }
  | { phase: 'done'; count: number };

export function ImportLessonStructureDialog({
  udaTitle,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  /** UDA di destinazione, mostrata per intero: nessuna ambiguità sul bersaglio. */
  udaTitle: string;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  /** Risolve con il numero di lezioni aggiunte, o `null` se l'import non è stato applicato. */
  onConfirm: (bytes: Uint8Array, filename: string) => Promise<number | null>;
}) {
  const [state, setState] = useState<DialogState>({ phase: 'select' });
  const [localError, setLocalError] = useState<string | null>(null);
  const runIdRef = useRef(0);
  // Guardia sincrona: `busy` è stato React asincrono e lascerebbe passare un
  // doppio click nello stesso tick.
  const inFlightRef = useRef(false);

  async function handleFile(file: File | null): Promise<void> {
    const runId = ++runIdRef.current;
    setLocalError(null);
    setState({ phase: 'select' });
    if (!file) return;
    setState({ phase: 'validating' });
    try {
      const buffer = await file.arrayBuffer();
      if (runId !== runIdRef.current) return;
      const bytes = new Uint8Array(buffer);
      const validation = validateLessonMetadataFile(bytes, { filename: file.name });
      if (runId !== runIdRef.current) return;
      if (!validation.ok) {
        setLocalError(validation.error.message);
        setState({ phase: 'select' });
        return;
      }
      setState({ phase: 'summary', bytes, filename: file.name, lessons: validation.value });
    } catch {
      if (runId !== runIdRef.current) return;
      setLocalError('Impossibile leggere il file selezionato. Riprova.');
      setState({ phase: 'select' });
    }
  }

  function downloadTemplate(): void {
    const blob = new Blob([LESSON_METADATA_TEMPLATE], { type: 'text/yaml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = LESSON_TEMPLATE_FILENAME;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (state.phase !== 'summary' || busy || inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      const count = await onConfirm(state.bytes, state.filename);
      // Su errore il riepilogo resta com'è: si riprova senza riscegliere il file.
      if (count !== null) setState({ phase: 'done', count });
    } finally {
      inFlightRef.current = false;
    }
  }

  const canSubmit = state.phase === 'summary' && !busy;

  return (
    <DialogShell title="Importa lezioni" onCancel={onCancel} busy={busy}>
      <form onSubmit={(event) => void submit(event)} className={styles.dialogForm}>
        {state.phase === 'done' ? (
          <p className={styles.dialogMessage} role="status">
            {state.count === 1
              ? '1 lezione aggiunta alla UDA.'
              : `${state.count} lezioni aggiunte alla UDA.`}{' '}
            Ogni lezione nasce vuota: aprila per scriverne il contenuto o generarlo con l'IA.
          </p>
        ) : (
          <>
            <p className={styles.dialogHint}>
              Aggiunge nuove lezioni <strong>vuote</strong> alla UDA «{udaTitle}» a partire da un
              file YAML di soli metadati. Non importa e non genera il corpo delle lezioni, e non
              crea domande o pool.
            </p>

            <label className={styles.dialogLabel}>
              File YAML delle lezioni
              <input
                type="file"
                accept=".yaml,.yml"
                autoFocus
                aria-label="File YAML delle lezioni"
                disabled={busy}
                onChange={(event) => void handleFile(event.target.files?.[0] ?? null)}
              />
            </label>

            <p className={styles.dialogHint}>
              <button type="button" onClick={downloadTemplate} disabled={busy}>
                Scarica modello YAML
              </button>
            </p>

            <p role="status" aria-live="polite" aria-busy={busy} className={styles.dialogHint}>
              {state.phase === 'validating'
                ? 'Controllo del file in corso…'
                : busy
                  ? 'Importazione in corso… Non chiudere questa finestra.'
                  : state.phase === 'summary'
                    ? `${state.lessons.length} lezioni verranno aggiunte in coda a quelle della UDA «${udaTitle}».`
                    : ''}
            </p>

            {state.phase === 'summary' && (
              <>
                <ol className={`${styles.dialogMessage} ${styles.structureSummary}`}>
                  {state.lessons.map((lesson, index) => (
                    <li key={`${index}-${lesson.titolo}`}>
                      <strong>{lesson.titolo}</strong>
                      <br />
                      {lesson.sottotitolo ?? 'Nessun sottotitolo'}
                      <br />
                      Difficoltà: {lesson.difficolta}
                      <br />
                      Concetti chiave: {lesson.concettiChiave.join(', ')}
                      <br />
                      Obiettivi: {lesson.obiettivi.join(' · ')}
                    </li>
                  ))}
                </ol>
                <p className={styles.dialogHint}>
                  Ogni lezione viene creata con il corpo Markdown vuoto e senza pool di domande.
                  Nessuna lezione esistente verrà modificata, rinominata o sovrascritta.
                </p>
              </>
            )}
          </>
        )}

        {(localError ?? error) && (
          <p role="alert" className="text-error">
            {localError ?? error}
          </p>
        )}

        <div className={`${styles.dialogActions} ${styles.structureActions}`}>
          <button type="button" onClick={onCancel} disabled={busy}>
            {state.phase === 'done' ? 'Chiudi' : 'Annulla'}
          </button>
          {state.phase !== 'done' && (
            <button type="submit" className="btn-primary" disabled={!canSubmit}>
              {busy ? 'Importazione…' : 'Importa lezioni'}
            </button>
          )}
        </div>
      </form>
    </DialogShell>
  );
}
