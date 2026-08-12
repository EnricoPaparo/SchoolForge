import { type ChangeEvent, type KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import type { Timestamp } from 'firebase/firestore';
import { db } from '../../lib/firebase.js';
import { listClasses } from '../repository/classes/classesService.js';
import {
  getStudentAccessSettings,
  setExamMode,
  setNewStudentRequestsEnabled,
  setStudentPortalEnabled,
  type StudentAccessSnapshot,
} from '../repository/students/studentAccessService.js';
import { listActiveOnlineVerificationClassIds } from '../repository/verifications/verificationsService.js';
import {
  approveStudent,
  assignStudentClass,
  blockStudent,
  listStudents,
  removeStudent,
  resetStudentToPending,
  type StudentItem,
} from '../repository/students/studentsService.js';
import {
  listDifferentiationLabels,
  type DifferentiationLabelItem,
} from '../repository/differentiation/differentiationLabelsService.js';
import {
  listStudentLabelAssignments,
  setStudentLabelAssignment,
  type StudentLabelAssignmentItem,
} from '../repository/studentLabelAssignments/studentLabelAssignmentsService.js';
import type { StudentStatus } from '../../types/firestore.js';
import { ClassesTab, type ClassesTabItem } from './ClassesTab.js';
import { LabelsTab } from './LabelsTab.js';
// `NO_LABEL_TEXT` è lo stesso testo mostrato nella select: la ricerca deve
// trovare «Nessuna etichetta» esattamente come l'utente lo legge.
import { NO_LABEL_TEXT, StudentIdentityFields } from './StudentIdentityFields.js';
import { RecordCard } from '../../components/RecordCard.js';
import { RecordActionsMenu } from './RecordActionsMenu.js';
import {
  IconCircleCheck,
  IconCircleX,
  IconClipboardCheck,
  IconRotateCcw,
  IconSend,
  IconTrash,
} from '../../components/icons.js';
import menuStyles from './CourseWorkspace.module.css';
import styles from './StudentsView.module.css';

/** VDIF-01 — la sezione Studenti ha ora tre schede. L'ordine è vincolante. */
const STUDENTS_TABS = ['students', 'classes', 'labels'] as const;
type StudentsTab = (typeof STUDENTS_TABS)[number];

const STATUS_LABEL: Record<StudentStatus, string> = {
  pending: 'In attesa',
  approved: 'Approvato',
  blocked: 'Bloccato',
};

/**
 * UI-STUDENTI-CLASSI-01 — colore sobrio e semantico del valore «Stato» dentro il
 * riquadro metrica: verde approvato, ambra in attesa, rosso bloccato. Il colore
 * accompagna l'etichetta testuale, non la sostituisce.
 */
const STATUS_TEXT_CLASS: Record<StudentStatus, string> = {
  pending: 'statusPending',
  approved: 'statusApproved',
  blocked: 'statusBlocked',
};

/**
 * Splits a Firestore timestamp into a date line and an "HH:mm" time line so the
 * card can show the date on top and the time in small text below it, saving
 * horizontal space. Returns `null` for missing/legacy values — mai una data
 * inventata, mai una migrazione.
 */
function formatDateTime(value: Timestamp | unknown): { date: string; time: string } | null {
  if (value && typeof (value as Timestamp).toDate === 'function') {
    const d = (value as Timestamp).toDate();
    return {
      date: d.toLocaleDateString('it-IT', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      }),
      time: d.toLocaleTimeString('it-IT', {
        hour: '2-digit',
        minute: '2-digit',
      }),
    };
  }
  return null;
}

interface Props {
  ownerUid: string;
  /** Called after any action that can change the pending count, so TeacherShell can refresh its nav badge. */
  onStudentsChanged?: () => void;
}

function ToggleCard({
  title,
  description,
  checked,
  disabled,
  onToggle,
}: {
  title: string;
  description: string;
  checked: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <div className={styles.toggleCard}>
      <div className={styles.toggleCardHeader}>
        <span className={styles.toggleTitle}>{title}</span>
        <button
          type="button"
          role="switch"
          aria-checked={checked}
          aria-label={title}
          className={`${styles.switch} ${checked ? styles.switchOn : ''}`}
          disabled={disabled}
          onClick={onToggle}
        >
          <span className={styles.switchThumb} />
        </button>
      </div>
      <p className={styles.toggleDesc}>{description}</p>
      <span className={`badge ${checked ? 'badge-ok' : 'badge-warning'}`}>
        {checked ? 'Attivo' : 'Disattivato'}
      </span>
    </div>
  );
}

