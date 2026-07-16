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
          status: 'in_progress',
          totalPoints: 2,
          maxPoints: 6,
          percentage: 33,
          evaluations: {
            q1: { points: 2, maxPoints: 2 },
            q2: { points: null, maxPoints: 3 },
            q3: { points: 0, maxPoints: 1 },
          },
        },
        {
          studentUid: 's2',
          status: 'in_progress',
          totalPoints: 0,
          maxPoints: 4,
          percentage: 0,
          generalFeedback: null,
          evaluations: {
            q1: { points: null, maxPoints: 2 },
            q2: { points: null, maxPoints: 2 },
          },
        },
      ]),
    );

    const map = await loadCorrectionProgressByStudent('ver1', fakeDb);
    // s1 has evaluated questions → hasContent true.
    expect(map.get('s1')).toEqual({
      status: 'in_progress',
      evaluated: 2,
      total: 3,
      totalPoints: 2,
      maxPoints: 6,
      percentage: 33,
      hasContent: true,
    });
    // s2 has no points, no feedback, no generalFeedback → hasContent false.
    expect(map.get('s2')).toEqual({
      status: 'in_progress',
      evaluated: 0,
      total: 2,
      totalPoints: 0,
      maxPoints: 4,
      percentage: 0,
      hasContent: false,
    });
  });

  it('marks hasContent true when only a per-question or general feedback is present', async () => {
    mockGetDocs.mockResolvedValueOnce(
      docsFrom([
        {
          studentUid: 'sfeed',
          status: 'in_progress',
          totalPoints: 0,
          maxPoints: 2,
          percentage: 0,
          evaluations: { q1: { points: null, maxPoints: 2, feedback: 'nota' } },
        },
        {
          studentUid: 'sgen',
          status: 'in_progress',
          totalPoints: 0,
          maxPoints: 2,
          percentage: 0,
          generalFeedback: '[mock] commento',
          evaluations: { q1: { points: null, maxPoints: 2 } },
        },
      ]),
    );
    const map = await loadCorrectionProgressByStudent('ver1', fakeDb);
    expect(map.get('sfeed')!.hasContent).toBe(true);
    expect(map.get('sgen')!.hasContent).toBe(true);
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
