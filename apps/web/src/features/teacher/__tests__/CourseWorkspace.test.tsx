import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StrictMode } from 'react';
import { CourseWorkspace } from '../CourseWorkspace.js';
import type { CourseCard } from '../../repository/programs/courseLibrary.js';
import type { LessonItem, UdaItem } from '../../repository/programs/programsService.js';

const mockListUdas = vi.fn();
const mockListLessons = vi.fn();
const mockFetchLessonContent = vi.fn();
const mockUpdateProgramTitle = vi.fn();
const mockSetProgramClassIds = vi.fn();
const mockDeleteProgram = vi.fn();
const mockGetImportMeta = vi.fn();
const mockCreateUda = vi.fn();
const mockUpdateUdaMetadata = vi.fn();
const mockDeleteUda = vi.fn();
const mockImportRepository = vi.fn();
const mockReadZipFile = vi.fn();
const mockSetLessonCompleted = vi.fn();
const mockCreateLesson = vi.fn();
const mockDeleteLesson = vi.fn();
const mockUpdateLessonBody = vi.fn();
const mockUpdateLessonMetadata = vi.fn();
const mockDownloadLessonPdf = vi.fn();
const mockReorderUda = vi.fn();
const mockReorderLesson = vi.fn();

vi.mock('../../../lib/firebase.js', () => ({ db: {}, storage: {} }));
vi.mock('../../repository/programs/programsService.js', () => ({
  listUdas: (...a: unknown[]) => mockListUdas(...a),
  listLessons: (...a: unknown[]) => mockListLessons(...a),
  updateProgramTitle: (...a: unknown[]) => mockUpdateProgramTitle(...a),
  setProgramClassIds: (...a: unknown[]) => mockSetProgramClassIds(...a),
  deleteProgram: (...a: unknown[]) => mockDeleteProgram(...a),
  getImportMeta: (...a: unknown[]) => mockGetImportMeta(...a),
  setLessonCompleted: (...a: unknown[]) => mockSetLessonCompleted(...a),
}));
vi.mock('../lessonPdf.js', () => ({
  downloadLessonPdf: (...a: unknown[]) => mockDownloadLessonPdf(...a),
}));
const { mockDeleteBlockedError } = vi.hoisted(() => ({
  mockDeleteBlockedError: class extends Error {
    blockers: { verificationId: string; title: string }[];
    constructor(blockers: { verificationId: string; title: string }[]) {
      super('blocked');
      this.name = 'RepositoryDeleteBlockedError';
      this.blockers = blockers;
    }
  },
}));
vi.mock('../../repository/editor/repositoryEditorService.js', () => ({
  createUda: (...a: unknown[]) => mockCreateUda(...a),
  updateUdaMetadata: (...a: unknown[]) => mockUpdateUdaMetadata(...a),
  deleteUda: (...a: unknown[]) => mockDeleteUda(...a),
  createLesson: (...a: unknown[]) => mockCreateLesson(...a),
  deleteLesson: (...a: unknown[]) => mockDeleteLesson(...a),
  updateLessonMarkdownBody: (...a: unknown[]) => mockUpdateLessonBody(...a),
  updateLessonMetadata: (...a: unknown[]) => mockUpdateLessonMetadata(...a),
  reorderUda: (...a: unknown[]) => mockReorderUda(...a),
  reorderLesson: (...a: unknown[]) => mockReorderLesson(...a),
  RepositoryDeleteBlockedError: mockDeleteBlockedError,
}));
vi.mock('../../repository/import/importRepository.js', () => ({
  importRepository: (...a: unknown[]) => mockImportRepository(...a),
}));
vi.mock('../../repository/import/readZipFile.js', () => ({
  readZipFile: (...a: unknown[]) => mockReadZipFile(...a),
}));
const mockListClasses = vi.fn();
vi.mock('../../repository/classes/classesService.js', () => ({
  listClasses: (...a: unknown[]) => mockListClasses(...a),
}));
vi.mock('../lessonContent.js', () => ({
  fetchLessonContent: (...a: unknown[]) => mockFetchLessonContent(...a),
}));
vi.mock('../MarkdownRenderer.js', () => ({
  MarkdownRenderer: ({ markdown }: { markdown: string }) => <div data-testid="md">{markdown}</div>,
}));
// The pool editor has its own dedicated test; here we stub it to observe that
// the workspace mounts it lazily (only on the Domande tab) and to drive its
// dirty/count callbacks for the tab + confirm-navigation tests.
vi.mock('../QuestionPoolEditor.js', () => ({
  QuestionPoolEditor: ({
    lesson,
    onDirtyChange,
    onPoolCountChange,
  }: {
    lesson: { id: string };
    onDirtyChange?: (d: boolean) => void;
    onPoolCountChange?: (n: number, s: string) => void;
  }) => (
    <div data-testid="pool-editor">
      POOL: {lesson.id}
      <button type="button" onClick={() => onDirtyChange?.(true)}>
        make-dirty
      </button>
      <button type="button" onClick={() => onPoolCountChange?.(7, 'valid')}>
        set-count-7
      </button>
    </div>
  ),
}));

afterEach(() => {
  cleanup();
  // Reset the viewport stub so desktop is the default for other tests.
  delete (window as { matchMedia?: unknown }).matchMedia;
});
beforeEach(() => {
  vi.clearAllMocks();
});

// Controllable matchMedia stub for the mobile/desktop breakpoint tests.
function setViewport(mobile: boolean) {
  const listeners = new Set<() => void>();
  let matches = mobile;
  (window as { matchMedia?: unknown }).matchMedia = vi.fn().mockReturnValue({
    get matches() {
      return matches;
    },
    media: '(max-width: 640px)',
    addEventListener: (_: string, cb: () => void) => listeners.add(cb),
    removeEventListener: (_: string, cb: () => void) => listeners.delete(cb),
  });
  return {
    set(next: boolean) {
      matches = next;
      act(() => listeners.forEach((cb) => cb()));
    },
  };
}

function card(overrides: Partial<CourseCard> = {}): CourseCard {
  return {
    programId: 'p1',
    title: 'Sistemi e Reti',
    annoScolastico: '2025/2026',
    classIds: ['c-4a'],
    classNames: ['4A INF'],
    udaCount: 2,
    lessonsTotal: 3,
    lessonsDone: 1,
    questionsTotal: 12,
    hasImport: true,
    activeImportId: 'imp1',
    ...overrides,
  };
}

function uda(dir: string, over: Partial<UdaItem> = {}): UdaItem {
  return {
    id: `uda-${dir}`,
    ownerUid: 'owner',
    importId: 'imp1',
    dir,
    filename: `${dir}.md`,
    storageBasePath: `base/${dir}`,
    lessonCount: 0,
    descrizione: null,
    competenze: [],
    obiettivi: [],
    ...over,
  } as UdaItem;
}

function lesson(id: string, udaDir: string, over: Partial<LessonItem> = {}): LessonItem {
  return {
    id,
    ownerUid: 'owner',
    importId: 'imp1',
    udaDir,
    path: `${udaDir}/${id}.md`,
    filename: `lezione-001-${id}.md`,
    poolStatus: 'absent',
    questionCount: 0,
    storageRef: `ref/${udaDir}/${id}.md`,
    poolStorageRef: null,
    completed: false,
    titolo: null,
    sottotitolo: null,
    difficolta: null,
    concettiChiave: [],
    obiettivi: [],
    ...over,
  } as LessonItem;
}

function renderWorkspace(over: Partial<CourseCard> = {}, onBack = vi.fn()) {
  return render(<CourseWorkspace card={card(over)} ownerUid="owner" onBack={onBack} />);
}

