import { useEffect, useMemo, useRef, useState } from 'react';
import type { LessonItem } from '../repository/programs/programsService.js';
import { db, functions } from '../../lib/firebase.js';
import {
  createAiContentCallables,
  describeAiContentError,
} from '../repository/pools/aiContentClient.js';
import {
  currentStudyPractice,
  practicePoolContext,
  type StudyPractice,
} from '../repository/programs/studyPractice.js';
import {
  saveStudyPractice,
  withdrawStudyPractice,
  loadPublicStudyPractice,
  loadPrivateStudyPractice,
} from '../repository/programs/studyPracticeService.js';
import { resolvePublicLessonId } from '../repository/programs/publicLessonId.js';
import { MarkdownRenderer } from '../../components/MarkdownRenderer.js';
import { StudyPracticePlayer } from '../student/StudyPracticePlayer.js';
import { AiStudyPracticeGenerationDialog } from './AiStudyPracticeGenerationDialog.js';
import {
  practiceStageLabel,
  practiceCoverageLabel,
} from '../repository/programs/studyPracticeLabels.js';
import styles from './StudyPracticeEditor.module.css';
export function StudyPracticeEditor({
  lesson,
  body,
  programId,
  importId,
  ownerUid,
  onDirtyChange,
  onApprovedChange,
}: {
  lesson: LessonItem;
  body: string;
  programId: string;
  importId: string;
  ownerUid: string;
  onDirtyChange: (value: boolean) => void;
  onApprovedChange: (context: string | undefined) => void;
}) {
  const initial = currentStudyPractice(lesson.studyPractice, body);
  const [draft, setDraft] = useState<StudyPractice | null>(null);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [reloadNonce, setReloadNonce] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [generationOpen, setGenerationOpen] = useState(false);
  const [published, setPublished] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [showPlayer, setShowPlayer] = useState(false);
  const callables = useMemo(() => createAiContentCallables(functions), []);
  const mounted = useRef(true);
  const locked = useRef(false);
  const publicationEpoch = useRef(0);
  const blocked = busy || loadState !== 'ready';
  useEffect(() => {
    let active = true;
    setLoadState('loading');
    setError(null);
    void loadPrivateStudyPractice({
      programId,
      importId,
      lessonId: lesson.id,
      ownerUid,
      sourceBody: body,
      db,
    }).then(
      (practice) => {
        if (active) {
          setDraft(practice);
          setDirty(false);
          setLoadState('ready');
        }
      },
      (error) => {
        if (active) {
          setDraft(null);
          setLoadState('error');
          setError(
            error instanceof Error && !('code' in error) && !('details' in error)
              ? error.message
              : describeAiContentError(error),
          );
        }
      },
    );
    return () => {
      active = false;
    };
  }, [programId, importId, lesson.id, ownerUid, body, reloadNonce]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    let active = true;
    const epoch = publicationEpoch.current;
    void loadPublicStudyPractice(resolvePublicLessonId(lesson, lesson.id), body, db).then(
      (p) => {
        if (active && epoch === publicationEpoch.current) {
          setPublished(!!p);
          onApprovedChange(practicePoolContext(p));
        }
      },
      () => {
        if (active && epoch === publicationEpoch.current) {
          setPublished(false);
          onApprovedChange(undefined);
        }
      },
    );
    return () => {
      active = false;
    };
  }, [lesson.id, body, onApprovedChange]);
  useEffect(() => {
    onDirtyChange(dirty || generationOpen);
    return () => onDirtyChange(false);
  }, [dirty, generationOpen, onDirtyChange]);
  async function action(work: () => Promise<void>) {
    if (locked.current || loadState !== 'ready') return;
    locked.current = true;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await work();
    } catch (e) {
      if (mounted.current)
        setError(
          e instanceof Error && !('code' in e) && !('details' in e)
            ? e.message
            : describeAiContentError(e),
        );
    } finally {
      locked.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  function change(next: StudyPractice) {
    setDraft(next);
    setDirty(true);
    setShowPlayer(false);
  }
  return (
    <section
      className={styles.editor}
      aria-label="Esercitazioni e percorso didattico"
      aria-busy={busy || loadState === 'loading'}
    >
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Percorso di studio</p>
          <h3>Esercitazioni per lo studente</h3>
          <p className={styles.description}>
            Un esempio da seguire, una guida per provare, una prova da svolgere in autonomia.
          </p>
        </div>
        <button
          type="button"
          className="btn-primary"
          disabled={blocked || !body.trim()}
          onClick={() => setGenerationOpen(true)}
        >
          Genera con IA
        </button>
      </header>
      {loadState === 'loading' && (
        <p role="status" className={styles.notice}>
          Caricamento esercitazione salvata…
        </p>
      )}
      {loadState === 'error' && (
        <button type="button" onClick={() => setReloadNonce((n) => n + 1)}>
          Ricarica esercitazione
        </button>
      )}
      {lesson.studyPractice && !initial && !draft && (
        <p role="status" className={styles.notice}>
          La lezione è cambiata: il percorso precedente non è attuale. Genera una nuova proposta.
        </p>
      )}
      {loadState === 'ready' && !draft && (
        <div className={styles.empty}>
          <h4>Costruisci un percorso per questa lezione</h4>
          <p>
            Genera una proposta, controlla consegne, soluzioni e aiuti, poi scegli quando renderla
            disponibile agli studenti.
          </p>
          <ol className={styles.progression}>
            <li>Esempio svolto</li>
            <li>Esercizio guidato</li>
            <li>Prova autonoma</li>
          </ol>
        </div>
      )}
      {generationOpen && (
        <AiStudyPracticeGenerationDialog
          body={body}
          objectives={lesson.obiettivi ?? []}
          callables={callables}
          replacesDraft={!!draft}
          onClose={() => setGenerationOpen(false)}
          onApply={(next) => {
            change(next);
            setGenerationOpen(false);
            setMessage('Proposta pronta da rivedere. Salva la bozza o approvala per pubblicarla.');
          }}
        />
      )}
      {(draft || published) && (
        <div className={styles.publication}>
          <div>
            <span className={styles.badge}>
              {published ? 'Pubblicata agli studenti' : 'Bozza privata'}
            </span>
            {dirty && <span className={styles.dirty}>Modifiche non salvate</span>}
            <p>
              {published
                ? 'Gli studenti vedono l’ultima versione approvata. Salvare una bozza ritira la pubblicazione.'
                : 'Controlla il percorso e approvalo per renderlo visibile agli studenti.'}
            </p>
          </div>
          <button
            type="button"
            disabled={blocked || !published}
            onClick={() =>
              void action(async () => {
                publicationEpoch.current += 1;
                await withdrawStudyPractice(resolvePublicLessonId(lesson, lesson.id), ownerUid, db);
                if (mounted.current) {
                  setPublished(false);
                  onApprovedChange(undefined);
                  setMessage('Esercitazione ritirata dalla vista studente.');
                }
              })
            }
          >
            Ritira pubblicazione
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-error">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className={styles.notice}>
          {message}
        </p>
      )}
      {draft && (
        <>
          <details className={styles.preparation}>
            <summary>Obiettivi e preparazione effettiva</summary>
            <p>
              I riferimenti sono estratti dal testo. La corrispondenza testuale non certifica da
              sola la validità didattica.
            </p>
            {draft.plan.plannedCoverage.length > 0 && (
              <ul>
                {draft.plan.plannedCoverage.map((c) => (
                  <li key={c.objective}>
                    <strong>
                      {c.objective}: {practiceCoverageLabel(c.status)}
                    </strong>
                    {c.sourceQuote && <blockquote>{c.sourceQuote}</blockquote>}
                  </li>
                ))}
              </ul>
            )}
            {draft.plan.objectives.map((o, i) => (
              <details key={i}>
                <summary>{o.capability}</summary>
                <p>Prerequisiti: {o.prerequisites}</p>
                <p>Metodo: {o.method}</p>
                <blockquote>
                  <MarkdownRenderer markdown={o.sourceQuote} />
                </blockquote>
              </details>
            ))}
          </details>
          <div className={styles.sectionHeading}>
            <h4>Attività del percorso</h4>
            <span>{draft.questions.length} attività</span>
          </div>
          {draft.questions.map((q, i) => (
            <details key={i} className={styles.exercise} open={i === 0}>
              <summary>
                <span className={styles.number}>{i + 1}</span>
                <span>
                  <strong>{practiceStageLabel(draft.plan.steps[i]!.stage)}</strong>
                  <span className={styles.capability}>
                    {draft.plan.objectives[draft.plan.steps[i]!.objectiveIndex]?.capability}
                  </span>
                </span>
                <span className={styles.editLabel}>Modifica</span>
              </summary>
              <fieldset disabled={blocked}>
                <legend className={styles.visuallyHidden}>Attività {i + 1}</legend>
                <label>
                  Consegna
                  <textarea
                    value={q.testo}
                    onChange={(e) =>
                      change({
                        ...draft,
                        questions: draft.questions.map((item, n) =>
                          n === i ? { ...item, testo: e.target.value } : item,
                        ),
                      })
                    }
                  />
                </label>
                {draft.plan.steps[i]!.hints.map((hint, h) => (
                  <label key={h}>
                    Aiuto {h + 1}
                    <textarea
                      value={hint}
                      onChange={(e) =>
                        change({
                          ...draft,
                          plan: {
                            ...draft.plan,
                            steps: draft.plan.steps.map((s, n) =>
                              n === i
                                ? {
                                    ...s,
                                    hints: s.hints.map((v, k) => (k === h ? e.target.value : v)),
                                  }
                                : s,
                            ),
                          },
                        })
                      }
                    />
                  </label>
                ))}
                {q.tipo === 'aperta' ? (
                  <label>
                    Soluzione commentata
                    <textarea
                      rows={6}
                      value={q.soluzione}
                      onChange={(e) =>
                        change({
                          ...draft,
                          questions: draft.questions.map((item, n) =>
                            n === i && item.tipo === 'aperta'
                              ? { ...item, soluzione: e.target.value }
                              : item,
                          ),
                        })
                      }
                    />
                  </label>
                ) : (
                  <>
                    {q.opzioni.map((option, k) => (
                      <label key={k}>
                        Opzione {k + 1}
                        <input
                          value={option}
                          onChange={(e) =>
                            change({
                              ...draft,
                              questions: draft.questions.map((item, n) =>
                                n === i && item.tipo !== 'aperta'
                                  ? {
                                      ...item,
                                      opzioni: item.opzioni.map((v, j) =>
                                        j === k ? e.target.value : v,
                                      ),
                                    }
                                  : item,
                              ),
                            })
                          }
                        />
                        <input
                          type="checkbox"
                          checked={q.soluzioneIndici.includes(k)}
                          aria-label={`Opzione ${k + 1} corretta`}
                          onChange={(e) =>
                            change({
                              ...draft,
                              questions: draft.questions.map((item, n) =>
                                n === i && item.tipo !== 'aperta'
                                  ? {
                                      ...item,
                                      soluzioneIndici: e.target.checked
                                        ? [...item.soluzioneIndici, k]
                                        : item.soluzioneIndici.filter((v) => v !== k),
                                    }
                                  : item,
                              ),
                            })
                          }
                        />
                      </label>
                    ))}
                  </>
                )}
              </fieldset>
            </details>
          ))}
          <div className={styles.actions}>
            <button type="button" disabled={blocked} onClick={() => setShowPlayer((v) => !v)}>
              Anteprima studente
            </button>
            {[false, true].map((publish) => (
              <button
                key={String(publish)}
                type="button"
                className={publish ? 'btn-primary' : undefined}
                disabled={blocked || (publish && !lesson.completed)}
                onClick={() =>
                  void action(async () => {
                    publicationEpoch.current += 1;
                    await saveStudyPractice({
                      programId,
                      importId,
                      lessonId: lesson.id,
                      ownerUid,
                      sourceBody: body,
                      practice: draft,
                      publish,
                      db,
                    });
                    if (mounted.current) {
                      setDirty(false);
                      setPublished(publish);
                      onApprovedChange(publish ? practicePoolContext(draft) : undefined);
                      setMessage(
                        publish
                          ? 'Esercitazione pubblicata.'
                          : 'Bozza salvata. Pubblicazione ritirata.',
                      );
                    }
                  })
                }
              >
                {publish ? 'Approva e pubblica' : 'Salva bozza'}
              </button>
            ))}
          </div>
          {!lesson.completed && <p>Per pubblicare, segna la lezione come svolta.</p>}
          {showPlayer && (
            <div className={styles.preview}>
              <h4>Vista studente</h4>
              <StudyPracticePlayer key={JSON.stringify(draft)} practice={draft} />
            </div>
          )}
        </>
      )}
    </section>
  );
}
