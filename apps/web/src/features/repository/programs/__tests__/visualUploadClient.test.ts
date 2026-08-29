import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createVisualUploadClient, describeVisualUploadError } from '../visualUploadClient.js';

const callable = vi.hoisted(() => vi.fn());
const handlers = vi.hoisted(() => new Map<string, ReturnType<typeof vi.fn>>());

vi.mock('firebase/functions', () => ({
  httpsCallable: (_functions: unknown, name: string) => {
    const handler = vi.fn(async (input: unknown) => ({ data: await handlers.get(name)?.(input) }));
    callable(name, handler);
    return handler;
  },
}));

beforeEach(() => {
  callable.mockClear();
  handlers.clear();
});

describe('visualUploadClient', () => {
  it('collega le tre callable al contratto server senza rimodellare i payload', async () => {
    handlers.set('aiVisualUploadAccept', vi.fn().mockResolvedValue({ status: 'ready' }));
    handlers.set('aiVisualUploadPromote', vi.fn().mockResolvedValue({ assetId: 'asset' }));
    handlers.set('aiVisualUploadAbandon', vi.fn().mockResolvedValue({ status: 'abandoned' }));
    const client = createVisualUploadClient({} as never);
    const accept = { requestId: 'r', base64: 'AA==', anchor: {} } as never;
    const promote = { requestId: 'r', promotionRequestId: 'p', mode: { mode: 'add' } } as never;

    await client.accept(accept);
    await client.promote(promote);
    await client.abandon('r');

    expect(handlers.get('aiVisualUploadAccept')).toHaveBeenCalledWith(accept);
    expect(handlers.get('aiVisualUploadPromote')).toHaveBeenCalledWith(promote);
    expect(handlers.get('aiVisualUploadAbandon')).toHaveBeenCalledWith({ requestId: 'r' });
    expect(callable.mock.calls.map(([name]) => name)).toEqual([
      'aiVisualUploadAccept',
      'aiVisualUploadPromote',
      'aiVisualUploadAbandon',
    ]);
  });

  it('traduce i codici applicativi e mantiene un fallback sicuro', () => {
    expect(describeVisualUploadError({ details: { code: 'visual_slot_full' } })).toContain(
      'tre immagini',
    );
    expect(describeVisualUploadError(new Error('offline'))).toContain('stesso tentativo');
  });
});