/**
 * Ordine stabile e leggibile delle etichette: `nameKey` è già la forma
 * normalizzata, quindi ordinare su di essa evita sia un `orderBy` Firestore
 * (che richiederebbe un indice composito con il filtro `ownerUid`) sia le
 * sorprese di un confronto sensibile a maiuscole e accenti.
 */
function sortLabels(items: DifferentiationLabelItem[]): DifferentiationLabelItem[] {
  return [...items].sort((a, b) => a.nameKey.localeCompare(b.nameKey, 'it'));
}

/** "Disattivata" / "Tutte le classi" / comma-separated class names. */
function examModeStatusLabel(
  examMode: StudentAccessSnapshot['examMode'],
  classNameById: Map<string, string>,
): string {
  if (!examMode.enabled) return 'Disattivata';
  if (examMode.scope === 'all') return 'Tutte le classi';
  const names = examMode.classIds.map((id) => classNameById.get(id) ?? id);
  return names.length > 0 ? names.join(', ') : 'Nessuna classe';
}

/**
 * M3F-11A: activation is a direct manual action, but its class scope is
 * derived from active+onlineEnabled verifications instead of asking the
 * teacher to repeat the same selection in a dialog.
 */
function ExamModeCard({
  examMode,
  classNameById,
  eligibleClassIds,
  disabled,
  onRequestEnable,
  onRequestDisable,
}: {
  examMode: StudentAccessSnapshot['examMode'];
  classNameById: Map<string, string>;
  eligibleClassIds: string[];
  disabled: boolean;
  onRequestEnable: () => void;
  onRequestDisable: () => void;
}) {
  return (
    <div className={styles.toggleCard}>
      <div className={styles.toggleCardHeader}>
        <span className={styles.toggleTitle}>Modalità verifica</span>
        <button
          type="button"
          role="switch"
          aria-checked={examMode.enabled}
          aria-label="Modalità verifica"
          className={`${styles.switch} ${examMode.enabled ? styles.switchOn : ''}`}
          disabled={disabled}
          title={
            !examMode.enabled && eligibleClassIds.length === 0
              ? 'Nessuna verifica online attiva con una classe assegnata.'
              : undefined
          }
          onClick={examMode.enabled ? onRequestDisable : onRequestEnable}
        >
          <span className={styles.switchThumb} />
        </button>
      </div>
      <p className={styles.toggleDesc}>
        Nasconde temporaneamente le Lezioni agli studenti delle classi coinvolte.
      </p>
      <span className={`badge ${examMode.enabled ? 'badge-warning' : 'badge-ok'}`}>
        {examModeStatusLabel(examMode, classNameById)}
      </span>
      {!examMode.enabled && eligibleClassIds.length > 0 && (
        <span className={styles.eligibleClasses}>
          Classi coinvolte: {eligibleClassIds.map((id) => classNameById.get(id) ?? id).join(', ')}
        </span>
      )}
    </div>
  );
}

