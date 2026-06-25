import { collection, doc, getDocs, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import type { LessonDoc, ProgramDoc, UdaDoc } from '../../../types/firestore.js';

export type ProgramItem = { id: string } & ProgramDoc;
export type UdaItem = { id: string } & UdaDoc;
export type LessonItem = { id: string } & LessonDoc;

export async function listPrograms(db: Firestore): Promise<ProgramItem[]> {
  const snap = await getDocs(collection(db, 'programs'));
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as ProgramDoc) }));
}

export async function createProgram(
  title: string,
  ownerUid: string,
  db: Firestore,
): Promise<string> {
  const ref = doc(collection(db, 'programs'));
  await setDoc(ref, {
    ownerUid,
    title,
    activeImportId: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  await setDoc(doc(collection(db, 'auditEvents')), {
    actorUid: ownerUid,
    action: 'program.created',
    targetId: ref.id,
    outcome: 'success',
    reason: null,
    timestamp: serverTimestamp(),
  });
  return ref.id;
}

export async function updateProgramTitle(
  programId: string,
  title: string,
  ownerUid: string,
  db: Firestore,
): Promise<void> {
  await updateDoc(doc(db, 'programs', programId), { title, updatedAt: serverTimestamp() });
  await setDoc(doc(collection(db, 'auditEvents')), {
    actorUid: ownerUid,
    action: 'program.updated',
    targetId: programId,
    outcome: 'success',
    reason: null,
    timestamp: serverTimestamp(),
  });
}

export async function listUdas(
  programId: string,
  importId: string,
  db: Firestore,
): Promise<UdaItem[]> {
  const snap = await getDocs(collection(db, 'programs', programId, 'imports', importId, 'udas'));
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as UdaDoc) }));
}

export async function listLessons(
  programId: string,
  importId: string,
  db: Firestore,
): Promise<LessonItem[]> {
  const snap = await getDocs(collection(db, 'programs', programId, 'imports', importId, 'lessons'));
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as LessonDoc) }));
}

export async function setLessonCompleted(
  programId: string,
  importId: string,
  lessonId: string,
  completed: boolean,
  ownerUid: string,
  db: Firestore,
): Promise<void> {
  await updateDoc(doc(db, 'programs', programId, 'imports', importId, 'lessons', lessonId), {
    completed,
    completedAt: completed ? serverTimestamp() : null,
  });
  await setDoc(doc(collection(db, 'auditEvents')), {
    actorUid: ownerUid,
    action: 'lesson.completed',
    targetId: lessonId,
    outcome: 'success',
    reason: completed ? 'marked as completed' : 'marked as not completed',
    timestamp: serverTimestamp(),
  });
}
