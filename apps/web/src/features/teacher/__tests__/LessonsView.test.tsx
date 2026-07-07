import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LessonsView } from '../LessonsView.js';

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('../../../lib/firebase.js', () => ({ db: {}, storage: {} }));

const mockListPrograms = vi.fn();
const mockListUdas = vi.fn();
const mockListLessons = vi.fn();

vi.mock('../../../features/repository/programs/programsService.js', () => ({
  listPrograms: (...args: unknown[]) => mockListPrograms(...args),
  listUdas: (...args: unknown[]) => mockListUdas(...args),
  listLessons: (...args: unknown[]) => mockListLessons(...args),
}));

const mockFetchLessonContent = vi.fn();
vi.mock('../lessonContent.js', () => ({
  fetchLessonContent: (...args: unknown[]) => mockFetchLessonContent(...args),
}));

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
});

// ─── Fixtures ────────────────────────────────────────────────────────────────

const PROGRAM = {
  id: 'prog-1',
  ownerUid: 'owner-uid',
  title: 'Informatica',
  activeImportId: 'imp-1',
  createdAt: null,
  updatedAt: null,
};

const PROGRAM_NO_IMPORT = { ...PROGRAM, id: 'prog-2', title: 'Vuoto', activeImportId: null };

const UDA = {
  id: 'uda-1',
  ownerUid: 'owner-uid',
  importId: 'imp-1',
  dir: 'uda-01-reti',
  filename: 'uda-01-reti.md',
  storageBasePath: 'repository/owner-uid/imports/imp-1/uda-01-reti',
  lessonCount: 1,
};

const LESSON_1 = {
  id: 'lesson-1',
  ownerUid: 'owner-uid',
  importId: 'imp-1',
  udaDir: 'uda-01-reti',
  path: 'uda-01-reti/lezione-001.md',
  filename: 'lezione-001.md',
  poolStatus: 'valid' as const,
  questionCount: 2,
  storageRef: 'repository/owner-uid/imports/imp-1/uda-01-reti/lezione-001.md',
  poolStorageRef: null,
  completed: false,
};

async function expandCourse(name: RegExp) {
  fireEvent.click(await screen.findByRole('button', { name }));
}

