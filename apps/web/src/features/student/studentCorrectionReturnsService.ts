import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import type { CorrectionReturnDoc } from '../../types/firestore.js';

/** `CorrectionReturnDoc` plus its Firestore doc id (== submissionId == `${verificationId}_${studentUid}`). */
export type StudentCorrectionReturnItem = CorrectionReturnDoc & { submissionId: string };

/** Epoch seconds from a Firestore Timestamp-like value, or null for a legacy/missing one. */
function timestampSeconds(ts: unknown): number | null {
  if (!ts || typeof ts !== 'object' || !('seconds' in ts)) return null;
  return (ts as { seconds: number }).seconds;
}

/**
 * Reads all and only the correction returns the current student may see —
 * a single server-side query (`studentUid == uid AND visibleToStudent ==
 * true`), never a client-side scan of the whole `correctionReturns`
 * collection and never one `getDoc` per verification (M4-02B). Both
 * filters are required, not just `studentUid`: Security Rules can only
 * authorize a `list` request on fields the query itself filters on (same
 * reasoning as `loadStudentVerifications`'s `classId`+`visibility` pair —
 * see firestore.rules). No realtime listener: this is a one-shot read,
 * called again only via an explicit manual reload.
 *
 * Deliberately no `orderBy('returnedAt')` on the query itself: Firestore's
 * `orderBy` silently *excludes* any document missing the ordered field
 * from the result set entirely, which would make a legacy/malformed
 * `returnedAt` unreachable no matter what JS-side sorting ran afterwards —
 * exactly the crash-avoidance this function promises, defeated at the
 * query layer. Ordering is therefore done exclusively in JS via
 * `timestampSeconds`: a valid timestamp sorts descending, a
 * missing/malformed one sorts last, never dropped.
 */
export async function loadStudentCorrectionReturns(
  uid: string,
  db: Firestore,
): Promise<StudentCorrectionReturnItem[]> {
  const snap = await getDocs(
    query(
      collection(db, 'correctionReturns'),
      where('studentUid', '==', uid),
      where('visibleToStudent', '==', true),
    ),
  );

  return snap.docs
    .map((d) => ({ ...(d.data() as CorrectionReturnDoc), submissionId: d.id }))
    .sort((a, b) => {
      const secondsA = timestampSeconds(a.returnedAt);
      const secondsB = timestampSeconds(b.returnedAt);
      if (secondsA != null && secondsB != null) return secondsB - secondsA;
      if (secondsA != null) return -1;
      if (secondsB != null) return 1;
      return 0;
    });
}

/**
 * Reads a single return projection by its deterministic id (==
 * submissionId), for the read-only workspace's manual "Ricarica" — a plain
 * `getDoc`, not the list query above, since the workspace already knows
 * which submission it's showing. Security Rules still gate this exactly
 * like the list query (`studentUid == uid && visibleToStudent == true`).
 *
 * Resolves to `null` only for the two cases that genuinely mean "no
 * longer available": the document doesn't exist, or the read was denied
 * (`permission-denied` — the docente just hid it, or it never belonged to
 * this student). Any other failure (network error, offline, etc.) is
 * rethrown rather than swallowed into `null`: a transient failure must
 * never be misread by the caller as "the docente hid the correction".
 */
export async function loadStudentCorrectionReturn(
  submissionId: string,
  db: Firestore,
): Promise<StudentCorrectionReturnItem | null> {
  try {
    const snap = await getDoc(doc(db, 'correctionReturns', submissionId));
    if (!snap.exists()) return null;
    return { ...(snap.data() as CorrectionReturnDoc), submissionId: snap.id };
  } catch (err) {
    const code = (err as { code?: string } | null)?.code;
    if (code === 'permission-denied') return null;
    throw err;
  }
}
