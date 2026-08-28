import { beforeEach, describe, expect, it, vi } from 'vitest';

const callable = vi.hoisted(() => vi.fn());
const httpsCallable = vi.hoisted(() => vi.fn(() => callable));

vi.mock('firebase/functions', () => ({ httpsCallable }));

import { createMultiVisualClient, type MultiVisualPlanRequest } from '../multiVisualClient.js';

const requestId = '11111111-1111-4111-8111-111111111111';
const resumedRequestId = '22222222-2222-4222-8222-222222222222';
const identity = { programId: 'program', importId: 'import', lessonId: 'lesson' };
const plan = {
  planHash: 'a'.repeat(64),
  requestId,
  status: 'proposed',
  slots: [],
  budgetCeiling: {},
  settlement: {},
};
const authorizeInput: MultiVisualPlanRequest = {
  ...identity,
  requestId,
  quantity: { mode: 'exact', ceiling: 1 },
  replacementAssetId: null,
  titolo: 'Titolo',
  sottotitolo: null,
  difficolta: 'base',
  concettiChiave: [],
  obiettivi: [],
  udaTitle: 'UDA',
  udaContext: null,
};

describe('multiVisualClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('estrae il piano dagli envelope di generate, edit e promote', async () => {
    callable
      .mockResolvedValueOnce({ data: { replayed: false, plan } })
      .mockResolvedValueOnce({ data: { replayed: true, plan } })
      .mockResolvedValueOnce({ data: { replayed: false, assetId: 'asset', plan } });
    const client = createMultiVisualClient({} as never);

    await expect(client.generateSlot({ ...identity, requestId, slotIndex: 0 })).resolves.toBe(plan);
    await expect(
      client.editSlot({
        ...identity,
        requestId,
        editRequestId: resumedRequestId,
        slotIndex: 0,
        abandon: true,
      }),
    ).resolves.toBe(plan);
    await expect(
      client.promoteSlot({
        ...identity,
        requestId,
        slotIndex: 0,
        promotionRequestId: resumedRequestId,
        mode: { mode: 'add' },
      }),
    ).resolves.toBe(plan);
  });

  it('rifiuta una risposta senza piano invece di far esplodere il rendering', async () => {
    callable.mockResolvedValue({ data: { replayed: false } });
    const client = createMultiVisualClient({} as never);
    await expect(client.generateSlot({ ...identity, requestId, slotIndex: 0 })).rejects.toThrow(
      'multi_visual_invalid_response',
    );
  });

  it('riprende il piano attivo comunicato dal server senza nuova identità economica', async () => {
    callable
      .mockRejectedValueOnce({
        details: { code: 'visual_plan_already_active', requestId: resumedRequestId },
      })
      .mockResolvedValueOnce({ data: { ...plan, requestId: resumedRequestId } });
    const client = createMultiVisualClient({} as never);

    await expect(client.authorize(authorizeInput)).resolves.toMatchObject({
      requestId: resumedRequestId,
      status: 'proposed',
    });
    expect(callable).toHaveBeenNthCalledWith(1, authorizeInput);
    expect(callable).toHaveBeenNthCalledWith(2, {
      ...authorizeInput,
      requestId: resumedRequestId,
    });
  });

  it('non ritenta errori diversi da visual_plan_already_active', async () => {
    const failure = { details: { code: 'budget_unavailable' } };
    callable.mockRejectedValue(failure);
    const client = createMultiVisualClient({} as never);
    await expect(client.authorize(authorizeInput)).rejects.toBe(failure);
    expect(callable).toHaveBeenCalledTimes(1);
  });
});
