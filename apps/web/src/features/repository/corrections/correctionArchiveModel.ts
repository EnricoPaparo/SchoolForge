import { doc, getDoc } from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import type {
  AnswerValue,
  CorrectionDoc,
  SubmissionDoc,
  VerificationDoc,
  VerificationTeacherQuestionSnapshot,
} from '../../../types/firestore.js';
import { resolveAssignedQuestions } from '../verifications/assignedVariant.js';
import { computeCorrectionTotals, isValidQuestionPoints } from './correctionContract.js';

export type CorrectionArchiveStatus = 'completed' | 'returned';

export type CorrectionArchiveQuestion = {
  order: number;
  questionText: string;
  answerText: string;
  points: number;
  maxPoints: number;
  teacherFeedback?: string;
};

/** Closed, privacy-minimal model consumed by the PDF renderer. */
export type CorrectionArchiveModel = {
  verificationTitle: string;
  studentName: string;
  className: string | null;
  submittedAt: Date | null;
  correctionStatus: CorrectionArchiveStatus;
  totalPoints: number;
  maxPoints: number;
  percentage: number | null;
  questions: CorrectionArchiveQuestion[];
  generalFeedback?: string;
};

export type CorrectionArchiveCandidate = {
  submissionId: string;
  studentUid: string;
  studentName: string;
};

export type CorrectionArchiveLoadFailure = {
  candidate: CorrectionArchiveCandidate;
  message: string;
};

export type CorrectionArchiveLoadResult = {
  models: Array<{ candidate: CorrectionArchiveCandidate; model: CorrectionArchiveModel }>;
  failures: CorrectionArchiveLoadFailure[];
};

const NO_ANSWER = 'Nessuna risposta';

function fail(): never {
  throw new Error('Dati della consegna o della correzione non coerenti.');
}

