import { describe, expect, it } from 'vitest';
import { shuffleWithRng } from '../examShuffle.js';

describe('shuffleWithRng (EXAM-UX-03)', () => {
  it('never loses or duplicates elements', () => {
    const input = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    const out = shuffleWithRng(input, mulberry32(42));
    expect([...out].sort((a, b) => a - b)).toEqual(input);
    expect(out).toHaveLength(input.length);
  });

  it('does not mutate the input array', () => {
    const input = ['a', 'b', 'c', 'd'];
    const snapshot = [...input];
    shuffleWithRng(input, mulberry32(1));
    expect(input).toEqual(snapshot);
  });

  it('is deterministic for a given injected RNG', () => {
    const input = [1, 2, 3, 4, 5, 6];
    expect(shuffleWithRng(input, mulberry32(7))).toEqual(shuffleWithRng(input, mulberry32(7)));
  });

  it('actually reorders for a suitable seed (not the identity)', () => {
    const input = [1, 2, 3, 4, 5, 6, 7, 8];
    expect(shuffleWithRng(input, mulberry32(123))).not.toEqual(input);
  });

  it('leaves a single-element or empty array unchanged', () => {
    expect(shuffleWithRng([], mulberry32(1))).toEqual([]);
    expect(shuffleWithRng(['only'], mulberry32(1))).toEqual(['only']);
  });

  it('is unbiased enough: rng()=0 keeps a valid permutation (no out-of-range index)', () => {
    // rng always 0 → j always 0 → still a valid permutation, no undefined holes.
    const out = shuffleWithRng([1, 2, 3, 4], () => 0);
    expect([...out].sort((a, b) => a - b)).toEqual([1, 2, 3, 4]);
  });
});

/** Tiny deterministic PRNG for tests (not used in production). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
