import { collection, doc, getDocs, query, updateDoc, where } from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import type { FirebaseStorage } from 'firebase/storage';
import { getBytes, ref } from 'firebase/storage';
import { parseLessonMetadata } from '../validation/lessonMetadata.js';
import { assertLessonContentSize, normalizeLessonContent } from './lessonContentSize.js';
import type { PublicLessonDoc } from '../../../types/firestore.js';

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

/**
 * Owner-only, idempotent backfill for `publicLessons` documents written
 * before M3F-08 (no `content`, or a corrupt non-string value). Reads the
 * canonical Markdown from Storage as the owner (the only reader storage.rules
 * still allows), derives the body the same way every other write path does
 * (`parseLessonMetadata`), validates size, and patches only `content` — never
 * touches any other field. Already-migrated documents (valid `content`
 * already present) are counted as `skipped`, not touched, so rerunning this
 * after a partial failure never re-writes or duplicates anything.
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

  return summary;
}
