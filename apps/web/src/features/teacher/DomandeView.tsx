import { useEffect, useState } from 'react';
import { parsePool, serializePool } from '@schoolforge/lesson-contract';
import type { ParsedPool, PoolQuestion, PoolValidationError } from '@schoolforge/lesson-contract';
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
  deletePool,
  loadPool,
  savePool,
  PoolDeleteBlockedError,
  type PoolDeleteBlocker,
} from '../repository/pools/poolEditorService.js';
import { useAuth } from '../../lib/auth.js';
import { db, storage } from '../../lib/firebase.js';
import { IconChevronLeft, IconChevronRight, IconTrash } from '../../components/icons.js';
import styles from './DomandeView.module.css';

const POOL_TEMPLATE = `---
schema: schoolforge-pool/v1
questions: []
---
`;

const TIPO_LABELS: Record<string, string> = {
  aperta: 'Aperta',
  chiusa_singola: 'Chiusa (singola)',
  chiusa_multipla: 'Chiusa (multipla)',
};

type CourseTreeState = {
  udas: UdaItem[] | null;
  lessons: LessonItem[] | null;
  error?: string;
};

type PoolState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'absent' }
  | { status: 'valid'; pool: ParsedPool }
  | { status: 'invalid'; errors: PoolValidationError[]; rawContent: string }
  | { status: 'error'; message: string };

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

