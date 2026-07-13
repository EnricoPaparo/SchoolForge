import { getBytes, ref } from 'firebase/storage';
import type { FirebaseStorage } from 'firebase/storage';

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
