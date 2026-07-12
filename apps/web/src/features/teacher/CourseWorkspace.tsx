import {
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { db, storage } from '../../lib/firebase.js';
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
import { resolveLessonTitle } from '../repository/programs/lessonTitle.js';
import {
  EMPTY_LESSON_METADATA,
  parseLessonMetadata,
} from '../repository/validation/lessonMetadata.js';
import type { LessonMetadata } from '../repository/validation/types.js';
import { fetchLessonContent } from './lessonContent.js';
import { downloadLessonPdf } from './lessonPdf.js';
import { MarkdownRenderer } from './MarkdownRenderer.js';
import { QuestionPoolEditor, type PoolCountStatus } from './QuestionPoolEditor.js';
import { MarkdownBodyEditor, LessonMetadataForm, type EditStatus } from './lessonEditors.js';
import { exportZip } from './exportZip.js';
import { downloadMarkdown, downloadPdf, generateMarkdown } from './programmaSvolto.js';
import { describeImportValidationError } from './importValidationMessage.js';
import {
  ClassesDialog,
  ConfirmDialog,
  ImportIntoCourseDialog,
  NewLessonDialog,
  NewUdaDialog,
  ProgramInfoDialog,
  TitleDialog,
  UdaMetadataDialog,
  type NewLessonValues,
  type UdaMetadataValues,
} from './workspaceDialogs.js';
import styles from './CourseWorkspace.module.css';

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

type LessonTab = 'contenuto' | 'domande' | 'informazioni';

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
  const [udaBlockers, setUdaBlockers] = useState<RepositoryDeleteBlocker[] | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  const [selection, setSelection] = useState<Selection>({ kind: 'course' });
  const [collapsedUdas, setCollapsedUdas] = useState<Set<string>>(new Set());
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // Lesson content is loaded on demand, only when a lesson is selected.
  const [lessonContent, setLessonContent] = useState<string | null>(null);
  const [lessonMetadata, setLessonMetadata] = useState<LessonMetadata>(EMPTY_LESSON_METADATA);
  const [lessonLoading, setLessonLoading] = useState(false);
  const [lessonError, setLessonError] = useState<string | null>(null);
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
  const [infoStatus, setInfoStatus] = useState<EditStatus>(NO_STATUS);
  const [completedBusy, setCompletedBusy] = useState(false);
  const [completedError, setCompletedError] = useState<string | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
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

  const anyDirty = poolDirty || contentDirty || infoDirty;

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
        if (!cancelled) setTree({ udas: [], lessons: [] });
        return;
      }
      try {
        const [udas, lessons] = await Promise.all([
          listUdas(card.programId, card.activeImportId, db),
          listLessons(card.programId, card.activeImportId, db),
        ]);
        if (!cancelled) setTree({ udas, lessons });
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
    setContentStatus(NO_STATUS);
    setInfoStatus(NO_STATUS);
  }

  function selectTab(tab: LessonTab) {
    setActiveTab(tab);
    if (tab === 'domande') setDomandeVisited(true);
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
    setPoolDirty(false);
    setEditingContent(false);
    setEditingInfo(false);
    setContentDirty(false);
    setInfoDirty(false);
    setContentStatus(NO_STATUS);
    setInfoStatus(NO_STATUS);
    setCompletedError(null);
    setPdfError(null);
    setLessonContent(null);
    setLessonMetadata(EMPTY_LESSON_METADATA);
    setLessonError(null);
    setLessonLoading(true);
    try {
      const raw = await fetchLessonContent(lesson.storageRef, storage);
      const { metadata, body } = parseLessonMetadata(raw);
      if (lessonRequestRef.current !== requestId) return; // superseded
      setLessonMetadata(metadata);
      setLessonContent(body);
    } catch {
      if (lessonRequestRef.current !== requestId) return; // superseded
      setLessonError('Impossibile caricare il contenuto della lezione.');
    } finally {
      if (lessonRequestRef.current === requestId) setLessonLoading(false);
    }
  }

  // Close the toolbar menu on any outside click, and whenever the selection
  // changes (course ⇄ UDA ⇄ lesson) so it never lingers over a new context.
  useEffect(() => {
    if (!menuOpen) return;
    function onDocClick() {
      setMenuOpen(false);
    }
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, [menuOpen]);
  useEffect(() => {
    setMenuOpen(false);
    setOrganizing(false);
    setReorderError(null);
    if (selection.kind !== 'lesson') currentLessonRef.current = null;
  }, [selection]);

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
    void withBusy(async () => {
      try {
        const files = await readZipFile(file);
        const result = await importRepository(
          { ownerUid, programmaTitle: card.title, programId: card.programId, files },
          { db, storage },
        );
        if (!mountedRef.current) return;
        if (result.status === 'validation_failed') {
          setWsError(describeImportValidationError(result.validationIssues));
          return;
        }
        // Structure fully changed: reload only this course's metadata + tree by
        // patching the card's active import (the tree effect reloads UDA/lezioni).
        const meta = await getImportMeta(card.programId, result.importId, db);
        if (!mountedRef.current) return;
        onCardPatch?.(card.programId, {
          activeImportId: result.importId,
          hasImport: true,
          udaCount: result.udaCount,
          lessonsTotal: result.lessonCount,
          lessonsDone: 0,
          questionsTotal: result.questionCount,
          annoScolastico: meta?.annoScolastico ?? null,
        });
        setSelection({ kind: 'course' });
        closeDialog();
      } catch (err) {
        if (mountedRef.current)
          setWsError(err instanceof Error ? err.message : "Errore durante l'importazione.");
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
    void withBusy(async () => {
      try {
        await deleteProgram(card.programId, ownerUid, db, storage);
        if (!mountedRef.current) return;
        onCourseDeleted?.(card.programId);
      } catch (err) {
        if (mountedRef.current)
          setWsError(err instanceof Error ? err.message : 'Impossibile eliminare il corso.');
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
    const meta = card.activeImportId
      ? await getImportMeta(card.programId, card.activeImportId, db).catch(() => null)
      : null;
    const content = generateMarkdown(cardToProgram(card), tree.udas, tree.lessons, meta);
    const base = `programma-svolto-${card.title.replace(/\s+/g, '_')}`;
    if (format === 'md') downloadMarkdown(content, `${base}.md`);
    else await downloadPdf(content, base);
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
        await deleteUda({ programId: card.programId, importId, udaId, ownerUid, db, storage });
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

  function handleToggleCompleted(lesson: LessonItem) {
    if (!card.activeImportId) return;
    const importId = card.activeImportId;
    const next = !(lesson.completed ?? false);
    setCompletedBusy(true);
    setCompletedError(null);
    void (async () => {
      try {
        await setLessonCompleted(card.programId, importId, lesson.id, next, ownerUid, db);
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

  async function handleDownloadLessonPdf(lesson: LessonItem) {
    if (lessonContent == null) return;
    setPdfBusy(true);
    setPdfError(null);
    try {
      const context = `${card.title} - ${lesson.udaDir}`;
      const { title } = resolveLessonTitle(lesson.filename, lessonMetadata.titolo ?? lesson.titolo);
      await downloadLessonPdf(title, lessonContent, context, lessonMetadata);
    } catch {
      if (mountedRef.current) setPdfError('Impossibile generare il PDF della lezione.');
    } finally {
      if (mountedRef.current) setPdfBusy(false);
    }
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

  // Back button: while organizing, it first leaves Organize (never navigates
  // away with residual state). On mobile it steps up exactly one level; on
  // desktop it always returns to the library (the sidebar handles the rest).
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
  const backLabel = organizing
    ? 'Esci da Organizza'
    : isMobile && selection.kind !== 'course'
      ? '← Indietro'
      : '← Libreria';
  const backRun = organizing ? exitOrganize : isMobile ? goUpOneLevel : () => guardedNav(onBack);

  return (
    <section aria-label={`Corso — ${card.title}`} className={styles.workspace}>
      <header className={styles.header}>
        <button type="button" className={styles.backBtn} onClick={backRun}>
          {backLabel}
        </button>
        <h2 className={styles.title}>{card.title}</h2>
      </header>

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

      <div
        className={`${styles.body}${sidebarCollapsed && !isMobile ? ` ${styles.bodyCollapsed}` : ''}`}
      >
        {/* Mobile: no sidebar at all — single-level progressive navigation. */}
        {isMobile ? null : sidebarCollapsed ? (
          <button
            type="button"
            className={styles.sidebarExpand}
            aria-label="Espandi struttura corso"
            title="Espandi struttura corso"
            onClick={() => setSidebarCollapsed(false)}
          >
            ▸
          </button>
        ) : (
          <nav className={styles.sidebar} aria-label="Struttura corso">
            <div className={styles.sidebarHead}>
              <button
                type="button"
                className={`${styles.overviewBtn}${selection.kind === 'course' ? ` ${styles.selected}` : ''}`}
                aria-current={selection.kind === 'course' ? 'true' : undefined}
                onClick={() => guardedNav(() => setSelection({ kind: 'course' }))}
              >
                Panoramica corso
              </button>
              <button
                type="button"
                className={styles.collapseBtn}
                aria-label="Comprimi struttura corso"
                title="Comprimi struttura corso"
                onClick={() => setSidebarCollapsed(true)}
              >
                ◂
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
                            guardedNav(() => setSelection({ kind: 'uda', udaDir: uda.dir }))
                          }
                        >
                          {uda.dir}
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
                                  aria-current={active ? 'true' : undefined}
                                  onClick={() => guardedNav(() => void selectLesson(lesson))}
                                >
                                  {lesson.completed && (
                                    <span className={styles.doneDot} aria-hidden="true">
                                      ●
                                    </span>
                                  )}
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
                  className={styles.toolbarMenuBtn}
                  aria-haspopup="true"
                  aria-expanded={menuOpen}
                  aria-label="Azioni corso"
                  onClick={() => setMenuOpen((o) => !o)}
                >
                  Azioni corso ▾
                </button>
                {menuOpen && (
                  <div className={styles.menu} role="menu">
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => openDialog({ kind: 'renameCourse' })}
                    >
                      Modifica titolo
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => openDialog({ kind: 'importCourse' })}
                    >
                      Importa ZIP
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      disabled={!card.hasImport}
                      onClick={() => void handleExportZip()}
                    >
                      Esporta ZIP
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      disabled={!card.hasImport}
                      onClick={() => void handleProgrammaSvolto('md')}
                    >
                      Programma svolto (MD)
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      disabled={!card.hasImport}
                      onClick={() => void handleProgrammaSvolto('pdf')}
                    >
                      Programma svolto (PDF)
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => openDialog({ kind: 'classes' })}
                    >
                      Classi assegnate
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => openDialog({ kind: 'info' })}
                    >
                      Informazioni
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className={styles.menuDanger}
                      onClick={() => openDialog({ kind: 'deleteCourse' })}
                    >
                      Elimina corso
                    </button>
                  </div>
                )}
              </div>
              {card.hasImport && tree && tree.udas.length > 1 && (
                <button type="button" onClick={enterOrganize}>
                  Organizza UDA
                </button>
              )}
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
              <button
                type="button"
                className="btn-success"
                onClick={() => openDialog({ kind: 'newLesson' })}
              >
                + Nuova lezione
              </button>
              <button type="button" onClick={() => openDialog({ kind: 'newUda' })}>
                + Nuova UDA
              </button>
              <div className={styles.menuWrap}>
                <button
                  type="button"
                  className={styles.toolbarMenuBtn}
                  aria-haspopup="true"
                  aria-expanded={menuOpen}
                  aria-label="Azioni UDA"
                  onClick={() => setMenuOpen((o) => !o)}
                >
                  Azioni UDA ▾
                </button>
                {menuOpen && (
                  <div className={styles.menu} role="menu">
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => openDialog({ kind: 'editUda', udaId: selectedUda.id })}
                    >
                      Modifica metadata
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className={styles.menuDanger}
                      onClick={() => openDialog({ kind: 'deleteUda', udaId: selectedUda.id })}
                    >
                      Elimina UDA
                    </button>
                  </div>
                )}
              </div>
              {(lessonsByUda.get(selectedUda.dir) ?? []).length > 1 && (
                <button type="button" onClick={enterOrganize}>
                  Organizza lezioni
                </button>
              )}
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
            <div className={styles.toolbar}>
              <button
                type="button"
                onClick={() => {
                  selectTab('contenuto');
                  setEditingContent(true);
                  setContentStatus(NO_STATUS);
                }}
                disabled={editingContent || lessonContent == null}
              >
                Modifica contenuto
              </button>
              <button
                type="button"
                onClick={() => {
                  selectTab('informazioni');
                  setEditingInfo(true);
                  setInfoStatus(NO_STATUS);
                }}
                disabled={editingInfo || lessonContent == null}
              >
                Modifica informazioni
              </button>
              <button
                type="button"
                onClick={() => void handleDownloadLessonPdf(selectedLesson)}
                disabled={pdfBusy || lessonContent == null}
              >
                {pdfBusy ? 'PDF…' : 'Scarica PDF'}
              </button>
              <button
                type="button"
                onClick={() => handleToggleCompleted(selectedLesson)}
                disabled={completedBusy}
                aria-pressed={selectedLesson.completed ?? false}
              >
                {selectedLesson.completed ? 'Segna non svolta' : 'Segna svolta'}
              </button>
              <div className={styles.menuWrap}>
                <button
                  type="button"
                  className={styles.toolbarMenuBtn}
                  aria-haspopup="true"
                  aria-expanded={menuOpen}
                  aria-label="Azioni lezione"
                  onClick={() => setMenuOpen((o) => !o)}
                >
                  ⋯
                </button>
                {menuOpen && (
                  <div className={styles.menu} role="menu">
                    <button
                      type="button"
                      role="menuitem"
                      className={styles.menuDanger}
                      onClick={() =>
                        openDialog({ kind: 'deleteLesson', lessonId: selectedLesson.id })
                      }
                    >
                      Elimina lezione
                    </button>
                  </div>
                )}
              </div>
              {contentStatus.saved && <span className={styles.savedNote}>Contenuto salvato</span>}
              {infoStatus.saved && <span className={styles.savedNote}>Informazioni salvate</span>}
              {completedError && (
                <span role="alert" className="text-error">
                  {completedError}
                </span>
              )}
              {pdfError && (
                <span role="alert" className="text-error">
                  {pdfError}
                </span>
              )}
            </div>
          )}
          {selection.kind === 'lesson' && selectedLesson && (
            <LessonDetail
              lesson={selectedLesson}
              metadata={lessonMetadata}
              content={lessonContent}
              loading={lessonLoading}
              error={lessonError}
              activeTab={activeTab}
              onSelectTab={selectTab}
              domandeVisited={domandeVisited}
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
          counts={{
            udaCount: tree?.udas.length ?? card.udaCount,
            lessonsDone: tree?.lessons.filter((l) => l.completed).length ?? card.lessonsDone,
            lessonsTotal: tree?.lessons.length ?? card.lessonsTotal,
            questionsTotal,
          }}
          classNames={card.classNames}
          onClose={closeDialog}
        />
      )}
      {wsDialog.kind === 'deleteCourse' && (
        <ConfirmDialog
          title="Elimina corso"
          message={`Eliminare definitivamente "${card.title}"? Verranno rimossi import, UDA, lezioni, pool e file caricati. L'operazione non è reversibile.`}
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
      <p className={styles.contextLabel}>Panoramica corso</p>
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
          <table className={styles.dataTable}>
            <thead>
              <tr>
                <th>UDA</th>
                <th>Lezioni svolte</th>
                {organizing && <th>Ordine</th>}
              </tr>
            </thead>
            <tbody>
              {tree.udas.map((uda, index) => {
                const udaLessons = lessonsByUda.get(uda.dir) ?? [];
                const done = udaLessons.filter((l) => l.completed).length;
                return (
                  <tr key={uda.id}>
                    <td>
                      {organizing ? (
                        uda.dir
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
                    {organizing && (
                      <td>
                        <ReorderControls
                          label={uda.dir}
                          isFirst={index === 0}
                          isLast={index === tree.udas.length - 1}
                          disabled={reorderBusy}
                          onUp={() => onMoveUda(index, -1)}
                          onDown={() => onMoveUda(index, 1)}
                        />
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

// ── UDA overview (UDA selected) ─────────────────────────────────────────────

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
      <p className={styles.contextLabel}>UDA</p>
      <h3 className={styles.sectionTitle}>{uda.dir}</h3>
      {uda.descrizione && <p className={styles.udaDescription}>{uda.descrizione}</p>}
      {uda.competenze.length > 0 && (
        <div className={styles.metaGroup}>
          <span className={styles.metaLabel}>Competenze</span>
          <ul className={styles.metaList}>
            {uda.competenze.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </div>
      )}
      {uda.obiettivi.length > 0 && (
        <div className={styles.metaGroup}>
          <span className={styles.metaLabel}>Obiettivi</span>
          <ul className={styles.metaList}>
            {uda.obiettivi.map((o) => (
              <li key={o}>{o}</li>
            ))}
          </ul>
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
          <table className={styles.dataTable}>
            <thead>
              <tr>
                <th>Lezione</th>
                <th>Stato</th>
                <th>Domande</th>
                {organizing && <th>Ordine</th>}
              </tr>
            </thead>
            <tbody>
              {lessons.map((lesson, index) => {
                const { title } = resolveLessonTitle(lesson.filename, lesson.titolo);
                return (
                  <tr key={lesson.id}>
                    <td>
                      {organizing ? (
                        title
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
                    {organizing && (
                      <td>
                        <ReorderControls
                          label={title}
                          isFirst={index === 0}
                          isLast={index === lessons.length - 1}
                          disabled={reorderBusy}
                          onUp={() => onMoveLesson(index, -1)}
                          onDown={() => onMoveLesson(index, 1)}
                        />
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

// ── Lesson detail (lesson selected) ─────────────────────────────────────────

const LESSON_TABS: { id: LessonTab; label: string }[] = [
  { id: 'contenuto', label: 'Contenuto' },
  { id: 'domande', label: 'Domande' },
  { id: 'informazioni', label: 'Informazioni' },
];

function LessonDetail({
  lesson,
  metadata,
  content,
  loading,
  error,
  activeTab,
  onSelectTab,
  domandeVisited,
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
}: {
  lesson: LessonItem;
  metadata: LessonMetadata;
  content: string | null;
  loading: boolean;
  error: string | null;
  activeTab: LessonTab;
  onSelectTab: (tab: LessonTab) => void;
  domandeVisited: boolean;
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
}) {
  const { title } = resolveLessonTitle(lesson.filename, metadata.titolo ?? lesson.titolo);

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
      <p className={styles.contextLabel}>Lezione</p>
      <div className={styles.lessonHead}>
        <h3 className={styles.sectionTitle}>{title}</h3>
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
        {editingContent ? (
          // Mounted whenever editing (even if the tab is hidden) so the draft
          // survives switching to another tab of the same lesson.
          <MarkdownBodyEditor
            initial={content ?? ''}
            status={contentStatus}
            onSave={onSaveContent}
            onCancel={onCancelContent}
            onDirtyChange={onContentDirtyChange}
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
                <p role="alert" className="text-error">
                  {error}
                </p>
              )}
              {!loading && !error && content !== null && content.trim() === '' && (
                <p className="state-empty">Nessun contenuto disponibile per questa lezione.</p>
              )}
              {!loading && !error && content !== null && content.trim() !== '' && (
                <MarkdownRenderer markdown={content} />
              )}
            </>
          )
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
          activeTab === 'informazioni' && <LessonInfo lesson={lesson} metadata={metadata} />
        )}
      </div>
    </div>
  );
}

// ── Lesson "Informazioni" tab: only metadata actually present ────────────────

function LessonInfo({ lesson, metadata }: { lesson: LessonItem; metadata: LessonMetadata }) {
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
              <dd>{metadata.concettiChiave.join(', ')}</dd>
            </>
          )}
          {metadata.obiettivi.length > 0 && (
            <>
              <dt>Obiettivi</dt>
              <dd>{metadata.obiettivi.join(', ')}</dd>
            </>
          )}
        </dl>
      )}

      <details className={styles.infoTechnical}>
        <summary>Dettagli tecnici</summary>
        <dl className={styles.infoList}>
          <dt>File</dt>
          <dd>{lesson.path}</dd>
        </dl>
      </details>
    </div>
  );
}