function toDate(value: unknown): Date | null {
  if (!value || typeof value !== 'object') return null;
  if ('toDate' in value && typeof value.toDate === 'function') {
    const date = value.toDate();
    return date instanceof Date && !Number.isNaN(date.getTime()) ? date : null;
  }
  if ('seconds' in value && typeof value.seconds === 'number') {
    const date = new Date(value.seconds * 1000);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

function optionTextById(question: VerificationTeacherQuestionSnapshot): Map<string, string> {
  if (!Array.isArray(question.opzioni) || question.opzioni.length === 0) fail();
  const result = new Map<string, string>();
  for (const option of question.opzioni) {
    if (
      typeof option?.id !== 'string' ||
      option.id.trim() === '' ||
      typeof option.testo !== 'string' ||
      option.testo.trim() === '' ||
      result.has(option.id)
    ) {
      fail();
    }
    result.set(option.id, option.testo);
  }
  return result;
}

export function formatArchiveAnswer(
  question: VerificationTeacherQuestionSnapshot,
  answer: AnswerValue | undefined,
): string {
  if (question.tipo === 'aperta') {
    if (answer === undefined) return NO_ANSWER;
    if (answer.tipo !== 'aperta' || typeof answer.testo !== 'string') fail();
    return answer.testo.trim() === '' ? NO_ANSWER : answer.testo;
  }

  const optionById = optionTextById(question);
  if (question.tipo === 'chiusa_singola') {
    if (answer === undefined) return NO_ANSWER;
    if (answer.tipo !== 'chiusa_singola') fail();
    if (answer.selectedId === null) return NO_ANSWER;
    if (typeof answer.selectedId !== 'string' || !optionById.has(answer.selectedId)) fail();
    return optionById.get(answer.selectedId)!;
  }

  if (answer === undefined) return NO_ANSWER;
  if (answer.tipo !== 'chiusa_multipla' || !Array.isArray(answer.selectedIds)) fail();
  if (answer.selectedIds.length === 0) return NO_ANSWER;
  const unique = new Set(answer.selectedIds);
  if (unique.size !== answer.selectedIds.length) fail();
  return answer.selectedIds
    .map((id) => {
      if (typeof id !== 'string' || !optionById.has(id)) fail();
      return `• ${optionById.get(id)!}`;
    })
    .join('\n');
}

export function buildCorrectionArchiveModel(params: {
  verificationId: string;
  verification: VerificationDoc;
  ownerUid: string;
  candidate: CorrectionArchiveCandidate;
  submission: SubmissionDoc;
  correction: CorrectionDoc;
}): CorrectionArchiveModel {
  const { verificationId, verification, ownerUid, candidate, submission, correction } = params;
  if (
    verification.ownerUid !== ownerUid ||
    submission.submissionId !== candidate.submissionId ||
    submission.verificationId !== verificationId ||
    submission.studentUid !== candidate.studentUid ||
    submission.ownerUid !== ownerUid ||
    submission.status !== 'submitted' ||
    (submission.correctionStatus !== undefined &&
      submission.correctionStatus !== correction.status) ||
    correction.submissionId !== candidate.submissionId ||
    correction.verificationId !== verificationId ||
    correction.studentUid !== candidate.studentUid ||
    correction.ownerUid !== ownerUid ||
    (correction.status !== 'completed' && correction.status !== 'returned')
  ) {
    fail();
  }

  const snapshot = verification.teacherSnapshot;
  if (
    !snapshot ||
    typeof snapshot.title !== 'string' ||
    snapshot.title.trim() === '' ||
    (snapshot.className !== null && typeof snapshot.className !== 'string') ||
    !Array.isArray(snapshot.questions) ||
    snapshot.questions.length === 0
  ) {
    fail();
  }
  const questions = resolveAssignedQuestions(snapshot, submission);
  if (questions.length === 0) fail();
  const allowedKeys = new Set(questions.map((question) => question.order.toString()));
  if (Object.keys(submission.answers ?? {}).some((key) => !allowedKeys.has(key))) fail();
  const evaluationKeys = Object.keys(correction.evaluations ?? {});
  if (
    evaluationKeys.length !== allowedKeys.size ||
    evaluationKeys.some((key) => !allowedKeys.has(key))
  ) {
    fail();
  }

  const archiveQuestions = questions.map((question) => {
    if (
      !Number.isInteger(question.order) ||
      typeof question.testo !== 'string' ||
      question.testo.trim() === '' ||
      !Number.isInteger(question.difficolta) ||
      question.difficolta < 1 ||
      question.difficolta > 5 ||
      question.maxPoints !== question.difficolta
    ) {
      fail();
    }
    const key = question.order.toString();
    const evaluation = correction.evaluations[key];
    if (
      !evaluation ||
      evaluation.order !== question.order ||
      evaluation.maxPoints !== question.maxPoints ||
      evaluation.points === null ||
      !isValidQuestionPoints(evaluation.points, evaluation.maxPoints) ||
      (evaluation.feedback !== undefined && typeof evaluation.feedback !== 'string')
    ) {
      fail();
    }
    return {
      order: question.order,
      questionText: question.testo,
      answerText: formatArchiveAnswer(question, submission.answers?.[key]),
      points: evaluation.points,
      maxPoints: evaluation.maxPoints,
      ...(evaluation.feedback?.trim() ? { teacherFeedback: evaluation.feedback } : {}),
    };
  });

  const totals = computeCorrectionTotals(correction.evaluations);
  if (
    totals.totalPoints !== correction.totalPoints ||
    totals.maxPoints !== correction.maxPoints ||
    totals.percentage !== correction.percentage
  ) {
    fail();
  }

  return {
    verificationTitle: snapshot.title,
    studentName: candidate.studentName.trim() || 'Studente',
    className: snapshot.className,
    submittedAt: toDate(submission.submittedAt),
    correctionStatus: correction.status,
    totalPoints: correction.totalPoints,
    maxPoints: correction.maxPoints,
    percentage: correction.percentage,
    questions: archiveQuestions,
    ...(correction.generalFeedback?.trim() ? { generalFeedback: correction.generalFeedback } : {}),
  };
}

export async function loadCorrectionArchiveModel(params: {
  verificationId: string;
  verification: VerificationDoc;
  ownerUid: string;
  candidate: CorrectionArchiveCandidate;
  db: Firestore;
}): Promise<CorrectionArchiveModel> {
  const { candidate, db } = params;
  const [submissionSnap, correctionSnap] = await Promise.all([
    getDoc(doc(db, 'submissions', candidate.submissionId)),
    getDoc(doc(db, 'corrections', candidate.submissionId)),
  ]);
  if (!submissionSnap.exists() || !correctionSnap.exists()) fail();
  return buildCorrectionArchiveModel({
    ...params,
    submission: submissionSnap.data() as SubmissionDoc,
    correction: correctionSnap.data() as CorrectionDoc,
  });
}

/** Loads at most three submissions concurrently and preserves candidate order. */
export async function loadCorrectionArchiveModels(params: {
  verificationId: string;
  verification: VerificationDoc;
  ownerUid: string;
  candidates: readonly CorrectionArchiveCandidate[];
  db: Firestore;
  loadOne?: typeof loadCorrectionArchiveModel;
}): Promise<CorrectionArchiveLoadResult> {
  const loadOne = params.loadOne ?? loadCorrectionArchiveModel;
  const output: Array<
    | { ok: true; candidate: CorrectionArchiveCandidate; model: CorrectionArchiveModel }
    | { ok: false; candidate: CorrectionArchiveCandidate; message: string }
    | undefined
  > = new Array(params.candidates.length);
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < params.candidates.length) {
      const index = cursor++;
      const candidate = params.candidates[index]!;
      try {
        const model = await loadOne({ ...params, candidate });
        output[index] = { ok: true, candidate, model };
      } catch {
        output[index] = {
          ok: false,
          candidate,
          message: 'Dati non coerenti o non disponibili.',
        };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(3, params.candidates.length) }, () => worker()));
  return {
    models: output
      .filter((entry): entry is Extract<NonNullable<(typeof output)[number]>, { ok: true }> =>
        Boolean(entry?.ok),
      )
      .map(({ candidate, model }) => ({ candidate, model })),
    failures: output
      .filter((entry): entry is Extract<NonNullable<(typeof output)[number]>, { ok: false }> =>
        Boolean(entry && !entry.ok),
      )
      .map(({ candidate, message }) => ({ candidate, message })),
  };
}
