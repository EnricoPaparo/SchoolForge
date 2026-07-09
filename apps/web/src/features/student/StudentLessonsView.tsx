import { useEffect, useState } from 'react';
import { useAuth } from '../../lib/auth.js';
import { db, storage } from '../../lib/firebase.js';
import {
  loadStudentLessons,
  type StudentLesson,
  type StudentProgram,
} from '../repository/programs/studentLessonsService.js';
import { resolveLessonTitle } from '../repository/programs/lessonTitle.js';
import {
  EMPTY_LESSON_METADATA,
  parseLessonMetadata,
} from '../repository/validation/lessonMetadata.js';
import type { LessonMetadata } from '../repository/validation/types.js';
import { fetchLessonContent } from '../teacher/lessonContent.js';
import { MarkdownRenderer } from '../teacher/MarkdownRenderer.js';
import styles from './StudentLessonsView.module.css';

type LoadState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'no-class' }
  | { status: 'ok'; programs: StudentProgram[]; lessonsByProgram: Record<string, StudentLesson[]> };

/**
 * Read-only Lezioni section for the student portal (M3L-C). Reads only
 * publicLessons + the top-level program fields already needed for the UI
 * (title) — never a program's imports/** subcollection (technical lessons,
 * questionIndex, pool). No docente actions, no import/export, no PDF.
 */
export function StudentLessonsView() {
  const { user } = useAuth();
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [expandedPrograms, setExpandedPrograms] = useState<Set<string>>(new Set());
  const [expandedUdas, setExpandedUdas] = useState<Set<string>>(new Set());
  const [selectedLesson, setSelectedLesson] = useState<StudentLesson | null>(null);
  const [lessonContent, setLessonContent] = useState<string | null>(null);
  const [lessonMetadata, setLessonMetadata] = useState<LessonMetadata>(EMPTY_LESSON_METADATA);
  const [lessonContentLoading, setLessonContentLoading] = useState(false);
  const [lessonContentError, setLessonContentError] = useState<string | null>(null);

  const uid = user?.uid;
  useEffect(() => {
    if (!uid) return;
    void load(uid);
  }, [uid]);

  async function load(uid: string) {
    setState({ status: 'loading' });
    try {
      const result = await loadStudentLessons(uid, db);
      if (result.status === 'no-class') {
        setState({ status: 'no-class' });
      } else {
        setState({
          status: 'ok',
          programs: result.programs,
          lessonsByProgram: result.lessonsByProgram,
        });
      }
    } catch {
      setState({ status: 'error' });
    }
  }

  function toggleProgram(programId: string) {
    setExpandedPrograms((prev) => {
      const next = new Set(prev);
      if (next.has(programId)) next.delete(programId);
      else next.add(programId);
      return next;
    });
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

  async function selectLesson(lesson: StudentLesson) {
    setSelectedLesson(lesson);
    setLessonContent(null);
    setLessonMetadata(EMPTY_LESSON_METADATA);
    setLessonContentError(null);
    setLessonContentLoading(true);
    try {
      const raw = await fetchLessonContent(lesson.contentPath, storage);
      const { metadata, body } = parseLessonMetadata(raw);
      setLessonMetadata(metadata);
      setLessonContent(body);
    } catch {
      setLessonContentError('Impossibile caricare il contenuto della lezione.');
    } finally {
      setLessonContentLoading(false);
    }
  }

  if (state.status === 'loading') {
    return (
      <p aria-busy="true" className="state-loading">
        Caricamento…
      </p>
    );
  }

  if (state.status === 'error') {
    return (
      <p role="alert" className="text-error">
        Impossibile caricare le lezioni.
      </p>
    );
  }

  if (state.status === 'no-class') {
    return (
      <section aria-label="Lezioni" className={styles.container}>
        <p className="state-empty">
          Nessuna classe assegnata. Chiedi al tuo docente di assegnarti una classe per vedere le
          lezioni.
        </p>
      </section>
    );
  }

  const { programs, lessonsByProgram } = state;

  if (programs.length === 0) {
    return (
      <section aria-label="Lezioni" className={styles.container}>
        <p className="state-empty">Nessun programma assegnato alla tua classe.</p>
      </section>
    );
  }

  return (
    <section aria-label="Lezioni" className={styles.container}>
      <aside className={styles.sidebar}>
        <h2 className={styles.sidebarTitle}>Lezioni</h2>

        <ul className={styles.programList}>
          {programs.map((program) => {
            const lessons = lessonsByProgram[program.id] ?? [];
            const expanded = expandedPrograms.has(program.id);
            const udaDirs = [...new Set(lessons.map((l) => l.udaDir))];

            return (
              <li key={program.id} className={styles.programItem}>
                <button
                  type="button"
                  className={styles.programToggle}
                  aria-expanded={expanded}
                  aria-controls={`student-lezioni-program-panel-${program.id}`}
                  onClick={() => toggleProgram(program.id)}
                >
                  <span
                    className={`${styles.caret}${expanded ? ` ${styles.caretOpen}` : ''}`}
                    aria-hidden="true"
                  >
                    ▶
                  </span>
                  <span className={styles.programTitle}>{program.title}</span>
                </button>

                {expanded && (
                  <div
                    id={`student-lezioni-program-panel-${program.id}`}
                    className={styles.udaPanel}
                  >
                    {lessons.length === 0 ? (
                      <p className="state-empty">Nessuna lezione disponibile.</p>
                    ) : (
                      <ul className={styles.udaList}>
                        {udaDirs.map((udaDir) => {
                          const udaKey = `${program.id}:${udaDir}`;
                          const udaExpanded = expandedUdas.has(udaKey);
                          const udaLessons = lessons.filter((l) => l.udaDir === udaDir);

                          return (
                            <li key={udaDir}>
                              <button
                                type="button"
                                className={styles.udaToggle}
                                aria-expanded={udaExpanded}
                                aria-controls={`student-lezioni-uda-panel-${udaKey}`}
                                onClick={() => toggleUda(program.id, udaDir)}
                              >
                                <span
                                  className={`${styles.caret}${udaExpanded ? ` ${styles.caretOpen}` : ''}`}
                                  aria-hidden="true"
                                >
                                  ▶
                                </span>
                                <span className={styles.udaDir}>{udaDir}</span>
                              </button>

                              {udaExpanded && (
                                <div
                                  id={`student-lezioni-uda-panel-${udaKey}`}
                                  className={styles.lessonPanel}
                                >
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
                                            onClick={() => void selectLesson(lesson)}
                                          >
                                            {title}
                                          </button>
                                        </li>
                                      );
                                    })}
                                  </ul>
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
          <p className={styles.noLessonHint}>Seleziona una lezione dalla lista.</p>
        ) : (
          <>
            <div className={styles.contentHeaderBlock}>
              <h3 className={styles.contentTitle}>
                {resolveLessonTitle(selectedLesson.filename, lessonMetadata.titolo).title}
              </h3>
              {lessonMetadata.sottotitolo && (
                <p className={styles.contentSubtitle}>{lessonMetadata.sottotitolo}</p>
              )}
            </div>

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
