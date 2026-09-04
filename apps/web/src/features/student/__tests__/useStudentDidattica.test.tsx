import { StrictMode, type ReactNode } from 'react';
import { act, cleanup, fireEvent, renderHook, waitFor } from '@testing-library/react';
import type { Firestore } from 'firebase/firestore';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  StudentLesson,
  StudentLibraryResult,
  StudentProgram,
} from '../../repository/programs/studentLessonsService.js';
import { useStudentDidattica } from '../useStudentDidattica.js';

const mockLibrary = vi.fn();
const mockCourse = vi.fn();
vi.mock('../../repository/programs/studentLessonsService.js', () => ({
  loadStudentLibrary: (...args: unknown[]) => mockLibrary(...args),
  loadStudentCourseLessons: (...args: unknown[]) => mockCourse(...args),
}));
const db = {} as Firestore;
const A: StudentProgram = { id: 'a', title: 'Alfa', classIds: ['class-a'], activeImportId: 'i1' };
const B: StudentProgram = { ...A, id: 'b', title: 'Beta' };
const library = (programs = [A, B], classId = 'class-a'): StudentLibraryResult => ({
  status: 'ok',
  classId,
  programs,
});
const lesson = (id: string) => ({ id, content: id }) as StudentLesson;
let now = 100_000;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
async function ready() {
  const hook = renderHook(({ uid }) => useStudentDidattica(uid, db), {
    initialProps: { uid: 'student' },
  });
  await waitFor(() => expect(hook.result.current.library.status).toBe('ok'));
  return hook;
}
async function open(hook: Awaited<ReturnType<typeof ready>>, id = 'a') {
  act(() => hook.result.current.open(id));
  await waitFor(() => expect(hook.result.current.course.status).toBe('ok'));
}
function lessons(hook: Awaited<ReturnType<typeof ready>>) {
  const state = hook.result.current.course;
  return state.status === 'ok' ? state.lessons.map((l) => l.id) : [];
}
beforeEach(() => {
  vi.resetAllMocks();
  now = 100_000;
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  mockLibrary.mockResolvedValue(library());
  mockCourse.mockImplementation(async (p: StudentProgram) => [lesson(p.id)]);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('student metadata and last-course cache', () => {
  it('initial load and library refresh never request lesson projections', async () => {
    const hook = await ready();
    expect(mockLibrary).toHaveBeenCalledOnce();
    expect(mockLibrary).toHaveBeenCalledWith('student', db);
    expect(mockCourse).not.toHaveBeenCalled();
    await act(() => hook.result.current.refresh(true));
    expect(mockLibrary).toHaveBeenCalledTimes(2);
    expect(mockCourse).not.toHaveBeenCalled();
  });
  it('fetches only the opened course; reopening reuses it, but retains no second course', async () => {
    const hook = await ready();
    await open(hook);
    expect(mockCourse).toHaveBeenCalledWith(A, db);
    act(() => hook.result.current.back());
    await open(hook);
    expect(mockCourse).toHaveBeenCalledOnce();
    await open(hook, 'b');
    expect(lessons(hook)).toEqual(['b']);
    await open(hook);
    expect(mockCourse.mock.calls.map(([p]) => p.id)).toEqual(['a', 'b', 'a']);
  });
  it('coalesces rapid identical opens and ignores superseded course responses', async () => {
    const a = deferred<StudentLesson[]>();
    const b = deferred<StudentLesson[]>();
    mockCourse.mockImplementation((p: StudentProgram) => (p.id === 'a' ? a.promise : b.promise));
    const hook = await ready();
    act(() => {
      hook.result.current.open('a');
      hook.result.current.open('a');
    });
    expect(mockCourse).toHaveBeenCalledOnce();
    act(() => hook.result.current.open('b'));
    expect(mockCourse).toHaveBeenCalledTimes(2);
    await act(async () => b.resolve([lesson('new-b')]));
    await act(async () => a.resolve([lesson('late-a')]));
    expect(hook.result.current.program?.id).toBe('b');
    expect(lessons(hook)).toEqual(['new-b']);
    await open(hook, 'a');
    expect(mockCourse).toHaveBeenCalledTimes(3);
  });
  it('coalesces A/B/A while reads are pending', async () => {
    const a = deferred<StudentLesson[]>();
    const b = deferred<StudentLesson[]>();
    mockCourse.mockImplementation((p: StudentProgram) => (p.id === 'a' ? a.promise : b.promise));
    const hook = await ready();
    act(() => {
      hook.result.current.open('a');
      hook.result.current.open('b');
      hook.result.current.open('a');
    });
    expect(mockCourse).toHaveBeenCalledTimes(2);
    await act(async () => a.resolve([lesson('a')]));
    await act(async () => b.resolve([lesson('b')]));
    expect(lessons(hook)).toEqual(['a']);
  });
  it('throttles duplicate focus/visibility events and refreshes only the selected expired course', async () => {
    const hook = await ready();
    await open(hook);
    act(() => {
      fireEvent(window, new Event('focus'));
      fireEvent(document, new Event('visibilitychange'));
    });
    expect(mockLibrary).toHaveBeenCalledOnce();
    now += 60_000;
    act(() => {
      fireEvent(window, new Event('focus'));
      fireEvent(document, new Event('visibilitychange'));
    });
    await waitFor(() => expect(hook.result.current.refreshing).toBe(false));
    expect(mockLibrary).toHaveBeenCalledTimes(2);
    expect(mockCourse.mock.calls.map(([p]) => p.id)).toEqual(['a', 'a']);
  });
  it('opening after expiration revalidates metadata before loading; manual refresh bypasses TTL', async () => {
    const hook = await ready();
    await open(hook);
    act(() => hook.result.current.back());
    now += 60_001;
    await open(hook);
    expect(mockLibrary).toHaveBeenCalledTimes(2);
    expect(mockCourse).toHaveBeenCalledTimes(2);
    await act(() => hook.result.current.refresh(true));
    expect(mockLibrary).toHaveBeenCalledTimes(3);
    expect(mockCourse).toHaveBeenCalledTimes(3);
  });
  it('does not refetch a still-fresh course when metadata reaches its TTL', async () => {
    const hook = await ready();
    now += 59_000;
    await open(hook);
    now += 1_001;
    await act(() => hook.result.current.refresh());
    expect(mockLibrary).toHaveBeenCalledTimes(2);
    expect(mockCourse).toHaveBeenCalledOnce();
  });
  it('switches to B immediately while automatic refresh still awaits A contents', async () => {
    const hook = await ready();
    await open(hook);
    const slow = deferred<StudentLesson[]>();
    mockCourse.mockImplementation((p: StudentProgram) =>
      p.id === 'a' ? slow.promise : Promise.resolve([lesson('b')]),
    );
    now += 60_001;
    act(() => {
      void hook.result.current.refresh();
    });
    await waitFor(() => expect(mockCourse).toHaveBeenCalledTimes(2));
    await open(hook, 'b');
    expect(lessons(hook)).toEqual(['b']);
    await act(async () => slow.resolve([lesson('old-a')]));
    expect(lessons(hook)).toEqual(['b']);
  });
});

describe('invalidation and failed-read recovery', () => {
  it('shows errors without fake empty lessons and retries a failed course manually', async () => {
    mockCourse.mockRejectedValueOnce(new Error('offline'));
    const hook = await ready();
    act(() => hook.result.current.open('a'));
    await waitFor(() => expect(hook.result.current.course.status).toBe('error'));
    await act(() => hook.result.current.refresh(true));
    expect(lessons(hook)).toEqual(['a']);
    expect(mockCourse).toHaveBeenCalledTimes(2);
  });
  it('retries failed metadata explicitly without an automatic retry storm', async () => {
    mockLibrary.mockRejectedValueOnce(new Error('offline'));
    const hook = renderHook(() => useStudentDidattica('student', db));
    await waitFor(() => expect(hook.result.current.library.status).toBe('error'));
    act(() => fireEvent(window, new Event('focus')));
    expect(mockLibrary).toHaveBeenCalledOnce();
    await act(() => hook.result.current.refresh(true));
    expect(hook.result.current.library.status).toBe('ok');
  });
  it('isolates changed import and ignores an old response after invalidation', async () => {
    const old = deferred<StudentLesson[]>();
    mockCourse.mockReturnValueOnce(old.promise);
    const hook = await ready();
    act(() => hook.result.current.open('a'));
    mockLibrary.mockResolvedValue(library([{ ...A, activeImportId: 'i2' }, B]));
    await act(() => hook.result.current.refresh(true));
    expect(mockCourse.mock.calls.map(([p]) => p.activeImportId)).toEqual(['i1', 'i2']);
    await act(async () => old.resolve([lesson('stale-import')]));
    expect(lessons(hook)).toEqual(['a']);
  });
  it('invalidates a cached import even while the library is open', async () => {
    const hook = await ready();
    await open(hook);
    act(() => hook.result.current.back());
    mockLibrary.mockResolvedValue(library([{ ...A, activeImportId: 'i2' }, B]));
    await act(() => hook.result.current.refresh(true));
    expect(mockCourse).toHaveBeenCalledOnce();
    await open(hook);
    expect(mockCourse.mock.calls[1]![0].activeImportId).toBe('i2');
  });
  it('isolates class changes, course revocation and no-class results', async () => {
    const hook = await ready();
    await open(hook);
    const context = hook.result.current.contextVersion;
    mockLibrary.mockResolvedValue(library([A, B], 'class-b'));
    await act(() => hook.result.current.refresh(true));
    expect(hook.result.current.contextVersion).toBeGreaterThan(context);
    expect(mockCourse).toHaveBeenCalledTimes(2);
    mockLibrary.mockResolvedValue(library([B], 'class-b'));
    await act(() => hook.result.current.refresh(true));
    expect(hook.result.current.program).toBeNull();
    expect(hook.result.current.course.status).toBe('idle');
    mockLibrary.mockResolvedValue({ status: 'no-class' });
    await act(() => hook.result.current.refresh(true));
    expect(hook.result.current.library.status).toBe('no-class');
  });
  it('preserves note identity on title/unrelated-course changes and transient errors, not access failures', async () => {
    const hook = await ready();
    await open(hook);
    const context = hook.result.current.contextVersion;
    mockLibrary.mockResolvedValue(library([{ ...A, title: 'Renamed' }]));
    await act(() => hook.result.current.refresh(true));
    expect(hook.result.current.contextVersion).toBe(context);
    mockLibrary.mockRejectedValueOnce(new Error('offline'));
    await act(() => hook.result.current.refresh(true));
    expect(hook.result.current.course.status).toBe('error');
    expect(hook.result.current.contextVersion).toBe(context);
    mockLibrary.mockRejectedValueOnce({ code: 'permission-denied' });
    await act(() => hook.result.current.refresh(true));
    expect(hook.result.current.contextVersion).toBeGreaterThan(context);
    expect(hook.result.current.library.status).toBe('error');
    expect(lessons(hook)).toEqual([]);
  });
  it('clears cached content and note identity on course permission denial', async () => {
    const hook = await ready();
    await open(hook);
    const context = hook.result.current.contextVersion;
    mockCourse.mockRejectedValueOnce({ code: 'permission-denied' });
    await act(() => hook.result.current.refresh(true));
    expect(hook.result.current.contextVersion).toBeGreaterThan(context);
    expect(hook.result.current.course.status).toBe('error');
    await open(hook);
    expect(mockCourse).toHaveBeenCalledTimes(3);
  });
  it('does not restore old account responses after uid changes or unmount', async () => {
    const old = deferred<StudentLesson[]>();
    mockCourse.mockReturnValueOnce(old.promise);
    const hook = await ready();
    act(() => hook.result.current.open('a'));
    hook.rerender({ uid: 'other-student' });
    await waitFor(() => expect(mockLibrary).toHaveBeenCalledWith('other-student', db));
    await act(async () => old.resolve([lesson('old-account')]));
    expect(hook.result.current.program).toBeNull();
    expect(lessons(hook)).toEqual([]);
    hook.unmount();
    act(() => fireEvent(window, new Event('focus')));
    expect(mockLibrary).toHaveBeenCalledTimes(2);
    const fresh = await ready();
    await open(fresh);
    expect(mockCourse).toHaveBeenCalledTimes(2);
  });
  it('handles StrictMode cleanup/remount and late metadata without clearing new refresh state', async () => {
    const old = deferred<StudentLibraryResult>();
    const current = deferred<StudentLibraryResult>();
    mockLibrary.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
    const hook = renderHook(() => useStudentDidattica('student', db), {
      wrapper: ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>,
    });
    await act(async () => old.resolve(library([B])));
    expect(hook.result.current.library.status).toBe('loading');
    expect(hook.result.current.refreshing).toBe(true);
    await act(async () => current.resolve(library([A])));
    expect(hook.result.current.library).toEqual(library([A]));
    expect(hook.result.current.refreshing).toBe(false);
  });
});
