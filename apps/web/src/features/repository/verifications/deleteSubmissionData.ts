import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  where,
  writeBatch,
} from 'firebase/firestore';
import type { DocumentReference, Firestore, QueryDocumentSnapshot } from 'firebase/firestore';
import type {
  CorrectionDoc,
  SubmissionDoc,
  SubmissionReceiptDoc,
} from '../../../types/firestore.js';

/** Readable, non-technical message shown when the submission was already returned. */
export const ALREADY_RETURNED_MESSAGE =
  'La consegna non può essere eliminata perché la correzione è già stata restituita allo studente.';

/**
 * Conservative per-batch mutation cap. Firestore's hard limit is 500; 400
 * leaves ample headroom and keeps each commit small and quick to retry.
 */
const MAX_BATCH_MUTATIONS = 400;

/**
 * M4-LIFE-02 — securely and completely delete one digital submission and every
 * personal-data document deterministically tied to it:
 *
 *   correctionEvents (correctionId == submissionId) → correctionReturns/{id} →
 *   corrections/{id} → submissionReceipts/{id} → submissions/{id}
 *
 * Dependent documents are deleted first and the submission + its receipt last,
 * so an interruption never leaves a submission whose personal data is only
 * partially removed while the top-level record already claims to be gone.
 *
 * **Idempotent and retry-safe**: every target is read first and only the
 * documents that actually exist are deleted, so re-running after an interrupted
 * pass simply finishes the job (and a fully-completed submission is a no-op).
 * Deletions are chunked at `MAX_BATCH_MUTATIONS`.
 *
 * **Owner-only**: the caller must own every existing document; ownership is
 * verified from the documents being deleted themselves (never a sibling that
 * might vanish in the same operation). Security Rules enforce the owner-only
 * delete server side as defence in depth.
 *
 * **M5-06B — deletable only before the first return.** A submission whose
 * correction has ever been returned to the student is off-limits: the return is
 * the moment the student saw the result, so its data must not be silently
 * erased. Any of the following counts as "already returned" and aborts the whole
 * operation **before a single write** (fail-closed, no partial deletion):
 *   - `correctionReturns/{submissionId}` exists — even if later hidden
 *     (`visibleToStudent: false`); the projection is never deleted by this flow;
 *   - `corrections/{submissionId}.status == 'returned'`;
 *   - the public lifecycle mirror on the submission or its receipt
 *     (`correctionStatus == 'returned'`).
 * Submissions with no correction, an `in_progress` correction, or a `completed`
 * correction that was never returned stay deletable — on `active` and `closed`
 * verifications alike.
 *
 * **No Storage reads/writes**: a submission owns no Storage object.
 *
 * After a successful delete, writes a single **non-identifying** audit event
 * (`submission.deleted`) carrying only `ownerUid`, the `verificationId` and a
 * timestamp — never the studentUid, the submissionId (which embeds the
 * studentUid), a name/email or any answer.
 */
