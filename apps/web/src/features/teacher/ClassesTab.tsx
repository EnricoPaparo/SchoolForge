import { type FormEvent, useState } from 'react';
import { db } from '../../lib/firebase.js';
import {
  createClass,
  deleteClass,
  updateClass,
  type ClassItem,
} from '../repository/classes/classesService.js';
import styles from './ClassesTab.module.css';

export type ClassesTabItem = Pick<ClassItem, 'id' | 'ownerUid' | 'name' | 'description'>;

interface Props {
  ownerUid: string;
  classes: ClassesTabItem[];
  studentCountByClassId: Map<string, number>;
  onClassCreated: (id: string, name: string) => void;
  onClassRenamed: (id: string, name: string) => void;
  onClassDeleted: (id: string) => void;
}

export function ClassesTab({
  ownerUid,
  classes,
  studentCountByClassId,
  onClassCreated,
  onClassRenamed,
  onClassDeleted,
}: Props) {
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    setActionError(null);
    try {
      const id = await createClass(name, null, ownerUid, db);
      onClassCreated(id, name);
      setNewName('');
    } catch {
      setActionError('Impossibile creare la classe. Riprova.');
    } finally {
      setCreating(false);
    }
  }

  function startEdit(item: ClassesTabItem) {
    setEditId(item.id);
    setEditName(item.name);
    setDeleteConfirmId(null);
    setActionError(null);
  }

  function cancelEdit() {
    setEditId(null);
    setEditName('');
  }

  async function handleSave(event: FormEvent, item: ClassesTabItem) {
    event.preventDefault();
    const name = editName.trim();
    if (!name) return;
    setSaving(true);
    setActionError(null);
    try {
      // Description is no longer exposed by the UI, but legacy data is preserved.
      await updateClass(item.id, name, item.description ?? null, ownerUid, db);
      onClassRenamed(item.id, name);
      cancelEdit();
    } catch {
      setActionError('Impossibile modificare la classe. Riprova.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(classId: string) {
    setDeleting(true);
    setActionError(null);
    try {
      await deleteClass(classId, ownerUid, db);
      onClassDeleted(classId);
      setDeleteConfirmId(null);
    } catch {
      setActionError('Impossibile eliminare la classe. Riprova.');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className={styles.container}>
      {actionError && (
        <p role="alert" className="text-error">
          {actionError}
        </p>
      )}

      <form id="new-class-form" aria-label="Nuova classe" onSubmit={(e) => void handleCreate(e)} />

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.th}>Classe</th>
              <th className={styles.th}>Studenti</th>
              <th className={`${styles.th} ${styles.thActions}`}>Azioni</th>
            </tr>
          </thead>
          <tbody>
            <tr className={styles.createRow}>
              <td className={styles.td}>
                <label className={styles.visuallyHidden} htmlFor="new-class-name">
                  Nome nuova classe
                </label>
                <input
                  id="new-class-name"
                  form="new-class-form"
                  className={styles.input}
                  value={newName}
                  placeholder="es. 3A Informatica"
                  onChange={(e) => setNewName(e.target.value)}
                />
              </td>
              <td className={styles.td} aria-label="Studenti non ancora disponibili">
                —
              </td>
              <td className={`${styles.td} ${styles.createAction}`}>
                <button
                  type="submit"
                  form="new-class-form"
                  className="btn-success"
                  disabled={creating || !newName.trim()}
                >
                  {creating ? 'Creazione…' : 'Aggiungi'}
                </button>
              </td>
            </tr>

            {classes.map((item) => {
              const count = studentCountByClassId.get(item.id) ?? 0;
              const editFormId = `edit-class-${item.id}`;
              return (
                <tr key={item.id} className={styles.row}>
                  <td className={styles.td}>
                    {editId === item.id ? (
                      <>
                        <form
                          id={editFormId}
                          aria-label={`Modifica classe ${item.name}`}
                          onSubmit={(e) => void handleSave(e, item)}
                        />
                        <label
                          className={styles.visuallyHidden}
                          htmlFor={`edit-class-name-${item.id}`}
                        >
                          Nome classe
                        </label>
                        <input
                          id={`edit-class-name-${item.id}`}
                          form={editFormId}
                          className={styles.input}
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                        />
                      </>
                    ) : (
                      <span className={styles.className}>{item.name}</span>
                    )}
                  </td>
                  <td className={styles.td}>{count}</td>
                  <td className={`${styles.td} ${styles.actionsCell}`}>
                    {editId === item.id ? (
                      <div className={styles.actions}>
                        <button
                          type="submit"
                          form={editFormId}
                          className="btn-success"
                          disabled={saving || !editName.trim()}
                        >
                          {saving ? 'Salvataggio…' : 'Salva'}
                        </button>
                        <button type="button" disabled={saving} onClick={cancelEdit}>
                          Annulla
                        </button>
                      </div>
                    ) : deleteConfirmId === item.id ? (
                      <div className={styles.actions}>
                        <span className={styles.confirmText}>Eliminare?</span>
                        <button
                          type="button"
                          className="btn-danger"
                          disabled={deleting}
                          onClick={() => void handleDelete(item.id)}
                        >
                          {deleting ? 'Eliminazione…' : 'Conferma'}
                        </button>
                        <button
                          type="button"
                          disabled={deleting}
                          onClick={() => setDeleteConfirmId(null)}
                        >
                          Annulla
                        </button>
                      </div>
                    ) : (
                      <div className={styles.iconActions}>
                        <button
                          type="button"
                          className={styles.iconButton}
                          aria-label={`Modifica classe ${item.name}`}
                          title="Modifica classe"
                          onClick={() => startEdit(item)}
                        >
                          <span aria-hidden="true">✏️</span>
                        </button>
                        <button
                          type="button"
                          className={styles.iconButton}
                          aria-label={`Elimina classe ${item.name}`}
                          title="Elimina classe"
                          onClick={() => {
                            setDeleteConfirmId(item.id);
                            setEditId(null);
                            setActionError(null);
                          }}
                        >
                          <span aria-hidden="true">🗑️</span>
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {classes.length === 0 && <p className="state-empty">Nessuna classe ancora creata.</p>}
    </div>
  );
}
