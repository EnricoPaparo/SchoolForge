import { useMemo, useState } from 'react';
import { DialogShell } from '../../components/DialogShell.js';
import {
  createMultiVisualClient,
  type MultiVisualPlan,
  type MultiVisualPlanRequest,
  describeMultiVisualError,
} from '../repository/programs/multiVisualClient.js';
import type { Functions } from 'firebase/functions';
import type { LessonVisualPrivateManifest } from '../../types/firestore.js';
import styles from './LessonMultiVisualWorkflowDialog.module.css';

export function LessonMultiVisualWorkflowDialog({
  functions,
  identity,
  lessonAi,
  existingCount,
  currentVisuals,
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
  currentVisuals: LessonVisualPrivateManifest[];
  headings: { text: string; index: number }[];
  onRefresh: () => Promise<void>;
  onClose: () => void;
}) {
  const client = useMemo(() => createMultiVisualClient(functions), [functions]);
  const requestId = useMemo(() => crypto.randomUUID(), []);
  const freeSlots = Math.max(0, Math.min(3 - existingCount, 3));
  const ceiling = Math.max(1, freeSlots) as 1 | 2 | 3;
  const [quantityMode, setQuantityMode] = useState<'auto' | 'exact'>('auto');
  const [exactQuantity, setExactQuantity] = useState<1 | 2 | 3>(1);
  const [plan, setPlan] = useState<MultiVisualPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingSlot, setEditingSlot] = useState<number | null>(null);
  const [draft, setDraft] = useState({
    subject: '',
    caption: '',
    altText: '',
    anchorHeadingIndex: 0,
  });

  async function authorize() {
    if (busy) return;
    if (existingCount >= 3) return;
    const selectedCeiling =
      quantityMode === 'auto' ? ceiling : (Math.min(exactQuantity, ceiling) as 1 | 2 | 3);
    if (
      !window.confirm(
        `Confermi la proposta fino a ${selectedCeiling} immagini? Il costo massimo comprende proposta e generazioni.`,
      )
    )
      return;
    setBusy(true);
    setError(null);
    try {
      const input: MultiVisualPlanRequest = {
        ...identity,
        requestId,
        quantity: { mode: quantityMode, ceiling: selectedCeiling },
        titolo: lessonAi.titolo,
        sottotitolo: lessonAi.sottotitolo,
        difficolta: lessonAi.difficolta,
        concettiChiave: lessonAi.concettiChiave ?? [],
        obiettivi: lessonAi.obiettivi ?? [],
        udaTitle: lessonAi.udaTitle,
        udaContext: lessonAi.udaContext,
      };
      setPlan(await client.authorize(input));
    } catch (cause) {
      setError(describeMultiVisualError(cause));
    } finally {
      setBusy(false);
    }
  }

  async function generate(slotIndex: number) {
    if (!plan || busy) return;
    setBusy(true);
    setError(null);
    try {
      setPlan(await client.generateSlot({ ...identity, requestId: plan.requestId, slotIndex }));
    } catch (cause) {
      setError(describeMultiVisualError(cause));
    } finally {
      setBusy(false);
    }
  }

  async function promote(slotIndex: number) {
    if (!plan || busy) return;
    const slot = plan.slots.find((item) => item.slotIndex === slotIndex);
    if (!slot?.staged) return;
    const heading =
      headings.find((item) => item.index === slot.anchor?.headingIndex) ?? headings[0];
    if (!heading) {
      setError('Serve almeno un titolo H2 o H3 nella lezione.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      setPlan(
        await client.promoteSlot({
          ...identity,
          requestId: plan.requestId,
          slotIndex,
          promotionRequestId: crypto.randomUUID(),
          mode: { mode: 'add' },
        }),
      );
      await onRefresh();
    } catch (cause) {
      setError(describeMultiVisualError(cause));
    } finally {
      setBusy(false);
    }
  }

  async function promoteAll() {
    if (!plan || busy) return;
    for (const slot of plan.slots) {
      if (slot.staged && !slot.promotedAssetId) await promote(slot.slotIndex);
    }
  }
  async function saveSlotEdit(slotIndex: number) {
    if (!plan || busy) return;
    const anchor = headings.find((item) => item.index === draft.anchorHeadingIndex) ?? headings[0];
    if (!anchor) return setError('Aggiungi almeno un titolo H2 o H3 alla lezione.');
    setBusy(true);
    setError(null);
    try {
      setPlan(
        await client.editSlot({
          ...identity,
          requestId: plan.requestId,
          editRequestId: crypto.randomUUID(),
          slotIndex,
          abandon: false,
          subject: draft.subject,
          caption: draft.caption,
          altText: draft.altText,
          anchorHeadingIndex: anchor.index,
          anchorHeadingText: anchor.text,
        }),
      );
      setEditingSlot(null);
    } catch (cause) {
      setError(describeMultiVisualError(cause));
    } finally {
      setBusy(false);
    }
  }
  async function abandonSlot(slotIndex: number) {
    if (!plan || busy) return;
    setBusy(true);
    setError(null);
    try {
      setPlan(
        await client.editSlot({
          ...identity,
          requestId: plan.requestId,
          editRequestId: crypto.randomUUID(),
          slotIndex,
          abandon: true,
        }),
      );
    } catch (cause) {
      setError(describeMultiVisualError(cause));
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
            Puoi aggiungere fino a {freeSlots} immagini. La proposta e ogni immagine hanno una
            conferma e un costo separati.
          </p>
          {currentVisuals.length > 0 && (
            <div className={styles.currentList} aria-label="Immagini attuali">
              <h4>Immagini attuali</h4>
              {currentVisuals.map((item, index) => (
                <div className={styles.currentItem} key={item.assetId}>
                  <span>
                    {index + 1}. {item.anchor.headingText}
                  </span>
                  <button
                    type="button"
                    className="btn-danger"
                    onClick={() =>
                      void client.remove({ ...identity, assetId: item.assetId }).then(onRefresh)
                    }
                    disabled={busy}
                  >
                    Rimuovi
                  </button>
                </div>
              ))}
            </div>
          )}
          <label>
            Quantità
            <select
              value={quantityMode === 'auto' ? 'auto' : String(exactQuantity)}
              onChange={(event) => {
                const value = event.target.value;
                if (value === 'auto') setQuantityMode('auto');
                else {
                  setQuantityMode('exact');
                  setExactQuantity(Number(value) as 1 | 2 | 3);
                }
              }}
              disabled={busy || existingCount >= 3}
            >
              <option value="auto">Auto (1–{freeSlots})</option>
              {[1, 2, 3]
                .filter((value) => value <= ceiling)
                .map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
            </select>
          </label>
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
                {slot.decision === 'image' &&
                  !slot.promotedAssetId &&
                  (editingSlot === slot.slotIndex ? (
                    <div className={styles.editor}>
                      <input
                        aria-label="Soggetto"
                        value={draft.subject}
                        onChange={(e) => setDraft((v) => ({ ...v, subject: e.target.value }))}
                      />
                      <input
                        aria-label="Didascalia"
                        value={draft.caption}
                        onChange={(e) => setDraft((v) => ({ ...v, caption: e.target.value }))}
                      />
                      <input
                        aria-label="Testo alternativo"
                        value={draft.altText}
                        onChange={(e) => setDraft((v) => ({ ...v, altText: e.target.value }))}
                      />
                      <select
                        aria-label="Ancora"
                        value={draft.anchorHeadingIndex}
                        onChange={(e) =>
                          setDraft((v) => ({ ...v, anchorHeadingIndex: Number(e.target.value) }))
                        }
                      >
                        {headings.map((h) => (
                          <option key={h.index} value={h.index}>
                            {h.text}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className="btn-primary"
                        onClick={() => void saveSlotEdit(slot.slotIndex)}
                        disabled={busy}
                      >
                        Salva modifica
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => {
                        setEditingSlot(slot.slotIndex);
                        setDraft({
                          subject: slot.subject ?? '',
                          caption: slot.caption ?? '',
                          altText: slot.altText ?? '',
                          anchorHeadingIndex: slot.anchor?.headingIndex ?? headings[0]?.index ?? 0,
                        });
                      }}
                    >
                      Modifica
                    </button>
                  ))}
                {slot.staged ? <p>Immagine generata pronta per l’applicazione.</p> : null}
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
                {slot.decision === 'image' && !slot.promotedAssetId && (
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => void abandonSlot(slot.slotIndex)}
                    disabled={busy}
                  >
                    Abbandona slot
                  </button>
                )}
              </article>
            ))}
          </div>
          {plan.slots.some((slot) => slot.staged && !slot.promotedAssetId) && (
            <button
              type="button"
              className="btn-primary"
              onClick={() => void promoteAll()}
              disabled={busy}
            >
              Applica tutte
            </button>
          )}
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
