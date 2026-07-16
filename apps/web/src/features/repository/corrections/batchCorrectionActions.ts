import type { Firestore } from 'firebase/firestore';
import { mapWithConcurrency } from '../verifications/mapWithConcurrency.js';
import { completeCorrection, reopenCorrection, returnCorrection } from './correctionsService.js';
import { isFullyEvaluated, type CorrectionProgress } from './correctionProgressService.js';

/**
 * M5-04 — azioni massive sulle correzioni selezionate: **Completa**, **Riapri**,
 * **Restituisci**. La UI calcola un riepilogo preliminare di eleggibilità (qui,
 * funzioni pure), ma la validazione **definitiva** resta ai service M4
 * (`completeCorrection`/`reopenCorrection`/`returnCorrection`), che questo modulo
 * si limita a invocare — **una volta per consegna**, con concorrenza limitata.
 * Nessuna Cloud Function, nessuna modifica alle `evaluations`, nessun provider IA.
 */

export type BatchAction = 'complete' | 'reopen' | 'return';

/** Motivo sintetico di esclusione (nessun dato sensibile). */
export type BatchExclusionReason =
  | 'no_correction'
  | 'not_in_progress'
  | 'not_fully_evaluated'
  | 'not_completed'
  | 'not_completed_or_returned'
  | 'already_returned';

export interface BatchSelectedRow {
  studentUid: string;
  studentName: string;
  submissionId: string;
  /** Progresso della correzione, o `undefined` se non esiste ancora. */
  progress: CorrectionProgress | undefined;
}

export interface BatchEligibleRow {
  studentUid: string;
  studentName: string;
  submissionId: string;
}

export interface BatchExcludedRow {
  studentUid: string;
  studentName: string;
  reason: BatchExclusionReason;
}

export interface BatchEligibility {
  eligible: BatchEligibleRow[];
  excluded: BatchExcludedRow[];
}

/** Massimo di service M4 invocati simultaneamente (concorrenza prudente). */
export const BATCH_CONCURRENCY = 3;

/**
 * Classifica una riga selezionata come eleggibile o esclusa per l'azione,
 * usando **solo** i dati già letti (`CorrectionProgress`). Funzione pura: il
 * risultato è indicativo per la conferma; il service M4 rivaluta comunque.
 */
export function classifyRow(
  action: BatchAction,
  row: BatchSelectedRow,
): BatchExclusionReason | null {
  const p = row.progress;
  if (!p) return 'no_correction';
  switch (action) {
    case 'complete':
      if (p.status !== 'in_progress') return 'not_in_progress';
      if (!isFullyEvaluated(p)) return 'not_fully_evaluated';
      return null;
    case 'reopen':
      if (p.status !== 'completed' && p.status !== 'returned') return 'not_completed_or_returned';
      return null;
    case 'return':
      if (p.status === 'returned') return 'already_returned';
      if (p.status !== 'completed') return 'not_completed';
      return null;
  }
}

/** Riepilogo preliminare di eleggibilità per la conferma. */
export function computeEligibility(
  action: BatchAction,
  rows: BatchSelectedRow[],
): BatchEligibility {
  const eligible: BatchEligibleRow[] = [];
  const excluded: BatchExcludedRow[] = [];
  for (const row of rows) {
    const reason = classifyRow(action, row);
    if (reason === null) {
      eligible.push({
        studentUid: row.studentUid,
        studentName: row.studentName,
        submissionId: row.submissionId,
      });
    } else {
      excluded.push({ studentUid: row.studentUid, studentName: row.studentName, reason });
    }
  }
  return { eligible, excluded };
}

export interface BatchRowResult {
  studentUid: string;
  submissionId: string;
  outcome: 'succeeded' | 'failed';
  /** Messaggio d'errore leggibile del service M4, presente solo se `failed`. */
  error?: string;
}

const SERVICE: Record<BatchAction, (submissionId: string, db: Firestore) => Promise<void>> = {
  complete: completeCorrection,
  reopen: reopenCorrection,
  return: returnCorrection,
};

/**
 * Esegue il service M4 corretto **una volta per consegna eleggibile**, con al
 * massimo `BATCH_CONCURRENCY` operazioni simultanee (worker-pool, mai
 * `Promise.all` senza limite). Un errore su una consegna **non** blocca le
 * altre: viene catturato e riportato come esito per-riga. Nessun retry
 * automatico.
 */
export async function runBatchCorrectionAction(
  action: BatchAction,
  rows: BatchEligibleRow[],
  db: Firestore,
): Promise<BatchRowResult[]> {
  const service = SERVICE[action];
  return mapWithConcurrency(rows, BATCH_CONCURRENCY, async (row) => {
    try {
      await service(row.submissionId, db);
      return { studentUid: row.studentUid, submissionId: row.submissionId, outcome: 'succeeded' };
    } catch (err) {
      return {
        studentUid: row.studentUid,
        submissionId: row.submissionId,
        outcome: 'failed',
        error: err instanceof Error ? err.message : 'Operazione non riuscita.',
      };
    }
  });
}

/** Etichetta leggibile per un motivo di esclusione. */
export function describeBatchExclusion(reason: BatchExclusionReason): string {
  switch (reason) {
    case 'no_correction':
      return 'Nessuna correzione presente';
    case 'not_in_progress':
      return 'Non è in correzione';
    case 'not_fully_evaluated':
      return 'Non tutte le domande sono valutate';
    case 'not_completed':
      return 'Non ancora completata';
    case 'not_completed_or_returned':
      return 'Non è completata né restituita';
    case 'already_returned':
      return 'Già restituita';
  }
}
