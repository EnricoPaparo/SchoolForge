import { doc, getDoc, type Firestore } from 'firebase/firestore';
import type { CorrectionReturnDoc, VerificationDoc } from '../../../types/firestore.js';
import { resolveAssignedQuestions } from '../verifications/assignedVariant.js';
import { mapWithConcurrency } from '../verifications/mapWithConcurrency.js';
import { setReturnVisibleToStudent, setSolutionsVisible } from './correctionsService.js';
import type { BatchSelectedRow } from './batchCorrectionActions.js';

export type BatchReturnVisibilityAction =
  | 'show_return'
  | 'hide_return'
  | 'show_solutions'
  | 'hide_solutions';

export type BatchReturnVisibilityExclusionReason =
  | 'no_correction'
  | 'not_returned'
  | 'missing_return'
  | 'inconsistent_return'
  | 'invalid_variant';

export interface BatchReturnVisibilityEligibleRow {
  studentUid: string;
  studentName: string;
  submissionId: string;
  assignedQuestionOrders?: number[];
  assignedAnswerKeys?: string[];
}

export interface BatchReturnVisibilityExcludedRow {
  studentUid: string;
  studentName: string;
  reason: BatchReturnVisibilityExclusionReason;
}

export interface BatchReturnVisibilityEligibility {
  eligible: BatchReturnVisibilityEligibleRow[];
  excluded: BatchReturnVisibilityExcludedRow[];
}

export interface BatchReturnVisibilityResult {
  studentUid: string;
  submissionId: string;
  outcome: 'succeeded' | 'noop' | 'failed';
  error?: string;
}

export const BATCH_RETURN_VISIBILITY_CONCURRENCY = 3;

function localExclusion(row: BatchSelectedRow): BatchReturnVisibilityExclusionReason | null {
  if (!row.progress) return 'no_correction';
  return row.progress.status === 'returned' ? null : 'not_returned';
}

function copyEligible(row: BatchSelectedRow): BatchReturnVisibilityEligibleRow {
  return {
    studentUid: row.studentUid,
    studentName: row.studentName,
    submissionId: row.submissionId,
    ...(row.assignedQuestionOrders ? { assignedQuestionOrders: row.assignedQuestionOrders } : {}),
    ...(row.assignedAnswerKeys ? { assignedAnswerKeys: row.assignedAnswerKeys } : {}),
  };
}

/**
 * Preflight on demand: local canonical correction status first, then one
 * point-read for each returned candidate. It is invoked only after the teacher
 * chooses a visibility action, never while the monitor is idle.
 */
export async function loadBatchReturnVisibilityEligibility(params: {
  rows: BatchSelectedRow[];
  ownerUid: string;
  verificationId: string;
  verification: VerificationDoc;
  db: Firestore;
}): Promise<BatchReturnVisibilityEligibility> {
  const { rows, ownerUid, verificationId, verification, db } = params;
  const excluded: BatchReturnVisibilityExcludedRow[] = [];
  const candidates: BatchSelectedRow[] = [];

  for (const row of rows) {
    let reason = localExclusion(row);
    if (reason === null && verification.teacherSnapshot) {
      try {
        resolveAssignedQuestions(verification.teacherSnapshot, row);
      } catch {
        reason = 'invalid_variant';
      }
    }
    if (reason) excluded.push({ studentUid: row.studentUid, studentName: row.studentName, reason });
    else candidates.push(row);
  }

  const checked = await mapWithConcurrency(
    candidates,
    BATCH_RETURN_VISIBILITY_CONCURRENCY,
    async (row) => {
      const snap = await getDoc(doc(db, 'correctionReturns', row.submissionId));
      if (!snap.exists()) return { row, reason: 'missing_return' as const };
      const data = snap.data() as CorrectionReturnDoc;
      if (
        data.correctionId !== row.submissionId ||
        data.studentUid !== row.studentUid ||
        data.ownerUid !== ownerUid ||
        data.verificationId !== verificationId
      ) {
        return { row, reason: 'inconsistent_return' as const };
      }
      return { row, reason: null };
    },
  );

  const eligible: BatchReturnVisibilityEligibleRow[] = [];
  for (const item of checked) {
    if (item.reason) {
      excluded.push({
        studentUid: item.row.studentUid,
        studentName: item.row.studentName,
        reason: item.reason,
      });
    } else {
      eligible.push(copyEligible(item.row));
    }
  }
  return { eligible, excluded };
}

function actionValue(action: BatchReturnVisibilityAction): boolean {
  return action === 'show_return' || action === 'show_solutions';
}

function safeServiceError(error: unknown): string {
  if (error instanceof Error && /^Impossibile\s/u.test(error.message)) return error.message;
  return 'Operazione non riuscita per questa consegna. Riprova.';
}

/** Invokes only the two canonical return services, with at most three in flight. */
export async function runBatchReturnVisibilityAction(params: {
  action: BatchReturnVisibilityAction;
  rows: BatchReturnVisibilityEligibleRow[];
  db: Firestore;
  verificationId: string;
  verification: VerificationDoc;
}): Promise<BatchReturnVisibilityResult[]> {
  const { action, rows, db, verificationId, verification } = params;
  const value = actionValue(action);
  return mapWithConcurrency(rows, BATCH_RETURN_VISIBILITY_CONCURRENCY, async (row) => {
    try {
      const mutation =
        action === 'show_return' || action === 'hide_return'
          ? await setReturnVisibleToStudent(row.submissionId, value, db)
          : await setSolutionsVisible(row.submissionId, value, db, {
              submission: {
                submissionId: row.submissionId,
                verificationId,
                ...(row.assignedQuestionOrders
                  ? { assignedQuestionOrders: row.assignedQuestionOrders }
                  : {}),
                ...(row.assignedAnswerKeys ? { assignedAnswerKeys: row.assignedAnswerKeys } : {}),
              },
              verification,
              ...(verification.teacherSnapshot?.questions
                ? { questions: verification.teacherSnapshot.questions }
                : {}),
            });
      return {
        studentUid: row.studentUid,
        submissionId: row.submissionId,
        outcome: mutation === 'noop' ? ('noop' as const) : ('succeeded' as const),
      };
    } catch (error) {
      return {
        studentUid: row.studentUid,
        submissionId: row.submissionId,
        outcome: 'failed' as const,
        error: safeServiceError(error),
      };
    }
  });
}

export function describeBatchReturnVisibilityExclusion(
  reason: BatchReturnVisibilityExclusionReason,
): string {
  switch (reason) {
    case 'no_correction':
      return 'Nessuna correzione presente';
    case 'not_returned':
      return 'La correzione non è attualmente restituita';
    case 'missing_return':
      return 'Restituzione non disponibile';
    case 'inconsistent_return':
      return 'Dati della restituzione non coerenti';
    case 'invalid_variant':
      return 'Variante assegnata non valida';
  }
}
