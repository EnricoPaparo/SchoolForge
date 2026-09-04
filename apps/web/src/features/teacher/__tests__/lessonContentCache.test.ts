import { describe, expect, it, vi } from 'vitest';
import { LessonContentCache } from '../lessonContentCache.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

describe('lesson content memory cache', () => {
  it('coalesces pending reads and reopens fresh content without a loader', async () => {
    const cache = new LessonContentCache<string>();
    const pending = deferred<string>();
    const loader = vi.fn(() => pending.promise);
    const first = cache.load('a', loader);
    expect(cache.load('a', loader)).toBe(first);
    pending.resolve('');
    await first;
    expect(await cache.load('a', loader)).toBe('');
    expect(loader).toHaveBeenCalledOnce();
  });

  it('expires exactly at 60 seconds from resolution, not the last hit', async () => {
    let now = 0;
    const cache = new LessonContentCache<string>(8, 60_000, () => now);
    const loader = vi.fn().mockResolvedValue('body');
    await cache.load('a', loader);
    now = 59_999;
    expect(cache.peek('a')).toBe('body');
    now = 60_000;
    expect(cache.peek('a')).toBeUndefined();
    await cache.load('a', loader);
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('evicts the least recently used entry and remains bounded', async () => {
    const cache = new LessonContentCache<string>(2);
    await cache.load('a', async () => 'a');
    await cache.load('b', async () => 'b');
    expect(cache.peek('a')).toBe('a');
    await cache.load('c', async () => 'c');
    expect(cache.peek('b')).toBeUndefined();
    expect(cache.peek('a')).toBe('a');
    expect(cache.peek('c')).toBe('c');
  });

  it('clear/retry prevents an old request poisoning or removing a newer pending read', async () => {
    const cache = new LessonContentCache<string>();
    const old = deferred<string>();
    const newer = deferred<string>();
    const first = cache.load('a', () => old.promise);
    cache.clear();
    const second = cache.load('a', () => newer.promise);
    old.resolve('obsolete');
    await first;
    expect(cache.peek('a')).toBeUndefined();
    expect(cache.load('a', async () => 'unwanted')).toBe(second);
    newer.resolve('current');
    await second;
    expect(cache.peek('a')).toBe('current');
  });

  it('does not retain failures and allows a real retry', async () => {
    const cache = new LessonContentCache<string>();
    const loader = vi.fn().mockRejectedValueOnce(new Error('denied')).mockResolvedValue('ok');
    await expect(cache.load('a', loader)).rejects.toThrow('denied');
    expect(cache.peek('a')).toBeUndefined();
    expect(await cache.load('a', loader)).toBe('ok');
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('never caches reads overlapping concurrent writes, including failed mutations', async () => {
    const cache = new LessonContentCache<string>();
    await cache.load('a', async () => 'old');
    const finishA = cache.beginMutation();
    const finishB = cache.beginMutation();
    expect(cache.peek('a')).toBeUndefined();
    const pending = deferred<string>();
    const read = cache.load('a', () => pending.promise);
    finishA();
    pending.resolve('during');
    await read;
    expect(cache.peek('a')).toBeUndefined();
    await cache.load('a', async () => 'also during');
    expect(cache.peek('a')).toBeUndefined();
    finishB();
    await cache.load('a', async () => 'committed');
    expect(cache.peek('a')).toBe('committed');
  });

  it('does not cache a pre-mutation response arriving after mutation completion', async () => {
    const cache = new LessonContentCache<string>();
    const pending = deferred<string>();
    const read = cache.load('a', () => pending.promise);
    const finish = cache.beginMutation();
    finish();
    await cache.load('a', async () => 'saved');
    pending.resolve('old');
    await read;
    expect(cache.peek('a')).toBe('saved');
  });
});
