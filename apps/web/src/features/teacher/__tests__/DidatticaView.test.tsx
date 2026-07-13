import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DidatticaView } from '../DidatticaView.js';
import type { CourseCard } from '../../repository/programs/courseLibrary.js';

const mockLoadCourseLibrary = vi.fn();
const mockCreateProgram = vi.fn();
const mockUpdateProgramTitle = vi.fn();
const mockDeleteProgram = vi.fn();
const mockImportRepository = vi.fn();
const mockReadZipFile = vi.fn();

vi.mock('../../../lib/firebase.js', () => ({ db: {}, storage: {} }));
vi.mock('../../repository/programs/courseLibrary.js', () => ({
  loadCourseLibrary: (...a: unknown[]) => mockLoadCourseLibrary(...a),
}));
vi.mock('../../repository/programs/programsService.js', () => ({
  createProgram: (...a: unknown[]) => mockCreateProgram(...a),
  updateProgramTitle: (...a: unknown[]) => mockUpdateProgramTitle(...a),
  deleteProgram: (...a: unknown[]) => mockDeleteProgram(...a),
}));
vi.mock('../../repository/import/importRepository.js', () => ({
  importRepository: (...a: unknown[]) => mockImportRepository(...a),
}));
vi.mock('../../repository/import/readZipFile.js', () => ({
  readZipFile: (...a: unknown[]) => mockReadZipFile(...a),
}));
const mockMigrationComplete = vi.fn();
const mockBackfill = vi.fn();
vi.mock('../../repository/programs/publicLessonsBackfillService.js', () => ({
  isPublicLessonsMigrationComplete: (...a: unknown[]) => mockMigrationComplete(...a),
  backfillPublicLessonsContent: (...a: unknown[]) => mockBackfill(...a),
}));
// The workspace (DUX-02) has its own dedicated test; here we only assert
// Didattica's two-level navigation (library ⇄ workspace) and that returning
// preserves the library's filters — so a light stub is enough.
vi.mock('../CourseWorkspace.js', () => ({
  CourseWorkspace: ({ card, onBack }: { card: { title: string }; onBack: () => void }) => (
    <div>
      <p>WORKSPACE: {card.title}</p>
      <button type="button" onClick={onBack}>
        ← Libreria
      </button>
    </div>
  ),
}));

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  // Default: migration already complete → maintenance notice hidden.
  mockMigrationComplete.mockResolvedValue(true);
});

function card(overrides: Partial<CourseCard> = {}): CourseCard {
  return {
    programId: 'p1',
    title: 'Sistemi e Reti',
    annoScolastico: '2025/2026',
    classIds: ['c-4a'],
    classNames: ['4A INF'],
    udaCount: 3,
    lessonsTotal: 12,
    lessonsDone: 9,
    questionsTotal: 41,
    hasImport: true,
    activeImportId: 'i1',
    ...overrides,
  };
}

function renderView() {
  return render(<DidatticaView ownerUid="owner-uid" />);
}

describe('DidatticaView — loading and rendering', () => {
  it('shows a loading state initially', () => {
    mockLoadCourseLibrary.mockReturnValue(new Promise(() => {}));
    renderView();
    expect(screen.getByText(/caricamento/i)).toBeTruthy();
  });

  it('renders a card with all the required metrics', async () => {
    mockLoadCourseLibrary.mockResolvedValue([card()]);
    renderView();

    await waitFor(() => expect(screen.getByText('Sistemi e Reti')).toBeTruthy());
    // Scope to the card so year/class text isn't confused with the filter options.
    const article = within(screen.getByRole('article'));
    expect(article.getByText('2025/2026')).toBeTruthy();
    expect(article.getByText('4A INF')).toBeTruthy();
    expect(article.getByText('3')).toBeTruthy(); // UDA
    expect(article.getByText('9/12')).toBeTruthy(); // lezioni svolte/totali
    expect(article.getByText('41')).toBeTruthy(); // domande
    expect(article.getByRole('img', { name: /avanzamento lezioni 75%/i })).toBeTruthy();
  });

  it('shows a readable error when loading fails', async () => {
    mockLoadCourseLibrary.mockRejectedValue(new Error('boom'));
    renderView();
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByText(/impossibile caricare i corsi/i)).toBeTruthy();
  });
});

