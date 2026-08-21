import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Ordered event log + Firestore/Gateway mocks ─────────────────────────────
let events: string[] = [];

interface BatchRecord {
  setPaths: string[];
  updatePaths: string[];
  deletePaths: string[];
}
let batches: BatchRecord[] = [];
let failBatchAt: number | null = null; // batch index (over the whole run) that rejects on commit

function makeBatch(): unknown {
  const rec: BatchRecord = { setPaths: [], updatePaths: [], deletePaths: [] };
  const index = batches.length;
  batches.push(rec);
  return {
    set: (ref: { __path: string }) => rec.setPaths.push(ref.__path),
    update: (ref: { __path: string }) => rec.updatePaths.push(ref.__path),
    delete: (ref: { __path: string }) => rec.deletePaths.push(ref.__path),
    commit: async () => {
      if (failBatchAt !== null && index === failBatchAt) {
        throw new Error(`batch ${index} failed`);
      }
      events.push(`batch:${index}`);
    },
  };
}

interface TxRecord {
  sets: Array<{ path: string; data: Record<string, unknown> }>;
  updates: Array<{ path: string; data: Record<string, unknown> }>;
  deletes: string[];
}
let txRecord: TxRecord;
let programSnap: { exists: () => boolean; data: () => Record<string, unknown> };
let failTransaction = false;

function isColl(v: unknown): v is { __path: string; __coll: true } {
  return typeof v === 'object' && v !== null && '__coll' in v;
}

// Cleanup module (real) uses these:
const mockGetDoc = vi.fn();
const mockGetDocs = vi.fn();
const mockUpdateDoc = vi.fn();

vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...segments: string[]) => ({
    __path: segments.join('/'),
    __coll: true,
  }),
  doc: (first: unknown, ...rest: unknown[]) => {
    if (isColl(first)) return { __path: `${first.__path}/auto-id` };
    return { __path: rest.join('/') };
  },
  runTransaction: async (_db: unknown, cb: (tx: unknown) => Promise<unknown>) => {
    if (failTransaction) throw new Error('transaction failed');
    events.push('transaction');
    const tx = {
      get: async () => programSnap,
      set: (ref: { __path: string }, data: Record<string, unknown>) =>
        txRecord.sets.push({ path: ref.__path, data }),
      update: (ref: { __path: string }, data: Record<string, unknown>) =>
        txRecord.updates.push({ path: ref.__path, data }),
      delete: (ref: { __path: string }) => txRecord.deletes.push(ref.__path),
    };
    return cb(tx);
  },
  serverTimestamp: () => '__ts',
  writeBatch: () => makeBatch(),
  getDoc: (...a: unknown[]) => mockGetDoc(...a),
  getDocs: (...a: unknown[]) => mockGetDocs(...a),
  updateDoc: (...a: unknown[]) => mockUpdateDoc(...a),
  query: (collRef: unknown, ...r: unknown[]) => ({ collRef, r }),
  where: (...a: unknown[]) => ({ __where: a }),
}));

const mockWriteFiles = vi.fn();
vi.mock('../../gateway/repositoryGatewayClient.js', () => ({
  writeTexts: vi.fn(),
}));

const mockValidateImport = vi.fn();
vi.mock('../../validation/index.js', () => ({
  validateImport: (...a: unknown[]) => mockValidateImport(...a),
}));

const mockBuildImportPayload = vi.fn();
vi.mock('../buildImportPayload.js', () => ({
  buildImportPayload: (...a: unknown[]) => mockBuildImportPayload(...a),
}));

import { importRepository } from '../importRepository.js';
import type { Firestore } from 'firebase/firestore';

const fakeDb = {} as Firestore;
const OWNER = 'owner-1';
const importDeps = { db: fakeDb, writeFiles: mockWriteFiles };

function makePayload(counts: { udas: number; lessons: number; questions: number }) {
  return {
    importMeta: {
      ownerUid: OWNER,
      status: 'staging',
      udaCount: counts.udas,
      lessonCount: counts.lessons,
      questionCount: counts.questions,
    },
    udas: Array.from({ length: counts.udas }, (_, i) => ({ id: `uda-${i}`, data: {} })),
    lessons: Array.from({ length: counts.lessons }, (_, i) => ({ id: `les-${i}`, data: {} })),
    questionIndex: Array.from({ length: counts.questions }, (_, i) => ({ id: `q-${i}`, data: {} })),
    publicLessons: Array.from({ length: counts.lessons }, (_, i) => ({
      id: `pl-${i}`,
      data: {},
    })),
  };
}

