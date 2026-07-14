import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../lib/firebase.js', () => ({ db: {}, storage: {} }));

const mockCollection = vi.fn();
const mockQuery = vi.fn();
const mockWhere = vi.fn();
const mockOnSnapshot = vi.fn();
const mockUnsubscribe = vi.fn();

vi.mock('firebase/firestore', () => ({
  collection: (...args: unknown[]) => mockCollection(...args),
  query: (...args: unknown[]) => mockQuery(...args),
  where: (...args: unknown[]) => mockWhere(...args),
  onSnapshot: (...args: unknown[]) => mockOnSnapshot(...args),
}));

import { watchSubmissions } from '../submissionsMonitorService.js';
import type { Firestore } from 'firebase/firestore';
import type { SubmissionDoc } from '../../../../types/firestore.js';

const fakeDb = {} as Firestore;

beforeEach(() => {
  vi.clearAllMocks();
  mockCollection.mockReturnValue({ id: 'submissions' });
  mockQuery.mockImplementation((...args: unknown[]) => ({ _query: args }));
  mockWhere.mockImplementation((field: string, op: string, value: unknown) => ({
    field,
    op,
    value,
  }));
  mockOnSnapshot.mockReturnValue(mockUnsubscribe);
});

describe('watchSubmissions', () => {
  it('filters the query by ownerUid and verificationId only', () => {
    watchSubmissions('ver-1', 'owner-1', fakeDb, vi.fn(), vi.fn());

    expect(mockWhere).toHaveBeenCalledWith('ownerUid', '==', 'owner-1');
    expect(mockWhere).toHaveBeenCalledWith('verificationId', '==', 'ver-1');
    expect(mockWhere).toHaveBeenCalledTimes(2);
  });

  it('maps only the compact monitor fields plus a sanitized attentionEvents copy, never answers/flagged', () => {
    const submission: SubmissionDoc = {
      submissionId: 'ver-1_stud-1',
      verificationId: 'ver-1',
      studentUid: 'stud-1',
      ownerUid: 'owner-1',
      status: 'submitted',
      answers: { '0': { tipo: 'aperta', testo: 'secret answer' } },
      flagged: { '0': true },
      attentionEvents: [
        { type: 'tab_blur', ts: 1 },
        { type: 'copy_attempt', ts: 2 },
      ],
      deliveryCode: 'SF-2026-A1B2',
      verificationTitle: 'Verifica 1',
      className: 'Classe A',
      startedAt: {} as never,
      lastSavedAt: {} as never,
      submittedAt: {} as never,
    };

    const onChange = vi.fn();
    mockOnSnapshot.mockImplementation((_q: unknown, next: (snap: unknown) => void) => {
      next({ docs: [{ data: () => submission }] });
      return mockUnsubscribe;
    });

    watchSubmissions('ver-1', 'owner-1', fakeDb, onChange, vi.fn());

    expect(onChange).toHaveBeenCalledWith([
      {
        studentUid: 'stud-1',
        status: 'submitted',
        lastSavedAt: submission.lastSavedAt,
        submittedAt: submission.submittedAt,
        deliveryCode: 'SF-2026-A1B2',
        attentionEventsCount: 2,
        correctionStatus: 'submitted',
        attentionEvents: [
          { type: 'tab_blur', ts: 1 },
          { type: 'copy_attempt', ts: 2 },
        ],
      },
    ]);
    const mapped = onChange.mock.calls[0][0][0];
    expect(mapped).not.toHaveProperty('answers');
    expect(mapped).not.toHaveProperty('flagged');
    expect(mapped.attentionEvents).not.toBe(submission.attentionEvents);
  });

  it('returns an empty attentionEvents array when the submission has none', () => {
    const submission: SubmissionDoc = {
      submissionId: 'ver-1_stud-1',
      verificationId: 'ver-1',
      studentUid: 'stud-1',
      ownerUid: 'owner-1',
      status: 'draft',
      answers: {},
      flagged: {},
      attentionEvents: [],
      deliveryCode: null,
      verificationTitle: 'Verifica 1',
      className: 'Classe A',
      startedAt: {} as never,
      lastSavedAt: {} as never,
      submittedAt: null,
    };

    const onChange = vi.fn();
    mockOnSnapshot.mockImplementation((_q: unknown, next: (snap: unknown) => void) => {
      next({ docs: [{ data: () => submission }] });
      return mockUnsubscribe;
    });

    watchSubmissions('ver-1', 'owner-1', fakeDb, onChange, vi.fn());

    const mapped = onChange.mock.calls[0][0][0];
    expect(mapped.attentionEvents).toEqual([]);
    expect(mapped.attentionEventsCount).toBe(0);
  });

  it('forwards listener errors via onError', () => {
    const onError = vi.fn();
    const boom = new Error('permission-denied');
    mockOnSnapshot.mockImplementation((_q: unknown, _next: unknown, errCb: (e: Error) => void) => {
      errCb(boom);
      return mockUnsubscribe;
    });

    watchSubmissions('ver-1', 'owner-1', fakeDb, vi.fn(), onError);

    expect(onError).toHaveBeenCalledWith(boom);
  });

  it('returns the unsubscribe function from onSnapshot', () => {
    const unsub = watchSubmissions('ver-1', 'owner-1', fakeDb, vi.fn(), vi.fn());
    expect(unsub).toBe(mockUnsubscribe);
  });
});
