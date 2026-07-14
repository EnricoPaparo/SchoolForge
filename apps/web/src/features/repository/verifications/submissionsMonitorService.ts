import { collection, onSnapshot, query, where } from 'firebase/firestore';
import type { Firestore, Unsubscribe } from 'firebase/firestore';
import type { AttentionEvent, SubmissionDoc } from '../../../types/firestore.js';
import { normalizeSubmissionCorrectionStatus } from '../corrections/submissionCorrectionStatus.js';

/**
 * Client-side projection of a submission for the teacher's "Consegne
 * online" monitor (M3F-05, event detail M3F-09). The listener below reads
 * each full, authorized `SubmissionDoc` over the network (Security Rules
 * already allow the owner to read every submission for their own
 * verifications) — `answers` and `flagged` arrive with it on the wire.
 * `toMonitorItem` discards them before the data ever reaches the UI: they
 * are never rendered and never returned from `watchSubmissions`, only this
 * compact shape is. `attentionEvents` is a sanitized copy of the raw
 * array — each entry keeps only `type`/`ts` (which is all `AttentionEvent`
 * ever contains — see `types/firestore.ts`), never `answers` or `flagged`.
 * `attentionEventsCount` is kept as a separate field (not derived from
 * `.length` by callers) so a monitor row can render the count without
 * holding onto the full list.
 *
 * Deliberately not backed by a second, narrower projection document (no
 * `submissions/{id}/monitorProjection` mirror): that would double the
 * writes on every autosave/submit for a field set the client already
 * discards locally, for no read-side benefit — the doc is small and this
 * keeps the product minimal.
 */
export type SubmissionMonitorItem = {
  studentUid: string;
  status: SubmissionDoc['status'];
  lastSavedAt: SubmissionDoc['lastSavedAt'];
  submittedAt: SubmissionDoc['submittedAt'];
  deliveryCode: SubmissionDoc['deliveryCode'];
  correctionStatus: NonNullable<SubmissionDoc['correctionStatus']>;
  correctionSummary: SubmissionDoc['correctionSummary'] | null;
  attentionEventsCount: number;
  /** Sanitized: `type` + `ts` only, same shape as `AttentionEvent` — never answers/flagged. */
  attentionEvents: AttentionEvent[];
};

function toMonitorItem(data: SubmissionDoc): SubmissionMonitorItem {
  const attentionEvents = (data.attentionEvents ?? []).map((e) => ({ type: e.type, ts: e.ts }));
  return {
    studentUid: data.studentUid,
    status: data.status,
    lastSavedAt: data.lastSavedAt,
    submittedAt: data.submittedAt,
    deliveryCode: data.deliveryCode,
    correctionStatus: normalizeSubmissionCorrectionStatus(data.correctionStatus),
    correctionSummary: data.correctionSummary ?? null,
    attentionEventsCount: attentionEvents.length,
    attentionEvents,
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
 * Never reads the question pool or Storage. It does read each submission's
 * `answers`/`flagged` off the wire (see `SubmissionMonitorItem` above for
 * why), but `toMonitorItem` strips them immediately — only the compact
 * fields it maps are exposed to callers.
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