function baseInput(programId?: string) {
  return {
    ownerUid: OWNER,
    programmaTitle: 'Corso',
    programId,
    files: [{ path: 'uda-01/lezione-001.md', content: 'x' }],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  events = [];
  batches = [];
  failBatchAt = null;
  failTransaction = false;
  txRecord = { sets: [], updates: [], deletes: [] };
  // Existing program with a previous active import → triggers cleanup path.
  programSnap = { exists: () => true, data: () => ({ activeImportId: 'old-imp' }) };
  mockValidateImport.mockReturnValue({ valid: true, issues: [] });
  mockWriteFiles.mockResolvedValue(undefined);
  mockBuildImportPayload.mockReturnValue(makePayload({ udas: 2, lessons: 3, questions: 4 }));
  mockGetDocs.mockResolvedValue({ docs: [] }); // no stale publicLessons by default
  mockGetDoc.mockResolvedValue({ exists: () => true }); // old import doc exists
  mockUpdateDoc.mockResolvedValue(undefined);
});

describe('importRepository — validation', () => {
  it('returns validation_failed without any write', async () => {
    mockValidateImport.mockReturnValue({ valid: false, issues: [{ code: 'x' }] });
    const res = await importRepository(baseInput('prog-1'), importDeps);
    expect(res.status).toBe('validation_failed');
    expect(mockWriteFiles).not.toHaveBeenCalled();
    expect(batches).toHaveLength(0);
    expect(events).not.toContain('transaction');
  });
});

describe('importRepository — happy path (small import)', () => {
  it('stages then switches then reports committed with cleanupPending false', async () => {
    const res = await importRepository(baseInput('prog-1'), importDeps);
    expect(res).toMatchObject({
      status: 'committed',
      programId: 'prog-1',
      cleanupPending: false,
      udaCount: 2,
      lessonCount: 3,
      questionCount: 4,
    });
    // One technical chunk (1 meta + 2 uda + 3 lessons + 4 qi = 10) and one
    // publicLessons chunk (3) — both well under 400.
    expect(batches.length).toBe(2);
    expect(mockWriteFiles).toHaveBeenCalledWith([
      expect.objectContaining({
        path: expect.stringMatching(
          /^repository\/owner-1\/imports\/[^/]+\/uda-01\/lezione-001\.md$/,
        ),
        content: 'x',
      }),
    ]);
  });

  it('never changes activeImportId during staging; switch happens after all chunks', async () => {
    await importRepository(baseInput('prog-1'), importDeps);
    // No staging batch ever writes the program doc.
    for (const b of batches) {
      expect(
        b.setPaths.some((p) => p.startsWith('programs/prog-1') && !p.includes('/imports/')),
      ).toBe(false);
      expect(b.updatePaths.some((p) => p === 'programs/prog-1')).toBe(false);
    }
    // Transaction (switch) is the LAST event, after every batch commit.
    expect(events[events.length - 1]).toBe('transaction');
    expect(events.filter((e) => e.startsWith('batch:')).length).toBeGreaterThan(0);
  });

  it('switch transaction contains ONLY program + import status + audit', async () => {
    await importRepository(baseInput('prog-1'), importDeps);
    // program updated with new activeImportId
    expect(txRecord.updates).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: 'programs/prog-1' })]),
    );
    // import doc status → active
    const importUpdate = txRecord.updates.find((u) => u.path.includes('/imports/'));
    expect(importUpdate?.data).toMatchObject({ status: 'active' });
    // audit event written (auto-id under auditEvents)
    expect(txRecord.sets.some((s) => s.path.startsWith('auditEvents/'))).toBe(true);
    // NO publicLessons / udas / lessons / questionIndex in the switch
    const allPaths = [...txRecord.sets, ...txRecord.updates].map((x) => x.path);
    expect(allPaths.some((p) => p.startsWith('publicLessons/'))).toBe(false);
    expect(allPaths.some((p) => p.includes('/udas/'))).toBe(false);
    expect(allPaths.some((p) => p.includes('/lessons/'))).toBe(false);
    expect(allPaths.some((p) => p.includes('/questionIndex/'))).toBe(false);
    // new activeImportId set on program
    const progUpdate = txRecord.updates.find((u) => u.path === 'programs/prog-1');
    expect(progUpdate?.data.activeImportId).toBeDefined();
    expect(progUpdate?.data.activeImportId).not.toBe('old-imp');
  });
});

