import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CourseWorkspace } from '../CourseWorkspace.js';
import type { CourseCard } from '../../repository/programs/courseLibrary.js';
import type { LessonItem, UdaItem } from '../../repository/programs/programsService.js';

const mockListUdas = vi.fn();
const mockListLessons = vi.fn();
const mockFetchLessonContent = vi.fn();

vi.mock('../../../lib/firebase.js', () => ({ db: {}, storage: {} }));
vi.mock('../../repository/programs/programsService.js', () => ({
  listUdas: (...a: unknown[]) => mockListUdas(...a),
  listLessons: (...a: unknown[]) => mockListLessons(...a),
}));
vi.mock('../lessonContent.js', () => ({
  fetchLessonContent: (...a: unknown[]) => mockFetchLessonContent(...a),
}));
vi.mock('../MarkdownRenderer.js', () => ({
  MarkdownRenderer: ({ markdown }: { markdown: string }) => <div data-testid="md">{markdown}</div>,
}));

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
});

function card(overrides: Partial<CourseCard> = {}): CourseCard {
  return {
    programId: 'p1',
    title: 'Sistemi e Reti',
    annoScolastico: '2025/2026',
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
  return render(<CourseWorkspace card={card(over)} onBack={onBack} />);
}

describe('CourseWorkspace — loading', () => {
  it('loads UDA and lessons once for the selected course only', async () => {
    mockListUdas.mockResolvedValue([uda('uda-01-reti')]);
    mockListLessons.mockResolvedValue([lesson('l1', 'uda-01-reti')]);
    renderWorkspace();

    await waitFor(() => expect(screen.getByRole('button', { name: 'uda-01-reti' })).toBeTruthy());
    expect(mockListUdas).toHaveBeenCalledTimes(1);
    expect(mockListLessons).toHaveBeenCalledTimes(1);
    expect(mockListUdas).toHaveBeenCalledWith('p1', 'imp1', expect.anything());
    expect(mockListLessons).toHaveBeenCalledWith('p1', 'imp1', expect.anything());
    // The summary strip reuses the card counters (no recompute).
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

    await waitFor(() =>
      expect(screen.getByText('Panoramica corso', { selector: 'p' })).toBeTruthy(),
    );
    const table = screen.getByRole('table');
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
    expect(screen.getByText('Panoramica corso', { selector: 'p' })).toBeTruthy();

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
