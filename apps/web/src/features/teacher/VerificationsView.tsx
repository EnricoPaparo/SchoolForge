import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  activateVerification,
  closeVerification,
  createVerification,
  deleteVerification,
  listVerifications,
  reopenVerification,
  setVerificationOnlineEnabled,
  setVerificationStudentPdfEnabled,
  setVerificationVisibility,
  updateVerificationConfig,
  VERIFICATION_TITLE_MAX_LENGTH,
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
import { VerificationTopicsControl } from '../../components/VerificationTopicsControl.js';
import {
  formatQuestionCountLabel,
  formatVerificationDateIt,
  isValidVerificationDate,
} from '../repository/verifications/verificationDate.js';
import {
  buildTopicOutline,
  readTopicOutline,
  TopicOutlineError,
} from '../repository/verifications/topicOutline.js';
import { listLessons, listUdas } from '../repository/programs/programsService.js';
import { AttentionEventsDialog } from './AttentionEventsDialog.js';
import { CorrectionWorkspace } from './CorrectionWorkspace.js';
import { AiBatchCorrectionDialog } from './AiBatchCorrectionDialog.js';
import { AiCorrectionSettingsDialog } from './AiCorrectionSettingsDialog.js';
import {
  loadTeacherAiPreferences,
  type TeacherAiPreferences,
} from '../repository/corrections/teacherAiPreferencesService.js';
import { BatchCorrectionActionsDialog } from './BatchCorrectionActionsDialog.js';
import { BatchReturnVisibilityDialog } from './BatchReturnVisibilityDialog.js';
import { BatchVisibilityMenu } from './BatchVisibilityMenu.js';
import { CorrectionArchiveExportDialog } from './CorrectionArchiveExportDialog.js';
import { createAiCorrectionCallables } from '../repository/corrections/aiCorrectionClient.js';
import {
  loadCorrectionProgressByStudent,
  type CorrectionProgress,
} from '../repository/corrections/correctionProgressService.js';
import {
  loadCorrectionReturnVisibilityBySubmission,
  type CorrectionReturnVisibility,
} from '../repository/corrections/correctionReturnVisibilityService.js';
import type {
  BatchAction,
  BatchSelectedRow,
} from '../repository/corrections/batchCorrectionActions.js';
import type { BatchReturnVisibilityAction } from '../repository/corrections/batchReturnVisibility.js';
import { deleteSubmissionData } from '../repository/verifications/deleteSubmissionData.js';
import {
  IconBookOpen,
  IconCircleX,
  IconClipboardCheck,
  IconFileText,
  IconPlus,
  IconTrash,
  IconSparkles,
  IconCircleCheck,
  IconEye,
  IconEyeOff,
  IconRotateCcw,
  IconSend,
  IconEraser,
  IconDownload,
  IconWifi,
  IconLayers,
} from '../../components/icons.js';
import { VerificationRecordCard } from '../../components/VerificationRecordCard.js';
import { VerificationActionsMenu } from './VerificationActionsMenu.js';
import { DialogShell } from '../../components/DialogShell.js';
import type {
  AttentionEvent,
  EquivalentGroupConfig,
  VerificationDistributionMode,
  VerificationTeacherQuestionSnapshot,
} from '../../types/firestore.js';
import { normalizeDistributionMode } from '../repository/verifications/vexDistribution.js';
import { reconcileEquivalentGroups } from '../repository/verifications/vexGroups.js';
import {
  assignOnSelect,
  autoGroupByKey,
  ungroupedEntryIds,
  type AutogroupRef,
} from '../repository/verifications/vexAutogroup.js';
import { VexBuilder, type VexBuilderQuestion } from './VexBuilder.js';
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
  classifyCorrectionArchiveEligibility,
  runCorrectionArchiveExport,
  type CorrectionArchiveEligibility,
} from '../repository/corrections/correctionArchiveExport.js';
import { PdfModuleLoadError, reloadCurrentPage } from '../../lib/pdfModuleLoader.js';
import {
  sortSubmissionMonitorRows,
  type SubmissionMonitorSortConfig,
  type SubmissionMonitorSortKey,
} from '../repository/verifications/submissionMonitorSort.js';
import styles from './VerificationsView.module.css';
// Stili condivisi del menu «Azioni» (voce distruttiva), gli stessi di Didattica.
import menuStyles from './CourseWorkspace.module.css';

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
function StatusText({
  status,
  visibility,
}: {
  status: 'draft' | 'active' | 'closed';
  visibility: 'hidden' | 'public';
}) {
  if (status === 'active') {
    const isPublic = visibility === 'public';
    return (
      <span
        className={`${styles.cardStatusText} ${
          isPublic ? styles.cardStatusPublic : styles.cardStatusMuted
        }`}
      >
        {isPublic ? 'Pubblica' : 'Nascosta'}
      </span>
    );
  }
  const labels = { draft: 'Bozza', closed: 'Chiusa' } as const;
  return (
    <span className={`${styles.cardStatusText} ${styles.cardStatusMuted}`}>{labels[status]}</span>
  );
}

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

/**
 * TWU-02 — explicit load states for the teacher's AI-correction preferences.
 * A preferences value is available ONLY in the `ready` state; a load error is a
 * distinct state that never resolves to an implicit default.
 */
type AiPreferencesLoadState =
  | { status: 'loading' }
  | { status: 'ready'; preferences: TeacherAiPreferences }
  | { status: 'error'; message: string };

