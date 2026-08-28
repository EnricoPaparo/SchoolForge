import { useMemo, useRef, useState } from 'react';
import { DialogShell } from '../../components/DialogShell.js';
import {
  createMultiVisualClient,
  type MultiVisualPlan,
  type MultiVisualPlanRequest,
  describeMultiVisualError,
} from '../repository/programs/multiVisualClient.js';
import type { Functions } from 'firebase/functions';
import type { LessonVisualItem } from '../../types/firestore.js';
import styles from './LessonMultiVisualWorkflowDialog.module.css';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function canGenerateOrPromote(slot: MultiVisualPlan['slots'][number]): boolean {
  if (slot.decision !== 'image' || slot.promotedAssetId || slot.state === 'abandoned') return false;
  if (slot.state === 'pending') return true;
  if (slot.state === 'ready') return Boolean(slot.staged);
  return (
    slot.state === 'failed' &&
    slot.attempts < 2 &&
    slot.lastError !== 'uncertain_outcome' &&
    slot.lastError !== 'staging_conflict'
  );
}

function isFatalWorkflowError(error: unknown): boolean {
  const code = (error as { details?: { code?: unknown } })?.details?.code;
  return [
    'budget_unavailable',
    'operation_budget_exceeded',
    'feature_disabled',
    'uncertain_state',
    'visual_plan_external_mutation',
    'visual_plan_expired',
    'corrupted_state',
  ].includes(typeof code === 'string' ? code : '');
}

