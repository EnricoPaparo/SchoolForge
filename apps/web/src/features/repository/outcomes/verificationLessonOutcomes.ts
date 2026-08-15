import type { CorrectionStatus, QuestionEvaluation } from '../../../types/firestore.js';
import { isValidQuestionPoints } from '../corrections/correctionContract.js';

export type VerificationOutcomeSource = {
  order: number;
  udaDir: string;
  lessonFilename: string;
  udaTitle: string;
  lessonTitle: string;
};

export type VerificationOutcomeCorrection = {
  correctionId: string;
  studentUid: string;
  status: CorrectionStatus;
  evaluations: Record<string, QuestionEvaluation>;
};

export type LessonOutcome = {
  udaDir: string;
  lessonFilename: string;
  lessonTitle: string;
  masteryPercentage: number;
  questionCount: number;
  evaluationCount: number;
};

export type UdaOutcome = {
  udaDir: string;
  udaTitle: string;
  masteryPercentage: number;
  questionCount: number;
  evaluationCount: number;
  lessons: LessonOutcome[];
};

export type VerificationLessonOutcomesReport = {
  finalizedCorrections: number;
  submittedCount: number;
  udas: UdaOutcome[];
};

export class VerificationLessonOutcomesError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VerificationLessonOutcomesError';
  }
}

type MutableAggregate = {
  sumRatios: number;
  evaluationCount: number;
  questionOrders: Set<number>;
};

function aggregate(): MutableAggregate {
  return { sumRatios: 0, evaluationCount: 0, questionOrders: new Set<number>() };
}

function percentage(value: MutableAggregate): number {
  return Math.round((value.sumRatios / value.evaluationCount) * 100);
}

function addEvaluation(target: MutableAggregate, evaluation: QuestionEvaluation): void {
  target.sumRatios += evaluation.points! / evaluation.maxPoints;
  target.evaluationCount += 1;
  target.questionOrders.add(evaluation.order);
}

/**
 * ESITI-01 — derivazione pura degli esiti per UDA e lezione.
 *
 * Ogni valutazione pesa uno: la padronanza è la media dei rapporti
 * `points / maxPoints`, non il rapporto fra due somme. In questo modo una
 * domanda da quattro punti non vale implicitamente quattro volte una domanda
 * da un punto. Una domanda vista da meno studenti pesa invece meno, come
 * richiesto dal contratto delle verifiche differenziate.
 *
 * `returned` è definitivo quanto `completed`: per contratto una correzione può
 * diventare `returned` soltanto dopo essere stata completata. `in_progress`
 * viene sempre esclusa.
 */
