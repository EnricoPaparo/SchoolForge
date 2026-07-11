import { collection, doc, getDoc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';
import type { Firestore, Unsubscribe } from 'firebase/firestore';
import type { StudentAccessSettings } from '../../../types/firestore.js';
import { normalizeExamMode, SAFE_DEFAULT_EXAM_MODE, type ExamModeSettings } from './examMode.js';

export type StudentAccessSnapshot = Pick<
  StudentAccessSettings,
  'studentPortalEnabled' | 'newStudentRequestsEnabled'
> & { examMode: ExamModeSettings };

const SAFE_DEFAULT: StudentAccessSnapshot = {
  studentPortalEnabled: false,
  newStudentRequestsEnabled: false,
  examMode: SAFE_DEFAULT_EXAM_MODE,
};

/** Shared by the one-shot read and the onSnapshot listener below. */
function normalizeSnapshotData(data: Record<string, unknown> | undefined): StudentAccessSnapshot {
  if (!data) return SAFE_DEFAULT;
  return {
    studentPortalEnabled: data.studentPortalEnabled === true,
    newStudentRequestsEnabled: data.newStudentRequestsEnabled === true,
    examMode: normalizeExamMode(data.examMode),
  };
}

/**
 * Reads settings/studentAccess. A missing document (teacher hasn't
 * initialized it yet) or a denied read both fall back to the safe default —
 * no student read is ever implied by the absence of this document.
 */
export async function getStudentAccessSettings(db: Firestore): Promise<StudentAccessSnapshot> {
  try {
    const snap = await getDoc(doc(db, 'settings', 'studentAccess'));
    if (!snap.exists()) return SAFE_DEFAULT;
    return normalizeSnapshotData(snap.data());
  } catch {
    return SAFE_DEFAULT;
  }
}

/**
 * Realtime listener on settings/studentAccess only — never on a lesson or
 * class document. Used by StudentShell (M3F-07) so a teacher toggling
 * Modalità verifica takes effect immediately for an already-open student
 * session, without requiring a new login. Exactly one document is watched;
 * the caller MUST invoke the returned unsubscribe on unmount. A read error
 * (e.g. transiently denied) reports the same safe default as the one-shot
 * read, never a stale "enabled" state.
 */
export function watchStudentAccessSettings(
  db: Firestore,
  onChange: (settings: StudentAccessSnapshot) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  return onSnapshot(
    doc(db, 'settings', 'studentAccess'),
    (snap) => {
      onChange(snap.exists() ? normalizeSnapshotData(snap.data()) : SAFE_DEFAULT);
    },
    (err) => {
      onChange(SAFE_DEFAULT);
      onError?.(err instanceof Error ? err : new Error(String(err)));
    },
  );
}

/**
 * Owner-only. Toggles the student portal on/off. Initializes
 * settings/studentAccess on first use (merge: true) — the teacher never
 * needs a separate setup step before using the toggle.
 */
export async function setStudentPortalEnabled(
  enabled: boolean,
  ownerUid: string,
  db: Firestore,
): Promise<void> {
  await setDoc(
    doc(db, 'settings', 'studentAccess'),
    { ownerUid, studentPortalEnabled: enabled, updatedAt: serverTimestamp(), updatedBy: ownerUid },
    { merge: true },
  );
  await setDoc(doc(collection(db, 'auditEvents')), {
    actorUid: ownerUid,
    action: 'studentAccess.updated',
    targetId: null,
    outcome: 'success',
    reason: `studentPortalEnabled=${enabled}`,
    timestamp: serverTimestamp(),
  });
}

/**
 * Owner-only. Toggles whether an unknown Google-authenticated non-owner may
 * self-create a pending students/{uid} request. Initializes
 * settings/studentAccess on first use (merge: true).
 */
export async function setNewStudentRequestsEnabled(
  enabled: boolean,
  ownerUid: string,
  db: Firestore,
): Promise<void> {
  await setDoc(
    doc(db, 'settings', 'studentAccess'),
    {
      ownerUid,
      newStudentRequestsEnabled: enabled,
      updatedAt: serverTimestamp(),
      updatedBy: ownerUid,
    },
    { merge: true },
  );
  await setDoc(doc(collection(db, 'auditEvents')), {
    actorUid: ownerUid,
    action: 'studentAccess.updated',
    targetId: null,
    outcome: 'success',
    reason: `newStudentRequestsEnabled=${enabled}`,
    timestamp: serverTimestamp(),
  });
}

export type SetExamModeInput =
  | { enabled: true; scope: 'all' }
  | { enabled: true; scope: 'classes'; classIds: string[] }
  | { enabled: false };

/**
 * Owner-only. Single operation covering all three Modalità verifica
 * transitions (activate globally, activate for selected classes,
 * deactivate) — one clear entry point rather than three near-duplicate
 * functions. Merges onto settings/studentAccess (never clobbers
 * studentPortalEnabled/newStudentRequestsEnabled) and always uses
 * `serverTimestamp()` for `enabledAt`/`updatedAt` — never a client clock.
 *
 * Skip-if-unchanged is deliberately the CALLER's responsibility (it already
 * holds the current `StudentAccessSnapshot` from the listener/one-shot
 * read): this function does not read-before-write, so it never spends an
 * extra Firestore read just to avoid a no-op write.
 */
export async function setExamMode(
  input: SetExamModeInput,
  ownerUid: string,
  db: Firestore,
): Promise<void> {
  let examMode: Record<string, unknown>;
  let reason: string;
  if (!input.enabled) {
    examMode = { enabled: false, scope: 'all', classIds: [], enabledAt: null };
    reason = 'examMode disabled';
  } else if (input.scope === 'all') {
    examMode = { enabled: true, scope: 'all', classIds: [], enabledAt: serverTimestamp() };
    reason = 'examMode enabled scope=all';
  } else {
    if (input.classIds.length === 0) {
      throw new Error(
        'Selezionare almeno una classe per attivare la modalità verifica per classi.',
      );
    }
    examMode = {
      enabled: true,
      scope: 'classes',
      classIds: input.classIds,
      enabledAt: serverTimestamp(),
    };
    reason = `examMode enabled scope=classes classIds=${input.classIds.join(',')}`;
  }

  await setDoc(
    doc(db, 'settings', 'studentAccess'),
    { ownerUid, examMode, updatedAt: serverTimestamp(), updatedBy: ownerUid },
    { merge: true },
  );
  await setDoc(doc(collection(db, 'auditEvents')), {
    actorUid: ownerUid,
    action: 'studentAccess.examModeUpdated',
    targetId: null,
    outcome: 'success',
    reason,
    timestamp: serverTimestamp(),
  });
}
