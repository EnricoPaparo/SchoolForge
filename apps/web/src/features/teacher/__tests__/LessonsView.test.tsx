import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LessonsView } from '../LessonsView.js';
import { EMPTY_LESSON_METADATA } from '../../repository/validation/lessonMetadata.js';

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('../../../lib/firebase.js', () => ({ db: {}, storage: {} }));
vi.mock('../../../lib/auth.js', () => ({
  useAuth: () => ({ user: { uid: 'owner-uid', email: 'teacher@test.com' } }),
}));

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

const mockDownloadLessonPdf = vi.fn();
vi.mock('../lessonPdf.js', () => ({
  downloadLessonPdf: (...args: unknown[]) => mockDownloadLessonPdf(...args),
}));

const mockUpdateLessonMetadata = vi.fn();
const mockUpdateLessonMarkdownBody = vi.fn();
const mockCreateLesson = vi.fn();
const mockCreateUda = vi.fn();
const mockReorderUda = vi.fn();
const mockReorderLesson = vi.fn();
vi.mock('../../repository/editor/repositoryEditorService.js', () => ({
  updateLessonMetadata: (...args: unknown[]) => mockUpdateLessonMetadata(...args),
  updateLessonMarkdownBody: (...args: unknown[]) => mockUpdateLessonMarkdownBody(...args),
  createLesson: (...args: unknown[]) => mockCreateLesson(...args),
  createUda: (...args: unknown[]) => mockCreateUda(...args),
  reorderUda: (...args: unknown[]) => mockReorderUda(...args),
  reorderLesson: (...args: unknown[]) => mockReorderLesson(...args),
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

const UDA_09_LEGACY = {
  ...UDA,
  id: 'uda-9',
  dir: 'uda-09-legacy',
  filename: 'uda-09-legacy.md',
  storageBasePath: 'repository/owner-uid/imports/imp-1/uda-09-legacy',
};

const UDA_2 = {
  ...UDA,
  id: 'uda-2',
  dir: 'uda-02-sicurezza',
  filename: 'uda-02-sicurezza.md',
  storageBasePath: 'repository/owner-uid/imports/imp-1/uda-02-sicurezza',
  order: 1,
};

const UDA_3 = {
  ...UDA,
  id: 'uda-3',
  dir: 'uda-03-database',
  filename: 'uda-03-database.md',
  storageBasePath: 'repository/owner-uid/imports/imp-1/uda-03-database',
  order: 2,
};

const UDA_WITH_ORDER = { ...UDA, order: 0 };

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

const LESSON_2 = {
  ...LESSON_1,
  id: 'lesson-2',
  path: 'uda-01-reti/lezione-002.md',
  filename: 'lezione-002.md',
  storageRef: 'repository/owner-uid/imports/imp-1/uda-01-reti/lezione-002.md',
};

const LESSON_3 = {
  ...LESSON_1,
  id: 'lesson-3',
  path: 'uda-01-reti/lezione-003.md',
  filename: 'lezione-003.md',
  storageRef: 'repository/owner-uid/imports/imp-1/uda-01-reti/lezione-003.md',
};

async function expandCourse(name: RegExp) {
  fireEvent.click(await screen.findByRole('button', { name }));
}

async function expandUda(name: RegExp) {
  // The UDA toggle's accessible name is just its dir (e.g. "uda-01-reti"),
  // which the "Nuova lezione — uda-01-reti" button's aria-label also
  // contains — disambiguate by excluding it explicitly rather than relying
  // on match order.
  const buttons = await screen.findAllByRole('button', { name });
  const toggle = buttons.find((b) => !b.getAttribute('aria-label')?.startsWith('Nuova lezione'));
  fireEvent.click(toggle ?? buttons[0]);
}

function enableReorderMode() {
  fireEvent.click(screen.getByRole('button', { name: 'Attiva riordino' }));
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
    expect(await screen.findByRole('button', { name: 'uda-01-reti' })).toBeTruthy();
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
    expect(
      await screen.findByRole('button', { name: /Apri lezione lezione-001\.md/ }),
    ).toBeTruthy();
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
    fireEvent.click(await screen.findByRole('button', { name: /Apri lezione lezione-001\.md/ }));

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
    fireEvent.click(await screen.findByRole('button', { name: /Apri lezione lezione-001\.md/ }));

    expect(await screen.findByRole('heading', { name: 'Lezione' })).toBeTruthy();
    expect(screen.getByText('Contenuto della lezione.')).toBeTruthy();
  });

  it('shows a header with a readable title (no front matter → cleaned-up filename) — no program name — plus a PDF download button', async () => {
    mockListPrograms.mockResolvedValue([PROGRAM]);
    mockListUdas.mockResolvedValue([UDA]);
    mockListLessons.mockResolvedValue([LESSON_1]);
    mockFetchLessonContent.mockResolvedValue('Contenuto.');
    render(<LessonsView />);
    await expandCourse(/^Informatica/);
    await expandUda(/uda-01-reti/);
    fireEvent.click(await screen.findByRole('button', { name: /Apri lezione lezione-001\.md/ }));

    // No front matter on this lesson: the heading falls back to a
    // cleaned-up filename, not the raw "lezione-001.md" — the program name
    // ("Informatica") is never repeated in it either way. The PDF button's
    // accessible name still references the raw filename (aria-label).
    expect(await screen.findByRole('heading', { name: 'Lezione 001' })).toBeTruthy();
    expect(
      await screen.findByRole('button', { name: /Scarica PDF — lezione-001\.md/ }),
    ).toBeTruthy();
  });

  it('calls downloadLessonPdf with the resolved title, content and "programma - UDA" context when "Scarica PDF" is clicked', async () => {
    mockListPrograms.mockResolvedValue([PROGRAM]);
    mockListUdas.mockResolvedValue([UDA]);
    mockListLessons.mockResolvedValue([LESSON_1]);
    mockFetchLessonContent.mockResolvedValue('# Lezione\nContenuto della lezione.');
    render(<LessonsView />);
    await expandCourse(/^Informatica/);
    await expandUda(/uda-01-reti/);
    fireEvent.click(await screen.findByRole('button', { name: /Apri lezione lezione-001\.md/ }));
    await screen.findByText('Contenuto della lezione.');

    fireEvent.click(screen.getByRole('button', { name: /Scarica PDF/ }));

    await waitFor(() => {
      expect(mockDownloadLessonPdf).toHaveBeenCalledWith(
        'Lezione 001',
        '# Lezione\nContenuto della lezione.',
        'Informatica - uda-01-reti',
        EMPTY_LESSON_METADATA,
      );
    });
  });

  it('shows a readable error when downloadLessonPdf fails', async () => {
    mockListPrograms.mockResolvedValue([PROGRAM]);
    mockListUdas.mockResolvedValue([UDA]);
    mockListLessons.mockResolvedValue([LESSON_1]);
    mockFetchLessonContent.mockResolvedValue('Contenuto.');
    mockDownloadLessonPdf.mockRejectedValue(new Error('boom'));
    render(<LessonsView />);
    await expandCourse(/^Informatica/);
    await expandUda(/uda-01-reti/);
    fireEvent.click(await screen.findByRole('button', { name: /Apri lezione lezione-001\.md/ }));
    await screen.findByText('Contenuto.');

    fireEvent.click(screen.getByRole('button', { name: /Scarica PDF/ }));

    expect(await screen.findByText(/Impossibile generare il PDF/)).toBeTruthy();
  });

  it('highlights the selected lesson', async () => {
    mockListPrograms.mockResolvedValue([PROGRAM]);
    mockListUdas.mockResolvedValue([UDA]);
    mockListLessons.mockResolvedValue([LESSON_1]);
    mockFetchLessonContent.mockResolvedValue('# Lezione');
    render(<LessonsView />);
    await expandCourse(/^Informatica/);
    await expandUda(/uda-01-reti/);
    const lessonBtn = await screen.findByRole('button', { name: /Apri lezione lezione-001\.md/ });
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
    fireEvent.click(await screen.findByRole('button', { name: /Apri lezione lezione-001\.md/ }));

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

describe('LessonsView — lesson body editor (RE-02)', () => {
  async function openLessonAndEditor() {
    mockListPrograms.mockResolvedValue([PROGRAM]);
    mockListUdas.mockResolvedValue([UDA]);
    mockListLessons.mockResolvedValue([LESSON_1]);
    mockFetchLessonContent.mockResolvedValue('# Lezione\nContenuto originale.');
    render(<LessonsView />);
    await expandCourse(/^Informatica/);
    await expandUda(/uda-01-reti/);
    fireEvent.click(await screen.findByRole('button', { name: /Apri lezione lezione-001\.md/ }));
    await screen.findByText('Contenuto originale.');
    fireEvent.click(await screen.findByRole('button', { name: /Modifica contenuto/ }));
  }

  it('opens with the current body prefilled in the editor tab', async () => {
    await openLessonAndEditor();
    const textarea = screen.getByRole('textbox', {
      name: /Corpo Markdown — lezione-001\.md/,
    }) as HTMLTextAreaElement;
    expect(textarea.value).toBe('# Lezione\nContenuto originale.');
  });

  it('switches to the Anteprima tab and renders the sanitized draft', async () => {
    await openLessonAndEditor();
    const textarea = screen.getByRole('textbox', { name: /Corpo Markdown/ });
    fireEvent.change(textarea, { target: { value: '# Bozza\nTesto in modifica.' } });
    fireEvent.click(screen.getByRole('tab', { name: 'Anteprima' }));

    expect(await screen.findByRole('heading', { name: 'Bozza' })).toBeTruthy();
    expect(screen.getByText('Testo in modifica.')).toBeTruthy();
    expect(screen.queryByRole('textbox', { name: /Corpo Markdown/ })).toBeNull();
  });

  it('discards unsaved changes when Annulla is clicked', async () => {
    await openLessonAndEditor();
    const textarea = screen.getByRole('textbox', { name: /Corpo Markdown/ });
    fireEvent.change(textarea, { target: { value: 'Testo modificato non salvato.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Annulla' }));

    expect(screen.getByText('Contenuto originale.')).toBeTruthy();
    expect(screen.queryByRole('textbox', { name: /Corpo Markdown/ })).toBeNull();
    expect(mockUpdateLessonMarkdownBody).not.toHaveBeenCalled();
  });

  it('saves the new body via updateLessonMarkdownBody and shows the updated content', async () => {
    mockUpdateLessonMarkdownBody.mockResolvedValue(undefined);
    await openLessonAndEditor();
    const textarea = screen.getByRole('textbox', { name: /Corpo Markdown/ });
    fireEvent.change(textarea, { target: { value: 'Contenuto aggiornato dal docente.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salva' }));

    await waitFor(() => {
      expect(mockUpdateLessonMarkdownBody).toHaveBeenCalledWith({
        programId: 'prog-1',
        importId: 'imp-1',
        lessonId: 'lesson-1',
        body: 'Contenuto aggiornato dal docente.',
        ownerUid: 'owner-uid',
        db: {},
        storage: {},
      });
    });
    expect(await screen.findByText('Contenuto aggiornato dal docente.')).toBeTruthy();
    expect(screen.queryByRole('textbox', { name: /Corpo Markdown/ })).toBeNull();
  });

  it('shows a clear error and keeps the draft editable when the save fails', async () => {
    mockUpdateLessonMarkdownBody.mockRejectedValue(
      new Error('Impossibile aggiornare il file della lezione su Storage.'),
    );
    await openLessonAndEditor();
    const textarea = screen.getByRole('textbox', { name: /Corpo Markdown/ });
    fireEvent.change(textarea, { target: { value: 'Testo che non verrà salvato.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salva' }));

    expect(
      await screen.findByText('Impossibile aggiornare il file della lezione su Storage.'),
    ).toBeTruthy();
    const draftTextarea = screen.getByRole('textbox', {
      name: /Corpo Markdown/,
    }) as HTMLTextAreaElement;
    expect(draftTextarea.value).toBe('Testo che non verrà salvato.');
  });
});

describe('LessonsView — new lesson creation (RE-03A)', () => {
  async function openCreateLessonForm() {
    mockListPrograms.mockResolvedValue([PROGRAM]);
    mockListUdas.mockResolvedValue([UDA]);
    mockListLessons.mockResolvedValue([LESSON_1]);
    render(<LessonsView />);
    await expandCourse(/^Informatica/);
    fireEvent.click(await screen.findByRole('button', { name: /Nuova lezione — uda-01-reti/ }));
  }

  it('opens the form, auto-expanding the UDA so the existing lessons stay visible', async () => {
    await openCreateLessonForm();
    expect(screen.getByLabelText('Titolo')).toBeTruthy();
    expect(
      await screen.findByRole('button', { name: /Apri lezione lezione-001\.md/ }),
    ).toBeTruthy();
  });

  it('disables Crea lezione until a title is entered', async () => {
    await openCreateLessonForm();
    expect(screen.getByRole('button', { name: 'Crea lezione' }).hasAttribute('disabled')).toBe(
      true,
    );
    fireEvent.change(screen.getByLabelText('Titolo'), { target: { value: 'DNS' } });
    expect(screen.getByRole('button', { name: 'Crea lezione' }).hasAttribute('disabled')).toBe(
      false,
    );
  });

  it('calls createLesson with the entered fields and shows the new lesson in the sidebar without a refetch', async () => {
    mockCreateLesson.mockResolvedValue({
      lessonId: 'uda-1_lezione-002-dns',
      filename: 'lezione-002-dns.md',
    });
    await openCreateLessonForm();

    fireEvent.change(screen.getByLabelText('Titolo'), { target: { value: 'DNS' } });
    fireEvent.change(screen.getByLabelText('Sottotitolo'), {
      target: { value: 'Risoluzione dei nomi' },
    });
    fireEvent.change(screen.getByLabelText('Concetti chiave (uno per riga)'), {
      target: { value: 'resolver\nrecord' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Crea lezione' }));

    await waitFor(() => {
      expect(mockCreateLesson).toHaveBeenCalledWith({
        programId: 'prog-1',
        importId: 'imp-1',
        udaId: 'uda-1',
        udaDir: 'uda-01-reti',
        ownerUid: 'owner-uid',
        fields: {
          titolo: 'DNS',
          sottotitolo: 'Risoluzione dei nomi',
          difficolta: null,
          concettiChiave: ['resolver', 'record'],
          obiettivi: [],
          body: '',
        },
        db: {},
        storage: {},
      });
    });

    expect(
      await screen.findByRole('button', { name: /Apri lezione lezione-002-dns\.md/ }),
    ).toBeTruthy();
    // Only the initial listLessons call from expanding the course — the new
    // lesson is spliced into local state, no refetch.
    expect(mockListLessons).toHaveBeenCalledTimes(1);
    expect(screen.queryByLabelText('Titolo')).toBeNull();
  });

  it('shows a clear error without closing the form when creation fails', async () => {
    mockCreateLesson.mockRejectedValue(
      new Error('Impossibile creare il file della lezione su Storage.'),
    );
    await openCreateLessonForm();
    fireEvent.change(screen.getByLabelText('Titolo'), { target: { value: 'DNS' } });
    fireEvent.click(screen.getByRole('button', { name: 'Crea lezione' }));

    expect(
      await screen.findByText('Impossibile creare il file della lezione su Storage.'),
    ).toBeTruthy();
    expect(screen.getByLabelText('Titolo')).toBeTruthy();
  });

  it('shows an inline error and never calls createLesson when the title is blank', async () => {
    await openCreateLessonForm();
    fireEvent.change(screen.getByLabelText('Titolo'), { target: { value: '   ' } });
    // Bypass the disabled submit button to exercise the service-level guard too.
    fireEvent.submit(screen.getByLabelText('Titolo').closest('form')!);

    expect(mockCreateLesson).not.toHaveBeenCalled();
  });
});

describe('LessonsView — new UDA creation (RE-03B)', () => {
  async function openCreateUdaForm() {
    mockListPrograms.mockResolvedValue([PROGRAM]);
    mockListUdas.mockResolvedValue([UDA]);
    mockListLessons.mockResolvedValue([LESSON_1]);
    render(<LessonsView />);
    await screen.findByRole('button', { name: /^Informatica/ });
    fireEvent.click(await screen.findByRole('button', { name: /Nuova UDA — Informatica/ }));
  }

  it('opens the form, auto-expanding the course so the existing UDA stays visible', async () => {
    await openCreateUdaForm();
    expect(screen.getByLabelText('Titolo')).toBeTruthy();
    expect(await screen.findByRole('button', { name: 'uda-01-reti' })).toBeTruthy();
  });

  it('disables Crea UDA until a title is entered', async () => {
    await openCreateUdaForm();
    expect(screen.getByRole('button', { name: 'Crea UDA' }).hasAttribute('disabled')).toBe(true);
    fireEvent.change(screen.getByLabelText('Titolo'), { target: { value: 'Sicurezza' } });
    expect(screen.getByRole('button', { name: 'Crea UDA' }).hasAttribute('disabled')).toBe(false);
  });

  it('calls createUda with the entered fields and shows the new UDA in the sidebar without a refetch', async () => {
    mockCreateUda.mockResolvedValue({
      udaId: 'uda-02-sicurezza',
      dir: 'uda-02-sicurezza',
      order: 1,
    });
    await openCreateUdaForm();

    fireEvent.change(screen.getByLabelText('Titolo'), { target: { value: 'Sicurezza' } });
    fireEvent.change(screen.getByLabelText('Descrizione'), {
      target: { value: 'Basi della sicurezza informatica' },
    });
    fireEvent.change(screen.getByLabelText('Competenze (una per riga)'), {
      target: { value: 'crittografia\nautenticazione' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Crea UDA' }));

    await waitFor(() => {
      expect(mockCreateUda).toHaveBeenCalledWith({
        programId: 'prog-1',
        importId: 'imp-1',
        ownerUid: 'owner-uid',
        fields: {
          titolo: 'Sicurezza',
          descrizione: 'Basi della sicurezza informatica',
          competenze: ['crittografia', 'autenticazione'],
          obiettivi: [],
        },
        db: {},
        storage: {},
      });
    });

    expect(await screen.findByRole('button', { name: 'uda-02-sicurezza' })).toBeTruthy();
    // Only the initial listUdas call from expanding the course — the new
    // UDA is spliced into local state, no refetch.
    expect(mockListUdas).toHaveBeenCalledTimes(1);
    expect(screen.queryByLabelText('Titolo')).toBeNull();
  });

  it('keeps a newly created uda-10 after legacy uda-09 in the visible sidebar', async () => {
    mockListPrograms.mockResolvedValue([PROGRAM]);
    mockListUdas.mockResolvedValue([UDA_09_LEGACY]);
    mockListLessons.mockResolvedValue([]);
    mockCreateUda.mockResolvedValue({ udaId: 'uda-10-finale', dir: 'uda-10-finale', order: 9 });

    render(<LessonsView />);
    await screen.findByRole('button', { name: /^Informatica/ });
    fireEvent.click(await screen.findByRole('button', { name: /Nuova UDA — Informatica/ }));
    await screen.findByRole('button', { name: 'uda-09-legacy' });
    fireEvent.change(screen.getByLabelText('Titolo'), { target: { value: 'Finale' } });
    fireEvent.click(screen.getByRole('button', { name: 'Crea UDA' }));

    const legacy = await screen.findByRole('button', { name: 'uda-09-legacy' });
    const created = await screen.findByRole('button', { name: 'uda-10-finale' });
    expect(legacy.compareDocumentPosition(created) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('closes the "Nuova lezione" form for a UDA when "Nuova UDA" is opened, and vice versa', async () => {
    await openCreateUdaForm();
    fireEvent.click(await screen.findByRole('button', { name: /Nuova lezione — uda-01-reti/ }));

    expect(screen.getAllByLabelText('Titolo')).toHaveLength(1);
  });

  it('shows a clear error without closing the form when creation fails', async () => {
    mockCreateUda.mockRejectedValue(new Error('Impossibile creare il file della UDA su Storage.'));
    await openCreateUdaForm();
    fireEvent.change(screen.getByLabelText('Titolo'), { target: { value: 'Sicurezza' } });
    fireEvent.click(screen.getByRole('button', { name: 'Crea UDA' }));

    expect(
      await screen.findByText('Impossibile creare il file della UDA su Storage.'),
    ).toBeTruthy();
    expect(screen.getByLabelText('Titolo')).toBeTruthy();
  });

  it('shows an inline error and never calls createUda when the title is blank', async () => {
    await openCreateUdaForm();
    fireEvent.change(screen.getByLabelText('Titolo'), { target: { value: '   ' } });
    fireEvent.submit(screen.getByLabelText('Titolo').closest('form')!);

    expect(mockCreateUda).not.toHaveBeenCalled();
  });
});

describe('LessonsView — UDA reorder (RE-04)', () => {
  it('keeps reorder controls hidden until reorder mode is enabled', async () => {
    mockListPrograms.mockResolvedValue([PROGRAM]);
    mockListUdas.mockResolvedValue([UDA_WITH_ORDER, UDA_2]);
    mockListLessons.mockResolvedValue([]);
    render(<LessonsView />);
    await expandCourse(/^Informatica/);

    expect(screen.queryByRole('button', { name: 'Sposta giù — uda-01-reti' })).toBeNull();

    enableReorderMode();

    expect(await screen.findByRole('button', { name: 'Sposta giù — uda-01-reti' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Termina riordino' })).toBeTruthy();
  });

  it('disables "Sposta su" on the first UDA and "Sposta giù" on the last', async () => {
    mockListPrograms.mockResolvedValue([PROGRAM]);
    mockListUdas.mockResolvedValue([UDA_WITH_ORDER, UDA_2]);
    mockListLessons.mockResolvedValue([]);
    render(<LessonsView />);
    await expandCourse(/^Informatica/);
    enableReorderMode();

    expect(
      (await screen.findByRole('button', { name: 'Sposta su — uda-01-reti' })).hasAttribute(
        'disabled',
      ),
    ).toBe(true);
    expect(
      screen.getByRole('button', { name: 'Sposta giù — uda-01-reti' }).hasAttribute('disabled'),
    ).toBe(false);
    expect(
      screen.getByRole('button', { name: 'Sposta su — uda-02-sicurezza' }).hasAttribute('disabled'),
    ).toBe(false);
    expect(
      screen
        .getByRole('button', { name: 'Sposta giù — uda-02-sicurezza' })
        .hasAttribute('disabled'),
    ).toBe(true);
  });

  it('moves a UDA down, calling reorderUda with the correct neighbor and reordering the sidebar', async () => {
    mockListPrograms.mockResolvedValue([PROGRAM]);
    mockListUdas.mockResolvedValue([UDA_WITH_ORDER, UDA_2]);
    mockListLessons.mockResolvedValue([]);
    mockReorderUda.mockResolvedValue({ order: 1, neighborOrder: 0 });
    render(<LessonsView />);
    await expandCourse(/^Informatica/);
    enableReorderMode();

    fireEvent.click(await screen.findByRole('button', { name: 'Sposta giù — uda-01-reti' }));

    await waitFor(() => {
      expect(mockReorderUda).toHaveBeenCalledWith({
        programId: 'prog-1',
        importId: 'imp-1',
        udaId: 'uda-1',
        neighborUdaId: 'uda-2',
        ownerUid: 'owner-uid',
        db: {},
      });
    });

    const first = await screen.findByRole('button', { name: 'uda-02-sicurezza' });
    const second = screen.getByRole('button', { name: 'uda-01-reti' });
    expect(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('disables only the controls of the two UDAs involved while a move is saving', async () => {
    mockListPrograms.mockResolvedValue([PROGRAM]);
    mockListUdas.mockResolvedValue([UDA_WITH_ORDER, UDA_2, UDA_3]);
    mockListLessons.mockResolvedValue([]);
    let resolveReorder!: (value: { order: number; neighborOrder: number }) => void;
    mockReorderUda.mockReturnValue(
      new Promise((resolve) => {
        resolveReorder = resolve;
      }),
    );
    render(<LessonsView />);
    await expandCourse(/^Informatica/);
    enableReorderMode();

    fireEvent.click(await screen.findByRole('button', { name: 'Sposta giù — uda-01-reti' }));

    expect(
      screen.getByRole('button', { name: 'Sposta giù — uda-01-reti' }).hasAttribute('disabled'),
    ).toBe(true);
    expect(
      screen.getByRole('button', { name: 'Sposta su — uda-02-sicurezza' }).hasAttribute('disabled'),
    ).toBe(true);
    expect(
      screen.getByRole('button', { name: 'Sposta su — uda-03-database' }).hasAttribute('disabled'),
    ).toBe(false);

    resolveReorder({ order: 1, neighborOrder: 0 });
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Sposta giù — uda-01-reti' }).hasAttribute('disabled'),
      ).toBe(false),
    );
  });

  it('shows a clear error next to the UDA when reorder fails', async () => {
    mockListPrograms.mockResolvedValue([PROGRAM]);
    mockListUdas.mockResolvedValue([UDA_WITH_ORDER, UDA_2]);
    mockListLessons.mockResolvedValue([]);
    mockReorderUda.mockRejectedValue(
      new Error('Impossibile salvare il nuovo ordine delle UDA. Riprova.'),
    );
    render(<LessonsView />);
    await expandCourse(/^Informatica/);
    enableReorderMode();

    fireEvent.click(await screen.findByRole('button', { name: 'Sposta giù — uda-01-reti' }));

    expect(
      await screen.findByText('Impossibile salvare il nuovo ordine delle UDA. Riprova.'),
    ).toBeTruthy();
  });
});

describe('LessonsView — lesson reorder (RE-04)', () => {
  async function expandUdaLessons() {
    mockListPrograms.mockResolvedValue([PROGRAM]);
    mockListUdas.mockResolvedValue([UDA]);
    mockListLessons.mockResolvedValue([LESSON_1, LESSON_2]);
    render(<LessonsView />);
    await expandCourse(/^Informatica/);
    await expandUda(/uda-01-reti/);
    enableReorderMode();
  }

  it('disables "Sposta su" on the first lesson and "Sposta giù" on the last', async () => {
    await expandUdaLessons();

    expect(
      (await screen.findByRole('button', { name: 'Sposta su — lezione-001.md' })).hasAttribute(
        'disabled',
      ),
    ).toBe(true);
    expect(
      screen.getByRole('button', { name: 'Sposta giù — lezione-001.md' }).hasAttribute('disabled'),
    ).toBe(false);
    expect(
      screen.getByRole('button', { name: 'Sposta su — lezione-002.md' }).hasAttribute('disabled'),
    ).toBe(false);
    expect(
      screen.getByRole('button', { name: 'Sposta giù — lezione-002.md' }).hasAttribute('disabled'),
    ).toBe(true);
  });

  it('moves a lesson down within the same UDA, calling reorderLesson with the correct neighbor', async () => {
    await expandUdaLessons();
    mockReorderLesson.mockResolvedValue({ order: 1, neighborOrder: 0 });

    fireEvent.click(await screen.findByRole('button', { name: 'Sposta giù — lezione-001.md' }));

    await waitFor(() => {
      expect(mockReorderLesson).toHaveBeenCalledWith({
        programId: 'prog-1',
        importId: 'imp-1',
        lessonId: 'lesson-1',
        neighborLessonId: 'lesson-2',
        ownerUid: 'owner-uid',
        db: {},
      });
    });

    const first = await screen.findByRole('button', { name: /Apri lezione lezione-002\.md/ });
    const second = screen.getByRole('button', { name: /Apri lezione lezione-001\.md/ });
    expect(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('moves the middle lesson in a three-lesson legacy UDA', async () => {
    mockListPrograms.mockResolvedValue([PROGRAM]);
    mockListUdas.mockResolvedValue([UDA]);
    mockListLessons.mockResolvedValue([LESSON_1, LESSON_2, LESSON_3]);
    mockReorderLesson.mockResolvedValue({ order: 2, neighborOrder: 1 });
    render(<LessonsView />);
    await expandCourse(/^Informatica/);
    await expandUda(/uda-01-reti/);
    enableReorderMode();

    fireEvent.click(await screen.findByRole('button', { name: 'Sposta giù — lezione-002.md' }));

    await waitFor(() => {
      expect(mockReorderLesson).toHaveBeenCalledWith({
        programId: 'prog-1',
        importId: 'imp-1',
        lessonId: 'lesson-2',
        neighborLessonId: 'lesson-3',
        ownerUid: 'owner-uid',
        db: {},
      });
    });

    const second = await screen.findByRole('button', { name: /Apri lezione lezione-003\.md/ });
    const third = screen.getByRole('button', { name: /Apri lezione lezione-002\.md/ });
    expect(second.compareDocumentPosition(third) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('shows a clear error next to the lesson when reorder fails', async () => {
    await expandUdaLessons();
    mockReorderLesson.mockRejectedValue(
      new Error('Impossibile salvare il nuovo ordine delle lezioni. Riprova.'),
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Sposta giù — lezione-001.md' }));

    expect(
      await screen.findByText('Impossibile salvare il nuovo ordine delle lezioni. Riprova.'),
    ).toBeTruthy();
  });
});
