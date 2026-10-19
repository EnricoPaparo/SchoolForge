import { useEffect, useRef, useState } from 'react';
import { DialogShell } from './workspaceDialogs.js';
import {
  AiCorrectionSettingsFields,
  type AiCorrectionSettingsValue,
} from './AiCorrectionSettingsFields.js';
import { AiAdvancedReviewControl } from './AiAdvancedReviewControl.js';
import {
  buildRequest,
  newRequestId,
  describeAiError,
  describeExclusion,
  DEFAULT_MODEL_PROFILE,
  MODEL_PROFILE_OPTIONS,
  GRADING_MODE_OPTIONS,
  type AiCorrectionCallables,
  type AiCorrectionPlanView,
  type AiRunResult,
} from '../repository/corrections/aiCorrectionClient.js';
import styles from './AiBatchCorrectionDialog.module.css';

export interface PlannedCorrectionProps {
  verificationId: string;
  submissionIds: string[];
  ownerUid?: string;
  submissionLabels?: Record<string, string>;
  callables: AiCorrectionCallables;
  defaults: AiCorrectionSettingsValue;
  onClose: () => void;
  onApplied: (result: AiRunResult) => void;
}
const usd = (micro: number) => `${(micro / 1000000).toFixed(6)} USD`;

/** The durable checkpoint belongs to the authenticated server owner. Nothing is
 * copied into browser storage; re-opening recovers the same group request IDs. */
