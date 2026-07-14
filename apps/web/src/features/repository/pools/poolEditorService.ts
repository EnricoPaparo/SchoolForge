import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import type { DocumentReference, Firestore, WriteBatch } from 'firebase/firestore';
import type { FirebaseStorage } from 'firebase/storage';
import {
  deleteFile,
  isFileNotFound,
  readText,
  writeText,
} from '../gateway/repositoryGatewayClient.js';
import { parsePool, serializePool } from '@schoolforge/lesson-contract';
import type { ParsedPool, PoolValidationError } from '@schoolforge/lesson-contract';
import { buildQuestionPreview, toDocId } from '../import/buildImportPayload.js';
import type { LessonDoc, QuestionIndexEntry, VerificationDoc } from '../../../types/firestore.js';

// ── Result types ──────────────────────────────────────────────────────────────

export type LoadPoolResult =
  | { status: 'absent' }
  | { status: 'valid'; pool: ParsedPool }
  | { status: 'invalid'; errors: PoolValidationError[]; rawContent: string };

export interface PoolDeleteBlocker {
  verificationId: string;
  title: string;
}

/**
 * Thrown by `deletePool` when at least one draft verification references a
 * question from the pool being deleted. Active and closed verifications use
 * immutable snapshots and are never blocked by pool deletion.
 */
export class PoolDeleteBlockedError extends Error {
  readonly blockers: PoolDeleteBlocker[];

