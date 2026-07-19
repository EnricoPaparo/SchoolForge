import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockLoad = vi.fn();
const mockCreate = vi.fn();
const mockUpdate = vi.fn();
const mockDelete = vi.fn();

vi.mock('../studentLessonNotesService.js', async () => {
  const actual = (await vi.importActual('../studentLessonNotesService.js')) as Record<
    string,
    unknown
  >;
  return {
    ...actual,
    loadStudentLessonNote: (...a: unknown[]) => mockLoad(...a),
    createStudentLessonNote: (...a: unknown[]) => mockCreate(...a),
    updateStudentLessonNote: (...a: unknown[]) => mockUpdate(...a),
    deleteStudentLessonNote: (...a: unknown[]) => mockDelete(...a),
  };
});

import { useLessonNotes, NOTE_AUTOSAVE_DELAY_MS } from '../useLessonNotes.js';
import { StudentLessonNoteError } from '../studentLessonNotesService.js';
import type { Firestore } from 'firebase/firestore';

const db = {} as Firestore;
const identity = {
  studentUid: 'student-uid',
  publicLessonId: 'i1_lesson-1',
  programId: 'p1',
  importId: 'i1',
};

beforeEach(() => {
  vi.clearAllMocks();
  mockLoad.mockResolvedValue({ state: 'missing' });
  mockCreate.mockResolvedValue(undefined);
  mockUpdate.mockResolvedValue(undefined);
  mockDelete.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useLessonNotes — reads', () => {
  it('does exactly one getDoc on first open and none on reopen in the same session', async () => {
    const { result } = renderHook(() => useLessonNotes(db));
    act(() => result.current.open(identity));
    await waitFor(() => expect(result.current.current?.loadState).toBe('loaded'));
    expect(mockLoad).toHaveBeenCalledTimes(1);

    act(() => result.current.close());
    act(() => result.current.open(identity));
    await waitFor(() => expect(result.current.current?.loadState).toBe('loaded'));
    expect(mockLoad).toHaveBeenCalledTimes(1); // no second read
  });

  it('never uses a listener/poll — a single load call, no interval', async () => {
    const { result } = renderHook(() => useLessonNotes(db));
    act(() => result.current.open(identity));
    await waitFor(() => expect(result.current.current?.loadState).toBe('loaded'));
    expect(mockLoad).toHaveBeenCalledTimes(1);
  });

  it('retries a failed load exactly once without duplicating concurrent reads', async () => {
    mockLoad
      .mockRejectedValueOnce(new StudentLessonNoteError('unavailable', 'x'))
      .mockResolvedValueOnce({ state: 'missing' });
    const { result } = renderHook(() => useLessonNotes(db));
    act(() => result.current.open(identity));
    await waitFor(() => expect(result.current.current?.loadState).toBe('error'));

    act(() => {
      result.current.retryLoad();
      result.current.retryLoad();
    });
    await waitFor(() => expect(result.current.current?.loadState).toBe('loaded'));
    expect(mockLoad).toHaveBeenCalledTimes(2);
  });
});

