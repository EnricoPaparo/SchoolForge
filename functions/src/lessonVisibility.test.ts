import { beforeEach, expect, it, vi } from 'vitest';
import type * as AdminFirestore from 'firebase-admin/firestore';
import type { CallableRequest } from 'firebase-functions/v2/https';
const mocks = vi.hoisted(() => ({ doc: vi.fn(), get: vi.fn() }));
vi.mock('firebase-admin/app', () => ({ getApps: () => [{}], initializeApp: vi.fn() }));
vi.mock('firebase-admin/firestore', async (original) => ({
  ...(await original<typeof AdminFirestore>()),
  getFirestore: () => ({ doc: mocks.doc }),
}));
const { setLessonVisibility } = await import('./lessonVisibilityGateway.js');
beforeEach(() => {
  vi.clearAllMocks();
  mocks.doc.mockReturnValue({ get: mocks.get });
  mocks.get.mockResolvedValue({ exists: true, data: () => ({ ownerUid: 'owner' }) });
});
it('rejects anonymous callers before any Firestore access', async () => {
  await expect(
    setLessonVisibility.run({ data: {} } as CallableRequest<unknown>),
  ).rejects.toMatchObject({ code: 'unauthenticated' });
  expect(mocks.doc).not.toHaveBeenCalled();
});
it('rejects students and other users before inspecting the lesson or payload', async () => {
  await expect(
    setLessonVisibility.run({ data: {}, auth: { uid: 'student' } } as CallableRequest<unknown>),
  ).rejects.toMatchObject({ code: 'permission-denied' });
  expect(mocks.doc).toHaveBeenCalledOnce();
  expect(mocks.doc).toHaveBeenCalledWith('settings/owner');
});
