import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetDocs = vi.fn();

vi.mock('firebase/firestore', () => ({
  collection: (...args: unknown[]) => ({ __collection: args }),
  query: (...args: unknown[]) => ({ __query: args }),
  where: (...args: unknown[]) => ({ __where: args }),
  getDocs: (...args: unknown[]) => mockGetDocs(...args),
}));

import type { Firestore } from 'firebase/firestore';
import { loadCorrectionProgressByStudent } from '../correctionProgressService.js';

const fakeDb = {} as Firestore;

function docsFrom(data: unknown[]) {
  return { docs: data.map((d) => ({ data: () => d })) };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('loadCorrectionProgressByStudent (M5-03 «Valutate»)', () => {
  it('counts evaluated (points !== null) over total per studentUid', async () => {
    mockGetDocs.mockResolvedValueOnce(
      docsFrom([
        {
          studentUid: 's1',
          evaluations: {
            q1: { points: 2, maxPoints: 2 },
            q2: { points: null, maxPoints: 3 },
            q3: { points: 0, maxPoints: 1 },
          },
        },
        {
          studentUid: 's2',
          evaluations: {
            q1: { points: null, maxPoints: 2 },
            q2: { points: null, maxPoints: 2 },
          },
        },
      ]),
    );

    const map = await loadCorrectionProgressByStudent('ver1', fakeDb);
    expect(map.get('s1')).toEqual({ evaluated: 2, total: 3 });
    expect(map.get('s2')).toEqual({ evaluated: 0, total: 2 });
  });

  it('returns an empty map when there are no corrections', async () => {
    mockGetDocs.mockResolvedValueOnce(docsFrom([]));
    const map = await loadCorrectionProgressByStudent('ver1', fakeDb);
    expect(map.size).toBe(0);
  });

  it('performs a single query (no listener, no polling)', async () => {
    mockGetDocs.mockResolvedValueOnce(docsFrom([]));
    await loadCorrectionProgressByStudent('ver1', fakeDb);
    expect(mockGetDocs).toHaveBeenCalledTimes(1);
  });
});
