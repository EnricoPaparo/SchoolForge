import { Fragment, type FormEvent, useEffect, useState } from 'react';
import {
  activateVerification,
  closeVerification,
  createVerification,
  deleteVerification,
  listVerifications,
  setVerificationOnlineEnabled,
  setVerificationStudentPdfEnabled,
  setVerificationVisibility,
  updateVerificationConfig,
  type VerificationItem,
} from '../repository/verifications/verificationsService.js';
import {
  listQuestionIndex,
  type QuestionIndexEntry,
} from '../repository/verifications/questionIndexService.js';
import {
  watchSubmissions,
  type SubmissionMonitorItem,
} from '../repository/verifications/submissionsMonitorService.js';
import { listClasses, type ClassItem } from '../repository/classes/classesService.js';
import { listPrograms, type ProgramItem } from '../repository/programs/programsService.js';
import { listStudents, type StudentItem } from '../repository/students/studentsService.js';
import { loadSelectedQuestions } from '../repository/verifications/loadSelectedQuestions.js';
import { loadSelectedQuestionsWithSolutions } from '../repository/verifications/loadSelectedQuestionsWithSolutions.js';
import {
  downloadStudentPdf,
  downloadTeacherSolutionsPdf,
} from '../repository/verifications/verificationPdf.js';
import {
  toPdfQuestion,
  toPdfQuestionWithSolution,
} from '../repository/verifications/verificationSnapshotMappers.js';
import { db, storage } from '../../lib/firebase.js';
import { useAuth } from '../../lib/auth.js';
import { QuestionPicker } from './QuestionPicker.js';
import { AttentionEventsDialog } from './AttentionEventsDialog.js';
import type { AttentionEvent, VerificationTeacherQuestionSnapshot } from '../../types/firestore.js';
import styles from './VerificationsView.module.css';

/** Extracts the epoch seconds from a Firestore Timestamp-like value, or null if absent. */
function timestampSeconds(ts: unknown): number | null {
  if (!ts || typeof ts !== 'object' || !('seconds' in ts)) return null;
  return (ts as { seconds: number }).seconds;
}

/** Formats a Firestore Timestamp-like value as a compact it-IT date+time string, or "—" if absent. */
function formatTimestamp(ts: unknown): string {
  const seconds = timestampSeconds(ts);
  if (seconds === null) return '—';
  return new Date(seconds * 1000).toLocaleString('it-IT', {
    dateStyle: 'short',
    timeStyle: 'short',
  });
}

/**
 * Most-recent-activation-first ordering: activatedAt, falling back to
 * closedAt, then updatedAt, when a verification lacks the primary date.
 * Drafts with no relevant date at all sink to the bottom.
 */
function verificationSortKey(v: VerificationItem): number | null {
  return (
    timestampSeconds(v.activatedAt) ?? timestampSeconds(v.closedAt) ?? timestampSeconds(v.updatedAt)
  );
}

function sortVerificationsByActivation(list: VerificationItem[]): VerificationItem[] {
  return [...list].sort((a, b) => {
    const keyA = verificationSortKey(a);
    const keyB = verificationSortKey(b);
    if (keyA === null && keyB === null) return 0;
    if (keyA === null) return 1;
    if (keyB === null) return -1;
    return keyB - keyA;
  });
}

/**
 * A single, non-redundant status label. For `active` verifications, the
 * status itself ("attiva") is redundant with visibility, so it's replaced
 * outright by "Pubblica"/"Nascosta" instead of showing both.
 */
function StatusBadge({
  status,
  visibility,
}: {
  status: 'draft' | 'active' | 'closed';
  visibility: 'hidden' | 'public';
}) {
  if (status === 'active') {
    const isPublic = visibility === 'public';
    return (
      <span className={`${styles.badge} ${isPublic ? styles.badgeActive : styles.badgeDraft}`}>
        {isPublic ? 'pubblica' : 'nascosta'}
      </span>
    );
  }
  const labels = { draft: 'bozza', closed: 'chiusa' } as const;
  const cls = { draft: styles.badgeDraft, closed: styles.badgeClosed } as const;
  return <span className={`${styles.badge} ${cls[status]}`}>{labels[status]}</span>;
}