describe('useLessonNotes — saves', () => {
  it('creates on first non-empty note', async () => {
    const { result } = renderHook(() => useLessonNotes(db));
    act(() => result.current.open(identity));
    await waitFor(() => expect(result.current.current?.loadState).toBe('loaded'));

    act(() => result.current.setDraft('ciao'));
    await act(async () => {
      result.current.saveNow();
    });
    await waitFor(() => expect(result.current.current?.dirty).toBe(false));
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockCreate.mock.calls[0][1]).toBe('ciao');
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('updates an existing note', async () => {
    mockLoad.mockResolvedValue({
      state: 'existing',
      note: { ...identity, content: 'vecchio', createdAt: null, updatedAt: null },
    });
    const { result } = renderHook(() => useLessonNotes(db));
    act(() => result.current.open(identity));
    await waitFor(() => expect(result.current.current?.draft).toBe('vecchio'));

    act(() => result.current.setDraft('nuovo'));
    await act(async () => {
      result.current.saveNow();
    });
    await waitFor(() => expect(result.current.current?.dirty).toBe(false));
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdate.mock.calls[0][2]).toBe('nuovo');
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('does not write when the draft equals the baseline', async () => {
    mockLoad.mockResolvedValue({
      state: 'existing',
      note: { ...identity, content: 'uguale', createdAt: null, updatedAt: null },
    });
    const { result } = renderHook(() => useLessonNotes(db));
    act(() => result.current.open(identity));
    await waitFor(() => expect(result.current.current?.draft).toBe('uguale'));

    act(() => result.current.setDraft('uguale'));
    await act(async () => {
      result.current.saveNow();
    });
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('does not write for a never-persisted, empty note', async () => {
    const { result } = renderHook(() => useLessonNotes(db));
    act(() => result.current.open(identity));
    await waitFor(() => expect(result.current.current?.loadState).toBe('loaded'));

    act(() => result.current.setDraft(''));
    await act(async () => {
      result.current.saveNow();
    });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('saves via the 15s idle debounce, and a later edit resets the timer', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useLessonNotes(db));
    act(() => result.current.open(identity));
    await act(async () => {
      await Promise.resolve();
    });

    act(() => result.current.setDraft('a'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(NOTE_AUTOSAVE_DELAY_MS - 1000);
    });
    expect(mockCreate).not.toHaveBeenCalled(); // not yet

    act(() => result.current.setDraft('ab')); // resets the timer
    await act(async () => {
      await vi.advanceTimersByTimeAsync(NOTE_AUTOSAVE_DELAY_MS - 1000);
    });
    expect(mockCreate).not.toHaveBeenCalled(); // still not — timer was reset

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockCreate.mock.calls[0][1]).toBe('ab');
  });

  it('queues one follow-up write when the draft changes during an in-flight write', async () => {
    let resolveCreate: () => void = () => {};
    mockCreate.mockImplementation(
      () =>
        new Promise<void>((res) => {
          resolveCreate = res;
        }),
    );
    const { result } = renderHook(() => useLessonNotes(db));
    act(() => result.current.open(identity));
    await waitFor(() => expect(result.current.current?.loadState).toBe('loaded'));

    act(() => result.current.setDraft('one'));
    act(() => result.current.saveNow()); // starts the write (sends "one")
    expect(result.current.current?.saveState).toBe('saving');

    act(() => result.current.setDraft('one-two')); // change during the write
    act(() => result.current.saveNow()); // queued — still only one in flight
    expect(mockCreate).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveCreate();
      await Promise.resolve();
    });
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
    expect(mockUpdate.mock.calls[0][2]).toBe('one-two');
    await waitFor(() => expect(result.current.current?.dirty).toBe(false));
    expect(result.current.current?.draft).toBe('one-two');
  });

  it('does not lose the autosave intent when its timer fires during a slow write', async () => {
    vi.useFakeTimers();
    let resolveCreate: () => void = () => {};
    mockCreate.mockImplementation(
      () =>
        new Promise<void>((res) => {
          resolveCreate = res;
        }),
    );
    const { result } = renderHook(() => useLessonNotes(db));
    act(() => result.current.open(identity));
    await act(async () => Promise.resolve());

    act(() => result.current.setDraft('prima'));
    act(() => result.current.saveNow());
    act(() => result.current.setDraft('ultima'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(NOTE_AUTOSAVE_DELAY_MS);
    });
    expect(mockCreate).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveCreate();
      await Promise.resolve();
    });
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdate.mock.calls[0][2]).toBe('ultima');
  });

  it('preserves the draft and stays dirty after a save error', async () => {
    mockCreate.mockRejectedValue(new StudentLessonNoteError('unavailable', 'x'));
    const { result } = renderHook(() => useLessonNotes(db));
    act(() => result.current.open(identity));
    await waitFor(() => expect(result.current.current?.loadState).toBe('loaded'));

    act(() => result.current.setDraft('testo'));
    await act(async () => {
      result.current.saveNow();
    });
    await waitFor(() => expect(result.current.current?.saveState).toBe('error'));
    expect(result.current.current?.draft).toBe('testo');
    expect(result.current.current?.dirty).toBe(true);
    expect(result.current.current?.errorCode).toBe('unavailable');
  });
});

describe('useLessonNotes — delete', () => {
  it('resets the cache to empty/clean without reloading', async () => {
    mockLoad.mockResolvedValue({
      state: 'existing',
      note: { ...identity, content: 'x', createdAt: null, updatedAt: null },
    });
    const { result } = renderHook(() => useLessonNotes(db));
    act(() => result.current.open(identity));
    await waitFor(() => expect(result.current.current?.exists).toBe(true));

    await act(async () => {
      await result.current.remove();
    });
    expect(mockDelete).toHaveBeenCalledTimes(1);
    expect(result.current.current?.exists).toBe(false);
    expect(result.current.current?.draft).toBe('');
    expect(result.current.current?.dirty).toBe(false);
    expect(mockLoad).toHaveBeenCalledTimes(1); // no reload
  });

  it('preserves local text on a failed delete', async () => {
    mockLoad.mockResolvedValue({
      state: 'existing',
      note: { ...identity, content: 'importante', createdAt: null, updatedAt: null },
    });
    mockDelete.mockRejectedValue(new StudentLessonNoteError('unavailable', 'x'));
    const { result } = renderHook(() => useLessonNotes(db));
    act(() => result.current.open(identity));
    await waitFor(() => expect(result.current.current?.exists).toBe(true));

    await act(async () => {
      await result.current.remove();
    });
    expect(result.current.current?.draft).toBe('importante');
    expect(result.current.current?.exists).toBe(true);
    expect(result.current.current?.saveState).toBe('error');
  });
});

describe('useLessonNotes — dirty tracking', () => {
  it('reports dirty only when the draft diverges from the baseline', async () => {
    const { result } = renderHook(() => useLessonNotes(db));
    act(() => result.current.open(identity));
    await waitFor(() => expect(result.current.current?.loadState).toBe('loaded'));
    expect(result.current.isDirty(identity.publicLessonId)).toBe(false);
    act(() => result.current.setDraft('x'));
    expect(result.current.isDirty(identity.publicLessonId)).toBe(true);
  });

  it('discardAndClose restores the persisted baseline before reopening', async () => {
    mockLoad.mockResolvedValue({
      state: 'existing',
      note: { ...identity, content: 'salvato', createdAt: null, updatedAt: null },
    });
    const { result } = renderHook(() => useLessonNotes(db));
    act(() => result.current.open(identity));
    await waitFor(() => expect(result.current.current?.draft).toBe('salvato'));
    act(() => result.current.setDraft('da scartare'));

    act(() => expect(result.current.discardAndClose()).toBe(true));
    act(() => result.current.open(identity));
    expect(result.current.current?.draft).toBe('salvato');
    expect(result.current.current?.dirty).toBe(false);
    expect(mockLoad).toHaveBeenCalledTimes(1);
  });
});
