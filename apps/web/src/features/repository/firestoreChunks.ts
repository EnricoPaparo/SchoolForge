import { writeBatch } from 'firebase/firestore';
import type { DocumentReference, Firestore, WriteBatch } from 'firebase/firestore';

/**
 * Prudent margin under Firestore's hard 500-mutation limit per `writeBatch`
 * (and per `runTransaction`). All chunked Firestore writes in the repository
 * feature use this single constant so the margin is applied uniformly.
 */
export const BATCH_CHUNK_SIZE = 400;

/**
 * A single mutation to apply to a `WriteBatch` (set/update/delete), deferred
 * so an arbitrary mix of mutation kinds can be chunked and committed
 * uniformly — see `commitOpsInChunks`.
 */
export type BatchOp = (batch: WriteBatch) => void;

/**
 * Commits an arbitrary list of `BatchOp`s in chunks of at most
 * `BATCH_CHUNK_SIZE`, one `writeBatch` per chunk. Chunks are committed
 * **sequentially** — never `Promise.all`'d — so a failure is deterministic
 * (it always happens at a specific chunk boundary, never as a burst of
 * concurrent in-flight batches) and so this never fires more concurrent
 * writes than a single chunk's worth at a time.
 *
 * Residual risk: Firestore only guarantees atomicity *within* one batch.
 * If the op list spans more than one chunk, a failure after chunk N-1
 * commits but before chunk N does leaves the first N-1 chunks' mutations
 * durably applied and the rest not yet applied — there is no cross-chunk
 * rollback. Callers that need a coherent switch (see importRepository's
 * staging → atomic switch → cleanup protocol) must keep the single decisive
 * mutation inside one batch/transaction and treat chunked staging/cleanup as
 * eventual-consistent.
 */
export async function commitOpsInChunks(db: Firestore, ops: BatchOp[]): Promise<void> {
  for (let i = 0; i < ops.length; i += BATCH_CHUNK_SIZE) {
    const batch = writeBatch(db);
    ops.slice(i, i + BATCH_CHUNK_SIZE).forEach((op) => op(batch));
    await batch.commit();
  }
}

/**
 * Deletes the given document references in chunks of at most
 * `BATCH_CHUNK_SIZE`, one `writeBatch` per chunk, committed sequentially.
 * A convenience wrapper over `commitOpsInChunks` for the common
 * delete-only case. Safe on an empty list (commits nothing).
 */
export async function deleteDocRefsInBatches(
  db: Firestore,
  refs: DocumentReference[],
): Promise<void> {
  await commitOpsInChunks(
    db,
    refs.map((r) => (batch) => batch.delete(r)),
  );
}
