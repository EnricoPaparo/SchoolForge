import { type FormEvent, useEffect, useState } from 'react';
import {
  createProgram,
  deleteProgram,
  getImportMeta,
  listLessons,
  listPrograms,
  listUdas,
  setLessonCompleted,
  updateProgramTitle,
  type LessonItem,
  type ProgramItem,
  type UdaItem,
} from '../repository/programs/programsService.js';
import type { ProgrammaMeta } from '../../types/firestore.js';
import { importRepository } from '../repository/import/importRepository.js';
import { readZipFile } from '../repository/import/readZipFile.js';
import type { ValidationIssue } from '../repository/validation/types.js';
import { db, storage } from '../../lib/firebase.js';
import { useAuth } from '../../lib/auth.js';
import { exportZip } from './exportZip.js';
import { downloadMarkdown, downloadPdf, generateMarkdown } from './programmaSvolto.js';
import { ImportZipModal, type ImportZipResult } from './ImportZipModal.js';
import styles from './ProgramsView.module.css';

/**
 * Translates the first validation issue into a clean Italian message for the
 * import modal. Falls back to the raw issue message/path for codes without a
 * dedicated translation, keeping compatibility with older validation issues.
 */
function describeImportValidationError(issues: ValidationIssue[]): string {
  const first = issues[0];
  if (!first) return 'Validazione fallita: struttura ZIP non valida.';
  if (first.code === 'NO_UDAS') {
    return 'Validazione fallita: lo ZIP non contiene nessuna UDA valida. Verifica che ci sia almeno una cartella "uda-NN-slug/" con un file UDA conforme.';
  }
  if (first.code === 'MISSING_UDA_FILE') {
    return `Validazione fallita: struttura ZIP non conforme — la cartella "${first.path}" non contiene un file UDA valido (es. "uda-01-slug.md").`;
  }
  return `Validazione fallita: ${first.message} (${first.path})`;
}

type CourseState = {
  udas: UdaItem[] | null;
  lessons: LessonItem[] | null;
  programmaMeta?: ProgrammaMeta | null;
  loadError?: string;
  exporting?: boolean;
  exportError?: string | null;
  pdfDownloading?: boolean;
};

