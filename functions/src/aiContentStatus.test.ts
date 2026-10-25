import { beforeEach, expect, it, vi } from 'vitest';
import type * as AdminFirestore from 'firebase-admin/firestore';
import type { CallableRequest } from 'firebase-functions/v2/https';
import { computeOpaqueRunId } from './aiContentCore.js';
const mock = vi.hoisted(() => ({ doc: vi.fn(), read: vi.fn() }));
vi.mock('firebase-admin/app', () => ({ getApps: () => [{}], initializeApp: vi.fn() }));
vi.mock('firebase-admin/firestore', async (original) => ({
  ...(await original<typeof AdminFirestore>()),
  getFirestore: () => ({ doc: mock.doc }),
}));
const { aiContentStatus } = await import('./aiContentGateway.js');
beforeEach(() => {
  vi.clearAllMocks();
  mock.doc.mockImplementation((path: string) =>
    path === 'settings/owner'
      ? { get: async () => ({ exists: true, data: () => ({ ownerUid: 'owner' }) }) }
      : { get: mock.read },
  );
  mock.read.mockResolvedValue({ exists: false });
});
it('rejects anonymous and non-owner reads before looking up any run', async () => {
  await expect(aiContentStatus.run({ data: {} } as CallableRequest<unknown>)).rejects.toMatchObject(
    { code: 'unauthenticated' },
  );
  expect(mock.doc).not.toHaveBeenCalled();
  await expect(
    aiContentStatus.run({ data: {}, auth: { uid: 'other' } } as CallableRequest<unknown>),
  ).rejects.toMatchObject({ code: 'permission-denied' });
  expect(mock.read).not.toHaveBeenCalled();
});
it('derives the run key from authenticated owner and allows no extra identity fields', async () => {
  const requestId = '11111111-2222-3333-4444-555555555555';
  await expect(
    aiContentStatus.run({
      data: { requestId, ownerUid: 'other' },
      auth: { uid: 'owner' },
    } as CallableRequest<unknown>),
  ).rejects.toMatchObject({ code: 'invalid-argument' });
  expect(mock.read).not.toHaveBeenCalled();
  const result = await aiContentStatus.run({
    data: { requestId },
    auth: { uid: 'owner' },
  } as CallableRequest<unknown>);
  expect(result).toEqual({ status: 'not_found' });
  expect(mock.doc).toHaveBeenLastCalledWith(
    `aiContentRuns/${computeOpaqueRunId('owner', requestId)}`,
  );
  expect(mock.read).toHaveBeenCalledOnce();
});
