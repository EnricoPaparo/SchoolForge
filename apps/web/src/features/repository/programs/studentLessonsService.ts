import { collection, getDocs, query, where } from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import type { PublicLessonDoc, ProgramDoc } from '../../../types/firestore.js';
import { getOwnStudentDoc } from '../students/studentsService.js';
import { normalizeLessonContent } from './lessonContentSize.js';

export type StudentProgram = Pick<ProgramDoc, 'title' | 'classIds'> & {
  id: string;
  activeImportId: string | null;
};
/**
 * `content` is normalized to `string | null` (never `undefined`): a legacy
 * `publicLessons` doc written before M3F-08 has no `content` field, and the
 * student UI must treat that as "projection missing" explicitly, not as an
 * absent-but-optional field it might accidentally skip checking.
 */
export type StudentLesson = { id: string } & Omit<PublicLessonDoc, 'content'> & {
    content: string | null;
  };

/**
 * `true` per una proiezione il cui corpo è presente ma vuoto o composto di soli
 * spazi: lo scheletro di una lezione importata e non ancora scritta.
 */
export function isEmptySkeleton(content: string | null): boolean {
  return typeof content === 'string' && content.trim() === '';
}

export type StudentLessonsResult =
  | { status: 'no-class' }
  | {
      status: 'ok';
      programs: StudentProgram[];
      lessonsByProgram: Record<string, StudentLesson[]>;
    };

/**
 * Reads only what an approved student is allowed to see (Security Rules
 * enforce the same class-matching independently — this mirrors, not
 * replaces, that check): their own classId, the programs assigned to that
 * class (`classIds` array-contains), and the `publicLessons` projection for
 * each matched program. Never reads a program's `imports/**` subcollection
 * (technical lessons, questionIndex, pool) — those stay owner-only.
 *
 * A program is queried one at a time (`where('programId', '==', id)`)
 * rather than combined with `in`, so the corresponding Security Rule only
 * ever needs to resolve a single, query-fixed program path per request.
 */
export async function loadStudentLessons(
  uid: string,
  db: Firestore,
): Promise<StudentLessonsResult> {
  const studentDoc = await getOwnStudentDoc(uid, db);
  const classId = studentDoc?.classId ?? null;
  if (!classId) return { status: 'no-class' };

  const programsSnap = await getDocs(
    query(collection(db, 'programs'), where('classIds', 'array-contains', classId)),
  );
  const programs: StudentProgram[] = programsSnap.docs
    .map((d) => {
      const data = d.data() as ProgramDoc;
      return {
        id: d.id,
        title: data.title,
        classIds: data.classIds ?? [],
        activeImportId: data.activeImportId ?? null,
      };
    })
    .sort((a, b) => a.title.localeCompare(b.title));

  const lessonsByProgram: Record<string, StudentLesson[]> = {};
  await Promise.all(
    programs.map(async (program) => {
      // A program with no active import has no visible projection: skip the
      // query entirely (an empty lesson list), rather than reading stale/legacy
      // projections that no longer belong to any active import. The Security
      // Rule enforces the same `importId == activeImportId` constraint
      // server-side (HARD-02B-1).
      if (!program.activeImportId) {
        lessonsByProgram[program.id] = [];
        return;
      }
      const lessonsSnap = await getDocs(
        query(
          collection(db, 'publicLessons'),
          where('programId', '==', program.id),
          where('importId', '==', program.activeImportId),
        ),
      );
      lessonsByProgram[program.id] = lessonsSnap.docs
        .map((d) => {
          const raw = d.data() as Partial<PublicLessonDoc>;
          return {
            id: d.id,
            ...raw,
            order: raw.order ?? Number.MAX_SAFE_INTEGER,
            sottotitolo: raw.sottotitolo ?? null,
            difficolta: raw.difficolta ?? null,
            concettiChiave: raw.concettiChiave ?? [],
            obiettivi: raw.obiettivi ?? [],
            content: normalizeLessonContent(raw.content),
          } as StudentLesson;
        })
        // STRUCTURE-IMPORT-02B: una lezione importata come scheletro ha corpo
        // vuoto. Mostrarla produrrebbe una card che non porta nulla, quindi
        // viene omessa finché il docente non salva o genera un contenuto reale
        // — il salvataggio canonico aggiorna `publicLessons.content` e la
        // rende visibile senza altre letture e senza un secondo percorso di
        // pubblicazione.
        //
        // Filtro di prodotto, **non** un confine di sicurezza: la proiezione
        // resta tecnicamente leggibile secondo le Rules correnti.
        //
        // `null` non è filtrato: è una proiezione legacy priva del campo
        // `content` (pre M3F-08), che la UI gestisce già a parte.
        .filter((lesson) => !isEmptySkeleton(lesson.content))
        .sort(
          (a, b) =>
            a.udaDir.localeCompare(b.udaDir) ||
            (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER) ||
            a.filename.localeCompare(b.filename),
        );
    }),
  );

  return { status: 'ok', programs, lessonsByProgram };
}