function QuestionCard({ q, index }: { q: PoolQuestion; index: number }) {
  const hasOpzioni = q.tipo === 'chiusa_singola' || q.tipo === 'chiusa_multipla';
  const soluzione =
    q.tipo === 'aperta'
      ? q.soluzione
      : Array.isArray(q.soluzione)
        ? q.soluzione.join(', ')
        : q.soluzione;

  return (
    <div className={styles.questionCard}>
      <div className={styles.questionHeader}>
        <span className={styles.questionNumber}>#{index + 1}</span>
        <span className={styles.questionId}>{q.id}</span>
        <span className={styles.questionTipo}>{TIPO_LABELS[q.tipo] ?? q.tipo}</span>
        <span className={styles.questionMeta}>
          Diff: {q.difficolta} · Peso: {q.peso} · Max: {q.maxPoints} pt
        </span>
      </div>
      <p className={styles.questionTesto}>{q.testo}</p>
      {hasOpzioni && (q.tipo === 'chiusa_singola' || q.tipo === 'chiusa_multipla') && (
        <ul className={styles.opzioniList}>
          {q.opzioni.map((o) => {
            const isSol = Array.isArray(q.soluzione)
              ? q.soluzione.includes(o.id)
              : q.soluzione === o.id;
            return (
              <li key={o.id} className={isSol ? styles.opzioneCorretta : undefined}>
                <span className={styles.opzioneId}>[{o.id}]</span> {o.testo}
              </li>
            );
          })}
        </ul>
      )}
      {soluzione !== null && (
        <div className={styles.soluzioneBlock}>
          <span className={styles.soluzioneLabel}>Soluzione:</span> {soluzione}
        </div>
      )}
    </div>
  );
}

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

  const [poolState, setPoolState] = useState<PoolState>({ status: 'idle' });

  // YAML editor
  const [editorOpen, setEditorOpen] = useState(false);
  const [yamlDraft, setYamlDraft] = useState('');
  const [yamlParseErrors, setYamlParseErrors] = useState<PoolValidationError[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Delete flow
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteBlockers, setDeleteBlockers] = useState<PoolDeleteBlocker[] | null>(null);

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

  async function handleSelectLesson(program: ProgramItem, lesson: LessonItem) {
    setSelectedProgram(program);
    setSelectedLesson(lesson);
    setEditorOpen(false);
    setSaveError(null);
    setDeleteConfirm(false);
    setDeleteError(null);
    setDeleteBlockers(null);
    setPoolState({ status: 'loading' });

    if (!program.activeImportId) {
      setPoolState({ status: 'absent' });
      return;
    }

    try {
      const result = await loadPool({
        programId: program.id,
        importId: program.activeImportId,
        lessonId: lesson.id,
        db,
        storage,
      });
      if (result.status === 'valid') {
        setPoolState({ status: 'valid', pool: result.pool });
        setYamlDraft(serializePool(result.pool));
      } else if (result.status === 'invalid') {
        setPoolState({
          status: 'invalid',
          errors: result.errors,
          rawContent: result.rawContent,
        });
        setYamlDraft(result.rawContent);
      } else {
        setPoolState({ status: 'absent' });
        setYamlDraft(POOL_TEMPLATE);
      }
    } catch (err) {
      setPoolState({
        status: 'error',
        message: err instanceof Error ? err.message : 'Errore caricamento pool.',
      });
    }
  }

  function openEditor() {
    setYamlParseErrors([]);
    setSaveError(null);
    if (poolState.status === 'valid') {
      setYamlDraft(serializePool(poolState.pool));
    }
    setEditorOpen(true);
  }

  async function handleSave() {
    if (!selectedProgram?.activeImportId || !selectedLesson) return;
    setYamlParseErrors([]);
    setSaveError(null);

    const parseResult = parsePool(yamlDraft, selectedLesson.filename);
    if (!parseResult.ok) {
      setYamlParseErrors(parseResult.errors);
      return;
    }

    setSaving(true);
    try {
      await savePool({
        programId: selectedProgram.id,
        importId: selectedProgram.activeImportId,
        lessonId: selectedLesson.id,
        pool: parseResult.pool,
        ownerUid,
        db,
        storage,
      });
      const savedPool = parseResult.pool;
      setPoolState({ status: 'valid', pool: savedPool });
      setYamlDraft(serializePool(savedPool));
      setEditorOpen(false);
      // Update lesson in courseTree to reflect new poolStatus
      setSelectedLesson((prev) =>
        prev ? { ...prev, poolStatus: 'valid', questionCount: savedPool.questions.length } : prev,
      );
      setCourseTree((prev) => {
        const cur = prev[selectedProgram.id];
        if (!cur?.lessons) return prev;
        return {
          ...prev,
          [selectedProgram.id]: {
            ...cur,
            lessons: cur.lessons.map((l) =>
              l.id === selectedLesson.id
                ? { ...l, poolStatus: 'valid', questionCount: savedPool.questions.length }
                : l,
            ),
          },
        };
      });
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Errore durante il salvataggio.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!selectedProgram?.activeImportId || !selectedLesson) return;
    setDeleting(true);
    setDeleteError(null);
    setDeleteBlockers(null);
    try {
      await deletePool({
        programId: selectedProgram.id,
        importId: selectedProgram.activeImportId,
        lessonId: selectedLesson.id,
        ownerUid,
        db,
        storage,
      });
      setPoolState({ status: 'absent' });
      setYamlDraft(POOL_TEMPLATE);
      setDeleteConfirm(false);
      setEditorOpen(false);
      setSelectedLesson((prev) =>
        prev ? { ...prev, poolStatus: 'absent', questionCount: 0 } : prev,
      );
      setCourseTree((prev) => {
        const cur = prev[selectedProgram.id];
        if (!cur?.lessons) return prev;
        return {
          ...prev,
          [selectedProgram.id]: {
            ...cur,
            lessons: cur.lessons.map((l) =>
              l.id === selectedLesson.id ? { ...l, poolStatus: 'absent', questionCount: 0 } : l,
            ),
          },
        };
      });
    } catch (err) {
      if (err instanceof PoolDeleteBlockedError) {
        setDeleteBlockers(err.blockers);
        setDeleteConfirm(false);
      } else {
        setDeleteError(err instanceof Error ? err.message : "Errore durante l'eliminazione.");
      }
    } finally {
      setDeleting(false);
    }
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
                                                onClick={() =>
                                                  void handleSelectLesson(program, lesson)
                                                }
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
        {poolState.status === 'idle' && (
          <div className={styles.emptyState}>
            <p>Seleziona una lezione dalla barra laterale per visualizzare il pool di domande.</p>
          </div>
        )}

        {poolState.status === 'loading' && (
          <div className={styles.emptyState}>
            <p>Caricamento pool…</p>
          </div>
        )}

        {poolState.status === 'error' && (
          <div className={styles.emptyState}>
            <p className={styles.errorMsg}>{poolState.message}</p>
          </div>
        )}

        {(poolState.status === 'absent' ||
          poolState.status === 'valid' ||
          poolState.status === 'invalid') &&
          selectedLesson && (
            <>
              <div className={styles.contentHeader}>
                <div className={styles.titleBlock}>
                  <h2 className={styles.contentTitle}>
                    {lessonTitle?.number ? `${lessonTitle.number}. ` : ''}
                    {lessonTitle?.title}
                  </h2>
                  {selectedProgram && (
                    <p className={styles.contentSubtitle}>{selectedProgram.title}</p>
                  )}
                </div>

                <div className={styles.contentActions}>
                  {poolState.status === 'valid' && (
                    <button
                      type="button"
                      className={`${styles.iconBtn} ${styles.iconBtnDanger}`}
                      title="Elimina pool"
                      aria-label="Elimina pool"
                      onClick={() => {
                        setDeleteConfirm(true);
                        setDeleteError(null);
                        setDeleteBlockers(null);
                      }}
                    >
                      <IconTrash size={14} />
                    </button>
                  )}
                </div>
              </div>

              {/* Delete confirmation */}
              {deleteConfirm && (
                <div className={styles.deleteConfirmBox} role="alert">
                  <p className={styles.deleteConfirmMsg}>
                    Eliminare il pool di domande di questa lezione? L&apos;operazione non è
                    reversibile.
                  </p>
                  <div className={styles.deleteConfirmActions}>
                    <button
                      type="button"
                      className={`${styles.btn} ${styles.btnDanger}`}
                      onClick={() => void handleDelete()}
                      disabled={deleting}
                    >
                      {deleting ? 'Eliminazione…' : 'Elimina'}
                    </button>
                    <button
                      type="button"
                      className={styles.btn}
                      onClick={() => setDeleteConfirm(false)}
                      disabled={deleting}
                    >
                      Annulla
                    </button>
                  </div>
                  {deleteError && <p className={styles.errorMsg}>{deleteError}</p>}
                </div>
              )}

              {/* Blockers warning */}
              {deleteBlockers && (
                <div className={styles.blockersBox} role="alert">
                  <p className={styles.deleteConfirmMsg}>
                    Impossibile eliminare il pool: le seguenti bozze di verifica lo utilizzano:
                  </p>
                  <ul className={styles.blockersList}>
                    {deleteBlockers.map((b) => (
                      <li key={b.verificationId}>{b.title}</li>
                    ))}
                  </ul>
                  <button
                    type="button"
                    className={styles.btn}
                    onClick={() => setDeleteBlockers(null)}
                  >
                    Chiudi
                  </button>
                </div>
              )}

              {/* Pool absent */}
              {poolState.status === 'absent' && !editorOpen && (
                <div className={styles.absentState}>
                  <p>Nessun pool di domande per questa lezione.</p>
                  <button
                    type="button"
                    className={`${styles.btn} ${styles.btnPrimary}`}
                    onClick={openEditor}
                  >
                    Crea pool
                  </button>
                </div>
              )}

              {/* Pool invalid */}
              {poolState.status === 'invalid' && !editorOpen && (
                <div className={styles.invalidState}>
                  <p className={styles.invalidTitle}>Il pool contiene errori di validazione:</p>
                  <ul className={styles.errorList}>
                    {poolState.errors.map((e, i) => (
                      <li key={i}>
                        {e.questionId ? `[${e.questionId}] ` : ''}
                        {e.field}: {e.message}
                      </li>
                    ))}
                  </ul>
                  <button
                    type="button"
                    className={`${styles.btn} ${styles.btnPrimary}`}
                    onClick={openEditor}
                  >
                    Modifica YAML
                  </button>
                </div>
              )}

              {/* Pool valid — question list */}
              {poolState.status === 'valid' && !editorOpen && (
                <div className={styles.questionList}>
                  <div className={styles.poolMeta}>
                    <span className={styles.poolCount}>
                      {poolState.pool.questions.length} domande
                    </span>
                    <button
                      type="button"
                      className={`${styles.btn} ${styles.btnSecondary}`}
                      onClick={openEditor}
                    >
                      Modifica YAML
                    </button>
                  </div>
                  {poolState.pool.questions.map((q, i) => (
                    <QuestionCard key={q.id} q={q} index={i} />
                  ))}
                  {poolState.pool.questions.length === 0 && (
                    <p className={styles.mutedMsg}>Il pool non contiene ancora domande.</p>
                  )}
                </div>
              )}

              {/* YAML editor */}
              {editorOpen && (
                <div className={styles.yamlEditor}>
                  <p className={styles.yamlHint}>
                    Modifica il file YAML del pool. Il contenuto verrà validato prima del
                    salvataggio.
                  </p>
                  <textarea
                    className={styles.yamlTextarea}
                    value={yamlDraft}
                    onChange={(e) => setYamlDraft(e.target.value)}
                    rows={20}
                    spellCheck={false}
                    aria-label="YAML del pool"
                  />
                  {yamlParseErrors.length > 0 && (
                    <ul className={styles.errorList} role="alert">
                      {yamlParseErrors.map((e, i) => (
                        <li key={i}>
                          {e.questionId ? `[${e.questionId}] ` : ''}
                          {e.field}: {e.message}
                        </li>
                      ))}
                    </ul>
                  )}
                  {saveError && <p className={styles.errorMsg}>{saveError}</p>}
                  <div className={styles.yamlActions}>
                    <button
                      type="button"
                      className={`${styles.btn} ${styles.btnPrimary}`}
                      onClick={() => void handleSave()}
                      disabled={saving}
                    >
                      {saving ? 'Salvataggio…' : 'Salva'}
                    </button>
                    <button
                      type="button"
                      className={styles.btn}
                      onClick={() => {
                        setEditorOpen(false);
                        setYamlParseErrors([]);
                        setSaveError(null);
                      }}
                      disabled={saving}
                    >
                      Annulla
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
      </section>
    </div>
  );
}
