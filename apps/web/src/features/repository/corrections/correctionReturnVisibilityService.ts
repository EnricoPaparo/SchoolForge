import { collection, getDocs, query, where, type Firestore } from 'firebase/firestore';

export interface CorrectionReturnVisibility {
  submissionId: string;
  studentUid: string;
  visibleToStudent: boolean;
  solutionsVisible: boolean;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Loads return visibility with one owner-only query scoped to a verification.
 * Malformed or mismatched documents are ignored fail-closed so the table never
 * presents an unverified projection as visible. No listener or polling is used.
 */
export async function loadCorrectionReturnVisibilityBySubmission(
  verificationId: string,
  ownerUid: string,
  db: Firestore,
): Promise<Map<string, CorrectionReturnVisibility>> {
  const snap = await getDocs(
    query(collection(db, 'correctionReturns'), where('verificationId', '==', verificationId)),
  );
  const bySubmission = new Map<string, CorrectionReturnVisibility>();
  for (const document of snap.docs) {
    const data = document.data() as Record<string, unknown>;
    if (
      !nonEmptyString(document.id) ||
      data.correctionId !== document.id ||
      data.ownerUid !== ownerUid ||
      data.verificationId !== verificationId ||
      !nonEmptyString(data.studentUid) ||
      document.id !== `${verificationId}_${data.studentUid}` ||
      typeof data.visibleToStudent !== 'boolean' ||
      typeof data.solutionsVisible !== 'boolean'
    ) {
      continue;
    }
    bySubmission.set(document.id, {
      submissionId: document.id,
      studentUid: data.studentUid,
      visibleToStudent: data.visibleToStudent,
      solutionsVisible: data.solutionsVisible,
    });
  }
  return bySubmission;
}
