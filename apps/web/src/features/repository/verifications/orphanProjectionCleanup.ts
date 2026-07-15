import {
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  where,
} from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import { deleteDocRefsInBatches } from '../firestoreChunks.js';

const CLEANUP_VERSION = 1 as const;

/**
 * One-time repair for projections left behind by the pre-fix delete flow.
 *
 * The caller already owns the current verification list, so no parent reads
 * are added here. A private Firestore marker prevents the collection-group
 * scan from becoming a recurring cost. A failed run never writes the marker
 * and is therefore safe to retry on the next visit.
 */
export async function cleanupOrphanVerificationProjections(
  ownerUid: string,
  existingVerificationIds: ReadonlySet<string>,
  db: Firestore,
): Promise<number> {
  const markerRef = doc(db, 'settings', 'verificationProjectionMigration');
  const marker = await getDoc(markerRef);
  if (marker.data()?.cleanupVersion === CLEANUP_VERSION) return 0;

  const projections = await getDocs(
    query(collectionGroup(db, 'publishedProjection'), where('ownerUid', '==', ownerUid)),
  );
  const orphanRefs = projections.docs
    .filter((item) => {
      const verificationId = item.ref.parent.parent?.id;
      return !verificationId || !existingVerificationIds.has(verificationId);
    })
    .map((item) => item.ref);

  await deleteDocRefsInBatches(db, orphanRefs);
  await setDoc(markerRef, {
    cleanupVersion: CLEANUP_VERSION,
    completedAt: serverTimestamp(),
  });
  return orphanRefs.length;
}
