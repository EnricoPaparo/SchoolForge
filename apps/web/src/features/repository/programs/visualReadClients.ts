import { doc, getDoc } from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import type { Functions } from 'firebase/functions';
import type { LessonVisualPublicManifest } from '../../../types/firestore.js';
import { composeVisualDataUri, readPublicLessonVisualBytes } from './lessonVisualContract.js';

/**
 * VISUAL-ENRICHMENT-04A — le due letture dei byte, una per ruolo.
 *
 * Sono deliberatamente **diverse**, perché le due sorgenti sono diverse:
 *
 * - il **docente** ha il manifest privato sul `LessonDoc` ma non i byte, che
 *   stanno nel suo repository Storage e a cui nessun client accede: passa dalla
 *   callable di export, l'unica operazione binaria del sistema;
 * - lo **studente** non ha accesso a Storage in nessuna forma: legge i byte da
 *   `publicLessonVisuals`, con una `getDoc` puntuale.
 *
 * In entrambi i casi la lettura avviene **solo se un manifest esiste**. Una
 * lezione senza immagine — la stragrande maggioranza — non produce nemmeno una
 * operazione, ed è la garanzia che rende questa funzione a costo zero per chi
 * non la usa.
 */

export interface LessonVisualBytes {
  assetId: string;
  dataUri: string;
  width: number;
  height: number;
}

// ── Docente ────────────────────────────────────────────────────────────────────

interface ExportBatchResponse {
  items?: unknown;
}

export class VisualReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VisualReadError';
  }
}

/**
 * Legge i byte di **una sola** lezione riusando `aiVisualExportBatch`.
 *
 * Non esiste una callable dedicata alla lettura del docente, e non serve: la
 * forma della risposta è già quella giusta, già verificata server-side contro
 * hash, dimensioni e struttura WebP. Aggiungere una seconda operazione binaria
 * avrebbe significato una seconda superficie da difendere per ottenere gli
 * stessi byte.
 *
 * `null` quando il server risponde `absent` o quando la risposta non è
 * conforme: il docente legge la lezione senza figura, mai un'immagine rotta.
 */
export function createTeacherVisualReader(functions: Functions) {
  const exportBatch = httpsCallable<
    { programId: string; importId: string; lessonIds: string[] },
    ExportBatchResponse
  >(functions, 'aiVisualExportBatch');

  return async function readLessonVisualBytes(params: {
    programId: string;
    importId: string;
    lessonId: string;
    manifest: { assetId: string; width: number; height: number };
  }): Promise<LessonVisualBytes | null> {
    const { programId, importId, lessonId, manifest } = params;
    const response = await exportBatch({ programId, importId, lessonIds: [lessonId] });

    const items = response.data?.items;
    if (!Array.isArray(items) || items.length !== 1) {
      throw new VisualReadError('Risposta dell’immagine non valida.');
    }
    const item = items[0] as Record<string, unknown> | null;
    if (typeof item !== 'object' || item === null) {
      throw new VisualReadError('Risposta dell’immagine non valida.');
    }
    if (item.lessonId !== lessonId) {
      throw new VisualReadError('La risposta non riguarda questa lezione.');
    }
    // `absent` è un esito legittimo del server, ma non qui: siamo arrivati
    // fin qui **perché** il LessonDoc dichiara un manifest, quindi i due
    // documenti divergono e non si indovina quale abbia ragione.
    if (item.status !== 'present') return null;
    if (item.assetId !== manifest.assetId) return null;

    const dataUri = composeVisualDataUri(item.base64);
    if (dataUri === null) return null;

    return {
      assetId: manifest.assetId,
      dataUri,
      width: manifest.width,
      height: manifest.height,
    };
  };
}

// ── Studente ───────────────────────────────────────────────────────────────────

/**
 * Legge i byte pubblici di una lezione, **una sola volta e su richiesta**.
 *
 * `getDoc` e non `onSnapshot`: l'immagine di una lezione non cambia mentre lo
 * studente la sta leggendo, e un listener costerebbe una connessione aperta per
 * osservare qualcosa che non si muove. Nessun retry: un errore di rete lascia
 * la lezione senza figura, che è esattamente com'era prima.
 *
 * Il documento è validato **contro il manifest che lo ha annunciato**: un
 * documento rimasto indietro — lezione smarcata, immagine sostituita — non deve
 * poter essere mostrato al posto di quello giusto.
 */
export async function readStudentVisualBytes(params: {
  db: Firestore;
  publicLessonId: string;
  manifest: LessonVisualPublicManifest;
}): Promise<LessonVisualBytes | null> {
  const { db, publicLessonId, manifest } = params;

  const snap = await getDoc(doc(db, 'publicLessonVisuals', publicLessonId));
  if (!snap.exists()) return null;

  const bytes = readPublicLessonVisualBytes({
    data: snap.data(),
    publicLessonId,
    manifest,
  });
  if (bytes === null) return null;

  return {
    assetId: bytes.assetId,
    dataUri: bytes.dataUri,
    width: bytes.width,
    height: bytes.height,
  };
}
