import {
  createMultiVisualClient,
  type MultiVisualIdentity,
} from '../repository/programs/multiVisualClient.js';
import { recordVisualPlanCosts } from '../repository/programs/generationFinancials.js';
import { useEffect, useSyncExternalStore } from 'react';
import type { Functions } from 'firebase/functions';
import { formatMicroUsd } from '../repository/pools/aiContentClient.js';
import {
  readGenerationCosts,
  recoverContentCost,
  subscribeGenerationCosts,
} from '../repository/programs/generationFinancials.js';
export function GenerationCostSummary({
  ledgerKey,
  functions,
  identity,
}: {
  ledgerKey: string;
  functions: Functions;
  identity?: MultiVisualIdentity;
}) {
  const entries = useSyncExternalStore(subscribeGenerationCosts, () =>
    readGenerationCosts(ledgerKey),
  );
  useEffect(() => {
    for (const entry of readGenerationCosts(ledgerKey)) {
      if (identity && entry.id.endsWith(':proposal')) {
        void createMultiVisualClient(functions)
          .status({ ...identity, requestId: entry.id.slice(0, -9) })
          .then((plan) => {
            if (plan) recordVisualPlanCosts(ledgerKey, plan);
          })
          .catch(() => undefined);
      }
      if (!entry.id.includes(':'))
        void recoverContentCost(functions, ledgerKey, entry.id).catch(() => undefined);
    }
  }, [ledgerKey, functions, identity]);
  if (!entries.length) return null;
  const known = entries.reduce((sum, e) => sum + e.knownActualMicroUsd, 0);
  const unknown = entries.filter((e) => e.unknown).length;
  return (
    <section aria-label="Costi della generazione">
      <p>
        Costo reale {unknown ? 'noto' : 'totale'}: {formatMicroUsd(known)}.
        {unknown > 0 && ` ${unknown} fasi con costo non ancora disponibile.`}
      </p>
      <details>
        <summary>Dettaglio costi per fase</summary>
        <ul>
          {entries.map((e) => (
            <li key={e.id}>
              {e.phase}: {formatMicroUsd(e.knownActualMicroUsd)}
              {e.unknown && ' + importo non disponibile'}
              {!!e.reservedUnknownMicroUsd &&
                `; riservato con esito da verificare: ${formatMicroUsd(e.reservedUnknownMicroUsd)}`}
              {e.settledMicroUsd !== null &&
                `; contabilizzato: ${formatMicroUsd(e.settledMicroUsd)}`}
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}
