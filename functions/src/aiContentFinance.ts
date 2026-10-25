import type { StoredAiContentRun } from './aiContentEngine.js';

/** Constant-size cumulative costs of preceding executions of the same request. */
export interface ContentFinancialHistory {
  historyComplete: boolean;
  executions: number;
  knownActualMicroUsd: number;
  unknownExecutions: number;
  settledMicroUsd: number;
  reservedUnknownMicroUsd: number;
}
export const emptyContentFinancialHistory = (): ContentFinancialHistory => ({
  historyComplete: true,
  executions: 0,
  knownActualMicroUsd: 0,
  unknownExecutions: 0,
  settledMicroUsd: 0,
  reservedUnknownMicroUsd: 0,
});
export function validContentFinancialHistory(value: unknown): value is ContentFinancialHistory {
  if (!value || typeof value !== 'object') return false;
  const h = value as ContentFinancialHistory;
  return (
    typeof h.historyComplete === 'boolean' &&
    [
      h.executions,
      h.knownActualMicroUsd,
      h.unknownExecutions,
      h.settledMicroUsd,
      h.reservedUnknownMicroUsd,
    ].every((n) => Number.isSafeInteger(n) && n >= 0) &&
    h.unknownExecutions <= h.executions
  );
}
export function contentFinancialSummary(run: StoredAiContentRun): ContentFinancialHistory {
  const h = run.financialHistory ?? emptyContentFinancialHistory();
  return {
    historyComplete: run.financialHistory?.historyComplete ?? false,
    executions: h.executions + 1,
    knownActualMicroUsd: h.knownActualMicroUsd + (run.actualCostMicroUsd ?? 0),
    unknownExecutions: h.unknownExecutions + (run.actualCostMicroUsd === null ? 1 : 0),
    settledMicroUsd: h.settledMicroUsd + (run.settledCostMicroUsd ?? 0),
    reservedUnknownMicroUsd:
      h.reservedUnknownMicroUsd + (run.status === 'running' ? run.reservedCostMicroUsd : 0),
  };
}