export async function deleteSubmissionData(
  submissionId: string,
  ownerUid: string,
  db: Firestore,
): Promise<void> {
  const submissionRef = doc(db, 'submissions', submissionId);
  const receiptRef = doc(db, 'submissionReceipts', submissionId);
  const correctionRef = doc(db, 'corrections', submissionId);
  const returnRef = doc(db, 'correctionReturns', submissionId);

  // Owner-scoped query so the read satisfies the correctionEvents read rule
  // (resource.data.ownerUid == request.auth.uid) and only ever touches this
  // submission's events.
  const eventsSnap = await getDocs(
    query(
      collection(db, 'correctionEvents'),
      where('ownerUid', '==', ownerUid),
      where('correctionId', '==', submissionId),
    ),
  );

  const [submissionSnap, receiptSnap, correctionSnap, returnSnap] = await Promise.all([
    getDoc(submissionRef),
    getDoc(receiptRef),
    getDoc(correctionRef),
    getDoc(returnRef),
  ]);

  // Ownership is verified from the documents being deleted themselves — never a
  // sibling doc that could be removed in the same pass. Any existing document
  // owned by someone else aborts before a single write.
  const existing: { ownerUid?: string; verificationId?: string }[] = [
    submissionSnap.exists() ? (submissionSnap.data() as SubmissionDoc) : null,
    receiptSnap.exists() ? (receiptSnap.data() as SubmissionReceiptDoc) : null,
    correctionSnap.exists() ? (correctionSnap.data() as CorrectionDoc) : null,
    returnSnap.exists()
      ? (returnSnap.data() as { ownerUid?: string; verificationId?: string })
      : null,
  ].filter((d): d is NonNullable<typeof d> => d !== null);
  for (const d of existing) {
    if (d.ownerUid !== ownerUid) {
      throw new Error('Operazione non consentita: la consegna non appartiene a questo docente.');
    }
  }
  for (const e of eventsSnap.docs) {
    if ((e.data() as { ownerUid?: string }).ownerUid !== ownerUid) {
      throw new Error('Operazione non consentita: la consegna non appartiene a questo docente.');
    }
  }

  // M5-06B — authoritative "already returned" preflight. Runs after ownership
  // and BEFORE any write: if any reliable signal says the correction was ever
  // returned, abort the whole operation with a readable message and delete
  // nothing (no partial cleanup). The correctionReturns projection is never
  // deleted by this flow — its existence alone is decisive.
  const correctionData = correctionSnap.exists()
    ? (correctionSnap.data() as CorrectionDoc)
    : undefined;
  const submissionData = submissionSnap.exists()
    ? (submissionSnap.data() as SubmissionDoc)
    : undefined;
  const receiptData = receiptSnap.exists()
    ? (receiptSnap.data() as SubmissionReceiptDoc)
    : undefined;
  const alreadyReturned =
    returnSnap.exists() ||
    correctionData?.status === 'returned' ||
    submissionData?.correctionStatus === 'returned' ||
    receiptData?.correctionStatus === 'returned';
  if (alreadyReturned) {
    throw new Error(ALREADY_RETURNED_MESSAGE);
  }

  const nothingExists =
    eventsSnap.empty &&
    !submissionSnap.exists() &&
    !receiptSnap.exists() &&
    !correctionSnap.exists() &&
    !returnSnap.exists();
  if (nothingExists) {
    // Already fully deleted (or never existed): idempotent no-op, no audit.
    return;
  }

  // The verificationId for the non-identifying audit comes from any surviving
  // document; correctionEvents don't carry it. If none survives we still delete
  // whatever is left but skip the audit (nothing identifying is retained).
  const verificationId =
    submissionData?.verificationId ??
    receiptData?.verificationId ??
    correctionData?.verificationId ??
    null;

  // Dependent documents first, submission + receipt last. correctionReturns is
  // intentionally absent: a surviving return would have aborted the preflight
  // above, so it never exists here (and this flow never deletes it).
  const refs: DocumentReference[] = [
    ...eventsSnap.docs.map((d: QueryDocumentSnapshot) => d.ref),
    ...(correctionSnap.exists() ? [correctionRef] : []),
    ...(receiptSnap.exists() ? [receiptRef] : []),
    ...(submissionSnap.exists() ? [submissionRef] : []),
  ];

  for (let i = 0; i < refs.length; i += MAX_BATCH_MUTATIONS) {
    const batch = writeBatch(db);
    for (const ref of refs.slice(i, i + MAX_BATCH_MUTATIONS)) {
      batch.delete(ref);
    }
    await batch.commit();
  }

  if (verificationId !== null) {
    await addDoc(collection(db, 'auditEvents'), {
      actorUid: ownerUid,
      action: 'submission.deleted',
      targetId: verificationId,
      outcome: 'success',
      reason: null,
      timestamp: serverTimestamp(),
    });
  }
}
