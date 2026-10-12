import { useEffect, useMemo, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../lib/firebase.js';

/** Epoch calibrated against server time; elapsed time never uses the PC clock. */
export class ServerExamClock {
  private anchor: { epoch: number; monotonic: number } | null = null;
  constructor(private monotonic = () => performance.now()) {}
  now = (): number | null =>
    this.anchor === null
      ? null
      : this.anchor.epoch + Math.max(0, this.monotonic() - this.anchor.monotonic);
  invalidate(): void {
    this.anchor = null;
  }
  calibrate(serverTimeMs: number, sentAt: number): void {
    const receivedAt = this.monotonic();
    const elapsed = receivedAt - sentAt;
    if (!Number.isFinite(serverTimeMs) || serverTimeMs <= 0 || elapsed < 0 || elapsed > 5000)
      throw new Error('Campione orologio non affidabile.');
    // The sample is a lower bound at receive: network delay must never lock
    // the draft early. The unchanged server deadline alone closes drafts.
    const epoch = serverTimeMs;
    this.anchor = { epoch: Math.max(epoch, this.now() ?? epoch), monotonic: receivedAt };
  }
}

export function useServerExamClock(active: boolean) {
  const clock = useMemo(() => new ServerExamClock(), []);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!active) return;
    let disposed = false;
    let pending = false;
    let generation = 0;
    const sync = async () => {
      if (pending || disposed || document.visibilityState === 'hidden') return;
      pending = true;
      const current = generation;
      const sent = performance.now();
      try {
        const sample = await httpsCallable<Record<string, never>, { serverTimeMs: number }>(
          functions,
          'examServerTime',
          { timeout: 10000 },
        )({});
        if (!disposed && current === generation) {
          clock.calibrate(sample.data.serverTimeMs, sent);
          setRevision((value) => value + 1);
        }
      } catch {
        // No wall-clock fallback and no new deadline; the next tick retries.
      } finally {
        pending = false;
      }
    };
    const resume = () => {
      generation++;
      clock.invalidate();
      setRevision((value) => value + 1);
      void sync();
    };
    void sync();
    const retry = setInterval(() => {
      void sync();
    }, 15000);
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('pageshow', resume);
    window.addEventListener('focus', resume);
    return () => {
      disposed = true;
      clearInterval(retry);
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('pageshow', resume);
      window.removeEventListener('focus', resume);
    };
  }, [active, clock]);
  return { now: clock.now, revision };
}
