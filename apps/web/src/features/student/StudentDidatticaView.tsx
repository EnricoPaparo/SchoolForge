import { useEffect, useMemo, useRef, useState } from 'react';
import { IconBookOpen, IconFileText, IconLayers, IconSearch } from '../../components/icons.js';
import { MarkdownRenderer } from '../../components/MarkdownRenderer.js';
import { ConfirmDialog } from '../../components/ConfirmDialog.js';
import { useAuth } from '../../lib/auth.js';
import { db } from '../../lib/firebase.js';
import { useIsMobile } from '../../lib/useIsMobile.js';
import {
  loadStudentLessons,
  type StudentLesson,
  type StudentProgram,
} from '../repository/programs/studentLessonsService.js';
import { resolveLessonTitle } from '../repository/programs/lessonTitle.js';
import { LessonNotesPanel } from './LessonNotesPanel.js';
import { useLessonNotes, type LessonNotesController } from './useLessonNotes.js';
import styles from './StudentDidatticaView.module.css';

type LoadState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'no-class' }
  | { status: 'ok'; programs: StudentProgram[]; lessonsByProgram: Record<string, StudentLesson[]> };

type Selection =
  | { kind: 'course' }
  | { kind: 'uda'; udaDir: string }
  | { kind: 'lesson'; lessonId: string };

function udaTitle(udaDir: string): string {
  const readable = udaDir
    .replace(/^uda-\d+(?:-|$)/i, '')
    .replace(/[-_]+/g, ' ')
    .trim();
  if (!readable) return udaDir;
  return readable.charAt(0).toUpperCase() + readable.slice(1);
}

function lessonsByUda(lessons: StudentLesson[]): Map<string, StudentLesson[]> {
  const result = new Map<string, StudentLesson[]>();
  for (const lesson of lessons) {
    const list = result.get(lesson.udaDir) ?? [];
    list.push(lesson);
    result.set(lesson.udaDir, list);
  }
  return result;
}

/**
 * SDUX-01 — student-only Didattica. It deliberately depends only on the
 * public student read model and shared presentational code. No teacher
 * component, mutation service, repository import path, pool or Storage API
 * is imported here; Security Rules independently enforce the same boundary.
 */
