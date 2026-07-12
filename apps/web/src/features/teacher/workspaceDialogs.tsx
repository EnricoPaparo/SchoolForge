import { type FormEvent, type ReactNode, useEffect, useState } from 'react';
import { db } from '../../lib/firebase.js';
import { getImportMeta } from '../repository/programs/programsService.js';
import { listClasses, type ClassItem } from '../repository/classes/classesService.js';
import type { ProgrammaMeta } from '../../types/firestore.js';
import styles from './DidatticaView.module.css';

/**
 * Shared dialog primitives + course/UDA dialogs for the Didattica surfaces.
 * Extracted so the library card menu (`DidatticaView`) and the course
 * workspace toolbar (`CourseWorkspace`) reuse the exact same components and
 * never grow two independent versions of the same operation (DUX-04A).
 */

export function DialogShell({
  title,
  children,
  onCancel,
}: {
  title: string;
  children: ReactNode;
  onCancel: () => void;
}) {
  return (
    <div className={styles.backdrop} onClick={onCancel}>
      <div
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className={styles.dialogTitle}>{title}</h3>
        {children}
      </div>
    </div>
  );
}

export function TitleDialog({
  title,
  label,
  confirmLabel,
  initial,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  title: string;
  label: string;
  confirmLabel: string;
  initial: string;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: (title: string) => void;
}) {
  const [value, setValue] = useState(initial);
  function submit(e: FormEvent) {
    e.preventDefault();
    const t = value.trim();
    if (!t) return;
    onConfirm(t);
  }
  return (
    <DialogShell title={title} onCancel={onCancel}>
      <form onSubmit={submit} className={styles.dialogForm}>
        <label className={styles.dialogLabel}>
          {label}
          <input
            type="text"
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            aria-label={label}
          />
        </label>
        {error && (
          <p role="alert" className="text-error">
            {error}
          </p>
        )}
        <div className={styles.dialogActions}>
          <button type="button" onClick={onCancel} disabled={busy}>
            Annulla
          </button>
          <button type="submit" className="btn-primary" disabled={busy || value.trim() === ''}>
            {busy ? 'Attendere…' : confirmLabel}
          </button>
        </div>
      </form>
    </DialogShell>
  );
}

export function ImportDialog({
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: (title: string, file: File) => void;
}) {
  const [title, setTitle] = useState('');
  const [file, setFile] = useState<File | null>(null);
  function submit(e: FormEvent) {
    e.preventDefault();
    const t = title.trim();
    if (!t || !file) return;
    onConfirm(t, file);
  }
  return (
    <DialogShell title="Importa un nuovo corso da ZIP" onCancel={onCancel}>
      <form onSubmit={submit} className={styles.dialogForm}>
        <label className={styles.dialogLabel}>
          Titolo del corso
          <input
            type="text"
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            aria-label="Titolo del corso"
          />
        </label>
        <label className={styles.dialogLabel}>
          File ZIP
          <input
            type="file"
            accept=".zip"
            aria-label="File ZIP del corso"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </label>
        <p className={styles.dialogHint}>
          Lo ZIP deve contenere cartelle <code>uda-NN-slug/</code> con i file UDA, lezioni e pool;
          il <code>programma.md</code> nella radice è opzionale.
        </p>
        {error && (
          <p role="alert" className="text-error">
            {error}
          </p>
        )}
        <div className={styles.dialogActions}>
          <button type="button" onClick={onCancel} disabled={busy}>
            Annulla
          </button>
          <button
            type="submit"
            className="btn-primary"
            disabled={busy || title.trim() === '' || !file}
          >
            {busy ? 'Importazione…' : 'Importa'}
          </button>
        </div>
      </form>
    </DialogShell>
  );
}

/**
 * "Import a ZIP into the current course" — the title is fixed (the course
 * already exists), only the file is chosen. Used by the workspace toolbar
 * where the course is already selected.
 */
export function ImportIntoCourseDialog({
  courseTitle,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  courseTitle: string;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: (file: File) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  function submit(e: FormEvent) {
    e.preventDefault();
    if (!file) return;
    onConfirm(file);
  }
  return (
    <DialogShell title={`Importa ZIP in "${courseTitle}"`} onCancel={onCancel}>
      <form onSubmit={submit} className={styles.dialogForm}>
        <label className={styles.dialogLabel}>
          File ZIP
          <input
            type="file"
            accept=".zip"
            autoFocus
            aria-label="File ZIP del corso"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </label>
        <p className={styles.dialogHint}>
          Sostituisce la struttura importata di questo corso con quella dello ZIP.
        </p>
        {error && (
          <p role="alert" className="text-error">
            {error}
          </p>
        )}
        <div className={styles.dialogActions}>
          <button type="button" onClick={onCancel} disabled={busy}>
            Annulla
          </button>
          <button type="submit" className="btn-primary" disabled={busy || !file}>
            {busy ? 'Importazione…' : 'Importa'}
          </button>
        </div>
      </form>
    </DialogShell>
  );
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  danger,
  busy,
  error,
  extra,
  onCancel,
  onConfirm,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  busy: boolean;
  error: string | null;
  /** Optional extra content (e.g. a blockers list) rendered above the actions. */
  extra?: ReactNode;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <DialogShell title={title} onCancel={onCancel}>
      <p className={styles.dialogMessage}>{message}</p>
      {extra}
      {error && (
        <p role="alert" className="text-error">
          {error}
        </p>
      )}
      <div className={styles.dialogActions}>
        <button type="button" onClick={onCancel} disabled={busy}>
          Annulla
        </button>
        <button
          type="button"
          className={danger ? 'btn-danger' : 'btn-primary'}
          onClick={onConfirm}
          disabled={busy}
        >
          {busy ? 'Attendere…' : confirmLabel}
        </button>
      </div>
    </DialogShell>
  );
}

