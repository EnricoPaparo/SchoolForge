import { doc, getDoc } from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';

export const UDA_APPEND_LEASE_BUSY_MESSAGE =
  'Importazione UDA in corso su questo corso. Attendi il completamento e riprova.';

/**
 * Mutual exclusion for structural UDA mutations while an "Importa UDA" append
 * is in flight (uda-import-contract §5.1, §7.3). Reads the active import doc's
 * single `udaAppendLease` and throws when a NON-expired lease is held, so
 * create/delete/reorder UDA (and create lesson) cannot race the staged append.
 *
 * This is the ONLY extra read these mutations take, and only when the teacher
 * actually mutates — never on an ordinary course open.
 */
export async function assertNoActiveUdaAppendLease(
  programId: string,
  importId: string,
  db: Firestore,
): Promise<void> {
  const snap = await getDoc(doc(db, `programs/${programId}/imports/${importId}`));
  if (!snap.exists()) return;
  const lease = (snap.data() as { udaAppendLease?: { expiresAt?: number } | null }).udaAppendLease;
  if (lease && typeof lease.expiresAt === 'number' && lease.expiresAt > Date.now()) {
    throw new Error(UDA_APPEND_LEASE_BUSY_MESSAGE);
  }
}
