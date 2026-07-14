import type { QuestionEvaluation, SubmissionCorrectionStatus } from '../../../types/firestore.js';

export function normalizeSubmissionCorrectionStatus(value: unknown): SubmissionCorrectionStatus {
  return value === 'in_progress' || value === 'completed' || value === 'returned'
    ? value
    : 'submitted';
}

export function correctionStatusLabel(status: SubmissionCorrectionStatus): string {
  switch (status) {
    case 'in_progress':
      return 'In correzione';
    case 'completed':
      return 'Corretta';
    case 'returned':
      return 'Restituita';
    default:
      return 'Consegnata';
  }
}

export function correctionProgressFromEvaluations(
  evaluations: Record<string, QuestionEvaluation>,
): Extract<SubmissionCorrectionStatus, 'submitted' | 'in_progress'> {
  return Object.values(evaluations).some((evaluation) => evaluation.points !== null)
    ? 'in_progress'
    : 'submitted';
}
