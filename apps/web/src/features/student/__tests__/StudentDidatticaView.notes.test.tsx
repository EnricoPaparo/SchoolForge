import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockLoadLessons = vi.fn();
const mockLoadNote = vi.fn();

vi.mock('../../../lib/firebase.js', () => ({ db: {}, storage: {}, functions: {} }));
vi.mock('../../../lib/auth.js', () => ({
  useAuth: () => ({ user: { uid: 'student-uid' }, loading: false }),
}));
vi.mock('../../repository/programs/studentLessonsService.js', () => ({
  loadStudentLessons: (...a: unknown[]) => mockLoadLessons(...a),
}));
vi.mock('../studentLessonNotesService.js', async () => {
  const actual = (await vi.importActual('../studentLessonNotesService.js')) as Record<
    string,
    unknown
  >;
  return {
    ...actual,
    loadStudentLessonNote: (...a: unknown[]) => mockLoadNote(...a),
    createStudentLessonNote: vi.fn().mockResolvedValue(undefined),
    updateStudentLessonNote: vi.fn().mockResolvedValue(undefined),
    deleteStudentLessonNote: vi.fn().mockResolvedValue(undefined),
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
  setMatchMedia(false);
  mockLoadNote.mockResolvedValue({ state: 'missing' });
  mockLoadLessons.mockResolvedValue({
    status: 'ok',
    programs: [{ id: 'p1', title: 'Informatica', classIds: ['class-a'], activeImportId: 'i1' }],
    lessonsByProgram: { p1: [LESSON] },
  });
});

afterEach(cleanup);

async function openCourseAndSelectLesson() {
  fireEvent.click(await screen.findByRole('button', { name: 'Apri corso Informatica' }));
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
  it('shows the Appunti command only once a real lesson is selected', async () => {
    render(<StudentDidatticaView />);
    await openCourseAndSelectLesson();
    expect(await screen.findByRole('button', { name: 'Appunti' })).toBeTruthy();
  });

  it('opens the desktop aside on click and reads the note once', async () => {
    render(<StudentDidatticaView />);
    await openCourseAndSelectLesson();
    fireEvent.click(await screen.findByRole('button', { name: 'Appunti' }));

    expect(await screen.findByRole('complementary', { name: 'Appunti' })).toBeTruthy();
    await waitFor(() => expect(mockLoadNote).toHaveBeenCalledTimes(1));
  });

  it('hides and restores the desktop structure while keeping the lesson expanded', async () => {
    render(<StudentDidatticaView />);
    await openCourseAndSelectLesson();
    const hide = await screen.findByRole('button', { name: 'Nascondi struttura' });
    expect(hide.getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByRole('complementary', { name: 'Struttura del corso' })).toBeTruthy();

    fireEvent.click(hide);
    expect(screen.queryByRole('complementary', { name: 'Struttura del corso' })).toBeNull();
    expect(screen.getByText('Corpo lezione')).toBeTruthy();
    const show = screen.getByRole('button', { name: 'Mostra struttura' });
    expect(show.getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(show);
    expect(screen.getByRole('complementary', { name: 'Struttura del corso' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Nascondi struttura' })).toBeTruthy();
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
