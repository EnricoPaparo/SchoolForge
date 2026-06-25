import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProgramsView } from '../ProgramsView.js';

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('../../../lib/firebase.js', () => ({ db: {} }));
vi.mock('../../../lib/auth.js', () => ({
  useAuth: () => ({ user: { uid: 'owner-uid', email: 'teacher@test.com' } }),
}));

const mockListPrograms = vi.fn();
const mockCreateProgram = vi.fn();
const mockUpdateProgramTitle = vi.fn();
const mockListUdas = vi.fn();
const mockListLessons = vi.fn();
const mockSetLessonCompleted = vi.fn();

vi.mock('../../../features/repository/programs/programsService.js', () => ({
  listPrograms: (...args: unknown[]) => mockListPrograms(...args),
  createProgram: (...args: unknown[]) => mockCreateProgram(...args),
  updateProgramTitle: (...args: unknown[]) => mockUpdateProgramTitle(...args),
  listUdas: (...args: unknown[]) => mockListUdas(...args),
  listLessons: (...args: unknown[]) => mockListLessons(...args),
  setLessonCompleted: (...args: unknown[]) => mockSetLessonCompleted(...args),
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
  lessonCount: 2,
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

const LESSON_2 = { ...LESSON_1, id: 'lesson-2', filename: 'lezione-002.md', completed: true };

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('ProgramsView — loading state', () => {
  it('shows loading indicator while fetching programs', () => {
    mockListPrograms.mockReturnValue(new Promise(() => {}));
    render(<ProgramsView />);
    expect(screen.getByText('Caricamento…')).toBeTruthy();
  });
});

describe('ProgramsView — error state', () => {
  it('shows error message when listPrograms fails', async () => {
    mockListPrograms.mockRejectedValue(new Error('network error'));
    render(<ProgramsView />);
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('Impossibile');
  });
});

describe('ProgramsView — empty state', () => {
  it('shows empty message and create form when no programs', async () => {
    mockListPrograms.mockResolvedValue([]);
    render(<ProgramsView />);
    expect(await screen.findByText(/Nessun programma/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Crea programma' })).toBeTruthy();
  });
});

describe('ProgramsView — programs list', () => {
  it('renders program names', async () => {
    mockListPrograms.mockResolvedValue([PROGRAM, PROGRAM_NO_IMPORT]);
    render(<ProgramsView />);
    expect(await screen.findByRole('button', { name: 'Informatica' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Vuoto' })).toBeTruthy();
  });
});

describe('ProgramsView — create program', () => {
  it('calls createProgram and reloads list on submit', async () => {
    mockListPrograms.mockResolvedValueOnce([]).mockResolvedValueOnce([PROGRAM]);
    mockCreateProgram.mockResolvedValue('prog-1');
    render(<ProgramsView />);
    await screen.findByText(/Nessun programma/);

    fireEvent.change(screen.getByLabelText('Titolo nuovo programma'), {
      target: { value: 'Informatica' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Crea programma' }));

    await waitFor(() => {
      expect(mockCreateProgram).toHaveBeenCalledWith('Informatica', 'owner-uid', {});
    });
    expect(await screen.findByRole('button', { name: 'Informatica' })).toBeTruthy();
  });
});

describe('ProgramsView — program with no import', () => {
  it('shows no-import message when activeImportId is null', async () => {
    mockListPrograms.mockResolvedValue([PROGRAM_NO_IMPORT]);
    render(<ProgramsView />);
    fireEvent.click(await screen.findByRole('button', { name: 'Vuoto' }));
    expect(await screen.findByText(/Nessun import attivo/)).toBeTruthy();
  });
});

describe('ProgramsView — UDA selection', () => {
  it('loads and shows UDAs when program is selected', async () => {
    mockListPrograms.mockResolvedValue([PROGRAM]);
    mockListUdas.mockResolvedValue([UDA]);
    render(<ProgramsView />);
    fireEvent.click(await screen.findByRole('button', { name: 'Informatica' }));
    expect(await screen.findByRole('button', { name: 'uda-01-reti' })).toBeTruthy();
  });
});

describe('ProgramsView — lesson list', () => {
  it('loads and shows lessons when UDA is selected', async () => {
    mockListPrograms.mockResolvedValue([PROGRAM]);
    mockListUdas.mockResolvedValue([UDA]);
    mockListLessons.mockResolvedValue([LESSON_1, LESSON_2]);
    render(<ProgramsView />);
    fireEvent.click(await screen.findByRole('button', { name: 'Informatica' }));
    fireEvent.click(await screen.findByRole('button', { name: 'uda-01-reti' }));
    expect(await screen.findByText('lezione-001.md')).toBeTruthy();
    expect(screen.getByText('lezione-002.md')).toBeTruthy();
  });

  it('shows completed checkbox state correctly', async () => {
    mockListPrograms.mockResolvedValue([PROGRAM]);
    mockListUdas.mockResolvedValue([UDA]);
    mockListLessons.mockResolvedValue([LESSON_1, LESSON_2]);
    render(<ProgramsView />);
    fireEvent.click(await screen.findByRole('button', { name: 'Informatica' }));
    fireEvent.click(await screen.findByRole('button', { name: 'uda-01-reti' }));
    await screen.findByText('lezione-001.md');
    const checkboxes = screen.getAllByRole('checkbox');
    expect((checkboxes[0] as HTMLInputElement).checked).toBe(false);
    expect((checkboxes[1] as HTMLInputElement).checked).toBe(true);
  });
});

describe('ProgramsView — toggle lesson completed', () => {
  it('calls setLessonCompleted and updates checkbox on toggle', async () => {
    mockListPrograms.mockResolvedValue([PROGRAM]);
    mockListUdas.mockResolvedValue([UDA]);
    mockListLessons.mockResolvedValue([LESSON_1]);
    mockSetLessonCompleted.mockResolvedValue(undefined);
    render(<ProgramsView />);
    fireEvent.click(await screen.findByRole('button', { name: 'Informatica' }));
    fireEvent.click(await screen.findByRole('button', { name: 'uda-01-reti' }));
    await screen.findByText('lezione-001.md');

    const checkbox = screen.getByRole('checkbox') as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
    fireEvent.click(checkbox);

    await waitFor(() => {
      expect(mockSetLessonCompleted).toHaveBeenCalledWith(
        'prog-1',
        'imp-1',
        'lesson-1',
        true,
        'owner-uid',
        {},
      );
    });
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true);
  });
});

describe('ProgramsView — edit program title', () => {
  it('shows edit form on click and calls updateProgramTitle on save', async () => {
    mockListPrograms.mockResolvedValue([PROGRAM]);
    mockListUdas.mockResolvedValue([UDA]);
    mockUpdateProgramTitle.mockResolvedValue(undefined);
    render(<ProgramsView />);
    fireEvent.click(await screen.findByRole('button', { name: 'Informatica' }));
    await screen.findByRole('button', { name: 'Modifica titolo' });
    fireEvent.click(screen.getByRole('button', { name: 'Modifica titolo' }));

    const input = screen.getByLabelText('Modifica titolo');
    fireEvent.change(input, { target: { value: 'Informatica v2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salva' }));

    await waitFor(() => {
      expect(mockUpdateProgramTitle).toHaveBeenCalledWith(
        'prog-1',
        'Informatica v2',
        'owner-uid',
        {},
      );
    });
    // Edit form dismissed — input no longer visible
    await waitFor(() => {
      expect(screen.queryByLabelText('Modifica titolo')).toBeNull();
    });
  });
});
