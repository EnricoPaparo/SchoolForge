import { collection, doc, getDoc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import { getBytes, ref, uploadBytes } from 'firebase/storage';
import type { FirebaseStorage } from 'firebase/storage';
import { parse as parseYaml } from 'yaml';
import {
  replaceFrontMatter,
  splitFrontMatter,
  type EditableFrontMatter,
} from '../validation/frontMatter.js';
import type { LessonMetadata, UdaMetadata } from '../validation/types.js';
import type { LessonDoc, UdaDoc } from '../../../types/firestore.js';

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

async function writeAuditEvent(
  db: Firestore,
  ownerUid: string,
  action: 'uda.updated' | 'lesson.updated',
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

  const frontMatterPatch: EditableFrontMatter = {
    titolo: fields.titolo,
    sottotitolo: fields.sottotitolo,
    difficolta: fields.difficolta,
    concetti_chiave: fields.concettiChiave,
    obiettivi: fields.obiettivi,
  };

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

  const docPatch = {
    titolo: fields.titolo,
    sottotitolo: fields.sottotitolo,
    difficolta: fields.difficolta,
    concettiChiave: fields.concettiChiave,
    obiettivi: fields.obiettivi,
  };

  try {
    await updateDoc(lessonRef, docPatch);
    // publicLessons shares the same document id as the technical lesson doc
    // (see buildImportPayload) — kept in sync only if a projection already
    // exists for it (e.g. absent for a legacy import predating publicLessons).
    const publicLessonRef = doc(db, 'publicLessons', lessonId);
    const publicLessonSnap = await getDoc(publicLessonRef);
    if (publicLessonSnap.exists()) {
      await updateDoc(publicLessonRef, docPatch);
    }
  } catch {
    throw new Error(
      'Il file della lezione è stato aggiornato su Storage ma i metadati non sono stati sincronizzati su Firestore. Riprova a salvare.',
    );
  }

  await writeAuditEvent(db, ownerUid, 'lesson.updated', lessonId);
}
