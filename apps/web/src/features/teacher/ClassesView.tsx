import { type FormEvent, useEffect, useState } from 'react';
import {
  createClass,
  deleteClass,
  listClasses,
  updateClass,
  type ClassItem,
} from '../repository/classes/classesService.js';
import { db } from '../../lib/firebase.js';
import { useAuth } from '../../lib/auth.js';
import styles from './ClassesView.module.css';

export function ClassesView() {
  const { user } = useAuth();
  const ownerUid = user?.uid ?? '';

  const [classes, setClasses] = useState<ClassItem[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [creating, setCreating] = useState(false);

  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [saving, setSaving] = useState(false);

  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    void loadClasses();
  }, []);

  async function loadClasses() {
    setLoadError(null);
    try {
      const list = await listClasses(ownerUid, db);
      setClasses(list);
    } catch {
      setLoadError('Impossibile caricare le classi.');
    }
  }

  function handleStartEdit(c: ClassItem) {
    setEditId(c.id);
    setEditName(c.name);
    setEditDesc(c.description ?? '');
    setDeleteConfirmId(null);
  }

  function handleCancelEdit() {
    setEditId(null);
    setEditName('');
    setEditDesc('');
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!editId) return;
    const name = editName.trim();
    if (!name) return;
    setSaving(true);
    try {
      await updateClass(editId, name, editDesc.trim() || null, ownerUid, db);
      setClasses(
        (prev) =>
          prev?.map((c) =>
            c.id === editId ? { ...c, name, description: editDesc.trim() || null } : c,
          ) ?? null,
      );
      setEditId(null);
    } finally {
      setSaving(false);
    }
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    try {
      await createClass(name, newDesc.trim() || null, ownerUid, db);
      setNewName('');
      setNewDesc('');
      await loadClasses();
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(classId: string) {
    setDeleting(true);
    try {
      await deleteClass(classId, ownerUid, db);
      setClasses((prev) => prev?.filter((c) => c.id !== classId) ?? null);
      setDeleteConfirmId(null);
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
  if (classes === null)
    return (
      <p aria-busy="true" className="state-loading">
        Caricamento…
      </p>
    );

  return (
    <section aria-label="Classi" className={styles.container}>
      {/* Create form — in alto */}
      <form
        aria-label="Nuova classe"
        className={styles.createForm}
        onSubmit={(e) => void handleCreate(e)}
      >
        <div className={styles.createRow}>
          <div className={styles.createField}>
            <label htmlFor="new-class-name" className={styles.fieldLabel}>
              Nome
            </label>
            <input
              id="new-class-name"
              type="text"
              className={styles.input}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="es. 3A Informatica"
            />
          </div>
          <div className={styles.createField}>
            <label htmlFor="new-class-desc" className={styles.fieldLabel}>
              Descrizione
            </label>
            <input
              id="new-class-desc"
              type="text"
              className={styles.input}
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              placeholder="opzionale"
            />
          </div>
          <button type="submit" className={styles.addBtn} disabled={creating || !newName.trim()}>
            {creating ? 'Creazione…' : '+ Aggiungi'}
          </button>
        </div>
      </form>

      {/* Classes table */}
      {classes.length === 0 ? (
        <p className="state-empty">Nessuna classe. Aggiungine una sopra.</p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.th}>Nome</th>
                <th className={styles.th}>Descrizione</th>
                <th className={styles.th} aria-label="Azioni"></th>
              </tr>
            </thead>
            <tbody>
              {classes.map((c) =>
                editId === c.id ? (
                  <tr key={c.id}>
                    <td colSpan={3} className={styles.td}>
                      <form
                        aria-label="Modifica classe"
                        className={styles.editForm}
                        onSubmit={(e) => void handleSave(e)}
                      >
                        <input
                          id={`edit-name-${c.id}`}
                          type="text"
                          className={styles.input}
                          value={editName}
                          aria-label="Nome classe"
                          onChange={(e) => setEditName(e.target.value)}
                        />
                        <input
                          id={`edit-desc-${c.id}`}
                          type="text"
                          className={styles.input}
                          value={editDesc}
                          aria-label="Descrizione classe"
                          onChange={(e) => setEditDesc(e.target.value)}
                        />
                        <button type="submit" disabled={saving || !editName.trim()}>
                          {saving ? 'Salvataggio…' : 'Salva'}
                        </button>
                        <button type="button" onClick={handleCancelEdit}>
                          Annulla
                        </button>
                      </form>
                    </td>
                  </tr>
                ) : deleteConfirmId === c.id ? (
                  <tr key={c.id} className={styles.confirmRow}>
                    <td colSpan={3} className={styles.td}>
                      <span className={styles.confirmText}>
                        Eliminare <strong>{c.name}</strong>? L&apos;operazione è irreversibile.
                      </span>
                      <button
                        type="button"
                        className={styles.deleteConfirmBtn}
                        disabled={deleting}
                        onClick={() => void handleDelete(c.id)}
                      >
                        {deleting ? 'Eliminazione…' : 'Elimina'}
                      </button>
                      <button type="button" onClick={() => setDeleteConfirmId(null)}>
                        Annulla
                      </button>
                    </td>
                  </tr>
                ) : (
                  <tr key={c.id} className={styles.row}>
                    <td className={styles.td}>
                      <span className={styles.className}>{c.name}</span>
                    </td>
                    <td className={styles.td}>
                      <span className={styles.classDesc}>{c.description ?? '—'}</span>
                    </td>
                    <td className={styles.tdActions}>
                      <div className={styles.actionsWrapper}>
                        <button
                          type="button"
                          className={styles.actionBtn}
                          onClick={() => handleStartEdit(c)}
                        >
                          Modifica
                        </button>
                        <button
                          type="button"
                          className={styles.deleteBtn}
                          aria-label={`Elimina classe ${c.name}`}
                          onClick={() => {
                            setDeleteConfirmId(c.id);
                            setEditId(null);
                          }}
                        >
                          Elimina
                        </button>
                      </div>
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
