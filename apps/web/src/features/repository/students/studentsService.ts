import {
  collection,
  deleteDoc,
  doc,
  getCountFromServer,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import type { StudentDoc } from '../../../types/firestore.js';
import { normalizeStudentStatus } from './status.js';

export type StudentItem = { id: string } & StudentDoc;

export async function listStudents(ownerUid: string, db: Firestore): Promise<StudentItem[]> {
  const snap = await getDocs(collection(db, 'students'));
  return snap.docs
    .map((d) => {
      const data = d.data() as StudentDoc;
      return { id: d.id, ...data, status: normalizeStudentStatus(data.status) };
    })
    .filter((item) => item.ownerUid === ownerUid);
}

/**
 * Simple, non-realtime count used for the "Studenti" nav badge. Uses a
 * server-side count aggregation (`getCountFromServer`) filtered on
 * `status == 'pending'` instead of loading every student document just to
 * count them (PERF-08 / PERF-SEC-01B-3) — this is called unconditionally on
 * every `TeacherShell` mount, independent of whether the teacher ever opens
 * the Studenti section, so it previously cost one full collection read per
 * app load regardless of use. No `ownerUid` filter: SchoolForge is
 * single-owner per deployment, so the `students` collection already only
 * ever contains that owner's own students (see `performance-security-audit.md`
 * PERF-01/PERF-02 — adding a redundant `ownerUid` filter would not reduce
 * what's read).
 */
export async function countPendingStudents(_ownerUid: string, db: Firestore): Promise<number> {
  const snap = await getCountFromServer(
    query(collection(db, 'students'), where('status', '==', 'pending')),
  );
  return snap.data().count;
}

/** Self-read of the caller's own students/{uid} document — used by RoleGate. */
export async function getOwnStudentDoc(uid: string, db: Firestore): Promise<StudentDoc | null> {
  const snap = await getDoc(doc(db, 'students', uid));
  if (!snap.exists()) return null;
  const data = snap.data() as StudentDoc;
  return { ...data, status: normalizeStudentStatus(data.status) };
}

/**
 * Self-service: called by a Google-authenticated non-owner with no
 * students/{uid} document yet, when settings/studentAccess.newStudentRequestsEnabled
 * is true (see RoleGate). Always creates status 'pending', classId null —
 * the Security Rules independently enforce the same restriction, so this
 * is defense in depth, not the only check. No audit event: a non-owner
 * cannot write auditEvents (owner-only), so the request itself is
 * unaudited; the teacher's later approve/block decision is.
 */
export async function requestStudentAccess(
  params: { uid: string; ownerUid: string; email: string; displayName: string | null },
  db: Firestore,
): Promise<void> {
  const { uid, ownerUid, email, displayName } = params;
  await setDoc(doc(db, 'students', uid), {
    uid,
    ownerUid,
    email,
    displayName,
    status: 'pending',
    classId: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    lastLoginAt: serverTimestamp(),
  });
}

export async function approveStudent(uid: string, ownerUid: string, db: Firestore): Promise<void> {
  await updateDoc(doc(db, 'students', uid), { status: 'approved', updatedAt: serverTimestamp() });
  await writeAudit(db, ownerUid, 'student.approved', uid);
}

export async function blockStudent(uid: string, ownerUid: string, db: Firestore): Promise<void> {
  await updateDoc(doc(db, 'students', uid), { status: 'blocked', updatedAt: serverTimestamp() });
  await writeAudit(db, ownerUid, 'student.blocked', uid);
}

export async function resetStudentToPending(
  uid: string,
  ownerUid: string,
  db: Firestore,
): Promise<void> {
  await updateDoc(doc(db, 'students', uid), { status: 'pending', updatedAt: serverTimestamp() });
  await writeAudit(db, ownerUid, 'student.reset', uid);
}

export async function removeStudent(uid: string, ownerUid: string, db: Firestore): Promise<void> {
  await deleteDoc(doc(db, 'students', uid));
  await writeAudit(db, ownerUid, 'student.removed', uid);
}

export async function assignStudentClass(
  uid: string,
  classId: string | null,
  ownerUid: string,
  db: Firestore,
): Promise<void> {
  await updateDoc(doc(db, 'students', uid), { classId, updatedAt: serverTimestamp() });
  await writeAudit(db, ownerUid, 'student.classAssigned', uid, classId ?? 'nessuna classe');
}

async function writeAudit(
  db: Firestore,
  ownerUid: string,
  action:
    | 'student.approved'
    | 'student.blocked'
    | 'student.reset'
    | 'student.removed'
    | 'student.classAssigned',
  targetId: string,
  reason: string | null = null,
): Promise<void> {
  await setDoc(doc(collection(db, 'auditEvents')), {
    actorUid: ownerUid,
    action,
    targetId,
    outcome: 'success',
    reason,
    timestamp: serverTimestamp(),
  });
}
