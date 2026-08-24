import {
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { db, functions, storage } from '../../lib/firebase.js';
import { PdfModuleLoadError, reloadCurrentPage } from '../../lib/pdfModuleLoader.js';
import { createProgramNotesCleanupCallable } from '../repository/programs/programNotesCleanupClient.js';
import {
  IconBookOpen,
  IconArrowUpDown,
  IconCircleQuestion,
  IconDownload,
  IconFileCheck,
  IconFileText,
  IconGraduationCap,
  IconLayers,
  IconMoreHorizontal,
  IconPanelLeft,
  IconPencil,
  IconPlus,
  IconTriangleAlert,
  IconTrash,
  IconUpload,
} from '../../components/icons.js';
import type { CourseCard } from '../repository/programs/courseLibrary.js';
import {
  deleteProgram,
  getImportMeta,
  listLessons,
  listUdas,
  setLessonCompleted,
  setProgramClassIds,
  updateProgramTitle,
  type LessonItem,
  type ProgramItem,
  type UdaItem,
} from '../repository/programs/programsService.js';
import { saveLessonConceptMap } from '../repository/programs/conceptMapService.js';
import { readPrivateConceptMap } from '../repository/programs/conceptMapContract.js';
import { createVisualLifecycleClient } from '../repository/programs/visualLifecycleClient.js';
import {
  createAiConceptMapCallables,
  type AiConceptMapCallables,
} from '../repository/pools/aiConceptMapClient.js';
import { ConceptMapEditor } from './ConceptMapEditor.js';
import {
  createLesson,
  createUda,
  deleteLesson,
  deleteUda,
  reorderLesson,
  reorderUda,
  updateLessonMarkdownBody,
  updateLessonMetadata,
  updateUdaMetadata,
  RepositoryDeleteBlockedError,
} from '../repository/editor/repositoryEditorService.js';
import type { RepositoryDeleteBlocker } from '../repository/editor/repositoryEditorGuards.js';
import { importRepository } from '../repository/import/importRepository.js';
import { readZipFile } from '../repository/import/readZipFile.js';
import { importUda } from '../repository/importUda/importUdaRepository.js';
import { importUdaStructure } from '../repository/structureImportRuntime/udaStructureImportRepository.js';
import { createFirestoreUdaStructureImportDeps } from '../repository/structureImportRuntime/udaStructureImportDeps.js';
import { ImportUdaStructureDialog } from './ImportUdaStructureDialog.js';
import { importLessonStructure } from '../repository/structureImportRuntime/lessonStructureImportRepository.js';
import { createFirestoreLessonStructureImportDeps } from '../repository/structureImportRuntime/lessonStructureImportDeps.js';
import { ImportLessonStructureDialog } from './ImportLessonStructureDialog.js';
import { resolveUdaTitle } from '../repository/programs/udaTitle.js';
import { createFirestoreUdaImportDeps } from '../repository/importUda/udaImportDeps.js';
import { filterCommittedLessons } from '../repository/programs/committedUdas.js';
import type { RawFile } from '../repository/validation/types.js';
import { resolveLessonTitle } from '../repository/programs/lessonTitle.js';
import { resolvePublicLessonId } from '../repository/programs/publicLessonId.js';
import {
  EMPTY_LESSON_METADATA,
  parseLessonMetadata,
} from '../repository/validation/lessonMetadata.js';
import type { LessonMetadata } from '../repository/validation/types.js';
import type { LessonVisualPrivateManifest } from '../../types/firestore.js';
import { fetchLessonContent, fetchPublicLessonContent } from './lessonContent.js';
import {
  describeStorageError,
  storageErrorDetailLines,
  type StorageErrorDetails,
} from './storageErrorDetails.js';
import { MarkdownRenderer } from './MarkdownRenderer.js';
import { LessonVisualAnchorNotice } from './LessonVisualAnchorNotice.js';
import { LessonVisualReanchorDialog } from './LessonVisualReanchorDialog.js';
import { LessonVisualWorkflowDialog } from './LessonVisualWorkflowDialog.js';
import {
  createVisualWorkflowPorts,
  readAuthoritativePrivateVisual,
} from '../repository/programs/visualGenerationClient.js';
import { parseLessonMarkdown } from '../../components/lessonManualMarkdown.js';
import { assignLessonHeadingSlugs } from '@schoolforge/lesson-contract';
import { useLessonVisual } from '../repository/programs/useLessonVisual.js';
import { QuestionPoolEditor, type PoolCountStatus } from './QuestionPoolEditor.js';
import {
  MarkdownBodyEditor,
  LessonMetadataForm,
  type EditStatus,
  type LessonAiButtonContext,
} from './lessonEditors.js';
import { buildLessonUdaContext } from '../repository/pools/lessonUdaContext.js';
import { exportZip } from './exportZip.js';
import { downloadMarkdown, downloadPdf, generateMarkdown } from './programmaSvolto.js';
import { describeImportValidationError } from './importValidationMessage.js';
import {
  ClassesDialog,
  ConfirmDialog,
  ImportIntoCourseDialog,
  ImportUdaDialog,
  NewLessonDialog,
  NewUdaDialog,
  ProgramInfoDialog,
  TitleDialog,
  UdaMetadataDialog,
  type NewLessonValues,
  type UdaMetadataValues,
} from './workspaceDialogs.js';
import styles from './CourseWorkspace.module.css';
import { ActionsMenu } from './ActionsMenu.js';

const NO_STATUS: EditStatus = { busy: false, error: null, saved: false };
const MOBILE_QUERY = '(max-width: 640px)';

/**
 * Local matchMedia hook (no new dependency). Mobile = single-level
 * progressive navigation; desktop = shared sidebar. Falls back to desktop
 * when matchMedia is unavailable (e.g. jsdom without a stub).
 */
function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia?.(MOBILE_QUERY).matches === true,
  );
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(MOBILE_QUERY);
    const onChange = () => setIsMobile(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return isMobile;
}

// Local order comparators mirroring the service's sort, so a reorder can be
// reflected in place (swap the two `order` values, then re-sort) without a
// Firestore re-read.
function udaOrderKey(uda: UdaItem): number {
  if (uda.order !== undefined) return uda.order;
  const m = /^uda-(\d+)(?:-|$)/.exec(uda.dir);
  return m ? Number(m[1]) - 1 : Number.MAX_SAFE_INTEGER;
}
function sortUdas(udas: UdaItem[]): UdaItem[] {
  return [...udas].sort((a, b) => udaOrderKey(a) - udaOrderKey(b) || a.dir.localeCompare(b.dir));
}
function lessonOrderKey(lesson: LessonItem): number {
  if (lesson.order !== undefined) return lesson.order;
  const m = /^lezione-(\d+)(?:-|\.md$)/.exec(lesson.filename);
  return m ? Number(m[1]) - 1 : Number.MAX_SAFE_INTEGER;
}
function sortLessons(lessons: LessonItem[]): LessonItem[] {
  return [...lessons].sort(
    (a, b) =>
      a.udaDir.localeCompare(b.udaDir) ||
      lessonOrderKey(a) - lessonOrderKey(b) ||
      a.filename.localeCompare(b.filename),
  );
}

/**
 * Builds the visual lesson metadata from the tree lesson itself (MOB-01C).
 * When the body comes from the `publicLessons` projection — which stores the
 * body already split from its front matter — the metadata can't be re-parsed
 * from the content, so it is taken from the fields `listLessons` already
 * loaded (populated from the same front matter at import time).
 */
function lessonMetadataFromItem(lesson: LessonItem): LessonMetadata {
  return {
    titolo: lesson.titolo ?? null,
    sottotitolo: lesson.sottotitolo ?? null,
    difficolta: lesson.difficolta ?? null,
    concettiChiave: lesson.concettiChiave ?? [],
    obiettivi: lesson.obiettivi ?? [],
  };
}

function poolStatusText(status: LessonItem['poolStatus']): string {
  if (status === 'valid') return 'Pool presente e valido';
  if (status === 'invalid') return 'Pool presente ma non valido';
  return 'Pool assente';
}

/**
 * Reorder up/down controls (RE-04 in the workspace). Two sibling buttons —
 * never nested inside an open/edit control — shown only in Organize mode.
 */
function ReorderControls({
  label,
  isFirst,
  isLast,
  disabled,
  onUp,
  onDown,
}: {
  label: string;
  isFirst: boolean;
  isLast: boolean;
  disabled: boolean;
  onUp: () => void;
  onDown: () => void;
}) {
  return (
    <span className={styles.reorderControls} role="group" aria-label={`Riordina ${label}`}>
      <button
        type="button"
        className={styles.reorderBtn}
        aria-label={`Sposta su — ${label}`}
        disabled={disabled || isFirst}
        onClick={onUp}
      >
        ↑
      </button>
      <button
        type="button"
        className={styles.reorderBtn}
        aria-label={`Sposta giù — ${label}`}
        disabled={disabled || isLast}
        onClick={onDown}
      >
        ↓
      </button>
    </span>
  );
}

/**
 * Builds the minimal `ProgramItem` shape the export/programma-svolto helpers
 * expect, from the library card the workspace already holds.
 */
function cardToProgram(card: CourseCard): ProgramItem {
  return {
    id: card.programId,
    ownerUid: '',
    title: card.title,
    activeImportId: card.activeImportId,
    classIds: [],
    createdAt: null as never,
    updatedAt: null as never,
  };
}

type CourseWorkspaceProps = {
  /**
   * The library card for the course being opened. The summary strip reuses
   * the counters DUX-01 already computed (anno, classi, UDA, lezioni,
   * domande) so the workspace never recomputes them; `activeImportId` lets
   * it load this one course's tree without re-reading the program list.
   */
  card: CourseCard;
  ownerUid: string;
  onBack: () => void;
  /**
   * Called when a pool edit changes the course's total question count, so the
   * library card counter can be updated in place without re-reading the whole
   * library (DUX-03 item 8).
   */
  onProgramQuestionsChange?: (programId: string, questionsTotal: number) => void;
  /**
   * DUX-04A: patch the library card in place after a course/UDA action
   * (title, classes, counts, active import) — avoids reloading the whole
   * library.
   */
  onCardPatch?: (programId: string, patch: Partial<CourseCard>) => void;
  /** DUX-04A: the course was deleted — drop its card and leave the workspace. */
  onCourseDeleted?: (programId: string) => void;
};

type WsDialog =
  | { kind: 'none' }
  | { kind: 'renameCourse' }
  | { kind: 'importCourse' }
  | { kind: 'importUda' }
  | { kind: 'importUdaStructure' }
  | { kind: 'importLessonStructure'; udaId: string }
  | { kind: 'classes' }
  | { kind: 'info' }
  | { kind: 'deleteCourse' }
  | { kind: 'newUda' }
  | { kind: 'editUda'; udaId: string }
  | { kind: 'deleteUda'; udaId: string }
  | { kind: 'newLesson' }
  | { kind: 'deleteLesson'; lessonId: string };

type Tree = { udas: UdaItem[]; lessons: LessonItem[] };

type Selection =
  | { kind: 'course' }
  | { kind: 'uda'; udaDir: string }
  | { kind: 'lesson'; lessonId: string };

type LessonTab = 'contenuto' | 'mappa' | 'domande' | 'informazioni';

