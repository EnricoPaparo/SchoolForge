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

const mockFetchLessonContent = vi.fn();
vi.mock('../lessonContent.js', () => ({
  fetchLessonContent: (...args: unknown[]) => mockFetchLessonContent(...args),
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

// ─── 1. ProgramsView renders program list ────────────────────────────────────

describe('M1 Integration — ProgramsView renders program list', () => {
  it('shows a program that has activeImportId', async () => {
    mockListPrograms.mockResolvedValue([PROGRAM]);
    mockListUdas.mockResolvedValue([]);
    render(<ProgramsView />);
    expect(await screen.findByRole('button', { name: 'Informatica' })).toBeTruthy();
  });
});

// ─── 2. UDA load on program select ───────────────────────────────────────────

describe('M1 Integration — UDA load on program select', () => {
  it('calls listUdas when a program is clicked', async () => {
    mockListPrograms.mockResolvedValue([PROGRAM]);
    mockListUdas.mockResolvedValue([UDA]);
    mockListLessons.mockResolvedValue([LESSON_COMPLETED, LESSON_INCOMPLETE]);
    render(<ProgramsView />);
    fireEvent.click(await screen.findByRole('button', { name: 'Informatica' }));
    await waitFor(() => {
      expect(mockListUdas).toHaveBeenCalledWith('prog-1', 'imp-1', {});
    });
    expect(await screen.findByRole('button', { name: 'uda-01-reti' })).toBeTruthy();
  });
});

// ─── 3. Lesson load on UDA select ────────────────────────────────────────────

describe('M1 Integration — Lesson load on UDA select', () => {
  it('calls listLessons and shows lessons when UDA is clicked', async () => {
    mockListPrograms.mockResolvedValue([PROGRAM]);
    mockListUdas.mockResolvedValue([UDA]);
    mockListLessons.mockResolvedValue([LESSON_COMPLETED, LESSON_INCOMPLETE]);
    render(<ProgramsView />);
    fireEvent.click(await screen.findByRole('button', { name: 'Informatica' }));
    fireEvent.click(await screen.findByRole('button', { name: 'uda-01-reti' }));
    expect(await screen.findByRole('button', { name: 'lezione-001.md' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'lezione-002.md' })).toBeTruthy();
    expect(mockListLessons).toHaveBeenCalled();
  });
});

// ─── 4. Lesson content rendering ─────────────────────────────────────────────

describe('M1 Integration — Lesson content rendering', () => {
  it('fetches lesson content and renders MarkdownRenderer when lesson is selected', async () => {
    mockListPrograms.mockResolvedValue([PROGRAM]);
    mockListUdas.mockResolvedValue([UDA]);
    mockListLessons.mockResolvedValue([LESSON_COMPLETED]);
    mockFetchLessonContent.mockResolvedValue('# Lezione\nContenuto di test.');
    render(<ProgramsView />);
    fireEvent.click(await screen.findByRole('button', { name: 'Informatica' }));
    fireEvent.click(await screen.findByRole('button', { name: 'uda-01-reti' }));
    fireEvent.click(await screen.findByRole('button', { name: 'lezione-001.md' }));
    await waitFor(() => {
      expect(mockFetchLessonContent).toHaveBeenCalledWith(LESSON_COMPLETED.storageRef, {});
    });
    // MarkdownRenderer should render an h1 from the markdown
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Lezione' })).toBeTruthy();
    });
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
    fireEvent.click(await screen.findByRole('button', { name: 'Informatica' }));
    fireEvent.click(await screen.findByRole('button', { name: 'uda-01-reti' }));
    await screen.findByRole('button', { name: 'lezione-002.md' });

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

// ─── 6. Export ZIP button present ────────────────────────────────────────────

describe('M1 Integration — Export ZIP button present', () => {
  it('shows Esporta ZIP button when program has activeImportId', async () => {
    mockListPrograms.mockResolvedValue([PROGRAM]);
    mockListUdas.mockResolvedValue([UDA]);
    mockListLessons.mockResolvedValue([]);
    render(<ProgramsView />);
    fireEvent.click(await screen.findByRole('button', { name: 'Informatica' }));
    expect(await screen.findByRole('button', { name: 'Esporta ZIP' })).toBeTruthy();
  });
});

// ─── 7. Programma svolto buttons present ─────────────────────────────────────

describe('M1 Integration — Programma svolto buttons present', () => {
  it('shows Programma svolto (MD) and (PDF) buttons', async () => {
    mockListPrograms.mockResolvedValue([PROGRAM]);
    mockListUdas.mockResolvedValue([UDA]);
    mockListLessons.mockResolvedValue([]);
    render(<ProgramsView />);
    fireEvent.click(await screen.findByRole('button', { name: 'Informatica' }));
    expect(await screen.findByRole('button', { name: 'Programma svolto (MD)' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Programma svolto (PDF)' })).toBeTruthy();
  });
});

// ─── 8. ReadinessView shows status ───────────────────────────────────────────

describe('M1 Integration — ReadinessView shows readiness info', () => {
  it('shows the readiness dashboard when a program with import is selected', async () => {
    mockListPrograms.mockResolvedValue([PROGRAM]);
    mockListUdas.mockResolvedValue([UDA]);
    mockListLessons.mockResolvedValue([LESSON_COMPLETED]);
    render(<ProgramsView />);
    fireEvent.click(await screen.findByRole('button', { name: 'Informatica' }));
    // ReadinessView is rendered inside ProgramsView — wait for udas/lessons to load
    await waitFor(() => {
      expect(screen.getByRole('region', { name: 'Dashboard di prontezza' })).toBeTruthy();
    });
    // With 1 lesson with poolStatus=valid, should show canGenerateVerifiche ✓
    expect(screen.getByText(/Consultazione lezioni/)).toBeTruthy();
  });
});

// ─── 9. TemplateKitView shows download buttons in TeacherShell ───────────────

describe('M1 Integration — TemplateKitView shows download buttons in TeacherShell', () => {
  it('renders template download buttons in the repository section', async () => {
    // TeacherShell starts on "repository" section which shows TemplateKitView
    render(<TeacherShell />);
    // Kit template section heading
    expect(await screen.findByText('Kit template')).toBeTruthy();
    // Individual template download buttons from the mocked TEMPLATES
    expect(screen.getByRole('button', { name: 'Scarica Programma' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Scarica UDA' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Scarica Lezione' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Scarica Pool domande' })).toBeTruthy();
    // Kit ZIP button
    expect(screen.getByRole('button', { name: 'Scarica kit completo (ZIP)' })).toBeTruthy();
  });
});
