import { doc, getDoc } from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import type { LessonVisualPublicManifest } from '../../../types/firestore.js';
import type { LessonVisualBytes } from './visualReadClients.js';
import { readPublicLessonVisualBytesMulti } from './lessonVisualContract.js';

export async function readStudentVisualBytesMulti(params: {
  db: Firestore;
  publicLessonId: string;
  manifests: LessonVisualPublicManifest[];
}): Promise<LessonVisualBytes[]> {
  if (params.manifests.length === 0) return [];
  const snap = await getDoc(doc(params.db, 'publicLessonVisuals', params.publicLessonId));
  if (!snap.exists()) return [];
  const data = snap.data() as Record<string, unknown>;
  const parsed = readPublicLessonVisualBytesMulti({
    data,
    publicLessonId: params.publicLessonId,
    manifests: params.manifests,
  });
  return parsed ? Object.values(parsed) : [];
}