export function ProgramsView() {
  const { user } = useAuth();
  const ownerUid = user?.uid ?? '';

  const [programs, setPrograms] = useState<ProgramItem[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [courseState, setCourseState] = useState<Record<string, CourseState>>({});
  const [expandedCourses, setExpandedCourses] = useState<Set<string>>(new Set());
  const [expandedUdas, setExpandedUdas] = useState<Set<string>>(new Set());

  const [editingProgramId, setEditingProgramId] = useState<string | null>(null);
  const [editTitleValue, setEditTitleValue] = useState('');
  const [savingTitle, setSavingTitle] = useState(false);

  const [infoOpenProgramId, setInfoOpenProgramId] = useState<string | null>(null);
  const [infoOpenUdaKey, setInfoOpenUdaKey] = useState<string | null>(null);

  const [newTitle, setNewTitle] = useState('');
  const [creating, setCreating] = useState(false);

  // ── Delete program state ────────────────────────────────────────
  const [deleteConfirmProgramId, setDeleteConfirmProgramId] = useState<string | null>(null);
  const [deletingProgram, setDeletingProgram] = useState(false);
  const [deleteProgramError, setDeleteProgramError] = useState<string | null>(null);

  // ── Import ZIP modal state ─────────────────────────────────────
  const [importModalProgramId, setImportModalProgramId] = useState<string | null>(null);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<ImportZipResult | null>(null);

  useEffect(() => {
    void loadPrograms();
  }, []);

  function updateCourseState(programId: string, patch: Partial<CourseState>) {
    setCourseState((prev) => ({
      ...prev,
      [programId]: { ...(prev[programId] ?? { udas: null, lessons: null }), ...patch },
    }));
  }

  async function loadPrograms() {
    setLoadError(null);
    try {
      const list = await listPrograms(db);
      setPrograms(list);
      list.forEach((p) => {
        if (p.activeImportId) void loadCourseSummary(p);
      });
    } catch {
      setLoadError('Impossibile caricare i programmi.');
    }
  }

  async function loadCourseSummary(program: ProgramItem) {
    if (!program.activeImportId) {
      updateCourseState(program.id, { udas: [], lessons: [] });
      return;
    }
    const importId = program.activeImportId;
    updateCourseState(program.id, { udas: null, lessons: null, loadError: undefined });
    try {
      const [udas, lessons, programmaMeta] = await Promise.all([
        listUdas(program.id, importId, db),
        listLessons(program.id, importId, db),
        getImportMeta(program.id, importId, db),
      ]);
      updateCourseState(program.id, { udas, lessons, programmaMeta });
    } catch {
      updateCourseState(program.id, {
        udas: [],
        lessons: [],
        loadError: 'Impossibile caricare i dati del corso.',
      });
    }
  }

  function toggleCourse(program: ProgramItem) {
    setExpandedCourses((prev) => {
      const next = new Set(prev);
      if (next.has(program.id)) next.delete(program.id);
      else next.add(program.id);
      return next;
    });
    if (program.activeImportId && !courseState[program.id]) {
      void loadCourseSummary(program);
    }
  }

  function toggleUda(programId: string, udaDir: string) {
    const key = `${programId}:${udaDir}`;
    setExpandedUdas((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleInfo(programId: string) {
    setInfoOpenProgramId((prev) => (prev === programId ? null : programId));
  }

  function toggleUdaInfo(udaKey: string) {
    setInfoOpenUdaKey((prev) => (prev === udaKey ? null : udaKey));
  }

  async function handleToggleLesson(program: ProgramItem, lesson: LessonItem) {
    if (!program.activeImportId) return;
    const completed = !(lesson.completed ?? false);
    await setLessonCompleted(
      program.id,
      program.activeImportId,
      lesson.id,
      completed,
      ownerUid,
      db,
    );
    setCourseState((prev) => {
      const cur = prev[program.id];
      if (!cur?.lessons) return prev;
      return {
        ...prev,
        [program.id]: {
          ...cur,
          lessons: cur.lessons.map((l) => (l.id === lesson.id ? { ...l, completed } : l)),
        },
      };
    });
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

  function startEditTitle(program: ProgramItem) {
    setEditingProgramId(program.id);
    setEditTitleValue(program.title);
  }

  async function handleSaveTitle(e: FormEvent, program: ProgramItem) {
    e.preventDefault();
    const t = editTitleValue.trim();
    if (!t) return;
    setSavingTitle(true);
    try {
      await updateProgramTitle(program.id, t, ownerUid, db);
      setPrograms(
        (prev) => prev?.map((p) => (p.id === program.id ? { ...p, title: t } : p)) ?? null,
      );
      setEditingProgramId(null);
    } finally {
      setSavingTitle(false);
    }
  }

  function startDeleteProgram(program: ProgramItem) {
    setDeleteConfirmProgramId(program.id);
    setDeleteProgramError(null);
  }

  function cancelDeleteProgram() {
    setDeleteConfirmProgramId(null);
    setDeleteProgramError(null);
  }

  async function handleConfirmDeleteProgram(program: ProgramItem) {
    setDeletingProgram(true);
    setDeleteProgramError(null);
    try {
      await deleteProgram(program.id, ownerUid, db, storage);
      setPrograms((prev) => prev?.filter((p) => p.id !== program.id) ?? null);
      setCourseState((prev) => {
        const next = { ...prev };
        delete next[program.id];
        return next;
      });
      setDeleteConfirmProgramId(null);
    } catch (err) {
      setDeleteProgramError(err instanceof Error ? err.message : 'Impossibile eliminare il corso.');
    } finally {
      setDeletingProgram(false);
    }
  }

  async function handleExportZip(program: ProgramItem) {
    updateCourseState(program.id, { exporting: true, exportError: null });
    try {
      await exportZip(program, storage, db);
    } catch {
      updateCourseState(program.id, { exportError: 'Impossibile esportare il ZIP.' });
    } finally {
      updateCourseState(program.id, { exporting: false });
    }
  }

  async function handleDownloadProgrammaSvoltoMd(program: ProgramItem) {
    const cs = courseState[program.id];
    if (!program.activeImportId || !cs?.udas) return;
    const allLessons = await listLessons(program.id, program.activeImportId, db);
    const content = generateMarkdown(program, cs.udas, allLessons, cs.programmaMeta);
    downloadMarkdown(content, `programma-svolto-${program.title.replace(/\s+/g, '_')}.md`);
  }

  async function handleDownloadProgrammaSvoltoPdf(program: ProgramItem) {
    const cs = courseState[program.id];
    if (!program.activeImportId || !cs?.udas) return;
    updateCourseState(program.id, { pdfDownloading: true });
    try {
      const allLessons = await listLessons(program.id, program.activeImportId, db);
      const content = generateMarkdown(program, cs.udas, allLessons, cs.programmaMeta);
      await downloadPdf(content, `programma-svolto-${program.title.replace(/\s+/g, '_')}`);
    } finally {
      updateCourseState(program.id, { pdfDownloading: false });
    }
  }

  function openImportModal(program: ProgramItem) {
    setImportModalProgramId(program.id);
    setImportFile(null);
    setImportError(null);
    setImportResult(null);
  }

  function closeImportModal() {
    setImportModalProgramId(null);
  }

  async function handleImport() {
    const program = programs?.find((p) => p.id === importModalProgramId);
    if (!program || !importFile) return;
    setImporting(true);
    setImportError(null);
    setImportResult(null);
    try {
      const files = await readZipFile(importFile);
      const result = await importRepository(
        {
          ownerUid,
          programmaTitle: program.title,
          programId: program.id,
          files,
        },
        { db, storage },
      );
      if (result.status === 'validation_failed') {
        setImportError(describeImportValidationError(result.validationIssues));
        return;
      }
      const counts: ImportZipResult = {
        udaCount: result.udaCount,
        lessonCount: result.lessonCount,
        questionCount: result.questionCount,
      };
      setImportFile(null);
      const updated = await listPrograms(db);
      setPrograms(updated);
      const refreshed = updated.find((p) => p.id === program.id);
      if (refreshed) await loadCourseSummary(refreshed);
      setImportResult(counts);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Errore durante l'importazione.");
    } finally {
      setImporting(false);
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

  const modalProgram = importModalProgramId
    ? programs.find((p) => p.id === importModalProgramId)
    : undefined;

  return (
    <section aria-label="Corsi" className={styles.container}>
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
        <button type="submit" className={styles.createBtn} disabled={creating || !newTitle.trim()}>
          {creating ? 'Creazione…' : 'Crea programma'}
        </button>
      </form>

      {programs.length === 0 ? (
        <p className="state-empty">Nessun programma. Creane uno.</p>
      ) : (
        <ul className={styles.courseList}>
          {programs.map((program) => {
            const cs = courseState[program.id];
            const expanded = expandedCourses.has(program.id);
            const udaCount = cs?.udas?.length ?? 0;
            const lessonsTotal = cs?.lessons?.length ?? 0;
            const lessonsDone = cs?.lessons?.filter((l) => l.completed).length ?? 0;
            const questionsTotal =
              cs?.lessons?.reduce((sum, l) => sum + (l.questionCount ?? 0), 0) ?? 0;
            const dataLoading =
              program.activeImportId != null && (cs?.udas == null || cs?.lessons == null);

            return (
              <li key={program.id} className={styles.courseItem}>
                <div className={styles.courseHeader}>
                  <button
                    type="button"
                    className={styles.courseToggle}
                    aria-expanded={expanded}
                    aria-controls={`course-panel-${program.id}`}
                    onClick={() => toggleCourse(program)}
                  >
                    <span
                      className={`${styles.caret}${expanded ? ` ${styles.caretOpen}` : ''}`}
                      aria-hidden="true"
                    >
                      ▶
                    </span>
                    <span className={styles.courseTitle}>{program.title}</span>
                    <span className={styles.courseCounters}>
                      {!program.activeImportId
                        ? 'Nessun import attivo'
                        : dataLoading
                          ? 'Caricamento dati…'
                          : `UDA: ${udaCount} · Lezioni: ${lessonsDone}/${lessonsTotal} svolte · Domande: ${questionsTotal} disponibili`}
                    </span>
                  </button>

                  <div
                    className={styles.courseActions}
                    role="group"
                    aria-label={`Azioni corso ${program.title}`}
                  >
                    <button
                      type="button"
                      className={styles.iconBtn}
                      title="Modifica titolo"
                      aria-label={`Modifica titolo — ${program.title}`}
                      onClick={() => startEditTitle(program)}
                    >
                      ✏️
                    </button>
                    <button
                      type="button"
                      className={styles.iconBtn}
                      title="Importa ZIP"
                      aria-label={`Importa ZIP — ${program.title}`}
                      onClick={() => openImportModal(program)}
                    >
                      ⬆️
                    </button>
                    <button
                      type="button"
                      className={styles.iconBtn}
                      title="Esporta ZIP"
                      aria-label={`Esporta ZIP — ${program.title}`}
                      disabled={!program.activeImportId || cs?.exporting}
                      onClick={() => void handleExportZip(program)}
                    >
                      {cs?.exporting ? '…' : '⬇️'}
                    </button>
                    <button
                      type="button"
                      className={styles.iconBtn}
                      title="Programma svolto (MD)"
                      aria-label={`Programma svolto (MD) — ${program.title}`}
                      disabled={!program.activeImportId || !cs?.udas}
                      onClick={() => void handleDownloadProgrammaSvoltoMd(program)}
                    >
                      📝
                    </button>
                    <button
                      type="button"
                      className={styles.iconBtn}
                      title="Programma svolto (PDF)"
                      aria-label={`Programma svolto (PDF) — ${program.title}`}
                      disabled={!program.activeImportId || !cs?.udas || cs?.pdfDownloading}
                      onClick={() => void handleDownloadProgrammaSvoltoPdf(program)}
                    >
                      {cs?.pdfDownloading ? '…' : '🖨️'}
                    </button>
                    <button
                      type="button"
                      className={styles.iconBtn}
                      title="Info corso"
                      aria-label={`Info corso — ${program.title}`}
                      aria-expanded={infoOpenProgramId === program.id}
                      onClick={() => toggleInfo(program.id)}
                    >
                      ℹ️
                    </button>
                    <button
                      type="button"
                      className={`${styles.iconBtn} ${styles.iconBtnDanger}`}
                      title="Elimina corso"
                      aria-label={`Elimina corso — ${program.title}`}
                      onClick={() => startDeleteProgram(program)}
                    >
                      🗑️
                    </button>
                  </div>
                </div>

                {deleteConfirmProgramId === program.id && (
                  <div
                    className={styles.deleteConfirmBox}
                    role="region"
                    aria-label={`Conferma eliminazione corso ${program.title}`}
                  >
                    <p className={styles.deleteConfirmMsg}>
                      Saranno eliminati import, UDA, lezioni, pool e file caricati. Operazione
                      irreversibile.
                    </p>
                    {deleteProgramError && (
                      <p role="alert" className="text-error">
                        {deleteProgramError}
                      </p>
                    )}
                    <div className={styles.deleteConfirmActions}>
                      <button
                        type="button"
                        className={styles.deleteConfirmBtn}
                        disabled={deletingProgram}
                        onClick={() => void handleConfirmDeleteProgram(program)}
                      >
                        {deletingProgram ? 'Eliminazione…' : 'Elimina definitivamente'}
                      </button>
                      <button
                        type="button"
                        onClick={cancelDeleteProgram}
                        disabled={deletingProgram}
                      >
                        Annulla
                      </button>
                    </div>
                  </div>
                )}

                {editingProgramId === program.id && (
                  <form
                    className={styles.editTitleForm}
                    onSubmit={(e) => void handleSaveTitle(e, program)}
                  >
                    <label htmlFor={`edit-program-title-${program.id}`}>
                      Modifica titolo
                      <input
                        id={`edit-program-title-${program.id}`}
                        value={editTitleValue}
                        onChange={(e) => setEditTitleValue(e.target.value)}
                      />
                    </label>
                    <button type="submit" disabled={savingTitle || !editTitleValue.trim()}>
                      Salva
                    </button>
                    <button type="button" onClick={() => setEditingProgramId(null)}>
                      Annulla
                    </button>
                  </form>
                )}

                {cs?.exportError && (
                  <p role="alert" className={`text-error ${styles.actionError}`}>
                    {cs.exportError}
                  </p>
                )}

                {infoOpenProgramId === program.id && (
                  <div
                    className={styles.infoPanel}
                    role="region"
                    aria-label={`Informazioni corso ${program.title}`}
                  >
                    <dl className={styles.infoList}>
                      <dt>Import</dt>
                      <dd>{program.activeImportId ? 'Attivo' : 'Nessuno'}</dd>
                      <dt>UDA totali</dt>
                      <dd>{udaCount}</dd>
                      <dt>Lezioni svolte</dt>
                      <dd>
                        {lessonsDone} / {lessonsTotal}
                      </dd>
                      <dt>Domande disponibili</dt>
                      <dd>{questionsTotal}</dd>
                      {cs?.programmaMeta && (
                        <>
                          <dt>Anno scolastico</dt>
                          <dd>{cs.programmaMeta.annoScolastico ?? 'Non indicato'}</dd>
                          <dt>Docente</dt>
                          <dd>{cs.programmaMeta.docente ?? 'Non indicato'}</dd>
                          <dt>Materia</dt>
                          <dd>{cs.programmaMeta.materia ?? 'Non indicato'}</dd>
                          <dt>Classe</dt>
                          <dd>{cs.programmaMeta.classe ?? 'Non indicato'}</dd>
                          <dt>Descrizione</dt>
                          <dd>{cs.programmaMeta.descrizione ?? 'Non indicato'}</dd>
                        </>
                      )}
                    </dl>
                  </div>
                )}

                {expanded && (
                  <div id={`course-panel-${program.id}`} className={styles.udaPanel}>
                    {!program.activeImportId ? (
                      <p className="state-empty">Nessun import attivo per questo programma.</p>
                    ) : cs?.udas == null ? (
                      <p aria-busy="true" className="state-loading">
                        Caricamento UDA…
                      </p>
                    ) : cs.udas.length === 0 ? (
                      <p className="state-empty">Nessuna UDA.</p>
                    ) : (
                      <ul className={styles.udaList}>
                        {cs.udas.map((uda) => {
                          const udaKey = `${program.id}:${uda.dir}`;
                          const udaExpanded = expandedUdas.has(udaKey);
                          const udaLessons = (cs.lessons ?? []).filter((l) => l.udaDir === uda.dir);
                          const udaDone = udaLessons.filter((l) => l.completed).length;

                          const udaInfoOpen = infoOpenUdaKey === udaKey;

                          return (
                            <li key={uda.id} className={styles.udaItem}>
                              <div className={styles.udaHeader}>
                                <button
                                  type="button"
                                  className={styles.udaToggle}
                                  aria-expanded={udaExpanded}
                                  aria-controls={`uda-panel-${uda.id}`}
                                  onClick={() => toggleUda(program.id, uda.dir)}
                                >
                                  <span
                                    className={`${styles.caret}${udaExpanded ? ` ${styles.caretOpen}` : ''}`}
                                    aria-hidden="true"
                                  >
                                    ▶
                                  </span>
                                  <span className={styles.udaDir}>{uda.dir}</span>
                                  <span className={styles.udaCounters}>
                                    Lezioni: {udaDone}/{udaLessons.length} svolte
                                  </span>
                                </button>
                                <button
                                  type="button"
                                  className={styles.iconBtn}
                                  title="Info UDA"
                                  aria-label={`Info UDA — ${uda.dir}`}
                                  aria-expanded={udaInfoOpen}
                                  onClick={() => toggleUdaInfo(udaKey)}
                                >
                                  ℹ️
                                </button>
                              </div>

                              {udaInfoOpen && (
                                <div
                                  className={styles.infoPanel}
                                  role="region"
                                  aria-label={`Informazioni UDA ${uda.dir}`}
                                >
                                  <dl className={styles.infoList}>
                                    <dt>Descrizione</dt>
                                    <dd>{uda.descrizione ?? 'Non indicato'}</dd>
                                    <dt>Competenze</dt>
                                    <dd>
                                      {uda.competenze.length > 0
                                        ? uda.competenze.join(', ')
                                        : 'Non indicato'}
                                    </dd>
                                    <dt>Obiettivi</dt>
                                    <dd>
                                      {uda.obiettivi.length > 0
                                        ? uda.obiettivi.join(', ')
                                        : 'Non indicato'}
                                    </dd>
                                  </dl>
                                </div>
                              )}

                              {udaExpanded && (
                                <div id={`uda-panel-${uda.id}`} className={styles.lessonPanel}>
                                  {udaLessons.length === 0 ? (
                                    <p className="state-empty">Nessuna lezione.</p>
                                  ) : (
                                    <ul className={styles.lessonList}>
                                      {udaLessons.map((lesson) => (
                                        <li
                                          key={lesson.id}
                                          className={`${styles.lessonRow}${lesson.completed ? ` ${styles.lessonCompleted}` : ''}`}
                                        >
                                          <input
                                            type="checkbox"
                                            id={`lesson-check-${lesson.id}`}
                                            checked={lesson.completed ?? false}
                                            onChange={() =>
                                              void handleToggleLesson(program, lesson)
                                            }
                                            aria-label={`Segna ${lesson.filename} come svolta`}
                                          />
                                          <span className={styles.lessonFilename}>
                                            {lesson.filename}
                                          </span>
                                        </li>
                                      ))}
                                    </ul>
                                  )}
                                </div>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {modalProgram && (
        <ImportZipModal
          programTitle={modalProgram.title}
          hasActiveImport={modalProgram.activeImportId != null}
          file={importFile}
          importing={importing}
          error={importError}
          result={importResult}
          onFileChange={setImportFile}
          onImport={() => void handleImport()}
          onClose={closeImportModal}
        />
      )}
    </section>
  );
}
