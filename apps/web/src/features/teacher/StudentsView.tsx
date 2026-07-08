import { type ChangeEvent, useEffect, useMemo, useState } from 'react';
import type { Timestamp } from 'firebase/firestore';
import { db } from '../../lib/firebase.js';
import { listClasses, type ClassItem } from '../repository/classes/classesService.js';
import {
  getStudentAccessSettings,
  setNewStudentRequestsEnabled,
  setStudentPortalEnabled,
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

export function StudentsView({ ownerUid, onStudentsChanged }: Props) {
  const [students, setStudents] = useState<StudentItem[] | null>(null);
  const [classes, setClasses] = useState<ClassItem[] | null>(null);
  const [access, setAccess] = useState<StudentAccessSnapshot | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | StudentStatus>('all');

  const [togglingPortal, setTogglingPortal] = useState(false);
  const [togglingRequests, setTogglingRequests] = useState(false);

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
      <div className={styles.togglesCard}>
        <label className={styles.toggleRow}>
          <input
            type="checkbox"
            checked={access.studentPortalEnabled}
            disabled={togglingPortal}
            onChange={() => void handleTogglePortal()}
          />
          <span className={styles.toggleLabel}>
            <strong>Portale studenti</strong>
            <span className={styles.toggleDesc}>
              Consente agli studenti approvati di leggere lezioni e verifiche pubblicate.
            </span>
          </span>
        </label>
        <label className={styles.toggleRow}>
          <input
            type="checkbox"
            checked={access.newStudentRequestsEnabled}
            disabled={togglingRequests}
            onChange={() => void handleToggleRequests()}
          />
          <span className={styles.toggleLabel}>
            <strong>Nuove richieste</strong>
            <span className={styles.toggleDesc}>
              Consente a un account Google sconosciuto di creare una richiesta di accesso in attesa.
            </span>
          </span>
        </label>
      </div>

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
                        <span className={styles.confirmText}>Rimuovere questo studente?</span>
                        <button
                          type="button"
                          className={`${styles.actionBtn} btn-danger`}
                          disabled={actionLoadingId === s.id}
                          onClick={() =>
                            void runAction(s.id, () => removeStudent(s.id, ownerUid, db))
                          }
                        >
                          {actionLoadingId === s.id ? 'Rimozione…' : 'Conferma'}
                        </button>
                        <button
                          type="button"
                          className={styles.actionBtn}
                          onClick={() => setDeleteConfirmId(null)}
                        >
                          Annulla
                        </button>
                      </div>
                    ) : (
                      <div className={styles.actionsWrapper}>
                        {s.status !== 'approved' && (
                          <button
                            type="button"
                            className={`${styles.actionBtn} btn-success`}
                            disabled={actionLoadingId === s.id}
                            onClick={() =>
                              void runAction(s.id, () => approveStudent(s.id, ownerUid, db))
                            }
                          >
                            Approva
                          </button>
                        )}
                        {s.status !== 'blocked' && (
                          <button
                            type="button"
                            className={`${styles.actionBtn} btn-danger`}
                            disabled={actionLoadingId === s.id}
                            onClick={() =>
                              void runAction(s.id, () => blockStudent(s.id, ownerUid, db))
                            }
                          >
                            Blocca
                          </button>
                        )}
                        {s.status !== 'pending' && (
                          <button
                            type="button"
                            className={styles.actionBtn}
                            disabled={actionLoadingId === s.id}
                            onClick={() =>
                              void runAction(s.id, () => resetStudentToPending(s.id, ownerUid, db))
                            }
                          >
                            Rimetti in attesa
                          </button>
                        )}
                        <button
                          type="button"
                          className={styles.actionBtn}
                          disabled={actionLoadingId === s.id}
                          onClick={() => setDeleteConfirmId(s.id)}
                        >
                          Rimuovi
                        </button>
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
