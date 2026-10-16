import { useState } from 'react';
import type { StudyPractice } from '../repository/programs/studyPractice.js';
import { practiceStageLabel } from '../repository/programs/studyPracticeLabels.js';
import styles from './StudyPracticePlayer.module.css';
import { MarkdownRenderer } from '../../components/MarkdownRenderer.js';
export function StudyPracticePlayer({ practice }: { practice: StudyPractice }) {
  const [hints, setHints] = useState<Record<number, number>>({});
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [selected, setSelected] = useState<Record<number, number[]>>({});
  const [revealed, setRevealed] = useState<Record<number, boolean>>({});
  return (
    <section aria-label="Esercitazione" className={styles.player}>
      <header className={styles.intro}>
        <div>
          <p className={styles.eyebrow}>Il tuo percorso di studio</p>
          <h3>Impara, prova, mettiti alla prova</h3>
          <p>Allenati senza voto. Le risposte restano qui finché questa esercitazione è aperta.</p>
        </div>
        <span className={styles.count}>{practice.plan.steps.length} attività</span>
      </header>
      {practice.plan.steps.map((step, i) => {
        const q = practice.questions[step.questionOrder]!;
        const example = step.stage === 'esempio';
        const values = selected[i] ?? [];
        return (
          <section key={i} aria-label={`Attività ${i + 1}`} className={styles.activity}>
            <header className={styles.activityHeader}>
              <span className={styles.number}>{i + 1}</span>
              <div>
                <span className={styles.stage}>{practiceStageLabel(step.stage)}</span>
                <h4>{practice.plan.objectives[step.objectiveIndex]?.capability}</h4>
              </div>
            </header>
            <MarkdownRenderer markdown={q.testo} />
            {!example &&
              (q.tipo === 'aperta' ? (
                <label className={styles.answer}>
                  La tua risposta
                  <textarea
                    rows={4}
                    maxLength={16000}
                    value={answers[i] ?? ''}
                    onChange={(e) => setAnswers((v) => ({ ...v, [i]: e.target.value }))}
                  />
                </label>
              ) : (
                <fieldset className={styles.choices}>
                  <legend>
                    Seleziona{' '}
                    {q.tipo === 'chiusa_singola' ? 'una risposta' : 'le risposte corrette'}
                  </legend>
                  {q.opzioni.map((option, n) => (
                    <label
                      key={n}
                      className={`${styles.choice} ${values.includes(n) ? styles.selected : ''}`}
                    >
                      <input
                        type={q.tipo === 'chiusa_singola' ? 'radio' : 'checkbox'}
                        name={`practice-${i}`}
                        checked={values.includes(n)}
                        onChange={(e) => {
                          setSelected((v) => ({
                            ...v,
                            [i]:
                              q.tipo === 'chiusa_singola'
                                ? [n]
                                : e.target.checked
                                  ? [...values, n]
                                  : values.filter((k) => k !== n),
                          }));
                          setRevealed((v) => ({ ...v, [i]: false }));
                        }}
                      />
                      {option}
                    </label>
                  ))}
                </fieldset>
              ))}
            {!example && (
              <div className={styles.help}>
                <button
                  type="button"
                  disabled={(hints[i] ?? 0) >= step.hints.length}
                  onClick={() => setHints((v) => ({ ...v, [i]: (v[i] ?? 0) + 1 }))}
                >
                  Mostra aiuto successivo
                </button>
                {step.hints.slice(0, hints[i] ?? 0).map((hint, n) => (
                  <div key={n} className={styles.hint}>
                    <strong>Aiuto {n + 1}</strong>
                    <MarkdownRenderer markdown={hint} />
                  </div>
                ))}
                <button type="button" onClick={() => setRevealed((v) => ({ ...v, [i]: true }))}>
                  {q.tipo === 'aperta' ? 'Confronta con la soluzione' : 'Controlla risposta'}
                </button>
              </div>
            )}
            {(example || revealed[i]) &&
              (q.tipo === 'aperta' ? (
                <div className={styles.solution}>
                  <h5>{example ? 'Svolgimento ragionato' : 'Soluzione per il confronto'}</h5>
                  <MarkdownRenderer markdown={q.soluzione} />
                  {!example && (
                    <p>
                      Confronta metodo, passaggi e motivazione: questa risposta non viene valutata
                      automaticamente.
                    </p>
                  )}
                </div>
              ) : (
                <div role="status" className={styles.feedback}>
                  {!example &&
                    (values.length === q.soluzioneIndici.length &&
                    values.every((n) => q.soluzioneIndici.includes(n))
                      ? 'Corretto.'
                      : 'Da rivedere: riprendi gli aiuti e prova ancora.')}
                  <details open={example}>
                    <summary>Mostra risposte corrette</summary>
                    {q.soluzioneIndici.map((n) => (
                      <p key={n}>{q.opzioni[n]}</p>
                    ))}
                  </details>
                </div>
              ))}
          </section>
        );
      })}
    </section>
  );
}
