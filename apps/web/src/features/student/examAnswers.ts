import type { AnswerValue } from '../../types/firestore.js';

/**
 * Whether a question counts as "compilata" for the progress indicator and
 * the pre-delivery confirmation count (D-M3F-08): aperta needs non-blank
 * text after trim, chiusa_singola needs a selection, chiusa_multipla needs
 * at least one selection. A missing/undefined answer is always "vuota".
 */
export function isAnswerFilled(answer: AnswerValue | undefined): boolean {
  if (!answer) return false;
  if (answer.tipo === 'aperta') return answer.testo.trim() !== '';
  if (answer.tipo === 'chiusa_singola') return answer.selectedId != null;
  return answer.selectedIds.length > 0;
}

export function countFilled(orders: number[], answers: Record<string, AnswerValue>): number {
  return orders.reduce(
    (count, order) => count + (isAnswerFilled(answers[String(order)]) ? 1 : 0),
    0,
  );
}
