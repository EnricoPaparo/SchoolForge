import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockLoadLessons = vi.fn();
const mockLoadNote = vi.fn();
const mockLoadNoteIndex = vi.fn();
const mockCreateNote = vi.fn();
const mockDeleteNote = vi.fn();
let mockUid: string | null = 'student-uid';

vi.mock('../../../lib/firebase.js', () => ({ db: {}, storage: {}, functions: {} }));
vi.mock('../../../lib/auth.js', () => ({
  useAuth: () => ({ user: mockUid ? { uid: mockUid } : null, loading: false }),
}));
vi.mock('../../repository/programs/studentLessonsService.js', () => ({
  loadStudentLibrary: async (...args: unknown[]) => {
    const result = await mockLoadLessons(...args);
    if (result.status !== 'ok') return result;
    return { status: 'ok', classId: 'class-a', programs: result.programs };
  },
  loadStudentCourseLessons: async (program: { id: string }) => {
    const result = await mockLoadLessons.getMockImplementation()?.();
    return result.lessonsByProgram[program.id] ?? [];
  },
}));
vi.mock('../studentLessonNotesService.js', async () => {
  const actual = (await vi.importActual('../studentLessonNotesService.js')) as Record<
    string,
    unknown
  >;
  return {
    ...actual,
    loadStudentLessonNote: (...a: unknown[]) => mockLoadNote(...a),
    loadStudentLessonNoteIndex: (...a: unknown[]) => mockLoadNoteIndex(...a),
    createStudentLessonNote: (...a: unknown[]) => mockCreateNote(...a),
    updateStudentLessonNote: vi.fn().mockResolvedValue(undefined),
    deleteStudentLessonNote: (...a: unknown[]) => mockDeleteNote(...a),
  };
});

import { StudentDidatticaView } from '../StudentDidatticaView.js';

const LESSON = {
  id: 'i1_lesson-1',
  ownerUid: 'owner',
  programId: 'p1',
  importId: 'i1',
  udaId: 'uda-01',
  udaDir: 'uda-01-reti',
  path: 'x',
  filename: 'lezione-001.md',
  contentPath: 'c',
  createdAt: null,
  content: 'Corpo lezione',
  titolo: 'Introduzione alle reti',
  sottotitolo: null,
  difficolta: null,
  concettiChiave: [],
  obiettivi: [],
  order: 0,
};

