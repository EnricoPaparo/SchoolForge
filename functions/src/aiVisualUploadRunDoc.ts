/**
 * MULTI-VISUAL-02 — adapter Firestore di `VisualUploadRun`
 * (`visualUploadRuns/{opaqueUploadRunId}`, roadmap §9.6).
 *
 * Sottile per disegno: la validazione strutturale vive interamente in
 * `aiVisualUploadCore.ts` (`validateVisualUploadRun`, puro). Questo modulo
 * aggiunge **solo** l'interoperabilità con Firestore — `serializeVisualUploadRun`
 * passa il documento così com'è (i tre istanti sono già `Timestamp` reali,
 * scritti dal gateway) — e la traduzione «malformato → `null`», nell'idioma
 * già in uso per `parseVisualRunDocument`/`parseStoredVisualCandidate`, così
 * il chiamante transazionale può distinguere «assente» (nessuna snapshot) da
 * «presente ma corrotto» (snapshot esiste, `null` dal parser) senza
 * catturare eccezioni dentro la transazione.
 */

import { AiVisualMultiError } from './aiVisualMultiCore.js';
import { validateVisualUploadRun, type VisualUploadRun } from './aiVisualUploadCore.js';

export function serializeVisualUploadRun(run: VisualUploadRun): Record<string, unknown> {
  return {
    contractVersion: run.contractVersion,
    ownerUid: run.ownerUid,
    programId: run.programId,
    importId: run.importId,
    lessonId: run.lessonId,
    publicLessonId: run.publicLessonId,
    udaDir: run.udaDir,
    requestId: run.requestId,
    status: run.status,
    sourceBodyHash: run.sourceBodyHash,
    anchor: run.anchor,
    rawBytesSha256: run.rawBytesSha256,
    rawByteLength: run.rawByteLength,
    normalized: run.normalized,
    caption: run.caption,
    altText: run.altText,
    lastError: run.lastError,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    expireAt: run.expireAt,
  };
}

/**
 * `null` su qualunque divergenza strutturale — mai un'eccezione che
 * risalirebbe fuori da una transazione Firestore. Il chiamante decide, in
 * base al fatto che la snapshot esistesse o no, se `null` significa
 * «nessun run» o «`corrupted_state`» (stessa disciplina di VE).
 */
export function parseStoredVisualUploadRun(data: unknown): VisualUploadRun | null {
  try {
    return validateVisualUploadRun(data);
  } catch (error) {
    if (error instanceof AiVisualMultiError) return null;
    throw error;
  }
}
