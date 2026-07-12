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
import { useAuth } from '../../lib/auth.js';
import { db } from '../../lib/firebase.js';
import { IconChevronLeft, IconChevronRight } from '../../components/icons.js';
import { QuestionPoolEditor, type PoolCountStatus } from './QuestionPoolEditor.js';
import styles from './DomandeView.module.css';

// ── Shared state types ─────────────────────────────────────────────────────────

type CourseTreeState = {
  udas: UdaItem[] | null;
  lessons: LessonItem[] | null;
  error?: string;
};

// ── Sub-components ─────────────────────────────────────────────────────────────

function PoolStatusBadge({ lesson }: { lesson: LessonItem }) {
  if (lesson.poolStatus === 'valid') {
    return (
      <span className={styles.badgeValid} title={`${lesson.questionCount ?? 0} domande`}>
        ●
      </span>
    );
  }
  if (lesson.poolStatus === 'invalid') {
    return (
      <span className={styles.badgeInvalid} title="Pool non valido">
        ⚠
      </span>
    );
  }
  return (
    <span className={styles.badgeAbsent} title="Nessun pool">
      ○
    </span>
  );
}

// ── Main view ──────────────────────────────────────────────────────────────────

export function DomandeView() {
  const { user } = useAuth();
  const ownerUid = user?.uid ?? '';

  const [programs, setPrograms] = useState<ProgramItem[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const [courseTree, setCourseTree] = useState<Record<string, CourseTreeState>>({});
  const [expandedCourses, setExpandedCourses] = useState<Set<string>>(new Set());
  const [expandedUdas, setExpandedUdas] = useState<Set<string>>(new Set());

  const [selectedProgram, setSelectedProgram] = useState<ProgramItem | null>(null);
  const [selectedLesson, setSelectedLesson] = useState<LessonItem | null>(null);

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

  function handleSelectLesson(program: ProgramItem, lesson: LessonItem) {
    setSelectedProgram(program);
    setSelectedLesson(lesson);
  }

  /** Keeps the sidebar badge and the selected lesson in sync after a pool edit. */
  function handlePoolCountChange(
    program: ProgramItem,
    lessonId: string,
    questionCount: number,
    poolStatus: PoolCountStatus,
  ) {
    setSelectedLesson((prev) =>
      prev && prev.id === lessonId ? { ...prev, poolStatus, questionCount } : prev,
    );
    setCourseTree((prev) => {
      const cur = prev[program.id];
      if (!cur?.lessons) return prev;
      return {
        ...prev,
        [program.id]: {
          ...cur,
          lessons: cur.lessons.map((l) =>
            l.id === lessonId ? { ...l, poolStatus, questionCount } : l,
          ),
        },
      };
    });
  }

  const lessonTitle = selectedLesson
    ? resolveLessonTitle(selectedLesson.filename, selectedLesson.titolo)
    : null;

  return (
    <div className={`${styles.container} ${sidebarCollapsed ? styles.containerCollapsed : ''}`}>
      {/* ── Sidebar ── */}
      <aside
        className={`${styles.sidebar} ${sidebarCollapsed ? styles.sidebarCollapsed : ''}`}
        aria-label="Navigazione lezioni"
      >
        {sidebarCollapsed ? (
          <button
            type="button"
            className={styles.iconBtn}
            title="Espandi barra laterale"
            aria-label="Espandi barra laterale"
            onClick={() => setSidebarCollapsed(false)}
          >
            <IconChevronRight size={14} />
          </button>
        ) : (
          <>
            <div className={styles.sidebarHeader}>
              <h2 className={styles.sidebarTitle}>Domande</h2>
              <button
                type="button"
                className={styles.iconBtn}
                title="Comprimi barra laterale"
                aria-label="Comprimi barra laterale"
                onClick={() => setSidebarCollapsed(true)}
              >
                <IconChevronLeft size={14} />
              </button>
            </div>

            {loadError && <p className={styles.errorMsg}>{loadError}</p>}

            {programs === null && !loadError && <p className={styles.mutedMsg}>Caricamento…</p>}

            {programs !== null && programs.length === 0 && (
              <p className={styles.mutedMsg}>Nessun corso trovato.</p>
            )}

            {programs !== null && programs.length > 0 && (
              <ul className={styles.courseList} role="tree">
                {programs.map((program) => {
                  const isExpanded = expandedCourses.has(program.id);
                  const tree = courseTree[program.id];
                  return (
                    <li key={program.id} className={styles.courseItem} role="treeitem">
                      <button
                        type="button"
                        className={styles.courseToggle}
                        aria-expanded={isExpanded}
                        onClick={() => toggleCourse(program)}
                      >
                        <span className={`${styles.caret} ${isExpanded ? styles.caretOpen : ''}`}>
                          ▶
                        </span>
                        <span className={styles.courseTitle}>{program.title}</span>
                      </button>

                      {isExpanded && (
                        <div className={styles.udaPanel}>
                          {!program.activeImportId && (
                            <p className={styles.mutedMsg}>Nessun import attivo.</p>
                          )}
                          {program.activeImportId && !tree && (
                            <p className={styles.mutedMsg}>Caricamento…</p>
                          )}
                          {tree?.error && <p className={styles.errorMsg}>{tree.error}</p>}
                          {tree && !tree.error && tree.udas !== null && (
                            <ul className={styles.udaList}>
                              {tree.udas.map((uda) => {
                                const udaKey = `${program.id}:${uda.dir}`;
                                const isUdaExpanded = expandedUdas.has(udaKey);
                                const udaLessons = (tree.lessons ?? []).filter(
                                  (l) => l.udaDir === uda.dir,
                                );
                                return (
                                  <li key={uda.id} className={styles.udaItem}>
                                    <button
                                      type="button"
                                      className={styles.udaToggle}
                                      aria-expanded={isUdaExpanded}
                                      onClick={() => toggleUda(program.id, uda.dir)}
                                    >
                                      <span
                                        className={`${styles.caret} ${isUdaExpanded ? styles.caretOpen : ''}`}
                                      >
                                        ▶
                                      </span>
                                      <span className={styles.udaTitle}>{uda.dir}</span>
                                    </button>

                                    {isUdaExpanded && (
                                      <ul className={styles.lessonList}>
                                        {udaLessons.map((lesson) => {
                                          const { title } = resolveLessonTitle(
                                            lesson.filename,
                                            lesson.titolo,
                                          );
                                          const isSelected =
                                            selectedLesson?.id === lesson.id &&
                                            selectedProgram?.id === program.id;
                                          return (
                                            <li key={lesson.id} className={styles.lessonRow}>
                                              <button
                                                type="button"
                                                className={styles.lessonBtn}
                                                aria-pressed={isSelected}
                                                onClick={() => handleSelectLesson(program, lesson)}
                                              >
                                                <PoolStatusBadge lesson={lesson} />
                                                <span className={styles.lessonTitle}>{title}</span>
                                              </button>
                                            </li>
                                          );
                                        })}
                                        {udaLessons.length === 0 && (
                                          <li>
                                            <p className={styles.mutedMsg}>Nessuna lezione.</p>
                                          </li>
                                        )}
                                      </ul>
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
          </>
        )}
      </aside>

      {/* ── Content panel ── */}
      <section className={styles.content} aria-label="Contenuto pool domande">
        {!selectedLesson || !selectedProgram ? (
          <div className={styles.emptyState}>
            <p>Seleziona una lezione dalla barra laterale per visualizzare il pool di domande.</p>
          </div>
        ) : (
          <>
            <div className={styles.contentHeader}>
              <div className={styles.titleBlock}>
                <h2 className={styles.contentTitle}>
                  {lessonTitle?.number ? `${lessonTitle.number}. ` : ''}
                  {lessonTitle?.title}
                </h2>
                <p className={styles.contentSubtitle}>{selectedProgram.title}</p>
              </div>
            </div>

            <QuestionPoolEditor
              key={`${selectedProgram.id}:${selectedLesson.id}`}
              programId={selectedProgram.id}
              importId={selectedProgram.activeImportId}
              lesson={selectedLesson}
              ownerUid={ownerUid}
              onPoolCountChange={(count, status) =>
                handlePoolCountChange(selectedProgram, selectedLesson.id, count, status)
              }
            />
          </>
        )}
      </section>
    </div>
  );
}
