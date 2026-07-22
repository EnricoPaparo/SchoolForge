import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetDoc = vi.fn();
const mockSetReturnVisible = vi.fn();
const mockSetSolutionsVisible = vi.fn();

vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, collection: string, id: string) => ({ path: `${collection}/${id}` }),
  getDoc: (...args: unknown[]) => mockGetDoc(...args),
}));

vi.mock('../correctionsService.js', () => ({
  setReturnVisibleToStudent: (...args: unknown[]) => mockSetReturnVisible(...args),
  setSolutionsVisible: (...args: unknown[]) => mockSetSolutionsVisible(...args),
}));

import type { Firestore } from 'firebase/firestore';
import type { CorrectionProgress } from '../correctionProgressService.js';
import type { BatchSelectedRow } from '../batchCorrectionActions.js';
import {
  BATCH_RETURN_VISIBILITY_CONCURRENCY,
  describeBatchReturnVisibilityExclusion,
  loadBatchReturnVisibilityEligibility,
  runBatchReturnVisibilityAction,
} from '../batchReturnVisibility.js';

const db = {} as Firestore;
const verification = {
  teacherSnapshot: {
    distributionMode: 'same_questions',
    questions: [{ order: 0, tipo: 'aperta', maxPoints: 2, testo: 'Q', soluzione: 'S' }],
  },
} as never;

function progress(status: CorrectionProgress['status']): CorrectionProgress {
  return {
    status,
    evaluated: 1,
    total: 1,
    totalPoints: 2,
    maxPoints: 2,
    percentage: 100,
    hasContent: true,
  };
}

function row(
  uid: string,
  status: CorrectionProgress['status'] | null = 'returned',
): BatchSelectedRow {
  return {
    studentUid: uid,
    studentName: `Studente ${uid}`,
    submissionId: `v1_${uid}`,
    progress: status ? progress(status) : undefined,
  };
}