  constructor(blockers: PoolDeleteBlocker[]) {
    super('Impossibile eliminare il pool: esistono bozze di verifica collegate.');
    this.name = 'PoolDeleteBlockedError';
    this.blockers = blockers;
  }
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function computePoolStorageRef(lesson: LessonDoc): string {
  return lesson.poolStorageRef ?? lesson.storageRef.replace(/\.md$/, '.pool.md');
}

function questionIndexCollection(db: Firestore, programId: string, importId: string) {
  return collection(db, 'programs', programId, 'imports', importId, 'questionIndex');
}

function buildQuestionIndexEntry(
  ownerUid: string,
  importId: string,
  lesson: LessonDoc,
  poolStorageRef: string,
  q: ParsedPool['questions'][number],
): QuestionIndexEntry {
  return {
    ownerUid,
    importId,
    udaDir: lesson.udaDir,
    lessonPath: lesson.path,
    lessonFilename: lesson.filename,
    poolStorageRef,
    questionLocalId: q.id,
    tipo: q.tipo,
    difficolta: q.difficolta,
    peso: q.peso,
    maxPoints: q.maxPoints,
    questionPreview: buildQuestionPreview(q.testo),
  };
}

const BATCH_CHUNK_SIZE = 400;

async function deleteDocRefsInBatches(db: Firestore, refs: DocumentReference[]): Promise<void> {
  for (let i = 0; i < refs.length; i += BATCH_CHUNK_SIZE) {
    const batch = writeBatch(db);
    refs.slice(i, i + BATCH_CHUNK_SIZE).forEach((r) => batch.delete(r));
    await batch.commit();
  }
}

/**
 * A single mutation to apply to a `WriteBatch` (set/update/delete), deferred
 * so an arbitrary mix of mutation kinds can be chunked and committed
 * uniformly — see `commitOpsInChunks`.
 */
type BatchOp = (batch: WriteBatch) => void;

/**
 * Commits an arbitrary list of `BatchOp`s in chunks of at most
 * `BATCH_CHUNK_SIZE` (a prudent margin under Firestore's 500-mutation
 * writeBatch limit), one `writeBatch` per chunk. Chunks are committed
 * sequentially — not `Promise.all`'d — so a failure is deterministic (it
 * always happens at a specific chunk boundary, never as a burst of
 * concurrent in-flight batches) and so this never fires more concurrent
 * writes than a single chunk's worth at a time.
 *
 * Residual risk: Firestore only guarantees atomicity *within* one batch.
 * If a pool has more mutations than fit in a single chunk, a failure after
 * chunk N-1 commits but before chunk N does leaves the first N-1 chunks'
 * mutations durably applied and the rest not yet applied — there is no
 * cross-chunk rollback. This is an explicit, documented trade-off (see
 * `savePool`), not a regression: the previous one-`setDoc`-per-question
 * loop had the same "partial completion on failure" property, just with
 * far more round-trips before a failure could occur.
 */
async function commitOpsInChunks(db: Firestore, ops: BatchOp[]): Promise<void> {
  for (let i = 0; i < ops.length; i += BATCH_CHUNK_SIZE) {
    const batch = writeBatch(db);
    ops.slice(i, i + BATCH_CHUNK_SIZE).forEach((op) => op(batch));
    await batch.commit();
  }
}

// ── loadPool ──────────────────────────────────────────────────────────────────

/**
 * Reads the `.pool.md` file for a lesson from Storage and parses it.
 *
 * Returns:
 * - `{ status: 'absent' }` when the lesson has no pool (poolStatus === 'absent'
 *   or Storage file is missing).
 * - `{ status: 'valid', pool }` when the file exists and parses cleanly.
 * - `{ status: 'invalid', errors, rawContent }` when the file exists but has
 *   validation errors. `rawContent` preserves the original file so the editor
 *   can repair it without replacing it with a blank template.
 */
export async function loadPool(params: {
  programId: string;
  importId: string;
  lessonId: string;
  db: Firestore;
  storage: FirebaseStorage;
}): Promise<LoadPoolResult> {
  const { programId, importId, lessonId, db } = params;

  const lessonRef = doc(db, 'programs', programId, 'imports', importId, 'lessons', lessonId);
  const snap = await getDoc(lessonRef);
  if (!snap.exists()) throw new Error('Lezione non trovata.');
  const lesson = snap.data() as LessonDoc;

  if (lesson.poolStatus === 'absent' || !lesson.poolStorageRef) {
    return { status: 'absent' };
  }

  let content: string;
  try {
    // SGW-01: lettura pool via gateway same-origin (non più getBytes diretto).
    content = await readText(lesson.poolStorageRef);
  } catch (err) {
    if (isFileNotFound(err)) {
      return { status: 'absent' };
    }
    throw new Error('Impossibile leggere il file pool da Storage.');
  }

  const result = parsePool(content, lesson.poolStorageRef);
  if (!result.ok) {
    return { status: 'invalid', errors: result.errors, rawContent: content };
  }
  return { status: 'valid', pool: result.pool };
}

// ── savePool ──────────────────────────────────────────────────────────────────

/**
 * Serializes `pool` and writes it back to Storage, then updates Firestore:
 * - Sets/overwrites each `questionIndex` entry for questions in the pool.
 * - Deletes stale `questionIndex` entries for questions no longer in the pool.
 * - Updates `lessons/{lessonId}` with the new `poolStatus`, `questionCount`,
 *   and `poolStorageRef`.
 *
 * All three kinds of Firestore mutation are committed via `commitOpsInChunks`
 * (chunks of at most 400 mutations per `writeBatch`, committed sequentially)
 * instead of one individually-awaited `setDoc` per question — see that
 * function's doc comment for the residual cross-chunk atomicity trade-off.
 * The number of documents written is unchanged; only the number of network
 * round-trips drops.
 *
 * Storage-poi-Firestore: if Storage fails, Firestore is never touched.
 * If Storage succeeds but Firestore fails, a distinct error is thrown so the
 * teacher knows to retry.
 */
export async function savePool(params: {
  programId: string;
  importId: string;
  lessonId: string;
  pool: ParsedPool;
  ownerUid: string;
  db: Firestore;
  storage: FirebaseStorage;
}): Promise<void> {
  const { programId, importId, lessonId, pool, ownerUid, db } = params;

  const lessonRef = doc(db, 'programs', programId, 'imports', importId, 'lessons', lessonId);
  const snap = await getDoc(lessonRef);
  if (!snap.exists()) throw new Error('Lezione non trovata.');
  const lesson = snap.data() as LessonDoc;

  const poolStorageRef = computePoolStorageRef(lesson);
  const serialized = serializePool(pool);

  try {
    // SGW-01: scrittura pool via gateway same-origin.
    await writeText(poolStorageRef, serialized);
  } catch {
    throw new Error('Impossibile scrivere il file pool su Storage.');
  }

  try {
    const qiCollection = questionIndexCollection(db, programId, importId);

    const existingSnap = await getDocs(
      query(
        qiCollection,
        where('udaDir', '==', lesson.udaDir),
        where('lessonFilename', '==', lesson.filename),
      ),
    );

    const newEntryIds = new Set(pool.questions.map((q) => `${lessonId}_${toDocId(q.id)}`));
    const staleRefs = existingSnap.docs.filter((d) => !newEntryIds.has(d.id)).map((d) => d.ref);

    // All mutations for this save — upserts, stale deletes, and the final
    // lesson-doc update — are collected up front (deterministic, no
    // network I/O yet) and only then committed in chunks (PERF-04 /
    // PERF-SEC-01B-2). This replaces one sequential, individually-awaited
    // `setDoc` per question with a handful of batch round-trips: the
    // number of Firestore writes is unchanged (still one write per
    // question document, since each is a distinct document), but the
    // number of network round-trips drops from N+2 to
    // ceil((N + staleRefs.length + 1) / 400).
    const ops: BatchOp[] = pool.questions.map((q) => {
      const entryId = `${lessonId}_${toDocId(q.id)}`;
      const entryData = buildQuestionIndexEntry(ownerUid, importId, lesson, poolStorageRef, q);
      return (batch) => batch.set(doc(qiCollection, entryId), entryData);
    });
    for (const staleRef of staleRefs) {
      ops.push((batch) => batch.delete(staleRef));
    }
    ops.push((batch) =>
      batch.update(lessonRef, {
        poolStatus: 'valid',
        questionCount: pool.questions.length,
        poolStorageRef,
      }),
    );

    await commitOpsInChunks(db, ops);
  } catch {
    throw new Error(
      'Il file pool è stato salvato su Storage ma non è stato possibile aggiornare i dati su Firestore. Riprova a salvare.',
    );
  }
}

// ── deletePool ────────────────────────────────────────────────────────────────

/**
 * Deletes the `.pool.md` file from Storage and removes all `questionIndex`
 * entries for the lesson. Updates `lessons/{lessonId}` to reflect the
 * absence of the pool (`poolStatus: 'absent'`, `questionCount: 0`,
 * `poolStorageRef: null`).
 *
 * Guard: throws `PoolDeleteBlockedError` (without touching Storage or
 * Firestore) when any **draft** verification references a question from this
 * pool. Active and closed verifications are unaffected — they use immutable
 * snapshots — and do not block deletion.
 *
 * Storage-poi-Firestore: a missing Storage file is tolerated (treated as
 * already absent). If Storage deletion succeeds but Firestore cleanup fails,
 * a distinct error is thrown.
 */
export async function deletePool(params: {
  programId: string;
  importId: string;
  lessonId: string;
  ownerUid: string;
  db: Firestore;
  storage: FirebaseStorage;
}): Promise<void> {
  // ownerUid is part of the public params contract (kept for call-site
  // compatibility) but is no longer needed locally now that the
  // verifications guard query below no longer filters by it (PERF-SEC-01B-3
  // — see comment above; SchoolForge is single-owner per deployment, so an
  // ownerUid filter here would not narrow the query further).
  const { programId, importId, lessonId, db } = params;

  const lessonRef = doc(db, 'programs', programId, 'imports', importId, 'lessons', lessonId);
  const snap = await getDoc(lessonRef);
  if (!snap.exists()) throw new Error('Lezione non trovata.');
  const lesson = snap.data() as LessonDoc;

  if (lesson.poolStatus === 'absent' || !lesson.poolStorageRef) {
    return;
  }

  const poolStorageRef = lesson.poolStorageRef;

  // Guard: block if any draft verification references this pool's
  // questions. Narrowed server-side to draft verifications for this exact
  // program+import (PERF-SEC-01B-3) instead of every verification the
  // owner has ever created — `config.questionRefs.some(...)` still has to
  // run client-side on the (much smaller) result, since it checks a
  // sub-field inside an array of maps, which Firestore cannot filter on
  // server-side without a schema change (see repositoryEditorService.ts's
  // `fetchVerificationsForGuard` for the same pattern).
  const verificationsSnap = await getDocs(
    query(
      collection(db, 'verifications'),
      where('status', '==', 'draft'),
      where('config.programId', '==', programId),
      where('config.importId', '==', importId),
    ),
  );
  const blockers: PoolDeleteBlocker[] = verificationsSnap.docs
    .map((d) => ({ id: d.id, ...(d.data() as VerificationDoc) }))
    .filter((v) => v.config.questionRefs.some((r) => r.poolStorageRef === poolStorageRef))
    .map((v) => ({ verificationId: v.id, title: v.config.title }));

  if (blockers.length > 0) throw new PoolDeleteBlockedError(blockers);

  try {
    // SGW-01: eliminazione pool via gateway (delete idempotente lato gateway).
    await deleteFile(poolStorageRef);
  } catch {
    throw new Error('Impossibile eliminare il file pool da Storage.');
  }

  try {
    const existingSnap = await getDocs(
      query(
        questionIndexCollection(db, programId, importId),
        where('udaDir', '==', lesson.udaDir),
        where('lessonFilename', '==', lesson.filename),
      ),
    );
    await deleteDocRefsInBatches(
      db,
      existingSnap.docs.map((d) => d.ref),
    );
    await updateDoc(lessonRef, {
      poolStatus: 'absent',
      questionCount: 0,
      poolStorageRef: null,
    });
  } catch {
    throw new Error(
      'Il file pool è stato eliminato da Storage ma non è stato possibile rimuovere i dati da Firestore. Riprova.',
    );
  }
}
