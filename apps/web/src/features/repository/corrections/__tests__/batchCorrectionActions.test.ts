import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockComplete = vi.fn();
const mockReopen = vi.fn();
const mockReturn = vi.fn();
const mockClear = vi.fn();

vi.mock('../correctionsService.js', () => ({
  completeCorrection: (...args: unknown[]) => mockComplete(...args),
  reopenCorrection: (...args: unknown[]) => mockReopen(...args),
  returnCorrection: (...args: unknown[]) => mockReturn(...args),
  clearCorrection: (...args: unknown[]) => mockClear(...args),
}));

import type { Firestore } from 'firebase/firestore';
import {
  BATCH_CONCURRENCY,
  classifyRow,
  computeEligibility,
  describeBatchExclusion,
  runBatchCorrectionAction,
  type BatchAction,
  type BatchSelectedRow,
} from '../batchCorrectionActions.js';
import type { CorrectionProgress } from '../correctionProgressService.js';

const fakeDb = {} as Firestore;

function progress(over: Partial<CorrectionProgress>): CorrectionProgress {
  return {
    status: 'in_progress',
    evaluated: 3,
    total: 3,
    totalPoints: 8,
    maxPoints: 10,
    percentage: 80,
    hasContent: true,
    ...over,
  };
}

function row(uid: string, p: CorrectionProgress | undefined): BatchSelectedRow {
  return { studentUid: uid, studentName: `Studente ${uid}`, submissionId: `v_${uid}`, progress: p };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockComplete.mockResolvedValue(undefined);
  mockReopen.mockResolvedValue(undefined);
  mockReturn.mockResolvedValue(undefined);
  mockClear.mockResolvedValue({ cleared: true });
});

describe('classifyRow (M5-04 eligibility)', () => {
  it('complete: only in_progress fully evaluated', () => {
    expect(classifyRow('complete', row('a', progress({ status: 'in_progress' })))).toBeNull();
    expect(classifyRow('complete', row('b', progress({ status: 'completed' })))).toBe(
      'not_in_progress',
    );
    expect(
      classifyRow(
        'complete',
        row('c', progress({ status: 'in_progress', evaluated: 2, total: 3 })),
      ),
    ).toBe('not_fully_evaluated');
    expect(classifyRow('complete', row('d', undefined))).toBe('no_correction');
  });

  it('reopen: only completed or returned', () => {
    expect(classifyRow('reopen', row('a', progress({ status: 'completed' })))).toBeNull();
    expect(classifyRow('reopen', row('b', progress({ status: 'returned' })))).toBeNull();
    expect(classifyRow('reopen', row('c', progress({ status: 'in_progress' })))).toBe(
      'not_completed_or_returned',
    );
  });

  it('return: only completed', () => {
    expect(classifyRow('return', row('a', progress({ status: 'completed' })))).toBeNull();
    expect(classifyRow('return', row('b', progress({ status: 'returned' })))).toBe(
      'already_returned',
    );
    expect(classifyRow('return', row('c', progress({ status: 'in_progress' })))).toBe(
      'not_completed',
    );
  });

  it('clear: only in_progress corrections containing points or feedback', () => {
    expect(classifyRow('clear', row('a', progress({ status: 'in_progress' })))).toBeNull();
    expect(
      classifyRow('clear', row('b', progress({ status: 'in_progress', hasContent: false }))),
    ).toBe('nothing_to_clear');
    expect(classifyRow('clear', row('c', progress({ status: 'completed' })))).toBe(
      'clear_requires_reopen',
    );
    expect(classifyRow('clear', row('d', progress({ status: 'returned' })))).toBe(
      'clear_requires_reopen',
    );
    expect(classifyRow('clear', row('e', undefined))).toBe('nothing_to_clear');
  });
});

describe('computeEligibility', () => {
  it('splits selected rows into eligible and excluded with reasons', () => {
    const rows = [
      row('a', progress({ status: 'in_progress', evaluated: 3, total: 3 })),
      row('b', progress({ status: 'completed' })),
      row('c', undefined),
    ];
    const { eligible, excluded } = computeEligibility('complete', rows);
    expect(eligible.map((e) => e.studentUid)).toEqual(['a']);
    expect(excluded).toEqual([
      { studentUid: 'b', studentName: 'Studente b', reason: 'not_in_progress' },
      { studentUid: 'c', studentName: 'Studente c', reason: 'no_correction' },
    ]);
  });
});

