import { collection, doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import type { StudentAccessSettings } from '../../../types/firestore.js';

export type StudentAccessSnapshot = Pick<
  StudentAccessSettings,
  'studentPortalEnabled' | 'newStudentRequestsEnabled'
>;

const SAFE_DEFAULT: StudentAccessSnapshot = {
  studentPortalEnabled: false,
  newStudentRequestsEnabled: false,
};

/**
 * Reads settings/studentAccess. A missing document (teacher hasn't
 * initialized it yet) or a denied read both fall back to the safe default —
 * no student read is ever implied by the absence of this document.
 */
export async function getStudentAccessSettings(db: Firestore): Promise<StudentAccessSnapshot> {
  try {
    const snap = await getDoc(doc(db, 'settings', 'studentAccess'));
    if (!snap.exists()) return SAFE_DEFAULT;
    const data = snap.data();
    return {
      studentPortalEnabled: data.studentPortalEnabled === true,
      newStudentRequestsEnabled: data.newStudentRequestsEnabled === true,
    };
  } catch {
    return SAFE_DEFAULT;
  }
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
