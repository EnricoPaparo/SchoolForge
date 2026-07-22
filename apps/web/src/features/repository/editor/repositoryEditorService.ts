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
import type { DocumentReference, Firestore, WriteBatch } from 'firebase/firestore';
import type { FirebaseStorage } from 'firebase/storage';
import { deleteFile, readText, writeText } from '../gateway/repositoryGatewayClient.js';
import { parse as parseYaml } from 'yaml';
import {
  composeMarkdownWithFrontMatter,
  replaceFrontMatter,
  splitFrontMatter,
  type EditableFrontMatter,
} from '../validation/frontMatter.js';
import { parseLessonMetadata } from '../validation/lessonMetadata.js';
import { assertLessonContentSize } from '../programs/lessonContentSize.js';
import { newPublicLessonId, resolvePublicLessonId } from '../programs/publicLessonId.js';
import { toDocId } from '../import/buildImportPayload.js';
import type { LessonMetadata, UdaMetadata } from '../validation/types.js';
import type {
  ImportDoc,
  LessonDoc,
  ProgrammaMeta,
  PublicLessonDoc,
  UdaDoc,
  VerificationDoc,
} from '../../../types/firestore.js';
import {
  findRepositoryDeleteBlockers,
  type RepositoryDeleteBlocker,
  type VerificationForRepositoryGuard,
} from './repositoryEditorGuards.js';
import { assertNoActiveUdaAppendLease } from '../importUda/udaImportLease.js';

// SGW-01: gli accessi Storage singolo-file passano dal gateway same-origin, non
// più da `firebase/storage` diretto (che su Brave fallisce con timeout ~120 s).
async function fetchStorageText(storagePath: string): Promise<string> {
  return readText(storagePath);
}

