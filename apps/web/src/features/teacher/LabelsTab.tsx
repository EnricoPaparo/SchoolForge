import { type FormEvent, useRef, useState } from 'react';
import { db } from '../../lib/firebase.js';
import {
  createDifferentiationLabel,
  deleteDifferentiationLabel,
  describeUsage,
  renameDifferentiationLabel,
  type DifferentiationLabelItem,
} from '../repository/differentiation/differentiationLabelsService.js';
import {
  LABEL_NAME_MAX_CODE_POINTS,
  countCodePoints,
} from '../repository/differentiation/labelName.js';
import { RecordCard } from '../../components/RecordCard.js';
import { RecordActionsMenu } from './RecordActionsMenu.js';
import { DialogShell } from '../../components/DialogShell.js';
import { IconPencil, IconTag, IconTrash } from '../../components/icons.js';
import menuStyles from './CourseWorkspace.module.css';
import styles from './LabelsTab.module.css';

/**
 * VDIF-01 — terza scheda della sezione Studenti: registro delle etichette
 * operative **private del docente**.
 *
 * Il componente non conosce Firestore: chiama il service canonico e mostra ciò
 * che torna. Ogni validazione del nome vive nell'helper puro condiviso, quindi
 * il dialog non può accettare un nome che il service poi rifiuterebbe.
 *
 * **Nessun esempio diagnostico** compare qui — né nei placeholder, né nello
 * stato vuoto, né nei testi di aiuto. È un vincolo del contratto: la UI invita a
 * denominazioni operative neutrali e basta.
 */

interface Props {
  ownerUid: string;
  labels: DifferentiationLabelItem[];
  onLabelCreated: (label: DifferentiationLabelItem) => void;
  onLabelRenamed: (label: DifferentiationLabelItem) => void;
  onLabelDeleted: (labelId: string) => void;
}

function studentCountLabel(count: number): string {
  if (count === 0) return 'Nessuno studente';
  return `${count} ${count === 1 ? 'studente' : 'studenti'}`;
}

