import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { DialogShell } from '../../components/DialogShell.js';
import { formatMicroUsd } from '../repository/pools/aiContentClient.js';
import {
  describeVisualWorkflowError,
  visualErrorDisposition,
  type VisualErrorDisposition,
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
  | 'current'
  | 'proposal-previewing'
  | 'proposal-confirm'
  | 'proposal-generating'
  | 'proposal'
  | 'none'
  | 'image-previewing'
  | 'image-preview-error'
  | 'image-confirm'
  | 'image-generating'
  | 'image-generate-error'
  | 'image-review'
  | 'promoting'
  | 'error'
  | 'removing';

type Attempt =
  | { status: 'none' }
  | { status: 'bound'; requestId: string; subject: string }
  | { status: 'previewed'; requestId: string; subject: string; preview: VisualImagePreview }
  | {
      status: 'generated';
      requestId: string;
      subject: string;
      preview: VisualImagePreview;
      image: VisualImageGenerate;
    };

type Confirmation =
  | { kind: 'abandon'; returnPhase: Phase }
  | { kind: 'remove'; returnPhase: Phase }
  | null;

export type CurrentVisualBytesState =
  | { status: 'ready'; dataUri: string }
  | { status: 'loading' }
  | { status: 'unavailable' };

export interface VisualHeading {
  text: string;
  index: number;
}

export function LessonVisualWorkflowDialog({
  proposalRequest,
  identity,
  headings,
  currentManifest,
  currentBytes,
  ports,
  onRefresh,
  onClose,
}: {
  proposalRequest: VisualProposalRequest;
  identity: VisualIdentity;
  headings: VisualHeading[];
  currentManifest: LessonVisualPrivateManifest | null;
  currentBytes: CurrentVisualBytesState | null;
  ports: VisualWorkflowPorts;
  onRefresh: () => Promise<void>;
  onClose: () => void;
}) {
  const [phase, setPhase] = useState<Phase>(currentManifest ? 'current' : 'proposal-previewing');
  const [proposalPreview, setProposalPreview] = useState<VisualProposalPreview | null>(null);
  const [proposal, setProposal] = useState<VisualProposal | null>(null);
  const [proposalActualCost, setProposalActualCost] = useState<number | null | undefined>(
    undefined,
  );
  const [subject, setSubject] = useState('');
  const [headingIndex, setHeadingIndex] = useState(headings[0]?.index ?? 0);
  const [caption, setCaption] = useState('');
  const [altText, setAltText] = useState('');
  const [attempt, setAttempt] = useState<Attempt>({ status: 'none' });
  const [error, setError] = useState<string | null>(null);
  const [generateDisposition, setGenerateDisposition] = useState<VisualErrorDisposition | null>(
    null,
  );
  const [confirmation, setConfirmation] = useState<Confirmation>(null);
  const mounted = useRef(true);
  const action = useRef(false);
  const proposalRequestRef = useRef(proposalRequest);
  const proposalPreviewPromise = useRef<ReturnType<VisualWorkflowPorts['previewProposal']> | null>(
    null,
  );
  const confirmBackRef = useRef<HTMLButtonElement>(null);

  const selectedHeading = headings.find((item) => item.index === headingIndex) ?? headings[0];
  const candidateBound = attempt.status !== 'none';
  const imagePreview =
    attempt.status === 'previewed' || attempt.status === 'generated' ? attempt.preview : null;
  const image = attempt.status === 'generated' ? attempt.image : null;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (currentManifest) return;
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
        proposalPreviewPromise.current = null;
        setError(describeVisualWorkflowError(cause));
        setPhase('error');
      });
    return () => {
      active = false;
    };
  }, [currentManifest, ports]);

  useEffect(() => {
    if (confirmation) confirmBackRef.current?.focus({ preventScroll: true });
  }, [confirmation]);

  async function once(run: () => Promise<void>) {
    if (action.current) return;
    action.current = true;
    try {
      await run();
    } finally {
      action.current = false;
    }
  }

  function consumeProposalPreview() {
    setPhase('proposal-previewing');
    setError(null);
    proposalPreviewPromise.current ??= ports.previewProposal(proposalRequestRef.current);
    void proposalPreviewPromise.current
      .then((result) => {
        if (!mounted.current) return;
        setProposalPreview(result);
        setPhase('proposal-confirm');
      })
      .catch((cause) => {
        if (!mounted.current) return;
        proposalPreviewPromise.current = null;
        setError(describeVisualWorkflowError(cause));
        setPhase('error');
      });
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
        setProposalActualCost(result.actualCostMicroUsd);
        if (nextProposal.decision === 'none') {
          setPhase('none');
          return;
        }
        setSubject(nextProposal.subject);
        setCaption(nextProposal.caption);
        setAltText(nextProposal.altText);
        setHeadingIndex(
          headings.find((heading) => heading.text === nextProposal.anchorHeadingText)?.index ??
            headings[0]?.index ??
            0,
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

  async function previewImage() {
    await once(async () => {
      const live = attempt.status === 'bound' ? attempt : null;
      let bound = live !== null;
      const requestId = live?.requestId ?? crypto.randomUUID();
      const attemptSubject = live?.subject ?? subject;
      setPhase('image-previewing');
      setError(null);
      try {
        if (!live) {
          await ports.bind({ ...identity, requestId });
          if (!mounted.current) return;
          setAttempt({ status: 'bound', requestId, subject: attemptSubject });
          bound = true;
        }
        const result = await ports.previewImage({ requestId, subject: attemptSubject });
        if (!mounted.current) return;
        setAttempt({ status: 'previewed', requestId, subject: attemptSubject, preview: result });
        setPhase('image-confirm');
      } catch (cause) {
        if (!mounted.current) return;
        setError(describeVisualWorkflowError(cause));
        setPhase(bound ? 'image-preview-error' : 'proposal');
      }
    });
  }

  async function generateImage() {
    if (attempt.status !== 'previewed') return;
    const live = attempt;
    await once(async () => {
      setPhase('image-generating');
      setError(null);
      setGenerateDisposition(null);
      try {
        const result = await ports.generateImage({
          requestId: live.requestId,
          subject: live.subject,
        });
        if (!mounted.current) return;
        setAttempt({ ...live, status: 'generated', image: result });
        setPhase('image-review');
      } catch (cause) {
        if (!mounted.current) return;
        setError(describeVisualWorkflowError(cause));
        setGenerateDisposition(visualErrorDisposition(cause));
        setPhase('image-generate-error');
      }
    });
  }

  async function promote() {
    if (attempt.status !== 'generated' || !selectedHeading) return;
    await once(async () => {
      setPhase('promoting');
      setError(null);
      try {
        await ports.promote({
          ...identity,
          requestId: attempt.requestId,
          anchorHeadingText: selectedHeading.text,
          anchorHeadingIndex: selectedHeading.index,
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

  async function abandonAnd(next: 'close' | 'edit' | 'regenerate') {
    if (attempt.status === 'none') {
      if (next === 'close') onClose();
      else setPhase('proposal');
      return;
    }
    const requestId = attempt.requestId;
    let abandoned = false;
    await once(async () => {
      try {
        await ports.abandon(requestId);
        if (!mounted.current) return;
        abandoned = true;
        setAttempt({ status: 'none' });
        setConfirmation(null);
        setError(null);
        if (next === 'close') onClose();
        else setPhase('proposal');
      } catch (cause) {
        if (mounted.current) {
          setError(describeVisualWorkflowError(cause));
          setConfirmation(null);
        }
      }
    });
    if (abandoned && next === 'regenerate') await previewImage();
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
          setPhase('current');
          setConfirmation(null);
        }
      }
    });
  }

  function requestClose() {
    if (action.current) return;
    if (candidateBound) setConfirmation({ kind: 'abandon', returnPhase: phase });
    else onClose();
  }

  async function refreshUncertain() {
    await once(async () => {
      try {
        await onRefresh();
        if (mounted.current) onClose();
      } catch (cause) {
        if (mounted.current) setError(describeVisualWorkflowError(cause));
      }
    });
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
  const confirmationTitle =
    confirmation?.kind === 'abandon'
      ? 'Abbandonare l’anteprima?'
      : confirmation?.kind === 'remove'
        ? 'Rimuovere l’immagine attuale?'
        : null;

  return (
    <DialogShell
      title={
        confirmationTitle ?? (currentManifest ? 'Gestisci immagine della lezione' : 'Arricchisci')
      }
      role={confirmation ? 'alertdialog' : 'dialog'}
      onCancel={() => {
        if (confirmation) setConfirmation(null);
        else requestClose();
      }}
      busy={busy}
      variant="wide-scroll"
      closeOnBackdrop
      closeOnEscape
    >
      {confirmation ? (
        <ConfirmationView
          kind={confirmation.kind}
          backRef={confirmBackRef}
          onBack={() => {
            setPhase(confirmation.returnPhase);
            setConfirmation(null);
          }}
          onConfirm={() => void (confirmation.kind === 'abandon' ? abandonAnd('close') : remove())}
        />
      ) : (
        <>
          <p className={styles.intro}>
            Profilo fisso: <strong>Quality</strong>. Proposta testuale e immagine hanno costi e
            conferme separate.
          </p>
          {busy && <Busy />}
          {phase === 'current' && currentManifest && (
            <CurrentView
              manifest={currentManifest}
              bytes={currentBytes}
              onPropose={consumeProposalPreview}
              onRemove={() => setConfirmation({ kind: 'remove', returnPhase: 'current' })}
              onClose={onClose}
            />
          )}
          {phase === 'proposal-confirm' && proposalPreview && (
            <>
              <CostRows preview={proposalPreview} />
              <Actions>
                <button onClick={requestClose}>Annulla</button>
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
              <ProposalCost actual={proposalActualCost} />
              <Actions>
                <button className="btn-primary" onClick={onClose}>
                  Chiudi
                </button>
              </Actions>
            </>
          )}
          {phase === 'proposal' && proposal?.decision === 'image' && (
            <ProposalEditor
              proposal={proposal}
              proposalActualCost={proposalActualCost}
              subject={subject}
              onSubject={setSubject}
              headingIndex={headingIndex}
              onHeadingIndex={setHeadingIndex}
              headings={headings}
              caption={caption}
              onCaption={setCaption}
              altText={altText}
              onAltText={setAltText}
              currentManifest={currentManifest}
              onRemove={() => setConfirmation({ kind: 'remove', returnPhase: 'proposal' })}
              onCancel={requestClose}
              onPreview={() => void previewImage()}
            />
          )}
          {phase === 'image-preview-error' && attempt.status === 'bound' && (
            <>
              <p>Il candidato resta associato a questo tentativo.</p>
              <Actions>
                <button onClick={() => void abandonAnd('edit')}>Modifica soggetto</button>
                <button className="btn-primary" onClick={() => void previewImage()}>
                  Riprova stima
                </button>
              </Actions>
            </>
          )}
          {phase === 'image-confirm' && imagePreview && (
            <>
              <ProposalCost actual={proposalActualCost} />
              <h4>Conferma generazione immagine</h4>
              <ul>
                <li>Preset: SchoolForge Sketch v1</li>
                <li>
                  Costo stimato immagine: {formatMicroUsd(imagePreview.estimatedCostMicroUsd)}
                </li>
                <li>
                  Tetto prenotabile immagine: {formatMicroUsd(imagePreview.reservationCostMicroUsd)}
                </li>
              </ul>
              <Actions>
                <button onClick={() => void abandonAnd('edit')}>Modifica soggetto</button>
                <button className="btn-primary" onClick={() => void generateImage()}>
                  Genera immagine
                </button>
              </Actions>
            </>
          )}
          {phase === 'image-generate-error' && attempt.status === 'previewed' && (
            <GenerateErrorActions
              disposition={generateDisposition}
              onRetry={() => void generateImage()}
              onAbandon={() => void abandonAnd('edit')}
              onRefresh={() => void refreshUncertain()}
              onClose={requestClose}
            />
          )}
          {phase === 'image-review' && attempt.status === 'generated' && image && (
            <>
              <p role="status">
                <strong>Anteprima — non ancora applicata</strong>
              </p>
              <ProposalCost actual={proposalActualCost} />
              <div className={currentManifest ? styles.comparison : undefined}>
                {currentManifest && (
                  <Preview
                    title="Immagine attuale"
                    manifest={currentManifest}
                    bytes={currentBytes}
                  />
                )}
                <figure className={styles.preview}>
                  <h4 className={styles.previewTitle}>Nuova proposta</h4>
                  <div className={styles.previewFrame} style={imageStyle} data-visual-frame>
                    <img
                      src={image.dataUri}
                      alt={altText}
                      width={image.width}
                      height={image.height}
                    />
                  </div>
                  <figcaption>{caption}</figcaption>
                </figure>
              </div>
              <ul>
                <li>
                  {image.width} × {image.height}px · {image.byteLength.toLocaleString('it-IT')} byte
                </li>
                <li>
                  {image.actualCostMicroUsd === null
                    ? `Costo immagine regolato: ${formatMicroUsd(image.settledCostMicroUsd)}`
                    : `Costo reale immagine: ${formatMicroUsd(image.actualCostMicroUsd)}`}
                </li>
              </ul>
              <EditorialFields
                headings={headings}
                headingIndex={headingIndex}
                onHeadingIndex={setHeadingIndex}
                caption={caption}
                onCaption={setCaption}
                altText={altText}
                onAltText={setAltText}
              />
              <Actions layout="review">
                <button onClick={() => void abandonAnd('edit')}>Modifica soggetto</button>
                <button onClick={() => void abandonAnd('regenerate')}>Rigenera</button>
                <button
                  onClick={() => setConfirmation({ kind: 'abandon', returnPhase: 'image-review' })}
                >
                  Abbandona
                </button>
                <button
                  className="btn-primary"
                  disabled={!caption || !altText || !selectedHeading}
                  onClick={() => void promote()}
                >
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
              <button className="btn-primary" onClick={consumeProposalPreview}>
                Riprova preview
              </button>
            </Actions>
          )}
        </>
      )}
    </DialogShell>
  );
}

function Busy() {
  return (
    <div role="status" aria-live="polite" aria-busy="true" className="loading-row">
      <span className="spinner" aria-hidden="true" />
      <span>Operazione in corso…</span>
    </div>
  );
}

function Actions({
  children,
  layout = 'default',
}: {
  children: ReactNode;
  layout?: 'default' | 'review';
}) {
  return (
    <div
      className={`dialog-actions ${styles.actions} ${layout === 'review' ? styles.reviewActions : ''}`}
      data-action-layout={layout}
    >
      {children}
    </div>
  );
}

function CostRows({ preview }: { preview: VisualProposalPreview }) {
  return (
    <>
      <h4>Stima della proposta testuale</h4>
      <ul>
        <li>Profilo: Quality</li>
        <li>Token stimati: {preview.estimatedInputTokens + preview.maxOutputTokens}</li>
        <li>Costo stimato proposta: {formatMicroUsd(preview.estimatedCostMicroUsd)}</li>
        <li>Tetto prenotabile proposta: {formatMicroUsd(preview.reservationCostMicroUsd)}</li>
      </ul>
    </>
  );
}

function ProposalCost({ actual }: { actual: number | null | undefined }) {
  if (actual === undefined) return null;
  return (
    <p className={styles.costSeparation}>
      <strong>Spesa proposta testuale:</strong>{' '}
      {actual === null
        ? 'costo esatto non disponibile; regolazione server conservativa'
        : formatMicroUsd(actual)}
    </p>
  );
}

function CurrentView({
  manifest,
  bytes,
  onPropose,
  onRemove,
  onClose,
}: {
  manifest: LessonVisualPrivateManifest;
  bytes: CurrentVisualBytesState | null;
  onPropose: () => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const unavailable = bytes?.status === 'unavailable';
  const loading = bytes?.status !== 'ready' && !unavailable;
  return (
    <>
      <Preview title="Immagine attuale" manifest={manifest} bytes={bytes} />
      <p>
        <strong>Posizione:</strong> {manifest.anchor.headingText}
      </p>
      {loading && (
        <p role="status">
          Attendi il caricamento dell’immagine prima di proporre una sostituzione.
        </p>
      )}
      {unavailable && (
        <p role="alert">
          L’immagine corrente non è leggibile. La sostituzione è bloccata; puoi comunque rimuoverla.
        </p>
      )}
      <Actions>
        <button className="btn-danger" onClick={onRemove}>
          Rimuovi immagine
        </button>
        <button onClick={onClose}>Chiudi</button>
        <button className="btn-primary" disabled={loading || unavailable} onClick={onPropose}>
          Proponi una sostituzione
        </button>
      </Actions>
    </>
  );
}

function ProposalEditor(props: {
  proposal: Extract<VisualProposal, { decision: 'image' }>;
  proposalActualCost: number | null | undefined;
  subject: string;
  onSubject: (value: string) => void;
  headingIndex: number;
  onHeadingIndex: (value: number) => void;
  headings: VisualHeading[];
  caption: string;
  onCaption: (value: string) => void;
  altText: string;
  onAltText: (value: string) => void;
  currentManifest: LessonVisualPrivateManifest | null;
  onRemove: () => void;
  onCancel: () => void;
  onPreview: () => void;
}) {
  return (
    <>
      <ProposalCost actual={props.proposalActualCost} />
      <label className={`${styles.field} ${styles.subjectField}`}>
        Cosa deve mostrare l’immagine
        <textarea
          value={props.subject}
          onChange={(event) => props.onSubject(event.target.value)}
          rows={4}
        />
      </label>
      <p>
        <strong>Utilità didattica:</strong> {props.proposal.rationale}
      </p>
      <EditorialFields
        headings={props.headings}
        headingIndex={props.headingIndex}
        onHeadingIndex={props.onHeadingIndex}
        caption={props.caption}
        onCaption={props.onCaption}
        altText={props.altText}
        onAltText={props.onAltText}
      />
      <Actions>
        {props.currentManifest && (
          <button className="btn-danger" onClick={props.onRemove}>
            Rimuovi immagine
          </button>
        )}
        <button onClick={props.onCancel}>Annulla</button>
        <button
          className="btn-primary"
          disabled={!props.subject || !props.caption || !props.altText}
          onClick={props.onPreview}
        >
          Stima immagine
        </button>
      </Actions>
    </>
  );
}

function EditorialFields(props: {
  headings: VisualHeading[];
  headingIndex: number;
  onHeadingIndex: (value: number) => void;
  caption: string;
  onCaption: (value: string) => void;
  altText: string;
  onAltText: (value: string) => void;
}) {
  return (
    <div className={styles.editorialFields}>
      <label className={styles.field}>
        Posizione
        <select
          value={props.headingIndex}
          onChange={(event) => props.onHeadingIndex(Number(event.target.value))}
        >
          {props.headings.map((heading) => (
            <option key={heading.index} value={heading.index}>
              {headingLabel(heading, props.headings)}
            </option>
          ))}
        </select>
      </label>
      <label className={styles.field}>
        Didascalia
        <textarea
          value={props.caption}
          onChange={(event) => props.onCaption(event.target.value)}
          rows={2}
        />
      </label>
      <label className={styles.field}>
        Testo alternativo
        <textarea
          value={props.altText}
          onChange={(event) => props.onAltText(event.target.value)}
          rows={3}
        />
      </label>
    </div>
  );
}

function headingLabel(heading: VisualHeading, headings: VisualHeading[]): string {
  const equal = headings.filter((item) => item.text === heading.text);
  if (equal.length === 1) return heading.text;
  const occurrence = equal.findIndex((item) => item.index === heading.index) + 1;
  const labels = ['prima', 'seconda', 'terza'];
  return `${heading.text} — ${labels[occurrence - 1] ?? `${occurrence}ª`} occorrenza`;
}

function Preview({
  title,
  manifest,
  bytes,
}: {
  title: string;
  manifest: LessonVisualPrivateManifest;
  bytes: CurrentVisualBytesState | null;
}) {
  return (
    <figure className={styles.preview}>
      <h4 className={styles.previewTitle}>{title}</h4>
      <div
        className={styles.previewFrame}
        style={{ aspectRatio: `${manifest.width} / ${manifest.height}` }}
        data-visual-frame
      >
        {bytes?.status === 'ready' ? (
          <img
            src={bytes.dataUri}
            alt={manifest.altText}
            width={manifest.width}
            height={manifest.height}
          />
        ) : (
          <div className={styles.placeholder}>
            {bytes?.status === 'unavailable' ? 'Immagine non disponibile' : 'Caricamento immagine…'}
          </div>
        )}
      </div>
      <figcaption>{manifest.caption}</figcaption>
    </figure>
  );
}

function GenerateErrorActions({
  disposition,
  onRetry,
  onAbandon,
  onRefresh,
  onClose,
}: {
  disposition: VisualErrorDisposition | null;
  onRetry: () => void;
  onAbandon: () => void;
  onRefresh: () => void;
  onClose: () => void;
}) {
  if (disposition === 'uncertain') {
    return (
      <Actions>
        <button className="btn-primary" onClick={onRefresh}>
          Aggiorna stato e chiudi
        </button>
      </Actions>
    );
  }
  if (disposition === 'terminal') {
    return (
      <Actions>
        <button className="btn-danger" onClick={onAbandon}>
          Abbandona tentativo
        </button>
      </Actions>
    );
  }
  if (disposition === 'blocked') {
    return (
      <Actions>
        <button onClick={onClose}>Chiudi</button>
        <button className="btn-primary" onClick={onRetry}>
          Riprova sullo stesso tentativo
        </button>
      </Actions>
    );
  }
  return (
    <Actions>
      <button onClick={onClose}>Chiudi</button>
      <button className="btn-primary" onClick={onRetry}>
        Verifica o riprova lo stesso tentativo
      </button>
    </Actions>
  );
}

function ConfirmationView({
  kind,
  backRef,
  onBack,
  onConfirm,
}: {
  kind: 'abandon' | 'remove';
  backRef: React.RefObject<HTMLButtonElement>;
  onBack: () => void;
  onConfirm: () => void;
}) {
  return (
    <>
      <p>
        {kind === 'abandon'
          ? 'Il candidato e lo staging verranno eliminati.'
          : 'L’immagine sarà rimossa dalla lezione e dalla proiezione pubblica.'}
      </p>
      <Actions>
        <button ref={backRef} type="button" onClick={onBack}>
          Torna all’anteprima
        </button>
        <button type="button" className="btn-danger" onClick={onConfirm}>
          {kind === 'abandon' ? 'Abbandona ed elimina' : 'Rimuovi immagine'}
        </button>
      </Actions>
    </>
  );
}
