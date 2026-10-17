import { useEffect, useRef, useState } from 'react';
import { DialogShell } from './workspaceDialogs.js';
import { AiModelProfileField } from './AiModelProfileField.js';
import {
  AiAdvancedReviewControl,
  AiAdvancedReviewResult,
  AiAdvancedReviewFailure,
} from './AiAdvancedReviewControl.js';
import { AiReviewExitConfirm } from './AiReviewExitConfirm.js';
import {
  DEFAULT_POOL_MODEL_PROFILE,
  describeAiContentError,
  formatMicroUsd,
  newRequestId,
  type AiContentCallables,
  type AiPoolContentRequest,
  type AiPoolPreviewResult,
  type AiPoolGenerateResult,
  type AiPoolReviewRequest,
  type AiPoolReviewResult,
  type PoolModelProfile,
} from '../repository/pools/aiContentClient.js';
import { validateStudyPractice, type StudyPractice } from '../repository/programs/studyPractice.js';
import { StudyPracticePlayer } from '../student/StudyPracticePlayer.js';
import styles from './AiPoolGenerationDialog.module.css';
import practiceStyles from './AiStudyPracticeGenerationDialog.module.css';

type Phase =
  | 'configure'
  | 'previewing'
  | 'confirm'
  | 'generating'
  | 'review'
  | 'estimating-review'
  | 'confirm-review'
  | 'reviewing';

