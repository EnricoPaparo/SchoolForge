import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { DialogShell } from '../../components/DialogShell.js';
import { formatMicroUsd } from '../repository/pools/aiContentClient.js';
import {
  describeVisualWorkflowError,
  type VisualIdentity,
  type VisualImageGenerate,
  type VisualImagePreview,
  type VisualProposal,
  type VisualProposalRequest,
  type VisualProposalPreview,
  type VisualWorkflowPorts,
} from '../repository/programs/visualGenerationClient.js';
import type { LessonVisualPrivateManifest } from '../../types/firestore.js';
import styles from './LessonVisualWorkflowDialog.module.css';

type Phase =
  | 'proposal-previewing'
  | 'proposal-confirm'
  | 'proposal-generating'
  | 'proposal'
  | 'none'
  | 'image-previewing'
  | 'image-confirm'
  | 'image-generating'
  | 'image-review'
  | 'promoting'
  | 'error'
  | 'removing';

export interface VisualHeading {
  text: string;
  index: number;
}

export function LessonVisualWorkflowDialog({
  proposalRequest,
  identity,
  headings,
  currentManifest,
  currentDataUri,
  ports,
  onRefresh,
  onClose,
}: {
  proposalRequest: VisualProposalRequest;
  identity: VisualIdentity;
  headings: VisualHeading[];
  currentManifest: LessonVisualPrivateManifest | null;
  currentDataUri: string | null;
  ports: VisualWorkflowPorts;
  onRefresh: () => Promise<void>;
  onClose: () => void;
}) {
  const [phase, setPhase] = useState<Phase>('proposal-previewing');
  const [proposalPreview, setProposalPreview] = useState<VisualProposalPreview | null>(null);
  const [proposal, setProposal] = useState<VisualProposal | null>(null);
  const [subject, setSubject] = useState('');
  const [heading, setHeading] = useState(headings[0]?.text ?? '');
  const [caption, setCaption] = useState('');
  const [altText, setAltText] = useState('');
  const [requestId, setRequestId] = useState<string | null>(null);
  const [candidateBound, setCandidateBound] = useState(false);
  const [imagePreview, setImagePreview] = useState<VisualImagePreview | null>(null);
  const [image, setImage] = useState<VisualImageGenerate | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAbandon, setShowAbandon] = useState(false);
  const [showRemove, setShowRemove] = useState(false);
  const mounted = useRef(true);
  const action = useRef(false);
  const proposalRequestRef = useRef(proposalRequest);
  const proposalPreviewPromise = useRef<ReturnType<VisualWorkflowPorts['previewProposal']> | null>(
    null,
  );
  const staged = candidateBound;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    let active = true;
    proposalPreviewPromise.current ??= ports.previewProposal(proposalRequestRef.current);
    void proposalPreviewPromise.current
      .then((result) => {
        if (!active || !mounted.current) return;
        setProposalPreview(result);
        setPhase('proposal-confirm');
      })
      .catch((cause) => {
        if (!active || !mounted.current) return;
        setError(describeVisualWorkflowError(cause));
        setPhase('error');
      });
    return () => {
      active = false;
    };
  }, [ports]);

  async function once(run: () => Promise<void>) {
    if (action.current) return;
    action.current = true;
    try {
      await run();
    } finally {
      action.current = false;
    }
  }

  async function generateProposal() {
    await once(async () => {
      setPhase('proposal-generating');
      setError(null);
      try {
        const result = await ports.generateProposal(proposalRequestRef.current);
        if (!mounted.current) return;
        const nextProposal = result.output;
        setProposal(nextProposal);
        if (nextProposal.decision === 'none') {
          setPhase('none');
          return;
        }
        setSubject(nextProposal.subject);
        setCaption(nextProposal.caption);
        setAltText(nextProposal.altText);
        setHeading(
          headings.some((h) => h.text === nextProposal.anchorHeadingText)
            ? nextProposal.anchorHeadingText
            : (headings[0]?.text ?? ''),
        );
        setPhase('proposal');
      } catch (cause) {
        if (mounted.current) {
          setError(describeVisualWorkflowError(cause));
          setPhase('proposal-confirm');
        }
      }
    });
  }

  async function previewImage(newAttempt = false) {
    await once(async () => {
      const id = newAttempt || !requestId ? crypto.randomUUID() : requestId;
      setRequestId(id);
      setPhase('image-previewing');
      setError(null);
      try {
        await ports.bind({ ...identity, requestId: id });
        if (!mounted.current) return;
        setCandidateBound(true);
        const result = await ports.previewImage({ requestId: id, subject });
        if (!mounted.current) return;
        setImagePreview(result);
        setPhase('image-confirm');
      } catch (cause) {
        if (mounted.current) {
          setError(describeVisualWorkflowError(cause));
          setPhase('proposal');
        }
      }
    });
  }

  async function generateImage() {
    if (!requestId) return;
    await once(async () => {
      setPhase('image-generating');
      setError(null);
      try {
        const result = await ports.generateImage({ requestId, subject });
        if (!mounted.current) return;
        setImage(result);
        setPhase('image-review');
      } catch (cause) {
        if (mounted.current) {
          setError(describeVisualWorkflowError(cause));
          // Una risposta persa può nascondere un run completato: il pulsante
          // resta disponibile e il retry usa lo stesso requestId (replay server).
          setPhase('image-confirm');
        }
      }
    });
  }

  async function promote() {
    if (!requestId) return;
    await once(async () => {
      setPhase('promoting');
      setError(null);
      try {
        await ports.promote({
          ...identity,
          requestId,
          anchorHeadingText: heading,
          caption,
          altText,
        });
        await onRefresh();
        if (mounted.current) onClose();
      } catch (cause) {
        if (mounted.current) {
          setError(describeVisualWorkflowError(cause));
          setPhase('image-review');
        }
      }
    });
  }

  async function abandon() {
    if (!requestId) return onClose();
    await once(async () => {
      try {
        await ports.abandon(requestId);
        if (mounted.current) onClose();
      } catch (cause) {
        if (mounted.current) {
          setError(describeVisualWorkflowError(cause));
          setShowAbandon(false);
        }
      }
    });
  }

  async function discardCandidate(next: 'edit' | 'regenerate') {
    if (!requestId) {
      if (next === 'edit') setPhase('proposal');
      else await previewImage(true);
      return;
    }
    let discarded = false;
    await once(async () => {
      try {
        await ports.abandon(requestId);
        if (!mounted.current) return;
        discarded = true;
        setImage(null);
        setImagePreview(null);
        setRequestId(null);
        setCandidateBound(false);
        if (next === 'edit') setPhase('proposal');
      } catch (cause) {
        if (mounted.current) setError(describeVisualWorkflowError(cause));
      }
    });
    if (discarded && next === 'regenerate') await previewImage(true);
  }

  async function remove() {
    await once(async () => {
      setPhase('removing');
      try {
        await ports.remove(identity);
        await onRefresh();
        if (mounted.current) onClose();
      } catch (cause) {
        if (mounted.current) {
          setError(describeVisualWorkflowError(cause));
          setPhase('proposal');
          setShowRemove(false);
        }
      }
    });
  }

  function requestClose() {
    if (action.current) return;
    if (staged) setShowAbandon(true);
    else onClose();
  }
  function invalidatePreview(value: string) {
    setSubject(value);
    setImagePreview(null);
    setRequestId(null);
    setPhase('proposal');
  }
  const busy = [
    'proposal-previewing',
    'proposal-generating',
    'image-previewing',
    'image-generating',
    'promoting',
    'removing',
  ].includes(phase);
  const imageStyle = useMemo(
    () => (image ? { aspectRatio: `${image.width} / ${image.height}` } : undefined),
    [image],
  );

  return (
    <DialogShell
      title={currentManifest ? 'Gestisci immagine della lezione' : 'Arricchisci visivamente'}
      onCancel={requestClose}
      busy={busy}
      variant="wide-scroll"
      closeOnBackdrop
      closeOnEscape
    >
      <p className={styles.intro}>
        Profilo fisso: <strong>Quality</strong>. Proposta testuale e immagine hanno costi e conferme
        separate.
      </p>
      {busy && (
        <div role="status" aria-live="polite" aria-busy="true" className="loading-row">
          <span className="spinner" aria-hidden="true" />
          <span>Operazione in corso…</span>
        </div>
      )}
      {phase === 'proposal-confirm' && proposalPreview && (
        <>
          <CostRows preview={proposalPreview} />
          <Actions>
            <button onClick={onClose}>Annulla</button>
            <button className="btn-primary" onClick={() => void generateProposal()}>
              Genera proposta
            </button>
          </Actions>
        </>
      )}
      {phase === 'none' && proposal?.decision === 'none' && (
        <>
          <h4>Nessuna immagine utile</h4>
          <p>{proposal.reason}</p>
          <Actions>
            <button className="btn-primary" onClick={onClose}>
              Chiudi
            </button>
          </Actions>
        </>
      )}
      {(phase === 'proposal' || (phase === 'error' && proposal?.decision === 'image')) &&
        proposal?.decision === 'image' && (
          <>
            <label className={styles.field}>
              Cosa deve mostrare l’immagine
              <textarea
                value={subject}
                onChange={(e) => invalidatePreview(e.target.value)}
                rows={4}
              />
            </label>
            <p>
              <strong>Utilità didattica:</strong> {proposal.rationale}
            </p>
            <label className={styles.field}>
              Posizione
              <select value={heading} onChange={(e) => setHeading(e.target.value)}>
                {headings.map((h) => (
                  <option key={`${h.index}-${h.text}`} value={h.text}>
                    {h.text}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.field}>
              Didascalia
              <input value={caption} onChange={(e) => setCaption(e.target.value)} />
            </label>
            <label className={styles.field}>
              Testo alternativo
              <input value={altText} onChange={(e) => setAltText(e.target.value)} />
            </label>
            <Actions>
              {currentManifest && (
                <button className="btn-danger" onClick={() => setShowRemove(true)}>
                  Rimuovi immagine
                </button>
              )}
              <button onClick={requestClose}>Annulla</button>
              <button
                className="btn-primary"
                disabled={!subject || !heading || !caption || !altText}
                onClick={() => void previewImage(true)}
              >
                Stima immagine
              </button>
            </Actions>
          </>
        )}
      {phase === 'image-confirm' && imagePreview && (
        <>
          <h4>Conferma generazione immagine</h4>
          <ul>
            <li>Preset: SchoolForge Sketch v1</li>
            <li>Costo stimato: {formatMicroUsd(imagePreview.estimatedCostMicroUsd)}</li>
            <li>Tetto prenotabile: {formatMicroUsd(imagePreview.reservationCostMicroUsd)}</li>
          </ul>
          <Actions>
            <button onClick={() => void discardCandidate('edit')}>Modifica richiesta</button>
            <button className="btn-primary" onClick={() => void generateImage()}>
              Genera immagine
            </button>
          </Actions>
        </>
      )}
      {phase === 'image-review' && image && (
        <>
          <p role="status">
            <strong>Anteprima — non ancora applicata</strong>
          </p>
          <div className={currentManifest ? styles.comparison : undefined}>
            {currentManifest && (
              <Preview title="Immagine attuale" src={currentDataUri} manifest={currentManifest} />
            )}
            <figure className={styles.preview} style={imageStyle}>
              <strong>Nuova proposta</strong>
              <img src={image.dataUri} alt={altText} width={image.width} height={image.height} />
              <figcaption>{caption}</figcaption>
            </figure>
          </div>
          <ul>
            <li>
              {image.width} × {image.height}px · {image.byteLength.toLocaleString('it-IT')} byte
            </li>
            <li>
              {image.actualCostMicroUsd === null
                ? `Costo regolato: ${formatMicroUsd(image.settledCostMicroUsd)}`
                : `Costo reale: ${formatMicroUsd(image.actualCostMicroUsd)}`}
            </li>
            <li>Posizione: {heading}</li>
          </ul>
          <Actions>
            <button onClick={() => void discardCandidate('edit')}>Modifica richiesta</button>
            <button onClick={() => void discardCandidate('regenerate')}>Rigenera</button>
            <button onClick={() => setShowAbandon(true)}>Abbandona</button>
            <button className="btn-primary" onClick={() => void promote()}>
              {currentManifest ? 'Sostituisci l’immagine attuale' : 'Applica alla lezione'}
            </button>
          </Actions>
        </>
      )}
      {error && (
        <p role="alert" className="text-error">
          {error}
        </p>
      )}
      {phase === 'error' && !proposal && (
        <Actions>
          <button onClick={onClose}>Chiudi</button>
        </Actions>
      )}
      {showAbandon && (
        <Confirm
          title="Abbandonare l’anteprima?"
          confirm="Abbandona ed elimina"
          onBack={() => setShowAbandon(false)}
          onConfirm={() => void abandon()}
        />
      )}
      {showRemove && (
        <Confirm
          title="Rimuovere l’immagine attuale?"
          confirm="Rimuovi immagine"
          onBack={() => setShowRemove(false)}
          onConfirm={() => void remove()}
        />
      )}
    </DialogShell>
  );
}

function Actions({ children }: { children: ReactNode }) {
  return <div className={`dialog-actions ${styles.actions}`}>{children}</div>;
}
function CostRows({ preview }: { preview: VisualProposalPreview }) {
  return (
    <>
      <h4>Stima della proposta testuale</h4>
      <ul>
        <li>Profilo: Quality</li>
        <li>Token stimati: {preview.estimatedInputTokens + preview.maxOutputTokens}</li>
        <li>Costo stimato: {formatMicroUsd(preview.estimatedCostMicroUsd)}</li>
        <li>Tetto prenotabile: {formatMicroUsd(preview.reservationCostMicroUsd)}</li>
      </ul>
    </>
  );
}
function Preview({
  title,
  src,
  manifest,
}: {
  title: string;
  src: string | null;
  manifest: LessonVisualPrivateManifest;
}) {
  return (
    <figure
      className={styles.preview}
      style={{ aspectRatio: `${manifest.width} / ${manifest.height}` }}
    >
      <strong>{title}</strong>
      {src ? (
        <img src={src} alt={manifest.altText} width={manifest.width} height={manifest.height} />
      ) : (
        <div className={styles.placeholder}>Immagine non disponibile</div>
      )}
      <figcaption>{manifest.caption}</figcaption>
    </figure>
  );
}
function Confirm({
  title,
  confirm,
  onBack,
  onConfirm,
}: {
  title: string;
  confirm: string;
  onBack: () => void;
  onConfirm: () => void;
}) {
  return (
    <DialogShell title={title} role="alertdialog" onCancel={onBack}>
      <Actions>
        <button type="button" onClick={onBack}>
          Torna all’anteprima
        </button>
        <button type="button" className="btn-danger" onClick={onConfirm}>
          {confirm}
        </button>
      </Actions>
    </DialogShell>
  );
}