async function expandUda(name: RegExp) {
  fireEvent.click(await screen.findByRole('button', { name }));
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('LessonsView — loading state', () => {
  it('shows loading indicator while fetching programs', () => {
    mockListPrograms.mockReturnValue(new Promise(() => {}));
    render(<LessonsView />);
    expect(screen.getByText('Caricamento…')).toBeTruthy();
  });
});

describe('LessonsView — error state', () => {
  it('shows error message when listPrograms fails', async () => {
    mockListPrograms.mockRejectedValue(new Error('network error'));
    render(<LessonsView />);
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('Impossibile');
  });
});

describe('LessonsView — empty state', () => {
  it('shows a helpful empty state when there are no programs', async () => {
    mockListPrograms.mockResolvedValue([]);
    render(<LessonsView />);
    expect(await screen.findByText(/Importa prima uno ZIP da Corsi/)).toBeTruthy();
  });
});

describe('LessonsView — courses with active import', () => {
  it('shows each course as a collapsed toggle', async () => {
    mockListPrograms.mockResolvedValue([PROGRAM, PROGRAM_NO_IMPORT]);
    render(<LessonsView />);
    const informatica = await screen.findByRole('button', { name: /^Informatica/ });
    expect(informatica.getAttribute('aria-expanded')).toBe('false');
    expect(await screen.findByRole('button', { name: /^Vuoto/ })).toBeTruthy();
  });
});

describe('LessonsView — course without active import', () => {
  it('shows a helpful message instead of breaking the page', async () => {
    mockListPrograms.mockResolvedValue([PROGRAM_NO_IMPORT]);
    render(<LessonsView />);
    await expandCourse(/^Vuoto/);
    expect(await screen.findByText(/Importa prima uno ZIP da Corsi/)).toBeTruthy();
  });
});

describe('LessonsView — expanding a course shows UDA', () => {
  it('loads and shows UDAs when a course is expanded', async () => {
    mockListPrograms.mockResolvedValue([PROGRAM]);
    mockListUdas.mockResolvedValue([UDA]);
    mockListLessons.mockResolvedValue([LESSON_1]);
    render(<LessonsView />);
    await expandCourse(/^Informatica/);
    expect(await screen.findByRole('button', { name: /uda-01-reti/ })).toBeTruthy();
  });
});

describe('LessonsView — expanding a UDA shows lessons', () => {
  it('shows lesson filenames for the expanded UDA', async () => {
    mockListPrograms.mockResolvedValue([PROGRAM]);
    mockListUdas.mockResolvedValue([UDA]);
    mockListLessons.mockResolvedValue([LESSON_1]);
    render(<LessonsView />);
    await expandCourse(/^Informatica/);
    await expandUda(/uda-01-reti/);
    expect(await screen.findByRole('button', { name: /lezione-001\.md/ })).toBeTruthy();
  });
});

describe('LessonsView — selecting a lesson', () => {
  it('calls fetchLessonContent with the lesson storageRef', async () => {
    mockListPrograms.mockResolvedValue([PROGRAM]);
    mockListUdas.mockResolvedValue([UDA]);
    mockListLessons.mockResolvedValue([LESSON_1]);
    mockFetchLessonContent.mockResolvedValue('# Lezione\nContenuto.');
    render(<LessonsView />);
    await expandCourse(/^Informatica/);
    await expandUda(/uda-01-reti/);
    fireEvent.click(await screen.findByRole('button', { name: /lezione-001\.md/ }));

    await waitFor(() => {
      expect(mockFetchLessonContent).toHaveBeenCalledWith(LESSON_1.storageRef, {});
    });
  });

  it('renders the Markdown content once loaded', async () => {
    mockListPrograms.mockResolvedValue([PROGRAM]);
    mockListUdas.mockResolvedValue([UDA]);
    mockListLessons.mockResolvedValue([LESSON_1]);
    mockFetchLessonContent.mockResolvedValue('# Lezione\nContenuto della lezione.');
    render(<LessonsView />);
    await expandCourse(/^Informatica/);
    await expandUda(/uda-01-reti/);
    fireEvent.click(await screen.findByRole('button', { name: /lezione-001\.md/ }));

    expect(await screen.findByRole('heading', { name: 'Lezione' })).toBeTruthy();
    expect(screen.getByText('Contenuto della lezione.')).toBeTruthy();
  });

  it('highlights the selected lesson', async () => {
    mockListPrograms.mockResolvedValue([PROGRAM]);
    mockListUdas.mockResolvedValue([UDA]);
    mockListLessons.mockResolvedValue([LESSON_1]);
    mockFetchLessonContent.mockResolvedValue('# Lezione');
    render(<LessonsView />);
    await expandCourse(/^Informatica/);
    await expandUda(/uda-01-reti/);
    const lessonBtn = await screen.findByRole('button', { name: /lezione-001\.md/ });
    expect(lessonBtn.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(lessonBtn);
    await waitFor(() => expect(lessonBtn.getAttribute('aria-pressed')).toBe('true'));
  });

  it('shows a readable error when fetchLessonContent fails', async () => {
    mockListPrograms.mockResolvedValue([PROGRAM]);
    mockListUdas.mockResolvedValue([UDA]);
    mockListLessons.mockResolvedValue([LESSON_1]);
    mockFetchLessonContent.mockRejectedValue(new Error('Network error'));
    render(<LessonsView />);
    await expandCourse(/^Informatica/);
    await expandUda(/uda-01-reti/);
    fireEvent.click(await screen.findByRole('button', { name: /lezione-001\.md/ }));

    expect(await screen.findByText(/Impossibile caricare il contenuto della lezione/)).toBeTruthy();
  });
});

describe('LessonsView — no lesson selected', () => {
  it('shows a prompt to select a lesson in the content panel', async () => {
    mockListPrograms.mockResolvedValue([PROGRAM]);
    render(<LessonsView />);
    await screen.findByRole('button', { name: /^Informatica/ });
    expect(screen.getByText(/Seleziona una lezione/)).toBeTruthy();
  });
});
