import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { IconBookOpen, IconFileText, IconLayers, IconPencil } from '../../components/icons.js';
import { CourseRecordCard } from '../../components/CourseRecordCard.js';
import { MarkdownRenderer } from '../../components/MarkdownRenderer.js';
import { ConfirmDialog } from '../../components/ConfirmDialog.js';
import { useAuth } from '../../lib/auth.js';
import { db } from '../../lib/firebase.js';
import { useIsMobile } from '../../lib/useIsMobile.js';
import {
  type StudentLesson,
  type StudentProgram,
} from '../repository/programs/studentLessonsService.js';
import { resolveLessonTitle } from '../repository/programs/lessonTitle.js';
import { readStudentVisualBytes } from '../repository/programs/visualReadClients.js';
import { readStudentVisualBytesMulti } from '../repository/programs/multiVisualReadClients.js';
import { useLessonVisual } from '../repository/programs/useLessonVisual.js';
import { LessonNotesPanel } from './LessonNotesPanel.js';
import { useLessonNotes, type LessonNotesController } from './useLessonNotes.js';
import { useStudentDidattica } from './useStudentDidattica.js';
import styles from './StudentDidatticaView.module.css';

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
  // Auth changes synchronously tear down all course/note state, including timers.
  return user ? <StudentDidatticaSession key={user.uid} uid={user.uid} /> : null;
}

function StudentDidatticaSession({ uid }: { uid: string }) {
  const data = useStudentDidattica(uid, db);
  const context = JSON.stringify([
    uid,
    data.library.status === 'ok' ? data.library.classId : null,
    data.contextVersion,
  ]);
  return <StudentDidatticaContent key={context} uid={uid} data={data} />;
}

