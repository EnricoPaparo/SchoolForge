import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import { readTexts } from '../gateway/repositoryGatewayClient.js';
import { parseLessonMetadata } from '../validation/lessonMetadata.js';
import { assertLessonContentSize, normalizeLessonContent } from './lessonContentSize.js';
import type {
  LessonDoc,
  PublicLessonDoc,
  PublicLessonsMigrationDoc,
} from '../../../types/firestore.js';

export interface BackfillFailure {
  id: string;
  reason: string;
}

export interface BackfillSummary {
  analyzed: number;
  migrated: number;
  skipped: number;
  failed: BackfillFailure[];
}

const BACKFILL_CONCURRENCY = 4;

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

/** Current public projection migration — see PublicLessonsMigrationDoc. */
const PUBLIC_LESSONS_CONTENT_VERSION = 2;

function migrationMarkerRef(db: Firestore) {
  return doc(db, 'settings', 'publicLessonsMigration');
}

/**
 * Owner-only cheap check: reads a single settings document instead of
 * scanning every `publicLessons` doc, so the maintenance notice in
 * `DidatticaView` can decide whether to show the backfill trigger without a
 * `getDocs` sweep on each mount. `true`
 * means a previous `backfillPublicLessonsContent` run completed with zero
 * failures — new write paths (import/createLesson/updateLessonMarkdownBody)
 * already keep `content` in sync, so once this is true it stays true.
 */
export async function isPublicLessonsMigrationComplete(db: Firestore): Promise<boolean> {
  const snap = await getDoc(migrationMarkerRef(db));
  if (!snap.exists()) return false;
  const data = snap.data() as Partial<PublicLessonsMigrationDoc>;
  return data.publicLessonsContentVersion === PUBLIC_LESSONS_CONTENT_VERSION;
}

/**
 * Owner-only, idempotent backfill for `publicLessons` documents written
 * before M3F-08 (no `content`, or a corrupt non-string value), and completion
 * flags written before the student progress bar existed. Reads the
 * canonical Markdown from Storage as the owner (the only reader storage.rules
 * still allows), derives the body the same way every other write path does
 * (`parseLessonMetadata`), validates size, and patches only `content` and
 * `completed`. Already-migrated documents (valid `content` and boolean
 * `completed`
 * already present) are counted as `skipped`, not touched, so rerunning this
 * after a partial failure never re-writes or duplicates anything.
 *
 * Sets `settings/publicLessonsMigration` only when the run ends with zero
 * failures — a partial run leaves the marker untouched (or absent), so the
 * trigger in Didattica stays visible and the docente can rerun.
 */
export async function backfillPublicLessonsContent(
  ownerUid: string,
  db: Firestore,
  _legacyStorage?: unknown,
): Promise<BackfillSummary> {
  const snap = await getDocs(
    query(collection(db, 'publicLessons'), where('ownerUid', '==', ownerUid)),
  );

  const summary: BackfillSummary = {
    analyzed: snap.docs.length,
    migrated: 0,
    skipped: 0,
    failed: [],
  };

  const legacyDocs = snap.docs.filter((d) => {
    const data = d.data() as Partial<PublicLessonDoc>;
    return normalizeLessonContent(data.content) === null || typeof data.completed !== 'boolean';
  });
  summary.skipped = snap.docs.length - legacyDocs.length;

  const paths = legacyDocs
    .filter((docSnap) => {
      const data = docSnap.data() as Partial<PublicLessonDoc>;
      return normalizeLessonContent(data.content) === null;
    })
    .map((docSnap) => (docSnap.data() as Partial<PublicLessonDoc>).contentPath)
    .filter((path): path is string => typeof path === 'string' && path.length > 0);
  let contentResults: Awaited<ReturnType<typeof readTexts>> = [];
  let contentReadError: string | null = null;
  try {
    contentResults = paths.length > 0 ? await readTexts(paths) : [];
  } catch (err) {
    contentReadError = err instanceof Error ? err.message : 'Gateway batch-read non disponibile.';
  }
  const resultByPath = new Map(contentResults.map((result) => [result.path, result]));

  await runWithConcurrency(legacyDocs, BACKFILL_CONCURRENCY, async (docSnap) => {
    const data = docSnap.data() as Partial<PublicLessonDoc>;
    try {
      const patch: { content?: string; completed?: boolean } = {};

      if (normalizeLessonContent(data.content) === null) {
        const contentPath = data.contentPath;
        if (!contentPath) throw new Error('contentPath mancante sulla proiezione.');
        if (contentReadError) throw new Error(contentReadError);
        const result = resultByPath.get(contentPath);
        if (!result?.ok) {
          throw new Error(result?.error.message ?? 'File non trovato dal gateway.');
        }
        const { body } = parseLessonMetadata(result.content);
        assertLessonContentSize(body, data.filename ?? docSnap.id);
        patch.content = body;
      }

      if (typeof data.completed !== 'boolean') {
        if (!data.programId || !data.importId) {
          throw new Error('Identità tecnica mancante sulla proiezione.');
        }
        const scopedPrefix = `${data.importId}_`;
        const lessonId = docSnap.id.startsWith(scopedPrefix)
          ? docSnap.id.slice(scopedPrefix.length)
          : docSnap.id;
        const lessonSnap = await getDoc(
          doc(db, 'programs', data.programId, 'imports', data.importId, 'lessons', lessonId),
        );
        if (!lessonSnap.exists()) throw new Error('Lezione tecnica non trovata.');
        const lesson = lessonSnap.data() as Partial<LessonDoc>;
        patch.completed = lesson.completed === true;
      }

      await updateDoc(doc(db, 'publicLessons', docSnap.id), patch);
      summary.migrated += 1;
    } catch (err) {
      summary.failed.push({
        id: docSnap.id,
        reason: err instanceof Error ? err.message : 'Errore sconosciuto durante il backfill.',
      });
    }
  });

  if (summary.failed.length === 0) {
    await setDoc(migrationMarkerRef(db), {
      publicLessonsContentVersion: PUBLIC_LESSONS_CONTENT_VERSION,
      completedAt: serverTimestamp(),
    } satisfies PublicLessonsMigrationDoc);
  }

  return summary;
}
