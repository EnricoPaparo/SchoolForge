import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { SCHOOLFORGE_FUNCTION_REGION } from './deploymentRegion.js';
import { renderTeacherLessonPdfBytes, validateLessonPdfInput } from './teacherLessonPdfCore.js';

if (!getApps().length) initializeApp();

export const renderTeacherLessonPdf = onCall(
  {
    region: SCHOOLFORGE_FUNCTION_REGION,
    memory: '1GiB',
    timeoutSeconds: 120,
    concurrency: 1,
    minInstances: 0,
    maxInstances: 2,
  },
  async (request) => {
    if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Accedi per scaricare il PDF.');
    const owner = await getFirestore().doc('settings/owner').get();
    if (owner.data()?.ownerUid !== request.auth.uid)
      throw new HttpsError('permission-denied', 'Esportazione riservata al docente.');
    let html: string;
    try {
      html = validateLessonPdfInput(request.data);
    } catch {
      throw new HttpsError('invalid-argument', 'Richiesta PDF non valida o troppo grande.');
    }
    try {
      const bytes = await renderTeacherLessonPdfBytes(html);
      return { base64: bytes.toString('base64') };
    } catch {
      throw new HttpsError(
        'internal',
        'Impossibile completare il PDF. Controlla le immagini e riprova.',
      );
    }
  },
);