export function deriveVerificationLessonOutcomes(input: {
  corrections: readonly VerificationOutcomeCorrection[];
  sources: readonly VerificationOutcomeSource[];
  submittedCount: number;
}): VerificationLessonOutcomesReport {
  if (!Number.isInteger(input.submittedCount) || input.submittedCount < 0) {
    throw new VerificationLessonOutcomesError('Conteggio delle consegne non valido.');
  }

  const sourceByOrder = new Map<number, VerificationOutcomeSource>();
  for (const source of input.sources) {
    if (!Number.isInteger(source.order) || source.order < 0 || sourceByOrder.has(source.order)) {
      throw new VerificationLessonOutcomesError('Origine delle domande non coerente.');
    }
    if (
      typeof source.udaDir !== 'string' ||
      source.udaDir.length === 0 ||
      typeof source.lessonFilename !== 'string' ||
      source.lessonFilename.length === 0 ||
      typeof source.udaTitle !== 'string' ||
      source.udaTitle.trim().length === 0 ||
      typeof source.lessonTitle !== 'string' ||
      source.lessonTitle.trim().length === 0
    ) {
      throw new VerificationLessonOutcomesError('Titoli didattici mancanti o non validi.');
    }
    sourceByOrder.set(source.order, source);
  }

  const finalized = input.corrections.filter((correction) => {
    if (!['in_progress', 'completed', 'returned'].includes(correction.status)) {
      throw new VerificationLessonOutcomesError('Stato di una correzione non valido.');
    }
    return correction.status === 'completed' || correction.status === 'returned';
  });
  if (finalized.length > input.submittedCount) {
    throw new VerificationLessonOutcomesError(
      'Le correzioni definitive superano le consegne disponibili.',
    );
  }
  const seenStudents = new Set<string>();
  const lessonAggregates = new Map<
    string,
    { source: VerificationOutcomeSource; value: MutableAggregate }
  >();
  const udaAggregates = new Map<
    string,
    { source: VerificationOutcomeSource; value: MutableAggregate }
  >();

  for (const correction of finalized) {
    if (
      typeof correction.correctionId !== 'string' ||
      correction.correctionId.length === 0 ||
      typeof correction.studentUid !== 'string' ||
      correction.studentUid.length === 0 ||
      !correction.evaluations ||
      typeof correction.evaluations !== 'object' ||
      Array.isArray(correction.evaluations)
    ) {
      throw new VerificationLessonOutcomesError('Correzione definitiva non valida.');
    }
    if (seenStudents.has(correction.studentUid)) {
      throw new VerificationLessonOutcomesError(
        'Sono presenti più correzioni per lo stesso studente.',
      );
    }
    seenStudents.add(correction.studentUid);

    const evaluations = Object.entries(correction.evaluations);
    if (evaluations.length === 0) {
      throw new VerificationLessonOutcomesError(
        'Una correzione definitiva non contiene valutazioni.',
      );
    }
    const seenOrders = new Set<number>();
    for (const [key, evaluation] of evaluations) {
      if (
        !evaluation ||
        typeof evaluation !== 'object' ||
        !Number.isInteger(evaluation.order) ||
        String(evaluation.order) !== key ||
        seenOrders.has(evaluation.order) ||
        evaluation.points === null ||
        typeof evaluation.maxPoints !== 'number' ||
        evaluation.maxPoints <= 0 ||
        !isValidQuestionPoints(evaluation.points, evaluation.maxPoints)
      ) {
        throw new VerificationLessonOutcomesError('Una valutazione definitiva non è valida.');
      }
      seenOrders.add(evaluation.order);
      const source = sourceByOrder.get(evaluation.order);
      if (!source) {
        throw new VerificationLessonOutcomesError(
          `La domanda ${evaluation.order + 1} non ha un’origine didattica riconoscibile.`,
        );
      }
      const lessonKey = `${source.udaDir}\u0000${source.lessonFilename}`;
      const lesson = lessonAggregates.get(lessonKey) ?? { source, value: aggregate() };
      addEvaluation(lesson.value, evaluation);
      lessonAggregates.set(lessonKey, lesson);

      const uda = udaAggregates.get(source.udaDir) ?? { source, value: aggregate() };
      addEvaluation(uda.value, evaluation);
      udaAggregates.set(source.udaDir, uda);
    }
  }

  const udas = [...udaAggregates.entries()].map(([udaDir, uda]) => {
    const lessons = [...lessonAggregates.values()]
      .filter((lesson) => lesson.source.udaDir === udaDir)
      .map(({ source, value }) => ({
        udaDir: source.udaDir,
        lessonFilename: source.lessonFilename,
        lessonTitle: source.lessonTitle,
        masteryPercentage: percentage(value),
        questionCount: value.questionOrders.size,
        evaluationCount: value.evaluationCount,
      }))
      .sort(
        (a, b) =>
          a.masteryPercentage - b.masteryPercentage ||
          a.lessonTitle.localeCompare(b.lessonTitle, 'it'),
      );
    return {
      udaDir,
      udaTitle: uda.source.udaTitle,
      masteryPercentage: percentage(uda.value),
      questionCount: uda.value.questionOrders.size,
      evaluationCount: uda.value.evaluationCount,
      lessons,
    };
  });
  udas.sort(
    (a, b) =>
      a.masteryPercentage - b.masteryPercentage || a.udaTitle.localeCompare(b.udaTitle, 'it'),
  );

  return {
    finalizedCorrections: finalized.length,
    submittedCount: input.submittedCount,
    udas,
  };
}
