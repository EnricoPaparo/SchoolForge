import type * as AdminFirestore from 'firebase-admin/firestore';
import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { doc, get, getStorage } = vi.hoisted(() => {
  const get = vi.fn(async () => ({
    exists: true,
    data: () => ({ ownerUid: 'owner' }),
  }));
  const doc = vi.fn((path: string) => {
    if (path !== 'settings/owner') throw new Error(`Unexpected document path: ${path}`);
    return { get };
  });
  const getStorage = vi.fn(() => {
    throw new Error('Unexpected storage access');
  });
  return { doc, get, getStorage };
});

vi.mock('firebase-admin/app', () => ({
  getApps: vi.fn(() => [{}]),
  initializeApp: vi.fn(),
}));

vi.mock('firebase-admin/firestore', async (importOriginal) => ({
  ...(await importOriginal<typeof AdminFirestore>()),
  getFirestore: () => ({ doc }),
}));

vi.mock('firebase-admin/storage', () => ({ getStorage }));

const { aiVisualPlanGenerateSlot, aiVisualPlanPromoteSlot } =
  await import('./aiVisualPlanExecutionGateway.js');

beforeEach(() => {
  vi.clearAllMocks();
});

describe.each([
  ['aiVisualPlanGenerateSlot', aiVisualPlanGenerateSlot],
  ['aiVisualPlanPromoteSlot', aiVisualPlanPromoteSlot],
] as const)('%s authorization', (_name, handler) => {
  it('rejects anonymous callers before document or storage access', async () => {
    const request = { data: {} } as CallableRequest<unknown>;
    const error: unknown = await Promise.resolve()
      .then(() => handler.run(request))
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(HttpsError);
    expect(error).toMatchObject({
      code: 'unauthenticated',
      httpErrorCode: { status: 401 },
      details: { code: 'unauthenticated' },
    });
    expect(doc).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
    expect(getStorage).not.toHaveBeenCalled();
  });

  it('rejects non-owners before validating malformed input or accessing storage', async () => {
    const request = {
      data: {},
      auth: { uid: 'intruder' },
    } as CallableRequest<unknown>;
    const error: unknown = await Promise.resolve()
      .then(() => handler.run(request))
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(HttpsError);
    expect(error).toMatchObject({
      code: 'permission-denied',
      httpErrorCode: { status: 403 },
      details: { code: 'not_owner' },
    });
    expect(doc).toHaveBeenCalledTimes(1);
    expect(doc).toHaveBeenCalledWith('settings/owner');
    expect(get).toHaveBeenCalledTimes(1);
    expect(getStorage).not.toHaveBeenCalled();
  });
});
