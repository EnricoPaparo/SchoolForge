import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StudentLessonsView } from '../StudentLessonsView.js';

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('../../../lib/firebase.js', () => ({ db: {}, storage: {} }));
vi.mock('../../../lib/auth.js', () => ({
  useAuth: () => ({ user: { uid: 'student-uid', email: 's@test.com', displayName: null } }),
}));

const mockLoadStudentLessons = vi.fn();
vi.mock('../../repository/programs/studentLessonsService.js', () => ({
  loadStudentLessons: (...args: unknown[]) => mockLoadStudentLessons(...args),
}));

const mockFetchLessonContent = vi.fn();
vi.mock('../../teacher/lessonContent.js', () => ({
  fetchLessonContent: (...args: unknown[]) => mockFetchLessonContent(...args),
}));

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
});

// ─── Fixtures ────────────────────────────────────────────────────────────────

const PROGRAM_A = { id: 'prog-a', title: 'Informatica', classIds: ['class-a'] };
const PROGRAM_B = { id: 'prog-b', title: 'Matematica', classIds: ['class-a'] };

const LESSON_1 = {
  id: 'l1',
  ownerUid: 'owner-uid',
  programId: 'prog-a',
  importId: 'imp-1',
  udaId: 'uda-1',
  udaDir: 'uda-01-reti',
  path: 'uda-01-reti/lezione-001.md',
  filename: 'lezione-001.md',
  contentPath: 'repository/owner-uid/imports/imp-1/uda-01-reti/lezione-001.md',
  createdAt: null,
};

const LESSON_2 = {
  ...LESSON_1,
  id: 'l2',
  udaDir: 'uda-02-web',
  filename: 'lezione-002.md',
  path: 'uda-02-web/lezione-002.md',
  contentPath: 'repository/owner-uid/imports/imp-1/uda-02-web/lezione-002.md',
};

