import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Firebase mocks ───────────────────────────────────────────────────────────

type FakeDocEntry = { exists: boolean; data?: unknown };
type FakeRef = { __path: string };

let store: Record<string, FakeDocEntry> = {};
let eventDocs: { path: string; data: unknown }[] = [];
const committedDeletes: string[][] = []; // one array of paths per committed batch
const addedAudits: unknown[] = [];

const mockDoc = vi.fn();
const mockCollection = vi.fn();
const mockGetDoc = vi.fn();
const mockGetDocs = vi.fn();
const mockAddDoc = vi.fn();

vi.mock('firebase/firestore', () => ({
  doc: (...args: unknown[]) => mockDoc(...args),
  collection: (...args: unknown[]) => mockCollection(...args),
  getDoc: (...args: unknown[]) => mockGetDoc(...args),
  getDocs: (...args: unknown[]) => mockGetDocs(...args),
  addDoc: (...args: unknown[]) => mockAddDoc(...args),
  query: (...parts: unknown[]) => ({ __query: parts }),
  where: (field: string, _op: string, value: unknown) => ({ field, value }),
  serverTimestamp: () => ({ __serverTimestamp: true }),
  writeBatch: () => {
    const paths: string[] = [];
    return {
      delete: (ref: FakeRef) => paths.push(ref.__path),
      commit: async () => {
        committedDeletes.push([...paths]);
        for (const p of paths) delete store[p];
      },
    };
  },
}));

import type { Firestore } from 'firebase/firestore';
import { deleteSubmissionData } from '../deleteSubmissionData.js';

const fakeDb = {} as Firestore;
const OWNER = 'owner-1';
const VERIF = 'v1';
const STUDENT = 'student-1';
const SUBMISSION_ID = `${VERIF}_${STUDENT}`;

beforeEach(() => {
  vi.clearAllMocks();
  store = {};
  eventDocs = [];
  committedDeletes.length = 0;
  addedAudits.length = 0;

  mockDoc.mockImplementation((first: unknown, ...rest: string[]) => ({
    __path: rest.join('/'),
  }));
  mockCollection.mockImplementation((_db: unknown, name: string) => ({ __collection: name }));
  mockGetDoc.mockImplementation(async (ref: FakeRef) => {
    const entry = store[ref.__path];
    return { exists: () => !!entry?.exists, data: () => entry?.data };
  });
  mockGetDocs.mockImplementation(async () => ({
    empty: eventDocs.length === 0,
    docs: eventDocs.map((e) => ({
      ref: { __path: e.path },
      data: () => e.data,
    })),
  }));
  mockAddDoc.mockImplementation(async (_col: unknown, data: unknown) => {
    addedAudits.push(data);
    return { id: 'audit-1' };
  });
});

function seed(path: string, data: unknown, ownerUid = OWNER) {
  store[path] = { exists: true, data: { ownerUid, verificationId: VERIF, ...(data as object) } };
}

/**
 * A deletable submission: submission + receipt + a `completed` (never returned)
 * correction + events. No `correctionReturns` and no `returned` mirror, so the
 * M5-06B preflight lets it through.
 */
function seedFullSubmission() {
  seed(`submissions/${SUBMISSION_ID}`, { studentUid: STUDENT, status: 'submitted' });
  seed(`submissionReceipts/${SUBMISSION_ID}`, {});
  seed(`corrections/${SUBMISSION_ID}`, { status: 'completed' });
  eventDocs = [
    { path: `correctionEvents/e1`, data: { ownerUid: OWNER, correctionId: SUBMISSION_ID } },
    { path: `correctionEvents/e2`, data: { ownerUid: OWNER, correctionId: SUBMISSION_ID } },
  ];
}

