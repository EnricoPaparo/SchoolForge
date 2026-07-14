import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import type { DocumentReference, Firestore } from 'firebase/firestore';
import type {
  ImportDoc,
  LessonDoc,
  ProgramDoc,
  ProgrammaMeta,
  UdaDoc,
} from '../../../types/firestore.js';
import { composeMarkdownWithFrontMatter } from '../validation/frontMatter.js';
import { deleteFile, deleteImportPrefix, writeText } from '../gateway/repositoryGatewayClient.js';

export type ProgramItem = { id: string } & ProgramDoc;
export type UdaItem = { id: string } & UdaDoc;
export type LessonItem = { id: string } & LessonDoc;

function udaOrderOrLegacy(uda: Pick<UdaDoc, 'dir' | 'order'>): number {
  if (uda.order !== undefined) return uda.order;
  const match = /^uda-(\d+)(?:-|$)/.exec(uda.dir);
  return match ? Number(match[1]) - 1 : Number.MAX_SAFE_INTEGER;
}

/**
 * Same reasoning as `udaOrderOrLegacy`: a lesson written before `order`
 * existed (or one whose `order` update failed to land) falls back to its
 * `lezione-XXX` numeric prefix rather than an undifferentiated
 * `MAX_SAFE_INTEGER` — otherwise every legacy lesson in a UDA would tie and
 * fall back to filename string sort, which happens to match import order
 * today but would silently stop matching after a RE-04 reorder of some
 * lessons but not others.
 */
function lessonOrderOrLegacy(lesson: Pick<LessonDoc, 'filename' | 'order'>): number {
  if (lesson.order !== undefined) return lesson.order;
  const match = /^lezione-(\d+)(?:-|\.md$)/.exec(lesson.filename);
  return match ? Number(match[1]) - 1 : Number.MAX_SAFE_INTEGER;
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

export type InitializedProgram = {
  programId: string;
  importId: string;
  annoScolastico: string;
};

function normalizeSchoolYear(value: string): string {
  const year = value.trim();
  const match = /^(\d{4})\/(\d{4})$/.exec(year);
  if (!match || Number(match[2]) !== Number(match[1]) + 1) {
    throw new Error('Anno scolastico non valido. Usa il formato AAAA/AAAA.');
  }
  return year;
}

/**
 * Creates a course that is immediately usable by the Repository Editor.
 * The canonical `programma.md` is written through SGW first, then program,
 * empty committed import and audit are created atomically in one Firestore
 * batch. If Firestore fails, the just-created file is removed best-effort.
 */
export async function createInitializedProgram(
  title: string,
  annoScolastico: string,
  ownerUid: string,
  db: Firestore,
): Promise<InitializedProgram> {
  const cleanTitle = title.trim();
  if (!cleanTitle) throw new Error('Il titolo del corso è obbligatorio.');
  const cleanYear = normalizeSchoolYear(annoScolastico);

  const programRef = doc(collection(db, 'programs'));
  const programId = programRef.id;
  const importId = crypto.randomUUID();
  const importRef = doc(db, 'programs', programId, 'imports', importId);
  const storagePath = `repository/${ownerUid}/imports/${importId}/programma.md`;
  const programmaMeta: ProgrammaMeta = {
    annoScolastico: cleanYear,
    docente: null,
    materia: null,
    classe: null,
    descrizione: null,
  };
  const markdown = composeMarkdownWithFrontMatter(
    { titolo: cleanTitle, anno_scolastico: cleanYear },
    '',
  );

  try {
    await writeText(storagePath, markdown);
  } catch {
    throw new Error('Impossibile inizializzare il file programma.md. Riprova.');
  }

  try {
    const batch = writeBatch(db);
    batch.set(programRef, {
      ownerUid,
      title: cleanTitle,
      activeImportId: importId,
      classIds: [],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    batch.set(importRef, {
      ownerUid,
      programId,
      importId,
      programmaTitle: cleanTitle,
      status: 'committed',
      importedAt: serverTimestamp(),
      udaCount: 0,
      lessonCount: 0,
      questionCount: 0,
      poolIssues: [],
      programmaMeta,
    });
    batch.set(doc(collection(db, 'auditEvents')), {
      actorUid: ownerUid,
      action: 'program.created',
      targetId: programId,
      outcome: 'success',
      reason: null,
      timestamp: serverTimestamp(),
    });
    await batch.commit();
  } catch {
    await deleteFile(storagePath).catch(() => undefined);
    throw new Error('Impossibile completare la creazione del corso. Riprova.');
  }

  return { programId, importId, annoScolastico: cleanYear };
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
      order: raw.order,
      titolo: raw.titolo ?? null,
      descrizione: raw.descrizione ?? null,
      competenze: raw.competenze ?? [],
      obiettivi: raw.obiettivi ?? [],
    } as UdaItem;
  });
  return items.sort(
    (a, b) => udaOrderOrLegacy(a) - udaOrderOrLegacy(b) || a.dir.localeCompare(b.dir),
  );
}