describe('importRepository — large import (>500 mutations)', () => {
  it('splits technical + publicLessons across multiple chunks, no limit failure', async () => {
    // 600 lessons → technical ops = 1 + 0 + 600 + 0 = 601 → 2 chunks;
    // publicLessons = 600 → 2 chunks. Total 4 staging batches.
    mockBuildImportPayload.mockReturnValue(makePayload({ udas: 0, lessons: 600, questions: 0 }));
    const res = await importRepository(baseInput('prog-1'), importDeps);
    expect(res.status).toBe('committed');
    expect(batches.length).toBe(4);
    // No single batch exceeds 400 mutations.
    for (const b of batches) {
      expect(b.setPaths.length + b.updatePaths.length + b.deletePaths.length).toBeLessThanOrEqual(
        400,
      );
    }
    // Total publicLessons written == 600, no loss/dup.
    const plWrites = batches
      .flatMap((b) => b.setPaths)
      .filter((p) => p.startsWith('publicLessons/'));
    expect(new Set(plWrites).size).toBe(600);
  });
});

describe('importRepository — pre-switch failures (not applied)', () => {
  it('Storage upload error → not_applied, no switch, activeImportId untouched', async () => {
    mockWriteFiles.mockRejectedValueOnce(new Error('gateway down'));
    const res = await importRepository(baseInput('prog-1'), importDeps);
    expect(res).toEqual({
      status: 'not_applied',
      message: 'Import non applicato: il corso precedente è rimasto intatto.',
    });
    expect(events).not.toContain('transaction');
  });

  it('error in a staging chunk → not_applied, no switch', async () => {
    failBatchAt = 0; // first technical chunk fails
    const res = await importRepository(baseInput('prog-1'), importDeps);
    expect(res.status).toBe('not_applied');
    expect(events).not.toContain('transaction');
  });

  it('error in the publicLessons chunk → not_applied, no switch', async () => {
    mockBuildImportPayload.mockReturnValue(makePayload({ udas: 0, lessons: 1, questions: 0 }));
    failBatchAt = 1; // technical chunk 0 ok, publicLessons chunk 1 fails
    const res = await importRepository(baseInput('prog-1'), importDeps);
    expect(res.status).toBe('not_applied');
    expect(events).not.toContain('transaction');
  });

  it('switch transaction failure → not_applied', async () => {
    failTransaction = true;
    const res = await importRepository(baseInput('prog-1'), importDeps);
    expect(res.status).toBe('not_applied');
  });
});

describe('importRepository — cleanup semantics', () => {
  it('cleanup failure after switch → committed with cleanupPending true', async () => {
    mockGetDocs.mockRejectedValueOnce(new Error('cleanup read failed'));
    const res = await importRepository(baseInput('prog-1'), importDeps);
    expect(res).toMatchObject({ status: 'committed', cleanupPending: true });
    // Switch still happened.
    expect(events).toContain('transaction');
  });

  it('cleanup uses the PREVIOUS activeImportId', async () => {
    mockGetDocs.mockResolvedValue({ docs: [{ ref: { __path: 'publicLessons/old-imp_l0' } }] });
    const res = await importRepository(baseInput('prog-1'), importDeps);
    expect(res).toMatchObject({ status: 'committed', cleanupPending: false });
    // The stale doc from the old import was deleted.
    const deleted = batches.flatMap((b) => b.deletePaths);
    expect(deleted).toContain('publicLessons/old-imp_l0');
  });

  it('new program (no previous import) → no cleanup attempted', async () => {
    programSnap = { exists: () => false, data: () => ({}) };
    const res = await importRepository(baseInput(undefined), importDeps);
    expect(res).toMatchObject({ status: 'committed', cleanupPending: false });
    expect(mockGetDocs).not.toHaveBeenCalled();
  });
});