export function StudentDidatticaView() {
  const { user } = useAuth();
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [search, setSearch] = useState('');
  const [openProgramId, setOpenProgramId] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection>({ kind: 'course' });
  const [expandedUdas, setExpandedUdas] = useState<Set<string>>(new Set());
  const notes = useLessonNotes(db);
  const isMobile = useIsMobile();
  const [pendingNav, setPendingNav] = useState<{ run: () => void } | null>(null);

  const uid = user?.uid;

  /**
   * Dirty guard for every navigation controlled by this view (lesson/UDA/
   * course change, back to library). When the open note has unsaved changes,
   * defer the navigation behind a confirmation; when clean, close the panel
   * and proceed immediately. External navigation (StudentShell section switch,
   * sign-out, Modalità verifica) is handled by unmounting the whole view — see
   * the residual-limit note in the PR/docs.
   */
  function guardNavigation(action: () => void) {
    const openId = notes.openLessonId;
    if (openId && notes.isDirty(openId)) {
      setPendingNav({ run: action });
      return;
    }
    if (openId) notes.close();
    action();
  }
  useEffect(() => {
    if (!uid) return;
    let cancelled = false;
    setState({ status: 'loading' });
    loadStudentLessons(uid, db)
      .then((result) => {
        if (cancelled) return;
        setState(result);
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'error' });
      });
    return () => {
      cancelled = true;
    };
  }, [uid]);

  const filteredPrograms = useMemo(() => {
    if (state.status !== 'ok') return [];
    const query = search.trim().toLocaleLowerCase('it');
    if (!query) return state.programs;
    return state.programs.filter((program) =>
      program.title.toLocaleLowerCase('it').includes(query),
    );
  }, [search, state]);

  if (state.status === 'loading')
    return (
      <p aria-busy="true" className="state-loading">
        Caricamento…
      </p>
    );
  if (state.status === 'error')
    return (
      <p role="alert" className="text-error">
        Impossibile caricare la didattica.
      </p>
    );
  if (state.status === 'no-class') {
    return (
      <p className="state-empty">
        Nessuna classe assegnata. Chiedi al docente di assegnarti una classe.
      </p>
    );
  }

  const openProgram = state.programs.find((program) => program.id === openProgramId) ?? null;
  const openLessons = openProgram ? (state.lessonsByProgram[openProgram.id] ?? []) : [];

  function openCourse(programId: string) {
    setOpenProgramId(programId);
    setSelection({ kind: 'course' });
    setExpandedUdas(new Set());
  }

  function backToLibrary() {
    setOpenProgramId(null);
    setSelection({ kind: 'course' });
    setExpandedUdas(new Set());
  }

  if (openProgram) {
    return (
      <>
        <StudentCourseWorkspace
          program={openProgram}
          lessons={openLessons}
          selection={selection}
          expandedUdas={expandedUdas}
          onSelectionChange={(next) => guardNavigation(() => setSelection(next))}
          onExpandedUdasChange={setExpandedUdas}
          onBack={() => guardNavigation(backToLibrary)}
          uid={uid ?? null}
          notes={notes}
          isMobile={isMobile}
        />
        {pendingNav && (
          <ConfirmDialog
            title="Modifiche non salvate"
            message="Ci sono modifiche non salvate agli appunti. Se continui le perdi."
            confirmLabel="Esci senza salvare"
            cancelLabel="Resta e continua"
            danger
            busy={notes.current?.saveState === 'saving'}
            onCancel={() => setPendingNav(null)}
            onConfirm={() => {
              if (!notes.discardAndClose()) return;
              pendingNav.run();
              setPendingNav(null);
            }}
          />
        )}
      </>
    );
  }

  return (
    <section aria-label="Didattica" className={styles.library}>
      <div className={styles.toolbar}>
        <div className={styles.searchWrap}>
          <span className={styles.searchIcon} aria-hidden="true">
            <IconSearch />
          </span>
          <label className={styles.visuallyHidden} htmlFor="student-course-search">
            Cerca corso
          </label>
          <input
            id="student-course-search"
            type="search"
            className={styles.search}
            placeholder="Cerca…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
      </div>

      {state.programs.length === 0 ? (
        <p className="state-empty">Nessun corso assegnato alla tua classe.</p>
      ) : filteredPrograms.length === 0 ? (
        <div className={styles.emptyState}>
          <p className={styles.emptyTitle}>Nessun corso trovato</p>
          <button type="button" onClick={() => setSearch('')}>
            Azzera ricerca
          </button>
        </div>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table} aria-label="Corsi disponibili">
            <colgroup>
              <col className={styles.titleColumn} />
              <col className={styles.udaColumn} />
              <col className={styles.lessonsColumn} />
              <col className={styles.actionsColumn} />
            </colgroup>
            <thead>
              <tr>
                <th scope="col">Titolo</th>
                <th scope="col">UDA</th>
                <th scope="col">Lezioni</th>
                <th scope="col">Azioni</th>
              </tr>
            </thead>
            <tbody>
              {filteredPrograms.map((program) => {
                const lessons = state.lessonsByProgram[program.id] ?? [];
                const udaCount = new Set(lessons.map((lesson) => lesson.udaDir)).size;
                return (
                  <tr key={program.id} className={styles.courseRow}>
                    <td className={styles.titleCell} title={program.title}>
                      <button
                        type="button"
                        className={styles.courseTitle}
                        onClick={() => openCourse(program.id)}
                      >
                        {program.title}
                      </button>
                    </td>
                    <td className={styles.numericCell}>{udaCount}</td>
                    <td className={styles.numericCell}>{lessons.length}</td>
                    <td className={styles.actionsCell}>
                      <button
                        type="button"
                        className={styles.openButton}
                        title="Apri corso"
                        aria-label={`Apri corso ${program.title}`}
                        onClick={() => openCourse(program.id)}
                      >
                        <span aria-hidden="true">📂</span>
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function StudentCourseWorkspace({
  program,
  lessons,
  selection,
  expandedUdas,
  onSelectionChange,
  onExpandedUdasChange,
  onBack,
  uid,
  notes,
  isMobile,
}: {
  program: StudentProgram;
  lessons: StudentLesson[];
  selection: Selection;
  expandedUdas: Set<string>;
  onSelectionChange: (selection: Selection) => void;
  onExpandedUdasChange: (next: Set<string>) => void;
  onBack: () => void;
  uid: string | null;
  notes: LessonNotesController;
  isMobile: boolean;
}) {
  const grouped = useMemo(() => lessonsByUda(lessons), [lessons]);
  const noteButtonRef = useRef<HTMLButtonElement>(null);
  const prevOpenRef = useRef<string | null>(null);

  // Desktop focus return: when the panel closes, focus goes back to the
  // exact "Appunti" button that opened it.
  useEffect(() => {
    if (prevOpenRef.current && notes.openLessonId === null) {
      noteButtonRef.current?.focus();
    }
    prevOpenRef.current = notes.openLessonId;
  }, [notes.openLessonId]);
  const udaDirs = [...grouped.keys()];
  const selectedLesson =
    selection.kind === 'lesson'
      ? (lessons.find((lesson) => lesson.id === selection.lessonId) ?? null)
      : null;
  const selectedUda =
    selection.kind === 'uda' ? selection.udaDir : (selectedLesson?.udaDir ?? null);
  const completedLessons = lessons.filter((lesson) => lesson.completed).length;
  const completionPercentage =
    lessons.length > 0 ? Math.round((completedLessons / lessons.length) * 100) : 0;

  function selectUda(udaDir: string) {
    onSelectionChange({ kind: 'uda', udaDir });
    onExpandedUdasChange(new Set([...expandedUdas, udaDir]));
  }

  function selectLesson(lesson: StudentLesson) {
    onSelectionChange({ kind: 'lesson', lessonId: lesson.id });
    onExpandedUdasChange(new Set([...expandedUdas, lesson.udaDir]));
  }

  function restoreLessonScroll(publicLessonId: string) {
    if (!isMobile) return;
    const scrollTop = notes.getRememberedScroll(publicLessonId);
    requestAnimationFrame(() => window.scrollTo({ top: scrollTop, behavior: 'auto' }));
  }

  return (
    <section aria-label={`Corso ${program.title}`} className={styles.workspace}>
      <header className={styles.workspaceHeader}>
        <button type="button" className={styles.backBtn} onClick={onBack}>
          ← Libreria
        </button>
        <div className={styles.courseHeading}>
          <h2>{program.title}</h2>
          <p>
            {udaDirs.length} UDA · {completedLessons}/{lessons.length} lezioni svolte
          </p>
          <div
            className={styles.progressTrack}
            role="progressbar"
            aria-label="Avanzamento lezioni"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={completionPercentage}
          >
            <div className={styles.progressFill} style={{ width: `${completionPercentage}%` }} />
          </div>
        </div>
      </header>

      <div className={styles.workspaceGrid}>
        <aside className={styles.sidebar} aria-label="Struttura del corso">
          <button
            type="button"
            className={styles.overviewBtn}
            aria-current={selection.kind === 'course' ? 'page' : undefined}
            onClick={() => onSelectionChange({ kind: 'course' })}
          >
            <IconBookOpen /> Panoramica corso
          </button>
          <ul className={styles.tree}>
            {udaDirs.map((udaDir) => {
              const expanded = expandedUdas.has(udaDir);
              const udaLessons = grouped.get(udaDir) ?? [];
              return (
                <li key={udaDir}>
                  <button
                    type="button"
                    className={styles.udaTreeBtn}
                    aria-expanded={expanded}
                    onClick={() => {
                      const next = new Set(expandedUdas);
                      if (expanded) next.delete(udaDir);
                      else next.add(udaDir);
                      onExpandedUdasChange(next);
                      onSelectionChange({ kind: 'uda', udaDir });
                    }}
                  >
                    <span aria-hidden="true">{expanded ? '▾' : '▸'}</span>
                    <IconLayers />
                    <span>{udaTitle(udaDir)}</span>
                  </button>
                  {expanded && (
                    <ul className={styles.lessonTree}>
                      {udaLessons.map((lesson) => (
                        <li key={lesson.id}>
                          <button
                            type="button"
                            className={styles.lessonTreeBtn}
                            aria-current={selectedLesson?.id === lesson.id ? 'page' : undefined}
                            onClick={() => selectLesson(lesson)}
                          >
                            <IconFileText />
                            <span>{resolveLessonTitle(lesson.filename, lesson.titolo).title}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </aside>

        <main className={styles.courseContent}>
          {isMobile && notes.current ? (
            <LessonNotesPanel controller={notes} isMobile onClosed={restoreLessonScroll} />
          ) : (
            <>
              {selection.kind !== 'course' && (
                <button
                  type="button"
                  className={styles.mobileBack}
                  onClick={() =>
                    onSelectionChange(
                      selection.kind === 'lesson' && selectedUda
                        ? { kind: 'uda', udaDir: selectedUda }
                        : { kind: 'course' },
                    )
                  }
                >
                  {selection.kind === 'lesson' ? '← UDA' : '← Corso'}
                </button>
              )}
              {selection.kind === 'course' && (
                <CourseOverview udaDirs={udaDirs} grouped={grouped} onSelect={selectUda} />
              )}
              {selection.kind === 'uda' && selectedUda && (
                <UdaOverview
                  udaDir={selectedUda}
                  lessons={grouped.get(selectedUda) ?? []}
                  onSelect={selectLesson}
                />
              )}
              {selectedLesson && (
                <LessonContent
                  lesson={selectedLesson}
                  canOpenNotes={uid != null}
                  notesOpen={notes.openLessonId === selectedLesson.id}
                  noteButtonRef={noteButtonRef}
                  onOpenNotes={() => {
                    if (uid == null) return;
                    const scrollTop = window.scrollY;
                    notes.open({
                      studentUid: uid,
                      publicLessonId: selectedLesson.id,
                      programId: selectedLesson.programId,
                      importId: selectedLesson.importId,
                    });
                    if (isMobile) notes.rememberScroll(selectedLesson.id, scrollTop);
                  }}
                />
              )}
            </>
          )}
        </main>
      </div>
      {!isMobile && <LessonNotesPanel controller={notes} isMobile={false} />}
    </section>
  );
}

function CourseOverview({
  udaDirs,
  grouped,
  onSelect,
}: {
  udaDirs: string[];
  grouped: Map<string, StudentLesson[]>;
  onSelect: (udaDir: string) => void;
}) {
  if (udaDirs.length === 0) return <p className="state-empty">Nessuna lezione disponibile.</p>;
  return (
    <div className={styles.overviewList}>
      {udaDirs.map((udaDir) => (
        <button key={udaDir} type="button" onClick={() => onSelect(udaDir)}>
          <span>
            <IconLayers /> {udaTitle(udaDir)}
          </span>
          <small>{(grouped.get(udaDir) ?? []).length} lezioni</small>
          <span aria-hidden="true">›</span>
        </button>
      ))}
    </div>
  );
}

function UdaOverview({
  udaDir,
  lessons,
  onSelect,
}: {
  udaDir: string;
  lessons: StudentLesson[];
  onSelect: (lesson: StudentLesson) => void;
}) {
  return (
    <div>
      <h3 className={styles.sectionTitle}>{udaTitle(udaDir)}</h3>
      <div className={styles.overviewList}>
        {lessons.map((lesson) => (
          <button key={lesson.id} type="button" onClick={() => onSelect(lesson)}>
            <span>
              <IconFileText /> {resolveLessonTitle(lesson.filename, lesson.titolo).title}
            </span>
            <span aria-hidden="true">›</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function LessonContent({
  lesson,
  canOpenNotes,
  notesOpen,
  noteButtonRef,
  onOpenNotes,
}: {
  lesson: StudentLesson;
  canOpenNotes: boolean;
  notesOpen: boolean;
  noteButtonRef: React.RefObject<HTMLButtonElement>;
  onOpenNotes: () => void;
}) {
  const title = resolveLessonTitle(lesson.filename, lesson.titolo).title;
  return (
    <article className={styles.lessonContent}>
      <header className={styles.lessonHeader}>
        <div className={styles.lessonHeaderText}>
          <h3>{title}</h3>
          {lesson.sottotitolo && <p>{lesson.sottotitolo}</p>}
        </div>
        {canOpenNotes && (
          <button
            type="button"
            ref={noteButtonRef}
            className={styles.notesBtn}
            aria-expanded={notesOpen}
            onClick={onOpenNotes}
          >
            <IconFileText /> Appunti
          </button>
        )}
      </header>
      {(lesson.difficolta ||
        (lesson.concettiChiave?.length ?? 0) > 0 ||
        (lesson.obiettivi?.length ?? 0) > 0) && (
        <div className={styles.lessonMeta}>
          {lesson.difficolta && <span className={styles.pill}>{lesson.difficolta}</span>}
          {(lesson.concettiChiave?.length ?? 0) > 0 && (
            <p>
              <strong>Concetti chiave:</strong> {lesson.concettiChiave?.join(', ')}
            </p>
          )}
          {(lesson.obiettivi?.length ?? 0) > 0 && (
            <div>
              <strong>Obiettivi</strong>
              <ul>
                {lesson.obiettivi?.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
      {lesson.content === null ? (
        <p role="alert" className="text-error">
          Contenuto temporaneamente non disponibile.
        </p>
      ) : (
        <MarkdownRenderer markdown={lesson.content} />
      )}
    </article>
  );
}
