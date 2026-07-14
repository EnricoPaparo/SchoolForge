import { type FormEvent, type ReactNode, useEffect, useState } from 'react';
import { db, storage } from '../../lib/firebase.js';
import { getImportMeta } from '../repository/programs/programsService.js';
import { listClasses, type ClassItem } from '../repository/classes/classesService.js';
import { updateProgramMetadata } from '../repository/editor/repositoryEditorService.js';
import { EMPTY_PROGRAM_METADATA } from '../repository/validation/programMetadata.js';
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

export function NewCourseDialog({
  initialYear,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  initialYear: string;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: (title: string, annoScolastico: string) => void;
}) {
  const [title, setTitle] = useState('');
  const [year, setYear] = useState(initialYear);
  const yearMatch = /^(\d{4})\/(\d{4})$/.exec(year.trim());
  const yearIsValid = yearMatch != null && Number(yearMatch[2]) === Number(yearMatch[1]) + 1;

  function submit(e: FormEvent) {
    e.preventDefault();
    const cleanTitle = title.trim();
    const cleanYear = year.trim();
    const match = /^(\d{4})\/(\d{4})$/.exec(cleanYear);
    if (!cleanTitle || !match || Number(match[2]) !== Number(match[1]) + 1) return;
    onConfirm(cleanTitle, cleanYear);
  }

  return (
    <DialogShell title="Nuovo corso" onCancel={onCancel}>
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
          Anno scolastico
          <input
            type="text"
            inputMode="numeric"
            placeholder="2025/2026"
            value={year}
            onChange={(e) => setYear(e.target.value)}
            aria-label="Anno scolastico"
            aria-describedby="new-course-year-hint"
          />
        </label>
        <p id="new-course-year-hint" className={styles.dialogHint}>
          Formato AAAA/AAAA, per esempio 2025/2026.
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
            disabled={busy || title.trim() === '' || !yearIsValid}
          >
            {busy ? 'Creazione…' : 'Crea'}
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

// ── New lesson ───────────────────────────────────────────────────────────────

export type NewLessonValues = {
  titolo: string;
  sottotitolo: string | null;
  difficolta: string | null;
  concettiChiave: string[];
  obiettivi: string[];
  body: string;
};

export function NewLessonDialog({
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: (values: NewLessonValues) => void;
}) {
  const [titolo, setTitolo] = useState('');
  const [sottotitolo, setSottotitolo] = useState('');
  const [difficolta, setDifficolta] = useState('');
  const [concettiChiave, setConcettiChiave] = useState('');
  const [obiettivi, setObiettivi] = useState('');
  const [body, setBody] = useState('');

  function submit(e: FormEvent) {
    e.preventDefault();
    const t = titolo.trim();
    if (!t) return;
    onConfirm({
      titolo: t,
      sottotitolo: sottotitolo.trim() || null,
      difficolta: difficolta.trim() || null,
      concettiChiave: linesToArray(concettiChiave),
      obiettivi: linesToArray(obiettivi),
      body,
    });
  }

  return (
    <DialogShell title="Nuova lezione" onCancel={onCancel}>
      <form onSubmit={submit} className={styles.dialogForm}>
        <label className={styles.dialogLabel}>
          Titolo
          <input
            type="text"
            autoFocus
            value={titolo}
            onChange={(e) => setTitolo(e.target.value)}
            aria-label="Titolo lezione"
          />
        </label>
        <label className={styles.dialogLabel}>
          Sottotitolo
          <input
            type="text"
            value={sottotitolo}
            onChange={(e) => setSottotitolo(e.target.value)}
            aria-label="Sottotitolo lezione"
          />
        </label>
        <label className={styles.dialogLabel}>
          Difficoltà
          <input
            type="text"
            value={difficolta}
            onChange={(e) => setDifficolta(e.target.value)}
            aria-label="Difficoltà lezione"
          />
        </label>
        <label className={styles.dialogLabel}>
          Concetti chiave (uno per riga)
          <textarea
            rows={2}
            value={concettiChiave}
            onChange={(e) => setConcettiChiave(e.target.value)}
            aria-label="Concetti chiave lezione"
          />
        </label>
        <label className={styles.dialogLabel}>
          Obiettivi (uno per riga)
          <textarea
            rows={2}
            value={obiettivi}
            onChange={(e) => setObiettivi(e.target.value)}
            aria-label="Obiettivi lezione"
          />
        </label>
        <label className={styles.dialogLabel}>
          Corpo Markdown iniziale (opzionale)
          <textarea
            rows={4}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            aria-label="Corpo Markdown lezione"
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
            {busy ? 'Creazione…' : 'Crea lezione'}
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
          Nessuna classe creata. Vai in Studenti, scheda Classi, per crearne una.
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
  ownerUid,
  counts,
  classNames,
  onSaved,
  onClose,
}: {
  programId: string;
  importId: string | null;
  ownerUid: string;
  counts: { udaCount: number; lessonsDone: number; lessonsTotal: number; questionsTotal: number };
  classNames: string[];
  onSaved: (metadata: ProgrammaMeta) => void;
  onClose: () => void;
}) {
  const [meta, setMeta] = useState<ProgrammaMeta | null | undefined>(undefined);
  const [draft, setDraft] = useState<ProgrammaMeta>(EMPTY_PROGRAM_METADATA);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!importId) {
      setMeta(null);
      return;
    }
    let cancelled = false;
    getImportMeta(programId, importId, db)
      .then((m) => {
        if (!cancelled) {
          setMeta(m);
          setDraft(m ?? EMPTY_PROGRAM_METADATA);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setMeta(null);
          setDraft(EMPTY_PROGRAM_METADATA);
          setError('Impossibile caricare i metadati del corso.');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [programId, importId]);

  function updateDraft(field: keyof ProgrammaMeta, value: string) {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  function save() {
    if (!importId || busy) return;
    setBusy(true);
    setError(null);
    void updateProgramMetadata({
      programId,
      importId,
      fields: draft,
      ownerUid,
      db,
      storage,
    })
      .then((saved) => {
        setMeta(saved);
        setDraft(saved);
        setEditing(false);
        onSaved(saved);
      })
      .catch((cause: unknown) => {
        setError(
          cause instanceof Error ? cause.message : 'Impossibile salvare i metadati del corso.',
        );
      })
      .finally(() => setBusy(false));
  }

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
        {meta === undefined && importId ? (
          <>
            <dt>Metadata</dt>
            <dd aria-busy="true">Caricamento…</dd>
          </>
        ) : meta && !editing ? (
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
      {!importId ? (
        <p className={styles.dialogHint}>
          Importa prima un contenuto didattico per aggiungere i metadati.
        </p>
      ) : editing ? (
        <form
          className={styles.dialogForm}
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
        >
          <label className={styles.dialogLabel}>
            Anno scolastico
            <input
              value={draft.annoScolastico ?? ''}
              placeholder="2025/2026"
              onChange={(event) => updateDraft('annoScolastico', event.target.value)}
            />
          </label>
          <label className={styles.dialogLabel}>
            Docente
            <input
              value={draft.docente ?? ''}
              onChange={(event) => updateDraft('docente', event.target.value)}
            />
          </label>
          <label className={styles.dialogLabel}>
            Materia
            <input
              value={draft.materia ?? ''}
              onChange={(event) => updateDraft('materia', event.target.value)}
            />
          </label>
          <label className={styles.dialogLabel}>
            Classe descrittiva
            <input
              value={draft.classe ?? ''}
              onChange={(event) => updateDraft('classe', event.target.value)}
            />
          </label>
          <label className={styles.dialogLabel}>
            Descrizione
            <textarea
              rows={4}
              value={draft.descrizione ?? ''}
              onChange={(event) => updateDraft('descrizione', event.target.value)}
            />
          </label>
          <div className={styles.dialogActions}>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setDraft(meta ?? EMPTY_PROGRAM_METADATA);
                setEditing(false);
                setError(null);
              }}
            >
              Annulla
            </button>
            <button type="submit" className="btn-success" disabled={busy}>
              {busy ? 'Salvataggio…' : 'Salva'}
            </button>
          </div>
        </form>
      ) : null}
      {error && (
        <p role="alert" className="text-error">
          {error}
        </p>
      )}
      <div className={styles.dialogActions}>
        {!editing && importId && meta !== undefined && (
          <button
            type="button"
            onClick={() => {
              setDraft(meta ?? EMPTY_PROGRAM_METADATA);
              setEditing(true);
              setError(null);
            }}
          >
            Modifica
          </button>
        )}
        {!editing && (
          <button type="button" className="btn-primary" onClick={onClose}>
            Chiudi
          </button>
        )}
      </div>
    </DialogShell>
  );
}