export function CourseWorkspace({
  card,
  ownerUid,
  onBack,
  onProgramQuestionsChange,
  onCardPatch,
  onCourseDeleted,
}: CourseWorkspaceProps) {
  const [tree, setTree] = useState<Tree | null>(null);
  const [treeError, setTreeError] = useState<string | null>(null);

  // Contextual course/UDA actions (DUX-04A).
  const [wsDialog, setWsDialog] = useState<WsDialog>({ kind: 'none' });
  const [wsBusy, setWsBusy] = useState(false);
  const [wsError, setWsError] = useState<string | null>(null);
  // Synchronous double-click guard for course deletion: `wsBusy` is React
  // state (async), so a second confirm click before the re-render could
  // otherwise invoke deleteProgram twice. This ref flips immediately.
  const deletingCourseRef = useRef(false);
  // Idempotency: one requestId per "Importa UDA" operation, kept stable across
  // retries of the same attempt (reset when the dialog opens/closes). Also acts
  // as a synchronous double-click guard for the import confirm.
  const udaImportRequestIdRef = useRef<string | null>(null);
  const udaStructureRequestIdRef = useRef<string | null>(null);
  const lessonStructureRequestIdRef = useRef<string | null>(null);
  const udaImportInFlightRef = useRef(false);
  // Non-blocking notice after a successful re-import whose deferred
  // publicLessons cleanup was postponed (cleanupPending) — HARD-02B-2.
  const [wsNotice, setWsNotice] = useState<string | null>(null);
  const [programPdfBusy, setProgramPdfBusy] = useState(false);
  const [programPdfError, setProgramPdfError] = useState<'stale_chunk' | 'generic' | null>(null);
  const programPdfBusyRef = useRef(false);
  const [udaBlockers, setUdaBlockers] = useState<RepositoryDeleteBlocker[] | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const menuTriggerRef = useRef<HTMLButtonElement | null>(null);

  const [selection, setSelection] = useState<Selection>({ kind: 'course' });
  const [collapsedUdas, setCollapsedUdas] = useState<Set<string>>(new Set());
  const [lessonFocusMode, setLessonFocusMode] = useState(false);

  // Lesson content is loaded on demand, only when a lesson is selected.
  const [lessonContent, setLessonContent] = useState<string | null>(null);
  const [lessonMetadata, setLessonMetadata] = useState<LessonMetadata>(EMPTY_LESSON_METADATA);
  const [lessonLoading, setLessonLoading] = useState(false);
  const [lessonError, setLessonError] = useState<string | null>(null);
  // MOB-01B: non-sensitive diagnostics for the last failed content read, shown
  // in an expandable "Dettagli tecnici" panel next to a "Riprova" button.
  const [lessonErrorDetails, setLessonErrorDetails] = useState<StorageErrorDetails | null>(null);
  // Monotonic id of the most recent lesson selection: only the request that
  // matches it may write the lesson panel. Guards against a slower earlier
  // fetch resolving after a newer one (out-of-order) and against a course
  // change / unmount landing a stale result.
  const lessonRequestRef = useRef(0);

  // Lesson tabs (DUX-03). The pool (Domande) is loaded lazily: only after the
  // Domande tab has been opened for the current lesson, and kept mounted while
  // switching tabs so the pool is read once per lesson.
  const [activeTab, setActiveTab] = useState<LessonTab>('contenuto');
  const [domandeVisited, setDomandeVisited] = useState(false);
  const [mappaVisited, setMappaVisited] = useState(false);
  const [poolDirty, setPoolDirty] = useState(false);
  // Navigation held back until the teacher confirms losing unsaved edits (any
  // of pool / content / metadata).
  const [pendingNav, setPendingNav] = useState<{ run: () => void } | null>(null);

  // Lesson editors (DUX-04B): content (Markdown body) and info (metadata).
  const [editingContent, setEditingContent] = useState(false);
  const [editingInfo, setEditingInfo] = useState(false);
  const [contentDirty, setContentDirty] = useState(false);
  const [infoDirty, setInfoDirty] = useState(false);
  const [contentStatus, setContentStatus] = useState<EditStatus>(NO_STATUS);
  /**
   * CONCEPT-MAP-04 — la mappa è una scheda della lezione, non una finestra.
   * Selezionarla non costa nessuna lettura: corpo e mappa sono già nell'albero
   * e nel contenuto caricati, e le callable partono solo su azione esplicita.
   */
  const [conceptMapDirty, setConceptMapDirty] = useState(false);
  const conceptMapCallables = useMemo(() => createAiConceptMapCallables(functions), []);
  const [infoStatus, setInfoStatus] = useState<EditStatus>(NO_STATUS);
  const [completedBusy, setCompletedBusy] = useState(false);
  const [completedError, setCompletedError] = useState<string | null>(null);
  const [lessonBlockers, setLessonBlockers] = useState<RepositoryDeleteBlocker[] | null>(null);
  // Tracks the currently-selected lesson id so a save that resolves after the
  // context changed can never write the new lesson's panel.
  const currentLessonRef = useRef<string | null>(null);
  // True while mounted; flipped false on unmount so no async handler resolving
  // after the teacher has left Didattica can setState / setTree / patch the
  // card. The underlying Firebase/Storage write still completes normally — we
  // only drop the UI update, which is what unmount makes meaningless.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // Invalidate in-flight revision/request ids so any resolving fetch or
      // save is treated as stale.
      lessonRequestRef.current++;
      currentLessonRef.current = null;
    };
  }, []);

  const anyDirty = poolDirty || contentDirty || infoDirty || conceptMapDirty;

  const isMobile = useIsMobile();
  // Organize mode (DUX-04C): reorder UDAs (course level) or lessons (UDA
  // level). Exclusive per context; reset whenever the selection changes.
  const [organizing, setOrganizing] = useState(false);
  const [reorderBusy, setReorderBusy] = useState(false);
  const [reorderError, setReorderError] = useState<string | null>(null);

  // ── Load the course tree once (UDA + lessons, 2 reads) ──────────────────
  useEffect(() => {
    let cancelled = false;
    setTree(null);
    setTreeError(null);
    async function load() {
      if (!card.activeImportId) {
        if (!cancelled) {
          setTree({ udas: [], lessons: [] });
          setCollapsedUdas(new Set());
        }
        return;
      }
      try {
        const [udas, allLessons] = await Promise.all([
          listUdas(card.programId, card.activeImportId, db),
          listLessons(card.programId, card.activeImportId, db),
        ]);
        // Reader coherence: hide lessons staged for a not-yet-committed UDA.
        const lessons = filterCommittedLessons(udas, allLessons);
        if (!cancelled) {
          setTree({ udas, lessons });
          // A large course must open as an overview, never as an already
          // exploded wall of lessons. The teacher can expand only the UDA
          // currently needed; later local tree updates preserve that choice.
          setCollapsedUdas(new Set(udas.map((uda) => uda.dir)));
        }
      } catch {
        if (!cancelled) setTreeError('Impossibile caricare la struttura del corso.');
      }
    }
    void load();
    return () => {
      cancelled = true;
      // Invalidate any in-flight lesson fetch so a stale result from the
      // previous course can never write this (or the next) course's panel.
      lessonRequestRef.current++;
    };
  }, [card.programId, card.activeImportId]);

  const lessonsByUda = useMemo(() => {
    const map = new Map<string, LessonItem[]>();
    for (const lesson of tree?.lessons ?? []) {
      const list = map.get(lesson.udaDir) ?? [];
      list.push(lesson);
      map.set(lesson.udaDir, list);
    }
    return map;
  }, [tree]);

  const selectedLesson =
    selection.kind === 'lesson'
      ? (tree?.lessons.find((l) => l.id === selection.lessonId) ?? null)
      : null;
  const selectedUda =
    selection.kind === 'uda' ? (tree?.udas.find((u) => u.dir === selection.udaDir) ?? null) : null;

  // Guards a navigation that would discard any unsaved edit (pool / content /
  // metadata): when dirty, hold the action back behind a confirm; else run it.
  function guardedNav(run: () => void) {
    if (anyDirty) setPendingNav({ run });
    else run();
  }

  // Drops every open lesson-editor draft of the current context. Used by the
  // "Continua senza salvare" confirm so a superseded draft can't reappear.
  function invalidateDrafts() {
    setEditingContent(false);
    setEditingInfo(false);
    setContentDirty(false);
    setInfoDirty(false);
    setPoolDirty(false);
    setConceptMapDirty(false);
    setContentStatus(NO_STATUS);
    setInfoStatus(NO_STATUS);
  }

  function selectTab(tab: LessonTab) {
    setActiveTab(tab);
    if (tab === 'domande') setDomandeVisited(true);
    if (tab === 'mappa') setMappaVisited(true);
  }

  function handlePoolCountChange(
    lessonId: string,
    questionCount: number,
    poolStatus: PoolCountStatus,
  ) {
    if (!tree) return;
    // Compute the next lessons deterministically, keep the state updater pure
    // (it only sets the value), and notify the parent exactly once — outside
    // the updater — so React Strict Mode's double-invoke can't fire the
    // external callback twice.
    const lessons = tree.lessons.map((l) =>
      l.id === lessonId ? { ...l, questionCount, poolStatus } : l,
    );
    setTree({ udas: tree.udas, lessons });
    onProgramQuestionsChange?.(
      card.programId,
      lessons.reduce((s, l) => s + (l.questionCount ?? 0), 0),
    );
  }

  async function selectLesson(lesson: LessonItem) {
    const requestId = ++lessonRequestRef.current;
    currentLessonRef.current = lesson.id;
    setSelection({ kind: 'lesson', lessonId: lesson.id });
    // New lesson: reset the tabs to Contenuto and drop the previous lesson's
    // contextual (pool + editor) state so nothing from it can bleed through.
    setActiveTab('contenuto');
    setDomandeVisited(false);
    setMappaVisited(false);
    setConceptMapDirty(false);
    setPoolDirty(false);
    setEditingContent(false);
    setEditingInfo(false);
    setContentDirty(false);
    setInfoDirty(false);
    setContentStatus(NO_STATUS);
    setInfoStatus(NO_STATUS);
    setCompletedError(null);
    await loadLessonContent(lesson, requestId);
  }

  // Core content fetch, shared by the initial lesson selection and "Riprova".
  // The `requestId` is the monotonic guard: only the write for the most recent
  // request lands, so a stale/out-of-order fetch (or one resolving after the
  // teacher moved on) can never overwrite the panel.
  async function loadLessonContent(lesson: LessonItem, requestId: number) {
    setLessonContent(null);
    setLessonMetadata(EMPTY_LESSON_METADATA);
    setLessonError(null);
    setLessonErrorDetails(null);
    setLessonLoading(true);
    // Wall-clock start, so the diagnostics can report how long a hang lasted
    // before the failure (a long elapsed ≈ Firebase's own retry window).
    const startedAt = Date.now();
    // Tracks which source is in play, so an error's diagnostics name it and
    // so a Firestore failure never silently falls through to Storage.
    let source: 'firestore' | 'storage' = 'firestore';
    try {
      // Primary (MOB-01C): the already-synced Firestore projection. One
      // deterministic getDoc, validated against the open course/import — no
      // Storage round-trip (which times out on Brave mobile).
      const projected = await fetchPublicLessonContent(
        {
          lessonId: lesson.id,
          programId: card.programId,
          importId: card.activeImportId ?? '',
          ownerUid,
        },
        db,
      );
      if (lessonRequestRef.current !== requestId) return; // superseded
      if (projected !== null) {
        // Valid projection: render immediately, metadata from the loaded tree.
        setLessonMetadata(lessonMetadataFromItem(lesson));
        setLessonContent(projected);
        return;
      }
      // Legacy fallback: projection absent / no valid content / mismatched —
      // read the Markdown from Storage and parse its front matter. Reached
      // only because the getDoc SUCCEEDED but had nothing usable, never
      // because it threw (a thrown getDoc is handled below, no Storage read).
      source = 'storage';
      const raw = await fetchLessonContent(lesson.storageRef, storage);
      const { metadata, body } = parseLessonMetadata(raw);
      if (lessonRequestRef.current !== requestId) return; // superseded
      setLessonMetadata(metadata);
      setLessonContent(body);
    } catch (err) {
      if (lessonRequestRef.current !== requestId) return; // superseded
      // Preserve the ORIGINAL error — classify it into whitelisted,
      // non-sensitive fields for the UI, and log a single structured line per
      // failed attempt (console only, never to Firebase).
      const details = describeStorageError(err, {
        bucket: storage.app?.options?.storageBucket ?? null,
        elapsedMs: Date.now() - startedAt,
        source,
      });
      console.error('[lesson-content] load failed', {
        storageRef: lesson.storageRef,
        ...details,
      });
      setLessonError('Impossibile caricare il contenuto della lezione.');
      setLessonErrorDetails(details);
    } finally {
      if (lessonRequestRef.current === requestId) setLessonLoading(false);
    }
  }

  // "Riprova": exactly one new read for the current lesson, guarded by a fresh
  // request id so it also invalidates any earlier in-flight fetch.
  function retryLessonContent(lesson: LessonItem) {
    const requestId = ++lessonRequestRef.current;
    currentLessonRef.current = lesson.id;
    void loadLessonContent(lesson, requestId);
  }

  // Close the toolbar menu on any outside click, and whenever the selection
  // changes (course ⇄ UDA ⇄ lesson) so it never lingers over a new context.
  useEffect(() => {
    if (!menuOpen) return;
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || menuTriggerRef.current?.contains(target)) return;
      setMenuOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      setMenuOpen(false);
      menuTriggerRef.current?.focus();
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [menuOpen]);
  useEffect(() => {
    setMenuOpen(false);
    setOrganizing(false);
    setReorderError(null);
    if (selection.kind !== 'lesson') {
      currentLessonRef.current = null;
      setLessonFocusMode(false);
    }
  }, [selection]);

  useEffect(() => {
    if (isMobile) setLessonFocusMode(false);
  }, [isMobile]);

  function toggleUdaCollapsed(udaDir: string) {
    setCollapsedUdas((prev) => {
      const next = new Set(prev);
      if (next.has(udaDir)) next.delete(udaDir);
      else next.add(udaDir);
      return next;
    });
  }

  // ── Course / UDA actions (DUX-04A) ──────────────────────────────────────
  // All go through the dirty guard so an unsaved pool edit is never lost.
  function openDialog(kind: WsDialog) {
    guardedNav(() => {
      setWsError(null);
      setUdaBlockers(null);
      setLessonBlockers(null);
      setMenuOpen(false);
      // Fresh "Importa UDA" operation → fresh idempotency token. Retries of the
      // SAME attempt (dialog kept open on error) keep the token.
      if (kind.kind === 'importUda') udaImportRequestIdRef.current = null;
      // Same reasoning for the metadata-only append: a freshly opened dialog is
      // a new operation, a retry inside the open dialog is the same one.
      if (kind.kind === 'importUdaStructure') udaStructureRequestIdRef.current = null;
      if (kind.kind === 'importLessonStructure') lessonStructureRequestIdRef.current = null;
      setWsDialog(kind);
    });
  }
  function closeDialog() {
    setWsDialog({ kind: 'none' });
    setWsError(null);
    setUdaBlockers(null);
    setLessonBlockers(null);
  }

  // Patches the library card's derived counters from a freshly-updated tree,
  // so the card and the summary strip stay correct without a library reload.
  function patchCardCounts(next: Tree) {
    onCardPatch?.(card.programId, {
      udaCount: next.udas.length,
      lessonsTotal: next.lessons.length,
      lessonsDone: next.lessons.filter((l) => l.completed).length,
      questionsTotal: next.lessons.reduce((s, l) => s + (l.questionCount ?? 0), 0),
    });
  }

  async function withBusy(fn: () => Promise<void>) {
    setWsBusy(true);
    setWsError(null);
    try {
      await fn();
    } finally {
      if (mountedRef.current) setWsBusy(false);
    }
  }

  function handleRenameCourse(title: string) {
    void withBusy(async () => {
      try {
        await updateProgramTitle(card.programId, title, ownerUid, db);
        if (!mountedRef.current) return;
        onCardPatch?.(card.programId, { title });
        closeDialog();
      } catch {
        if (mountedRef.current) setWsError('Impossibile rinominare il corso.');
      }
    });
  }

  function handleImportCourse(file: File) {
    setWsNotice(null);
    void withBusy(async () => {
      try {
        const files = await readZipFile(file);
        const result = await importRepository(
          { ownerUid, programmaTitle: card.title, programId: card.programId, files },
          { db },
        );
        if (!mountedRef.current) return;
        if (result.status === 'validation_failed') {
          setWsError(describeImportValidationError(result.validationIssues));
          return;
        }
        if (result.status === 'not_applied') {
          // Errore prima dello switch atomico: nessuno switch, corso precedente
          // intatto e ancora visibile. Nessun rollback finto.
          setWsError(result.message);
          return;
        }
        // result.status === 'committed' — the atomic switch already succeeded:
        // the import is live and correct. From here on NOTHING (a failed
        // metadata re-read, a card patch, any UI refresh) may downgrade this
        // to a blocking error — that would falsely tell the teacher the import
        // failed when it did not. Patch the card immediately from the data
        // already in ImportRepositoryResult, then treat getImportMeta as a
        // pure best-effort refinement of annoScolastico.
        onCardPatch?.(card.programId, {
          activeImportId: result.importId,
          hasImport: true,
          udaCount: result.udaCount,
          lessonsTotal: result.lessonCount,
          lessonsDone: 0,
          questionsTotal: result.questionCount,
        });
        setSelection({ kind: 'course' });
        closeDialog();

        let refreshDeferred = false;
        try {
          const meta = await getImportMeta(card.programId, result.importId, db);
          if (!mountedRef.current) return;
          onCardPatch?.(card.programId, { annoScolastico: meta?.annoScolastico ?? null });
        } catch {
          // Post-switch metadata re-read failed — import stays a success; the
          // displayed annoScolastico will simply refresh on next load.
          refreshDeferred = true;
        }

        if (!mountedRef.current) return;
        const notices: string[] = [];
        if (result.cleanupPending) {
          notices.push('Import completato. Pulizia delle vecchie proiezioni rinviata.');
        }
        if (refreshDeferred) {
          notices.push(
            'Import completato. Alcuni dati visualizzati verranno aggiornati al prossimo caricamento.',
          );
        }
        setWsNotice(notices.length > 0 ? notices.join(' ') : null);
      } catch (err) {
        // This catch now guards ONLY the pre-commit steps (readZipFile,
        // importRepository, and the committed-branch card patch/close, which do
        // not throw). A committed import never reaches here as an error.
        if (mountedRef.current)
          setWsError(err instanceof Error ? err.message : "Errore durante l'importazione.");
      }
    });
  }

  /**
   * STRUCTURE-IMPORT-02B — append di lezioni «scheletro» nella UDA scelta.
   *
   * Risolve con il numero di lezioni aggiunte, o `null` se l'import non è stato
   * applicato, così il dialog conserva file e riepilogo per il retry. Il
   * `requestId` sopravvive ai retry: stesso requestId e stesso manifest sono un
   * replay, mai un secondo import.
   */
  async function handleImportLessonStructure(
    udaId: string,
    bytes: Uint8Array,
  ): Promise<number | null> {
    if (!card.activeImportId) return null;
    if (!lessonStructureRequestIdRef.current) {
      lessonStructureRequestIdRef.current = crypto.randomUUID();
    }
    const requestId = lessonStructureRequestIdRef.current;
    setWsNotice(null);
    setWsError(null);
    let added: number | null = null;
    await withBusy(async () => {
      try {
        const result = await importLessonStructure(
          // STRUCTURE-IMPORT-UI-PASTE-01 — non esiste più un file, quindi
          // nessun `filename`: il controllo di estensione non ha bersaglio e il
          // resto della validazione byte-first è identico.
          { programId: card.programId, udaId, ownerUid, requestId, bytes },
          createFirestoreLessonStructureImportDeps(db),
        );
        if (!mountedRef.current) return;
        if (result.status === 'validation_failed') {
          setWsError(result.error.message);
          return;
        }
        if (result.status === 'not_applied' || result.status === 'cleanup_pending') {
          setWsError(result.message);
          return;
        }
        if (result.status === 'committed_replay') {
          // Un tentativo precedente era già andato a buon fine e la risposta si
          // era persa. Gli id vengono dal record persistito, non da un piano
          // ricostruito: l'albero locale non va indovinato, va ricaricato.
          added = result.lessonCount;
          lessonStructureRequestIdRef.current = null;
          setWsNotice(
            `${result.lessonCount} lezioni erano già state importate da questo tentativo. Ricarica la vista per vederle.`,
          );
          return;
        }
        // Committato: le lezioni sono vive. Da qui nulla può declassare
        // l'esito a errore.
        added = result.lessonCount;
        lessonStructureRequestIdRef.current = null;
        let refreshDeferred = false;
        try {
          // Nessun refetch: il manifest è esattamente ciò che il commit ha
          // scritto. Le nuove lezioni entrano sotto la loro UDA, in ordine
          // canonico, e i conteggi seguono.
          const appended: LessonItem[] = result.manifest.lessons.map((planned) => ({
            id: planned.lessonId,
            ...planned.doc,
            completed: false,
          }));
          setTree((prev) => {
            if (!prev) return prev;
            const next = {
              udas: prev.udas.map((u) =>
                u.id === udaId ? { ...u, lessonCount: (u.lessonCount ?? 0) + appended.length } : u,
              ),
              lessons: sortLessons([...prev.lessons, ...appended]),
            };
            patchCardCounts(next);
            return next;
          });
          // Nessuna selezione automatica: aprire una lezione vuota non aiuta.
        } catch {
          refreshDeferred = true;
        }
        setWsNotice(
          refreshDeferred
            ? `${result.lessonCount} lezioni importate. La vista non si è aggiornata completamente; verrà riallineata al prossimo caricamento.`
            : `${result.lessonCount} lezioni importate, con corpo vuoto e senza pool. Nessuna lezione esistente è stata modificata.`,
        );
      } catch (err) {
        if (mountedRef.current) {
          setWsError(
            err instanceof Error ? err.message : "Errore durante l'importazione delle lezioni.",
          );
        }
      }
    });
    return added;
  }

  /**
   * STRUCTURE-IMPORT-02A — metadata-only append of UDAs from a YAML file.
   *
   * Resolves with the number of UDAs added, or `null` when the import did not
   * apply, so the dialog can keep the file and the summary for a retry. The
   * `requestId` survives those retries: the same request with the same manifest
   * hash is a replay, never a second import.
   */
  async function handleImportUdaStructure(bytes: Uint8Array): Promise<number | null> {
    if (!card.activeImportId) return null;
    if (!udaStructureRequestIdRef.current) udaStructureRequestIdRef.current = crypto.randomUUID();
    const requestId = udaStructureRequestIdRef.current;
    setWsNotice(null);
    setWsError(null);
    let added: number | null = null;
    await withBusy(async () => {
      try {
        const result = await importUdaStructure(
          { programId: card.programId, ownerUid, requestId, bytes },
          createFirestoreUdaStructureImportDeps(db),
        );
        if (!mountedRef.current) return;
        if (result.status === 'validation_failed') {
          setWsError(result.error.message);
          return;
        }
        if (result.status === 'not_applied' || result.status === 'cleanup_pending') {
          setWsError(result.message);
          return;
        }
        if (result.status === 'committed_replay') {
          // Stesso caso dell'import lezioni: il commit era già avvenuto e la
          // risposta si era persa. Nessuna ricostruzione locale, solo il
          // conteggio autorevole e l'invito a ricaricare.
          added = result.udaCount;
          udaStructureRequestIdRef.current = null;
          setWsNotice(
            `${result.udaCount} UDA erano già state importate da questo tentativo. Ricarica la vista per vederle.`,
          );
          return;
        }
        // Committed: every new UDA is live. Nothing below may turn this into an
        // error — at worst the local view is stale and says so.
        added = result.udaCount;
        udaStructureRequestIdRef.current = null;
        let refreshDeferred = false;
        try {
          // No refetch: the manifest is exactly what the commit wrote, so the
          // new UDAs are appended locally, already in canonical order.
          const appended: UdaItem[] = result.manifest.udas.map((planned) => ({
            id: planned.udaId,
            ...planned.doc,
          }));
          setTree((prev) => {
            if (!prev) return prev;
            const next = { ...prev, udas: sortUdas([...prev.udas, ...appended]) };
            patchCardCounts(next);
            return next;
          });
          setCollapsedUdas((prev) => {
            const next = new Set(prev);
            for (const uda of appended) next.add(uda.id);
            return next;
          });
        } catch {
          refreshDeferred = true;
        }
        setWsNotice(
          refreshDeferred
            ? `${result.udaCount} UDA importate. La vista non si è aggiornata completamente; verrà riallineata al prossimo caricamento.`
            : `${result.udaCount} UDA importate. Nessuna UDA esistente è stata modificata.`,
        );
      } catch (err) {
        if (mountedRef.current) {
          setWsError(
            err instanceof Error
              ? err.message
              : "Errore durante l'importazione della struttura UDA.",
          );
        }
      }
    });
    return added;
  }

  function handleImportUda(files: RawFile[]) {
    if (!card.activeImportId) return;
    // Synchronous double-click guard (wsBusy is async React state).
    if (udaImportInFlightRef.current) return;
    udaImportInFlightRef.current = true;
    if (!udaImportRequestIdRef.current) udaImportRequestIdRef.current = crypto.randomUUID();
    const requestId = udaImportRequestIdRef.current;
    setWsNotice(null);
    void withBusy(async () => {
      try {
        const result = await importUda(
          { programId: card.programId, ownerUid, requestId, files },
          createFirestoreUdaImportDeps(db),
        );
        if (!mountedRef.current) return;
        if (result.status === 'validation_failed') {
          setWsError(result.error.message);
          return;
        }
        if (result.status === 'not_applied' || result.status === 'cleanup_pending') {
          setWsError(result.message);
          return;
        }
        // result.status === 'committed': the UDA is live. From here nothing may
        // downgrade this to a blocking error. Refresh the tree best-effort.
        const importId = card.activeImportId!;
        let refreshDeferred = false;
        try {
          const [udas, allLessons] = await Promise.all([
            listUdas(card.programId, importId, db),
            listLessons(card.programId, importId, db),
          ]);
          if (!mountedRef.current) return;
          const lessons = filterCommittedLessons(udas, allLessons);
          const next = { udas, lessons };
          setTree(next);
          setCollapsedUdas((prev) => new Set(prev).add(result.udaId));
          patchCardCounts(next);
        } catch {
          refreshDeferred = true;
        }
        // Reset idempotency token — this operation is done.
        udaImportRequestIdRef.current = null;
        setSelection({ kind: 'course' });
        closeDialog();
        if (!mountedRef.current) return;
        setWsNotice(
          refreshDeferred
            ? 'UDA importata. La vista non si è aggiornata completamente; verrà riallineata al prossimo caricamento.'
            : 'UDA importata. Sidebar, panoramica e conteggi sono stati aggiornati.',
        );
      } catch (err) {
        if (mountedRef.current)
          setWsError(
            err instanceof Error ? err.message : "Errore durante l'importazione della UDA.",
          );
      } finally {
        udaImportInFlightRef.current = false;
      }
    });
  }

  function handleSaveClasses(classIds: string[], classNames: string[]) {
    void withBusy(async () => {
      try {
        await setProgramClassIds(card.programId, classIds, ownerUid, db);
        if (!mountedRef.current) return;
        onCardPatch?.(card.programId, { classIds, classNames });
        closeDialog();
      } catch {
        if (mountedRef.current) setWsError('Impossibile salvare le classi.');
      }
    });
  }

  function handleDeleteCourse() {
    if (deletingCourseRef.current) return;
    deletingCourseRef.current = true;
    void withBusy(async () => {
      try {
        await deleteProgram(
          card.programId,
          ownerUid,
          db,
          createProgramNotesCleanupCallable(functions),
          createVisualLifecycleClient(functions).cleanupForDelete,
        );
        if (!mountedRef.current) return;
        onCourseDeleted?.(card.programId);
      } catch (err) {
        if (mountedRef.current)
          setWsError(err instanceof Error ? err.message : 'Impossibile eliminare il corso.');
      } finally {
        deletingCourseRef.current = false;
      }
    });
  }

  async function handleExportZip() {
    setMenuOpen(false);
    try {
      await exportZip(cardToProgram(card), storage, db);
    } catch {
      if (mountedRef.current) setWsError('Impossibile esportare il ZIP.');
    }
  }

  async function handleProgrammaSvolto(format: 'md' | 'pdf') {
    setMenuOpen(false);
    if (!tree) return;
    if (format === 'pdf' && programPdfBusyRef.current) return;
    if (format === 'pdf') {
      programPdfBusyRef.current = true;
      setProgramPdfBusy(true);
      setProgramPdfError(null);
    }
    try {
      const meta = card.activeImportId
        ? await getImportMeta(card.programId, card.activeImportId, db).catch(() => null)
        : null;
      const content = generateMarkdown(cardToProgram(card), tree.udas, tree.lessons, meta);
      const base = `programma-svolto-${card.title.replace(/\s+/g, '_')}`;
      if (format === 'md') downloadMarkdown(content, `${base}.md`);
      else await downloadPdf(content, base);
    } catch (error) {
      if (format !== 'pdf') throw error;
      if (!mountedRef.current) return;
      setProgramPdfError(
        error instanceof PdfModuleLoadError && error.category === 'stale_chunk'
          ? 'stale_chunk'
          : 'generic',
      );
    } finally {
      if (format === 'pdf') {
        programPdfBusyRef.current = false;
        if (mountedRef.current) setProgramPdfBusy(false);
      }
    }
  }

  function handleNewUda(values: { titolo: string } & UdaMetadataValues) {
    if (!card.activeImportId) return;
    const importId = card.activeImportId;
    void withBusy(async () => {
      try {
        const { udaId, dir, order } = await createUda({
          programId: card.programId,
          importId,
          ownerUid,
          fields: values,
          db,
          storage,
        });
        const newUda: UdaItem = {
          id: udaId,
          ownerUid,
          importId,
          dir,
          filename: `${dir}.md`,
          order,
          storageBasePath: `repository/${ownerUid}/imports/${importId}/${dir}`,
          lessonCount: 0,
          titolo: values.titolo,
          descrizione: values.descrizione,
          competenze: values.competenze,
          obiettivi: values.obiettivi,
        };
        if (!mountedRef.current) return;
        // Compute the next tree deterministically, keep setTree pure, and
        // patch the card once outside the updater (Strict Mode double-invokes
        // updaters — the external callback must not run twice).
        const next: Tree = tree
          ? { udas: [...tree.udas, newUda], lessons: tree.lessons }
          : { udas: [newUda], lessons: [] };
        setTree(next);
        patchCardCounts(next);
        closeDialog();
      } catch (err) {
        if (mountedRef.current)
          setWsError(err instanceof Error ? err.message : 'Impossibile creare la UDA.');
      }
    });
  }

  function handleEditUda(udaId: string, values: UdaMetadataValues) {
    if (!card.activeImportId) return;
    const importId = card.activeImportId;
    void withBusy(async () => {
      try {
        await updateUdaMetadata({
          programId: card.programId,
          importId,
          udaId,
          fields: values,
          ownerUid,
          db,
          storage,
        });
        if (!mountedRef.current) return;
        setTree((prev) =>
          prev
            ? {
                ...prev,
                udas: prev.udas.map((u) => (u.id === udaId ? { ...u, ...values } : u)),
              }
            : prev,
        );
        closeDialog();
      } catch (err) {
        if (mountedRef.current)
          setWsError(err instanceof Error ? err.message : 'Impossibile salvare la UDA.');
      }
    });
  }

  function handleDeleteUda(udaId: string) {
    if (!card.activeImportId) return;
    const importId = card.activeImportId;
    const uda = tree?.udas.find((u) => u.id === udaId);
    void withBusy(async () => {
      try {
        await deleteUda({
          programId: card.programId,
          importId,
          udaId,
          ownerUid,
          db,
          storage,
          cleanupVisuals: createVisualLifecycleClient(functions).cleanupForDelete,
        });
        if (!mountedRef.current) return;
        // Deterministic next tree + pure setTree; patch the card once, outside
        // the updater, so Strict Mode can't duplicate the card callback.
        if (tree) {
          const next: Tree = {
            udas: tree.udas.filter((u) => u.id !== udaId),
            lessons: uda ? tree.lessons.filter((l) => l.udaDir !== uda.dir) : tree.lessons,
          };
          setTree(next);
          patchCardCounts(next);
        }
        setSelection({ kind: 'course' });
        closeDialog();
      } catch (err) {
        if (!mountedRef.current) return;
        if (err instanceof RepositoryDeleteBlockedError) {
          setUdaBlockers(err.blockers);
        } else {
          setWsError(err instanceof Error ? err.message : 'Impossibile eliminare la UDA.');
        }
      }
    });
  }

  // ── Lesson actions (DUX-04B) ────────────────────────────────────────────
  function handleNewLesson(uda: UdaItem, values: NewLessonValues) {
    if (!card.activeImportId) return;
    const importId = card.activeImportId;
    void withBusy(async () => {
      try {
        const { lessonId, filename } = await createLesson({
          programId: card.programId,
          importId,
          udaId: uda.id,
          udaDir: uda.dir,
          ownerUid,
          fields: values,
          db,
          storage,
        });
        const newLesson: LessonItem = {
          id: lessonId,
          ownerUid,
          importId,
          udaDir: uda.dir,
          path: `${uda.dir}/${filename}`,
          filename,
          poolStatus: 'absent',
          questionCount: 0,
          storageRef: `repository/${ownerUid}/imports/${importId}/${uda.dir}/${filename}`,
          poolStorageRef: null,
          completed: false,
          titolo: values.titolo,
          sottotitolo: values.sottotitolo,
          difficolta: values.difficolta,
          concettiChiave: values.concettiChiave,
          obiettivi: values.obiettivi,
        };
        if (!mountedRef.current) return;
        const next: Tree = tree
          ? { udas: tree.udas, lessons: [...tree.lessons, newLesson] }
          : { udas: [], lessons: [newLesson] };
        setTree(next);
        patchCardCounts(next);
        closeDialog();
        // Select the new lesson and show its content locally — no Storage read.
        currentLessonRef.current = lessonId;
        setSelection({ kind: 'lesson', lessonId });
        setActiveTab('contenuto');
        setDomandeVisited(false);
        setMappaVisited(false);
        setConceptMapDirty(false);
        setPoolDirty(false);
        setEditingContent(false);
        setEditingInfo(false);
        setContentDirty(false);
        setInfoDirty(false);
        setLessonError(null);
        setLessonLoading(false);
        setLessonContent(values.body);
        setLessonMetadata({
          titolo: values.titolo,
          sottotitolo: values.sottotitolo,
          difficolta: values.difficolta,
          concettiChiave: values.concettiChiave,
          obiettivi: values.obiettivi,
        });
        lessonRequestRef.current++; // invalidate any in-flight fetch
      } catch (err) {
        if (mountedRef.current)
          setWsError(err instanceof Error ? err.message : 'Impossibile creare la lezione.');
      }
    });
  }

  function handleSaveContent(lesson: LessonItem, body: string) {
    if (!card.activeImportId) return;
    const importId = card.activeImportId;
    const lessonId = lesson.id;
    setContentStatus({ busy: true, error: null, saved: false });
    void (async () => {
      try {
        await updateLessonMarkdownBody({
          programId: card.programId,
          importId,
          lessonId,
          body,
          ownerUid,
          db,
          storage,
        });
        // After unmount, no UI update at all; after a mere lesson change, the
        // save must not write the now-current lesson's panel.
        if (!mountedRef.current || currentLessonRef.current !== lessonId) return;
        setLessonContent(body);
        setEditingContent(false);
        setContentDirty(false);
        setContentStatus({ busy: false, error: null, saved: true });
      } catch (err) {
        if (!mountedRef.current || currentLessonRef.current !== lessonId) return;
        setContentStatus({
          busy: false,
          error: err instanceof Error ? err.message : 'Impossibile salvare il contenuto.',
          saved: false,
        });
      }
    })();
  }

  function handleSaveInfo(lesson: LessonItem, fields: LessonMetadata) {
    if (!card.activeImportId) return;
    const importId = card.activeImportId;
    const lessonId = lesson.id;
    setInfoStatus({ busy: true, error: null, saved: false });
    void (async () => {
      try {
        await updateLessonMetadata({
          programId: card.programId,
          importId,
          lessonId,
          fields,
          ownerUid,
          db,
          storage,
        });
        // After unmount, no local update at all. While still mounted, the tree
        // update (keyed by id) is allowed even after a mere lesson change —
        // it updates the *old* lesson's document, not the new panel.
        if (!mountedRef.current) return;
        setTree((prev) =>
          prev
            ? {
                ...prev,
                lessons: prev.lessons.map((l) => (l.id === lessonId ? { ...l, ...fields } : l)),
              }
            : prev,
        );
        if (currentLessonRef.current !== lessonId) return;
        setLessonMetadata(fields);
        setEditingInfo(false);
        setInfoDirty(false);
        setInfoStatus({ busy: false, error: null, saved: true });
      } catch (err) {
        if (!mountedRef.current || currentLessonRef.current !== lessonId) return;
        setInfoStatus({
          busy: false,
          error: err instanceof Error ? err.message : 'Impossibile salvare le informazioni.',
          saved: false,
        });
      }
    })();
  }

  /**
   * CONCEPT-MAP-03 — mappa già salvata sulla lezione selezionata, letta
   * fail-closed dall'albero **già in memoria**: nessuna lettura aggiuntiva.
   */
  const selectedConceptMap = selectedLesson ? readPrivateConceptMap(selectedLesson) : null;
  /**
   * Motivo per cui la generazione è impossibile, o `null` se è disponibile. Una
   * mappa generata da un corpo non salvato descriverebbe un testo che non
   * esiste ancora per nessuno: né per lo studente, né al prossimo caricamento.
   * Il motivo vive nella scheda, accanto al pulsante che disabilita.
   */
  const conceptMapBlockedReason: string | null =
    lessonContent === null
      ? 'Contenuto della lezione non disponibile.'
      : lessonContent.trim().length === 0
        ? 'La lezione non ha ancora un contenuto: scrivilo e salvalo prima di generare la mappa.'
        : contentDirty
          ? 'Salva prima le modifiche al contenuto: la mappa si genera dal testo salvato.'
          : null;
  const visualBlockedReason: string | null = lessonLoading
    ? 'Attendi il caricamento del contenuto.'
    : lessonError
      ? 'Risolvi prima l’errore di caricamento del contenuto.'
      : lessonContent === null || lessonContent.trim().length === 0
        ? 'La lezione deve avere un contenuto salvato.'
        : editingContent
          ? 'Termina prima la modifica del contenuto.'
          : contentDirty
            ? 'Salva prima le modifiche al contenuto.'
            : !card.activeImportId
              ? 'L’importazione attiva non è disponibile.'
              : null;

  async function handleSaveConceptMap(lesson: LessonItem, markdown: string): Promise<void> {
    if (!card.activeImportId) throw new Error('Importazione non disponibile.');
    await saveLessonConceptMap({
      programId: card.programId,
      importId: card.activeImportId,
      lessonId: lesson.id,
      publicLessonId: resolvePublicLessonId(lesson, lesson.id),
      ownerUid,
      conceptMapMarkdown: markdown,
      db,
    });
    if (!mountedRef.current) return;
    // Aggiornamento locale dell'albero: la lezione selezionata riflette subito
    // la nuova mappa senza rileggere nulla.
    setTree((prev) =>
      prev
        ? {
            udas: prev.udas,
            lessons: prev.lessons.map((l) =>
              l.id === lesson.id ? { ...l, conceptMapMarkdown: markdown } : l,
            ),
          }
        : prev,
    );
  }

  function handleToggleCompleted(lesson: LessonItem) {
    if (!card.activeImportId) return;
    const importId = card.activeImportId;
    const next = !(lesson.completed ?? false);
    setCompletedBusy(true);
    setCompletedError(null);
    void (async () => {
      try {
        await setLessonCompleted(
          card.programId,
          importId,
          lesson.id,
          resolvePublicLessonId(lesson, lesson.id),
          next,
          ownerUid,
          db,
        );
        if (!mountedRef.current) return;
        // Deterministic next tree + pure setTree; patch the card's lessonsDone
        // once, outside the updater (Strict Mode-safe).
        if (tree) {
          const lessons = tree.lessons.map((l) =>
            l.id === lesson.id ? { ...l, completed: next } : l,
          );
          const nextTree: Tree = { udas: tree.udas, lessons };
          setTree(nextTree);
          patchCardCounts(nextTree);
        }
      } catch (err) {
        if (mountedRef.current)
          setCompletedError(
            err instanceof Error ? err.message : 'Impossibile aggiornare lo stato.',
          );
      } finally {
        if (mountedRef.current) setCompletedBusy(false);
      }
    })();
  }

  function handleDeleteLesson(lessonId: string) {
    if (!card.activeImportId) return;
    const importId = card.activeImportId;
    const lesson = tree?.lessons.find((l) => l.id === lessonId);
    const uda = lesson ? tree?.udas.find((u) => u.dir === lesson.udaDir) : undefined;
    if (!lesson || !uda) return;
    void withBusy(async () => {
      try {
        await deleteLesson({
          programId: card.programId,
          importId,
          udaId: uda.id,
          lessonId,
          ownerUid,
          db,
          storage,
          cleanupVisuals: createVisualLifecycleClient(functions).cleanupForDelete,
        });
        if (!mountedRef.current) return;
        if (tree) {
          const nextTree: Tree = {
            udas: tree.udas,
            lessons: tree.lessons.filter((l) => l.id !== lessonId),
          };
          setTree(nextTree);
          patchCardCounts(nextTree);
        }
        setSelection({ kind: 'uda', udaDir: uda.dir });
        closeDialog();
      } catch (err) {
        if (!mountedRef.current) return;
        if (err instanceof RepositoryDeleteBlockedError) {
          setLessonBlockers(err.blockers);
        } else {
          setWsError(err instanceof Error ? err.message : 'Impossibile eliminare la lezione.');
        }
      }
    });
  }

  // ── Organize mode + reorder (DUX-04C) ───────────────────────────────────
  // Entering Organize goes through the dirty guard: an unsaved editor must be
  // resolved first (never silently discarded).
  function enterOrganize() {
    guardedNav(() => {
      setReorderError(null);
      setMenuOpen(false);
      setOrganizing(true);
    });
  }
  function exitOrganize() {
    setOrganizing(false);
    setReorderError(null);
  }

  function handleMoveUda(index: number, direction: -1 | 1) {
    if (!card.activeImportId || !tree || reorderBusy) return;
    const importId = card.activeImportId;
    const udas = tree.udas;
    const neighborIndex = index + direction;
    if (neighborIndex < 0 || neighborIndex >= udas.length) return;
    const uda = udas[index]!;
    const neighbor = udas[neighborIndex]!;
    setReorderBusy(true);
    setReorderError(null);
    void (async () => {
      try {
        const { order, neighborOrder } = await reorderUda({
          programId: card.programId,
          importId,
          udaId: uda.id,
          neighborUdaId: neighbor.id,
          ownerUid,
          db,
        });
        if (!mountedRef.current) return;
        // Apply the swapped orders locally only after success, then re-sort.
        setTree((prev) => {
          if (!prev) return prev;
          const nextUdas = sortUdas(
            prev.udas.map((u) =>
              u.id === uda.id
                ? { ...u, order }
                : u.id === neighbor.id
                  ? { ...u, order: neighborOrder }
                  : u,
            ),
          );
          return { udas: nextUdas, lessons: prev.lessons };
        });
      } catch (err) {
        if (mountedRef.current)
          setReorderError(err instanceof Error ? err.message : 'Impossibile riordinare la UDA.');
      } finally {
        if (mountedRef.current) setReorderBusy(false);
      }
    })();
  }

  function handleMoveLesson(
    udaDir: string,
    lessonsInUda: LessonItem[],
    index: number,
    direction: -1 | 1,
  ) {
    if (!card.activeImportId || !tree || reorderBusy) return;
    const importId = card.activeImportId;
    const neighborIndex = index + direction;
    if (neighborIndex < 0 || neighborIndex >= lessonsInUda.length) return;
    const lesson = lessonsInUda[index]!;
    const neighbor = lessonsInUda[neighborIndex]!;
    // La UDA è nota dal `dir`: serve al guardrail contro un import di lezioni
    // in volo su questa stessa UDA, ed è obbligatoria.
    const parentUdaId = tree.udas.find((u) => u.dir === udaDir)?.id;
    if (!parentUdaId) return;
    setReorderBusy(true);
    setReorderError(null);
    void (async () => {
      try {
        const { order, neighborOrder } = await reorderLesson({
          programId: card.programId,
          importId,
          lessonId: lesson.id,
          neighborLessonId: neighbor.id,
          ownerUid,
          udaId: parentUdaId,
          db,
        });
        if (!mountedRef.current) return;
        setTree((prev) => {
          if (!prev) return prev;
          const nextLessons = sortLessons(
            prev.lessons.map((l) =>
              l.id === lesson.id
                ? { ...l, order }
                : l.id === neighbor.id
                  ? { ...l, order: neighborOrder }
                  : l,
            ),
          );
          return { udas: prev.udas, lessons: nextLessons };
        });
      } catch (err) {
        if (mountedRef.current)
          setReorderError(
            err instanceof Error ? err.message : 'Impossibile riordinare la lezione.',
          );
      } finally {
        if (mountedRef.current) setReorderBusy(false);
      }
    })();
  }

  const pct = card.lessonsTotal > 0 ? Math.round((card.lessonsDone / card.lessonsTotal) * 100) : 0;
  const yearLabel = card.annoScolastico ?? 'Senza anno';
  // Once the tree is loaded, derive the domande total from it so a pool edit
  // updates the strip live; before that, fall back to the card's counter.
  const questionsTotal = tree
    ? tree.lessons.reduce((s, l) => s + (l.questionCount ?? 0), 0)
    : card.questionsTotal;

  // Back keeps its navigation meaning even while organizing. The selection
  // effect clears Organize, while "Fine" remains the explicit exit control.
  function goUpOneLevel() {
    if (selection.kind === 'lesson' && selectedLesson) {
      const udaDir = selectedLesson.udaDir;
      guardedNav(() => setSelection({ kind: 'uda', udaDir }));
    } else if (selection.kind === 'uda') {
      guardedNav(() => setSelection({ kind: 'course' }));
    } else {
      guardedNav(onBack);
    }
  }
  const backLabel = isMobile && selection.kind !== 'course' ? '← Indietro' : '← Libreria';
  const backRun = isMobile ? goUpOneLevel : () => guardedNav(onBack);

  return (
    <section aria-label={`Corso — ${card.title}`} className={styles.workspace}>
      <header className={styles.header}>
        <button type="button" className={styles.backBtn} onClick={backRun}>
          {backLabel}
        </button>
        <h2 className={styles.title}>{card.title}</h2>
      </header>

      {wsNotice && (
        <p role="status" className="text-muted">
          {wsNotice}
        </p>
      )}

      {programPdfBusy && (
        <p aria-busy="true" className="state-loading">
          Generazione PDF in corso…
        </p>
      )}
      {programPdfError && (
        <div role="alert">
          <p className="text-error">
            {programPdfError === 'stale_chunk'
              ? 'SchoolForge è stato aggiornato. Ricarica la pagina e riprova.'
              : 'Impossibile generare il PDF. Riprova.'}
          </p>
          {programPdfError === 'stale_chunk' && (
            <button type="button" onClick={() => guardedNav(reloadCurrentPage)}>
              Ricarica pagina
            </button>
          )}
        </div>
      )}

      <div className={styles.summaryStrip}>
        <span className={styles.pill}>{yearLabel}</span>
        {card.classNames.length > 0 ? (
          card.classNames.map((name) => (
            <span key={name} className={styles.pill}>
              {name}
            </span>
          ))
        ) : (
          <span className={styles.pill}>Nessuna classe</span>
        )}
        <span className={styles.sep} aria-hidden="true">
          ·
        </span>
        <span>
          <strong>{card.udaCount}</strong> UDA
        </span>
        <span className={styles.sep} aria-hidden="true">
          ·
        </span>
        <span>
          <strong>
            {card.lessonsDone}/{card.lessonsTotal}
          </strong>{' '}
          lezioni svolte
        </span>
        <span className={styles.sep} aria-hidden="true">
          ·
        </span>
        <span>
          <strong>{questionsTotal}</strong> domande
        </span>
        <div className={styles.progressTrack} role="img" aria-label={`Avanzamento lezioni ${pct}%`}>
          <div className={styles.progressFill} style={{ width: `${pct}%` }} />
        </div>
      </div>

      <div className={`${styles.body}${lessonFocusMode ? ` ${styles.bodyFocus}` : ''}`}>
        {/* Mobile: no sidebar at all — single-level progressive navigation. */}
        {isMobile || lessonFocusMode ? null : (
          <nav className={styles.sidebar} aria-label="Struttura corso">
            <div className={styles.sidebarHead}>
              <button
                type="button"
                className={`${styles.overviewBtn}${selection.kind === 'course' ? ` ${styles.selected}` : ''}`}
                aria-current={selection.kind === 'course' ? 'true' : undefined}
                onClick={() => guardedNav(() => setSelection({ kind: 'course' }))}
              >
                <IconBookOpen size={15} />
                <span>Panoramica corso</span>
              </button>
            </div>

            {tree === null ? (
              <p aria-busy="true" className="state-loading">
                Caricamento…
              </p>
            ) : treeError ? (
              <p role="alert" className="text-error">
                {treeError}
              </p>
            ) : tree.udas.length === 0 ? (
              <p className="state-empty">Nessuna UDA in questo corso.</p>
            ) : (
              <ul className={styles.udaList}>
                {tree.udas.map((uda) => {
                  const open = !collapsedUdas.has(uda.dir);
                  const udaLessons = lessonsByUda.get(uda.dir) ?? [];
                  const udaCompleted =
                    udaLessons.length > 0 && udaLessons.every((lesson) => lesson.completed);
                  const udaSelected = selection.kind === 'uda' && selection.udaDir === uda.dir;
                  return (
                    <li key={uda.id} className={styles.udaItem}>
                      <div className={styles.udaHead}>
                        <button
                          type="button"
                          className={styles.caretBtn}
                          aria-label={open ? `Comprimi ${uda.dir}` : `Espandi ${uda.dir}`}
                          aria-expanded={open}
                          onClick={() => toggleUdaCollapsed(uda.dir)}
                        >
                          <span
                            className={open ? styles.caretOpen : styles.caret}
                            aria-hidden="true"
                          >
                            ▸
                          </span>
                        </button>
                        <button
                          type="button"
                          className={`${styles.udaTitleBtn}${udaSelected ? ` ${styles.selected}` : ''}`}
                          aria-current={udaSelected ? 'true' : undefined}
                          onClick={() =>
                            guardedNav(() => {
                              setCollapsedUdas((current) => {
                                const next = new Set(current);
                                next.delete(uda.dir);
                                return next;
                              });
                              setSelection({ kind: 'uda', udaDir: uda.dir });
                            })
                          }
                        >
                          <span
                            className={
                              udaCompleted ? styles.udaCompletedIcon : styles.udaPendingIcon
                            }
                            aria-hidden="true"
                            title={udaCompleted ? 'UDA completata' : 'UDA da completare'}
                          >
                            <IconLayers size={14} />
                          </span>
                          <span>{uda.dir}</span>
                        </button>
                      </div>
                      {open && udaLessons.length > 0 && (
                        <ul className={styles.lessonList}>
                          {udaLessons.map((lesson) => {
                            const { title } = resolveLessonTitle(lesson.filename, lesson.titolo);
                            const active =
                              selection.kind === 'lesson' && selection.lessonId === lesson.id;
                            return (
                              <li key={lesson.id}>
                                <button
                                  type="button"
                                  className={`${styles.lessonBtn}${active ? ` ${styles.selected}` : ''}`}
                                  aria-label={title}
                                  aria-current={active ? 'true' : undefined}
                                  onClick={() => guardedNav(() => void selectLesson(lesson))}
                                >
                                  <span
                                    className={
                                      lesson.completed
                                        ? styles.lessonCompletedIcon
                                        : styles.lessonPendingIcon
                                    }
                                    role="img"
                                    aria-label={
                                      lesson.completed ? 'Lezione svolta' : 'Lezione da svolgere'
                                    }
                                    title={
                                      lesson.completed ? 'Lezione svolta' : 'Lezione da svolgere'
                                    }
                                  >
                                    {lesson.completed ? (
                                      <IconFileCheck size={14} />
                                    ) : (
                                      <IconFileText size={14} />
                                    )}
                                  </span>
                                  <span
                                    className={`${styles.poolStatus} ${
                                      lesson.poolStatus === 'valid'
                                        ? styles.poolValid
                                        : lesson.poolStatus === 'invalid'
                                          ? styles.poolInvalid
                                          : styles.poolAbsent
                                    }`}
                                    role="img"
                                    aria-label={poolStatusText(lesson.poolStatus)}
                                    title={poolStatusText(lesson.poolStatus)}
                                  >
                                    {lesson.poolStatus === 'invalid' ? (
                                      <IconTriangleAlert size={14} />
                                    ) : (
                                      <IconCircleQuestion size={14} />
                                    )}
                                  </span>
                                  <span className={styles.lessonBtnText}>{title}</span>
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </nav>
        )}

        <div className={styles.content}>
          {selection.kind === 'course' && organizing && (
            <div className={styles.toolbar}>
              <span className={styles.organizeLabel}>Riordina UDA</span>
              <button type="button" className="btn-primary" onClick={exitOrganize}>
                Fine
              </button>
            </div>
          )}
          {selection.kind === 'course' && !organizing && (
            <div className={styles.toolbar}>
              <div className={styles.menuWrap}>
                <button
                  type="button"
                  ref={menuTriggerRef}
                  className={styles.toolbarMenuBtn}
                  aria-haspopup="true"
                  aria-expanded={menuOpen}
                  aria-label="Azioni corso"
                  onClick={() => setMenuOpen((o) => !o)}
                >
                  <IconMoreHorizontal size={16} />
                  <span>Azioni</span>
                </button>
                <ActionsMenu
                  open={menuOpen}
                  anchorRef={menuTriggerRef}
                  ariaLabel="Azioni corso"
                  ref={menuRef}
                >
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => openDialog({ kind: 'renameCourse' })}
                  >
                    <IconPencil size={15} />
                    Modifica titolo
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => openDialog({ kind: 'importCourse' })}
                  >
                    <IconUpload size={15} />
                    Importa ZIP
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    disabled={!card.hasImport}
                    onClick={() => openDialog({ kind: 'importUda' })}
                  >
                    <IconUpload size={15} />
                    Importa UDA
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    disabled={!card.hasImport}
                    onClick={() => openDialog({ kind: 'importUdaStructure' })}
                  >
                    <IconLayers size={15} />
                    Importa struttura UDA
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    disabled={!card.hasImport}
                    onClick={() => void handleExportZip()}
                  >
                    <IconDownload size={15} />
                    Esporta ZIP
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    disabled={!card.hasImport}
                    onClick={() => void handleProgrammaSvolto('md')}
                  >
                    <IconFileText size={15} />
                    Programma svolto (MD)
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    disabled={!card.hasImport || programPdfBusy}
                    onClick={() => void handleProgrammaSvolto('pdf')}
                  >
                    <IconFileCheck size={15} />
                    Programma svolto (PDF)
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => openDialog({ kind: 'classes' })}
                  >
                    <IconGraduationCap size={15} />
                    Classi assegnate
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => openDialog({ kind: 'info' })}
                  >
                    <IconBookOpen size={15} />
                    Modifica metadati corso
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    disabled={!card.hasImport}
                    onClick={() => openDialog({ kind: 'newUda' })}
                  >
                    <IconPlus size={15} />
                    Nuova UDA
                  </button>
                  {card.hasImport && tree && tree.udas.length > 1 && (
                    <button type="button" role="menuitem" onClick={enterOrganize}>
                      <IconArrowUpDown size={15} />
                      Organizza UDA
                    </button>
                  )}
                  <button
                    type="button"
                    role="menuitem"
                    className={styles.menuDanger}
                    onClick={() => openDialog({ kind: 'deleteCourse' })}
                  >
                    <IconTrash size={15} />
                    Elimina corso
                  </button>
                </ActionsMenu>
              </div>
            </div>
          )}
          {selection.kind === 'course' && (
            <CourseOverview
              card={card}
              tree={tree}
              lessonsByUda={lessonsByUda}
              organizing={organizing}
              reorderBusy={reorderBusy}
              reorderError={reorderError}
              onSelectUda={(udaDir) => guardedNav(() => setSelection({ kind: 'uda', udaDir }))}
              onMoveUda={handleMoveUda}
            />
          )}
          {selection.kind === 'uda' && selectedUda && organizing && (
            <div className={styles.toolbar}>
              <span className={styles.organizeLabel}>Riordina lezioni</span>
              <button type="button" className="btn-primary" onClick={exitOrganize}>
                Fine
              </button>
            </div>
          )}
          {selection.kind === 'uda' && selectedUda && !organizing && (
            <div className={styles.toolbar}>
              <div className={styles.menuWrap}>
                <button
                  type="button"
                  ref={menuTriggerRef}
                  className={styles.toolbarMenuBtn}
                  aria-haspopup="true"
                  aria-expanded={menuOpen}
                  aria-label="Azioni UDA"
                  onClick={() => setMenuOpen((o) => !o)}
                >
                  <IconMoreHorizontal size={16} />
                  <span>Azioni</span>
                </button>
                <ActionsMenu
                  open={menuOpen}
                  anchorRef={menuTriggerRef}
                  ariaLabel="Azioni UDA"
                  ref={menuRef}
                >
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => openDialog({ kind: 'newLesson' })}
                  >
                    <IconPlus size={15} />
                    Nuova lezione
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() =>
                      openDialog({ kind: 'importLessonStructure', udaId: selectedUda.id })
                    }
                  >
                    <IconUpload size={15} />
                    Importa lezioni
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => openDialog({ kind: 'editUda', udaId: selectedUda.id })}
                  >
                    <IconPencil size={15} />
                    Modifica metadata
                  </button>
                  {(lessonsByUda.get(selectedUda.dir) ?? []).length > 1 && (
                    <button type="button" role="menuitem" onClick={enterOrganize}>
                      <IconArrowUpDown size={15} />
                      Organizza lezioni
                    </button>
                  )}
                  <button
                    type="button"
                    role="menuitem"
                    className={styles.menuDanger}
                    onClick={() => openDialog({ kind: 'deleteUda', udaId: selectedUda.id })}
                  >
                    <IconTrash size={15} />
                    Elimina UDA
                  </button>
                </ActionsMenu>
              </div>
            </div>
          )}
          {selection.kind === 'uda' && selectedUda && (
            <UdaOverview
              uda={selectedUda}
              lessons={lessonsByUda.get(selectedUda.dir) ?? []}
              onOpenLesson={(l) => guardedNav(() => void selectLesson(l))}
              organizing={organizing}
              reorderBusy={reorderBusy}
              reorderError={reorderError}
              onMoveLesson={(index, dir) =>
                handleMoveLesson(
                  selectedUda.dir,
                  lessonsByUda.get(selectedUda.dir) ?? [],
                  index,
                  dir,
                )
              }
            />
          )}
          {selection.kind === 'lesson' && selectedLesson && (
            <div
              className={`${styles.toolbar} ${styles.toolbarLesson}`}
              data-testid="lesson-toolbar"
            >
              <div className={styles.menuWrap}>
                <button
                  type="button"
                  ref={menuTriggerRef}
                  className={styles.toolbarMenuBtn}
                  aria-haspopup="true"
                  aria-expanded={menuOpen}
                  aria-label="Azioni lezione"
                  onClick={() => setMenuOpen((o) => !o)}
                >
                  <IconMoreHorizontal size={16} />
                  <span>Azioni</span>
                </button>
                <ActionsMenu
                  open={menuOpen}
                  anchorRef={menuTriggerRef}
                  ariaLabel="Azioni lezione"
                  ref={menuRef}
                >
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false);
                      selectTab('contenuto');
                      if (!editingContent) {
                        setEditingContent(true);
                        setContentStatus(NO_STATUS);
                      }
                    }}
                    disabled={
                      (editingContent && activeTab === 'contenuto') || lessonContent == null
                    }
                  >
                    <IconPencil size={15} />
                    Modifica contenuto
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false);
                      selectTab('informazioni');
                      if (!editingInfo) {
                        setEditingInfo(true);
                        setInfoStatus(NO_STATUS);
                      }
                    }}
                    disabled={
                      (editingInfo && activeTab === 'informazioni') || lessonContent == null
                    }
                  >
                    <IconBookOpen size={15} />
                    Modifica informazioni
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className={styles.menuDanger}
                    onClick={() =>
                      openDialog({ kind: 'deleteLesson', lessonId: selectedLesson.id })
                    }
                  >
                    <IconTrash size={15} />
                    Elimina lezione
                  </button>
                </ActionsMenu>
              </div>
              {/* Kept outside the menu: the two most frequent lesson actions. */}
              <button
                type="button"
                className={styles.toolbarActionBtn}
                onClick={() => handleToggleCompleted(selectedLesson)}
                disabled={completedBusy}
                aria-pressed={selectedLesson.completed ?? false}
                title={selectedLesson.completed ? 'Segna non svolta' : 'Segna svolta'}
                aria-label={`${selectedLesson.completed ? 'Segna non svolta' : 'Segna svolta'} — ${
                  selectedLesson.titolo ?? selectedLesson.filename
                }`}
              >
                {selectedLesson.completed ? (
                  <IconFileText size={15} />
                ) : (
                  <IconFileCheck size={15} />
                )}
                <span>{selectedLesson.completed ? 'Segna non svolta' : 'Segna svolta'}</span>
              </button>
              {/* Structure toggle only where a desktop sidebar actually exists. */}
              {!isMobile && (
                <button
                  type="button"
                  className={styles.toolbarActionBtn}
                  onClick={() => setLessonFocusMode((current) => !current)}
                  aria-pressed={lessonFocusMode}
                  title={lessonFocusMode ? 'Mostra struttura' : 'Nascondi struttura'}
                  aria-label={lessonFocusMode ? 'Mostra struttura' : 'Nascondi struttura'}
                >
                  <IconPanelLeft size={15} />
                  <span>{lessonFocusMode ? 'Mostra struttura' : 'Nascondi struttura'}</span>
                </button>
              )}
              {contentStatus.saved && <span className={styles.savedNote}>Contenuto salvato</span>}
              {infoStatus.saved && <span className={styles.savedNote}>Informazioni salvate</span>}
              {completedError && (
                <span role="alert" className="text-error">
                  {completedError}
                </span>
              )}
            </div>
          )}
          {selection.kind === 'lesson' && selectedLesson && (
            <LessonDetail
              lesson={selectedLesson}
              metadata={lessonMetadata}
              lessonAi={{
                titolo: lessonMetadata.titolo ?? selectedLesson.titolo ?? null,
                sottotitolo: lessonMetadata.sottotitolo ?? null,
                difficolta: lessonMetadata.difficolta ?? null,
                // UDA title già in memoria dall'albero: nessuna nuova query.
                udaTitle: tree?.udas.find((u) => u.dir === selectedLesson.udaDir)?.titolo ?? null,
                concettiChiave: lessonMetadata.concettiChiave,
                obiettivi: lessonMetadata.obiettivi,
                // AIGEN-CONTEXT-01 + STRUCTURE-IMPORT-03: indice e contesto
                // generale dell'UDA dallo stesso albero già caricato
                // (`tree.lessons` è già in ordine canonico): zero nuove letture.
                udaContext: buildLessonUdaContext({
                  lessons: tree?.lessons ?? [],
                  udaDir: selectedLesson.udaDir,
                  uda: tree?.udas.find((u) => u.dir === selectedLesson.udaDir) ?? null,
                  currentLessonId: selectedLesson.id,
                }),
              }}
              content={lessonContent}
              loading={lessonLoading}
              error={lessonError}
              errorDetails={lessonErrorDetails}
              onRetryContent={() => retryLessonContent(selectedLesson)}
              activeTab={activeTab}
              onSelectTab={selectTab}
              domandeVisited={domandeVisited}
              mappaVisited={mappaVisited}
              programId={card.programId}
              importId={card.activeImportId}
              ownerUid={ownerUid}
              onDirtyChange={setPoolDirty}
              onPoolCountChange={(count, status) =>
                handlePoolCountChange(selectedLesson.id, count, status)
              }
              editingContent={editingContent}
              editingInfo={editingInfo}
              contentStatus={contentStatus}
              infoStatus={infoStatus}
              onSaveContent={(body) => handleSaveContent(selectedLesson, body)}
              onSaveInfo={(fields) => handleSaveInfo(selectedLesson, fields)}
              onCancelContent={() => {
                setEditingContent(false);
                setContentDirty(false);
                setContentStatus(NO_STATUS);
              }}
              onCancelInfo={() => {
                setEditingInfo(false);
                setInfoDirty(false);
                setInfoStatus(NO_STATUS);
              }}
              onContentDirtyChange={setContentDirty}
              onInfoDirtyChange={setInfoDirty}
              conceptMap={selectedConceptMap}
              conceptMapBlockedReason={conceptMapBlockedReason}
              conceptMapCallables={conceptMapCallables}
              onSaveConceptMap={(markdown) => handleSaveConceptMap(selectedLesson, markdown)}
              onConceptMapDirtyChange={setConceptMapDirty}
              visualBlockedReason={visualBlockedReason}
            />
          )}
        </div>
      </div>

      {pendingNav && (
        <div className={styles.confirmBackdrop} onClick={() => setPendingNav(null)}>
          <div
            className={styles.confirmDialog}
            role="alertdialog"
            aria-modal="true"
            aria-label="Modifiche non salvate"
            onClick={(e) => e.stopPropagation()}
          >
            <p className={styles.confirmMessage}>
              Ci sono modifiche non salvate nel pool di domande. Continuando andranno perse.
            </p>
            <div className={styles.confirmActions}>
              <button type="button" onClick={() => setPendingNav(null)}>
                Annulla
              </button>
              <button
                type="button"
                className="btn-danger"
                onClick={() => {
                  const nav = pendingNav;
                  setPendingNav(null);
                  invalidateDrafts();
                  nav.run();
                }}
              >
                Continua senza salvare
              </button>
            </div>
          </div>
        </div>
      )}

      {wsDialog.kind === 'renameCourse' && (
        <TitleDialog
          title="Modifica titolo corso"
          label="Titolo del corso"
          confirmLabel="Salva"
          initial={card.title}
          busy={wsBusy}
          error={wsError}
          onCancel={closeDialog}
          onConfirm={handleRenameCourse}
        />
      )}
      {wsDialog.kind === 'importCourse' && (
        <ImportIntoCourseDialog
          courseTitle={card.title}
          busy={wsBusy}
          error={wsError}
          onCancel={closeDialog}
          onConfirm={handleImportCourse}
        />
      )}
      {wsDialog.kind === 'importUda' && (
        <ImportUdaDialog
          courseTitle={card.title}
          busy={wsBusy}
          error={wsError}
          onCancel={closeDialog}
          onConfirm={handleImportUda}
        />
      )}
      {wsDialog.kind === 'importUdaStructure' && (
        <ImportUdaStructureDialog
          courseTitle={card.title}
          busy={wsBusy}
          error={wsError}
          onCancel={closeDialog}
          onConfirm={handleImportUdaStructure}
        />
      )}
      {wsDialog.kind === 'importLessonStructure' && selectedUda && (
        <ImportLessonStructureDialog
          udaTitle={resolveUdaTitle(selectedUda.dir, selectedUda.titolo)}
          busy={wsBusy}
          error={wsError}
          onCancel={closeDialog}
          onConfirm={(bytes) => handleImportLessonStructure(wsDialog.udaId, bytes)}
        />
      )}
      {wsDialog.kind === 'classes' && (
        <ClassesDialog
          ownerUid={ownerUid}
          currentClassIds={card.classIds}
          busy={wsBusy}
          error={wsError}
          onCancel={closeDialog}
          onConfirm={handleSaveClasses}
        />
      )}
      {wsDialog.kind === 'info' && (
        <ProgramInfoDialog
          programId={card.programId}
          importId={card.activeImportId}
          ownerUid={ownerUid}
          counts={{
            udaCount: tree?.udas.length ?? card.udaCount,
            lessonsDone: tree?.lessons.filter((l) => l.completed).length ?? card.lessonsDone,
            lessonsTotal: tree?.lessons.length ?? card.lessonsTotal,
            questionsTotal,
          }}
          classNames={card.classNames}
          onSaved={(metadata) =>
            onCardPatch?.(card.programId, { annoScolastico: metadata.annoScolastico })
          }
          onClose={closeDialog}
        />
      )}
      {wsDialog.kind === 'deleteCourse' && (
        <ConfirmDialog
          title="Elimina corso"
          message={`Eliminare definitivamente "${card.title}"? Verranno rimossi import, UDA, lezioni, pool e file caricati, e anche gli appunti personali degli studenti associati al corso. L'operazione non è reversibile.`}
          confirmLabel="Elimina"
          danger
          busy={wsBusy}
          error={wsError}
          onCancel={closeDialog}
          onConfirm={handleDeleteCourse}
        />
      )}
      {wsDialog.kind === 'newUda' && (
        <NewUdaDialog
          busy={wsBusy}
          error={wsError}
          onCancel={closeDialog}
          onConfirm={handleNewUda}
        />
      )}
      {wsDialog.kind === 'editUda' &&
        (() => {
          const uda = tree?.udas.find((u) => u.id === wsDialog.udaId);
          if (!uda) return null;
          return (
            <UdaMetadataDialog
              title={`Modifica UDA — ${uda.dir}`}
              confirmLabel="Salva"
              initial={{
                descrizione: uda.descrizione,
                competenze: uda.competenze,
                obiettivi: uda.obiettivi,
              }}
              busy={wsBusy}
              error={wsError}
              onCancel={closeDialog}
              onConfirm={(values) => handleEditUda(wsDialog.udaId, values)}
            />
          );
        })()}
      {wsDialog.kind === 'deleteUda' &&
        (() => {
          const uda = tree?.udas.find((u) => u.id === wsDialog.udaId);
          if (!uda) return null;
          return (
            <ConfirmDialog
              title="Elimina UDA"
              message={
                udaBlockers
                  ? `Impossibile eliminare "${uda.dir}": è collegata a delle verifiche. Rimuovile o modificale prima di eliminare.`
                  : `Eliminare "${uda.dir}"? Verranno rimosse tutte le sue lezioni, i file su Storage e i pool collegati. L'operazione non è reversibile.`
              }
              confirmLabel="Elimina"
              danger
              busy={wsBusy}
              error={wsError}
              extra={
                udaBlockers ? (
                  <ul className={styles.blockersList}>
                    {udaBlockers.map((b) => (
                      <li key={b.verificationId}>{b.title}</li>
                    ))}
                  </ul>
                ) : undefined
              }
              onCancel={closeDialog}
              onConfirm={() => (udaBlockers ? closeDialog() : handleDeleteUda(wsDialog.udaId))}
            />
          );
        })()}
      {wsDialog.kind === 'newLesson' &&
        selectedUda &&
        (() => {
          const uda = selectedUda;
          return (
            <NewLessonDialog
              busy={wsBusy}
              error={wsError}
              onCancel={closeDialog}
              onConfirm={(values) => handleNewLesson(uda, values)}
            />
          );
        })()}
      {wsDialog.kind === 'deleteLesson' &&
        (() => {
          const lesson = tree?.lessons.find((l) => l.id === wsDialog.lessonId);
          if (!lesson) return null;
          const { title } = resolveLessonTitle(lesson.filename, lesson.titolo);
          return (
            <ConfirmDialog
              title="Elimina lezione"
              message={
                lessonBlockers
                  ? `Impossibile eliminare "${title}": è collegata a delle verifiche. Rimuovile o modificale prima di eliminare.`
                  : `Eliminare "${title}"? Verranno rimossi il file su Storage e l'eventuale pool collegato. L'operazione non è reversibile.`
              }
              confirmLabel="Elimina"
              danger
              busy={wsBusy}
              error={wsError}
              extra={
                lessonBlockers ? (
                  <ul className={styles.blockersList}>
                    {lessonBlockers.map((b) => (
                      <li key={b.verificationId}>{b.title}</li>
                    ))}
                  </ul>
                ) : undefined
              }
              onCancel={closeDialog}
              onConfirm={() =>
                lessonBlockers ? closeDialog() : handleDeleteLesson(wsDialog.lessonId)
              }
            />
          );
        })()}
    </section>
  );
}

