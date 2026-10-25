import { lessonProjectionRef } from './lessonProjection.js';
import {
  collection,
  doc,
  getDoc,
  getDocFromServer,
  runTransaction,
  serverTimestamp,
} from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import type { LessonDoc, PublicLessonDoc } from '../../../types/firestore.js';
import {
  checkLessonBeforeProjection,
  checkProjectionMatchesLesson,
  identityFailureMessage,
} from './lessonProjectionIdentity.js';
import {
  currentStudyPractice,
  validateStudyPractice,
  type StudyPractice,
} from './studyPractice.js';
export async function loadPublicStudyPractice(
  publicLessonId: string,
  body: string,
  db: Firestore,
): Promise<StudyPractice | null> {
  try {
    const snapshot = await getDoc(doc(db, 'publicLessonPractice', publicLessonId));
    return snapshot.exists() ? currentStudyPractice(snapshot.data().practice, body) : null;
  } catch (error) {
    if ((error as { code?: string }).code?.includes('permission-denied')) return null;
    throw error;
  }
}
export async function saveStudyPractice(params: {
  programId: string;
  importId: string;
  lessonId: string;
  ownerUid: string;
  sourceBody: string;
  practice: StudyPractice;
  publish: boolean;
  db: Firestore;
}): Promise<void> {
  const practice = validateStudyPractice(params.practice, params.sourceBody);
  await runTransaction(params.db, async (tx) => {
    const lessonRef = doc(
      params.db,
      'programs',
      params.programId,
      'imports',
      params.importId,
      'lessons',
      params.lessonId,
    );
    const lessonSnap = await tx.get(lessonRef);
    const lesson = lessonSnap.exists() ? (lessonSnap.data() as LessonDoc) : null;
    const gate = checkLessonBeforeProjection({
      lesson,
      lessonId: params.lessonId,
      ownerUid: params.ownerUid,
      importId: params.importId,
    });
    if (!gate.ok) throw new Error(identityFailureMessage(gate.failure));
    const projectionRef = lessonProjectionRef(params.db, lesson, gate.publicLessonId);
    const projectionSnap = await tx.get(projectionRef);
    const publicLesson = projectionSnap.exists()
      ? (projectionSnap.data() as PublicLessonDoc)
      : null;
    const identity = checkProjectionMatchesLesson({
      lesson: lesson!,
      publicLesson,
      programId: params.programId,
      importId: params.importId,
      ownerUid: params.ownerUid,
    });
    if (!identity.ok) throw new Error(identityFailureMessage(identity.failure));
    if (publicLesson?.content !== params.sourceBody)
      throw new Error('La lezione è cambiata: ricarica prima di salvare.');
    if (
      params.publish &&
      (lesson?.hiddenFromStudents === true || !lesson?.completed || !publicLesson?.completed)
    )
      throw new Error('Segna la lezione come svolta prima di pubblicare.');
    tx.update(lessonRef, { studyPractice: practice });
    const publicRef = doc(params.db, 'publicLessonPractice', gate.publicLessonId);
    if (params.publish)
      tx.set(publicRef, {
        ownerUid: params.ownerUid,
        publicLessonId: gate.publicLessonId,
        practice,
      });
    else tx.delete(publicRef);
    tx.set(doc(collection(params.db, 'auditEvents')), {
      actorUid: params.ownerUid,
      action: params.publish ? 'lesson.practicePublished' : 'lesson.practiceDraftSaved',
      targetId: params.lessonId,
      outcome: 'success',
      timestamp: serverTimestamp(),
    });
  });
}
export async function withdrawStudyPractice(
  publicLessonId: string,
  ownerUid: string,
  db: Firestore,
): Promise<void> {
  await runTransaction(db, async (tx) => {
    const ref = doc(db, 'publicLessonPractice', publicLessonId);
    const snap = await tx.get(ref);
    if (snap.exists() && snap.data().ownerUid !== ownerUid) throw new Error('Accesso negato.');
    tx.delete(ref);
  });
}

/** Read the authoritative private draft whenever its editor opens; the course tree
 * is a navigation snapshot and may predate another save in the same workspace. */
export async function loadPrivateStudyPractice(params: {
  programId: string;
  importId: string;
  lessonId: string;
  ownerUid: string;
  sourceBody: string;
  db: Firestore;
}): Promise<StudyPractice | null> {
  const snapshot = await getDocFromServer(
    doc(
      params.db,
      'programs',
      params.programId,
      'imports',
      params.importId,
      'lessons',
      params.lessonId,
    ),
  );
  const lesson = snapshot.exists() ? (snapshot.data() as LessonDoc) : null;
  if (!lesson || lesson.ownerUid !== params.ownerUid || lesson.importId !== params.importId)
    throw new Error('Impossibile caricare la lezione corrente. Ricarica il corso.');
  return currentStudyPractice(lesson.studyPractice, params.sourceBody);
}

/** Verify the authoritative private artifact AND current public lesson body before continuing. */
export async function verifyStudyPracticeDraft(
  params: Parameters<typeof loadPrivateStudyPractice>[0] & {
    publicLessonId: string;
    practice: StudyPractice;
  },
): Promise<void> {
  const practice = validateStudyPractice(params.practice, params.sourceBody);
  const stored = await loadPrivateStudyPractice(params);
  const projection = await getDocFromServer(doc(params.db, 'publicLessons', params.publicLessonId));
  if (
    !projection.exists() ||
    projection.data().ownerUid !== params.ownerUid ||
    projection.data().content !== params.sourceBody ||
    !stored
  )
    throw new Error('La fonte o la bozza salvata è cambiata. Ricarica prima di continuare.');
  const stable = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(stable)
      : v && typeof v === 'object'
        ? Object.fromEntries(
            Object.entries(v)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([k, x]) => [k, stable(x)]),
          )
        : v;
  if (JSON.stringify(stable(stored)) !== JSON.stringify(stable(practice)))
    throw new Error('La bozza salvata è cambiata. Ricarica prima di continuare.');
}