describe('DidatticaView — filters', () => {
  it('defaults to the most recent school year, hiding older-year courses', async () => {
    mockLoadCourseLibrary.mockResolvedValue([
      card({ programId: 'p1', title: 'Corso Recente', annoScolastico: '2025/2026' }),
      card({ programId: 'p2', title: 'Corso Vecchio', annoScolastico: '2024/2025' }),
    ]);
    renderView();

    await waitFor(() => expect(screen.getByText('Corso Recente')).toBeTruthy());
    expect(screen.queryByText('Corso Vecchio')).toBeNull();

    // Switching to "Tutti gli anni" reveals both.
    fireEvent.change(screen.getByLabelText('Filtro anno scolastico'), {
      target: { value: '__all__' },
    });
    expect(screen.getByText('Corso Vecchio')).toBeTruthy();
  });

  it('offers "Senza anno" and filters to courses without a school year', async () => {
    mockLoadCourseLibrary.mockResolvedValue([
      card({ programId: 'p1', title: 'Con Anno', annoScolastico: '2025/2026' }),
      card({ programId: 'p2', title: 'Senza Anno', annoScolastico: null }),
    ]);
    renderView();

    await waitFor(() => expect(screen.getByText('Con Anno')).toBeTruthy());
    fireEvent.change(screen.getByLabelText('Filtro anno scolastico'), {
      target: { value: '__none__' },
    });
    expect(screen.getByText('Senza Anno')).toBeTruthy();
    expect(screen.queryByText('Con Anno')).toBeNull();
  });

  it('combines year + class + search filters', async () => {
    mockLoadCourseLibrary.mockResolvedValue([
      card({
        programId: 'p1',
        title: 'Reti 4A',
        annoScolastico: '2025/2026',
        classNames: ['4A INF'],
      }),
      card({
        programId: 'p2',
        title: 'Reti 3B',
        annoScolastico: '2025/2026',
        classNames: ['3B INF'],
      }),
      card({
        programId: 'p3',
        title: 'Basi dati 4A',
        annoScolastico: '2025/2026',
        classNames: ['4A INF'],
      }),
    ]);
    renderView();

    await waitFor(() => expect(screen.getByText('Reti 4A')).toBeTruthy());
    // class = 4A INF → drops "Reti 3B"
    fireEvent.change(screen.getByLabelText('Filtro classe'), { target: { value: '4A INF' } });
    expect(screen.queryByText('Reti 3B')).toBeNull();
    // search "reti" → drops "Basi dati 4A"
    fireEvent.change(screen.getByLabelText('Cerca corso'), { target: { value: 'reti' } });
    expect(screen.getByText('Reti 4A')).toBeTruthy();
    expect(screen.queryByText('Basi dati 4A')).toBeNull();
  });

  it('shows a composed empty state with a working "Azzera filtri" reset', async () => {
    mockLoadCourseLibrary.mockResolvedValue([card({ title: 'Solo Corso' })]);
    renderView();

    await waitFor(() => expect(screen.getByText('Solo Corso')).toBeTruthy());
    fireEvent.change(screen.getByLabelText('Cerca corso'), { target: { value: 'zzz-no-match' } });
    expect(screen.getByText(/nessun corso corrisponde ai filtri/i)).toBeTruthy();

    fireEvent.click(screen.getByText('Azzera filtri'));
    expect(screen.getByText('Solo Corso')).toBeTruthy();
  });
});

describe('DidatticaView — open course', () => {
  it('opens the course workspace in place and returns to the library preserving filters', async () => {
    mockLoadCourseLibrary.mockResolvedValue([
      card({ programId: 'p1', title: 'Reti', annoScolastico: '2025/2026', classNames: ['4A INF'] }),
      card({
        programId: 'p2',
        title: 'Basi dati',
        annoScolastico: '2025/2026',
        classNames: ['4A INF'],
      }),
    ]);
    renderView();

    await waitFor(() => expect(screen.getByText('Reti')).toBeTruthy());
    // Narrow the library with a search before opening the workspace.
    fireEvent.change(screen.getByLabelText('Cerca corso'), { target: { value: 'reti' } });
    expect(screen.queryByText('Basi dati')).toBeNull();

    // Open the workspace for "Reti" (the library stays mounted underneath).
    fireEvent.click(screen.getByRole('button', { name: /apri il corso reti/i }));
    expect(screen.getByText('WORKSPACE: Reti')).toBeTruthy();

    // Back to the library: the earlier search filter is still applied.
    fireEvent.click(screen.getByRole('button', { name: /← libreria/i }));
    expect(screen.getByText('Reti')).toBeTruthy();
    expect(screen.queryByText('Basi dati')).toBeNull();
    expect((screen.getByLabelText('Cerca corso') as HTMLInputElement).value).toBe('reti');
  });

  it('exposes rename/delete in the ⋯ menu as sibling controls (no nested buttons)', async () => {
    mockLoadCourseLibrary.mockResolvedValue([card({ title: 'Con Menu' })]);
    renderView();

    await waitFor(() => expect(screen.getByText('Con Menu')).toBeTruthy());
    // The open button must not contain the menu button (no nested interactive).
    const openBtn = screen.getByRole('button', { name: /apri il corso con menu/i });
    expect(openBtn.querySelector('button')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /azioni corso — con menu/i }));
    const menu = screen.getByRole('menu');
    expect(within(menu).getByText('Rinomina')).toBeTruthy();
    expect(within(menu).getByText('Elimina corso')).toBeTruthy();
  });
});

