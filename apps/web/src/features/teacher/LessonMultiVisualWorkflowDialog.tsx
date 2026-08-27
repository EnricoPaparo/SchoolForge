import { useMemo, useState } from 'react';
import { DialogShell } from '../../components/DialogShell.js';
import {
  createMultiVisualClient,
  type MultiVisualPlan,
  type MultiVisualPlanRequest,
} from '../repository/programs/multiVisualClient.js';
import type { Functions } from 'firebase/functions';
import styles from './LessonMultiVisualWorkflowDialog.module.css';

export function LessonMultiVisualWorkflowDialog({
  functions,
  identity,
  lessonAi,
  existingCount,
  headings,
  onRefresh,
  onClose,
}: {
  functions: Functions;
  identity: { programId: string; importId: string; lessonId: string };
  lessonAi: {
    titolo?: string | null;
    sottotitolo?: string | null;
    difficolta?: string | null;
    concettiChiave?: string[];
    obiettivi?: string[];
    udaTitle?: string | null;
    udaContext?: unknown;
  };
  existingCount: number;
  headings: { text: string; index: number }[];
  onRefresh: () => Promise<void>;
  onClose: () => void;
}) {
  const client = useMemo(() => createMultiVisualClient(functions), [functions]);
  const requestId = useMemo(() => crypto.randomUUID(), []);
  const ceiling = Math.min(3 - existingCount, 3) as 1 | 2 | 3;
  const [plan, setPlan] = useState<MultiVisualPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function authorize() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const input: MultiVisualPlanRequest = {
        ...identity,
        requestId,
        quantity: { mode: 'exact', ceiling },
        titolo: lessonAi.titolo,
        sottotitolo: lessonAi.sottotitolo,
        difficolta: lessonAi.difficolta,
        concettiChiave: lessonAi.concettiChiave ?? [],
        obiettivi: lessonAi.obiettivi ?? [],
        udaTitle: lessonAi.udaTitle,
        udaContext: lessonAi.udaContext,
      };
      setPlan((await client.authorize(input)).plan);
    } catch {
      setError('Impossibile preparare le immagini. Riprova.');
    } finally {
      setBusy(false);
    }
  }

  async function generate(slotIndex: number) {
    if (!plan || busy) return;
    setBusy(true);
    setError(null);
    try {
      setPlan((await client.generateSlot({ requestId: plan.requestId, slotIndex })).plan);
    } catch {
      setError(
        'Impossibile generare questa immagine. Riprova senza costi aggiuntivi se il tentativo è già concluso.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function promote(slotIndex: number) {
    if (!plan || busy) return;
    const slot = plan.slots.find((item) => item.slotIndex === slotIndex);
    if (!slot?.staged) return;
    const heading = headings.find((item) => item.index === slot.anchorHeadingIndex) ?? headings[0];
    if (!heading) {
      setError('Serve almeno un titolo H2 o H3 nella lezione.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      setPlan(
        (
          await client.promoteSlot({
            requestId: plan.requestId,
            slotIndex,
            anchorHeadingIndex: heading.index,
            anchorHeadingText: heading.text,
            caption: slot.caption ?? 'Illustrazione della lezione',
            altText: slot.altText ?? slot.subject ?? 'Illustrazione della lezione',
          })
        ).plan,
      );
      await onRefresh();
    } catch {
      setError('Impossibile applicare questa immagine. Nessun dato è stato modificato.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <DialogShell
      title="Aggiungi immagini alla lezione"
      onCancel={onClose}
      busy={busy}
      variant="wide-scroll"
    >
      {!plan ? (
        <>
          <p>
            Puoi aggiungere fino a {ceiling} immagini. La proposta e ogni immagine hanno una
            conferma e un costo separati.
          </p>
          {error && (
            <p role="alert" className={styles.error}>
              {error}
            </p>
          )}
          <div className={styles.actions}>
            <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>
              Annulla
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={() => void authorize()}
              disabled={busy}
            >
              Stima immagini
            </button>
          </div>
        </>
      ) : (
        <>
          <p>
            Proposta pronta. Genera le immagini una alla volta: i tentativi già conclusi non vengono
            ripetuti.
          </p>
          {error && (
            <p role="alert" className={styles.error}>
              {error}
            </p>
          )}
          <div className={styles.slots}>
            {plan.slots.map((slot) => (
              <article key={slot.slotIndex} className={styles.slot}>
                <h4>Immagine {slot.slotIndex + 1}</h4>
                <p>{slot.subject ?? 'Nessuna immagine proposta'}</p>
                {slot.staged ? <img src={slot.staged.dataUri} alt="Anteprima proposta" /> : null}
                {slot.promotedAssetId ? (
                  <p className={styles.success}>Applicata alla lezione.</p>
                ) : (
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={() =>
                      void (slot.staged ? promote(slot.slotIndex) : generate(slot.slotIndex))
                    }
                    disabled={busy || slot.decision === 'none'}
                  >
                    {slot.staged ? 'Applica immagine' : 'Genera immagine'}
                  </button>
                )}
              </article>
            ))}
          </div>
          <div className={styles.actions}>
            <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>
              Chiudi
            </button>
          </div>
        </>
      )}
    </DialogShell>
  );
}
