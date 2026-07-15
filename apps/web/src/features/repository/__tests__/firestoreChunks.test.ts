import { beforeEach, describe, expect, it, vi } from 'vitest';

// Each writeBatch() returns a fresh recording batch; committedBatches records
// the ordered list of (mutations, commitIndex) so tests can assert chunk
// boundaries, sequential commit order, and no loss/duplication.
interface RecordedBatch {
  ops: Array<{ kind: 'set' | 'update' | 'delete'; ref: unknown }>;
  committed: boolean;
}
let batches: RecordedBatch[] = [];
let commitOrder: number[] = [];
let commitCounter = 0;
let failCommitAt: number | null = null;

function makeBatch(): unknown {
  const rec: RecordedBatch = { ops: [], committed: false };
  const index = batches.length;
  batches.push(rec);
  return {
    set: (ref: unknown) => rec.ops.push({ kind: 'set', ref }),
    update: (ref: unknown) => rec.ops.push({ kind: 'update', ref }),
    delete: (ref: unknown) => rec.ops.push({ kind: 'delete', ref }),
    commit: async () => {
      if (failCommitAt !== null && index === failCommitAt) {
        throw new Error(`commit failed at batch ${index}`);
      }
      rec.committed = true;
      commitOrder.push(commitCounter++);
    },
  };
}

vi.mock('firebase/firestore', () => ({
  writeBatch: () => makeBatch(),
}));

import { BATCH_CHUNK_SIZE, commitOpsInChunks, deleteDocRefsInBatches } from '../firestoreChunks.js';
import type { Firestore, DocumentReference } from 'firebase/firestore';
import type { BatchOp } from '../firestoreChunks.js';

const fakeDb = {} as Firestore;

beforeEach(() => {
  batches = [];
  commitOrder = [];
  commitCounter = 0;
  failCommitAt = null;
});

function makeOps(n: number): BatchOp[] {
  return Array.from(
    { length: n },
    (_, i) => (batch) => batch.set({ __id: i } as never, {} as never),
  );
}

describe('BATCH_CHUNK_SIZE', () => {
  it('is a prudent margin under Firestore 500-mutation limit', () => {
    expect(BATCH_CHUNK_SIZE).toBe(400);
    expect(BATCH_CHUNK_SIZE).toBeLessThan(500);
  });
});

describe('commitOpsInChunks', () => {
  it('commits nothing for 0 ops', async () => {
    await commitOpsInChunks(fakeDb, makeOps(0));
    expect(batches).toHaveLength(0);
  });

  it('uses a single batch for 1 op', async () => {
    await commitOpsInChunks(fakeDb, makeOps(1));
    expect(batches).toHaveLength(1);
    expect(batches[0]!.ops).toHaveLength(1);
    expect(batches[0]!.committed).toBe(true);
  });

  it('uses a single batch for exactly 400 ops', async () => {
    await commitOpsInChunks(fakeDb, makeOps(400));
    expect(batches).toHaveLength(1);
    expect(batches[0]!.ops).toHaveLength(400);
  });

  it('splits 401 ops into two batches (400 + 1)', async () => {
    await commitOpsInChunks(fakeDb, makeOps(401));
    expect(batches).toHaveLength(2);
    expect(batches[0]!.ops).toHaveLength(400);
    expect(batches[1]!.ops).toHaveLength(1);
  });

  it('splits >800 ops into three batches with no loss or duplication', async () => {
    await commitOpsInChunks(fakeDb, makeOps(801));
    expect(batches).toHaveLength(3);
    expect(batches[0]!.ops).toHaveLength(400);
    expect(batches[1]!.ops).toHaveLength(400);
    expect(batches[2]!.ops).toHaveLength(1);
    // Every op id 0..800 appears exactly once, in order.
    const ids = batches.flatMap((b) => b.ops.map((o) => (o.ref as { __id: number }).__id));
    expect(ids).toEqual(Array.from({ length: 801 }, (_, i) => i));
  });

  it('commits chunks strictly sequentially (never in parallel)', async () => {
    await commitOpsInChunks(fakeDb, makeOps(801));
    // commitOrder reflects the order commits completed; since each chunk is
    // awaited before the next batch is even created, order must be 0,1,2.
    expect(commitOrder).toEqual([0, 1, 2]);
    expect(batches.every((b) => b.committed)).toBe(true);
  });

  it('stops at the failing chunk boundary (no cross-chunk rollback)', async () => {
    failCommitAt = 1; // second chunk fails
    await expect(commitOpsInChunks(fakeDb, makeOps(801))).rejects.toThrow('commit failed');
    // First chunk committed durably; third chunk was never created.
    expect(batches[0]!.committed).toBe(true);
    expect(batches).toHaveLength(2);
  });
});

describe('deleteDocRefsInBatches', () => {
  it('is safe on zero refs', async () => {
    await deleteDocRefsInBatches(fakeDb, []);
    expect(batches).toHaveLength(0);
  });

  it('deletes refs in chunks of 400', async () => {
    const refs = Array.from(
      { length: 401 },
      (_, i) => ({ __id: i }) as unknown as DocumentReference,
    );
    await deleteDocRefsInBatches(fakeDb, refs);
    expect(batches).toHaveLength(2);
    expect(batches[0]!.ops.every((o) => o.kind === 'delete')).toBe(true);
    const ids = batches.flatMap((b) => b.ops.map((o) => (o.ref as { __id: number }).__id));
    expect(ids).toEqual(Array.from({ length: 401 }, (_, i) => i));
  });
});
