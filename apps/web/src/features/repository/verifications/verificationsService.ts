import {
  collection,
  doc,
  getDoc,
  getDocs,
  runTransaction,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import type { ClassItem } from '../classes/classesService.js';
import type {
  VerificationConfig,
  VerificationDoc,
  VerificationTeacherSnapshot,
} from '../../../types/firestore.js';

export type VerificationItem = { id: string } & VerificationDoc;

export async function listVerifications(
  ownerUid: string,
  db: Firestore,
): Promise<VerificationItem[]> {
  const snap = await getDocs(collection(db, 'verifications'));
  return snap.docs
    .map((d) => ({ id: d.id, ...(d.data() as VerificationDoc) }))
    .filter((item) => item.ownerUid === ownerUid);
}

export async function createVerification(
  config: Pick<VerificationConfig, 'title' | 'classId' | 'programId' | 'importId'>,
  ownerUid: string,
  db: Firestore,
): Promise<string> {
  const ref = doc(collection(db, 'verifications'));
  const fullConfig: VerificationConfig = {
    ...config,
    questionRefs: [],
  };
  await setDoc(ref, {
    ownerUid,
    status: 'draft',
    config: fullConfig,
    teacherSnapshot: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    activatedAt: null,
    closedAt: null,
  });
  await setDoc(doc(collection(db, 'auditEvents')), {
    actorUid: ownerUid,
    action: 'verification.created',
    targetId: ref.id,
    outcome: 'success',
    reason: null,
    timestamp: serverTimestamp(),
  });
  return ref.id;
}

export async function updateVerificationConfig(
  verificationId: string,
  config: Partial<VerificationConfig>,
  ownerUid: string,
  db: Firestore,
): Promise<void> {
  const snap = await getDoc(doc(db, 'verifications', verificationId));
  const data = snap.data() as VerificationDoc;
  if (data.status !== 'draft') {
    throw new Error('Verifica non modificabile: non è in bozza');
  }
  await setDoc(
    doc(db, 'verifications', verificationId),
    { config: { ...data.config, ...config }, updatedAt: serverTimestamp() },
    { merge: true },
  );
  await setDoc(doc(collection(db, 'auditEvents')), {
    actorUid: ownerUid,
    action: 'verification.updated',
    targetId: verificationId,
    outcome: 'success',
    reason: null,
    timestamp: serverTimestamp(),
  });
}

export function validateForActivation(config: VerificationConfig): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  if (!config.title || config.title.trim() === '') {
    errors.push('Il titolo è obbligatorio');
  }
  if (!config.programId) {
    errors.push('Il programma è obbligatorio');
  }
  if (!config.importId) {
    errors.push("L'importazione è obbligatoria");
  }
  if (!config.questionRefs || config.questionRefs.length < 1) {
    errors.push('Selezionare almeno una domanda');
  }
  return { valid: errors.length === 0, errors };
}

export async function activateVerification(
  verificationId: string,
  classItem: ClassItem | null,
  ownerUid: string,
  db: Firestore,
): Promise<void> {
  const verRef = doc(db, 'verifications', verificationId);
  await runTransaction(db, async (transaction) => {
    const snap = await transaction.get(verRef);
    if (!snap.exists()) {
      throw new Error('Verifica non trovata');
    }
    const data = snap.data() as VerificationDoc;
    if (data.status !== 'draft') {
      throw new Error('Verifica non attivabile: non è in bozza');
    }
    const validation = validateForActivation(data.config);
    if (!validation.valid) {
      throw new Error(`Verifica non valida: ${validation.errors.join(', ')}`);
    }
    const teacherSnapshot: Omit<VerificationTeacherSnapshot, 'activatedAt'> & {
      activatedAt: ReturnType<typeof serverTimestamp>;
    } = {
      title: data.config.title,
      classId: data.config.classId,
      className: classItem?.name ?? null,
      programId: data.config.programId,
      importId: data.config.importId,
      questionRefs: data.config.questionRefs,
      activatedAt: serverTimestamp(),
    };
    transaction.update(verRef, {
      status: 'active',
      teacherSnapshot,
      activatedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  });
  await setDoc(doc(collection(db, 'auditEvents')), {
    actorUid: ownerUid,
    action: 'verification.activated',
    targetId: verificationId,
    outcome: 'success',
    reason: null,
    timestamp: serverTimestamp(),
  });
}

export async function closeVerification(
  verificationId: string,
  ownerUid: string,
  db: Firestore,
): Promise<void> {
  const snap = await getDoc(doc(db, 'verifications', verificationId));
  const data = snap.data() as VerificationDoc;
  if (data.status !== 'active') {
    throw new Error('Verifica non chiudibile: non è attiva');
  }
  await setDoc(
    doc(db, 'verifications', verificationId),
    { status: 'closed', closedAt: serverTimestamp(), updatedAt: serverTimestamp() },
    { merge: true },
  );
  await setDoc(doc(collection(db, 'auditEvents')), {
    actorUid: ownerUid,
    action: 'verification.closed',
    targetId: verificationId,
    outcome: 'success',
    reason: null,
    timestamp: serverTimestamp(),
  });
}
