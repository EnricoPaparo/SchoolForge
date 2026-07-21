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
import type { StudentStatus } from '../../types/firestore.js';
import { ClassesTab, type ClassesTabItem } from './ClassesTab.js';
import styles from './StudentsView.module.css';

type StudentsTab = 'students' | 'classes';

const STATUS_LABEL: Record<StudentStatus, string> = {
  pending: 'In attesa',
  approved: 'Approvato',
  blocked: 'Bloccato',
};

const STATUS_BADGE_CLASS: Record<StudentStatus, string> = {
  pending: 'badge-warning',
  approved: 'badge-ok',
  blocked: 'badge-error',
};

function formatTimestamp(value: Timestamp | unknown): string {
  if (value && typeof (value as Timestamp).toDate === 'function') {
    return (value as Timestamp).toDate().toLocaleDateString('it-IT', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  }
  return '—';
}

interface Props {
  ownerUid: string;
  /** Called after any action that can change the pending count, so TeacherShell can refresh its nav badge. */
  onStudentsChanged?: () => void;
}

function IconButton({
  icon,
  label,
  variant,
  disabled,
  onClick,
}: {
  icon: string;
  label: string;
  variant?: 'success' | 'danger';
  disabled?: boolean;
  onClick: () => void;
}) {
  const variantClass = variant === 'success' ? styles.iconBtnSuccess : '';
  const dangerClass = variant === 'danger' ? styles.iconBtnDanger : '';
  return (
    <button
      type="button"
      className={`${styles.iconBtn} ${variantClass} ${dangerClass}`}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      <span aria-hidden="true">{icon}</span>
    </button>
  );
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
  const studentsTabRef = useRef<HTMLButtonElement>(null);
  const classesTabRef = useRef<HTMLButtonElement>(null);
  const [students, setStudents] = useState<StudentItem[] | null>(null);
  const [classes, setClasses] = useState<ClassesTabItem[] | null>(null);
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

  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  useEffect(() => {
    void loadAll();
  }, []);

  async function loadAll() {
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

  const classNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of classes ?? []) map.set(c.id, c.name);
    return map;
  }, [classes]);

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
      const haystack = [s.displayName ?? '', s.email, STATUS_LABEL[s.status], className]
        .join(' ')
        .toLowerCase();
      return haystack.includes(term);
    });
  }, [students, search, statusFilter, classNameById]);

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
      await loadAll();
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

  function selectTab(tab: StudentsTab) {
    setActiveTab(tab);
    (tab === 'students' ? studentsTabRef : classesTabRef).current?.focus();
  }

  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      selectTab(activeTab === 'students' ? 'classes' : 'students');
    } else if (event.key === 'Home') {
      event.preventDefault();
      selectTab('students');
    } else if (event.key === 'End') {
      event.preventDefault();
      selectTab('classes');
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

      <div className={styles.tabs} role="tablist" aria-label="Gestione studenti e classi">
        <button
          ref={studentsTabRef}
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
          ref={classesTabRef}
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
              placeholder="Cerca per nome, email, stato o classe…"
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
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th className={styles.th}>Nome</th>
                    <th className={styles.th}>Email</th>
                    <th className={styles.th}>Stato</th>
                    <th className={styles.th}>Classe</th>
                    <th className={styles.th}>Richiesta accesso</th>
                    <th className={styles.th}>Primo accesso</th>
                    <th className={styles.th}>Ultimo accesso</th>
                    <th className={styles.th} aria-label="Azioni"></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredStudents.map((s) => (
                    <tr key={s.id} className={styles.row}>
                      <td className={styles.td}>{s.displayName ?? '—'}</td>
                      <td className={styles.td}>{s.email}</td>
                      <td className={styles.td}>
                        <span className={`badge ${STATUS_BADGE_CLASS[s.status]}`}>
                          {STATUS_LABEL[s.status]}
                        </span>
                      </td>
                      <td className={styles.td}>
                        <select
                          aria-label={`Classe di ${s.displayName ?? s.email}`}
                          className={styles.classSelect}
                          value={s.classId ?? ''}
                          disabled={actionLoadingId === s.id}
                          onChange={(e) => handleClassChange(s.id, e)}
                        >
                          <option value="">Nessuna classe</option>
                          {(classes ?? []).map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className={styles.td}>{formatTimestamp(s.createdAt)}</td>
                      <td className={styles.td}>
                        {s.firstPortalAccessAt ? formatTimestamp(s.firstPortalAccessAt) : '—'}
                      </td>
                      <td className={styles.td}>
                        {s.lastPortalAccessAt ? formatTimestamp(s.lastPortalAccessAt) : '—'}
                      </td>
                      <td className={styles.tdActions}>
                        {deleteConfirmId === s.id ? (
                          <div className={styles.confirmActions}>
                            <span className={styles.confirmText}>Rimuovere?</span>
                            <IconButton
                              icon="✔️"
                              label="Conferma rimozione"
                              variant="danger"
                              disabled={actionLoadingId === s.id}
                              onClick={() =>
                                void runAction(s.id, () => removeStudent(s.id, ownerUid, db))
                              }
                            />
                            <IconButton
                              icon="✖️"
                              label="Annulla rimozione"
                              onClick={() => setDeleteConfirmId(null)}
                            />
                          </div>
                        ) : (
                          <div className={styles.actionsWrapper}>
                            {s.status !== 'approved' && (
                              <IconButton
                                icon="✅"
                                label="Approva"
                                variant="success"
                                disabled={actionLoadingId === s.id}
                                onClick={() =>
                                  void runAction(s.id, () => approveStudent(s.id, ownerUid, db))
                                }
                              />
                            )}
                            {s.status !== 'blocked' && (
                              <IconButton
                                icon="⛔"
                                label="Blocca"
                                variant="danger"
                                disabled={actionLoadingId === s.id}
                                onClick={() =>
                                  void runAction(s.id, () => blockStudent(s.id, ownerUid, db))
                                }
                              />
                            )}
                            {s.status !== 'pending' && (
                              <IconButton
                                icon="↩️"
                                label="Rimetti in attesa"
                                disabled={actionLoadingId === s.id}
                                onClick={() =>
                                  void runAction(s.id, () =>
                                    resetStudentToPending(s.id, ownerUid, db),
                                  )
                                }
                              />
                            )}
                            <IconButton
                              icon="🗑️"
                              label="Rimuovi"
                              disabled={actionLoadingId === s.id}
                              onClick={() => setDeleteConfirmId(s.id)}
                            />
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {pendingCount > 0 && (
            <p className={styles.pendingHint}>
              {pendingCount} student{pendingCount === 1 ? 'e' : 'i'} in attesa di approvazione.
            </p>
          )}
        </div>
      ) : (
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
      )}
    </section>
  );
}
