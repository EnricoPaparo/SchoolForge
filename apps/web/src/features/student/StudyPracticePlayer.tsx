import { useState } from 'react';
import type { StudyPractice } from '../repository/programs/studyPractice.js';
import { MarkdownRenderer } from '../../components/MarkdownRenderer.js';
export function StudyPracticePlayer({ practice }: { practice: StudyPractice }) {
  const [hints, setHints] = useState<Record<number, number>>({});
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [selected, setSelected] = useState<Record<number, number[]>>({});
  const [revealed, setRevealed] = useState<Record<number, boolean>>({});
  return (
    <section aria-label="Esercitazione">
      <p>Allenati senza voto. Le risposte restano qui finché questa esercitazione è aperta.</p>
      {practice.plan.steps.map((step, i) => {
        const q = practice.questions[step.questionOrder]!;
        const example = step.stage === 'esempio';
        const values = selected[i] ?? [];
        return (
          <section key={i} aria-label={`Attività ${i + 1}`}>
            <h4>
              {i + 1}. {step.stage} — {practice.plan.objectives[step.objectiveIndex]?.capability}
            </h4>
            <MarkdownRenderer markdown={q.testo} />
            {!example &&
              (q.tipo === 'aperta' ? (
                <label>
                  La tua risposta
                  <textarea
                    rows={4}
                    maxLength={16000}
                    value={answers[i] ?? ''}
                    onChange={(e) => setAnswers((v) => ({ ...v, [i]: e.target.value }))}
                  />
                </label>
              ) : (
                <fieldset>
                  <legend>
                    Seleziona{' '}
                    {q.tipo === 'chiusa_singola' ? 'una risposta' : 'le risposte corrette'}
                  </legend>
                  {q.opzioni.map((option, n) => (
                    <label key={n} style={{ display: 'block' }}>
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
              <>
                <button
                  type="button"
                  disabled={(hints[i] ?? 0) >= step.hints.length}
                  onClick={() => setHints((v) => ({ ...v, [i]: (v[i] ?? 0) + 1 }))}
                >
                  Mostra aiuto successivo
                </button>
                {step.hints.slice(0, hints[i] ?? 0).map((hint, n) => (
                  <div key={n}>
                    <strong>Aiuto {n + 1}</strong>
                    <MarkdownRenderer markdown={hint} />
                  </div>
                ))}
                <button type="button" onClick={() => setRevealed((v) => ({ ...v, [i]: true }))}>
                  {q.tipo === 'aperta' ? 'Confronta con la soluzione' : 'Controlla risposta'}
                </button>
              </>
            )}
            {(example || revealed[i]) &&
              (q.tipo === 'aperta' ? (
                <div>
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
                <div role="status">
                  {values.length === q.soluzioneIndici.length &&
                  values.every((n) => q.soluzioneIndici.includes(n))
                    ? 'Corretto.'
                    : 'Da rivedere: riprendi gli aiuti e prova ancora.'}
                  <details>
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
