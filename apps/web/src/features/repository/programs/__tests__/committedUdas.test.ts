import { describe, expect, it } from 'vitest';
import { committedUdaDirSet, filterCommittedLessons } from '../committedUdas.js';

describe('committedUdas — reader coherence for staged appends', () => {
  const udas = [{ dir: 'uda-01-a' }, { dir: 'uda-02-b' }];
  const lessons = [
    { id: 'l1', udaDir: 'uda-01-a' },
    { id: 'l2', udaDir: 'uda-02-b' },
    // Staged lesson for a UDA that has no UdaDoc yet.
    { id: 'l3-staged', udaDir: 'uda-03-staged' },
  ];

  it('builds the set of committed UDA dirs', () => {
    expect(committedUdaDirSet(udas)).toEqual(new Set(['uda-01-a', 'uda-02-b']));
  });

  it('drops lessons whose udaDir has no committed UdaDoc', () => {
    const kept = filterCommittedLessons(udas, lessons);
    expect(kept.map((l) => l.id)).toEqual(['l1', 'l2']);
  });

  it('keeps everything when all UDAs are committed', () => {
    expect(filterCommittedLessons(udas, lessons.slice(0, 2))).toHaveLength(2);
  });

  it('drops all lessons when there are no committed UDAs', () => {
    expect(filterCommittedLessons([], lessons)).toEqual([]);
  });
});
