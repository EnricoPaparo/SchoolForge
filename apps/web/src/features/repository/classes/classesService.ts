import { collection, doc, getDocs, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import type { ClassDoc } from '../../../types/firestore.js';

export type ClassItem = { id: string } & ClassDoc;

export async function listClasses(ownerUid: string, db: Firestore): Promise<ClassItem[]> {
  const snap = await getDocs(collection(db, 'classes'));
  return snap.docs
    .map((d) => ({ id: d.id, ...(d.data() as ClassDoc) }))
    .filter((item) => item.ownerUid === ownerUid);
}

export async function createClass(
  name: string,
  description: string | null,
  ownerUid: string,
  db: Firestore,
): Promise<string> {
  const ref = doc(collection(db, 'classes'));
  await setDoc(ref, {
    ownerUid,
    name,
    description,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  await setDoc(doc(collection(db, 'auditEvents')), {
    actorUid: ownerUid,
    action: 'class.created',
    targetId: ref.id,
    outcome: 'success',
    reason: null,
    timestamp: serverTimestamp(),
  });
  return ref.id;
}

export async function updateClass(
  classId: string,
  name: string,
  description: string | null,
  ownerUid: string,
  db: Firestore,
): Promise<void> {
  await updateDoc(doc(db, 'classes', classId), {
    name,
    description,
    updatedAt: serverTimestamp(),
  });
  await setDoc(doc(collection(db, 'auditEvents')), {
    actorUid: ownerUid,
    action: 'class.updated',
    targetId: classId,
    outcome: 'success',
    reason: null,
    timestamp: serverTimestamp(),
  });
}
