import { parsePool } from '@schoolforge/lesson-contract';
import { parseLessonMetadata } from '../validation/lessonMetadata.js';
import { assertLessonContentSize } from '../programs/lessonContentSize.js';
import { newPublicLessonId } from '../programs/publicLessonId.js';
import { toDocId } from '../canonicalNaming.js';
import type { ImportValidationResult, RawFile } from '../validation/types.js';
import type { ImportPayload } from './types.js';

// Re-exported so the historical import path keeps working; the implementation
// now lives in the shared pure module (see canonicalNaming.ts).
export { toDocId };

const QUESTION_PREVIEW_MAX_LENGTH = 100;

/**
 * Builds a safe preview snippet for the question index: whitespace-normalized,
 * truncated to at most 100 chars. Never derive this from soluzione, answers,
 * or explanations — only from the question's own testo.
 */
export function buildQuestionPreview(testo: string): string {
  const normalized = testo.replace(/\s+/g, ' ').trim();
  return normalized.slice(0, QUESTION_PREVIEW_MAX_LENGTH);
}

/**
 * Pure function: maps a validated import result to Firestore document payloads.
 * No Firebase SDK calls — safe to unit-test without emulators.
 *
 * Only call this when validation.valid === true (structural issues absent).
 * Pool/question issues are stored in importMeta.poolIssues but do not block.
 */
export function buildImportPayload(params: {
  validation: ImportValidationResult;
  programmaTitle: string;
  ownerUid: string;
  programId: string;
  importId: string;
  files: RawFile[];
}): ImportPayload {
  const { validation, programmaTitle, ownerUid, programId, importId, files } = params;

  const filesMap = new Map(files.map((f) => [f.path, f.content]));

  const udas: ImportPayload['udas'] = [];
  const lessons: ImportPayload['lessons'] = [];
  const questionIndex: ImportPayload['questionIndex'] = [];
  const publicLessons: ImportPayload['publicLessons'] = [];

  for (const [udaIndex, uda] of validation.udas.entries()) {
    const udaId = toDocId(uda.dir);
    const storageBasePath = `repository/${ownerUid}/imports/${importId}/${uda.dir}`;

    udas.push({
      id: udaId,
      data: {
        ownerUid,
        importId,
        dir: uda.dir,
        filename: uda.filename,
        order: udaIndex,
        storageBasePath,
        lessonCount: uda.lessons.length,
        titolo: uda.metadata.titolo ?? null,
        descrizione: uda.metadata.descrizione,
        competenze: uda.metadata.competenze,
        obiettivi: uda.metadata.obiettivi,
      },
    });

    for (const [lessonIndex, lesson] of uda.lessons.entries()) {
      // Scoped by udaId: lesson numbering restarts per UDA, so two UDAs can
      // legitimately share a lesson filename (e.g. both have a "lezione-001-...").
      const lessonId = `${udaId}_${toDocId(lesson.filename.replace(/\.md$/, ''))}`;
      const publicLessonId = newPublicLessonId(importId, lessonId);
      const storageRef = `repository/${ownerUid}/imports/${importId}/${lesson.path}`;
      const poolPath = lesson.path.replace(/\.md$/, '.pool.md');
      const poolStorageRef =
        lesson.poolStatus !== 'absent'
          ? `repository/${ownerUid}/imports/${importId}/${poolPath}`
          : null;

      let questionCount = 0;

      if (lesson.poolStatus === 'valid') {
        const poolContent = filesMap.get(poolPath);
        if (poolContent) {
          const parsed = parsePool(poolContent, poolPath);
          if (parsed.ok) {
            for (const q of parsed.pool.questions) {
              const entryId = `${lessonId}_${toDocId(q.id)}`;
              questionIndex.push({
                id: entryId,
                data: {
                  ownerUid,
                  importId,
                  udaDir: uda.dir,
                  lessonPath: lesson.path,
                  lessonFilename: lesson.filename,
                  poolStorageRef: poolStorageRef!,
                  questionLocalId: q.id,
                  tipo: q.tipo as 'aperta' | 'chiusa_singola' | 'chiusa_multipla',
                  // POOL-SIMPLE v2: difficoltà 1–5, maxPoints === difficolta, no peso.
                  difficolta: q.difficolta,
                  maxPoints: q.maxPoints,
                  questionPreview: buildQuestionPreview(q.testo),
                },
              });
              questionCount++;
            }
          }
        }
      }

      lessons.push({
        id: lessonId,
        udaId,
        data: {
          ownerUid,
          importId,
          publicLessonId,
          udaDir: uda.dir,
          path: lesson.path,
          filename: lesson.filename,
          order: lessonIndex,
          poolStatus: lesson.poolStatus,
          questionCount,
          storageRef,
          poolStorageRef,
          titolo: lesson.metadata.titolo,
          sottotitolo: lesson.metadata.sottotitolo,
          difficolta: lesson.metadata.difficolta,
          concettiChiave: lesson.metadata.concettiChiave,
          obiettivi: lesson.metadata.obiettivi,
        },
      });

      // Public projection (M3-lite, body M3F-08): only what's needed to
      // display the lesson to a student. Never poolStatus/poolStorageRef/
      // questionCount — those are teacher-only technical details.
      // titolo/difficolta are didactic front matter, safe to expose like
      // filename/path already are. `content` is the body only (front matter
      // already split out into the fields above) — the exact same parse
      // `parseLessonMetadata` performs everywhere else in this codebase, so
      // the projection matches character-for-character what a body edit
      // would later recompute.
      const rawFileContent = filesMap.get(lesson.path) ?? '';
      const { body: lessonBody } = parseLessonMetadata(rawFileContent);
      assertLessonContentSize(lessonBody, lesson.filename);

      publicLessons.push({
        id: publicLessonId,
        data: {
          ownerUid,
          programId,
          importId,
          udaId,
          udaDir: uda.dir,
          path: lesson.path,
          filename: lesson.filename,
          contentPath: storageRef,
          titolo: lesson.metadata.titolo,
          sottotitolo: lesson.metadata.sottotitolo,
          difficolta: lesson.metadata.difficolta,
          concettiChiave: lesson.metadata.concettiChiave,
          obiettivi: lesson.metadata.obiettivi,
          order: lessonIndex,
          completed: false,
          content: lessonBody,
        },
      });
    }
  }

  const poolIssues = validation.issues.filter((i) => i.level === 'pool' || i.level === 'question');

  return {
    importMeta: {
      ownerUid,
      programId,
      importId,
      programmaTitle,
      // Written as staging (invisible) and promoted to 'active' by the atomic
      // switch in importRepository — see HARD-02B-2 / HARD-F06.
      status: 'staging',
      udaCount: udas.length,
      lessonCount: lessons.length,
      questionCount: questionIndex.length,
      poolIssues,
      programmaMeta: validation.programma,
    },
    udas,
    lessons,
    questionIndex,
    publicLessons,
  };
}