export function AiPlannedCorrectionDialog({
  verificationId,
  submissionIds,
  ownerUid,
  submissionLabels = {},
  callables,
  defaults,
  onClose,
  onApplied,
}: PlannedCorrectionProps) {
  const [settings, setSettings] = useState({ ...defaults, modelProfile: DEFAULT_MODEL_PROFILE });
  const [advancedReview, setAdvancedReview] = useState(true);
  const [plan, setPlan] = useState<AiCorrectionPlanView | null>(null);
  const [phase, setPhase] = useState<
    'loading' | 'configure' | 'previewing' | 'confirm' | 'running' | 'paused' | 'result'
  >('loading');
  const [error, setError] = useState<string | null>(null);
  const active = useRef(true);
  const stop = useRef(false);
  const sending = useRef(false);
  const generation = useRef(0);
  const identity = useRef({ ownerUid, verificationId });
  identity.current = { ownerUid, verificationId };
  useEffect(() => {
    generation.current++;
    active.current = true;
    const session = { ownerUid, verificationId };
    setPlan(null);
    setError(null);
    setPhase('loading');
    void callables.planStatus!({ verificationId })
      .then((saved) => {
        if (
          !active.current ||
          identity.current.ownerUid !== session.ownerUid ||
          identity.current.verificationId !== session.verificationId
        )
          return;
        setPlan(saved);
        if (saved) {
          setSettings({
            modelProfile: saved.settings.modelProfile ?? DEFAULT_MODEL_PROFILE,
            gradingMode: saved.settings.gradingMode,
            teacherGuidance: saved.settings.teacherGuidance ?? '',
          });
          setAdvancedReview(saved.settings.advancedReview !== false);
        }
        setPhase(
          saved
            ? saved.consented
              ? saved.groups.every((g) => g.state === 'completed')
                ? 'result'
                : 'paused'
              : 'confirm'
            : 'configure',
        );
      })
      .catch((err) => {
        if (
          !active.current ||
          identity.current.ownerUid !== session.ownerUid ||
          identity.current.verificationId !== session.verificationId
        )
          return;
        setError(describeAiError(err));
        setPhase('configure');
      });
    return () => {
      active.current = false;
      stop.current = true;
      generation.current++;
    };
  }, [callables, ownerUid, verificationId]);

  async function preview(ids = submissionIds) {
    if (sending.current) return;
    sending.current = true;
    setError(null);
    setPhase('previewing');
    const attempt = generation.current;
    try {
      const response = await callables.planPreview!(
        buildRequest(
          verificationId,
          ids,
          newRequestId(),
          settings.gradingMode,
          settings.teacherGuidance,
          settings.modelProfile,
          advancedReview,
        ),
      );
      if (!active.current || generation.current !== attempt) return;
      setPlan(response);
      setPhase('confirm');
    } catch (err) {
      if (active.current && generation.current === attempt) {
        setError(describeAiError(err));
        setPhase('configure');
      }
    } finally {
      sending.current = false;
    }
  }

  async function execute() {
    if (!plan || sending.current) return;
    sending.current = true;
    stop.current = false;
    setError(null);
    setPhase('running');
    const attempt = generation.current;
    let current = plan;
    try {
      for (let index = 0; index < current.groups.length; index++) {
        const group = current.groups[index]!;
        if (group.state === 'completed') continue;
        if (stop.current || !active.current || generation.current !== attempt) break;
        current = await callables.planRunGroup!({
          verificationId,
          planId: current.planId,
          groupIndex: index,
          maximumCostMicroUsd: current.preview.maximumCostMicroUsd ?? 0,
          groupMaximumCostMicroUsd: group.maximumCostMicroUsd,
        });
        if (!active.current || generation.current !== attempt) return;
        setPlan(current);
        const result = current.groups[index]?.result;
        if (result) onApplied(result);
        if (current.groups[index]?.state !== 'completed') {
          stop.current = true;
          break;
        }
      }
      if (active.current && generation.current === attempt)
        setPhase(current.groups.every((g) => g.state === 'completed') ? 'result' : 'paused');
    } catch (err) {
      if (active.current && generation.current === attempt) {
        setError(describeAiError(err));
        // The server may have completed the group after the response was lost.
        // Restore metadata, but do not automatically invoke any further group.
        try {
          const saved = await callables.planStatus!({ verificationId, planId: current.planId });
          if (saved && active.current && generation.current === attempt) setPlan(saved);
        } catch {
          /* next explicit resume repeats status verification */
        }
        if (active.current && generation.current === attempt) setPhase('paused');
      }
    } finally {
      sending.current = false;
    }
  }

  const completed = plan?.groups.filter((g) => g.state === 'completed') ?? [];
  const processed = completed.reduce((sum, g) => sum + g.submissionIds.length, 0);
  const allIds = plan?.groups.flatMap((g) => g.submissionIds) ?? [];
  const settled = completed.reduce((sum, g) => sum + (g.result?.costSettledMicroUsd ?? 0), 0);
  const failed = completed.flatMap(
    (g) => g.result?.results.filter((r) => r.outcome === 'failed' || r.outcome === 'partial') ?? [],
  );
  const pendingIds =
    plan?.groups
      .filter((g) => g.state === 'pending' || g.state === 'blocked')
      .flatMap((g) => g.submissionIds) ?? [];
  const safeFailedIds = completed
    .filter(
      (g) =>
        !g.result?.results.some((r) => r.reason === 'provider_timeout') &&
        !(g.result as (AiRunResult & { retry?: { unknownBillingAttempts?: number } }) | undefined)
          ?.retry?.unknownBillingAttempts,
    )
    .flatMap(
      (g) =>
        g.result?.results
          .filter((r) => r.outcome === 'failed' || r.outcome === 'partial')
          .map((r) => r.submissionId) ?? [],
    );
  const remainingIds = [...pendingIds, ...safeFailedIds];
  const label = (id: string) =>
    submissionLabels[id] ?? `Consegna ${Math.max(0, allIds.indexOf(id)) + 1}`;
  const busy = phase === 'loading' || phase === 'previewing';
  function close() {
    stop.current = true;
    onClose();
  }
  return (
    <DialogShell
      title="Correggi con IA"
      onCancel={close}
      busy={busy}
      closeOnBackdrop={false}
      closeOnEscape={false}
    >
      {phase === 'loading' && <p role="status">Recupero delle correzioni in corso…</p>}
      {error && (
        <p role="alert" className="text-error">
          {error}
        </p>
      )}
      {plan && phase !== 'configure' && (
        <div className={styles.appliedGuidance}>
          <strong>Criteri del piano</strong>
          <p>
            {MODEL_PROFILE_OPTIONS.find((o) => o.value === plan.settings.modelProfile)?.label ??
              'Economico'}{' '}
            ·{' '}
            {GRADING_MODE_OPTIONS.find((o) => o.value === plan.settings.gradingMode)?.label ??
              'Equilibrato'}{' '}
            · Revisione avanzata {plan.settings.advancedReview === false ? 'disattivata' : 'attiva'}
          </p>
          <p>{plan.settings.teacherGuidance || 'Nessuna indicazione aggiuntiva'}</p>
        </div>
      )}
      {phase === 'configure' && (
        <div className={styles.config}>
          <p>
            L’IA propone punteggio e feedback per le domande aperte; le chiuse restano
            deterministiche. La selezione sarà organizzata automaticamente in gruppi.
          </p>
          <p>
            Consegne selezionate: <strong>{submissionIds.length}</strong>
          </p>
          <AiCorrectionSettingsFields
            value={settings}
            onChange={setSettings}
            disabled={false}
            idPrefix="ai-plan"
          />
          <AiAdvancedReviewControl
            id="ai-plan-review"
            checked={advancedReview}
            disabled={false}
            onChange={setAdvancedReview}
            description="Il revisore verifica punteggi e feedback. La seconda valutazione aggiunge un costo incluso nella stima e nel massimo autorizzabile."
          />
          <div className="dialog-actions">
            <button onClick={close}>Annulla</button>
            <button className="btn-primary" onClick={() => void preview()}>
              Calcola stima
            </button>
          </div>
        </div>
      )}
      {phase === 'previewing' && (
        <p role="status" aria-busy="true">
          Preparo i gruppi e verifico il budget complessivo…
        </p>
      )}
      {phase === 'confirm' && plan && (
        <>
          <p>
            Consegne selezionate: {plan.preview.counts.selected}. Elaborabili:{' '}
            {plan.preview.counts.eligible}. Escluse: {plan.preview.counts.excluded}.
          </p>
          <p>
            {plan.groups.length} gruppi progressivi. Una sola conferma autorizza l’intero piano.
          </p>
          <ul>
            <li>Costo stimato: {plan.preview.costEstimated.toFixed(6)} USD</li>
            <li>
              Massimo autorizzabile, inclusi retry e revisione:{' '}
              {usd(plan.preview.maximumCostMicroUsd ?? 0)}
            </li>
            <li>Token stimati: {plan.preview.tokensEstimated}</li>
            <li>Domande già valutate ignorate: {plan.preview.counts.alreadyGradedIgnored}</li>
          </ul>
          <p>
            La disponibilità è verificata ora e nuovamente prima di ogni gruppo. Altre operazioni
            possono consumare il budget nel frattempo.
          </p>
          <p>
            {plan.preview.mode === 'mock'
              ? 'Modalità mock — costo reale 0'
              : 'Modalità OpenAI — costo reale registrato dopo ogni gruppo'}
          </p>
          <details>
            <summary>Gruppi e massimi autorizzati</summary>
            <ol>
              {plan.groups.map((g) => (
                <li key={g.requestId}>
                  {g.submissionIds.map(label).join(', ')} — massimo {usd(g.maximumCostMicroUsd)}
                </li>
              ))}
            </ol>
          </details>
          {!!plan.preview.excluded.length && (
            <details>
              <summary>Consegne escluse ({plan.preview.excluded.length})</summary>
              <ul>
                {plan.preview.excluded.map((e) => (
                  <li key={e.submissionId}>
                    {submissionLabels[e.submissionId] ?? e.submissionId}:{' '}
                    {describeExclusion(e.reason)}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {plan.budget && (
            <div role="alert">
              <p>
                {plan.budget.reason === 'daily_budget_exceeded'
                  ? 'Il budget giornaliero disponibile non basta per l’intera selezione.'
                  : 'Il budget mensile disponibile non basta per l’intera selezione.'}{' '}
                Disponibilità prudenziale: {usd(plan.budget.availableMicroUsd)}.
              </p>
              <p>
                Puoi preparare un nuovo piano per {plan.budget.compatibleSubmissionIds.length}{' '}
                consegne compatibili. Le altre rimarranno da correggere.
              </p>
              {!!plan.budget.compatibleSubmissionIds.length && (
                <button onClick={() => void preview(plan.budget!.compatibleSubmissionIds)}>
                  Prepara piano per {plan.budget.compatibleSubmissionIds.length} consegne
                </button>
              )}
            </div>
          )}
          <div className="dialog-actions">
            <button onClick={close}>Annulla</button>
            <button
              onClick={() => {
                setPlan(null);
                setError(null);
                setPhase('configure');
              }}
            >
              Modifica impostazioni
            </button>
            <button
              className="btn-primary"
              disabled={!!plan.budget || !plan.groups.length}
              onClick={() => void execute()}
            >
              Conferma correzione
            </button>
          </div>
        </>
      )}
      {plan && ['running', 'paused', 'result'].includes(phase) && (
        <>
          <div role="status" aria-live="polite">
            <strong>
              {phase === 'running'
                ? 'Correzione in corso…'
                : phase === 'paused'
                  ? 'Correzione sospesa'
                  : failed.length
                    ? 'Elaborazione terminata con consegne da riprendere.'
                    : 'Correzione completata.'}
            </strong>
            <p>
              Consegne elaborate: {processed} di {plan.preview.counts.eligible}. Gruppi completati:{' '}
              {completed.length} di {plan.groups.length}.
            </p>
          </div>
          <progress
            max={Math.max(1, plan.preview.counts.eligible)}
            value={processed}
            aria-label="Consegne elaborate"
          />
          <p>
            Costo contabilizzato, incluse quote prudenziali: {usd(settled)}. Massimo dell’intero
            piano: {usd(plan.preview.maximumCostMicroUsd ?? 0)}.
          </p>
          {phase === 'running' && (
            <p>
              Puoi fermarti o chiudere: il gruppo avviato terminerà; i successivi partiranno
              soltanto alla ripresa.
            </p>
          )}
          <details open>
            <summary>Avanzamento consegne</summary>
            <ul>
              {plan.groups.flatMap((g, index) =>
                g.submissionIds.map((id) => (
                  <li key={id}>
                    {label(id)}:{' '}
                    {g.state === 'completed'
                      ? (() => {
                          const r = g.result?.results.find((r) => r.submissionId === id);
                          return r?.reason
                            ? describeExclusion(r.reason)
                            : r?.outcome === 'succeeded'
                              ? 'corretta'
                              : r?.outcome === 'partial'
                                ? 'parziale'
                                : 'da verificare';
                        })()
                      : phase === 'running' && index === completed.length
                        ? 'in elaborazione'
                        : g.state === 'running'
                          ? 'esito da recuperare'
                          : 'in attesa'}
                  </li>
                )),
              )}
            </ul>
          </details>
          <div className="dialog-actions">
            {phase === 'running' && (
              <button
                onClick={() => {
                  stop.current = true;
                }}
              >
                Ferma dopo il gruppo corrente
              </button>
            )}
            {phase === 'paused' && !plan.groups.some((g) => g.state === 'blocked') && (
              <button className="btn-primary" onClick={() => void execute()}>
                Riprendi correzione
              </button>
            )}
            {phase !== 'running' && remainingIds.length > 0 && (
              <button onClick={() => void preview(remainingIds)}>
                Nuova stima delle consegne rimanenti
              </button>
            )}
            {phase === 'result' && (
              <button
                onClick={() => {
                  setPlan(null);
                  setPhase('configure');
                }}
              >
                Nuova selezione
              </button>
            )}
            <button onClick={close}>Chiudi</button>
          </div>
        </>
      )}
    </DialogShell>
  );
}
