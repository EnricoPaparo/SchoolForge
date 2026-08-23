import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Functions } from 'firebase/functions';

const callable = vi.hoisted(() => vi.fn());
const httpsCallable = vi.hoisted(() => vi.fn((_functions: unknown, _name: string) => callable));
vi.mock('firebase/functions', () => ({ httpsCallable }));

import { createVisualLifecycleClient } from '../visualLifecycleClient.js';

describe('visualLifecycleClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    callable.mockResolvedValue({ data: { status: 'completed' } });
  });

  it('registra le tre callable e invia payload chiusi', async () => {
    const functions = {} as Functions;
    const client = createVisualLifecycleClient(functions);
    expect(httpsCallable.mock.calls.map((call) => call[1])).toEqual([
      'setLessonCompleted',
      'aiVisualRemove',
      'aiVisualAbandon',
      'aiVisualCleanupForDelete',
    ]);
    await client.setLessonCompleted({
      programId: 'p',
      importId: 'i',
      lessonId: 'l',
      completed: true,
    });
    await client.removeLessonVisual({ programId: 'p', importId: 'i', lessonId: 'l' });
    await client.abandonVisual('123e4567-e89b-42d3-a456-426614174000');
    await client.cleanupForDelete({ programId: 'p', importId: 'i', lessonIds: ['l'] });
    expect(callable.mock.calls.map((call) => call[0])).toEqual([
      { programId: 'p', importId: 'i', lessonId: 'l', completed: true },
      { programId: 'p', importId: 'i', lessonId: 'l' },
      { requestId: '123e4567-e89b-42d3-a456-426614174000' },
      { programId: 'p', importId: 'i', lessonIds: ['l'] },
    ]);
  });

  it('segmenta il cleanup bulk entro il limite transazionale di 100 lezioni', async () => {
    const client = createVisualLifecycleClient({} as Functions);
    const lessonIds = Array.from({ length: 101 }, (_, index) => `l-${index}`);
    await client.cleanupForDelete({ programId: 'p', importId: 'i', lessonIds });
    expect(callable).toHaveBeenCalledTimes(2);
    expect(callable.mock.calls[0]?.[0]).toMatchObject({ lessonIds: lessonIds.slice(0, 100) });
    expect(callable.mock.calls[1]?.[0]).toMatchObject({ lessonIds: lessonIds.slice(100) });
  });
});
