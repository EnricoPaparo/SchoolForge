import { type FormEvent, useRef, useState } from 'react';
import { DialogShell } from '../../components/DialogShell.js';
import {
  UDA_METADATA_TEMPLATE,
  UDA_TEMPLATE_FILENAME,
  validateUdaMetadataFile,
} from '../repository/structureImport/index.js';
import type { NormalizedUdaMetadata } from '../repository/structureImport/index.js';
import styles from './DidatticaView.module.css';

/**
 * STRUCTURE-IMPORT-02A — «Importa struttura UDA».
 *
 * Adds UDAs to the open course from a single YAML file of metadata. It never
 * imports lessons, content or pools, and never touches an existing UDA — the
 * summary says so explicitly, because a teacher who expects lesson bodies would
 * otherwise discover the truth only afterwards.
 *
 * The file is read with `file.arrayBuffer()` and validated **byte-first** by the
 * STRUCTURE-IMPORT-01 API: extension, size limit on the original bytes and
 * strict UTF-8 all apply before anything else, and before any Firebase
 * operation. `File.text()` is never used: it would repair invalid UTF-8 into
 * U+FFFD and import mangled titles instead of refusing the file.
 *
 * The template download is entirely client-side, from the canonical constant.
 */

type DialogState =
  | { phase: 'select' }
  | { phase: 'validating' }
  | { phase: 'summary'; bytes: Uint8Array; filename: string; udas: NormalizedUdaMetadata[] }
  | { phase: 'done'; count: number };

export function ImportUdaStructureDialog({
  courseTitle,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  courseTitle: string;
  /** True while the import is running: the dialog cannot be closed accidentally. */
  busy: boolean;
  /** Pre-commit error from the orchestrator — the summary is kept for a retry. */
  error: string | null;
  onCancel: () => void;
  /** Resolves with the number of UDAs added, or `null` when the import failed. */
  onConfirm: (bytes: Uint8Array, filename: string) => Promise<number | null>;
}) {
  const [state, setState] = useState<DialogState>({ phase: 'select' });
  const [localError, setLocalError] = useState<string | null>(null);
  const runIdRef = useRef(0);
  // Synchronous guard: `busy` is async React state and would let a double click
  // through in the same tick.
  const inFlightRef = useRef(false);

  async function handleFile(file: File | null): Promise<void> {
    const runId = ++runIdRef.current;
    setLocalError(null);
    setState({ phase: 'select' });
    if (!file) return;
    setState({ phase: 'validating' });
    try {
      // Byte-first: the bytes, never `file.text()`.
      const buffer = await file.arrayBuffer();
      if (runId !== runIdRef.current) return;
      const bytes = new Uint8Array(buffer);
      const validation = validateUdaMetadataFile(bytes, { filename: file.name });
      if (runId !== runIdRef.current) return;
      if (!validation.ok) {
        setLocalError(validation.error.message);
        setState({ phase: 'select' });
        return;
      }
      setState({ phase: 'summary', bytes, filename: file.name, udas: validation.value });
    } catch {
      if (runId !== runIdRef.current) return;
      setLocalError('Impossibile leggere il file selezionato. Riprova.');
      setState({ phase: 'select' });
    }
  }

  function downloadTemplate(): void {
    const blob = new Blob([UDA_METADATA_TEMPLATE], { type: 'text/yaml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = UDA_TEMPLATE_FILENAME;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (state.phase !== 'summary' || busy || inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      const count = await onConfirm(state.bytes, state.filename);
      // On failure the summary stays exactly as it is, so the teacher can retry
      // without picking the file again.
      if (count !== null) setState({ phase: 'done', count });
    } finally {
      inFlightRef.current = false;
    }
  }

  const canSubmit = state.phase === 'summary' && !busy;

  return (
    <DialogShell title="Importa struttura UDA" onCancel={onCancel} busy={busy}>
      <form onSubmit={(event) => void submit(event)} className={styles.dialogForm}>
        {state.phase === 'done' ? (
          <p className={styles.dialogMessage} role="status">
            {state.count === 1
              ? '1 UDA aggiunta al corso.'
              : `${state.count} UDA aggiunte al corso.`}{' '}
            Le lezioni non sono state importate: aprile dalla nuova UDA per crearle.
          </p>
        ) : (
          <>
            <p className={styles.dialogHint}>
              Aggiunge nuove UDA al corso «{courseTitle}» a partire da un file YAML di soli
              metadati. Le UDA esistenti non vengono modificate. Non importa lezioni, contenuti o
              pool di domande.
            </p>

            <label className={styles.dialogLabel}>
              File YAML delle UDA
              <input
                type="file"
                accept=".yaml,.yml"
                autoFocus
                aria-label="File YAML delle UDA"
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
                    ? `${state.udas.length} UDA verranno aggiunte in coda a quelle esistenti.`
                    : ''}
            </p>

            {state.phase === 'summary' && (
              <>
                <ol className={`${styles.dialogMessage} ${styles.structureSummary}`}>
                  {state.udas.map((uda, index) => (
                    <li key={`${index}-${uda.titolo}`}>
                      <strong>{uda.titolo}</strong>
                      <br />
                      {uda.descrizione ?? 'Nessuna descrizione'}
                      <br />
                      {uda.competenze.length === 1
                        ? '1 competenza'
                        : `${uda.competenze.length} competenze`}
                      {' · '}
                      {uda.obiettivi.length === 1
                        ? '1 obiettivo'
                        : `${uda.obiettivi.length} obiettivi`}
                    </li>
                  ))}
                </ol>
                <p className={styles.dialogHint}>
                  Nessuna UDA esistente verrà modificata, rinominata o sovrascritta.
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

        <div className={styles.dialogActions}>
          <button type="button" onClick={onCancel} disabled={busy}>
            {state.phase === 'done' ? 'Chiudi' : 'Annulla'}
          </button>
          {state.phase !== 'done' && (
            <button type="submit" className="btn-primary" disabled={!canSubmit}>
              {busy ? 'Importazione…' : 'Importa UDA'}
            </button>
          )}
        </div>
      </form>
    </DialogShell>
  );
}
