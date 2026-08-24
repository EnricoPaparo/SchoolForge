import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StrictMode } from 'react';
import { CourseWorkspace } from '../CourseWorkspace.js';
import { PdfModuleLoadError } from '../../../lib/pdfModuleLoader.js';
import type { CourseCard } from '../../repository/programs/courseLibrary.js';
import type { LessonItem, UdaItem } from '../../repository/programs/programsService.js';
import type { LessonVisualPrivateManifest } from '../../../types/firestore.js';
import type * as PdfModuleLoaderModule from '../../../lib/pdfModuleLoader.js';
import type * as ProgrammaSvoltoModule from '../programmaSvolto.js';

const mockListUdas = vi.fn();
const mockListLessons = vi.fn();
const mockFetchLessonContent = vi.fn();
const mockFetchPublicLessonContent = vi.fn();
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
const mockUpdateProgramMetadata = vi.fn();
const mockReorderUda = vi.fn();
const mockReorderLesson = vi.fn();
const mockDownloadProgramPdf = vi.fn();
const mockReloadCurrentPage = vi.fn();
const mockVisualPreviewProposal = vi.fn();
const mockVisualGenerateProposal = vi.fn();
const mockVisualBind = vi.fn();
const mockVisualPreviewImage = vi.fn();
const mockVisualGenerateImage = vi.fn();
const mockVisualPromote = vi.fn();
const mockVisualAbandon = vi.fn();
const mockVisualRemove = vi.fn();
const mockReadAuthoritativePrivateVisual = vi.fn();
const mockReadTeacherVisual = vi.fn();

