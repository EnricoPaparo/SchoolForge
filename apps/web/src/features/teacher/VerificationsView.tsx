import { Fragment, type FormEvent, useEffect, useMemo, useRef, useState } from 'react';
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
import { cleanupOrphanVerificationProjections } from '../repository/verifications/orphanProjectionCleanup.js';
import {
  listQuestionIndex,
  type QuestionIndexEntry,
} from '../repository/verifications/questionIndexService.js';
import {
  watchSubmissions,
  type SubmissionMonitorItem,
} from '../repository/verifications/submissionsMonitorService.js';
import { listClasses, type ClassItem } from '../repository/classes/classesService.js';
import {
  getImportMeta,
  listPrograms,
  type ProgramItem,
} from '../repository/programs/programsService.js';
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
import { db, functions, storage } from '../../lib/firebase.js';
import { useAuth } from '../../lib/auth.js';
import { QuestionPicker } from './QuestionPicker.js';
import { AttentionEventsDialog } from './AttentionEventsDialog.js';
import { CorrectionWorkspace } from './CorrectionWorkspace.js';
import { AiBatchCorrectionDialog } from './AiBatchCorrectionDialog.js';
import { BatchCorrectionActionsDialog } from './BatchCorrectionActionsDialog.js';
import { createAiCorrectionCallables } from '../repository/corrections/aiCorrectionClient.js';
import {
  loadCorrectionProgressByStudent,
  isClearable,
  type CorrectionProgress,
} from '../repository/corrections/correctionProgressService.js';
import { ClearCorrectionDialog } from './ClearCorrectionDialog.js';
import type {
  BatchAction,
  BatchSelectedRow,
} from '../repository/corrections/batchCorrectionActions.js';
import { deleteSubmissionData } from '../repository/verifications/deleteSubmissionData.js';
import {
  IconTrash,
  IconSparkles,
  IconCircleCheck,
  IconRotateCcw,
  IconSend,
  IconEraser,
} from '../../components/icons.js';
import type { AttentionEvent, VerificationTeacherQuestionSnapshot } from '../../types/firestore.js';
import { correctionStatusLabel } from '../repository/corrections/submissionCorrectionStatus.js';
import {
  buildCorrectionRegisterCsvFilename,
  buildCorrectionRegisterExportRows,
  downloadCorrectionRegisterCsv,
  serializeCorrectionRegisterCsv,
  type CorrectionRegisterExportRow,
} from '../repository/corrections/correctionRegisterExport.js';
import { downloadCorrectionRegisterPdf } from '../repository/corrections/correctionRegisterPdf.js';
import {
  sortSubmissionMonitorRows,
  type SubmissionMonitorSortConfig,
  type SubmissionMonitorSortKey,
} from '../repository/verifications/submissionMonitorSort.js';
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

function formatPercentage(item: SubmissionMonitorItem | null): string {
  const summary = item?.correctionSummary;
  if (!summary || summary.percentage === null || item?.correctionStatus === 'submitted') return '—';
  return `${summary.percentage}%`;
}

// ── Archive filters (VUX-01) ──────────────────────────────────────────────
const FILTER_ALL = '__all__';
const YEAR_NONE = '__none_year__';
const CLASS_NONE = '__none_class__';

/** Stable cache key for an exact (programId, importId) pair. */
function importKey(programId: string, importId: string): string {
  return `${programId}|${importId}`;
}

/**
 * The school year for a verification comes from the EXACT import the
 * verification used (`config.importId`) — never the program's currently
 * active import — read from the shared `annoByKey` cache. Legacy/missing
 * metadata (or a verification without programId/importId) yields `null`,
 * shown as "—" and grouped under "Senza anno".
 */
function verificationYear(
  v: VerificationItem,
  annoByKey: Map<string, string | null>,
): string | null {
  const { programId, importId } = v.config;
  if (!programId || !importId) return null;
  return annoByKey.get(importKey(programId, importId)) ?? null;
}

