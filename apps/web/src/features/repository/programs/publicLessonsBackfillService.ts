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
import type { FirebaseStorage } from 'firebase/storage';
import { getBytes, ref } from 'firebase/storage';
import { parseLessonMetadata } from '../validation/lessonMetadata.js';
import { assertLessonContentSize, normalizeLessonContent } from './lessonContentSize.js';
import type { PublicLessonDoc, PublicLessonsMigrationDoc } from '../../../types/firestore.js';

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

/** The only migration this marker tracks so far — see PublicLessonsMigrationDoc. */
const PUBLIC_LESSONS_CONTENT_VERSION = 1;

function migrationMarkerRef(db: Firestore) {
  return doc(db, 'settings', 'publicLessonsMigration');
}

/**
 * Owner-only cheap check: reads a single settings document instead of
 * scanning every `publicLessons` doc, so `LessonsView` can decide whether to
 * show the backfill trigger without a `getDocs` sweep on each mount. `true`
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
 * before M3F-08 (no `content`, or a corrupt non-string value). Reads the
 * canonical Markdown from Storage as the owner (the only reader storage.rules
 * still allows), derives the body the same way every other write path does
 * (`parseLessonMetadata`), validates size, and patches only `content` — never
 * touches any other field. Already-migrated documents (valid `content`
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
  storage: FirebaseStorage,
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
    return normalizeLessonContent(data.content) === null;
  });
  summary.skipped = snap.docs.length - legacyDocs.length;

  await runWithConcurrency(legacyDocs, BACKFILL_CONCURRENCY, async (docSnap) => {
    const data = docSnap.data() as Partial<PublicLessonDoc>;
    const contentPath = data.contentPath;
    if (!contentPath) {
      summary.failed.push({ id: docSnap.id, reason: 'contentPath mancante sulla proiezione.' });
      return;
    }
    try {
      const bytes = await getBytes(ref(storage, contentPath));
      const raw = new TextDecoder().decode(bytes);
      const { body } = parseLessonMetadata(raw);
      assertLessonContentSize(body, data.filename ?? docSnap.id);
      await updateDoc(doc(db, 'publicLessons', docSnap.id), { content: body });
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
