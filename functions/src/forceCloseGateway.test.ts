import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as AdminFirestore from 'firebase-admin/firestore';

/**
 * FORCE-SUBMIT-02 — test di **wiring** dell'accodamento su Cloud Tasks.
 *
 * Esiste per un motivo preciso: la firma precedente era
 * `taskQueue(FORCE_CLOSE_QUEUE, FORCE_CLOSE_REGION)`, dove il secondo argomento
 * è un `extensionId` e non una region — un riferimento che a runtime non
 * risolve alcuna coda. Questo test **fallisce** con quella firma, perché
 * pretende un unico argomento nella forma qualificata
 * `locations/{region}/functions/{queue}`.
 */

const enqueue = vi.hoisted(() => vi.fn(async () => undefined));
const taskQueue = vi.hoisted(() => vi.fn(() => ({ enqueue })));
vi.mock('firebase-admin/functions', () => ({ getFunctions: () => ({ taskQueue }) }));
vi.mock('firebase-admin/app', () => ({ getApps: () => [{}], initializeApp: () => ({}) }));
vi.mock('firebase-admin/firestore', async (importOriginal) => {
  const actual = await importOriginal<typeof AdminFirestore>();
  return { ...actual, getFirestore: () => ({}) };
});
vi.mock('firebase-functions/v2/https', () => ({
  onCall: (_opts: unknown, handler: unknown) => handler,
  HttpsError: class extends Error {},
}));
vi.mock('firebase-functions/v2/tasks', () => ({
  onTaskDispatched: (_opts: unknown, handler: unknown) => handler,
}));
vi.mock('firebase-functions/logger', () => ({
  info: () => {},
  warn: () => {},
  error: () => {},
}));

const {
  enqueueForceCloseTask,
  FORCE_CLOSE_QUEUE,
  FORCE_CLOSE_QUEUE_PATH,
  FORCE_CLOSE_REGION,
  FORCE_CLOSE_TASK_REGION,
} = await import('./forceCloseGateway.js');

const PAYLOAD = {
  verificationId: 'ver-1',
  studentUid: 'stud-a',
  ownerUid: 'owner-uid',
  requestId: 'abcdefghijklmnopqrstuvwx',
  deadlineMs: 1_800_000_060_000,
};

beforeEach(() => {
  taskQueue.mockClear();
  enqueue.mockClear();
});

describe('enqueueForceCloseTask — riferimento della coda', () => {
  it('usa il nome qualificato locations/{region}/functions/{queue}', () => {
    expect(FORCE_CLOSE_QUEUE_PATH).toBe(
      `locations/${FORCE_CLOSE_TASK_REGION}/functions/${FORCE_CLOSE_QUEUE}`,
    );
    expect(FORCE_CLOSE_REGION).toBe('us-central1');
    expect(FORCE_CLOSE_TASK_REGION).toBe('us-central1');
  });

  it('passa **un solo** argomento a taskQueue: la region non è un extensionId', async () => {
    await enqueueForceCloseTask(PAYLOAD, {
      scheduleTime: new Date(PAYLOAD.deadlineMs),
      id: 'fc-abcdefghijklmnopqrstuvwx',
    });

    expect(taskQueue).toHaveBeenCalledTimes(1);
    // Con la firma sbagliata questa asserzione fallisce: gli argomenti erano due
    // e il secondo era la region interpretata come extensionId.
    expect(taskQueue.mock.calls[0]).toHaveLength(1);
    expect(taskQueue.mock.calls[0]![0]).toBe(FORCE_CLOSE_QUEUE_PATH);
    expect(taskQueue.mock.calls[0]![0]).not.toBe(FORCE_CLOSE_TASK_REGION);
  });

  it('accoda il payload con scheduleTime e id deterministico', async () => {
    const scheduleTime = new Date(PAYLOAD.deadlineMs);
    await enqueueForceCloseTask(PAYLOAD, { scheduleTime, id: 'fc-abcdefghijklmnopqrstuvwx' });

    expect(enqueue).toHaveBeenCalledWith(PAYLOAD, {
      scheduleTime,
      id: 'fc-abcdefghijklmnopqrstuvwx',
    });
  });
});
