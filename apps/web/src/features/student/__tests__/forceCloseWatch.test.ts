import { describe, expect, it, vi } from 'vitest';

const onSnapshot = vi.hoisted(() => vi.fn());
const doc = vi.hoisted(() => vi.fn(() => ({ path: 'submissions/v1_u1' })));
vi.mock('firebase/firestore', () => ({ doc, onSnapshot }));

const {
  formatRemaining,
  isUrgent,
  remainingSeconds,
  timestampToMillis,
  toForceCloseRequest,
  watchOwnForceClose,
  FORCE_CLOSE_URGENT_SECONDS,
} = await import('../forceCloseWatch.js');

const DEADLINE = { seconds: 1_800_000_060, nanoseconds: 0 };
const REQUEST_ID = 'abcdefghijklmnopqrstuvwx';

describe('toForceCloseRequest — solo richieste coerenti', () => {
  it('riconosce una bozza con entrambi i marcatori', () => {
    expect(
      toForceCloseRequest({
        status: 'draft',
        forceCloseRequestId: REQUEST_ID,
        forceCloseDeadline: DEADLINE as never,
      }),
    ).toEqual({ requestId: REQUEST_ID, deadlineMs: 1_800_000_060_000 });
  });

  it.each([
    ['documento assente', undefined],
    [
      'già consegnata',
      { status: 'submitted', forceCloseRequestId: REQUEST_ID, forceCloseDeadline: DEADLINE },
    ],
    ['senza marcatori', { status: 'draft' }],
    ['solo requestId', { status: 'draft', forceCloseRequestId: REQUEST_ID }],
    ['solo deadline', { status: 'draft', forceCloseDeadline: DEADLINE }],
    ['requestId vuoto', { status: 'draft', forceCloseRequestId: '', forceCloseDeadline: DEADLINE }],
    [
      'deadline malformata',
      { status: 'draft', forceCloseRequestId: REQUEST_ID, forceCloseDeadline: 'domani' },
    ],
  ])('«%s» ⇒ nessun banner', (_label, data) => {
    expect(toForceCloseRequest(data as never)).toBeNull();
  });
});

describe('timestampToMillis', () => {
  it('converte un Timestamp Firestore-like', () => {
    expect(timestampToMillis({ seconds: 2, nanoseconds: 500_000_000 })).toBe(2500);
    expect(timestampToMillis({ seconds: 2 })).toBe(2000);
  });

  it('rifiuta ciò che non è un timestamp', () => {
    for (const bad of [null, undefined, 0, 'x', {}, { seconds: 'x' }]) {
      expect(timestampToMillis(bad)).toBeNull();
    }
  });
});

describe('watchOwnForceClose — un solo listener sul proprio documento', () => {
  function setup() {
    const handlers = { onRequest: vi.fn(), onUnavailable: vi.fn() };
    let next: (snap: unknown) => void = () => {};
    let fail: () => void = () => {};
    const unsubscribe = vi.fn();
    onSnapshot.mockImplementation((_ref, onNext, onError) => {
      next = onNext;
      fail = onError;
      return unsubscribe;
    });
    const returned = watchOwnForceClose('v1', 'u1', {} as never, handlers);
    return { handlers, next: () => next, fail: () => fail, unsubscribe, returned };
  }

  it('osserva esattamente la propria submission, senza query', () => {
    doc.mockClear();
    setup();
    expect(doc).toHaveBeenCalledWith({}, 'submissions', 'v1_u1');
    expect(onSnapshot).toHaveBeenCalledTimes(1);
  });

  it('propaga la richiesta corrente e la sua rimozione', () => {
    const { handlers, next } = setup();
    next()({
      exists: () => true,
      data: () => ({
        status: 'draft',
        forceCloseRequestId: REQUEST_ID,
        forceCloseDeadline: DEADLINE,
      }),
    });
    expect(handlers.onRequest).toHaveBeenCalledWith({
      requestId: REQUEST_ID,
      deadlineMs: 1_800_000_060_000,
    });

    next()({ exists: () => true, data: () => ({ status: 'draft' }) });
    expect(handlers.onRequest).toHaveBeenLastCalledWith(null);
  });

  it('documento assente, non più bozza o permesso negato ⇒ sessione verosimilmente chiusa', () => {
    const { handlers, next, fail } = setup();
    next()({ exists: () => false });
    next()({ exists: () => true, data: () => ({ status: 'submitted' }) });
    fail()();
    expect(handlers.onUnavailable).toHaveBeenCalledTimes(3);
    expect(handlers.onRequest).not.toHaveBeenCalled();
  });

  it('restituisce la funzione di disiscrizione del listener', () => {
    const { unsubscribe, returned } = setup();
    returned();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});

describe('countdown derivato dalla deadline', () => {
  it('ricalcola i secondi mancanti dall’orologio, mai decrementando', () => {
    const deadline = 60_000;
    expect(remainingSeconds(deadline, 0)).toBe(60);
    expect(remainingSeconds(deadline, 30_000)).toBe(30);
    // Scheda sospesa per 40 s: il valore riflette la realtà, non i tick persi.
    expect(remainingSeconds(deadline, 55_000)).toBe(5);
    expect(remainingSeconds(deadline, 60_000)).toBe(0);
    expect(remainingSeconds(deadline, 90_000)).toBe(0);
  });

  it('formatta mm:ss a due cifre', () => {
    expect(formatRemaining(60)).toBe('01:00');
    expect(formatRemaining(47)).toBe('00:47');
    expect(formatRemaining(0)).toBe('00:00');
    expect(formatRemaining(-5)).toBe('00:00');
  });

  it('gli ultimi 10 secondi sono urgenti', () => {
    expect(isUrgent(FORCE_CLOSE_URGENT_SECONDS + 1)).toBe(false);
    expect(isUrgent(FORCE_CLOSE_URGENT_SECONDS)).toBe(true);
    expect(isUrgent(0)).toBe(true);
  });
});
