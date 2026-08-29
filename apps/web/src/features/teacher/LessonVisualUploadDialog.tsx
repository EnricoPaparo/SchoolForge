import { useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import type { Functions } from 'firebase/functions';
import { DialogShell } from '../../components/DialogShell.js';
import type { LessonVisualItem } from '../../types/firestore.js';
import {
  createVisualUploadClient,
  describeVisualUploadError,
  MAX_VISUAL_UPLOAD_BYTES,
  VISUAL_UPLOAD_MIME_TYPES,
} from '../repository/programs/visualUploadClient.js';
import styles from './LessonVisualUploadDialog.module.css';

const ACCEPT_ATTRIBUTE = VISUAL_UPLOAD_MIME_TYPES.join(',');

function isAcceptedFile(file: File): boolean {
  return (VISUAL_UPLOAD_MIME_TYPES as readonly string[]).includes(file.type);
}

export function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('file_read_failed'));
    reader.onload = () => {
      const value = reader.result;
      if (typeof value !== 'string') return reject(new Error('file_read_failed'));
      const comma = value.indexOf(',');
      if (comma < 0) return reject(new Error('file_read_failed'));
      resolve(value.slice(comma + 1));
    };
    reader.readAsDataURL(file);
  });
}

export function LessonVisualUploadDialog({
  functions,
  identity,
  headings,
  currentVisuals,
  onRefresh,
  onBack,
  onClose,
}: {
  functions: Functions;
  identity: { programId: string; importId: string; lessonId: string };
  headings: { text: string; index: number }[];
  currentVisuals: LessonVisualItem[];
  onRefresh: () => Promise<void>;
  onBack: () => void;
  onClose: () => void;
}) {
  const client = useMemo(() => createVisualUploadClient(functions), [functions]);
  const requestId = useRef(crypto.randomUUID());
  const promotionRequestId = useRef(crypto.randomUUID());
  const action = useRef(false);
  const mounted = useRef(true);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [headingIndex, setHeadingIndex] = useState(headings[0]?.index ?? 0);
  const [caption, setCaption] = useState('');
  const [altText, setAltText] = useState('');
  const [mode, setMode] = useState<'add' | 'replace'>(
    currentVisuals.length >= 3 ? 'replace' : 'add',
  );
  const [replaceAssetId, setReplaceAssetId] = useState(currentVisuals[0]?.assetId ?? '');
  const [busy, setBusy] = useState(false);
  const [attemptStarted, setAttemptStarted] = useState(false);
  const [ready, setReady] = useState(false);
  const [promoted, setPromoted] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (previewUrl && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  function chooseFile(next: File | null) {
    if (!next || attemptStarted) return;
    setError(null);
    if (!isAcceptedFile(next)) {
      setError('Formato non ammesso: usa PNG, JPEG o WebP.');
      return;
    }
    if (next.size <= 0 || next.size > MAX_VISUAL_UPLOAD_BYTES) {
      setError('Il file deve avere una dimensione massima di 2 MB.');
      return;
    }
    setFile(next);
    setPreviewUrl(
      typeof URL.createObjectURL === 'function' ? URL.createObjectURL(next) : 'preview-unavailable',
    );
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    chooseFile(event.target.files?.[0] ?? null);
    event.target.value = '';
  }

  function onDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragging(false);
    chooseFile(event.dataTransfer.files?.[0] ?? null);
  }

  async function abandonAndClose(destination: 'back' | 'close') {
    if (action.current) return;
    action.current = true;
    setBusy(true);
    setError(null);
    const mustAbandon = attemptStarted && !promoted;
    setProgress(mustAbandon ? 'Annullamento dell’upload…' : null);
    try {
      if (mustAbandon) await client.abandon(requestId.current);
    } catch {
      if (!mounted.current) return;
      setError(
        'Impossibile annullare l’upload. Riprova: se l’immagine fosse già stata salvata, usa «Riprova upload» per verificarne lo stato e aggiornare la lezione.',
      );
      return;
    } finally {
      action.current = false;
      if (mounted.current) {
        setBusy(false);
        setProgress(null);
      }
    }
    if (!mounted.current) return;
    if (destination === 'back') onBack();
    else onClose();
  }

  async function submit() {
    if (action.current) return;
    const heading = headings.find((item) => item.index === headingIndex);
    if (!file) return setError('Seleziona un’immagine da caricare.');
    if (!heading) return setError('Aggiungi almeno un titolo H2 o H3 alla lezione.');
    if (!caption.trim() || !altText.trim()) {
      return setError('Didascalia e testo alternativo sono obbligatori.');
    }
    if (mode === 'add' && currentVisuals.length >= 3) {
      return setError('La lezione contiene già tre immagini: scegline una da sostituire.');
    }
    if (mode === 'replace' && !replaceAssetId) {
      return setError('Seleziona l’immagine da sostituire.');
    }

    action.current = true;
    setBusy(true);
    setError(null);
    let promotionCompleted = promoted;
    let acceptedReady = ready;
    try {
      if (!promoted) {
        setAttemptStarted(true);
        if (!acceptedReady) {
          setProgress('Preparazione e ottimizzazione dell’immagine…');
          const base64 = await readFileAsBase64(file);
          const accepted = await client.accept({
            ...identity,
            requestId: requestId.current,
            base64,
            anchor: {
              anchorHeadingIndex: heading.index,
              anchorHeadingText: heading.text,
            },
            caption: caption.trim(),
            altText: altText.trim(),
          });
          if (accepted.status !== 'ready' && accepted.status !== 'promoted') {
            throw new Error(`visual_upload_${accepted.status}`);
          }
          acceptedReady = true;
          setReady(true);
          if (accepted.status === 'promoted') promotionCompleted = true;
        }
        if (!promotionCompleted) {
          setProgress(
            mode === 'replace' ? 'Sostituzione dell’immagine…' : 'Aggiunta alla lezione…',
          );
          await client.promote({
            requestId: requestId.current,
            promotionRequestId: promotionRequestId.current,
            mode: mode === 'replace' ? { mode: 'replace', replaceAssetId } : { mode: 'add' },
          });
        }
        promotionCompleted = true;
        setPromoted(true);
      }
      setProgress('Aggiornamento della lezione…');
      await onRefresh();
      onClose();
    } catch (cause) {
      setError(
        promotionCompleted
          ? 'Immagine salvata. Riprova l’aggiornamento della lezione.'
          : describeVisualUploadError(cause),
      );
    } finally {
      action.current = false;
      setBusy(false);
      setProgress(null);
    }
  }

  const locked = attemptStarted || busy;
  const canAdd = currentVisuals.length < 3;

  return (
    <DialogShell
      title="Carica immagine"
      onCancel={() => void abandonAndClose('close')}
      busy={busy}
      variant="wide-scroll"
    >
      <p className={styles.intro}>
        PNG, JPEG o WebP fino a 2 MB. L’immagine viene ottimizzata prima di essere aggiunta alla
        lezione.
      </p>

      <div className={styles.layout}>
        <div className={styles.fileColumn}>
          <label
            className={`${styles.dropzone}${dragging ? ` ${styles.dropzoneDragging}` : ''}`}
            onDragEnter={(event) => {
              event.preventDefault();
              if (!locked) setDragging(true);
            }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
          >
            <input
              type="file"
              accept={ACCEPT_ATTRIBUTE}
              onChange={onFileChange}
              disabled={locked}
            />
            <strong>{file ? file.name : 'Scegli o trascina un’immagine'}</strong>
            <span>{file ? `${Math.ceil(file.size / 1024)} KB` : 'PNG, JPEG, WebP · max 2 MB'}</span>
          </label>
          {file && previewUrl && (
            <figure className={styles.preview}>
              <img src={previewUrl} alt="Anteprima locale dell’immagine selezionata" />
              <figcaption>Anteprima locale, non ancora salvata</figcaption>
            </figure>
          )}
        </div>

        <div className={styles.formColumn}>
          <fieldset disabled={locked} className={styles.modeGroup}>
            <legend>Operazione</legend>
            <label>
              <input
                type="radio"
                name="upload-mode"
                value="add"
                checked={mode === 'add'}
                disabled={!canAdd}
                onChange={() => setMode('add')}
              />
              Aggiungi immagine
            </label>
            {currentVisuals.length > 0 && (
              <label>
                <input
                  type="radio"
                  name="upload-mode"
                  value="replace"
                  checked={mode === 'replace'}
                  onChange={() => setMode('replace')}
                />
                Sostituisci immagine
              </label>
            )}
          </fieldset>

          {mode === 'replace' && (
            <label>
              Immagine da sostituire
              <select
                value={replaceAssetId}
                onChange={(event) => setReplaceAssetId(event.target.value)}
                disabled={locked}
                required
              >
                {currentVisuals.map((item, index) => (
                  <option value={item.assetId} key={item.assetId}>
                    {index + 1}. {item.anchor.headingText}
                  </option>
                ))}
              </select>
            </label>
          )}

          <label>
            Posizione nella lezione
            <select
              value={headingIndex}
              onChange={(event) => setHeadingIndex(Number(event.target.value))}
              disabled={locked}
              required
            >
              {headings.map((heading) => (
                <option value={heading.index} key={`${heading.index}:${heading.text}`}>
                  {heading.text}
                </option>
              ))}
            </select>
          </label>

          <label>
            Didascalia
            <textarea
              value={caption}
              onChange={(event) => setCaption(event.target.value)}
              maxLength={500}
              rows={3}
              disabled={locked}
              required
            />
          </label>

          <label>
            Testo alternativo
            <textarea
              aria-label="Testo alternativo"
              value={altText}
              onChange={(event) => setAltText(event.target.value)}
              maxLength={1000}
              rows={4}
              disabled={locked}
              required
              aria-describedby="visual-upload-alt-help"
            />
            <span id="visual-upload-alt-help" className={styles.help}>
              Descrivi ciò che serve a comprendere l’immagine senza vederla.
            </span>
          </label>
        </div>
      </div>

      {progress && <p role="status">{progress}</p>}
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}

      <div className={styles.actions}>
        <button type="button" onClick={() => void abandonAndClose('back')} disabled={busy}>
          Indietro
        </button>
        <button type="button" className="btn-primary" onClick={() => void submit()} disabled={busy}>
          {promoted ? 'Aggiorna lezione' : attemptStarted ? 'Riprova upload' : 'Carica e applica'}
        </button>
      </div>
    </DialogShell>
  );
}
