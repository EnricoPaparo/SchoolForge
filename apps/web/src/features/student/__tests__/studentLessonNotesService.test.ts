import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetDoc = vi.fn();
const mockSetDoc = vi.fn();
const mockUpdateDoc = vi.fn();
const mockDeleteDoc = vi.fn();

vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...segments: string[]) => ({ __path: segments.join('/') }),
  getDoc: (...args: unknown[]) => mockGetDoc(...args),
  setDoc: (...args: unknown[]) => mockSetDoc(...args),
  updateDoc: (...args: unknown[]) => mockUpdateDoc(...args),
  deleteDoc: (...args: unknown[]) => mockDeleteDoc(...args),
  serverTimestamp: () => ({ __serverTimestamp: true }),
}));

import {
  STUDENT_LESSON_NOTE_MAX_LENGTH,
  StudentLessonNoteError,
  createStudentLessonNote,
  deleteStudentLessonNote,
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

    await loadStudentLessonNote(STUDENT_UID, PUBLIC_LESSON_ID, fakeDb);
    await createStudentLessonNote(identity, 'x', fakeDb);
    await updateStudentLessonNote(STUDENT_UID, PUBLIC_LESSON_ID, 'y', fakeDb);
    await deleteStudentLessonNote(STUDENT_UID, PUBLIC_LESSON_ID, fakeDb);

    for (const mock of [mockGetDoc, mockSetDoc, mockUpdateDoc, mockDeleteDoc]) {
      expect((mock.mock.calls[0][0] as { __path: string }).__path).toBe(EXPECTED_PATH);
    }
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
  it('writes the full identity with createdAt == updatedAt == serverTimestamp in a single setDoc, no extra read', async () => {
    mockSetDoc.mockResolvedValue(undefined);

    await createStudentLessonNote(identity, 'appunti', fakeDb);

    expect(mockSetDoc).toHaveBeenCalledOnce();
    expect(mockGetDoc).not.toHaveBeenCalled();
    const payload = mockSetDoc.mock.calls[0][1] as Record<string, unknown>;
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
    expect(mockSetDoc).not.toHaveBeenCalled();
  });

  it('allows content of exactly 20 000 characters', async () => {
    mockSetDoc.mockResolvedValue(undefined);

    await createStudentLessonNote(identity, 'x'.repeat(STUDENT_LESSON_NOTE_MAX_LENGTH), fakeDb);

    expect(mockSetDoc).toHaveBeenCalledOnce();
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
  it('deletes only the note document in a single deleteDoc, touching nothing else', async () => {
    mockDeleteDoc.mockResolvedValue(undefined);

    await deleteStudentLessonNote(STUDENT_UID, PUBLIC_LESSON_ID, fakeDb);

    expect(mockDeleteDoc).toHaveBeenCalledOnce();
    expect(mockGetDoc).not.toHaveBeenCalled();
    expect(mockSetDoc).not.toHaveBeenCalled();
    expect(mockUpdateDoc).not.toHaveBeenCalled();
  });
});
