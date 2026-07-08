import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  runTransaction,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import type { FirebaseStorage } from 'firebase/storage';
import type { ClassItem } from '../classes/classesService.js';
import type {
  PublicVerificationQuestion,
  VerificationConfig,
  VerificationDoc,
  VerificationTeacherSnapshot,
  VerificationVisibility,
} from '../../../types/firestore.js';
import { loadSelectedQuestions } from './loadSelectedQuestions.js';
import { normalizeVisibility } from './visibility.js';

export type VerificationItem = { id: string } & Omit<VerificationDoc, 'visibility'> & {
    visibility: VerificationVisibility;
  };

export async function listVerifications(
  ownerUid: string,
  db: Firestore,
): Promise<VerificationItem[]> {
  const snap = await getDocs(collection(db, 'verifications'));
  return snap.docs
    .map((d) => {
      const data = d.data() as VerificationDoc;
      return { id: d.id, ...data, visibility: normalizeVisibility(data.visibility) };
    })
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
    visibility: 'hidden',
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

/**
 * Activates a draft verification. Alongside the existing owner-only
 * `teacherSnapshot`, this also builds and writes `publishedProjection/data`
 * — the safe, solution-free projection a student (M3-lite) will eventually
 * read to render the student PDF. It never includes poolStorageRef,
 * questionLocalId, questionIndexEntryId or soluzione.
 *
 * The question text/options are fetched from Storage (loadSelectedQuestions)
 * BEFORE opening the transaction — Storage reads don't belong inside a
 * Firestore transaction, and this keeps retries cheap. `visibility` is
 * always reset to `hidden` on activation: publishing is a separate,
 * explicit teacher action (see setVerificationVisibility).
 */
export async function activateVerification(
  verificationId: string,
  classItem: ClassItem | null,
  ownerUid: string,
  db: Firestore,
  storage: FirebaseStorage,
): Promise<void> {
  const verRef = doc(db, 'verifications', verificationId);

  const preSnap = await getDoc(verRef);
  if (!preSnap.exists()) {
    throw new Error('Verifica non trovata');
  }
  const preData = preSnap.data() as VerificationDoc;
  if (preData.status !== 'draft') {
    throw new Error('Verifica non attivabile: non è in bozza');
  }
  const preValidation = validateForActivation(preData.config);
  if (!preValidation.valid) {
    throw new Error(`Verifica non valida: ${preValidation.errors.join(', ')}`);
  }

  const questionsResult = await loadSelectedQuestions(preData.config.questionRefs, storage);
  if (!questionsResult.ok) {
    throw new Error(`Impossibile generare la proiezione pubblica: ${questionsResult.error}`);
  }
  const publicQuestions: PublicVerificationQuestion[] = questionsResult.questions.map(
    (q, index) => ({
      order: index,
      tipo: q.tipo,
      maxPoints: q.ref.maxPoints,
      testo: q.testo,
      ...(q.opzioni ? { opzioni: q.opzioni } : {}),
    }),
  );

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
    const className = classItem?.name ?? null;
    const teacherSnapshot: Omit<VerificationTeacherSnapshot, 'activatedAt'> & {
      activatedAt: ReturnType<typeof serverTimestamp>;
    } = {
      title: data.config.title,
      classId: data.config.classId,
      className,
      programId: data.config.programId,
      importId: data.config.importId,
      questionRefs: data.config.questionRefs,
      activatedAt: serverTimestamp(),
    };
    transaction.update(verRef, {
      status: 'active',
      visibility: 'hidden',
      teacherSnapshot,
      activatedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    const projectionRef = doc(db, 'verifications', verificationId, 'publishedProjection', 'data');
    transaction.set(projectionRef, {
      ownerUid,
      title: data.config.title,
      className,
      questions: publicQuestions,
      activatedAt: serverTimestamp(),
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

/**
 * Toggles `visibility` on an `active` verification — publishing or hiding
 * it from the student portal (M3-lite). Touches only `visibility` and
 * `updatedAt`; never config, teacherSnapshot, status or any other field.
 * The Security Rules enforce the same restriction server-side.
 */
export async function setVerificationVisibility(
  verificationId: string,
  visibility: VerificationVisibility,
  ownerUid: string,
  db: Firestore,
): Promise<void> {
  const snap = await getDoc(doc(db, 'verifications', verificationId));
  const data = snap.data() as VerificationDoc | undefined;
  if (!data || data.status !== 'active') {
    throw new Error('Visibilità modificabile solo su una verifica attiva');
  }
  await setDoc(
    doc(db, 'verifications', verificationId),
    { visibility, updatedAt: serverTimestamp() },
    { merge: true },
  );
  await setDoc(doc(collection(db, 'auditEvents')), {
    actorUid: ownerUid,
    action: 'verification.visibilityChanged',
    targetId: verificationId,
    outcome: 'success',
    reason: `visibility -> ${visibility}`,
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

/**
 * Deletes a verification. Allowed for `draft` (discard an unfinished
 * configuration) and `closed` (tidy up an old exam) — never for `active`,
 * which is an immutable snapshot that can only be closed. The security
 * rules enforce the same constraint server-side as defense in depth.
 */
export async function deleteVerification(
  verificationId: string,
  ownerUid: string,
  db: Firestore,
): Promise<void> {
  const snap = await getDoc(doc(db, 'verifications', verificationId));
  const data = snap.data() as VerificationDoc | undefined;
  if (!data || (data.status !== 'draft' && data.status !== 'closed')) {
    throw new Error('Verifica non eliminabile: deve essere in bozza o chiusa');
  }
  await deleteDoc(doc(db, 'verifications', verificationId));
  await setDoc(doc(collection(db, 'auditEvents')), {
    actorUid: ownerUid,
    action: 'verification.deleted',
    targetId: verificationId,
    outcome: 'success',
    reason: null,
    timestamp: serverTimestamp(),
  });
}
