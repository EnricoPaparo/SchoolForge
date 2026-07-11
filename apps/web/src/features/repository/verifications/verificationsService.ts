import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  writeBatch,
  where,
} from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import type { FirebaseStorage } from 'firebase/storage';
import type { ClassItem } from '../classes/classesService.js';
import type {
  VerificationConfig,
  VerificationDoc,
  VerificationTeacherQuestionSnapshot,
  VerificationTeacherSnapshot,
  VerificationVisibility,
} from '../../../types/firestore.js';
import { loadSelectedQuestionsWithSolutions } from './loadSelectedQuestionsWithSolutions.js';
import { normalizeOnlineEnabled } from './onlineEnabled.js';
import { normalizeStudentPdfEnabled } from './studentPdfEnabled.js';
import { assertTeacherSnapshotQuestionsWithinLimit } from './verificationSnapshotLimits.js';
import {
  toPublicVerificationQuestion,
  toTeacherQuestionSnapshot,
} from './verificationSnapshotMappers.js';
import { normalizeVisibility } from './visibility.js';

export type VerificationItem = { id: string } & Omit<
  VerificationDoc,
  'visibility' | 'onlineEnabled' | 'studentPdfEnabled'
> & {
    visibility: VerificationVisibility;
    onlineEnabled: boolean;
    studentPdfEnabled: boolean;
  };

export async function listVerifications(
  ownerUid: string,
  db: Firestore,
): Promise<VerificationItem[]> {
  const snap = await getDocs(collection(db, 'verifications'));
  return snap.docs
    .map((d) => {
      const data = d.data() as VerificationDoc;
      return {
        id: d.id,
        ...data,
        visibility: normalizeVisibility(data.visibility),
        onlineEnabled: normalizeOnlineEnabled(data.onlineEnabled),
        studentPdfEnabled: normalizeStudentPdfEnabled(data.studentPdfEnabled),
      };
    })
    .filter((item) => item.ownerUid === ownerUid);
}

/**
 * Returns only the distinct classes that currently have an active online
 * verification. Used by the teacher's manual Modalità verifica switch: the
 * switch derives its scope without a class-picker dialog, while paper-only
 * or merely active verifications never block lessons. The Firestore query is
 * bounded to matching documents; it does not scan the verification archive.
 */
export async function listActiveOnlineVerificationClassIds(
  ownerUid: string,
  db: Firestore,
): Promise<string[]> {
  const snap = await getDocs(
    query(
      collection(db, 'verifications'),
      where('ownerUid', '==', ownerUid),
      where('status', '==', 'active'),
      where('onlineEnabled', '==', true),
    ),
  );
  return [
    ...new Set(
      snap.docs
        .map((item) => (item.data() as VerificationDoc).config?.classId)
        .filter((classId): classId is string => typeof classId === 'string' && classId.length > 0),
    ),
  ];
}

