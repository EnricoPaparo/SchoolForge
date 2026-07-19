import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetDoc = vi.fn();
const mockSetDoc = vi.fn();
const mockUpdateDoc = vi.fn();
const mockDeleteDoc = vi.fn();
const mockGetDocs = vi.fn();
const mockBatchSet = vi.fn();
const mockBatchDelete = vi.fn();
const mockBatchCommit = vi.fn();

vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...segments: string[]) => ({ __path: segments.join('/') }),
  collection: (_db: unknown, ...segments: string[]) => ({ __path: segments.join('/') }),
  where: (...args: unknown[]) => ({ __where: args }),
  query: (...args: unknown[]) => ({ __query: args }),
  getDoc: (...args: unknown[]) => mockGetDoc(...args),
  getDocs: (...args: unknown[]) => mockGetDocs(...args),
  setDoc: (...args: unknown[]) => mockSetDoc(...args),
  updateDoc: (...args: unknown[]) => mockUpdateDoc(...args),
  deleteDoc: (...args: unknown[]) => mockDeleteDoc(...args),
  serverTimestamp: () => ({ __serverTimestamp: true }),
  arrayUnion: (...values: unknown[]) => ({ __arrayUnion: values }),
  arrayRemove: (...values: unknown[]) => ({ __arrayRemove: values }),
  writeBatch: () => ({
    set: (...args: unknown[]) => mockBatchSet(...args),
    delete: (...args: unknown[]) => mockBatchDelete(...args),
    commit: (...args: unknown[]) => mockBatchCommit(...args),
  }),
}));

import {
  STUDENT_LESSON_NOTE_MAX_LENGTH,
  StudentLessonNoteError,
  createStudentLessonNote,
  deleteStudentLessonNote,
  loadStudentLessonNoteIndex,
  loadStudentLessonNote,
  updateStudentLessonNote,
} from '../studentLessonNotesService.js';
import type { StudentLessonNoteIdentity } from '../studentLessonNotesService.js';
import type { Firestore } from 'firebase/firestore';

const fakeDb = {} as Firestore;
const STUDENT_UID = 'student-uid';
const PUBLIC_LESSON_ID = 'i1_lesson-1';
const EXPECTED_PATH = `students/${STUDENT_UID}/lessonNotes/${PUBLIC_LESSON_ID}`;