function StudentDidatticaContent({
  uid,
  data,
}: {
  uid: string;
  data: ReturnType<typeof useStudentDidattica>;
}) {
  const [selection, setSelection] = useState<Selection>({ kind: 'course' });
  const [expandedUdas, setExpandedUdas] = useState<Set<string>>(new Set());
  const notes = useLessonNotes(db);
  const isMobile = useIsMobile();
  const [pendingNav, setPendingNav] = useState<{ run: () => void } | null>(null);

  function guardNavigation(action: () => void) {
    const openId = notes.openLessonId;
    if (openId && notes.isDirty(openId)) {
      setPendingNav({ run: action });
      return;
    }
    if (openId) notes.close();
    action();
  }

  // Refresh may discover a revoked class/import. Obtain explicit consent
  // before such a refresh can discard a dirty draft.
  function retryRefresh() {
    if (notes.current?.dirty)
      guardNavigation(() => {
        void data.refresh(true);
      });
    else void data.refresh(true);
  }

  // Protects F5/tab-close only while a draft would otherwise be lost silently;
  // no localStorage, no polling — just a listener bound to the dirty window.
  useEffect(() => {
    if (!notes.current?.dirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [notes.current?.dirty]);

  const state = data.library;
  return (
    <>
      {state.status === 'loading' && (
        <p aria-busy="true" className="state-loading">
          Caricamento…
        </p>
      )}
      {state.status === 'error' && (
        <p role="alert" className="text-error">
          Impossibile caricare la didattica.{' '}
          <button
            type="button"
            className="btn btn-secondary"
            disabled={data.refreshing}
            onClick={retryRefresh}
          >
            Riprova
          </button>
        </p>
      )}
      {state.status === 'ok' && data.libraryError && !data.program && (
        <p role="alert" className="text-error">
          Impossibile aggiornare la didattica.{' '}
          <button
            type="button"
            className="btn btn-secondary"
            disabled={data.refreshing}
            onClick={retryRefresh}
          >
            Riprova
          </button>
        </p>
      )}
      {state.status === 'no-class' && (
        <p className="state-empty">
          Nessuna classe assegnata. Chiedi al docente di assegnarti una classe.
        </p>
      )}
      {state.status === 'ok' &&
        (data.program ? (
          data.course.status === 'ok' ? (
            <StudentCourseWorkspace
              program={data.program}
              lessons={data.course.lessons}
              selection={selection}
              expandedUdas={expandedUdas}
              onSelectionChange={(next) => guardNavigation(() => setSelection(next))}
              onExpandedUdasChange={setExpandedUdas}
              onBack={() => guardNavigation(() => data.back())}
              uid={uid}
              notes={notes}
              isMobile={isMobile}
            />
          ) : (
            <section aria-label={`Corso ${data.program.title}`}>
              <button
                type="button"
                className={styles.backBtn}
                onClick={() => guardNavigation(() => data.back())}
              >
                ← Libreria
              </button>
              <h2>{data.program.title}</h2>
              {data.course.status === 'error' ? (
                <p role="alert" className="text-error">
                  Impossibile caricare il corso.{' '}
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={data.refreshing}
                    onClick={retryRefresh}
                  >
                    Riprova
                  </button>
                </p>
              ) : (
                <p aria-busy="true" className="state-loading">
                  Caricamento corso…
                </p>
              )}
            </section>
          )
        ) : (
          <section aria-label="Didattica" className={styles.library}>
            {state.programs.length === 0 ? (
              <p className="state-empty">Nessun corso assegnato alla tua classe.</p>
            ) : (
              <div className={styles.courseList} role="list" aria-label="Corsi disponibili">
                {state.programs.map((program) => (
                  <CourseRecordCard
                    key={program.id}
                    title={program.title}
                    openLabel={`Apri il corso ${program.title}`}
                    onOpen={() => {
                      setSelection({ kind: 'course' });
                      setExpandedUdas(new Set());
                      data.open(program.id);
                    }}
                    metrics={[]}
                    compact
                  />
                ))}
              </div>
            )}
          </section>
        ))}
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

      <div className={styles.workspaceGrid}>
        {!isMobile ? (
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

type StudentLessonTab = 'contenuto' | 'mappa';

const LESSON_VIEW_TABS: { id: StudentLessonTab; label: string }[] = [
  { id: 'contenuto', label: 'Contenuto' },
  { id: 'mappa', label: 'Mappa concettuale' },
];

function LessonContent({
  lesson,
  canOpenNotes,
  notesOpen,
  hasSavedNote,
  noteButtonRef,
  onOpenNotes,
}: {
  lesson: StudentLesson;
  canOpenNotes: boolean;
  notesOpen: boolean;
  hasSavedNote: boolean;
  noteButtonRef: React.RefObject<HTMLButtonElement>;
  onOpenNotes: () => void;
}) {
  const title = resolveLessonTitle(lesson.filename, lesson.titolo).title;

  /**
   * La mappa esiste per lo studente solo se è **nella proiezione**: il
   * normalizzatore autorevole (`readPublicConceptMap`, applicato al confine da
   * `loadStudentCourseLessons`) ha già deciso, e qui non si rilegge nulla.
   */
  const hasConceptMap =
    typeof lesson.conceptMapMarkdown === 'string' && lesson.conceptMapMarkdown.length > 0;

  const [activeTab, setActiveTab] = useState<StudentLessonTab>('contenuto');
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // Cambio lezione: si torna sempre a «Contenuto». La mappa della lezione
  // precedente non deve restare selezionata su una lezione che magari non ne
  // ha nessuna.
  useEffect(() => {
    setActiveTab('contenuto');
  }, [lesson.id]);

  // Stessa navigazione delle schede docente: ←/→ ciclici, Home ed End.
  function onTabKeyDown(e: React.KeyboardEvent) {
    const idx = LESSON_VIEW_TABS.findIndex((t) => t.id === activeTab);
    let next = idx;
    if (e.key === 'ArrowRight') next = (idx + 1) % LESSON_VIEW_TABS.length;
    else if (e.key === 'ArrowLeft')
      next = (idx - 1 + LESSON_VIEW_TABS.length) % LESSON_VIEW_TABS.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = LESSON_VIEW_TABS.length - 1;
    else return;
    e.preventDefault();
    setActiveTab(LESSON_VIEW_TABS[next]!.id);
    tabRefs.current[next]?.focus();
  }

  /**
   * VE-04A — i byte dell'immagine, letti **solo** se il manifest esiste.
   *
   * `lesson.visual` è già normalizzato fail-closed al confine
   * (`readStudentVisualManifest`): assente, malformato o su lezione non svolta
   * vale `null`, e in quel caso non parte alcuna lettura. È la garanzia che
   * rende la funzione gratuita per la stragrande maggioranza delle lezioni.
   */
  const visualRequest = lesson.visual
    ? { assetId: lesson.visual.assetId, lessonKey: lesson.id }
    : null;

  const loadVisual = useCallback(
    async () =>
      lesson.visual
        ? readStudentVisualBytes({ db, publicLessonId: lesson.id, manifest: lesson.visual })
        : null,
    [db, lesson.id, lesson.visual],
  );

  const visualState = useLessonVisual(visualRequest, loadVisual);
  const [multiVisualState, setMultiVisualState] = useState<'idle' | 'loading' | 'ready' | 'error'>(
    'idle',
  );
  const [multiVisualBytes, setMultiVisualBytes] = useState<Record<string, string>>({});
  useEffect(() => {
    let active = true;
    const multiManifest = lesson.visuals ?? [];
    if (multiManifest.length === 0) {
      setMultiVisualBytes({});
      setMultiVisualState('idle');
      return () => {
        active = false;
      };
    }
    setMultiVisualState('loading');
    void readStudentVisualBytesMulti({ db, publicLessonId: lesson.id, manifests: multiManifest })
      .then((entries) => {
        if (!active) return;
        setMultiVisualBytes(
          Object.fromEntries(entries.map((entry) => [entry.assetId, entry.dataUri])),
        );
        setMultiVisualState('ready');
      })
      .catch(() => {
        if (active) setMultiVisualState('error');
      });
    return () => {
      active = false;
    };
  }, [db, lesson.id, lesson.visuals]);

  /**
   * Il manifest basta: posizione e spazio riservato non aspettano i byte, che
   * cambiano solo il contenuto del frame. `idle` non capita quando il manifest
   * c'è — la lettura parte subito — ma è trattato come `loading` perché è
   * comunque uno stato in cui i byte non ci sono ancora.
   */
  const visual = lesson.visual
    ? {
        anchorSlug: lesson.visual.anchor.headingSlug,
        headingText: lesson.visual.anchor.headingText,
        altText: lesson.visual.altText,
        caption: lesson.visual.caption,
        width: lesson.visual.width,
        height: lesson.visual.height,
        dataUri: visualState.status === 'ready' ? visualState.bytes.dataUri : null,
        status:
          visualState.status === 'ready'
            ? ('ready' as const)
            : visualState.status === 'unavailable'
              ? ('unavailable' as const)
              : ('loading' as const),
      }
    : null;
  const visuals = (lesson.visuals ?? []).map((item) => ({
    anchorSlug: item.anchor.headingSlug,
    headingText: item.anchor.headingText,
    altText: item.altText,
    caption: item.caption,
    width: item.width,
    height: item.height,
    dataUri: multiVisualBytes[item.assetId] ?? null,
    status:
      multiVisualState === 'error'
        ? ('unavailable' as const)
        : multiVisualState === 'ready' && multiVisualBytes[item.assetId]
          ? ('ready' as const)
          : ('loading' as const),
  }));

  const body =
    lesson.content === null ? (
      <p role="alert" className="text-error">
        Contenuto temporaneamente non disponibile.
      </p>
    ) : (
      // LESSON-MANUAL-01 — vista lezione studente: stessa variante del docente,
      // quindi resa equivalente fra i due ruoli. Titolo, sottotitolo e metadati
      // restano nella testata esistente, senza duplicazioni.
      //
      // VE-04A: nessun `onMissingAnchor`. Se l'ancora non si risolve lo studente
      // vede semplicemente la figura in fondo — un avviso tecnico su una
      // decisione editoriale del docente non gli riguarda.
      <MarkdownRenderer
        markdown={lesson.content}
        variant="lesson"
        visual={visual}
        visuals={visuals}
      />
    );

  return (
    <article className={styles.lessonContent}>
      <header className={styles.lessonHeader}>
        <div className={styles.lessonHeaderText}>
          <h3>{title}</h3>
          {lesson.sottotitolo && <p>{lesson.sottotitolo}</p>}
        </div>
        <div className={styles.lessonActions}>
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
      {/*
        CONCEPT-MAP-04 — le schede compaiono **solo** quando la proiezione
        pubblica contiene davvero una mappa. Niente scheda disabilitata, niente
        placeholder, niente «non disponibile»: un segnaposto racconterebbe allo
        studente che esiste qualcosa che non può vedere, ed è l'opposto di ciò
        che la roadmap chiede.

        La condizione non è `completed`: è la presenza reale del campo nella
        proiezione, già governata da CONCEPT-MAP-02. Legarla allo stato svolta
        significherebbe fidarsi di un flag dell'interfaccia al posto del confine
        dati. Il controllo è positivo (stringa non vuota) e non `!== null`: un
        documento legacy privo del campo darebbe `undefined !== null`, cioè
        `true`, e manderebbe `undefined` dentro il renderer.
      */}
      {hasConceptMap ? (
        <>
          <div className={styles.lessonTablist} role="tablist" aria-label="Schede lezione">
            {LESSON_VIEW_TABS.map((t, i) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                id={`student-tab-${t.id}`}
                ref={(el) => {
                  tabRefs.current[i] = el;
                }}
                aria-selected={activeTab === t.id}
                aria-controls={`student-panel-${t.id}`}
                tabIndex={activeTab === t.id ? 0 : -1}
                className={`${styles.lessonTab}${activeTab === t.id ? ` ${styles.lessonTabActive}` : ''}`}
                onClick={() => setActiveTab(t.id)}
                onKeyDown={onTabKeyDown}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div
            role="tabpanel"
            id="student-panel-contenuto"
            aria-labelledby="student-tab-contenuto"
            hidden={activeTab !== 'contenuto'}
          >
            {body}
          </div>
          <div
            role="tabpanel"
            id="student-panel-mappa"
            aria-labelledby="student-tab-mappa"
            hidden={activeTab !== 'mappa'}
          >
            <div className={styles.conceptMap}>
              <MarkdownRenderer markdown={lesson.conceptMapMarkdown!} variant="lesson" />
            </div>
          </div>
        </>
      ) : (
        body
      )}
    </article>
  );
}
