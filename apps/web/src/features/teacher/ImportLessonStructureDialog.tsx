import { type FormEvent, useRef, useState } from 'react';
import { DialogShell } from '../../components/DialogShell.js';
import { parseLessonStructureInput } from '../repository/structureImport/index.js';
import type { NormalizedLessonMetadata } from '../repository/structureImport/index.js';
import styles from './DidatticaView.module.css';

/**
 * STRUCTURE-IMPORT-02B — «Importa lezioni».
 *
 * Aggiunge lezioni **vuote** alla UDA da cui il docente ha aperto il menu: la
 * struttura non contiene alcun riferimento alla destinazione, quindi la UDA è
 * mostrata esplicitamente nel riepilogo — è l'unico modo che il docente ha per
 * accorgersi di aver aperto il menu sbagliato prima di confermare.
 *
 * STRUCTURE-IMPORT-UI-PASTE-01 — stesso linguaggio UX di «Importa struttura
 * UDA»: si incolla la struttura, non si sceglie un file. Il testo diventa byte
 * UTF-8 con `TextEncoder` e passa dall'unica porta byte-first
 * (`parseLessonStructureInput`): limite sui byte, decodifica fatale,
 * riconoscimento della sintassi, validatori invariati.
 *
 * STRUCTURE-IMPORT-SIMPLE-01 — nessun selettore di formato e nessun passaggio
 * in più: la finestra non distingue formato semplice e YAML.
 *
 * `variant="wide-scroll"`: la struttura ha bisogno di larghezza, ed è la stessa
 * variante già usata dai dialog di generazione IA — non una misura inventata qui.
 */

type DialogState =
  | { phase: 'input' }
  | { phase: 'summary'; bytes: Uint8Array; lessons: NormalizedLessonMetadata[] }
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
  onConfirm: (bytes: Uint8Array) => Promise<number | null>;
}) {
  const [state, setState] = useState<DialogState>({ phase: 'input' });
  const [yaml, setYaml] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Guardia sincrona: `busy` è stato React asincrono e lascerebbe passare un
  // doppio click nello stesso tick.
  const inFlightRef = useRef(false);

  /**
   * Fase 1 → 2. Ordine vincolante: stringa → byte UTF-8 → limite sui byte →
   * parser e validatori esistenti. Nessuna correzione, normalizzazione o
   * riformattazione del testo prima della codifica.
   */
  function verify(): void {
    setLocalError(null);
    const bytes = new TextEncoder().encode(yaml);
    const validation = parseLessonStructureInput(bytes);
    if (!validation.ok) {
      setLocalError(validation.error.message);
      textareaRef.current?.focus();
      return;
    }
    setState({ phase: 'summary', bytes, lessons: validation.value });
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
      // Su errore il riepilogo resta com'è: si riprova senza reincollare.
      if (count !== null) setState({ phase: 'done', count });
    } finally {
      inFlightRef.current = false;
    }
  }

  const hasText = yaml.trim().length > 0;
  const canSubmit = state.phase === 'input' ? hasText && !busy : state.phase === 'summary' && !busy;

  return (
    <DialogShell title="Importa lezioni" onCancel={onCancel} busy={busy} variant="wide-scroll">
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
              Aggiunge nuove lezioni <strong>vuote</strong> alla UDA «{udaTitle}» a partire da una
              struttura di soli metadati. Non importa e non genera il corpo delle lezioni, e non
              crea domande o pool.
            </p>

            {state.phase === 'input' && (
              <label className={styles.dialogLabel} htmlFor="import-lesson-structure-yaml">
                Struttura delle lezioni
                <textarea
                  id="import-lesson-structure-yaml"
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
                  aria-describedby="import-lesson-structure-help"
                  value={yaml}
                  onChange={(event) => setYaml(event.target.value)}
                />
              </label>
            )}

            {state.phase === 'input' && (
              <p id="import-lesson-structure-help" className={styles.dialogHint}>
                Incolla la struttura copiata dalla sezione Template. Spazi, righe vuote e simboli
                degli elenchi vengono riconosciuti automaticamente.
              </p>
            )}

            <p role="status" aria-live="polite" aria-busy={busy} className={styles.dialogHint}>
              {busy
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
              {state.phase === 'input'
                ? 'Verifica struttura'
                : busy
                  ? 'Importazione…'
                  : 'Importa lezioni'}
            </button>
          )}
        </div>
      </form>
    </DialogShell>
  );
}
