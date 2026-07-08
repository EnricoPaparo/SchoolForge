import type { VerificationVisibility } from '../../../types/firestore.js';

/**
 * Verifications created before M3-lite have no `visibility` field in
 * Firestore. Treat anything other than the literal `'public'` as `'hidden'`
 * — the safe default — instead of crashing or leaking an undefined value
 * into UI/rules-adjacent code.
 */
export function normalizeVisibility(value: unknown): VerificationVisibility {
  return value === 'public' ? 'public' : 'hidden';
}
