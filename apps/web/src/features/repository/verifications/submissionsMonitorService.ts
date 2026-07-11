import { collection, onSnapshot, query, where } from 'firebase/firestore';
import type { Firestore, Unsubscribe } from 'firebase/firestore';
import type { SubmissionDoc } from '../../../types/firestore.js';

/**
 * Minimal projection of a submission for the teacher's "Consegne online"
 * monitor (M3F-05). Deliberately excludes `answers` and `flagged` — the
 * monitor never shows question content or student answers, only delivery
 * status. `attentionEventsCount` replaces the full `attentionEvents[]`
 * array for the same reason (event count only, not full detail).
 */
export type SubmissionMonitorItem = {
  studentUid: string;
  status: SubmissionDoc['status'];
  lastSavedAt: SubmissionDoc['lastSavedAt'];
  submittedAt: SubmissionDoc['submittedAt'];
  deliveryCode: SubmissionDoc['deliveryCode'];
  attentionEventsCount: number;
};

function toMonitorItem(data: SubmissionDoc): SubmissionMonitorItem {
  return {
    studentUid: data.studentUid,
    status: data.status,
    lastSavedAt: data.lastSavedAt,
    submittedAt: data.submittedAt,
    deliveryCode: data.deliveryCode,
    attentionEventsCount: data.attentionEvents?.length ?? 0,
  };
}

/**
 * Opens a realtime listener on `submissions`, filtered to exactly one
 * (ownerUid, verificationId) pair — never a broader/global listener. Costs
 * exactly one active Firestore listener for as long as the teacher keeps
 * the monitor panel open; the caller MUST invoke the returned unsubscribe
 * function when the panel closes, the verification changes, or the
 * component unmounts.
 *
 * Never reads `answers`, the question pool, or Storage — only the compact
 * fields mapped by `toMonitorItem`.
 */
export function watchSubmissions(
  verificationId: string,
  ownerUid: string,
  db: Firestore,
  onChange: (items: SubmissionMonitorItem[]) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  const q = query(
    collection(db, 'submissions'),
    where('ownerUid', '==', ownerUid),
    where('verificationId', '==', verificationId),
  );
  return onSnapshot(
    q,
    (snap) => {
      onChange(snap.docs.map((d) => toMonitorItem(d.data() as SubmissionDoc)));
    },
    (err) => {
      onError(err instanceof Error ? err : new Error(String(err)));
    },
  );
}
