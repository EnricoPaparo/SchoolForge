/**
 * VISUAL-ENRICHMENT — autenticazione owner-only e rilettura autorevole di
 * identità della lezione, condivise da **tutti** i gateway del dominio
 * visuale (VE e MULTI-VISUAL).
 *
 * **Estratto da `aiVisualGateway.ts` in MULTI-VISUAL-02**, comportamento
 * bit-per-bit invariato — nessuna logica cambiata, solo il file che la
 * dichiara. Il motivo è la dipendenza: `aiVisualGateway.ts` importa
 * `onCall`/`HttpsError` da `firebase-functions/v2/https` per **definire**
 * le callable, ma `requireOwner`/`authorizeVisualCaller`/
 * `readAuthoritativeLesson` non usano quel trasporto — sono solo
 * autenticazione e letture Firestore. Tenerle nello stesso modulo delle
 * callable costringerebbe **ogni** consumatore (incluso un secondo gateway
 * come `aiVisualUploadGateway.ts`) a trascinarsi dentro l'intera
 * dichiarazione delle callable VE solo per riusare due funzioni pure di
 * lettura — un accoppiamento che questo modulo elimina senza duplicare
 * nulla: `aiVisualGateway.ts` importa da qui esattamente come farebbe un
 * secondo gateway.
 */

import type { Firestore } from 'firebase-admin/firestore';
import type { CallableRequest } from 'firebase-functions/v2/https';
import { AiVisualError } from './aiVisualCore.js';
import {
  checkLessonForVisual,
  checkProjectionForVisual,
  describeVisualBindingFailure,
} from './aiVisualLessonBinding.js';

export function lessonPath(programId: string, importId: string, lessonId: string): string {
  return `programs/${programId}/imports/${importId}/lessons/${lessonId}`;
}

export function authorizeVisualCaller(uid: unknown, ownerUid: unknown): string {
  if (typeof uid !== 'string' || uid.length === 0) {
    throw new AiVisualError('unauthenticated', 'Autenticazione richiesta.');
  }
  if (typeof ownerUid !== 'string' || ownerUid !== uid) {
    throw new AiVisualError('not_owner', 'Accesso riservato al docente proprietario.');
  }
  return uid;
}

export async function requireOwner(
  request: CallableRequest<unknown>,
  db: Firestore,
): Promise<string> {
  const uid = request.auth?.uid;
  if (typeof uid !== 'string' || uid.length === 0) {
    throw new AiVisualError('unauthenticated', 'Autenticazione richiesta.');
  }
  const ownerSnap = await db.doc('settings/owner').get();
  const ownerUid = ownerSnap.exists ? ownerSnap.data()?.ownerUid : null;
  return authorizeVisualCaller(uid, ownerUid);
}

/**
 * Legge la lezione e la sua proiezione, verifica che siano coerenti fra loro, e
 * restituisce i soli valori **autorevoli**: id pubblico, UDA, corpo salvato e
 * stato di svolgimento.
 *
 * Le due letture sono sequenziali di proposito. L'indirizzo della proiezione non
 * è quello ricevuto dal chiamante ma quello **derivato** dal documento tecnico,
 * quindi non può essere calcolato prima di aver letto il primo documento: un
 * `getAll` parallelo richiederebbe di fidarsi di un id che è esattamente ciò che
 * questo cancello rifiuta di considerare autorevole.
 */
export async function readAuthoritativeLesson(
  db: Firestore,
  params: { ownerUid: string; programId: string; importId: string; lessonId: string },
): Promise<{
  publicLessonId: string;
  udaDir: string;
  body: string;
  completed: boolean;
}> {
  const { ownerUid, programId, importId, lessonId } = params;
  const lessonSnap = await db.doc(lessonPath(programId, importId, lessonId)).get();
  const lesson = lessonSnap.exists ? (lessonSnap.data() as Record<string, unknown>) : null;
  const gate = checkLessonForVisual({ lesson, lessonId, ownerUid, importId });
  if (!gate.ok) {
    throw new AiVisualError('invalid_input', describeVisualBindingFailure(gate.failure));
  }

  const publicSnap = await db.doc(`publicLessons/${gate.publicLessonId}`).get();
  const projectionGate = checkProjectionForVisual({
    lesson: lesson as Record<string, unknown>,
    publicLesson: publicSnap.exists ? (publicSnap.data() as Record<string, unknown>) : null,
    programId,
    importId,
    ownerUid,
  });
  if (!projectionGate.ok) {
    throw new AiVisualError('invalid_input', describeVisualBindingFailure(projectionGate.failure));
  }
  return {
    publicLessonId: gate.publicLessonId,
    udaDir: gate.udaDir,
    body: projectionGate.body,
    completed: projectionGate.completed,
  };
}
