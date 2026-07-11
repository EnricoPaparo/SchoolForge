import { describe, expect, it } from 'vitest';
import { mapWithConcurrency } from '../mapWithConcurrency.js';

describe('mapWithConcurrency', () => {
  it('preserves output order regardless of resolution order', async () => {
    const items = [30, 10, 20, 5, 25];
    const result = await mapWithConcurrency(items, 3, (ms) => {
      return new Promise<number>((resolve) => setTimeout(() => resolve(ms), ms));
    });
    expect(result).toEqual(items);
  });

  it('never runs more than `concurrency` mappers at once', async () => {
    const items = Array.from({ length: 10 }, (_, i) => i);
    let inFlight = 0;
    let maxInFlight = 0;

    await mapWithConcurrency(items, 4, async (i) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight -= 1;
      return i;
    });

    expect(maxInFlight).toBeLessThanOrEqual(4);
  });

  it('maps every item exactly once', async () => {
    const items = ['a', 'b', 'c'];
    let calls = 0;
    const result = await mapWithConcurrency(items, 2, async (s) => {
      calls += 1;
      return s.toUpperCase();
    });
    expect(calls).toBe(3);
    expect(result).toEqual(['A', 'B', 'C']);
  });

  it('handles an empty list', async () => {
    const result = await mapWithConcurrency<number, number>([], 4, async (n) => n);
    expect(result).toEqual([]);
  });
});