const AI_PREFS_ERROR_MESSAGE = 'Impossibile caricare le impostazioni IA. Riprova.';

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
  // UI-VERIFICHE-06B — stato iniziale **vuoto**: la data non viene mai scelta
  // silenziosamente (nessun "oggi" implicito); il docente la indica sempre.
  const [newDate, setNewDate] = useState('');
  const [editDraftDate, setEditDraftDate] = useState('');
  /**
   * UI-VERIFICHE-06B — albero canonico del corso della bozza aperta (UDA e
   * lezioni con i loro titoli), letto **una volta** insieme al pool. È la sola
   * fonte dell'ordine canonico del perimetro didattico.
   */
  const [courseTree, setCourseTree] = useState<{
    udas: { dir: string; titolo?: string | null }[];
    lessons: { udaDir: string; filename: string; titolo?: string | null }[];
  } | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
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
  // VEX-01A — distribuzione online e gruppi equivalenti del draft. Viaggiano
  // nello stesso salvataggio bozza di titolo/classe/domande (nessuna write extra).
  const [distributionMode, setDistributionMode] =
    useState<VerificationDistributionMode>('same_questions');
  const [equivalentGroups, setEquivalentGroups] = useState<EquivalentGroupConfig[]>([]);
  // VEX-02C: entryId selezionati in questa sessione, ancora comuni e candidati a
  // formare un nuovo gruppo con una domanda compatibile (abbinamento progressivo).
  // Vive in un ref: non è stato di rendering e non deve triggerare re-render.
  const vexSessionUnassignedRef = useRef<string[]>([]);
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

  const [reopenConfirmId, setReopenConfirmId] = useState<string | null>(null);
  const [reopening, setReopening] = useState(false);
  const [reopenError, setReopenError] = useState<string | null>(null);

  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // ── Consegne online monitor (M3F-05, always-on-selection M3F-09) ────
  const [monitorStudents, setMonitorStudents] = useState<StudentItem[] | null>(null);
  const [monitorItems, setMonitorItems] = useState<SubmissionMonitorItem[] | null>(null);
  const [monitorError, setMonitorError] = useState<string | null>(null);
  const [csvExportError, setCsvExportError] = useState<string | null>(null);
  const [pdfExportError, setPdfExportError] = useState<string | null>(null);
  const [pdfExportNeedsReload, setPdfExportNeedsReload] = useState(false);
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
  // ── Manual "Aggiorna" for the submissions monitor (TWU-01) ─────────
  // Explicit, teacher-initiated refresh of the pull-based monitor reads
  // (correction progress / «Valutate» / correction status + class roster),
  // reusing the same services as the selection effect. No new query, no
  // listener, no polling — the cost exists ONLY on click.
  const [monitorRefreshing, setMonitorRefreshing] = useState(false);
  const [monitorRefreshError, setMonitorRefreshError] = useState(false);
  // TWU-02A — local time of the last successful manual refresh (HH:mm:ss), or
  // null before the first one. Shown inline in the «Consegne online» header.
  const [monitorRefreshedAt, setMonitorRefreshedAt] = useState<string | null>(null);
  // Synchronous re-entrancy guard: two rapid clicks both pass the state check
  // before React re-renders, so a ref set before the first await is what
  // actually collapses them into a single refresh orchestration.
  const monitorRefreshingRef = useRef(false);
  const mountedRef = useRef(true);

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
    studentUid: string;
    studentName: string;
  } | null>(null);
  // ── Batch AI correction (M5-03, mock) ─────────────────────────────
  // Selezione stabile per studentUid (non per indice), così resta valida
  // durante ordinamento e aggiornamenti live della tabella.
  const [aiSelectedUids, setAiSelectedUids] = useState<Set<string>>(new Set());
  const [aiDialogOpen, setAiDialogOpen] = useState(false);
  // TWU-02 — default AI-correction preferences: a single owner-only get on
  // entering Verifiche, kept in memory for the session; one write only on save.
  // A load error is an EXPLICIT distinct state — never a silent fallback to the
  // application defaults (which would risk running quality/Luna when the teacher
  // had saved economy). Until preferences are `ready`, the AI dialogs cannot run
  // with implicit defaults.
  const [aiSettingsOpen, setAiSettingsOpen] = useState(false);
  const [aiPrefs, setAiPrefs] = useState<AiPreferencesLoadState>({ status: 'loading' });
  // In-flight guard: collapses StrictMode double-invocation and double-clicks on
  // «Riprova» into a single explicit get.
  const aiPrefsLoadingRef = useRef(false);
  // M5-04: azione massiva in conferma (Completa/Riapri/Restituisci/Azzera) o null.
  const [batchAction, setBatchAction] = useState<BatchAction | null>(null);
  // TWU-03: una delle quattro operazioni indipendenti sulla proiezione restituita.
  const [batchReturnVisibilityAction, setBatchReturnVisibilityAction] =
    useState<BatchReturnVisibilityAction | null>(null);
  const [archiveEligibility, setArchiveEligibility] = useState<CorrectionArchiveEligibility | null>(
    null,
  );
  const [archiveExportBusy, setArchiveExportBusy] = useState(false);
  const archiveExportBusyRef = useRef(false);
  const [archiveExportError, setArchiveExportError] = useState<'stale_chunk' | 'generic' | null>(
    null,
  );
  const [archiveExportFailures, setArchiveExportFailures] = useState<string[]>([]);
  // «Valutate» n/totale per studentUid: singola lettura mirata (no listener).
  const [correctionProgress, setCorrectionProgress] = useState<Map<string, CorrectionProgress>>(
    new Map(),
  );
  const [correctionReturnVisibility, setCorrectionReturnVisibility] = useState<
    Map<string, CorrectionReturnVisibility>
  >(new Map());
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
              ...(r.item?.assignedQuestionOrders
                ? { assignedQuestionOrders: r.item.assignedQuestionOrders }
                : {}),
              ...(r.item?.assignedAnswerKeys
                ? { assignedAnswerKeys: r.item.assignedAnswerKeys }
                : {}),
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

  /**
   * TWU-01 — single refresh orchestration behind the «Aggiorna» button. It runs
   * the same three load operations as the selection effect: correction
   * progress, class roster and return visibility. The visibility query is
   * scoped by `verificationId` and uses its automatic single-field index.
   * Billed Firestore reads are proportional to the documents returned by each
   * operation (not a fixed "3 reads"); the cost exists only on click, with no
   * listener or polling. Keeps current data on error, guards against
   * double-click, and never updates state after unmount.
   */
  async function refreshMonitor(): Promise<void> {
    if (!selectedVer || monitorRefreshingRef.current) return;
    monitorRefreshingRef.current = true;
    setMonitorRefreshing(true);
    setMonitorRefreshedAt(null);
    setMonitorRefreshError(false);
    const verId = selectedVer.id;
    const classId = selectedVer.teacherSnapshot?.classId ?? selectedVer.config.classId;
    try {
      const [progress, students, returnVisibility] = await Promise.all([
        loadCorrectionProgressByStudent(verId, db),
        listStudents(ownerUid, db),
        loadCorrectionReturnVisibilityBySubmission(verId, ownerUid, db),
      ]);
      if (!mountedRef.current) return;
      const approved = students
        .filter((s) => s.status === 'approved' && s.classId === classId)
        .sort((a, b) => (a.displayName ?? a.email).localeCompare(b.displayName ?? b.email, 'it'));
      setCorrectionProgress(progress);
      setMonitorStudents(approved);
      setCorrectionReturnVisibility(returnVisibility);
      // Local time via the existing Date logic; not persisted anywhere.
      setMonitorRefreshedAt(new Date().toLocaleTimeString('it-IT'));
    } catch {
      // Keep the current data visible; the inline header status reports the failure.
      if (mountedRef.current) setMonitorRefreshError(true);
    } finally {
      if (mountedRef.current) setMonitorRefreshing(false);
      monitorRefreshingRef.current = false;
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
    setPdfExportNeedsReload(false);
    try {
      await downloadCorrectionRegisterPdf({
        verificationTitle: model.title,
        className: model.className,
        rows: model.rows,
      });
    } catch (cause) {
      if (cause instanceof PdfModuleLoadError && cause.category === 'stale_chunk') {
        setPdfExportError('SchoolForge è stato aggiornato. Ricarica la pagina e riprova.');
        setPdfExportNeedsReload(true);
      } else {
        setPdfExportError('Impossibile generare il PDF del riepilogo. Riprova.');
      }
    } finally {
      exportingPdfRef.current = false;
      setExportingPdf(false);
    }
  }

  async function executeCorrectionArchiveExport(
    eligibility: CorrectionArchiveEligibility,
  ): Promise<Awaited<ReturnType<typeof runCorrectionArchiveExport>>> {
    if (!selectedVer) throw new Error('Verifica non disponibile.');
    return runCorrectionArchiveExport({
      verificationId: selectedVer.id,
      verification: selectedVer,
      ownerUid,
      candidates: eligibility.eligible,
      db,
    });
  }

  async function handleCorrectionArchiveExport(): Promise<void> {
    if (archiveExportBusyRef.current || !selectedVer) return;
    const eligibility = classifyCorrectionArchiveEligibility(batchSelectedRows);
    setArchiveExportError(null);
    setArchiveExportFailures([]);
    if (eligibility.eligible.length !== 1 || eligibility.excluded.length > 0) {
      setArchiveEligibility(eligibility);
      return;
    }

    archiveExportBusyRef.current = true;
    setArchiveExportBusy(true);
    try {
      const result = await executeCorrectionArchiveExport(eligibility);
      if (!mountedRef.current) return;
      if (!result.ok) {
        setArchiveExportError('generic');
        setArchiveExportFailures(result.failures.map((failure) => failure.candidate.studentName));
      }
    } catch (cause) {
      if (!mountedRef.current) return;
      setArchiveExportError(
        cause instanceof PdfModuleLoadError && cause.category === 'stale_chunk'
          ? 'stale_chunk'
          : 'generic',
      );
    } finally {
      archiveExportBusyRef.current = false;
      if (mountedRef.current) setArchiveExportBusy(false);
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
    setCorrectionReturnVisibility(new Map());
    setArchiveEligibility(null);
    setArchiveExportError(null);
    setArchiveExportFailures([]);

    // «Valutate»: singola lettura mirata delle correzioni della verifica
    // (owner-only per Rules, nessun listener, nessun polling).
    loadCorrectionProgressByStudent(v.id, db)
      .then((progress) => {
        if (!cancelled) setCorrectionProgress(progress);
      })
      .catch(() => undefined);

    // One owner-only query scoped to this verification. Malformed return
    // projections are ignored fail-closed by the service.
    loadCorrectionReturnVisibilityBySubmission(v.id, ownerUid, db)
      .then((visibility) => {
        if (!cancelled) setCorrectionReturnVisibility(visibility);
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

  // TWU-01: tracks mount state so the manual refresh never sets state after
  // unmount (StrictMode-safe: the ref is reset to true on the second mount).
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Reset the transient refresh feedback when the selected verification changes.
  useEffect(() => {
    setMonitorRefreshError(false);
    setMonitorRefreshedAt(null);
  }, [selectedVerId]);

  // TWU-02 — one explicit owner-only get of the AI-correction preferences (no
  // listener/polling). On success ⇒ `ready`; on any failure (network, permission,
  // malformed document) ⇒ `error` — NEVER a silent fallback to the defaults. The
  // in-flight ref collapses StrictMode's double effect and «Riprova» double-clicks
  // into a single get; no state update after unmount.
  function loadAiPreferences() {
    if (!ownerUid || aiPrefsLoadingRef.current) return;
    aiPrefsLoadingRef.current = true;
    setAiPrefs({ status: 'loading' });
    loadTeacherAiPreferences(ownerUid, db)
      .then((preferences) => {
        if (mountedRef.current) setAiPrefs({ status: 'ready', preferences });
      })
      .catch(() => {
        if (mountedRef.current) setAiPrefs({ status: 'error', message: AI_PREFS_ERROR_MESSAGE });
      })
      .finally(() => {
        aiPrefsLoadingRef.current = false;
      });
  }

  // Load once on entering Verifiche (per owner). StrictMode-safe via the ref.
  useEffect(() => {
    loadAiPreferences();
  }, [ownerUid]);

  // TWU-02 — persistent, accessible error banner with a compact «Riprova» button.
  // A retry is a single new explicit get (guarded against double-click).
  function renderAiPrefsError() {
    return (
      <p role="alert" className={styles.aiPrefsError}>
        <span>{AI_PREFS_ERROR_MESSAGE}</span>
        <button type="button" className={styles.aiPrefsRetryBtn} onClick={loadAiPreferences}>
          Riprova
        </button>
      </p>
    );
  }

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
    setEditDraftDate(v.config.verificationDate ?? '');
    setCourseTree(null);
    // VEX-01A: modalità normalizzata fail-closed; gruppi riconciliati con la
    // selezione corrente (scarta entryId non più presenti e gruppi vuoti).
    setDistributionMode(normalizeDistributionMode(v.config.distributionMode));
    setEquivalentGroups(
      reconcileEquivalentGroups(
        v.config.equivalentGroups ?? [],
        new Set(v.config.questionRefs.map((r) => r.questionIndexEntryId)),
      ),
    );
    // VEX-02C: al caricamento le domande comuni persistite NON sono candidate a
    // un abbinamento automatico (nessuna autocompilazione globale); la sessione
    // di abbinamento progressivo parte vuota.
    vexSessionUnassignedRef.current = [];
    draftRevisionRef.current = 0;
    setDraftSaveStatus('idle');
    setDraftSavedAt(null);
    setDraftSaveError(null);

    if (v.status === 'draft' && v.config.programId && v.config.importId) {
      try {
        // UI-VERIFICHE-06B — l'albero canonico del corso viaggia con la lettura
        // del pool già necessaria per il picker: serve a comporre il perimetro
        // didattico durante la selezione. Non c'è alcuna lettura all'apertura
        // della popup «Argomenti», né sulle liste, né a verifica attivata.
        const [entries, udas, lessons] = await Promise.all([
          listQuestionIndex(v.config.programId, v.config.importId, db),
          listUdas(v.config.programId, v.config.importId, db),
          listLessons(v.config.programId, v.config.importId, db),
        ]);
        setQuestionIndex(entries);
        setCourseTree({ udas, lessons });
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

  /** Metadati minimi (UDA/tipo/difficoltà) per l'autogroup, dal questionIndex. */
  function autogroupRefsFor(ids: Set<string>): AutogroupRef[] {
    if (!questionIndex) return [];
    const entryMap = new Map(questionIndex.map((e) => [e.id, e]));
    return Array.from(ids)
      .map((id) => entryMap.get(id))
      .filter((e): e is NonNullable<typeof e> => e !== undefined)
      .map((e) => ({
        questionIndexEntryId: e.id,
        udaDir: e.udaDir,
        tipo: e.tipo,
        difficolta: e.difficolta,
      }));
  }

  function handleQuestionSelectionChange(next: Set<string>) {
    const prev = selectedQuestionIds;
    const added = [...next].filter((id) => !prev.has(id));

    // VEX-02C: tutto il calcolo (riconciliazione, abbinamento progressivo, UUID,
    // candidati di sessione) avviene **fuori** dall'updater di React, una sola
    // volta per evento utente. L'updater si limita ad applicare il risultato
    // già calcolato, così Strict Mode (doppia invocazione) non può generare
    // UUID/gruppi doppi né perdere candidati.
    // VEX-01A: deselezione ⇒ rimozione dal gruppo + eliminazione dei gruppi vuoti.
    let groups = reconcileEquivalentGroups(equivalentGroups, next);
    // Ripulisci i candidati non più selezionati o ora raggruppati.
    let sessionUnassigned = vexSessionUnassignedRef.current.filter(
      (id) => next.has(id) && !groups.some((g) => g.questionIndexEntryIds.includes(id)),
    );
    // Abbinamento progressivo SOLO per le domande appena selezionate e solo in
    // modalità varianti. Mai un ricalcolo globale: le scelte manuali restano
    // autorevoli (le domande già presenti non vengono toccate).
    if (distributionMode === 'equivalent_variants' && added.length > 0) {
      const refs = autogroupRefsFor(next);
      for (const id of added) {
        const res = assignOnSelect({
          newEntryId: id,
          refs,
          groups,
          sessionUnassigned,
        });
        groups = res.groups;
        sessionUnassigned = res.sessionUnassigned;
      }
    }

    setSelectedQuestionIds(next);
    setEquivalentGroups(groups);
    vexSessionUnassignedRef.current = sessionUnassigned;
    markDraftDirty();
  }

  function handleDistributionModeChange(mode: VerificationDistributionMode) {
    // VEX-02C: **prima** inizializzazione — solo alla transizione manuale verso
    // `equivalent_variants` e SOLO se non esistono già gruppi. Al caricamento di
    // una configurazione esistente questo handler non viene invocato, quindi
    // nessuna autocompilazione globale sui gruppi/comuni già persistiti.
    if (mode === 'equivalent_variants' && equivalentGroups.length === 0) {
      const refs = autogroupRefsFor(selectedQuestionIds);
      const auto = autoGroupByKey(refs);
      setEquivalentGroups(auto);
      // I singleton della precompilazione (di questa sessione) diventano candidati
      // per un abbinamento con selezioni successive; i comuni persistiti no.
      vexSessionUnassignedRef.current = ungroupedEntryIds(refs, auto);
    }
    setDistributionMode(mode);
    markDraftDirty();
  }

  function handleEquivalentGroupsChange(groups: EquivalentGroupConfig[]) {
    setEquivalentGroups(groups);
    markDraftDirty();
  }

  /**
   * Domande selezionate per il builder VEX, come tipo **UI-only**
   * `VexBuilderQuestion`: i metadati stabili + `questionPreview` **già** caricato
   * nel `questionIndex` (nessuna nuova lettura/query/Storage). La preview è
   * puramente di visualizzazione: non viene mai persistita in
   * `config.equivalentGroups` né aggiunta a `VerificationQuestionRef`.
   */
  function selectedRefsForBuilder(): VexBuilderQuestion[] {
    if (!questionIndex) return [];
    const entryMap = new Map(questionIndex.map((e) => [e.id, e]));
    return Array.from(selectedQuestionIds)
      .map((id) => entryMap.get(id))
      .filter((e): e is NonNullable<typeof e> => e !== undefined)
      .map((entry) => ({
        questionIndexEntryId: entry.id,
        questionLocalId: entry.questionLocalId,
        questionPreview: entry.questionPreview,
        udaDir: entry.udaDir,
        tipo: entry.tipo,
        difficolta: entry.difficolta,
        maxPoints: entry.maxPoints,
      }));
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
    if (title.length > VERIFICATION_TITLE_MAX_LENGTH) {
      setDraftSaveStatus('error');
      setDraftSaveError(
        `Il titolo della verifica non può superare ${VERIFICATION_TITLE_MAX_LENGTH} caratteri.`,
      );
      return;
    }
    const savedRevision = draftRevisionRef.current;
    setSavingDraft(true);
    setDraftSaveStatus('saving');
    setDraftSaveError(null);
    try {
      const classId = editDraftClassId || null;
      const questionRefs = buildQuestionRefsFromSelection();
      // VEX-01A: distributionMode ed equivalentGroups viaggiano nello stesso
      // update di titolo/classe/questionRefs (nessuna scrittura aggiuntiva). I
      // gruppi vengono riconciliati con la selezione corrente prima di salvare.
      const reconciledGroups = reconcileEquivalentGroups(equivalentGroups, selectedQuestionIds);
      const vexPatch = { distributionMode, equivalentGroups: reconciledGroups };
      // UI-VERIFICHE-06B — data e perimetro viaggiano nello **stesso** update di
      // titolo/classe/domande: nessuna scrittura dedicata, nessun listener. Il
      // perimetro è ricalcolato dall'albero già in memoria; se non è costruibile
      // (titoli mancanti, lezione rimossa dal corso) la bozza si salva comunque
      // senza perimetro — l'attivazione lo ricostruirà autorevolmente e, se
      // ancora incoerente, fallirà lì in modo esplicito.
      const datePatch = isValidVerificationDate(editDraftDate)
        ? { verificationDate: editDraftDate }
        : {};
      let topicPatch: { topicOutline?: ReturnType<typeof buildTopicOutline> } = {};
      if (courseTree && questionRefs !== null && questionRefs.length > 0) {
        try {
          topicPatch = {
            topicOutline: buildTopicOutline({
              questionRefs,
              udas: courseTree.udas,
              lessons: courseTree.lessons,
            }),
          };
        } catch (error) {
          if (!(error instanceof TopicOutlineError)) throw error;
        }
      }
      const patch =
        questionRefs === null
          ? { title, classId, ...datePatch, ...topicPatch, ...vexPatch }
          : { title, classId, questionRefs, ...datePatch, ...topicPatch, ...vexPatch };
      await updateVerificationConfig(selectedVer.id, patch, ownerUid, db);
      if (reconciledGroups !== equivalentGroups) setEquivalentGroups(reconciledGroups);
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
    if (title.length > VERIFICATION_TITLE_MAX_LENGTH) {
      setCreateError(
        `Il titolo della verifica non può superare ${VERIFICATION_TITLE_MAX_LENGTH} caratteri.`,
      );
      return;
    }
    if (!isValidVerificationDate(newDate)) {
      setCreateError('Indica la data della verifica.');
      return;
    }
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
        {
          title,
          classId: newClassId || null,
          programId: newProgramId,
          importId,
          verificationDate: newDate,
        },
        ownerUid,
        db,
      );
      setNewTitle('');
      setNewProgramId('');
      setNewClassId('');
      setNewDate('');
      setCreateDialogOpen(false);
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
      if (title.length > VERIFICATION_TITLE_MAX_LENGTH) {
        setActivateError(
          `Il titolo della verifica non può superare ${VERIFICATION_TITLE_MAX_LENGTH} caratteri.`,
        );
        return;
      }
      const classId = editDraftClassId || null;
      const questionRefs = buildQuestionRefsFromSelection();
      // VEX-01A: persist distributionMode/equivalentGroups so activation reads
      // exactly what is visible. The fail-closed guard in activateVerification
      // rejects equivalent_variants before any pool read/transaction/write.
      const reconciledGroups = reconcileEquivalentGroups(equivalentGroups, selectedQuestionIds);
      const vexPatch = { distributionMode, equivalentGroups: reconciledGroups };
      // UI-VERIFICHE-06B — data e perimetro viaggiano nello **stesso** update di
      // titolo/classe/domande: nessuna scrittura dedicata, nessun listener. Il
      // perimetro è ricalcolato dall'albero già in memoria; se non è costruibile
      // (titoli mancanti, lezione rimossa dal corso) la bozza si salva comunque
      // senza perimetro — l'attivazione lo ricostruirà autorevolmente e, se
      // ancora incoerente, fallirà lì in modo esplicito.
      const datePatch = isValidVerificationDate(editDraftDate)
        ? { verificationDate: editDraftDate }
        : {};
      let topicPatch: { topicOutline?: ReturnType<typeof buildTopicOutline> } = {};
      if (courseTree && questionRefs !== null && questionRefs.length > 0) {
        try {
          topicPatch = {
            topicOutline: buildTopicOutline({
              questionRefs,
              udas: courseTree.udas,
              lessons: courseTree.lessons,
            }),
          };
        } catch (error) {
          if (!(error instanceof TopicOutlineError)) throw error;
        }
      }
      const patch =
        questionRefs === null
          ? { title, classId, ...datePatch, ...topicPatch, ...vexPatch }
          : { title, classId, questionRefs, ...datePatch, ...topicPatch, ...vexPatch };
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
    if (v.status === 'draft') return;
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
    setReopenConfirmId(null);
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
    setReopenConfirmId(null);
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
      // converges to the same result. Also drop the row from the local
      // selection and its correction-progress entry so «Valutate» and the batch
      // actions stay coherent — no full-page reload, no extra listener.
      setMonitorItems((prev) => prev?.filter((m) => m.studentUid !== studentUid) ?? prev);
      setAiSelectedUids((prev) => {
        if (!prev.has(studentUid)) return prev;
        const next = new Set(prev);
        next.delete(studentUid);
        return next;
      });
      setCorrectionProgress((prev) => {
        if (!prev.has(studentUid)) return prev;
        const next = new Map(prev);
        next.delete(studentUid);
        return next;
      });
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
    setReopenConfirmId(null);
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

  function handleStartReopen(id: string) {
    setReopenConfirmId(id);
    setReopenError(null);
    setCloseConfirmId(null);
    setDeleteConfirmId(null);
    setOnlineDisableConfirmId(null);
    setPdfDisableConfirmId(null);
  }

  async function handleConfirmReopen(id: string) {
    setReopening(true);
    setReopenError(null);
    try {
      await reopenVerification(id, ownerUid, db);
      setReopenConfirmId(null);
      const updated = await listVerifications(ownerUid, db);
      setVerifications(updated);
      if (selectedVer?.id === id) {
        const refreshed = updated.find((verification) => verification.id === id);
        if (refreshed) setSelectedVer(refreshed);
      }
    } catch (err) {
      setReopenError(err instanceof Error ? err.message : 'Errore durante la riapertura.');
    } finally {
      setReopening(false);
    }
  }

  function handleStartDelete(id: string) {
    setDeleteConfirmId(id);
    setDeleteError(null);
    setCloseConfirmId(null);
    setReopenConfirmId(null);
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
        onReturned={(submissionId) => {
          setCorrectionReturnVisibility((current) => {
            const next = new Map(current);
            next.set(submissionId, {
              submissionId,
              studentUid: correctionTarget.studentUid,
              visibleToStudent: true,
              solutionsVisible: true,
            });
            return next;
          });
        }}
        onClose={() => {
          setCorrectionTarget(null);
          // Il workspace salva direttamente la correction, mentre la tabella
          // mantiene una fotografia mirata del progresso. Aggiornala al
          // ritorno così «Valutate» e le azioni batch (incluso «Azzera»)
          // riflettono subito l'ultimo salvataggio, senza refresh pagina né
          // listener permanente.
          void refreshCorrectionProgress();
        }}
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
  const closeConfirmVerification = verifications.find((item) => item.id === closeConfirmId);
  const reopenConfirmVerification = verifications.find((item) => item.id === reopenConfirmId);
  const deleteConfirmVerification = verifications.find((item) => item.id === deleteConfirmId);
  const onlineDisableVerification = verifications.find(
    (item) => item.id === onlineDisableConfirmId,
  );
  const pdfDisableVerification = verifications.find((item) => item.id === pdfDisableConfirmId);

  return (
    <section aria-label="Verifiche" className={styles.container}>
      {!selectedVer && (
        <>
          <div className={styles.filters} aria-label="Filtri archivio verifiche">
            <select
              aria-label="Filtro anno scolastico"
              value={yearFilter}
              onChange={(event) => setYearFilter(event.target.value)}
            >
              <option value={FILTER_ALL}>Tutti gli anni</option>
              {yearOptions.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
              {hasNoYear && <option value={YEAR_NONE}>Senza anno</option>}
            </select>
            <select
              aria-label="Filtro classe"
              value={classFilter}
              onChange={(event) => setClassFilter(event.target.value)}
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
              onChange={(event) => setSearch(event.target.value)}
            />
            <div className={styles.filterActions}>
              <button
                type="button"
                className="btn-primary"
                onClick={() => {
                  setCreateError(null);
                  setCreateDialogOpen(true);
                }}
              >
                <IconPlus />
                Nuova verifica
              </button>
              <button
                type="button"
                className={`btn-primary ${styles.aiSettingsBtn}`}
                disabled={aiPrefs.status !== 'ready'}
                onClick={() => setAiSettingsOpen(true)}
              >
                <IconSparkles />
                Impostazioni correzione IA
              </button>
            </div>
            {aiPrefs.status === 'error' && renderAiPrefsError()}
          </div>

          {verifications.length === 0 && (
            <p className="state-empty">Nessuna verifica. Creane una dalla barra superiore.</p>
          )}
          {verifications.length > 0 && filtered.length === 0 && (
            <div className="state-empty">
              <p>Nessuna verifica corrisponde ai filtri.</p>
              <button type="button" onClick={resetFilters}>
                Azzera filtri
              </button>
            </div>
          )}
          {filtered.length > 0 && (
            <div className={styles.verificationList} role="list" aria-label="Archivio verifiche">
              {filtered.map((verification) => {
                const programTitle =
                  programs.find((program) => program.id === verification.config.programId)?.title ??
                  verification.config.programId;
                const className = verification.config.classId
                  ? (classes.find((item) => item.id === verification.config.classId)?.name ??
                    verification.config.classId)
                  : 'Nessuna classe';
                const schoolYear = verificationYear(verification, annoByKey) ?? '—';
                const questionCount =
                  verification.status === 'draft'
                    ? verification.config.questionRefs.length
                    : (verification.teacherSnapshot?.questionRefs.length ??
                      verification.config.questionRefs.length);
                const errors = [
                  pdfErrors[verification.id],
                  solutionsPdfErrors[verification.id],
                  onlineErrors[verification.id],
                  visibilityErrors[verification.id],
                  pdfEnabledErrors[verification.id],
                ].filter((message): message is string => Boolean(message));
                // UI-VERIFICHE-05 — presentazione compatta: il conteggio domande
                // affianca il titolo e classe/anno/programma diventano una sola
                // riga sobria. Gli stessi dati già caricati, nessuna nuova lettura.
                // UI-VERIFICHE-06B — testata «02/02/2026 · Titolo · 6 Domande»: la
                // data è congelata nello snapshot dopo l'attivazione, mentre in
                // bozza vale quella della config. Assente sulle verifiche legacy ⇒
                // omessa insieme al suo separatore, mai sostituita da un trattino.
                const questionLabel = formatQuestionCountLabel(questionCount);
                const datePrefix =
                  formatVerificationDateIt(
                    verification.teacherSnapshot?.verificationDate ??
                      verification.config.verificationDate,
                  ) ?? undefined;
                // Perimetro già in memoria: snapshot congelato per le verifiche
                // attivate, config per le bozze. Nessuna lettura all'apertura.
                const topicOutline = readTopicOutline(
                  verification.teacherSnapshot?.topicOutline ?? verification.config.topicOutline,
                );
                const metaLine = [className, schoolYear, programTitle]
                  .map((part) => part?.trim())
                  .filter((part): part is string => Boolean(part) && part !== '—')
                  .join(' · ');

                return (
                  <VerificationRecordCard
                    key={verification.id}
                    title={verification.config.title}
                    titlePrefix={datePrefix}
                    titleMeta={questionLabel}
                    metaLine={metaLine}
                    openLabel={`Apri dettaglio verifica ${verification.config.title}`}
                    onOpen={() => void handleSelectVer(verification)}
                    defaultCue="Apri verifica →"
                    actionLayout="verification"
                    metrics={[
                      {
                        label: 'Stato',
                        value: (
                          <StatusText
                            status={verification.status}
                            visibility={verification.visibility}
                          />
                        ),
                        icon: <IconClipboardCheck />,
                      },
                      {
                        label: 'Online',
                        icon: <IconWifi />,
                        interactive: verification.status === 'active',
                        value:
                          verification.status === 'active' ? (
                            <button
                              type="button"
                              role="switch"
                              aria-checked={verification.onlineEnabled}
                              data-record-card-cue={`${
                                verification.onlineEnabled ? 'Disattiva' : 'Attiva'
                              } online →`}
                              aria-label={`${verification.onlineEnabled ? 'Disattiva' : 'Attiva'} online — ${verification.config.title}`}
                              title={
                                verification.config.classId == null
                                  ? 'Assegna una classe alla verifica per abilitare l’online'
                                  : verification.onlineEnabled
                                    ? 'Online attivo'
                                    : 'Online disattivato'
                              }
                              className={`${styles.onlineSwitch} ${
                                verification.onlineEnabled ? styles.onlineSwitchOn : ''
                              }`}
                              disabled={
                                onlineLoadingId === verification.id ||
                                (!verification.onlineEnabled && verification.config.classId == null)
                              }
                              onClick={() =>
                                verification.onlineEnabled
                                  ? handleStartDisableOnline(verification.id)
                                  : void handleEnableOnline(verification)
                              }
                            >
                              <span className={styles.onlineSwitchThumb} />
                            </button>
                          ) : (
                            '—'
                          ),
                      },
                      {
                        // UI-VERIFICHE-06B — terzo riquadro: controllo cliccabile
                        // (`interactive`), quindi il click apre la popup e **non**
                        // la card. Il perimetro è già in memoria: nessuna lettura.
                        label: 'Argomenti',
                        icon: <IconLayers />,
                        interactive: true,
                        value: (
                          <VerificationTopicsControl
                            verificationTitle={verification.config.title}
                            topicOutline={topicOutline}
                          />
                        ),
                      },
                    ]}
                    actions={
                      // UI-VERIFICHE-06A — un solo pulsante «Azioni» sulla card:
                      // le sei azioni vivono nel menu portalato condiviso, con
                      // handler, disabled, titoli e conferme identici a prima.
                      <VerificationActionsMenu
                        ariaLabel={`Azioni verifica — ${verification.config.title}`}
                      >
                        <button
                          type="button"
                          role="menuitem"
                          title="Scarica PDF studenti"
                          aria-label={`Scarica PDF studenti — ${verification.config.title}`}
                          disabled={pdfLoadingId === verification.id}
                          onClick={() => void handleDownloadPdf(verification)}
                        >
                          <IconDownload size={15} />
                          Scarica PDF studenti
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          title="Scarica PDF soluzioni"
                          aria-label={`Scarica PDF soluzioni — ${verification.config.title}`}
                          disabled={solutionsPdfLoadingId === verification.id}
                          onClick={() => void handleDownloadSolutionsPdf(verification)}
                        >
                          <IconBookOpen size={15} />
                          Scarica PDF soluzioni
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          title={
                            verification.status === 'draft'
                              ? 'Attiva prima la verifica'
                              : verification.visibility === 'public'
                                ? 'Nascondi allo studente'
                                : 'Pubblica allo studente'
                          }
                          aria-label={`${
                            verification.visibility === 'public' ? 'Nascondi' : 'Pubblica'
                          } allo studente — ${verification.config.title}`}
                          disabled={
                            verification.status === 'draft' ||
                            visibilityLoadingId === verification.id
                          }
                          onClick={() => void handleToggleVisibility(verification)}
                        >
                          {verification.visibility === 'public' ? (
                            <IconEyeOff size={15} />
                          ) : (
                            <IconEye size={15} />
                          )}
                          {verification.visibility === 'public'
                            ? 'Nascondi allo studente'
                            : 'Pubblica allo studente'}
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          title={
                            verification.studentPdfEnabled
                              ? 'Disabilita PDF studente'
                              : 'Abilita PDF studente'
                          }
                          aria-label={`${
                            verification.studentPdfEnabled ? 'Disabilita' : 'Abilita'
                          } PDF studente — ${verification.config.title}`}
                          aria-pressed={verification.studentPdfEnabled}
                          disabled={pdfEnabledLoadingId === verification.id}
                          onClick={() =>
                            verification.studentPdfEnabled
                              ? handleStartDisableStudentPdf(verification.id)
                              : void handleEnableStudentPdf(verification)
                          }
                        >
                          <IconFileText size={15} />
                          {verification.studentPdfEnabled
                            ? 'Disabilita PDF studente'
                            : 'Abilita PDF studente'}
                        </button>
                        {verification.status === 'closed' ? (
                          <button
                            type="button"
                            role="menuitem"
                            title="Riapri verifica"
                            aria-label={`Riapri verifica — ${verification.config.title}`}
                            disabled={reopening}
                            onClick={() => handleStartReopen(verification.id)}
                          >
                            <IconRotateCcw size={15} />
                            Riapri verifica
                          </button>
                        ) : (
                          <button
                            type="button"
                            role="menuitem"
                            title={
                              verification.status === 'active'
                                ? 'Chiudi verifica'
                                : 'Attiva prima la verifica'
                            }
                            aria-label={`Chiudi verifica — ${verification.config.title}`}
                            disabled={verification.status !== 'active' || closing}
                            onClick={() => handleStartClose(verification.id)}
                          >
                            <IconCircleX size={15} />
                            Chiudi verifica
                          </button>
                        )}
                        <button
                          type="button"
                          role="menuitem"
                          className={menuStyles.menuDanger}
                          title={
                            verification.status === 'active'
                              ? 'Chiudi prima la verifica'
                              : 'Elimina verifica'
                          }
                          aria-label={`Elimina verifica — ${verification.config.title}`}
                          disabled={verification.status === 'active' || deleting}
                          onClick={() => handleStartDelete(verification.id)}
                        >
                          <IconTrash size={15} />
                          Elimina verifica
                        </button>
                      </VerificationActionsMenu>
                    }
                    errors={
                      errors.length > 0
                        ? errors.map((message) => (
                            <p key={message} role="alert" className="text-error">
                              {message}
                            </p>
                          ))
                        : undefined
                    }
                  />
                );
              })}
            </div>
          )}
        </>
      )}

      {createDialogOpen && (
        <DialogShell
          title="Nuova verifica"
          busy={creating}
          onCancel={() => setCreateDialogOpen(false)}
        >
          <form className={styles.createDialogForm} onSubmit={(event) => void handleCreate(event)}>
            <div className={styles.formField}>
              <div className={styles.titleFieldHeader}>
                <label htmlFor="new-ver-title">Titolo</label>
                <span className={styles.titleCounter} aria-live="polite">
                  {newTitle.length}/{VERIFICATION_TITLE_MAX_LENGTH}
                </span>
              </div>
              <input
                id="new-ver-title"
                type="text"
                value={newTitle}
                maxLength={VERIFICATION_TITLE_MAX_LENGTH}
                onChange={(event) => setNewTitle(event.target.value)}
                autoFocus
              />
            </div>
            <div className={styles.formField}>
              <label htmlFor="new-ver-program">Corso</label>
              <select
                id="new-ver-program"
                value={newProgramId}
                onChange={(event) => setNewProgramId(event.target.value)}
              >
                <option value="">
                  {readyPrograms.length === 0 ? 'Nessun corso pronto' : 'Seleziona corso'}
                </option>
                {readyPrograms.map((program) => (
                  <option key={program.id} value={program.id}>
                    {program.title}
                  </option>
                ))}
              </select>
            </div>
            {/* UI-VERIFICHE-06B — Classe e Data affiancate su desktop, impilate su
                mobile: la data è un dato didattico obbligatorio, non un extra. */}
            <div className={styles.formRow}>
              <div className={styles.formField}>
                <label htmlFor="new-ver-class">Classe (opzionale)</label>
                <select
                  id="new-ver-class"
                  value={newClassId}
                  onChange={(event) => setNewClassId(event.target.value)}
                >
                  <option value="">Nessuna</option>
                  {classes.map((classItem) => (
                    <option key={classItem.id} value={classItem.id}>
                      {classItem.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className={styles.formField}>
                <label htmlFor="new-ver-date">Data</label>
                <input
                  id="new-ver-date"
                  type="date"
                  value={newDate}
                  onChange={(event) => setNewDate(event.target.value)}
                />
              </div>
            </div>
            {createError && (
              <p role="alert" className="text-error">
                {createError}
              </p>
            )}
            <div className={styles.dialogActions}>
              <button type="button" disabled={creating} onClick={() => setCreateDialogOpen(false)}>
                Annulla
              </button>
              <button
                type="submit"
                className="btn-primary"
                disabled={
                  creating || !newTitle.trim() || !newProgramId || !isValidVerificationDate(newDate)
                }
              >
                {creating ? 'Creazione…' : 'Crea verifica'}
              </button>
            </div>
          </form>
        </DialogShell>
      )}

      {closeConfirmVerification && (
        <DialogShell
          title="Conferma chiusura"
          role="alertdialog"
          busy={closing}
          onCancel={() => setCloseConfirmId(null)}
        >
          <div role="region" aria-label="Conferma chiusura">
            <p>
              Chiudere <strong>{closeConfirmVerification.config.title}</strong>? Potrai riaprirla in
              seguito.
            </p>
            {closeError && (
              <p role="alert" className="text-error">
                {closeError}
              </p>
            )}
            <div className={styles.dialogActions}>
              <button type="button" disabled={closing} onClick={() => setCloseConfirmId(null)}>
                Annulla
              </button>
              <button
                type="button"
                className="btn-success"
                disabled={closing}
                onClick={() => void handleConfirmClose(closeConfirmVerification.id)}
              >
                {closing ? 'Chiusura…' : 'Conferma chiusura'}
              </button>
            </div>
          </div>
        </DialogShell>
      )}

      {reopenConfirmVerification && (
        <DialogShell
          title="Conferma riapertura"
          role="alertdialog"
          busy={reopening}
          onCancel={() => setReopenConfirmId(null)}
        >
          <div role="region" aria-label="Conferma riapertura">
            <p>
              Riaprire <strong>{reopenConfirmVerification.config.title}</strong>? La verifica
              tornerà attiva mantenendo visibilità, disponibilità online e impostazione PDF
              correnti.
            </p>
            {reopenError && (
              <p role="alert" className="text-error">
                {reopenError}
              </p>
            )}
            <div className={styles.dialogActions}>
              <button type="button" disabled={reopening} onClick={() => setReopenConfirmId(null)}>
                Annulla
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={reopening}
                onClick={() => void handleConfirmReopen(reopenConfirmVerification.id)}
              >
                {reopening ? 'Riapertura…' : 'Riapri verifica'}
              </button>
            </div>
          </div>
        </DialogShell>
      )}

      {deleteConfirmVerification && (
        <DialogShell
          title="Conferma eliminazione"
          role="alertdialog"
          busy={deleting}
          onCancel={() => setDeleteConfirmId(null)}
        >
          <div role="region" aria-label="Conferma eliminazione">
            <p>
              Eliminare definitivamente <strong>{deleteConfirmVerification.config.title}</strong>?
              L&apos;operazione è irreversibile e non può essere annullata.
            </p>
            {deleteError && (
              <p role="alert" className="text-error">
                {deleteError}
              </p>
            )}
            <div className={styles.dialogActions}>
              <button type="button" disabled={deleting} onClick={() => setDeleteConfirmId(null)}>
                Annulla
              </button>
              <button
                type="button"
                className="btn-danger"
                disabled={deleting}
                onClick={() => void handleConfirmDelete(deleteConfirmVerification.id)}
              >
                {deleting ? 'Eliminazione…' : 'Elimina definitivamente'}
              </button>
            </div>
          </div>
        </DialogShell>
      )}

      {onlineDisableVerification && (
        <DialogShell
          title="Conferma disattivazione online"
          role="alertdialog"
          busy={onlineLoadingId === onlineDisableVerification.id}
          onCancel={() => setOnlineDisableConfirmId(null)}
        >
          <div
            className={styles.onlineDisableDialog}
            role="region"
            aria-label="Conferma disattivazione online"
          >
            <p>
              Le bozze esistenti non potranno essere salvate o consegnate finché l&apos;online resta
              disabilitato.
            </p>
            {onlineDisableError && (
              <p role="alert" className="text-error">
                {onlineDisableError}
              </p>
            )}
            <div className={styles.dialogActions}>
              <button
                type="button"
                disabled={onlineLoadingId === onlineDisableVerification.id}
                onClick={() => setOnlineDisableConfirmId(null)}
              >
                Annulla
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={onlineLoadingId === onlineDisableVerification.id}
                onClick={() => void handleConfirmDisableOnline(onlineDisableVerification.id)}
              >
                {onlineLoadingId === onlineDisableVerification.id
                  ? 'Disattivazione…'
                  : 'Disattiva online'}
              </button>
            </div>
          </div>
        </DialogShell>
      )}

      {pdfDisableVerification && (
        <DialogShell
          title="Conferma disattivazione PDF studente"
          role="alertdialog"
          busy={pdfEnabledLoadingId === pdfDisableVerification.id}
          onCancel={() => setPdfDisableConfirmId(null)}
        >
          <div role="region" aria-label="Conferma disattivazione PDF studente">
            <p>
              Gli studenti non potranno più scaricare il PDF di{' '}
              <strong>{pdfDisableVerification.config.title}</strong>.
            </p>
            {pdfDisableError && (
              <p role="alert" className="text-error">
                {pdfDisableError}
              </p>
            )}
            <div className={styles.dialogActions}>
              <button
                type="button"
                disabled={pdfEnabledLoadingId === pdfDisableVerification.id}
                onClick={() => setPdfDisableConfirmId(null)}
              >
                Annulla
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={pdfEnabledLoadingId === pdfDisableVerification.id}
                onClick={() => void handleConfirmDisableStudentPdf(pdfDisableVerification.id)}
              >
                {pdfEnabledLoadingId === pdfDisableVerification.id
                  ? 'Disattivazione…'
                  : 'Disattiva PDF'}
              </button>
            </div>
          </div>
        </DialogShell>
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
              <div className={styles.draftField}>
                <div className={styles.titleFieldHeader}>
                  <label htmlFor="draft-title">Titolo bozza</label>
                  <span className={styles.titleCounter} aria-live="polite">
                    {editDraftTitle.length}/{VERIFICATION_TITLE_MAX_LENGTH}
                  </span>
                </div>
                <input
                  id="draft-title"
                  type="text"
                  value={editDraftTitle}
                  maxLength={VERIFICATION_TITLE_MAX_LENGTH}
                  onChange={(e) => {
                    setEditDraftTitle(e.target.value);
                    markDraftDirty();
                  }}
                />
              </div>
              {/* UI-VERIFICHE-06B — la data resta modificabile finché la verifica è
                  in bozza, con lo stesso «Salva bozza» di titolo, classe e
                  domande: nessun percorso e nessuna scrittura aggiuntivi. */}
              <div className={styles.draftField}>
                <label htmlFor="draft-date">Data</label>
                <input
                  id="draft-date"
                  type="date"
                  value={editDraftDate}
                  onChange={(e) => {
                    setEditDraftDate(e.target.value);
                    markDraftDirty();
                  }}
                />
              </div>
              <div className={styles.draftField}>
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

              {/* VEX-01A: builder «Distribuzione online», subito dopo il picker.
                  Mostrato solo in bozza (non su verifiche attive/chiuse). */}
              <VexBuilder
                distributionMode={distributionMode}
                onModeChange={handleDistributionModeChange}
                selectedRefs={selectedRefsForBuilder()}
                groups={equivalentGroups}
                onGroupsChange={handleEquivalentGroupsChange}
              />

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
                {/* TWU-02A — title + inline refresh status (no separate row, no
                    layout shift of the table). aria-live only on the status. */}
                <div className={styles.monitorTitleGroup}>
                  <h3 className={styles.createTitle}>Consegne online</h3>
                  <span
                    role="status"
                    aria-live="polite"
                    className={styles.refreshStatus}
                    data-state={
                      monitorRefreshing
                        ? 'loading'
                        : monitorRefreshError
                          ? 'error'
                          : monitorRefreshedAt
                            ? 'success'
                            : 'idle'
                    }
                  >
                    {monitorRefreshing
                      ? 'Aggiornamento…'
                      : monitorRefreshError
                        ? 'Aggiornamento non riuscito'
                        : monitorRefreshedAt
                          ? `Aggiornato alle ${monitorRefreshedAt}`
                          : ''}
                  </span>
                </div>
                <div className={styles.monitorActions}>
                  <button
                    type="button"
                    className={styles.refreshBtn}
                    aria-label="Aggiorna consegne"
                    disabled={monitorStudents === null || monitorRefreshing}
                    onClick={() => void refreshMonitor()}
                  >
                    <IconRotateCcw />
                    <span className={styles.refreshLabel}>
                      {monitorRefreshing ? 'Aggiornamento…' : 'Aggiorna'}
                    </span>
                  </button>
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
              {/* TWU-02 — if the AI preferences failed to load, «Correggi con IA»
                  must not start on invented defaults: show the persistent error
                  + «Riprova» and disable the button until preferences are ready. */}
              {aiPrefs.status === 'error' && renderAiPrefsError()}
              {/* M5-04A/TWU-03A/CORR-PDF-01: ordine operativo stabile e
                  griglia responsive 7 → 2 → 1, con Azzera sempre ultimo e
                  unico distruttivo. */}
              <div
                className={styles.batchToolbar}
                role="group"
                aria-label="Azioni sulle consegne selezionate"
              >
                <button
                  type="button"
                  className="btn-primary"
                  disabled={
                    aiSelectedUids.size === 0 ||
                    aiDialogOpen ||
                    batchAction !== null ||
                    batchReturnVisibilityAction !== null ||
                    archiveExportBusy ||
                    archiveEligibility !== null ||
                    aiPrefs.status !== 'ready'
                  }
                  onClick={() => setAiDialogOpen(true)}
                >
                  <IconSparkles />
                  Correggi con IA
                  {aiSelectedUids.size > 0 ? ` (${aiSelectedUids.size})` : ''}
                </button>
                {(
                  [
                    { action: 'complete', label: 'Completa', Icon: IconCircleCheck },
                    { action: 'return', label: 'Restituisci', Icon: IconSend },
                  ] as const
                ).map(({ action, label, Icon }) => (
                  <button
                    key={action}
                    type="button"
                    className="btn-primary"
                    disabled={
                      aiSelectedUids.size === 0 ||
                      aiDialogOpen ||
                      batchAction !== null ||
                      batchReturnVisibilityAction !== null ||
                      archiveExportBusy ||
                      archiveEligibility !== null
                    }
                    onClick={() => setBatchAction(action)}
                  >
                    <Icon />
                    {label}
                  </button>
                ))}
                <BatchVisibilityMenu
                  disabled={
                    aiSelectedUids.size === 0 ||
                    aiDialogOpen ||
                    batchAction !== null ||
                    batchReturnVisibilityAction !== null ||
                    archiveExportBusy ||
                    archiveEligibility !== null
                  }
                  contextKey={selectedVer?.id ?? ''}
                  onSelect={setBatchReturnVisibilityAction}
                />
                <button
                  type="button"
                  className="btn-primary"
                  disabled={
                    aiSelectedUids.size === 0 ||
                    aiDialogOpen ||
                    batchAction !== null ||
                    batchReturnVisibilityAction !== null ||
                    archiveExportBusy ||
                    archiveEligibility !== null
                  }
                  onClick={() => void handleCorrectionArchiveExport()}
                >
                  {archiveExportBusy ? (
                    <span className="spinner" aria-hidden="true" />
                  ) : (
                    <IconDownload />
                  )}
                  {archiveExportBusy ? 'Preparazione…' : 'PDF correzioni'}
                </button>
                {(
                  [
                    { action: 'reopen', label: 'Riapri', Icon: IconRotateCcw },
                    { action: 'clear', label: 'Azzera', Icon: IconEraser },
                  ] as const
                ).map(({ action, label, Icon }) => (
                  <button
                    key={action}
                    type="button"
                    className={action === 'clear' ? 'btn-danger' : 'btn-primary'}
                    disabled={
                      aiSelectedUids.size === 0 ||
                      aiDialogOpen ||
                      batchAction !== null ||
                      batchReturnVisibilityAction !== null ||
                      archiveExportBusy ||
                      archiveEligibility !== null
                    }
                    onClick={() => setBatchAction(action)}
                  >
                    <Icon />
                    {label}
                  </button>
                ))}
              </div>
              <>
                {/* TWU-02A: the refresh status now lives inline in the header
                    above (no separate row → no table layout shift). */}
                {csvExportError && (
                  <p role="alert" className="text-error">
                    {csvExportError}
                  </p>
                )}
                {pdfExportError && (
                  <div role="alert" className="text-error">
                    <p>{pdfExportError}</p>
                    {pdfExportNeedsReload && (
                      <button type="button" onClick={reloadCurrentPage}>
                        Ricarica pagina
                      </button>
                    )}
                  </div>
                )}
                {archiveExportError && (
                  <div role="alert" className="text-error">
                    <p>
                      {archiveExportError === 'stale_chunk'
                        ? 'SchoolForge è stato aggiornato. Ricarica la pagina e riprova.'
                        : 'Impossibile generare i PDF. Riprova.'}
                    </p>
                    {archiveExportError === 'stale_chunk' && (
                      <button type="button" onClick={reloadCurrentPage}>
                        Ricarica pagina
                      </button>
                    )}
                    {archiveExportFailures.length > 0 && (
                      <ul>
                        {archiveExportFailures.map((studentName, index) => (
                          <li key={`${studentName}-${index}`}>{studentName}</li>
                        ))}
                      </ul>
                    )}
                  </div>
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
                            <th className={`${styles.th} ${styles.visibilityHeader}`}>
                              Visibilità
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
                            const submissionId = `${selectedVer.id}_${row.studentUid}`;
                            const visibility = correctionReturnVisibility.get(submissionId);
                            const showVisibility =
                              correctionProgress.get(row.studentUid)?.status === 'returned' &&
                              visibility?.studentUid === row.studentUid;
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
                                <td className={`${styles.td} ${styles.visibilityCell}`}>
                                  {showVisibility && visibility ? (
                                    <span
                                      className={styles.visibilityIcons}
                                      aria-label="Stato visibilità restituzione"
                                    >
                                      <span
                                        className={styles.visibilityIcon}
                                        title={
                                          visibility.visibleToStudent
                                            ? 'Restituzione visibile allo studente'
                                            : 'Restituzione nascosta allo studente'
                                        }
                                        aria-label={
                                          visibility.visibleToStudent
                                            ? 'Restituzione visibile allo studente'
                                            : 'Restituzione nascosta allo studente'
                                        }
                                      >
                                        {visibility.visibleToStudent ? <IconEye /> : <IconEyeOff />}
                                      </span>
                                      <span
                                        className={styles.visibilityIcon}
                                        title={
                                          visibility.solutionsVisible
                                            ? 'Soluzioni visibili allo studente'
                                            : 'Soluzioni nascoste allo studente'
                                        }
                                        aria-label={
                                          visibility.solutionsVisible
                                            ? 'Soluzioni visibili allo studente'
                                            : 'Soluzioni nascoste allo studente'
                                        }
                                      >
                                        {visibility.solutionsVisible ? (
                                          <IconBookOpen />
                                        ) : (
                                          <IconCircleX />
                                        )}
                                      </span>
                                    </span>
                                  ) : (
                                    <span aria-label="Visibilità non disponibile">—</span>
                                  )}
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
                                            studentUid: row.studentUid,
                                            studentName,
                                          })
                                        }
                                      >
                                        ✏️
                                      </button>
                                    ) : (
                                      !(item && selectedVer.status === 'closed') && '—'
                                    )}
                                    {/* M5-06B — delete a real submission on an
                                        active OR closed verification, as long as
                                        the correction was never returned. A
                                        returned submission shows a disabled trash
                                        with an accessible explanation (keeps the
                                        Azioni column layout stable). Eligibility
                                        comes from the row's own correctionStatus
                                        mirror — no extra per-row read; the service
                                        preflight is the authoritative gate. */}
                                    {item &&
                                      (item.correctionStatus === 'returned' ? (
                                        <button
                                          type="button"
                                          className={styles.iconBtn}
                                          title="La correzione è già stata restituita: la consegna non è eliminabile."
                                          aria-label={`Consegna non eliminabile (correzione restituita) — ${studentName}`}
                                          disabled
                                        >
                                          <IconTrash />
                                        </button>
                                      ) : (
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
                                      ))}
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

      {aiSettingsOpen && aiPrefs.status === 'ready' && (
        <AiCorrectionSettingsDialog
          ownerUid={ownerUid}
          db={db}
          initial={aiPrefs.preferences}
          onClose={() => setAiSettingsOpen(false)}
          onSaved={(prefs) => {
            setAiPrefs({ status: 'ready', preferences: prefs });
            setAiSettingsOpen(false);
          }}
        />
      )}

      {aiDialogOpen && selectedVer && aiPrefs.status === 'ready' && (
        <AiBatchCorrectionDialog
          verificationId={selectedVer.id}
          submissionIds={aiSelectedSubmissionIds}
          callables={aiCallables}
          defaults={aiPrefs.preferences}
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
          verificationId={selectedVer.id}
          verification={selectedVer}
          onClose={() => setBatchAction(null)}
          onApplied={(action, results) => {
            if (action === 'return') {
              setCorrectionReturnVisibility((current) => {
                const next = new Map(current);
                for (const result of results) {
                  if (result.outcome !== 'succeeded') continue;
                  next.set(result.submissionId, {
                    submissionId: result.submissionId,
                    studentUid: result.studentUid,
                    visibleToStudent: true,
                    solutionsVisible: true,
                  });
                }
                return next;
              });
            }
            // M5-04A: una sola rilettura mirata aggiorna «Valutate»/stato/
            // percentuale. La selezione resta INVARIATA (né riuscite né fallite
            // vengono deselezionate): il docente può concatenare azioni sullo
            // stesso gruppo. La selezione cambia solo manualmente.
            void refreshCorrectionProgress();
          }}
        />
      )}

      {batchReturnVisibilityAction && selectedVer && (
        <BatchReturnVisibilityDialog
          action={batchReturnVisibilityAction}
          rows={batchSelectedRows}
          ownerUid={ownerUid}
          verificationId={selectedVer.id}
          verification={selectedVer}
          db={db}
          onClose={() => setBatchReturnVisibilityAction(null)}
          onApplied={(_action, results) => {
            // Server-confirmed values only: succeeded/no-op rows update the
            // local map; failures keep their previous state. No final read.
            setCorrectionReturnVisibility((current) => {
              const next = new Map(current);
              for (const result of results) {
                if (result.outcome === 'failed') continue;
                next.set(result.submissionId, {
                  submissionId: result.submissionId,
                  studentUid: result.studentUid,
                  visibleToStudent: result.visibleToStudent,
                  solutionsVisible: result.solutionsVisible,
                });
              }
              return next;
            });
          }}
        />
      )}

      {archiveEligibility && selectedVer && (
        <CorrectionArchiveExportDialog
          selectedCount={batchSelectedRows.length}
          eligibility={archiveEligibility}
          run={() => executeCorrectionArchiveExport(archiveEligibility)}
          onClose={() => setArchiveEligibility(null)}
          onReload={reloadCurrentPage}
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
              Verranno eliminati definitivamente: la consegna, le risposte, la correzione e lo
              storico della correzione. L’operazione è irreversibile.
            </p>
            <p className={styles.deleteDialogBody}>
              Se la correzione è stata riaperta dopo una restituzione, verrà eliminata anche la
              precedente restituzione ora nascosta allo studente.
            </p>
            <p className={styles.deleteDialogBody}>
              {selectedVer?.status === 'closed'
                ? 'La verifica resterà chiusa: eliminare la consegna non la riapre né consente un nuovo svolgimento.'
                : 'Se la verifica è ancora disponibile per la classe, lo studente potrà svolgerla di nuovo finché resta online e visibile.'}
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
