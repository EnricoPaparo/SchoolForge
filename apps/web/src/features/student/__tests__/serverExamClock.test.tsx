import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ServerExamClock, useServerExamClock } from '../serverExamClock.js';
const { sample } = vi.hoisted(() => ({ sample: vi.fn() }));
vi.mock('../../../lib/firebase.js', () => ({ functions: {} }));
vi.mock('firebase/functions', () => ({ httpsCallable: () => sample }));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  sample.mockReset();
});

describe('calibrated exam clock', () => {
  it.each([-120000, 120000])('ignores PC offset %i and later wall clock changes', (offset) => {
    let elapsed = 0;
    const clock = new ServerExamClock(() => elapsed);
    vi.spyOn(Date, 'now').mockReturnValue(1000000 + offset);
    clock.calibrate(1000000, 0);
    expect(clock.now()).toBe(1000000);
    elapsed = 60000;
    vi.mocked(Date.now).mockReturnValue(-999999);
    expect(clock.now()).toBe(1060000);
  });
  it('a new mount never turns a stale deadline into another grace period', () => {
    const clock = new ServerExamClock(() => 0);
    clock.calibrate(1065000, 0);
    expect(1060000 - clock.now()!).toBeLessThan(0);
  });
  it('never locks early due to response delay and rejects slow/malformed samples', () => {
    let elapsed = 4000;
    const clock = new ServerExamClock(() => elapsed);
    clock.calibrate(1000000, 0);
    expect(clock.now()).toBe(1000000);
    expect(clock.now()!).toBeLessThan(1000000 + 4000);
    elapsed = 7000;
    expect(() => clock.calibrate(2000000, 0)).toThrow();
    expect(() => clock.calibrate(NaN, elapsed)).toThrow();
    expect(clock.now()).toBe(1003000);
    clock.invalidate();
    expect(clock.now()).toBeNull();
  });
  it('retries failed synchronization without using local time or changing deadlines', async () => {
    vi.useFakeTimers();
    sample
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue({ data: { serverTimeMs: 1000000 } });
    const { result } = renderHook(() => useServerExamClock(true));
    await act(async () => {});
    expect(result.current.now()).toBeNull();
    await act(async () => {
      vi.advanceTimersByTime(15000);
    });
    expect(result.current.now()).toBe(1000000);
  });
  it('invalidates on resume when monotonic time stopped during sleep and awaits a new sample', async () => {
    sample.mockResolvedValueOnce({ data: { serverTimeMs: 1000000 } });
    const { result } = renderHook(() => useServerExamClock(true));
    await act(async () => {});
    sample.mockRejectedValueOnce(new Error('offline'));
    await act(async () => {
      window.dispatchEvent(new Event('pageshow'));
    });
    expect(result.current.now()).toBeNull();
  });
});