describe('StudentLessonsView', () => {
  it('shows a loading state while fetching', () => {
    mockLoadStudentLessons.mockReturnValue(new Promise(() => {}));
    render(<StudentLessonsView />);
    expect(screen.getByText('Caricamento…')).toBeTruthy();
  });

  it('shows "nessuna classe assegnata" when the student has no class', async () => {
    mockLoadStudentLessons.mockResolvedValue({ status: 'no-class' });
    render(<StudentLessonsView />);
    await waitFor(() => expect(screen.getByText(/Nessuna classe assegnata/)).toBeTruthy());
  });

  it('shows "nessun programma assegnato" when no program matches the class', async () => {
    mockLoadStudentLessons.mockResolvedValue({
      status: 'ok',
      programs: [],
      lessonsByProgram: {},
    });
    render(<StudentLessonsView />);
    await waitFor(() =>
      expect(screen.getByText(/Nessun programma assegnato alla tua classe/)).toBeTruthy(),
    );
  });

  it('shows a readable error when loading fails', async () => {
    mockLoadStudentLessons.mockRejectedValue(new Error('boom'));
    render(<StudentLessonsView />);
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByText('Impossibile caricare le lezioni.')).toBeTruthy();
  });

  it('lists only programs/lessons returned by the service (class filtering happens upstream)', async () => {
    mockLoadStudentLessons.mockResolvedValue({
      status: 'ok',
      programs: [PROGRAM_A],
      lessonsByProgram: { [PROGRAM_A.id]: [LESSON_1] },
    });
    render(<StudentLessonsView />);
    await waitFor(() => expect(screen.getByText('Informatica')).toBeTruthy());
    expect(screen.queryByText('Matematica')).toBeNull();
  });

  it('shows "nessuna lezione disponibile" for a program with no lessons', async () => {
    mockLoadStudentLessons.mockResolvedValue({
      status: 'ok',
      programs: [PROGRAM_A],
      lessonsByProgram: { [PROGRAM_A.id]: [] },
    });
    render(<StudentLessonsView />);
    await waitFor(() => screen.getByText('Informatica'));
    fireEvent.click(screen.getByText('Informatica'));
    expect(screen.getByText('Nessuna lezione disponibile.')).toBeTruthy();
  });

  it('renders programs and lessons in the order given by the service (stable ordering is the service’s job)', async () => {
    mockLoadStudentLessons.mockResolvedValue({
      status: 'ok',
      programs: [PROGRAM_A, PROGRAM_B],
      lessonsByProgram: {
        [PROGRAM_A.id]: [LESSON_1, LESSON_2],
        [PROGRAM_B.id]: [],
      },
    });
    render(<StudentLessonsView />);
    await waitFor(() => screen.getByText('Informatica'));
    const titles = screen.getAllByText(/Informatica|Matematica/).map((el) => el.textContent);
    expect(titles).toEqual(['Informatica', 'Matematica']);
  });

  it('clicking a lesson loads and renders its markdown content', async () => {
    mockLoadStudentLessons.mockResolvedValue({
      status: 'ok',
      programs: [PROGRAM_A],
      lessonsByProgram: { [PROGRAM_A.id]: [LESSON_1] },
    });
    mockFetchLessonContent.mockResolvedValue('# Titolo\n\nContenuto della lezione.');

    render(<StudentLessonsView />);
    await waitFor(() => screen.getByText('Informatica'));
    fireEvent.click(screen.getByText('Informatica'));
    fireEvent.click(screen.getByText('uda-01-reti'));
    fireEvent.click(screen.getByRole('button', { name: /Apri lezione lezione-001.md/ }));

    await waitFor(() => expect(screen.getByText('Titolo')).toBeTruthy());
    expect(mockFetchLessonContent).toHaveBeenCalledWith(LESSON_1.contentPath, {});
  });

  it('shows a readable error when lesson content fails to load', async () => {
    mockLoadStudentLessons.mockResolvedValue({
      status: 'ok',
      programs: [PROGRAM_A],
      lessonsByProgram: { [PROGRAM_A.id]: [LESSON_1] },
    });
    mockFetchLessonContent.mockRejectedValue(new Error('storage down'));

    render(<StudentLessonsView />);
    await waitFor(() => screen.getByText('Informatica'));
    fireEvent.click(screen.getByText('Informatica'));
    fireEvent.click(screen.getByText('uda-01-reti'));
    fireEvent.click(screen.getByRole('button', { name: /Apri lezione lezione-001.md/ }));

    await waitFor(() =>
      expect(screen.getByText('Impossibile caricare il contenuto della lezione.')).toBeTruthy(),
    );
  });

  it('never renders docente-only actions (no import, no PDF, no template controls)', async () => {
    mockLoadStudentLessons.mockResolvedValue({
      status: 'ok',
      programs: [PROGRAM_A],
      lessonsByProgram: { [PROGRAM_A.id]: [LESSON_1] },
    });
    mockFetchLessonContent.mockResolvedValue('# Titolo');

    render(<StudentLessonsView />);
    await waitFor(() => screen.getByText('Informatica'));
    fireEvent.click(screen.getByText('Informatica'));
    fireEvent.click(screen.getByText('uda-01-reti'));
    fireEvent.click(screen.getByRole('button', { name: /Apri lezione lezione-001.md/ }));
    await waitFor(() => expect(screen.getByText('Titolo')).toBeTruthy());

    expect(screen.queryByRole('button', { name: /PDF/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Importa/i })).toBeNull();
  });
});

describe('StudentLessonsView — sidebar collapse toggle', () => {
  it('shows a sidebar toggle button when programs are loaded', async () => {
    mockLoadStudentLessons.mockResolvedValue({
      status: 'ok',
      programs: [PROGRAM_A],
      lessonsByProgram: { [PROGRAM_A.id]: [LESSON_1] },
    });
    render(<StudentLessonsView />);
    await screen.findByText('Informatica');
    expect(screen.getByRole('button', { name: 'Comprimi sidebar' })).toBeTruthy();
  });

  it('hides the program list when sidebar is collapsed', async () => {
    mockLoadStudentLessons.mockResolvedValue({
      status: 'ok',
      programs: [PROGRAM_A],
      lessonsByProgram: { [PROGRAM_A.id]: [LESSON_1] },
    });
    render(<StudentLessonsView />);
    await screen.findByText('Informatica');

    fireEvent.click(screen.getByRole('button', { name: 'Comprimi sidebar' }));

    expect(screen.queryByText('Informatica')).toBeNull();
    expect(screen.getByRole('button', { name: 'Espandi sidebar' })).toBeTruthy();
  });

  it('restores the program list when re-expanded', async () => {
    mockLoadStudentLessons.mockResolvedValue({
      status: 'ok',
      programs: [PROGRAM_A],
      lessonsByProgram: { [PROGRAM_A.id]: [LESSON_1] },
    });
    render(<StudentLessonsView />);
    await screen.findByText('Informatica');

    fireEvent.click(screen.getByRole('button', { name: 'Comprimi sidebar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Espandi sidebar' }));

    expect(await screen.findByText('Informatica')).toBeTruthy();
  });
});
