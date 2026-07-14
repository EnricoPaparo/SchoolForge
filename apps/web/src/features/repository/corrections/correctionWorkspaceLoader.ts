import { doc, getDoc } from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import type {
  CorrectionDoc,
  CorrectionReturnDoc,
  PublicVerificationQuestion,
  SubmissionDoc,
  VerificationDoc,
  VerificationTeacherQuestionSnapshot,
} from '../../../types/firestore.js';
import { loadPublishedProjectionQuestions, openOrLoadCorrection } from './correctionsService.js';

/**
 * Canonical question the correction workspace renders — assembled once by the
 * loader so the component never has to branch on recent-vs-legacy itself.
 *
 * - `soluzione` carries the frozen teacher solution when available.
 * - `solutionUnavailable` is `true` for a legacy verification activated before
 *   the immutable snapshot-with-solutions existed: text/type/options come from
 *   the frozen published projection, but there is deliberately NO solution to
 *   show — it is never reconstructed from the (possibly since-edited) live pool.
 */
export type CorrectionWorkspaceQuestion = {
  order: number;
  tipo: 'aperta' | 'chiusa_singola' | 'chiusa_multipla';
  maxPoints: number;
  /** Frozen difficulty/weight from the teacher snapshot; absent on legacy verifications. */
  difficolta?: 1 | 2 | 3;
  peso?: 1 | 2 | 3;
  testo: string;
  opzioni?: { id: string; testo: string }[];
  soluzione: string | string[] | null;
  solutionUnavailable: boolean;
};

export type CorrectionWorkspaceData = {
  submission: SubmissionDoc;
  verification: VerificationDoc;
  correction: CorrectionDoc;
  /**
   * The canonical questions to render, ordered by `order`. Derived from the
   * verification's `teacherSnapshot.questions` when present (with solutions),
   * otherwise from the frozen published projection (text/type/options only,
   * `solutionUnavailable: true`). Never read from the live pool or Storage.
   */
  questions: CorrectionWorkspaceQuestion[];
  /** `null` when the correction has never been returned yet. */
  correctionReturn: CorrectionReturnDoc | null;
};

function fromTeacherSnapshot(
  questions: VerificationTeacherQuestionSnapshot[],
): CorrectionWorkspaceQuestion[] {
  return [...questions]
    .sort((a, b) => a.order - b.order)
    .map((q) => ({
      order: q.order,
      tipo: q.tipo,
      maxPoints: q.maxPoints,
      ...(q.difficolta !== undefined ? { difficolta: q.difficolta } : {}),
      ...(q.peso !== undefined ? { peso: q.peso } : {}),
      testo: q.testo,
      ...(q.opzioni ? { opzioni: q.opzioni } : {}),
      soluzione: q.soluzione,
      solutionUnavailable: false,
    }));
}

function fromProjection(questions: PublicVerificationQuestion[]): CorrectionWorkspaceQuestion[] {
  return [...questions]
    .sort((a, b) => a.order - b.order)
    .map((q) => ({
      order: q.order,
      tipo: q.tipo,
      maxPoints: q.maxPoints,
      testo: q.testo,
      ...(q.opzioni ? { opzioni: q.opzioni } : {}),
      soluzione: null,
      solutionUnavailable: true,
    }));
}

/**
 * Small composite read for the M4-02 correction workspace — not a new
 * business-rule surface, just the reads the workspace needs assembled in one
 * place: the submitted submission, the verification, the correction (via
 * `openOrLoadCorrection`, so opening the workspace is what actually creates it
 * the first time), the canonical questions, and the return projection if one
 * already exists. Used both for the initial open and to refresh local state
 * after every mutating action, so the UI never has to guess what a service
 * call changed — it just re-reads.
 *
 * Projection reads are capped at one per open: a recent verification renders
 * from `teacherSnapshot.questions` (no projection read in the loader); a legacy
 * one reuses the projection `openOrLoadCorrection` already read while creating
 * the correction, falling back to a single read only when the correction
 * already existed. Never the live pool, never Storage.
 *
 * Every write remains the exclusive responsibility of `correctionsService.ts`;
 * this module never writes anything.
 */
export async function loadCorrectionWorkspace(
  submissionId: string,
  ownerUid: string,
  db: Firestore,
): Promise<CorrectionWorkspaceData> {
  const submissionSnap = await getDoc(doc(db, 'submissions', submissionId));
  if (!submissionSnap.exists()) {
    throw new Error('Consegna non trovata.');
  }
  const submission = submissionSnap.data() as SubmissionDoc;
  if (submission.status !== 'submitted') {
    throw new Error('Impossibile correggere: la consegna non è ancora stata inviata.');
  }
  if (submission.ownerUid !== ownerUid) {
    throw new Error('Impossibile correggere: la consegna non appartiene a questo docente.');
  }

  const verificationSnap = await getDoc(doc(db, 'verifications', submission.verificationId));
  if (!verificationSnap.exists()) {
    throw new Error('Verifica non trovata.');
  }
  const verification = verificationSnap.data() as VerificationDoc;

  const { correction, projectionQuestions } = await openOrLoadCorrection(
    submissionId,
    ownerUid,
    db,
  );

  const teacherQuestions = verification.teacherSnapshot?.questions;
  let questions: CorrectionWorkspaceQuestion[];
  if (teacherQuestions && teacherQuestions.length > 0) {
    questions = fromTeacherSnapshot(teacherQuestions);
  } else {
    // Legacy verification: reuse the projection the create path already read
    // when available, otherwise read it exactly once here. Never the pool.
    const projection =
      projectionQuestions ??
      (await loadPublishedProjectionQuestions(submission.verificationId, db));
    questions = fromProjection(projection);
  }

  const returnSnap = await getDoc(doc(db, 'correctionReturns', submissionId));
  const correctionReturn = returnSnap.exists() ? (returnSnap.data() as CorrectionReturnDoc) : null;

  return { submission, verification, correction, questions, correctionReturn };
}
