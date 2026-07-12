import { doc, getDoc } from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import type {
  CorrectionDoc,
  CorrectionReturnDoc,
  SubmissionDoc,
  VerificationDoc,
} from '../../../types/firestore.js';
import { openOrLoadCorrection } from './correctionsService.js';

export type CorrectionWorkspaceData = {
  submission: SubmissionDoc;
  verification: VerificationDoc;
  correction: CorrectionDoc;
  /** `null` when the correction has never been returned yet. */
  correctionReturn: CorrectionReturnDoc | null;
};

/**
 * Small composite read for the M4-02 correction workspace — not a new
 * business-rule surface, just the four reads the workspace needs assembled
 * in one place: the submitted submission, the verification's
 * `teacherSnapshot` (question text/options/frozen solution — never the
 * live pool), the correction (via `openOrLoadCorrection`, so opening the
 * workspace is what actually creates it the first time), and the return
 * projection if one already exists. Used both for the initial open and to
 * refresh local state after every mutating action, so the UI never has to
 * guess what a service call changed — it just re-reads.
 *
 * Every write remains the exclusive responsibility of
 * `correctionsService.ts`; this module never writes anything.
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

  const correction = await openOrLoadCorrection(submissionId, ownerUid, db);

  const returnSnap = await getDoc(doc(db, 'correctionReturns', submissionId));
  const correctionReturn = returnSnap.exists() ? (returnSnap.data() as CorrectionReturnDoc) : null;

  return { submission, verification, correction, correctionReturn };
}
