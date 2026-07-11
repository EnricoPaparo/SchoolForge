import { type ChangeEvent, useEffect, useMemo, useState } from 'react';
import type { Timestamp } from 'firebase/firestore';
import { db } from '../../lib/firebase.js';
import { listClasses, type ClassItem } from '../repository/classes/classesService.js';
import {
  getStudentAccessSettings,
  setExamMode,
  setNewStudentRequestsEnabled,
  setStudentPortalEnabled,
  type SetExamModeInput,
  type StudentAccessSnapshot,
} from '../repository/students/studentAccessService.js';
import {
  approveStudent,
  assignStudentClass,
  blockStudent,
  listStudents,
  removeStudent,
  resetStudentToPending,
  type StudentItem,
} from '../repository/students/studentsService.js';
import type { ExamModeScope } from '../repository/students/examMode.js';
import type { StudentStatus } from '../../types/firestore.js';
import styles from './StudentsView.module.css';

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
 * Modalità verifica (M3F-07): unlike the two simple ToggleCards above, the
 * switch here never toggles instantly — enabling always opens the scope
 * dialog (default "classi selezionate", explicit alternative "tutte le
 * classi"), and disabling always asks for a lightweight confirmation.
 * Kept out of ToggleCard on purpose: that component's instant on/off would
 * let a click silently apply the *previous* dialog scope, which is exactly
 * the ambiguity a confirmation step exists to prevent.
 */
function ExamModeCard({
  examMode,
  classes,
  classNameById,
  disabled,
  onRequestEnable,
  onRequestDisable,
}: {
  examMode: StudentAccessSnapshot['examMode'];
  classes: ClassItem[];
  classNameById: Map<string, string>;
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
          onClick={examMode.enabled ? onRequestDisable : onRequestEnable}
        >
          <span className={styles.switchThumb} />
        </button>
      </div>
      <p className={styles.toggleDesc}>
        Nasconde temporaneamente le Lezioni agli studenti delle classi coinvolte. Le verifiche
        online restano sempre disponibili.
      </p>
      <span className={`badge ${examMode.enabled ? 'badge-warning' : 'badge-ok'}`}>
        {examModeStatusLabel(examMode, classNameById)}
      </span>
      {classes.length === 0 && !examMode.enabled && (
        <p className={styles.toggleDesc}>Crea almeno una classe per poter attivare la modalità.</p>
      )}
    </div>
  );
}

type ExamModeDialogState = {
  scope: ExamModeScope;
  selectedClassIds: Set<string>;
  globalConfirmed: boolean;
};

function ExamModeDialog({
  classes,
  state,
  saving,
  error,
  onChange,
  onCancel,
  onConfirm,
}: {
  classes: ClassItem[];
  state: ExamModeDialogState;
  saving: boolean;
  error: string | null;
  onChange: (next: ExamModeDialogState) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const canConfirm =
    state.scope === 'classes' ? state.selectedClassIds.size > 0 : state.globalConfirmed;

  function toggleClass(id: string) {
    const next = new Set(state.selectedClassIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange({ ...state, selectedClassIds: next });
  }

  return (
    <div className={styles.examModeOverlay}>
      <div
        className={styles.examModeDialog}
        role="alertdialog"
        aria-label="Attiva modalità verifica"
      >
        <h3 className={styles.examModeDialogTitle}>Attiva modalità verifica</h3>

        <div className={styles.examModeScopeChoice}>
          <label className={styles.examModeScopeOption}>
            <input
              type="radio"
              name="exam-mode-scope"
              checked={state.scope === 'classes'}
              onChange={() => onChange({ ...state, scope: 'classes' })}
            />
            Una o più classi
          </label>
          <label className={styles.examModeScopeOption}>
            <input
              type="radio"
              name="exam-mode-scope"
              checked={state.scope === 'all'}
              onChange={() => onChange({ ...state, scope: 'all' })}
            />
            Tutte le classi
          </label>
        </div>

        {state.scope === 'classes' ? (
          classes.length === 0 ? (
            <p className="state-empty">Nessuna classe disponibile.</p>
          ) : (
            <ul className={styles.examModeClassList}>
              {classes.map((c) => (
                <li key={c.id}>
                  <label className={styles.examModeClassOption}>
                    <input
                      type="checkbox"
                      checked={state.selectedClassIds.has(c.id)}
                      onChange={() => toggleClass(c.id)}
                    />
                    {c.name}
                  </label>
                </li>
              ))}
            </ul>
          )
        ) : (
          <label className={styles.examModeGlobalConfirm}>
            <input
              type="checkbox"
              checked={state.globalConfirmed}
              onChange={(e) => onChange({ ...state, globalConfirmed: e.target.checked })}
            />
            Confermo di voler bloccare le lezioni per TUTTE le classi.
          </label>
        )}

        {error && (
          <p role="alert" className="text-error">
            {error}
          </p>
        )}

        <div className={styles.examModeDialogActions}>
          <button type="button" onClick={onCancel} disabled={saving}>
            Annulla
          </button>
          <button
            type="button"
            className="btn-success"
            disabled={saving || !canConfirm}
            onClick={onConfirm}
          >
            {saving ? 'Attivazione…' : 'Attiva'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function StudentsView({ ownerUid, onStudentsChanged }: Props) {
  const [students, setStudents] = useState<StudentItem[] | null>(null);
  const [classes, setClasses] = useState<ClassItem[] | null>(null);
  const [access, setAccess] = useState<StudentAccessSnapshot | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | StudentStatus>('all');

  const [togglingPortal, setTogglingPortal] = useState(false);
  const [togglingRequests, setTogglingRequests] = useState(false);

  const [examModeDialogState, setExamModeDialogState] = useState<ExamModeDialogState | null>(null);
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
      const [studentsList, classesList, accessSettings] = await Promise.all([
        listStudents(ownerUid, db),
        listClasses(ownerUid, db),
        getStudentAccessSettings(db),
      ]);
      setStudents(studentsList);
      setClasses(classesList);
      setAccess(accessSettings);
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

  function handleOpenExamModeDialog() {
    setExamModeError(null);
    setExamModeDialogState({
      scope: 'classes',
      selectedClassIds: new Set(),
      globalConfirmed: false,
    });
  }

  function handleCloseExamModeDialog() {
    setExamModeDialogState(null);
    setExamModeError(null);
  }

  async function handleConfirmExamModeDialog() {
    if (!examModeDialogState || !access) return;
    const input: SetExamModeInput =
      examModeDialogState.scope === 'all'
        ? { enabled: true, scope: 'all' }
        : { enabled: true, scope: 'classes', classIds: [...examModeDialogState.selectedClassIds] };

    // Skip the write when the requested state already matches — using only
    // the state already loaded in `access`, no extra read.
    const alreadyCurrent =
      access.examMode.enabled &&
      access.examMode.scope === input.scope &&
      (input.scope === 'all' ||
        (input.scope === 'classes' &&
          input.classIds.length === access.examMode.classIds.length &&
          input.classIds.every((id) => access.examMode.classIds.includes(id))));
    if (alreadyCurrent) {
      handleCloseExamModeDialog();
      return;
    }

    setExamModeSaving(true);
    setExamModeError(null);
    try {
      await setExamMode(input, ownerUid, db);
      setAccess((prev) =>
        prev
          ? {
              ...prev,
              examMode:
                input.scope === 'all'
                  ? { enabled: true, scope: 'all', classIds: [], enabledAt: null }
                  : { enabled: true, scope: 'classes', classIds: input.classIds, enabledAt: null },
            }
          : prev,
      );
      setExamModeDialogState(null);
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

  if (loadError)
    return (
      <p role="alert" className="text-error">
        {loadError}
      </p>
    );
  if (students === null || access === null)
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
          classes={classes ?? []}
          classNameById={classNameById}
          disabled={examModeSaving}
          onRequestEnable={handleOpenExamModeDialog}
          onRequestDisable={handleStartDisableExamMode}
        />
      </div>

      {access.examMode.enabled && (
        <p role="status" className={styles.examModeBanner}>
          ⚠️ Modalità verifica attiva — {examModeStatusLabel(access.examMode, classNameById)}. Le
          lezioni non sono visibili agli studenti delle classi coinvolte.
        </p>
      )}

      {examModeDialogState && (
        <ExamModeDialog
          classes={classes ?? []}
          state={examModeDialogState}
          saving={examModeSaving}
          error={examModeError}
          onChange={setExamModeDialogState}
          onCancel={handleCloseExamModeDialog}
          onConfirm={() => void handleConfirmExamModeDialog()}
        />
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
                  <td className={styles.td}>{formatTimestamp(s.lastLoginAt)}</td>
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
                              void runAction(s.id, () => resetStudentToPending(s.id, ownerUid, db))
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
    </section>
  );
}