const identity: StudentLessonNoteIdentity = {
  studentUid: STUDENT_UID,
  publicLessonId: PUBLIC_LESSON_ID,
  programId: 'p1',
  importId: 'i1',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('deterministic path', () => {
  it('load/create/update/delete all target students/{uid}/lessonNotes/{publicLessonId}', async () => {
    mockGetDoc.mockResolvedValue({ exists: () => false });
    mockSetDoc.mockResolvedValue(undefined);
    mockUpdateDoc.mockResolvedValue(undefined);
    mockDeleteDoc.mockResolvedValue(undefined);
    mockBatchCommit.mockResolvedValue(undefined);

    await loadStudentLessonNote(STUDENT_UID, PUBLIC_LESSON_ID, fakeDb);
    await createStudentLessonNote(identity, 'x', fakeDb);
    await updateStudentLessonNote(STUDENT_UID, PUBLIC_LESSON_ID, 'y', fakeDb);
    await deleteStudentLessonNote(identity, fakeDb);

    expect((mockGetDoc.mock.calls[0][0] as { __path: string }).__path).toBe(EXPECTED_PATH);
    expect((mockUpdateDoc.mock.calls[0][0] as { __path: string }).__path).toBe(EXPECTED_PATH);
    expect(mockBatchSet).toHaveBeenCalled();
    expect(mockBatchDelete).toHaveBeenCalledWith({ __path: EXPECTED_PATH });
  });
});

describe('loadStudentLessonNote', () => {
  it('resolves to a typed missing state (not an error) when the document is absent', async () => {
    mockGetDoc.mockResolvedValue({ exists: () => false });

    const result = await loadStudentLessonNote(STUDENT_UID, PUBLIC_LESSON_ID, fakeDb);

    expect(result).toEqual({ state: 'missing' });
  });

  it('normalizes a present document into an existing state', async () => {
    mockGetDoc.mockResolvedValue({
      exists: () => true,
      data: () => ({
        studentUid: STUDENT_UID,
        publicLessonId: PUBLIC_LESSON_ID,
        programId: 'p1',
        importId: 'i1',
        content: 'appunti',
        createdAt: { seconds: 1 },
        updatedAt: { seconds: 2 },
      }),
    });

    const result = await loadStudentLessonNote(STUDENT_UID, PUBLIC_LESSON_ID, fakeDb);

    expect(result).toEqual({
      state: 'existing',
      note: {
        studentUid: STUDENT_UID,
        publicLessonId: PUBLIC_LESSON_ID,
        programId: 'p1',
        importId: 'i1',
        content: 'appunti',
        createdAt: { seconds: 1 },
        updatedAt: { seconds: 2 },
      },
    });
  });

  it('does a single getDoc and no other Firestore call', async () => {
    mockGetDoc.mockResolvedValue({ exists: () => false });

    await loadStudentLessonNote(STUDENT_UID, PUBLIC_LESSON_ID, fakeDb);

    expect(mockGetDoc).toHaveBeenCalledOnce();
    expect(mockSetDoc).not.toHaveBeenCalled();
    expect(mockUpdateDoc).not.toHaveBeenCalled();
    expect(mockDeleteDoc).not.toHaveBeenCalled();
  });

  it('treats a present document with a non-string content as unavailable (fail-closed)', async () => {
    mockGetDoc.mockResolvedValue({
      exists: () => true,
      data: () => ({ content: 123 }),
    });

    await expect(
      loadStudentLessonNote(STUDENT_UID, PUBLIC_LESSON_ID, fakeDb),
    ).rejects.toMatchObject({ code: 'unavailable' });
  });

  it('sanitizes a raw Firebase error into a typed error without leaking the message', async () => {
    mockGetDoc.mockRejectedValue(
      Object.assign(new Error('FIRESTORE INTERNAL raw detail'), { code: 'permission-denied' }),
    );

    const error = (await loadStudentLessonNote(STUDENT_UID, PUBLIC_LESSON_ID, fakeDb).catch(
      (e) => e,
    )) as StudentLessonNoteError;

    expect(error).toBeInstanceOf(StudentLessonNoteError);
    expect(error.code).toBe('permission-denied');
    expect(error.message).not.toContain('raw detail');
  });
});

describe('createStudentLessonNote', () => {
  it('atomically writes the note and adds its id to the course index', async () => {
    mockBatchCommit.mockResolvedValue(undefined);

    await createStudentLessonNote(identity, 'appunti', fakeDb);

    expect(mockBatchCommit).toHaveBeenCalledOnce();
    expect(mockBatchSet).toHaveBeenCalledTimes(2);
    expect(mockGetDoc).not.toHaveBeenCalled();
    const payload = mockBatchSet.mock.calls[0][1] as Record<string, unknown>;
    expect(payload).toEqual({
      studentUid: STUDENT_UID,
      publicLessonId: PUBLIC_LESSON_ID,
      programId: 'p1',
      importId: 'i1',
      content: 'appunti',
      createdAt: { __serverTimestamp: true },
      updatedAt: { __serverTimestamp: true },
    });
    expect(payload.createdAt).toEqual(payload.updatedAt);
  });

  it('rejects content over the 20 000 limit before any write', async () => {
    await expect(
      createStudentLessonNote(identity, 'x'.repeat(STUDENT_LESSON_NOTE_MAX_LENGTH + 1), fakeDb),
    ).rejects.toMatchObject({ code: 'content-too-long' });
    expect(mockBatchCommit).not.toHaveBeenCalled();
  });

  it('allows content of exactly 20 000 characters', async () => {
    mockBatchCommit.mockResolvedValue(undefined);

    await createStudentLessonNote(identity, 'x'.repeat(STUDENT_LESSON_NOTE_MAX_LENGTH), fakeDb);

    expect(mockBatchCommit).toHaveBeenCalledOnce();
  });
});

describe('updateStudentLessonNote', () => {
  it('updates only content and updatedAt, never identity or createdAt, in a single updateDoc with no extra read', async () => {
    mockUpdateDoc.mockResolvedValue(undefined);

    await updateStudentLessonNote(STUDENT_UID, PUBLIC_LESSON_ID, 'nuovo', fakeDb);

    expect(mockUpdateDoc).toHaveBeenCalledOnce();
    expect(mockGetDoc).not.toHaveBeenCalled();
    const payload = mockUpdateDoc.mock.calls[0][1] as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual(['content', 'updatedAt']);
    expect(payload.content).toBe('nuovo');
    expect(payload.updatedAt).toEqual({ __serverTimestamp: true });
  });

  it('rejects content over the limit before any write', async () => {
    await expect(
      updateStudentLessonNote(
        STUDENT_UID,
        PUBLIC_LESSON_ID,
        'x'.repeat(STUDENT_LESSON_NOTE_MAX_LENGTH + 1),
        fakeDb,
      ),
    ).rejects.toMatchObject({ code: 'content-too-long' });
    expect(mockUpdateDoc).not.toHaveBeenCalled();
  });

  it('sanitizes a raw Firebase write error', async () => {
    mockUpdateDoc.mockRejectedValue(
      Object.assign(new Error('raw firebase failure'), { code: 'unavailable' }),
    );

    const error = (await updateStudentLessonNote(STUDENT_UID, PUBLIC_LESSON_ID, 'x', fakeDb).catch(
      (e) => e,
    )) as StudentLessonNoteError;

    expect(error).toBeInstanceOf(StudentLessonNoteError);
    expect(error.code).toBe('unavailable');
    expect(error.message).not.toContain('raw firebase failure');
  });
});

describe('deleteStudentLessonNote', () => {
  it('atomically deletes the note and removes its id from the index', async () => {
    mockBatchCommit.mockResolvedValue(undefined);

    await deleteStudentLessonNote(identity, fakeDb);

    expect(mockBatchDelete).toHaveBeenCalledWith({ __path: EXPECTED_PATH });
    expect(mockBatchSet).toHaveBeenCalledOnce();
    expect(mockBatchCommit).toHaveBeenCalledOnce();
    expect(mockGetDoc).not.toHaveBeenCalled();
    expect(mockUpdateDoc).not.toHaveBeenCalled();
  });
});

describe('loadStudentLessonNoteIndex', () => {
  const indexIdentity = { studentUid: STUDENT_UID, programId: 'p1', importId: 'i1' };

  it('uses one read when a valid current-import index exists and removes duplicates in memory', async () => {
    mockGetDoc.mockResolvedValue({
      exists: () => true,
      data: () => ({ ...indexIdentity, lessonIds: [PUBLIC_LESSON_ID, PUBLIC_LESSON_ID] }),
    });

    await expect(loadStudentLessonNoteIndex(indexIdentity, fakeDb)).resolves.toEqual({
      lessonIds: [PUBLIC_LESSON_ID],
      bootstrapped: false,
    });
    expect(mockGetDoc).toHaveBeenCalledOnce();
    expect(mockGetDocs).not.toHaveBeenCalled();
  });

  it('bootstraps a missing index from only trim-non-empty query results', async () => {
    mockGetDoc.mockResolvedValue({ exists: () => false });
    mockGetDocs.mockResolvedValue({
      docs: [
        { id: PUBLIC_LESSON_ID, data: () => ({ content: 'nota' }) },
        { id: 'empty', data: () => ({ content: '  ' }) },
      ],
    });
    mockSetDoc.mockResolvedValue(undefined);

    await expect(loadStudentLessonNoteIndex(indexIdentity, fakeDb)).resolves.toEqual({
      lessonIds: [PUBLIC_LESSON_ID],
      bootstrapped: true,
    });
    expect(mockGetDocs).toHaveBeenCalledOnce();
    expect(mockGetDocs.mock.calls[0][0]).toEqual({
      __query: [
        { __path: `students/${STUDENT_UID}/lessonNotes` },
        { __where: ['programId', '==', 'p1'] },
        { __where: ['importId', '==', 'i1'] },
      ],
    });
    expect(mockSetDoc).toHaveBeenCalledOnce();
  });
});
