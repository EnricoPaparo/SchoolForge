import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Firebase mocks ───────────────────────────────────────────────────────────

const mockGetDoc = vi.fn();
const mockSetDoc = vi.fn();
const mockUpdateDoc = vi.fn();
const mockBatchUpdate = vi.fn();
const mockBatchSet = vi.fn();
const mockBatchCommit = vi.fn();

vi.mock('firebase/firestore', async () => {
  const actual = await vi.importActual<typeof import('firebase/firestore')>('firebase/firestore');
  return {
    ...actual,
    getDoc: (...args: unknown[]) => mockGetDoc(...args),
    setDoc: (...args: unknown[]) => mockSetDoc(...args),
    updateDoc: (...args: unknown[]) => mockUpdateDoc(...args),
    writeBatch: () => ({
      update: mockBatchUpdate,
      set: mockBatchSet,
      commit: mockBatchCommit,
    }),
    doc: (db: unknown, ...segments: string[]) => ({ __path: segments.join('/') }),
    serverTimestamp: () => ({ __serverTimestamp: true }),
    arrayUnion: (...items: unknown[]) => ({ __arrayUnion: items }),
    Timestamp: {
      now: () => ({ seconds: 1000, nanoseconds: 0 }),
    },
  };
});

import type { Firestore } from 'firebase/firestore';
import {
  generateDeliveryCode,
  loadReceipt,
  loadSubmission,
  saveDraft,
  startSubmission,
  submissionId,
  submitSubmission,
} from '../submissionsService.js';

const fakeDb = {} as Firestore;

beforeEach(() => {
  vi.clearAllMocks();
  mockBatchCommit.mockResolvedValue(undefined);
  mockSetDoc.mockResolvedValue(undefined);
  mockUpdateDoc.mockResolvedValue(undefined);
});

// ─── submissionId ─────────────────────────────────────────────────────────────

describe('submissionId', () => {
  it('concatenates verificationId and studentUid with underscore', () => {
    expect(submissionId('ver-abc', 'uid-xyz')).toBe('ver-abc_uid-xyz');
  });
});

// ─── generateDeliveryCode ─────────────────────────────────────────────────────

describe('generateDeliveryCode', () => {
  it('matches the format SF-YYYY-XXXX', () => {
    const code = generateDeliveryCode();
    expect(code).toMatch(/^SF-\d{4}-[A-Z0-9]{4}$/);
  });

  it('includes the current year', () => {
    const year = new Date().getFullYear().toString();
    expect(generateDeliveryCode()).toContain(year);
  });

  it('produces different codes on successive calls (statistical)', () => {
    const codes = new Set(Array.from({ length: 10 }, () => generateDeliveryCode()));
    expect(codes.size).toBeGreaterThan(1);
  });
});

// ─── loadSubmission ───────────────────────────────────────────────────────────

describe('loadSubmission', () => {
  it('reads from submissions/{verificationId}_{studentUid}', async () => {
    mockGetDoc.mockResolvedValue({ exists: () => false });
    await loadSubmission('ver-1', 'uid-1', fakeDb);
    const [ref] = mockGetDoc.mock.calls[0] as [{ __path: string }];
    expect(ref.__path).toBe('submissions/ver-1_uid-1');
  });

  it('returns null when the document does not exist', async () => {
    mockGetDoc.mockResolvedValue({ exists: () => false });
    const result = await loadSubmission('ver-1', 'uid-1', fakeDb);
    expect(result).toBeNull();
  });

  it('returns the document data when it exists', async () => {
    const data = { submissionId: 'ver-1_uid-1', status: 'draft' };
    mockGetDoc.mockResolvedValue({ exists: () => true, data: () => data });
    const result = await loadSubmission('ver-1', 'uid-1', fakeDb);
    expect(result).toEqual(data);
  });
});

// ─── loadReceipt ──────────────────────────────────────────────────────────────

describe('loadReceipt', () => {
  it('reads from submissionReceipts/{verificationId}_{studentUid}', async () => {
    mockGetDoc.mockResolvedValue({ exists: () => false });
    await loadReceipt('ver-1', 'uid-1', fakeDb);
    const [ref] = mockGetDoc.mock.calls[0] as [{ __path: string }];
    expect(ref.__path).toBe('submissionReceipts/ver-1_uid-1');
  });

  it('returns null when no receipt exists', async () => {
    mockGetDoc.mockResolvedValue({ exists: () => false });
    expect(await loadReceipt('ver-1', 'uid-1', fakeDb)).toBeNull();
  });

  it('returns receipt data when it exists', async () => {
    const data = { deliveryCode: 'SF-2026-ABCD' };
    mockGetDoc.mockResolvedValue({ exists: () => true, data: () => data });
    expect(await loadReceipt('ver-1', 'uid-1', fakeDb)).toEqual(data);
  });
});

// ─── startSubmission ──────────────────────────────────────────────────────────

