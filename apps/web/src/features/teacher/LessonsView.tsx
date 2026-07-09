import { useEffect, useState } from 'react';
import {
  listLessons,
  listPrograms,
  listUdas,
  type LessonItem,
  type ProgramItem,
  type UdaItem,
} from '../repository/programs/programsService.js';
import { resolveLessonTitle } from '../repository/programs/lessonTitle.js';
import {
  EMPTY_LESSON_METADATA,
  parseLessonMetadata,
} from '../repository/validation/lessonMetadata.js';
import type { LessonMetadata } from '../repository/validation/types.js';
import { updateLessonMetadata } from '../repository/editor/repositoryEditorService.js';
import { useAuth } from '../../lib/auth.js';
import { db, storage } from '../../lib/firebase.js';
import { fetchLessonContent } from './lessonContent.js';
import { downloadLessonPdf } from './lessonPdf.js';
import { MarkdownRenderer } from './MarkdownRenderer.js';
import styles from './LessonsView.module.css';

function linesToArray(value: string): string[] {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

const IMPORT_HINT = 'Importa prima uno ZIP da Corsi per vedere le lezioni.';

type CourseTreeState = {
  udas: UdaItem[] | null;
  lessons: LessonItem[] | null;
  error?: string;
};

export function LessonsView() {
  const { user } = useAuth();
  const ownerUid = user?.uid ?? '';

  const [programs, setPrograms] = useState<ProgramItem[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [courseTree, setCourseTree] = useState<Record<string, CourseTreeState>>({});
  const [expandedCourses, setExpandedCourses] = useState<Set<string>>(new Set());
  const [expandedUdas, setExpandedUdas] = useState<Set<string>>(new Set());

  const [selectedProgram, setSelectedProgram] = useState<ProgramItem | null>(null);
  const [selectedLesson, setSelectedLesson] = useState<LessonItem | null>(null);
  const [lessonContent, setLessonContent] = useState<string | null>(null);
  const [lessonMetadata, setLessonMetadata] = useState<LessonMetadata>(EMPTY_LESSON_METADATA);
  const [lessonContentLoading, setLessonContentLoading] = useState(false);
  const [lessonContentError, setLessonContentError] = useState<string | null>(null);
  const [pdfDownloading, setPdfDownloading] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);

  // ── Lesson metadata editor (RE-01) ──────────────────────────────
  const [editingLessonMetadata, setEditingLessonMetadata] = useState(false);
  const [editTitolo, setEditTitolo] = useState('');
  const [editSottotitolo, setEditSottotitolo] = useState('');
  const [editDifficolta, setEditDifficolta] = useState('');
  const [editConcettiChiave, setEditConcettiChiave] = useState('');
  const [editObiettivi, setEditObiettivi] = useState('');
  const [savingLessonMetadata, setSavingLessonMetadata] = useState(false);
  const [lessonMetadataSaveError, setLessonMetadataSaveError] = useState<string | null>(null);

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

  async function loadCourseTree(program: ProgramItem) {
    if (!program.activeImportId) return;
    const importId = program.activeImportId;
    setCourseTree((prev) => ({ ...prev, [program.id]: { udas: null, lessons: null } }));
    try {
      const [udas, lessons] = await Promise.all([
        listUdas(program.id, importId, db),
        listLessons(program.id, importId, db),
      ]);
      setCourseTree((prev) => ({ ...prev, [program.id]: { udas, lessons } }));
    } catch {
      setCourseTree((prev) => ({
        ...prev,
        [program.id]: { udas: [], lessons: [], error: 'Impossibile caricare i dati del corso.' },
      }));
    }
  }

  function toggleCourse(program: ProgramItem) {
    setExpandedCourses((prev) => {
      const next = new Set(prev);
      if (next.has(program.id)) next.delete(program.id);
      else next.add(program.id);
      return next;
    });
    if (program.activeImportId && !courseTree[program.id]) {
      void loadCourseTree(program);
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

  async function selectLesson(program: ProgramItem, lesson: LessonItem) {
    setSelectedProgram(program);
    setSelectedLesson(lesson);
    setLessonContent(null);
    setLessonMetadata(EMPTY_LESSON_METADATA);
    setLessonContentError(null);
    setPdfError(null);
    setEditingLessonMetadata(false);
    setLessonMetadataSaveError(null);
    setLessonContentLoading(true);
    try {
      const raw = await fetchLessonContent(lesson.storageRef, storage);
      const { metadata, body } = parseLessonMetadata(raw);
      setLessonMetadata(metadata);
      setLessonContent(body);
    } catch {
      setLessonContentError('Impossibile caricare il contenuto della lezione.');
    } finally {
      setLessonContentLoading(false);
    }
  }

  function toggleLessonMetadataEdit() {
    setLessonMetadataSaveError(null);
    setEditingLessonMetadata((prev) => {
      if (prev) return false;
      setEditTitolo(lessonMetadata.titolo ?? '');
      setEditSottotitolo(lessonMetadata.sottotitolo ?? '');
      setEditDifficolta(lessonMetadata.difficolta ?? '');
      setEditConcettiChiave(lessonMetadata.concettiChiave.join('\n'));
      setEditObiettivi(lessonMetadata.obiettivi.join('\n'));
      return true;
    });
  }

  async function handleSaveLessonMetadata() {
    if (!selectedProgram?.activeImportId || !selectedLesson) return;
    const fields: LessonMetadata = {
      titolo: editTitolo.trim() || null,
      sottotitolo: editSottotitolo.trim() || null,
      difficolta: editDifficolta.trim() || null,
      concettiChiave: linesToArray(editConcettiChiave),
      obiettivi: linesToArray(editObiettivi),
    };
    setSavingLessonMetadata(true);
    setLessonMetadataSaveError(null);
    try {
      await updateLessonMetadata({
        programId: selectedProgram.id,
        importId: selectedProgram.activeImportId,
        lessonId: selectedLesson.id,
        fields,
        ownerUid,
        db,
        storage,
      });
      setLessonMetadata(fields);
      setCourseTree((prev) => {
        const cur = prev[selectedProgram.id];
        if (!cur?.lessons) return prev;
        return {
          ...prev,
          [selectedProgram.id]: {
            ...cur,
            lessons: cur.lessons.map((l) => (l.id === selectedLesson.id ? { ...l, ...fields } : l)),
          },
        };
      });
      setEditingLessonMetadata(false);
    } catch (err) {
      setLessonMetadataSaveError(
        err instanceof Error ? err.message : 'Impossibile salvare i metadata della lezione.',
      );
    } finally {
      setSavingLessonMetadata(false);
    }
  }

  async function handleDownloadLessonPdf() {
    if (!selectedLesson || lessonContent == null) return;
    setPdfError(null);
    setPdfDownloading(true);
    try {
      const contextParts = [selectedProgram?.title, selectedLesson.udaDir].filter(
        (part): part is string => Boolean(part?.trim()),
      );
      const context = contextParts.length > 0 ? contextParts.join(' - ') : null;
      const { title } = resolveLessonTitle(selectedLesson.filename, lessonMetadata.titolo);
      await downloadLessonPdf(title, lessonContent, context, lessonMetadata);
    } catch {
      setPdfError('Impossibile generare il PDF della lezione.');
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

  if (programs.length === 0) {
    return (
      <section aria-label="Lezioni" className={styles.container}>
        <p className={`state-empty ${styles.emptyPanel}`}>
          Nessun programma disponibile. {IMPORT_HINT}
        </p>
      </section>
    );
  }

  return (
    <section aria-label="Lezioni" className={styles.container}>
      <aside className={styles.sidebar}>
        <h2 className={styles.sidebarTitle}>Lezioni</h2>

        <ul className={styles.courseList}>
          {programs.map((program) => {
            const tree = courseTree[program.id];
            const expanded = expandedCourses.has(program.id);

            return (
              <li key={program.id} className={styles.courseItem}>
                <button
                  type="button"
                  className={styles.courseToggle}
                  aria-expanded={expanded}
                  aria-controls={`lezioni-course-panel-${program.id}`}
                  onClick={() => toggleCourse(program)}
                >
                  <span
                    className={`${styles.caret}${expanded ? ` ${styles.caretOpen}` : ''}`}
                    aria-hidden="true"
                  >
                    ▶
                  </span>
                  <span className={styles.courseTitle}>{program.title}</span>
                  {!program.activeImportId && (
                    <span className="badge badge-warning">Nessun import</span>
                  )}
                </button>

                {expanded && (
                  <div id={`lezioni-course-panel-${program.id}`} className={styles.udaPanel}>
                    {!program.activeImportId ? (
                      <p className="state-empty">{IMPORT_HINT}</p>
                    ) : tree?.udas == null ? (
                      <p aria-busy="true" className="state-loading">
                        Caricamento UDA…
                      </p>
                    ) : tree.udas.length === 0 ? (
                      <p className="state-empty">Nessuna UDA.</p>
                    ) : (
                      <ul className={styles.udaList}>
                        {tree.udas.map((uda) => {
                          const udaKey = `${program.id}:${uda.dir}`;
                          const udaExpanded = expandedUdas.has(udaKey);
                          const udaLessons = (tree.lessons ?? []).filter(
                            (l) => l.udaDir === uda.dir,
                          );

                          return (
                            <li key={uda.id}>
                              <button
                                type="button"
                                className={styles.udaToggle}
                                aria-expanded={udaExpanded}
                                aria-controls={`lezioni-uda-panel-${uda.id}`}
                                onClick={() => toggleUda(program.id, uda.dir)}
                              >
                                <span
                                  className={`${styles.caret}${udaExpanded ? ` ${styles.caretOpen}` : ''}`}
                                  aria-hidden="true"
                                >
                                  ▶
                                </span>
                                <span className={styles.udaDir}>{uda.dir}</span>
                              </button>

                              {udaExpanded && (
                                <div
                                  id={`lezioni-uda-panel-${uda.id}`}
                                  className={styles.lessonPanel}
                                >
                                  {udaLessons.length === 0 ? (
                                    <p className="state-empty">Nessuna lezione.</p>
                                  ) : (
                                    <ul className={styles.lessonList}>
                                      {udaLessons.map((lesson) => {
                                        const { title } = resolveLessonTitle(
                                          lesson.filename,
                                          lesson.titolo,
                                        );
                                        return (
                                          <li key={lesson.id}>
                                            <button
                                              type="button"
                                              className={styles.lessonBtn}
                                              aria-pressed={selectedLesson?.id === lesson.id}
                                              aria-label={`Apri lezione ${lesson.filename}`}
                                              onClick={() => void selectLesson(program, lesson)}
                                            >
                                              {title}
                                            </button>
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
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </aside>

      <div className={styles.content}>
        {selectedLesson === null ? (
          <p className="state-empty">
            Seleziona una lezione dalla lista per leggerne il contenuto.
          </p>
        ) : (
          <>
            <div className={styles.contentHeader}>
              <div className={styles.titleBlock}>
                <h3 className={styles.contentTitle}>
                  {resolveLessonTitle(selectedLesson.filename, lessonMetadata.titolo).title}
                </h3>
                {lessonMetadata.sottotitolo && (
                  <p className={styles.contentSubtitle}>{lessonMetadata.sottotitolo}</p>
                )}
              </div>
              <button
                type="button"
                className={styles.pdfBtn}
                title="Modifica metadata"
                aria-label={`Modifica metadata — ${selectedLesson.filename}`}
                aria-expanded={editingLessonMetadata}
                disabled={lessonContent == null}
                onClick={toggleLessonMetadataEdit}
              >
                ✏️
              </button>
              <button
                type="button"
                className={styles.pdfBtn}
                title="Scarica PDF"
                aria-label={`Scarica PDF — ${selectedLesson.filename}`}
                disabled={lessonContent == null || pdfDownloading}
                onClick={() => void handleDownloadLessonPdf()}
              >
                {pdfDownloading ? '…' : '🖨️'}
              </button>
            </div>

            {editingLessonMetadata && (
              <form
                className={styles.metadataEditForm}
                role="region"
                aria-label={`Modifica metadata — ${selectedLesson.filename}`}
                onSubmit={(e) => {
                  e.preventDefault();
                  void handleSaveLessonMetadata();
                }}
              >
                <label htmlFor="lesson-edit-titolo">
                  Titolo
                  <input
                    id="lesson-edit-titolo"
                    type="text"
                    value={editTitolo}
                    onChange={(e) => setEditTitolo(e.target.value)}
                  />
                </label>
                <label htmlFor="lesson-edit-sottotitolo">
                  Sottotitolo
                  <input
                    id="lesson-edit-sottotitolo"
                    type="text"
                    value={editSottotitolo}
                    onChange={(e) => setEditSottotitolo(e.target.value)}
                  />
                </label>
                <label htmlFor="lesson-edit-difficolta">
                  Difficoltà
                  <input
                    id="lesson-edit-difficolta"
                    type="text"
                    value={editDifficolta}
                    onChange={(e) => setEditDifficolta(e.target.value)}
                  />
                </label>
                <label htmlFor="lesson-edit-concetti">
                  Concetti chiave (uno per riga)
                  <textarea
                    id="lesson-edit-concetti"
                    rows={3}
                    value={editConcettiChiave}
                    onChange={(e) => setEditConcettiChiave(e.target.value)}
                  />
                </label>
                <label htmlFor="lesson-edit-obiettivi">
                  Obiettivi (uno per riga)
                  <textarea
                    id="lesson-edit-obiettivi"
                    rows={3}
                    value={editObiettivi}
                    onChange={(e) => setEditObiettivi(e.target.value)}
                  />
                </label>
                {lessonMetadataSaveError && (
                  <p role="alert" className="text-error">
                    {lessonMetadataSaveError}
                  </p>
                )}
                <div className={styles.metadataEditActions}>
                  <button type="submit" className="btn-success" disabled={savingLessonMetadata}>
                    {savingLessonMetadata ? 'Salvataggio…' : 'Salva'}
                  </button>
                  <button
                    type="button"
                    disabled={savingLessonMetadata}
                    onClick={() => setEditingLessonMetadata(false)}
                  >
                    Annulla
                  </button>
                </div>
              </form>
            )}

            {lessonMetadata.difficolta && (
              <span className={styles.contentDifficulty}>{lessonMetadata.difficolta}</span>
            )}

            {(lessonMetadata.concettiChiave.length > 0 || lessonMetadata.obiettivi.length > 0) && (
              <div className={styles.metaBlock}>
                {lessonMetadata.concettiChiave.length > 0 && (
                  <div className={styles.metaGroup}>
                    <span className={styles.metaLabel}>Concetti chiave</span>
                    <ul className={styles.chipList}>
                      {lessonMetadata.concettiChiave.map((concetto) => (
                        <li key={concetto} className={styles.chip}>
                          {concetto}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {lessonMetadata.obiettivi.length > 0 && (
                  <div className={styles.metaGroup}>
                    <span className={styles.metaLabel}>Obiettivi</span>
                    <ul className={styles.metaList}>
                      {lessonMetadata.obiettivi.map((obiettivo) => (
                        <li key={obiettivo}>{obiettivo}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {pdfError && (
              <p role="alert" className={`text-error ${styles.pdfError}`}>
                {pdfError}
              </p>
            )}

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
          </>
        )}
      </div>
    </section>
  );
}
