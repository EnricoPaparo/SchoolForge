import { type FormEvent, useRef, useState } from 'react';
import { DialogShell } from '../../components/DialogShell.js';
import { parseUdaStructureInput } from '../repository/structureImport/index.js';
import type { NormalizedUdaMetadata } from '../repository/structureImport/index.js';
import styles from './DidatticaView.module.css';

/**
 * STRUCTURE-IMPORT-02A — «Importa struttura UDA».
 *
 * Aggiunge UDA al corso aperto da una struttura YAML di soli metadati. Non
 * importa mai lezioni, contenuti o pool, e non tocca mai una UDA esistente — il
 * riepilogo lo dice esplicitamente, perché un docente che si aspetta i corpi
 * delle lezioni lo scoprirebbe altrimenti solo dopo.
 *
 * STRUCTURE-IMPORT-UI-PASTE-01 — il docente **incolla** la struttura invece di
 * scegliere un file. Il file era il vero costo del flusso: obbligava a salvare
 * un modello su disco, ritrovarlo, e scoprire solo al secondo passaggio che
 * l'estensione o la codifica non andavano bene. Gli esempi copiabili vivono
 * nella sezione Template, che resta l'unico punto autorevole.
 *
 * Il percorso di validazione **non cambia**: il testo incollato diventa byte
 * UTF-8 con `TextEncoder` e viene consegnato all'unica porta byte-first
 * (`parseUdaStructureInput`), che applica limite sui byte, decodifica UTF-8
 * fatale, riconosce la sintassi e chiama i validatori di sempre. Nessuna API
 * permissiva di lettura file: qui non si legge più alcun file.
 *
 * STRUCTURE-IMPORT-SIMPLE-01 — la finestra non sa quale delle due sintassi ha
 * davanti, e non deve saperlo: nessun selettore di formato, nessuna modalità
 * avanzata, nessuna conversione. Il riconoscimento vive nell'adapter.
 *
 * `variant="wide-scroll"`: la struttura ha bisogno di larghezza, ed è la stessa
 * variante già usata dai dialog di generazione IA — non una misura inventata qui.
 */

type DialogState =
  | { phase: 'input' }
  | { phase: 'summary'; bytes: Uint8Array; udas: NormalizedUdaMetadata[] }
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
  onConfirm: (bytes: Uint8Array) => Promise<number | null>;
}) {
  const [state, setState] = useState<DialogState>({ phase: 'input' });
  const [yaml, setYaml] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Synchronous guard: `busy` is async React state and would let a double click
  // through in the same tick.
  const inFlightRef = useRef(false);

  /**
   * Fase 1 → 2. L'ordine è vincolante: stringa → byte UTF-8 → limite sui byte →
   * parser e validatori esistenti. Il testo non viene toccato prima di essere
   * codificato: spazi, accenti, apostrofi e indentazione arrivano al parser
   * esattamente come il docente li ha incollati.
   */
  function verify(): void {
    setLocalError(null);
    const bytes = new TextEncoder().encode(yaml);
    const validation = parseUdaStructureInput(bytes);
    if (!validation.ok) {
      // Il testo resta dov'è: si corregge, non si reincolla da capo.
      setLocalError(validation.error.message);
      textareaRef.current?.focus();
      return;
    }
    setState({ phase: 'summary', bytes, udas: validation.value });
  }

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (busy || inFlightRef.current) return;
    if (state.phase === 'input') {
      verify();
      return;
    }
    if (state.phase !== 'summary') return;
    inFlightRef.current = true;
    try {
      const count = await onConfirm(state.bytes);
      // On failure the summary stays exactly as it is, so the teacher can retry
      // without pasting again.
      if (count !== null) setState({ phase: 'done', count });
    } finally {
      inFlightRef.current = false;
    }
  }

  const hasText = yaml.trim().length > 0;
  const canSubmit = state.phase === 'input' ? hasText && !busy : state.phase === 'summary' && !busy;

  return (
    <DialogShell
      title="Importa struttura UDA"
      onCancel={onCancel}
      busy={busy}
      variant="wide-scroll"
    >
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
              Aggiunge nuove UDA al corso «{courseTitle}» a partire da una struttura di soli
              metadati. Le UDA esistenti non vengono modificate. Non importa lezioni, contenuti o
              pool di domande.
            </p>

            {state.phase === 'input' && (
              <label className={styles.dialogLabel} htmlFor="import-uda-structure-yaml">
                Struttura delle UDA
                <textarea
                  id="import-uda-structure-yaml"
                  ref={textareaRef}
                  className={styles.structureTextarea}
                  rows={14}
                  autoFocus
                  spellCheck={false}
                  autoCorrect="off"
                  autoCapitalize="off"
                  autoComplete="off"
                  disabled={busy}
                  aria-invalid={localError !== null}
                  aria-describedby="import-uda-structure-help"
                  value={yaml}
                  onChange={(event) => setYaml(event.target.value)}
                />
              </label>
            )}

            {state.phase === 'input' && (
              <p id="import-uda-structure-help" className={styles.dialogHint}>
                Incolla la struttura copiata dalla sezione Template. Spazi, righe vuote e simboli
                degli elenchi vengono riconosciuti automaticamente.
              </p>
            )}

            <p role="status" aria-live="polite" aria-busy={busy} className={styles.dialogHint}>
              {busy
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

        <div className={`${styles.dialogActions} ${styles.structureActions}`}>
          <button type="button" onClick={onCancel} disabled={busy}>
            {state.phase === 'done' ? 'Chiudi' : 'Annulla'}
          </button>
          {state.phase !== 'done' && (
            <button type="submit" className="btn-primary" disabled={!canSubmit}>
              {state.phase === 'input'
                ? 'Verifica struttura'
                : busy
                  ? 'Importazione…'
                  : 'Importa UDA'}
            </button>
          )}
        </div>
      </form>
    </DialogShell>
  );
}
