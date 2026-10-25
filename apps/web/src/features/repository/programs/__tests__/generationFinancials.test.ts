import { describe, expect, it, vi } from 'vitest';
import type { Functions } from 'firebase/functions';
const api = vi.hoisted(() => ({ status: vi.fn() }));
vi.mock('firebase/functions', () => ({ httpsCallable: () => api.status }));
import {
  instrumentContentCallables,
  readGenerationCosts,
  recoverContentCost,
  recordVisualPlanCosts,
  writeGenerationCost,
} from '../generationFinancials.js';
import type { MultiVisualPlan } from '../multiVisualClient.js';
const functions = {} as Functions;
const status = (over = {}) => ({
  data: {
    status: 'completed',
    knownActualMicroUsd: 65,
    unknownExecutions: 0,
    settledMicroUsd: 65,
    historyComplete: true,
    executions: 2,
    updatedAtMs: 1000,
    ...over,
  },
});
describe('generation cost ledger', () => {
  it('replaces cumulative same-run totals, retains paid failures and deduplicates replay', async () => {
    const key = 'cost-dedup';
    api.status.mockResolvedValue(status());
    const client = instrumentContentCallables(
      { generate: vi.fn(async (_req: unknown) => ({ actualCostMicroUsd: 40 })) },
      functions,
      key,
    );
    await client.generate({ kind: 'lesson', requestId: 'request' });
    await client.generate({ kind: 'lesson', requestId: 'request' });
    expect(readGenerationCosts(key)).toHaveLength(1);
    expect(readGenerationCosts(key)[0]).toMatchObject({
      knownActualMicroUsd: 65,
      unknown: false,
      settledMicroUsd: 65,
    });
    const freshModule = await import('../generationFinancials.js');
    expect(freshModule.readGenerationCosts(key)).toEqual(JSON.parse(sessionStorage.getItem(key)!));
  });
  it('never claims a provisional total when cumulative status is unavailable', async () => {
    const key = 'cost-unknown';
    api.status.mockRejectedValue(new Error('offline'));
    const client = instrumentContentCallables(
      { generate: vi.fn(async (_req: unknown) => ({ actualCostMicroUsd: 40 })) },
      functions,
      key,
    );
    await client.generate({ kind: 'lesson', requestId: 'lost' });
    expect(readGenerationCosts(key)[0]).toMatchObject({ knownActualMicroUsd: 40, unknown: true });
    api.status.mockResolvedValue(status({ unknownExecutions: 1 }));
    await recoverContentCost(functions, key, 'lost');
    expect(readGenerationCosts(key)[0]).toMatchObject({ knownActualMicroUsd: 65, unknown: true });
    api.status.mockResolvedValue(status());
    await recoverContentCost(functions, key, 'lost');
    expect(readGenerationCosts(key)[0].unknown).toBe(false);
  });
  it('ignores stale running status even at identical timestamps and invalid runtime cost fields', async () => {
    const key = 'cost-race';
    writeGenerationCost(key, {
      id: 'race',
      phase: 'Contenuto',
      knownActualMicroUsd: 0,
      unknown: true,
      settledMicroUsd: null,
    });
    let resolve!: (value: unknown) => void;
    api.status
      .mockImplementationOnce(
        () =>
          new Promise((r) => {
            resolve = r;
          }),
      )
      .mockResolvedValueOnce(status());
    const old = recoverContentCost(functions, key, 'race');
    await recoverContentCost(functions, key, 'race');
    resolve(status({ status: 'running', knownActualMicroUsd: 25, unknownExecutions: 1 }));
    await old;
    expect(readGenerationCosts(key)[0]).toMatchObject({ knownActualMicroUsd: 65, unknown: false });
    api.status.mockResolvedValue(status({ knownActualMicroUsd: -1 }));
    await recoverContentCost(functions, key, 'race');
    expect(readGenerationCosts(key)[0].knownActualMicroUsd).toBe(65);
  });
  it('preserves old image plans and replaces cumulative slot attempts without invented reviewer costs', () => {
    const key = 'cost-images';
    const plan = {
      requestId: 'old-plan',
      settlement: { proposalActualCost: 5, slots: [{ slotIndex: 0, attempts: 1, actualCost: 20 }] },
    } as MultiVisualPlan;
    recordVisualPlanCosts(key, plan);
    recordVisualPlanCosts(key, {
      ...plan,
      settlement: { ...plan.settlement, slots: [{ slotIndex: 0, attempts: 2, actualCost: 50 }] },
    });
    recordVisualPlanCosts(key, { ...plan, requestId: 'new-plan' });
    const entries = readGenerationCosts(key);
    expect(entries).toHaveLength(4);
    expect(entries.reduce((sum, e) => sum + e.knownActualMicroUsd, 0)).toBe(80);
    expect(entries.some((e) => e.phase.includes('Revisione'))).toBe(false);
  });
});

it('does not let an old proposing snapshot erase settled proposal costs', () => {
  const key = 'proposal-race';
  const plan = {
    requestId: 'proposal',
    status: 'proposed',
    slots: [],
    settlement: { proposalActualCost: 5, slots: [] },
  } as unknown as MultiVisualPlan;
  recordVisualPlanCosts(key, plan);
  recordVisualPlanCosts(key, {
    ...plan,
    status: 'proposing',
    settlement: { ...plan.settlement, proposalActualCost: null },
  });
  expect(readGenerationCosts(key)).toEqual([
    expect.objectContaining({ knownActualMicroUsd: 5, unknown: false }),
  ]);
});
