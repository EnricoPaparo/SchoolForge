import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProgramsView } from '../ProgramsView.js';

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('../../../lib/firebase.js', () => ({ db: {}, storage: {} }));
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

const mockFetchLessonContent = vi.fn();
vi.mock('../lessonContent.js', () => ({
  fetchLessonContent: (...args: unknown[]) => mockFetchLessonContent(...args),
}));

const mockExportZip = vi.fn();
vi.mock('../exportZip.js', () => ({
  exportZip: (...args: unknown[]) => mockExportZip(...args),
}));

const mockImportRepository = vi.fn();
const mockReadZipFile = vi.fn();
vi.mock('../../../features/repository/import/importRepository.js', () => ({
  importRepository: (...args: unknown[]) => mockImportRepository(...args),
}));
vi.mock('../../../features/repository/import/readZipFile.js', () => ({
  readZipFile: (...args: unknown[]) => mockReadZipFile(...args),
}));

const mockGenerateMarkdown = vi.fn().mockReturnValue('# Programma svolto');
const mockDownloadMarkdown = vi.fn();
const mockDownloadPdf = vi.fn().mockResolvedValue(undefined);
vi.mock('../programmaSvolto.js', () => ({
  generateMarkdown: (...args: unknown[]) => mockGenerateMarkdown(...args),
  downloadMarkdown: (...args: unknown[]) => mockDownloadMarkdown(...args),
  downloadPdf: (...args: unknown[]) => mockDownloadPdf(...args),
}));

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  mockReadZipFile.mockResolvedValue([]);
  mockImportRepository.mockResolvedValue({
    status: 'committed',
    programId: 'prog-1',
    importId: 'imp-new',
    validationIssues: [],
    udaCount: 2,
    lessonCount: 5,
    questionCount: 10,
  });
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
    expect(await screen.findByRole('button', { name: 'lezione-001.md' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'lezione-002.md' })).toBeTruthy();
  });

  it('shows completed checkbox state correctly', async () => {
    mockListPrograms.mockResolvedValue([PROGRAM]);
    mockListUdas.mockResolvedValue([UDA]);
    mockListLessons.mockResolvedValue([LESSON_1, LESSON_2]);
    render(<ProgramsView />);
    fireEvent.click(await screen.findByRole('button', { name: 'Informatica' }));
    fireEvent.click(await screen.findByRole('button', { name: 'uda-01-reti' }));
    await screen.findByRole('button', { name: 'lezione-001.md' });
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
    await screen.findByRole('button', { name: 'lezione-001.md' });

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

// ─── M1-E new tests ──────────────────────────────────────────────────────────

describe('ProgramsView — lesson content rendering', () => {
  it('shows lesson content when a lesson is clicked', async () => {
    mockListPrograms.mockResolvedValue([PROGRAM]);
    mockListUdas.mockResolvedValue([UDA]);
    mockListLessons.mockResolvedValue([LESSON_1]);
    mockFetchLessonContent.mockResolvedValue('# Lezione\nContenuto della lezione.');

    render(<ProgramsView />);
    fireEvent.click(await screen.findByRole('button', { name: 'Informatica' }));
    fireEvent.click(await screen.findByRole('button', { name: 'uda-01-reti' }));
    fireEvent.click(await screen.findByRole('button', { name: 'lezione-001.md' }));

    await waitFor(() => {
      expect(mockFetchLessonContent).toHaveBeenCalledWith(LESSON_1.storageRef, {});
    });
  });

  it('shows error when lesson content cannot be loaded', async () => {
    mockListPrograms.mockResolvedValue([PROGRAM]);
    mockListUdas.mockResolvedValue([UDA]);
    mockListLessons.mockResolvedValue([LESSON_1]);
    mockFetchLessonContent.mockRejectedValue(new Error('Network error'));

    render(<ProgramsView />);
    fireEvent.click(await screen.findByRole('button', { name: 'Informatica' }));
    fireEvent.click(await screen.findByRole('button', { name: 'uda-01-reti' }));
    fireEvent.click(await screen.findByRole('button', { name: 'lezione-001.md' }));

    expect(await screen.findByText(/Impossibile caricare il contenuto della lezione/)).toBeTruthy();
  });
});

describe('ProgramsView — Esporta ZIP button', () => {
  it('shows Esporta ZIP button when program has activeImportId', async () => {
    mockListPrograms.mockResolvedValue([PROGRAM]);
    mockListUdas.mockResolvedValue([UDA]);
    render(<ProgramsView />);
    fireEvent.click(await screen.findByRole('button', { name: 'Informatica' }));
    expect(await screen.findByRole('button', { name: 'Esporta ZIP' })).toBeTruthy();
  });

  it('does not show Esporta ZIP button when program has no activeImportId', async () => {
    mockListPrograms.mockResolvedValue([PROGRAM_NO_IMPORT]);
    render(<ProgramsView />);
    fireEvent.click(await screen.findByRole('button', { name: 'Vuoto' }));
    await screen.findByText(/Nessun import attivo/);
    expect(screen.queryByRole('button', { name: 'Esporta ZIP' })).toBeNull();
  });
});

describe('ProgramsView — Programma svolto buttons', () => {
  it('shows Programma svolto (MD) and (PDF) buttons when program has activeImportId', async () => {
    mockListPrograms.mockResolvedValue([PROGRAM]);
    mockListUdas.mockResolvedValue([UDA]);
    render(<ProgramsView />);
    fireEvent.click(await screen.findByRole('button', { name: 'Informatica' }));
    expect(await screen.findByRole('button', { name: 'Programma svolto (MD)' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Programma svolto (PDF)' })).toBeTruthy();
  });
});

describe('ProgramsView — Import ZIP', () => {
  it('import button not visible when no program is selected', async () => {
    mockListPrograms.mockResolvedValue([]);
    render(<ProgramsView />);
    await screen.findByText(/Nessun programma/);
    expect(screen.queryByRole('button', { name: /importa zip/i })).toBeNull();
  });

  it('shows import ZIP section when a program is selected', async () => {
    mockListPrograms.mockResolvedValue([PROGRAM]);
    mockListUdas.mockResolvedValue([UDA]);
    mockListLessons.mockResolvedValue([LESSON_1]);
    render(<ProgramsView />);
    fireEvent.click(await screen.findByRole('button', { name: 'Informatica' }));
    expect(await screen.findByRole('button', { name: /importa zip/i })).toBeTruthy();
    expect(screen.getByLabelText(/importa zip didattico/i)).toBeTruthy();
  });

  it('import button is disabled without file selected', async () => {
    mockListPrograms.mockResolvedValue([PROGRAM]);
    mockListUdas.mockResolvedValue([UDA]);
    mockListLessons.mockResolvedValue([LESSON_1]);
    render(<ProgramsView />);
    fireEvent.click(await screen.findByRole('button', { name: 'Informatica' }));
    const btn = await screen.findByRole('button', { name: /importa zip/i });
    expect(btn).toHaveProperty('disabled', true);
  });

  it('calls importRepository with correct programId when ZIP is selected and imported', async () => {
    const updatedProgram = { ...PROGRAM, activeImportId: 'imp-new' };
    mockListPrograms.mockResolvedValueOnce([PROGRAM]).mockResolvedValue([updatedProgram]);
    mockListUdas.mockResolvedValue([UDA]);
    mockListLessons.mockResolvedValue([LESSON_1]);
    render(<ProgramsView />);
    fireEvent.click(await screen.findByRole('button', { name: 'Informatica' }));

    const fileInput = await screen.findByLabelText(/importa zip didattico/i);
    const fakeFile = new File(['zip content'], 'repo.zip', { type: 'application/zip' });
    fireEvent.change(fileInput, { target: { files: [fakeFile] } });

    const btn = screen.getByRole('button', { name: /importa zip/i });
    expect(btn).toHaveProperty('disabled', false);
    fireEvent.click(btn);

    await waitFor(() => expect(mockImportRepository).toHaveBeenCalledTimes(1));
    const [input] = mockImportRepository.mock.calls[0];
    expect(input.programId).toBe('prog-1');
    expect(input.ownerUid).toBe('owner-uid');
    expect(input.programmaTitle).toBe('Informatica');
  });

  it('shows loading state during import', async () => {
    mockListPrograms.mockResolvedValue([PROGRAM]);
    mockListUdas.mockResolvedValue([UDA]);
    mockListLessons.mockResolvedValue([LESSON_1]);
    mockImportRepository.mockReturnValue(new Promise(() => {}));
    render(<ProgramsView />);
    fireEvent.click(await screen.findByRole('button', { name: 'Informatica' }));

    const fileInput = await screen.findByLabelText(/importa zip didattico/i);
    fireEvent.change(fileInput, {
      target: { files: [new File(['zip'], 'r.zip', { type: 'application/zip' })] },
    });
    fireEvent.click(screen.getByRole('button', { name: /importa zip/i }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /importazione/i })).toHaveProperty(
        'disabled',
        true,
      ),
    );
  });

  it('shows success message with counts after successful import', async () => {
    const updatedProgram = { ...PROGRAM, activeImportId: 'imp-new' };
    mockListPrograms.mockResolvedValueOnce([PROGRAM]).mockResolvedValue([updatedProgram]);
    mockListUdas.mockResolvedValue([UDA]);
    mockListLessons.mockResolvedValue([LESSON_1]);
    render(<ProgramsView />);
    fireEvent.click(await screen.findByRole('button', { name: 'Informatica' }));

    const fileInput = await screen.findByLabelText(/importa zip didattico/i);
    fireEvent.change(fileInput, {
      target: { files: [new File(['zip'], 'r.zip', { type: 'application/zip' })] },
    });
    fireEvent.click(screen.getByRole('button', { name: /importa zip/i }));

    await waitFor(() => expect(screen.getByText(/import completato/i)).toBeTruthy());
    expect(screen.getByText(/2 UDA/i)).toBeTruthy();
    expect(screen.getByText(/5 lezioni/i)).toBeTruthy();
    expect(screen.getByText(/10 domande/i)).toBeTruthy();
  });

  it('shows error when importRepository returns validation_failed', async () => {
    mockListPrograms.mockResolvedValue([PROGRAM]);
    mockListUdas.mockResolvedValue([UDA]);
    mockListLessons.mockResolvedValue([LESSON_1]);
    mockImportRepository.mockResolvedValue({
      status: 'validation_failed',
      validationIssues: [
        {
          level: 'error',
          path: 'uda-01/uda.md',
          field: 'titolo',
          code: 'missing',
          message: 'Campo titolo mancante',
        },
      ],
    });
    render(<ProgramsView />);
    fireEvent.click(await screen.findByRole('button', { name: 'Informatica' }));

    const fileInput = await screen.findByLabelText(/importa zip didattico/i);
    fireEvent.change(fileInput, {
      target: { files: [new File(['zip'], 'r.zip', { type: 'application/zip' })] },
    });
    fireEvent.click(screen.getByRole('button', { name: /importa zip/i }));

    await waitFor(() => screen.getByRole('alert'));
    expect(screen.getByRole('alert').textContent).toMatch(/validazione fallita/i);
  });

  it('shows error when importRepository throws', async () => {
    mockListPrograms.mockResolvedValue([PROGRAM]);
    mockListUdas.mockResolvedValue([UDA]);
    mockListLessons.mockResolvedValue([LESSON_1]);
    mockImportRepository.mockRejectedValue(new Error('Storage non raggiungibile'));
    render(<ProgramsView />);
    fireEvent.click(await screen.findByRole('button', { name: 'Informatica' }));

    const fileInput = await screen.findByLabelText(/importa zip didattico/i);
    fireEvent.change(fileInput, {
      target: { files: [new File(['zip'], 'r.zip', { type: 'application/zip' })] },
    });
    fireEvent.click(screen.getByRole('button', { name: /importa zip/i }));

    await waitFor(() => screen.getByRole('alert'));
    expect(screen.getByRole('alert').textContent).toMatch(/storage non raggiungibile/i);
  });
});
