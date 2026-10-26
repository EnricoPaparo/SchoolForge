import { useMemo, useRef, useState } from 'react';
import {
  parsePool,
  serializePool,
  type ParsedPool,
  type PoolQuestion,
} from '@schoolforge/lesson-contract';
import { DialogShell } from '../../components/DialogShell.js';
import { AiReviewExitConfirm } from './AiReviewExitConfirm.js';
import { PoolCoverageReport } from './PoolCoverageReport.js';
import { functions } from '../../lib/firebase.js';
import {
  createAiContentCallables,
  describeAiContentError,
  formatMicroUsd,
  newRequestId,
  POOL_MODEL_PROFILE_OPTIONS,
  type AiPoolReviewRequest,
  type AiPoolReviewResult,
  type AiProposalQuestion,
} from '../repository/pools/aiContentClient.js';
import styles from './AiPoolGenerationDialog.module.css';

function candidate(q: PoolQuestion, order: number): AiProposalQuestion {
  if (q.tipo === 'aperta')
    return {
      order,
      tipo: q.tipo,
      testo: q.testo,
      difficolta: q.difficolta,
      soluzione: q.soluzione,
    };
  const correct = Array.isArray(q.soluzione) ? q.soluzione : [q.soluzione];
  return {
    order,
    tipo: q.tipo,
    testo: q.testo,
    difficolta: q.difficolta,
    opzioni: q.opzioni.map((o) => o.testo),
    soluzioneIndici: correct.map((id) => q.opzioni.findIndex((o) => o.id === id)),
  };
}
function repaired(original: PoolQuestion, proposal: AiProposalQuestion): PoolQuestion {
  if (original.tipo === 'aperta' && proposal.tipo === 'aperta')
    return { ...original, testo: proposal.testo, soluzione: proposal.soluzione };
  if (original.tipo !== 'aperta' && proposal.tipo !== 'aperta' && original.tipo === proposal.tipo) {
    if (
      !proposal.soluzioneIndici.length ||
      proposal.soluzioneIndici.some(
        (i) => !Number.isInteger(i) || i < 0 || i >= proposal.opzioni.length,
      )
    )
      throw new Error('Soluzione proposta non valida.');
    const opzioni = proposal.opzioni.map((testo, index) => ({
      id: String.fromCharCode(97 + index),
      testo,
    }));
    return {
      ...original,
      testo: proposal.testo,
      opzioni,
      soluzione: proposal.soluzioneIndici.map((i) => opzioni[i]!.id),
    } as PoolQuestion;
  }
  throw new Error('La revisione ha cambiato tipo domanda.');
}