describe('startSubmission', () => {
  const input = {
    verificationId: 'ver-1',
    studentUid: 'uid-1',
    ownerUid: 'owner-1',
    verificationTitle: 'Matematica Q1',
    className: '3A',
  };

  it('writes to submissions/{id}', async () => {
    await startSubmission(input, fakeDb);
    const [ref] = mockSetDoc.mock.calls[0] as [{ __path: string }, unknown];
    expect(ref.__path).toBe('submissions/ver-1_uid-1');
  });

  it('sets status to draft', async () => {
    await startSubmission(input, fakeDb);
    const [, payload] = mockSetDoc.mock.calls[0] as [unknown, { status: string }];
    expect(payload.status).toBe('draft');
  });

  it('sets submissionId matching the document path', async () => {
    await startSubmission(input, fakeDb);
    const [, payload] = mockSetDoc.mock.calls[0] as [unknown, { submissionId: string }];
    expect(payload.submissionId).toBe('ver-1_uid-1');
  });

  it('initialises answers, flagged, attentionEvents as empty', async () => {
    await startSubmission(input, fakeDb);
    const [, payload] = mockSetDoc.mock.calls[0] as [
      unknown,
      { answers: unknown; flagged: unknown; attentionEvents: unknown[] },
    ];
    expect(payload.answers).toEqual({});
    expect(payload.flagged).toEqual({});
    expect(payload.attentionEvents).toEqual([]);
  });

  it('sets deliveryCode to null and submittedAt to null', async () => {
    await startSubmission(input, fakeDb);
    const [, payload] = mockSetDoc.mock.calls[0] as [
      unknown,
      { deliveryCode: unknown; submittedAt: unknown },
    ];
    expect(payload.deliveryCode).toBeNull();
    expect(payload.submittedAt).toBeNull();
  });

  it('uses serverTimestamp for lastSavedAt', async () => {
    await startSubmission(input, fakeDb);
    const [, payload] = mockSetDoc.mock.calls[0] as [unknown, { lastSavedAt: unknown }];
    expect(payload.lastSavedAt).toEqual({ __serverTimestamp: true });
  });
});

// ─── saveDraft ────────────────────────────────────────────────────────────────

describe('saveDraft', () => {
  const base = {
    verificationId: 'ver-1',
    studentUid: 'uid-1',
    answers: { '1': { tipo: 'aperta' as const, testo: 'risposta' } },
    flagged: { '2': true },
    newAttentionEvents: [],
  };

  it('updates the correct document', async () => {
    await saveDraft(base, fakeDb);
    const [ref] = mockUpdateDoc.mock.calls[0] as [{ __path: string }, unknown];
    expect(ref.__path).toBe('submissions/ver-1_uid-1');
  });

  it('writes answers and flagged', async () => {
    await saveDraft(base, fakeDb);
    const [, update] = mockUpdateDoc.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(update['answers']).toEqual(base.answers);
    expect(update['flagged']).toEqual(base.flagged);
  });

  it('uses serverTimestamp for lastSavedAt', async () => {
    await saveDraft(base, fakeDb);
    const [, update] = mockUpdateDoc.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(update['lastSavedAt']).toEqual({ __serverTimestamp: true });
  });

  it('does not include attentionEvents when newAttentionEvents is empty', async () => {
    await saveDraft(base, fakeDb);
    const [, update] = mockUpdateDoc.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(update).not.toHaveProperty('attentionEvents');
  });

  it('appends attention events via arrayUnion when provided', async () => {
    const event = { type: 'tab_blur' as const, ts: 1234 };
    await saveDraft({ ...base, newAttentionEvents: [event] }, fakeDb);
    const [, update] = mockUpdateDoc.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(update['attentionEvents']).toEqual({ __arrayUnion: [event] });
  });
});

// ─── submitSubmission ─────────────────────────────────────────────────────────

describe('submitSubmission', () => {
  const input = {
    verificationId: 'ver-1',
    studentUid: 'uid-1',
    ownerUid: 'owner-1',
    answers: {},
    flagged: {},
    newAttentionEvents: [],
    verificationTitle: 'Matematica Q1',
    className: '3A',
  };

  it('commits a batch', async () => {
    await submitSubmission(input, fakeDb);
    expect(mockBatchCommit).toHaveBeenCalledOnce();
  });

  it('updates the submission to submitted', async () => {
    await submitSubmission(input, fakeDb);
    const [ref, update] = mockBatchUpdate.mock.calls[0] as [
      { __path: string },
      Record<string, unknown>,
    ];
    expect(ref.__path).toBe('submissions/ver-1_uid-1');
    expect(update['status']).toBe('submitted');
  });

  it('sets the receipt in submissionReceipts', async () => {
    await submitSubmission(input, fakeDb);
    const [ref] = mockBatchSet.mock.calls[0] as [{ __path: string }, unknown];
    expect(ref.__path).toBe('submissionReceipts/ver-1_uid-1');
  });

  it('receipt does not include answers or flagged or attentionEvents', async () => {
    await submitSubmission(input, fakeDb);
    const [, receipt] = mockBatchSet.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(receipt).not.toHaveProperty('answers');
    expect(receipt).not.toHaveProperty('flagged');
    expect(receipt).not.toHaveProperty('attentionEvents');
  });

  it('returns the delivery code', async () => {
    const code = await submitSubmission(input, fakeDb);
    expect(code).toMatch(/^SF-\d{4}-[A-Z0-9]{4}$/);
  });

  it('stores the same delivery code in both submission update and receipt', async () => {
    const code = await submitSubmission(input, fakeDb);
    const [, update] = mockBatchUpdate.mock.calls[0] as [unknown, { deliveryCode: string }];
    const [, receipt] = mockBatchSet.mock.calls[0] as [unknown, { deliveryCode: string }];
    expect(update.deliveryCode).toBe(code);
    expect(receipt.deliveryCode).toBe(code);
  });

  it('uses arrayUnion when there are attention events', async () => {
    const event = { type: 'fullscreen_exit' as const, ts: 5678 };
    await submitSubmission({ ...input, newAttentionEvents: [event] }, fakeDb);
    const [, update] = mockBatchUpdate.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(update['attentionEvents']).toEqual({ __arrayUnion: [event] });
  });

  it('does not include attentionEvents field when newAttentionEvents is empty', async () => {
    await submitSubmission(input, fakeDb);
    const [, update] = mockBatchUpdate.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(update).not.toHaveProperty('attentionEvents');
  });
});
