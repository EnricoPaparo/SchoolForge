import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
const mockGetImportMeta = vi.fn();
const mockSetLessonCompleted = vi.fn();
const mockDeleteProgram = vi.fn();

vi.mock('../../../features/repository/programs/programsService.js', () => ({
  listPrograms: (...args: unknown[]) => mockListPrograms(...args),
  createProgram: (...args: unknown[]) => mockCreateProgram(...args),
  updateProgramTitle: (...args: unknown[]) => mockUpdateProgramTitle(...args),
  listUdas: (...args: unknown[]) => mockListUdas(...args),
  listLessons: (...args: unknown[]) => mockListLessons(...args),
  getImportMeta: (...args: unknown[]) => mockGetImportMeta(...args),
  setLessonCompleted: (...args: unknown[]) => mockSetLessonCompleted(...args),
  deleteProgram: (...args: unknown[]) => mockDeleteProgram(...args),
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
  descrizione: 'Introduzione alle reti informatiche.',
  competenze: ['Comprendere il modello ISO/OSI'],
  obiettivi: ['Spiegare il funzionamento di HTTP'],
};

const UDA_NO_METADATA = {
  ...UDA,
  id: 'uda-2',
  dir: 'uda-02-web',
  filename: 'uda-02-web.md',
  descrizione: null,
  competenze: [],
  obiettivi: [],
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

async function expandCourse(name: RegExp) {
  fireEvent.click(await screen.findByRole('button', { name }));
}

async function expandUda(name: RegExp) {
  // Anchored so it matches only the UDA toggle button (whose accessible name
  // starts with the dir), not the "Info UDA — <dir>" button added in UX-08.
  fireEvent.click(await screen.findByRole('button', { name: new RegExp(`^${name.source}`) }));
}

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

describe('ProgramsView — course list as accordion', () => {
  it('renders each course as a collapsed accordion toggle', async () => {
    mockListPrograms.mockResolvedValue([PROGRAM, PROGRAM_NO_IMPORT]);
    render(<ProgramsView />);
    const informatica = await screen.findByRole('button', { name: /^Informatica/ });
    const vuoto = await screen.findByRole('button', { name: /^Vuoto/ });
    expect(informatica.getAttribute('aria-expanded')).toBe('false');
    expect(vuoto.getAttribute('aria-expanded')).toBe('false');
  });

  it('shows counters in the course header without an import status badge', async () => {
    mockListPrograms.mockResolvedValue([PROGRAM]);
    mockListUdas.mockResolvedValue([UDA]);
    mockListLessons.mockResolvedValue([LESSON_1, LESSON_2]);
    render(<ProgramsView />);
    await screen.findByRole('button', { name: /^Informatica/ });
    expect(screen.queryByText('Importato')).toBeNull();
    expect(await screen.findByText(/UDA: 1/)).toBeTruthy();
    expect(await screen.findByText(/Lezioni: 1\/2 svolte/)).toBeTruthy();
    expect(await screen.findByText(/Domande: 4 disponibili/)).toBeTruthy();
  });

  it('shows a clear "no import" empty state for a program without an active import', async () => {
    mockListPrograms.mockResolvedValue([PROGRAM_NO_IMPORT]);
    render(<ProgramsView />);
    await screen.findByRole('button', { name: /^Vuoto/ });
    expect(screen.queryByText('Nessun import')).toBeNull();
    expect(await screen.findByText('Nessun import attivo')).toBeTruthy();
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
    expect(await screen.findByRole('button', { name: /^Informatica/ })).toBeTruthy();
  });
});

describe('ProgramsView — expanding a course with no active import', () => {
  it('shows no-import message when a course with no import is expanded', async () => {
    mockListPrograms.mockResolvedValue([PROGRAM_NO_IMPORT]);
    render(<ProgramsView />);
    await expandCourse(/^Vuoto/);
    expect(await screen.findByText('Nessun import attivo per questo programma.')).toBeTruthy();
  });
});

describe('ProgramsView — expanding a course shows UDA', () => {
  it('loads and shows UDAs when a course is expanded', async () => {
    mockListPrograms.mockResolvedValue([PROGRAM]);
    mockListUdas.mockResolvedValue([UDA]);
    mockListLessons.mockResolvedValue([]);
    render(<ProgramsView />);
    await expandCourse(/^Informatica/);
    expect(await screen.findByRole('button', { name: /^uda-01-reti/ })).toBeTruthy();
  });
});

describe('ProgramsView — UDA info panel', () => {
  it('shows descrizione, competenze and obiettivi parsed from the UDA file', async () => {
    mockListPrograms.mockResolvedValue([PROGRAM]);
    mockListUdas.mockResolvedValue([UDA]);
    mockListLessons.mockResolvedValue([]);
    render(<ProgramsView />);
    await expandCourse(/^Informatica/);
    await screen.findByRole('button', { name: /^uda-01-reti/ });

    fireEvent.click(screen.getByRole('button', { name: 'Info UDA — uda-01-reti' }));

    const region = await screen.findByRole('region', { name: 'Informazioni UDA uda-01-reti' });
    expect(within(region).getByText('Introduzione alle reti informatiche.')).toBeTruthy();
    expect(within(region).getByText('Comprendere il modello ISO/OSI')).toBeTruthy();
    expect(within(region).getByText('Spiegare il funzionamento di HTTP')).toBeTruthy();
  });

  it('shows "Non indicato" when descrizione/competenze/obiettivi are missing', async () => {
    mockListPrograms.mockResolvedValue([PROGRAM]);
    mockListUdas.mockResolvedValue([UDA_NO_METADATA]);
    mockListLessons.mockResolvedValue([]);
    render(<ProgramsView />);
    await expandCourse(/^Informatica/);
    await screen.findByRole('button', { name: /^uda-02-web/ });

    fireEvent.click(screen.getByRole('button', { name: 'Info UDA — uda-02-web' }));

    const region = await screen.findByRole('region', { name: 'Informazioni UDA uda-02-web' });
    expect(within(region).getAllByText('Non indicato')).toHaveLength(3);
  });

  it('never shows technical details like storage path or importId', async () => {
    mockListPrograms.mockResolvedValue([PROGRAM]);
    mockListUdas.mockResolvedValue([UDA]);
    mockListLessons.mockResolvedValue([]);
    render(<ProgramsView />);
    await expandCourse(/^Informatica/);
    await screen.findByRole('button', { name: /^uda-01-reti/ });

    fireEvent.click(screen.getByRole('button', { name: 'Info UDA — uda-01-reti' }));

    const region = await screen.findByRole('region', { name: 'Informazioni UDA uda-01-reti' });
    expect(within(region).queryByText(/repository\/owner-uid/)).toBeNull();
    expect(within(region).queryByText('imp-1')).toBeNull();
  });
});

describe('ProgramsView — program info panel (programma.md metadata)', () => {
  it('shows programma.md metadata when present, without the raw import id', async () => {
    mockListPrograms.mockResolvedValue([PROGRAM]);
    mockListUdas.mockResolvedValue([UDA]);
    mockListLessons.mockResolvedValue([]);
    mockGetImportMeta.mockResolvedValue({
      annoScolastico: '2025/2026',
      docente: 'Mario Rossi',
      materia: 'Informatica',
      classe: '3A',
      descrizione: 'Programma annuale di informatica.',
    });
    render(<ProgramsView />);
    await screen.findByRole('button', { name: /^Informatica/ });

    fireEvent.click(screen.getByRole('button', { name: /Info corso/ }));

    const region = await screen.findByRole('region', { name: 'Informazioni corso Informatica' });
    expect(within(region).getByText('2025/2026')).toBeTruthy();
    expect(within(region).getByText('Mario Rossi')).toBeTruthy();
    expect(within(region).getByText('Programma annuale di informatica.')).toBeTruthy();
    // The raw import id is a technical detail — never shown to the teacher.
    expect(within(region).queryByText('imp-1')).toBeNull();
  });

  it('omits the programma.md section entirely when the file was not provided', async () => {
    mockListPrograms.mockResolvedValue([PROGRAM]);
    mockListUdas.mockResolvedValue([UDA]);
    mockListLessons.mockResolvedValue([]);
    mockGetImportMeta.mockResolvedValue(null);
    render(<ProgramsView />);
    await screen.findByRole('button', { name: /^Informatica/ });

    fireEvent.click(screen.getByRole('button', { name: /Info corso/ }));

    const region = await screen.findByRole('region', { name: 'Informazioni corso Informatica' });
    expect(within(region).queryByText('Docente')).toBeNull();
    expect(within(region).queryByText('Anno scolastico')).toBeNull();
  });
});

describe('ProgramsView — expanding a UDA shows lessons', () => {
  it('shows lessons for the expanded UDA', async () => {
    mockListPrograms.mockResolvedValue([PROGRAM]);
    mockListUdas.mockResolvedValue([UDA]);
    mockListLessons.mockResolvedValue([LESSON_1, LESSON_2]);
    render(<ProgramsView />);
    await expandCourse(/^Informatica/);
    await expandUda(/uda-01-reti/);
    expect(await screen.findByText('lezione-001.md')).toBeTruthy();
    expect(screen.getByText('lezione-002.md')).toBeTruthy();
  });

  it('shows completed checkbox state correctly', async () => {
    mockListPrograms.mockResolvedValue([PROGRAM]);
    mockListUdas.mockResolvedValue([UDA]);
    mockListLessons.mockResolvedValue([LESSON_1, LESSON_2]);
    render(<ProgramsView />);
    await expandCourse(/^Informatica/);
    await expandUda(/uda-01-reti/);
    await screen.findByText('lezione-001.md');
    const checkboxes = screen.getAllByRole('checkbox');
    expect((checkboxes[0] as HTMLInputElement).checked).toBe(false);
    expect((checkboxes[1] as HTMLInputElement).checked).toBe(true);
  });

  it('does not open Markdown content when a lesson row is present — no viewer rendered', async () => {
    mockListPrograms.mockResolvedValue([PROGRAM]);
    mockListUdas.mockResolvedValue([UDA]);
    mockListLessons.mockResolvedValue([LESSON_1]);
    render(<ProgramsView />);
    await expandCourse(/^Informatica/);
    await expandUda(/uda-01-reti/);
    const filename = await screen.findByText('lezione-001.md');
    fireEvent.click(filename);
    // Lesson filename is plain text, not a button — no markdown/prose viewer appears.
    expect(screen.queryByRole('button', { name: 'lezione-001.md' })).toBeNull();
    expect(document.querySelector('.prose')).toBeNull();
  });
});

describe('ProgramsView — toggle lesson completed', () => {
  it('calls setLessonCompleted and updates checkbox on toggle', async () => {
    mockListPrograms.mockResolvedValue([PROGRAM]);
    mockListUdas.mockResolvedValue([UDA]);
    mockListLessons.mockResolvedValue([LESSON_1]);
    mockSetLessonCompleted.mockResolvedValue(undefined);
    render(<ProgramsView />);
    await expandCourse(/^Informatica/);
    await expandUda(/uda-01-reti/);
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
    await screen.findByRole('button', { name: /^Informatica/ });
    fireEvent.click(screen.getByRole('button', { name: /Modifica titolo/ }));

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
    await waitFor(() => {
      expect(screen.queryByLabelText('Modifica titolo')).toBeNull();
    });
  });
});

describe('ProgramsView — Esporta ZIP action', () => {
  it('calls exportZip when Esporta ZIP icon is clicked', async () => {
    mockListPrograms.mockResolvedValue([PROGRAM]);
    mockListUdas.mockResolvedValue([UDA]);
    mockListLessons.mockResolvedValue([LESSON_1]);
    mockExportZip.mockResolvedValue(undefined);
    render(<ProgramsView />);
    await screen.findByRole('button', { name: /^Informatica/ });
    fireEvent.click(screen.getByRole('button', { name: /Esporta ZIP/ }));
    await waitFor(() => expect(mockExportZip).toHaveBeenCalledWith(PROGRAM, {}, {}));
  });

  it('disables Esporta ZIP when program has no activeImportId', async () => {
    mockListPrograms.mockResolvedValue([PROGRAM_NO_IMPORT]);
    render(<ProgramsView />);
    await screen.findByRole('button', { name: /^Vuoto/ });
    expect(screen.getByRole('button', { name: /Esporta ZIP/ })).toHaveProperty('disabled', true);
  });
});

describe('ProgramsView — Programma svolto actions', () => {
  it('calls generateMarkdown/downloadMarkdown when MD icon is clicked', async () => {
    mockListPrograms.mockResolvedValue([PROGRAM]);
    mockListUdas.mockResolvedValue([UDA]);
    mockListLessons.mockResolvedValue([LESSON_1]);
    render(<ProgramsView />);
    await screen.findByRole('button', { name: /^Informatica/ });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Programma svolto \(MD\)/ })).toHaveProperty(
        'disabled',
        false,
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: /Programma svolto \(MD\)/ }));
    await waitFor(() => expect(mockDownloadMarkdown).toHaveBeenCalled());
  });

  it('calls downloadPdf when PDF icon is clicked', async () => {
    mockListPrograms.mockResolvedValue([PROGRAM]);
    mockListUdas.mockResolvedValue([UDA]);
    mockListLessons.mockResolvedValue([LESSON_1]);
    render(<ProgramsView />);
    await screen.findByRole('button', { name: /^Informatica/ });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Programma svolto \(PDF\)/ })).toHaveProperty(
        'disabled',
        false,
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: /Programma svolto \(PDF\)/ }));
    await waitFor(() => expect(mockDownloadPdf).toHaveBeenCalled());
  });
});