/** The server compacts output orders after discards: only their complement proves identity. */
function mappedOrders(request: AiPoolReviewRequest, result: AiPoolReviewResult): number[] | null {
  const count = request.candidateQuestions.length;
  const discarded = result.output.discardedQuestions ?? [];
  const omitted = new Set(discarded.map((q) => q.questionOrder));
  if (
    omitted.size !== discarded.length ||
    discarded.some(
      (q) => !Number.isInteger(q.questionOrder) || q.questionOrder < 0 || q.questionOrder >= count,
    )
  )
    return null;
  const retained = Array.from({ length: count }, (_, i) => i).filter((i) => !omitted.has(i));
  if (
    retained.length !== result.output.questions.length ||
    result.output.questions.some(
      (q, i) => q.order !== i || q.tipo !== request.candidateQuestions[retained[i]!]!.tipo,
    )
  )
    return null;
  return retained;
}
type Props = {
  className?: string;
  pool: ParsedPool;
  lessonSource: string;
  approvedPractice?: string;
  onApply: (pool: ParsedPool) => Promise<void>;
};
export function PoolCoherenceAudit(props: Props) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className={props.className}
        disabled={!props.lessonSource.trim() || !props.pool.questions.length}
        onClick={() => setOpen(true)}
      >
        Controlla coerenza
      </button>
      {open && <AuditDialog {...props} onClose={() => setOpen(false)} />}
    </>
  );
}
function AuditDialog({
  pool,
  lessonSource,
  approvedPractice,
  onApply,
  onClose,
}: Props & { onClose: () => void }) {
  const callables = useMemo(() => createAiContentCallables(functions), []);
  const [source] = useState(() => ({
    pool,
    lessonSource,
    approvedPractice,
    fingerprint: JSON.stringify({ pool, lessonSource, approvedPractice }),
  }));
  const stale = source.fingerprint !== JSON.stringify({ pool, lessonSource, approvedPractice });
  const [phase, setPhase] = useState<'configure' | 'estimate' | 'results'>('configure');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requests, setRequests] = useState<AiPoolReviewRequest[]>([]);
  const previews = useRef<{ estimatedCostMicroUsd: number; reservationCostMicroUsd: number }[]>([]);
  const [results, setResults] = useState<AiPoolReviewResult[]>([]);
  const completed = useRef<AiPoolReviewResult[]>([]);
  const [progress, setProgress] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [uncertainCost, setUncertainCost] = useState(false);
  const [exitConfirm, setExitConfirm] = useState(false);
  const lock = useRef(false);
  const headingRef = useRef<HTMLParagraphElement>(null);
  const latestStale = useRef(stale);
  latestStale.current = stale;
  async function action(fn: () => Promise<void>) {
    if (lock.current || latestStale.current) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(
        e instanceof Error && !('code' in e) && !('details' in e)
          ? e.message
          : describeAiContentError(e),
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  function close() {
    if (lock.current) return;
    if (attempted && !accepted && (phase !== 'results' || changes.length > 0)) setExitConfirm(true);
    else onClose();
  }
  function configure() {
    setExitConfirm(false);
    setRequests([]);
    previews.current = [];
    completed.current = [];
    setResults([]);
    setAttempted(false);
    setAccepted(false);
    setError(null);
    setUncertainCost(false);
    setPhase('configure');
  }
  async function estimate() {
    if (!callables.previewReview) throw new Error('Revisore non disponibile.');
    let next = requests;
    if (!next.length) {
      next = [];
      for (let start = 0; start < source.pool.questions.length; start += 30) {
        const chunk = source.pool.questions.slice(start, start + 30);
        const counts = { aperta: 0, chiusa_singola: 0, chiusa_multipla: 0 };
        chunk.forEach((q) => counts[q.tipo]++);
        next.push({
          kind: 'pool_review',
          requestId: newRequestId(),
          modelProfile: 'quality',
          level: 'balanced',
          lessonSource: source.lessonSource,
          counts,
          existingPoolQuestionCount: source.pool.questions.length,
          candidateQuestions: chunk.map(candidate),
          existingQuestionStems: source.pool.questions
            .filter((_, i) => i < start || i >= start + 30)
            .map((q) => q.testo)
            .slice(0, 1000),
          ...(source.approvedPractice ? { approvedPractice: source.approvedPractice } : {}),
        });
      }
      setRequests(next);
    }
    for (let i = previews.current.length; i < next.length; i++) {
      if (latestStale.current)
        throw new Error('Il contenuto è cambiato. Chiudi e riapri il controllo.');
      setProgress(`Calcolo della stima: blocco ${i + 1} di ${next.length}…`);
      previews.current.push(await callables.previewReview(next[i]!));
    }
    setPhase('estimate');
  }
  async function run() {
    if (!callables.generateReview) throw new Error('Revisore non disponibile.');
    setAttempted(true);
    for (let i = completed.current.length; i < requests.length; i++) {
      if (latestStale.current)
        throw new Error('Il contenuto è cambiato. Chiudi e riapri il controllo.');
      setProgress(`Controllo in corso: blocco ${i + 1} di ${requests.length}…`);
      try {
        completed.current.push(await callables.generateReview(requests[i]!));
      } catch (e) {
        setUncertainCost(true);
        throw e;
      }
      setResults([...completed.current]);
    }
    setPhase('results');
  }
  const mappings = results.map((r, i) => mappedOrders(requests[i]!, r));
  const changes: { index: number; question: PoolQuestion }[] = [];
  let invalidRepairs = 0;
  results.forEach((r, block) => {
    if (r.output.reviewOutcome !== 'improved') return;
    mappings[block]?.forEach((order, i) => {
      const index = block * 30 + order;
      const original = source.pool.questions[index]!;
      try {
        const question = repaired(original, r.output.questions[i]!);
        const parsed = parsePool(serializePool({ ...source.pool, questions: [question] }));
        if (!parsed.ok) invalidRepairs++;
        else if (JSON.stringify(candidate(original, i)) !== JSON.stringify(candidate(question, i)))
          changes.push({ index, question });
      } catch {
        invalidRepairs++;
      }
    });
  });
  const unvalidated =
    invalidRepairs +
    results.reduce(
      (n, r, i) =>
        n +
        (mappings[i] === null
          ? requests[i]!.candidateQuestions.length
          : (r.output.discardedQuestions?.length ?? 0)),
      0,
    );
  const allKnown = results.every((r) => typeof r.actualCostMicroUsd === 'number');
  return (
    <>
      <DialogShell
        title="Coerenza con la lezione"
        variant="wide-scroll"
        onCancel={close}
        busy={busy || exitConfirm}
        initialFocusRef={headingRef}
      >
        <p ref={headingRef} tabIndex={-1}>
          Il revisore controlla preparazione, copertura, duplicazioni, soluzioni e distrattori. Le
          modifiche richiedono la tua conferma.
        </p>
        {stale && !accepted && (
          <p role="alert">
            Il pool o la lezione sono cambiati. Chiudi e riapri il controllo prima di proseguire.
          </p>
        )}
        {phase === 'configure' && !busy && (
          <div className={styles.config}>
            <p className={styles.fixedProfile}>
              Profilo revisore:{' '}
              <strong>
                Quality — {POOL_MODEL_PROFILE_OPTIONS.find((o) => o.value === 'quality')!.modelId}
              </strong>
            </p>
            <p>
              {source.pool.questions.length}{' '}
              {source.pool.questions.length === 1 ? 'domanda' : 'domande'};{' '}
              {Math.ceil(source.pool.questions.length / 30)}{' '}
              {source.pool.questions.length <= 30 ? 'blocco' : 'blocchi'}, uno alla volta.{' '}
              {source.approvedPractice
                ? 'Pratica approvata inclusa come riferimento.'
                : 'Riferimento: testo della lezione.'}
            </p>
            <div className="dialog-actions">
              <button type="button" onClick={close}>
                Annulla
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={stale}
                onClick={() => void action(estimate)}
              >
                {error ? 'Riprova stima' : 'Calcola stima'}
              </button>
            </div>
          </div>
        )}
        {busy && (
          <div role="status" className="loading-row">
            <span className="spinner" aria-hidden="true" />
            {progress}
          </div>
        )}
        {phase === 'estimate' && (
          <div className={styles.estimate}>
            <ul className={styles.estimateList}>
              <li>
                Costo stimato:{' '}
                {formatMicroUsd(previews.current.reduce((n, p) => n + p.estimatedCostMicroUsd, 0))}
              </li>
              <li>
                Prenotazione massima totale:{' '}
                {formatMicroUsd(
                  previews.current.reduce((n, p) => n + p.reservationCostMicroUsd, 0),
                )}
              </li>
              <li>
                Blocchi completati: {results.length} di {requests.length}
              </li>
            </ul>
            <p>Nessuna modifica automatica al pool.</p>
            {uncertainCost && (
              <p>
                Il tentativo interrotto potrebbe aver consumato credito: il totale complessivo non è
                disponibile. Il retry usa le stesse richieste e conserva i blocchi riusciti.
              </p>
            )}
            {!busy && (
              <div className="dialog-actions">
                <button type="button" onClick={close}>
                  Chiudi
                </button>
                {!attempted && (
                  <button type="button" onClick={configure}>
                    Modifica configurazione
                  </button>
                )}
                <button
                  type="button"
                  className="btn-primary"
                  disabled={stale}
                  onClick={() => void action(run)}
                >
                  {attempted ? 'Riprova blocchi rimanenti' : 'Conferma ed esegui controllo'}
                </button>
              </div>
            )}
          </div>
        )}
        {results.length > 0 && (
          <>
            <p role="status">
              {phase === 'results' ? 'Controllo completato.' : 'Risultati parziali conservati.'}{' '}
              {changes.length}{' '}
              {changes.length === 1 ? 'proposta applicabile' : 'proposte applicabili'}.{' '}
              {allKnown
                ? `Costo noto dei blocchi completati: ${formatMicroUsd(results.reduce((n, r) => n + r.actualCostMicroUsd!, 0))}.`
                : 'Consumo esatto non disponibile.'}
            </p>
            {uncertainCost && (
              <p>
                Il tentativo interrotto potrebbe aver consumato credito. Il costo totale complessivo
                non è disponibile.
              </p>
            )}
            {unvalidated > 0 && (
              <p role="alert">
                {unvalidated}{' '}
                {unvalidated === 1
                  ? 'domanda non convalidata resta'
                  : 'domande non convalidate restano'}{' '}
                nel pool senza modifiche. Il controllo non ne certifica la coerenza.
              </p>
            )}
            {results.map((r, block) => (
              <details key={block}>
                <summary>Blocco {block + 1}: riepilogo e limiti</summary>
                <p>{r.output.issueCodes.join(', ') || 'Nessuna criticità segnalata.'}</p>
                <PoolCoverageReport
                  summary={
                    r.output.coverageSummary
                      ? {
                          ...r.output.coverageSummary,
                          advancedOrdinals: mappings[block]
                            ? r.output.coverageSummary.advancedOrdinals
                                .map((i) => mappings[block]![i])
                                .filter((i): i is number => i !== undefined)
                            : [],
                        }
                      : undefined
                  }
                  offset={block * 30}
                />
                {r.output.discardedQuestions?.map((q) => (
                  <p key={q.questionOrder}>
                    Domanda {block * 30 + q.questionOrder + 1}, conservata: {q.reason}
                  </p>
                ))}
                {mappings[block] === null && (
                  <p>
                    Corrispondenza non verificabile: nessuna proposta di questo blocco verrà
                    applicata.
                  </p>
                )}
                {r.reviewFeedback?.changes.map((c, i) => (
                  <p key={i}>{c}</p>
                ))}
              </details>
            ))}
            {changes.map(({ index, question }) => (
              <details key={index}>
                <summary>Domanda {index + 1}: proposta</summary>
                <p>Prima: {source.pool.questions[index]!.testo}</p>
                <p>Soluzione precedente: {solutionText(source.pool.questions[index]!)}</p>
                {source.pool.questions[index]!.tipo !== 'aperta' && (
                  <ul>
                    {(
                      source.pool.questions[index]! as Exclude<PoolQuestion, { tipo: 'aperta' }>
                    ).opzioni.map((o) => (
                      <li key={o.id}>{o.testo}</li>
                    ))}
                  </ul>
                )}
                <p>Dopo: {question.testo}</p>
                {question.tipo !== 'aperta' && (
                  <ul>
                    {question.opzioni.map((o) => (
                      <li key={o.id}>{o.testo}</li>
                    ))}
                  </ul>
                )}
                <p>Soluzione: {solutionText(question)}</p>
              </details>
            ))}
          </>
        )}
        {phase === 'results' && (
          <div className="dialog-actions">
            <button type="button" disabled={busy} onClick={close}>
              Chiudi
            </button>
            {!accepted && changes.length > 0 && (
              <button
                type="button"
                className="btn-primary"
                disabled={busy || stale}
                onClick={() =>
                  void action(async () => {
                    setProgress('Applicazione delle proposte…');
                    const byIndex = new Map(changes.map((c) => [c.index, c.question]));
                    const parsed = parsePool(
                      serializePool({
                        ...source.pool,
                        questions: source.pool.questions.map((q, i) => byIndex.get(i) ?? q),
                      }),
                    );
                    if (!parsed.ok) throw new Error('Pool revisionato non valido.');
                    await onApply(parsed.pool);
                    setAccepted(true);
                  })
                }
              >
                Applica proposta al pool
              </button>
            )}
          </div>
        )}
        {accepted && <p role="status">Proposta applicata.</p>}
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
function solutionText(question: PoolQuestion): string {
  return question.tipo === 'aperta'
    ? question.soluzione
    : question.opzioni
        .filter((o) => question.soluzione.includes(o.id))
        .map((o) => o.testo)
        .join('; ');
}
