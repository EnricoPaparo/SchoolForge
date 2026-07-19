import {
  arrayRemove,
  arrayUnion,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import type { StudentLessonNoteDoc, StudentLessonNoteIndexDoc } from '../../types/firestore.js';

/**
 * ANNOT-01 — Firestore service for the student's strictly personal lesson
 * notes stored at `students/{studentUid}/lessonNotes/{publicLessonId}`.
 *
 * Deliberately minimal and stateless: this layer only reads/writes the
 * deterministic personal document. It does NOT implement the session cache,
 * debounce, dirty guard, coalescing or focus/navigation logic — those belong
 * to the UI controller. Nothing here starts a realtime listener or polls:
 * ordinary note loads are one-shot, and presence-changing mutations use one
 * atomic batch for note + index. No extra read is issued by save/delete.
 */

/** The client-side ceiling for note content — re-validated by Security Rules. */
export const STUDENT_LESSON_NOTE_MAX_LENGTH = 20_000;
export const STUDENT_LESSON_NOTE_INDEX_MAX_IDS = 500;

/**
 * Identity of a lesson note, derived by the caller (ANNOT-02) from the
 * `publicLessons` projection already loaded for the selected lesson — the
 * service never re-reads the projection to obtain these. `publicLessonId` is
 * the Firestore document id; `programId`/`importId` are the projection's own
 * fields the Security Rules cross-check on write.
 */
export interface StudentLessonNoteIdentity {
  studentUid: string;
  publicLessonId: string;
  programId: string;
  importId: string;
}

export type StudentLessonNoteIndexIdentity = Omit<StudentLessonNoteIdentity, 'publicLessonId'>;

export interface StudentLessonNoteIndexResult {
  lessonIds: string[];
  bootstrapped: boolean;
}

/**
 * Result of loading a note: an absent document is a normal `missing` state,
 * never an error — the very first open of a lesson finds no note yet.
 */
export type StudentLessonNoteLoadResult =
  | { state: 'missing' }
  | { state: 'existing'; note: StudentLessonNoteDoc };

/**
 * Sanitized, UI-safe error codes. No raw Firebase message ever reaches the
 * caller: `permission-denied` is surfaced as such (access lost / exam mode),
 * `content-too-long` is a client-contract violation caught before any write,
 * and everything else collapses to `unavailable`. The ANNOT-02 UI maps these
 * to sanitized copy — it never renders `.message` verbatim.
 */
export type StudentLessonNoteErrorCode = 'content-too-long' | 'permission-denied' | 'unavailable';

export class StudentLessonNoteError extends Error {
  readonly code: StudentLessonNoteErrorCode;

  constructor(code: StudentLessonNoteErrorCode, message: string) {
    super(message);
    this.name = 'StudentLessonNoteError';
    this.code = code;
  }
}

function noteRef(db: Firestore, studentUid: string, publicLessonId: string) {
  return doc(db, 'students', studentUid, 'lessonNotes', publicLessonId);
}

function noteIndexRef(db: Firestore, studentUid: string, programId: string) {
  return doc(db, 'students', studentUid, 'lessonNoteIndexes', programId);
}

/**
 * Wraps a Firebase failure into a sanitized `StudentLessonNoteError`. A
 * `permission-denied` (access revoked, class no longer assigned, Modalità
 * verifica, or a foreign path) is kept distinct; any other failure becomes
 * `unavailable`. Never returns a false success and never auto-retries.
 */
function toNoteError(err: unknown): StudentLessonNoteError {
  const code = (err as { code?: string } | null)?.code;
  if (code === 'permission-denied') {
    return new StudentLessonNoteError('permission-denied', 'Operazione non consentita.');
  }
  return new StudentLessonNoteError('unavailable', 'Operazione non riuscita.');
}

/**
 * Rejects content that is not a string or exceeds the ceiling BEFORE any
 * network write — the client never relies on silent server-side truncation
 * (the Rules deny an over-limit write outright). Returns the validated string.
 */
function validateContent(content: string): string {
  if (typeof content !== 'string' || content.length > STUDENT_LESSON_NOTE_MAX_LENGTH) {
    throw new StudentLessonNoteError(
      'content-too-long',
      `Il contenuto supera i ${STUDENT_LESSON_NOTE_MAX_LENGTH} caratteri.`,
    );
  }
  return content;
}

/**
 * Loads the student's note for a lesson via a single `getDoc` on the
 * deterministic path. No listener, no polling. An absent document resolves to
 * `{ state: 'missing' }` (not an error); a present one is normalized and
 * returned as `{ state: 'existing', note }`. A present document whose
 * `content` is not a string is treated as `unavailable` (fail-closed) rather
 * than silently coerced.
 */
export async function loadStudentLessonNote(
  studentUid: string,
  publicLessonId: string,
  db: Firestore,
): Promise<StudentLessonNoteLoadResult> {
  let snap;
  try {
    snap = await getDoc(noteRef(db, studentUid, publicLessonId));
  } catch (err) {
    throw toNoteError(err);
  }

  if (!snap.exists()) return { state: 'missing' };

  const data = snap.data() as Partial<StudentLessonNoteDoc>;
  if (typeof data.content !== 'string') {
    throw new StudentLessonNoteError('unavailable', 'Nota non leggibile.');
  }

  return {
    state: 'existing',
    note: {
      studentUid,
      publicLessonId,
      programId: typeof data.programId === 'string' ? data.programId : '',
      importId: typeof data.importId === 'string' ? data.importId : '',
      content: data.content,
      createdAt: data.createdAt as StudentLessonNoteDoc['createdAt'],
      updatedAt: data.updatedAt as StudentLessonNoteDoc['updatedAt'],
    },
  };
}

/**
 * Atomically creates a non-blank note and adds its id to the per-course index.
 * Identity comes from the already-loaded lesson context; no extra read. The
 * array transform is idempotent, so lessonIds never gains duplicates.
 */
export async function createStudentLessonNote(
  identity: StudentLessonNoteIdentity,
  content: string,
  db: Firestore,
): Promise<void> {
  const validated = validateContent(content);
  if (validated.trim() === '') return;
  const timestamp = serverTimestamp();
  try {
    const batch = writeBatch(db);
    batch.set(noteRef(db, identity.studentUid, identity.publicLessonId), {
      studentUid: identity.studentUid,
      publicLessonId: identity.publicLessonId,
      programId: identity.programId,
      importId: identity.importId,
      content: validated,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    batch.set(
      noteIndexRef(db, identity.studentUid, identity.programId),
      {
        studentUid: identity.studentUid,
        programId: identity.programId,
        importId: identity.importId,
        lessonIds: arrayUnion(identity.publicLessonId),
        updatedAt: timestamp,
      },
      { merge: true },
    );
    await batch.commit();
  } catch (err) {
    throw toNoteError(err);
  }
}

/**
 * Updates ONLY `content` and `updatedAt` on an existing note. Never rewrites
 * the identity fields or `createdAt` (Security Rules forbid it anyway), never
 * reads the document first and never uses a transaction — a single
 * `updateDoc` write. If the document does not exist the write fails and is
 * surfaced as `unavailable`.
 */
export async function updateStudentLessonNote(
  studentUid: string,
  publicLessonId: string,
  content: string,
  db: Firestore,
): Promise<void> {
  const validated = validateContent(content);
  try {
    await updateDoc(noteRef(db, studentUid, publicLessonId), {
      content: validated,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    throw toNoteError(err);
  }
}

/**
 * Atomically deletes the student's personal note and removes its id from the
 * per-course index. Never recurses or touches publicLessons, programs or
 * Storage. The same operation implements persisted-note -> trim-empty.
 */
export async function deleteStudentLessonNote(
  identity: StudentLessonNoteIdentity,
  db: Firestore,
): Promise<void> {
  try {
    const batch = writeBatch(db);
    batch.delete(noteRef(db, identity.studentUid, identity.publicLessonId));
    batch.set(
      noteIndexRef(db, identity.studentUid, identity.programId),
      {
        studentUid: identity.studentUid,
        programId: identity.programId,
        importId: identity.importId,
        lessonIds: arrayRemove(identity.publicLessonId),
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
    await batch.commit();
  } catch (err) {
    throw toNoteError(err);
  }
}

/**
 * Loads the one per-course index. A missing index, or one from an older
 * import, is bootstrapped once from this student's notes constrained to the
 * current program/import. Empty notes are ignored and the normalized index is
 * persisted in one batch write. No listener or global migration is used.
 */
export async function loadStudentLessonNoteIndex(
  identity: StudentLessonNoteIndexIdentity,
  db: Firestore,
): Promise<StudentLessonNoteIndexResult> {
  try {
    const indexRef = noteIndexRef(db, identity.studentUid, identity.programId);
    const indexSnap = await getDoc(indexRef);
    if (indexSnap.exists()) {
      const data = indexSnap.data() as Partial<StudentLessonNoteIndexDoc>;
      if (
        data.studentUid === identity.studentUid &&
        data.programId === identity.programId &&
        data.importId === identity.importId &&
        Array.isArray(data.lessonIds) &&
        data.lessonIds.length <= STUDENT_LESSON_NOTE_INDEX_MAX_IDS &&
        data.lessonIds.every((id) => typeof id === 'string' && id.length > 0)
      ) {
        return { lessonIds: [...new Set(data.lessonIds)], bootstrapped: false };
      }
    }

    const notesSnap = await getDocs(
      query(
        collection(db, 'students', identity.studentUid, 'lessonNotes'),
        where('programId', '==', identity.programId),
        where('importId', '==', identity.importId),
      ),
    );
    const lessonIds = [
      ...new Set(
        notesSnap.docs
          .filter((note) => {
            const content = (note.data() as Partial<StudentLessonNoteDoc>).content;
            return typeof content === 'string' && content.trim() !== '';
          })
          .map((note) => note.id),
      ),
    ];
    if (lessonIds.length > STUDENT_LESSON_NOTE_INDEX_MAX_IDS) {
      throw new StudentLessonNoteError('unavailable', 'Indice appunti non disponibile.');
    }
    await setDoc(indexRef, {
      studentUid: identity.studentUid,
      programId: identity.programId,
      importId: identity.importId,
      lessonIds,
      updatedAt: serverTimestamp(),
    });
    return { lessonIds, bootstrapped: true };
  } catch (err) {
    throw toNoteError(err);
  }
}
