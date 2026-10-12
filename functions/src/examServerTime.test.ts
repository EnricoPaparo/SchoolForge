import { afterEach, expect, it, vi } from 'vitest';
import { examServerTime } from './examServerTime.js';
afterEach(() => vi.restoreAllMocks());
it('rejects anonymous clock requests', async () => {
  await expect(examServerTime.run({ data: {} } as never)).rejects.toMatchObject({
    code: 'unauthenticated',
  });
});
it('returns only authoritative server time to authenticated callers', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(1800000000000);
  expect(await examServerTime.run({ data: {}, auth: { uid: 'student' } } as never)).toEqual({
    serverTimeMs: 1800000000000,
  });
});