/** Same modal, settings and estimate/confirmation flow as the other content generators. */
export function AiStudyPracticeGenerationDialog({
  body,
  objectives,
  callables,
  replacesDraft,
  onApply,
  onClose,
}: {
  body: string;
  objectives: string[];
  callables: AiContentCallables;
  replacesDraft: boolean;
  onApply: (practice: StudyPractice) => void;
  onClose: () => void;
}) {
  const [phase, setPhase] = useState<Phase>('configure');
  const [model, setModel] = useState<PoolModelProfile>(DEFAULT_POOL_MODEL_PROFILE);
  const [advancedReview, setAdvancedReview] = useState(true);
  const [baseResult, setBaseResult] = useState<AiPoolGenerateResult | null>(null);
  const [reviewRequest, setReviewRequest] = useState<AiPoolReviewRequest | null>(null);
  const [reviewEstimate, setReviewEstimate] = useState<
    (Omit<AiPoolPreviewResult, 'kind'> & { kind: 'pool_review' }) | null
  >(null);
  const [reviewResult, setReviewResult] = useState<AiPoolReviewResult | null>(null);
  const [reviewFailed, setReviewFailed] = useState(false);
  const [count, setCount] = useState(6);
  const [guidance, setGuidance] = useState('');
  const [estimate, setEstimate] = useState<AiPoolPreviewResult | null>(null);
  const [request, setRequest] = useState<AiPoolContentRequest | null>(null);
  const [proposal, setProposal] = useState<StudyPractice | null>(null);
  const [cost, setCost] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exitConfirm, setExitConfirm] = useState(false);
  const mounted = useRef(true);
  const locked = useRef(false);
  const applied = useRef(false);
  const headingRef = useRef<HTMLParagraphElement>(null);
  const busy = ['previewing', 'generating', 'estimating-review', 'reviewing'].includes(phase);
  const sourceIdentity = JSON.stringify([body, objectives]);
  const sourceRef = useRef(sourceIdentity);
  const epoch = useRef(0);
  useEffect(() => {
    if (sourceRef.current === sourceIdentity) return;
    sourceRef.current = sourceIdentity;
    epoch.current++;
    locked.current = false;
    applied.current = false;
    setPhase('configure');
    setEstimate(null);
    setRequest(null);
    setProposal(null);
    setBaseResult(null);
    setReviewRequest(null);
    setReviewEstimate(null);
    setReviewResult(null);
    setReviewFailed(false);
    setCost(null);
    setError(null);
    setExitConfirm(false);
  }, [sourceIdentity]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, [phase]);
  function configure() {
    setPhase('configure');
    setEstimate(null);
    setRequest(null);
    setProposal(null);
    setError(null);
    setExitConfirm(false);
    setBaseResult(null);
    setReviewRequest(null);
    setReviewEstimate(null);
    setReviewResult(null);
    setReviewFailed(false);
    setCost(null);
    applied.current = false;
  }
  function close() {
    if (busy) return;
    if (proposal || baseResult) setExitConfirm(true);
    else onClose();
  }
  async function preview() {
    if (locked.current || !body.trim()) return;
    locked.current = true;
    const ticket = epoch.current;
    setError(null);
    setPhase('previewing');
    const next: AiPoolContentRequest = {
      kind: 'pool',
      purpose: 'practice',
      plannedObjectives: objectives,
      requestId: newRequestId(),
      modelProfile: model,
      level: 'balanced',
      counts: { aperta: count - 1, chiusa_singola: 1, chiusa_multipla: 0 },
      ...(guidance.trim() ? { teacherGuidance: guidance.trim() } : {}),
      lessonSource: body,
      existingPoolQuestionCount: 0,
    };
    try {
      const result = await callables.preview(next);
      if (mounted.current && ticket === epoch.current) {
        setEstimate(result);
        setRequest(next);
        setPhase('confirm');
      }
    } catch (e) {
      if (mounted.current && ticket === epoch.current) {
        setError(describeAiContentError(e));
        setPhase('configure');
      }
    } finally {
      if (ticket === epoch.current) locked.current = false;
    }
  }
  function materialize(result: AiPoolGenerateResult | AiPoolReviewResult): StudyPractice {
    return validateStudyPractice(
      {
        version: 1,
        sourceBody: body,
        plan: result.output.studyPlan,
        questions: result.output.questions,
      },
      body,
    );
  }
  async function estimateReview(next: AiPoolReviewRequest, ticket: number) {
    if (!callables.previewReview || !callables.generateReview)
      throw new Error('Il revisore delle esercitazioni non è disponibile.');
    setPhase('estimating-review');
    const result = await callables.previewReview(next);
    if (mounted.current && ticket === epoch.current) {
      setReviewEstimate(result);
      setReviewFailed(false);
      setPhase('confirm-review');
    }
  }
  async function generate() {
    if (locked.current || !request) return;
    locked.current = true;
    const ticket = epoch.current;
    setError(null);
    setPhase('generating');
    let generated = false;
    try {
      const result = await callables.generate(request);
      const next = materialize(result);
      if (!mounted.current || ticket !== epoch.current) return;
      generated = true;
      setBaseResult(result);
      setCost(result.actualCostMicroUsd ?? null);
      if (advancedReview) {
        const review: AiPoolReviewRequest = {
          ...request,
          kind: 'pool_review',
          requestId: newRequestId(),
          candidateQuestions: result.output.questions,
          candidateStudyPlan: result.output.studyPlan,
        };
        setReviewRequest(review);
        await estimateReview(review, ticket);
      } else {
        setProposal(next);
        setPhase('review');
      }
    } catch (e) {
      if (mounted.current && ticket === epoch.current) {
        setError(describeAiContentError(e));
        setPhase(generated ? 'confirm-review' : 'confirm');
        setReviewFailed(generated);
      }
    } finally {
      if (ticket === epoch.current) locked.current = false;
    }
  }
  async function retryReviewEstimate() {
    if (locked.current || !reviewRequest) return;
    locked.current = true;
    const ticket = epoch.current;
    setError(null);
    try {
      await estimateReview(reviewRequest, ticket);
    } catch (e) {
      if (mounted.current && ticket === epoch.current) {
        setError(describeAiContentError(e));
        setPhase('confirm-review');
        setReviewFailed(true);
      }
    } finally {
      if (ticket === epoch.current) locked.current = false;
    }
  }
  async function review() {
    if (locked.current || !reviewRequest || !reviewEstimate || !callables.generateReview) return;
    locked.current = true;
    const ticket = epoch.current;
    setError(null);
    setPhase('reviewing');
    try {
      const result = await callables.generateReview(reviewRequest);
      if (
        result.kind !== 'pool_review' ||
        !['improved', 'unchanged'].includes(result.output?.reviewOutcome)
      )
        throw new Error('Revisione non valida.');
      const next = materialize(result);
      if (mounted.current && ticket === epoch.current) {
        setReviewResult(result);
        setProposal(next);
        setReviewFailed(false);
        setPhase('review');
      }
    } catch (e) {
      if (mounted.current && ticket === epoch.current) {
        setError(describeAiContentError(e));
        setReviewFailed(true);
        setPhase('confirm-review');
      }
    } finally {
      if (ticket === epoch.current) locked.current = false;
    }
  }
  return (
    <>
      <DialogShell
        title="Genera esercitazioni con IA"
        variant="wide-scroll"
        onCancel={close}
        busy={busy}
        initialFocusRef={headingRef}
      >
        <p ref={headingRef} tabIndex={-1}>
          Dall’esempio svolto alla prova autonoma, con aiuti preparati sulla lezione.
        </p>
        {phase === 'configure' && (
          <div className={styles.config}>
            <AiModelProfileField value={model} onChange={setModel} />
            <AiAdvancedReviewControl
              id="ai-practice-review"
              checked={advancedReview}
              onChange={setAdvancedReview}
              description="Controlla metodi, soluzioni, aiuti e progressione del percorso completo. Dopo la bozza vedrai la stima del revisore e confermerai il costo separatamente."
            />
            <fieldset className={practiceStyles.extent}>
              <legend className={styles.fieldLabel}>Estensione del percorso</legend>
              <div className={`${styles.optionRow} ${styles.depthOptions}`}>
                {[3, 6, 9].map((n, i) => (
                  <label
                    key={n}
                    className={`${styles.choice} ${practiceStyles.countCard} ${count === n ? styles.choiceSelected : ''}`}
                  >
                    <input
                      className={practiceStyles.hiddenRadio}
                      type="radio"
                      name="practice-count"
                      value={n}
                      checked={count === n}
                      onChange={() => setCount(n)}
                    />
                    <span className={styles.choiceLabel}>{['Breve', 'Standard', 'Estesa'][i]}</span>
                    <span className={styles.choiceMeta}>{n} attività</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <div className={styles.field}>
              <label className={styles.fieldLabel} htmlFor="practice-guidance">
                Indicazioni aggiuntive (facoltative)
              </label>
              <textarea
                id="practice-guidance"
                className={styles.guidanceTextarea}
                rows={3}
                maxLength={500}
                value={guidance}
                onChange={(e) => setGuidance(e.target.value)}
                aria-describedby="practice-guidance-count"
                placeholder="Capacità da allenare, passaggi da chiarire, errori frequenti…"
              />
              <span className={styles.counter} id="practice-guidance-count">
                {guidance.length}/500
              </span>
            </div>
            <p>
              Ogni capacità include esempio, esercizio guidato e prova autonoma. Potrai modificare
              la bozza prima di pubblicarla.
            </p>
            <div className="dialog-actions">
              <button type="button" onClick={close}>
                Annulla
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={!body.trim()}
                onClick={() => void preview()}
              >
                Calcola stima
              </button>
            </div>
          </div>
        )}
        {busy && (
          <div role="status" aria-live="polite" aria-busy="true" className="loading-row">
            <span className="spinner" aria-hidden="true" />
            <span>
              {phase === 'previewing' || phase === 'estimating-review'
                ? 'Calcolo della stima…'
                : phase === 'reviewing'
                  ? 'Revisione delle esercitazioni…'
                  : 'Generazione delle esercitazioni…'}
            </span>
          </div>
        )}
        {phase === 'confirm' && estimate && (
          <div className={styles.estimate}>
            <ul className={styles.estimateList}>
              <li>Attività: {count}</li>
              <li>Profilo: {model === 'quality' ? 'Quality' : 'Economy'}</li>
              <li>Costo generazione stimato: {formatMicroUsd(estimate.estimatedCostMicroUsd)}</li>
              <li>Tetto massimo prenotabile: {formatMicroUsd(estimate.reservationCostMicroUsd)}</li>
            </ul>
            {advancedReview && (
              <p>
                Revisione avanzata attiva. Il costo del revisore sarà calcolato sulla bozza e
                richiederà una conferma separata prima di avviarlo.
              </p>
            )}
            {replacesDraft && (
              <p>
                La proposta potrà sostituire la bozza locale solo quando scegli «Usa bozza». La
                pubblicazione richiede un’azione separata.
              </p>
            )}
            <div className="dialog-actions">
              <button type="button" onClick={configure}>
                Modifica configurazione
              </button>
              <button type="button" className="btn-primary" onClick={() => void generate()}>
                Genera esercitazioni
              </button>
            </div>
          </div>
        )}
        {phase === 'confirm-review' && baseResult && (
          <div className={styles.estimate}>
            <p>
              Bozza generata e conservata in questa finestra. Conferma il costo della revisione
              prima di proseguire.
            </p>
            <ul className={styles.estimateList}>
              <li>
                Generazione:{' '}
                {cost === null ? 'consumo esatto non disponibile' : formatMicroUsd(cost)}
              </li>
              {reviewEstimate && (
                <>
                  <li>Revisione stimata: {formatMicroUsd(reviewEstimate.estimatedCostMicroUsd)}</li>
                  <li>
                    Tetto revisione prenotabile:{' '}
                    {formatMicroUsd(reviewEstimate.reservationCostMicroUsd)}
                  </li>
                  <li>
                    Totale {cost === null ? 'stimato' : 'generazione e revisione stimata'}:{' '}
                    {formatMicroUsd(
                      (cost ?? estimate?.estimatedCostMicroUsd ?? 0) +
                        reviewEstimate.estimatedCostMicroUsd,
                    )}
                  </li>
                </>
              )}
            </ul>
            {reviewFailed && <AiAdvancedReviewFailure />}
            <div className="dialog-actions">
              <button type="button" onClick={close}>
                Annulla proposta
              </button>
              {reviewEstimate ? (
                <button type="button" className="btn-primary" onClick={() => void review()}>
                  {reviewFailed ? 'Riprova solo la revisione' : 'Conferma e revisiona'}
                </button>
              ) : (
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => void retryReviewEstimate()}
                >
                  Ricalcola stima revisione
                </button>
              )}
            </div>
          </div>
        )}
        {phase === 'review' && proposal && (
          <>
            <p role="status">
              Proposta generata.{' '}
              {cost === null
                ? 'Consumo esatto non disponibile: contabilizzato il tetto prudenziale.'
                : `Costo reale: ${formatMicroUsd(cost)}.`}
            </p>
            <AiAdvancedReviewResult
              result={null}
              status={reviewResult?.output.reviewOutcome ?? 'disabled'}
              feedback={reviewResult?.reviewFeedback}
              replayed={reviewResult?.replayed}
            />
            {reviewResult && (
              <p>
                Revisione:{' '}
                {reviewResult.actualCostMicroUsd === null
                  ? 'consumo esatto non disponibile'
                  : formatMicroUsd(reviewResult.actualCostMicroUsd)}
                . Totale:{' '}
                {cost === null || reviewResult.actualCostMicroUsd === null
                  ? 'consumo esatto non disponibile'
                  : formatMicroUsd(cost + reviewResult.actualCostMicroUsd)}
                .
              </p>
            )}
            <StudyPracticePlayer practice={proposal} />
            <p>
              «Usa bozza» porta il percorso nell’editor. Nessun salvataggio o pubblicazione avviene
              qui.
            </p>
            <div className="dialog-actions">
              <button type="button" onClick={close}>
                Annulla proposta
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={() => {
                  if (applied.current) return;
                  applied.current = true;
                  onApply(proposal);
                }}
              >
                Usa bozza
              </button>
            </div>
          </>
        )}
        {error && (
          <p role="alert" className="text-error">
            {error}
          </p>
        )}
      </DialogShell>
      {exitConfirm && (
        <AiReviewExitConfirm
          onKeepReviewing={() => setExitConfirm(false)}
          onBackToConfigure={configure}
          onAbandon={onClose}
        />
      )}
    </>
  );
}