export async function createVerification(
  config: Pick<VerificationConfig, 'title' | 'classId' | 'programId' | 'importId'>,
  ownerUid: string,
  db: Firestore,
): Promise<string> {
  const ref = doc(collection(db, 'verifications'));
  const auditRef = doc(collection(db, 'auditEvents'));
  const fullConfig: VerificationConfig = {
    ...config,
    questionRefs: [],
  };
  const batch = writeBatch(db);
  batch.set(ref, {
    ownerUid,
    status: 'draft',
    visibility: 'hidden',
    studentPdfEnabled: false,
    config: fullConfig,
    teacherSnapshot: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    activatedAt: null,
    closedAt: null,
  });
  batch.set(auditRef, {
    actorUid: ownerUid,
    action: 'verification.created',
    targetId: ref.id,
    outcome: 'success',
    reason: null,
    timestamp: serverTimestamp(),
  });
  await batch.commit();
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

/** `soluzione` must be a non-empty string, or a non-empty array of non-empty strings. */
function isValidSoluzione(soluzione: string | string[]): boolean {
  if (Array.isArray(soluzione)) {
    return soluzione.length > 0 && soluzione.every((s) => s.trim().length > 0);
  }
  return soluzione.trim().length > 0;
}

/**
 * Activates a draft verification. Alongside the existing owner-only
 * `teacherSnapshot`, this also builds and writes `publishedProjection/data`
 * — the safe, solution-free projection a student (M3-lite) reads to list the
 * verification and render the student PDF (M3L-D). It never includes
 * poolStorageRef, questionLocalId, questionIndexEntryId or soluzione.
 * `classId` is copied from `config.classId` as-is (including `null`) — a
 * verification never assigned to a class stays invisible to every student.
 *
 * Fix for the immutable-snapshot gap: `teacherSnapshot.questions` now
 * embeds each question's full text, options AND solution at activation
 * time (`VerificationTeacherQuestionSnapshot`) — so an `active`/`closed`
 * verification's own PDF downloads (normal + solutions, see
 * `VerificationsView.tsx`) never again need to re-read the current pool
 * file from Storage. Before this fix, `teacherSnapshot` only kept
 * `questionRefs` (stable pointers into the *current* pool), so editing or
 * deleting a pool after activation could silently change — or break — an
 * already-activated verification's PDFs. `questionRefs` is still kept
 * alongside `questions` for tracking/compatibility, but is no longer the
 * PDF data source once `questions` is present.
 *
 * All questions are read from Storage exactly ONCE, via
 * `loadSelectedQuestionsWithSolutions` (solutions included) — BEFORE
 * opening the transaction, same as before (Storage reads don't belong
 * inside a Firestore transaction, and this keeps retries cheap). Both
 * `teacherSnapshot.questions` and `publishedProjection.questions` are then
 * derived from that single load: the projection strips `soluzione` via
 * `toPublicVerificationQuestion`, so there is no second Storage read and no
 * risk of the two ever disagreeing about what a question's text/options
 * were at activation time. A missing/invalid pool, a missing question, an
 * invalid solution, or a snapshot that would serialize too large all fail
 * BEFORE the transaction opens — activation is all-or-nothing.
 *
 * `visibility` is always reset to `hidden` on activation: publishing is a
 * separate, explicit teacher action (see `setVerificationVisibility`).
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

  // Single Storage read for both the owner-only teacher snapshot (with
  // solutions) and the student-safe published projection (without) — see
  // doc comment above.
  const questionsResult = await loadSelectedQuestionsWithSolutions(
    preData.config.questionRefs,
    storage,
  );
  if (!questionsResult.ok) {
    throw new Error(`Impossibile attivare: ${questionsResult.error}`);
  }
  const invalidIndex = questionsResult.questions.findIndex((q) => !isValidSoluzione(q.soluzione));
  if (invalidIndex !== -1) {
    const badRef = questionsResult.questions[invalidIndex]!.ref;
    throw new Error(
      `Impossibile attivare: soluzione mancante o non valida per la domanda ${badRef.questionLocalId}.`,
    );
  }

  const teacherQuestions: VerificationTeacherQuestionSnapshot[] = questionsResult.questions.map(
    (q, index) => toTeacherQuestionSnapshot(q, index),
  );
  assertTeacherSnapshotQuestionsWithinLimit(teacherQuestions);

  const publicQuestions = teacherQuestions.map(toPublicVerificationQuestion);

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
      questions: teacherQuestions,
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
      classId: data.config.classId,
      visibility: 'hidden',
      // Mirrored from the parent verification, same as classId/visibility —
      // see PublishedProjectionDoc. No teacher toggle exists yet (M3F-05), so
      // this is always false today; activation just keeps the mirror honest.
      onlineEnabled: normalizeOnlineEnabled(data.onlineEnabled),
      // M3F-09: mirrored the same way — a teacher may have already toggled
      // studentPdfEnabled while this verification was still a draft (no
      // projection existed yet to mirror onto), so activation is what
      // carries that choice into the projection for the first time.
      studentPdfEnabled: normalizeStudentPdfEnabled(data.studentPdfEnabled),
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
 * `updatedAt` on the parent document; never config, teacherSnapshot, status
 * or any other field. The Security Rules enforce the same restriction
 * server-side.
 *
 * Also mirrors the new value onto `publishedProjection/data.visibility`
 * (M3L-D) — required so the student's `collectionGroup` discovery query has
 * a query-filterable field to authorize on; see `PublishedProjectionDoc`.
 *
 * Written atomically in a single `writeBatch` together with the audit
 * event (PERF-SEC-01B-1 / PERF-05) — a partial failure can no longer leave
 * the parent document and the projection mirror out of sync, matching the
 * pattern already used by `setVerificationOnlineEnabled`/
 * `setVerificationStudentPdfEnabled`.
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
  const batch = writeBatch(db);
  batch.set(
    doc(db, 'verifications', verificationId),
    { visibility, updatedAt: serverTimestamp() },
    { merge: true },
  );
  batch.set(
    doc(db, 'verifications', verificationId, 'publishedProjection', 'data'),
    { visibility },
    { merge: true },
  );
  batch.set(doc(collection(db, 'auditEvents')), {
    actorUid: ownerUid,
    action: 'verification.visibilityChanged',
    targetId: verificationId,
    outcome: 'success',
    reason: `visibility -> ${visibility}`,
    timestamp: serverTimestamp(),
  });
  await batch.commit();
}

/**
 * Toggles `onlineEnabled` on an `active` verification — the master switch
 * that lets students actually start/save/submit the online exam (Security
 * Rules gate every submission write on `verificationOnlineAndActive()`,
 * which reads this exact field). Touches only `onlineEnabled` and
 * `updatedAt` on the parent document; never config, teacherSnapshot, status,
 * or `visibility` — the two toggles are independent, mirroring
 * `setVerificationVisibility`.
 *
 * Like `setVerificationVisibility`, this uses a single `writeBatch` so the
 * parent update and the `publishedProjection/data.onlineEnabled` mirror
 * commit atomically — a partial failure can never leave the two out of
 * sync.
 *
 * A verification with no class assigned (`config.classId == null`) can
 * never have online enabled: `verificationClassMatches()` in Security Rules
 * would deny every submission anyway, so enabling here would be a dead,
 * confusing toggle.
 */
export async function setVerificationOnlineEnabled(
  verificationId: string,
  onlineEnabled: boolean,
  ownerUid: string,
  db: Firestore,
): Promise<void> {
  const snap = await getDoc(doc(db, 'verifications', verificationId));
  const data = snap.data() as VerificationDoc | undefined;
  if (!data || data.status !== 'active') {
    throw new Error('Online modificabile solo su una verifica attiva');
  }
  if (onlineEnabled && data.config.classId == null) {
    throw new Error("Assegnare una classe prima di attivare l'online");
  }
  const batch = writeBatch(db);
  batch.set(
    doc(db, 'verifications', verificationId),
    { onlineEnabled, updatedAt: serverTimestamp() },
    { merge: true },
  );
  batch.set(
    doc(db, 'verifications', verificationId, 'publishedProjection', 'data'),
    { onlineEnabled },
    { merge: true },
  );
  batch.set(doc(collection(db, 'auditEvents')), {
    actorUid: ownerUid,
    action: 'verification.onlineEnabledChanged',
    targetId: verificationId,
    outcome: 'success',
    reason: `onlineEnabled -> ${onlineEnabled}`,
    timestamp: serverTimestamp(),
  });
  await batch.commit();
}

/**
 * Toggles `studentPdfEnabled` — the sole gate on whether a student may
 * download the verification PDF (M3F-09). Unlike `visibility`/
 * `onlineEnabled`, this is allowed on `draft`, `active`, AND `closed`: a
 * teacher may want to prepare the flag before activation, or open/close
 * paper access on an already-closed exam without reopening anything else.
 * Toggling it never changes `status`, `visibility`, or `onlineEnabled` — a
 * `draft`/`closed`/hidden verification never becomes visible to a student
 * just because this flag is `true` (see `PublishedProjectionDoc` and
 * `loadStudentVerifications`, which still gate on `visibility == 'public'`
 * and class match first).
 *
 * Touches only `studentPdfEnabled`/`updatedAt` on the parent document —
 * the Security Rules enforce the same restriction for `active`/`closed`
 * server-side (a `draft` verification allows any owner update already).
 * Written atomically in a single `writeBatch` together with the
 * `publishedProjection/data` mirror (when one exists — a `draft`
 * verification has none yet, see `activateVerification`) and the audit
 * event, so a partial failure can never leave the parent document and the
 * projection out of sync.
 */
export async function setVerificationStudentPdfEnabled(
  verificationId: string,
  studentPdfEnabled: boolean,
  ownerUid: string,
  db: Firestore,
): Promise<void> {
  const verRef = doc(db, 'verifications', verificationId);
  const snap = await getDoc(verRef);
  const data = snap.data() as VerificationDoc | undefined;
  if (!data) {
    throw new Error('Verifica non trovata');
  }

  const projectionRef = doc(db, 'verifications', verificationId, 'publishedProjection', 'data');
  const projectionSnap = await getDoc(projectionRef);

  const batch = writeBatch(db);
  batch.set(verRef, { studentPdfEnabled, updatedAt: serverTimestamp() }, { merge: true });
  if (projectionSnap.exists()) {
    batch.set(projectionRef, { studentPdfEnabled }, { merge: true });
  }
  batch.set(doc(collection(db, 'auditEvents')), {
    actorUid: ownerUid,
    action: 'verification.studentPdfEnabledChanged',
    targetId: verificationId,
    outcome: 'success',
    reason: `studentPdfEnabled -> ${studentPdfEnabled}`,
    timestamp: serverTimestamp(),
  });
  await batch.commit();
}

/**
 * Closes an active verification. Also forces
 * `publishedProjection/data.visibility` back to `'hidden'` (M3L-D) — a
 * closed verification must never remain readable by a student via a stale
 * `'public'` mirror, since the Security Rules list-query gate checks only
 * this mirrored field, not the parent's `status`.
 *
 * Written atomically in a single `writeBatch` together with the audit
 * event (PERF-SEC-01B-1 / PERF-05) — a partial failure can no longer leave
 * the parent document and the projection mirror out of sync, matching the
 * pattern already used by `setVerificationOnlineEnabled`/
 * `setVerificationStudentPdfEnabled`.
 */
export async function closeVerification(
  verificationId: string,
  ownerUid: string,
  db: Firestore,
): Promise<void> {
  const snap = await getDoc(doc(db, 'verifications', verificationId));
  const data = snap.data() as VerificationDoc | undefined;
  if (!data) {
    throw new Error('Verifica non trovata');
  }
  if (data.status !== 'active') {
    throw new Error('Verifica non chiudibile: non è attiva');
  }
  const batch = writeBatch(db);
  batch.set(
    doc(db, 'verifications', verificationId),
    { status: 'closed', closedAt: serverTimestamp(), updatedAt: serverTimestamp() },
    { merge: true },
  );
  batch.set(
    doc(db, 'verifications', verificationId, 'publishedProjection', 'data'),
    { visibility: 'hidden' },
    { merge: true },
  );
  batch.set(doc(collection(db, 'auditEvents')), {
    actorUid: ownerUid,
    action: 'verification.closed',
    targetId: verificationId,
    outcome: 'success',
    reason: null,
    timestamp: serverTimestamp(),
  });
  await batch.commit();
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