export function LessonMultiVisualWorkflowDialog({
  functions,
  identity,
  lessonAi,
  existingCount,
  currentVisuals,
  legacySingular = false,
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
  currentVisuals: LessonVisualItem[];
  legacySingular?: boolean;
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
  const [progressText, setProgressText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<{
    applied: number;
    skipped: number;
    unavailable: number;
  } | null>(null);
  const [editingSlot, setEditingSlot] = useState<number | null>(null);
  const [draft, setDraft] = useState({
    subject: '',
    caption: '',
    altText: '',
    anchorHeadingIndex: 0,
  });
  const [replaceAssetId, setReplaceAssetId] = useState<string | null>(null);
  const promotionRequestIds = useRef(new Map<number, string>());
  const editorialRequestIds = useRef(new Map<string, string>());

  function promotionRequestIdFor(slotIndex: number): string {
    const existing = promotionRequestIds.current.get(slotIndex);
    if (existing) return existing;
    const storageKey = `schoolforge:multi-visual:promotion:${identity.programId}:${identity.importId}:${identity.lessonId}:${plan?.requestId ?? requestId}:${slotIndex}`;
    try {
      const persisted = window.sessionStorage.getItem(storageKey);
      if (persisted && UUID_V4.test(persisted)) {
        promotionRequestIds.current.set(slotIndex, persisted);
        return persisted;
      }
    } catch {
      // La memoria in pagina resta sufficiente quando lo storage della sessione
      // è disabilitato dal browser.
    }
    const created = crypto.randomUUID();
    promotionRequestIds.current.set(slotIndex, created);
    try {
      window.sessionStorage.setItem(storageKey, created);
    } catch {
      // Vedi sopra: nessun blocco del flusso per uno storage non disponibile.
    }
    return created;
  }

  function editorialRequestIdFor(slotIndex: number, payload: Record<string, unknown>): string {
    const canonicalPayload = JSON.stringify(payload);
    const memoryKey = `${slotIndex}:${canonicalPayload}`;
    const existing = editorialRequestIds.current.get(memoryKey);
    if (existing) return existing;
    const storageKey = `schoolforge:multi-visual:editorial:${identity.programId}:${identity.importId}:${identity.lessonId}:${plan?.requestId ?? requestId}:${slotIndex}`;
    try {
      const persisted = JSON.parse(window.sessionStorage.getItem(storageKey) ?? 'null') as unknown;
      if (
        typeof persisted === 'object' &&
        persisted !== null &&
        'payload' in persisted &&
        'requestId' in persisted &&
        persisted.payload === canonicalPayload &&
        typeof persisted.requestId === 'string' &&
        UUID_V4.test(persisted.requestId)
      ) {
        editorialRequestIds.current.set(memoryKey, persisted.requestId);
        return persisted.requestId;
      }
    } catch {
      // Un valore assente o corrotto non deve uscire dal browser.
    }
    const created = crypto.randomUUID();
    editorialRequestIds.current.set(memoryKey, created);
    try {
      window.sessionStorage.setItem(
        storageKey,
        JSON.stringify({ payload: canonicalPayload, requestId: created }),
      );
    } catch {
      // La memoria in pagina conserva comunque l'idempotenza del tentativo.
    }
    return created;
  }

  async function authorize() {
    if (busy) return;
    if (existingCount >= 3 && !replaceAssetId) return;
    const availableSlots = replaceAssetId ? 1 : freeSlots;
    const selectedCeiling =
      quantityMode === 'auto'
        ? (Math.max(1, availableSlots) as 1 | 2 | 3)
        : (Math.min(exactQuantity, Math.max(1, availableSlots)) as 1 | 2 | 3);
    setBusy(true);
    setProgressText('Sto preparando le proposte visive…');
    setError(null);
    setSummary(null);
    try {
      const input: MultiVisualPlanRequest = {
        ...identity,
        requestId,
        quantity: { mode: quantityMode, ceiling: selectedCeiling },
        replacementAssetId: replaceAssetId,
        titolo: lessonAi.titolo,
        sottotitolo: lessonAi.sottotitolo,
        difficolta: lessonAi.difficolta,
        concettiChiave: lessonAi.concettiChiave ?? [],
        obiettivi: lessonAi.obiettivi ?? [],
        udaTitle: lessonAi.udaTitle,
        udaContext: lessonAi.udaContext,
      };
      setPlan(await client.authorize(input));
      if (legacySingular) await onRefresh();
    } catch (cause) {
      setError(describeMultiVisualError(cause));
    } finally {
      setBusy(false);
      setProgressText(null);
    }
  }

  async function generateAndApply() {
    if (!plan || busy || editingSlot !== null) return;
    let currentPlan = plan;
    let changed = false;
    const actionable = currentPlan.slots.filter(canGenerateOrPromote);
    if (actionable.length === 0) return;

    setBusy(true);
    setError(null);
    setSummary(null);
    let firstSlotError: unknown = null;
    try {
      for (let position = 0; position < actionable.length; position += 1) {
        const slotIndex = actionable[position]!.slotIndex;
        let slot = currentPlan.slots.find((item) => item.slotIndex === slotIndex);
        if (!slot) continue;

        try {
          if (!slot.staged && !slot.promotedAssetId) {
            setProgressText(`Generazione immagine ${position + 1} di ${actionable.length}…`);
            currentPlan = await client.generateSlot({
              ...identity,
              requestId: currentPlan.requestId,
              slotIndex,
            });
            setPlan(currentPlan);
            slot = currentPlan.slots.find((item) => item.slotIndex === slotIndex);
          }

          if (slot?.staged && !slot.promotedAssetId) {
            setProgressText(`Applicazione immagine ${position + 1} di ${actionable.length}…`);
            currentPlan = await client.promoteSlot({
              ...identity,
              requestId: currentPlan.requestId,
              slotIndex,
              promotionRequestId: promotionRequestIdFor(slotIndex),
              mode: replaceAssetId ? { mode: 'replace', replaceAssetId } : { mode: 'add' },
            });
            changed = true;
            setPlan(currentPlan);
          }
        } catch (cause) {
          // Gli errori di un singolo slot non devono impedire agli altri slot
          // indipendenti di concludere. Stati globali/incerti restano invece
          // fail-closed: nessuna nuova spesa dopo una risposta non affidabile.
          firstSlotError ??= cause;
          if (isFatalWorkflowError(cause)) throw cause;
        }
      }

      setProgressText('Aggiornamento della lezione…');
      if (changed) await onRefresh();
      if (firstSlotError) {
        setError(describeMultiVisualError(firstSlotError));
        return;
      }
      setSummary({
        applied: currentPlan.slots.filter((slot) => Boolean(slot.promotedAssetId)).length,
        skipped: currentPlan.slots.filter(
          (slot) => slot.decision !== 'image' || slot.state === 'abandoned',
        ).length,
        unavailable: currentPlan.slots.filter(
          (slot) =>
            slot.decision === 'image' &&
            !slot.promotedAssetId &&
            slot.state !== 'abandoned' &&
            !canGenerateOrPromote(slot),
        ).length,
      });
    } catch (cause) {
      await onRefresh().catch(() => undefined);
      setPlan(currentPlan);
      setError(describeMultiVisualError(cause));
    } finally {
      setBusy(false);
      setProgressText(null);
    }
  }
  async function saveSlotEdit(slotIndex: number) {
    if (!plan || busy) return;
    const anchor = headings.find((item) => item.index === draft.anchorHeadingIndex) ?? headings[0];
    if (!anchor) return setError('Aggiungi almeno un titolo H2 o H3 alla lezione.');
    const editorialPayload = {
      abandon: false,
      subject: draft.subject,
      caption: draft.caption,
      altText: draft.altText,
      anchorHeadingIndex: anchor.index,
      anchorHeadingText: anchor.text,
    } as const;
    setBusy(true);
    setProgressText('Salvataggio delle modifiche…');
    setError(null);
    try {
      setPlan(
        await client.editSlot({
          ...identity,
          requestId: plan.requestId,
          editRequestId: editorialRequestIdFor(slotIndex, editorialPayload),
          slotIndex,
          ...editorialPayload,
        }),
      );
      setEditingSlot(null);
    } catch (cause) {
      setError(describeMultiVisualError(cause));
    } finally {
      setBusy(false);
      setProgressText(null);
    }
  }
  async function abandonSlot(slotIndex: number) {
    if (!plan || busy) return;
    setBusy(true);
    setProgressText('Rimozione della proposta…');
    setError(null);
    try {
      setPlan(
        await client.editSlot({
          ...identity,
          requestId: plan.requestId,
          editRequestId: editorialRequestIdFor(slotIndex, { abandon: true }),
          slotIndex,
          abandon: true,
        }),
      );
    } catch (cause) {
      setError(describeMultiVisualError(cause));
    } finally {
      setBusy(false);
      setProgressText(null);
    }
  }

  async function removeExisting(assetId: string) {
    if (busy) return;
    if (!window.confirm('Rimuovere definitivamente questa immagine dalla lezione?')) return;
    setBusy(true);
    setProgressText('Rimozione dell’immagine…');
    setError(null);
    try {
      await client.remove({ ...identity, assetId });
      await onRefresh();
    } catch (cause) {
      setError(describeMultiVisualError(cause));
    } finally {
      setBusy(false);
      setProgressText(null);
    }
  }

  const actionableSlots = plan?.slots.filter(canGenerateOrPromote) ?? [];

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
            Puoi aggiungere fino a {freeSlots} immagini. «Stima immagini» prepara subito le
            proposte; dopo la revisione un unico comando genera e applica quelle confermate.
          </p>
          {currentVisuals.length > 0 && (
            <div className={styles.currentList} aria-label="Immagini attuali">
              <h4>Immagini attuali</h4>
              {currentVisuals.map((item, index) => (
                <div className={styles.currentItem} key={item.assetId}>
                  <span>
                    {index + 1}. {item.anchor.headingText}
                  </span>
                  <span className={styles.inlineActions}>
                    <button
                      type="button"
                      className="btn-secondary"
                      aria-pressed={replaceAssetId === item.assetId}
                      onClick={() => {
                        setReplaceAssetId(item.assetId);
                        setQuantityMode('exact');
                        setExactQuantity(1);
                      }}
                      disabled={busy}
                    >
                      Sostituisci
                    </button>
                  </span>
                  <button
                    type="button"
                    className="btn-danger"
                    onClick={() => void removeExisting(item.assetId)}
                    disabled={busy || legacySingular}
                  >
                    Rimuovi
                  </button>
                </div>
              ))}
            </div>
          )}
          {legacySingular && (
            <p role="status">
              L’immagine legacy verrà adottata nel formato multi quando confermi la proposta; prima
              dell’adozione puoi sostituirla, ma non rimuoverla.
            </p>
          )}
          {replaceAssetId && (
            <p role="status">
              La nuova immagine sostituirà quella selezionata.
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setReplaceAssetId(null)}
                disabled={busy}
              >
                Annulla sostituzione
              </button>
            </p>
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
              disabled={busy || Boolean(replaceAssetId) || existingCount >= 3}
            >
              <option value="auto">Auto (1–{freeSlots})</option>
              {[1, 2, 3]
                .filter((value) => value <= (replaceAssetId ? 1 : ceiling))
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
          {progressText && (
            <div role="status" aria-live="polite" aria-busy="true" className="loading-row">
              <span className="spinner" aria-hidden="true" />
              <span>{progressText}</span>
            </div>
          )}
          <div className={styles.actions}>
            <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>
              Annulla
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={() => void authorize()}
              disabled={busy || (existingCount >= 3 && !replaceAssetId)}
            >
              Stima immagini
            </button>
          </div>
        </>
      ) : (
        <>
          {summary ? (
            <section className={styles.summary} aria-labelledby="multi-visual-summary-title">
              <h3 id="multi-visual-summary-title">Immagini applicate alla lezione</h3>
              <p>
                {summary.applied === 1
                  ? 'È stata applicata 1 immagine.'
                  : `Sono state applicate ${summary.applied} immagini.`}
              </p>
              {summary.skipped > 0 && (
                <p>
                  {summary.skipped === 1
                    ? 'Una proposta non richiedeva un’immagine oppure è stata scartata.'
                    : `${summary.skipped} proposte non richiedevano un’immagine oppure sono state scartate.`}
                </p>
              )}
              {summary.unavailable > 0 && (
                <p>
                  {summary.unavailable === 1
                    ? 'Una proposta non era più generabile ed è stata lasciata invariata.'
                    : `${summary.unavailable} proposte non erano più generabili e sono state lasciate invariate.`}
                </p>
              )}
            </section>
          ) : (
            <p>
              Controlla le proposte, modifica i dettagli se necessario e poi genera e applica tutto
              con un solo comando.
            </p>
          )}
          {error && (
            <p role="alert" className={styles.error}>
              {error}
            </p>
          )}
          {!summary && (
            <div className={styles.slots}>
              {plan.slots.map((slot) => (
                <article key={slot.slotIndex} className={styles.slot}>
                  <h4>Immagine {slot.slotIndex + 1}</h4>
                  {slot.decision === 'image' ? (
                    <>
                      {editingSlot === slot.slotIndex && slot.state === 'pending' ? (
                        <div className={styles.editor}>
                          <label>
                            Cosa deve mostrare l’immagine
                            <textarea
                              rows={4}
                              value={draft.subject}
                              onChange={(e) =>
                                setDraft((value) => ({ ...value, subject: e.target.value }))
                              }
                            />
                          </label>
                          <label>
                            Didascalia
                            <textarea
                              rows={2}
                              value={draft.caption}
                              onChange={(e) =>
                                setDraft((value) => ({ ...value, caption: e.target.value }))
                              }
                            />
                          </label>
                          <label>
                            Testo alternativo
                            <textarea
                              rows={3}
                              value={draft.altText}
                              onChange={(e) =>
                                setDraft((value) => ({ ...value, altText: e.target.value }))
                              }
                            />
                          </label>
                          <label>
                            Posizione nella lezione
                            <select
                              value={draft.anchorHeadingIndex}
                              onChange={(e) =>
                                setDraft((value) => ({
                                  ...value,
                                  anchorHeadingIndex: Number(e.target.value),
                                }))
                              }
                            >
                              {headings.map((heading) => (
                                <option key={heading.index} value={heading.index}>
                                  {heading.text}
                                </option>
                              ))}
                            </select>
                          </label>
                          <div className={styles.slotActions}>
                            <button
                              type="button"
                              className="btn-primary"
                              onClick={() => void saveSlotEdit(slot.slotIndex)}
                              disabled={busy}
                            >
                              Salva modifiche
                            </button>
                            <button
                              type="button"
                              className="btn-secondary"
                              onClick={() => setEditingSlot(null)}
                              disabled={busy}
                            >
                              Annulla
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <dl className={styles.slotDetails}>
                            <div>
                              <dt>Soggetto</dt>
                              <dd>{slot.subject}</dd>
                            </div>
                            <div>
                              <dt>Utilità didattica</dt>
                              <dd>{slot.rationale}</dd>
                            </div>
                            <div>
                              <dt>Didascalia</dt>
                              <dd>{slot.caption}</dd>
                            </div>
                            <div>
                              <dt>Testo alternativo</dt>
                              <dd>{slot.altText}</dd>
                            </div>
                            <div>
                              <dt>Posizione</dt>
                              <dd>{slot.anchor?.headingText}</dd>
                            </div>
                          </dl>
                          {!slot.promotedAssetId && slot.state !== 'abandoned' && (
                            <div className={styles.slotActions}>
                              <button
                                type="button"
                                className="btn-secondary"
                                onClick={() => {
                                  setEditingSlot(slot.slotIndex);
                                  setDraft({
                                    subject: slot.subject ?? '',
                                    caption: slot.caption ?? '',
                                    altText: slot.altText ?? '',
                                    anchorHeadingIndex:
                                      slot.anchor?.headingIndex ?? headings[0]?.index ?? 0,
                                  });
                                }}
                                disabled={busy || slot.state !== 'pending'}
                              >
                                Modifica
                              </button>
                              <button
                                type="button"
                                className="btn-secondary"
                                onClick={() => void abandonSlot(slot.slotIndex)}
                                disabled={busy || slot.state !== 'pending'}
                              >
                                Scarta proposta
                              </button>
                            </div>
                          )}
                        </>
                      )}
                    </>
                  ) : (
                    <p>Nessuna immagine utile proposta per questa parte della lezione.</p>
                  )}
                </article>
              ))}
            </div>
          )}
          {progressText && (
            <div role="status" aria-live="polite" aria-busy="true" className="loading-row">
              <span className="spinner" aria-hidden="true" />
              <span>{progressText}</span>
            </div>
          )}
          <div className={styles.actions}>
            {!summary && actionableSlots.length > 0 && (
              <button
                type="button"
                className="btn-primary"
                onClick={() => void generateAndApply()}
                disabled={busy || editingSlot !== null}
              >
                Genera e applica{' '}
                {actionableSlots.length === 1 ? '1 immagine' : `${actionableSlots.length} immagini`}
              </button>
            )}
            <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>
              Chiudi
            </button>
          </div>
        </>
      )}
    </DialogShell>
  );
}
