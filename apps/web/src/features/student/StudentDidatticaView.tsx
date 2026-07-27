import { useEffect, useMemo, useRef, useState } from 'react';
import {
  IconBookOpen,
  IconCircleCheck,
  IconFileText,
  IconLayers,
  IconPanelLeft,
  IconPencil,
} from '../../components/icons.js';
import { CourseRecordCard } from '../../components/CourseRecordCard.js';
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
      {state.programs.length === 0 ? (
        <p className="state-empty">Nessun corso assegnato alla tua classe.</p>
      ) : (
        <div className={styles.courseList} role="list" aria-label="Corsi disponibili">
          {state.programs.map((program) => {
            const lessons = state.lessonsByProgram[program.id] ?? [];
            const udaCount = new Set(lessons.map((lesson) => lesson.udaDir)).size;
            const completedLessons = lessons.filter((lesson) => lesson.completed).length;
            const completionPercentage =
              lessons.length > 0 ? Math.round((completedLessons / lessons.length) * 100) : 0;
            return (
              <CourseRecordCard
                key={program.id}
                title={program.title}
                openLabel={`Apri il corso ${program.title}`}
                onOpen={() => openCourse(program.id)}
                metrics={[
                  { label: 'UDA', value: udaCount, icon: <IconLayers size={17} /> },
                  { label: 'Lezioni', value: lessons.length, icon: <IconFileText size={17} /> },
                  {
                    label: 'Svolte',
                    value: completedLessons,
                    icon: <IconCircleCheck size={17} />,
                  },
                ]}
                progress={{
                  label: `Avanzamento ${program.title}`,
                  value: completionPercentage,
                  text: `${completedLessons}/${lessons.length} lezioni`,
                }}
                accentProgressOnInteraction
              />
            );
          })}
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
  const [structureHidden, setStructureHidden] = useState(false);

  useEffect(() => {
    setStructureHidden(false);
  }, [program.id]);

  useEffect(() => {
    if (!uid || !program.activeImportId) return;
    notes.loadIndex({
      studentUid: uid,
      programId: program.id,
      importId: program.activeImportId,
    });
  }, [notes.loadIndex, program.activeImportId, program.id, uid]);

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

      <div
        className={`${styles.workspaceGrid}${structureHidden && !isMobile ? ` ${styles.workspaceGridFocus}` : ''}`}
      >
        {isMobile || !structureHidden ? (
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
                              <LessonRowLabel
                                lesson={lesson}
                                hasSavedNote={notes.hasSavedNote(lesson.id)}
                              />
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
        ) : null}

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
                  hasSavedNote={notes.hasSavedNote}
                />
              )}
              {selectedLesson && (
                <LessonContent
                  lesson={selectedLesson}
                  canOpenNotes={uid != null}
                  notesOpen={notes.openLessonId === selectedLesson.id}
                  hasSavedNote={notes.hasSavedNote(selectedLesson.id)}
                  noteButtonRef={noteButtonRef}
                  isMobile={isMobile}
                  structureHidden={structureHidden}
                  onToggleStructure={() => setStructureHidden((current) => !current)}
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
  hasSavedNote,
}: {
  udaDir: string;
  lessons: StudentLesson[];
  onSelect: (lesson: StudentLesson) => void;
  hasSavedNote: (publicLessonId: string) => boolean;
}) {
  return (
    <div>
      <h3 className={styles.sectionTitle}>{udaTitle(udaDir)}</h3>
      <div className={styles.overviewList}>
        {lessons.map((lesson) => (
          <button key={lesson.id} type="button" onClick={() => onSelect(lesson)}>
            <LessonRowLabel lesson={lesson} hasSavedNote={hasSavedNote(lesson.id)} />
            <span aria-hidden="true">›</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function LessonRowLabel({
  lesson,
  hasSavedNote,
}: {
  lesson: StudentLesson;
  hasSavedNote: boolean;
}) {
  return (
    <span className={styles.lessonRowLabel}>
      <span className={styles.lessonIcon} aria-hidden="true">
        <IconFileText size={16} />
      </span>
      <span className={styles.noteIndicatorSlot}>
        {hasSavedNote && (
          <span className={styles.noteIndicator} title="Appunti salvati">
            <IconPencil size={14} />
            <span className={styles.visuallyHidden}>Appunti salvati</span>
          </span>
        )}
      </span>
      <span className={styles.lessonRowTitle}>
        {resolveLessonTitle(lesson.filename, lesson.titolo).title}
      </span>
    </span>
  );
}

function LessonContent({
  lesson,
  canOpenNotes,
  notesOpen,
  hasSavedNote,
  noteButtonRef,
  isMobile,
  structureHidden,
  onToggleStructure,
  onOpenNotes,
}: {
  lesson: StudentLesson;
  canOpenNotes: boolean;
  notesOpen: boolean;
  hasSavedNote: boolean;
  noteButtonRef: React.RefObject<HTMLButtonElement>;
  isMobile: boolean;
  structureHidden: boolean;
  onToggleStructure: () => void;
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
        <div className={styles.lessonActions}>
          {!isMobile && (
            <button
              type="button"
              className={styles.lessonActionBtn}
              aria-pressed={structureHidden}
              aria-label={structureHidden ? 'Mostra struttura' : 'Nascondi struttura'}
              title={structureHidden ? 'Mostra struttura' : 'Nascondi struttura'}
              onClick={onToggleStructure}
            >
              <IconPanelLeft size={15} />
              <span>{structureHidden ? 'Mostra struttura' : 'Nascondi struttura'}</span>
            </button>
          )}
          {canOpenNotes && (
            <button
              type="button"
              ref={noteButtonRef}
              className={`${styles.notesBtn}${hasSavedNote ? ` ${styles.notesBtnSaved}` : ''}`}
              aria-expanded={notesOpen}
              aria-label={hasSavedNote ? 'Appunti, appunti salvati' : 'Appunti'}
              onClick={onOpenNotes}
            >
              {hasSavedNote ? <IconPencil /> : <IconFileText />} Appunti
            </button>
          )}
        </div>
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
