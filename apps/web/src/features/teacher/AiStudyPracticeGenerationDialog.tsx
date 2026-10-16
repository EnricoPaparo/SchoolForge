import { useEffect, useRef, useState } from 'react';
import { DialogShell } from './workspaceDialogs.js';
import { AiModelProfileField } from './AiModelProfileField.js';
import { AiReviewExitConfirm } from './AiReviewExitConfirm.js';
import {
  DEFAULT_POOL_MODEL_PROFILE,
  describeAiContentError,
  formatMicroUsd,
  newRequestId,
  type AiContentCallables,
  type AiPoolContentRequest,
  type AiPoolPreviewResult,
  type PoolModelProfile,
} from '../repository/pools/aiContentClient.js';
import { validateStudyPractice, type StudyPractice } from '../repository/programs/studyPractice.js';
import { StudyPracticePlayer } from '../student/StudyPracticePlayer.js';
import styles from './AiPoolGenerationDialog.module.css';
import practiceStyles from './AiStudyPracticeGenerationDialog.module.css';

type Phase = 'configure' | 'previewing' | 'confirm' | 'generating' | 'review';

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
  const busy = phase === 'previewing' || phase === 'generating';
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
  }
  function close() {
    if (busy) return;
    if (proposal) setExitConfirm(true);
    else onClose();
  }
  async function preview() {
    if (locked.current || !body.trim()) return;
    locked.current = true;
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
      if (mounted.current) {
        setEstimate(result);
        setRequest(next);
        setPhase('confirm');
      }
    } catch (e) {
      if (mounted.current) {
        setError(describeAiContentError(e));
        setPhase('configure');
      }
    } finally {
      locked.current = false;
    }
  }
  async function generate() {
    if (locked.current || !request) return;
    locked.current = true;
    setError(null);
    setPhase('generating');
    try {
      const result = await callables.generate(request);
      const next = validateStudyPractice(
        {
          version: 1,
          sourceBody: body,
          plan: result.output.studyPlan,
          questions: result.output.questions,
        },
        body,
      );
      if (mounted.current) {
        setProposal(next);
        setCost(result.actualCostMicroUsd ?? null);
        setPhase('review');
      }
    } catch (e) {
      if (mounted.current) {
        setError(describeAiContentError(e));
        setPhase('confirm');
      }
    } finally {
      locked.current = false;
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
            <fieldset className={practiceStyles.extent}>
              <legend className={styles.fieldLabel}>Estensione del percorso</legend>
              <div className={`${styles.optionRow} ${styles.depthOptions}`}>
                {[3, 6, 9].map((n, i) => (
                  <label
                    key={n}
                    className={`${styles.choice} ${count === n ? styles.choiceSelected : ''}`}
                  >
                    <input
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
              {phase === 'previewing' ? 'Calcolo della stima…' : 'Generazione delle esercitazioni…'}
            </span>
          </div>
        )}
        {phase === 'confirm' && estimate && (
          <div className={styles.estimate}>
            <ul className={styles.estimateList}>
              <li>Attività: {count}</li>
              <li>Profilo: {model === 'quality' ? 'Quality' : 'Economy'}</li>
              <li>Costo stimato: {formatMicroUsd(estimate.estimatedCostMicroUsd)}</li>
              <li>Tetto massimo prenotabile: {formatMicroUsd(estimate.reservationCostMicroUsd)}</li>
            </ul>
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
        {phase === 'review' && proposal && (
          <>
            <p role="status">
              Proposta generata.{' '}
              {cost === null
                ? 'Consumo esatto non disponibile: contabilizzato il tetto prudenziale.'
                : `Costo reale: ${formatMicroUsd(cost)}.`}
            </p>
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
