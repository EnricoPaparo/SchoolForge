import { useEffect, useRef, useState } from 'react';
import {
  MAX_MAX_CHARACTERS,
  MIN_MAX_CHARACTERS,
  type ParsedPool,
} from '@schoolforge/lesson-contract';
import { DialogShell } from './workspaceDialogs.js';
import { BoundedStepper, QuestionCountStepper } from './QuestionCountStepper.js';
import { IconTrash } from '../../components/icons.js';
import styles from './AiPoolGenerationDialog.module.css';
import {
  buildPoolContentRequest,
  describeAiContentError,
  formatMicroUsd,
  newRequestId,
  DEFAULT_POOL_LEVEL,
  DEFAULT_POOL_MODEL_PROFILE,
  MAX_POOL_TOTAL_QUESTIONS,
  MAX_TEACHER_GUIDANCE_CHARS,
  POOL_LEVEL_OPTIONS,
  POOL_MODEL_PROFILE_OPTIONS,
  type AiContentCallables,
  type AiPoolContentRequest,
  type AiPoolGenerateResult,
  type AiPoolPreviewResult,
  type PoolLevel,
  type PoolModelProfile,
} from '../repository/pools/aiContentClient.js';
import {
  buildPoolFromProposal,
  proposalToLocalQuestions,
  optionIdFromIndex,
  type LocalProposalQuestion,
} from '../repository/pools/aiPoolMapper.js';

/**
 * AIGEN-02 — dialog «Genera con IA» del pool. Fasi in-place (il dialog non si
 * chiude mai fra stima e generazione): configurazione → stima → conferma →
 * generazione → revisione locale editabile → conferma → applicazione canonica.
 *
 * Preview e generate usano la **stessa** `requestId` e lo **stesso** payload
 * normalizzato (idempotenza server-side AIGEN-01). Ogni modifica di
 * profilo/stile/quantità/indicazioni invalida la stima e genera una nuova
 * `requestId`. Le modifiche alla proposta restano **solo** nello stato locale:
 * nessuna write finché il docente non conferma l'applicazione; un replay
 * restituisce la proposta originale, non le modifiche locali.
 */

type Phase =
  | 'configure'
  | 'previewing'
  | 'confirm'
  | 'generating'
  | 'review'
  | 'applying'
  | 'done'
  | 'error';

type CountsDraft = { aperta: string; chiusa_singola: string; chiusa_multipla: string };

/**
 * Passo dello stepper «Caratteri max» nella revisione bozza: i limiti restano
 * quelli canonici del contratto (`MIN/MAX_MAX_CHARACTERS`); il passo è solo un
 * comodo incremento dell'editor, il valore resta digitabile liberamente.
 */
const ANSWER_CHARACTERS_STEP = 100;

