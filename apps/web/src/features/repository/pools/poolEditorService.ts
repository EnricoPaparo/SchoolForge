import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import type { DocumentReference, Firestore } from 'firebase/firestore';
import { deleteObject, getBytes, ref, uploadBytes } from 'firebase/storage';
import type { FirebaseStorage } from 'firebase/storage';
import { parsePool, serializePool } from '@schoolforge/lesson-contract';
import type { ParsedPool, PoolValidationError } from '@schoolforge/lesson-contract';
import { buildQuestionPreview, toDocId } from '../import/buildImportPayload.js';
import type { LessonDoc, QuestionIndexEntry, VerificationDoc } from '../../../types/firestore.js';

// ── Result types ──────────────────────────────────────────────────────────────

export type LoadPoolResult =
  | { status: 'absent' }
  | { status: 'valid'; pool: ParsedPool }
  | { status: 'invalid'; errors: PoolValidationError[] };

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

// ── loadPool ──────────────────────────────────────────────────────────────────

/**
 * Reads the `.pool.md` file for a lesson from Storage and parses it.
 *
 * Returns:
 * - `{ status: 'absent' }` when the lesson has no pool (poolStatus === 'absent'
 *   or Storage file is missing).
 * - `{ status: 'valid', pool }` when the file exists and parses cleanly.
 * - `{ status: 'invalid', errors }` when the file exists but has validation
 *   errors (preserves the original errors so the UI can show them).
 */
export async function loadPool(params: {
  programId: string;
  importId: string;
  lessonId: string;
  db: Firestore;
  storage: FirebaseStorage;
}): Promise<LoadPoolResult> {
  const { programId, importId, lessonId, db, storage } = params;

  const lessonRef = doc(db, 'programs', programId, 'imports', importId, 'lessons', lessonId);
  const snap = await getDoc(lessonRef);
  if (!snap.exists()) throw new Error('Lezione non trovata.');
  const lesson = snap.data() as LessonDoc;

  if (lesson.poolStatus === 'absent' || !lesson.poolStorageRef) {
    return { status: 'absent' };
  }

  let content: string;
  try {
    const bytes = await getBytes(ref(storage, lesson.poolStorageRef));
    content = new TextDecoder().decode(bytes);
  } catch (err) {
    if ((err as { code?: string }).code === 'storage/object-not-found') {
      return { status: 'absent' };
    }
    throw new Error('Impossibile leggere il file pool da Storage.');
  }

  const result = parsePool(content, lesson.poolStorageRef);
  if (!result.ok) {
    return { status: 'invalid', errors: result.errors };
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
  const { programId, importId, lessonId, pool, ownerUid, db, storage } = params;

  const lessonRef = doc(db, 'programs', programId, 'imports', importId, 'lessons', lessonId);
  const snap = await getDoc(lessonRef);
  if (!snap.exists()) throw new Error('Lezione non trovata.');
  const lesson = snap.data() as LessonDoc;

  const poolStorageRef = computePoolStorageRef(lesson);
  const serialized = serializePool(pool);

  try {
    await uploadBytes(ref(storage, poolStorageRef), new TextEncoder().encode(serialized));
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

    for (const q of pool.questions) {
      const entryId = `${lessonId}_${toDocId(q.id)}`;
      await setDoc(
        doc(qiCollection, entryId),
        buildQuestionIndexEntry(ownerUid, importId, lesson, poolStorageRef, q),
      );
    }

    const staleRefs = existingSnap.docs.filter((d) => !newEntryIds.has(d.id)).map((d) => d.ref);
    await deleteDocRefsInBatches(db, staleRefs);

    await updateDoc(lessonRef, {
      poolStatus: 'valid',
      questionCount: pool.questions.length,
      poolStorageRef,
    });
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
  const { programId, importId, lessonId, ownerUid, db, storage } = params;

  const lessonRef = doc(db, 'programs', programId, 'imports', importId, 'lessons', lessonId);
  const snap = await getDoc(lessonRef);
  if (!snap.exists()) throw new Error('Lezione non trovata.');
  const lesson = snap.data() as LessonDoc;

  if (lesson.poolStatus === 'absent' || !lesson.poolStorageRef) {
    return;
  }

  const poolStorageRef = lesson.poolStorageRef;

  // Guard: block if any draft verification references this pool's questions.
  const verificationsSnap = await getDocs(
    query(collection(db, 'verifications'), where('ownerUid', '==', ownerUid)),
  );
  const blockers: PoolDeleteBlocker[] = verificationsSnap.docs
    .map((d) => ({ id: d.id, ...(d.data() as VerificationDoc) }))
    .filter(
      (v) =>
        v.status === 'draft' &&
        v.config.programId === programId &&
        v.config.importId === importId &&
        v.config.questionRefs.some((r) => r.poolStorageRef === poolStorageRef),
    )
    .map((v) => ({ verificationId: v.id, title: v.config.title }));

  if (blockers.length > 0) throw new PoolDeleteBlockedError(blockers);

  try {
    await deleteObject(ref(storage, poolStorageRef));
  } catch (err) {
    if ((err as { code?: string }).code !== 'storage/object-not-found') {
      throw new Error('Impossibile eliminare il file pool da Storage.');
    }
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
