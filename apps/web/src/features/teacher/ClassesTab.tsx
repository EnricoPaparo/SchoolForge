import { type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from 'react';
import { db } from '../../lib/firebase.js';
import {
  createClass,
  deleteClass,
  updateClass,
  type ClassItem,
} from '../repository/classes/classesService.js';
import { RecordCard } from '../../components/RecordCard.js';
import { RecordActionsMenu } from './RecordActionsMenu.js';
import { DialogShell } from '../../components/DialogShell.js';
import { IconPencil, IconPlus, IconTrash } from '../../components/icons.js';
import menuStyles from './CourseWorkspace.module.css';
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

/** «1 studente» / «0 studenti» — il conteggio arriva dagli studenti già caricati. */
function studentCountLabel(count: number): string {
  return `${count} ${count === 1 ? 'studente' : 'studenti'}`;
}

export function ClassesTab({
  ownerUid,
  classes,
  studentCountByClassId,
  onClassCreated,
  onClassRenamed,
  onClassDeleted,
}: Props) {
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const editInputRef = useRef<HTMLInputElement>(null);
  const savingRef = useRef(false);

  useEffect(() => {
    if (editId) {
      editInputRef.current?.focus();
      editInputRef.current?.select();
    }
  }, [editId]);

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
      setCreateDialogOpen(false);
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
    setActionError(null);
  }

  async function handleSave(item: ClassesTabItem) {
    if (savingRef.current) return;
    const name = editName.trim();
    if (!name || name === item.name.trim()) return;
    savingRef.current = true;
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
      savingRef.current = false;
      setSaving(false);
    }
  }

  function handleEditKeyDown(event: KeyboardEvent<HTMLInputElement>, item: ClassesTabItem) {
    if (event.key === 'Escape') {
      event.preventDefault();
      if (!savingRef.current) cancelEdit();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      void handleSave(item);
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
      {/*
       * UI-STUDENTI-CLASSI-01 — azione primaria della sezione: a larghezza piena
       * ma con altezza sobria, non un banner. Apre il flusso di creazione già
       * esistente dentro `DialogShell`.
       */}
      <button
        type="button"
        className={`btn-primary ${styles.newClassBtn}`}
        onClick={() => {
          setActionError(null);
          setCreateDialogOpen(true);
        }}
      >
        <IconPlus size={16} />
        <span>Nuova classe</span>
      </button>

      {actionError && !createDialogOpen && (
        <p role="alert" className="text-error">
          {actionError}
        </p>
      )}

      {classes.length === 0 ? (
        <p className="state-empty">Nessuna classe ancora creata.</p>
      ) : (
        <div className={styles.classList} role="list" aria-label="Classi">
          {classes.map((item) => {
            const count = studentCountByClassId.get(item.id) ?? 0;
            const isEditing = editId === item.id;
            const isConfirmingDelete = deleteConfirmId === item.id;
            return (
              <RecordCard
                key={item.id}
                recordLabel="Classe"
                title={item.name}
                titleMeta={studentCountLabel(count)}
                actionLayout="class-admin"
                metrics={[]}
                identityControl={
                  isEditing ? (
                    <div className={styles.editRow}>
                      <label
                        className={styles.visuallyHidden}
                        htmlFor={`edit-class-name-${item.id}`}
                      >
                        Nome classe
                      </label>
                      <input
                        id={`edit-class-name-${item.id}`}
                        ref={editInputRef}
                        className={styles.input}
                        value={editName}
                        disabled={saving}
                        onChange={(e) => setEditName(e.target.value)}
                        onKeyDown={(e) => handleEditKeyDown(e, item)}
                      />
                      <button
                        type="button"
                        className="btn-success"
                        disabled={
                          saving || !editName.trim() || editName.trim() === item.name.trim()
                        }
                        onClick={() => void handleSave(item)}
                      >
                        {saving ? 'Salvataggio…' : 'Salva'}
                      </button>
                      <button type="button" disabled={saving} onClick={cancelEdit}>
                        Annulla
                      </button>
                    </div>
                  ) : isConfirmingDelete ? (
                    <div className={styles.editRow}>
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
                  ) : undefined
                }
                actions={
                  <RecordActionsMenu ariaLabel={`Azioni classe — ${item.name}`}>
                    <button
                      type="button"
                      role="menuitem"
                      title="Modifica classe"
                      aria-label={`Modifica classe ${item.name}`}
                      onClick={() => startEdit(item)}
                    >
                      <IconPencil size={15} />
                      <span>Modifica classe</span>
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className={menuStyles.menuDanger}
                      title="Elimina classe"
                      aria-label={`Elimina classe ${item.name}`}
                      onClick={() => {
                        setDeleteConfirmId(item.id);
                        setEditId(null);
                        setActionError(null);
                      }}
                    >
                      <IconTrash size={15} />
                      <span>Elimina classe</span>
                    </button>
                  </RecordActionsMenu>
                }
              />
            );
          })}
        </div>
      )}

      {createDialogOpen && (
        <DialogShell
          title="Nuova classe"
          busy={creating}
          onCancel={() => setCreateDialogOpen(false)}
        >
          <form
            id="new-class-form"
            aria-label="Nuova classe"
            className={styles.createForm}
            onSubmit={(e) => void handleCreate(e)}
          >
            <div className={styles.formField}>
              <label htmlFor="new-class-name">Nome classe</label>
              <input
                id="new-class-name"
                className={styles.input}
                value={newName}
                placeholder="es. 3A Informatica"
                autoFocus
                onChange={(e) => setNewName(e.target.value)}
              />
            </div>
            {actionError && (
              <p role="alert" className="text-error">
                {actionError}
              </p>
            )}
            <div className={styles.dialogActions}>
              <button type="button" disabled={creating} onClick={() => setCreateDialogOpen(false)}>
                Annulla
              </button>
              <button type="submit" className="btn-primary" disabled={creating || !newName.trim()}>
                {creating ? 'Creazione…' : 'Aggiungi'}
              </button>
            </div>
          </form>
        </DialogShell>
      )}
    </div>
  );
}
