import { parsePool } from '@schoolforge/lesson-contract';
import type { ImportValidationResult, RawFile } from '../validation/types.js';
import type { ImportPayload } from './types.js';

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

  for (const uda of validation.udas) {
    const udaId = toDocId(uda.dir);
    const storageBasePath = `repository/${ownerUid}/imports/${importId}/${uda.dir}`;

    udas.push({
      id: udaId,
      data: {
        ownerUid,
        importId,
        dir: uda.dir,
        filename: uda.filename,
        storageBasePath,
        lessonCount: uda.lessons.length,
        descrizione: uda.metadata.descrizione,
        competenze: uda.metadata.competenze,
        obiettivi: uda.metadata.obiettivi,
      },
    });

    for (const lesson of uda.lessons) {
      // Scoped by udaId: lesson numbering restarts per UDA, so two UDAs can
      // legitimately share a lesson filename (e.g. both have a "lezione-001-...").
      const lessonId = `${udaId}_${toDocId(lesson.filename.replace(/\.md$/, ''))}`;
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
                  difficolta: q.difficolta,
                  peso: q.peso,
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
          udaDir: uda.dir,
          path: lesson.path,
          filename: lesson.filename,
          poolStatus: lesson.poolStatus,
          questionCount,
          storageRef,
          poolStorageRef,
          titolo: lesson.metadata.titolo,
          difficolta: lesson.metadata.difficolta,
        },
      });

      // Public projection (M3-lite): only what's needed to display the
      // lesson to a student. Never poolStatus/poolStorageRef/questionCount —
      // those are teacher-only technical details. titolo/difficolta are
      // didactic front matter, safe to expose like filename/path already are.
      publicLessons.push({
        id: lessonId,
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
          difficolta: lesson.metadata.difficolta,
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
      status: 'committed',
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

/** Converts a path/filename fragment into a safe Firestore document ID. */
function toDocId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_');
}
