import type {
  PublicVerificationQuestion,
  VerificationTeacherQuestionSnapshot,
} from '../../../types/firestore.js';
import type { LoadedQuestionWithSolution } from './loadSelectedQuestionsWithSolutions.js';

/**
 * Small pure mappers between `VerificationTeacherQuestionSnapshot` (the
 * frozen, embedded per-question data written at activation) and the shapes
 * the rest of the codebase already knows how to render — so neither
 * `activateVerification` nor `VerificationsView`'s PDF handlers need to
 * duplicate this mapping logic inline.
 */

/**
 * `LoadedQuestionWithSolution` (from `loadSelectedQuestionsWithSolutions`,
 * read once at activation time) → the frozen snapshot shape. `order` is the
 * position in the verification's definitive question order.
 */
export function toTeacherQuestionSnapshot(
  q: LoadedQuestionWithSolution,
  order: number,
): VerificationTeacherQuestionSnapshot {
  return {
    order,
    tipo: q.tipo,
    maxPoints: q.ref.maxPoints,
    testo: q.testo,
    ...(q.opzioni ? { opzioni: q.opzioni } : {}),
    soluzione: q.soluzione,
  };
}

/**
 * Frozen snapshot question → the student-safe published projection shape.
 * Never includes `soluzione`, `poolStorageRef`, `questionLocalId` or
 * `questionIndexEntryId` — this is the one place that must never leak them.
 */
export function toPublicVerificationQuestion(
  q: VerificationTeacherQuestionSnapshot,
): PublicVerificationQuestion {
  return {
    order: q.order,
    tipo: q.tipo,
    maxPoints: q.maxPoints,
    testo: q.testo,
    ...(q.opzioni ? { opzioni: q.opzioni } : {}),
  };
}

/**
 * Frozen snapshot question → the minimal shape `downloadStudentPdf` needs
 * (see `verificationPdf.ts` — it only ever reads `ref.maxPoints`, `testo`,
 * `tipo`, `opzioni`, never any other field of a full `VerificationQuestionRef`).
 */
export function toPdfQuestion(q: VerificationTeacherQuestionSnapshot): {
  ref: { maxPoints: number };
  testo: string;
  tipo: 'aperta' | 'chiusa_singola' | 'chiusa_multipla';
  opzioni?: { id: string; testo: string }[];
} {
  return {
    ref: { maxPoints: q.maxPoints },
    testo: q.testo,
    tipo: q.tipo,
    ...(q.opzioni ? { opzioni: q.opzioni } : {}),
  };
}

/**
 * Frozen snapshot question → the minimal shape `downloadTeacherSolutionsPdf`
 * needs — same as `toPdfQuestion` plus `soluzione`.
 */
export function toPdfQuestionWithSolution(q: VerificationTeacherQuestionSnapshot): {
  ref: { maxPoints: number };
  testo: string;
  tipo: 'aperta' | 'chiusa_singola' | 'chiusa_multipla';
  opzioni?: { id: string; testo: string }[];
  soluzione: string | string[];
} {
  return {
    ...toPdfQuestion(q),
    soluzione: q.soluzione,
  };
}
