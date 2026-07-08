/**
 * M1 Integration Smoke Tests
 *
 * Exercises the full M1 flow at the component/service boundary using mocks.
 * No real Firebase is used. All service modules are mocked.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProgramsView } from '../ProgramsView.js';
import { TeacherShell } from '../TeacherShell.js';

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('../../../lib/firebase.js', () => ({ db: {}, storage: {} }));
vi.mock('../../../lib/auth.js', () => ({
  useAuth: () => ({
    user: { uid: 'owner-uid', displayName: 'Docente Test', email: 'docente@test.com' },
    signOut: vi.fn(),
  }),
}));

const mockListPrograms = vi.fn();
const mockListUdas = vi.fn();
const mockListLessons = vi.fn();
const mockSetLessonCompleted = vi.fn();
const mockCreateProgram = vi.fn();
const mockUpdateProgramTitle = vi.fn();

vi.mock('../../../features/repository/programs/programsService.js', () => ({
  listPrograms: (...args: unknown[]) => mockListPrograms(...args),
  listUdas: (...args: unknown[]) => mockListUdas(...args),
  listLessons: (...args: unknown[]) => mockListLessons(...args),
  setLessonCompleted: (...args: unknown[]) => mockSetLessonCompleted(...args),
  createProgram: (...args: unknown[]) => mockCreateProgram(...args),
  updateProgramTitle: (...args: unknown[]) => mockUpdateProgramTitle(...args),
}));

const mockExportZip = vi.fn();
vi.mock('../exportZip.js', () => ({
  exportZip: (...args: unknown[]) => mockExportZip(...args),
}));

const mockGenerateMarkdown = vi.fn().mockReturnValue('# Programma svolto');
const mockDownloadMarkdown = vi.fn();
const mockDownloadPdf = vi.fn().mockResolvedValue(undefined);
vi.mock('../programmaSvolto.js', () => ({
  generateMarkdown: (...args: unknown[]) => mockGenerateMarkdown(...args),
  downloadMarkdown: (...args: unknown[]) => mockDownloadMarkdown(...args),
  downloadPdf: (...args: unknown[]) => mockDownloadPdf(...args),
}));

const mockDownloadTemplate = vi.fn();
const mockDownloadKitZip = vi.fn().mockResolvedValue(undefined);
vi.mock('../templateKit.js', () => ({
  TEMPLATES: [
    { filename: 'programma-template.md', name: 'Programma' },
    { filename: 'uda-template.md', name: 'UDA' },
    { filename: 'lezione-template.md', name: 'Lezione' },
    { filename: 'pool-template.pool.md', name: 'Pool domande' },
  ],
  downloadTemplate: (...args: unknown[]) => mockDownloadTemplate(...args),
  downloadKitZip: (...args: unknown[]) => mockDownloadKitZip(...args),
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

const UDA = {
  id: 'uda-1',
  ownerUid: 'owner-uid',
  importId: 'imp-1',
  dir: 'uda-01-reti',
  filename: 'uda-01-reti.md',
  storageBasePath: 'repository/owner-uid/imports/imp-1/uda-01-reti',
  lessonCount: 2,
};

const LESSON_COMPLETED = {
  id: 'lesson-1',
  ownerUid: 'owner-uid',
  importId: 'imp-1',
  udaDir: 'uda-01-reti',
  path: 'uda-01-reti/lezione-001.md',
  filename: 'lezione-001.md',
  poolStatus: 'valid' as const,
  questionCount: 3,
  storageRef: 'repository/owner-uid/imports/imp-1/uda-01-reti/lezione-001.md',
  poolStorageRef: 'repository/owner-uid/imports/imp-1/uda-01-reti/lezione-001.pool.md',
  completed: true,
};

const LESSON_INCOMPLETE = {
  ...LESSON_COMPLETED,
  id: 'lesson-2',
  filename: 'lezione-002.md',
  storageRef: 'repository/owner-uid/imports/imp-1/uda-01-reti/lezione-002.md',
  poolStorageRef: null,
  poolStatus: 'none' as const,
  questionCount: 0,
  completed: false,
};

async function expandCourse(name: RegExp) {
  fireEvent.click(await screen.findByRole('button', { name }));
}

async function expandUda(name: RegExp) {
  fireEvent.click(await screen.findByRole('button', { name }));
}

// ─── 1. ProgramsView renders program list ────────────────────────────────────

describe('M1 Integration — ProgramsView renders program list', () => {
  it('shows a program that has activeImportId', async () => {
    mockListPrograms.mockResolvedValue([PROGRAM]);
    mockListUdas.mockResolvedValue([]);
    mockListLessons.mockResolvedValue([]);
    render(<ProgramsView />);
    expect(await screen.findByRole('button', { name: /^Informatica/ })).toBeTruthy();
  });
});

// ─── 2. UDA load on course expand ────────────────────────────────────────────

describe('M1 Integration — UDA load on course expand', () => {
  it('calls listUdas when a course is expanded', async () => {
    mockListPrograms.mockResolvedValue([PROGRAM]);
    mockListUdas.mockResolvedValue([UDA]);
    mockListLessons.mockResolvedValue([LESSON_COMPLETED, LESSON_INCOMPLETE]);
    render(<ProgramsView />);
    await expandCourse(/^Informatica/);
    await waitFor(() => {
      expect(mockListUdas).toHaveBeenCalledWith('prog-1', 'imp-1', {});
    });
    expect(await screen.findByRole('button', { name: /uda-01-reti/ })).toBeTruthy();
  });
});

// ─── 3. Lesson load on UDA expand ────────────────────────────────────────────

describe('M1 Integration — Lesson load on UDA expand', () => {
  it('shows lessons when the UDA is expanded', async () => {
    mockListPrograms.mockResolvedValue([PROGRAM]);
    mockListUdas.mockResolvedValue([UDA]);
    mockListLessons.mockResolvedValue([LESSON_COMPLETED, LESSON_INCOMPLETE]);
    render(<ProgramsView />);
    await expandCourse(/^Informatica/);
    await expandUda(/uda-01-reti/);
    expect(await screen.findByText('lezione-001.md')).toBeTruthy();
    expect(screen.getByText('lezione-002.md')).toBeTruthy();
    expect(mockListLessons).toHaveBeenCalled();
  });
});

// ─── 4. Lessons in Corsi do not open a Markdown viewer ───────────────────────

describe('M1 Integration — Lessons in Corsi stay structural (no Markdown viewer)', () => {
  it('renders lesson filenames as plain rows, not clickable content openers', async () => {
    mockListPrograms.mockResolvedValue([PROGRAM]);
    mockListUdas.mockResolvedValue([UDA]);
    mockListLessons.mockResolvedValue([LESSON_COMPLETED]);
    render(<ProgramsView />);
    await expandCourse(/^Informatica/);
    await expandUda(/uda-01-reti/);
    await screen.findByText('lezione-001.md');
    expect(screen.queryByRole('button', { name: 'lezione-001.md' })).toBeNull();
    expect(document.querySelector('.prose')).toBeNull();
  });
});

// ─── 5. Toggle lesson completed ──────────────────────────────────────────────

describe('M1 Integration — Toggle lesson completed', () => {
  it('calls setLessonCompleted and updates checkbox on toggle', async () => {
    mockListPrograms.mockResolvedValue([PROGRAM]);
    mockListUdas.mockResolvedValue([UDA]);
    mockListLessons.mockResolvedValue([LESSON_INCOMPLETE]);
    mockSetLessonCompleted.mockResolvedValue(undefined);
    render(<ProgramsView />);
    await expandCourse(/^Informatica/);
    await expandUda(/uda-01-reti/);
    await screen.findByText('lezione-002.md');

    const checkbox = screen.getByRole('checkbox') as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
    fireEvent.click(checkbox);

    await waitFor(() => {
      expect(mockSetLessonCompleted).toHaveBeenCalledWith(
        'prog-1',
        'imp-1',
        'lesson-2',
        true,
        'owner-uid',
        {},
      );
    });
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true);
  });
});

// ─── 6. Export ZIP action present ────────────────────────────────────────────

describe('M1 Integration — Export ZIP action present', () => {
  it('shows Esporta ZIP icon action when program has activeImportId', async () => {
    mockListPrograms.mockResolvedValue([PROGRAM]);
    mockListUdas.mockResolvedValue([UDA]);
    mockListLessons.mockResolvedValue([]);
    render(<ProgramsView />);
    await screen.findByRole('button', { name: /^Informatica/ });
    expect(await screen.findByRole('button', { name: /Esporta ZIP/ })).toBeTruthy();
  });
});

// ─── 7. Programma svolto actions present ─────────────────────────────────────

describe('M1 Integration — Programma svolto actions present', () => {
  it('shows Programma svolto (MD) and (PDF) icon actions', async () => {
    mockListPrograms.mockResolvedValue([PROGRAM]);
    mockListUdas.mockResolvedValue([UDA]);
    mockListLessons.mockResolvedValue([]);
    render(<ProgramsView />);
    await screen.findByRole('button', { name: /^Informatica/ });
    expect(await screen.findByRole('button', { name: /Programma svolto \(MD\)/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Programma svolto \(PDF\)/ })).toBeTruthy();
  });
});

// ─── 8. Readiness dashboard no longer shown as a separate card ──────────────

describe('M1 Integration — Readiness no longer a separate card in Corsi', () => {
  it('does not render the readiness dashboard region; state is in course counters', async () => {
    mockListPrograms.mockResolvedValue([PROGRAM]);
    mockListUdas.mockResolvedValue([UDA]);
    mockListLessons.mockResolvedValue([LESSON_COMPLETED]);
    render(<ProgramsView />);
    await screen.findByRole('button', { name: /^Informatica/ });
    await waitFor(() => expect(screen.getByText(/UDA: 1/)).toBeTruthy());
    expect(screen.queryByRole('region', { name: 'Dashboard di prontezza' })).toBeNull();
  });
});

// ─── 9. TemplateKitView shows download buttons in TeacherShell ───────────────

describe('M1 Integration — TemplateKitView shows download buttons in TeacherShell', () => {
  it('renders template download buttons in the repository section', async () => {
    mockListPrograms.mockResolvedValue([]);
    render(<TeacherShell />);
    fireEvent.click(await screen.findByRole('button', { name: 'Template' }));
    // Kit template region
    expect(await screen.findByRole('region', { name: 'Kit template' })).toBeTruthy();
    // Individual template download buttons from the mocked TEMPLATES
    expect(screen.getByRole('button', { name: /Scarica template Programma/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Scarica template UDA/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Scarica template Lezione/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Scarica template Pool domande/ })).toBeTruthy();
    // Kit ZIP button
    expect(screen.getByRole('button', { name: 'Scarica kit completo (ZIP)' })).toBeTruthy();
  });
});
