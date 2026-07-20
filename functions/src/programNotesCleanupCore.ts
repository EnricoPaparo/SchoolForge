/**
 * ANNOT-CLEANUP-01 — pure core for the owner-only cleanup of a program's
 * student lesson notes. No Firebase Admin SDK here: every I/O boundary is an
 * injected port, so the whole flow is unit-testable with fakes.
 *
 * Strategy (economical, indexed — never a scan of all `lessonNotes`):
 *  - one collection-group read over `lessonNoteIndexes` filtered by
 *    `programId == input` → one document per student who kept a note for that
 *    course (each already carries the student's `lessonIds`);
 *  - note delete paths are built directly from the index's `studentUid` +
 *    `lessonIds` — the `lessonNotes` documents (and their `content`) are NEVER
 *    read, so the teacher never sees note contents;
 *  - deletes run in sequential chunks of at most 400 ops; deleting an already
 *    absent document is a no-op, so the whole operation is idempotent and
 *    safe to retry.
 *
 * This covers exactly the notes tracked by the ANNOT-03B per-course index.
 * There is deliberately no fallback scan of `lessonNotes`, no TTL, scheduler,
 * polling, listener or legacy migration.
 */

export const NOTE_CLEANUP_CHUNK_SIZE = 400;
export const NOTE_INDEX_MAX_LESSON_IDS = 500;

export interface ProgramNotesCleanupInput {
  programId: string;
}

export interface ProgramNotesCleanupResult {
  status: 'completed';
  notesDeleted: number;
  indexesDeleted: number;
}

export type ProgramNotesCleanupErrorCode =
  | 'unauthenticated'
  | 'not_owner'
  | 'invalid_input'
  | 'malformed_index'
  | 'internal';

export class ProgramNotesCleanupError extends Error {
  readonly code: ProgramNotesCleanupErrorCode;
  constructor(code: ProgramNotesCleanupErrorCode, message: string) {
    super(message);
    this.name = 'ProgramNotesCleanupError';
    this.code = code;
  }
}

/**
 * One `lessonNoteIndexes` document as read by the collection-group query. The
 * Admin adapter fills `pathStudentUid`/`pathProgramId` from the document ref
 * (`students/{studentUid}/lessonNoteIndexes/{programId}`) so the core can check
 * the stored fields against the actual path — never trusting the payload alone.
 */
export interface RawLessonNoteIndex {
  pathStudentUid: string;
  pathProgramId: string;
  data: Record<string, unknown>;
}

/** A document to delete, expressed as path segments (the port builds the ref). */
export interface DocRefPath {
  segments: string[];
}

export interface ProgramNotesCleanupDeps {
  callerUid: string | null;
  getOwnerUid: () => Promise<string | null>;
  /** Collection-group query on `lessonNoteIndexes` where `programId == programId`. */
  queryIndexesByProgram: (programId: string) => Promise<RawLessonNoteIndex[]>;
  /** Deletes up to NOTE_CLEANUP_CHUNK_SIZE documents; absent docs are a no-op. */
  deleteChunk: (refs: DocRefPath[]) => Promise<void>;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/** Validates the closed input: only a non-empty `programId`. */
export function validateCleanupInput(input: unknown): ProgramNotesCleanupInput {
  const programId = (input as { programId?: unknown } | null)?.programId;
  if (!isNonEmptyString(programId)) {
    throw new ProgramNotesCleanupError('invalid_input', 'programId mancante o non valido.');
  }
  return { programId };
}

/**
 * Fail-closed validation of one index document against the requested program.
 * Returns the student uid + de-duplicated lesson ids. A malformed index throws
 * (never leads to deleting arbitrary paths) with a readable message that never
 * exposes note content or a concrete path.
 */
export function validateIndex(
  raw: RawLessonNoteIndex,
  programId: string,
): { studentUid: string; lessonIds: string[] } {
  const fail = () => {
    throw new ProgramNotesCleanupError(
      'malformed_index',
      'Indice appunti non valido: impossibile completare la pulizia in modo sicuro.',
    );
  };

  // Path must be coherent with the requested program.
  if (!isNonEmptyString(raw.pathStudentUid) || raw.pathProgramId !== programId) fail();
  // Stored identity must match the path and the requested program.
  if (
    raw.data.studentUid !== raw.pathStudentUid ||
    !isNonEmptyString(raw.data.studentUid) ||
    raw.data.programId !== programId
  ) {
    fail();
  }
  const lessonIds = raw.data.lessonIds;
  if (
    !Array.isArray(lessonIds) ||
    lessonIds.length > NOTE_INDEX_MAX_LESSON_IDS ||
    !lessonIds.every(isNonEmptyString)
  ) {
    fail();
  }
  // De-duplicate before building deletes.
  return {
    studentUid: raw.pathStudentUid,
    lessonIds: [...new Set(lessonIds as string[])],
  };
}

/**
 * Owner-only, indexed cleanup. Order: authenticate → assert owner → one
 * collection-group read → validate every index fail-closed → delete notes in
 * chunks, then indexes in chunks (notes always removed before their index, so
 * a retry never orphans a note). Returns minimal counts only — no uid, path,
 * lessonId, name, email or content ever leaves this function.
 */
export async function runProgramNotesCleanup(
  input: unknown,
  deps: ProgramNotesCleanupDeps,
): Promise<ProgramNotesCleanupResult> {
  const { programId } = validateCleanupInput(input);

  if (!isNonEmptyString(deps.callerUid)) {
    throw new ProgramNotesCleanupError('unauthenticated', 'Autenticazione richiesta.');
  }
  const ownerUid = await deps.getOwnerUid();
  if (!isNonEmptyString(ownerUid) || deps.callerUid !== ownerUid) {
    throw new ProgramNotesCleanupError(
      'not_owner',
      'Operazione riservata al docente proprietario.',
    );
  }

  const rawIndexes = await deps.queryIndexesByProgram(programId);

  const noteRefs: DocRefPath[] = [];
  const indexRefs: DocRefPath[] = [];
  for (const raw of rawIndexes) {
    const { studentUid, lessonIds } = validateIndex(raw, programId);
    for (const lessonId of lessonIds) {
      noteRefs.push({ segments: ['students', studentUid, 'lessonNotes', lessonId] });
    }
    indexRefs.push({ segments: ['students', studentUid, 'lessonNoteIndexes', programId] });
  }

  // Delete notes first (in chunks), then their indexes (in chunks): a crash
  // mid-way never leaves an index pointing at notes that are gone, and the
  // next retry re-queries only the still-present indexes — idempotent.
  await deleteInChunks(noteRefs, deps.deleteChunk);
  await deleteInChunks(indexRefs, deps.deleteChunk);

  return {
    status: 'completed',
    notesDeleted: noteRefs.length,
    indexesDeleted: indexRefs.length,
  };
}

async function deleteInChunks(
  refs: DocRefPath[],
  deleteChunk: (refs: DocRefPath[]) => Promise<void>,
): Promise<void> {
  for (let i = 0; i < refs.length; i += NOTE_CLEANUP_CHUNK_SIZE) {
    await deleteChunk(refs.slice(i, i + NOTE_CLEANUP_CHUNK_SIZE));
  }
}
