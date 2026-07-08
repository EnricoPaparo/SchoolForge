import type { StudentStatus } from '../../../types/firestore.js';

/**
 * Anything other than an exact 'approved'/'blocked' match is treated as
 * 'pending' — the safest default, mirroring normalizeVisibility(). Guards
 * against malformed data reaching a decision that grants access.
 */
export function normalizeStudentStatus(value: unknown): StudentStatus {
  if (value === 'approved' || value === 'blocked') return value;
  return 'pending';
}
