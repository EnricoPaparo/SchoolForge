import { collection, doc, getDoc, runTransaction, serverTimestamp } from 'firebase/firestore';
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
    const projectionRef = doc(params.db, 'publicLessons', gate.publicLessonId);
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
    if (params.publish && (!lesson?.completed || !publicLesson?.completed))
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
