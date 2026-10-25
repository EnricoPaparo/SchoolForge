import { describe, expect, it } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';
import { createPorts } from './aiContentGateway.js';
import { contentFinancialSummary, emptyContentFinancialHistory } from './aiContentFinance.js';
import { parseStoredRunDocument } from './aiContentRunDoc.js';
import type { StoredAiContentRun } from './aiContentEngine.js';
import type { AiRuntimeConfig } from './aiCorrectionRuntimeConfig.js';

function memoryDatabase() {
  const docs = new Map<string, Record<string, unknown>>();
  const doc = (path: string) => ({ path });
  const tx = {
    get: async (ref: { path: string }) => ({
      exists: docs.has(ref.path),
      data: () => docs.get(ref.path),
    }),
    set: (ref: { path: string }, data: Record<string, unknown>, options?: { merge?: boolean }) => {
      docs.set(ref.path, options?.merge ? { ...docs.get(ref.path), ...data } : data);
    },
  };
  return {
    docs,
    db: {
      doc,
      runTransaction: async (f: (t: typeof tx) => Promise<unknown>) => f(tx),
    } as unknown as Firestore,
  };
}
const config = {
  limits: { maxApplicationRetries: 0, attemptTimeoutMs: 60_000 },
  monthlyBudgetMicroUsd: 1_000_000,
  dailyBudgetMicroUsd: 1_000_000,
} as AiRuntimeConfig;
const base: StoredAiContentRun = {
  contractVersion: 1,
  kind: 'pool',
  status: 'running',
  inputHash: 'a'.repeat(64),
  modelProfile: 'economy',
  model: 'mock',
  priceListVersion: 'test',
  estimatedInputTokens: 10,
  maxOutputTokens: 10,
  actualInputTokens: null,
  actualOutputTokens: null,
  estimatedCostMicroUsd: 100,
  reservedCostMicroUsd: 100,
  settledCostMicroUsd: null,
  actualCostMicroUsd: null,
  leaseExecutionId: 'first',
  leaseExpiresAtMs: 2000,
  output: null,
  createdAtMs: 1000,
  updatedAtMs: 1000,
  expireAtMs: 100_000,
};
describe('durable cumulative content accounting', () => {
  it('preserves paid failure across same-request retry, deduplicates terminal callbacks and fences stale workers', async () => {
    const { db, docs } = memoryDatabase();
    const ports = createPorts(db, config, 'mock', undefined, false);
    const reserve = async (executionId: string, nowMs: number) =>
      ports.reserveRunAndBudget({
        opaqueRunId: 'run',
        budgetReservationKey: `budget-${executionId}`,
        inputHash: base.inputHash,
        run: { ...base, leaseExecutionId: executionId, updatedAtMs: nowMs },
        reserveMicroUsd: 100,
        expiresAtMs: nowMs + 1000,
        nowMs,
      });
    expect(await reserve('first', 1000)).toMatchObject({ kind: 'reserved' });
    const fail = {
      opaqueRunId: 'run',
      budgetReservationKey: 'budget-first',
      executionId: 'first',
      actualInputTokens: 10,
      actualOutputTokens: 10,
      actualCostMicroUsd: 25,
      settledMicroUsd: 25,
      nowMs: 1100,
    };
    await ports.failRun(fail);
    await ports.failRun({ ...fail, actualCostMicroUsd: 999 });
    expect(await reserve('second', 1200)).toMatchObject({ kind: 'reserved' });
    await ports.failRun({ ...fail, actualCostMicroUsd: 999 });
    const complete = {
      ...fail,
      budgetReservationKey: 'budget-second',
      executionId: 'second',
      actualCostMicroUsd: 40,
      settledMicroUsd: 40,
      nowMs: 1300,
      output: {
        questions: [
          { order: 0, tipo: 'aperta', testo: 'Domanda', difficolta: 2, soluzione: 'Risposta' },
        ],
      },
    };
    expect(await ports.finalizeRun(complete)).toBe('finalized');
    expect(await ports.finalizeRun({ ...complete, actualCostMicroUsd: 999 })).toBe('lost_lease');
    const run = parseStoredRunDocument(docs.get('aiContentRuns/run'))!;
    expect(contentFinancialSummary(run)).toEqual({
      historyComplete: true,
      executions: 2,
      knownActualMicroUsd: 65,
      unknownExecutions: 0,
      settledMicroUsd: 65,
      reservedUnknownMicroUsd: 0,
    });
    expect(await reserve('third', 1400)).toMatchObject({ kind: 'replay_completed' });
    expect(contentFinancialSummary(run).knownActualMicroUsd).toBe(65);
  });
  it('retains uncertainty and the conservative reservation across expired execution takeover', () => {
    const prior = contentFinancialSummary({
      ...base,
      financialHistory: emptyContentFinancialHistory(),
    });
    expect(prior).toMatchObject({
      knownActualMicroUsd: 0,
      unknownExecutions: 1,
      settledMicroUsd: 0,
      reservedUnknownMicroUsd: 100,
    });
    const recovered = contentFinancialSummary({
      ...base,
      status: 'completed',
      actualCostMicroUsd: 40,
      settledCostMicroUsd: 40,
      financialHistory: prior,
    });
    expect(recovered).toMatchObject({
      knownActualMicroUsd: 40,
      unknownExecutions: 1,
      settledMicroUsd: 40,
      reservedUnknownMicroUsd: 100,
    });
    expect(contentFinancialSummary(base).historyComplete).toBe(false);
  });
});
