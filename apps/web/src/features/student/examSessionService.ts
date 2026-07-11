import type { Firestore } from 'firebase/firestore';
import type { SubmissionDoc } from '../../types/firestore.js';
import {
  loadStudentVerifications,
  type StudentVerificationItem,
} from '../repository/verifications/studentVerificationsService.js';
import { loadSubmission } from './submissionsService.js';

/**
 * Best-effort hint only (D-M3F-14/§7.3a): remembers which verification the
 * student was last mid-draft on, so a refresh checks that one deterministic
 * path first instead of scanning every online-enabled verification. Never
 * decides anything on its own — every read through this hint is re-verified
 * against Firestore before it is trusted (see `findActiveDraftSession`).
 */
const ACTIVE_SESSION_HINT_KEY = 'schoolforge:activeExamVerificationId';

export function readActiveSessionHint(): string | null {
  try {
    return sessionStorage.getItem(ACTIVE_SESSION_HINT_KEY);
  } catch {
    return null;
  }
}

export function writeActiveSessionHint(verificationId: string): void {
  try {
    sessionStorage.setItem(ACTIVE_SESSION_HINT_KEY, verificationId);
  } catch {
    // Non-fatal — Firestore stays the source of truth either way.
  }
}

export function clearActiveSessionHint(): void {
  try {
    sessionStorage.removeItem(ACTIVE_SESSION_HINT_KEY);
  } catch {
    // Non-fatal.
  }
}

export type ActiveExamSession = {
  item: StudentVerificationItem;
  submission: SubmissionDoc;
};

/**
 * Scans the given online-enabled verifications for the caller's own draft
 * submission. Deliberately uses only deterministic single-document get()s
 * (`submissions/{verificationId}_{uid}`, via `loadSubmission`) — never an
 * unscoped/collection query — mirroring the exact contract Security Rules
 * already grant a student for their own submission (M3F-03 `allow get`).
 * `onlineItems` is expected to already be scoped to the student's own class
 * (see `loadStudentVerifications`), so this never scans more than the
 * handful of verifications a student could plausibly start.
 */
export async function findActiveDraftSession(
  uid: string,
  onlineItems: StudentVerificationItem[],
  db: Firestore,
): Promise<ActiveExamSession | null> {
  if (onlineItems.length === 0) {
    clearActiveSessionHint();
    return null;
  }

  const hint = readActiveSessionHint();
  const ordered = hint
    ? [...onlineItems.filter((i) => i.id === hint), ...onlineItems.filter((i) => i.id !== hint)]
    : onlineItems;

  for (const item of ordered) {
    // A submission that is already `submitted` is no longer readable by the
    // student via get() (Security Rules deny it once status != 'draft') —
    // that rejection just means "not a draft here", the same as a missing
    // document; the scan must continue to the next item rather than
    // surfacing an error for a perfectly normal, already-delivered exam.
    let submission: SubmissionDoc | null = null;
    try {
      submission = await loadSubmission(item.id, uid, db);
    } catch {
      continue;
    }
    if (submission && submission.status === 'draft') {
      writeActiveSessionHint(item.id);
      return { item, submission };
    }
  }
  clearActiveSessionHint();
  return null;
}

/**
 * Full resolution from scratch: fetches the student's own class-scoped
 * verification list (same query `StudentVerificationsView` uses) and looks
 * for a draft among the online-enabled ones. Used by `StudentShell` at
 * mount time, before any section-specific view exists to have already
 * fetched this — a genuinely mandatory check, not an optimization.
 */
export async function resolveActiveSession(
  uid: string,
  db: Firestore,
): Promise<ActiveExamSession | null> {
  const result = await loadStudentVerifications(uid, db);
  if (result.status !== 'ok') {
    clearActiveSessionHint();
    return null;
  }
  const onlineItems = result.verifications.filter((v) => v.onlineEnabled);
  return findActiveDraftSession(uid, onlineItems, db);
}
