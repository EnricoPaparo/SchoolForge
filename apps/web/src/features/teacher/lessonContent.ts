import { doc, getDoc } from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import { getBytes, ref } from 'firebase/storage';
import type { FirebaseStorage } from 'firebase/storage';
import type { PublicLessonDoc } from '../../types/firestore.js';
import { normalizeLessonContent } from '../repository/programs/lessonContentSize.js';

/** Which source served (or failed to serve) the lesson body — for diagnostics. */
export type LessonContentSource = 'firestore' | 'storage';

/**
 * MOB-01C — primary source for teacher lesson consultation: the already-synced
 * `publicLessons/{lessonId}.content` Firestore projection. Reading it avoids
 * the Storage `getBytes` round-trip that times out on Brave mobile
 * (`storage/retry-limit-exceeded`, ~120s) while Safari succeeds.
 *
 * One deterministic `getDoc`, then the projection is validated before use:
 * document must exist, and `ownerUid`/`programId`/`importId` must match the
 * course/import currently open (a stale projection from a previous import must
 * NOT be shown). `content` is read through `normalizeLessonContent`, so a
 * legacy pre-M3F-08 document (missing/non-string `content`) is treated as
 * "projection unavailable".
 *
 * Returns:
 *  - the body string (including a valid empty string) when the projection is
 *    present, matching and has usable `content` → caller renders it, no
 *    Storage read;
 *  - `null` when the projection is absent, mismatched, or has no valid
 *    `content` → caller falls back to the legacy Storage read.
 *
 * A thrown error (transient/permission-denied on the `getDoc`) is propagated
 * unchanged and must NOT trigger the Storage fallback — the caller surfaces it
 * and offers a manual retry, so a real problem is never hidden. Never reads
 * the pool or any private/technical field.
 */
export async function fetchPublicLessonContent(
  params: { lessonId: string; programId: string; importId: string; ownerUid: string },
  db: Firestore,
): Promise<string | null> {
  const snap = await getDoc(doc(db, 'publicLessons', params.lessonId));
  if (!snap.exists()) return null;
  const data = snap.data() as Partial<PublicLessonDoc>;
  if (
    data.ownerUid !== params.ownerUid ||
    data.programId !== params.programId ||
    data.importId !== params.importId
  ) {
    return null;
  }
  return normalizeLessonContent(data.content);
}

/**
 * Reads a lesson's Markdown from Storage via `getBytes` (XHR under the hood).
 * On failure it lets the ORIGINAL Firebase `StorageError` propagate unchanged
 * — never re-wrapping it in a generic `Error` — so the caller can classify its
 * `code` / HTTP status for diagnostics (MOB-01B).
 */
export async function fetchLessonContent(
  storageRef: string,
  storage: FirebaseStorage,
): Promise<string> {
  const fileRef = ref(storage, storageRef);
  const bytes = await getBytes(fileRef);
  return new TextDecoder().decode(bytes);
}