export function StudentsView({ ownerUid, onStudentsChanged }: Props) {
  const [activeTab, setActiveTab] = useState<StudentsTab>('students');
  /**
   * Un ref per scheda, indicizzato dal nome: con tre schede una coppia di ref
   * separati diventerebbe una catena di ternari, e una quarta scheda la
   * romperebbe di nuovo.
   */
  const tabRefs = useRef<Record<StudentsTab, HTMLButtonElement | null>>({
    students: null,
    classes: null,
    labels: null,
  });
  const [students, setStudents] = useState<StudentItem[] | null>(null);
  const [classes, setClasses] = useState<ClassesTabItem[] | null>(null);
  const [labels, setLabels] = useState<DifferentiationLabelItem[] | null>(null);
  /**
   * VDIF-01 — un guasto sulle sole etichette non deve far sparire studenti e
   * classi, ma nemmeno mostrare una lista vuota come se fosse completa: la
   * scheda Etichette mostra l'errore, le altre due restano operative.
   */
  const [labelsError, setLabelsError] = useState<string | null>(null);
  /**
   * VDIF-02 — assegnazioni caricate una volta con le etichette e unite in
   * memoria via `labelId`. L'assegnazione **non** porta il nome: una rinomina si
   * riflette da sola attraverso il join, senza toccare un solo documento.
   */
  const [assignments, setAssignments] = useState<StudentLabelAssignmentItem[] | null>(null);
  /** Studenti con una mutazione in corso: operazioni su card diverse possono convivere. */
  const [labelBusyUids, setLabelBusyUids] = useState<ReadonlySet<string>>(() => new Set());
  /** Errori ancorati alle rispettive card, non un banner globale. */
  const [labelErrors, setLabelErrors] = useState<ReadonlyMap<string, string>>(() => new Map());
  /**
   * Scelte **tentate** e non ancora persistite, una per card. In caso di errore
   * la select continua a mostrarle: un ripristino silenzioso al valore
   * precedente farebbe credere che non sia successo nulla.
   */
  const [pendingLabels, setPendingLabels] = useState<ReadonlyMap<string, string | null>>(
    () => new Map(),
  );
  const [eligibleExamClassIds, setEligibleExamClassIds] = useState<string[] | null>(null);
  const [access, setAccess] = useState<StudentAccessSnapshot | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | StudentStatus>('all');

  const [togglingPortal, setTogglingPortal] = useState(false);
  const [togglingRequests, setTogglingRequests] = useState(false);

  const [examModeSaving, setExamModeSaving] = useState(false);
  const [examModeError, setExamModeError] = useState<string | null>(null);
  const [examModeDisableConfirm, setExamModeDisableConfirm] = useState(false);

  /**
   * Guardia **sincrona per studente**: due eventi dello stesso uid non avviano
   * due transazioni, mentre due card diverse restano indipendenti.
   */
  const labelBusyRef = useRef(new Set<string>());

  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  useEffect(() => {
    void loadAll();
  }, []);

  /**
   * Dati «core» della vista: studenti, classi, impostazioni di accesso e classi
   * eleggibili per la Modalità verifica. È **esattamente** ciò che veniva
   * ricaricato prima di VDIF-01, e resta ciò che si ricarica dopo ogni azione
   * su uno studente.
   */
  async function loadCore() {
    setLoadError(null);
    try {
      const [studentsList, classesList, accessSettings, activeOnlineClassIds] = await Promise.all([
        listStudents(ownerUid, db),
        listClasses(ownerUid, db),
        getStudentAccessSettings(db),
        listActiveOnlineVerificationClassIds(ownerUid, db),
      ]);
      setStudents(studentsList);
      setClasses(classesList);
      setAccess(accessSettings);
      setEligibleExamClassIds(activeOnlineClassIds);
    } catch {
      setLoadError('Impossibile caricare gli studenti.');
    }
  }

  /**
   * VDIF-01 — le etichette si caricano **una sola volta**, all'apertura della
   * vista, e poi vivono in memoria: le mutazioni CRUD aggiornano la lista
   * localmente (il service restituisce già il documento risultante).
   *
   * Deliberatamente **fuori** da `loadCore`: approvare uno studente, bloccarlo,
   * cambiargli classe o rimuoverlo non tocca né le etichette né i loro
   * contatori, quindi rileggerle dopo ogni azione sarebbe una query pagata per
   * ottenere dati identici. Quando VDIF-02 introdurrà l'assegnazione — che
   * muove `assignedCount` — sarà quel percorso ad aggiornare il contatore, non
   * un refetch a tappeto.
   *
   * Un errore qui non impedisce di lavorare su studenti e classi: resta
   * circoscritto alla scheda Etichette, che lo mostra invece di presentare una
   * lista vuota come se fosse completa.
   */
  async function loadLabels() {
    setLabelsError(null);
    try {
      // VDIF-02 — due query in parallelo, una volta sola: etichette e
      // assegnazioni si uniscono in memoria via `labelId`. Nessuna lettura per
      // card, nessun listener, nessun polling.
      const [labelList, assignmentList] = await Promise.all([
        listDifferentiationLabels(ownerUid, db),
        listStudentLabelAssignments(ownerUid, db),
      ]);
      setLabels(labelList);
      setAssignments(assignmentList);
    } catch (error) {
      setLabels(null);
      setAssignments(null);
      setLabelsError(
        error instanceof Error && error.message
          ? error.message
          : 'Impossibile caricare le etichette.',
      );
    }
  }

  async function loadAll() {
    await Promise.all([loadCore(), loadLabels()]);
  }

  const classNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of classes ?? []) map.set(c.id, c.name);
    return map;
  }, [classes]);

  /** VDIF-02 — join in memoria: `labelId` → nome, unica fonte del nome mostrato. */
  const labelNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const label of labels ?? []) map.set(label.labelId, label.name);
    return map;
  }, [labels]);

  const labelIdByStudentUid = useMemo(() => {
    const map = new Map<string, string>();
    for (const assignment of assignments ?? []) {
      map.set(assignment.studentUid, assignment.labelId);
    }
    return map;
  }, [assignments]);

  /**
   * Etichette in ordine alfabetico per **nome**, come le legge il docente.
   * L'ordinamento della lista (per `nameKey`) serve alla scheda Etichette; qui
   * conta la stringa visibile.
   */
  const sortedLabels = useMemo(
    () => [...(labels ?? [])].sort((a, b) => a.name.localeCompare(b.name, 'it')),
    [labels],
  );

  function labelTextFor(studentUid: string): string {
    const labelId = labelIdByStudentUid.get(studentUid);
    if (!labelId) return NO_LABEL_TEXT;
    // Un'assegnazione che punta a un'etichetta non più in lista non viene
    // mascherata come «Nessuna etichetta»: si mostra lo stato per quello che è.
    return labelNameById.get(labelId) ?? 'Etichetta non disponibile';
  }

  const pendingCount = useMemo(
    () => (students ?? []).filter((s) => s.status === 'pending').length,
    [students],
  );

  const studentCountByClassId = useMemo(() => {
    const counts = new Map<string, number>();
    for (const student of students ?? []) {
      if (!student.classId) continue;
      counts.set(student.classId, (counts.get(student.classId) ?? 0) + 1);
    }
    return counts;
  }, [students]);

  const filteredStudents = useMemo(() => {
    if (!students) return [];
    const term = search.trim().toLowerCase();
    return students.filter((s) => {
      if (statusFilter !== 'all' && s.status !== statusFilter) return false;
      if (!term) return true;
      const className = s.classId ? (classNameById.get(s.classId) ?? '') : 'nessuna classe';
      // VDIF-02 — l'etichetta entra nel testo cercabile: sia il suo nome sia la
      // stringa «Nessuna etichetta», così si trovano anche gli studenti senza.
      const haystack = [
        s.displayName ?? '',
        s.email,
        STATUS_LABEL[s.status],
        className,
        labelTextFor(s.id),
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(term);
    });
    // `labelTextFor` dipende dalle due mappe elencate: cambiano insieme a loro.
  }, [students, search, statusFilter, classNameById, labelNameById, labelIdByStudentUid]);

  async function handleTogglePortal() {
    if (!access) return;
    setTogglingPortal(true);
    try {
      const next = !access.studentPortalEnabled;
      await setStudentPortalEnabled(next, ownerUid, db);
      setAccess((prev) => (prev ? { ...prev, studentPortalEnabled: next } : prev));
    } finally {
      setTogglingPortal(false);
    }
  }

  async function handleToggleRequests() {
    if (!access) return;
    setTogglingRequests(true);
    try {
      const next = !access.newStudentRequestsEnabled;
      await setNewStudentRequestsEnabled(next, ownerUid, db);
      setAccess((prev) => (prev ? { ...prev, newStudentRequestsEnabled: next } : prev));
    } finally {
      setTogglingRequests(false);
    }
  }

  async function handleEnableExamMode() {
    if (!access || !eligibleExamClassIds || eligibleExamClassIds.length === 0) return;
    setExamModeError(null);
    setExamModeSaving(true);
    try {
      await setExamMode(
        { enabled: true, scope: 'classes', classIds: eligibleExamClassIds },
        ownerUid,
        db,
      );
      setAccess((prev) =>
        prev
          ? {
              ...prev,
              examMode: {
                enabled: true,
                scope: 'classes',
                classIds: eligibleExamClassIds,
                enabledAt: null,
              },
            }
          : prev,
      );
    } catch (err) {
      setExamModeError(
        err instanceof Error ? err.message : 'Impossibile attivare la modalità verifica.',
      );
    } finally {
      setExamModeSaving(false);
    }
  }

  function handleStartDisableExamMode() {
    setExamModeError(null);
    setExamModeDisableConfirm(true);
  }

  async function handleConfirmDisableExamMode() {
    setExamModeSaving(true);
    setExamModeError(null);
    try {
      await setExamMode({ enabled: false }, ownerUid, db);
      setAccess((prev) =>
        prev
          ? { ...prev, examMode: { enabled: false, scope: 'all', classIds: [], enabledAt: null } }
          : prev,
      );
      setExamModeDisableConfirm(false);
    } catch (err) {
      setExamModeError(
        err instanceof Error ? err.message : 'Impossibile disattivare la modalità verifica.',
      );
    } finally {
      setExamModeSaving(false);
    }
  }

  async function runAction(uid: string, action: () => Promise<void>) {
    setActionError(null);
    setActionLoadingId(uid);
    try {
      await action();
      // Solo i dati core: nessuna azione su uno studente modifica le etichette.
      await loadCore();
      onStudentsChanged?.();
    } catch {
      setActionError('Operazione non riuscita. Riprova.');
    } finally {
      setActionLoadingId(null);
      setDeleteConfirmId(null);
    }
  }

  function handleClassChange(uid: string, e: ChangeEvent<HTMLSelectElement>) {
    const classId = e.target.value === '' ? null : e.target.value;
    void runAction(uid, () => assignStudentClass(uid, classId, ownerUid, db));
  }

  /**
   * Applica i contatori **autorevoli** restituiti dalla transazione. La UI non
   * li ricalcola: sono i valori realmente scritti nel commit.
   */
  function applyLabelCounts(counts: { labelId: string; assignedCount: number }[]) {
    if (counts.length === 0) return;
    setLabels((prev) =>
      prev
        ? prev.map((label) => {
            const update = counts.find((c) => c.labelId === label.labelId);
            return update ? { ...label, assignedCount: update.assignedCount } : label;
          })
        : prev,
    );
  }

  /**
   * VDIF-02 — assegnazione, cambio o rimozione dell'etichetta di uno studente.
   *
   * Salvataggio immediato alla selezione, busy circoscritto alla card, guardia
   * sincrona anti-doppio-click, e **nessun refetch**: il service restituisce
   * l'assegnazione risultante e i contatori scritti, che bastano ad aggiornare
   * lo stato locale.
   */
  async function persistLabelSelection(uid: string, nextLabelId: string | null) {
    if (labelBusyRef.current.has(uid)) return;
    labelBusyRef.current.add(uid);
    setPendingLabels((prev) => new Map(prev).set(uid, nextLabelId));
    setLabelBusyUids((prev) => new Set(prev).add(uid));
    setLabelErrors((prev) => {
      const next = new Map(prev);
      next.delete(uid);
      return next;
    });
    try {
      const result = await setStudentLabelAssignment(uid, nextLabelId, ownerUid, db);
      setAssignments((prev) => {
        if (!prev) return prev;
        const others = prev.filter((item) => item.studentUid !== uid);
        return result.labelId === null
          ? others
          : [...others, { studentUid: uid, ownerUid, labelId: result.labelId }];
      });
      applyLabelCounts(result.labelCounts);
      setPendingLabels((prev) => {
        const next = new Map(prev);
        next.delete(uid);
        return next;
      });
    } catch (error) {
      // La scelta tentata resta visibile e il pulsante consente di ritentare
      // anche quando la select non emetterebbe un secondo evento `change`.
      setLabelErrors((prev) => {
        const next = new Map(prev);
        next.set(
          uid,
          error instanceof Error && error.message
            ? error.message
            : 'Impossibile aggiornare l’etichetta. Riprova.',
        );
        return next;
      });
    } finally {
      labelBusyRef.current.delete(uid);
      setLabelBusyUids((prev) => {
        const next = new Set(prev);
        next.delete(uid);
        return next;
      });
    }
  }

  function handleLabelChange(uid: string, event: ChangeEvent<HTMLSelectElement>) {
    const nextLabelId = event.target.value === '' ? null : event.target.value;
    void persistLabelSelection(uid, nextLabelId);
  }

  function selectTab(tab: StudentsTab) {
    setActiveTab(tab);
    tabRefs.current[tab]?.focus();
  }

  /**
   * Frecce cicliche su tutta la lista, Home/End agli estremi: generalizzato
   * sull'array delle schede invece che sulla coppia, così aggiungerne una non
   * richiede di riscrivere la navigazione.
   */
  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const index = STUDENTS_TABS.indexOf(activeTab);
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      selectTab(STUDENTS_TABS[(index + 1) % STUDENTS_TABS.length]!);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      selectTab(STUDENTS_TABS[(index - 1 + STUDENTS_TABS.length) % STUDENTS_TABS.length]!);
    } else if (event.key === 'Home') {
      event.preventDefault();
      selectTab(STUDENTS_TABS[0]);
    } else if (event.key === 'End') {
      event.preventDefault();
      selectTab(STUDENTS_TABS[STUDENTS_TABS.length - 1]!);
    }
  }

  function handleClassCreated(id: string, name: string) {
    setClasses((prev) => (prev ? [...prev, { id, ownerUid, name, description: null }] : prev));
  }

  function handleClassRenamed(id: string, name: string) {
    setClasses((prev) => prev?.map((item) => (item.id === id ? { ...item, name } : item)) ?? null);
  }

  function handleClassDeleted(id: string) {
    setClasses((prev) => prev?.filter((item) => item.id !== id) ?? null);
  }

  /*
   * VDIF-01 — le mutazioni delle etichette aggiornano la lista **in memoria**:
   * il service ha già scritto in transazione e restituisce il documento
   * risultante, quindi una rilettura completa sarebbe una query in più per
   * ottenere ciò che si conosce già.
   */
  function handleLabelCreated(label: DifferentiationLabelItem) {
    setLabels((prev) => sortLabels([...(prev ?? []), label]));
  }

  function handleLabelRenamed(label: DifferentiationLabelItem) {
    setLabels((prev) =>
      prev ? sortLabels(prev.map((item) => (item.labelId === label.labelId ? label : item))) : prev,
    );
  }

  function handleLabelDeleted(labelId: string) {
    setLabels((prev) => prev?.filter((item) => item.labelId !== labelId) ?? null);
  }

  if (loadError)
    return (
      <p role="alert" className="text-error">
        {loadError}
      </p>
    );
  if (students === null || classes === null || access === null || eligibleExamClassIds === null)
    return (
      <p aria-busy="true" className="state-loading">
        Caricamento…
      </p>
    );

  return (
    <section aria-label="Studenti" className={styles.container}>
      <div className={styles.togglesGrid}>
        <ToggleCard
          title="Portale studenti"
          description="Consente agli studenti approvati di leggere lezioni e verifiche pubblicate."
          checked={access.studentPortalEnabled}
          disabled={togglingPortal}
          onToggle={() => void handleTogglePortal()}
        />
        <ToggleCard
          title="Nuove richieste"
          description="Consente a un account Google sconosciuto di creare una richiesta di accesso in attesa."
          checked={access.newStudentRequestsEnabled}
          disabled={togglingRequests}
          onToggle={() => void handleToggleRequests()}
        />
        <ExamModeCard
          examMode={access.examMode}
          classNameById={classNameById}
          eligibleClassIds={eligibleExamClassIds}
          disabled={
            examModeSaving || (!access.examMode.enabled && eligibleExamClassIds.length === 0)
          }
          onRequestEnable={() => void handleEnableExamMode()}
          onRequestDisable={handleStartDisableExamMode}
        />
      </div>

      {access.examMode.enabled && (
        <p role="status" className={styles.examModeBanner}>
          ⚠️ Modalità verifica attiva — {examModeStatusLabel(access.examMode, classNameById)}. Le
          lezioni non sono visibili agli studenti delle classi coinvolte.
        </p>
      )}

      {examModeError && !examModeDisableConfirm && (
        <p role="alert" className="text-error">
          {examModeError}
        </p>
      )}

      {examModeDisableConfirm && (
        <div className={styles.examModeOverlay}>
          <div
            className={styles.examModeDialog}
            role="alertdialog"
            aria-label="Disattiva modalità verifica"
          >
            <h3 className={styles.examModeDialogTitle}>Disattiva modalità verifica</h3>
            <p>Le lezioni torneranno visibili agli studenti delle classi coinvolte. Continuare?</p>
            {examModeError && (
              <p role="alert" className="text-error">
                {examModeError}
              </p>
            )}
            <div className={styles.examModeDialogActions}>
              <button
                type="button"
                onClick={() => setExamModeDisableConfirm(false)}
                disabled={examModeSaving}
              >
                Annulla
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={examModeSaving}
                onClick={() => void handleConfirmDisableExamMode()}
              >
                {examModeSaving ? 'Disattivazione…' : 'Disattiva'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div
        className={styles.tabs}
        role="tablist"
        aria-label="Gestione studenti, classi ed etichette"
      >
        <button
          ref={(node) => {
            tabRefs.current.students = node;
          }}
          type="button"
          role="tab"
          id="students-tab"
          aria-controls="students-panel"
          aria-selected={activeTab === 'students'}
          tabIndex={activeTab === 'students' ? 0 : -1}
          className={`${styles.tab}${activeTab === 'students' ? ` ${styles.tabActive}` : ''}`}
          onClick={() => setActiveTab('students')}
          onKeyDown={handleTabKeyDown}
        >
          Studenti
          {pendingCount > 0 && <span className={styles.tabCount}>{pendingCount}</span>}
        </button>
        <button
          ref={(node) => {
            tabRefs.current.classes = node;
          }}
          type="button"
          role="tab"
          id="classes-tab"
          aria-controls="classes-panel"
          aria-selected={activeTab === 'classes'}
          tabIndex={activeTab === 'classes' ? 0 : -1}
          className={`${styles.tab}${activeTab === 'classes' ? ` ${styles.tabActive}` : ''}`}
          onClick={() => setActiveTab('classes')}
          onKeyDown={handleTabKeyDown}
        >
          Classi
        </button>
        <button
          ref={(node) => {
            tabRefs.current.labels = node;
          }}
          type="button"
          role="tab"
          id="labels-tab"
          aria-controls="labels-panel"
          aria-selected={activeTab === 'labels'}
          tabIndex={activeTab === 'labels' ? 0 : -1}
          className={`${styles.tab}${activeTab === 'labels' ? ` ${styles.tabActive}` : ''}`}
          onClick={() => setActiveTab('labels')}
          onKeyDown={handleTabKeyDown}
        >
          Etichette
        </button>
      </div>

      {activeTab === 'students' ? (
        <div
          role="tabpanel"
          id="students-panel"
          aria-labelledby="students-tab"
          className={styles.tabPanel}
        >
          {actionError && (
            <p role="alert" className="text-error">
              {actionError}
            </p>
          )}

          <div className={styles.filterRow}>
            <input
              type="text"
              className={styles.searchInput}
              placeholder="Cerca per nome, email, stato, classe o etichetta…"
              aria-label="Cerca studenti"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <select
              className={styles.statusSelect}
              aria-label="Filtra per stato"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as 'all' | StudentStatus)}
            >
              <option value="all">Tutti gli stati</option>
              <option value="pending">In attesa</option>
              <option value="approved">Approvati</option>
              <option value="blocked">Bloccati</option>
            </select>
          </div>

          {students.length === 0 ? (
            <p className="state-empty">Nessuno studente ha ancora effettuato l&apos;accesso.</p>
          ) : filteredStudents.length === 0 ? (
            <p className="state-empty">Nessuno studente trovato.</p>
          ) : (
            <div className={styles.studentList} role="list" aria-label="Elenco studenti">
              {filteredStudents.map((s) => {
                const name = s.displayName ?? s.email;
                const busy = actionLoadingId === s.id;
                const first = formatDateTime(s.firstPortalAccessAt);
                const last = formatDateTime(s.lastPortalAccessAt);
                /*
                 * VDIF-02 — stato dell'etichetta **circoscritto a questa card**:
                 * un'assegnazione in corso o fallita su un altro studente non
                 * deve disabilitare né segnalare nulla qui.
                 */
                const labelBusy = busy || labelBusyUids.has(s.id);
                const cardLabelError = labelErrors.get(s.id) ?? null;
                /*
                 * Dopo un errore la scelta **tentata** resta selezionata: il
                 * docente vede che cosa stava facendo e può riprovare senza
                 * ricostruirla. Riuscita, la voce di `pendingLabels` sparisce e
                 * si torna al valore persistito.
                 */
                const labelSelectValue = pendingLabels.has(s.id)
                  ? (pendingLabels.get(s.id) ?? '')
                  : (labelIdByStudentUid.get(s.id) ?? '');
                return (
                  <RecordCard
                    key={s.id}
                    recordLabel="Studente"
                    title={s.displayName ?? '—'}
                    metaLine={s.email}
                    actionLayout="student-admin"
                    identityControl={
                      <StudentIdentityFields
                        studentId={s.id}
                        studentName={name}
                        classes={classes ?? []}
                        classId={s.classId}
                        classDisabled={busy}
                        onClassChange={(e) => handleClassChange(s.id, e)}
                        labels={sortedLabels}
                        labelValue={labelSelectValue}
                        labelDisabled={labelBusy || labels === null || assignments === null}
                        labelError={cardLabelError}
                        onLabelChange={(e) => handleLabelChange(s.id, e)}
                        onLabelRetry={() =>
                          void persistLabelSelection(s.id, pendingLabels.get(s.id) ?? null)
                        }
                      />
                    }
                    metrics={[
                      {
                        label: 'Stato',
                        icon: <IconClipboardCheck />,
                        value: (
                          <span className={styles[STATUS_TEXT_CLASS[s.status]]}>
                            {STATUS_LABEL[s.status]}
                          </span>
                        ),
                      },
                      {
                        label: 'Primo accesso',
                        icon: <IconCircleCheck />,
                        value: first ? (
                          <span className={styles.accessValue}>
                            {first.date}
                            <span className={styles.cellTime}>{first.time}</span>
                          </span>
                        ) : (
                          '—'
                        ),
                      },
                      {
                        label: 'Ultimo accesso',
                        icon: <IconRotateCcw />,
                        value: last ? (
                          <span className={styles.accessValue}>
                            {last.date}
                            <span className={styles.cellTime}>{last.time}</span>
                          </span>
                        ) : (
                          '—'
                        ),
                      },
                    ]}
                    actions={
                      <RecordActionsMenu ariaLabel={`Azioni studente — ${name}`}>
                        <button
                          type="button"
                          role="menuitem"
                          title="Approva"
                          aria-label={`Approva ${name}`}
                          disabled={busy || s.status === 'approved'}
                          onClick={() =>
                            void runAction(s.id, () => approveStudent(s.id, ownerUid, db))
                          }
                        >
                          <IconCircleCheck size={15} />
                          <span>Approva</span>
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          title="Blocca"
                          aria-label={`Blocca ${name}`}
                          disabled={busy || s.status === 'blocked'}
                          onClick={() =>
                            void runAction(s.id, () => blockStudent(s.id, ownerUid, db))
                          }
                        >
                          <IconCircleX size={15} />
                          <span>Blocca</span>
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          title="Rimetti in attesa"
                          aria-label={`Rimetti in attesa ${name}`}
                          disabled={busy || s.status === 'pending'}
                          onClick={() =>
                            void runAction(s.id, () => resetStudentToPending(s.id, ownerUid, db))
                          }
                        >
                          <IconSend size={15} />
                          <span>Rimetti in attesa</span>
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          className={menuStyles.menuDanger}
                          title="Rimuovi studente"
                          aria-label={`Rimuovi ${name}`}
                          disabled={busy}
                          onClick={() => setDeleteConfirmId(s.id)}
                        >
                          <IconTrash size={15} />
                          <span>Rimuovi studente</span>
                        </button>
                      </RecordActionsMenu>
                    }
                    errors={
                      deleteConfirmId === s.id ? (
                        /* La conferma resta ancorata alla card che la riguarda:
                           la lista non si sposta e nessun'altra card cambia. */
                        <div
                          className={styles.confirmActions}
                          role="group"
                          aria-label={`Conferma rimozione di ${name}`}
                        >
                          <span className={styles.confirmText}>Rimuovere {name}?</span>
                          <button
                            type="button"
                            className="btn-danger"
                            disabled={busy}
                            onClick={() =>
                              /*
                               * VDIF-02 — la rimozione libera l'eventuale
                               * etichetta nella stessa transazione. Il service
                               * restituisce il contatore **scritto**: si applica
                               * localmente, senza rileggere le etichette.
                               */
                              void runAction(s.id, async () => {
                                const effect = await removeStudent(s.id, ownerUid, db);
                                setAssignments((prev) =>
                                  prev ? prev.filter((item) => item.studentUid !== s.id) : prev,
                                );
                                if (effect.releasedLabel) applyLabelCounts([effect.releasedLabel]);
                              })
                            }
                          >
                            {busy ? 'Rimozione…' : 'Conferma'}
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => setDeleteConfirmId(null)}
                          >
                            Annulla
                          </button>
                        </div>
                      ) : undefined
                    }
                  />
                );
              })}
            </div>
          )}
          {pendingCount > 0 && (
            <p className={styles.pendingHint}>
              {pendingCount} student{pendingCount === 1 ? 'e' : 'i'} in attesa di approvazione.
            </p>
          )}
        </div>
      ) : activeTab === 'classes' ? (
        <div
          role="tabpanel"
          id="classes-panel"
          aria-labelledby="classes-tab"
          className={styles.tabPanel}
        >
          <ClassesTab
            ownerUid={ownerUid}
            classes={classes}
            studentCountByClassId={studentCountByClassId}
            onClassCreated={handleClassCreated}
            onClassRenamed={handleClassRenamed}
            onClassDeleted={handleClassDeleted}
          />
        </div>
      ) : (
        <div
          role="tabpanel"
          id="labels-panel"
          aria-labelledby="labels-tab"
          className={styles.tabPanel}
        >
          {labelsError ? (
            /* Errore esplicito: mai una lista vuota spacciata per completa.
               Il retry rilegge **solo** le etichette, non l'intera vista. */
            <div className={styles.labelsErrorRow}>
              <p role="alert" className="text-error">
                {labelsError}
              </p>
              <button type="button" onClick={() => void loadLabels()}>
                Riprova
              </button>
            </div>
          ) : labels === null ? (
            <p aria-busy="true" className="state-loading">
              Caricamento etichette…
            </p>
          ) : (
            <LabelsTab
              ownerUid={ownerUid}
              labels={labels}
              onLabelCreated={handleLabelCreated}
              onLabelRenamed={handleLabelRenamed}
              onLabelDeleted={handleLabelDeleted}
            />
          )}
        </div>
      )}
    </section>
  );
}
