import type { StudyPractice } from '../studyPractice.js';
export const STUDY_BODY =
  'Per seguire il ciclo annota il valore iniziale, controlla la condizione, esegui il corpo e aggiorna la variabile prima di ripetere.';
export function studyFixture(): StudyPractice {
  return {
    version: 1,
    sourceBody: STUDY_BODY,
    plan: {
      plannedCoverage: [
        { objective: 'Prevedere output', status: 'preparato', sourceQuote: STUDY_BODY },
      ],
      objectives: [
        {
          capability: 'Tracciare un ciclo',
          prerequisites: 'Variabili',
          method: 'Annotare ogni iterazione',
          sourceQuote: STUDY_BODY,
        },
      ],
      steps: ['esempio', 'guidato', 'autonomo'].map((stage, i) => ({
        questionOrder: i,
        objectiveIndex: 0,
        stage: stage as 'esempio' | 'guidato' | 'autonomo',
        hints: ['Prima controlla la condizione.', 'Poi aggiorna la variabile.'],
      })),
    },
    questions: [
      {
        order: 0,
        tipo: 'aperta',
        testo: 'Segui questo ciclo svolto.',
        difficolta: 1,
        soluzione: 'Controllo, esecuzione, aggiornamento: questi sono i passaggi.',
      },
      {
        order: 1,
        tipo: 'aperta',
        testo: 'Completa la seconda iterazione.',
        difficolta: 2,
        soluzione: 'Annota il nuovo valore prima del controllo.',
      },
      {
        order: 2,
        tipo: 'chiusa_singola',
        testo: 'Che cosa viene controllato prima?',
        difficolta: 2,
        opzioni: ['Condizione', 'Aggiornamento'],
        soluzioneIndici: [0],
      },
    ],
  };
}
