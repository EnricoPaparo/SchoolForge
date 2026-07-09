import type { VerificationDoc, VerificationStatus } from '../../../types/firestore.js';

export type RepositoryDeleteTarget =
  | {
      kind: 'uda';
      programId: string;
      importId: string;
      udaDir: string;
    }
  | {
      kind: 'lesson';
      programId: string;
      importId: string;
      udaDir: string;
      lessonFilename: string;
    };

export interface RepositoryDeleteBlocker {
  verificationId: string;
  title: string;
  status: VerificationStatus;
}

export type VerificationForRepositoryGuard = Pick<VerificationDoc, 'status' | 'config'> & {
  id: string;
};

function blocksUda(verification: VerificationForRepositoryGuard, target: RepositoryDeleteTarget) {
  return (
    target.kind === 'uda' &&
    verification.config.questionRefs.some((ref) => ref.udaDir === target.udaDir)
  );
}

function blocksLesson(
  verification: VerificationForRepositoryGuard,
  target: RepositoryDeleteTarget,
) {
  return (
    target.kind === 'lesson' &&
    verification.config.questionRefs.some(
      (ref) => ref.udaDir === target.udaDir && ref.lessonFilename === target.lessonFilename,
    )
  );
}

/**
 * Pure RE-00 guard: tells the future Repository Editor whether deleting a
 * UDA/lesson would break existing verifications.
 *
 * Applies to draft/active/closed verifications alike. SchoolForge does not
 * silently rewrite or delete verifications when didactic material is removed:
 * the teacher must handle linked verifications first.
 */
export function findRepositoryDeleteBlockers(
  target: RepositoryDeleteTarget,
  verifications: VerificationForRepositoryGuard[],
): RepositoryDeleteBlocker[] {
  return verifications
    .filter(
      (verification) =>
        verification.config.programId === target.programId &&
        verification.config.importId === target.importId &&
        (blocksUda(verification, target) || blocksLesson(verification, target)),
    )
    .map((verification) => ({
      verificationId: verification.id,
      title: verification.config.title,
      status: verification.status,
    }));
}

export function canDeleteRepositoryTarget(
  target: RepositoryDeleteTarget,
  verifications: VerificationForRepositoryGuard[],
): boolean {
  return findRepositoryDeleteBlockers(target, verifications).length === 0;
}
