import { httpsCallable } from 'firebase/functions';
import type { Functions } from 'firebase/functions';

/**
 * VISUAL-ENRICHMENT-03C — client dell'unica operazione binaria.
 *
 * Ricalca deliberatamente il client testuale del gateway (`readTexts`): batch
 * bounded, ordine verificato elemento per elemento, nessun retry infinito. Le
 * differenze rispetto a quello sono due, ed entrambe sono volute:
 *
 * - **nessun risultato parziale.** Il gateway testuale restituisce un esito per
 *   file e chi chiama decide; qui un visual dichiarato che non arriva fa
 *   fallire l'export, perché un archivio a cui manca in silenzio una figura
 *   sembra completo ed è il modo peggiore di perdere un dato;
 * - **niente dimezzamento sul limite di byte.** La suddivisione è per numero di
 *   lezioni, e il tetto per immagine garantisce già che un batch pieno stia
 *   sotto il tetto della risposta.
 *
 * I limiti sono duplicati da `functions/src/aiVisualExport.ts` perché il web non
 * può importare da Functions. La duplicazione è dichiarata e verificata da un
 * test che confronta i due valori: se divergessero, il client comporrebbe batch
 * che il server rifiuta.
 */

/** Deve restare uguale a `MAX_VISUAL_EXPORT_LESSONS_PER_BATCH` lato Functions. */
export const VISUAL_EXPORT_LESSONS_PER_BATCH = 13;

/** Deve restare uguale a `MAX_VISUAL_EXPORT_CONCURRENCY` lato Functions. */
export const VISUAL_EXPORT_CONCURRENCY = 2;

/** Deve restare uguale a `VISUAL_EXPORT_ZIP_PREFIX` lato Functions. */
export const VISUAL_EXPORT_ZIP_PREFIX = 'visuals/';

export interface VisualExportRequest {
  programId: string;
  importId: string;
  lessonIds: string[];
}

export type VisualExportItem =
  | { lessonId: string; status: 'absent' }
  | {
      lessonId: string;
      status: 'present';
      assetId: string;
      manifestJson: string;
      base64: string;
      byteLength: number;
    }
  | {
      lessonId: string;
      status: 'multi';
      assets: Array<{
        assetId: string;
        manifestJson: string;
        base64: string;
        byteLength: number;
      }>;
    };

export class VisualExportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VisualExportError';
  }
}

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * Valida la forma di un elemento **prima** di fidarsene.
 *
 * Non è diffidenza verso il nostro stesso server: è che questo valore diventa
 * il nome di un file dentro un archivio che l'utente aprirà altrove, e un
 * `assetId` inatteso smetterebbe di essere un dato per diventare una posizione
 * nel filesystem di chi lo estrae.
 */
function parseItem(raw: unknown, expectedLessonId: string): VisualExportItem {
  if (typeof raw !== 'object' || raw === null) {
    throw new VisualExportError('Risposta dell’export visuale non valida.');
  }
  const item = raw as Record<string, unknown>;
  if (item.lessonId !== expectedLessonId) {
    throw new VisualExportError('L’ordine della risposta dell’export non è quello richiesto.');
  }
  if (item.status === 'absent') {
    return { lessonId: expectedLessonId, status: 'absent' };
  }
  if (item.status === 'multi') {
    if (
      Object.keys(item).sort().join(',') !== 'assets,lessonId,status' ||
      !Array.isArray(item.assets) ||
      item.assets.length < 1 ||
      item.assets.length > 3
    ) {
      throw new VisualExportError('Risposta multi-visuale non valida.');
    }
    const seen = new Set<string>();
    const assets = item.assets.map((raw) => {
      if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        throw new VisualExportError('Asset multi-visuale non valido.');
      }
      const asset = raw as Record<string, unknown>;
      if (
        Object.keys(asset).sort().join(',') !== 'assetId,base64,byteLength,manifestJson' ||
        typeof asset.assetId !== 'string' ||
        !UUID_V4_RE.test(asset.assetId) ||
        seen.has(asset.assetId) ||
        typeof asset.manifestJson !== 'string' ||
        asset.manifestJson.length === 0 ||
        typeof asset.base64 !== 'string' ||
        asset.base64.length === 0 ||
        typeof asset.byteLength !== 'number' ||
        !Number.isInteger(asset.byteLength) ||
        asset.byteLength <= 0
      ) {
        throw new VisualExportError('Asset multi-visuale non valido.');
      }
      seen.add(asset.assetId);
      return {
        assetId: asset.assetId,
        manifestJson: asset.manifestJson,
        base64: asset.base64,
        byteLength: asset.byteLength,
      };
    });
    return { lessonId: expectedLessonId, status: 'multi', assets };
  }
  if (
    item.status !== 'present' ||
    typeof item.assetId !== 'string' ||
    !UUID_V4_RE.test(item.assetId) ||
    typeof item.manifestJson !== 'string' ||
    item.manifestJson.length === 0 ||
    typeof item.base64 !== 'string' ||
    item.base64.length === 0 ||
    typeof item.byteLength !== 'number' ||
    !Number.isInteger(item.byteLength) ||
    item.byteLength <= 0
  ) {
    throw new VisualExportError(
      `L’immagine della lezione ${expectedLessonId} è arrivata in una forma non valida.`,
    );
  }
  return {
    lessonId: expectedLessonId,
    status: 'present',
    assetId: item.assetId,
    manifestJson: item.manifestJson,
    base64: item.base64,
    byteLength: item.byteLength,
  };
}

