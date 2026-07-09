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
} from 'firebase/firestore';
import type { DocumentReference, Firestore } from 'firebase/firestore';
import { getBytes, ref, uploadBytes } from 'firebase/storage';
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
import type { LessonDoc, PublicLessonDoc, UdaDoc } from '../../../types/firestore.js';

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

async function writeAuditEvent(
  db: Firestore,
  ownerUid: string,
  action: 'uda.updated' | 'lesson.updated' | 'lesson.created',
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
