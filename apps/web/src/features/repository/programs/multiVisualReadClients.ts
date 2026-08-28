import { doc, getDoc } from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import type { Functions } from 'firebase/functions';
import type { LessonVisualItem, LessonVisualPublicManifest } from '../../../types/firestore.js';
import type { LessonVisualBytes } from './visualReadClients.js';
import { composeVisualDataUri, readPublicLessonVisualBytesMulti } from './lessonVisualContract.js';
import { createVisualExportClient, VisualExportError } from './visualExportClient.js';

export function createTeacherMultiVisualReader(functions: Functions) {
  const client = createVisualExportClient(functions);
  return async function readTeacherMultiVisualBytes(params: {
    programId: string;
    importId: string;
    lessonId: string;
    manifests: LessonVisualItem[];
  }): Promise<LessonVisualBytes[]> {
    if (params.manifests.length === 0) return [];
    const [item] = await client.fetchLessonVisuals({
      programId: params.programId,
      importId: params.importId,
      lessonIds: [params.lessonId],
    });
    if (!item || item.status !== 'multi') {
      throw new VisualExportError('Risposta multi-visuale docente non valida.');
    }
    const expected = params.manifests.map((manifest) => manifest.assetId);
    if (
      item.assets.length !== expected.length ||
      item.assets.some((asset, index) => asset.assetId !== expected[index])
    ) {
      throw new VisualExportError('Ordine multi-visuale docente divergente dal manifest.');
    }
    return item.assets.map((asset, index) => {
      const manifest = params.manifests[index]!;
      const dataUri = composeVisualDataUri(asset.base64);
      if (dataUri === null) throw new VisualExportError('Byte multi-visuali docente non validi.');
      return {
        assetId: asset.assetId,
        dataUri,
        width: manifest.width,
        height: manifest.height,
      };
    });
  };
}

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
