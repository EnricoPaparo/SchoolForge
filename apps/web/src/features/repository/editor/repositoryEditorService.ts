import {
  collection,
  doc,
  getDoc,
  getDocs,
  increment,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import type { DocumentReference, Firestore } from 'firebase/firestore';
import { deleteObject, getBytes, ref, uploadBytes } from 'firebase/storage';
import type { FirebaseStorage } from 'firebase/storage';
import { parse as parseYaml } from 'yaml';
import {
  composeMarkdownWithFrontMatter,
  replaceFrontMatter,
  splitFrontMatter,
  type EditableFrontMatter,
} from '../validation/frontMatter.js';
import { parseLessonMetadata } from '../validation/lessonMetadata.js';
import { toDocId } from '../import/buildImportPayload.js';
import type { LessonMetadata, UdaMetadata } from '../validation/types.js';
import type {
  LessonDoc,
  PublicLessonDoc,
  UdaDoc,
  VerificationDoc,
} from '../../../types/firestore.js';
import {
  findRepositoryDeleteBlockers,
  type RepositoryDeleteBlocker,
  type VerificationForRepositoryGuard,
} from './repositoryEditorGuards.js';

async function fetchStorageText(storagePath: string, storage: FirebaseStorage): Promise<string> {
  const bytes = await getBytes(ref(storage, storagePath));
  return new TextDecoder().decode(bytes);
}

async function writeStorageText(
  storagePath: string,
  content: string,
  storage: FirebaseStorage,
): Promise<void> {
  await uploadBytes(ref(storage, storagePath), new TextEncoder().encode(content));
}

/**
 * Parses the raw YAML front matter of `content` into a plain object, so an
 * edit can be layered on top — overriding only the fields the teacher
 * changed — while preserving every other key already present (e.g. a UDA's
 * `titolo`). `replaceFrontMatter` itself has no merge semantics: it always
 * replaces the whole block, so callers must merge before calling it.
 */
function readRawFrontMatter(content: string): EditableFrontMatter {
  const { frontMatterRaw } = splitFrontMatter(content);
  if (!frontMatterRaw) return {};
  try {
    return (parseYaml(frontMatterRaw) as EditableFrontMatter) ?? {};
  } catch {
    return {};
  }
}

/**
 * Deterministic, filesystem-safe slug for a lesson title: lowercase,
 * diacritics stripped, anything outside [a-z0-9] collapsed to a single
 * hyphen, leading/trailing hyphens trimmed. Never empty — falls back to
 * "lezione" so a title made entirely of symbols still yields a valid
 * filename.
 */
const COMBINING_DIACRITICS_RE = /[\u0300-\u036f]/g;

function slugify(input: string): string {
  const slug = input
    .normalize('NFD')
    .replace(COMBINING_DIACRITICS_RE, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'lezione';
}

/** Maps parsed lesson metadata to the YAML front matter keys used on disk. */
function lessonFrontMatterFields(metadata: LessonMetadata): EditableFrontMatter {
  return {
    titolo: metadata.titolo,
    sottotitolo: metadata.sottotitolo,
    difficolta: metadata.difficolta,
    concetti_chiave: metadata.concettiChiave,
    obiettivi: metadata.obiettivi,
  };
}

function udaOrderFromDir(dir: string | undefined): number | null {
  const match = /^uda-(\d+)(?:-|$)/.exec(dir ?? '');
  return match ? Number(match[1]) - 1 : null;
}

/** Same reasoning as `udaOrderFromDir`, for a lesson's `lezione-XXX` filename prefix. */
function lessonOrderFromFilename(filename: string | undefined): number | null {
  const match = /^lezione-(\d+)(?:-|\.md$)/.exec(filename ?? '');
  return match ? Number(match[1]) - 1 : null;
}

/**
 * Maps a UDA's titolo (not part of `UdaMetadata` — see `validateUda`,
 * `descrizione`/`competenze`/`obiettivi` are the only metadata fields) plus
 * its metadata to the YAML front matter keys used on disk.
 */
function udaFrontMatterFields(titolo: string, metadata: UdaMetadata): EditableFrontMatter {
  return {
    titolo,
    descrizione: metadata.descrizione,
    competenze: metadata.competenze,
    obiettivi: metadata.obiettivi,
  };
}

async function writeAuditEvent(
  db: Firestore,
  ownerUid: string,
  action:
    | 'uda.updated'
    | 'uda.created'
    | 'uda.reordered'
    | 'uda.deleted'
    | 'lesson.updated'
    | 'lesson.created'
    | 'lesson.reordered'
    | 'lesson.deleted',
  targetId: string,
): Promise<void> {
  await setDoc(doc(collection(db, 'auditEvents')), {
    actorUid: ownerUid,
    action,
    targetId,
    outcome: 'success',
    reason: null,
    timestamp: serverTimestamp(),
  });
}

type LessonDocPatch = Pick<
  LessonDoc,
  'titolo' | 'sottotitolo' | 'difficolta' | 'concettiChiave' | 'obiettivi'
>;

/**
 * Updates the technical lesson document and, if a projection already exists
 * for it, the matching `publicLessons` entry (same document id — see
 * `buildImportPayload`). Shared by every save path that ends up with a
 * didactic metadata patch to persist, whether the teacher edited the
 * metadata directly (`updateLessonMetadata`) or only the body
 * (`updateLessonMarkdownBody`, where the patch is just a resync of whatever
 * front matter the save recomposed).
 */
async function syncLessonMetadataDocs(
  db: Firestore,
  lessonRef: DocumentReference,
  lessonId: string,
  docPatch: LessonDocPatch,
): Promise<void> {
  await updateDoc(lessonRef, docPatch);
  const publicLessonRef = doc(db, 'publicLessons', lessonId);
  const publicLessonSnap = await getDoc(publicLessonRef);
  if (publicLessonSnap.exists()) {
    await updateDoc(publicLessonRef, docPatch);
  }
}

/**
 * Rewrites a UDA's Markdown file in Storage (front matter only, body
 * untouched) and its Firestore technical document. Storage is written
 * first: if that fails, nothing else changes. If Storage succeeds but the
 * Firestore update fails, the two are now out of sync — reported as a
 * distinct error so the teacher knows to retry the save rather than assume
 * nothing happened (see repository-editor-roadmap.md §7).
 */
export async function updateUdaMetadata(params: {
  programId: string;
  importId: string;
  udaId: string;
  fields: UdaMetadata;
  ownerUid: string;
  db: Firestore;
  storage: FirebaseStorage;
}): Promise<void> {
  const { programId, importId, udaId, fields, ownerUid, db, storage } = params;
  const udaRef = doc(db, 'programs', programId, 'imports', importId, 'udas', udaId);
  const snap = await getDoc(udaRef);
  if (!snap.exists()) throw new Error('UDA non trovata.');
  const uda = snap.data() as UdaDoc;
  const storagePath = `${uda.storageBasePath}/${uda.filename}`;

  try {
    const currentContent = await fetchStorageText(storagePath, storage);
    const nextFrontMatter: EditableFrontMatter = {
      ...readRawFrontMatter(currentContent),
      descrizione: fields.descrizione,
      competenze: fields.competenze,
      obiettivi: fields.obiettivi,
    };
    await writeStorageText(
      storagePath,
      replaceFrontMatter(currentContent, nextFrontMatter),
      storage,
    );
  } catch {
    throw new Error('Impossibile aggiornare il file della UDA su Storage.');
  }

  try {
    await updateDoc(udaRef, {
      descrizione: fields.descrizione,
      competenze: fields.competenze,
      obiettivi: fields.obiettivi,
    });
  } catch {
    throw new Error(
      'Il file della UDA è stato aggiornato su Storage ma i metadati non sono stati salvati su Firestore. Riprova a salvare.',
    );
  }

  await writeAuditEvent(db, ownerUid, 'uda.updated', udaId);
}

/**
 * Rewrites a lesson's Markdown file in Storage (front matter only, body
 * untouched), its Firestore technical document, and the `publicLessons`
 * projection when one exists for this lesson (see
 * repository-editor-roadmap.md §4.2 — every save must keep all three in
 * sync). Storage is written first, same rollback/error-reporting reasoning
 * as `updateUdaMetadata`.
 */
export async function updateLessonMetadata(params: {
  programId: string;
  importId: string;
  lessonId: string;
  fields: LessonMetadata;
  ownerUid: string;
  db: Firestore;
  storage: FirebaseStorage;
}): Promise<void> {
  const { programId, importId, lessonId, fields, ownerUid, db, storage } = params;
  const lessonRef = doc(db, 'programs', programId, 'imports', importId, 'lessons', lessonId);
  const snap = await getDoc(lessonRef);
  if (!snap.exists()) throw new Error('Lezione non trovata.');
  const lesson = snap.data() as LessonDoc;

  const frontMatterPatch = lessonFrontMatterFields(fields);

  try {
    const currentContent = await fetchStorageText(lesson.storageRef, storage);
    const nextFrontMatter: EditableFrontMatter = {
      ...readRawFrontMatter(currentContent),
      ...frontMatterPatch,
    };
    await writeStorageText(
      lesson.storageRef,
      replaceFrontMatter(currentContent, nextFrontMatter),
      storage,
    );
  } catch {
    throw new Error('Impossibile aggiornare il file della lezione su Storage.');
  }

  try {
    await syncLessonMetadataDocs(db, lessonRef, lessonId, fields);
  } catch {
    throw new Error(
      'Il file della lezione è stato aggiornato su Storage ma i metadati non sono stati sincronizzati su Firestore. Riprova a salvare.',
    );
  }

  await writeAuditEvent(db, ownerUid, 'lesson.updated', lessonId);
}

/**
 * Rewrites a lesson's body while preserving its existing front matter as-is
 * (RE-02 — no metadata editing here, see `updateLessonMetadata` for that).
 * The current front matter is read from Storage, recomposed on top of the
 * new body via `composeMarkdownWithFrontMatter`, and written back; the
 * Firestore technical document and `publicLessons` projection are then
 * resynced with the same (unchanged, just recomputed) metadata, so a future
 * normalization of the YAML block never leaves Firestore out of step with
 * what Storage actually contains. Same Storage-first error-reporting
 * reasoning as `updateUdaMetadata`/`updateLessonMetadata`.
 */
export async function updateLessonMarkdownBody(params: {
  programId: string;
  importId: string;
  lessonId: string;
  body: string;
  ownerUid: string;
  db: Firestore;
  storage: FirebaseStorage;
}): Promise<void> {
  const { programId, importId, lessonId, body, ownerUid, db, storage } = params;
  const lessonRef = doc(db, 'programs', programId, 'imports', importId, 'lessons', lessonId);
  const snap = await getDoc(lessonRef);
  if (!snap.exists()) throw new Error('Lezione non trovata.');
  const lesson = snap.data() as LessonDoc;

  let metadata: LessonMetadata;
  try {
    const currentContent = await fetchStorageText(lesson.storageRef, storage);
    const nextContent = composeMarkdownWithFrontMatter(readRawFrontMatter(currentContent), body);
    metadata = parseLessonMetadata(nextContent).metadata;
    await writeStorageText(lesson.storageRef, nextContent, storage);
  } catch {
    throw new Error('Impossibile aggiornare il file della lezione su Storage.');
  }

  try {
    await syncLessonMetadataDocs(db, lessonRef, lessonId, metadata);
  } catch {
    throw new Error(
      'Il contenuto della lezione è stato aggiornato su Storage ma i metadati non sono stati sincronizzati su Firestore. Riprova a salvare.',
    );
  }

  await writeAuditEvent(db, ownerUid, 'lesson.updated', lessonId);
}

export interface NewLessonFields {
  titolo: string;
  sottotitolo: string | null;
  difficolta: string | null;
  concettiChiave: string[];
  obiettivi: string[];
  body: string;
}

/**
 * Creates a new lesson inside an existing UDA (RE-03A — no UDA creation, no
 * deletion, no reordering). The lesson number (`lezione-XXX-slug.md`) and
 * `order` are both derived from the highest values already present among
 * the UDA's existing lessons, so a legacy import with gaps or an
 * out-of-order `order` never collides with the new one. `questionCount` is
 * always 0 and `poolStatus` always `'absent'` — this never creates a pool
 * file. `publicLessons` is written unconditionally, mirroring
 * `buildImportPayload`: the projection always exists, visibility to a
 * student is decided at read time by the parent program's `classIds`, not
 * by whether the doc exists.
 */
export async function createLesson(params: {
  programId: string;
  importId: string;
  udaId: string;
  udaDir: string;
  ownerUid: string;
  fields: NewLessonFields;
  db: Firestore;
  storage: FirebaseStorage;
}): Promise<{ lessonId: string; filename: string }> {
  const { programId, importId, udaId, udaDir, ownerUid, fields, db, storage } = params;
  const titolo = fields.titolo.trim();
  if (!titolo) throw new Error('Il titolo della lezione è obbligatorio.');

  const lessonsRef = collection(db, 'programs', programId, 'imports', importId, 'lessons');
  const existingSnap = await getDocs(query(lessonsRef, where('udaDir', '==', udaDir)));
  const existingLessons = existingSnap.docs.map((d) => d.data() as Partial<LessonDoc>);

  const maxNumber = existingLessons.reduce((max, lesson) => {
    const match = /^lezione-(\d+)-/.exec(lesson.filename ?? '');
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
  const maxOrder = existingLessons.reduce((max, lesson) => Math.max(max, lesson.order ?? -1), -1);

  const filename = `lezione-${String(maxNumber + 1).padStart(3, '0')}-${slugify(titolo)}.md`;
  const path = `${udaDir}/${filename}`;
  const storageRef = `repository/${ownerUid}/imports/${importId}/${path}`;
  const lessonId = `${udaId}_${toDocId(filename.replace(/\.md$/, ''))}`;
  const order = maxOrder + 1;

  const metadata: LessonMetadata = {
    titolo,
    sottotitolo: fields.sottotitolo,
    difficolta: fields.difficolta,
    concettiChiave: fields.concettiChiave,
    obiettivi: fields.obiettivi,
  };

  try {
    const content = composeMarkdownWithFrontMatter(lessonFrontMatterFields(metadata), fields.body);
    await writeStorageText(storageRef, content, storage);
  } catch {
    throw new Error('Impossibile creare il file della lezione su Storage.');
  }

  try {
    await setDoc(doc(lessonsRef, lessonId), {
      ownerUid,
      importId,
      udaDir,
      path,
      filename,
      order,
      poolStatus: 'absent',
      questionCount: 0,
      storageRef,
      poolStorageRef: null,
      ...metadata,
    } satisfies LessonDoc);

    await setDoc(doc(db, 'publicLessons', lessonId), {
      ownerUid,
      programId,
      importId,
      udaId,
      udaDir,
      path,
      filename,
      contentPath: storageRef,
      order,
      createdAt: serverTimestamp(),
      ...metadata,
    } satisfies PublicLessonDoc);

    await updateDoc(doc(db, 'programs', programId, 'imports', importId, 'udas', udaId), {
      lessonCount: increment(1),
    });
  } catch {
    throw new Error(
      'Il file della lezione è stato creato su Storage ma non è stato possibile salvare i metadati su Firestore. Riprova.',
    );
  }

  await writeAuditEvent(db, ownerUid, 'lesson.created', lessonId);

  return { lessonId, filename };
}

export interface NewUdaFields {
  titolo: string;
  descrizione: string | null;
  competenze: string[];
  obiettivi: string[];
}

/**
 * Creates a new UDA inside an existing program/import (RE-03B — no lessons
 * created automatically, no deletion, no reordering). The UDA number
 * (`uda-XX-slug`) and `order` are both derived from the highest values
 * already present among the import's existing UDAs, so a legacy import
 * with gaps or an out-of-order `order` never collides with the new one —
 * same reasoning as `createLesson`. The UDA body is left empty:
 * `descrizione` lives in front matter (RE-01+), and RE-03B never creates
 * lessons for the new UDA, so there is nothing else to write. `lessonCount`
 * starts at `0` and is incremented independently by `createLesson`.
 */
export async function createUda(params: {
  programId: string;
  importId: string;
  ownerUid: string;
  fields: NewUdaFields;
  db: Firestore;
  storage: FirebaseStorage;
}): Promise<{ udaId: string; dir: string; order: number }> {
  const { programId, importId, ownerUid, fields, db, storage } = params;
  const titolo = fields.titolo.trim();
  if (!titolo) throw new Error('Il titolo della UDA è obbligatorio.');

  const udasRef = collection(db, 'programs', programId, 'imports', importId, 'udas');
  const existingSnap = await getDocs(udasRef);
  const existingUdas = existingSnap.docs.map((d) => d.data() as Partial<UdaDoc>);

  const maxNumber = existingUdas.reduce((max, uda) => {
    const match = /^uda-(\d+)-/.exec(uda.dir ?? '');
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
  const maxOrder = existingUdas.reduce(
    (max, uda) => Math.max(max, uda.order ?? udaOrderFromDir(uda.dir) ?? -1),
    -1,
  );

  const dir = `uda-${String(maxNumber + 1).padStart(2, '0')}-${slugify(titolo)}`;
  const filename = `${dir}.md`;
  const storageBasePath = `repository/${ownerUid}/imports/${importId}/${dir}`;
  const udaId = toDocId(dir);
  const order = maxOrder + 1;

  const metadata: UdaMetadata = {
    descrizione: fields.descrizione,
    competenze: fields.competenze,
    obiettivi: fields.obiettivi,
  };

  try {
    const content = composeMarkdownWithFrontMatter(udaFrontMatterFields(titolo, metadata), '');
    await writeStorageText(`${storageBasePath}/${filename}`, content, storage);
  } catch {
    throw new Error('Impossibile creare il file della UDA su Storage.');
  }

  try {
    await setDoc(doc(udasRef, udaId), {
      ownerUid,
      importId,
      dir,
      filename,
      order,
      storageBasePath,
      lessonCount: 0,
      ...metadata,
    } satisfies UdaDoc);
  } catch {
    throw new Error(
      'Il file della UDA è stato creato su Storage ma non è stato possibile salvare i metadati su Firestore. Riprova.',
    );
  }

  await writeAuditEvent(db, ownerUid, 'uda.created', udaId);

  return { udaId, dir, order };
}

/**
 * Swaps the `order` of two UDAs (RE-04 — adjacent-move reorder only, no
 * drag & drop, no renumbering of the rest of the list). Never touches
 * Storage or `dir`/`filename`: reordering is a pure Firestore concern. Both
 * `order` values are read fresh from Firestore (never trusted from the
 * caller) and fall back to the `uda-XX` dir prefix via `udaOrderFromDir`
 * when a UDA has never had an explicit `order` — the same fallback
 * `listUdas` uses to sort it in the first place, so a legacy UDA "graduates"
 * to an explicit `order` on its first move instead of jumping unpredictably.
 * The two writes are batched: either both `order` values land or neither
 * does, so a mid-swap failure can never leave the pair half-swapped.
 */
export async function reorderUda(params: {
  programId: string;
  importId: string;
  udaId: string;
  neighborUdaId: string;
  ownerUid: string;
  db: Firestore;
}): Promise<{ order: number; neighborOrder: number }> {
  const { programId, importId, udaId, neighborUdaId, ownerUid, db } = params;
  const udaRef = doc(db, 'programs', programId, 'imports', importId, 'udas', udaId);
  const neighborRef = doc(db, 'programs', programId, 'imports', importId, 'udas', neighborUdaId);
  const [udaSnap, neighborSnap] = await Promise.all([getDoc(udaRef), getDoc(neighborRef)]);
  if (!udaSnap.exists()) throw new Error('UDA non trovata.');
  if (!neighborSnap.exists()) throw new Error('UDA vicina non trovata.');
  const uda = udaSnap.data() as UdaDoc;
  const neighbor = neighborSnap.data() as UdaDoc;

  const order = neighbor.order ?? udaOrderFromDir(neighbor.dir) ?? 0;
  const neighborOrder = uda.order ?? udaOrderFromDir(uda.dir) ?? 0;

  try {
    const batch = writeBatch(db);
    batch.update(udaRef, { order });
    batch.update(neighborRef, { order: neighborOrder });
    await batch.commit();
  } catch {
    throw new Error('Impossibile salvare il nuovo ordine delle UDA. Riprova.');
  }

  await writeAuditEvent(db, ownerUid, 'uda.reordered', udaId);

  return { order, neighborOrder };
}

/**
 * Swaps the `order` of two lessons within the same UDA (RE-04 — same
 * adjacent-move-only, Storage-untouched reasoning as `reorderUda`). Rejects
 * a cross-UDA swap: the UI only ever offers a neighbor from the same
 * lesson list, so this is a defensive guard, not a normal path. When a
 * `publicLessons` projection exists for either lesson (same document id as
 * the technical lesson doc — see `buildImportPayload`), its `order` is
 * updated in the same batch, so the student-facing list never drifts from
 * the teacher-facing one.
 */
export async function reorderLesson(params: {
  programId: string;
  importId: string;
  lessonId: string;
  neighborLessonId: string;
  ownerUid: string;
  db: Firestore;
}): Promise<{ order: number; neighborOrder: number }> {
  const { programId, importId, lessonId, neighborLessonId, ownerUid, db } = params;
  const lessonRef = doc(db, 'programs', programId, 'imports', importId, 'lessons', lessonId);
  const neighborRef = doc(
    db,
    'programs',
    programId,
    'imports',
    importId,
    'lessons',
    neighborLessonId,
  );
  const [lessonSnap, neighborSnap] = await Promise.all([getDoc(lessonRef), getDoc(neighborRef)]);
  if (!lessonSnap.exists()) throw new Error('Lezione non trovata.');
  if (!neighborSnap.exists()) throw new Error('Lezione vicina non trovata.');
  const lesson = lessonSnap.data() as LessonDoc;
  const neighbor = neighborSnap.data() as LessonDoc;

  if (lesson.udaDir !== neighbor.udaDir) {
    throw new Error('Le lezioni non appartengono alla stessa UDA.');
  }

  const order = neighbor.order ?? lessonOrderFromFilename(neighbor.filename) ?? 0;
  const neighborOrder = lesson.order ?? lessonOrderFromFilename(lesson.filename) ?? 0;

  try {
    const batch = writeBatch(db);
    batch.update(lessonRef, { order });
    batch.update(neighborRef, { order: neighborOrder });

    const publicLessonRef = doc(db, 'publicLessons', lessonId);
    const neighborPublicLessonRef = doc(db, 'publicLessons', neighborLessonId);
    const [publicLessonSnap, neighborPublicLessonSnap] = await Promise.all([
      getDoc(publicLessonRef),
      getDoc(neighborPublicLessonRef),
    ]);
    if (publicLessonSnap.exists()) batch.update(publicLessonRef, { order });
    if (neighborPublicLessonSnap.exists()) {
      batch.update(neighborPublicLessonRef, { order: neighborOrder });
    }

    await batch.commit();
  } catch {
    throw new Error('Impossibile salvare il nuovo ordine delle lezioni. Riprova.');
  }

  await writeAuditEvent(db, ownerUid, 'lesson.reordered', lessonId);

  return { order, neighborOrder };
}

// ─── Protected deletion (RE-05) ───────────────────────────────────────────

/**
 * Thrown by `deleteUda`/`deleteLesson` instead of a plain `Error` when the
 * target is referenced by at least one verification (draft, active or
 * closed alike — see `findRepositoryDeleteBlockers`). Carries the full
 * blocker list so the UI can show *which* verifications are in the way,
 * not just a generic "can't delete" message. Nothing is deleted when this
 * is thrown: Storage and Firestore are both left untouched.
 */
export class RepositoryDeleteBlockedError extends Error {
  readonly blockers: RepositoryDeleteBlocker[];

  constructor(blockers: RepositoryDeleteBlocker[]) {
    super('Impossibile eliminare: esistono verifiche collegate.');
    this.name = 'RepositoryDeleteBlockedError';
    this.blockers = blockers;
  }
}

async function fetchVerificationsForGuard(
  ownerUid: string,
  db: Firestore,
): Promise<VerificationForRepositoryGuard[]> {
  const snap = await getDocs(
    query(collection(db, 'verifications'), where('ownerUid', '==', ownerUid)),
  );
  return snap.docs.map((d) => {
    const data = d.data() as VerificationDoc;
    return { id: d.id, status: data.status, config: data.config };
  });
}

export async function getUdaDeleteBlockers(
  ownerUid: string,
  programId: string,
  importId: string,
  udaDir: string,
  db: Firestore,
): Promise<RepositoryDeleteBlocker[]> {
  const verifications = await fetchVerificationsForGuard(ownerUid, db);
  return findRepositoryDeleteBlockers({ kind: 'uda', programId, importId, udaDir }, verifications);
}

export async function getLessonDeleteBlockers(
  ownerUid: string,
  programId: string,
  importId: string,
  udaDir: string,
  lessonFilename: string,
  db: Firestore,
): Promise<RepositoryDeleteBlocker[]> {
  const verifications = await fetchVerificationsForGuard(ownerUid, db);
  return findRepositoryDeleteBlockers(
    { kind: 'lesson', programId, importId, udaDir, lessonFilename },
    verifications,
  );
}

/** Deletes a Storage object, tolerating one that's already gone. */
async function deleteStorageObjectIfExists(storage: FirebaseStorage, path: string): Promise<void> {
  try {
    await deleteObject(ref(storage, path));
  } catch (err) {
    if ((err as { code?: string }).code !== 'storage/object-not-found') throw err;
  }
}

const DELETE_BATCH_CHUNK_SIZE = 400;
const STORAGE_DELETE_CONCURRENCY = 4;

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;

  async function consume() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      await worker(items[index]!);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => consume()));
}

/** Firestore caps a single batch at 500 writes — chunk defensively below that. */
async function deleteDocRefsInBatches(db: Firestore, refs: DocumentReference[]): Promise<void> {
  for (let i = 0; i < refs.length; i += DELETE_BATCH_CHUNK_SIZE) {
    const batch = writeBatch(db);
    refs.slice(i, i + DELETE_BATCH_CHUNK_SIZE).forEach((docRef) => batch.delete(docRef));
    await batch.commit();
  }
}

function questionIndexCollection(db: Firestore, programId: string, importId: string) {
  return collection(db, 'programs', programId, 'imports', importId, 'questionIndex');
}

/**
 * Deletes a lesson: its Markdown file and pool file (if any) on Storage,
 * its technical Firestore document, matching `questionIndex` entries, the
 * `publicLessons` projection, and decrements the parent UDA's
 * `lessonCount`. Blocked — nothing deleted, Storage and Firestore both left
 * untouched — when at least one verification references this lesson (see
 * `getLessonDeleteBlockers`); the teacher must remove/edit those
 * verifications first (repository-editor-roadmap.md §4.3).
 */
export async function deleteLesson(params: {
  programId: string;
  importId: string;
  udaId: string;
  lessonId: string;
  ownerUid: string;
  db: Firestore;
  storage: FirebaseStorage;
}): Promise<void> {
  const { programId, importId, udaId, lessonId, ownerUid, db, storage } = params;
  const lessonRef = doc(db, 'programs', programId, 'imports', importId, 'lessons', lessonId);
  const snap = await getDoc(lessonRef);
  if (!snap.exists()) throw new Error('Lezione non trovata.');
  const lesson = snap.data() as LessonDoc;

  const blockers = await getLessonDeleteBlockers(
    ownerUid,
    programId,
    importId,
    lesson.udaDir,
    lesson.filename,
    db,
  );
  if (blockers.length > 0) throw new RepositoryDeleteBlockedError(blockers);

  const questionIndexSnap = await getDocs(
    query(
      questionIndexCollection(db, programId, importId),
      where('udaDir', '==', lesson.udaDir),
      where('lessonFilename', '==', lesson.filename),
    ),
  );

  try {
    await deleteStorageObjectIfExists(storage, lesson.storageRef);
    if (lesson.poolStorageRef) {
      await deleteStorageObjectIfExists(storage, lesson.poolStorageRef);
    }
  } catch {
    throw new Error('Impossibile eliminare il file della lezione su Storage.');
  }

  try {
    await deleteDocRefsInBatches(db, [
      lessonRef,
      doc(db, 'publicLessons', lessonId),
      ...questionIndexSnap.docs.map((d) => d.ref),
    ]);
    await updateDoc(doc(db, 'programs', programId, 'imports', importId, 'udas', udaId), {
      lessonCount: increment(-1),
    });
  } catch {
    throw new Error(
      'Il file della lezione è stato eliminato da Storage ma non è stato possibile rimuovere tutti i dati da Firestore. Riprova.',
    );
  }

  await writeAuditEvent(db, ownerUid, 'lesson.deleted', lessonId);
}

/**
 * Deletes a UDA and every lesson inside it: all Markdown/pool files on
 * Storage, all technical Firestore documents (lessons, questionIndex
 * entries, publicLessons projections), and the UDA's own document. Blocked
 * — nothing deleted — when at least one verification references this UDA
 * or any lesson/question inside it (see `getUdaDeleteBlockers`), same
 * reasoning as `deleteLesson`.
 */
export async function deleteUda(params: {
  programId: string;
  importId: string;
  udaId: string;
  ownerUid: string;
  db: Firestore;
  storage: FirebaseStorage;
}): Promise<void> {
  const { programId, importId, udaId, ownerUid, db, storage } = params;
  const udaRef = doc(db, 'programs', programId, 'imports', importId, 'udas', udaId);
  const udaSnap = await getDoc(udaRef);
  if (!udaSnap.exists()) throw new Error('UDA non trovata.');
  const uda = udaSnap.data() as UdaDoc;

  const blockers = await getUdaDeleteBlockers(ownerUid, programId, importId, uda.dir, db);
  if (blockers.length > 0) throw new RepositoryDeleteBlockedError(blockers);

  const lessonsRef = collection(db, 'programs', programId, 'imports', importId, 'lessons');
  const [lessonsSnap, questionIndexSnap] = await Promise.all([
    getDocs(query(lessonsRef, where('udaDir', '==', uda.dir))),
    getDocs(
      query(questionIndexCollection(db, programId, importId), where('udaDir', '==', uda.dir)),
    ),
  ]);
  const lessons = lessonsSnap.docs.map((d) => ({ id: d.id, ...(d.data() as LessonDoc) }));

  try {
    const storagePaths = [
      `${uda.storageBasePath}/${uda.filename}`,
      ...lessons.map((lesson) => lesson.storageRef),
      ...lessons
        .map((lesson) => lesson.poolStorageRef)
        .filter((path): path is string => Boolean(path)),
    ];
    await runWithConcurrency(storagePaths, STORAGE_DELETE_CONCURRENCY, (path) =>
      deleteStorageObjectIfExists(storage, path),
    );
  } catch {
    throw new Error('Impossibile eliminare i file della UDA su Storage.');
  }

  try {
    await deleteDocRefsInBatches(db, [
      ...lessonsSnap.docs.map((d) => d.ref),
      ...questionIndexSnap.docs.map((d) => d.ref),
      ...lessons.map((lesson) => doc(db, 'publicLessons', lesson.id)),
      udaRef,
    ]);
  } catch {
    throw new Error(
      'I file della UDA sono stati eliminati da Storage ma non è stato possibile rimuovere tutti i dati da Firestore. Riprova.',
    );
  }

  await writeAuditEvent(db, ownerUid, 'uda.deleted', udaId);
}
