import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import type {
  CorrectionDoc,
  SubmissionDoc,
  VerificationDoc,
  VerificationQuestionRef,
  VerificationTeacherSnapshot,
} from '../../../types/firestore.js';
import { listLessons, listUdas } from '../programs/programsService.js';
import {
  deriveVerificationLessonOutcomes,
  VerificationLessonOutcomesError,
  type VerificationLessonOutcomesReport,
  type VerificationOutcomeCorrection,
  type VerificationOutcomeSource,
} from './verificationLessonOutcomes.js';

function assertClosedVerification(
  ownerUid: string,
  raw: unknown,
): VerificationDoc & { teacherSnapshot: VerificationTeacherSnapshot } {
  if (!raw || typeof raw !== 'object') {
    throw new VerificationLessonOutcomesError('Verifica non valida.');
  }
  const verification = raw as VerificationDoc;
  if (verification.ownerUid !== ownerUid) {
    throw new VerificationLessonOutcomesError('Verifica non disponibile.');
  }
  if (verification.status !== 'closed') {
    throw new VerificationLessonOutcomesError('Gli esiti sono disponibili solo a verifica chiusa.');
  }
  if (!verification.teacherSnapshot?.questions || !verification.teacherSnapshot.questionRefs) {
    throw new VerificationLessonOutcomesError(
      'Questa verifica non contiene lo snapshot necessario per calcolare gli esiti.',
    );
  }
  return verification as VerificationDoc & { teacherSnapshot: VerificationTeacherSnapshot };
}

function assertLoadInput(input: { verificationId: string; ownerUid: string }): void {
  if (input.verificationId.trim().length === 0) {
    throw new VerificationLessonOutcomesError('Identificativo della verifica non valido.');
  }
  if (input.ownerUid.trim().length === 0) {
    throw new VerificationLessonOutcomesError('Docente non valido.');
  }
}

function sourceRefByOrder(
  snapshot: VerificationTeacherSnapshot,
): Map<number, VerificationQuestionRef> {
  const byOrder = new Map<number, VerificationQuestionRef>();
  snapshot.questionRefs.forEach((ref, order) => byOrder.set(order, ref));

  // Le alternative differenziate sono congelate in `questions[]`, ma
  // `questionRefs` conserva le sole domande selezionate. VDIF-04 garantisce che
  // ogni alternativa appartenga alla stessa lezione della base: qui eredita
  // esclusivamente quell'origine didattica, mai l'etichetta.
  for (const question of snapshot.differentiation?.questions ?? []) {
    const baseRef = snapshot.questionRefs[question.baseOrder];
    if (!baseRef) {
      throw new VerificationLessonOutcomesError('Snapshot delle varianti non coerente.');
    }
    for (const choice of Object.values(question.choices)) {
      if (choice.kind !== 'alternative') continue;
      const previous = byOrder.get(choice.order);
      if (
        previous &&
        (previous.udaDir !== baseRef.udaDir || previous.lessonFilename !== baseRef.lessonFilename)
      ) {
        throw new VerificationLessonOutcomesError('Origine di una variante non coerente.');
      }
      byOrder.set(choice.order, baseRef);
    }
  }
  return byOrder;
}

/**
 * ESITI-01 — lettura una-tantum, eseguita soltanto aprendo il dialog.
 * Nessun listener, polling o scrittura. La verifica viene riletta per impedire
 * che una card diventata stantia apra gli esiti dopo una riapertura.
 */
export async function loadVerificationLessonOutcomes(input: {
  verificationId: string;
  ownerUid: string;
  db: Firestore;
}): Promise<VerificationLessonOutcomesReport> {
  // Gli identificativi vengono fermati prima di costruire qualunque
  // DocumentReference: un input locale corrotto non deve produrre operazioni.
  assertLoadInput(input);
  const verificationRef = doc(input.db, 'verifications', input.verificationId);
  const verificationSnap = await getDoc(verificationRef);
  if (!verificationSnap.exists()) {
    throw new VerificationLessonOutcomesError('Verifica non trovata.');
  }
  const verification = assertClosedVerification(input.ownerUid, verificationSnap.data());
  const { teacherSnapshot } = verification;
  // `assertClosedVerification` ha già verificato la presenza; la costante
  // rende il restringimento esplicito anche oltre il confine della funzione.
  const teacherQuestions = teacherSnapshot.questions!;

  const [correctionsSnap, submissionsSnap, udas, lessons] = await Promise.all([
    getDocs(
      query(
        collection(input.db, 'corrections'),
        where('verificationId', '==', input.verificationId),
      ),
    ),
    getDocs(
      query(
        collection(input.db, 'submissions'),
        where('verificationId', '==', input.verificationId),
        where('ownerUid', '==', input.ownerUid),
        where('status', '==', 'submitted'),
      ),
    ),
    listUdas(teacherSnapshot.programId, teacherSnapshot.importId, input.db),
    listLessons(teacherSnapshot.programId, teacherSnapshot.importId, input.db),
  ]);

  const corrections: VerificationOutcomeCorrection[] = correctionsSnap.docs.map((item) => {
    const data = item.data() as CorrectionDoc;
    if (data.ownerUid !== input.ownerUid || data.verificationId !== input.verificationId) {
      throw new VerificationLessonOutcomesError('Una correzione non appartiene alla verifica.');
    }
    return {
      correctionId: item.id,
      studentUid: data.studentUid,
      status: data.status,
      evaluations: data.evaluations,
    };
  });

  for (const item of submissionsSnap.docs) {
    const data = item.data() as SubmissionDoc;
    if (
      data.ownerUid !== input.ownerUid ||
      data.verificationId !== input.verificationId ||
      data.status !== 'submitted'
    ) {
      throw new VerificationLessonOutcomesError('Una consegna non appartiene alla verifica.');
    }
  }

  const udaByDir = new Map(udas.map((uda) => [uda.dir, uda]));
  const lessonByPath = new Map(
    lessons.map((lesson) => [`${lesson.udaDir}\u0000${lesson.filename}`, lesson]),
  );
  const refByOrder = sourceRefByOrder(teacherSnapshot);
  const sources: VerificationOutcomeSource[] = teacherQuestions.map((question) => {
    const ref = refByOrder.get(question.order);
    if (!ref) {
      throw new VerificationLessonOutcomesError(
        `La domanda ${question.order + 1} non ha un’origine didattica riconoscibile.`,
      );
    }
    const uda = udaByDir.get(ref.udaDir);
    const lesson = lessonByPath.get(`${ref.udaDir}\u0000${ref.lessonFilename}`);
    if (!uda?.titolo || !lesson?.titolo) {
      throw new VerificationLessonOutcomesError(
        'Il perimetro didattico del corso non è più riconoscibile.',
      );
    }
    return {
      order: question.order,
      udaDir: ref.udaDir,
      lessonFilename: ref.lessonFilename,
      udaTitle: uda.titolo,
      lessonTitle: lesson.titolo,
    };
  });

  return deriveVerificationLessonOutcomes({
    corrections,
    sources,
    submittedCount: submissionsSnap.size,
  });
}
