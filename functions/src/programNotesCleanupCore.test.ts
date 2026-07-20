import { describe, expect, it, vi } from 'vitest';
import {
  NOTE_CLEANUP_CHUNK_SIZE,
  ProgramNotesCleanupError,
  runProgramNotesCleanup,
  validateIndex,
  type DocRefPath,
  type ProgramNotesCleanupDeps,
  type RawLessonNoteIndex,
} from './programNotesCleanupCore.js';

const PROGRAM_ID = 'prog-1';
const OWNER = 'owner-uid';

function rawIndex(
  studentUid: string,
  lessonIds: unknown,
  overrides: Partial<RawLessonNoteIndex> = {},
) {
  return {
    pathStudentUid: studentUid,
    pathProgramId: PROGRAM_ID,
    data: { studentUid, programId: PROGRAM_ID, importId: 'i1', lessonIds },
    ...overrides,
  } satisfies RawLessonNoteIndex;
}

function makeDeps(
  overrides: Partial<ProgramNotesCleanupDeps> & { indexes?: RawLessonNoteIndex[] } = {},
): {
  deps: ProgramNotesCleanupDeps;
  deletedChunks: DocRefPath[][];
  queryCalls: string[];
} {
  const deletedChunks: DocRefPath[][] = [];
  const queryCalls: string[] = [];
  const { indexes, ...depOverrides } = overrides;
  const deps: ProgramNotesCleanupDeps = {
    callerUid: OWNER,
    getOwnerUid: async () => OWNER,
    queryIndexesByProgram: async (programId) => {
      queryCalls.push(programId);
      return indexes ?? [];
    },
    deleteChunk: async (refs) => {
      deletedChunks.push(refs);
    },
    ...depOverrides,
  };
  return { deps, deletedChunks, queryCalls };
}

/** All deleted document paths, flattened. */
function deletedPaths(chunks: DocRefPath[][]): string[] {
  return chunks.flat().map((r) => r.segments.join('/'));
}

describe('runProgramNotesCleanup — authorization', () => {
  it('allows the authenticated owner', async () => {
    const { deps } = makeDeps({ indexes: [] });
    const result = await runProgramNotesCleanup({ programId: PROGRAM_ID }, deps);
    expect(result).toEqual({ status: 'completed', notesDeleted: 0, indexesDeleted: 0 });
  });

  it('denies an anonymous caller (no uid)', async () => {
    const { deps } = makeDeps({ callerUid: null });
    await expect(runProgramNotesCleanup({ programId: PROGRAM_ID }, deps)).rejects.toMatchObject({
      code: 'unauthenticated',
    });
  });

  it('denies a non-owner authenticated caller', async () => {
    const { deps } = makeDeps({ callerUid: 'someone-else' });
    await expect(runProgramNotesCleanup({ programId: PROGRAM_ID }, deps)).rejects.toMatchObject({
      code: 'not_owner',
    });
  });

  it('denies when there is no configured owner (fail-closed)', async () => {
    const { deps } = makeDeps({ getOwnerUid: async () => null });
    await expect(runProgramNotesCleanup({ programId: PROGRAM_ID }, deps)).rejects.toMatchObject({
      code: 'not_owner',
    });
  });

  it('rejects an empty/invalid programId before any query', async () => {
    const { deps, queryCalls } = makeDeps();
    await expect(runProgramNotesCleanup({ programId: '' }, deps)).rejects.toMatchObject({
      code: 'invalid_input',
    });
    await expect(runProgramNotesCleanup({}, deps)).rejects.toMatchObject({ code: 'invalid_input' });
    expect(queryCalls).toHaveLength(0);
  });
});