describe('runBatchCorrectionAction', () => {
  it('calls the matching M4 service once per eligible row', async () => {
    const rows = [
      { studentUid: 'a', studentName: 'A', submissionId: 'v_a' },
      { studentUid: 'b', studentName: 'B', submissionId: 'v_b' },
    ];
    const res = await runBatchCorrectionAction('return', rows, fakeDb);
    expect(mockReturn).toHaveBeenCalledTimes(2);
    expect(mockReturn).toHaveBeenCalledWith('v_a', fakeDb);
    expect(mockComplete).not.toHaveBeenCalled();
    expect(res.every((r) => r.outcome === 'succeeded')).toBe(true);
  });

  it('reports partial success without blocking other rows', async () => {
    mockComplete.mockImplementation((id: string) =>
      id === 'v_b' ? Promise.reject(new Error('non valutata')) : Promise.resolve(),
    );
    const rows = ['a', 'b', 'c'].map((u) => ({
      studentUid: u,
      studentName: u.toUpperCase(),
      submissionId: `v_${u}`,
    }));
    const res = await runBatchCorrectionAction('complete', rows, fakeDb);
    expect(mockComplete).toHaveBeenCalledTimes(3);
    expect(res.find((r) => r.studentUid === 'b')).toEqual({
      studentUid: 'b',
      submissionId: 'v_b',
      outcome: 'failed',
      error: 'non valutata',
    });
    expect(res.filter((r) => r.outcome === 'succeeded').map((r) => r.studentUid)).toEqual([
      'a',
      'c',
    ]);
  });

  it('never runs more than BATCH_CONCURRENCY operations at once', async () => {
    expect(BATCH_CONCURRENCY).toBe(3);
    let inFlight = 0;
    let peak = 0;
    mockReopen.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          inFlight++;
          peak = Math.max(peak, inFlight);
          setTimeout(() => {
            inFlight--;
            resolve();
          }, 5);
        }),
    );
    const rows = Array.from({ length: 9 }, (_, i) => ({
      studentUid: `s${i}`,
      studentName: `S${i}`,
      submissionId: `v_s${i}`,
    }));
    await runBatchCorrectionAction('reopen', rows, fakeDb);
    expect(peak).toBeLessThanOrEqual(3);
    expect(mockReopen).toHaveBeenCalledTimes(9);
  });

  it('clear runs at most three operations concurrently and isolates a row failure', async () => {
    let inFlight = 0;
    let peak = 0;
    mockClear.mockImplementation(
      (id: string) =>
        new Promise((resolve, reject) => {
          inFlight++;
          peak = Math.max(peak, inFlight);
          setTimeout(() => {
            inFlight--;
            if (id === 'v_s2') reject(new Error('errore mirato'));
            else resolve({ cleared: true });
          }, 5);
        }),
    );
    const rows = Array.from({ length: 7 }, (_, i) => ({
      studentUid: `s${i}`,
      studentName: `S${i}`,
      submissionId: `v_s${i}`,
    }));

    const results = await runBatchCorrectionAction('clear', rows, fakeDb);

    expect(peak).toBeLessThanOrEqual(3);
    expect(mockClear).toHaveBeenCalledTimes(7);
    expect(results.filter((result) => result.outcome === 'succeeded')).toHaveLength(6);
    expect(results.find((result) => result.studentUid === 's2')).toMatchObject({
      outcome: 'failed',
      error: 'errore mirato',
    });
  });
});

describe('describeBatchExclusion', () => {
  it('maps every reason to a non-empty label', () => {
    const reasons = [
      'no_correction',
      'not_in_progress',
      'not_fully_evaluated',
      'not_completed',
      'not_completed_or_returned',
      'already_returned',
      'clear_requires_reopen',
      'nothing_to_clear',
    ] as const;
    for (const r of reasons) expect(describeBatchExclusion(r).length).toBeGreaterThan(0);
  });
});

// Type-only guard: all supported batch actions remain explicit.
const _actions: BatchAction[] = ['complete', 'reopen', 'return', 'clear'];
void _actions;
