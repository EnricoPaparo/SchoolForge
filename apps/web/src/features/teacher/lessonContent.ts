import { getDownloadURL, ref } from 'firebase/storage';
import type { FirebaseStorage } from 'firebase/storage';

/**
 * Fetches the Markdown text content of a lesson from Firebase Storage.
 * Uses DI pattern (accepts storage instance as parameter).
 */
export async function fetchLessonContent(
  storageRef: string,
  storage: FirebaseStorage,
): Promise<string> {
  const fileRef = ref(storage, storageRef);
  const url = await getDownloadURL(fileRef);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch lesson content: ${response.status} ${response.statusText}`);
  }
  return response.text();
}