async function writeStorageText(storagePath: string, content: string): Promise<void> {
  await writeText(storagePath, content);
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

function isStorageObjectNotFound(error: unknown): boolean {
  // Post SGW-01 the gateway reports an absent file as `file_not_found`; the
  // legacy `storage/object-not-found` is kept for any rollback to direct SDK.
  if (typeof error !== 'object' || error === null || !('code' in error)) return false;
  const code = (error as { code?: unknown }).code;
  return code === 'file_not_found' || code === 'storage/object-not-found';
}

function normalizeProgramMetadata(fields: ProgrammaMeta): ProgrammaMeta {
  const clean = (value: string | null): string | null => {
    const trimmed = value?.trim() ?? '';
    return trimmed || null;
  };
  return {
    annoScolastico: clean(fields.annoScolastico),
    docente: clean(fields.docente),
    materia: clean(fields.materia),
    classe: clean(fields.classe),
    descrizione: clean(fields.descrizione),
  };
}

/**
 * Updates the optional root-level `programma.md` and its Firestore projection.
 * The file is created only inside an existing import; when already present,
 * its body and unrelated front-matter keys are preserved.
 */
export async function updateProgramMetadata(params: {
  programId: string;
  importId: string;
  fields: ProgrammaMeta;
  ownerUid: string;
  db: Firestore;
  storage: FirebaseStorage;
}): Promise<ProgrammaMeta> {
  const { programId, importId, ownerUid, db } = params;
  const fields = normalizeProgramMetadata(params.fields);
  const importRef = doc(db, 'programs', programId, 'imports', importId);
  const importSnap = await getDoc(importRef);
  if (!importSnap.exists()) throw new Error('Import del corso non trovato.');
  const importDoc = importSnap.data() as ImportDoc;
  if (importDoc.ownerUid !== ownerUid || importDoc.programId !== programId) {
    throw new Error('Import del corso non valido.');
  }

  const storagePath = `repository/${ownerUid}/imports/${importId}/programma.md`;
  let currentContent = '';
  try {
    currentContent = await fetchStorageText(storagePath);
  } catch (error) {
    if (!isStorageObjectNotFound(error)) {
      throw new Error('Impossibile leggere il file programma.md da Storage.');
    }
  }

  const nextFrontMatter: EditableFrontMatter = {
    ...readRawFrontMatter(currentContent),
    anno_scolastico: fields.annoScolastico,
    docente: fields.docente,
    materia: fields.materia,
    classe: fields.classe,
    descrizione: fields.descrizione,
  };
  const nextContent = replaceFrontMatter(currentContent, nextFrontMatter);

  try {
    await writeStorageText(storagePath, nextContent);
  } catch {
    throw new Error('Impossibile aggiornare il file programma.md su Storage.');
  }

  try {
    const batch = writeBatch(db);
    batch.update(importRef, { programmaMeta: fields });
    batch.update(doc(db, 'programs', programId), { updatedAt: serverTimestamp() });
    batch.set(doc(collection(db, 'auditEvents')), {
      actorUid: ownerUid,
      action: 'program.metadataUpdated',
      targetId: programId,
      outcome: 'success',
      reason: null,
      timestamp: serverTimestamp(),
    });
    await batch.commit();
  } catch {
    throw new Error(
      'Il file programma.md è stato aggiornato su Storage ma i metadati non sono stati sincronizzati su Firestore. Riprova a salvare.',
    );
  }

  return fields;
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
 * Maps a UDA's `titolo` plus its metadata to the YAML front matter keys used
 * on disk. `titolo` is passed explicitly (the canonical value at create time)
 * and takes precedence over any `metadata.titolo`.
 */
function udaFrontMatterFields(titolo: string, metadata: UdaMetadata): EditableFrontMatter {
  return {
    titolo,
    descrizione: metadata.descrizione,
    competenze: metadata.competenze,
    obiettivi: metadata.obiettivi,
  };
}

type RepositoryAuditAction =
  | 'uda.updated'
  | 'uda.created'
  | 'uda.reordered'
  | 'uda.deleted'
  | 'lesson.updated'
  | 'lesson.created'
  | 'lesson.reordered'
  | 'lesson.deleted';

function addAuditEvent(
  batch: WriteBatch,
  db: Firestore,
  ownerUid: string,
  action: RepositoryAuditAction,
  targetId: string,
): void {
  batch.set(doc(collection(db, 'auditEvents')), {
    actorUid: ownerUid,
    action,
    targetId,
    outcome: 'success',
    reason: null,
    timestamp: serverTimestamp(),
  });
}

async function writeAuditEvent(
  db: Firestore,
  ownerUid: string,
  action: RepositoryAuditAction,
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
 * for it, the matching `publicLessons` entry. The projection id is resolved by
 * the caller via `resolvePublicLessonId` (HARD-02B-1): import-scoped
 * `${importId}_${lessonId}` for lessons imported/created from HARD-02B-1 on,
 * the legacy bare `lessonId` otherwise. Shared by every save path that ends up with a
 * didactic metadata patch to persist, whether the teacher edited the
 * metadata directly (`updateLessonMetadata`) or only the body
 * (`updateLessonMarkdownBody`, where the patch is just a resync of whatever
 * front matter the save recomposed). `publicContent`, when provided (only by
 * `updateLessonMarkdownBody`), also patches `publicLessons.content` — never
 * the technical `LessonDoc`, which has no such field.
 */
async function syncLessonMetadataDocs(
  db: Firestore,
  lessonRef: DocumentReference,
  lessonId: string,
  publicLessonId: string,
  publicLessonExists: boolean,
  docPatch: LessonDocPatch,
  ownerUid: string,
  publicContent?: string,
): Promise<void> {
  const batch = writeBatch(db);
  batch.update(lessonRef, docPatch);
  const publicLessonRef = doc(db, 'publicLessons', publicLessonId);
  if (publicLessonExists) {
    const publicPatch =
      publicContent === undefined ? docPatch : { ...docPatch, content: publicContent };
    batch.update(publicLessonRef, publicPatch);
  }
  addAuditEvent(batch, db, ownerUid, 'lesson.updated', lessonId);
  await batch.commit();
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
  const { programId, importId, udaId, fields, ownerUid, db } = params;
  const udaRef = doc(db, 'programs', programId, 'imports', importId, 'udas', udaId);
  const snap = await getDoc(udaRef);
  if (!snap.exists()) throw new Error('UDA non trovata.');
  const uda = snap.data() as UdaDoc;
  const storagePath = `${uda.storageBasePath}/${uda.filename}`;

  try {
    const currentContent = await fetchStorageText(storagePath);
    const nextFrontMatter: EditableFrontMatter = {
      ...readRawFrontMatter(currentContent),
      descrizione: fields.descrizione,
      competenze: fields.competenze,
      obiettivi: fields.obiettivi,
    };
    await writeStorageText(storagePath, replaceFrontMatter(currentContent, nextFrontMatter));
  } catch {
    throw new Error('Impossibile aggiornare il file della UDA su Storage.');
  }

  try {
    const batch = writeBatch(db);
    batch.update(udaRef, {
      descrizione: fields.descrizione,
      competenze: fields.competenze,
      obiettivi: fields.obiettivi,
    });
    addAuditEvent(batch, db, ownerUid, 'uda.updated', udaId);
    await batch.commit();
  } catch {
    throw new Error(
      'Il file della UDA è stato aggiornato su Storage ma i metadati non sono stati salvati su Firestore. Riprova a salvare.',
    );
  }
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
  const { programId, importId, lessonId, fields, ownerUid, db } = params;
  const lessonRef = doc(db, 'programs', programId, 'imports', importId, 'lessons', lessonId);
  // Read the technical lesson first (already required for storageRef), then
  // resolve the projection id from it — no extra read: legacy docs resolve to
  // lessonId, new docs to the stored import-scoped publicLessonId.
  const snap = await getDoc(lessonRef);
  if (!snap.exists()) throw new Error('Lezione non trovata.');
  const lesson = snap.data() as LessonDoc;
  const publicLessonId = resolvePublicLessonId(lesson, lessonId);
  const publicLessonSnap = await getDoc(doc(db, 'publicLessons', publicLessonId));

  const frontMatterPatch = lessonFrontMatterFields(fields);

  try {
    const currentContent = await fetchStorageText(lesson.storageRef);
    const nextFrontMatter: EditableFrontMatter = {
      ...readRawFrontMatter(currentContent),
      ...frontMatterPatch,
    };
    await writeStorageText(lesson.storageRef, replaceFrontMatter(currentContent, nextFrontMatter));
  } catch {
    throw new Error('Impossibile aggiornare il file della lezione su Storage.');
  }

  try {
    await syncLessonMetadataDocs(
      db,
      lessonRef,
      lessonId,
      publicLessonId,
      publicLessonSnap.exists(),
      fields,
      ownerUid,
    );
  } catch {
    throw new Error(
      'Il file della lezione è stato aggiornato su Storage ma i metadati non sono stati sincronizzati su Firestore. Riprova a salvare.',
    );
  }
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
  const { programId, importId, lessonId, body, ownerUid, db } = params;
  const lessonRef = doc(db, 'programs', programId, 'imports', importId, 'lessons', lessonId);
  const snap = await getDoc(lessonRef);
  if (!snap.exists()) throw new Error('Lezione non trovata.');
  const lesson = snap.data() as LessonDoc;
  const publicLessonId = resolvePublicLessonId(lesson, lessonId);
  const publicLessonSnap = await getDoc(doc(db, 'publicLessons', publicLessonId));

  let metadata: LessonMetadata;
  let publicBody: string;
  try {
    const currentContent = await fetchStorageText(lesson.storageRef);
    const nextContent = composeMarkdownWithFrontMatter(readRawFrontMatter(currentContent), body);
    const parsed = parseLessonMetadata(nextContent);
    metadata = parsed.metadata;
    publicBody = parsed.body;
    assertLessonContentSize(publicBody, lesson.filename);
    await writeStorageText(lesson.storageRef, nextContent);
  } catch (err) {
    if (err instanceof Error && err.message.includes('supera il limite')) throw err;
    throw new Error('Impossibile aggiornare il file della lezione su Storage.');
  }

  try {
    await syncLessonMetadataDocs(
      db,
      lessonRef,
      lessonId,
      publicLessonId,
      publicLessonSnap.exists(),
      metadata,
      ownerUid,
      publicBody,
    );
  } catch {
    throw new Error(
      'Il contenuto della lezione è stato aggiornato su Storage ma i metadati non sono stati sincronizzati su Firestore. Riprova a salvare.',
    );
  }
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
  const { programId, importId, udaId, udaDir, ownerUid, fields, db } = params;
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
  // A lesson created inside a legacy import still gets an import-scoped
  // publicLessons id (HARD-02B-1) — the projection collection is program-wide,
  // so new writes always follow the new convention.
  const publicLessonId = newPublicLessonId(importId, lessonId);
  const order = maxOrder + 1;

  const metadata: LessonMetadata = {
    titolo,
    sottotitolo: fields.sottotitolo,
    difficolta: fields.difficolta,
    concettiChiave: fields.concettiChiave,
    obiettivi: fields.obiettivi,
  };

  let publicBody: string;
  try {
    const content = composeMarkdownWithFrontMatter(lessonFrontMatterFields(metadata), fields.body);
    publicBody = parseLessonMetadata(content).body;
    assertLessonContentSize(publicBody, filename);
    await writeStorageText(storageRef, content);
  } catch (err) {
    if (err instanceof Error && err.message.includes('supera il limite')) throw err;
    throw new Error('Impossibile creare il file della lezione su Storage.');
  }

  try {
    const batch = writeBatch(db);
    batch.set(doc(lessonsRef, lessonId), {
      ownerUid,
      importId,
      publicLessonId,
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

    batch.set(doc(db, 'publicLessons', publicLessonId), {
      ownerUid,
      programId,
      importId,
      udaId,
      udaDir,
      path,
      filename,
      contentPath: storageRef,
      order,
      completed: false,
      createdAt: serverTimestamp(),
      content: publicBody,
      ...metadata,
    } satisfies PublicLessonDoc);

    batch.update(doc(db, 'programs', programId, 'imports', importId, 'udas', udaId), {
      lessonCount: increment(1),
    });
    addAuditEvent(batch, db, ownerUid, 'lesson.created', lessonId);
    await batch.commit();
  } catch {
    throw new Error(
      'Il file della lezione è stato creato su Storage ma non è stato possibile salvare i metadati su Firestore. Riprova.',
    );
  }

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
  const { programId, importId, ownerUid, fields, db } = params;
  const titolo = fields.titolo.trim();
  if (!titolo) throw new Error('Il titolo della UDA è obbligatorio.');

  // Mutual exclusion with an in-flight "Importa UDA" staged append.
  await assertNoActiveUdaAppendLease(programId, importId, db);

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
    titolo,
    descrizione: fields.descrizione,
    competenze: fields.competenze,
    obiettivi: fields.obiettivi,
  };

  try {
    const content = composeMarkdownWithFrontMatter(udaFrontMatterFields(titolo, metadata), '');
    await writeStorageText(`${storageBasePath}/${filename}`, content);
  } catch {
    throw new Error('Impossibile creare il file della UDA su Storage.');
  }

  try {
    const batch = writeBatch(db);
    batch.set(doc(udasRef, udaId), {
      ownerUid,
      importId,
      dir,
      filename,
      order,
      storageBasePath,
      lessonCount: 0,
      ...metadata,
    } satisfies UdaDoc);
    addAuditEvent(batch, db, ownerUid, 'uda.created', udaId);
    await batch.commit();
  } catch {
    throw new Error(
      'Il file della UDA è stato creato su Storage ma non è stato possibile salvare i metadati su Firestore. Riprova.',
    );
  }

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
  // Mutual exclusion with an in-flight "Importa UDA" staged append.
  await assertNoActiveUdaAppendLease(programId, importId, db);
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
 * `publicLessons` projection exists for either lesson (id resolved via
 * `resolvePublicLessonId` — HARD-02B-1), its `order` is
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

    const publicLessonRef = doc(db, 'publicLessons', resolvePublicLessonId(lesson, lessonId));
    const neighborPublicLessonRef = doc(
      db,
      'publicLessons',
      resolvePublicLessonId(neighbor, neighborLessonId),
    );
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

/**
 * Narrowed server-side to verifications for this exact program+import
 * (PERF-SEC-01B-3), instead of every verification the owner has ever
 * created. `findRepositoryDeleteBlockers` still needs to run client-side
 * on the result: it checks whether `config.questionRefs` (an array of
 * maps) contains an entry matching `udaDir`/`lessonFilename`, which
 * Firestore cannot filter on server-side (array-contains only matches a
 * whole element, not a sub-field) — narrowing by `programId`/`importId`
 * first still shrinks the candidate set to just that import's
 * verifications, which is the only part a simple equality query can do
 * without a schema change.
 */
async function fetchVerificationsForGuard(
  programId: string,
  importId: string,
  db: Firestore,
): Promise<VerificationForRepositoryGuard[]> {
  const snap = await getDocs(
    query(
      collection(db, 'verifications'),
      where('config.programId', '==', programId),
      where('config.importId', '==', importId),
    ),
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
  const verifications = await fetchVerificationsForGuard(programId, importId, db);
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
  const verifications = await fetchVerificationsForGuard(programId, importId, db);
  return findRepositoryDeleteBlockers(
    { kind: 'lesson', programId, importId, udaDir, lessonFilename },
    verifications,
  );
}

/**
 * Deletes a single Storage file via the gateway. The gateway delete is
 * idempotent (an already-absent file is a no-op, not an error), so no
 * object-not-found handling is needed here anymore (SGW-01).
 */
async function deleteStorageObjectIfExists(path: string): Promise<void> {
  await deleteFile(path);
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
  const { programId, importId, udaId, lessonId, ownerUid, db } = params;
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
    await deleteStorageObjectIfExists(lesson.storageRef);
    if (lesson.poolStorageRef) {
      await deleteStorageObjectIfExists(lesson.poolStorageRef);
    }
  } catch {
    throw new Error('Impossibile eliminare il file della lezione su Storage.');
  }

  try {
    await deleteDocRefsInBatches(db, [
      lessonRef,
      doc(db, 'publicLessons', resolvePublicLessonId(lesson, lessonId)),
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
  const { programId, importId, udaId, ownerUid, db } = params;
  const udaRef = doc(db, 'programs', programId, 'imports', importId, 'udas', udaId);
  const udaSnap = await getDoc(udaRef);
  if (!udaSnap.exists()) throw new Error('UDA non trovata.');
  const uda = udaSnap.data() as UdaDoc;

  const blockers = await getUdaDeleteBlockers(ownerUid, programId, importId, uda.dir, db);
  if (blockers.length > 0) throw new RepositoryDeleteBlockedError(blockers);
  // Mutual exclusion with an in-flight "Importa UDA" staged append.
  await assertNoActiveUdaAppendLease(programId, importId, db);

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
      deleteStorageObjectIfExists(path),
    );
  } catch {
    throw new Error('Impossibile eliminare i file della UDA su Storage.');
  }

  try {
    await deleteDocRefsInBatches(db, [
      ...lessonsSnap.docs.map((d) => d.ref),
      ...questionIndexSnap.docs.map((d) => d.ref),
      ...lessons.map((lesson) =>
        doc(db, 'publicLessons', resolvePublicLessonId(lesson, lesson.id)),
      ),
      udaRef,
    ]);
  } catch {
    throw new Error(
      'I file della UDA sono stati eliminati da Storage ma non è stato possibile rimuovere tutti i dati da Firestore. Riprova.',
    );
  }

  await writeAuditEvent(db, ownerUid, 'uda.deleted', udaId);
}
