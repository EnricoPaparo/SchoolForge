import { useEffect, useMemo, useRef, useState } from 'react';
import type { LessonItem } from '../repository/programs/programsService.js';
import { db, functions } from '../../lib/firebase.js';
import {
  createAiContentCallables,
  describeAiContentError,
  formatMicroUsd,
  newRequestId,
  type AiPoolContentRequest,
  type AiPoolPreviewResult,
} from '../repository/pools/aiContentClient.js';
import {
  currentStudyPractice,
  practicePoolContext,
  validateStudyPractice,
  type StudyPractice,
} from '../repository/programs/studyPractice.js';
import {
  saveStudyPractice,
  withdrawStudyPractice,
  loadPublicStudyPractice,
} from '../repository/programs/studyPracticeService.js';
import { resolvePublicLessonId } from '../repository/programs/publicLessonId.js';
import { MarkdownRenderer } from '../../components/MarkdownRenderer.js';
import { StudyPracticePlayer } from '../student/StudyPracticePlayer.js';
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
  const [draft, setDraft] = useState<StudyPractice | null>(initial);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [activityCount, setActivityCount] = useState(6);
  const [focus, setFocus] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [preview, setPreview] = useState<AiPoolPreviewResult | null>(null);
  const [request, setRequest] = useState<AiPoolContentRequest | null>(null);
  const [showPlayer, setShowPlayer] = useState(false);
  const callables = useMemo(() => createAiContentCallables(functions), []);
  const mounted = useRef(true);
  const locked = useRef(false);
  const publicationEpoch = useRef(0);
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
        if (active && epoch === publicationEpoch.current) onApprovedChange(practicePoolContext(p));
      },
      () => {
        if (active && epoch === publicationEpoch.current) onApprovedChange(undefined);
      },
    );
    return () => {
      active = false;
    };
  }, [lesson.id, body, onApprovedChange]);
  useEffect(() => {
    onDirtyChange(dirty);
    return () => onDirtyChange(false);
  }, [dirty, onDirtyChange]);
  async function action(work: () => Promise<void>) {
    if (locked.current) return;
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
      aria-busy={busy}
    >
      <h3>Esercitazioni per lo studente</h3>
      <p>
        Un percorso con esempi svolti, guida e lavoro autonomo. Controlla i riferimenti alla lezione
        e gli aiuti prima di pubblicare. Le risposte dello studente restano nella sessione.
      </p>
      {lesson.studyPractice && !initial && !draft && (
        <p role="status">
          La lezione è cambiata: il percorso precedente non è attuale. Genera una nuova proposta.
        </p>
      )}
      <label>
        Estensione del percorso{' '}
        <select
          disabled={busy}
          value={activityCount}
          onChange={(e) => {
            setActivityCount(Number(e.target.value));
            setPreview(null);
            setRequest(null);
          }}
        >
          <option value={3}>Breve — 3 attività</option>
          <option value={6}>Standard — 6 attività</option>
          <option value={9}>Estesa — 9 attività</option>
        </select>
      </label>
      <label>
        Indicazioni e capacità su cui concentrarsi (facoltative)
        <textarea
          maxLength={500}
          disabled={busy}
          value={focus}
          onChange={(e) => {
            setFocus(e.target.value);
            setPreview(null);
            setRequest(null);
          }}
        />
      </label>
      <p>
        Ogni capacità allenata richiede almeno un esempio, una guida e un esercizio autonomo. Il
        riepilogo distingue la preparazione nella lezione dalla copertura delle esercitazioni.
      </p>
      <div className={styles.actions}>
        <button
          type="button"
          disabled={busy || !body.trim()}
          onClick={() =>
            void action(async () => {
              const next: AiPoolContentRequest = {
                kind: 'pool',
                purpose: 'practice',
                plannedObjectives: lesson.obiettivi ?? [],
                requestId: newRequestId(),
                modelProfile: 'economy',
                level: 'balanced',
                counts: { aperta: activityCount - 1, chiusa_singola: 1, chiusa_multipla: 0 },
                ...(focus.trim() ? { teacherGuidance: focus.trim() } : {}),
                lessonSource: body,
                existingPoolQuestionCount: 0,
              };
              const estimate = await callables.preview(next);
              if (mounted.current) {
                setRequest(next);
                setPreview(estimate);
              }
            })
          }
        >
          Stima nuova esercitazione
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            void action(async () => {
              publicationEpoch.current += 1;
              await withdrawStudyPractice(resolvePublicLessonId(lesson, lesson.id), ownerUid, db);
              if (mounted.current) {
                onApprovedChange(undefined);
                setMessage('Esercitazione ritirata dalla vista studente.');
              }
            })
          }
        >
          Ritira pubblicazione
        </button>
      </div>
      {preview && request && (
        <div role="status">
          <p>
            Stima: {formatMicroUsd(preview.estimatedCostMicroUsd)}. Prenotazione massima:{' '}
            {formatMicroUsd(preview.reservationCostMicroUsd)}. La generazione sostituirà la proposta
            locale.
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void action(async () => {
                const result = await callables.generate(request);
                const next = validateStudyPractice(
                  {
                    version: 1,
                    sourceBody: body,
                    plan: result.output.studyPlan,
                    questions: result.output.questions,
                  },
                  body,
                );
                if (mounted.current) {
                  change(next);
                  setPreview(null);
                }
              })
            }
          >
            Genera proposta
          </button>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      {draft && (
        <>
          <h4>Obiettivi e preparazione effettiva</h4>
          <p>
            I riferimenti sono estratti dal testo. La corrispondenza testuale non certifica da sola
            la validità didattica.
          </p>
          {draft.plan.plannedCoverage.length > 0 && (
            <ul>
              {draft.plan.plannedCoverage.map((c) => (
                <li key={c.objective}>
                  <strong>
                    {c.objective}: {c.status}
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
          {draft.questions.map((q, i) => (
            <fieldset key={i} disabled={busy} className={styles.exercise}>
              <legend>
                {i + 1}. {draft.plan.steps[i]?.stage} —{' '}
                {draft.plan.objectives[draft.plan.steps[i]!.objectiveIndex]?.capability}
              </legend>
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
          ))}
          <div className={styles.actions}>
            <button type="button" disabled={busy} onClick={() => setShowPlayer((v) => !v)}>
              Anteprima studente
            </button>
            {[false, true].map((publish) => (
              <button
                key={String(publish)}
                type="button"
                disabled={busy || (publish && !lesson.completed)}
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
          {showPlayer && <StudyPracticePlayer key={JSON.stringify(draft)} practice={draft} />}
        </>
      )}
    </section>
  );
}
