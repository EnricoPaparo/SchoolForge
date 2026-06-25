import { type FormEvent, useEffect, useState } from 'react';
import {
  createProgram,
  listLessons,
  listPrograms,
  listUdas,
  setLessonCompleted,
  updateProgramTitle,
  type LessonItem,
  type ProgramItem,
  type UdaItem,
} from '../repository/programs/programsService.js';
import { db, storage } from '../../lib/firebase.js';
import { useAuth } from '../../lib/auth.js';
import { MarkdownRenderer } from './MarkdownRenderer.js';
import { fetchLessonContent } from './lessonContent.js';
import { exportZip } from './exportZip.js';
import { downloadMarkdown, downloadPdf, generateMarkdown } from './programmaSvolto.js';
import { ReadinessView } from './ReadinessView.js';
import styles from './ProgramsView.module.css';

export function ProgramsView() {
  const { user } = useAuth();
  const ownerUid = user?.uid ?? '';

  const [programs, setPrograms] = useState<ProgramItem[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [selectedProgram, setSelectedProgram] = useState<ProgramItem | null>(null);
  const [udas, setUdas] = useState<UdaItem[] | null>(null);

  const [selectedUdaDir, setSelectedUdaDir] = useState<string | null>(null);
  const [lessons, setLessons] = useState<LessonItem[] | null>(null);

  const [allLessons, setAllLessons] = useState<LessonItem[] | null>(null);

  const [selectedLesson, setSelectedLesson] = useState<LessonItem | null>(null);
  const [lessonContent, setLessonContent] = useState<string | null>(null);
  const [lessonContentError, setLessonContentError] = useState<string | null>(null);
  const [lessonContentLoading, setLessonContentLoading] = useState(false);

  const [newTitle, setNewTitle] = useState('');
  const [creating, setCreating] = useState(false);

  const [editTitle, setEditTitle] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [exportingZip, setExportingZip] = useState(false);
  const [exportZipError, setExportZipError] = useState<string | null>(null);

  const [pdfDownloading, setPdfDownloading] = useState(false);

  useEffect(() => {
    void loadPrograms();
  }, []);

  async function loadPrograms() {
    setLoadError(null);
    try {
      const list = await listPrograms(db);
      setPrograms(list);
    } catch {
      setLoadError('Impossibile caricare i programmi.');
    }
  }

  async function handleSelectProgram(p: ProgramItem) {
    setSelectedProgram(p);
    setSelectedUdaDir(null);
    setLessons(null);
    setAllLessons(null);
    setUdas(null);
    setEditTitle(null);
    setSelectedLesson(null);
    setLessonContent(null);
    setLessonContentError(null);
    setExportZipError(null);
    if (!p.activeImportId) return;
    try {
      const [udaList, lessonList] = await Promise.all([
        listUdas(p.id, p.activeImportId, db),
        listLessons(p.id, p.activeImportId, db),
      ]);
      setUdas(udaList);
      setAllLessons(lessonList);
    } catch {
      setUdas([]);
      setAllLessons([]);
    }
  }

  async function handleSelectUda(udaDir: string) {
    if (!selectedProgram?.activeImportId) return;
    setSelectedUdaDir(udaDir);
    setLessons(null);
    setSelectedLesson(null);
    setLessonContent(null);
    setLessonContentError(null);
    try {
      const all = await listLessons(selectedProgram.id, selectedProgram.activeImportId, db);
      setLessons(all.filter((l) => l.udaDir === udaDir));
    } catch {
      setLessons([]);
    }
  }

  async function handleSelectLesson(lesson: LessonItem) {
    setSelectedLesson(lesson);
    setLessonContent(null);
    setLessonContentError(null);
    setLessonContentLoading(true);
    try {
      const content = await fetchLessonContent(lesson.storageRef, storage);
      setLessonContent(content);
    } catch {
      setLessonContentError('Impossibile caricare il contenuto della lezione.');
    } finally {
      setLessonContentLoading(false);
    }
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    const t = newTitle.trim();
    if (!t) return;
    setCreating(true);
    try {
      await createProgram(t, ownerUid, db);
      setNewTitle('');
      await loadPrograms();
    } finally {
      setCreating(false);
    }
  }

  async function handleSaveTitle(e: FormEvent) {
    e.preventDefault();
    if (!selectedProgram || editTitle === null) return;
    const t = editTitle.trim();
    if (!t) return;
    setSaving(true);
    try {
      await updateProgramTitle(selectedProgram.id, t, ownerUid, db);
      const updated = { ...selectedProgram, title: t };
      setSelectedProgram(updated);
      setPrograms((prev) => prev?.map((p) => (p.id === updated.id ? updated : p)) ?? null);
      setEditTitle(null);
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleLesson(lesson: LessonItem) {
    if (!selectedProgram?.activeImportId) return;
    const completed = !(lesson.completed ?? false);
    await setLessonCompleted(
      selectedProgram.id,
      selectedProgram.activeImportId,
      lesson.id,
      completed,
      ownerUid,
      db,
    );
    setLessons((prev) => prev?.map((l) => (l.id === lesson.id ? { ...l, completed } : l)) ?? null);
  }

  async function handleExportZip() {
    if (!selectedProgram) return;
    setExportingZip(true);
    setExportZipError(null);
    try {
      await exportZip(selectedProgram, storage, db);
    } catch {
      setExportZipError('Impossibile esportare il ZIP.');
    } finally {
      setExportingZip(false);
    }
  }

  async function handleDownloadProgrammaSvoltoMd() {
    if (!selectedProgram || !udas || !lessons) return;
    const allLessons = await listLessons(
      selectedProgram.id,
      selectedProgram.activeImportId ?? '',
      db,
    );
    const content = generateMarkdown(selectedProgram, udas, allLessons);
    downloadMarkdown(content, `programma-svolto-${selectedProgram.title.replace(/\s+/g, '_')}.md`);
  }

  async function handleDownloadProgrammaSvoltoPdf() {
    if (!selectedProgram || !udas) return;
    setPdfDownloading(true);
    try {
      const allLessons = await listLessons(
        selectedProgram.id,
        selectedProgram.activeImportId ?? '',
        db,
      );
      const content = generateMarkdown(selectedProgram, udas, allLessons);
      await downloadPdf(content, `programma-svolto-${selectedProgram.title.replace(/\s+/g, '_')}`);
    } finally {
      setPdfDownloading(false);
    }
  }

  if (loadError)
    return (
      <p role="alert" className="text-error">
        {loadError}
      </p>
    );
  if (programs === null)
    return (
      <p aria-busy="true" className="state-loading">
        Caricamento…
      </p>
    );

  return (
    <section aria-label="Programmi" className={styles.container}>
      {/* ── Sidebar: program list + create form ── */}
      <aside className={styles.sidebar}>
        <h2 className={styles.sidebarTitle}>Programmi</h2>

        {programs.length === 0 && <p className="state-empty">Nessun programma. Creane uno.</p>}

        {programs.length > 0 && (
          <ul className={styles.programList}>
            {programs.map((p) => (
              <li key={p.id} className={styles.programItem}>
                <button
                  type="button"
                  className={styles.programBtn}
                  aria-pressed={selectedProgram?.id === p.id}
                  onClick={() => void handleSelectProgram(p)}
                >
                  {p.title}
                </button>
              </li>
            ))}
          </ul>
        )}

        <form className={styles.createForm} onSubmit={(e) => void handleCreate(e)}>
          <label className={styles.createLabel} htmlFor="new-program-title">
            Titolo nuovo programma
          </label>
          <input
            id="new-program-title"
            type="text"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
          />
          <button
            type="submit"
            className={styles.createBtn}
            disabled={creating || !newTitle.trim()}
          >
            {creating ? 'Creazione…' : 'Crea programma'}
          </button>
        </form>
      </aside>

      {/* ── Detail panel ── */}
      {selectedProgram && (
        <div className={styles.detail}>
          {/* Program title */}
          {editTitle !== null ? (
            <form className={styles.editTitleForm} onSubmit={(e) => void handleSaveTitle(e)}>
              <label htmlFor="edit-program-title">
                Modifica titolo
                <input
                  id="edit-program-title"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                />
              </label>
              <button type="submit" disabled={saving || !editTitle.trim()}>
                Salva
              </button>
              <button type="button" onClick={() => setEditTitle(null)}>
                Annulla
              </button>
            </form>
          ) : (
            <div className={styles.programHeader}>
              <h2 className={styles.programTitle}>{selectedProgram.title}</h2>
              <button type="button" onClick={() => setEditTitle(selectedProgram.title)}>
                Modifica titolo
              </button>
            </div>
          )}

          {/* Export toolbar */}
          {selectedProgram.activeImportId && (
            <div className={styles.exportBar}>
              <span className={styles.exportBarLabel}>Esporta</span>
              <button type="button" onClick={() => void handleExportZip()} disabled={exportingZip}>
                {exportingZip ? 'Esportazione…' : 'Esporta ZIP'}
              </button>

              <button
                type="button"
                onClick={() => void handleDownloadProgrammaSvoltoMd()}
                disabled={!udas}
              >
                Programma svolto (MD)
              </button>

              <button
                type="button"
                onClick={() => void handleDownloadProgrammaSvoltoPdf()}
                disabled={!udas || pdfDownloading}
              >
                {pdfDownloading ? 'Generazione PDF…' : 'Programma svolto (PDF)'}
              </button>

              {exportZipError && (
                <p role="alert" className="text-error">
                  {exportZipError}
                </p>
              )}
            </div>
          )}

          {/* UDA + Lesson content */}
          {!selectedProgram.activeImportId ? (
            <p className="state-empty">Nessun import attivo per questo programma.</p>
          ) : udas === null ? (
            <p aria-busy="true" className="state-loading">
              Caricamento UDA…
            </p>
          ) : (
            <div className={styles.contentPanel}>
              <h3 className={styles.udaTitle}>UDA</h3>
              {udas.length === 0 ? (
                <p className="state-empty">Nessuna UDA.</p>
              ) : (
                <ul className={styles.udaList}>
                  {udas.map((u) => (
                    <li key={u.id}>
                      <button
                        type="button"
                        className={styles.udaBtn}
                        aria-pressed={selectedUdaDir === u.dir}
                        onClick={() => void handleSelectUda(u.dir)}
                      >
                        {u.dir}
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              {selectedUdaDir && (
                <div className={styles.lessonSection}>
                  <h4 className={styles.lessonTitle}>Lezioni — {selectedUdaDir}</h4>
                  {lessons === null ? (
                    <p aria-busy="true" className="state-loading">
                      Caricamento lezioni…
                    </p>
                  ) : lessons.length === 0 ? (
                    <p className="state-empty">Nessuna lezione.</p>
                  ) : (
                    <ul className={styles.lessonList}>
                      {lessons.map((l) => (
                        <li
                          key={l.id}
                          className={`${styles.lessonRow}${l.completed ? ` ${styles.lessonCompleted}` : ''}`}
                        >
                          <input
                            type="checkbox"
                            id={`lesson-check-${l.id}`}
                            checked={l.completed ?? false}
                            onChange={() => void handleToggleLesson(l)}
                            aria-label={`Segna ${l.filename} come svolta`}
                          />
                          <button
                            type="button"
                            className={styles.lessonBtn}
                            onClick={() => void handleSelectLesson(l)}
                            aria-pressed={selectedLesson?.id === l.id}
                          >
                            {l.filename}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}

                  {selectedLesson && (
                    <div className={styles.lessonContentPanel}>
                      <h5 className={styles.lessonContentTitle}>{selectedLesson.filename}</h5>
                      {lessonContentLoading && (
                        <p aria-busy="true" className="state-loading">
                          Caricamento contenuto…
                        </p>
                      )}
                      {lessonContentError && (
                        <p role="alert" className="text-error">
                          {lessonContentError}
                        </p>
                      )}
                      {lessonContent !== null && !lessonContentLoading && (
                        <MarkdownRenderer markdown={lessonContent} />
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <ReadinessView program={selectedProgram} udas={udas} lessons={allLessons} />
        </div>
      )}
    </section>
  );
}