// ── Course overview (no UDA/lesson selected) ────────────────────────────────

function CourseOverview({
  card,
  tree,
  lessonsByUda,
  organizing,
  reorderBusy,
  reorderError,
  onSelectUda,
  onMoveUda,
}: {
  card: CourseCard;
  tree: Tree | null;
  lessonsByUda: Map<string, LessonItem[]>;
  organizing: boolean;
  reorderBusy: boolean;
  reorderError: string | null;
  onSelectUda: (udaDir: string) => void;
  onMoveUda: (index: number, direction: -1 | 1) => void;
}) {
  return (
    <div>
      {!card.hasImport ? (
        <p className="state-empty">
          Nessun contenuto importato. Importa uno ZIP dalla libreria per popolare questo corso.
        </p>
      ) : tree === null ? (
        <p aria-busy="true" className="state-loading">
          Caricamento struttura…
        </p>
      ) : tree.udas.length === 0 ? (
        <p className="state-empty">Nessuna UDA in questo corso.</p>
      ) : (
        <>
          {organizing && reorderError && (
            <p role="alert" className="text-error">
              {reorderError}
            </p>
          )}
          <div className={styles.overviewPanel}>
            <table className={styles.dataTable}>
              <colgroup>
                <col className={styles.udaTitleColumn} />
                <col className={styles.progressColumn} />
                <col className={styles.orderColumn} />
              </colgroup>
              <thead>
                <tr>
                  <th>UDA</th>
                  <th>Lezioni svolte</th>
                  <th>{organizing ? 'Ordine' : <span className={styles.srOnly}>Apri</span>}</th>
                </tr>
              </thead>
              <tbody>
                {tree.udas.map((uda, index) => {
                  const udaLessons = lessonsByUda.get(uda.dir) ?? [];
                  const done = udaLessons.filter((l) => l.completed).length;
                  return (
                    <tr key={uda.id}>
                      <td className={styles.titleCell}>
                        {organizing ? (
                          <span className={styles.rowStaticLabel}>{uda.dir}</span>
                        ) : (
                          <button
                            type="button"
                            className={styles.rowOpenBtn}
                            aria-label={`Apri UDA ${uda.dir}`}
                            onClick={() => onSelectUda(uda.dir)}
                          >
                            {uda.dir}
                          </button>
                        )}
                      </td>
                      <td>{`${done}/${udaLessons.length}`}</td>
                      <td className={styles.orderCell}>
                        {organizing ? (
                          <ReorderControls
                            label={uda.dir}
                            isFirst={index === 0}
                            isLast={index === tree.udas.length - 1}
                            disabled={reorderBusy}
                            onUp={() => onMoveUda(index, -1)}
                            onDown={() => onMoveUda(index, 1)}
                          />
                        ) : (
                          <span className={styles.rowAffordance} aria-hidden="true">
                            ›
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

// ── UDA overview (UDA selected) ─────────────────────────────────────────────

function MetadataList({ items }: { items: readonly string[] }) {
  return (
    <ul className={styles.metaList}>
      {items.map((item, index) => (
        <li key={`${index}-${item}`}>{item}</li>
      ))}
    </ul>
  );
}

function UdaOverview({
  uda,
  lessons,
  onOpenLesson,
  organizing,
  reorderBusy,
  reorderError,
  onMoveLesson,
}: {
  uda: UdaItem;
  lessons: LessonItem[];
  onOpenLesson: (lesson: LessonItem) => void;
  organizing: boolean;
  reorderBusy: boolean;
  reorderError: string | null;
  onMoveLesson: (index: number, direction: -1 | 1) => void;
}) {
  return (
    <div>
      <h3 className={styles.sectionTitle}>{uda.dir}</h3>
      {uda.descrizione && <p className={styles.udaDescription}>{uda.descrizione}</p>}
      {uda.competenze.length > 0 && (
        <div className={styles.metaGroup}>
          <span className={styles.metaLabel}>Competenze</span>
          <MetadataList items={uda.competenze} />
        </div>
      )}
      {uda.obiettivi.length > 0 && (
        <div className={styles.metaGroup}>
          <span className={styles.metaLabel}>Obiettivi</span>
          <MetadataList items={uda.obiettivi} />
        </div>
      )}

      {lessons.length === 0 ? (
        <p className="state-empty">Nessuna lezione in questa UDA.</p>
      ) : (
        <>
          {organizing && reorderError && (
            <p role="alert" className="text-error">
              {reorderError}
            </p>
          )}
          <div className={styles.overviewPanel}>
            <table className={styles.dataTable}>
              <colgroup>
                <col className={styles.lessonTitleColumn} />
                <col className={styles.lessonStatusColumn} />
                <col className={styles.questionsColumn} />
                <col className={styles.orderColumn} />
              </colgroup>
              <thead>
                <tr>
                  <th>Lezione</th>
                  <th>Stato</th>
                  <th>Domande</th>
                  <th>{organizing ? 'Ordine' : <span className={styles.srOnly}>Apri</span>}</th>
                </tr>
              </thead>
              <tbody>
                {lessons.map((lesson, index) => {
                  const { title } = resolveLessonTitle(lesson.filename, lesson.titolo);
                  return (
                    <tr key={lesson.id}>
                      <td className={styles.titleCell}>
                        {organizing ? (
                          <span className={styles.rowStaticLabel}>{title}</span>
                        ) : (
                          <button
                            type="button"
                            className={styles.rowOpenBtn}
                            aria-label={`Apri lezione ${title}`}
                            onClick={() => onOpenLesson(lesson)}
                          >
                            {title}
                          </button>
                        )}
                      </td>
                      <td>{lesson.completed ? 'Svolta' : 'Da svolgere'}</td>
                      <td>{lesson.questionCount}</td>
                      <td className={styles.orderCell}>
                        {organizing ? (
                          <ReorderControls
                            label={title}
                            isFirst={index === 0}
                            isLast={index === lessons.length - 1}
                            disabled={reorderBusy}
                            onUp={() => onMoveLesson(index, -1)}
                            onDown={() => onMoveLesson(index, 1)}
                          />
                        ) : (
                          <span className={styles.rowAffordance} aria-hidden="true">
                            ›
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

// ── Lesson detail (lesson selected) ─────────────────────────────────────────

const LESSON_TABS: { id: LessonTab; label: string }[] = [
  { id: 'contenuto', label: 'Contenuto' },
  // CONCEPT-MAP-04 — la mappa segue il contenuto perché ne è la sintesi: si
  // legge dopo, mai al posto suo.
  { id: 'mappa', label: 'Mappa concettuale' },
  { id: 'domande', label: 'Domande' },
  { id: 'informazioni', label: 'Informazioni' },
];

function LessonDetail({
  lesson,
  metadata,
  content,
  loading,
  error,
  errorDetails,
  onRetryContent,
  activeTab,
  onSelectTab,
  domandeVisited,
  mappaVisited,
  programId,
  importId,
  ownerUid,
  onDirtyChange,
  onPoolCountChange,
  editingContent,
  editingInfo,
  contentStatus,
  infoStatus,
  onSaveContent,
  onSaveInfo,
  onCancelContent,
  onCancelInfo,
  onContentDirtyChange,
  onInfoDirtyChange,
  lessonAi,
  conceptMap,
  conceptMapBlockedReason,
  conceptMapCallables,
  onSaveConceptMap,
  onConceptMapDirtyChange,
  visualBlockedReason,
}: {
  lesson: LessonItem;
  metadata: LessonMetadata;
  content: string | null;
  loading: boolean;
  error: string | null;
  errorDetails: StorageErrorDetails | null;
  onRetryContent: () => void;
  activeTab: LessonTab;
  onSelectTab: (tab: LessonTab) => void;
  domandeVisited: boolean;
  mappaVisited: boolean;
  programId: string;
  importId: string | null;
  ownerUid: string;
  onDirtyChange: (dirty: boolean) => void;
  onPoolCountChange: (questionCount: number, poolStatus: PoolCountStatus) => void;
  editingContent: boolean;
  editingInfo: boolean;
  contentStatus: EditStatus;
  infoStatus: EditStatus;
  onSaveContent: (body: string) => void;
  onSaveInfo: (fields: LessonMetadata) => void;
  onCancelContent: () => void;
  onCancelInfo: () => void;
  onContentDirtyChange: (dirty: boolean) => void;
  onInfoDirtyChange: (dirty: boolean) => void;
  lessonAi: LessonAiButtonContext;
  conceptMap: string | null;
  conceptMapBlockedReason: string | null;
  conceptMapCallables: AiConceptMapCallables;
  onSaveConceptMap: (conceptMapMarkdown: string) => Promise<void>;
  onConceptMapDirtyChange: (dirty: boolean) => void;
  visualBlockedReason: string | null;
}) {
  const { title } = resolveLessonTitle(lesson.filename, metadata.titolo ?? lesson.titolo);

  /**
   * VE-04A — l'immagine della lezione, letta **solo** quando serve davvero.
   *
   * Due condizioni, entrambe necessarie: il `LessonDoc` dichiara un manifest, e
   * la scheda «Contenuto» è aperta. Una lezione senza immagine non produce
   * nessuna chiamata, e nemmeno una lezione con immagine di cui il docente stia
   * guardando le domande — i byte servono per mostrarli, non per averli.
   *
   * Nessuna lettura parte da una card, dall'albero laterale o da una lista:
   * quelle superfici hanno già il manifest e non mostrano figure.
   */
  const [reanchoring, setReanchoring] = useState(false);
  const [localVisual, setLocalVisual] = useState<LessonVisualPrivateManifest | null | undefined>(
    undefined,
  );
  const [visualDialogOpen, setVisualDialogOpen] = useState(false);
  const visualPorts = useMemo(() => createVisualWorkflowPorts(functions), []);
  const detailMounted = useRef(true);
  useEffect(() => {
    detailMounted.current = true;
    return () => {
      detailMounted.current = false;
    };
  }, []);

  // Cambio lezione: l'override locale del riancoraggio non deve sopravvivere
  // alla lezione su cui è stato applicato.
  useEffect(() => {
    setLocalVisual(undefined);
    setVisualDialogOpen(false);
    setReanchoring(false);
  }, [lesson.id]);

  const manifest = localVisual === undefined ? (lesson.visual ?? null) : localVisual;
  const contentOpen = activeTab === 'contenuto' && !editingContent;

  const visualRequest =
    manifest && contentOpen && importId
      ? { assetId: manifest.assetId, lessonKey: lesson.id }
      : null;

  const loadVisual = useCallback(async () => {
    if (!manifest || !importId) return null;
    const { createTeacherVisualReader } =
      await import('../repository/programs/visualReadClients.js');
    return createTeacherVisualReader(functions)({
      programId,
      importId,
      lessonId: lesson.id,
      manifest: { assetId: manifest.assetId, width: manifest.width, height: manifest.height },
    });
  }, [manifest, programId, importId, lesson.id]);

  const visualState = useLessonVisual(visualRequest, loadVisual);

  /**
   * Il manifest basta: la figura è montata subito, con lo spazio già riservato,
   * e l'avviso dell'ancora mancante compare senza aspettare i byte — è
   * un'informazione che si ha già, e farla arrivare in ritardo insieme
   * all'immagine sposterebbe il testo sotto gli occhi del docente.
   */
  const lessonVisual = manifest
    ? {
        anchorSlug: manifest.anchor.headingSlug,
        headingText: manifest.anchor.headingText,
        altText: manifest.altText,
        caption: manifest.caption,
        width: manifest.width,
        height: manifest.height,
        dataUri: visualState.status === 'ready' ? visualState.bytes.dataUri : null,
        status:
          visualState.status === 'ready'
            ? ('ready' as const)
            : visualState.status === 'unavailable'
              ? ('unavailable' as const)
              : ('loading' as const),
      }
    : null;

  /**
   * Gli heading realmente presenti nel corpo corrente: l'elenco del dialog
   * viene da qui e da nessun altro posto, così non può proporre una sezione
   * che il server rifiuterebbe.
   */
  const reanchorHeadings = useMemo(
    () =>
      content
        ? // Gli slug arrivano dal package condiviso, gli stessi che il server
          // ricalcolerà: l'elenco mostra ciò che il server accetterà, non una
          // approssimazione.
          assignLessonHeadingSlugs(
            parseLessonMarkdown(content).headings.map((heading) => ({
              text: heading.text,
              level: heading.level,
            })),
          )
        : [],
    [content],
  );

  const visualHeadings = useMemo(
    () =>
      reanchorHeadings
        .filter((heading) => heading.level === 2 || heading.level === 3)
        .map((heading, index) => ({ text: heading.text, index })),
    [reanchorHeadings],
  );
  const effectiveVisualBlockedReason =
    visualBlockedReason ??
    (visualHeadings.length === 0
      ? 'Aggiungi almeno un titolo H2 o H3 al contenuto salvato.'
      : visualDialogOpen
        ? 'Operazione visuale in corso.'
        : null);
  const visualProposalRequest = useMemo(
    () =>
      content && lessonAi.udaContext
        ? {
            kind: 'visual_proposal' as const,
            requestId: crypto.randomUUID(),
            modelProfile: 'quality' as const,
            titolo: lessonAi.titolo ?? '',
            sottotitolo: lessonAi.sottotitolo ?? null,
            difficolta: lessonAi.difficolta ?? '',
            concettiChiave: lessonAi.concettiChiave ?? [],
            obiettivi: lessonAi.obiettivi ?? [],
            udaTitle: lessonAi.udaTitle ?? '',
            udaContext: lessonAi.udaContext,
            lessonBody: content,
          }
        : null,
    [content, lessonAi],
  );

  async function refreshVisual() {
    if (!importId) return;
    const next = await readAuthoritativePrivateVisual({
      db,
      programId,
      importId,
      lessonId: lesson.id,
    });
    if (!detailMounted.current) return;
    setLocalVisual(next);
  }

  async function confirmReanchor(choice: { index: number; text: string }) {
    if (!importId || !manifest) return;
    const { createVisualReanchorClient } =
      await import('../repository/programs/visualReanchorClient.js');
    const result = await createVisualReanchorClient(functions)({
      programId,
      importId,
      lessonId: lesson.id,
      anchorHeadingText: choice.text,
      anchorHeadingIndex: choice.index,
    });
    // Aggiornamento locale: il manifest è cambiato solo nell'ancora, e i byte
    // sono gli stessi. Rileggere l'intero corso per una stringa sarebbe
    // sproporzionato — e farebbe sparire e riapparire la figura sotto gli occhi.
    setLocalVisual({
      ...manifest,
      anchor: {
        headingSlug: result.headingSlug,
        headingText: choice.text,
        placement: 'after-heading',
      },
    });
    setReanchoring(false);
  }

  // Local refs to the tab buttons so keyboard navigation can move real focus
  // (roving tabindex) without fragile global DOM queries.
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // Keyboard navigation across the tablist (←/→, Home/End): selects the tab
  // and moves focus to its button. Only the active tab keeps tabIndex 0.
  function onTabKeyDown(e: ReactKeyboardEvent) {
    const idx = LESSON_TABS.findIndex((t) => t.id === activeTab);
    let next = idx;
    if (e.key === 'ArrowRight') next = (idx + 1) % LESSON_TABS.length;
    else if (e.key === 'ArrowLeft') next = (idx - 1 + LESSON_TABS.length) % LESSON_TABS.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = LESSON_TABS.length - 1;
    else return;
    e.preventDefault();
    onSelectTab(LESSON_TABS[next]!.id);
    tabRefs.current[next]?.focus();
  }

  return (
    <div>
      <div className={styles.lessonHead}>
        <h3 className={`${styles.sectionTitle} ${styles.lessonMainTitle}`}>
          {title}
          {lesson.completed && (
            <span
              className={styles.lessonMainCompleted}
              role="img"
              aria-label="Lezione svolta"
              title="Lezione svolta"
            >
              <IconFileCheck size={17} />
            </span>
          )}
        </h3>
        {metadata.sottotitolo && <p className={styles.lessonSubtitle}>{metadata.sottotitolo}</p>}
      </div>

      <div className={styles.tablist} role="tablist" aria-label="Schede lezione">
        {LESSON_TABS.map((t, i) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`tab-${t.id}`}
            ref={(el) => {
              tabRefs.current[i] = el;
            }}
            aria-selected={activeTab === t.id}
            aria-controls={`panel-${t.id}`}
            tabIndex={activeTab === t.id ? 0 : -1}
            className={`${styles.tab}${activeTab === t.id ? ` ${styles.tabActive}` : ''}`}
            onClick={() => onSelectTab(t.id)}
            onKeyDown={onTabKeyDown}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div
        role="tabpanel"
        id="panel-contenuto"
        aria-labelledby="tab-contenuto"
        hidden={activeTab !== 'contenuto'}
      >
        {activeTab === 'contenuto' && (
          <div className={styles.visualActions}>
            <button
              type="button"
              className="btn-secondary"
              disabled={effectiveVisualBlockedReason !== null}
              aria-describedby={
                effectiveVisualBlockedReason ? `visual-disabled-${lesson.id}` : undefined
              }
              onClick={() => setVisualDialogOpen(true)}
            >
              {manifest ? 'Gestisci immagine' : 'Arricchisci visivamente'}
            </button>
            {effectiveVisualBlockedReason && (
              <span id={`visual-disabled-${lesson.id}`} className={styles.disabledReason}>
                {effectiveVisualBlockedReason}
              </span>
            )}
          </div>
        )}
        {editingContent ? (
          // Mounted whenever editing (even if the tab is hidden) so the draft
          // survives switching to another tab of the same lesson.
          <MarkdownBodyEditor
            initial={content ?? ''}
            status={contentStatus}
            onSave={onSaveContent}
            onCancel={onCancelContent}
            onDirtyChange={onContentDirtyChange}
            lessonAi={lessonAi}
          />
        ) : (
          activeTab === 'contenuto' && (
            <>
              {loading && (
                <p aria-busy="true" className="state-loading">
                  Caricamento contenuto…
                </p>
              )}
              {error && (
                <div role="alert" className={styles.lessonErrorBox}>
                  <p className="text-error">{error}</p>
                  <div className={styles.lessonErrorActions}>
                    <button type="button" className="btn-secondary" onClick={onRetryContent}>
                      Riprova
                    </button>
                  </div>
                  {errorDetails && (
                    <details className={styles.lessonErrorDetails}>
                      <summary>Dettagli tecnici</summary>
                      <dl className={styles.lessonErrorDl}>
                        {storageErrorDetailLines(errorDetails).map((row) => (
                          <div key={row.label}>
                            <dt>{row.label}</dt>
                            <dd>{row.value}</dd>
                          </div>
                        ))}
                      </dl>
                    </details>
                  )}
                </div>
              )}
              {!loading && !error && content !== null && content.trim() === '' && (
                <p className="state-empty">Nessun contenuto disponibile per questa lezione.</p>
              )}
              {/*
                LESSON-MANUAL-01 — la sola vista lezione del docente adotta la
                variante «manuale». Titolo e sottotitolo restano dove sono, nella
                testata della vista: il renderer non li ripete.
              */}
              {!loading && !error && content !== null && content.trim() !== '' && (
                <MarkdownRenderer
                  markdown={content}
                  variant="lesson"
                  visual={lessonVisual}
                  onMissingAnchor={
                    manifest ? (
                      <LessonVisualAnchorNotice
                        headingText={manifest.anchor.headingText}
                        onReanchor={() => setReanchoring(true)}
                      />
                    ) : null
                  }
                />
              )}
              {visualDialogOpen && visualProposalRequest && importId && (
                <LessonVisualWorkflowDialog
                  proposalRequest={visualProposalRequest}
                  identity={{ programId, importId, lessonId: lesson.id }}
                  headings={visualHeadings}
                  currentManifest={manifest}
                  currentDataUri={visualState.status === 'ready' ? visualState.bytes.dataUri : null}
                  ports={visualPorts}
                  onRefresh={refreshVisual}
                  onClose={() => setVisualDialogOpen(false)}
                />
              )}
              {reanchoring && manifest && (
                <LessonVisualReanchorDialog
                  headings={reanchorHeadings}
                  currentAnchorSlug={manifest.anchor.headingSlug}
                  onCancel={() => setReanchoring(false)}
                  onConfirm={confirmReanchor}
                />
              )}
            </>
          )
        )}
      </div>

      <div
        role="tabpanel"
        id="panel-mappa"
        aria-labelledby="tab-mappa"
        hidden={activeTab !== 'mappa'}
      >
        {/*
          CONCEPT-MAP-04 — montato alla prima apertura e mantenuto montato:
          passare a un'altra scheda della stessa lezione non deve perdere una
          proposta pagata né una modifica manuale. Il montaggio non costa nulla
          — nessuna callable parte da solo — e la chiave lega lo stato alla
          lezione, così cambiare lezione riparte da zero invece di trascinarsi
          dietro il testo della precedente.
        */}
        {mappaVisited && (
          <ConceptMapEditor
            key={lesson.id}
            lessonBody={content}
            initialConceptMap={conceptMap}
            blockedReason={conceptMapBlockedReason}
            callables={conceptMapCallables}
            onSave={onSaveConceptMap}
            onDirtyChange={onConceptMapDirtyChange}
          />
        )}
      </div>

      <div
        role="tabpanel"
        id="panel-domande"
        aria-labelledby="tab-domande"
        hidden={activeTab !== 'domande'}
      >
        {/* Lazy: mounted only once the Domande tab has been opened, then kept
            mounted across tab switches so the pool is read once per lesson. */}
        {domandeVisited && (
          <QuestionPoolEditor
            programId={programId}
            importId={importId}
            lesson={lesson}
            ownerUid={ownerUid}
            lessonSource={content}
            onDirtyChange={onDirtyChange}
            onPoolCountChange={onPoolCountChange}
          />
        )}
      </div>

      <div
        role="tabpanel"
        id="panel-informazioni"
        aria-labelledby="tab-informazioni"
        hidden={activeTab !== 'informazioni'}
      >
        {editingInfo ? (
          <LessonMetadataForm
            initial={metadata}
            status={infoStatus}
            onSave={onSaveInfo}
            onCancel={onCancelInfo}
            onDirtyChange={onInfoDirtyChange}
          />
        ) : (
          activeTab === 'informazioni' && <LessonInfo metadata={metadata} />
        )}
      </div>
    </div>
  );
}

// ── Lesson "Informazioni" tab: only metadata actually present ────────────────

function LessonInfo({ metadata }: { metadata: LessonMetadata }) {
  const hasAny =
    Boolean(metadata.titolo) ||
    Boolean(metadata.sottotitolo) ||
    Boolean(metadata.difficolta) ||
    metadata.concettiChiave.length > 0 ||
    metadata.obiettivi.length > 0;

  return (
    <div>
      {!hasAny ? (
        <p className="state-empty">Nessun metadato per questa lezione.</p>
      ) : (
        <dl className={styles.infoList}>
          {metadata.titolo && (
            <>
              <dt>Titolo</dt>
              <dd>{metadata.titolo}</dd>
            </>
          )}
          {metadata.sottotitolo && (
            <>
              <dt>Sottotitolo</dt>
              <dd>{metadata.sottotitolo}</dd>
            </>
          )}
          {metadata.difficolta && (
            <>
              <dt>Difficoltà</dt>
              <dd>{metadata.difficolta}</dd>
            </>
          )}
          {metadata.concettiChiave.length > 0 && (
            <>
              <dt>Concetti chiave</dt>
              <dd>
                <MetadataList items={metadata.concettiChiave} />
              </dd>
            </>
          )}
          {metadata.obiettivi.length > 0 && (
            <>
              <dt>Obiettivi</dt>
              <dd>
                <MetadataList items={metadata.obiettivi} />
              </dd>
            </>
          )}
        </dl>
      )}
    </div>
  );
}
