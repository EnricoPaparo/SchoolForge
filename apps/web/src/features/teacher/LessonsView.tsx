import { useEffect, useState } from 'react';
import {
  listLessons,
  listPrograms,
  listUdas,
  type LessonItem,
  type ProgramItem,
  type UdaItem,
} from '../repository/programs/programsService.js';
import { resolveLessonTitle } from '../repository/programs/lessonTitle.js';
import {
  EMPTY_LESSON_METADATA,
  parseLessonMetadata,
} from '../repository/validation/lessonMetadata.js';
import type { LessonMetadata } from '../repository/validation/types.js';
import {
  createLesson,
  createUda,
  deleteLesson,
  deleteUda,
  reorderLesson,
  reorderUda,
  RepositoryDeleteBlockedError,
  updateLessonMarkdownBody,
  updateLessonMetadata,
} from '../repository/editor/repositoryEditorService.js';
import type { RepositoryDeleteBlocker } from '../repository/editor/repositoryEditorGuards.js';
import { useAuth } from '../../lib/auth.js';
import { db, storage } from '../../lib/firebase.js';
import { fetchLessonContent } from './lessonContent.js';
import { downloadLessonPdf } from './lessonPdf.js';
import { MarkdownRenderer } from './MarkdownRenderer.js';
import styles from './LessonsView.module.css';