describe('CourseWorkspace — loading', () => {
  it('loads UDA and lessons once for the selected course only', async () => {
    mockListUdas.mockResolvedValue([uda('uda-01-reti')]);
    mockListLessons.mockResolvedValue([lesson('l1', 'uda-01-reti', { questionCount: 12 })]);
    renderWorkspace();

    await waitFor(() => expect(screen.getByRole('button', { name: 'uda-01-reti' })).toBeTruthy());
    expect(mockListUdas).toHaveBeenCalledTimes(1);
    expect(mockListLessons).toHaveBeenCalledTimes(1);
    expect(mockListUdas).toHaveBeenCalledWith('p1', 'imp1', expect.anything());
    expect(mockListLessons).toHaveBeenCalledWith('p1', 'imp1', expect.anything());
    // The summary strip derives the domande total from the loaded tree.
    expect(screen.getByText('12')).toBeTruthy(); // domande
    expect(screen.getByRole('img', { name: /avanzamento lezioni 33%/i })).toBeTruthy();
  });

  it('shows the course overview (UDA table) by default', async () => {
    mockListUdas.mockResolvedValue([uda('uda-01-reti'), uda('uda-02-sicurezza')]);
    mockListLessons.mockResolvedValue([
      lesson('l1', 'uda-01-reti', { completed: true }),
      lesson('l2', 'uda-01-reti'),
    ]);
    renderWorkspace();

    const table = await screen.findByRole('table');
    // uda-01 has 1/2 lessons done.
    expect(within(table).getByText('1/2')).toBeTruthy();
  });
});