export function VerificationsView() {
  const { user } = useAuth();
  const ownerUid = user?.uid ?? '';

  // ── List state ──────────────────────────────────────────────────
  const [verifications, setVerifications] = useState<VerificationItem[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [programs, setPrograms] = useState<ProgramItem[]>([]);
  const [classes, setClasses] = useState<ClassItem[]>([]);

  // ── Create form state ───────────────────────────────────────────
  const [newTitle, setNewTitle] = useState('');
  const [newProgramId, setNewProgramId] = useState('');
  const [newClassId, setNewClassId] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // ── Detail state (draft configuration only) ─────────────────────
  const [selectedVer, setSelectedVer] = useState<VerificationItem | null>(null);
  const [questionIndex, setQuestionIndex] = useState<QuestionIndexEntry[] | null>(null);
  const [questionIndexError, setQuestionIndexError] = useState<string | null>(null);
  const [selectedQuestionIds, setSelectedQuestionIds] = useState<Set<string>>(new Set());

  // ── Draft edit state ────────────────────────────────────────────
  const [editDraftTitle, setEditDraftTitle] = useState('');
  const [editDraftClassId, setEditDraftClassId] = useState('');
  const [savingDraft, setSavingDraft] = useState(false);

  // ── Activation state (draft detail flow) ────────────────────────
  const [showActivateConfirm, setShowActivateConfirm] = useState(false);
  const [activating, setActivating] = useState(false);
  const [activateError, setActivateError] = useState<string | null>(null);

  // ── Row actions: PDF / close / delete ────────────────────────────
  const [pdfLoadingId, setPdfLoadingId] = useState<string | null>(null);
  const [pdfErrors, setPdfErrors] = useState<Record<string, string | null>>({});

  const [solutionsPdfLoadingId, setSolutionsPdfLoadingId] = useState<string | null>(null);
  const [solutionsPdfErrors, setSolutionsPdfErrors] = useState<Record<string, string | null>>({});

  const [visibilityLoadingId, setVisibilityLoadingId] = useState<string | null>(null);
  const [visibilityErrors, setVisibilityErrors] = useState<Record<string, string | null>>({});

  const [onlineLoadingId, setOnlineLoadingId] = useState<string | null>(null);
  const [onlineErrors, setOnlineErrors] = useState<Record<string, string | null>>({});
  const [onlineDisableConfirmId, setOnlineDisableConfirmId] = useState<string | null>(null);
  const [onlineDisableError, setOnlineDisableError] = useState<string | null>(null);

  const [pdfEnabledLoadingId, setPdfEnabledLoadingId] = useState<string | null>(null);
  const [pdfEnabledErrors, setPdfEnabledErrors] = useState<Record<string, string | null>>({});
  const [pdfDisableConfirmId, setPdfDisableConfirmId] = useState<string | null>(null);
  const [pdfDisableError, setPdfDisableError] = useState<string | null>(null);

  const [closeConfirmId, setCloseConfirmId] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);

  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // ── Consegne online monitor (M3F-05, always-on-selection M3F-09) ────
  const [monitorStudents, setMonitorStudents] = useState<StudentItem[] | null>(null);
  const [monitorItems, setMonitorItems] = useState<SubmissionMonitorItem[] | null>(null);
  const [monitorError, setMonitorError] = useState<string | null>(null);
  const [attentionDialog, setAttentionDialog] = useState<{
    studentName: string;
    events: AttentionEvent[];
  } | null>(null);

  useEffect(() => {
    void loadAll();
  }, []);

  // Opens exactly one `submissions` listener, only while a non-draft
  // verification is selected — never globally, never for more than one
  // verification at a time, and never at all for a `draft` (which cannot
  // have submissions yet). Always closed via the effect cleanup when the
  // selection changes (including to null/back to draft) or the component
  // unmounts.
  const selectedVerId = selectedVer?.id ?? null;
  const selectedVerStatus = selectedVer?.status ?? null;
  useEffect(() => {
    if (!selectedVerId || selectedVerStatus === 'draft') return;
    const v = verifications?.find((item) => item.id === selectedVerId);
    if (!v) return;

    let cancelled = false;
    setMonitorError(null);
    setMonitorStudents(null);
    setMonitorItems(null);

    const classId = v.teacherSnapshot?.classId ?? v.config.classId;
    listStudents(ownerUid, db)
      .then((students) => {
        if (cancelled) return;
        const approved = students
          .filter((s) => s.status === 'approved' && s.classId === classId)
          .sort((a, b) => (a.displayName ?? a.email).localeCompare(b.displayName ?? b.email, 'it'));
        setMonitorStudents(approved);
      })
      .catch(() => {
        if (!cancelled) setMonitorError('Impossibile caricare gli studenti della classe.');
      });

    const unsubscribe = watchSubmissions(
      v.id,
      ownerUid,
      db,
      (items) => {
        if (!cancelled) setMonitorItems(items);
      },
      () => {
        if (!cancelled) setMonitorError('Impossibile caricare le consegne.');
      },
    );

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [selectedVerId, selectedVerStatus]);

  async function loadAll() {
    setLoadError(null);
    try {
      const [verList, progList, classList] = await Promise.all([
        listVerifications(ownerUid, db),
        listPrograms(db),
        listClasses(ownerUid, db),
      ]);
      setVerifications(verList);
      setPrograms(progList);
      setClasses(classList);
    } catch {
      setLoadError('Impossibile caricare i dati.');
    }
  }

  async function handleSelectVer(v: VerificationItem) {
    setSelectedVer(v);
    setShowActivateConfirm(false);
    setActivateError(null);
    setQuestionIndex(null);
    setQuestionIndexError(null);
    setMonitorStudents(null);
    setMonitorItems(null);
    setMonitorError(null);
    setAttentionDialog(null);
    setSelectedQuestionIds(new Set(v.config.questionRefs.map((r) => r.questionIndexEntryId)));
    setEditDraftTitle(v.config.title);
    setEditDraftClassId(v.config.classId ?? '');

    if (v.status === 'draft' && v.config.programId && v.config.importId) {
      try {
        const entries = await listQuestionIndex(v.config.programId, v.config.importId, db);
        setQuestionIndex(entries);
      } catch {
        setQuestionIndexError('Impossibile caricare il pool di domande.');
      }
    }
  }

  /**
   * Pure mapping from the current question-picker selection to the stable
   * `VerificationQuestionRef[]` shape stored on the draft config — never the
   * full question text/solution. Shared by the standalone draft save and by
   * activation (which re-saves the selection just before freezing the
   * immutable teacherSnapshot).
   */
  function buildQuestionRefsFromSelection() {
    if (!questionIndex) return null;
    const entryMap = new Map(questionIndex.map((e) => [e.id, e]));
    return Array.from(selectedQuestionIds)
      .map((id) => {
        const entry = entryMap.get(id);
        if (!entry) return null;
        return {
          questionIndexEntryId: entry.id,
          questionLocalId: entry.questionLocalId,
          udaDir: entry.udaDir,
          lessonFilename: entry.lessonFilename,
          poolStorageRef: entry.poolStorageRef,
          tipo: entry.tipo,
          difficolta: entry.difficolta,
          peso: entry.peso,
          maxPoints: entry.maxPoints,
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);
  }

  /**
   * "Salva bozza": persists title, class and the current question selection
   * together in a single `updateVerificationConfig` write — no immutable
   * snapshot is created here (only "Attiva verifica" does that).
   */
  async function handleSaveDraft() {
    if (!selectedVer || selectedVer.status !== 'draft') return;
    const title = editDraftTitle.trim();
    if (!title) return;
    setSavingDraft(true);
    try {
      const classId = editDraftClassId || null;
      const questionRefs = buildQuestionRefsFromSelection();
      const patch = questionRefs === null ? { title, classId } : { title, classId, questionRefs };
      await updateVerificationConfig(selectedVer.id, patch, ownerUid, db);
      const updated = { ...selectedVer, config: { ...selectedVer.config, ...patch } };
      setSelectedVer(updated);
      setVerifications((prev) => prev?.map((v) => (v.id === updated.id ? updated : v)) ?? null);
    } finally {
      setSavingDraft(false);
    }
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    const title = newTitle.trim();
    if (!title || !newProgramId) return;
    setCreating(true);
    setCreateError(null);
    try {
      const program = programs.find((p) => p.id === newProgramId);
      const importId = program?.activeImportId ?? '';
      const newId = await createVerification(
        { title, classId: newClassId || null, programId: newProgramId, importId },
        ownerUid,
        db,
      );
      setNewTitle('');
      setNewProgramId('');
      setNewClassId('');
      const updated = await listVerifications(ownerUid, db);
      setVerifications(updated);
      const created = updated.find((v) => v.id === newId);
      if (created) {
        await handleSelectVer(created);
      }
    } catch {
      setCreateError('Impossibile creare la verifica.');
    } finally {
      setCreating(false);
    }
  }

  async function handleConfirmActivate() {
    if (!selectedVer) return;
    setActivating(true);
    setActivateError(null);
    try {
      const title = editDraftTitle.trim();
      if (!title) {
        setActivateError('Inserisci un titolo prima di attivare la verifica.');
        return;
      }
      const classId = editDraftClassId || null;
      const questionRefs = buildQuestionRefsFromSelection();
      const patch = questionRefs === null ? { title, classId } : { title, classId, questionRefs };
      // Activation must freeze exactly what is currently visible in the draft
      // editor, even when the teacher did not click "Salva bozza" first.
      await updateVerificationConfig(selectedVer.id, patch, ownerUid, db);
      const classItem = classes.find((c) => c.id === classId) ?? null;
      await activateVerification(selectedVer.id, classItem, ownerUid, db, storage);
      setShowActivateConfirm(false);
      const updated = await listVerifications(ownerUid, db);
      setVerifications(updated);
      const refreshed = updated.find((v) => v.id === selectedVer.id);
      if (refreshed) setSelectedVer(refreshed);
    } catch (err) {
      setActivateError(err instanceof Error ? err.message : "Errore durante l'attivazione.");
    } finally {
      setActivating(false);
    }
  }

  /**
   * Resolves what a PDF download should be built from.
   *
   * - `draft`: always `refs` — the current saved/loaded question selection,
   *   re-read from the live pools in Storage (bozze are never frozen).
   * - `active`/`closed` with `teacherSnapshot.questions` (every verification
   *   activated after this fix): `embedded` — the frozen per-question data
   *   (text/options/solution) from activation time, zero Storage reads,
   *   completely independent of whatever the pools look like now.
   * - `active`/`closed` WITHOUT `teacherSnapshot.questions` (legacy —
   *   activated before this fix): `refs`, falling back to the old behavior
   *   of re-reading `teacherSnapshot.questionRefs` from the *current* pool
   *   files. This is intentionally temporary compatibility, not the
   *   long-term contract — see `VerificationTeacherSnapshot.questions` doc
   *   comment in `types/firestore.ts`. A teacher who wants a legacy
   *   verification fully independent from the pools can recreate it
   *   (draft → activate) to get a fresh embedded snapshot.
   */
  function resolvePdfSource(v: VerificationItem):
    | {
        kind: 'embedded';
        title: string;
        className: string | null;
        questions: VerificationTeacherQuestionSnapshot[];
      }
    | {
        kind: 'refs';
        title: string;
        className: string | null;
        questionRefs: VerificationItem['config']['questionRefs'];
      }
    | null {
    if (v.status === 'draft') {
      const classNameResolved = classes.find((c) => c.id === v.config.classId)?.name ?? null;
      return {
        kind: 'refs',
        title: v.config.title,
        questionRefs: v.config.questionRefs,
        className: classNameResolved,
      };
    }
    const snapshot = v.teacherSnapshot;
    if (!snapshot) return null;
    const classNameResolved =
      classes.find((c) => c.id === snapshot.classId)?.name ?? snapshot.className ?? null;
    if (snapshot.questions) {
      return {
        kind: 'embedded',
        title: snapshot.title,
        className: classNameResolved,
        questions: snapshot.questions,
      };
    }
    // Legacy fallback (compatibility only — see doc comment above).
    return {
      kind: 'refs',
      title: snapshot.title,
      questionRefs: snapshot.questionRefs,
      className: classNameResolved,
    };
  }

  async function handleDownloadPdf(v: VerificationItem) {
    if (v.status !== 'draft' && v.status !== 'active' && v.status !== 'closed') return;
    setPdfLoadingId(v.id);
    setPdfErrors((prev) => ({ ...prev, [v.id]: null }));
    try {
      const source = resolvePdfSource(v);
      if (!source) {
        setPdfErrors((prev) => ({
          ...prev,
          [v.id]: 'Snapshot della verifica non disponibile. Riattiva o ricrea la verifica.',
        }));
        return;
      }
      if (source.kind === 'embedded') {
        await downloadStudentPdf(
          { title: source.title },
          source.questions.map(toPdfQuestion),
          source.className,
        );
        return;
      }
      if (source.questionRefs.length === 0) {
        setPdfErrors((prev) => ({
          ...prev,
          [v.id]:
            'La bozza non ha domande selezionate. Aggiungi almeno una domanda prima di scaricare il PDF.',
        }));
        return;
      }
      const result = await loadSelectedQuestions(source.questionRefs, storage);
      if (!result.ok) {
        setPdfErrors((prev) => ({ ...prev, [v.id]: result.error }));
        return;
      }
      await downloadStudentPdf({ title: source.title }, result.questions, source.className);
    } finally {
      setPdfLoadingId(null);
    }
  }

  async function handleDownloadSolutionsPdf(v: VerificationItem) {
    if (v.status !== 'draft' && v.status !== 'active' && v.status !== 'closed') return;
    setSolutionsPdfLoadingId(v.id);
    setSolutionsPdfErrors((prev) => ({ ...prev, [v.id]: null }));
    try {
      const source = resolvePdfSource(v);
      if (!source) {
        setSolutionsPdfErrors((prev) => ({
          ...prev,
          [v.id]: 'Snapshot della verifica non disponibile. Riattiva o ricrea la verifica.',
        }));
        return;
      }
      if (source.kind === 'embedded') {
        await downloadTeacherSolutionsPdf(
          { title: source.title },
          source.questions.map(toPdfQuestionWithSolution),
          source.className,
        );
        return;
      }
      if (source.questionRefs.length === 0) {
        setSolutionsPdfErrors((prev) => ({
          ...prev,
          [v.id]:
            'La bozza non ha domande selezionate. Aggiungi almeno una domanda prima di scaricare il PDF.',
        }));
        return;
      }
      const result = await loadSelectedQuestionsWithSolutions(source.questionRefs, storage);
      if (!result.ok) {
        setSolutionsPdfErrors((prev) => ({ ...prev, [v.id]: result.error }));
        return;
      }
      await downloadTeacherSolutionsPdf(
        { title: source.title },
        result.questions,
        source.className,
      );
    } finally {
      setSolutionsPdfLoadingId(null);
    }
  }

  async function handleToggleVisibility(v: VerificationItem) {
    if (v.status !== 'active') return;
    const nextVisibility: VerificationItem['visibility'] =
      v.visibility === 'public' ? 'hidden' : 'public';
    setVisibilityLoadingId(v.id);
    setVisibilityErrors((prev) => ({ ...prev, [v.id]: null }));
    try {
      await setVerificationVisibility(v.id, nextVisibility, ownerUid, db);
      const updated = { ...v, visibility: nextVisibility };
      setVerifications((prev) => prev?.map((item) => (item.id === v.id ? updated : item)) ?? null);
      if (selectedVer?.id === v.id) setSelectedVer(updated);
    } catch (err) {
      setVisibilityErrors((prev) => ({
        ...prev,
        [v.id]: err instanceof Error ? err.message : 'Impossibile aggiornare la visibilità.',
      }));
    } finally {
      setVisibilityLoadingId(null);
    }
  }

  async function handleEnableOnline(v: VerificationItem) {
    if (v.status !== 'active' || v.onlineEnabled || v.config.classId == null) return;
    setOnlineLoadingId(v.id);
    setOnlineErrors((prev) => ({ ...prev, [v.id]: null }));
    try {
      await setVerificationOnlineEnabled(v.id, true, ownerUid, db);
      const updated = { ...v, onlineEnabled: true };
      setVerifications((prev) => prev?.map((item) => (item.id === v.id ? updated : item)) ?? null);
      if (selectedVer?.id === v.id) setSelectedVer(updated);
    } catch (err) {
      setOnlineErrors((prev) => ({
        ...prev,
        [v.id]: err instanceof Error ? err.message : "Impossibile attivare l'online.",
      }));
    } finally {
      setOnlineLoadingId(null);
    }
  }

  function handleStartDisableOnline(id: string) {
    setOnlineDisableConfirmId(id);
    setOnlineDisableError(null);
    setCloseConfirmId(null);
    setDeleteConfirmId(null);
    setPdfDisableConfirmId(null);
  }

  async function handleConfirmDisableOnline(id: string) {
    setOnlineLoadingId(id);
    setOnlineDisableError(null);
    try {
      await setVerificationOnlineEnabled(id, false, ownerUid, db);
      setOnlineDisableConfirmId(null);
      setVerifications(
        (prev) =>
          prev?.map((item) => (item.id === id ? { ...item, onlineEnabled: false } : item)) ?? null,
      );
      if (selectedVer?.id === id) {
        setSelectedVer((prev) => (prev ? { ...prev, onlineEnabled: false } : prev));
      }
    } catch (err) {
      setOnlineDisableError(
        err instanceof Error ? err.message : "Impossibile disattivare l'online.",
      );
    } finally {
      setOnlineLoadingId(null);
    }
  }

  /** Enabling never needs confirmation — it never publishes/activates anything on its own. */
  async function handleEnableStudentPdf(v: VerificationItem) {
    if (v.studentPdfEnabled) return;
    setPdfEnabledLoadingId(v.id);
    setPdfEnabledErrors((prev) => ({ ...prev, [v.id]: null }));
    try {
      await setVerificationStudentPdfEnabled(v.id, true, ownerUid, db);
      const updated = { ...v, studentPdfEnabled: true };
      setVerifications((prev) => prev?.map((item) => (item.id === v.id ? updated : item)) ?? null);
      if (selectedVer?.id === v.id) setSelectedVer(updated);
    } catch (err) {
      setPdfEnabledErrors((prev) => ({
        ...prev,
        [v.id]: err instanceof Error ? err.message : 'Impossibile abilitare il PDF studente.',
      }));
    } finally {
      setPdfEnabledLoadingId(null);
    }
  }

  function handleStartDisableStudentPdf(id: string) {
    setPdfDisableConfirmId(id);
    setPdfDisableError(null);
    setCloseConfirmId(null);
    setDeleteConfirmId(null);
    setOnlineDisableConfirmId(null);
  }

  async function handleConfirmDisableStudentPdf(id: string) {
    setPdfEnabledLoadingId(id);
    setPdfDisableError(null);
    try {
      await setVerificationStudentPdfEnabled(id, false, ownerUid, db);
      setPdfDisableConfirmId(null);
      setVerifications(
        (prev) =>
          prev?.map((item) => (item.id === id ? { ...item, studentPdfEnabled: false } : item)) ??
          null,
      );
      if (selectedVer?.id === id) {
        setSelectedVer((prev) => (prev ? { ...prev, studentPdfEnabled: false } : prev));
      }
    } catch (err) {
      setPdfDisableError(
        err instanceof Error ? err.message : 'Impossibile disabilitare il PDF studente.',
      );
    } finally {
      setPdfEnabledLoadingId(null);
    }
  }

  function handleOpenAttentionEvents(studentName: string, events: AttentionEvent[]) {
    setAttentionDialog({ studentName, events });
  }

  function handleStartClose(id: string) {
    setCloseConfirmId(id);
    setCloseError(null);
    setDeleteConfirmId(null);
    setOnlineDisableConfirmId(null);
    setPdfDisableConfirmId(null);
  }

  async function handleConfirmClose(id: string) {
    setClosing(true);
    setCloseError(null);
    try {
      await closeVerification(id, ownerUid, db);
      setCloseConfirmId(null);
      const updated = await listVerifications(ownerUid, db);
      setVerifications(updated);
      if (selectedVer?.id === id) {
        const refreshed = updated.find((v) => v.id === id);
        if (refreshed) setSelectedVer(refreshed);
      }
    } catch (err) {
      setCloseError(err instanceof Error ? err.message : 'Errore durante la chiusura.');
    } finally {
      setClosing(false);
    }
  }

  function handleStartDelete(id: string) {
    setDeleteConfirmId(id);
    setDeleteError(null);
    setCloseConfirmId(null);
    setOnlineDisableConfirmId(null);
    setPdfDisableConfirmId(null);
  }

  async function handleConfirmDelete(id: string) {
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteVerification(id, ownerUid, db);
      setVerifications((prev) => prev?.filter((v) => v.id !== id) ?? null);
      setDeleteConfirmId(null);
      if (selectedVer?.id === id) setSelectedVer(null);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Errore durante l'eliminazione.");
    } finally {
      setDeleting(false);
    }
  }

  if (loadError)
    return (
      <p role="alert" className="text-error">
        {loadError}
      </p>
    );
  if (verifications === null)
    return (
      <p aria-busy="true" className="state-loading">
        Caricamento…
      </p>
    );

  const canActivate = selectedQuestionIds.size >= 1;
  const sortedVerifications = sortVerificationsByActivation(verifications);

  return (
    <section aria-label="Verifiche" className={styles.container}>
      {/* ── Create form ── */}
      <form
        aria-label="Nuova verifica"
        className={styles.createForm}
        onSubmit={(e) => void handleCreate(e)}
      >
        <div className={styles.formRow}>
          <label htmlFor="new-ver-title">Titolo</label>
          <input
            id="new-ver-title"
            type="text"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
          />
        </div>

        <div className={styles.formRow}>
          <label htmlFor="new-ver-program">Programma</label>
          <select
            id="new-ver-program"
            value={newProgramId}
            onChange={(e) => setNewProgramId(e.target.value)}
          >
            <option value="">— Seleziona programma —</option>
            {programs.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
        </div>

        <div className={styles.formRow}>
          <label htmlFor="new-ver-class">Classe (opzionale)</label>
          <select
            id="new-ver-class"
            value={newClassId}
            onChange={(e) => setNewClassId(e.target.value)}
          >
            <option value="">— Nessuna classe —</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        {createError && (
          <p role="alert" className="text-error">
            {createError}
          </p>
        )}

        <button
          type="submit"
          className="btn-success"
          disabled={creating || !newTitle.trim() || !newProgramId}
        >
          {creating ? 'Creazione…' : 'Crea verifica'}
        </button>
      </form>

      {/* ── Verification table ── */}
      {verifications.length === 0 ? (
        <p className="state-empty">Nessuna verifica. Creane una.</p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.th}>Titolo</th>
                <th className={styles.th}>Classe</th>
                <th className={styles.th}>Corso</th>
                <th className={`${styles.th} ${styles.statusColumn}`}>Stato</th>
                <th className={styles.th}>Domande</th>
                <th className={styles.th} aria-label="Azioni"></th>
              </tr>
            </thead>
            <tbody>
              {sortedVerifications.map((v) => {
                const programTitle =
                  programs.find((p) => p.id === v.config.programId)?.title ?? v.config.programId;
                const className = v.config.classId
                  ? (classes.find((c) => c.id === v.config.classId)?.name ?? v.config.classId)
                  : '—';
                const questionCount =
                  v.status === 'draft'
                    ? v.config.questionRefs.length
                    : (v.teacherSnapshot?.questionRefs.length ?? v.config.questionRefs.length);

                if (closeConfirmId === v.id) {
                  return (
                    <tr key={v.id} className={styles.confirmRowInline}>
                      <td colSpan={6} className={styles.td}>
                        <div
                          role="region"
                          aria-label="Conferma chiusura"
                          className={styles.confirmBox}
                        >
                          <p className={styles.confirmMsg}>
                            Chiudere <strong>{v.config.title}</strong>? Questa operazione non è
                            reversibile.
                          </p>
                          {closeError && (
                            <p role="alert" className="text-error">
                              {closeError}
                            </p>
                          )}
                          <div className={styles.confirmRow}>
                            <button
                              type="button"
                              className="btn-success"
                              disabled={closing}
                              onClick={() => void handleConfirmClose(v.id)}
                            >
                              {closing ? 'Chiusura…' : 'Conferma chiusura'}
                            </button>
                            <button
                              type="button"
                              onClick={() => setCloseConfirmId(null)}
                              disabled={closing}
                            >
                              Annulla
                            </button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  );
                }

                if (deleteConfirmId === v.id) {
                  return (
                    <tr key={v.id} className={styles.confirmRowInline}>
                      <td colSpan={6} className={styles.td}>
                        <div
                          role="region"
                          aria-label="Conferma eliminazione"
                          className={`${styles.confirmBox} ${styles.confirmBoxDanger}`}
                        >
                          <p className={styles.confirmMsg}>
                            Eliminare definitivamente <strong>{v.config.title}</strong>?
                            L&apos;operazione è irreversibile e non può essere annullata.
                          </p>
                          {deleteError && (
                            <p role="alert" className="text-error">
                              {deleteError}
                            </p>
                          )}
                          <div className={styles.confirmRow}>
                            <button
                              type="button"
                              className="btn-danger"
                              disabled={deleting}
                              onClick={() => void handleConfirmDelete(v.id)}
                            >
                              {deleting ? 'Eliminazione…' : 'Elimina definitivamente'}
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeleteConfirmId(null)}
                              disabled={deleting}
                            >
                              Annulla
                            </button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  );
                }

                if (onlineDisableConfirmId === v.id) {
                  return (
                    <tr key={v.id} className={styles.confirmRowInline}>
                      <td colSpan={6} className={styles.td}>
                        <div
                          role="region"
                          aria-label="Conferma disattivazione online"
                          className={styles.confirmBox}
                        >
                          <p className={styles.confirmMsg}>
                            Le bozze esistenti non potranno essere salvate o consegnate finché
                            l&apos;online resta disabilitato.
                          </p>
                          {onlineDisableError && (
                            <p role="alert" className="text-error">
                              {onlineDisableError}
                            </p>
                          )}
                          <div className={styles.confirmRow}>
                            <button
                              type="button"
                              className="btn-primary"
                              disabled={onlineLoadingId === v.id}
                              onClick={() => void handleConfirmDisableOnline(v.id)}
                            >
                              {onlineLoadingId === v.id ? 'Disattivazione…' : 'Disattiva online'}
                            </button>
                            <button
                              type="button"
                              onClick={() => setOnlineDisableConfirmId(null)}
                              disabled={onlineLoadingId === v.id}
                            >
                              Annulla
                            </button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  );
                }

                if (pdfDisableConfirmId === v.id) {
                  return (
                    <tr key={v.id} className={styles.confirmRowInline}>
                      <td colSpan={6} className={styles.td}>
                        <div
                          role="region"
                          aria-label="Conferma disattivazione PDF studente"
                          className={styles.confirmBox}
                        >
                          <p className={styles.confirmMsg}>
                            Gli studenti non potranno più scaricare il PDF di{' '}
                            <strong>{v.config.title}</strong>.
                          </p>
                          {pdfDisableError && (
                            <p role="alert" className="text-error">
                              {pdfDisableError}
                            </p>
                          )}
                          <div className={styles.confirmRow}>
                            <button
                              type="button"
                              className="btn-primary"
                              disabled={pdfEnabledLoadingId === v.id}
                              onClick={() => void handleConfirmDisableStudentPdf(v.id)}
                            >
                              {pdfEnabledLoadingId === v.id ? 'Disattivazione…' : 'Disattiva PDF'}
                            </button>
                            <button
                              type="button"
                              onClick={() => setPdfDisableConfirmId(null)}
                              disabled={pdfEnabledLoadingId === v.id}
                            >
                              Annulla
                            </button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  );
                }

                return (
                  <Fragment key={v.id}>
                    <tr className={styles.row}>
                      <td className={styles.td}>
                        <button
                          type="button"
                          className={styles.verTitleBtn}
                          aria-pressed={selectedVer?.id === v.id}
                          aria-label={`Apri dettaglio verifica ${v.config.title}`}
                          onClick={() => void handleSelectVer(v)}
                        >
                          {v.config.title}
                        </button>
                        {v.status !== 'draft' && (
                          <span className={styles.verTimestamps}>
                            Attivata: {formatTimestamp(v.activatedAt)}
                            {v.status === 'closed' && <> · Chiusa: {formatTimestamp(v.closedAt)}</>}
                          </span>
                        )}
                      </td>
                      <td className={`${styles.td} ${styles.metaCell}`}>{className}</td>
                      <td className={`${styles.td} ${styles.metaCell}`}>{programTitle}</td>
                      <td className={styles.td}>
                        <StatusBadge status={v.status} visibility={v.visibility} />
                        {v.status === 'active' && (
                          <div className={styles.onlineControl}>
                            <button
                              type="button"
                              role="switch"
                              aria-checked={v.onlineEnabled}
                              aria-label={`${v.onlineEnabled ? 'Disattiva' : 'Attiva'} online — ${v.config.title}`}
                              title={
                                v.config.classId == null
                                  ? 'Assegna una classe alla verifica per abilitare l’online'
                                  : v.onlineEnabled
                                    ? 'Online attivo'
                                    : 'Online disattivato'
                              }
                              className={`${styles.onlineSwitch} ${v.onlineEnabled ? styles.onlineSwitchOn : ''}`}
                              disabled={
                                onlineLoadingId === v.id ||
                                (!v.onlineEnabled && v.config.classId == null)
                              }
                              onClick={() =>
                                v.onlineEnabled
                                  ? handleStartDisableOnline(v.id)
                                  : void handleEnableOnline(v)
                              }
                            >
                              <span className={styles.onlineSwitchThumb} />
                            </button>
                            <span className={styles.onlineLabel}>
                              {v.config.classId == null
                                ? 'Nessuna classe'
                                : v.onlineEnabled
                                  ? 'Online attivo'
                                  : 'Online disattivato'}
                            </span>
                          </div>
                        )}
                      </td>
                      <td className={`${styles.td} ${styles.metaCell}`}>{questionCount}</td>
                      <td className={styles.tdActions}>
                        <div className={styles.actionsWrapper}>
                          <button
                            type="button"
                            className={styles.iconBtn}
                            title="Scarica PDF studenti"
                            aria-label={`Scarica PDF studenti — ${v.config.title}`}
                            disabled={pdfLoadingId === v.id}
                            onClick={() => void handleDownloadPdf(v)}
                          >
                            {pdfLoadingId === v.id ? '…' : '⬇️'}
                          </button>
                          <button
                            type="button"
                            className={styles.iconBtn}
                            title="Scarica PDF soluzioni"
                            aria-label={`Scarica PDF soluzioni — ${v.config.title}`}
                            disabled={solutionsPdfLoadingId === v.id}
                            onClick={() => void handleDownloadSolutionsPdf(v)}
                          >
                            {solutionsPdfLoadingId === v.id ? '…' : '🔑'}
                          </button>
                          {v.status === 'active' && (
                            <button
                              type="button"
                              className={styles.iconBtn}
                              title={
                                v.visibility === 'public'
                                  ? 'Nascondi allo studente'
                                  : 'Pubblica allo studente'
                              }
                              aria-label={`${v.visibility === 'public' ? 'Nascondi' : 'Pubblica'} allo studente — ${v.config.title}`}
                              disabled={visibilityLoadingId === v.id}
                              onClick={() => void handleToggleVisibility(v)}
                            >
                              {visibilityLoadingId === v.id
                                ? '…'
                                : v.visibility === 'public'
                                  ? '🙈'
                                  : '👁️'}
                            </button>
                          )}
                          <button
                            type="button"
                            className={`${styles.iconBtn}${v.studentPdfEnabled ? ` ${styles.iconBtnActive}` : ''}`}
                            title={
                              v.studentPdfEnabled
                                ? 'Disabilita PDF studente'
                                : 'Abilita PDF studente'
                            }
                            aria-label={`${v.studentPdfEnabled ? 'Disabilita' : 'Abilita'} PDF studente — ${v.config.title}`}
                            aria-pressed={v.studentPdfEnabled}
                            disabled={pdfEnabledLoadingId === v.id}
                            onClick={() =>
                              v.studentPdfEnabled
                                ? handleStartDisableStudentPdf(v.id)
                                : void handleEnableStudentPdf(v)
                            }
                          >
                            📄
                          </button>
                          {v.status === 'active' && (
                            <button
                              type="button"
                              className={styles.iconBtn}
                              title="Chiudi verifica"
                              aria-label={`Chiudi verifica — ${v.config.title}`}
                              onClick={() => handleStartClose(v.id)}
                            >
                              🔒
                            </button>
                          )}
                          {(v.status === 'draft' || v.status === 'closed') && (
                            <button
                              type="button"
                              className={styles.iconBtn}
                              title="Elimina verifica"
                              aria-label={`Elimina verifica — ${v.config.title}`}
                              onClick={() => handleStartDelete(v.id)}
                            >
                              🗑️
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                    {pdfErrors[v.id] && (
                      <tr>
                        <td colSpan={6} className={styles.td}>
                          <p role="alert" className="text-error">
                            {pdfErrors[v.id]}
                          </p>
                        </td>
                      </tr>
                    )}
                    {solutionsPdfErrors[v.id] && (
                      <tr>
                        <td colSpan={6} className={styles.td}>
                          <p role="alert" className="text-error">
                            {solutionsPdfErrors[v.id]}
                          </p>
                        </td>
                      </tr>
                    )}
                    {onlineErrors[v.id] && (
                      <tr>
                        <td colSpan={6} className={styles.td}>
                          <p role="alert" className="text-error">
                            {onlineErrors[v.id]}
                          </p>
                        </td>
                      </tr>
                    )}
                    {visibilityErrors[v.id] && (
                      <tr>
                        <td colSpan={6} className={styles.td}>
                          <p role="alert" className="text-error">
                            {visibilityErrors[v.id]}
                          </p>
                        </td>
                      </tr>
                    )}
                    {pdfEnabledErrors[v.id] && (
                      <tr>
                        <td colSpan={6} className={styles.td}>
                          <p role="alert" className="text-error">
                            {pdfEnabledErrors[v.id]}
                          </p>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Detail panel — draft configuration only; active/closed show a compact summary ── */}
      {selectedVer && (
        <div className={styles.detail} aria-label="Dettaglio verifica">
          <div className={styles.detailHeader}>
            <h2 className={styles.detailTitle}>{selectedVer.config.title}</h2>
            <StatusBadge status={selectedVer.status} visibility={selectedVer.visibility} />
            <span className={styles.pdfStatusBadge} aria-live="polite">
              PDF studente: {selectedVer.studentPdfEnabled ? 'abilitato' : 'disabilitato'}
            </span>
          </div>

          {/* ── Draft: edit title/class ── */}
          {selectedVer.status === 'draft' && (
            <div className={styles.draftEditForm}>
              <label htmlFor="draft-title">Titolo bozza</label>
              <input
                id="draft-title"
                type="text"
                value={editDraftTitle}
                onChange={(e) => setEditDraftTitle(e.target.value)}
              />
              <label htmlFor="draft-class">Classe</label>
              <select
                id="draft-class"
                value={editDraftClassId}
                onChange={(e) => setEditDraftClassId(e.target.value)}
              >
                <option value="">— Nessuna classe —</option>
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* ── Draft: question selection + activate ── */}
          {selectedVer.status === 'draft' && (
            <>
              <div>
                <h3 className={styles.createTitle}>Selezione domande</h3>
                {questionIndexError && (
                  <p role="alert" className="text-error">
                    {questionIndexError}
                  </p>
                )}
                {questionIndex === null && !questionIndexError && (
                  <p aria-busy="true" className="state-loading">
                    Caricamento domande…
                  </p>
                )}
                {questionIndex !== null && questionIndex.length === 0 && (
                  <p className="state-empty">Nessuna domanda disponibile per questo programma.</p>
                )}
                {questionIndex !== null && questionIndex.length > 0 && (
                  <QuestionPicker
                    entries={questionIndex}
                    selectedIds={selectedQuestionIds}
                    onChange={setSelectedQuestionIds}
                  />
                )}
              </div>

              {/* Salva bozza + Attiva verifica — kept side by side, in this order */}
              {!showActivateConfirm ? (
                <div className={styles.draftActionBar}>
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={savingDraft || !editDraftTitle.trim()}
                    onClick={() => void handleSaveDraft()}
                  >
                    {savingDraft ? 'Salvataggio…' : 'Salva bozza'}
                  </button>
                  <button
                    type="button"
                    className="btn-success"
                    disabled={!canActivate}
                    onClick={() => setShowActivateConfirm(true)}
                    aria-label="Attiva verifica"
                  >
                    Attiva verifica
                  </button>
                </div>
              ) : (
                <div
                  className={styles.confirmPanel}
                  role="region"
                  aria-label="Conferma attivazione"
                >
                  <p className={styles.confirmMsg}>
                    Dopo l&apos;attivazione la configurazione non sarà più modificabile. Continuare?
                  </p>
                  {activateError && (
                    <p role="alert" className="text-error">
                      {activateError}
                    </p>
                  )}
                  <div className={styles.confirmRow}>
                    <button
                      type="button"
                      className="btn-success"
                      disabled={activating}
                      onClick={() => void handleConfirmActivate()}
                    >
                      {activating ? 'Attivazione…' : 'Conferma attivazione'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowActivateConfirm(false)}
                      disabled={activating}
                    >
                      Annulla
                    </button>
                  </div>
                </div>
              )}
            </>
          )}

          {/* ── Active / closed: compact read-only summary — actions live in the table row ── */}
          {selectedVer.status !== 'draft' && (
            <p className={styles.detailMeta}>
              Programma: {programTitle(selectedVer, programs)}
              {selectedVer.config.classId &&
                ` · Classe: ${classes.find((c) => c.id === selectedVer.config.classId)?.name ?? selectedVer.config.classId}`}
              {' · Domande configurate: '}
              {(selectedVer.teacherSnapshot?.questionRefs.length ??
                selectedVer.config.questionRefs.length) ||
                0}
            </p>
          )}

          {/* ── Consegne online monitor (M3F-05) — hidden entirely for draft (M3F-11C) ── */}
          {selectedVer.status !== 'draft' && (
            <div role="region" aria-label="Consegne online" className={styles.monitorPanel}>
              <h3 className={styles.createTitle}>Consegne online</h3>
              <>
                {monitorError && (
                  <p role="alert" className="text-error">
                    {monitorError}
                  </p>
                )}
                {!monitorError &&
                  (monitorStudents === null ||
                    (monitorStudents.length > 0 && monitorItems === null)) && (
                    <p aria-busy="true" className="state-loading">
                      Caricamento consegne…
                    </p>
                  )}
                {!monitorError && monitorStudents !== null && monitorStudents.length === 0 && (
                  <p className="state-empty">Nessuno studente approvato in questa classe.</p>
                )}
                {!monitorError &&
                  monitorStudents !== null &&
                  monitorStudents.length > 0 &&
                  monitorItems !== null && (
                    <div className={styles.tableWrap}>
                      <table className={styles.table}>
                        <thead>
                          <tr>
                            <th className={styles.th}>Studente</th>
                            <th className={styles.th}>Stato</th>
                            <th className={styles.th}>Ultimo salvataggio</th>
                            <th className={styles.th}>Consegnata il</th>
                            <th className={styles.th}>Eventi</th>
                            <th className={styles.th}>Codice</th>
                          </tr>
                        </thead>
                        <tbody>
                          {monitorStudents.map((s) => {
                            const item = monitorItems?.find((m) => m.studentUid === s.id);
                            const stateLabel = !item
                              ? 'Non iniziata'
                              : item.status === 'submitted'
                                ? 'Consegnata'
                                : 'In corso';
                            const studentName = s.displayName ?? s.email;
                            const eventsCount = item?.attentionEventsCount ?? 0;
                            return (
                              <tr key={s.id} className={styles.row}>
                                <td className={styles.td}>{studentName}</td>
                                <td className={styles.td}>{stateLabel}</td>
                                <td className={`${styles.td} ${styles.metaCell}`}>
                                  {item ? formatTimestamp(item.lastSavedAt) : '—'}
                                </td>
                                <td className={`${styles.td} ${styles.metaCell}`}>
                                  {item ? formatTimestamp(item.submittedAt) : '—'}
                                </td>
                                <td className={`${styles.td} ${styles.metaCell}`}>
                                  {eventsCount > 0 ? (
                                    <button
                                      type="button"
                                      className={styles.eventsBtn}
                                      aria-label={`Eventi di attenzione — ${studentName}`}
                                      onClick={() =>
                                        handleOpenAttentionEvents(
                                          studentName,
                                          item?.attentionEvents ?? [],
                                        )
                                      }
                                    >
                                      {eventsCount}
                                    </button>
                                  ) : (
                                    eventsCount
                                  )}
                                </td>
                                <td className={`${styles.td} ${styles.metaCell}`}>
                                  {item?.deliveryCode ?? '—'}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
              </>
            </div>
          )}
        </div>
      )}

      {attentionDialog && (
        <AttentionEventsDialog
          studentName={attentionDialog.studentName}
          events={attentionDialog.events}
          onClose={() => setAttentionDialog(null)}
        />
      )}
    </section>
  );
}

function programTitle(v: VerificationItem, programs: ProgramItem[]): string {
  return programs.find((p) => p.id === v.config.programId)?.title ?? v.config.programId;
}