function linesToArray(value: string): string[] {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

const IMPORT_HINT = 'Importa prima uno ZIP da Corsi per vedere le lezioni.';

const VERIFICATION_STATUS_LABELS: Record<RepositoryDeleteBlocker['status'], string> = {
  draft: 'bozza',
  active: 'attiva',
  closed: 'chiusa',
};

function udaOrderOrLegacy(uda: UdaItem): number {
  if (uda.order !== undefined) return uda.order;
  const match = /^uda-(\d+)(?:-|$)/.exec(uda.dir);
  return match ? Number(match[1]) - 1 : Number.MAX_SAFE_INTEGER;
}

function sortUdas(udas: UdaItem[]): UdaItem[] {
  return [...udas].sort(
    (a, b) => udaOrderOrLegacy(a) - udaOrderOrLegacy(b) || a.dir.localeCompare(b.dir),
  );
}

function lessonOrderOrLegacy(lesson: LessonItem): number {
  if (lesson.order !== undefined) return lesson.order;
  const match = /^lezione-(\d+)(?:-|\.md$)/.exec(lesson.filename);
  return match ? Number(match[1]) - 1 : Number.MAX_SAFE_INTEGER;
}

function sortLessons(lessons: LessonItem[]): LessonItem[] {
  return [...lessons].sort(
    (a, b) =>
      a.udaDir.localeCompare(b.udaDir) ||
      lessonOrderOrLegacy(a) - lessonOrderOrLegacy(b) ||
      a.filename.localeCompare(b.filename),
  );
}

type CourseTreeState = {
  udas: UdaItem[] | null;
  lessons: LessonItem[] | null;
  error?: string;
};

export function LessonsView() {
  const { user } = useAuth();
  const ownerUid = user?.uid ?? '';

  const [programs, setPrograms] = useState<ProgramItem[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reorderMode, setReorderMode] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const [courseTree, setCourseTree] = useState<Record<string, CourseTreeState>>({});
  const [expandedCourses, setExpandedCourses] = useState<Set<string>>(new Set());
  const [expandedUdas, setExpandedUdas] = useState<Set<string>>(new Set());

  const [selectedProgram, setSelectedProgram] = useState<ProgramItem | null>(null);
  const [selectedLesson, setSelectedLesson] = useState<LessonItem | null>(null);
  const [lessonContent, setLessonContent] = useState<string | null>(null);
  const [lessonMetadata, setLessonMetadata] = useState<LessonMetadata>(EMPTY_LESSON_METADATA);
  const [lessonContentLoading, setLessonContentLoading] = useState(false);
  const [lessonContentError, setLessonContentError] = useState<string | null>(null);
  const [pdfDownloading, setPdfDownloading] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);

  // ── Lesson metadata editor (RE-01) ──────────────────────────────
  const [editingLessonMetadata, setEditingLessonMetadata] = useState(false);
  const [editTitolo, setEditTitolo] = useState('');
  const [editSottotitolo, setEditSottotitolo] = useState('');
  const [editDifficolta, setEditDifficolta] = useState('');
  const [editConcettiChiave, setEditConcettiChiave] = useState('');
  const [editObiettivi, setEditObiettivi] = useState('');
  const [savingLessonMetadata, setSavingLessonMetadata] = useState(false);
  const [lessonMetadataSaveError, setLessonMetadataSaveError] = useState<string | null>(null);

  // ── Lesson body editor (RE-02) ──────────────────────────────────
  const [editingLessonBody, setEditingLessonBody] = useState(false);
  const [bodyDraft, setBodyDraft] = useState('');
  const [bodyEditorTab, setBodyEditorTab] = useState<'editor' | 'preview'>('editor');
  const [savingLessonBody, setSavingLessonBody] = useState(false);
  const [lessonBodySaveError, setLessonBodySaveError] = useState<string | null>(null);

  // ── New lesson creation (RE-03A) ────────────────────────────────
  const [creatingLessonUdaKey, setCreatingLessonUdaKey] = useState<string | null>(null);
  const [newLessonTitolo, setNewLessonTitolo] = useState('');
  const [newLessonSottotitolo, setNewLessonSottotitolo] = useState('');
  const [newLessonDifficolta, setNewLessonDifficolta] = useState('');
  const [newLessonConcettiChiave, setNewLessonConcettiChiave] = useState('');
  const [newLessonObiettivi, setNewLessonObiettivi] = useState('');
  const [newLessonBody, setNewLessonBody] = useState('');
  const [savingNewLesson, setSavingNewLesson] = useState(false);
  const [createLessonError, setCreateLessonError] = useState<string | null>(null);

  // ── New UDA creation (RE-03B) ────────────────────────────────────
  const [creatingUdaProgramId, setCreatingUdaProgramId] = useState<string | null>(null);
  const [newUdaTitolo, setNewUdaTitolo] = useState('');
  const [newUdaDescrizione, setNewUdaDescrizione] = useState('');
  const [newUdaCompetenze, setNewUdaCompetenze] = useState('');
  const [newUdaObiettivi, setNewUdaObiettivi] = useState('');
  const [savingNewUda, setSavingNewUda] = useState(false);
  const [createUdaError, setCreateUdaError] = useState<string | null>(null);

  // ── UDA/lesson reorder (RE-04) ───────────────────────────────────
  const [busyUdaIds, setBusyUdaIds] = useState<Set<string>>(new Set());
  const [udaReorderError, setUdaReorderError] = useState<{
    udaId: string;
    message: string;
  } | null>(null);
  const [busyLessonIds, setBusyLessonIds] = useState<Set<string>>(new Set());
  const [lessonReorderError, setLessonReorderError] = useState<{
    lessonId: string;
    message: string;
  } | null>(null);

  // ── Protected UDA/lesson deletion (RE-05) ───────────────────────
  const [deleteConfirmUdaId, setDeleteConfirmUdaId] = useState<string | null>(null);
  const [deletingUdaId, setDeletingUdaId] = useState<string | null>(null);
  const [udaDeleteError, setUdaDeleteError] = useState<{
    udaId: string;
    message: string;
  } | null>(null);
  const [udaDeleteBlockers, setUdaDeleteBlockers] = useState<{
    udaId: string;
    blockers: RepositoryDeleteBlocker[];
  } | null>(null);

  const [deleteConfirmLessonId, setDeleteConfirmLessonId] = useState<string | null>(null);
  const [deletingLessonId, setDeletingLessonId] = useState<string | null>(null);
  const [lessonDeleteError, setLessonDeleteError] = useState<{
    lessonId: string;
    message: string;
  } | null>(null);
  const [lessonDeleteBlockers, setLessonDeleteBlockers] = useState<{
    lessonId: string;
    blockers: RepositoryDeleteBlocker[];
  } | null>(null);

  useEffect(() => {
    void loadPrograms();
  }, []);

  async function loadPrograms() {
    setLoadError(null);
    try {
      const list = await listPrograms(db);
      setPrograms(list);
    } catch {
      setLoadError('Impossibile caricare i programmi.');
    }
  }

  async function loadCourseTree(program: ProgramItem) {
    if (!program.activeImportId) return;
    const importId = program.activeImportId;
    setCourseTree((prev) => ({ ...prev, [program.id]: { udas: null, lessons: null } }));
    try {
      const [udas, lessons] = await Promise.all([
        listUdas(program.id, importId, db),
        listLessons(program.id, importId, db),
      ]);
      setCourseTree((prev) => ({ ...prev, [program.id]: { udas, lessons } }));
    } catch {
      setCourseTree((prev) => ({
        ...prev,
        [program.id]: { udas: [], lessons: [], error: 'Impossibile caricare i dati del corso.' },
      }));
    }
  }

  function toggleCourse(program: ProgramItem) {
    setExpandedCourses((prev) => {
      const next = new Set(prev);
      if (next.has(program.id)) next.delete(program.id);
      else next.add(program.id);
      return next;
    });
    if (program.activeImportId && !courseTree[program.id]) {
      void loadCourseTree(program);
    }
  }

  function toggleUda(programId: string, udaDir: string) {
    const key = `${programId}:${udaDir}`;
    setExpandedUdas((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function handleMoveUda(
    program: ProgramItem,
    udas: UdaItem[],
    index: number,
    direction: -1 | 1,
  ) {
    if (!program.activeImportId) return;
    const neighborIndex = index + direction;
    if (neighborIndex < 0 || neighborIndex >= udas.length) return;
    const uda = udas[index];
    const neighbor = udas[neighborIndex];
    setUdaReorderError(null);
    setBusyUdaIds(new Set([uda.id, neighbor.id]));
    try {
      const { order, neighborOrder } = await reorderUda({
        programId: program.id,
        importId: program.activeImportId,
        udaId: uda.id,
        neighborUdaId: neighbor.id,
        ownerUid,
        db,
      });
      setCourseTree((prev) => {
        const cur = prev[program.id];
        if (!cur?.udas) return prev;
        const nextUdas = sortUdas(
          cur.udas.map((u) => {
            if (u.id === uda.id) return { ...u, order };
            if (u.id === neighbor.id) return { ...u, order: neighborOrder };
            return u;
          }),
        );
        return { ...prev, [program.id]: { ...cur, udas: nextUdas } };
      });
    } catch (err) {
      setUdaReorderError({
        udaId: uda.id,
        message: err instanceof Error ? err.message : 'Impossibile riordinare la UDA.',
      });
    } finally {
      setBusyUdaIds(new Set());
    }
  }

  async function handleMoveLesson(
    program: ProgramItem,
    lessonsInUda: LessonItem[],
    index: number,
    direction: -1 | 1,
  ) {
    if (!program.activeImportId) return;
    const neighborIndex = index + direction;
    if (neighborIndex < 0 || neighborIndex >= lessonsInUda.length) return;
    const lesson = lessonsInUda[index];
    const neighbor = lessonsInUda[neighborIndex];
    setLessonReorderError(null);
    setBusyLessonIds(new Set([lesson.id, neighbor.id]));
    try {
      const { order, neighborOrder } = await reorderLesson({
        programId: program.id,
        importId: program.activeImportId,
        lessonId: lesson.id,
        neighborLessonId: neighbor.id,
        ownerUid,
        db,
      });
      setCourseTree((prev) => {
        const cur = prev[program.id];
        if (!cur?.lessons) return prev;
        const nextLessons = sortLessons(
          cur.lessons.map((l) => {
            if (l.id === lesson.id) return { ...l, order };
            if (l.id === neighbor.id) return { ...l, order: neighborOrder };
            return l;
          }),
        );
        return { ...prev, [program.id]: { ...cur, lessons: nextLessons } };
      });
    } catch (err) {
      setLessonReorderError({
        lessonId: lesson.id,
        message: err instanceof Error ? err.message : 'Impossibile riordinare la lezione.',
      });
    } finally {
      setBusyLessonIds(new Set());
    }
  }

  function startDeleteUda(uda: UdaItem) {
    setDeleteConfirmUdaId(uda.id);
    setUdaDeleteError(null);
    setUdaDeleteBlockers(null);
  }

  function cancelDeleteUda() {
    setDeleteConfirmUdaId(null);
    setUdaDeleteError(null);
    setUdaDeleteBlockers(null);
  }

  async function handleConfirmDeleteUda(program: ProgramItem, uda: UdaItem) {
    if (!program.activeImportId) return;
    setDeletingUdaId(uda.id);
    setUdaDeleteError(null);
    setUdaDeleteBlockers(null);
    try {
      await deleteUda({
        programId: program.id,
        importId: program.activeImportId,
        udaId: uda.id,
        ownerUid,
        db,
        storage,
      });
      setCourseTree((prev) => {
        const cur = prev[program.id];
        if (!cur) return prev;
        return {
          ...prev,
          [program.id]: {
            ...cur,
            udas: cur.udas?.filter((u) => u.id !== uda.id) ?? cur.udas,
            lessons: cur.lessons?.filter((l) => l.udaDir !== uda.dir) ?? cur.lessons,
          },
        };
      });
      if (selectedLesson?.udaDir === uda.dir) {
        setSelectedLesson(null);
        setSelectedProgram(null);
        setLessonContent(null);
      }
      setDeleteConfirmUdaId(null);
    } catch (err) {
      if (err instanceof RepositoryDeleteBlockedError) {
        setUdaDeleteBlockers({ udaId: uda.id, blockers: err.blockers });
      } else {
        setUdaDeleteError({
          udaId: uda.id,
          message: err instanceof Error ? err.message : 'Impossibile eliminare la UDA.',
        });
      }
    } finally {
      setDeletingUdaId(null);
    }
  }

  function startDeleteLesson(lesson: LessonItem) {
    setDeleteConfirmLessonId(lesson.id);
    setLessonDeleteError(null);
    setLessonDeleteBlockers(null);
  }

  function cancelDeleteLesson() {
    setDeleteConfirmLessonId(null);
    setLessonDeleteError(null);
    setLessonDeleteBlockers(null);
  }

  async function handleConfirmDeleteLesson(program: ProgramItem, uda: UdaItem, lesson: LessonItem) {
    if (!program.activeImportId) return;
    setDeletingLessonId(lesson.id);
    setLessonDeleteError(null);
    setLessonDeleteBlockers(null);
    try {
      await deleteLesson({
        programId: program.id,
        importId: program.activeImportId,
        udaId: uda.id,
        lessonId: lesson.id,
        ownerUid,
        db,
        storage,
      });
      setCourseTree((prev) => {
        const cur = prev[program.id];
        if (!cur?.lessons) return prev;
        return {
          ...prev,
          [program.id]: { ...cur, lessons: cur.lessons.filter((l) => l.id !== lesson.id) },
        };
      });
      if (selectedLesson?.id === lesson.id) {
        setSelectedLesson(null);
        setSelectedProgram(null);
        setLessonContent(null);
      }
      setDeleteConfirmLessonId(null);
    } catch (err) {
      if (err instanceof RepositoryDeleteBlockedError) {
        setLessonDeleteBlockers({ lessonId: lesson.id, blockers: err.blockers });
      } else {
        setLessonDeleteError({
          lessonId: lesson.id,
          message: err instanceof Error ? err.message : 'Impossibile eliminare la lezione.',
        });
      }
    } finally {
      setDeletingLessonId(null);
    }
  }

  function toggleCreateUda(program: ProgramItem) {
    setCreateUdaError(null);
    setCreatingLessonUdaKey(null);
    setCreatingUdaProgramId((prev) => {
      if (prev === program.id) return null;
      setNewUdaTitolo('');
      setNewUdaDescrizione('');
      setNewUdaCompetenze('');
      setNewUdaObiettivi('');
      return program.id;
    });
    setExpandedCourses((prev) => (prev.has(program.id) ? prev : new Set(prev).add(program.id)));
    if (program.activeImportId && !courseTree[program.id]) {
      void loadCourseTree(program);
    }
  }

  async function handleCreateUda(program: ProgramItem) {
    if (!program.activeImportId) return;
    const titolo = newUdaTitolo.trim();
    if (!titolo) {
      setCreateUdaError('Il titolo della UDA è obbligatorio.');
      return;
    }
    setSavingNewUda(true);
    setCreateUdaError(null);
    const fields = {
      titolo,
      descrizione: newUdaDescrizione.trim() || null,
      competenze: linesToArray(newUdaCompetenze),
      obiettivi: linesToArray(newUdaObiettivi),
    };
    try {
      const { udaId, dir, order } = await createUda({
        programId: program.id,
        importId: program.activeImportId,
        ownerUid,
        fields,
        db,
        storage,
      });
      const newUda: UdaItem = {
        id: udaId,
        ownerUid,
        importId: program.activeImportId,
        dir,
        filename: `${dir}.md`,
        order,
        storageBasePath: `repository/${ownerUid}/imports/${program.activeImportId}/${dir}`,
        lessonCount: 0,
        descrizione: fields.descrizione,
        competenze: fields.competenze,
        obiettivi: fields.obiettivi,
      };
      setCourseTree((prev) => {
        const cur = prev[program.id];
        if (!cur) return prev;
        const udas = sortUdas([...(cur.udas ?? []), newUda]);
        return { ...prev, [program.id]: { ...cur, udas } };
      });
      setCreatingUdaProgramId(null);
    } catch (err) {
      setCreateUdaError(err instanceof Error ? err.message : 'Impossibile creare la UDA.');
    } finally {
      setSavingNewUda(false);
    }
  }

  function toggleCreateLesson(program: ProgramItem, udaKey: string) {
    setCreateLessonError(null);
    setCreatingUdaProgramId(null);
    setCreatingLessonUdaKey((prev) => {
      if (prev === udaKey) return null;
      setNewLessonTitolo('');
      setNewLessonSottotitolo('');
      setNewLessonDifficolta('');
      setNewLessonConcettiChiave('');
      setNewLessonObiettivi('');
      setNewLessonBody('');
      return udaKey;
    });
    setExpandedUdas((prev) => (prev.has(udaKey) ? prev : new Set(prev).add(udaKey)));
    if (program.activeImportId && !courseTree[program.id]) {
      void loadCourseTree(program);
    }
  }

  async function handleCreateLesson(program: ProgramItem, uda: UdaItem) {
    if (!program.activeImportId) return;
    const titolo = newLessonTitolo.trim();
    if (!titolo) {
      setCreateLessonError('Il titolo della lezione è obbligatorio.');
      return;
    }
    setSavingNewLesson(true);
    setCreateLessonError(null);
    const fields = {
      titolo,
      sottotitolo: newLessonSottotitolo.trim() || null,
      difficolta: newLessonDifficolta.trim() || null,
      concettiChiave: linesToArray(newLessonConcettiChiave),
      obiettivi: linesToArray(newLessonObiettivi),
      body: newLessonBody,
    };
    try {
      const { lessonId, filename } = await createLesson({
        programId: program.id,
        importId: program.activeImportId,
        udaId: uda.id,
        udaDir: uda.dir,
        ownerUid,
        fields,
        db,
        storage,
      });
      const newLesson: LessonItem = {
        id: lessonId,
        ownerUid,
        importId: program.activeImportId,
        udaDir: uda.dir,
        path: `${uda.dir}/${filename}`,
        filename,
        poolStatus: 'absent',
        questionCount: 0,
        storageRef: `repository/${ownerUid}/imports/${program.activeImportId}/${uda.dir}/${filename}`,
        poolStorageRef: null,
        titolo: fields.titolo,
        sottotitolo: fields.sottotitolo,
        difficolta: fields.difficolta,
        concettiChiave: fields.concettiChiave,
        obiettivi: fields.obiettivi,
      };
      setCourseTree((prev) => {
        const cur = prev[program.id];
        if (!cur) return prev;
        const lessons = sortLessons([...(cur.lessons ?? []), newLesson]);
        return { ...prev, [program.id]: { ...cur, lessons } };
      });
      setCreatingLessonUdaKey(null);
    } catch (err) {
      setCreateLessonError(err instanceof Error ? err.message : 'Impossibile creare la lezione.');
    } finally {
      setSavingNewLesson(false);
    }
  }

  async function selectLesson(program: ProgramItem, lesson: LessonItem) {
    setSelectedProgram(program);
    setSelectedLesson(lesson);
    setLessonContent(null);
    setLessonMetadata(EMPTY_LESSON_METADATA);
    setLessonContentError(null);
    setPdfError(null);
    setEditingLessonMetadata(false);
    setLessonMetadataSaveError(null);
    setEditingLessonBody(false);
    setLessonBodySaveError(null);
    setLessonContentLoading(true);
    try {
      const raw = await fetchLessonContent(lesson.storageRef, storage);
      const { metadata, body } = parseLessonMetadata(raw);
      setLessonMetadata(metadata);
      setLessonContent(body);
    } catch {
      setLessonContentError('Impossibile caricare il contenuto della lezione.');
    } finally {
      setLessonContentLoading(false);
    }
  }

  function toggleLessonMetadataEdit() {
    setLessonMetadataSaveError(null);
    setEditingLessonBody(false);
    setEditingLessonMetadata((prev) => {
      if (prev) return false;
      setEditTitolo(lessonMetadata.titolo ?? '');
      setEditSottotitolo(lessonMetadata.sottotitolo ?? '');
      setEditDifficolta(lessonMetadata.difficolta ?? '');
      setEditConcettiChiave(lessonMetadata.concettiChiave.join('\n'));
      setEditObiettivi(lessonMetadata.obiettivi.join('\n'));
      return true;
    });
  }

  async function handleSaveLessonMetadata() {
    if (!selectedProgram?.activeImportId || !selectedLesson) return;
    const fields: LessonMetadata = {
      titolo: editTitolo.trim() || null,
      sottotitolo: editSottotitolo.trim() || null,
      difficolta: editDifficolta.trim() || null,
      concettiChiave: linesToArray(editConcettiChiave),
      obiettivi: linesToArray(editObiettivi),
    };
    setSavingLessonMetadata(true);
    setLessonMetadataSaveError(null);
    try {
      await updateLessonMetadata({
        programId: selectedProgram.id,
        importId: selectedProgram.activeImportId,
        lessonId: selectedLesson.id,
        fields,
        ownerUid,
        db,
        storage,
      });
      setLessonMetadata(fields);
      setCourseTree((prev) => {
        const cur = prev[selectedProgram.id];
        if (!cur?.lessons) return prev;
        return {
          ...prev,
          [selectedProgram.id]: {
            ...cur,
            lessons: cur.lessons.map((l) => (l.id === selectedLesson.id ? { ...l, ...fields } : l)),
          },
        };
      });
      setEditingLessonMetadata(false);
    } catch (err) {
      setLessonMetadataSaveError(
        err instanceof Error ? err.message : 'Impossibile salvare i metadata della lezione.',
      );
    } finally {
      setSavingLessonMetadata(false);
    }
  }

  function toggleLessonBodyEdit() {
    setLessonBodySaveError(null);
    setEditingLessonMetadata(false);
    setEditingLessonBody((prev) => {
      if (prev) return false;
      setBodyDraft(lessonContent ?? '');
      setBodyEditorTab('editor');
      return true;
    });
  }

  async function handleSaveLessonBody() {
    if (!selectedProgram?.activeImportId || !selectedLesson) return;
    setSavingLessonBody(true);
    setLessonBodySaveError(null);
    try {
      await updateLessonMarkdownBody({
        programId: selectedProgram.id,
        importId: selectedProgram.activeImportId,
        lessonId: selectedLesson.id,
        body: bodyDraft,
        ownerUid,
        db,
        storage,
      });
      setLessonContent(bodyDraft);
      setEditingLessonBody(false);
    } catch (err) {
      setLessonBodySaveError(
        err instanceof Error ? err.message : 'Impossibile salvare il contenuto della lezione.',
      );
    } finally {
      setSavingLessonBody(false);
    }
  }

  async function handleDownloadLessonPdf() {
    if (!selectedLesson || lessonContent == null) return;
    setPdfError(null);
    setPdfDownloading(true);
    try {
      const contextParts = [selectedProgram?.title, selectedLesson.udaDir].filter(
        (part): part is string => Boolean(part?.trim()),
      );
      const context = contextParts.length > 0 ? contextParts.join(' - ') : null;
      const { title } = resolveLessonTitle(selectedLesson.filename, lessonMetadata.titolo);
      await downloadLessonPdf(title, lessonContent, context, lessonMetadata);
    } catch {
      setPdfError('Impossibile generare il PDF della lezione.');
    } finally {
      setPdfDownloading(false);
    }
  }

  if (loadError)
    return (
      <p role="alert" className="text-error">
        {loadError}
      </p>
    );
  if (programs === null)
    return (
      <p aria-busy="true" className="state-loading">
        Caricamento…
      </p>
    );

  if (programs.length === 0) {
    return (
      <section aria-label="Lezioni" className={styles.container}>
        <p className={`state-empty ${styles.emptyPanel}`}>
          Nessun programma disponibile. {IMPORT_HINT}
        </p>
      </section>
    );
  }

  return (
    <section
      aria-label="Lezioni"
      className={`${styles.container}${sidebarCollapsed ? ` ${styles.containerCollapsed}` : ''}`}
    >
      <aside
        className={`${styles.sidebar}${sidebarCollapsed ? ` ${styles.sidebarCollapsed}` : ''}`}
      >
        <div className={styles.sidebarHeader}>
          {!sidebarCollapsed && <h2 className={styles.sidebarTitle}>Lezioni</h2>}
          <div className={styles.sidebarHeaderActions}>
            {!sidebarCollapsed && (
              <button
                type="button"
                className={`${styles.reorderModeBtn}${reorderMode ? ` ${styles.reorderModeBtnActive}` : ''}`}
                aria-pressed={reorderMode}
                aria-label={reorderMode ? 'Termina riordino' : 'Attiva riordino'}
                title={reorderMode ? 'Termina riordino' : 'Riordina UDA e lezioni'}
                onClick={() => setReorderMode((prev) => !prev)}
              >
                ↕
              </button>
            )}
            <button
              type="button"
              className={styles.sidebarToggleBtn}
              aria-label={sidebarCollapsed ? 'Espandi sidebar' : 'Comprimi sidebar'}
              title={sidebarCollapsed ? 'Espandi sidebar' : 'Comprimi sidebar'}
              onClick={() => setSidebarCollapsed((v) => !v)}
            >
              {sidebarCollapsed ? '›' : '‹'}
            </button>
          </div>
        </div>

        {!sidebarCollapsed && (
          <ul className={styles.courseList}>
            {programs.map((program) => {
              const tree = courseTree[program.id];
              const expanded = expandedCourses.has(program.id);

              return (
                <li key={program.id} className={styles.courseItem}>
                  <div className={styles.courseRow}>
                    <button
                      type="button"
                      className={styles.courseToggle}
                      aria-expanded={expanded}
                      aria-controls={`lezioni-course-panel-${program.id}`}
                      onClick={() => toggleCourse(program)}
                    >
                      <span
                        className={`${styles.caret}${expanded ? ` ${styles.caretOpen}` : ''}`}
                        aria-hidden="true"
                      >
                        ▶
                      </span>
                      <span className={styles.courseTitle}>{program.title}</span>
                      {!program.activeImportId && (
                        <span className="badge badge-warning">Nessun import</span>
                      )}
                    </button>
                    {program.activeImportId && (
                      <button
                        type="button"
                        className={styles.udaAddBtn}
                        title="Nuova UDA"
                        aria-label={`Nuova UDA — ${program.title}`}
                        aria-expanded={creatingUdaProgramId === program.id}
                        onClick={() => toggleCreateUda(program)}
                      >
                        ＋
                      </button>
                    )}
                  </div>

                  {expanded && (
                    <div id={`lezioni-course-panel-${program.id}`} className={styles.udaPanel}>
                      {!program.activeImportId ? (
                        <p className="state-empty">{IMPORT_HINT}</p>
                      ) : tree?.udas == null ? (
                        <p aria-busy="true" className="state-loading">
                          Caricamento UDA…
                        </p>
                      ) : tree.udas.length === 0 ? (
                        <p className="state-empty">Nessuna UDA.</p>
                      ) : (
                        <ul className={styles.udaList}>
                          {tree.udas.map((uda, udaIndex) => {
                            const udaKey = `${program.id}:${uda.dir}`;
                            const udaExpanded = expandedUdas.has(udaKey);
                            const udaLessons = (tree.lessons ?? []).filter(
                              (l) => l.udaDir === uda.dir,
                            );

                            const udaCreating = creatingLessonUdaKey === udaKey;
                            const udaBusy = busyUdaIds.has(uda.id);

                            return (
                              <li key={uda.id}>
                                <div className={styles.udaRow}>
                                  <button
                                    type="button"
                                    className={styles.udaToggle}
                                    aria-expanded={udaExpanded}
                                    aria-controls={`lezioni-uda-panel-${uda.id}`}
                                    onClick={() => toggleUda(program.id, uda.dir)}
                                  >
                                    <span
                                      className={`${styles.caret}${udaExpanded ? ` ${styles.caretOpen}` : ''}`}
                                      aria-hidden="true"
                                    >
                                      ▶
                                    </span>
                                    <span className={styles.udaDir}>{uda.dir}</span>
                                  </button>
                                  {reorderMode && (
                                    <div
                                      className={styles.reorderControls}
                                      role="group"
                                      aria-label={`Riordina ${uda.dir}`}
                                    >
                                      <button
                                        type="button"
                                        className={styles.reorderBtn}
                                        title="Sposta su"
                                        aria-label={`Sposta su — ${uda.dir}`}
                                        disabled={udaIndex === 0 || udaBusy}
                                        onClick={() =>
                                          void handleMoveUda(program, tree.udas!, udaIndex, -1)
                                        }
                                      >
                                        ▲
                                      </button>
                                      <button
                                        type="button"
                                        className={styles.reorderBtn}
                                        title="Sposta giù"
                                        aria-label={`Sposta giù — ${uda.dir}`}
                                        disabled={udaIndex === tree.udas!.length - 1 || udaBusy}
                                        onClick={() =>
                                          void handleMoveUda(program, tree.udas!, udaIndex, 1)
                                        }
                                      >
                                        ▼
                                      </button>
                                    </div>
                                  )}
                                  <button
                                    type="button"
                                    className={styles.udaAddBtn}
                                    title="Nuova lezione"
                                    aria-label={`Nuova lezione — ${uda.dir}`}
                                    aria-expanded={udaCreating}
                                    onClick={() => toggleCreateLesson(program, udaKey)}
                                  >
                                    ＋
                                  </button>
                                  {!reorderMode && (
                                    <button
                                      type="button"
                                      className={styles.deleteBtn}
                                      title="Elimina UDA"
                                      aria-label={`Elimina UDA — ${uda.dir}`}
                                      onClick={() => startDeleteUda(uda)}
                                    >
                                      🗑️
                                    </button>
                                  )}
                                </div>

                                {udaReorderError?.udaId === uda.id && (
                                  <p role="alert" className={`text-error ${styles.reorderError}`}>
                                    {udaReorderError.message}
                                  </p>
                                )}

                                {deleteConfirmUdaId === uda.id && (
                                  <div
                                    className={styles.deleteConfirmBox}
                                    role="region"
                                    aria-label={`Conferma eliminazione UDA ${uda.dir}`}
                                  >
                                    {udaDeleteBlockers?.udaId === uda.id ? (
                                      <>
                                        <p className={styles.deleteConfirmMsg}>
                                          Impossibile eliminare: esistono verifiche collegate a
                                          questa UDA. Rimuovile o modificale prima di eliminare.
                                        </p>
                                        <ul className={styles.deleteBlockersList}>
                                          {udaDeleteBlockers.blockers.map((blocker) => (
                                            <li
                                              key={blocker.verificationId}
                                              title={blocker.verificationId}
                                            >
                                              {blocker.title} (
                                              {VERIFICATION_STATUS_LABELS[blocker.status]})
                                            </li>
                                          ))}
                                        </ul>
                                        <div className={styles.deleteConfirmActions}>
                                          <button type="button" onClick={cancelDeleteUda}>
                                            Chiudi
                                          </button>
                                        </div>
                                      </>
                                    ) : (
                                      <>
                                        <p className={styles.deleteConfirmMsg}>
                                          Saranno eliminate tutte le lezioni della UDA, i relativi
                                          file su Storage e i pool collegati. Operazione
                                          irreversibile.
                                        </p>
                                        {udaDeleteError?.udaId === uda.id && (
                                          <p role="alert" className="text-error">
                                            {udaDeleteError.message}
                                          </p>
                                        )}
                                        <div className={styles.deleteConfirmActions}>
                                          <button
                                            type="button"
                                            className={`${styles.deleteConfirmBtn} btn-danger`}
                                            disabled={deletingUdaId === uda.id}
                                            onClick={() =>
                                              void handleConfirmDeleteUda(program, uda)
                                            }
                                          >
                                            {deletingUdaId === uda.id
                                              ? 'Eliminazione…'
                                              : 'Elimina definitivamente'}
                                          </button>
                                          <button
                                            type="button"
                                            disabled={deletingUdaId === uda.id}
                                            onClick={cancelDeleteUda}
                                          >
                                            Annulla
                                          </button>
                                        </div>
                                      </>
                                    )}
                                  </div>
                                )}

                                {udaExpanded && (
                                  <div
                                    id={`lezioni-uda-panel-${uda.id}`}
                                    className={styles.lessonPanel}
                                  >
                                    {udaLessons.length === 0 ? (
                                      <p className="state-empty">Nessuna lezione.</p>
                                    ) : (
                                      <ul className={styles.lessonList}>
                                        {udaLessons.map((lesson, lessonIndex) => {
                                          const { title } = resolveLessonTitle(
                                            lesson.filename,
                                            lesson.titolo,
                                          );
                                          const lessonBusy = busyLessonIds.has(lesson.id);
                                          return (
                                            <li key={lesson.id}>
                                              <div className={styles.lessonRow}>
                                                <button
                                                  type="button"
                                                  className={styles.lessonBtn}
                                                  aria-pressed={selectedLesson?.id === lesson.id}
                                                  aria-label={`Apri lezione ${lesson.filename}`}
                                                  onClick={() => void selectLesson(program, lesson)}
                                                >
                                                  {title}
                                                </button>
                                                {!reorderMode && (
                                                  <button
                                                    type="button"
                                                    className={styles.deleteBtn}
                                                    title="Elimina lezione"
                                                    aria-label={`Elimina lezione — ${lesson.filename}`}
                                                    onClick={() => startDeleteLesson(lesson)}
                                                  >
                                                    🗑️
                                                  </button>
                                                )}
                                                {reorderMode && (
                                                  <div
                                                    className={styles.reorderControls}
                                                    role="group"
                                                    aria-label={`Riordina ${lesson.filename}`}
                                                  >
                                                    <button
                                                      type="button"
                                                      className={styles.reorderBtn}
                                                      title="Sposta su"
                                                      aria-label={`Sposta su — ${lesson.filename}`}
                                                      disabled={lessonIndex === 0 || lessonBusy}
                                                      onClick={() =>
                                                        void handleMoveLesson(
                                                          program,
                                                          udaLessons,
                                                          lessonIndex,
                                                          -1,
                                                        )
                                                      }
                                                    >
                                                      ▲
                                                    </button>
                                                    <button
                                                      type="button"
                                                      className={styles.reorderBtn}
                                                      title="Sposta giù"
                                                      aria-label={`Sposta giù — ${lesson.filename}`}
                                                      disabled={
                                                        lessonIndex === udaLessons.length - 1 ||
                                                        lessonBusy
                                                      }
                                                      onClick={() =>
                                                        void handleMoveLesson(
                                                          program,
                                                          udaLessons,
                                                          lessonIndex,
                                                          1,
                                                        )
                                                      }
                                                    >
                                                      ▼
                                                    </button>
                                                  </div>
                                                )}
                                              </div>
                                              {lessonReorderError?.lessonId === lesson.id && (
                                                <p
                                                  role="alert"
                                                  className={`text-error ${styles.reorderError}`}
                                                >
                                                  {lessonReorderError.message}
                                                </p>
                                              )}

                                              {deleteConfirmLessonId === lesson.id && (
                                                <div
                                                  className={styles.deleteConfirmBox}
                                                  role="region"
                                                  aria-label={`Conferma eliminazione lezione ${lesson.filename}`}
                                                >
                                                  {lessonDeleteBlockers?.lessonId === lesson.id ? (
                                                    <>
                                                      <p className={styles.deleteConfirmMsg}>
                                                        Impossibile eliminare: esistono verifiche
                                                        collegate a questa lezione. Rimuovile o
                                                        modificale prima di eliminare.
                                                      </p>
                                                      <ul className={styles.deleteBlockersList}>
                                                        {lessonDeleteBlockers.blockers.map(
                                                          (blocker) => (
                                                            <li
                                                              key={blocker.verificationId}
                                                              title={blocker.verificationId}
                                                            >
                                                              {blocker.title} (
                                                              {
                                                                VERIFICATION_STATUS_LABELS[
                                                                  blocker.status
                                                                ]
                                                              }
                                                              )
                                                            </li>
                                                          ),
                                                        )}
                                                      </ul>
                                                      <div className={styles.deleteConfirmActions}>
                                                        <button
                                                          type="button"
                                                          onClick={cancelDeleteLesson}
                                                        >
                                                          Chiudi
                                                        </button>
                                                      </div>
                                                    </>
                                                  ) : (
                                                    <>
                                                      <p className={styles.deleteConfirmMsg}>
                                                        Saranno eliminati il file su Storage e
                                                        l&apos;eventuale pool collegato. Operazione
                                                        irreversibile.
                                                      </p>
                                                      {lessonDeleteError?.lessonId ===
                                                        lesson.id && (
                                                        <p role="alert" className="text-error">
                                                          {lessonDeleteError.message}
                                                        </p>
                                                      )}
                                                      <div className={styles.deleteConfirmActions}>
                                                        <button
                                                          type="button"
                                                          className={`${styles.deleteConfirmBtn} btn-danger`}
                                                          disabled={deletingLessonId === lesson.id}
                                                          onClick={() =>
                                                            void handleConfirmDeleteLesson(
                                                              program,
                                                              uda,
                                                              lesson,
                                                            )
                                                          }
                                                        >
                                                          {deletingLessonId === lesson.id
                                                            ? 'Eliminazione…'
                                                            : 'Elimina definitivamente'}
                                                        </button>
                                                        <button
                                                          type="button"
                                                          disabled={deletingLessonId === lesson.id}
                                                          onClick={cancelDeleteLesson}
                                                        >
                                                          Annulla
                                                        </button>
                                                      </div>
                                                    </>
                                                  )}
                                                </div>
                                              )}
                                            </li>
                                          );
                                        })}
                                      </ul>
                                    )}

                                    {udaCreating && (
                                      <form
                                        className={styles.newLessonForm}
                                        role="region"
                                        aria-label={`Nuova lezione — ${uda.dir}`}
                                        onSubmit={(e) => {
                                          e.preventDefault();
                                          void handleCreateLesson(program, uda);
                                        }}
                                      >
                                        <label htmlFor={`new-lesson-titolo-${uda.id}`}>
                                          Titolo
                                          <input
                                            id={`new-lesson-titolo-${uda.id}`}
                                            type="text"
                                            value={newLessonTitolo}
                                            onChange={(e) => setNewLessonTitolo(e.target.value)}
                                            required
                                          />
                                        </label>
                                        <label htmlFor={`new-lesson-sottotitolo-${uda.id}`}>
                                          Sottotitolo
                                          <input
                                            id={`new-lesson-sottotitolo-${uda.id}`}
                                            type="text"
                                            value={newLessonSottotitolo}
                                            onChange={(e) =>
                                              setNewLessonSottotitolo(e.target.value)
                                            }
                                          />
                                        </label>
                                        <label htmlFor={`new-lesson-difficolta-${uda.id}`}>
                                          Difficoltà
                                          <input
                                            id={`new-lesson-difficolta-${uda.id}`}
                                            type="text"
                                            value={newLessonDifficolta}
                                            onChange={(e) => setNewLessonDifficolta(e.target.value)}
                                          />
                                        </label>
                                        <label htmlFor={`new-lesson-concetti-${uda.id}`}>
                                          Concetti chiave (uno per riga)
                                          <textarea
                                            id={`new-lesson-concetti-${uda.id}`}
                                            rows={2}
                                            value={newLessonConcettiChiave}
                                            onChange={(e) =>
                                              setNewLessonConcettiChiave(e.target.value)
                                            }
                                          />
                                        </label>
                                        <label htmlFor={`new-lesson-obiettivi-${uda.id}`}>
                                          Obiettivi (uno per riga)
                                          <textarea
                                            id={`new-lesson-obiettivi-${uda.id}`}
                                            rows={2}
                                            value={newLessonObiettivi}
                                            onChange={(e) => setNewLessonObiettivi(e.target.value)}
                                          />
                                        </label>
                                        <label htmlFor={`new-lesson-body-${uda.id}`}>
                                          Corpo Markdown iniziale (opzionale)
                                          <textarea
                                            id={`new-lesson-body-${uda.id}`}
                                            rows={4}
                                            value={newLessonBody}
                                            onChange={(e) => setNewLessonBody(e.target.value)}
                                          />
                                        </label>
                                        {createLessonError && (
                                          <p role="alert" className="text-error">
                                            {createLessonError}
                                          </p>
                                        )}
                                        <div className={styles.newLessonActions}>
                                          <button
                                            type="submit"
                                            className="btn-success"
                                            disabled={savingNewLesson || !newLessonTitolo.trim()}
                                          >
                                            {savingNewLesson ? 'Creazione…' : 'Crea lezione'}
                                          </button>
                                          <button
                                            type="button"
                                            disabled={savingNewLesson}
                                            onClick={() => setCreatingLessonUdaKey(null)}
                                          >
                                            Annulla
                                          </button>
                                        </div>
                                      </form>
                                    )}
                                  </div>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      )}

                      {creatingUdaProgramId === program.id && (
                        <form
                          className={styles.newLessonForm}
                          role="region"
                          aria-label={`Nuova UDA — ${program.title}`}
                          onSubmit={(e) => {
                            e.preventDefault();
                            void handleCreateUda(program);
                          }}
                        >
                          <label htmlFor={`new-uda-titolo-${program.id}`}>
                            Titolo
                            <input
                              id={`new-uda-titolo-${program.id}`}
                              type="text"
                              value={newUdaTitolo}
                              onChange={(e) => setNewUdaTitolo(e.target.value)}
                              required
                            />
                          </label>
                          <label htmlFor={`new-uda-descrizione-${program.id}`}>
                            Descrizione
                            <textarea
                              id={`new-uda-descrizione-${program.id}`}
                              rows={2}
                              value={newUdaDescrizione}
                              onChange={(e) => setNewUdaDescrizione(e.target.value)}
                            />
                          </label>
                          <label htmlFor={`new-uda-competenze-${program.id}`}>
                            Competenze (una per riga)
                            <textarea
                              id={`new-uda-competenze-${program.id}`}
                              rows={2}
                              value={newUdaCompetenze}
                              onChange={(e) => setNewUdaCompetenze(e.target.value)}
                            />
                          </label>
                          <label htmlFor={`new-uda-obiettivi-${program.id}`}>
                            Obiettivi (uno per riga)
                            <textarea
                              id={`new-uda-obiettivi-${program.id}`}
                              rows={2}
                              value={newUdaObiettivi}
                              onChange={(e) => setNewUdaObiettivi(e.target.value)}
                            />
                          </label>
                          {createUdaError && (
                            <p role="alert" className="text-error">
                              {createUdaError}
                            </p>
                          )}
                          <div className={styles.newLessonActions}>
                            <button
                              type="submit"
                              className="btn-success"
                              disabled={savingNewUda || !newUdaTitolo.trim()}
                            >
                              {savingNewUda ? 'Creazione…' : 'Crea UDA'}
                            </button>
                            <button
                              type="button"
                              disabled={savingNewUda}
                              onClick={() => setCreatingUdaProgramId(null)}
                            >
                              Annulla
                            </button>
                          </div>
                        </form>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </aside>

      <div className={styles.content}>
        {selectedLesson === null ? (
          <p className="state-empty">
            Seleziona una lezione dalla lista per leggerne il contenuto.
          </p>
        ) : (
          <>
            <div className={styles.contentHeader}>
              <div className={styles.titleBlock}>
                <h3 className={styles.contentTitle}>
                  {resolveLessonTitle(selectedLesson.filename, lessonMetadata.titolo).title}
                </h3>
                {lessonMetadata.sottotitolo && (
                  <p className={styles.contentSubtitle}>{lessonMetadata.sottotitolo}</p>
                )}
              </div>
              <button
                type="button"
                className={styles.pdfBtn}
                title="Modifica contenuto"
                aria-label={`Modifica contenuto — ${selectedLesson.filename}`}
                aria-expanded={editingLessonBody}
                disabled={lessonContent == null}
                onClick={toggleLessonBodyEdit}
              >
                📝
              </button>
              <button
                type="button"
                className={styles.pdfBtn}
                title="Modifica metadata"
                aria-label={`Modifica metadata — ${selectedLesson.filename}`}
                aria-expanded={editingLessonMetadata}
                disabled={lessonContent == null}
                onClick={toggleLessonMetadataEdit}
              >
                ✏️
              </button>
              <button
                type="button"
                className={styles.pdfBtn}
                title="Scarica PDF"
                aria-label={`Scarica PDF — ${selectedLesson.filename}`}
                disabled={lessonContent == null || pdfDownloading}
                onClick={() => void handleDownloadLessonPdf()}
              >
                {pdfDownloading ? '…' : '🖨️'}
              </button>
            </div>

            {editingLessonMetadata && (
              <form
                className={styles.metadataEditForm}
                role="region"
                aria-label={`Modifica metadata — ${selectedLesson.filename}`}
                onSubmit={(e) => {
                  e.preventDefault();
                  void handleSaveLessonMetadata();
                }}
              >
                <label htmlFor="lesson-edit-titolo">
                  Titolo
                  <input
                    id="lesson-edit-titolo"
                    type="text"
                    value={editTitolo}
                    onChange={(e) => setEditTitolo(e.target.value)}
                  />
                </label>
                <label htmlFor="lesson-edit-sottotitolo">
                  Sottotitolo
                  <input
                    id="lesson-edit-sottotitolo"
                    type="text"
                    value={editSottotitolo}
                    onChange={(e) => setEditSottotitolo(e.target.value)}
                  />
                </label>
                <label htmlFor="lesson-edit-difficolta">
                  Difficoltà
                  <input
                    id="lesson-edit-difficolta"
                    type="text"
                    value={editDifficolta}
                    onChange={(e) => setEditDifficolta(e.target.value)}
                  />
                </label>
                <label htmlFor="lesson-edit-concetti">
                  Concetti chiave (uno per riga)
                  <textarea
                    id="lesson-edit-concetti"
                    rows={3}
                    value={editConcettiChiave}
                    onChange={(e) => setEditConcettiChiave(e.target.value)}
                  />
                </label>
                <label htmlFor="lesson-edit-obiettivi">
                  Obiettivi (uno per riga)
                  <textarea
                    id="lesson-edit-obiettivi"
                    rows={3}
                    value={editObiettivi}
                    onChange={(e) => setEditObiettivi(e.target.value)}
                  />
                </label>
                {lessonMetadataSaveError && (
                  <p role="alert" className="text-error">
                    {lessonMetadataSaveError}
                  </p>
                )}
                <div className={styles.metadataEditActions}>
                  <button type="submit" className="btn-success" disabled={savingLessonMetadata}>
                    {savingLessonMetadata ? 'Salvataggio…' : 'Salva'}
                  </button>
                  <button
                    type="button"
                    disabled={savingLessonMetadata}
                    onClick={() => setEditingLessonMetadata(false)}
                  >
                    Annulla
                  </button>
                </div>
              </form>
            )}

            {lessonMetadata.difficolta && (
              <span className={styles.contentDifficulty}>{lessonMetadata.difficolta}</span>
            )}

            {(lessonMetadata.concettiChiave.length > 0 || lessonMetadata.obiettivi.length > 0) && (
              <div className={styles.metaBlock}>
                {lessonMetadata.concettiChiave.length > 0 && (
                  <div className={styles.metaGroup}>
                    <span className={styles.metaLabel}>Concetti chiave</span>
                    <ul className={styles.chipList}>
                      {lessonMetadata.concettiChiave.map((concetto) => (
                        <li key={concetto} className={styles.chip}>
                          {concetto}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {lessonMetadata.obiettivi.length > 0 && (
                  <div className={styles.metaGroup}>
                    <span className={styles.metaLabel}>Obiettivi</span>
                    <ul className={styles.metaList}>
                      {lessonMetadata.obiettivi.map((obiettivo) => (
                        <li key={obiettivo}>{obiettivo}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {pdfError && (
              <p role="alert" className={`text-error ${styles.pdfError}`}>
                {pdfError}
              </p>
            )}

            {lessonContentLoading && (
              <p aria-busy="true" className="state-loading">
                Caricamento contenuto…
              </p>
            )}
            {lessonContentError && (
              <p role="alert" className="text-error">
                {lessonContentError}
              </p>
            )}

            {editingLessonBody ? (
              <div
                className={styles.bodyEditor}
                role="region"
                aria-label={`Modifica contenuto — ${selectedLesson.filename}`}
              >
                <div className={styles.bodyEditorTabs} role="tablist">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={bodyEditorTab === 'editor'}
                    className={styles.bodyEditorTab}
                    onClick={() => setBodyEditorTab('editor')}
                  >
                    Editor
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={bodyEditorTab === 'preview'}
                    className={styles.bodyEditorTab}
                    onClick={() => setBodyEditorTab('preview')}
                  >
                    Anteprima
                  </button>
                </div>

                {bodyEditorTab === 'editor' ? (
                  <textarea
                    className={styles.bodyEditorTextarea}
                    value={bodyDraft}
                    onChange={(e) => setBodyDraft(e.target.value)}
                    aria-label={`Corpo Markdown — ${selectedLesson.filename}`}
                    rows={18}
                  />
                ) : (
                  <div className={styles.bodyEditorPreview}>
                    <MarkdownRenderer markdown={bodyDraft} />
                  </div>
                )}

                {lessonBodySaveError && (
                  <p role="alert" className="text-error">
                    {lessonBodySaveError}
                  </p>
                )}

                <div className={styles.bodyEditorActions}>
                  <button
                    type="button"
                    className="btn-success"
                    disabled={savingLessonBody}
                    onClick={() => void handleSaveLessonBody()}
                  >
                    {savingLessonBody ? 'Salvataggio…' : 'Salva'}
                  </button>
                  <button
                    type="button"
                    disabled={savingLessonBody}
                    onClick={() => setEditingLessonBody(false)}
                  >
                    Annulla
                  </button>
                </div>
              </div>
            ) : (
              lessonContent !== null &&
              !lessonContentLoading && <MarkdownRenderer markdown={lessonContent} />
            )}
          </>
        )}
      </div>
    </section>
  );
}