function setMatchMedia(isMobile: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: isMobile,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
      onchange: null,
    }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUid = 'student-uid';
  setMatchMedia(false);
  mockLoadNote.mockResolvedValue({ state: 'missing' });
  mockLoadNoteIndex.mockResolvedValue({ lessonIds: [], bootstrapped: false });
  mockCreateNote.mockResolvedValue(undefined);
  mockDeleteNote.mockResolvedValue(undefined);
  mockLoadLessons.mockResolvedValue({
    status: 'ok',
    programs: [{ id: 'p1', title: 'Informatica', classIds: ['class-a'], activeImportId: 'i1' }],
    lessonsByProgram: { p1: [LESSON] },
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function openCourseAndSelectLesson() {
  fireEvent.click(await screen.findByRole('button', { name: 'Apri il corso Informatica' }));
  // Course overview: no lesson selected yet.
  expect(screen.queryByRole('button', { name: 'Appunti' })).toBeNull();
  // Expand the UDA from the sidebar tree (first match — sidebar precedes overview).
  const udaButtons = await screen.findAllByRole('button', { name: /Reti/i });
  fireEvent.click(udaButtons[0]!);
  // Pick the lesson (sidebar lesson tree entry).
  const lessonButtons = await screen.findAllByText('Introduzione alle reti');
  fireEvent.click(lessonButtons[0]!);
}

describe('StudentDidatticaView — Appunti entry point', () => {
  it('keeps a dirty draft across successful and offline automatic refreshes, including recovery', async () => {
    let now = 100_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    render(<StudentDidatticaView />);
    await openCourseAndSelectLesson();
    fireEvent.click(await screen.findByRole('button', { name: 'Appunti' }));
    fireEvent.change(await screen.findByLabelText('Testo degli appunti'), {
      target: { value: 'Draft da conservare' },
    });
    now += 60_001;
    fireEvent(window, new Event('focus'));
    await waitFor(() => expect(mockLoadLessons).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByText('Aggiornamento…')).toBeNull());
    expect((screen.getByLabelText('Testo degli appunti') as HTMLTextAreaElement).value).toBe(
      'Draft da conservare',
    );
    mockLoadLessons.mockRejectedValueOnce(new Error('offline'));
    now += 60_001;
    fireEvent(window, new Event('focus'));
    await screen.findByText(/Impossibile caricare il corso/);
    expect(screen.queryByRole('progressbar')).toBeNull();
    now += 60_001;
    fireEvent(window, new Event('focus'));
    const recovered = await screen.findByLabelText('Testo degli appunti');
    expect((recovered as HTMLTextAreaElement).value).toBe('Draft da conservare');
    expect(mockLoadNote).toHaveBeenCalledOnce();
    expect(mockCreateNote).not.toHaveBeenCalled();
  });

  it('guards explicit refresh and library navigation before discarding dirty notes', async () => {
    render(<StudentDidatticaView />);
    await openCourseAndSelectLesson();
    fireEvent.click(await screen.findByRole('button', { name: 'Appunti' }));
    fireEvent.change(await screen.findByLabelText('Testo degli appunti'), {
      target: { value: 'Draft protetto' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Aggiorna' }));
    expect(await screen.findByRole('dialog')).toBeTruthy();
    expect(mockLoadLessons).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Resta e continua' }));
    expect((screen.getByLabelText('Testo degli appunti') as HTMLTextAreaElement).value).toBe(
      'Draft protetto',
    );
    fireEvent.click(screen.getByRole('button', { name: '← Libreria' }));
    fireEvent.click(screen.getByRole('button', { name: 'Resta e continua' }));
    expect(screen.queryByLabelText('Corsi disponibili')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Aggiorna' }));
    fireEvent.click(screen.getByRole('button', { name: 'Esci senza salvare' }));
    await waitFor(() => expect(mockLoadLessons).toHaveBeenCalledTimes(2));
  });

  it('drops note state on import invalidation and never restores an old note response', async () => {
    let resolveOld!: (result: unknown) => void;
    mockLoadNote.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveOld = resolve;
      }),
    );
    render(<StudentDidatticaView />);
    await openCourseAndSelectLesson();
    fireEvent.click(await screen.findByRole('button', { name: 'Appunti' }));
    await waitFor(() => expect(mockLoadNote).toHaveBeenCalledOnce());
    mockLoadLessons.mockResolvedValue({
      status: 'ok',
      programs: [{ id: 'p1', title: 'Informatica', classIds: ['class-a'], activeImportId: 'i2' }],
      lessonsByProgram: { p1: [{ ...LESSON, id: 'i2_lesson-1', importId: 'i2' }] },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Aggiorna' }));
    await waitFor(() => expect(mockLoadNoteIndex).toHaveBeenCalledTimes(2));
    await act(async () => resolveOld({ state: 'existing', note: { content: 'Nota obsoleta' } }));
    expect(screen.queryByDisplayValue('Nota obsoleta')).toBeNull();
    expect(screen.queryByLabelText('Testo degli appunti')).toBeNull();
  });

  it('drops pending note reads on logout/account change', async () => {
    let resolveOld!: (result: unknown) => void;
    mockLoadNote.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveOld = resolve;
      }),
    );
    const view = render(<StudentDidatticaView />);
    await openCourseAndSelectLesson();
    fireEvent.click(await screen.findByRole('button', { name: 'Appunti' }));
    await waitFor(() => expect(mockLoadNote).toHaveBeenCalledOnce());
    mockUid = null;
    view.rerender(<StudentDidatticaView />);
    expect(screen.queryByText('Informatica')).toBeNull();
    mockUid = 'other-student';
    view.rerender(<StudentDidatticaView />);
    await act(async () =>
      resolveOld({ state: 'existing', note: { content: 'Nota privata precedente' } }),
    );
    await screen.findByRole('button', { name: 'Apri il corso Informatica' });
    expect(screen.queryByDisplayValue('Nota privata precedente')).toBeNull();
    expect(mockLoadLessons).toHaveBeenLastCalledWith('other-student', expect.anything());
  });

  it('shows the Appunti command only once a real lesson is selected', async () => {
    render(<StudentDidatticaView />);
    await openCourseAndSelectLesson();
    expect(await screen.findByRole('button', { name: 'Appunti' })).toBeTruthy();
  });

  it('shows a stable pencil indicator and highlights Appunti only for persisted notes', async () => {
    mockLoadNoteIndex.mockResolvedValue({ lessonIds: [LESSON.id], bootstrapped: false });
    render(<StudentDidatticaView />);
    await openCourseAndSelectLesson();

    expect(await screen.findByTitle('Appunti salvati')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Appunti, appunti salvati' })).toBeTruthy();
  });

  it('updates the persisted indicator after save without reloading the course', async () => {
    render(<StudentDidatticaView />);
    await openCourseAndSelectLesson();
    fireEvent.click(await screen.findByRole('button', { name: 'Appunti' }));
    const textarea = await screen.findByLabelText('Testo degli appunti');
    fireEvent.change(textarea, { target: { value: 'Nota persistita' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salva' }));

    await waitFor(() => expect(mockCreateNote).toHaveBeenCalledOnce());
    expect(await screen.findByRole('button', { name: 'Appunti, appunti salvati' })).toBeTruthy();
    expect(mockLoadLessons).toHaveBeenCalledOnce();
    expect(mockLoadNoteIndex).toHaveBeenCalledOnce();
  });

  it('does not create a persisted indicator when the atomic save fails', async () => {
    mockCreateNote.mockRejectedValue(new Error('offline'));
    render(<StudentDidatticaView />);
    await openCourseAndSelectLesson();
    fireEvent.click(await screen.findByRole('button', { name: 'Appunti' }));
    fireEvent.change(await screen.findByLabelText('Testo degli appunti'), {
      target: { value: 'Draft locale' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Salva' }));

    await waitFor(() => expect(screen.getByText('Errore')).toBeTruthy());
    expect(screen.queryByRole('button', { name: 'Appunti, appunti salvati' })).toBeNull();
    expect(screen.queryByTitle('Appunti salvati')).toBeNull();
  });

  it('opens the desktop aside on click and reads the note once', async () => {
    render(<StudentDidatticaView />);
    await openCourseAndSelectLesson();
    fireEvent.click(await screen.findByRole('button', { name: 'Appunti' }));

    expect(await screen.findByRole('complementary', { name: 'Appunti' })).toBeTruthy();
    await waitFor(() => expect(mockLoadNote).toHaveBeenCalledTimes(1));
  });

  it('loads the per-course index once and reuses it when the course is reopened', async () => {
    render(<StudentDidatticaView />);
    fireEvent.click(await screen.findByRole('button', { name: 'Apri il corso Informatica' }));
    await waitFor(() => expect(mockLoadNoteIndex).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole('button', { name: '← Libreria' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Apri il corso Informatica' }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mockLoadNoteIndex).toHaveBeenCalledOnce();
  });

  it('opens the dedicated mobile view under the mobile breakpoint', async () => {
    setMatchMedia(true);
    render(<StudentDidatticaView />);
    await openCourseAndSelectLesson();
    fireEvent.click(await screen.findByRole('button', { name: 'Appunti' }));

    expect(await screen.findByRole('region', { name: 'Appunti' })).toBeTruthy();
    expect(screen.getByText('← Torna alla lezione')).toBeTruthy();
    expect(screen.queryByRole('complementary', { name: 'Appunti' })).toBeNull();
  });

  it('does not render the structure toggle on mobile', async () => {
    setMatchMedia(true);
    render(<StudentDidatticaView />);
    await openCourseAndSelectLesson();
    expect(screen.queryByRole('button', { name: 'Nascondi struttura' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Mostra struttura' })).toBeNull();
  });

  it('restores the lesson scroll position when closing mobile notes', async () => {
    setMatchMedia(true);
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 420 });
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    render(<StudentDidatticaView />);
    await openCourseAndSelectLesson();
    fireEvent.click(await screen.findByRole('button', { name: 'Appunti' }));
    await screen.findByRole('region', { name: 'Appunti' });
    fireEvent.click(screen.getByText('← Torna alla lezione'));

    expect(scrollTo).toHaveBeenCalledWith({ top: 420, behavior: 'auto' });
  });
});
