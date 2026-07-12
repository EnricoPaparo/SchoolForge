import {
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { db, storage } from '../../lib/firebase.js';
import type { CourseCard } from '../repository/programs/courseLibrary.js';
import {
  listLessons,
  listUdas,
  type LessonItem,
  type UdaItem,
} from '../repository/programs/programsService.js';
import { resolveLessonTitle } from '../repository/programs/lessonTitle.js';
import {
  EMPTY_LESSON_METADATA,
  parseLessonMetadata,
} from '../repository/validation/lessonMetadata.js';
import type { LessonMetadata } from '../repository/validation/types.js';
import { fetchLessonContent } from './lessonContent.js';
import { MarkdownRenderer } from './MarkdownRenderer.js';
import { QuestionPoolEditor, type PoolCountStatus } from './QuestionPoolEditor.js';
import styles from './CourseWorkspace.module.css';

type CourseWorkspaceProps = {
  /**
   * The library card for the course being opened. The summary strip reuses
   * the counters DUX-01 already computed (anno, classi, UDA, lezioni,
   * domande) so the workspace never recomputes them; `activeImportId` lets
   * it load this one course's tree without re-reading the program list.
   */
  card: CourseCard;
  ownerUid: string;
  onBack: () => void;
  /**
   * Called when a pool edit changes the course's total question count, so the
   * library card counter can be updated in place without re-reading the whole
   * library (DUX-03 item 8).
   */
  onProgramQuestionsChange?: (programId: string, questionsTotal: number) => void;
};

type Tree = { udas: UdaItem[]; lessons: LessonItem[] };

type Selection =
  | { kind: 'course' }
  | { kind: 'uda'; udaDir: string }
  | { kind: 'lesson'; lessonId: string };

type LessonTab = 'contenuto' | 'domande' | 'informazioni';

export function CourseWorkspace({
  card,
  ownerUid,
  onBack,
  onProgramQuestionsChange,
}: CourseWorkspaceProps) {
  const [tree, setTree] = useState<Tree | null>(null);
  const [treeError, setTreeError] = useState<string | null>(null);

  const [selection, setSelection] = useState<Selection>({ kind: 'course' });
  const [collapsedUdas, setCollapsedUdas] = useState<Set<string>>(new Set());
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // Lesson content is loaded on demand, only when a lesson is selected.
  const [lessonContent, setLessonContent] = useState<string | null>(null);
  const [lessonMetadata, setLessonMetadata] = useState<LessonMetadata>(EMPTY_LESSON_METADATA);
  const [lessonLoading, setLessonLoading] = useState(false);
  const [lessonError, setLessonError] = useState<string | null>(null);
  // Monotonic id of the most recent lesson selection: only the request that
  // matches it may write the lesson panel. Guards against a slower earlier
  // fetch resolving after a newer one (out-of-order) and against a course
  // change / unmount landing a stale result.
  const lessonRequestRef = useRef(0);

  // Lesson tabs (DUX-03). The pool (Domande) is loaded lazily: only after the
  // Domande tab has been opened for the current lesson, and kept mounted while
  // switching tabs so the pool is read once per lesson.
  const [activeTab, setActiveTab] = useState<LessonTab>('contenuto');
  const [domandeVisited, setDomandeVisited] = useState(false);
  const [poolDirty, setPoolDirty] = useState(false);
  // Navigation held back until the teacher confirms losing unsaved pool edits.
  const [pendingNav, setPendingNav] = useState<{ run: () => void } | null>(null);

  // ── Load the course tree once (UDA + lessons, 2 reads) ──────────────────
  useEffect(() => {
    let cancelled = false;
    setTree(null);
    setTreeError(null);
    async function load() {
      if (!card.activeImportId) {
        if (!cancelled) setTree({ udas: [], lessons: [] });
        return;
      }
      try {
        const [udas, lessons] = await Promise.all([
          listUdas(card.programId, card.activeImportId, db),
          listLessons(card.programId, card.activeImportId, db),
        ]);
        if (!cancelled) setTree({ udas, lessons });
      } catch {
        if (!cancelled) setTreeError('Impossibile caricare la struttura del corso.');
      }
    }
    void load();
    return () => {
      cancelled = true;
      // Invalidate any in-flight lesson fetch so a stale result from the
      // previous course can never write this (or the next) course's panel.
      lessonRequestRef.current++;
    };
  }, [card.programId, card.activeImportId]);

  const lessonsByUda = useMemo(() => {
    const map = new Map<string, LessonItem[]>();
    for (const lesson of tree?.lessons ?? []) {
      const list = map.get(lesson.udaDir) ?? [];
      list.push(lesson);
      map.set(lesson.udaDir, list);
    }
    return map;
  }, [tree]);

  const selectedLesson =
    selection.kind === 'lesson'
      ? (tree?.lessons.find((l) => l.id === selection.lessonId) ?? null)
      : null;
  const selectedUda =
    selection.kind === 'uda' ? (tree?.udas.find((u) => u.dir === selection.udaDir) ?? null) : null;

  // Guards a navigation that would discard unsaved pool edits: when the pool
  // editor is dirty, hold the action back behind a confirm; otherwise run it.
  function guardedNav(run: () => void) {
    if (poolDirty) setPendingNav({ run });
    else run();
  }

  function selectTab(tab: LessonTab) {
    setActiveTab(tab);
    if (tab === 'domande') setDomandeVisited(true);
  }

  function handlePoolCountChange(
    lessonId: string,
    questionCount: number,
    poolStatus: PoolCountStatus,
  ) {
    setTree((prev) => {
      if (!prev) return prev;
      const lessons = prev.lessons.map((l) =>
        l.id === lessonId ? { ...l, questionCount, poolStatus } : l,
      );
      onProgramQuestionsChange?.(
        card.programId,
        lessons.reduce((s, l) => s + (l.questionCount ?? 0), 0),
      );
      return { ...prev, lessons };
    });
  }

  async function selectLesson(lesson: LessonItem) {
    const requestId = ++lessonRequestRef.current;
    setSelection({ kind: 'lesson', lessonId: lesson.id });
    // New lesson: reset the tabs to Contenuto and drop the previous lesson's
    // contextual (pool) state so nothing from it can bleed through.
    setActiveTab('contenuto');
    setDomandeVisited(false);
    setPoolDirty(false);
    setLessonContent(null);
    setLessonMetadata(EMPTY_LESSON_METADATA);
    setLessonError(null);
    setLessonLoading(true);
    try {
      const raw = await fetchLessonContent(lesson.storageRef, storage);
      const { metadata, body } = parseLessonMetadata(raw);
      if (lessonRequestRef.current !== requestId) return; // superseded
      setLessonMetadata(metadata);
      setLessonContent(body);
    } catch {
      if (lessonRequestRef.current !== requestId) return; // superseded
      setLessonError('Impossibile caricare il contenuto della lezione.');
    } finally {
      if (lessonRequestRef.current === requestId) setLessonLoading(false);
    }
  }

  function toggleUdaCollapsed(udaDir: string) {
    setCollapsedUdas((prev) => {
      const next = new Set(prev);
      if (next.has(udaDir)) next.delete(udaDir);
      else next.add(udaDir);
      return next;
    });
  }

  const pct = card.lessonsTotal > 0 ? Math.round((card.lessonsDone / card.lessonsTotal) * 100) : 0;
  const yearLabel = card.annoScolastico ?? 'Senza anno';
  // Once the tree is loaded, derive the domande total from it so a pool edit
  // updates the strip live; before that, fall back to the card's counter.
  const questionsTotal = tree
    ? tree.lessons.reduce((s, l) => s + (l.questionCount ?? 0), 0)
    : card.questionsTotal;

  return (
    <section aria-label={`Corso — ${card.title}`} className={styles.workspace}>
      <header className={styles.header}>
        <button type="button" className={styles.backBtn} onClick={() => guardedNav(onBack)}>
          ← Libreria
        </button>
        <h2 className={styles.title}>{card.title}</h2>
      </header>

      <div className={styles.summaryStrip}>
        <span className={styles.pill}>{yearLabel}</span>
        {card.classNames.length > 0 ? (
          card.classNames.map((name) => (
            <span key={name} className={styles.pill}>
              {name}
            </span>
          ))
        ) : (
          <span className={styles.pill}>Nessuna classe</span>
        )}
        <span className={styles.sep} aria-hidden="true">
          ·
        </span>
        <span>
          <strong>{card.udaCount}</strong> UDA
        </span>
        <span className={styles.sep} aria-hidden="true">
          ·
        </span>
        <span>
          <strong>
            {card.lessonsDone}/{card.lessonsTotal}
          </strong>{' '}
          lezioni svolte
        </span>
        <span className={styles.sep} aria-hidden="true">
          ·
        </span>
        <span>
          <strong>{questionsTotal}</strong> domande
        </span>
        <div className={styles.progressTrack} role="img" aria-label={`Avanzamento lezioni ${pct}%`}>
          <div className={styles.progressFill} style={{ width: `${pct}%` }} />
        </div>
      </div>

      <div className={`${styles.body}${sidebarCollapsed ? ` ${styles.bodyCollapsed}` : ''}`}>
        {sidebarCollapsed ? (
          <button
            type="button"
            className={styles.sidebarExpand}
            aria-label="Espandi struttura corso"
            title="Espandi struttura corso"
            onClick={() => setSidebarCollapsed(false)}
          >
            ▸
          </button>
        ) : (
          <nav className={styles.sidebar} aria-label="Struttura corso">
            <div className={styles.sidebarHead}>
              <button
                type="button"
                className={`${styles.overviewBtn}${selection.kind === 'course' ? ` ${styles.selected}` : ''}`}
                aria-current={selection.kind === 'course' ? 'true' : undefined}
                onClick={() => guardedNav(() => setSelection({ kind: 'course' }))}
              >
                Panoramica corso
              </button>
              <button
                type="button"
                className={styles.collapseBtn}
                aria-label="Comprimi struttura corso"
                title="Comprimi struttura corso"
                onClick={() => setSidebarCollapsed(true)}
              >
                ◂
              </button>
            </div>

            {tree === null ? (
              <p aria-busy="true" className="state-loading">
                Caricamento…
              </p>
            ) : treeError ? (
              <p role="alert" className="text-error">
                {treeError}
              </p>
            ) : tree.udas.length === 0 ? (
              <p className="state-empty">Nessuna UDA in questo corso.</p>
            ) : (
              <ul className={styles.udaList}>
                {tree.udas.map((uda) => {
                  const open = !collapsedUdas.has(uda.dir);
                  const udaLessons = lessonsByUda.get(uda.dir) ?? [];
                  const udaSelected = selection.kind === 'uda' && selection.udaDir === uda.dir;
                  return (
                    <li key={uda.id} className={styles.udaItem}>
                      <div className={styles.udaHead}>
                        <button
                          type="button"
                          className={styles.caretBtn}
                          aria-label={open ? `Comprimi ${uda.dir}` : `Espandi ${uda.dir}`}
                          aria-expanded={open}
                          onClick={() => toggleUdaCollapsed(uda.dir)}
                        >
                          <span
                            className={open ? styles.caretOpen : styles.caret}
                            aria-hidden="true"
                          >
                            ▸
                          </span>
                        </button>
                        <button
                          type="button"
                          className={`${styles.udaTitleBtn}${udaSelected ? ` ${styles.selected}` : ''}`}
                          aria-current={udaSelected ? 'true' : undefined}
                          onClick={() =>
                            guardedNav(() => setSelection({ kind: 'uda', udaDir: uda.dir }))
                          }
                        >
                          {uda.dir}
                        </button>
                      </div>
                      {open && udaLessons.length > 0 && (
                        <ul className={styles.lessonList}>
                          {udaLessons.map((lesson) => {
                            const { title } = resolveLessonTitle(lesson.filename, lesson.titolo);
                            const active =
                              selection.kind === 'lesson' && selection.lessonId === lesson.id;
                            return (
                              <li key={lesson.id}>
                                <button
                                  type="button"
                                  className={`${styles.lessonBtn}${active ? ` ${styles.selected}` : ''}`}
                                  aria-current={active ? 'true' : undefined}
                                  onClick={() => guardedNav(() => void selectLesson(lesson))}
                                >
                                  {lesson.completed && (
                                    <span className={styles.doneDot} aria-hidden="true">
                                      ●
                                    </span>
                                  )}
                                  <span className={styles.lessonBtnText}>{title}</span>
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </nav>
        )}

        <div className={styles.content}>
          {selection.kind === 'course' && (
            <CourseOverview card={card} tree={tree} lessonsByUda={lessonsByUda} />
          )}
          {selection.kind === 'uda' && selectedUda && (
            <UdaOverview
              uda={selectedUda}
              lessons={lessonsByUda.get(selectedUda.dir) ?? []}
              onOpenLesson={(l) => guardedNav(() => void selectLesson(l))}
            />
          )}
          {selection.kind === 'lesson' && selectedLesson && (
            <LessonDetail
              lesson={selectedLesson}
              metadata={lessonMetadata}
              content={lessonContent}
              loading={lessonLoading}
              error={lessonError}
              activeTab={activeTab}
              onSelectTab={selectTab}
              domandeVisited={domandeVisited}
              programId={card.programId}
              importId={card.activeImportId}
              ownerUid={ownerUid}
              onDirtyChange={setPoolDirty}
              onPoolCountChange={(count, status) =>
                handlePoolCountChange(selectedLesson.id, count, status)
              }
            />
          )}
        </div>
      </div>

      {pendingNav && (
        <div className={styles.confirmBackdrop} onClick={() => setPendingNav(null)}>
          <div
            className={styles.confirmDialog}
            role="alertdialog"
            aria-modal="true"
            aria-label="Modifiche non salvate"
            onClick={(e) => e.stopPropagation()}
          >
            <p className={styles.confirmMessage}>
              Ci sono modifiche non salvate nel pool di domande. Continuando andranno perse.
            </p>
            <div className={styles.confirmActions}>
              <button type="button" onClick={() => setPendingNav(null)}>
                Annulla
              </button>
              <button
                type="button"
                className="btn-danger"
                onClick={() => {
                  const nav = pendingNav;
                  setPendingNav(null);
                  setPoolDirty(false);
                  nav.run();
                }}
              >
                Continua senza salvare
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

// ── Course overview (no UDA/lesson selected) ────────────────────────────────

function CourseOverview({
  card,
  tree,
  lessonsByUda,
}: {
  card: CourseCard;
  tree: Tree | null;
  lessonsByUda: Map<string, LessonItem[]>;
}) {
  return (
    <div>
      <p className={styles.contextLabel}>Panoramica corso</p>
      {!card.hasImport ? (
        <p className="state-empty">
          Nessun contenuto importato. Importa uno ZIP dalla libreria per popolare questo corso.
        </p>
      ) : tree === null ? (
        <p aria-busy="true" className="state-loading">
          Caricamento struttura…
        </p>
      ) : tree.udas.length === 0 ? (
        <p className="state-empty">Nessuna UDA in questo corso.</p>
      ) : (
        <table className={styles.dataTable}>
          <thead>
            <tr>
              <th>UDA</th>
              <th>Lezioni svolte</th>
            </tr>
          </thead>
          <tbody>
            {tree.udas.map((uda) => {
              const udaLessons = lessonsByUda.get(uda.dir) ?? [];
              const done = udaLessons.filter((l) => l.completed).length;
              return (
                <tr key={uda.id}>
                  <td>{uda.dir}</td>
                  <td>{`${done}/${udaLessons.length}`}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ── UDA overview (UDA selected) ─────────────────────────────────────────────

function UdaOverview({
  uda,
  lessons,
  onOpenLesson,
}: {
  uda: UdaItem;
  lessons: LessonItem[];
  onOpenLesson: (lesson: LessonItem) => void;
}) {
  return (
    <div>
      <p className={styles.contextLabel}>UDA</p>
      <h3 className={styles.sectionTitle}>{uda.dir}</h3>
      {uda.descrizione && <p className={styles.udaDescription}>{uda.descrizione}</p>}
      {uda.competenze.length > 0 && (
        <div className={styles.metaGroup}>
          <span className={styles.metaLabel}>Competenze</span>
          <ul className={styles.metaList}>
            {uda.competenze.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </div>
      )}
      {uda.obiettivi.length > 0 && (
        <div className={styles.metaGroup}>
          <span className={styles.metaLabel}>Obiettivi</span>
          <ul className={styles.metaList}>
            {uda.obiettivi.map((o) => (
              <li key={o}>{o}</li>
            ))}
          </ul>
        </div>
      )}

      {lessons.length === 0 ? (
        <p className="state-empty">Nessuna lezione in questa UDA.</p>
      ) : (
        <table className={styles.dataTable}>
          <thead>
            <tr>
              <th>Lezione</th>
              <th>Stato</th>
              <th>Domande</th>
            </tr>
          </thead>
          <tbody>
            {lessons.map((lesson) => {
              const { title } = resolveLessonTitle(lesson.filename, lesson.titolo);
              return (
                <tr key={lesson.id}>
                  <td>
                    <button
                      type="button"
                      className={styles.rowOpenBtn}
                      onClick={() => onOpenLesson(lesson)}
                    >
                      {title}
                    </button>
                  </td>
                  <td>{lesson.completed ? 'Svolta' : 'Da svolgere'}</td>
                  <td>{lesson.questionCount}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ── Lesson detail (lesson selected) ─────────────────────────────────────────

const LESSON_TABS: { id: LessonTab; label: string }[] = [
  { id: 'contenuto', label: 'Contenuto' },
  { id: 'domande', label: 'Domande' },
  { id: 'informazioni', label: 'Informazioni' },
];

function LessonDetail({
  lesson,
  metadata,
  content,
  loading,
  error,
  activeTab,
  onSelectTab,
  domandeVisited,
  programId,
  importId,
  ownerUid,
  onDirtyChange,
  onPoolCountChange,
}: {
  lesson: LessonItem;
  metadata: LessonMetadata;
  content: string | null;
  loading: boolean;
  error: string | null;
  activeTab: LessonTab;
  onSelectTab: (tab: LessonTab) => void;
  domandeVisited: boolean;
  programId: string;
  importId: string | null;
  ownerUid: string;
  onDirtyChange: (dirty: boolean) => void;
  onPoolCountChange: (questionCount: number, poolStatus: PoolCountStatus) => void;
}) {
  const { title } = resolveLessonTitle(lesson.filename, metadata.titolo ?? lesson.titolo);

  // Roving-ish keyboard navigation across the tablist (←/→, Home/End).
  function onTabKeyDown(e: ReactKeyboardEvent) {
    const idx = LESSON_TABS.findIndex((t) => t.id === activeTab);
    let next = idx;
    if (e.key === 'ArrowRight') next = (idx + 1) % LESSON_TABS.length;
    else if (e.key === 'ArrowLeft') next = (idx - 1 + LESSON_TABS.length) % LESSON_TABS.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = LESSON_TABS.length - 1;
    else return;
    e.preventDefault();
    onSelectTab(LESSON_TABS[next]!.id);
  }

  return (
    <div>
      <p className={styles.contextLabel}>Lezione</p>
      <div className={styles.lessonHead}>
        <h3 className={styles.sectionTitle}>{title}</h3>
        {metadata.sottotitolo && <p className={styles.lessonSubtitle}>{metadata.sottotitolo}</p>}
      </div>

      <div className={styles.tablist} role="tablist" aria-label="Schede lezione">
        {LESSON_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={activeTab === t.id}
            aria-controls={`panel-${t.id}`}
            tabIndex={activeTab === t.id ? 0 : -1}
            className={`${styles.tab}${activeTab === t.id ? ` ${styles.tabActive}` : ''}`}
            onClick={() => onSelectTab(t.id)}
            onKeyDown={onTabKeyDown}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div
        role="tabpanel"
        id="panel-contenuto"
        aria-labelledby="tab-contenuto"
        hidden={activeTab !== 'contenuto'}
      >
        {activeTab === 'contenuto' && (
          <>
            {loading && (
              <p aria-busy="true" className="state-loading">
                Caricamento contenuto…
              </p>
            )}
            {error && (
              <p role="alert" className="text-error">
                {error}
              </p>
            )}
            {!loading && !error && content !== null && content.trim() === '' && (
              <p className="state-empty">Nessun contenuto disponibile per questa lezione.</p>
            )}
            {!loading && !error && content !== null && content.trim() !== '' && (
              <MarkdownRenderer markdown={content} />
            )}
          </>
        )}
      </div>

      <div
        role="tabpanel"
        id="panel-domande"
        aria-labelledby="tab-domande"
        hidden={activeTab !== 'domande'}
      >
        {/* Lazy: mounted only once the Domande tab has been opened, then kept
            mounted across tab switches so the pool is read once per lesson. */}
        {domandeVisited && (
          <QuestionPoolEditor
            programId={programId}
            importId={importId}
            lesson={lesson}
            ownerUid={ownerUid}
            onDirtyChange={onDirtyChange}
            onPoolCountChange={onPoolCountChange}
          />
        )}
      </div>

      <div
        role="tabpanel"
        id="panel-informazioni"
        aria-labelledby="tab-informazioni"
        hidden={activeTab !== 'informazioni'}
      >
        {activeTab === 'informazioni' && <LessonInfo lesson={lesson} metadata={metadata} />}
      </div>
    </div>
  );
}

// ── Lesson "Informazioni" tab: only metadata actually present ────────────────

function LessonInfo({ lesson, metadata }: { lesson: LessonItem; metadata: LessonMetadata }) {
  const hasAny =
    Boolean(metadata.titolo) ||
    Boolean(metadata.sottotitolo) ||
    Boolean(metadata.difficolta) ||
    metadata.concettiChiave.length > 0 ||
    metadata.obiettivi.length > 0;

  return (
    <div>
      {!hasAny ? (
        <p className="state-empty">Nessun metadato per questa lezione.</p>
      ) : (
        <dl className={styles.infoList}>
          {metadata.titolo && (
            <>
              <dt>Titolo</dt>
              <dd>{metadata.titolo}</dd>
            </>
          )}
          {metadata.sottotitolo && (
            <>
              <dt>Sottotitolo</dt>
              <dd>{metadata.sottotitolo}</dd>
            </>
          )}
          {metadata.difficolta && (
            <>
              <dt>Difficoltà</dt>
              <dd>{metadata.difficolta}</dd>
            </>
          )}
          {metadata.concettiChiave.length > 0 && (
            <>
              <dt>Concetti chiave</dt>
              <dd>{metadata.concettiChiave.join(', ')}</dd>
            </>
          )}
          {metadata.obiettivi.length > 0 && (
            <>
              <dt>Obiettivi</dt>
              <dd>{metadata.obiettivi.join(', ')}</dd>
            </>
          )}
        </dl>
      )}

      <details className={styles.infoTechnical}>
        <summary>Dettagli tecnici</summary>
        <dl className={styles.infoList}>
          <dt>File</dt>
          <dd>{lesson.path}</dd>
        </dl>
      </details>
    </div>
  );
}
