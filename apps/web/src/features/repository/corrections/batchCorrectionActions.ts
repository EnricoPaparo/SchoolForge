import type { Firestore } from 'firebase/firestore';
import type { VerificationDoc } from '../../../types/firestore.js';
import { mapWithConcurrency } from '../verifications/mapWithConcurrency.js';
import { resolveAssignedQuestions } from '../verifications/assignedVariant.js';
import {
  clearCorrection,
  completeCorrection,
  reopenCorrection,
  returnCorrection,
} from './correctionsService.js';
import { isFullyEvaluated, type CorrectionProgress } from './correctionProgressService.js';

/**
 * M5-04 — azioni massive sulle correzioni selezionate: **Completa**, **Riapri**,
 * **Restituisci** e **Azzera**. La UI calcola un riepilogo preliminare di
 * eleggibilità con funzioni pure, ma la validazione **definitiva** resta ai
 * service M4 (`completeCorrection`/`reopenCorrection`/`returnCorrection`/
 * `clearCorrection`), che questo modulo invoca **una volta per consegna**, con
 * concorrenza limitata. Nessuna Cloud Function e nessun provider IA.
 */

export type BatchAction = 'complete' | 'reopen' | 'return' | 'clear';

/** Motivo sintetico di esclusione (nessun dato sensibile). */
export type BatchExclusionReason =
  | 'no_correction'
  | 'not_in_progress'
  | 'not_fully_evaluated'
  | 'not_completed'
  | 'not_completed_or_returned'
  | 'already_returned'
  | 'clear_requires_reopen'
  | 'nothing_to_clear'
  | 'invalid_variant';

export interface BatchSelectedRow {
  studentUid: string;
  studentName: string;
  submissionId: string;
  assignedQuestionOrders?: number[];
  assignedAnswerKeys?: string[];
  /** Progresso della correzione, o `undefined` se non esiste ancora. */
  progress: CorrectionProgress | undefined;
}

export interface BatchEligibleRow {
  studentUid: string;
  studentName: string;
  submissionId: string;
  assignedQuestionOrders?: number[];
  assignedAnswerKeys?: string[];
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
  if (!p) return action === 'clear' ? 'nothing_to_clear' : 'no_correction';
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
    case 'clear':
      if (p.status !== 'in_progress') return 'clear_requires_reopen';
      if (!p.hasContent) return 'nothing_to_clear';
      return null;
  }
}

/** Riepilogo preliminare di eleggibilità per la conferma. */
export function computeEligibility(
  action: BatchAction,
  rows: BatchSelectedRow[],
  verification?: VerificationDoc,
): BatchEligibility {
  const eligible: BatchEligibleRow[] = [];
  const excluded: BatchExcludedRow[] = [];
  for (const row of rows) {
    let reason = classifyRow(action, row);
    if (reason === null && verification?.teacherSnapshot) {
      try {
        resolveAssignedQuestions(verification.teacherSnapshot, row);
      } catch {
        reason = 'invalid_variant';
      }
    }
    if (reason === null) {
      eligible.push({
        studentUid: row.studentUid,
        studentName: row.studentName,
        submissionId: row.submissionId,
        ...(row.assignedQuestionOrders
          ? { assignedQuestionOrders: row.assignedQuestionOrders }
          : {}),
        ...(row.assignedAnswerKeys ? { assignedAnswerKeys: row.assignedAnswerKeys } : {}),
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

const SERVICE: Record<
  BatchAction,
  (
    submissionId: string,
    db: Firestore,
    context?: Parameters<typeof completeCorrection>[2],
  ) => Promise<unknown>
> = {
  complete: (submissionId, db, context) =>
    context ? completeCorrection(submissionId, db, context) : completeCorrection(submissionId, db),
  reopen: (submissionId, db, context) =>
    context ? reopenCorrection(submissionId, db, context) : reopenCorrection(submissionId, db),
  return: (submissionId, db) => returnCorrection(submissionId, db),
  clear: (submissionId, db, context) =>
    context ? clearCorrection(submissionId, db, context) : clearCorrection(submissionId, db),
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
  variantContext?: { verificationId: string; verification: VerificationDoc },
): Promise<BatchRowResult[]> {
  const service = SERVICE[action];
  return mapWithConcurrency(rows, BATCH_CONCURRENCY, async (row) => {
    try {
      if (variantContext) {
        await service(row.submissionId, db, {
          submission: {
            submissionId: row.submissionId,
            verificationId: variantContext.verificationId,
            ...(row.assignedQuestionOrders
              ? { assignedQuestionOrders: row.assignedQuestionOrders }
              : {}),
            ...(row.assignedAnswerKeys ? { assignedAnswerKeys: row.assignedAnswerKeys } : {}),
          },
          verification: variantContext.verification,
          ...(variantContext.verification.teacherSnapshot?.questions
            ? { questions: variantContext.verification.teacherSnapshot.questions }
            : {}),
        });
      } else {
        await service(row.submissionId, db);
      }
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
    case 'clear_requires_reopen':
      return 'Riapri prima la correzione';
    case 'nothing_to_clear':
      return 'Nessuna correzione da azzerare';
    case 'invalid_variant':
      return 'Variante assegnata non valida; operazione esclusa';
  }
}