function parseCount(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const n = Number(trimmed);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

export function AiPoolGenerationDialog({
  lessonSource,
  existingPool,
  callables,
  onApply,
  onClose,
  defaultModelProfile = DEFAULT_POOL_MODEL_PROFILE,
}: {
  /** Testo Markdown della lezione già in memoria (nessuna nuova lettura Storage). */
  lessonSource: string;
  /** Pool esistente, o `null` se assente. */
  existingPool: ParsedPool | null;
  callables: AiContentCallables;
  /** Persistenza canonica del pool combinato (savePool). Lancia in caso di errore. */
  onApply: (pool: ParsedPool) => Promise<void>;
  onClose: () => void;
  defaultModelProfile?: PoolModelProfile;
}) {
  const isNewPool = existingPool === null;
  const existingCount = existingPool?.questions.length ?? 0;

  const [phase, setPhase] = useState<Phase>('configure');
  const [modelProfile, setModelProfile] = useState<PoolModelProfile>(defaultModelProfile);
  const [level, setLevel] = useState<PoolLevel>(DEFAULT_POOL_LEVEL);
  const [counts, setCounts] = useState<CountsDraft>({
    aperta: '3',
    chiusa_singola: '3',
    chiusa_multipla: '0',
  });
  const [guidance, setGuidance] = useState('');
  const [preview, setPreview] = useState<AiPoolPreviewResult | null>(null);
  const [previewRequest, setPreviewRequest] = useState<AiPoolContentRequest | null>(null);
  const [result, setResult] = useState<AiPoolGenerateResult | null>(null);
  const [localQuestions, setLocalQuestions] = useState<LocalProposalQuestion[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [applyErrors, setApplyErrors] = useState<string[] | null>(null);
  const [showApplyConfirm, setShowApplyConfirm] = useState(false);
  const [doneMessage, setDoneMessage] = useState('');

  const requestIdRef = useRef<string>(newRequestId());
  const previewStartedRef = useRef(false);
  const generateStartedRef = useRef(false);
  const applyStartedRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const parsedCounts = {
    aperta: parseCount(counts.aperta),
    chiusa_singola: parseCount(counts.chiusa_singola),
    chiusa_multipla: parseCount(counts.chiusa_multipla),
  };
  const countsValid =
    parsedCounts.aperta !== null &&
    parsedCounts.chiusa_singola !== null &&
    parsedCounts.chiusa_multipla !== null;
  const total = countsValid
    ? parsedCounts.aperta! + parsedCounts.chiusa_singola! + parsedCounts.chiusa_multipla!
    : null;
  // «+» attivo solo se il totale è valido e sotto il massimo: nessun tipo può
  // spingere il totale oltre MAX_POOL_TOTAL_QUESTIONS tramite lo stepper.
  const canIncrement = total !== null && total < MAX_POOL_TOTAL_QUESTIONS;
  const guidanceValid = guidance.length <= MAX_TEACHER_GUIDANCE_CHARS;
  const sourceValid = lessonSource.trim().length > 0;
  const configValid =
    countsValid &&
    total !== null &&
    total >= 1 &&
    total <= MAX_POOL_TOTAL_QUESTIONS &&
    guidanceValid &&
    sourceValid;

  // Ogni modifica alla configurazione invalida la stima e genera una nuova
  // requestId: la generate successiva non può entrare in conflitto.
  function invalidateEstimate() {
    setPreview(null);
    setPreviewRequest(null);
    setError(null);
    generateStartedRef.current = false;
    requestIdRef.current = newRequestId();
    setPhase('configure');
  }

  function updateModelProfile(next: PoolModelProfile) {
    setModelProfile(next);
    invalidateEstimate();
  }
  function updateLevel(next: PoolLevel) {
    setLevel(next);
    invalidateEstimate();
  }
  function updateCount(key: keyof CountsDraft, value: string) {
    setCounts((prev) => ({ ...prev, [key]: value }));
    invalidateEstimate();
  }
  function updateGuidance(value: string) {
    setGuidance(value);
    invalidateEstimate();
  }

  function currentRequest(): AiPoolContentRequest {
    return buildPoolContentRequest({
      requestId: requestIdRef.current,
      modelProfile,
      level,
      counts: {
        aperta: parsedCounts.aperta ?? 0,
        chiusa_singola: parsedCounts.chiusa_singola ?? 0,
        chiusa_multipla: parsedCounts.chiusa_multipla ?? 0,
      },
      lessonSource,
      existingPoolQuestionCount: existingCount,
      teacherGuidance: guidance,
    });
  }

  async function requestPreview() {
    if (previewStartedRef.current || !configValid) return;
    previewStartedRef.current = true;
    setError(null);
    setPhase('previewing');
    const request = currentRequest();
    try {
      const res = await callables.preview(request);
      if (!mountedRef.current) return;
      setPreview(res);
      setPreviewRequest(request);
      setPhase('confirm');
    } catch (err) {
      if (!mountedRef.current) return;
      setError(describeAiContentError(err));
      setPhase('error');
    } finally {
      previewStartedRef.current = false;
    }
  }

  async function confirmGenerate() {
    if (generateStartedRef.current || !preview || !previewRequest) return;
    generateStartedRef.current = true;
    setError(null);
    setPhase('generating');
    try {
      const res = await callables.generate(previewRequest);
      if (!mountedRef.current) return;
      setResult(res);
      setLocalQuestions(proposalToLocalQuestions(res.output));
      setApplyErrors(null);
      setShowApplyConfirm(false);
      setPhase('review');
    } catch (err) {
      if (!mountedRef.current) return;
      setError(describeAiContentError(err));
      setPhase('error');
      // Consenti un nuovo tentativo (stessa requestId → idempotente lato server).
      generateStartedRef.current = false;
    }
  }

  function discardProposal() {
    setResult(null);
    setLocalQuestions([]);
    setApplyErrors(null);
    setShowApplyConfirm(false);
    invalidateEstimate();
  }

  function editQuestion(localKey: string, patch: Partial<LocalProposalQuestion>) {
    setLocalQuestions((prev) =>
      prev.map((q) => (q.localKey === localKey ? { ...q, ...patch } : q)),
    );
    setApplyErrors(null);
  }
  function deleteQuestion(localKey: string) {
    setLocalQuestions((prev) => prev.filter((q) => q.localKey !== localKey));
    setApplyErrors(null);
  }

  async function doApply() {
    if (applyStartedRef.current) return;
    const mapped = buildPoolFromProposal(existingPool?.questions ?? null, localQuestions);
    if (!mapped.ok) {
      setApplyErrors(mapped.errors);
      setShowApplyConfirm(false);
      return;
    }
    applyStartedRef.current = true;
    setApplyErrors(null);
    setPhase('applying');
    try {
      await onApply(mapped.pool);
      if (!mountedRef.current) return;
      setDoneMessage(
        isNewPool
          ? `Pool creato con ${mapped.addedCount} domande.`
          : `${mapped.addedCount} domande aggiunte al pool.`,
      );
      setPhase('done');
    } catch (err) {
      if (!mountedRef.current) return;
      // In errore: proposta ed edit locali conservati, nessuna write parziale.
      setApplyErrors([err instanceof Error ? err.message : 'Errore durante il salvataggio.']);
      setShowApplyConfirm(false);
      setPhase('review');
    } finally {
      applyStartedRef.current = false;
    }
  }

  const busy = phase === 'previewing' || phase === 'generating' || phase === 'applying';

  return (
    <DialogShell title="Genera pool con IA" onCancel={onClose} busy={busy} variant="wide-scroll">
      {/* 1) CONFIGURAZIONE */}
      {phase === 'configure' && (
        <div className={styles.config}>
          {/* Profilo modello */}
          <div className={styles.field}>
            <span className={styles.fieldLabel} id="ai-pool-profile-label">
              Profilo modello
            </span>
            <div
              className={styles.optionRow}
              role="radiogroup"
              aria-labelledby="ai-pool-profile-label"
            >
              {POOL_MODEL_PROFILE_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  role="radio"
                  aria-checked={modelProfile === o.value}
                  className={`${styles.choice} ${modelProfile === o.value ? styles.choiceSelected : ''}`}
                  onClick={() => updateModelProfile(o.value)}
                >
                  <span className={styles.choiceLabel}>{o.label}</span>
                  <span className={styles.choiceMeta}>{o.description}</span>
                  <span className={styles.choiceMeta}>Modello: {o.modelId}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Stile del pool */}
          <div className={styles.field}>
            <span className={styles.fieldLabel} id="ai-pool-level-label">
              Stile del pool
            </span>
            <div
              className={styles.optionRow}
              role="radiogroup"
              aria-labelledby="ai-pool-level-label"
            >
              {POOL_LEVEL_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  role="radio"
                  aria-checked={level === o.value}
                  className={`${styles.choice} ${level === o.value ? styles.choiceSelected : ''}`}
                  onClick={() => updateLevel(o.value)}
                >
                  <span className={styles.choiceLabel}>{o.label}</span>
                  <span className={styles.choiceMeta}>Difficoltà {o.difficultyLabel}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Quantità */}
          <div className={styles.field}>
            <span className={styles.fieldLabel}>Quantità di domande</span>
            <div className={styles.counts}>
              <QuestionCountStepper
                label="Aperte"
                rawValue={counts.aperta}
                parsedValue={parsedCounts.aperta}
                onChange={(v) => updateCount('aperta', v)}
                canIncrement={canIncrement}
                decrementLabel="Diminuisci domande aperte"
                incrementLabel="Aumenta domande aperte"
              />
              <QuestionCountStepper
                label="Risposta singola"
                rawValue={counts.chiusa_singola}
                parsedValue={parsedCounts.chiusa_singola}
                onChange={(v) => updateCount('chiusa_singola', v)}
                canIncrement={canIncrement}
                decrementLabel="Diminuisci domande a risposta singola"
                incrementLabel="Aumenta domande a risposta singola"
              />
              <QuestionCountStepper
                label="Risposta multipla"
                rawValue={counts.chiusa_multipla}
                parsedValue={parsedCounts.chiusa_multipla}
                onChange={(v) => updateCount('chiusa_multipla', v)}
                canIncrement={canIncrement}
                decrementLabel="Diminuisci domande a risposta multipla"
                incrementLabel="Aumenta domande a risposta multipla"
              />
            </div>
            <span className={styles.total}>
              Totale richiesto: {total ?? '—'}
              {total !== null && total > MAX_POOL_TOTAL_QUESTIONS
                ? ` (massimo ${MAX_POOL_TOTAL_QUESTIONS})`
                : ''}
            </span>
          </div>

          {/* Indicazioni aggiuntive */}
          <div className={styles.field}>
            <label className={styles.fieldLabel} htmlFor="ai-pool-guidance">
              Indicazioni aggiuntive (facoltative)
            </label>
            <textarea
              id="ai-pool-guidance"
              className={styles.guidanceTextarea}
              rows={3}
              maxLength={MAX_TEACHER_GUIDANCE_CHARS}
              value={guidance}
              onChange={(e) => updateGuidance(e.target.value)}
              aria-describedby="ai-pool-guidance-counter"
            />
            <span id="ai-pool-guidance-counter" className={styles.counter}>
              {guidance.length}/{MAX_TEACHER_GUIDANCE_CHARS}
            </span>
          </div>

          {!sourceValid && (
            <p role="alert" className="text-error">
              Il testo della lezione è vuoto: aggiungi contenuto prima di generare.
            </p>
          )}

          <div className="dialog-actions">
            <button type="button" onClick={onClose}>
              Annulla
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={!configValid}
              onClick={() => void requestPreview()}
            >
              Calcola stima
            </button>
          </div>
        </div>
      )}

      {/* 2) STIMA IN CORSO */}
      {phase === 'previewing' && (
        <div role="status" aria-live="polite" aria-busy="true" className="loading-row">
          <span className="spinner" aria-hidden="true" />
          <span>Calcolo della stima…</span>
        </div>
      )}

      {/* 3) CONFERMA STIMA */}
      {phase === 'confirm' && preview && (
        <div className={styles.estimate}>
          <ul className={styles.estimateList}>
            <li>Totale domande: {preview.requestedTotal ?? total}</li>
            <li>Aperte: {parsedCounts.aperta ?? 0}</li>
            <li>Risposta singola: {parsedCounts.chiusa_singola ?? 0}</li>
            <li>Risposta multipla: {parsedCounts.chiusa_multipla ?? 0}</li>
            <li>
              Profilo: {POOL_MODEL_PROFILE_OPTIONS.find((o) => o.value === modelProfile)?.label}
            </li>
            <li>Stile: {POOL_LEVEL_OPTIONS.find((o) => o.value === level)?.label}</li>
            <li>Token stimati: {preview.estimatedInputTokens + preview.maxOutputTokens}</li>
            <li>Costo stimato: {formatMicroUsd(preview.estimatedCostMicroUsd)}</li>
            <li>Tetto massimo prenotabile: {formatMicroUsd(preview.reservationCostMicroUsd)}</li>
          </ul>
          <div className="dialog-actions">
            <button type="button" onClick={invalidateEstimate}>
              Modifica configurazione
            </button>
            <button type="button" className="btn-primary" onClick={() => void confirmGenerate()}>
              Genera pool
            </button>
          </div>
        </div>
      )}

      {/* 4) GENERAZIONE IN CORSO */}
      {phase === 'generating' && (
        <div role="status" aria-live="polite" aria-busy="true" className="loading-row">
          <span className="spinner" aria-hidden="true" />
          <span>Generazione del pool in corso…</span>
        </div>
      )}

      {/* 5) REVISIONE PROPOSTA */}
      {phase === 'review' && result && (
        <>
          <p role="status">
            {result.replayed ? 'Proposta già generata: ripristinata.' : 'Proposta generata.'}{' '}
            {result.actualCostMicroUsd === null
              ? 'Consumo esatto non disponibile; è stato contabilizzato prudenzialmente il tetto indicato.'
              : `Costo reale: ${formatMicroUsd(result.actualCostMicroUsd)}.`}
          </p>

          {localQuestions.length === 0 ? (
            <p role="alert" className="text-error">
              Hai rimosso tutte le domande proposte. Annulla la proposta o rigenera.
            </p>
          ) : (
            <div className={styles.reviewList}>
              {localQuestions.map((q, index) => (
                <ProposalQuestionCard
                  key={q.localKey}
                  question={q}
                  ordinal={index + 1}
                  onChange={(patch) => editQuestion(q.localKey, patch)}
                  onDelete={() => deleteQuestion(q.localKey)}
                />
              ))}
            </div>
          )}

          {applyErrors && (
            <ul role="alert" className="text-error">
              {applyErrors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          )}

          {showApplyConfirm ? (
            <div role="alert">
              <p>
                {isNewPool
                  ? `Verrà creato un pool con ${localQuestions.length} domande.`
                  : `Verranno aggiunte ${localQuestions.length} domande al pool esistente. Le domande attuali non saranno modificate.`}
              </p>
              <div className="dialog-actions">
                <button type="button" onClick={() => setShowApplyConfirm(false)}>
                  Annulla
                </button>
                <button type="button" className="btn-primary" onClick={() => void doApply()}>
                  {isNewPool ? 'Crea pool' : 'Aggiungi al pool'}
                </button>
              </div>
            </div>
          ) : (
            <div className="dialog-actions">
              <button type="button" onClick={discardProposal}>
                Annulla proposta
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={localQuestions.length === 0}
                onClick={() => setShowApplyConfirm(true)}
              >
                {isNewPool ? 'Crea pool' : 'Aggiungi al pool'}
              </button>
            </div>
          )}
        </>
      )}

      {/* APPLICAZIONE IN CORSO */}
      {phase === 'applying' && (
        <div role="status" aria-live="polite" aria-busy="true" className="loading-row">
          <span className="spinner" aria-hidden="true" />
          <span>Salvataggio del pool…</span>
        </div>
      )}

      {/* 6) FATTO */}
      {phase === 'done' && (
        <>
          <p role="status">{doneMessage}</p>
          <div className="dialog-actions">
            <button type="button" className="btn-primary" onClick={onClose}>
              Chiudi
            </button>
          </div>
        </>
      )}

      {/* ERRORE (stima/generazione) */}
      {phase === 'error' && (
        <>
          <p role="alert" className="text-error">
            {error}
          </p>
          <div className="dialog-actions">
            <button type="button" onClick={onClose}>
              Chiudi
            </button>
            <button type="button" className="btn-primary" onClick={() => void requestPreview()}>
              Riprova stima
            </button>
          </div>
        </>
      )}
    </DialogShell>
  );
}

/** Card di revisione/modifica di una singola domanda proposta (stato locale). */
function ProposalQuestionCard({
  question,
  ordinal,
  onChange,
  onDelete,
}: {
  question: LocalProposalQuestion;
  ordinal: number;
  onChange: (patch: Partial<LocalProposalQuestion>) => void;
  onDelete: () => void;
}) {
  const tipoLabel =
    question.tipo === 'aperta'
      ? 'Aperta'
      : question.tipo === 'chiusa_singola'
        ? 'Chiusa (singola)'
        : 'Chiusa (multipla)';
  // Palette distinta per tipo (AIGEN-UI-02): nessuno sfondo bianco.
  const badgeClass =
    question.tipo === 'aperta'
      ? styles.badgeAperta
      : question.tipo === 'chiusa_singola'
        ? styles.badgeSingola
        : styles.badgeMultipla;

  function toggleSolution(optionIndex: number) {
    if (question.tipo === 'chiusa_singola') {
      onChange({ soluzioneIndici: [optionIndex] });
      return;
    }
    const set = new Set(question.soluzioneIndici);
    if (set.has(optionIndex)) set.delete(optionIndex);
    else set.add(optionIndex);
    onChange({ soluzioneIndici: [...set].sort((a, b) => a - b) });
  }

  return (
    <div className={styles.reviewItem}>
      {/*
       * Riga metadati compatta (AIGEN-UI-02): badge tipo, difficoltà, caratteri
       * max (solo aperte) ed «Elimina» sulla stessa riga, per recuperare spazio
       * verticale. «Elimina» resta accanto agli altri controlli anche in wrap.
       */}
      <div className={styles.reviewHead}>
        <strong>Domanda {ordinal}</strong>
        <span className={`${styles.badge} ${badgeClass}`}>{tipoLabel}</span>
        <span className={styles.reviewHeadSpacer} />
        <div className={styles.reviewHeadControls}>
          <BoundedStepper
            value={question.difficolta}
            min={1}
            max={5}
            ariaLabel={`Difficoltà domanda ${ordinal}`}
            decrementLabel={`Diminuisci difficoltà domanda ${ordinal}`}
            incrementLabel={`Aumenta difficoltà domanda ${ordinal}`}
            onChange={(difficolta) => onChange({ difficolta })}
          />
          {question.tipo === 'aperta' && (
            <BoundedStepper
              value={question.maxCharacters}
              min={MIN_MAX_CHARACTERS}
              max={MAX_MAX_CHARACTERS}
              step={ANSWER_CHARACTERS_STEP}
              ariaLabel={`Caratteri max domanda ${ordinal}`}
              decrementLabel={`Diminuisci caratteri max domanda ${ordinal}`}
              incrementLabel={`Aumenta caratteri max domanda ${ordinal}`}
              onChange={(maxCharacters) => onChange({ maxCharacters })}
            />
          )}
          <button
            type="button"
            className={`btn-danger ${styles.reviewDeleteBtn}`}
            onClick={onDelete}
            aria-label={`Elimina domanda ${ordinal}`}
          >
            <IconTrash size={13} />
            {/* Su schermi molto stretti resta la sola icona: il nome accessibile
                è comunque garantito da `aria-label`. */}
            <span className={styles.reviewDeleteLabel}>Elimina</span>
          </button>
        </div>
      </div>

      <label className={styles.field}>
        Testo
        <textarea
          rows={2}
          value={question.testo}
          onChange={(e) => onChange({ testo: e.target.value })}
          aria-label={`Testo domanda ${ordinal}`}
        />
      </label>

      {question.tipo === 'aperta' ? (
        <>
          <label className={styles.field}>
            Soluzione di riferimento
            <textarea
              rows={2}
              value={question.soluzione}
              onChange={(e) => onChange({ soluzione: e.target.value })}
              aria-label={`Soluzione domanda ${ordinal}`}
            />
          </label>
        </>
      ) : (
        <div className={styles.field}>
          <span className={styles.fieldLabel}>Opzioni e soluzione</span>
          {question.opzioni.map((opt, optIndex) => (
            <div className={styles.opzioneRow} key={optIndex}>
              <input
                type={question.tipo === 'chiusa_singola' ? 'radio' : 'checkbox'}
                name={`sol-${question.localKey}`}
                checked={question.soluzioneIndici.includes(optIndex)}
                onChange={() => toggleSolution(optIndex)}
                aria-label={`Opzione ${optionIdFromIndex(optIndex)} corretta`}
              />
              <input
                type="text"
                value={opt}
                onChange={(e) => {
                  const next = [...question.opzioni];
                  next[optIndex] = e.target.value;
                  onChange({ opzioni: next });
                }}
                aria-label={`Testo opzione ${optionIdFromIndex(optIndex)} domanda ${ordinal}`}
              />
              <button
                type="button"
                className="btn-danger"
                onClick={() => {
                  const next = question.opzioni.filter((_, i) => i !== optIndex);
                  const nextSol = question.soluzioneIndici
                    .filter((i) => i !== optIndex)
                    .map((i) => (i > optIndex ? i - 1 : i));
                  onChange({ opzioni: next, soluzioneIndici: nextSol });
                }}
                aria-label={`Elimina opzione ${optionIdFromIndex(optIndex)} domanda ${ordinal}`}
              >
                ✕
              </button>
            </div>
          ))}
          <button type="button" onClick={() => onChange({ opzioni: [...question.opzioni, ''] })}>
            Aggiungi opzione
          </button>
        </div>
      )}
    </div>
  );
}