function reconcile(requested: readonly string[], rawItems: unknown): VisualExportItem[] {
  if (!Array.isArray(rawItems) || rawItems.length !== requested.length) {
    throw new VisualExportError('La risposta dell’export non copre tutte le lezioni richieste.');
  }
  const seen = new Set<string>();
  return requested.map((lessonId, index) => {
    if (seen.has(lessonId)) {
      throw new VisualExportError('La risposta dell’export contiene un duplicato.');
    }
    seen.add(lessonId);
    return parseItem(rawItems[index], lessonId);
  });
}

/**
 * Esegue i batch con concorrenza limitata **conservando l'ordine canonico**.
 *
 * L'ordine dei risultati non può dipendere dal completamento delle promise: i
 * percorsi dell'archivio ne discendono, e un archivio il cui ordine fisico
 * cambia a ogni export è un archivio che non si può confrontare con il
 * precedente. Ogni batch scrive nel proprio slot, mai in coda a un array
 * condiviso.
 */
async function runBounded<T>(
  tasks: ReadonlyArray<() => Promise<T>>,
  concurrency: number,
): Promise<T[]> {
  const results = new Array<T>(tasks.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, async () => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= tasks.length) return;
      results[index] = await tasks[index]!();
    }
  });
  await Promise.all(workers);
  return results;
}

export function createVisualExportClient(functions: Functions) {
  const exportBatch = httpsCallable<VisualExportRequest, { items?: unknown }>(
    functions,
    'aiVisualExportBatch',
  );

  return {
    /**
     * Legge i visual di tutte le lezioni indicate, in quante chiamate servono.
     *
     * I `lessonIds` sono deduplicati **conservando la prima posizione**: una
     * stessa immagine non viene mai riletta due volte, e l'ordine resta quello
     * canonico deciso dal chiamante.
     */
    async fetchLessonVisuals(request: VisualExportRequest): Promise<VisualExportItem[]> {
      const lessonIds = [...new Set(request.lessonIds)];
      if (lessonIds.length === 0) return [];

      const batches: string[][] = [];
      for (let i = 0; i < lessonIds.length; i += VISUAL_EXPORT_LESSONS_PER_BATCH) {
        batches.push(lessonIds.slice(i, i + VISUAL_EXPORT_LESSONS_PER_BATCH));
      }

      const perBatch = await runBounded(
        batches.map((batch) => async () => {
          const response = await exportBatch({
            programId: request.programId,
            importId: request.importId,
            lessonIds: batch,
          });
          return reconcile(batch, response.data?.items);
        }),
        VISUAL_EXPORT_CONCURRENCY,
      );

      const items = perBatch.flat();
      // Ricontrollo complessivo: i singoli batch sono coerenti ciascuno con la
      // propria richiesta, ma è la ricomposizione a dover corrispondere
      // all'ordine canonico completo.
      if (items.length !== lessonIds.length) {
        throw new VisualExportError('La ricomposizione dell’export non è completa.');
      }
      items.forEach((item, index) => {
        if (item.lessonId !== lessonIds[index]) {
          throw new VisualExportError('La ricomposizione dell’export non rispetta l’ordine.');
        }
      });
      return items;
    },
  };
}

export type VisualExportClient = ReturnType<typeof createVisualExportClient>;