describe('deleteSubmissionData', () => {
  it('deletes every linked document, dependents first and submission + receipt last', async () => {
    seedFullSubmission();
    await deleteSubmissionData(SUBMISSION_ID, OWNER, fakeDb);

    const deleted = committedDeletes.flat();
    expect(deleted).toEqual([
      'correctionEvents/e1',
      'correctionEvents/e2',
      `corrections/${SUBMISSION_ID}`,
      `submissionReceipts/${SUBMISSION_ID}`,
      `submissions/${SUBMISSION_ID}`,
    ]);
    expect(deleted).not.toContain(`correctionReturns/${SUBMISSION_ID}`);
    // Submission + receipt come after every dependent.
    expect(deleted.indexOf(`submissions/${SUBMISSION_ID}`)).toBe(deleted.length - 1);
    expect(deleted.indexOf(`submissionReceipts/${SUBMISSION_ID}`)).toBeGreaterThan(
      deleted.indexOf(`corrections/${SUBMISSION_ID}`),
    );
  });

  it('handles a submission with no correction/return/receipt/events (only the submission)', async () => {
    seed(`submissions/${SUBMISSION_ID}`, { studentUid: STUDENT, status: 'submitted' });
    await deleteSubmissionData(SUBMISSION_ID, OWNER, fakeDb);
    expect(committedDeletes.flat()).toEqual([`submissions/${SUBMISSION_ID}`]);
  });

  it('is an idempotent no-op when nothing exists (retry after full deletion)', async () => {
    await deleteSubmissionData(SUBMISSION_ID, OWNER, fakeDb);
    expect(committedDeletes).toHaveLength(0);
    expect(addedAudits).toHaveLength(0);
  });

  it('resumes cleanly after an interruption (submission already gone, dependents remain)', async () => {
    // Submission + receipt already deleted; a correction and events still linger.
    seed(`corrections/${SUBMISSION_ID}`, {});
    eventDocs = [
      { path: 'correctionEvents/e1', data: { ownerUid: OWNER, correctionId: SUBMISSION_ID } },
    ];
    await deleteSubmissionData(SUBMISSION_ID, OWNER, fakeDb);
    expect(committedDeletes.flat()).toEqual([
      'correctionEvents/e1',
      `corrections/${SUBMISSION_ID}`,
    ]);
    // verificationId still resolvable from the correction → audit written.
    expect(addedAudits).toHaveLength(1);
  });

  it('chunks deletions into batches of at most 400 mutations', async () => {
    seed(`submissions/${SUBMISSION_ID}`, { studentUid: STUDENT, status: 'submitted' });
    eventDocs = Array.from({ length: 850 }, (_, i) => ({
      path: `correctionEvents/e${i}`,
      data: { ownerUid: OWNER, correctionId: SUBMISSION_ID },
    }));
    await deleteSubmissionData(SUBMISSION_ID, OWNER, fakeDb);
    // Events are chunked separately; the submission graph is deleted atomically last.
    expect(committedDeletes.map((b) => b.length)).toEqual([400, 400, 50, 1]);
    for (const batch of committedDeletes) expect(batch.length).toBeLessThanOrEqual(400);
    // Submission is in the LAST chunk.
    expect(committedDeletes.at(-1)).toContain(`submissions/${SUBMISSION_ID}`);
  });

  it('writes a non-identifying audit: ownerUid + verificationId + action only, no PII', async () => {
    seedFullSubmission();
    await deleteSubmissionData(SUBMISSION_ID, OWNER, fakeDb);

    expect(addedAudits).toHaveLength(1);
    const audit = addedAudits[0] as Record<string, unknown>;
    expect(audit.actorUid).toBe(OWNER);
    expect(audit.action).toBe('submission.deleted');
    expect(audit.targetId).toBe(VERIF);
    const serialized = JSON.stringify(audit);
    expect(serialized).not.toContain(STUDENT);
    expect(serialized).not.toContain(SUBMISSION_ID); // embeds the studentUid
    expect(serialized).not.toMatch(/risposta|answer|email|@/i);
  });

  it('refuses to delete data owned by a different teacher, writing nothing', async () => {
    seed(
      `submissions/${SUBMISSION_ID}`,
      { studentUid: STUDENT, status: 'submitted' },
      'other-owner',
    );
    await expect(deleteSubmissionData(SUBMISSION_ID, OWNER, fakeDb)).rejects.toThrow(
      /non appartiene a questo docente/i,
    );
    expect(committedDeletes).toHaveLength(0);
    expect(addedAudits).toHaveLength(0);
  });

  // ── M4-LIFE-03 — current lifecycle controls deletion ───────────────────────

  it('deletes a submission with no correction at all', async () => {
    seed(`submissions/${SUBMISSION_ID}`, { studentUid: STUDENT, status: 'submitted' });
    seed(`submissionReceipts/${SUBMISSION_ID}`, {});
    await deleteSubmissionData(SUBMISSION_ID, OWNER, fakeDb);
    expect(committedDeletes.flat()).toEqual([
      `submissionReceipts/${SUBMISSION_ID}`,
      `submissions/${SUBMISSION_ID}`,
    ]);
  });

  it('deletes an in_progress correction that was never returned', async () => {
    seed(`submissions/${SUBMISSION_ID}`, { studentUid: STUDENT, status: 'submitted' });
    seed(`corrections/${SUBMISSION_ID}`, { status: 'in_progress' });
    await deleteSubmissionData(SUBMISSION_ID, OWNER, fakeDb);
    expect(committedDeletes.flat()).toContain(`corrections/${SUBMISSION_ID}`);
    expect(addedAudits).toHaveLength(1);
  });

  it('deletes a completed correction that was never returned', async () => {
    seedFullSubmission(); // correction status 'completed'
    await deleteSubmissionData(SUBMISSION_ID, OWNER, fakeDb);
    expect(committedDeletes.flat()).toContain(`corrections/${SUBMISSION_ID}`);
  });

  it('blocks before any write when the correction status is returned', async () => {
    seed(`submissions/${SUBMISSION_ID}`, { studentUid: STUDENT, status: 'submitted' });
    seed(`corrections/${SUBMISSION_ID}`, { status: 'returned' });
    await expect(deleteSubmissionData(SUBMISSION_ID, OWNER, fakeDb)).rejects.toThrow(
      /correzione è restituita allo studente/i,
    );
    expect(committedDeletes).toHaveLength(0);
    expect(addedAudits).toHaveLength(0);
  });

  it('deletes a genuinely reopened correction and its hidden previous return', async () => {
    seed(`submissions/${SUBMISSION_ID}`, { studentUid: STUDENT, status: 'submitted' });
    seed(`corrections/${SUBMISSION_ID}`, { status: 'in_progress' });
    seed(`correctionReturns/${SUBMISSION_ID}`, { visibleToStudent: false });
    await deleteSubmissionData(SUBMISSION_ID, OWNER, fakeDb);
    expect(committedDeletes.flat()).toEqual(
      expect.arrayContaining([
        `correctionReturns/${SUBMISSION_ID}`,
        `corrections/${SUBMISSION_ID}`,
        `submissions/${SUBMISSION_ID}`,
      ]),
    );
  });

  it('blocks a hidden return when its correction is still returned', async () => {
    seed(`submissions/${SUBMISSION_ID}`, { studentUid: STUDENT, status: 'submitted' });
    seed(`corrections/${SUBMISSION_ID}`, { status: 'returned' });
    seed(`correctionReturns/${SUBMISSION_ID}`, { visibleToStudent: false });
    await expect(deleteSubmissionData(SUBMISSION_ID, OWNER, fakeDb)).rejects.toThrow(
      /Riaprila prima/i,
    );
    expect(committedDeletes).toHaveLength(0);
  });

  it('fails closed when a reopened return has a stale returned mirror', async () => {
    seed(`submissions/${SUBMISSION_ID}`, {
      studentUid: STUDENT,
      status: 'submitted',
      correctionStatus: 'returned',
    });
    seed(`corrections/${SUBMISSION_ID}`, { status: 'in_progress' });
    seed(`correctionReturns/${SUBMISSION_ID}`, { visibleToStudent: false });
    await expect(deleteSubmissionData(SUBMISSION_ID, OWNER, fakeDb)).rejects.toThrow(
      /Riaprila prima/i,
    );
    expect(committedDeletes).toHaveLength(0);
  });

  it('blocks when the submission public mirror says returned', async () => {
    seed(`submissions/${SUBMISSION_ID}`, {
      studentUid: STUDENT,
      status: 'submitted',
      correctionStatus: 'returned',
    });
    await expect(deleteSubmissionData(SUBMISSION_ID, OWNER, fakeDb)).rejects.toThrow(
      /correzione è restituita allo studente/i,
    );
    expect(committedDeletes).toHaveLength(0);
  });

  it('blocks when the receipt public mirror says returned', async () => {
    seed(`submissions/${SUBMISSION_ID}`, { studentUid: STUDENT, status: 'submitted' });
    seed(`submissionReceipts/${SUBMISSION_ID}`, { correctionStatus: 'returned' });
    await expect(deleteSubmissionData(SUBMISSION_ID, OWNER, fakeDb)).rejects.toThrow(
      /correzione è restituita allo studente/i,
    );
    expect(committedDeletes).toHaveLength(0);
  });

  it('queries correctionEvents owner-scoped and filtered to this submission only', async () => {
    seedFullSubmission();
    await deleteSubmissionData(SUBMISSION_ID, OWNER, fakeDb);
    // The events read is constrained by ownerUid == owner AND correctionId ==
    // this submission, so events of other corrections are never touched.
    const queryArg = mockGetDocs.mock.calls[0]?.[0] as { __query?: unknown[] };
    const filters = (queryArg.__query ?? []).filter(
      (p): p is { field: string; value: unknown } =>
        typeof p === 'object' && p !== null && 'field' in p,
    );
    expect(filters).toEqual(
      expect.arrayContaining([
        { field: 'ownerUid', value: OWNER },
        { field: 'correctionId', value: SUBMISSION_ID },
      ]),
    );
  });
});