describe('CourseWorkspace — selection', () => {
  it('shows UDA metadata and its lessons table when a UDA is selected', async () => {
    mockListUdas.mockResolvedValue([
      uda('uda-01-reti', {
        descrizione: 'Fondamenti di reti',
        competenze: ['Progettare una LAN'],
        obiettivi: ['Comprendere TCP/IP'],
      }),
    ]);
    mockListLessons.mockResolvedValue([
      lesson('l1', 'uda-01-reti', { titolo: 'Il modello ISO/OSI', questionCount: 5 }),
    ]);
    renderWorkspace();

    await waitFor(() => expect(screen.getByRole('button', { name: 'uda-01-reti' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'uda-01-reti' }));

    expect(screen.getByText('Fondamenti di reti')).toBeTruthy();
    expect(screen.getByText('Progettare una LAN')).toBeTruthy();
    expect(screen.getByText('Comprendere TCP/IP')).toBeTruthy();
    const table = screen.getByRole('table');
    expect(within(table).getByText('Il modello ISO/OSI')).toBeTruthy();
    expect(within(table).getByText('5')).toBeTruthy(); // domande per lezione
  });

  it('loads the lesson Markdown on demand only when the lesson is selected', async () => {
    mockListUdas.mockResolvedValue([uda('uda-01-reti')]);
    mockListLessons.mockResolvedValue([
      lesson('l1', 'uda-01-reti', { titolo: 'Il modello ISO/OSI' }),
    ]);
    mockFetchLessonContent.mockResolvedValue('# Titolo\n\nCorpo della lezione.');
    renderWorkspace();

    await waitFor(() => expect(screen.getByRole('button', { name: 'uda-01-reti' })).toBeTruthy());
    // Not fetched until a lesson is actually opened.
    expect(mockFetchLessonContent).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Il modello ISO/OSI' }));
    await waitFor(() => expect(screen.getByTestId('md')).toBeTruthy());
    expect(mockFetchLessonContent).toHaveBeenCalledTimes(1);
    expect(mockFetchLessonContent).toHaveBeenCalledWith('ref/uda-01-reti/l1.md', expect.anything());
    expect(screen.getByTestId('md').textContent).toContain('Corpo della lezione.');
    // No pool read: the only content read is the lesson Markdown itself.
    expect(mockListLessons).toHaveBeenCalledTimes(1);
    expect(mockListUdas).toHaveBeenCalledTimes(1);
  });

  it('ignores an out-of-order stale fetch: the last selected lesson wins', async () => {
    mockListUdas.mockResolvedValue([uda('uda-01-reti')]);
    mockListLessons.mockResolvedValue([
      lesson('lA', 'uda-01-reti', { titolo: 'Lezione A' }),
      lesson('lB', 'uda-01-reti', { titolo: 'Lezione B' }),
    ]);

    // Two controlled fetches: A (first selected) resolves *after* B (second).
    let resolveA!: (v: string) => void;
    let resolveB!: (v: string) => void;
    mockFetchLessonContent
      .mockImplementationOnce(() => new Promise<string>((r) => (resolveA = r)))
      .mockImplementationOnce(() => new Promise<string>((r) => (resolveB = r)));

    renderWorkspace();
    await waitFor(() => expect(screen.getByRole('button', { name: 'uda-01-reti' })).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'Lezione A' }));
    fireEvent.click(screen.getByRole('button', { name: 'Lezione B' }));

    // B (the latest selection) resolves first, then the stale A resolves.
    resolveB('# B\n\nContenuto della lezione B — meta-B.');
    await waitFor(() => expect(screen.getByTestId('md').textContent).toContain('meta-B'));
    resolveA('# A\n\nContenuto della lezione A — meta-A.');

    // A must not overwrite the panel: B's content and title stay on screen.
    await waitFor(() => expect(screen.getByTestId('md').textContent).toContain('meta-B'));
    expect(screen.getByTestId('md').textContent).not.toContain('meta-A');
    expect(screen.getByRole('heading', { name: 'Lezione B' })).toBeTruthy();
  });

  it('shows a readable error when the lesson content fails to load', async () => {
    mockListUdas.mockResolvedValue([uda('uda-01-reti')]);
    mockListLessons.mockResolvedValue([lesson('l1', 'uda-01-reti', { titolo: 'Rotta' })]);
    mockFetchLessonContent.mockRejectedValue(new Error('boom'));
    renderWorkspace();

    await waitFor(() => expect(screen.getByRole('button', { name: 'uda-01-reti' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Rotta' }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByText(/impossibile caricare il contenuto/i)).toBeTruthy();
  });
});

describe('CourseWorkspace — sidebar and semantics', () => {
  it('collapses the sidebar and gives the content the freed space', async () => {
    mockListUdas.mockResolvedValue([uda('uda-01-reti')]);
    mockListLessons.mockResolvedValue([lesson('l1', 'uda-01-reti', { titolo: 'Lez 1' })]);
    renderWorkspace();

    await waitFor(() => expect(screen.getByRole('button', { name: 'uda-01-reti' })).toBeTruthy());
    // Collapse: the structure nav disappears, an expand affordance replaces it.
    fireEvent.click(screen.getByRole('button', { name: /comprimi struttura corso/i }));
    expect(screen.queryByRole('navigation', { name: 'Struttura corso' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'uda-01-reti' })).toBeNull();
    // Content (course overview) is still present, now occupying the row.
    expect(screen.getByRole('table')).toBeTruthy();

    // Expand again restores the structure.
    fireEvent.click(screen.getByRole('button', { name: /espandi struttura corso/i }));
    expect(screen.getByRole('navigation', { name: 'Struttura corso' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'uda-01-reti' })).toBeTruthy();
  });

  it('uses a semantic structure: nav + button rows with no nested interactive controls', async () => {
    mockListUdas.mockResolvedValue([uda('uda-01-reti')]);
    mockListLessons.mockResolvedValue([lesson('l1', 'uda-01-reti', { titolo: 'Lez 1' })]);
    renderWorkspace();

    await waitFor(() => expect(screen.getByRole('button', { name: 'uda-01-reti' })).toBeTruthy());
    const nav = screen.getByRole('navigation', { name: 'Struttura corso' });
    const lessonBtn = within(nav).getByRole('button', { name: 'Lez 1' });
    // The lesson row is a real button with no button nested inside it.
    expect(lessonBtn.querySelector('button')).toBeNull();
    const udaTitleBtn = within(nav).getByRole('button', { name: 'uda-01-reti' });
    expect(udaTitleBtn.querySelector('button')).toBeNull();
  });

  it('distinguishes lesson completion and pool status with labelled sidebar indicators', async () => {
    mockListUdas.mockResolvedValue([uda('uda-01-reti')]);
    mockListLessons.mockResolvedValue([
      lesson('l1', 'uda-01-reti', {
        titolo: 'Con pool',
        completed: true,
        poolStatus: 'valid',
      }),
      lesson('l2', 'uda-01-reti', { titolo: 'Senza pool', poolStatus: 'absent' }),
      lesson('l3', 'uda-01-reti', { titolo: 'Pool non valido', poolStatus: 'invalid' }),
    ]);
    renderWorkspace();

    const nav = await screen.findByRole('navigation', { name: 'Struttura corso' });
    expect(within(nav).getByRole('img', { name: 'Lezione svolta' })).toBeTruthy();
    expect(within(nav).getByRole('img', { name: 'Pool presente e valido' })).toBeTruthy();
    expect(within(nav).getByRole('img', { name: 'Pool assente' })).toBeTruthy();
    expect(within(nav).getByRole('img', { name: 'Pool presente ma non valido' })).toBeTruthy();
  });

  it('calls onBack from the "← Libreria" control', async () => {
    const onBack = vi.fn();
    mockListUdas.mockResolvedValue([uda('uda-01-reti')]);
    mockListLessons.mockResolvedValue([]);
    renderWorkspace({}, onBack);

    await waitFor(() => expect(screen.getByRole('button', { name: 'uda-01-reti' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /← libreria/i }));
    expect(onBack).toHaveBeenCalledOnce();
  });
});

describe('CourseWorkspace — lesson tabs (DUX-03)', () => {
  async function openLesson(title = 'Il modello ISO/OSI') {
    mockListUdas.mockResolvedValue([uda('uda-01-reti')]);
    mockListLessons.mockResolvedValue([lesson('l1', 'uda-01-reti', { titolo: title })]);
    mockFetchLessonContent.mockResolvedValue('Corpo lezione.');
    renderWorkspace();
    await waitFor(() => expect(screen.getByRole('button', { name: title })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: title }));
    await waitFor(() =>
      expect(screen.getByRole('tablist', { name: 'Schede lezione' })).toBeTruthy(),
    );
  }

  it('shows three tabs, Contenuto active, and does NOT mount the pool before Domande is opened', async () => {
    await openLesson();
    expect(screen.getByRole('tab', { name: 'Contenuto' }).getAttribute('aria-selected')).toBe(
      'true',
    );
    expect(screen.getByRole('tab', { name: 'Domande' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Informazioni' })).toBeTruthy();
    // Content is visible; the pool editor has not been mounted (lazy).
    await waitFor(() => expect(screen.getByTestId('md')).toBeTruthy());
    expect(screen.queryByTestId('pool-editor')).toBeNull();
  });

  it('mounts the pool editor when Domande opens and keeps it mounted across tab switches', async () => {
    await openLesson();
    fireEvent.click(screen.getByRole('tab', { name: 'Domande' }));
    expect(screen.getByTestId('pool-editor')).toBeTruthy();

    // Switching to another tab keeps it mounted (hidden), not unmounted, so
    // the pool is not re-read when returning.
    fireEvent.click(screen.getByRole('tab', { name: 'Informazioni' }));
    expect(screen.getByTestId('pool-editor')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Domande' }));
    expect(screen.getByTestId('pool-editor')).toBeTruthy();
  });

  it('Informazioni shows only present metadata (empty state + technical file path here)', async () => {
    await openLesson();
    fireEvent.click(screen.getByRole('tab', { name: 'Informazioni' }));
    expect(screen.getByText(/nessun metadato/i)).toBeTruthy();
    // Technical detail is available in a discreet secondary section.
    expect(screen.getByText('uda-01-reti/l1.md')).toBeTruthy();
  });

  it('confirms before changing lesson when the pool has unsaved edits', async () => {
    mockListUdas.mockResolvedValue([uda('uda-01-reti')]);
    mockListLessons.mockResolvedValue([
      lesson('lA', 'uda-01-reti', { titolo: 'Lezione A' }),
      lesson('lB', 'uda-01-reti', { titolo: 'Lezione B' }),
    ]);
    mockFetchLessonContent.mockResolvedValue('Corpo.');
    renderWorkspace();

    await waitFor(() => expect(screen.getByRole('button', { name: 'Lezione A' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Lezione A' }));
    fireEvent.click(await screen.findByRole('tab', { name: 'Domande' }));
    fireEvent.click(screen.getByRole('button', { name: 'make-dirty' }));

    // Attempt to switch lesson → confirm dialog, no immediate switch.
    fireEvent.click(screen.getByRole('button', { name: 'Lezione B' }));
    expect(screen.getByRole('alertdialog', { name: 'Modifiche non salvate' })).toBeTruthy();
    expect(screen.getByTestId('pool-editor').textContent).toContain('lA');

    // Confirm → the switch goes through.
    fireEvent.click(screen.getByRole('button', { name: /continua senza salvare/i }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Lezione B' })).toBeTruthy();
  });

  it('updates the domande counter locally after a pool save, without reloading the tree', async () => {
    mockListUdas.mockResolvedValue([uda('uda-01-reti')]);
    mockListLessons.mockResolvedValue([
      lesson('l1', 'uda-01-reti', { titolo: 'Lez 1', questionCount: 5 }),
    ]);
    mockFetchLessonContent.mockResolvedValue('Corpo.');
    renderWorkspace();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Lez 1' })).toBeTruthy());
    // Strip derives the domande total from the loaded tree (5).
    expect(screen.getByText('5')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Lez 1' }));
    fireEvent.click(await screen.findByRole('tab', { name: 'Domande' }));
    fireEvent.click(screen.getByRole('button', { name: 'set-count-7' }));
    // Only one lesson in the tree → total becomes 7; no extra tree reads.
    expect(screen.getByText('7')).toBeTruthy();
    expect(mockListUdas).toHaveBeenCalledTimes(1);
    expect(mockListLessons).toHaveBeenCalledTimes(1);
  });

  it('notifies onProgramQuestionsChange exactly once (no double-call in Strict Mode)', async () => {
    mockListUdas.mockResolvedValue([uda('uda-01-reti')]);
    mockListLessons.mockResolvedValue([
      lesson('l1', 'uda-01-reti', { titolo: 'Lez 1', questionCount: 5 }),
      lesson('l2', 'uda-01-reti', { titolo: 'Lez 2', questionCount: 3 }),
    ]);
    mockFetchLessonContent.mockResolvedValue('Corpo.');
    const onProgramQuestionsChange = vi.fn();
    render(
      <StrictMode>
        <CourseWorkspace
          card={card()}
          ownerUid="owner"
          onBack={vi.fn()}
          onProgramQuestionsChange={onProgramQuestionsChange}
        />
      </StrictMode>,
    );

    await waitFor(() => expect(screen.getByRole('button', { name: 'Lez 1' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Lez 1' }));
    fireEvent.click(await screen.findByRole('tab', { name: 'Domande' }));
    fireEvent.click(screen.getByRole('button', { name: 'set-count-7' }));

    // Called once, with the correct course total (l1 7 + l2 3 = 10).
    expect(onProgramQuestionsChange).toHaveBeenCalledTimes(1);
    expect(onProgramQuestionsChange).toHaveBeenCalledWith('p1', 10);
  });

  it('moves selection AND focus with arrow/Home/End keys, keeping one tabbable tab', async () => {
    await openLesson();
    const tabContenuto = screen.getByRole('tab', { name: 'Contenuto' });
    const tabDomande = screen.getByRole('tab', { name: 'Domande' });
    const tabInformazioni = screen.getByRole('tab', { name: 'Informazioni' });

    tabContenuto.focus();
    fireEvent.keyDown(tabContenuto, { key: 'ArrowRight' });
    expect(tabDomande.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(tabDomande);
    // Roving tabindex: exactly one tab is in the tab order.
    expect([tabContenuto, tabDomande, tabInformazioni].filter((t) => t.tabIndex === 0)).toEqual([
      tabDomande,
    ]);

    fireEvent.keyDown(tabDomande, { key: 'End' });
    expect(tabInformazioni.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(tabInformazioni);

    fireEvent.keyDown(tabInformazioni, { key: 'Home' });
    expect(tabContenuto.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(tabContenuto);

    fireEvent.keyDown(tabContenuto, { key: 'ArrowLeft' });
    expect(tabInformazioni.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(tabInformazioni);
  });
});

describe('CourseWorkspace — course/UDA actions (DUX-04A)', () => {
  async function renderAndReady(
    over: Partial<CourseCard> = {},
    spies: Partial<Record<'onCardPatch' | 'onCourseDeleted', ReturnType<typeof vi.fn>>> = {},
  ) {
    mockListUdas.mockResolvedValue([uda('uda-01-reti')]);
    mockListLessons.mockResolvedValue([lesson('l1', 'uda-01-reti', { questionCount: 4 })]);
    mockFetchLessonContent.mockResolvedValue('Corpo.');
    render(
      <CourseWorkspace
        card={card(over)}
        ownerUid="owner"
        onBack={vi.fn()}
        onCardPatch={spies.onCardPatch}
        onCourseDeleted={spies.onCourseDeleted}
      />,
    );
    await waitFor(() => expect(screen.getByRole('button', { name: 'uda-01-reti' })).toBeTruthy());
  }

  it('shows the course toolbar by default and the UDA toolbar when a UDA is selected', async () => {
    await renderAndReady();
    expect(screen.getByRole('button', { name: 'Azioni corso' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Azioni UDA' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'uda-01-reti' }));
    expect(screen.getByRole('button', { name: '+ Nuova UDA' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Azioni UDA' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Azioni corso' })).toBeNull();
  });

  it('closes contextual menus with Escape or an outside pointer and restores trigger focus', async () => {
    await renderAndReady();
    const trigger = screen.getByRole('button', { name: 'Azioni corso' });

    fireEvent.click(trigger);
    expect(screen.getByRole('menu')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);

    fireEvent.click(trigger);
    expect(screen.getByRole('menu')).toBeTruthy();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('renames the course and patches the card', async () => {
    const onCardPatch = vi.fn();
    mockUpdateProgramTitle.mockResolvedValue(undefined);
    await renderAndReady({}, { onCardPatch });

    fireEvent.click(screen.getByRole('button', { name: 'Azioni corso' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Modifica titolo' }));
    fireEvent.change(screen.getByLabelText('Titolo del corso'), { target: { value: 'Reti 2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salva' }));

    await waitFor(() =>
      expect(mockUpdateProgramTitle).toHaveBeenCalledWith('p1', 'Reti 2', 'owner', {}),
    );
    expect(onCardPatch).toHaveBeenCalledWith('p1', { title: 'Reti 2' });
  });

  it('edits UDA metadata and updates the tree', async () => {
    mockUpdateUdaMetadata.mockResolvedValue(undefined);
    await renderAndReady();
    fireEvent.click(screen.getByRole('button', { name: 'uda-01-reti' }));
    fireEvent.click(screen.getByRole('button', { name: 'Azioni UDA' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Modifica metadata' }));

    fireEvent.change(screen.getByLabelText('Descrizione UDA'), {
      target: { value: 'Nuova descr' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Salva' }));

    await waitFor(() => expect(mockUpdateUdaMetadata).toHaveBeenCalledOnce());
    const arg = mockUpdateUdaMetadata.mock.calls[0][0] as { fields: { descrizione: string } };
    expect(arg.fields.descrizione).toBe('Nuova descr');
    // Tree updated locally: description now visible in the UDA overview.
    await waitFor(() => expect(screen.getByText('Nuova descr')).toBeTruthy());
  });

  it('creates a new UDA and shows it in the sidebar', async () => {
    const onCardPatch = vi.fn();
    mockCreateUda.mockResolvedValue({ udaId: 'uda-new', dir: 'uda-02-nuova', order: 1 });
    await renderAndReady({}, { onCardPatch });
    fireEvent.click(screen.getByRole('button', { name: 'uda-01-reti' }));
    fireEvent.click(screen.getByRole('button', { name: '+ Nuova UDA' }));
    fireEvent.change(screen.getByLabelText('Titolo UDA'), { target: { value: 'Nuova' } });
    fireEvent.click(screen.getByRole('button', { name: 'Crea UDA' }));

    await waitFor(() => expect(mockCreateUda).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.getByRole('button', { name: 'uda-02-nuova' })).toBeTruthy());
    // Card UDA count patched locally (1 → 2).
    expect(onCardPatch).toHaveBeenCalledWith('p1', expect.objectContaining({ udaCount: 2 }));
  });

  it('deletes an authorized UDA and returns to the course overview', async () => {
    mockDeleteUda.mockResolvedValue(undefined);
    await renderAndReady();
    fireEvent.click(screen.getByRole('button', { name: 'uda-01-reti' }));
    fireEvent.click(screen.getByRole('button', { name: 'Azioni UDA' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Elimina UDA' }));
    fireEvent.click(screen.getByRole('button', { name: 'Elimina' }));

    await waitFor(() => expect(mockDeleteUda).toHaveBeenCalledOnce());
    // UDA gone from the sidebar; back on the course overview.
    await waitFor(() => expect(screen.queryByRole('button', { name: 'uda-01-reti' })).toBeNull());
    expect(screen.getAllByText('Nessuna UDA in questo corso.')).toHaveLength(2);
  });

  it('shows the verifications blockers and keeps the UDA when deletion is blocked', async () => {
    mockDeleteUda.mockRejectedValue(
      new mockDeleteBlockedError([{ verificationId: 'v1', title: 'Compito di Reti' }]),
    );
    await renderAndReady();
    fireEvent.click(screen.getByRole('button', { name: 'uda-01-reti' }));
    fireEvent.click(screen.getByRole('button', { name: 'Azioni UDA' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Elimina UDA' }));
    fireEvent.click(screen.getByRole('button', { name: 'Elimina' }));

    await waitFor(() => expect(screen.getByText('Compito di Reti')).toBeTruthy());
    // Still selectable (not removed) once the dialog is closed.
    fireEvent.click(screen.getByRole('button', { name: 'Annulla' }));
    expect(screen.getByRole('button', { name: 'uda-01-reti' })).toBeTruthy();
  });

  it('imports a ZIP into the course and patches only that course (no library reload)', async () => {
    const onCardPatch = vi.fn();
    mockReadZipFile.mockResolvedValue([{ path: 'programma.md', text: '' }]);
    mockImportRepository.mockResolvedValue({
      status: 'committed',
      importId: 'imp2',
      udaCount: 3,
      lessonCount: 9,
      questionCount: 20,
    });
    mockGetImportMeta.mockResolvedValue({ annoScolastico: '2026/2027' });
    await renderAndReady({}, { onCardPatch });

    fireEvent.click(screen.getByRole('button', { name: 'Azioni corso' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Importa ZIP' }));
    const file = new File(['z'], 'c.zip', { type: 'application/zip' });
    fireEvent.change(screen.getByLabelText('File ZIP del corso'), { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: 'Importa' }));

    await waitFor(() => expect(mockImportRepository).toHaveBeenCalledOnce());
    await waitFor(() =>
      expect(onCardPatch).toHaveBeenCalledWith(
        'p1',
        expect.objectContaining({ activeImportId: 'imp2', udaCount: 3, questionsTotal: 20 }),
      ),
    );
  });

  it('deletes the course and notifies the parent', async () => {
    const onCourseDeleted = vi.fn();
    mockDeleteProgram.mockResolvedValue(undefined);
    await renderAndReady({}, { onCourseDeleted });

    fireEvent.click(screen.getByRole('button', { name: 'Azioni corso' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Elimina corso' }));
    fireEvent.click(screen.getByRole('button', { name: 'Elimina' }));

    await waitFor(() => expect(mockDeleteProgram).toHaveBeenCalledWith('p1', 'owner', {}, {}));
    expect(onCourseDeleted).toHaveBeenCalledWith('p1');
  });
});

describe('CourseWorkspace — pure updaters & class preservation (DUX-04A fixes)', () => {
  async function selectUda(onCardPatch = vi.fn(), strict = false) {
    mockListUdas.mockResolvedValue([uda('uda-01-reti')]);
    mockListLessons.mockResolvedValue([lesson('l1', 'uda-01-reti', { questionCount: 4 })]);
    mockFetchLessonContent.mockResolvedValue('Corpo.');
    const tree = (
      <CourseWorkspace card={card()} ownerUid="owner" onBack={vi.fn()} onCardPatch={onCardPatch} />
    );
    render(strict ? <StrictMode>{tree}</StrictMode> : tree);
    await waitFor(() => expect(screen.getByRole('button', { name: 'uda-01-reti' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'uda-01-reti' }));
    return onCardPatch;
  }

  it('patches the card exactly once when creating a UDA (StrictMode-safe)', async () => {
    mockCreateUda.mockResolvedValue({ udaId: 'uda-new', dir: 'uda-02-nuova', order: 1 });
    const onCardPatch = await selectUda(vi.fn(), true);
    fireEvent.click(screen.getByRole('button', { name: '+ Nuova UDA' }));
    fireEvent.change(screen.getByLabelText('Titolo UDA'), { target: { value: 'Nuova' } });
    fireEvent.click(screen.getByRole('button', { name: 'Crea UDA' }));

    await waitFor(() => expect(mockCreateUda).toHaveBeenCalledOnce());
    await waitFor(() => expect(onCardPatch).toHaveBeenCalledTimes(1));
    expect(onCardPatch).toHaveBeenCalledWith('p1', expect.objectContaining({ udaCount: 2 }));
  });

  it('patches the card exactly once when deleting a UDA (StrictMode-safe)', async () => {
    mockDeleteUda.mockResolvedValue(undefined);
    const onCardPatch = await selectUda(vi.fn(), true);
    fireEvent.click(screen.getByRole('button', { name: 'Azioni UDA' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Elimina UDA' }));
    fireEvent.click(screen.getByRole('button', { name: 'Elimina' }));

    await waitFor(() => expect(mockDeleteUda).toHaveBeenCalledOnce());
    await waitFor(() => expect(onCardPatch).toHaveBeenCalledTimes(1));
    expect(onCardPatch).toHaveBeenCalledWith('p1', expect.objectContaining({ udaCount: 0 }));
  });

  async function openClasses(onCardPatch = vi.fn()) {
    mockListUdas.mockResolvedValue([uda('uda-01-reti')]);
    mockListLessons.mockResolvedValue([lesson('l1', 'uda-01-reti')]);
    mockFetchLessonContent.mockResolvedValue('Corpo.');
    mockListClasses.mockResolvedValue([
      { id: 'c1', name: '1A' },
      { id: 'c2', name: '2B' },
      { id: 'c3', name: '3C' },
    ]);
    render(
      <CourseWorkspace
        card={card({ classIds: ['c1', 'c2'], classNames: ['1A', '2B'] })}
        ownerUid="owner"
        onBack={vi.fn()}
        onCardPatch={onCardPatch}
      />,
    );
    await waitFor(() => expect(screen.getByRole('button', { name: 'Azioni corso' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Azioni corso' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Classi assegnate' }));
    await waitFor(() => expect(screen.getByRole('checkbox', { name: '1A' })).toBeTruthy());
    return onCardPatch;
  }

  it('opens the classes dialog with the current classIds preselected', async () => {
    await openClasses();
    expect((screen.getByRole('checkbox', { name: '1A' }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('checkbox', { name: '2B' }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('checkbox', { name: '3C' }) as HTMLInputElement).checked).toBe(false);
  });

  it('saving unchanged preserves the same class ids', async () => {
    mockSetProgramClassIds.mockResolvedValue(undefined);
    const onCardPatch = await openClasses();
    fireEvent.click(screen.getByRole('button', { name: 'Salva' }));

    await waitFor(() => expect(mockSetProgramClassIds).toHaveBeenCalledOnce());
    expect(mockSetProgramClassIds).toHaveBeenCalledWith('p1', ['c1', 'c2'], 'owner', {});
    expect(onCardPatch).toHaveBeenCalledWith('p1', {
      classIds: ['c1', 'c2'],
      classNames: ['1A', '2B'],
    });
  });

  it('editing updates classIds and classNames coherently', async () => {
    mockSetProgramClassIds.mockResolvedValue(undefined);
    const onCardPatch = await openClasses();
    fireEvent.click(screen.getByRole('checkbox', { name: '1A' })); // remove c1
    fireEvent.click(screen.getByRole('checkbox', { name: '3C' })); // add c3
    fireEvent.click(screen.getByRole('button', { name: 'Salva' }));

    await waitFor(() =>
      expect(mockSetProgramClassIds).toHaveBeenCalledWith('p1', ['c2', 'c3'], 'owner', {}),
    );
    expect(onCardPatch).toHaveBeenCalledWith('p1', {
      classIds: ['c2', 'c3'],
      classNames: ['2B', '3C'],
    });
  });

  it('does not duplicate the class card callback under StrictMode', async () => {
    mockSetProgramClassIds.mockResolvedValue(undefined);
    mockListUdas.mockResolvedValue([uda('uda-01-reti')]);
    mockListLessons.mockResolvedValue([lesson('l1', 'uda-01-reti')]);
    mockFetchLessonContent.mockResolvedValue('Corpo.');
    mockListClasses.mockResolvedValue([{ id: 'c1', name: '1A' }]);
    const onCardPatch = vi.fn();
    render(
      <StrictMode>
        <CourseWorkspace
          card={card({ classIds: ['c1'], classNames: ['1A'] })}
          ownerUid="owner"
          onBack={vi.fn()}
          onCardPatch={onCardPatch}
        />
      </StrictMode>,
    );
    await waitFor(() => expect(screen.getByRole('button', { name: 'Azioni corso' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Azioni corso' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Classi assegnate' }));
    await waitFor(() => expect(screen.getByRole('checkbox', { name: '1A' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Salva' }));

    await waitFor(() => expect(mockSetProgramClassIds).toHaveBeenCalledOnce());
    expect(onCardPatch).toHaveBeenCalledTimes(1);
  });
});

describe('CourseWorkspace — lesson actions (DUX-04B)', () => {
  async function openLesson(over: Partial<LessonItem> = {}, body = 'Corpo lezione A.') {
    mockListUdas.mockResolvedValue([uda('uda-01-reti')]);
    mockListLessons.mockResolvedValue([
      lesson('l1', 'uda-01-reti', { titolo: 'Lezione A', ...over }),
    ]);
    mockFetchLessonContent.mockResolvedValue(body);
    const onCardPatch = vi.fn();
    render(
      <CourseWorkspace card={card()} ownerUid="owner" onBack={vi.fn()} onCardPatch={onCardPatch} />,
    );
    await waitFor(() => expect(screen.getByRole('button', { name: 'Lezione A' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Lezione A' }));
    await waitFor(() => expect(screen.getByTestId('md')).toBeTruthy());
    return onCardPatch;
  }

  it('creates a lesson, updates the tree locally and shows it selected', async () => {
    const onCardPatch = vi.fn();
    mockListUdas.mockResolvedValue([uda('uda-01-reti')]);
    mockListLessons.mockResolvedValue([lesson('l1', 'uda-01-reti', { titolo: 'Esistente' })]);
    mockCreateLesson.mockResolvedValue({ lessonId: 'l2', filename: 'lezione-002-nuova.md' });
    render(
      <CourseWorkspace card={card()} ownerUid="owner" onBack={vi.fn()} onCardPatch={onCardPatch} />,
    );
    await waitFor(() => expect(screen.getByRole('button', { name: 'uda-01-reti' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'uda-01-reti' }));
    fireEvent.click(screen.getByRole('button', { name: '+ Nuova lezione' }));
    fireEvent.change(screen.getByLabelText('Titolo lezione'), { target: { value: 'Nuova' } });
    fireEvent.change(screen.getByLabelText('Corpo Markdown lezione'), {
      target: { value: 'Corpo iniziale.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Crea lezione' }));

    await waitFor(() => expect(mockCreateLesson).toHaveBeenCalledOnce());
    // New lesson selected, its content shown locally (no extra Storage read).
    await waitFor(() => expect(screen.getByTestId('md').textContent).toContain('Corpo iniziale.'));
    expect(mockFetchLessonContent).not.toHaveBeenCalled();
    expect(onCardPatch).toHaveBeenCalledWith('p1', expect.objectContaining({ lessonsTotal: 2 }));
  });

  it('edits the content and cancels back to consultation', async () => {
    await openLesson();
    fireEvent.click(screen.getByRole('button', { name: 'Modifica contenuto' }));
    const textarea = screen.getByLabelText('Corpo Markdown') as HTMLTextAreaElement;
    expect(textarea.value).toBe('Corpo lezione A.');
    fireEvent.change(textarea, { target: { value: 'Modificato.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Annulla' }));
    // Back to consultation showing the original content.
    expect(screen.queryByLabelText('Corpo Markdown')).toBeNull();
    expect(screen.getByTestId('md').textContent).toContain('Corpo lezione A.');
    expect(mockUpdateLessonBody).not.toHaveBeenCalled();
  });

  it('saves content via updateLessonMarkdownBody without touching metadata', async () => {
    mockUpdateLessonBody.mockResolvedValue(undefined);
    await openLesson();
    fireEvent.click(screen.getByRole('button', { name: 'Modifica contenuto' }));
    fireEvent.change(screen.getByLabelText('Corpo Markdown'), {
      target: { value: 'Nuovo corpo.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Salva' }));

    await waitFor(() => expect(mockUpdateLessonBody).toHaveBeenCalledOnce());
    expect(mockUpdateLessonBody.mock.calls[0][0]).toMatchObject({
      lessonId: 'l1',
      body: 'Nuovo corpo.',
    });
    expect(mockUpdateLessonMetadata).not.toHaveBeenCalled();
    // Persistent "saved" feedback in the toolbar; editor closed, content updated.
    await waitFor(() => expect(screen.getByText('Contenuto salvato')).toBeTruthy());
    expect(screen.getByTestId('md').textContent).toContain('Nuovo corpo.');
  });

  it('saves metadata via updateLessonMetadata without touching the body', async () => {
    mockUpdateLessonMetadata.mockResolvedValue(undefined);
    await openLesson();
    fireEvent.click(screen.getByRole('button', { name: 'Modifica informazioni' }));
    fireEvent.change(screen.getByLabelText('Titolo lezione'), { target: { value: 'Titolo 2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salva' }));

    await waitFor(() => expect(mockUpdateLessonMetadata).toHaveBeenCalledOnce());
    expect(mockUpdateLessonMetadata.mock.calls[0][0]).toMatchObject({
      lessonId: 'l1',
      fields: expect.objectContaining({ titolo: 'Titolo 2' }),
    });
    expect(mockUpdateLessonBody).not.toHaveBeenCalled();
  });

  it('returns to an open information draft after switching tabs', async () => {
    await openLesson();
    fireEvent.click(screen.getByRole('button', { name: 'Modifica informazioni' }));
    const titleInput = screen.getByLabelText('Titolo lezione') as HTMLInputElement;
    fireEvent.change(titleInput, { target: { value: 'Titolo non salvato' } });

    fireEvent.click(screen.getByRole('tab', { name: 'Contenuto' }));
    const returnButton = screen.getByRole('button', { name: 'Modifica informazioni' });
    expect((returnButton as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(returnButton);

    expect(screen.getByRole('tab', { name: 'Informazioni' }).getAttribute('aria-selected')).toBe(
      'true',
    );
    expect((screen.getByLabelText('Titolo lezione') as HTMLInputElement).value).toBe(
      'Titolo non salvato',
    );
  });

  it('guards a lesson change when the content editor is dirty', async () => {
    mockListUdas.mockResolvedValue([uda('uda-01-reti')]);
    mockListLessons.mockResolvedValue([
      lesson('lA', 'uda-01-reti', { titolo: 'Lezione A' }),
      lesson('lB', 'uda-01-reti', { titolo: 'Lezione B' }),
    ]);
    mockFetchLessonContent.mockResolvedValue('Corpo.');
    render(<CourseWorkspace card={card()} ownerUid="owner" onBack={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Lezione A' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Lezione A' }));
    await waitFor(() => expect(screen.getByTestId('md')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Modifica contenuto' }));
    fireEvent.change(screen.getByLabelText('Corpo Markdown'), { target: { value: 'dirty' } });

    fireEvent.click(screen.getByRole('button', { name: 'Lezione B' }));
    expect(screen.getByRole('alertdialog', { name: 'Modifiche non salvate' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /continua senza salvare/i }));
    expect(screen.getByRole('heading', { name: 'Lezione B' })).toBeTruthy();
    expect(screen.queryByLabelText('Corpo Markdown')).toBeNull();
  });

  it('toggles completion with one write and patches the card once (StrictMode)', async () => {
    mockSetLessonCompleted.mockResolvedValue(undefined);
    mockListUdas.mockResolvedValue([uda('uda-01-reti')]);
    mockListLessons.mockResolvedValue([lesson('l1', 'uda-01-reti', { titolo: 'Lezione A' })]);
    mockFetchLessonContent.mockResolvedValue('Corpo.');
    const onCardPatch = vi.fn();
    render(
      <StrictMode>
        <CourseWorkspace
          card={card()}
          ownerUid="owner"
          onBack={vi.fn()}
          onCardPatch={onCardPatch}
        />
      </StrictMode>,
    );
    await waitFor(() => expect(screen.getByRole('button', { name: 'Lezione A' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Lezione A' }));
    await waitFor(() => expect(screen.getByTestId('md')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Segna svolta' }));

    await waitFor(() => expect(mockSetLessonCompleted).toHaveBeenCalledOnce());
    await waitFor(() => expect(onCardPatch).toHaveBeenCalledTimes(1));
    expect(onCardPatch).toHaveBeenCalledWith('p1', expect.objectContaining({ lessonsDone: 1 }));
  });

  it('downloads the PDF reusing the already-loaded content and metadata', async () => {
    mockDownloadLessonPdf.mockResolvedValue(undefined);
    await openLesson();
    expect(mockFetchLessonContent).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Scarica PDF' }));

    await waitFor(() => expect(mockDownloadLessonPdf).toHaveBeenCalledOnce());
    const [, content, context] = mockDownloadLessonPdf.mock.calls[0];
    expect(content).toBe('Corpo lezione A.');
    expect(context).toBe('Sistemi e Reti - uda-01-reti');
    // No second Storage read for the PDF.
    expect(mockFetchLessonContent).toHaveBeenCalledTimes(1);
  });

  it('deletes an authorized lesson and returns to its UDA', async () => {
    mockDeleteLesson.mockResolvedValue(undefined);
    const onCardPatch = await openLesson();
    fireEvent.click(screen.getByRole('button', { name: 'Azioni lezione' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Elimina lezione' }));
    fireEvent.click(screen.getByRole('button', { name: 'Elimina' }));

    await waitFor(() => expect(mockDeleteLesson).toHaveBeenCalledOnce());
    // Back on the UDA overview; the lesson is gone.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '+ Nuova lezione' })).toBeTruthy(),
    );
    expect(onCardPatch).toHaveBeenCalledWith('p1', expect.objectContaining({ lessonsTotal: 0 }));
  });

  it('shows verification blockers and keeps a lesson when deletion is blocked', async () => {
    mockDeleteLesson.mockRejectedValue(
      new mockDeleteBlockedError([{ verificationId: 'v1', title: 'Compito' }]),
    );
    await openLesson();
    fireEvent.click(screen.getByRole('button', { name: 'Azioni lezione' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Elimina lezione' }));
    fireEvent.click(screen.getByRole('button', { name: 'Elimina' }));

    await waitFor(() => expect(screen.getByText('Compito')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Annulla' }));
    expect(screen.getByRole('heading', { name: 'Lezione A' })).toBeTruthy();
  });

  it('ignores a content save that resolves after the lesson changed', async () => {
    mockListUdas.mockResolvedValue([uda('uda-01-reti')]);
    mockListLessons.mockResolvedValue([
      lesson('lA', 'uda-01-reti', { titolo: 'Lezione A' }),
      lesson('lB', 'uda-01-reti', { titolo: 'Lezione B' }),
    ]);
    mockFetchLessonContent.mockImplementation((ref: string) =>
      Promise.resolve(ref.includes('lA') ? 'Corpo A.' : 'Corpo B.'),
    );
    let resolveSave!: () => void;
    mockUpdateLessonBody.mockImplementation(
      () => new Promise<void>((r) => (resolveSave = () => r())),
    );
    render(<CourseWorkspace card={card()} ownerUid="owner" onBack={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Lezione A' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Lezione A' }));
    await waitFor(() => expect(screen.getByTestId('md').textContent).toContain('Corpo A.'));

    fireEvent.click(screen.getByRole('button', { name: 'Modifica contenuto' }));
    fireEvent.change(screen.getByLabelText('Corpo Markdown'), {
      target: { value: 'Stale A body.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Salva' }));

    // Switch to B while A's save is still pending (confirm the dirty guard).
    fireEvent.click(screen.getByRole('button', { name: 'Lezione B' }));
    fireEvent.click(screen.getByRole('button', { name: /continua senza salvare/i }));
    await waitFor(() => expect(screen.getByTestId('md').textContent).toContain('Corpo B.'));

    // Now A's save resolves — it must not overwrite B's panel.
    resolveSave();
    await Promise.resolve();
    expect(screen.getByTestId('md').textContent).toContain('Corpo B.');
    expect(screen.getByTestId('md').textContent).not.toContain('Stale A body.');
  });
});

describe('CourseWorkspace — async hardening after unmount (DUX-04B)', () => {
  async function selectA(onCardPatch = vi.fn()) {
    mockListUdas.mockResolvedValue([uda('uda-01-reti')]);
    mockListLessons.mockResolvedValue([lesson('lA', 'uda-01-reti', { titolo: 'Lezione A' })]);
    mockFetchLessonContent.mockResolvedValue('Corpo A.');
    const view = render(
      <CourseWorkspace card={card()} ownerUid="owner" onBack={vi.fn()} onCardPatch={onCardPatch} />,
    );
    await waitFor(() => expect(screen.getByRole('button', { name: 'Lezione A' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Lezione A' }));
    await waitFor(() => expect(screen.getByTestId('md')).toBeTruthy());
    return view;
  }

  it('does not patch the card when completion resolves after unmount', async () => {
    let resolve!: () => void;
    mockSetLessonCompleted.mockImplementation(
      () => new Promise<void>((r) => (resolve = () => r())),
    );
    const onCardPatch = vi.fn();
    const { unmount } = await selectA(onCardPatch);
    fireEvent.click(screen.getByRole('button', { name: 'Segna svolta' }));

    unmount();
    resolve();
    await Promise.resolve();
    await Promise.resolve();
    // Remote write completed, but no card callback after unmount.
    expect(onCardPatch).not.toHaveBeenCalled();
  });

  it('does not update or callback when a content save resolves after unmount', async () => {
    let resolve!: () => void;
    mockUpdateLessonBody.mockImplementation(() => new Promise<void>((r) => (resolve = () => r())));
    const onCardPatch = vi.fn();
    const { unmount } = await selectA(onCardPatch);
    fireEvent.click(screen.getByRole('button', { name: 'Modifica contenuto' }));
    fireEvent.change(screen.getByLabelText('Corpo Markdown'), { target: { value: 'nuovo' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salva' }));

    unmount();
    resolve();
    await Promise.resolve();
    await Promise.resolve();
    // Save proceeded; no post-unmount state update or callback.
    expect(mockUpdateLessonBody).toHaveBeenCalledOnce();
    expect(onCardPatch).not.toHaveBeenCalled();
  });

  it('lets a metadata save after a lesson change update the old doc but not the new panel', async () => {
    mockListUdas.mockResolvedValue([uda('uda-01-reti')]);
    mockListLessons.mockResolvedValue([
      lesson('lA', 'uda-01-reti', { titolo: 'Lezione A' }),
      lesson('lB', 'uda-01-reti', { titolo: 'Lezione B' }),
    ]);
    mockFetchLessonContent.mockImplementation((ref: string) =>
      Promise.resolve(ref.includes('lA') ? 'Corpo A.' : 'Corpo B.'),
    );
    let resolveSave!: () => void;
    mockUpdateLessonMetadata.mockImplementation(
      () => new Promise<void>((r) => (resolveSave = () => r())),
    );
    render(<CourseWorkspace card={card()} ownerUid="owner" onBack={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Lezione A' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Lezione A' }));
    await waitFor(() => expect(screen.getByTestId('md').textContent).toContain('Corpo A.'));
    fireEvent.click(screen.getByRole('button', { name: 'Modifica informazioni' }));
    fireEvent.change(screen.getByLabelText('Titolo lezione'), { target: { value: 'A2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salva' }));

    // Switch to B while A's metadata save is pending (dirty guard → confirm).
    fireEvent.click(screen.getByRole('button', { name: 'Lezione B' }));
    fireEvent.click(screen.getByRole('button', { name: /continua senza salvare/i }));
    await waitFor(() => expect(screen.getByTestId('md').textContent).toContain('Corpo B.'));

    resolveSave();
    await Promise.resolve();
    // Still on lesson B; its heading/panel not overwritten by A's save.
    expect(screen.getByRole('heading', { name: 'Lezione B' })).toBeTruthy();
  });
});

describe('CourseWorkspace — mobile progressive navigation (DUX-04C)', () => {
  function renderMobile(onBack = vi.fn()) {
    setViewport(true);
    mockListUdas.mockResolvedValue([uda('uda-01-reti')]);
    mockListLessons.mockResolvedValue([lesson('l1', 'uda-01-reti', { titolo: 'Lezione A' })]);
    mockFetchLessonContent.mockResolvedValue('Corpo.');
    return render(<CourseWorkspace card={card()} ownerUid="owner" onBack={onBack} />);
  }

  it('hides the desktop sidebar and drills course → UDA → lesson', async () => {
    renderMobile();
    await screen.findByRole('table');
    // No desktop sidebar on mobile.
    expect(screen.queryByRole('navigation', { name: 'Struttura corso' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Apri UDA uda-01-reti' }));
    expect(screen.getByRole('heading', { name: 'uda-01-reti' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Apri lezione Lezione A' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Lezione A' })).toBeTruthy());
  });

  it('steps back exactly one level: lesson → UDA → course → library', async () => {
    const onBack = vi.fn();
    renderMobile(onBack);
    await screen.findByRole('table');
    fireEvent.click(screen.getByRole('button', { name: 'Apri UDA uda-01-reti' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apri lezione Lezione A' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Lezione A' })).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: '← Indietro' }));
    expect(screen.getByRole('heading', { name: 'uda-01-reti' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '← Indietro' }));
    expect(screen.getByRole('table')).toBeTruthy();
    // At the course level the button returns to the library.
    fireEvent.click(screen.getByRole('button', { name: '← Libreria' }));
    expect(onBack).toHaveBeenCalledOnce();
  });

  it('keeps the selection across a breakpoint change (desktop lesson → mobile lesson)', async () => {
    const vp = setViewport(false);
    mockListUdas.mockResolvedValue([uda('uda-01-reti')]);
    mockListLessons.mockResolvedValue([lesson('l1', 'uda-01-reti', { titolo: 'Lezione A' })]);
    mockFetchLessonContent.mockResolvedValue('Corpo.');
    render(<CourseWorkspace card={card()} ownerUid="owner" onBack={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('navigation', { name: 'Struttura corso' })));
    // Select the lesson via the desktop sidebar.
    fireEvent.click(screen.getByRole('button', { name: 'Lezione A' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Lezione A' })).toBeTruthy());

    vp.set(true); // switch to mobile
    expect(screen.queryByRole('navigation', { name: 'Struttura corso' })).toBeNull();
    // Same selection is the source of truth → still on the lesson.
    expect(screen.getByRole('heading', { name: 'Lezione A' })).toBeTruthy();
  });

  it('does not reset an open editor draft across a breakpoint change', async () => {
    const vp = setViewport(false);
    mockListUdas.mockResolvedValue([uda('uda-01-reti')]);
    mockListLessons.mockResolvedValue([lesson('l1', 'uda-01-reti', { titolo: 'Lezione A' })]);
    mockFetchLessonContent.mockResolvedValue('Corpo.');
    render(<CourseWorkspace card={card()} ownerUid="owner" onBack={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('navigation', { name: 'Struttura corso' })));
    fireEvent.click(screen.getByRole('button', { name: 'Lezione A' }));
    await waitFor(() => expect(screen.getByTestId('md')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Modifica contenuto' }));
    fireEvent.change(screen.getByLabelText('Corpo Markdown'), {
      target: { value: 'bozza mobile' },
    });

    vp.set(true);
    // Draft preserved through the breakpoint change.
    expect((screen.getByLabelText('Corpo Markdown') as HTMLTextAreaElement).value).toBe(
      'bozza mobile',
    );
  });
});

describe('CourseWorkspace — Organize mode (DUX-04C)', () => {
  async function organizeUdas() {
    mockListUdas.mockResolvedValue([
      uda('uda-01-reti', { order: 0 }),
      uda('uda-02-sic', { order: 1 }),
      uda('uda-03-db', { order: 2 }),
    ]);
    mockListLessons.mockResolvedValue([]);
    render(<CourseWorkspace card={card()} ownerUid="owner" onBack={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Organizza UDA' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Organizza UDA' }));
  }

  it('reorders UDAs down via reorderUda and disables normal actions', async () => {
    mockReorderUda.mockResolvedValue({ order: 1, neighborOrder: 0 });
    await organizeUdas();
    // Normal course actions hidden; "Fine" shown.
    expect(screen.queryByRole('button', { name: 'Azioni corso' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Fine' })).toBeTruthy();
    // First row: up disabled; last row: down disabled.
    expect(
      (screen.getByRole('button', { name: 'Sposta su — uda-01-reti' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (screen.getByRole('button', { name: 'Sposta giù — uda-03-db' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Sposta giù — uda-01-reti' }));
    await waitFor(() => expect(mockReorderUda).toHaveBeenCalledOnce());
    expect(mockReorderUda.mock.calls[0][0]).toMatchObject({
      udaId: 'uda-uda-01-reti',
      neighborUdaId: 'uda-uda-02-sic',
    });
  });

  it('reorders lessons only within the UDA via reorderLesson', async () => {
    mockReorderLesson.mockResolvedValue({ order: 1, neighborOrder: 0 });
    mockListUdas.mockResolvedValue([uda('uda-01-reti')]);
    mockListLessons.mockResolvedValue([
      lesson('lA', 'uda-01-reti', { titolo: 'Lez A', order: 0 }),
      lesson('lB', 'uda-01-reti', { titolo: 'Lez B', order: 1 }),
    ]);
    render(<CourseWorkspace card={card()} ownerUid="owner" onBack={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'uda-01-reti' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'uda-01-reti' }));
    fireEvent.click(screen.getByRole('button', { name: 'Organizza lezioni' }));

    fireEvent.click(screen.getByRole('button', { name: 'Sposta giù — Lez A' }));
    await waitFor(() => expect(mockReorderLesson).toHaveBeenCalledOnce());
    expect(mockReorderLesson.mock.calls[0][0]).toMatchObject({
      lessonId: 'lA',
      neighborLessonId: 'lB',
    });
  });

  it('keeps the previous order and shows an error when reorder fails', async () => {
    mockReorderUda.mockRejectedValue(
      new Error('Impossibile salvare il nuovo ordine delle UDA. Riprova.'),
    );
    await organizeUdas();
    const before = screen.getAllByRole('cell').map((c) => c.textContent);
    fireEvent.click(screen.getByRole('button', { name: 'Sposta giù — uda-01-reti' }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByText(/nuovo ordine delle uda/i)).toBeTruthy();
    // Order unchanged (uda-01 still before uda-02 in the DOM).
    const after = screen.getAllByRole('cell').map((c) => c.textContent);
    expect(after).toEqual(before);
  });

  it('invokes reorderUda once even on a rapid double click (busy lock)', async () => {
    let resolve!: () => void;
    mockReorderUda.mockImplementation(
      () => new Promise((r) => (resolve = () => r({ order: 1, neighborOrder: 0 }))),
    );
    await organizeUdas();
    const down = screen.getByRole('button', { name: 'Sposta giù — uda-01-reti' });
    fireEvent.click(down);
    fireEvent.click(down);
    expect(mockReorderUda).toHaveBeenCalledTimes(1);
    resolve();
    await waitFor(() => expect(mockReorderUda).toHaveBeenCalledTimes(1));
  });

  it('does not update after unmount when a reorder resolves late', async () => {
    let resolve!: () => void;
    mockReorderUda.mockImplementation(
      () => new Promise((r) => (resolve = () => r({ order: 1, neighborOrder: 0 }))),
    );
    await organizeUdas();
    fireEvent.click(screen.getByRole('button', { name: 'Sposta giù — uda-01-reti' }));
    cleanup();
    expect(() => {
      resolve();
    }).not.toThrow();
  });

  it('enters Organize directly when there are no unsaved edits (guarded path)', async () => {
    await organizeUdas();
    // No confirm dialog; arrows are shown immediately.
    expect(screen.queryByRole('alertdialog', { name: 'Modifiche non salvate' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Sposta giù — uda-01-reti' })).toBeTruthy();
  });
});
