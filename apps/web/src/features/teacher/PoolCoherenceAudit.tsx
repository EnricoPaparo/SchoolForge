import { useMemo, useRef, useState } from 'react';
import {
  parsePool,
  serializePool,
  type ParsedPool,
  type PoolQuestion,
} from '@schoolforge/lesson-contract';
import { PoolCoverageReport } from './PoolCoverageReport.js';
import { functions } from '../../lib/firebase.js';
import {
  createAiContentCallables,
  describeAiContentError,
  formatMicroUsd,
  newRequestId,
  type AiPoolReviewRequest,
  type AiPoolReviewResult,
  type AiProposalQuestion,
} from '../repository/pools/aiContentClient.js';
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
    return {
      ...original,
      testo: proposal.testo,
      difficolta: original.difficolta,
      soluzione: proposal.soluzione,
    };
  if (original.tipo !== 'aperta' && proposal.tipo !== 'aperta' && original.tipo === proposal.tipo) {
    const opzioni = proposal.opzioni.map((testo, index) => ({
      id: String.fromCharCode(97 + index),
      testo,
    }));
    return {
      ...original,
      testo: proposal.testo,
      difficolta: original.difficolta,
      opzioni,
      soluzione:
        proposal.tipo === 'chiusa_singola'
          ? [opzioni[proposal.soluzioneIndici[0]!]!.id]
          : proposal.soluzioneIndici.map((i) => opzioni[i]!.id),
    } as PoolQuestion;
  }
  throw new Error('La revisione ha cambiato tipo domanda.');
}
export function PoolCoherenceAudit({
  pool,
  lessonSource,
  approvedPractice,
  onApply,
}: {
  pool: ParsedPool;
  lessonSource: string;
  approvedPractice?: string;
  onApply: (pool: ParsedPool) => Promise<void>;
}) {
  const callables = useMemo(() => createAiContentCallables(functions), []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requests, setRequests] = useState<AiPoolReviewRequest[]>([]);
  const [cost, setCost] = useState<number | null>(null);
  const [results, setResults] = useState<AiPoolReviewResult[]>([]);
  const [accepted, setAccepted] = useState(false);
  const lock = useRef(false);
  async function action(fn: () => Promise<void>) {
    if (lock.current) return;
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
  return (
    <section aria-label="Controllo coerenza pool" aria-busy={busy}>
      <h3>Coerenza con la lezione</h3>
      <p>
        Il revisore ricostruisce la soluzione e controlla se conoscenze e procedimenti sono
        preparati nel testo. Verifica anche copertura, duplicazioni, soluzioni e distrattori. Il
        risultato è una proposta da controllare.
      </p>
      <p>
        {approvedPractice
          ? 'La pratica approvata è disponibile come riferimento aggiuntivo.'
          : 'Controllo basato sulla lezione; nessuna pratica approvata disponibile.'}
      </p>
      <button
        type="button"
        disabled={busy || !lessonSource.trim() || !pool.questions.length}
        onClick={() =>
          void action(async () => {
            if (!callables.previewReview) throw new Error('Revisore non disponibile.');
            const next: AiPoolReviewRequest[] = [];
            for (let start = 0; start < pool.questions.length; start += 30) {
              const chunk = pool.questions.slice(start, start + 30);
              const counts = { aperta: 0, chiusa_singola: 0, chiusa_multipla: 0 };
              chunk.forEach((q) => counts[q.tipo]++);
              next.push({
                kind: 'pool_review',
                requestId: newRequestId(),
                modelProfile: 'economy',
                level: 'balanced',
                lessonSource,
                counts,
                existingPoolQuestionCount: pool.questions.length,
                candidateQuestions: chunk.map(candidate),
                existingQuestionStems: pool.questions
                  .filter((_, i) => i < start || i >= start + 30)
                  .map((q) => q.testo)
                  .slice(0, 1000),
                ...(approvedPractice ? { approvedPractice } : {}),
              });
            }
            let total = 0;
            for (const req of next)
              total += (await callables.previewReview(req)).reservationCostMicroUsd;
            setRequests(next);
            setCost(total);
            setResults([]);
            setAccepted(false);
          })
        }
      >
        Controlla coerenza con la lezione — stima
      </button>
      {cost !== null && !results.length && (
        <>
          <p>
            Prenotazione massima totale: {formatMicroUsd(cost)} per {requests.length} blocchi.
            Nessuna modifica automatica al pool.
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void action(async () => {
                if (!callables.generateReview) throw new Error('Revisore non disponibile.');
                const reviewed: AiPoolReviewResult[] = [];
                for (const request of requests)
                  reviewed.push(await callables.generateReview(request));
                setResults(reviewed);
              })
            }
          >
            Esegui controllo
          </button>
        </>
      )}
      {results.length > 0 && (
        <div role="status">
          <p>
            {results.every((r) => r.output.reviewOutcome === 'unchanged')
              ? 'Controllo completato senza proposte di sostituzione. Leggi il riepilogo per eventuali limiti di copertura.'
              : 'Il revisore propone modifiche. Leggi le differenze prima di applicarle.'}
          </p>
          {results.map((r, i) => (
            <div key={i}>
              <p>
                Blocco {i + 1}: {r.output.issueCodes.join(', ') || 'nessuna criticità rilevata'}
              </p>
              <PoolCoverageReport summary={r.output.coverageSummary} offset={i * 30} />
              {r.reviewFeedback?.changes.map((c, n) => (
                <p key={n}>{c}</p>
              ))}
            </div>
          ))}
          {results
            .flatMap((r) => r.output.questions)
            .map(
              (q, i) =>
                JSON.stringify(candidate(pool.questions[i]!, i % 30)) !== JSON.stringify(q) && (
                  <details key={i}>
                    <summary>Domanda {i + 1}: proposta</summary>
                    <p>Prima: {pool.questions[i]?.testo}</p>
                    <p>
                      Soluzione precedente:{' '}
                      {pool.questions[i]?.tipo === 'aperta'
                        ? (pool.questions[i] as Extract<PoolQuestion, { tipo: 'aperta' }>).soluzione
                        : candidate(pool.questions[i]!, i).tipo !== 'aperta'
                          ? JSON.stringify(pool.questions[i]?.soluzione)
                          : ''}
                    </p>
                    {pool.questions[i]?.tipo !== 'aperta' && (
                      <ul>
                        {(
                          pool.questions[i] as Exclude<PoolQuestion, { tipo: 'aperta' }>
                        ).opzioni.map((o) => (
                          <li key={o.id}>{o.testo}</li>
                        ))}
                      </ul>
                    )}
                    <p>Dopo: {q.testo}</p>
                    {q.tipo !== 'aperta' && (
                      <ul>
                        {q.opzioni.map((o, n) => (
                          <li key={n}>{o}</li>
                        ))}
                      </ul>
                    )}
                    <p>
                      Soluzione:{' '}
                      {q.tipo === 'aperta'
                        ? q.soluzione
                        : q.soluzioneIndici.map((n) => q.opzioni[n]).join('; ')}
                    </p>
                  </details>
                ),
            )}
          {!accepted && results.some((r) => r.output.reviewOutcome === 'improved') && (
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void action(async () => {
                  const proposals = results.flatMap((r) => r.output.questions);
                  if (proposals.length !== pool.questions.length)
                    throw new Error('Quantità della revisione non valida.');
                  const result = parsePool(
                    serializePool({
                      ...pool,
                      questions: pool.questions.map((q, i) => repaired(q, proposals[i]!)),
                    }),
                  );
                  if (!result.ok) throw new Error('Pool revisionato non valido.');
                  await onApply(result.pool);
                  setAccepted(true);
                })
              }
            >
              Applica proposta al pool
            </button>
          )}
          {accepted && <p>Proposta applicata.</p>}
        </div>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