/** Distinct school years present in the list, most recent first. */
function distinctYears(list: VerificationItem[], annoByKey: Map<string, string | null>): string[] {
  const set = new Set<string>();
  for (const v of list) {
    const year = verificationYear(v, annoByKey);
    if (year) set.add(year);
  }
  return [...set].sort((a, b) => b.localeCompare(a));
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

  // ── Archive: school-year cache + filters (VUX-01) ───────────────
  // `annoByKey` caches the school year per exact (programId, importId)
  // pair, so getImportMeta is called once per distinct pair and shared
  // across every verification that uses it. `annoRequestedRef` dedupes
  // requests across re-renders (never fetch the same pair twice).
  const [annoByKey, setAnnoByKey] = useState<Map<string, string | null>>(new Map());
  const annoRequestedRef = useRef<Set<string>>(new Set());
  const [yearFilter, setYearFilter] = useState<string>(FILTER_ALL);
  const yearInitialized = useRef(false);
  const [classFilter, setClassFilter] = useState<string>(FILTER_ALL);
  const [search, setSearch] = useState('');

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
  const [draftSaveStatus, setDraftSaveStatus] = useState<
    'idle' | 'dirty' | 'saving' | 'saved' | 'error'
  >('idle');
  const [draftSavedAt, setDraftSavedAt] = useState<string | null>(null);
  const [draftSaveError, setDraftSaveError] = useState<string | null>(null);
  const draftRevisionRef = useRef(0);

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
  const [csvExportError, setCsvExportError] = useState<string | null>(null);
  const [pdfExportError, setPdfExportError] = useState<string | null>(null);
  const [exportingPdf, setExportingPdf] = useState(false);
  const exportingPdfRef = useRef(false);
  const [monitorSort, setMonitorSort] = useState<SubmissionMonitorSortConfig>({
    key: 'student',
    direction: 'asc',
  });
  const [attentionDialog, setAttentionDialog] = useState<{
    studentName: string;
    events: AttentionEvent[];
  } | null>(null);

  // ── Delete submission (M4-LIFE-02) ────────────────────────────────
  const [submissionDeleteTarget, setSubmissionDeleteTarget] = useState<{
    studentUid: string;
    studentName: string;
  } | null>(null);
  const [deletingSubmission, setDeletingSubmission] = useState(false);
  const [submissionDeleteError, setSubmissionDeleteError] = useState<string | null>(null);

  // ── Correction workspace (M4-02) ──────────────────────────────────
  const [correctionTarget, setCorrectionTarget] = useState<{
    submissionId: string;
    studentName: string;
  } | null>(null);
  // M5-04C — «Azzera correzione»: consegna target del dialog di conferma.
  const [clearTarget, setClearTarget] = useState<{
    submissionId: string;
    studentName: string;
    studentUid: string;
  } | null>(null);

  // ── Batch AI correction (M5-03, mock) ─────────────────────────────
  // Selezione stabile per studentUid (non per indice), così resta valida
  // durante ordinamento e aggiornamenti live della tabella.
  const [aiSelectedUids, setAiSelectedUids] = useState<Set<string>>(new Set());
  const [aiDialogOpen, setAiDialogOpen] = useState(false);
  // M5-04: azione massiva in conferma (Completa/Riapri/Restituisci) o null.
  const [batchAction, setBatchAction] = useState<BatchAction | null>(null);
  // «Valutate» n/totale per studentUid: singola lettura mirata (no listener).
  const [correctionProgress, setCorrectionProgress] = useState<Map<string, CorrectionProgress>>(
    new Map(),
  );
  const aiCallables = useMemo(() => createAiCorrectionCallables(functions), []);

  const sortedMonitorRows = useMemo(() => {
    if (!monitorStudents || !monitorItems) return [];
    const rows = monitorStudents.map((student) => {
      const item = monitorItems.find((candidate) => candidate.studentUid === student.id) ?? null;
      const stateLabel = !item
        ? 'Non iniziata'
        : item.status === 'submitted'
          ? correctionStatusLabel(item.correctionStatus)
          : 'In corso';
      return {
        studentUid: student.id,
        studentName: student.displayName ?? student.email,
        stateLabel,
        item,
      };
    });
    return sortSubmissionMonitorRows(rows, monitorSort);
  }, [monitorStudents, monitorItems, monitorSort]);

  // ── Batch AI selection helpers (M5-03) ────────────────────────────
  const selectableUids = useMemo(
    () => sortedMonitorRows.filter((r) => r.item?.status === 'submitted').map((r) => r.studentUid),
    [sortedMonitorRows],
  );
  const allSelectableSelected =
    selectableUids.length > 0 && selectableUids.every((uid) => aiSelectedUids.has(uid));
  const aiSelectedSubmissionIds = useMemo(
    () => (selectedVer ? [...aiSelectedUids].map((uid) => `${selectedVer.id}_${uid}`) : []),
    [aiSelectedUids, selectedVer],
  );
  // M5-04: righe selezionate arricchite col progresso già letto (stesso dato di
  // «Valutate», nessuna lettura aggiuntiva) per calcolare l'eleggibilità.
  const batchSelectedRows = useMemo<BatchSelectedRow[]>(
    () =>
      selectedVer
        ? sortedMonitorRows
            .filter((r) => aiSelectedUids.has(r.studentUid))
            .map((r) => ({
              studentUid: r.studentUid,
              studentName: r.studentName,
              submissionId: `${selectedVer.id}_${r.studentUid}`,
              progress: correctionProgress.get(r.studentUid),
            }))
        : [],
    [selectedVer, sortedMonitorRows, aiSelectedUids, correctionProgress],
  );

  function toggleRowSelected(uid: string): void {
    setAiSelectedUids((prev) => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid);
      else next.add(uid);
      return next;
    });
  }

  function toggleSelectAll(): void {
    setAiSelectedUids(() =>
      selectableUids.every((uid) => aiSelectedUids.has(uid)) ? new Set() : new Set(selectableUids),
    );
  }

  function formatValutate(studentUid: string): string {
    const p = correctionProgress.get(studentUid);
    return p && p.total > 0 ? `${p.evaluated}/${p.total}` : '—';
  }

  async function refreshCorrectionProgress(): Promise<void> {
    if (!selectedVer) return;
    try {
      setCorrectionProgress(await loadCorrectionProgressByStudent(selectedVer.id, db));
    } catch {
      /* non-blocking: la tabella resta usabile con i dati precedenti */
    }
  }

  function toggleMonitorSort(key: SubmissionMonitorSortKey): void {
    setMonitorSort((current) => ({
      key,
      direction: current.key === key && current.direction === 'asc' ? 'desc' : 'asc',
    }));
  }

  function monitorSortAria(key: SubmissionMonitorSortKey): 'ascending' | 'descending' | 'none' {
    if (monitorSort.key !== key) return 'none';
    return monitorSort.direction === 'asc' ? 'ascending' : 'descending';
  }

  function monitorSortLabel(key: SubmissionMonitorSortKey, label: string): string {
    const nextDirection =
      monitorSort.key === key && monitorSort.direction === 'asc' ? 'decrescente' : 'crescente';
    return `Ordina per ${label.toLocaleLowerCase('it-IT')} ${nextDirection}`;
  }

  function monitorSortIndicator(key: SubmissionMonitorSortKey): string {
    if (monitorSort.key !== key) return '';
    return monitorSort.direction === 'asc' ? ' ↑' : ' ↓';
  }

  /**
   * Builds the canonical export model from the SORTED monitor rows already in
   * memory — the single place that maps student/email/submission, shared by the
   * CSV and PDF exports so neither handler duplicates it. No Firestore read.
   * Rows preserve the current table order.
   */
  function buildCurrentExport(): {
    rows: CorrectionRegisterExportRow[];
    title: string;
    className: string | null;
  } | null {
    if (!selectedVer || !monitorStudents || sortedMonitorRows.length === 0) return null;
    const emailByUid = new Map(monitorStudents.map((student) => [student.id, student.email]));
    const rows = buildCorrectionRegisterExportRows(
      sortedMonitorRows.map((row) => ({
        studentName: row.studentName,
        studentEmail: emailByUid.get(row.studentUid) ?? null,
        submission: row.item,
      })),
    );
    const className =
      selectedVer.teacherSnapshot?.className ??
      classes.find((item) => item.id === selectedVer.config.classId)?.name ??
      null;
    return { rows, title: selectedVer.config.title, className };
  }

  function handleExportCorrectionRegisterCsv(): void {
    const model = buildCurrentExport();
    if (!model) return;
    setCsvExportError(null);
    try {
      downloadCorrectionRegisterCsv(
        serializeCorrectionRegisterCsv(model.rows),
        buildCorrectionRegisterCsvFilename({ title: model.title, className: model.className }),
      );
    } catch {
      setCsvExportError('Impossibile esportare il Registro Correzioni. Riprova.');
    }
  }

  async function handleExportCorrectionRegisterPdf(): Promise<void> {
    // Synchronous double-click guard (the `exportingPdf` state can be raced
    // before the re-render).
    if (exportingPdfRef.current) return;
    const model = buildCurrentExport();
    if (!model) return;
    exportingPdfRef.current = true;
    setExportingPdf(true);
    setPdfExportError(null);
    try {
      await downloadCorrectionRegisterPdf({
        verificationTitle: model.title,
        className: model.className,
        rows: model.rows,
      });
    } catch {
      setPdfExportError('Impossibile generare il PDF del riepilogo. Riprova.');
    } finally {
      exportingPdfRef.current = false;
      setExportingPdf(false);
    }
  }

  useEffect(() => {
    void loadAll();
  }, []);

  // Resolves the school year for every distinct (programId, importId) pair
  // in the list — one getImportMeta per pair, cached and shared. No Storage
  // read, no realtime listener. Missing/legacy metadata resolves to null
  // (shown as "—" / "Senza anno") and never blocks the list, which renders
  // immediately while years fill in.
  useEffect(() => {
    if (!verifications) return;
    const toFetch: { key: string; programId: string; importId: string }[] = [];
    for (const v of verifications) {
      const { programId, importId } = v.config;
      if (!programId || !importId) continue;
      const key = importKey(programId, importId);
      if (annoRequestedRef.current.has(key)) continue;
      annoRequestedRef.current.add(key);
      toFetch.push({ key, programId, importId });
    }
    if (toFetch.length === 0) return;

    let cancelled = false;
    void (async () => {
      const results = await Promise.all(
        toFetch.map(async ({ key, programId, importId }) => {
          try {
            const meta = await getImportMeta(programId, importId, db);
            // A resolved `null` is a legitimate "Senza anno" and is cached.
            return { key, ok: true, year: meta?.annoScolastico ?? null } as const;
          } catch {
            // A transient throw must NOT be frozen as "Senza anno".
            return { key, ok: false } as const;
          }
        }),
      );
      if (cancelled) return;
      // Free every errored key so a later list refresh can retry it — but do
      // not retry in a loop here.
      for (const r of results) if (!r.ok) annoRequestedRef.current.delete(r.key);
      const resolved = results.filter(
        (r): r is { key: string; ok: true; year: string | null } => r.ok,
      );
      if (resolved.length === 0) return;
      // Functional update: merge into the LATEST map so concurrent resolutions
      // for different pairs never overwrite each other. Pure/StrictMode-safe —
      // no side effects inside the updater.
      setAnnoByKey((prev) => {
        const next = new Map(prev);
        for (const r of resolved) next.set(r.key, r.year);
        return next;
      });
    })();
    return () => {
      cancelled = true;
    };
    // Driven by `verifications` changing; per-pair dedup lives in the ref.
  }, [verifications]);

  // Auto-selects the most recent year exactly once, only after the initial
  // pairs have resolved (every pair with ids is present in the cache — errored
  // pairs, freed above, are retried on a later refresh and don't count as
  // resolved). Uses "Tutti gli anni" when no year exists, and never overrides
  // a manual choice.
  useEffect(() => {
    if (yearInitialized.current || !verifications) return;
    const allResolved = verifications.every((v) => {
      const { programId, importId } = v.config;
      if (!programId || !importId) return true;
      return annoByKey.has(importKey(programId, importId));
    });
    if (!allResolved) return;
    yearInitialized.current = true;
    const years = distinctYears(verifications, annoByKey);
    if (years.length > 0) setYearFilter(years[0]!);
  }, [verifications, annoByKey]);

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
    setAiSelectedUids(new Set());
    setCorrectionProgress(new Map());

    // «Valutate»: singola lettura mirata delle correzioni della verifica
    // (owner-only per Rules, nessun listener, nessun polling).
    loadCorrectionProgressByStudent(v.id, db)
      .then((progress) => {
        if (!cancelled) setCorrectionProgress(progress);
      })
      .catch(() => undefined);

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
      // One-time repair for projections left by the old non-cascading delete
      // flow. It is deliberately non-blocking: the teacher archive is usable
      // even if maintenance must retry on the next visit.
      void cleanupOrphanVerificationProjections(
        ownerUid,
        new Set(verList.map((item) => item.id)),
        db,
      ).catch(() => undefined);
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
    setCsvExportError(null);
    setAttentionDialog(null);
    setSelectedQuestionIds(new Set(v.config.questionRefs.map((r) => r.questionIndexEntryId)));
    setEditDraftTitle(v.config.title);
    setEditDraftClassId(v.config.classId ?? '');
    draftRevisionRef.current = 0;
    setDraftSaveStatus('idle');
    setDraftSavedAt(null);
    setDraftSaveError(null);

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

  function markDraftDirty() {
    draftRevisionRef.current += 1;
    setDraftSaveStatus('dirty');
    setDraftSavedAt(null);
    setDraftSaveError(null);
  }

  function handleQuestionSelectionChange(next: Set<string>) {
    setSelectedQuestionIds(next);
    markDraftDirty();
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
    const savedRevision = draftRevisionRef.current;
    setSavingDraft(true);
    setDraftSaveStatus('saving');
    setDraftSaveError(null);
    try {
      const classId = editDraftClassId || null;
      const questionRefs = buildQuestionRefsFromSelection();
      const patch = questionRefs === null ? { title, classId } : { title, classId, questionRefs };
      await updateVerificationConfig(selectedVer.id, patch, ownerUid, db);
      const updated = { ...selectedVer, config: { ...selectedVer.config, ...patch } };
      setSelectedVer(updated);
      setVerifications((prev) => prev?.map((v) => (v.id === updated.id ? updated : v)) ?? null);
      if (draftRevisionRef.current === savedRevision) {
        setDraftSaveStatus('saved');
        setDraftSavedAt(
          new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }),
        );
      } else {
        setDraftSaveStatus('dirty');
      }
    } catch (error) {
      setDraftSaveStatus('error');
      setDraftSaveError(error instanceof Error ? error.message : 'Impossibile salvare la bozza.');
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
      const program = readyPrograms.find((p) => p.id === newProgramId);
      if (!program?.activeImportId) {
        setCreateError('Seleziona un corso pronto con una importazione attiva.');
        return;
      }
      const importId = program.activeImportId;
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
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : 'Impossibile creare la verifica.');
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
      // Success: close the draft detail and return to the list, which now
      // shows the just-activated verification with its refreshed status. On
      // error we fall through to the catch and stay in the detail with the
      // error visible.
      setSelectedVer(null);
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

  async function handleConfirmDeleteSubmission() {
    if (!selectedVer || !submissionDeleteTarget || deletingSubmission) return;
    const { studentUid } = submissionDeleteTarget;
    const submissionId = `${selectedVer.id}_${studentUid}`;
    setDeletingSubmission(true);
    setSubmissionDeleteError(null);
    try {
      await deleteSubmissionData(submissionId, ownerUid, db);
      // Update local state without reopening the monitor listener: drop the
      // deleted student's row data. The still-open watchSubmissions listener
      // converges to the same result.
      setMonitorItems((prev) => prev?.filter((m) => m.studentUid !== studentUid) ?? prev);
      setSubmissionDeleteTarget(null);
    } catch (err) {
      setSubmissionDeleteError(
        err instanceof Error ? err.message : 'Errore durante l’eliminazione della consegna.',
      );
    } finally {
      setDeletingSubmission(false);
    }
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

  // ── Derived: filter options + filtered/sorted list (VUX-01) ──────
  const programTitleById = useMemo(() => new Map(programs.map((p) => [p.id, p.title])), [programs]);
  const readyPrograms = useMemo(
    () => programs.filter((program) => Boolean(program.activeImportId)),
    [programs],
  );
  const classNameById = useMemo(() => new Map(classes.map((c) => [c.id, c.name])), [classes]);

  const verList = verifications ?? [];
  const yearOptions = useMemo(() => distinctYears(verList, annoByKey), [verList, annoByKey]);
  const hasNoYear = useMemo(
    () => verList.some((v) => !verificationYear(v, annoByKey)),
    [verList, annoByKey],
  );
  const classOptions = useMemo(() => {
    const set = new Set<string>();
    // Readable class names only — an unresolved classId is never shown as an
    // option (no technical id leaks into the filter).
    for (const v of verList) {
      const name = v.config.classId ? (classNameById.get(v.config.classId) ?? null) : null;
      if (name) set.add(name);
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [verList, classNameById]);
  const hasNoClass = useMemo(() => verList.some((v) => !v.config.classId), [verList]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = verList.filter((v) => {
      const year = verificationYear(v, annoByKey);
      if (yearFilter === YEAR_NONE && year) return false;
      if (yearFilter !== FILTER_ALL && yearFilter !== YEAR_NONE && year !== yearFilter)
        return false;

      // Resolved class name only (no id fallback) — used both for matching the
      // class filter and for the search haystack.
      const className = v.config.classId ? (classNameById.get(v.config.classId) ?? null) : null;
      if (classFilter === CLASS_NONE && className) return false;
      if (classFilter !== FILTER_ALL && classFilter !== CLASS_NONE && className !== classFilter)
        return false;

      if (q) {
        // Search text only — never technical ids: resolved titles/names or an
        // empty string, so a raw programId/classId can never match.
        const programTitleResolved = programTitleById.get(v.config.programId) ?? '';
        const haystack =
          `${v.config.title} ${programTitleResolved} ${className ?? ''}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
    return sortVerificationsByActivation(list);
  }, [verList, annoByKey, yearFilter, classFilter, search, programTitleById, classNameById]);

  function resetFilters() {
    setYearFilter(FILTER_ALL);
    setClassFilter(FILTER_ALL);
    setSearch('');
  }

  // Full takeover of this view's content area while a correction is open —
  // same pattern as the student's OnlineExamView taking over StudentShell.
  // No new router: just a local piece of state gating what this component
  // renders, exactly like `selectedVer` already gates list vs detail.
  if (correctionTarget) {
    return (
      <CorrectionWorkspace
        submissionId={correctionTarget.submissionId}
        ownerUid={ownerUid}
        studentName={correctionTarget.studentName}
        onClose={() => setCorrectionTarget(null)}
      />
    );
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

  return (
    <section aria-label="Verifiche" className={styles.container}>
      {!selectedVer && (
        <form
          id="new-verification-form"
          className={styles.newVerificationForm}
          aria-label="Nuova verifica"
          onSubmit={(e) => void handleCreate(e)}
        />
      )}

      {/* ── Archive filters (VUX-01) ── */}
      {!selectedVer && verifications.length > 0 && (
        <div className={styles.filters} aria-label="Filtri archivio verifiche">
          <select
            aria-label="Filtro anno scolastico"
            value={yearFilter}
            onChange={(e) => setYearFilter(e.target.value)}
          >
            <option value={FILTER_ALL}>Tutti gli anni</option>
            {yearOptions.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
            {hasNoYear && <option value={YEAR_NONE}>Senza anno</option>}
          </select>
          <select
            aria-label="Filtro classe"
            value={classFilter}
            onChange={(e) => setClassFilter(e.target.value)}
          >
            <option value={FILTER_ALL}>Tutte le classi</option>
            {classOptions.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
            {hasNoClass && <option value={CLASS_NONE}>Nessuna classe</option>}
          </select>
          <input
            className={styles.filterSearch}
            type="search"
            placeholder="Cerca verifica…"
            aria-label="Cerca verifica"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      )}

      {/* ── Verification table ── */}
      {!selectedVer && (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <colgroup>
              <col className={styles.titleColumn} />
              <col className={styles.courseColumn} />
              <col className={styles.classColumn} />
              <col className={styles.yearColumn} />
              <col className={styles.statusColumn} />
              <col className={styles.exercisesColumn} />
              <col className={styles.actionsColumn} />
            </colgroup>
            <thead>
              <tr>
                <th className={styles.th}>Titolo</th>
                <th className={styles.th}>Corso</th>
                <th className={styles.th}>Classe</th>
                <th className={styles.th}>Anno</th>
                <th className={styles.th}>Stato</th>
                <th className={styles.th} title="Esercizi">
                  Es.
                </th>
                <th className={styles.th}>Azioni</th>
              </tr>
            </thead>
            <tbody>
              <tr className={styles.createRowInline}>
                <td className={`${styles.td} ${styles.createCell}`}>
                  <label className={styles.visuallyHidden} htmlFor="new-ver-title">
                    Titolo nuova verifica
                  </label>
                  <input
                    id="new-ver-title"
                    form="new-verification-form"
                    className={styles.createInput}
                    type="text"
                    placeholder="Titolo nuova verifica"
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                  />
                </td>
                <td className={`${styles.td} ${styles.createCell}`}>
                  <label className={styles.visuallyHidden} htmlFor="new-ver-program">
                    Programma nuova verifica
                  </label>
                  <select
                    id="new-ver-program"
                    form="new-verification-form"
                    className={styles.createInput}
                    value={newProgramId}
                    onChange={(e) => setNewProgramId(e.target.value)}
                  >
                    <option value="">
                      {readyPrograms.length === 0 ? 'Nessun corso pronto' : 'Corso'}
                    </option>
                    {readyPrograms.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.title}
                      </option>
                    ))}
                  </select>
                </td>
                <td className={`${styles.td} ${styles.createCell}`}>
                  <label className={styles.visuallyHidden} htmlFor="new-ver-class">
                    Classe nuova verifica (opzionale)
                  </label>
                  <select
                    id="new-ver-class"
                    form="new-verification-form"
                    className={styles.createInput}
                    value={newClassId}
                    onChange={(e) => setNewClassId(e.target.value)}
                  >
                    <option value="">Nessuna</option>
                    {classes.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td className={`${styles.td} ${styles.metaCell} ${styles.yearCell}`}>—</td>
                <td className={styles.td}>
                  <span className={`${styles.badge} ${styles.badgeNew}`}>Nuova</span>
                </td>
                <td className={`${styles.td} ${styles.metaCell}`}>—</td>
                <td className={`${styles.tdActions} ${styles.createActionCell}`}>
                  <button
                    type="submit"
                    form="new-verification-form"
                    className="btn-success"
                    aria-label="Crea verifica"
                    disabled={creating || !newTitle.trim() || !newProgramId}
                  >
                    {creating ? 'Creazione…' : 'Crea'}
                  </button>
                </td>
              </tr>
              {createError && (
                <tr className={styles.createErrorRow}>
                  <td colSpan={7} className={styles.td}>
                    <p role="alert" className="text-error">
                      {createError}
                    </p>
                  </td>
                </tr>
              )}
              {verifications.length === 0 && (
                <tr>
                  <td colSpan={7} className={styles.emptyTableCell}>
                    Nessuna verifica. Creane una dalla prima riga.
                  </td>
                </tr>
              )}
              {verifications.length > 0 && filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className={styles.emptyTableCell}>
                    <p>Nessuna verifica corrisponde ai filtri.</p>
                    <button type="button" onClick={resetFilters}>
                      Azzera filtri
                    </button>
                  </td>
                </tr>
              )}
              {filtered.map((v) => {
                const programTitle =
                  programs.find((p) => p.id === v.config.programId)?.title ?? v.config.programId;
                const className = v.config.classId
                  ? (classes.find((c) => c.id === v.config.classId)?.name ?? v.config.classId)
                  : '—';
                const annoScolastico = verificationYear(v, annoByKey) ?? '—';
                const questionCount =
                  v.status === 'draft'
                    ? v.config.questionRefs.length
                    : (v.teacherSnapshot?.questionRefs.length ?? v.config.questionRefs.length);

                if (closeConfirmId === v.id) {
                  return (
                    <tr key={v.id} className={styles.confirmRowInline}>
                      <td colSpan={7} className={styles.td}>
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
                      <td colSpan={7} className={styles.td}>
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
                      <td colSpan={7} className={styles.td}>
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
                      <td colSpan={7} className={styles.td}>
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
                          aria-label={`Apri dettaglio verifica ${v.config.title}`}
                          onClick={() => void handleSelectVer(v)}
                        >
                          {v.config.title}
                        </button>
                        {v.status !== 'draft' && (
                          <span className={styles.verTimestamps}>
                            <span>Attivata: {formatTimestamp(v.activatedAt)}</span>
                            {v.status === 'closed' && (
                              <span>Chiusa: {formatTimestamp(v.closedAt)}</span>
                            )}
                          </span>
                        )}
                      </td>
                      <td className={`${styles.td} ${styles.metaCell}`}>{programTitle}</td>
                      <td className={`${styles.td} ${styles.metaCell}`}>{className}</td>
                      <td className={`${styles.td} ${styles.metaCell} ${styles.yearCell}`}>
                        {annoScolastico}
                      </td>
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
                          {(v.status === 'active' || v.status === 'closed') && (
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
                        <td colSpan={7} className={styles.td}>
                          <p role="alert" className="text-error">
                            {pdfErrors[v.id]}
                          </p>
                        </td>
                      </tr>
                    )}
                    {solutionsPdfErrors[v.id] && (
                      <tr>
                        <td colSpan={7} className={styles.td}>
                          <p role="alert" className="text-error">
                            {solutionsPdfErrors[v.id]}
                          </p>
                        </td>
                      </tr>
                    )}
                    {onlineErrors[v.id] && (
                      <tr>
                        <td colSpan={7} className={styles.td}>
                          <p role="alert" className="text-error">
                            {onlineErrors[v.id]}
                          </p>
                        </td>
                      </tr>
                    )}
                    {visibilityErrors[v.id] && (
                      <tr>
                        <td colSpan={7} className={styles.td}>
                          <p role="alert" className="text-error">
                            {visibilityErrors[v.id]}
                          </p>
                        </td>
                      </tr>
                    )}
                    {pdfEnabledErrors[v.id] && (
                      <tr>
                        <td colSpan={7} className={styles.td}>
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
            <button
              type="button"
              className={styles.backButton}
              onClick={() => setSelectedVer(null)}
            >
              ← Torna alle verifiche
            </button>
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
                onChange={(e) => {
                  setEditDraftTitle(e.target.value);
                  markDraftDirty();
                }}
              />
              <label htmlFor="draft-class">Classe</label>
              <select
                id="draft-class"
                value={editDraftClassId}
                onChange={(e) => {
                  setEditDraftClassId(e.target.value);
                  markDraftDirty();
                }}
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
                    onChange={handleQuestionSelectionChange}
                  />
                )}
              </div>

              {/* Salva bozza + Attiva verifica — kept side by side, in this order */}
              {!showActivateConfirm ? (
                <div className={styles.draftActionArea}>
                  <div className={styles.draftActionBar}>
                    <button
                      type="button"
                      className="btn-primary"
                      disabled={
                        savingDraft ||
                        !editDraftTitle.trim() ||
                        (draftSaveStatus !== 'dirty' && draftSaveStatus !== 'error')
                      }
                      onClick={() => void handleSaveDraft()}
                    >
                      {savingDraft
                        ? 'Salvataggio…'
                        : draftSaveStatus === 'error'
                          ? 'Riprova salvataggio'
                          : 'Salva bozza'}
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
                  <p
                    className={`${styles.draftSaveFeedback} ${
                      draftSaveStatus === 'error'
                        ? styles.draftSaveFeedbackError
                        : draftSaveStatus === 'saved'
                          ? styles.draftSaveFeedbackSuccess
                          : ''
                    }`}
                    aria-live="polite"
                    role={draftSaveStatus === 'error' ? 'alert' : 'status'}
                  >
                    {draftSaveStatus === 'dirty' && '● Modifiche non salvate'}
                    {draftSaveStatus === 'saving' && 'Salvataggio in corso…'}
                    {draftSaveStatus === 'saved' && `✓ Bozza salvata alle ${draftSavedAt ?? '—'}`}
                    {draftSaveStatus === 'error' &&
                      `✕ ${draftSaveError ?? 'Impossibile salvare la bozza.'}`}
                    {draftSaveStatus === 'idle' && 'Nessuna modifica da salvare'}
                  </p>
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
              <div className={styles.monitorHeader}>
                <h3 className={styles.createTitle}>Consegne online</h3>
                <div className={styles.monitorActions}>
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={
                      monitorStudents === null ||
                      monitorItems === null ||
                      sortedMonitorRows.length === 0
                    }
                    onClick={handleExportCorrectionRegisterCsv}
                  >
                    Esporta CSV
                  </button>
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={
                      monitorStudents === null ||
                      monitorItems === null ||
                      sortedMonitorRows.length === 0 ||
                      exportingPdf
                    }
                    onClick={() => void handleExportCorrectionRegisterPdf()}
                  >
                    {exportingPdf ? 'Generazione…' : 'Esporta PDF'}
                  </button>
                </div>
              </div>
              {/* M5-04A: barra azioni batch sulle righe selezionate — icone
                  coerenti, dimensioni uniformi, griglia responsive (4 col →
                  2 col → 1 col). Nessun pulsante sulle singole righe. */}
              <div
                className={styles.batchToolbar}
                role="group"
                aria-label="Azioni sulle consegne selezionate"
              >
                <button
                  type="button"
                  className="btn-primary"
                  disabled={aiSelectedUids.size === 0 || aiDialogOpen || batchAction !== null}
                  onClick={() => setAiDialogOpen(true)}
                >
                  <IconSparkles />
                  Correggi con IA
                  {aiSelectedUids.size > 0 ? ` (${aiSelectedUids.size})` : ''}
                </button>
                {(
                  [
                    { action: 'complete', label: 'Completa', Icon: IconCircleCheck },
                    { action: 'reopen', label: 'Riapri', Icon: IconRotateCcw },
                    { action: 'return', label: 'Restituisci', Icon: IconSend },
                  ] as const
                ).map(({ action, label, Icon }) => (
                  <button
                    key={action}
                    type="button"
                    className="btn-primary"
                    disabled={aiSelectedUids.size === 0 || aiDialogOpen || batchAction !== null}
                    onClick={() => setBatchAction(action)}
                  >
                    <Icon />
                    {label}
                  </button>
                ))}
              </div>
              <>
                {csvExportError && (
                  <p role="alert" className="text-error">
                    {csvExportError}
                  </p>
                )}
                {pdfExportError && (
                  <p role="alert" className="text-error">
                    {pdfExportError}
                  </p>
                )}
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
                    <div className={`${styles.tableWrap} ${styles.submissionsTableWrap}`}>
                      <table className={styles.table}>
                        <colgroup>
                          <col className={styles.selectionColumn} />
                          <col span={8} />
                        </colgroup>
                        <thead>
                          <tr>
                            <th className={`${styles.th} ${styles.selectionHeader}`}>
                              <input
                                type="checkbox"
                                aria-label="Seleziona tutte le consegne"
                                checked={allSelectableSelected}
                                disabled={selectableUids.length === 0}
                                onChange={toggleSelectAll}
                              />
                            </th>
                            <th className={styles.th} aria-sort={monitorSortAria('student')}>
                              <button
                                type="button"
                                className={styles.sortHeaderButton}
                                aria-label={monitorSortLabel('student', 'Studente')}
                                onClick={() => toggleMonitorSort('student')}
                              >
                                Studente{monitorSortIndicator('student')}
                              </button>
                            </th>
                            <th className={styles.th} aria-sort={monitorSortAria('status')}>
                              <button
                                type="button"
                                className={styles.sortHeaderButton}
                                aria-label={monitorSortLabel('status', 'Stato')}
                                onClick={() => toggleMonitorSort('status')}
                              >
                                Stato{monitorSortIndicator('status')}
                              </button>
                            </th>
                            <th className={styles.th}>Valutate</th>
                            <th className={styles.th} aria-sort={monitorSortAria('percentage')}>
                              <button
                                type="button"
                                className={styles.sortHeaderButton}
                                aria-label={monitorSortLabel('percentage', 'Percentuale')}
                                onClick={() => toggleMonitorSort('percentage')}
                              >
                                Percentuale{monitorSortIndicator('percentage')}
                              </button>
                            </th>
                            <th className={styles.th} aria-sort={monitorSortAria('submittedAt')}>
                              <button
                                type="button"
                                className={styles.sortHeaderButton}
                                aria-label={monitorSortLabel('submittedAt', 'Consegna')}
                                onClick={() => toggleMonitorSort('submittedAt')}
                              >
                                Consegna{monitorSortIndicator('submittedAt')}
                              </button>
                            </th>
                            <th className={styles.th} aria-sort={monitorSortAria('events')}>
                              <button
                                type="button"
                                className={styles.sortHeaderButton}
                                aria-label={monitorSortLabel('events', 'Eventi')}
                                onClick={() => toggleMonitorSort('events')}
                              >
                                Eventi{monitorSortIndicator('events')}
                              </button>
                            </th>
                            <th className={styles.th}>Codice</th>
                            <th className={styles.th}>Azioni</th>
                          </tr>
                        </thead>
                        <tbody>
                          {sortedMonitorRows.map((row) => {
                            const item = row.item;
                            const stateLabel = row.stateLabel;
                            const studentName = row.studentName;
                            const eventsCount = item?.attentionEventsCount ?? 0;
                            const selectable = item?.status === 'submitted';
                            return (
                              <tr key={row.studentUid} className={styles.row}>
                                <td className={`${styles.td} ${styles.selectionCell}`}>
                                  <input
                                    type="checkbox"
                                    aria-label={`Seleziona consegna — ${studentName}`}
                                    checked={aiSelectedUids.has(row.studentUid)}
                                    disabled={!selectable}
                                    onChange={() => toggleRowSelected(row.studentUid)}
                                  />
                                </td>
                                <td className={styles.td}>{studentName}</td>
                                <td className={`${styles.td} ${styles.monitorStatusCell}`}>
                                  {stateLabel}
                                </td>
                                <td className={`${styles.td} ${styles.scoreCell}`}>
                                  {formatValutate(row.studentUid)}
                                </td>
                                <td className={`${styles.td} ${styles.percentageCell}`}>
                                  {formatPercentage(item)}
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
                                <td className={`${styles.td} ${styles.metaCell}`}>
                                  <div className={styles.actionsWrapper}>
                                    {item?.status === 'submitted' ? (
                                      <button
                                        type="button"
                                        className={styles.iconBtn}
                                        title="Apri correzione"
                                        aria-label={`Apri correzione — ${studentName}`}
                                        onClick={() =>
                                          setCorrectionTarget({
                                            submissionId: `${selectedVer.id}_${row.studentUid}`,
                                            studentName,
                                          })
                                        }
                                      >
                                        ✏️
                                      </button>
                                    ) : (
                                      !(item && selectedVer.status === 'closed') && '—'
                                    )}
                                    {/* M5-04C: «Azzera correzione» — solo se
                                        esiste una correzione in_progress con
                                        qualcosa da azzerare. Per completed/
                                        returned il docente riapre prima. */}
                                    {item?.status === 'submitted' &&
                                      (() => {
                                        const p = correctionProgress.get(row.studentUid);
                                        return p && isClearable(p) ? (
                                          <button
                                            type="button"
                                            className={styles.iconBtn}
                                            title="Azzera correzione"
                                            aria-label={`Azzera correzione — ${studentName}`}
                                            onClick={() =>
                                              setClearTarget({
                                                submissionId: `${selectedVer.id}_${row.studentUid}`,
                                                studentName,
                                                studentUid: row.studentUid,
                                              })
                                            }
                                          >
                                            <IconEraser />
                                          </button>
                                        ) : null;
                                      })()}
                                    {/* Delete a submission — only for a real,
                                        existing submission on a CLOSED verification. */}
                                    {item && selectedVer.status === 'closed' && (
                                      <button
                                        type="button"
                                        className={styles.iconBtn}
                                        title="Elimina consegna"
                                        aria-label={`Elimina consegna — ${studentName}`}
                                        disabled={deletingSubmission}
                                        onClick={() =>
                                          setSubmissionDeleteTarget({
                                            studentUid: row.studentUid,
                                            studentName,
                                          })
                                        }
                                      >
                                        <IconTrash />
                                      </button>
                                    )}
                                  </div>
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

      {aiDialogOpen && selectedVer && (
        <AiBatchCorrectionDialog
          verificationId={selectedVer.id}
          submissionIds={aiSelectedSubmissionIds}
          callables={aiCallables}
          onClose={() => setAiDialogOpen(false)}
          onApplied={() => {
            // M5-04A: aggiornamento minimale (stato/percentuale dal listener del
            // monitor, «Valutate» da una singola rilettura mirata). La selezione
            // NON viene toccata: resta invariata per poter concatenare azioni
            // sullo stesso gruppo (Correggi con IA → Completa → Restituisci).
            void refreshCorrectionProgress();
          }}
        />
      )}

      {batchAction && selectedVer && (
        <BatchCorrectionActionsDialog
          action={batchAction}
          rows={batchSelectedRows}
          db={db}
          onClose={() => setBatchAction(null)}
          onApplied={() => {
            // M5-04A: una sola rilettura mirata aggiorna «Valutate»/stato/
            // percentuale. La selezione resta INVARIATA (né riuscite né fallite
            // vengono deselezionate): il docente può concatenare azioni sullo
            // stesso gruppo. La selezione cambia solo manualmente.
            void refreshCorrectionProgress();
          }}
        />
      )}

      {clearTarget && (
        <ClearCorrectionDialog
          submissionId={clearTarget.submissionId}
          studentName={clearTarget.studentName}
          db={db}
          onClose={() => setClearTarget(null)}
          onCleared={() => {
            // M5-04C: una sola rilettura mirata aggiorna «Valutate»/stato/
            // percentuale (la riga torna «non valutata»). La selezione della
            // consegna resta INVARIATA: si può subito rilanciare «Correggi con IA».
            void refreshCorrectionProgress();
          }}
        />
      )}

      {submissionDeleteTarget && (
        <div className={styles.deleteBackdrop}>
          <div
            role="alertdialog"
            aria-label="Conferma eliminazione consegna"
            className={styles.deleteDialog}
          >
            <p className={styles.deleteDialogTitle}>
              Eliminare la consegna di <strong>{submissionDeleteTarget.studentName}</strong>?
            </p>
            <p className={styles.deleteDialogBody}>
              Verranno eliminati definitivamente: la consegna, le risposte, la correzione, la
              restituzione e lo storico della correzione. L’operazione è irreversibile.
            </p>
            {submissionDeleteError && (
              <p role="alert" className="text-error">
                {submissionDeleteError}
              </p>
            )}
            <div className={styles.confirmRow}>
              <button
                type="button"
                className="btn-danger"
                disabled={deletingSubmission}
                onClick={() => void handleConfirmDeleteSubmission()}
              >
                {deletingSubmission ? 'Eliminazione…' : 'Elimina consegna'}
              </button>
              <button
                type="button"
                disabled={deletingSubmission}
                onClick={() => {
                  setSubmissionDeleteTarget(null);
                  setSubmissionDeleteError(null);
                }}
              >
                Annulla
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function programTitle(v: VerificationItem, programs: ProgramItem[]): string {
  return programs.find((p) => p.id === v.config.programId)?.title ?? v.config.programId;
}
