import { parsePool } from '@schoolforge/lesson-contract';
import type { ImportValidationResult, RawFile } from '../validation/types.js';
import type { ImportPayload } from './types.js';

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
      },
    });

    for (const lesson of uda.lessons) {
      const lessonId = toDocId(lesson.filename.replace(/\.md$/, ''));
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
              const entryId = `${udaId}_${lessonId}_${toDocId(q.id)}`;
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
    },
    udas,
    lessons,
    questionIndex,
  };
}

/** Converts a path/filename fragment into a safe Firestore document ID. */
function toDocId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_');
}