describe('DidatticaView — create and import refresh the library', () => {
  it('creates a course and refreshes the library in place', async () => {
    mockLoadCourseLibrary
      .mockResolvedValueOnce([card({ programId: 'p1', title: 'Esistente' })])
      .mockResolvedValueOnce([
        card({ programId: 'p1', title: 'Esistente' }),
        card({ programId: 'p2', title: 'Nuovo Corso' }),
      ]);
    mockCreateProgram.mockResolvedValue('p2');
    renderView();

    await waitFor(() => expect(screen.getByText('Esistente')).toBeTruthy());
    fireEvent.click(screen.getByText('+ Nuovo corso'));
    fireEvent.change(screen.getByLabelText('Titolo del corso'), {
      target: { value: 'Nuovo Corso' },
    });
    fireEvent.click(screen.getByText('Crea'));

    await waitFor(() => expect(screen.getByText('Nuovo Corso')).toBeTruthy());
    expect(mockCreateProgram).toHaveBeenCalledWith('Nuovo Corso', 'owner-uid', {});
    expect(mockLoadCourseLibrary).toHaveBeenCalledTimes(2);
  });

  it('imports a new course from ZIP (create + import) and refreshes', async () => {
    mockLoadCourseLibrary
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([card({ programId: 'p9', title: 'Importato' })]);
    mockCreateProgram.mockResolvedValue('p9');
    mockReadZipFile.mockResolvedValue([{ path: 'programma.md', text: '' }]);
    mockImportRepository.mockResolvedValue({
      status: 'committed',
      udaCount: 2,
      lessonCount: 5,
      questionCount: 10,
    });
    renderView();

    await waitFor(() => expect(screen.getByText(/nessun corso/i)).toBeTruthy());
    fireEvent.click(screen.getByText('Importa ZIP'));
    fireEvent.change(screen.getByLabelText('Titolo del corso'), {
      target: { value: 'Importato' },
    });
    const file = new File(['zip-bytes'], 'corso.zip', { type: 'application/zip' });
    fireEvent.change(screen.getByLabelText('File ZIP del corso'), { target: { files: [file] } });
    fireEvent.click(screen.getByText('Importa'));

    await waitFor(() => expect(screen.getByText('Importato')).toBeTruthy());
    expect(mockCreateProgram).toHaveBeenCalledWith('Importato', 'owner-uid', {});
    expect(mockImportRepository).toHaveBeenCalledOnce();
    const [input] = mockImportRepository.mock.calls[0] as [
      { programId: string; programmaTitle: string; ownerUid: string },
    ];
    expect(input.programId).toBe('p9');
    expect(input.programmaTitle).toBe('Importato');
    expect(mockLoadCourseLibrary).toHaveBeenCalledTimes(2);
  });

  it('shows the validation error and keeps the dialog open when the ZIP is invalid', async () => {
    mockLoadCourseLibrary.mockResolvedValue([]);
    mockCreateProgram.mockResolvedValue('p9');
    mockReadZipFile.mockResolvedValue([]);
    mockImportRepository.mockResolvedValue({
      status: 'validation_failed',
      validationIssues: [{ code: 'NO_UDAS', path: '', message: 'no udas' }],
    });
    renderView();

    await waitFor(() => expect(screen.getByText(/nessun corso/i)).toBeTruthy());
    fireEvent.click(screen.getByText('Importa ZIP'));
    fireEvent.change(screen.getByLabelText('Titolo del corso'), { target: { value: 'Rotto' } });
    const file = new File(['x'], 'corso.zip', { type: 'application/zip' });
    fireEvent.change(screen.getByLabelText('File ZIP del corso'), { target: { files: [file] } });
    fireEvent.click(screen.getByText('Importa'));

    await waitFor(() => expect(screen.getByText(/validazione fallita/i)).toBeTruthy());
    // Dialog stays open (the title field is still present).
    expect(screen.getByLabelText('File ZIP del corso')).toBeTruthy();
  });
});

describe('DidatticaView — publicLessons backfill notice (DUX-04D)', () => {
  it('hides the notice when the migration is already complete', async () => {
    mockMigrationComplete.mockResolvedValue(true);
    mockLoadCourseLibrary.mockResolvedValue([card()]);
    renderView();
    await waitFor(() => expect(screen.getByText('Sistemi e Reti')).toBeTruthy());
    expect(screen.queryByText(/proiezioni lezione legacy/i)).toBeNull();
  });

  it('shows the notice and runs the backfill when the migration is pending', async () => {
    mockMigrationComplete.mockResolvedValue(false);
    mockBackfill.mockResolvedValue({ analyzed: 3, migrated: 2, skipped: 1, failed: [] });
    mockLoadCourseLibrary.mockResolvedValue([card()]);
    renderView();

    await waitFor(() => expect(screen.getByText(/proiezioni lezione legacy/i)).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /sincronizza proiezioni legacy/i }));

    await waitFor(() => expect(mockBackfill).toHaveBeenCalledOnce());
    // On success the marker flips and the notice disappears.
    await waitFor(() => expect(screen.queryByText(/proiezioni lezione legacy/i)).toBeNull());
  });
});