function returnSnap(uid: string, overrides: Record<string, unknown> = {}) {
  return {
    exists: () => true,
    data: () => ({
      correctionId: `v1_${uid}`,
      studentUid: uid,
      ownerUid: 'owner',
      verificationId: 'v1',
      visibleToStudent: false,
      solutionsVisible: false,
      ...overrides,
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSetReturnVisible.mockResolvedValue('changed');
  mockSetSolutionsVisible.mockResolvedValue('changed');
  mockGetDoc.mockImplementation((ref: { path: string }) =>
    Promise.resolve(returnSnap(ref.path.split('_').at(-1)!)),
  );
});

describe('loadBatchReturnVisibilityEligibility', () => {
  it('uses loaded correction status and point-reads only returned candidates', async () => {
    const result = await loadBatchReturnVisibilityEligibility({
      rows: [row('ok'), row('none', null), row('completed', 'completed')],
      ownerUid: 'owner',
      verificationId: 'v1',
      verification,
      db,
    });

    expect(mockGetDoc).toHaveBeenCalledTimes(1);
    expect(result.eligible.map((entry) => entry.studentUid)).toEqual(['ok']);
    expect(result.excluded.map((entry) => entry.reason)).toEqual(['no_correction', 'not_returned']);
  });

  it('excludes missing or inconsistent return projections', async () => {
    mockGetDoc
      .mockResolvedValueOnce({ exists: () => false })
      .mockResolvedValueOnce(returnSnap('b', { ownerUid: 'other' }));

    const result = await loadBatchReturnVisibilityEligibility({
      rows: [row('a'), row('b')],
      ownerUid: 'owner',
      verificationId: 'v1',
      verification,
      db,
    });

    expect(result.eligible).toHaveLength(0);
    expect(result.excluded.map((entry) => entry.reason)).toEqual([
      'missing_return',
      'inconsistent_return',
    ]);
  });
});

describe('runBatchReturnVisibilityAction', () => {
  function eligible(uid: string) {
    return {
      ...row(uid),
      visibleToStudent: false,
      solutionsVisible: false,
    };
  }

  it.each([
    ['show_return', mockSetReturnVisible, true],
    ['hide_return', mockSetReturnVisible, false],
    ['show_solutions', mockSetSolutionsVisible, true],
    ['hide_solutions', mockSetSolutionsVisible, false],
  ] as const)('%s invokes only its canonical service with %s', async (action, service, value) => {
    await runBatchReturnVisibilityAction({
      action,
      rows: [eligible('a')],
      db,
      verificationId: 'v1',
      verification,
    });

    expect(service).toHaveBeenCalledTimes(1);
    expect(service.mock.calls[0]?.[0]).toBe('v1_a');
    expect(service.mock.calls[0]?.[1]).toBe(value);
    expect(
      action.includes('solutions') ? mockSetReturnVisible : mockSetSolutionsVisible,
    ).not.toHaveBeenCalled();
  });

  it('reports changed, no-op and sanitized failure without blocking other rows', async () => {
    mockSetReturnVisible
      .mockResolvedValueOnce('changed')
      .mockResolvedValueOnce('noop')
      .mockRejectedValueOnce(new Error('permission-denied project@example.test'));

    const result = await runBatchReturnVisibilityAction({
      action: 'show_return',
      rows: [eligible('a'), eligible('b'), eligible('c')],
      db,
      verificationId: 'v1',
      verification,
    });

    expect(result.map((entry) => entry.outcome)).toEqual(['succeeded', 'noop', 'failed']);
    const failure = result[2];
    expect(failure?.outcome).toBe('failed');
    if (!failure || failure.outcome !== 'failed') throw new Error('Expected failed result');
    expect(failure.error).toBe('Operazione non riuscita per questa consegna. Riprova.');
    expect(failure.error).not.toContain('project@example.test');
  });

  it('never exceeds concurrency three', async () => {
    expect(BATCH_RETURN_VISIBILITY_CONCURRENCY).toBe(3);
    let active = 0;
    let peak = 0;
    mockSetReturnVisible.mockImplementation(
      () =>
        new Promise<'changed'>((resolve) => {
          active++;
          peak = Math.max(peak, active);
          setTimeout(() => {
            active--;
            resolve('changed');
          }, 5);
        }),
    );

    await runBatchReturnVisibilityAction({
      action: 'hide_return',
      rows: Array.from({ length: 9 }, (_, index) => eligible(`s${index}`)),
      db,
      verificationId: 'v1',
      verification,
    });
    expect(peak).toBeLessThanOrEqual(3);
  });

  it('passes the assigned VEX variant only to setSolutionsVisible', async () => {
    const questions = [
      { order: 0, tipo: 'aperta', maxPoints: 2, testo: 'Comune', soluzione: 'S0' },
      { order: 1, tipo: 'aperta', maxPoints: 2, testo: 'A', soluzione: 'S1' },
      { order: 2, tipo: 'aperta', maxPoints: 2, testo: 'B', soluzione: 'S2' },
    ];
    const vex = {
      teacherSnapshot: {
        distributionMode: 'equivalent_variants',
        questions,
      },
    } as never;
    await runBatchReturnVisibilityAction({
      action: 'show_solutions',
      rows: [
        {
          ...eligible('a'),
          assignedQuestionOrders: [0, 2],
          assignedAnswerKeys: ['0', '2'],
        },
      ],
      db,
      verificationId: 'v1',
      verification: vex,
    });

    expect(mockSetSolutionsVisible).toHaveBeenCalledWith('v1_a', true, db, {
      submission: {
        submissionId: 'v1_a',
        verificationId: 'v1',
        assignedQuestionOrders: [0, 2],
        assignedAnswerKeys: ['0', '2'],
      },
      verification: vex,
      questions,
    });
  });
});

it('maps every exclusion reason to readable copy', () => {
  for (const reason of [
    'no_correction',
    'not_returned',
    'missing_return',
    'inconsistent_return',
    'invalid_variant',
  ] as const) {
    expect(describeBatchReturnVisibilityExclusion(reason)).not.toBe('');
  }
});