function draftCountLabel(count: number): string {
  return `${count} ${count === 1 ? 'bozza' : 'bozze'}`;
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function LabelsTab({
  ownerUid,
  labels,
  onLabelCreated,
  onLabelRenamed,
  onLabelDeleted,
}: Props) {
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editError, setEditError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  /**
   * Guardie **sincrone** anti-doppio-click: due click nello stesso tick non
   * possono avviare due transazioni. Uno stato React non basta, perché il
   * secondo click parte prima del re-render.
   */
  const busyRef = useRef(false);

  const editing = labels.find((item) => item.labelId === editId) ?? null;
  const deleting_ = labels.find((item) => item.labelId === deleteId) ?? null;

  function closeCreate() {
    setCreateOpen(false);
    setCreateName('');
    setCreateError(null);
  }

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    if (busyRef.current) return;
    busyRef.current = true;
    setCreating(true);
    setCreateError(null);
    try {
      const created = await createDifferentiationLabel(createName, ownerUid, db);
      onLabelCreated(created);
      closeCreate();
    } catch (error) {
      // Il testo digitato resta nel campo: un errore non deve costringere a
      // riscrivere ciò che il docente aveva già scritto.
      setCreateError(messageOf(error, 'Impossibile creare l’etichetta. Riprova.'));
    } finally {
      busyRef.current = false;
      setCreating(false);
    }
  }

  function startEdit(item: DifferentiationLabelItem) {
    setEditId(item.labelId);
    setEditName(item.name);
    setEditError(null);
  }

  function closeEdit() {
    setEditId(null);
    setEditName('');
    setEditError(null);
  }

  async function handleRename(event: FormEvent) {
    event.preventDefault();
    if (busyRef.current || !editing) return;
    busyRef.current = true;
    setSaving(true);
    setEditError(null);
    try {
      const renamed = await renameDifferentiationLabel(editing.labelId, editName, ownerUid, db);
      onLabelRenamed(renamed);
      closeEdit();
    } catch (error) {
      setEditError(messageOf(error, 'Impossibile modificare l’etichetta. Riprova.'));
    } finally {
      busyRef.current = false;
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (busyRef.current || !deleting_) return;
    busyRef.current = true;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteDifferentiationLabel(deleting_.labelId, ownerUid, db);
      onLabelDeleted(deleting_.labelId);
      setDeleteId(null);
    } catch (error) {
      // Se nel frattempo un contatore è cambiato il service rifiuta: il dialog
      // resta aperto e mostra il motivo, invece di chiudersi lasciando credere
      // che l'eliminazione sia avvenuta.
      setDeleteError(messageOf(error, 'Impossibile eliminare l’etichetta. Riprova.'));
    } finally {
      busyRef.current = false;
      setDeleting(false);
    }
  }

  return (
    <div className={styles.container}>
      <button
        type="button"
        className={`btn-primary ${styles.newLabelBtn}`}
        onClick={() => {
          setCreateError(null);
          setCreateOpen(true);
        }}
      >
        <IconTag size={16} />
        <span>Nuova etichetta</span>
      </button>

      {labels.length === 0 ? (
        <div className={styles.empty}>
          <h3 className={styles.emptyTitle}>Nessuna etichetta</h3>
          <p className={styles.emptyText}>
            Le etichette servono a te, per servire domande diverse a studenti diversi nella stessa
            verifica. Usa nomi operativi e assegnane al massimo una per studente.
          </p>
          <p className={styles.emptyText}>
            <span className={styles.emptyStrong}>Gli studenti non le vedono mai:</span> non
            compaiono nella verifica, nella correzione restituita, nei PDF o negli export.
          </p>
        </div>
      ) : (
        <div className={styles.labelList} role="list" aria-label="Etichette">
          {labels.map((item) => {
            /*
             * `assignedCount` è il contatore transazionale, mosso da VDIF-02
             * nella stessa transazione dell'assegnazione. Questa card lo
             * mostrava già da VDIF-01, quando valeva sempre 0: il pacchetto che
             * ha iniziato a muoverlo non ha dovuto toccare questo componente.
             */
            const students = item.assignedCount;
            const inUse = item.assignedCount > 0 || item.draftUsageCount > 0;
            const usageReason = inUse ? describeUsage(item) : null;
            const hintId = `label-usage-${item.labelId}`;
            return (
              <RecordCard
                key={item.labelId}
                recordLabel="Etichetta"
                title={item.name}
                titleMeta={
                  item.draftUsageCount > 0
                    ? `${studentCountLabel(students)} · ${draftCountLabel(item.draftUsageCount)}`
                    : studentCountLabel(students)
                }
                actionLayout="class-admin"
                metrics={[]}
                metaLine={
                  usageReason ? (
                    <span className={styles.usageNote} id={hintId}>
                      {usageReason}
                    </span>
                  ) : undefined
                }
                actions={
                  <RecordActionsMenu ariaLabel={`Azioni etichetta — ${item.name}`}>
                    <button
                      type="button"
                      role="menuitem"
                      title="Modifica etichetta"
                      aria-label={`Modifica etichetta ${item.name}`}
                      onClick={() => startEdit(item)}
                    >
                      <IconPencil size={15} />
                      <span>Modifica etichetta</span>
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className={menuStyles.menuDanger}
                      title="Elimina etichetta"
                      aria-label={`Elimina etichetta ${item.name}`}
                      disabled={inUse}
                      aria-describedby={inUse ? hintId : undefined}
                      onClick={() => {
                        setDeleteError(null);
                        setDeleteId(item.labelId);
                      }}
                    >
                      <IconTrash size={15} />
                      <span>Elimina etichetta</span>
                    </button>
                  </RecordActionsMenu>
                }
              />
            );
          })}
        </div>
      )}

      {createOpen && (
        <DialogShell title="Nuova etichetta" busy={creating} onCancel={closeCreate}>
          <form className={styles.form} aria-label="Nuova etichetta" onSubmit={handleCreate}>
            <div className={styles.field}>
              <div className={styles.fieldHead}>
                <label htmlFor="new-label-name">Nome etichetta</label>
                <span
                  className={`${styles.counter} ${
                    countCodePoints(createName) > LABEL_NAME_MAX_CODE_POINTS
                      ? styles.counterOver
                      : ''
                  }`}
                  aria-live="polite"
                >
                  {countCodePoints(createName)}/{LABEL_NAME_MAX_CODE_POINTS}
                </span>
              </div>
              {/*
                Nessun `maxLength`: l'attributo HTML conta **unità UTF-16**, non
                code point, quindi taglierebbe a metà un nome di 40 emoji — e lo
                farebbe in silenzio, che è il modo peggiore. Il limite lo decide
                `normalizeLabelName`, che conta code point e byte separatamente
                e produce un errore leggibile.
              */}
              <input
                id="new-label-name"
                type="text"
                className={styles.input}
                value={createName}
                autoFocus
                aria-describedby="new-label-hint"
                aria-invalid={createError ? true : undefined}
                aria-errormessage={createError ? 'new-label-error' : undefined}
                onChange={(event) => setCreateName(event.target.value)}
              />
            </div>
            <p className={styles.hint} id="new-label-hint">
              Usa una denominazione operativa neutrale. L’etichetta resta privata e serve solo a te
              per scegliere quali domande servire.
            </p>
            {createError && (
              <p role="alert" id="new-label-error" className="text-error">
                {createError}
              </p>
            )}
            <div className={styles.dialogActions}>
              <button type="button" disabled={creating} onClick={closeCreate}>
                Annulla
              </button>
              <button
                type="submit"
                className="btn-primary"
                disabled={creating || createName.trim().length === 0}
              >
                <IconTag size={15} />
                <span>{creating ? 'Creazione…' : 'Aggiungi'}</span>
              </button>
            </div>
          </form>
        </DialogShell>
      )}

      {editing && (
        <DialogShell title="Modifica etichetta" busy={saving} onCancel={closeEdit}>
          <form className={styles.form} aria-label="Modifica etichetta" onSubmit={handleRename}>
            <div className={styles.field}>
              <div className={styles.fieldHead}>
                <label htmlFor="edit-label-name">Nome etichetta</label>
                <span
                  className={`${styles.counter} ${
                    countCodePoints(editName) > LABEL_NAME_MAX_CODE_POINTS ? styles.counterOver : ''
                  }`}
                  aria-live="polite"
                >
                  {countCodePoints(editName)}/{LABEL_NAME_MAX_CODE_POINTS}
                </span>
              </div>
              {/* Nessun `maxLength`: vedi la nota nel dialog di creazione. */}
              <input
                id="edit-label-name"
                type="text"
                className={styles.input}
                value={editName}
                autoFocus
                aria-invalid={editError ? true : undefined}
                aria-errormessage={editError ? 'edit-label-error' : undefined}
                onChange={(event) => setEditName(event.target.value)}
              />
            </div>
            {editError && (
              <p role="alert" id="edit-label-error" className="text-error">
                {editError}
              </p>
            )}
            <div className={styles.dialogActions}>
              <button type="button" disabled={saving} onClick={closeEdit}>
                Annulla
              </button>
              <button
                type="submit"
                className="btn-primary"
                disabled={saving || editName.trim().length === 0}
              >
                <IconPencil size={15} />
                <span>{saving ? 'Salvataggio…' : 'Salva'}</span>
              </button>
            </div>
          </form>
        </DialogShell>
      )}

      {deleting_ && (
        <DialogShell
          title="Elimina etichetta"
          role="alertdialog"
          busy={deleting}
          onCancel={() => {
            setDeleteId(null);
            setDeleteError(null);
          }}
        >
          <p>
            Eliminare <span className={styles.deleteName}>{deleting_.name}</span>? L’operazione è
            irreversibile.
          </p>
          <p className={styles.hint}>
            Le verifiche già attivate non sono toccate: la loro configurazione è congelata al
            momento dell’attivazione.
          </p>
          {deleteError && (
            <p role="alert" className="text-error">
              {deleteError}
            </p>
          )}
          <div className={styles.dialogActions}>
            <button
              type="button"
              disabled={deleting}
              onClick={() => {
                setDeleteId(null);
                setDeleteError(null);
              }}
            >
              Annulla
            </button>
            <button
              type="button"
              className="btn-danger"
              disabled={deleting}
              onClick={() => void handleDelete()}
            >
              <IconTrash size={15} />
              <span>{deleting ? 'Eliminazione…' : 'Elimina'}</span>
            </button>
          </div>
        </DialogShell>
      )}
    </div>
  );
}
