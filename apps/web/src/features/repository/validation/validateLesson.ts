import { parsePool } from '@schoolforge/lesson-contract';
import type { LessonResult, RawFile, ValidationIssue } from './types.js';

const LESSON_FILENAME_RE = /^lezione-\d{3}-.+\.md$/;

export function validateLesson(lessonFile: RawFile, poolFile?: RawFile): LessonResult {
  const filename = lessonFile.path.split('/').pop() ?? lessonFile.path;
  const issues: ValidationIssue[] = [];

  if (!LESSON_FILENAME_RE.test(filename)) {
    issues.push({
      level: 'lezione',
      path: lessonFile.path,
      field: 'filename',
      code: 'INVALID_LESSON_FILENAME',
      message: `Lesson filename "${filename}" does not match lezione-XXX-titolo.md`,
    });
  }

  let poolStatus: LessonResult['poolStatus'] = 'absent';

  if (poolFile) {
    const result = parsePool(poolFile.content, poolFile.path);
    if (result.ok) {
      poolStatus = 'valid';
    } else {
      poolStatus = 'invalid';
      for (const err of result.errors) {
        issues.push({
          level: err.questionIndex !== null ? 'question' : 'pool',
          path: poolFile.path,
          field: err.field,
          code: 'POOL_ERROR',
          message: err.message,
        });
      }
    }
  }

  return {
    path: lessonFile.path,
    filename,
    valid: issues.every((i) => i.level !== 'lezione'),
    poolStatus,
    issues,
  };
}