describe('runProgramNotesCleanup — closed input & Firestore-segment validation', () => {
  const badInputs: Array<[string, unknown]> = [
    ['extra property besides programId', { programId: PROGRAM_ID, studentUid: 'x' }],
    ['whitespace-only programId', { programId: '   ' }],
    ['programId with a slash', { programId: 'a/b' }],
    ['programId equal to ".."', { programId: '..' }],
    ['programId equal to "."', { programId: '.' }],
    ['non-string programId', { programId: 123 }],
    ['null input', null],
    ['array input', [{ programId: PROGRAM_ID }]],
    ['programId over the UTF-8 segment limit', { programId: 'a'.repeat(1501) }],
  ];

  it.each(badInputs)('rejects %s before any query or delete', async (_label, input) => {
    const deleteChunk = vi.fn(async () => {});
    const { deps, queryCalls } = makeDeps({ deleteChunk });
    await expect(runProgramNotesCleanup(input, deps)).rejects.toMatchObject({
      code: 'invalid_input',
    });
    expect(queryCalls).toHaveLength(0);
    expect(deleteChunk).not.toHaveBeenCalled();
  });

  it('accepts a valid programId unchanged (no normalization)', async () => {
    const { deps, queryCalls } = makeDeps({ indexes: [] });
    await runProgramNotesCleanup({ programId: PROGRAM_ID }, deps);
    expect(queryCalls).toEqual([PROGRAM_ID]);
  });
});

describe('runProgramNotesCleanup — deletion', () => {
  it('does nothing (zero notes/indexes) when no student has an index for the course', async () => {
    const { deps, deletedChunks, queryCalls } = makeDeps({ indexes: [] });
    const result = await runProgramNotesCleanup({ programId: PROGRAM_ID }, deps);
    expect(queryCalls).toEqual([PROGRAM_ID]);
    expect(deletedChunks.flat()).toHaveLength(0);
    expect(result).toEqual({ status: 'completed', notesDeleted: 0, indexesDeleted: 0 });
  });

  it('deletes notes + index for one student, building note paths from the index (no lessonNotes read)', async () => {
    const { deps, deletedChunks } = makeDeps({
      indexes: [rawIndex('stud-1', ['i1_l1', 'i1_l2'])],
    });
    const result = await runProgramNotesCleanup({ programId: PROGRAM_ID }, deps);
    expect(result).toEqual({ status: 'completed', notesDeleted: 2, indexesDeleted: 1 });
    expect(deletedPaths(deletedChunks)).toEqual([
      'students/stud-1/lessonNotes/i1_l1',
      'students/stud-1/lessonNotes/i1_l2',
      'students/stud-1/lessonNoteIndexes/prog-1',
    ]);
  });

  it('handles multiple students, one index read per student', async () => {
    const { deps, deletedChunks } = makeDeps({
      indexes: [rawIndex('stud-1', ['a']), rawIndex('stud-2', ['b', 'c'])],
    });
    const result = await runProgramNotesCleanup({ programId: PROGRAM_ID }, deps);
    expect(result).toEqual({ status: 'completed', notesDeleted: 3, indexesDeleted: 2 });
    const paths = deletedPaths(deletedChunks);
    expect(paths).toContain('students/stud-1/lessonNotes/a');
    expect(paths).toContain('students/stud-2/lessonNotes/b');
    expect(paths).toContain('students/stud-2/lessonNotes/c');
    expect(paths).toContain('students/stud-1/lessonNoteIndexes/prog-1');
    expect(paths).toContain('students/stud-2/lessonNoteIndexes/prog-1');
  });

  it('de-duplicates lessonIds before building deletes', async () => {
    const { deps, deletedChunks } = makeDeps({
      indexes: [rawIndex('stud-1', ['dup', 'dup', 'other'])],
    });
    const result = await runProgramNotesCleanup({ programId: PROGRAM_ID }, deps);
    expect(result.notesDeleted).toBe(2);
    expect(deletedPaths(deletedChunks).filter((p) => p.endsWith('/dup'))).toHaveLength(1);
  });

  it('chunks deletes at 400 and deletes notes before indexes', async () => {
    const many = Array.from({ length: 450 }, (_, i) => `l-${i}`);
    const { deps, deletedChunks } = makeDeps({ indexes: [rawIndex('stud-1', many)] });
    const result = await runProgramNotesCleanup({ programId: PROGRAM_ID }, deps);
    expect(result.notesDeleted).toBe(450);
    // 450 notes → chunks of 400 + 50; then 1 index chunk.
    expect(deletedChunks.map((c) => c.length)).toEqual([NOTE_CLEANUP_CHUNK_SIZE, 50, 1]);
    // Last chunk is the index (notes deleted before their index).
    expect(deletedChunks.at(-1)![0]!.segments).toEqual([
      'students',
      'stud-1',
      'lessonNoteIndexes',
      'prog-1',
    ]);
  });

  it('never reads lessonNotes documents — the deps expose no note-read port', async () => {
    // The dependency surface only queries lessonNoteIndexes and deletes refs;
    // there is deliberately no port to read a lessonNotes document or its
    // content, so the teacher path can never observe note content.
    const { deps } = makeDeps({ indexes: [rawIndex('stud-1', ['x'])] });
    expect(Object.keys(deps).sort()).toEqual([
      'callerUid',
      'deleteChunk',
      'getOwnerUid',
      'queryIndexesByProgram',
    ]);
  });

  it('is idempotent on retry (re-running with fewer/no indexes completes)', async () => {
    const first = makeDeps({ indexes: [rawIndex('stud-1', ['x'])] });
    await runProgramNotesCleanup({ programId: PROGRAM_ID }, first.deps);
    // Second run: indexes already deleted → query returns nothing → completes.
    const second = makeDeps({ indexes: [] });
    const result = await runProgramNotesCleanup({ programId: PROGRAM_ID }, second.deps);
    expect(result).toEqual({ status: 'completed', notesDeleted: 0, indexesDeleted: 0 });
  });

  it('returns only minimal counts — no uid, path, lessonId or content', async () => {
    const { deps } = makeDeps({ indexes: [rawIndex('stud-secret', ['secret-lesson'])] });
    const result = await runProgramNotesCleanup({ programId: PROGRAM_ID }, deps);
    const serialized = JSON.stringify(result);
    expect(Object.keys(result).sort()).toEqual(['indexesDeleted', 'notesDeleted', 'status']);
    expect(serialized).not.toContain('stud-secret');
    expect(serialized).not.toContain('secret-lesson');
    expect(serialized).not.toContain('students/');
  });
});

