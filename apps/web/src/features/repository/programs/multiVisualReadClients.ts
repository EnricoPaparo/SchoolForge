import { doc, getDoc } from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import type { LessonVisualPublicManifest } from '../../../types/firestore.js';
import type { LessonVisualBytes } from './visualReadClients.js';

export async function readStudentVisualBytesMulti(params: {
  db: Firestore;
  publicLessonId: string;
  manifests: LessonVisualPublicManifest[];
}): Promise<LessonVisualBytes[]> {
  if (params.manifests.length === 0) return [];
  const snap = await getDoc(doc(params.db, 'publicLessonVisuals', params.publicLessonId));
  if (!snap.exists()) return [];
  const data = snap.data() as Record<string, unknown>;
  if (data.publicLessonId !== params.publicLessonId || !isPlainObject(data.bytes)) return [];
  return params.manifests.flatMap((manifest) => {
    const entry = (data.bytes as Record<string, unknown>)[manifest.assetId];
    if (!isPlainObject(entry) || typeof entry.dataUri !== 'string') return [];
    if (entry.width !== manifest.width || entry.height !== manifest.height) return [];
    return [
      {
        assetId: manifest.assetId,
        dataUri: entry.dataUri,
        width: manifest.width,
        height: manifest.height,
      },
    ];
  });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