/**
 * `filename` is a required LessonDoc field for imports written by the
 * current importer, but legacy documents pre-dating that guarantee may only
 * carry `path` — fall back to its last segment, and finally to an empty
 * string, so sorting never dereferences an undefined value.
 */
function filenameOrLegacy(raw: Partial<LessonDoc>): string {
  return raw.filename ?? raw.path?.split('/').pop() ?? '';
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
      filename: filenameOrLegacy(raw),
      sottotitolo: raw.sottotitolo ?? null,
      difficolta: raw.difficolta ?? null,
      concettiChiave: raw.concettiChiave ?? [],
      obiettivi: raw.obiettivi ?? [],
    } as LessonItem;
  });
  return items.sort(
    (a, b) =>
      a.udaDir.localeCompare(b.udaDir) ||
      lessonOrderOrLegacy(a) - lessonOrderOrLegacy(b) ||
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
const PREFIX_DELETE_CONCURRENCY = 3;

async function deleteDocsInBatches(db: Firestore, refs: DocumentReference[]): Promise<void> {
  for (let i = 0; i < refs.length; i += BATCH_DELETE_CHUNK_SIZE) {
    const batch = writeBatch(db);
    refs.slice(i, i + BATCH_DELETE_CHUNK_SIZE).forEach((docRef) => batch.delete(docRef));
    await batch.commit();
  }
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
): Promise<void> {
  // A targeted, server-side existence check (PERF-SEC-01B-3): only asks
  // "does at least one verification reference this program?" via
  // `where('config.programId', '==', programId)` + `limit(1)`, instead of
  // reading the entire `verifications` collection just to `.some()` over it
  // client-side. `config.programId` is a plain scalar field inside a map
  // (not inside an array), so a single-field equality filter is enough —
  // no composite index required.
  const linkedVerificationSnap = await getDocs(
    query(collection(db, 'verifications'), where('config.programId', '==', programId), limit(1)),
  );
  if (!linkedVerificationSnap.empty) {
    throw new Error(PROGRAM_DELETE_BLOCKED_MESSAGE);
  }

  const [importsSnap, publicLessonsSnap] = await Promise.all([
    getDocs(collection(db, 'programs', programId, 'imports')),
    getDocs(query(collection(db, 'publicLessons'), where('programId', '==', programId))),
  ]);

  const imports = await Promise.all(
    importsSnap.docs.map(async (importDoc) => {
      const importId = importDoc.id;
      const importBasePath = `programs/${programId}/imports/${importId}`;
      const [udasSnap, lessonsSnap, questionIndexSnap] = await Promise.all([
        getDocs(collection(db, importBasePath, 'udas')),
        getDocs(collection(db, importBasePath, 'lessons')),
        getDocs(collection(db, importBasePath, 'questionIndex')),
      ]);
      return { importId, importBasePath, udasSnap, lessonsSnap, questionIndexSnap };
    }),
  );

  // Una sola richiesta gateway per import: niente listAll/deleteObject ricorsivi
  // dal browser e nessun retry Storage SDK di ~120 s su Brave.
  for (let i = 0; i < imports.length; i += PREFIX_DELETE_CONCURRENCY) {
    await Promise.all(
      imports
        .slice(i, i + PREFIX_DELETE_CONCURRENCY)
        .map(({ importId }) => deleteImportPrefix(`repository/${ownerUid}/imports/${importId}`)),
    );
  }

  for (const { importBasePath, udasSnap, lessonsSnap, questionIndexSnap } of imports) {
    await deleteDocsInBatches(db, [
      ...udasSnap.docs.map((d) => d.ref),
      ...lessonsSnap.docs.map((d) => d.ref),
      ...questionIndexSnap.docs.map((d) => d.ref),
      doc(db, importBasePath),
    ]);
  }

  // Never leave a student-visible publicLessons projection pointing at a
  // program that no longer exists.
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
