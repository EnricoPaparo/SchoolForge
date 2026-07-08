import { useEffect, useState } from 'react';
import {
  listLessons,
  listPrograms,
  listUdas,
  type LessonItem,
  type ProgramItem,
  type UdaItem,
} from '../repository/programs/programsService.js';
import { db, storage } from '../../lib/firebase.js';
import { fetchLessonContent } from './lessonContent.js';
import { downloadLessonPdf } from './lessonPdf.js';
import { MarkdownRenderer } from './MarkdownRenderer.js';
import styles from './LessonsView.module.css';

const IMPORT_HINT = 'Importa prima uno ZIP da Corsi per vedere le lezioni.';

type CourseTreeState = {
  udas: UdaItem[] | null;
  lessons: LessonItem[] | null;
  error?: string;
};

export function LessonsView() {
  const [programs, setPrograms] = useState<ProgramItem[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [courseTree, setCourseTree] = useState<Record<string, CourseTreeState>>({});
  const [expandedCourses, setExpandedCourses] = useState<Set<string>>(new Set());
  const [expandedUdas, setExpandedUdas] = useState<Set<string>>(new Set());

  const [selectedLesson, setSelectedLesson] = useState<LessonItem | null>(null);
  const [lessonContent, setLessonContent] = useState<string | null>(null);
  const [lessonContentLoading, setLessonContentLoading] = useState(false);
  const [lessonContentError, setLessonContentError] = useState<string | null>(null);
  const [pdfDownloading, setPdfDownloading] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);

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

  async function selectLesson(lesson: LessonItem) {
    setSelectedLesson(lesson);
    setLessonContent(null);
    setLessonContentError(null);
    setPdfError(null);
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

  async function handleDownloadLessonPdf() {
    if (!selectedLesson || lessonContent == null) return;
    setPdfError(null);
    setPdfDownloading(true);
    try {
      await downloadLessonPdf(selectedLesson.filename, lessonContent, selectedLesson.udaDir);
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
                                      {udaLessons.map((lesson) => (
                                        <li key={lesson.id}>
                                          <button
                                            type="button"
                                            className={styles.lessonBtn}
                                            aria-pressed={selectedLesson?.id === lesson.id}
                                            aria-label={`Apri lezione ${lesson.filename}`}
                                            onClick={() => void selectLesson(lesson)}
                                          >
                                            {lesson.filename}
                                          </button>
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
      </aside>

      <div className={styles.content}>
        {selectedLesson === null ? (
          <p className="state-empty">
            Seleziona una lezione dalla lista per leggerne il contenuto.
          </p>
        ) : (
          <>
            <div className={styles.contentHeader}>
              <h3 className={styles.contentTitle}>{selectedLesson.filename}</h3>
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