describe('ProgramsView — Import ZIP guided modal', () => {
  it('opens the guided modal when Importa ZIP icon is clicked', async () => {
    mockListPrograms.mockResolvedValue([PROGRAM]);
    mockListUdas.mockResolvedValue([UDA]);
    mockListLessons.mockResolvedValue([LESSON_1]);
    render(<ProgramsView />);
    await screen.findByRole('button', { name: /^Informatica/ });
    fireEvent.click(screen.getByRole('button', { name: /Importa ZIP/ }));

    expect(await screen.findByRole('dialog')).toBeTruthy();
    expect(screen.getByText(/uda-NN-slug/)).toBeTruthy();
    expect(screen.getByLabelText('File ZIP')).toBeTruthy();
  });

  it('import button in modal is disabled without a file selected', async () => {
    mockListPrograms.mockResolvedValue([PROGRAM]);
    mockListUdas.mockResolvedValue([UDA]);
    render(<ProgramsView />);
    await screen.findByRole('button', { name: /^Informatica/ });
    fireEvent.click(screen.getByRole('button', { name: /Importa ZIP/ }));
    const dialog = await screen.findByRole('dialog');
    const importBtn = within(dialog).getByRole('button', { name: 'Importa ZIP' });
    expect(importBtn).toHaveProperty('disabled', true);
  });

  it('calls the import pipeline with the correct programId when a ZIP is selected and imported', async () => {
    const updatedProgram = { ...PROGRAM, activeImportId: 'imp-new' };
    mockListPrograms.mockResolvedValueOnce([PROGRAM]).mockResolvedValue([updatedProgram]);
    mockListUdas.mockResolvedValue([UDA]);
    mockListLessons.mockResolvedValue([LESSON_1]);
    render(<ProgramsView />);
    await screen.findByRole('button', { name: /^Informatica/ });
    fireEvent.click(screen.getByRole('button', { name: /Importa ZIP/ }));
    const dialog = await screen.findByRole('dialog');

    const fileInput = within(dialog).getByLabelText('File ZIP');
    const fakeFile = new File(['zip content'], 'repo.zip', { type: 'application/zip' });
    fireEvent.change(fileInput, { target: { files: [fakeFile] } });

    const importBtn = within(dialog).getByRole('button', { name: 'Importa ZIP' });
    expect(importBtn).toHaveProperty('disabled', false);
    fireEvent.click(importBtn);

    await waitFor(() => expect(mockImportRepository).toHaveBeenCalledTimes(1));
    const [input] = mockImportRepository.mock.calls[0];
    expect(input.programId).toBe('prog-1');
    expect(input.ownerUid).toBe('owner-uid');
    expect(input.programmaTitle).toBe('Informatica');
  });

  it('shows loading state during import', async () => {
    mockListPrograms.mockResolvedValue([PROGRAM]);
    mockListUdas.mockResolvedValue([UDA]);
    mockImportRepository.mockReturnValue(new Promise(() => {}));
    render(<ProgramsView />);
    await screen.findByRole('button', { name: /^Informatica/ });
    fireEvent.click(screen.getByRole('button', { name: /Importa ZIP/ }));
    const dialog = await screen.findByRole('dialog');

    const fileInput = within(dialog).getByLabelText('File ZIP');
    fireEvent.change(fileInput, {
      target: { files: [new File(['zip'], 'r.zip', { type: 'application/zip' })] },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Importa ZIP' }));

    await waitFor(() =>
      expect(within(dialog).getByRole('button', { name: /Importazione/i })).toHaveProperty(
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
    await screen.findByRole('button', { name: /^Informatica/ });
    fireEvent.click(screen.getByRole('button', { name: /Importa ZIP/ }));
    const dialog = await screen.findByRole('dialog');

    const fileInput = within(dialog).getByLabelText('File ZIP');
    fireEvent.change(fileInput, {
      target: { files: [new File(['zip'], 'r.zip', { type: 'application/zip' })] },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Importa ZIP' }));

    await waitFor(() => expect(screen.getByText(/import completato/i)).toBeTruthy());
    expect(screen.getByText(/2 UDA/i)).toBeTruthy();
    expect(screen.getByText(/5 lezioni/i)).toBeTruthy();
    expect(screen.getByText(/10 domande/i)).toBeTruthy();
  });

  it('shows error when importRepository returns validation_failed', async () => {
    mockListPrograms.mockResolvedValue([PROGRAM]);
    mockListUdas.mockResolvedValue([UDA]);
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
    await screen.findByRole('button', { name: /^Informatica/ });
    fireEvent.click(screen.getByRole('button', { name: /Importa ZIP/ }));
    const dialog = await screen.findByRole('dialog');

    const fileInput = within(dialog).getByLabelText('File ZIP');
    fireEvent.change(fileInput, {
      target: { files: [new File(['zip'], 'r.zip', { type: 'application/zip' })] },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Importa ZIP' }));

    await waitFor(() => screen.getByRole('alert'));
    expect(screen.getByRole('alert').textContent).toMatch(/validazione fallita/i);
  });

  it('shows error when importRepository throws', async () => {
    mockListPrograms.mockResolvedValue([PROGRAM]);
    mockListUdas.mockResolvedValue([UDA]);
    mockImportRepository.mockRejectedValue(new Error('Storage non raggiungibile'));
    render(<ProgramsView />);
    await screen.findByRole('button', { name: /^Informatica/ });
    fireEvent.click(screen.getByRole('button', { name: /Importa ZIP/ }));
    const dialog = await screen.findByRole('dialog');

    const fileInput = within(dialog).getByLabelText('File ZIP');
    fireEvent.change(fileInput, {
      target: { files: [new File(['zip'], 'r.zip', { type: 'application/zip' })] },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Importa ZIP' }));

    await waitFor(() => screen.getByRole('alert'));
    expect(screen.getByRole('alert').textContent).toMatch(/storage non raggiungibile/i);
  });

  it('closes the modal when Chiudi/Annulla is clicked', async () => {
    mockListPrograms.mockResolvedValue([PROGRAM]);
    mockListUdas.mockResolvedValue([UDA]);
    render(<ProgramsView />);
    await screen.findByRole('button', { name: /^Informatica/ });
    fireEvent.click(screen.getByRole('button', { name: /Importa ZIP/ }));
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: 'Annulla' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('ProgramsView — delete program', () => {
  it('shows a confirmation with the exact required wording before deleting', async () => {
    mockListPrograms.mockResolvedValue([PROGRAM]);
    mockListUdas.mockResolvedValue([UDA]);
    render(<ProgramsView />);
    await screen.findByRole('button', { name: /^Informatica/ });

    const deleteTrigger = screen.getByRole('button', { name: 'Elimina corso — Informatica' });
    expect(deleteTrigger.classList.contains('btn-danger')).toBe(false);

    fireEvent.click(deleteTrigger);

    expect(
      screen.getByText(
        'Saranno eliminati import, UDA, lezioni, pool e file caricati. Operazione irreversibile.',
      ),
    ).toBeTruthy();
    expect(
      screen
        .getByRole('button', { name: 'Elimina definitivamente' })
        .classList.contains('btn-danger'),
    ).toBe(true);
    expect(mockDeleteProgram).not.toHaveBeenCalled();
  });

  it('cancels deletion without calling the service', async () => {
    mockListPrograms.mockResolvedValue([PROGRAM]);
    mockListUdas.mockResolvedValue([UDA]);
    render(<ProgramsView />);
    await screen.findByRole('button', { name: /^Informatica/ });

    fireEvent.click(screen.getByRole('button', { name: 'Elimina corso — Informatica' }));
    fireEvent.click(screen.getByRole('button', { name: 'Annulla' }));

    expect(mockDeleteProgram).not.toHaveBeenCalled();
    expect(
      screen.queryByText(
        'Saranno eliminati import, UDA, lezioni, pool e file caricati. Operazione irreversibile.',
      ),
    ).toBeNull();
  });

  it('deletes the program and removes it from the list on confirm', async () => {
    mockListPrograms.mockResolvedValue([PROGRAM]);
    mockListUdas.mockResolvedValue([UDA]);
    mockDeleteProgram.mockResolvedValue(undefined);
    render(<ProgramsView />);
    await screen.findByRole('button', { name: /^Informatica/ });

    fireEvent.click(screen.getByRole('button', { name: 'Elimina corso — Informatica' }));
    fireEvent.click(screen.getByRole('button', { name: 'Elimina definitivamente' }));

    await waitFor(() =>
      expect(mockDeleteProgram).toHaveBeenCalledWith('prog-1', 'owner-uid', {}, {}),
    );
    await waitFor(() => expect(screen.queryByText('Informatica')).toBeNull());
  });

  it('shows the blocked-deletion error and keeps the program when linked verifications exist', async () => {
    mockListPrograms.mockResolvedValue([PROGRAM]);
    mockListUdas.mockResolvedValue([UDA]);
    mockDeleteProgram.mockRejectedValue(
      new Error(
        'Impossibile eliminare il corso: esistono verifiche associate. Elimina prima le verifiche collegate.',
      ),
    );
    render(<ProgramsView />);
    await screen.findByRole('button', { name: /^Informatica/ });

    fireEvent.click(screen.getByRole('button', { name: 'Elimina corso — Informatica' }));
    fireEvent.click(screen.getByRole('button', { name: 'Elimina definitivamente' }));

    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'Impossibile eliminare il corso: esistono verifiche associate. Elimina prima le verifiche collegate.',
    );
    expect(screen.getByText('Informatica')).toBeTruthy();
  });
});

describe('ProgramsView — ReadinessView no longer shown as a separate card', () => {
  it('does not render the readiness dashboard region in Corsi', async () => {
    mockListPrograms.mockResolvedValue([PROGRAM]);
    mockListUdas.mockResolvedValue([UDA]);
    mockListLessons.mockResolvedValue([LESSON_1, LESSON_2]);
    render(<ProgramsView />);
    await screen.findByRole('button', { name: /^Informatica/ });
    await waitFor(() => expect(screen.getByText(/UDA: 1/)).toBeTruthy());
    expect(screen.queryByRole('region', { name: 'Dashboard di prontezza' })).toBeNull();
    expect(screen.queryByText('Prontezza repository')).toBeNull();
  });
});
