import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import type { DocumentReference, Firestore } from 'firebase/firestore';
import { deleteObject, listAll, ref } from 'firebase/storage';
import type { FirebaseStorage } from 'firebase/storage';
import type {
  ImportDoc,
  LessonDoc,
  ProgramDoc,
  ProgrammaMeta,
  UdaDoc,
  VerificationDoc,
} from '../../../types/firestore.js';

export type ProgramItem = { id: string } & ProgramDoc;
export type UdaItem = { id: string } & UdaDoc;
export type LessonItem = { id: string } & LessonDoc;

function orderOrLegacy(value: number | undefined): number {
  return value ?? Number.MAX_SAFE_INTEGER;
}

/**
 * Programs created before `classIds` existed are read back with
 * `classIds: []` — the safe default (not visible to any student) rather
 * than an undefined field that could be mistaken for "visible to all".
 * No migration is run; this normalization happens on every read.
 */
export async function listPrograms(db: Firestore): Promise<ProgramItem[]> {
  const snap = await getDocs(collection(db, 'programs'));
  return snap.docs.map((d) => {
    const data = d.data() as ProgramDoc;
    return { id: d.id, ...data, classIds: data.classIds ?? [] };
  });
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
    classIds: [],
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

/**
 * Sets the full list of classes a program is assigned to. An empty array
 * means the program (and everything under it) is not visible to any
 * student — this is a valid, intentional state, not an error.
 */
export async function setProgramClassIds(
  programId: string,
  classIds: string[],
  ownerUid: string,
  db: Firestore,
): Promise<void> {
  const deduped = [...new Set(classIds)];
  await updateDoc(doc(db, 'programs', programId), {
    classIds: deduped,
    updatedAt: serverTimestamp(),
  });
  await setDoc(doc(collection(db, 'auditEvents')), {
    actorUid: ownerUid,
    action: 'program.classesUpdated',
    targetId: programId,
    outcome: 'success',
    reason: deduped.length > 0 ? deduped.join(',') : 'nessuna classe',
    timestamp: serverTimestamp(),
  });
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
  const items = snap.docs.map((d) => {
    const raw = d.data() as Partial<UdaDoc>;
    return {
      id: d.id,
      ...raw,
      order: raw.order ?? Number.MAX_SAFE_INTEGER,
      descrizione: raw.descrizione ?? null,
      competenze: raw.competenze ?? [],
      obiettivi: raw.obiettivi ?? [],
    } as UdaItem;
  });
  return items.sort(
    (a, b) => orderOrLegacy(a.order) - orderOrLegacy(b.order) || a.dir.localeCompare(b.dir),
  );
}

export async function listLessons(
  programId: string,
  importId: string,
  db: Firestore,
): Promise<LessonItem[]> {
  const snap = await getDocs(collection(db, 'programs', programId, 'imports', importId, 'lessons'));
  const items = snap.docs.map((d) => {
    const raw = d.data() as Partial<LessonDoc>;
    return {
      id: d.id,
      ...raw,
      order: raw.order,
      sottotitolo: raw.sottotitolo ?? null,
      difficolta: raw.difficolta ?? null,
      concettiChiave: raw.concettiChiave ?? [],
      obiettivi: raw.obiettivi ?? [],
    } as LessonItem;
  });
  return items.sort(
    (a, b) =>
      a.udaDir.localeCompare(b.udaDir) ||
      orderOrLegacy(a.order) - orderOrLegacy(b.order) ||
      a.filename.localeCompare(b.filename),
  );
}

/**
 * Reads the didactic metadata parsed from the optional root-level programma.md
 * of an import. Returns null when the import has no metadata doc, or when
 * programma.md was absent at import time.
 */
export async function getImportMeta(
  programId: string,
  importId: string,
  db: Firestore,
): Promise<ProgrammaMeta | null> {
  const snap = await getDoc(doc(db, 'programs', programId, 'imports', importId));
  if (!snap.exists()) return null;
  const data = snap.data() as ImportDoc;
  return data.programmaMeta ?? null;
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

export const PROGRAM_DELETE_BLOCKED_MESSAGE =
  'Impossibile eliminare il corso: esistono verifiche associate. Elimina prima le verifiche collegate.';

const BATCH_DELETE_CHUNK_SIZE = 400;

async function deleteDocsInBatches(db: Firestore, refs: DocumentReference[]): Promise<void> {
  for (let i = 0; i < refs.length; i += BATCH_DELETE_CHUNK_SIZE) {
    const batch = writeBatch(db);
    refs.slice(i, i + BATCH_DELETE_CHUNK_SIZE).forEach((docRef) => batch.delete(docRef));
    await batch.commit();
  }
}

/** Recursively deletes every file under a Storage path prefix. */
async function deleteStoragePrefix(storage: FirebaseStorage, path: string): Promise<void> {
  const listing = await listAll(ref(storage, path));
  await Promise.all(listing.items.map((item) => deleteObject(item)));
  await Promise.all(
    listing.prefixes.map((prefix) => deleteStoragePrefix(storage, prefix.fullPath)),
  );
}

/**
 * Deletes a program and everything stored under it: every import (including
 * orphaned ones left behind by past reimports, not just the active one) with
 * its UDA/lesson/questionIndex docs, and the corresponding Storage files.
 *
 * Blocked when any verification references this program via
 * `config.programId` — verifications are never deleted automatically; the
 * teacher must remove them first.
 */
export async function deleteProgram(
  programId: string,
  ownerUid: string,
  db: Firestore,
  storage: FirebaseStorage,
): Promise<void> {
  const verificationsSnap = await getDocs(collection(db, 'verifications'));
  const hasLinkedVerification = verificationsSnap.docs.some(
    (d) => (d.data() as VerificationDoc).config.programId === programId,
  );
  if (hasLinkedVerification) {
    throw new Error(PROGRAM_DELETE_BLOCKED_MESSAGE);
  }

  const importsSnap = await getDocs(collection(db, 'programs', programId, 'imports'));

  for (const importDoc of importsSnap.docs) {
    const importId = importDoc.id;
    const importBasePath = `programs/${programId}/imports/${importId}`;
    const [udasSnap, lessonsSnap, questionIndexSnap] = await Promise.all([
      getDocs(collection(db, importBasePath, 'udas')),
      getDocs(collection(db, importBasePath, 'lessons')),
      getDocs(collection(db, importBasePath, 'questionIndex')),
    ]);

    await deleteDocsInBatches(db, [
      ...udasSnap.docs.map((d) => d.ref),
      ...lessonsSnap.docs.map((d) => d.ref),
      ...questionIndexSnap.docs.map((d) => d.ref),
      doc(db, importBasePath),
    ]);

    await deleteStoragePrefix(storage, `repository/${ownerUid}/imports/${importId}`);
  }

  // Never leave a student-visible publicLessons projection pointing at a
  // program that no longer exists.
  const publicLessonsSnap = await getDocs(
    query(collection(db, 'publicLessons'), where('programId', '==', programId)),
  );
  await deleteDocsInBatches(
    db,
    publicLessonsSnap.docs.map((d) => d.ref),
  );

  await deleteDoc(doc(db, 'programs', programId));

  await setDoc(doc(collection(db, 'auditEvents')), {
    actorUid: ownerUid,
    action: 'program.deleted',
    targetId: programId,
    outcome: 'success',
    reason: null,
    timestamp: serverTimestamp(),
  });
}