vi.mock('../../../lib/firebase.js', () => ({ db: {}, storage: {}, functions: {} }));
vi.mock('../../repository/programs/visualGenerationClient.js', () => ({
  createVisualWorkflowPorts: () => ({
    previewProposal: (...args: unknown[]) => mockVisualPreviewProposal(...args),
    generateProposal: (...args: unknown[]) => mockVisualGenerateProposal(...args),
    bind: (...args: unknown[]) => mockVisualBind(...args),
    previewImage: (...args: unknown[]) => mockVisualPreviewImage(...args),
    generateImage: (...args: unknown[]) => mockVisualGenerateImage(...args),
    promote: (...args: unknown[]) => mockVisualPromote(...args),
    abandon: (...args: unknown[]) => mockVisualAbandon(...args),
    remove: (...args: unknown[]) => mockVisualRemove(...args),
  }),
  readAuthoritativePrivateVisual: (...args: unknown[]) =>
    mockReadAuthoritativePrivateVisual(...args),
}));
vi.mock('../../repository/programs/visualReadClients.js', () => ({
  createTeacherVisualReader:
    () =>
    (...args: unknown[]) =>
      mockReadTeacherVisual(...args),
}));
vi.mock('../../../lib/pdfModuleLoader.js', async (importOriginal) => {
  const actual = await importOriginal<typeof PdfModuleLoaderModule>();
  return { ...actual, reloadCurrentPage: () => mockReloadCurrentPage() };
});
vi.mock('../programmaSvolto.js', async (importOriginal) => {
  const actual = await importOriginal<typeof ProgrammaSvoltoModule>();
  return {
    ...actual,
    downloadPdf: (...args: unknown[]) => mockDownloadProgramPdf(...args),
  };
});
vi.mock('../../repository/programs/programNotesCleanupClient.js', () => ({
  createProgramNotesCleanupCallable: () => vi.fn(),
}));
vi.mock('../../repository/programs/programsService.js', () => ({
  listUdas: (...a: unknown[]) => mockListUdas(...a),
  listLessons: (...a: unknown[]) => mockListLessons(...a),
  updateProgramTitle: (...a: unknown[]) => mockUpdateProgramTitle(...a),
  setProgramClassIds: (...a: unknown[]) => mockSetProgramClassIds(...a),
  deleteProgram: (...a: unknown[]) => mockDeleteProgram(...a),
  getImportMeta: (...a: unknown[]) => mockGetImportMeta(...a),
  setLessonCompleted: (...a: unknown[]) => mockSetLessonCompleted(...a),
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
  updateProgramMetadata: (...a: unknown[]) => mockUpdateProgramMetadata(...a),
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
  fetchPublicLessonContent: (...a: unknown[]) => mockFetchPublicLessonContent(...a),
}));
vi.mock('../MarkdownRenderer.js', () => ({
  MarkdownRenderer: ({
    markdown,
    visual,
  }: {
    markdown: string;
    visual?: { caption: string; dataUri: string | null } | null;
  }) => (
    <div
      data-testid="md"
      data-visual={visual ? 'present' : 'absent'}
      data-visual-caption={visual?.caption ?? ''}
      data-visual-bytes={visual?.dataUri ?? ''}
    >
      {markdown}
    </div>
  ),
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
  // Default: no usable Firestore projection, so existing tests exercise the
  // legacy Storage path (fetchLessonContent). MOB-01C tests override this.
  mockFetchPublicLessonContent.mockResolvedValue(null);
  mockDownloadProgramPdf.mockResolvedValue(undefined);
  mockVisualPreviewProposal.mockResolvedValue({
    kind: 'visual_proposal',
    modelProfile: 'quality',
    estimatedInputTokens: 100,
    maxOutputTokens: 200,
    estimatedCostMicroUsd: 10,
    reservationCostMicroUsd: 20,
    requestedTotal: null,
  });
  mockVisualRemove.mockResolvedValue(undefined);
  mockReadAuthoritativePrivateVisual.mockResolvedValue(null);
  mockReadTeacherVisual.mockResolvedValue(null);
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

function visualManifest(overrides: Partial<LessonVisualPrivateManifest> = {}) {
  return {
    assetId: '123e4567-e89b-42d3-a456-426614174000',
    anchor: {
      headingSlug: 'topologie',
      headingText: 'Topologie',
      placement: 'after-heading' as const,
    },
    caption: 'Topologie di rete',
    altText: 'Schema delle topologie di rete',
    width: 800,
    height: 600,
    storageRef:
      'repository/owner/imp1/uda-01-reti/visuals/123e4567-e89b-42d3-a456-426614174000.webp',
    byteLength: 128,
    sha256: 'a'.repeat(64),
    mimeType: 'image/webp' as const,
    styleVersion: 'schoolforge-sketch/v1' as const,
    sourceBodyHash: 'b'.repeat(64),
    approvedAt: { toMillis: () => 1_700_000_000_000 } as LessonVisualPrivateManifest['approvedAt'],
    ...overrides,
  } satisfies LessonVisualPrivateManifest;
}

function renderWorkspace(over: Partial<CourseCard> = {}, onBack = vi.fn()) {
  return render(<CourseWorkspace card={card(over)} ownerUid="owner" onBack={onBack} />);
}

async function expandUda(dir = 'uda-01-reti') {
  await waitFor(() => expect(screen.getByRole('button', { name: dir })).toBeTruthy());
  const expand = screen.queryByRole('button', { name: `Espandi ${dir}` });
  if (expand) fireEvent.click(expand);
}

function clickMenuAction(
  context: 'Azioni corso' | 'Azioni UDA' | 'Azioni lezione',
  action: string,
) {
  fireEvent.click(screen.getByRole('button', { name: context }));
  fireEvent.click(screen.getByRole('menuitem', { name: action }));
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
    // Large course trees start compact: every UDA is collapsed until requested.
    expect(screen.getByRole('button', { name: 'Espandi uda-01-reti' })).toBeTruthy();
    expect(screen.queryByTitle('Pool assente')).toBeNull();
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
    expect(screen.getByText('Progettare una LAN').closest('li')?.parentElement?.tagName).toBe('UL');
    expect(screen.getByText('Comprendere TCP/IP').closest('li')?.parentElement?.tagName).toBe('UL');
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

    await expandUda();
    fireEvent.click(screen.getByRole('button', { name: 'Il modello ISO/OSI' }));
    await waitFor(() => expect(screen.getByTestId('md')).toBeTruthy());
    expect(mockFetchLessonContent).toHaveBeenCalledTimes(1);
    expect(mockFetchLessonContent).toHaveBeenCalledWith('ref/uda-01-reti/l1.md', expect.anything());
    expect(screen.getByTestId('md').textContent).toContain('Corpo della lezione.');
    // No pool read: the only content read is the lesson Markdown itself.
    expect(mockListLessons).toHaveBeenCalledTimes(1);
    expect(mockListUdas).toHaveBeenCalledTimes(1);
  });

  it('mostra il controllo visuale disabilitato durante loading, errore e contenuto vuoto', async () => {
    mockListUdas.mockResolvedValue([uda('uda-01-reti')]);
    mockListLessons.mockResolvedValue([lesson('l1', 'uda-01-reti', { titolo: 'Visuale' })]);
    let rejectContent!: (cause: unknown) => void;
    mockFetchLessonContent.mockReturnValue(
      new Promise<string>((_resolve, reject) => {
        rejectContent = reject;
      }),
    );
    vi.spyOn(console, 'error').mockImplementation(() => {});
    renderWorkspace();
    await expandUda();
    fireEvent.click(screen.getByRole('button', { name: 'Visuale' }));

    const control = await screen.findByRole('button', { name: 'Arricchisci visivamente' });
    expect(control.hasAttribute('disabled')).toBe(true);
    expect(screen.getByText('Attendi il caricamento del contenuto.')).toBeTruthy();

    rejectContent(new Error('boom'));
    await screen.findByText('Risolvi prima l’errore di caricamento del contenuto.');
    expect(control.hasAttribute('disabled')).toBe(true);

    cleanup();
    vi.clearAllMocks();
    mockFetchPublicLessonContent.mockResolvedValue(null);
    mockListUdas.mockResolvedValue([uda('uda-01-reti')]);
    mockListLessons.mockResolvedValue([lesson('l1', 'uda-01-reti', { titolo: 'Vuota' })]);
    mockFetchLessonContent.mockResolvedValue('   ');
    renderWorkspace();
    await expandUda();
    fireEvent.click(screen.getByRole('button', { name: 'Vuota' }));
    expect(await screen.findByText('La lezione deve avere un contenuto salvato.')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Arricchisci visivamente' }).hasAttribute('disabled'),
    ).toBe(true);
  });

  it('non apre workflow dalla scheda Contenuto e richiede heading H2/H3 canonici', async () => {
    mockListUdas.mockResolvedValue([uda('uda-01-reti')]);
    mockListLessons.mockResolvedValue([lesson('l1', 'uda-01-reti', { titolo: 'Visuale' })]);
    mockFetchLessonContent.mockResolvedValue('# Titolo\n\nCorpo senza sottosezioni.');
    renderWorkspace();
    await expandUda();
    fireEvent.click(screen.getByRole('button', { name: 'Visuale' }));
    const control = await screen.findByRole('button', { name: 'Arricchisci visivamente' });
    expect(control.hasAttribute('disabled')).toBe(true);
    expect(screen.getByText(/almeno un titolo H2 o H3/)).toBeTruthy();
    expect(screen.queryByText('Stima della proposta testuale')).toBeNull();
  });

  it('ignores an out-of-order stale fetch: the last selected lesson wins', async () => {
    mockListUdas.mockResolvedValue([uda('uda-01-reti')]);
    mockListLessons.mockResolvedValue([
      lesson('lA', 'uda-01-reti', { titolo: 'Lezione A' }),
      lesson('lB', 'uda-01-reti', { titolo: 'Lezione B' }),
    ]);

    // Two controlled reads (primary Firestore projection): A (first selected)
    // resolves *after* B (second).
    let resolveA!: (v: string) => void;
    let resolveB!: (v: string) => void;
    mockFetchPublicLessonContent
      .mockImplementationOnce(() => new Promise<string>((r) => (resolveA = r)))
      .mockImplementationOnce(() => new Promise<string>((r) => (resolveB = r)));

    renderWorkspace();
    await expandUda();

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

    await expandUda();
    fireEvent.click(screen.getByRole('button', { name: 'Rotta' }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByText(/impossibile caricare il contenuto/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Arricchisci visivamente' })).toBeTruthy();
  });
});

describe('CourseWorkspace — visual workflow wiring (VE-04B)', () => {
  async function openVisualLesson(currentVisual: LessonVisualPrivateManifest | null) {
    mockListUdas.mockResolvedValue([
      uda('uda-01-reti', {
        titolo: 'Reti di calcolatori',
        descrizione: 'Fondamenti di reti',
        competenze: ['Progettare una LAN'],
        obiettivi: ['Confrontare le topologie'],
      }),
    ]);
    mockListLessons.mockResolvedValue([
      lesson('l1', 'uda-01-reti', {
        titolo: 'Topologie di rete',
        visual: currentVisual ?? undefined,
      }),
    ]);
    mockFetchLessonContent.mockResolvedValue(
      '---\ntitolo: Topologie di rete\ndifficolta: base\n---\n\n## Topologie\n\nCorpo.',
    );
    if (currentVisual) {
      mockReadTeacherVisual.mockResolvedValue({
        assetId: currentVisual.assetId,
        dataUri: 'data:image/webp;base64,UklGRg==',
        width: currentVisual.width,
        height: currentVisual.height,
      });
    }

    renderWorkspace();
    await expandUda();
    fireEvent.click(await screen.findByRole('button', { name: 'Topologie di rete' }));
    await screen.findByTestId('md');
  }

  it('apre il percorso proposta dal controllo reale e restituisce il focus alla chiusura', async () => {
    await openVisualLesson(null);
    const trigger = screen.getByRole('button', { name: 'Arricchisci visivamente' });
    trigger.focus();
    fireEvent.click(trigger);

    await screen.findByText('Stima della proposta testuale');
    expect(mockVisualPreviewProposal).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Annulla' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });

  it('gestisce e rimuove la visual corrente senza IA, poi aggiorna controllo e renderer', async () => {
    const current = visualManifest();
    await openVisualLesson(current);
    await waitFor(() => expect(screen.getByTestId('md').dataset.visualBytes).toContain('UklGRg'));
    expect(screen.getByTestId('md').dataset.visual).toBe('present');
    expect(screen.getByTestId('md').dataset.visualCaption).toBe(current.caption);

    const trigger = screen.getByRole('button', { name: 'Gestisci immagine' });
    trigger.focus();
    fireEvent.click(trigger);
    await screen.findByRole('heading', { name: 'Immagine attuale' });
    expect(mockVisualPreviewProposal).not.toHaveBeenCalled();
    expect(mockVisualGenerateProposal).not.toHaveBeenCalled();
    expect(mockVisualBind).not.toHaveBeenCalled();
    expect(mockVisualPreviewImage).not.toHaveBeenCalled();
    expect(mockVisualGenerateImage).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Rimuovi immagine' }));
    fireEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', {
        name: 'Rimuovi immagine',
      }),
    );

    await waitFor(() => expect(mockVisualRemove).toHaveBeenCalledOnce());
    expect(mockVisualRemove).toHaveBeenCalledWith({
      programId: 'p1',
      importId: 'imp1',
      lessonId: 'l1',
    });
    expect(mockReadAuthoritativePrivateVisual).toHaveBeenCalledOnce();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Arricchisci visivamente' })).toBeTruthy(),
    );
    expect(screen.getByTestId('md').dataset.visual).toBe('absent');
    expect(screen.getByTestId('md').dataset.visualBytes).toBe('');
    expect(document.activeElement).toBe(trigger);
    expect(mockVisualPromote).not.toHaveBeenCalled();
    expect(mockVisualAbandon).not.toHaveBeenCalled();
  });
});

describe('CourseWorkspace — content load diagnostics + retry (MOB-01B)', () => {
  function storageErr() {
    return Object.assign(new Error('blocked'), { code: 'storage/unknown', status: 0 });
  }

  it('shows non-sensitive technical details on failure', async () => {
    mockListUdas.mockResolvedValue([uda('uda-01-reti')]);
    mockListLessons.mockResolvedValue([lesson('l1', 'uda-01-reti', { titolo: 'Rotta' })]);
    mockFetchLessonContent.mockRejectedValue(storageErr());
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    renderWorkspace();

    await expandUda();
    fireEvent.click(screen.getByRole('button', { name: 'Rotta' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Riprova' })).toBeTruthy());

    // Details are behind a disclosure and carry only whitelisted fields.
    fireEvent.click(screen.getByText('Dettagli tecnici'));
    expect(screen.getByText('storage/unknown')).toBeTruthy();
    expect(screen.getByText('Codice')).toBeTruthy();
    expect(screen.getByText('Stato HTTP')).toBeTruthy();

    // Exactly one structured console line per failed attempt; nothing written
    // to Firebase (no service mock was invoked beyond the content fetch).
    expect(errSpy).toHaveBeenCalledTimes(1);
    expect(errSpy.mock.calls[0][0]).toBe('[lesson-content] load failed');
    errSpy.mockRestore();
  });

  it('Riprova performs exactly one new read and renders content on success', async () => {
    mockListUdas.mockResolvedValue([uda('uda-01-reti')]);
    mockListLessons.mockResolvedValue([lesson('l1', 'uda-01-reti', { titolo: 'Rotta' })]);
    mockFetchLessonContent
      .mockRejectedValueOnce(storageErr())
      .mockResolvedValueOnce('# Ok\n\nContenuto recuperato.');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    renderWorkspace();

    await expandUda();
    fireEvent.click(screen.getByRole('button', { name: 'Rotta' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Riprova' })).toBeTruthy());
    expect(mockFetchLessonContent).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Riprova' }));
    await waitFor(() => expect(screen.getByTestId('md')).toBeTruthy());
    // One new read only, on the same storageRef.
    expect(mockFetchLessonContent).toHaveBeenCalledTimes(2);
    expect(mockFetchLessonContent).toHaveBeenLastCalledWith(
      'ref/uda-01-reti/l1.md',
      expect.anything(),
    );
    expect(screen.getByTestId('md').textContent).toContain('Contenuto recuperato.');
    expect(screen.queryByRole('button', { name: 'Riprova' })).toBeNull();
  });

  it('a superseded earlier read never overwrites a newer selection', async () => {
    mockListUdas.mockResolvedValue([uda('uda-01-reti')]);
    mockListLessons.mockResolvedValue([lesson('l1', 'uda-01-reti', { titolo: 'Rotta' })]);
    let resolveRetry!: (v: string) => void;
    let resolveNewer!: (v: string) => void;
    // Primary reads go through the Firestore projection now; drive it.
    mockFetchPublicLessonContent
      .mockRejectedValueOnce(storageErr())
      .mockImplementationOnce(() => new Promise<string>((r) => (resolveRetry = r)))
      .mockImplementationOnce(() => new Promise<string>((r) => (resolveNewer = r)));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    renderWorkspace();

    await expandUda();
    fireEvent.click(screen.getByRole('button', { name: 'Rotta' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Riprova' })).toBeTruthy());

    // Retry (read #2, still pending), then re-select the lesson from the
    // sidebar (read #3) which supersedes it.
    fireEvent.click(screen.getByRole('button', { name: 'Riprova' }));
    fireEvent.click(screen.getByRole('button', { name: 'Rotta' }));

    resolveNewer('# Tre\n\nmeta-nuovo.');
    await waitFor(() => expect(screen.getByTestId('md').textContent).toContain('meta-nuovo'));
    // The obsolete retry resolves last and must not overwrite the panel.
    resolveRetry('# Due\n\nmeta-obsoleto.');
    await waitFor(() => expect(screen.getByTestId('md').textContent).toContain('meta-nuovo'));
    expect(screen.getByTestId('md').textContent).not.toContain('meta-obsoleto');
  });
});

describe('CourseWorkspace — Firestore projection primary source (MOB-01C)', () => {
  async function openLessonFrom(over: Partial<LessonItem> = {}) {
    mockListUdas.mockResolvedValue([uda('uda-01-reti')]);
    mockListLessons.mockResolvedValue([
      lesson('l1', 'uda-01-reti', { titolo: 'Lezione A', ...over }),
    ]);
    renderWorkspace();
    await expandUda();
    fireEvent.click(screen.getByRole('button', { name: 'Lezione A' }));
  }

  it('valid projection → one Firestore read, zero Storage reads', async () => {
    mockFetchPublicLessonContent.mockResolvedValue('# Titolo\n\nCorpo dalla proiezione.');
    await openLessonFrom();

    await waitFor(() => expect(screen.getByTestId('md')).toBeTruthy());
    expect(screen.getByTestId('md').textContent).toContain('Corpo dalla proiezione.');
    expect(mockFetchPublicLessonContent).toHaveBeenCalledTimes(1);
    expect(mockFetchPublicLessonContent).toHaveBeenCalledWith(
      { lessonId: 'l1', programId: 'p1', importId: 'imp1', ownerUid: 'owner' },
      expect.anything(),
    );
    expect(mockFetchLessonContent).not.toHaveBeenCalled();
  });

  it('valid empty content → rendered as empty, zero Storage reads', async () => {
    mockFetchPublicLessonContent.mockResolvedValue('');
    await openLessonFrom();

    await waitFor(() => expect(screen.getByText(/nessun contenuto disponibile/i)).toBeTruthy());
    expect(mockFetchLessonContent).not.toHaveBeenCalled();
  });

  it('keeps the lesson metadata (from the tree) when serving the projection', async () => {
    mockFetchPublicLessonContent.mockResolvedValue('Corpo.');
    // titolo stays 'Lezione A' (the sidebar/click name); the subtitle comes
    // from the tree lesson, not from re-parsed front matter.
    await openLessonFrom({ sottotitolo: 'Livelli' });

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Lezione A' })).toBeTruthy());
    expect(screen.getByText('Livelli')).toBeTruthy();
  });

  it('legacy projection without content → one Firestore + one Storage read', async () => {
    mockFetchPublicLessonContent.mockResolvedValue(null); // legacy / no content
    mockFetchLessonContent.mockResolvedValue('# T\n\nCorpo da Storage legacy.');
    await openLessonFrom();

    await waitFor(() => expect(screen.getByTestId('md')).toBeTruthy());
    expect(screen.getByTestId('md').textContent).toContain('Corpo da Storage legacy.');
    expect(mockFetchPublicLessonContent).toHaveBeenCalledTimes(1);
    expect(mockFetchLessonContent).toHaveBeenCalledTimes(1);
    expect(mockFetchLessonContent).toHaveBeenCalledWith('ref/uda-01-reti/l1.md', expect.anything());
  });

  it('Firestore error → NO Storage fallback, error visible, source = Firestore', async () => {
    mockFetchPublicLessonContent.mockRejectedValue(
      Object.assign(new Error('denied'), { code: 'permission-denied' }),
    );
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await openLessonFrom();

    await waitFor(() => expect(screen.getByRole('button', { name: 'Riprova' })).toBeTruthy());
    // Never fell through to Storage.
    expect(mockFetchLessonContent).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Dettagli tecnici'));
    expect(screen.getByText('Firestore publicLessons')).toBeTruthy();
  });

  it('Riprova after a Firestore error performs exactly one new read', async () => {
    mockFetchPublicLessonContent
      .mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'unavailable' }))
      .mockResolvedValueOnce('# Ok\n\nRecuperato via proiezione.');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await openLessonFrom();

    await waitFor(() => expect(screen.getByRole('button', { name: 'Riprova' })).toBeTruthy());
    expect(mockFetchPublicLessonContent).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Riprova' }));
    await waitFor(() => expect(screen.getByTestId('md')).toBeTruthy());
    expect(mockFetchPublicLessonContent).toHaveBeenCalledTimes(2);
    expect(mockFetchLessonContent).not.toHaveBeenCalled();
    expect(screen.getByTestId('md').textContent).toContain('Recuperato via proiezione.');
  });
});

describe('CourseWorkspace — sidebar and semantics', () => {
  it('offers lesson focus mode without a global sidebar collapse control', async () => {
    mockListUdas.mockResolvedValue([uda('uda-01-reti')]);
    mockListLessons.mockResolvedValue([lesson('l1', 'uda-01-reti', { titolo: 'Lez 1' })]);
    mockFetchLessonContent.mockResolvedValue('Corpo lezione.');
    renderWorkspace();

    await expandUda();
    expect(screen.queryByRole('button', { name: /comprimi struttura corso/i })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Lez 1' }));
    // Structure toggle lives on the toolbar (outside the "Azioni" menu) now.
    fireEvent.click(screen.getByRole('button', { name: 'Nascondi struttura' }));
    expect(screen.queryByRole('navigation', { name: 'Struttura corso' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'uda-01-reti' })).toBeNull();
    expect(screen.getByRole('tablist', { name: 'Schede lezione' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Mostra struttura' }));
    expect(screen.getByRole('navigation', { name: 'Struttura corso' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'uda-01-reti' })).toBeTruthy();
  });

  it('uses a semantic structure: nav + button rows with no nested interactive controls', async () => {
    mockListUdas.mockResolvedValue([uda('uda-01-reti')]);
    mockListLessons.mockResolvedValue([lesson('l1', 'uda-01-reti', { titolo: 'Lez 1' })]);
    renderWorkspace();

    await expandUda();
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

    await expandUda();
    const nav = await screen.findByRole('navigation', { name: 'Struttura corso' });
    expect(within(nav).getByRole('img', { name: 'Lezione svolta' })).toBeTruthy();
    expect(within(nav).getByRole('img', { name: 'Pool presente e valido' })).toBeTruthy();
    expect(within(nav).getByRole('img', { name: 'Pool assente' })).toBeTruthy();
    expect(within(nav).getByRole('img', { name: 'Pool presente ma non valido' })).toBeTruthy();
  });

  it('marks an UDA as completed only when all of its lessons are completed', async () => {
    mockListUdas.mockResolvedValue([uda('uda-01-reti'), uda('uda-02-vuota')]);
    mockListLessons.mockResolvedValue([
      lesson('l1', 'uda-01-reti', { completed: true }),
      lesson('l2', 'uda-01-reti', { completed: true }),
    ]);
    renderWorkspace();

    await waitFor(() => expect(screen.getByTitle('UDA completata')).toBeTruthy());
    expect(screen.getByTitle('UDA da completare')).toBeTruthy();
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
  async function openLesson(title = 'Il modello ISO/OSI', body = 'Corpo lezione.') {
    mockListUdas.mockResolvedValue([uda('uda-01-reti')]);
    mockListLessons.mockResolvedValue([lesson('l1', 'uda-01-reti', { titolo: title })]);
    mockFetchLessonContent.mockResolvedValue(body);
    renderWorkspace();
    await expandUda();
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

  it('Informazioni shows only didactic metadata and no technical file path', async () => {
    await openLesson();
    fireEvent.click(screen.getByRole('tab', { name: 'Informazioni' }));
    expect(screen.getByText(/nessun metadato/i)).toBeTruthy();
    expect(screen.queryByText(/dettagli tecnici/i)).toBeNull();
    expect(screen.queryByText('uda-01-reti/l1.md')).toBeNull();
  });

  it('Informazioni renders lesson key concepts and objectives as semantic lists', async () => {
    const firstObjective =
      'Descrivere le differenze tra interfaccia a riga di comando e interfaccia grafica.';
    const secondObjective =
      'Eseguire da riga di comando i comandi per verificare la cartella corrente ed elencarne il contenuto.';
    await openLesson(
      'Aprire il prompt dei comandi ed eseguire i primi comandi',
      `---
titolo: Aprire il prompt dei comandi ed eseguire i primi comandi
sottotitolo: Riga di comando
difficolta: base
concetti_chiave:
  - riga di comando
obiettivi:
  - ${firstObjective}
  - ${secondObjective}
---
`,
    );
    fireEvent.click(screen.getByRole('tab', { name: 'Informazioni' }));

    const keyConceptTerm = screen.getByText('Concetti chiave', { selector: 'dt' });
    const keyConceptList = keyConceptTerm.nextElementSibling?.querySelector('ul');
    expect(keyConceptList).not.toBeNull();
    expect(within(keyConceptList!).getAllByRole('listitem')).toHaveLength(1);
    expect(within(keyConceptList!).getByRole('listitem').textContent).toBe('riga di comando');

    const objectivesTerm = screen.getByText('Obiettivi', { selector: 'dt' });
    const objectivesList = objectivesTerm.nextElementSibling?.querySelector('ul');
    expect(objectivesList).not.toBeNull();
    expect(
      within(objectivesList!)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual([firstObjective, secondObjective]);
    expect(objectivesTerm.nextElementSibling?.textContent).not.toContain(
      `${firstObjective}, ${secondObjective}`,
    );
  });

  it('keeps an internal comma inside one objective list item', async () => {
    const objective = 'Descrivere file, cartelle e percorsi dalla riga di comando.';
    await openLesson(
      'Riga di comando',
      `---
titolo: Riga di comando
difficolta: base
concetti_chiave:
  - shell
obiettivi:
  - ${objective}
---
`,
    );
    fireEvent.click(screen.getByRole('tab', { name: 'Informazioni' }));

    const objectivesTerm = screen.getByText('Obiettivi', { selector: 'dt' });
    const items = within(objectivesTerm.nextElementSibling as HTMLElement).getAllByRole('listitem');
    expect(items).toHaveLength(1);
    expect(items[0]!.textContent).toBe(objective);
  });

  it('renders duplicate values without React key warnings', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      await openLesson(
        'Valori duplicati',
        `---
titolo: Valori duplicati
difficolta: base
concetti_chiave:
  - shell
  - shell
obiettivi:
  - Eseguire un comando
  - Eseguire un comando
---
`,
      );
      fireEvent.click(screen.getByRole('tab', { name: 'Informazioni' }));

      const infoList = screen.getByText('Obiettivi', { selector: 'dt' }).closest('dl');
      expect(within(infoList!).getAllByRole('listitem')).toHaveLength(4);
      expect(consoleError).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });

  it('hides empty lesson list sections while preserving other metadata', async () => {
    await openLesson(
      'Solo titolo',
      `---
titolo: Solo titolo
difficolta: base
concetti_chiave: []
obiettivi: []
---
`,
    );
    fireEvent.click(screen.getByRole('tab', { name: 'Informazioni' }));

    expect(screen.getByText('Titolo', { selector: 'dt' })).toBeTruthy();
    expect(screen.queryByText('Concetti chiave', { selector: 'dt' })).toBeNull();
    expect(screen.queryByText('Obiettivi', { selector: 'dt' })).toBeNull();
  });

  it('keeps lesson metadata arrays newline-separated in the editor', async () => {
    await openLesson(
      'Riga di comando',
      `---
titolo: Riga di comando
difficolta: base
concetti_chiave:
  - shell
  - terminale
obiettivi:
  - Primo obiettivo
  - Secondo obiettivo
---
`,
    );
    clickMenuAction('Azioni lezione', 'Modifica informazioni');

    expect((screen.getByLabelText('Concetti chiave lezione') as HTMLTextAreaElement).value).toBe(
      'shell\nterminale',
    );
    expect((screen.getByLabelText('Obiettivi lezione') as HTMLTextAreaElement).value).toBe(
      'Primo obiettivo\nSecondo obiettivo',
    );
  });

  it('confirms before changing lesson when the pool has unsaved edits', async () => {
    mockListUdas.mockResolvedValue([uda('uda-01-reti')]);
    mockListLessons.mockResolvedValue([
      lesson('lA', 'uda-01-reti', { titolo: 'Lezione A' }),
      lesson('lB', 'uda-01-reti', { titolo: 'Lezione B' }),
    ]);
    mockFetchLessonContent.mockResolvedValue('Corpo.');
    renderWorkspace();

    await expandUda();
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
    await expandUda();
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

    await expandUda();
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
    // CONCEPT-MAP-04: la mappa è la seconda scheda, quindi è lei la prima a
    // destra del contenuto.
    const tabMappa = screen.getByRole('tab', { name: 'Mappa concettuale' });
    const tabDomande = screen.getByRole('tab', { name: 'Domande' });
    const tabInformazioni = screen.getByRole('tab', { name: 'Informazioni' });
    const allTabs = [tabContenuto, tabMappa, tabDomande, tabInformazioni];

    tabContenuto.focus();
    fireEvent.keyDown(tabContenuto, { key: 'ArrowRight' });
    expect(tabMappa.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(tabMappa);
    // Roving tabindex: exactly one tab is in the tab order.
    expect(allTabs.filter((t) => t.tabIndex === 0)).toEqual([tabMappa]);

    fireEvent.keyDown(tabMappa, { key: 'ArrowRight' });
    expect(tabDomande.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(tabDomande);

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
    fireEvent.click(screen.getByRole('button', { name: 'Azioni corso' }));
    expect(screen.getByRole('menuitem', { name: 'Nuova UDA' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Azioni corso' }));

    fireEvent.click(screen.getByRole('button', { name: 'uda-01-reti' }));
    expect(screen.getByRole('button', { name: 'Azioni UDA' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Azioni corso' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Azioni UDA' }));
    expect(screen.getByRole('menuitem', { name: 'Nuova lezione' })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: 'Nuova UDA' })).toBeNull();
  });

  it('renders the Actions menu on document.body (outside the scrollable panel)', async () => {
    await renderAndReady();
    fireEvent.click(screen.getByRole('button', { name: 'Azioni corso' }));
    const menu = screen.getByRole('menu');
    // Portaled: its parent is <body>, so no scrollable/overflow ancestor of the
    // workspace can clip it.
    expect(menu.parentElement).toBe(document.body);
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

  it('edits course metadata and patches the school year without reloading the library', async () => {
    const onCardPatch = vi.fn();
    mockGetImportMeta.mockResolvedValue({
      annoScolastico: '2025/2026',
      docente: 'Mario Rossi',
      materia: 'Informatica',
      classe: '3A',
      descrizione: 'Corso base',
    });
    mockUpdateProgramMetadata.mockResolvedValue({
      annoScolastico: '2026/2027',
      docente: 'Mario Rossi',
      materia: 'Informatica',
      classe: '3A',
      descrizione: 'Corso aggiornato',
    });
    await renderAndReady({}, { onCardPatch });

    fireEvent.click(screen.getByRole('button', { name: 'Azioni corso' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Modifica metadati corso' }));
    await waitFor(() => expect(screen.getByText('2025/2026')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Modifica' }));
    fireEvent.change(screen.getByLabelText('Anno scolastico'), {
      target: { value: '2026/2027' },
    });
    fireEvent.change(screen.getByLabelText('Descrizione'), {
      target: { value: 'Corso aggiornato' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Salva' }));

    await waitFor(() => expect(mockUpdateProgramMetadata).toHaveBeenCalledOnce());
    expect(mockUpdateProgramMetadata).toHaveBeenCalledWith(
      expect.objectContaining({
        programId: 'p1',
        importId: 'imp1',
        ownerUid: 'owner',
        fields: expect.objectContaining({
          annoScolastico: '2026/2027',
          descrizione: 'Corso aggiornato',
        }),
      }),
    );
    expect(onCardPatch).toHaveBeenCalledWith('p1', { annoScolastico: '2026/2027' });
  });

  it('does not offer metadata editing before the course has an active import', async () => {
    render(
      <CourseWorkspace
        card={card({ activeImportId: null, hasImport: false })}
        ownerUid="owner"
        onBack={vi.fn()}
      />,
    );
    await waitFor(() => expect(screen.getByRole('button', { name: 'Azioni corso' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Azioni corso' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Modifica metadati corso' }));

    expect(
      screen.getByText('Importa prima un contenuto didattico per aggiungere i metadati.'),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Modifica' })).toBeNull();
    expect(mockUpdateProgramMetadata).not.toHaveBeenCalled();
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
    clickMenuAction('Azioni corso', 'Nuova UDA');
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

  it('keeps a committed import successful when the post-switch metadata re-read fails', async () => {
    const onCardPatch = vi.fn();
    mockReadZipFile.mockResolvedValue([{ path: 'programma.md', text: '' }]);
    mockImportRepository.mockResolvedValue({
      status: 'committed',
      importId: 'imp2',
      udaCount: 3,
      lessonCount: 9,
      questionCount: 20,
      cleanupPending: false,
    });
    // The atomic switch already succeeded; only the post-switch metadata
    // re-read fails. This must NOT surface as an import error.
    mockGetImportMeta.mockRejectedValue(new Error('firestore transient'));
    await renderAndReady({}, { onCardPatch });

    fireEvent.click(screen.getByRole('button', { name: 'Azioni corso' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Importa ZIP' }));
    const file = new File(['z'], 'c.zip', { type: 'application/zip' });
    fireEvent.change(screen.getByLabelText('File ZIP del corso'), { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: 'Importa' }));

    await waitFor(() => expect(mockGetImportMeta).toHaveBeenCalledOnce());
    // Card patched from ImportRepositoryResult (success preserved).
    await waitFor(() =>
      expect(onCardPatch).toHaveBeenCalledWith(
        'p1',
        expect.objectContaining({ activeImportId: 'imp2', udaCount: 3, questionsTotal: 20 }),
      ),
    );
    // No blocking error, dialog closed, only a non-blocking deferred-refresh notice.
    expect(screen.queryByText("Errore durante l'importazione")).toBeNull();
    expect(screen.queryByRole('button', { name: 'Importa' })).toBeNull();
    await waitFor(() =>
      expect(
        screen.getByText(
          'Import completato. Alcuni dati visualizzati verranno aggiornati al prossimo caricamento.',
        ),
      ).toBeTruthy(),
    );
  });

  it('deletes the course and notifies the parent', async () => {
    const onCourseDeleted = vi.fn();
    mockDeleteProgram.mockResolvedValue(undefined);
    await renderAndReady({}, { onCourseDeleted });

    fireEvent.click(screen.getByRole('button', { name: 'Azioni corso' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Elimina corso' }));
    fireEvent.click(screen.getByRole('button', { name: 'Elimina' }));

    await waitFor(() =>
      expect(mockDeleteProgram).toHaveBeenCalledWith(
        'p1',
        'owner',
        {},
        expect.any(Function),
        expect.any(Function),
      ),
    );
    expect(onCourseDeleted).toHaveBeenCalledWith('p1');
  });

  it('double-click on confirm invokes deleteProgram only once (sync guard)', async () => {
    // deleteProgram stays pending so a second confirm click lands before the
    // first call resolves; the synchronous ref guard must swallow it.
    let resolveDelete: () => void = () => {};
    mockDeleteProgram.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveDelete = resolve;
      }),
    );
    await renderAndReady({}, { onCourseDeleted: vi.fn() });

    fireEvent.click(screen.getByRole('button', { name: 'Azioni corso' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Elimina corso' }));
    const confirm = screen.getByRole('button', { name: 'Elimina' });
    fireEvent.click(confirm);
    fireEvent.click(confirm);

    await waitFor(() => expect(mockDeleteProgram).toHaveBeenCalledTimes(1));
    resolveDelete();
  });
});

describe('CourseWorkspace — Programma svolto PDF chunk recovery', () => {
  async function renderProgramPdfWorkspace() {
    mockListUdas.mockResolvedValue([uda('uda-01-reti')]);
    mockListLessons.mockResolvedValue([
      lesson('l1', 'uda-01-reti', { completed: true, titolo: 'Lezione A' }),
    ]);
    mockGetImportMeta.mockResolvedValue(null);
    renderWorkspace();
    await screen.findByRole('button', { name: 'Azioni corso' });
  }

  it('shows stale-chunk recovery without automatic reload and reloads once on explicit click', async () => {
    mockDownloadProgramPdf.mockRejectedValueOnce(new PdfModuleLoadError('stale_chunk'));
    await renderProgramPdfWorkspace();

    clickMenuAction('Azioni corso', 'Programma svolto (PDF)');
    expect(
      await screen.findByText('SchoolForge è stato aggiornato. Ricarica la pagina e riprova.'),
    ).toBeTruthy();
    expect(mockReloadCurrentPage).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Ricarica pagina' }));
    expect(mockReloadCurrentPage).toHaveBeenCalledTimes(1);
    expect(mockDownloadProgramPdf).toHaveBeenCalledTimes(1);
  });

  it('keeps generic PDF failures distinct and releases busy', async () => {
    mockDownloadProgramPdf.mockRejectedValueOnce(new Error('renderer failed'));
    await renderProgramPdfWorkspace();

    clickMenuAction('Azioni corso', 'Programma svolto (PDF)');
    expect(await screen.findByText('Impossibile generare il PDF. Riprova.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Ricarica pagina' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Azioni corso' }));
    expect(
      (screen.getByRole('menuitem', { name: 'Programma svolto (PDF)' }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });

  it('routes an explicit reload through the existing dirty guard', async () => {
    mockDownloadProgramPdf.mockRejectedValueOnce(new PdfModuleLoadError('stale_chunk'));
    mockFetchLessonContent.mockResolvedValue('Corpo.');
    await renderProgramPdfWorkspace();
    clickMenuAction('Azioni corso', 'Programma svolto (PDF)');
    await screen.findByRole('button', { name: 'Ricarica pagina' });

    await expandUda();
    fireEvent.click(screen.getByRole('button', { name: 'Lezione A' }));
    fireEvent.click(await screen.findByRole('tab', { name: 'Domande' }));
    fireEvent.click(screen.getByRole('button', { name: 'make-dirty' }));
    fireEvent.click(screen.getByRole('button', { name: 'Ricarica pagina' }));

    expect(mockReloadCurrentPage).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog', { name: 'Modifiche non salvate' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /continua senza salvare/i }));
    expect(mockReloadCurrentPage).toHaveBeenCalledTimes(1);
  });

  it('blocks a synchronous double click while one PDF generation is pending', async () => {
    let resolvePdf!: () => void;
    mockDownloadProgramPdf.mockReturnValueOnce(
      new Promise<void>((resolve) => (resolvePdf = resolve)),
    );
    await renderProgramPdfWorkspace();

    fireEvent.click(screen.getByRole('button', { name: 'Azioni corso' }));
    const action = screen.getByRole('menuitem', { name: 'Programma svolto (PDF)' });
    fireEvent.click(action);
    fireEvent.click(action);
    await waitFor(() => expect(mockDownloadProgramPdf).toHaveBeenCalledTimes(1));
    resolvePdf();
    await waitFor(() => expect(screen.queryByText('Generazione PDF in corso…')).toBeNull());
  });

  it('does not update recovery UI after unmount', async () => {
    let rejectPdf!: (error: unknown) => void;
    mockDownloadProgramPdf.mockReturnValueOnce(
      new Promise<void>((_resolve, reject) => (rejectPdf = reject)),
    );
    mockListUdas.mockResolvedValue([uda('uda-01-reti')]);
    mockListLessons.mockResolvedValue([lesson('l1', 'uda-01-reti', { completed: true })]);
    mockGetImportMeta.mockResolvedValue(null);
    const view = renderWorkspace();
    await screen.findByRole('button', { name: 'Azioni corso' });
    clickMenuAction('Azioni corso', 'Programma svolto (PDF)');
    view.unmount();
    rejectPdf(new PdfModuleLoadError('stale_chunk'));
    await act(async () => Promise.resolve());
    expect(screen.queryByText(/SchoolForge è stato aggiornato/)).toBeNull();
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
    const onCardPatch = vi.fn();
    mockListUdas.mockResolvedValue([uda('uda-01-reti')]);
    mockListLessons.mockResolvedValue([lesson('l1', 'uda-01-reti')]);
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
    await waitFor(() => expect(screen.getByRole('button', { name: 'Azioni corso' })).toBeTruthy());
    clickMenuAction('Azioni corso', 'Nuova UDA');
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
    await expandUda();
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
    clickMenuAction('Azioni UDA', 'Nuova lezione');
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
    clickMenuAction('Azioni lezione', 'Modifica contenuto');
    const textarea = screen.getByLabelText('Corpo Markdown') as HTMLTextAreaElement;
    expect(
      screen.getByRole('button', { name: 'Arricchisci visivamente' }).hasAttribute('disabled'),
    ).toBe(true);
    expect(screen.getByText('Termina prima la modifica del contenuto.')).toBeTruthy();
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
    clickMenuAction('Azioni lezione', 'Modifica contenuto');
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
    clickMenuAction('Azioni lezione', 'Modifica informazioni');
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
    clickMenuAction('Azioni lezione', 'Modifica informazioni');
    const titleInput = screen.getByLabelText('Titolo lezione') as HTMLInputElement;
    fireEvent.change(titleInput, { target: { value: 'Titolo non salvato' } });

    fireEvent.click(screen.getByRole('tab', { name: 'Contenuto' }));
    fireEvent.click(screen.getByRole('button', { name: 'Azioni lezione' }));
    const returnButton = screen.getByRole('menuitem', { name: 'Modifica informazioni' });
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
    await expandUda();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Lezione A' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Lezione A' }));
    await waitFor(() => expect(screen.getByTestId('md')).toBeTruthy());
    clickMenuAction('Azioni lezione', 'Modifica contenuto');
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
    await expandUda();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Lezione A' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Lezione A' }));
    await waitFor(() => expect(screen.getByTestId('md')).toBeTruthy());
    // "Segna svolta" is a toolbar button (outside the "Azioni" menu) now.
    fireEvent.click(screen.getByRole('button', { name: /^Segna svolta/i }));

    await waitFor(() => expect(mockSetLessonCompleted).toHaveBeenCalledOnce());
    await waitFor(() => expect(onCardPatch).toHaveBeenCalledTimes(1));
    expect(onCardPatch).toHaveBeenCalledWith('p1', expect.objectContaining({ lessonsDone: 1 }));
  });

  it('does not expose the single-lesson PDF command and preserves the other lesson actions', async () => {
    await openLesson();
    fireEvent.click(screen.getByRole('button', { name: 'Azioni lezione' }));
    const menu = screen.getByRole('menu');

    expect(within(menu).queryByRole('menuitem', { name: 'Scarica PDF' })).toBeNull();
    expect(within(menu).getByRole('menuitem', { name: 'Modifica contenuto' })).toBeTruthy();
    expect(within(menu).getByRole('menuitem', { name: 'Modifica informazioni' })).toBeTruthy();
    expect(within(menu).getByRole('menuitem', { name: 'Elimina lezione' })).toBeTruthy();
  });

  it('deletes an authorized lesson and returns to its UDA', async () => {
    mockDeleteLesson.mockResolvedValue(undefined);
    const onCardPatch = await openLesson();
    fireEvent.click(screen.getByRole('button', { name: 'Azioni lezione' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Elimina lezione' }));
    fireEvent.click(screen.getByRole('button', { name: 'Elimina' }));

    await waitFor(() => expect(mockDeleteLesson).toHaveBeenCalledOnce());
    // Back on the UDA overview; the lesson is gone.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Azioni UDA' })).toBeTruthy());
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
    await expandUda();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Lezione A' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Lezione A' }));
    await waitFor(() => expect(screen.getByTestId('md').textContent).toContain('Corpo A.'));

    clickMenuAction('Azioni lezione', 'Modifica contenuto');
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
    await expandUda();
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
    fireEvent.click(screen.getByRole('button', { name: /^Segna svolta/i }));

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
    clickMenuAction('Azioni lezione', 'Modifica contenuto');
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
    await expandUda();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Lezione A' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Lezione A' }));
    await waitFor(() => expect(screen.getByTestId('md').textContent).toContain('Corpo A.'));
    clickMenuAction('Azioni lezione', 'Modifica informazioni');
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

  it('loads the lesson content on mobile: same storageRef, fetched exactly once (MOB-01)', async () => {
    setViewport(true);
    mockListUdas.mockResolvedValue([uda('uda-01-reti')]);
    mockListLessons.mockResolvedValue([lesson('l1', 'uda-01-reti', { titolo: 'Lezione A' })]);
    mockFetchLessonContent.mockResolvedValue('# Titolo\n\nCorpo della lezione mobile.');
    render(<CourseWorkspace card={card()} ownerUid="owner" onBack={vi.fn()} />);

    await screen.findByRole('table');
    // Drill the mobile-only progressive path: course → UDA → lesson.
    fireEvent.click(screen.getByRole('button', { name: 'Apri UDA uda-01-reti' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apri lezione Lezione A' }));

    // Content actually renders (not the generic error), and the fetch used the
    // lesson's own storageRef exactly once — identical to the desktop path.
    await waitFor(() => expect(screen.getByTestId('md')).toBeTruthy());
    expect(screen.getByTestId('md').textContent).toContain('Corpo della lezione mobile.');
    expect(screen.queryByText(/impossibile caricare il contenuto/i)).toBeNull();
    expect(mockFetchLessonContent).toHaveBeenCalledTimes(1);
    expect(mockFetchLessonContent).toHaveBeenCalledWith('ref/uda-01-reti/l1.md', expect.anything());
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
    await expandUda();
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
    await expandUda();
    fireEvent.click(screen.getByRole('button', { name: 'Lezione A' }));
    await waitFor(() => expect(screen.getByTestId('md')).toBeTruthy());
    clickMenuAction('Azioni lezione', 'Modifica contenuto');
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
    await waitFor(() => expect(screen.getByRole('button', { name: 'Azioni corso' })).toBeTruthy());
    clickMenuAction('Azioni corso', 'Organizza UDA');
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

  it('keeps a stable table geometry when entering organize mode', async () => {
    mockListUdas.mockResolvedValue([
      uda('uda-01-reti', { order: 0 }),
      uda('uda-02-sic', { order: 1 }),
    ]);
    mockListLessons.mockResolvedValue([]);
    render(<CourseWorkspace card={card()} ownerUid="owner" onBack={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Azioni corso' })).toBeTruthy());

    const table = screen.getByRole('table');
    expect(table.querySelectorAll('col')).toHaveLength(3);
    expect(within(table).getAllByRole('row')[1]?.querySelectorAll('td')).toHaveLength(3);

    clickMenuAction('Azioni corso', 'Organizza UDA');
    expect(table.querySelectorAll('col')).toHaveLength(3);
    expect(within(table).getAllByRole('row')[1]?.querySelectorAll('td')).toHaveLength(3);
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
    clickMenuAction('Azioni UDA', 'Organizza lezioni');

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

describe('CourseWorkspace — lesson toolbar + table wrapping (DUX-08)', () => {
  async function openLessonDesktop() {
    mockListUdas.mockResolvedValue([uda('uda-01-reti')]);
    mockListLessons.mockResolvedValue([lesson('l1', 'uda-01-reti', { titolo: 'Lezione A' })]);
    mockFetchLessonContent.mockResolvedValue('Corpo.');
    renderWorkspace();
    await expandUda();
    fireEvent.click(screen.getByRole('button', { name: 'Lezione A' }));
    await waitFor(() =>
      expect(screen.getByRole('tablist', { name: 'Schede lezione' })).toBeTruthy(),
    );
  }

  it('keeps only "Segna svolta" and the structure toggle outside the "Azioni" menu (desktop)', async () => {
    await openLessonDesktop();
    // Both visible on the toolbar without opening the menu.
    expect(screen.getByRole('button', { name: /^Segna svolta/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Nascondi struttura' })).toBeTruthy();

    // The menu holds the remaining actions and NOT these two.
    fireEvent.click(screen.getByRole('button', { name: 'Azioni lezione' }));
    const menu = screen.getByRole('menu');
    expect(within(menu).getByRole('menuitem', { name: 'Modifica contenuto' })).toBeTruthy();
    expect(within(menu).getByRole('menuitem', { name: 'Modifica informazioni' })).toBeTruthy();
    expect(within(menu).queryByRole('menuitem', { name: 'Scarica PDF' })).toBeNull();
    expect(within(menu).getByRole('menuitem', { name: 'Elimina lezione' })).toBeTruthy();
    expect(within(menu).queryByRole('menuitem', { name: /segna svolta/i })).toBeNull();
    expect(within(menu).queryByRole('menuitem', { name: /struttura/i })).toBeNull();
  });

  it('never duplicates the svolta / structure actions inside and outside the menu', async () => {
    await openLessonDesktop();
    fireEvent.click(screen.getByRole('button', { name: 'Azioni lezione' }));
    expect(screen.getAllByRole('button', { name: /^Segna svolta/i })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Nascondi struttura' })).toHaveLength(1);
  });

  it('does not expose the structure command on mobile (no sidebar to toggle)', async () => {
    setViewport(true);
    mockListUdas.mockResolvedValue([uda('uda-01-reti')]);
    mockListLessons.mockResolvedValue([lesson('l1', 'uda-01-reti', { titolo: 'Lezione A' })]);
    mockFetchLessonContent.mockResolvedValue('Corpo.');
    renderWorkspace();
    await screen.findByRole('table');
    fireEvent.click(screen.getByRole('button', { name: 'Apri UDA uda-01-reti' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apri lezione Lezione A' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Lezione A' })).toBeTruthy());

    expect(screen.queryByRole('button', { name: /struttura/i })).toBeNull();
    // The svolta toggle is still available on mobile.
    expect(screen.getByRole('button', { name: /^Segna svolta/i })).toBeTruthy();
  });

  it('keeps «Azioni» and «Segna svolta» in the same two-column lesson toolbar on mobile (AIGEN-UI-02)', async () => {
    setViewport(true);
    mockListUdas.mockResolvedValue([uda('uda-01-reti')]);
    mockListLessons.mockResolvedValue([lesson('l1', 'uda-01-reti', { titolo: 'Lezione A' })]);
    mockFetchLessonContent.mockResolvedValue('Corpo.');
    renderWorkspace();
    await screen.findByRole('table');
    fireEvent.click(screen.getByRole('button', { name: 'Apri UDA uda-01-reti' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apri lezione Lezione A' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Lezione A' })).toBeTruthy());

    const toolbar = screen.getByTestId('lesson-toolbar');
    // Modificatore a due colonne applicato solo alla toolbar della lezione.
    expect(toolbar.className).toMatch(/toolbarLesson/);
    // Entrambi i comandi vivono nella stessa toolbar (stessa riga su mobile).
    expect(toolbar.contains(screen.getByRole('button', { name: 'Azioni lezione' }))).toBe(true);
    expect(toolbar.contains(screen.getByRole('button', { name: /^Segna svolta/i }))).toBe(true);
    // Su mobile la toolbar della lezione ha esattamente questi due comandi.
    expect(toolbar.querySelectorAll('button').length).toBe(2);
  });

  it('preserves state, callback and a busy lock on the svolta toggle', async () => {
    let resolveToggle!: () => void;
    mockSetLessonCompleted.mockImplementation(() => new Promise<void>((r) => (resolveToggle = r)));
    const onCardPatch = vi.fn();
    mockListUdas.mockResolvedValue([uda('uda-01-reti')]);
    mockListLessons.mockResolvedValue([lesson('l1', 'uda-01-reti', { titolo: 'Lezione A' })]);
    mockFetchLessonContent.mockResolvedValue('Corpo.');
    render(
      <CourseWorkspace card={card()} ownerUid="owner" onBack={vi.fn()} onCardPatch={onCardPatch} />,
    );
    await expandUda();
    fireEvent.click(screen.getByRole('button', { name: 'Lezione A' }));
    await waitFor(() => expect(screen.getByTestId('md')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: /^Segna svolta/i }));
    // Busy lock while the single write is in flight.
    expect(
      (screen.getByRole('button', { name: /^Segna svolta/i }) as HTMLButtonElement).disabled,
    ).toBe(true);

    await act(async () => {
      resolveToggle();
    });
    await waitFor(() => expect(mockSetLessonCompleted).toHaveBeenCalledOnce());
    // State flipped (label now "non svolta") and the card patched once.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^Segna non svolta/i })).toBeTruthy(),
    );
    expect(onCardPatch).toHaveBeenCalledWith('p1', expect.objectContaining({ lessonsDone: 1 }));
  });

  it('marks UDA and lesson title cells for wrapping', async () => {
    mockListUdas.mockResolvedValue([uda('uda-01-reti')]);
    mockListLessons.mockResolvedValue([lesson('l1', 'uda-01-reti', { titolo: 'Lezione A' })]);
    renderWorkspace();
    // Course overview UDA table: title cell carries the wrapping class
    // (CSS modules hash the name, so match on the token substring).
    await screen.findByRole('table');
    expect(document.querySelector('[class*="titleCell"]')).toBeTruthy();

    // Open the UDA → the lessons table's title cell carries it too.
    fireEvent.click(screen.getByRole('button', { name: 'Apri UDA uda-01-reti' }));
    await waitFor(() => expect(screen.getByRole('table')).toBeTruthy());
    expect(document.querySelectorAll('[class*="titleCell"]').length).toBeGreaterThan(0);
  });
});
