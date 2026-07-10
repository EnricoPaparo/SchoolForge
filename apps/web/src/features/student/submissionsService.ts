import {
  arrayUnion,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  Timestamp,
  writeBatch,
} from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import type {
  AnswerValue,
  AttentionEvent,
  SubmissionDoc,
  SubmissionReceiptDoc,
} from '../../types/firestore.js';

// ─── ID helpers ──────────────────────────────────────────────────────────────

export function submissionId(verificationId: string, studentUid: string): string {
  return `${verificationId}_${studentUid}`;
}

// ─── Delivery code ───────────────────────────────────────────────────────────

/**
 * Generates a human-readable delivery code for a submitted exam.
 * Format: `SF-YYYY-XXXX` where XXXX is an uppercase alphanumeric random string.
 * Pure function — injectable seed not needed; used only at submit time.
 */
export function generateDeliveryCode(): string {
  const year = new Date().getFullYear();
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let suffix = '';
  for (let i = 0; i < 4; i++) {
    suffix += chars[Math.floor(Math.random() * chars.length)];
  }
  return `SF-${year}-${suffix}`;
}

// ─── Read operations ─────────────────────────────────────────────────────────

/**
 * Loads the submission doc for (verificationId, studentUid).
 * Returns null when no submission exists yet.
 *
 * Note: Security Rules allow students to read only their own draft; teachers
 * can read any submission for their verifications. This function makes no
 * assumption about the caller's role — the caller is responsible for using
 * it only in authorized contexts.
 */
export async function loadSubmission(
  verificationId: string,
  studentUid: string,
  db: Firestore,
): Promise<SubmissionDoc | null> {
  const id = submissionId(verificationId, studentUid);
  const snap = await getDoc(doc(db, 'submissions', id));
  return snap.exists() ? (snap.data() as SubmissionDoc) : null;
}

/**
 * Loads the submission receipt for (verificationId, studentUid).
 * Returns null when no receipt exists (submission not yet delivered).
 */
export async function loadReceipt(
  verificationId: string,
  studentUid: string,
  db: Firestore,
): Promise<SubmissionReceiptDoc | null> {
  const id = submissionId(verificationId, studentUid);
  const snap = await getDoc(doc(db, 'submissionReceipts', id));
  return snap.exists() ? (snap.data() as SubmissionReceiptDoc) : null;
}

// ─── Write operations ─────────────────────────────────────────────────────────

export type StartSubmissionInput = {
  verificationId: string;
  studentUid: string;
  ownerUid: string;
  verificationTitle: string;
  className: string | null;
};

/**
 * Creates a new draft submission, or no-ops if one already exists.
 * Uses `setDoc` with `{ merge: false }` semantics via explicit existence check
 * delegated to Security Rules: the Rules deny creation if a document with
 * the same id already exists (Firestore allows only create or update, not both
 * in a single Rules clause). To avoid a redundant read here and trust the Rules,
 * we use `setDoc` without merge — a second call would overwrite, but the Rules
 * deny it. Callers should check `loadSubmission` first when idempotency matters.
 */
export async function startSubmission(input: StartSubmissionInput, db: Firestore): Promise<void> {
  const { verificationId, studentUid, ownerUid, verificationTitle, className } = input;
  const id = submissionId(verificationId, studentUid);
  const payload: SubmissionDoc = {
    submissionId: id,
    verificationId,
    studentUid,
    ownerUid,
    status: 'draft',
    answers: {},
    flagged: {},
    attentionEvents: [],
    deliveryCode: null,
    verificationTitle,
    className,
    startedAt: Timestamp.now(),
    lastSavedAt: serverTimestamp(),
    submittedAt: null,
  };
  await setDoc(doc(db, 'submissions', id), payload);
}

export type SaveDraftInput = {
  verificationId: string;
  studentUid: string;
  answers: Record<string, AnswerValue>;
  flagged: Record<string, boolean>;
  /** Attention events accumulated since the last save. Appended via arrayUnion. */
  newAttentionEvents: AttentionEvent[];
};

/**
 * Persists answer and flagged changes on a draft submission.
 * Uses `serverTimestamp()` for `lastSavedAt` to avoid client clock skew.
 * Appends new attention events via `arrayUnion` so concurrent saves from
 * multiple tabs don't clobber each other.
 */
export async function saveDraft(input: SaveDraftInput, db: Firestore): Promise<void> {
  const { verificationId, studentUid, answers, flagged, newAttentionEvents } = input;
  const id = submissionId(verificationId, studentUid);
  const update: Record<string, unknown> = {
    answers,
    flagged,
    lastSavedAt: serverTimestamp(),
  };
  if (newAttentionEvents.length > 0) {
    update['attentionEvents'] = arrayUnion(...newAttentionEvents);
  }
  const { updateDoc } = await import('firebase/firestore');
  await updateDoc(doc(db, 'submissions', id), update);
}

export type SubmitInput = {
  verificationId: string;
  studentUid: string;
  ownerUid: string;
  answers: Record<string, AnswerValue>;
  flagged: Record<string, boolean>;
  newAttentionEvents: AttentionEvent[];
  verificationTitle: string;
  className: string | null;
};

/**
 * Atomically submits a draft: updates the submission to `submitted` and
 * creates the matching receipt in a single write batch.
 *
 * The receipt is the only document the student can read after submission
 * (Security Rules deny access to the submission itself once `submitted`).
 */
export async function submitSubmission(input: SubmitInput, db: Firestore): Promise<string> {
  const {
    verificationId,
    studentUid,
    ownerUid,
    answers,
    flagged,
    newAttentionEvents,
    verificationTitle,
    className,
  } = input;

  const id = submissionId(verificationId, studentUid);
  const code = generateDeliveryCode();
  const now = serverTimestamp();

  const batch = writeBatch(db);

  const submissionUpdate: Record<string, unknown> = {
    status: 'submitted',
    answers,
    flagged,
    deliveryCode: code,
    lastSavedAt: now,
    submittedAt: now,
  };
  if (newAttentionEvents.length > 0) {
    submissionUpdate['attentionEvents'] = arrayUnion(...newAttentionEvents);
  }
  batch.update(doc(db, 'submissions', id), submissionUpdate);

  const receipt: SubmissionReceiptDoc = {
    submissionId: id,
    verificationId,
    studentUid,
    ownerUid,
    verificationTitle,
    className,
    deliveryCode: code,
    submittedAt: now,
  };
  batch.set(doc(db, 'submissionReceipts', id), receipt);

  await batch.commit();
  return code;
}
