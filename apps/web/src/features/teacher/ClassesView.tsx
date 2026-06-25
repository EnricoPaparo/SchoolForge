import { type FormEvent, useEffect, useState } from 'react';
import {
  createClass,
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
      <h2 className={styles.sectionTitle}>Classi</h2>

      {classes.length === 0 && <p className="state-empty">Nessuna classe. Creane una.</p>}

      {classes.length > 0 && (
        <ul className={styles.classList}>
          {classes.map((c) =>
            editId === c.id ? (
              <li key={c.id}>
                <form
                  aria-label="Modifica classe"
                  className={styles.editForm}
                  onSubmit={(e) => void handleSave(e)}
                >
                  <div className={styles.editFormRow}>
                    <label htmlFor={`edit-name-${c.id}`}>Nome</label>
                    <input
                      id={`edit-name-${c.id}`}
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                    />
                  </div>
                  <div className={styles.editFormRow}>
                    <label htmlFor={`edit-desc-${c.id}`}>Descrizione</label>
                    <input
                      id={`edit-desc-${c.id}`}
                      type="text"
                      value={editDesc}
                      onChange={(e) => setEditDesc(e.target.value)}
                    />
                  </div>
                  <div className={styles.editFormRow}>
                    <button type="submit" disabled={saving || !editName.trim()}>
                      {saving ? 'Salvataggio…' : 'Salva'}
                    </button>
                    <button type="button" onClick={handleCancelEdit}>
                      Annulla
                    </button>
                  </div>
                </form>
              </li>
            ) : (
              <li key={c.id} className={styles.classRow}>
                <span className={styles.className}>{c.name}</span>
                {c.description && <span className={styles.classDesc}>{c.description}</span>}
                <button type="button" onClick={() => handleStartEdit(c)}>
                  Modifica
                </button>
              </li>
            ),
          )}
        </ul>
      )}

      <form
        aria-label="Nuova classe"
        className={styles.createForm}
        onSubmit={(e) => void handleCreate(e)}
      >
        <span className={styles.createLabel}>Crea nuova classe</span>
        <label htmlFor="new-class-name">Nome</label>
        <input
          id="new-class-name"
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
        />
        <label htmlFor="new-class-desc">Descrizione (opzionale)</label>
        <input
          id="new-class-desc"
          type="text"
          value={newDesc}
          onChange={(e) => setNewDesc(e.target.value)}
        />
        <button type="submit" disabled={creating || !newName.trim()}>
          {creating ? 'Creazione…' : 'Crea classe'}
        </button>
      </form>
    </section>
  );
}
