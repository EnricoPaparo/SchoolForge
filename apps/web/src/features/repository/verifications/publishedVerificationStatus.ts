import type { PublishedVerificationStatus } from '../../../types/firestore.js';

/** Legacy projections predate this field and were necessarily active when published. */
export function normalizePublishedVerificationStatus(value: unknown): PublishedVerificationStatus {
  return value === 'closed' ? 'closed' : 'active';
}
