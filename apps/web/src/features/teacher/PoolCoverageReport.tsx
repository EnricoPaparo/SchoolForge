import type { PoolCoverageSummary } from '@schoolforge/lesson-contract';
export function PoolCoverageReport({
  summary,
  offset = 0,
}: {
  summary: PoolCoverageSummary | undefined;
  offset?: number;
}) {
  if (!summary) return null;
  return (
    <section aria-label="Riepilogo copertura">
      <h4>Riepilogo del controllo IA</h4>
      <p>
        Riepilogo della proposta analizzata: le modifiche successive richiedono un nuovo controllo.
        La corrispondenza didattica resta un giudizio, non una certificazione.
      </p>
      <p>Capacità verificate:</p>
      <ul>
        {summary.coveredCapabilities.map((c, i) => (
          <li key={i}>{c}</li>
        ))}
      </ul>
      <p>Lacune o preparazione da integrare:</p>
      {summary.gaps.length ? (
        <ul>
          {summary.gaps.map((g, i) => (
            <li key={i}>{g}</li>
          ))}
        </ul>
      ) : (
        <p>Nessuna lacuna segnalata dal modello.</p>
      )}
      <p>
        Richieste avanzate:{' '}
        {summary.advancedOrdinals.length
          ? summary.advancedOrdinals.map((i) => i + 1 + offset).join(', ')
          : 'nessuna segnalata'}
        .
      </p>
    </section>
  );
}
