import type { StudentAccessSettings, StudentDoc } from '../../../types/firestore.js';

/**
 * Mirrors the Security Rules gate (`isApprovedStudent()` in firestore.rules
 * and storage.rules): a student can read portal content only when the
 * portal is globally enabled AND their own document is approved. Being
 * Google-authenticated is never sufficient on its own — a missing,
 * `pending`, or `blocked` student document always denies, as does a
 * missing or disabled `settings/studentAccess`.
 */
export function canReadStudentContent(
  access: Pick<StudentAccessSettings, 'studentPortalEnabled'> | null | undefined,
  student: Pick<StudentDoc, 'status'> | null | undefined,
): boolean {
  return access?.studentPortalEnabled === true && student?.status === 'approved';
}