// ── UDA metadata (descrizione / competenze / obiettivi) ─────────────────────

function linesToArray(value: string): string[] {
  return value
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

export type UdaMetadataValues = {
  descrizione: string | null;
  competenze: string[];
  obiettivi: string[];
};

export function UdaMetadataDialog({
  title,
  initial,
  confirmLabel,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  title: string;
  initial: UdaMetadataValues;
  confirmLabel: string;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: (values: UdaMetadataValues) => void;
}) {
  const [descrizione, setDescrizione] = useState(initial.descrizione ?? '');
  const [competenze, setCompetenze] = useState(initial.competenze.join('\n'));
  const [obiettivi, setObiettivi] = useState(initial.obiettivi.join('\n'));

  function submit(e: FormEvent) {
    e.preventDefault();
    onConfirm({
      descrizione: descrizione.trim() || null,
      competenze: linesToArray(competenze),
      obiettivi: linesToArray(obiettivi),
    });
  }

  return (
    <DialogShell title={title} onCancel={onCancel}>
      <form onSubmit={submit} className={styles.dialogForm}>
        <label className={styles.dialogLabel}>
          Descrizione
          <textarea
            rows={2}
            value={descrizione}
            onChange={(e) => setDescrizione(e.target.value)}
            aria-label="Descrizione UDA"
          />
        </label>
        <label className={styles.dialogLabel}>
          Competenze (una per riga)
          <textarea
            rows={3}
            value={competenze}
            onChange={(e) => setCompetenze(e.target.value)}
            aria-label="Competenze UDA"
          />
        </label>
        <label className={styles.dialogLabel}>
          Obiettivi (uno per riga)
          <textarea
            rows={3}
            value={obiettivi}
            onChange={(e) => setObiettivi(e.target.value)}
            aria-label="Obiettivi UDA"
          />
        </label>
        {error && (
          <p role="alert" className="text-error">
            {error}
          </p>
        )}
        <div className={styles.dialogActions}>
          <button type="button" onClick={onCancel} disabled={busy}>
            Annulla
          </button>
          <button type="submit" className="btn-success" disabled={busy}>
            {busy ? 'Salvataggio…' : confirmLabel}
          </button>
        </div>
      </form>
    </DialogShell>
  );
}

/** Dialog to create a new UDA: title is required, metadata optional. */
export function NewUdaDialog({
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: (values: { titolo: string } & UdaMetadataValues) => void;
}) {
  const [titolo, setTitolo] = useState('');
  const [descrizione, setDescrizione] = useState('');
  const [competenze, setCompetenze] = useState('');
  const [obiettivi, setObiettivi] = useState('');

  function submit(e: FormEvent) {
    e.preventDefault();
    const t = titolo.trim();
    if (!t) return;
    onConfirm({
      titolo: t,
      descrizione: descrizione.trim() || null,
      competenze: linesToArray(competenze),
      obiettivi: linesToArray(obiettivi),
    });
  }

  return (
    <DialogShell title="Nuova UDA" onCancel={onCancel}>
      <form onSubmit={submit} className={styles.dialogForm}>
        <label className={styles.dialogLabel}>
          Titolo
          <input
            type="text"
            autoFocus
            value={titolo}
            onChange={(e) => setTitolo(e.target.value)}
            aria-label="Titolo UDA"
          />
        </label>
        <label className={styles.dialogLabel}>
          Descrizione
          <textarea
            rows={2}
            value={descrizione}
            onChange={(e) => setDescrizione(e.target.value)}
            aria-label="Descrizione UDA"
          />
        </label>
        <label className={styles.dialogLabel}>
          Competenze (una per riga)
          <textarea
            rows={2}
            value={competenze}
            onChange={(e) => setCompetenze(e.target.value)}
            aria-label="Competenze UDA"
          />
        </label>
        <label className={styles.dialogLabel}>
          Obiettivi (uno per riga)
          <textarea
            rows={2}
            value={obiettivi}
            onChange={(e) => setObiettivi(e.target.value)}
            aria-label="Obiettivi UDA"
          />
        </label>
        {error && (
          <p role="alert" className="text-error">
            {error}
          </p>
        )}
        <div className={styles.dialogActions}>
          <button type="button" onClick={onCancel} disabled={busy}>
            Annulla
          </button>
          <button type="submit" className="btn-success" disabled={busy || titolo.trim() === ''}>
            {busy ? 'Creazione…' : 'Crea UDA'}
          </button>
        </div>
      </form>
    </DialogShell>
  );
}

// ── Classes assignment ───────────────────────────────────────────────────────

export function ClassesDialog({
  ownerUid,
  currentClassIds,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  ownerUid: string;
  currentClassIds: string[];
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: (classIds: string[], classNames: string[]) => void;
}) {
  const [classes, setClasses] = useState<ClassItem[] | null>(null);
  const [selected, setSelected] = useState<string[]>(currentClassIds);

  useEffect(() => {
    let cancelled = false;
    listClasses(ownerUid, db)
      .then((list) => {
        if (!cancelled) setClasses(list);
      })
      .catch(() => {
        if (!cancelled) setClasses([]);
      });
    return () => {
      cancelled = true;
    };
  }, [ownerUid]);

  function toggle(id: string) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  return (
    <DialogShell title="Classi assegnate" onCancel={onCancel}>
      {classes === null ? (
        <p aria-busy="true" className="state-loading">
          Caricamento classi…
        </p>
      ) : classes.length === 0 ? (
        <p className="state-empty">
          Nessuna classe creata. Vai alla sezione Classi per crearne una.
        </p>
      ) : (
        <>
          <p className={styles.dialogHint}>
            Un corso senza classi selezionate non è visibile a nessuno studente.
          </p>
          <ul className={styles.checklist}>
            {classes.map((c) => (
              <li key={c.id}>
                <label className={styles.checklistItem}>
                  <input
                    type="checkbox"
                    checked={selected.includes(c.id)}
                    onChange={() => toggle(c.id)}
                  />
                  <span>{c.name}</span>
                </label>
              </li>
            ))}
          </ul>
        </>
      )}
      {error && (
        <p role="alert" className="text-error">
          {error}
        </p>
      )}
      <div className={styles.dialogActions}>
        <button type="button" onClick={onCancel} disabled={busy}>
          Annulla
        </button>
        <button
          type="button"
          className="btn-success"
          onClick={() => {
            const names = (classes ?? []).filter((c) => selected.includes(c.id)).map((c) => c.name);
            onConfirm(selected, names);
          }}
          disabled={busy || classes === null}
        >
          {busy ? 'Salvataggio…' : 'Salva'}
        </button>
      </div>
    </DialogShell>
  );
}

// ── Program information / metadata ───────────────────────────────────────────

export function ProgramInfoDialog({
  programId,
  importId,
  counts,
  classNames,
  onClose,
}: {
  programId: string;
  importId: string | null;
  counts: { udaCount: number; lessonsDone: number; lessonsTotal: number; questionsTotal: number };
  classNames: string[];
  onClose: () => void;
}) {
  const [meta, setMeta] = useState<ProgrammaMeta | null | undefined>(undefined);

  useEffect(() => {
    if (!importId) {
      setMeta(null);
      return;
    }
    let cancelled = false;
    getImportMeta(programId, importId, db)
      .then((m) => {
        if (!cancelled) setMeta(m);
      })
      .catch(() => {
        if (!cancelled) setMeta(null);
      });
    return () => {
      cancelled = true;
    };
  }, [programId, importId]);

  return (
    <DialogShell title="Informazioni corso" onCancel={onClose}>
      <dl className={styles.infoList}>
        <dt>Import</dt>
        <dd>{importId ? 'Attivo' : 'Nessuno'}</dd>
        <dt>UDA totali</dt>
        <dd>{counts.udaCount}</dd>
        <dt>Lezioni svolte</dt>
        <dd>
          {counts.lessonsDone} / {counts.lessonsTotal}
        </dd>
        <dt>Domande disponibili</dt>
        <dd>{counts.questionsTotal}</dd>
        <dt>Classi</dt>
        <dd>{classNames.length > 0 ? classNames.join(', ') : 'Nessuna'}</dd>
        {meta === undefined ? (
          <>
            <dt>Metadata</dt>
            <dd aria-busy="true">Caricamento…</dd>
          </>
        ) : meta ? (
          <>
            <dt>Anno scolastico</dt>
            <dd>{meta.annoScolastico ?? 'Non indicato'}</dd>
            <dt>Docente</dt>
            <dd>{meta.docente ?? 'Non indicato'}</dd>
            <dt>Materia</dt>
            <dd>{meta.materia ?? 'Non indicato'}</dd>
            <dt>Classe</dt>
            <dd>{meta.classe ?? 'Non indicato'}</dd>
            <dt>Descrizione</dt>
            <dd>{meta.descrizione ?? 'Non indicato'}</dd>
          </>
        ) : null}
      </dl>
      <div className={styles.dialogActions}>
        <button type="button" className="btn-primary" onClick={onClose}>
          Chiudi
        </button>
      </div>
    </DialogShell>
  );
}