describe('runProgramNotesCleanup — fail-closed on malformed index', () => {
  const badCases: Array<[string, RawLessonNoteIndex]> = [
    ['path studentUid empty', rawIndex('', ['x'], { pathStudentUid: '' })],
    ['path programId mismatch', rawIndex('s', ['x'], { pathProgramId: 'other' })],
    [
      'data.studentUid mismatch',
      {
        pathStudentUid: 's',
        pathProgramId: PROGRAM_ID,
        data: { studentUid: 'evil', programId: PROGRAM_ID, lessonIds: ['x'] },
      },
    ],
    [
      'data.programId mismatch',
      {
        pathStudentUid: 's',
        pathProgramId: PROGRAM_ID,
        data: { studentUid: 's', programId: 'other', lessonIds: ['x'] },
      },
    ],
    [
      'lessonIds not an array',
      {
        pathStudentUid: 's',
        pathProgramId: PROGRAM_ID,
        data: { studentUid: 's', programId: PROGRAM_ID, lessonIds: 'x' },
      },
    ],
    ['lessonId not a non-empty string', rawIndex('s', ['ok', ''])],
    ['lessonId whitespace-only', rawIndex('s', ['ok', '   '])],
    ['lessonId non-string', rawIndex('s', ['ok', 123])],
    ['lessonId with a slash', rawIndex('s', ['ok', 'a/b'])],
    ['lessonId equal to "."', rawIndex('s', ['ok', '.'])],
    ['lessonId equal to ".."', rawIndex('s', ['ok', '..'])],
    ['pathStudentUid with a slash', rawIndex('s', ['x'], { pathStudentUid: 'a/b' })],
    [
      'too many lessonIds',
      rawIndex(
        's',
        Array.from({ length: 501 }, (_, i) => `l-${i}`),
      ),
    ],
  ];

  it.each(badCases)('rejects: %s — never deletes arbitrary paths', async (_label, index) => {
    const deleteChunk = vi.fn(async () => {});
    const { deps } = makeDeps({ indexes: [index], deleteChunk });
    await expect(runProgramNotesCleanup({ programId: PROGRAM_ID }, deps)).rejects.toMatchObject({
      code: 'malformed_index',
    });
    // A malformed index aborts before deleting anything.
    expect(deleteChunk).not.toHaveBeenCalled();
  });

  it('the malformed-index error message leaks no path or content', () => {
    try {
      validateIndex(rawIndex('stud-x', ['secret'], { pathProgramId: 'mismatch' }), PROGRAM_ID);
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(ProgramNotesCleanupError);
      const message = (err as ProgramNotesCleanupError).message;
      expect(message).not.toContain('stud-x');
      expect(message).not.toContain('secret');
      expect(message).not.toContain('students/');
    }
  });
});
