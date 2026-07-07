import { getBytes, ref } from 'firebase/storage';
import type { FirebaseStorage } from 'firebase/storage';

export async function fetchLessonContent(
  storageRef: string,
  storage: FirebaseStorage,
): Promise<string> {
  const fileRef = ref(storage, storageRef);
  const bytes = await getBytes(fileRef);
  return new TextDecoder().decode(bytes);
}
