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

/** Readable, non-technical message for a correction that is currently returned. */
export const ALREADY_RETURNED_MESSAGE =
  'La consegna non può essere eliminata mentre la correzione è restituita allo studente. Riaprila prima di eliminarla.';

/** Firestore permits 500 mutations; reserve headroom for predictable retries. */
const MAX_BATCH_MUTATIONS = 400;

/**
 * M4-LIFE-03 securely deletes the deterministic submission graph.
 *
 * A current `returned` correction is protected. A former return restores the
 * destructive actions only after a *real* reopen: correction `in_progress`,
 * hidden projection, and neither public mirror still `returned`. A hidden
 * projection alone is deliberately insufficient. Any incoherent state fails
 * closed before a write.
 *
 * The normal graph fits in one atomic batch: events, hidden return, correction,
 * receipt and submission. For the exceptional case of many correctionEvents,
 * events are chunked first, then the 1:1 graph remains one final atomic batch.
 * A retry is idempotent and safely completes an interrupted event cleanup.
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

  const existing: { ownerUid?: string; verificationId?: string }[] = [
    submissionSnap.exists() ? (submissionSnap.data() as SubmissionDoc) : null,
    receiptSnap.exists() ? (receiptSnap.data() as SubmissionReceiptDoc) : null,
    correctionSnap.exists() ? (correctionSnap.data() as CorrectionDoc) : null,
    returnSnap.exists()
      ? (returnSnap.data() as { ownerUid?: string; verificationId?: string })
      : null,
  ].filter((value): value is NonNullable<typeof value> => value !== null);
  for (const value of existing) {
    if (value.ownerUid !== ownerUid) {
      throw new Error('Operazione non consentita: la consegna non appartiene a questo docente.');
    }
  }
  for (const event of eventsSnap.docs) {
    if ((event.data() as { ownerUid?: string }).ownerUid !== ownerUid) {
      throw new Error('Operazione non consentita: la consegna non appartiene a questo docente.');
    }
  }

  const correction = correctionSnap.exists()
    ? (correctionSnap.data() as CorrectionDoc)
    : undefined;
  const submission = submissionSnap.exists()
    ? (submissionSnap.data() as SubmissionDoc)
    : undefined;
  const receipt = receiptSnap.exists()
    ? (receiptSnap.data() as SubmissionReceiptDoc)
    : undefined;
  const correctionReturn = returnSnap.exists()
    ? (returnSnap.data() as { visibleToStudent?: unknown })
    : undefined;
  const mirrorsReturned =
    submission?.correctionStatus === 'returned' || receipt?.correctionStatus === 'returned';
  const isTrulyReopened =
    returnSnap.exists() &&
    correctionReturn?.visibleToStudent === false &&
    correction?.status === 'in_progress' &&
    !mirrorsReturned;

  // A return can be removed only as part of a true reopen deletion. This also
  // blocks a manual hide, a visible return, stale returned mirrors, a missing
  // correction and every other ambiguous legacy combination.
  if (
    correction?.status === 'returned' ||
    mirrorsReturned ||
    correctionReturn?.visibleToStudent === true ||
    (returnSnap.exists() && !isTrulyReopened)
  ) {
    throw new Error(ALREADY_RETURNED_MESSAGE);
  }

  const nothingExists =
    eventsSnap.empty &&
    !submissionSnap.exists() &&
    !receiptSnap.exists() &&
    !correctionSnap.exists() &&
    !returnSnap.exists();
  if (nothingExists) return;

  const verificationId =
    submission?.verificationId ?? receipt?.verificationId ?? correction?.verificationId ?? null;
  const eventRefs = eventsSnap.docs.map((event: QueryDocumentSnapshot) => event.ref);
  const coreRefs: DocumentReference[] = [
    ...(isTrulyReopened ? [returnRef] : []),
    ...(correctionSnap.exists() ? [correctionRef] : []),
    ...(receiptSnap.exists() ? [receiptRef] : []),
    ...(submissionSnap.exists() ? [submissionRef] : []),
  ];
  const allRefs = [...eventRefs, ...coreRefs];

  if (allRefs.length <= MAX_BATCH_MUTATIONS) {
    const batch = writeBatch(db);
    for (const ref of allRefs) batch.delete(ref);
    await batch.commit();
  } else {
    for (let i = 0; i < eventRefs.length; i += MAX_BATCH_MUTATIONS) {
      const batch = writeBatch(db);
      for (const ref of eventRefs.slice(i, i + MAX_BATCH_MUTATIONS)) batch.delete(ref);
      await batch.commit();
    }
    if (coreRefs.length > 0) {
      const batch = writeBatch(db);
      for (const ref of coreRefs) batch.delete(ref);
      await batch.commit();
    }
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
