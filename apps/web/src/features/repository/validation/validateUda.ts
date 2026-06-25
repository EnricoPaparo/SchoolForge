import { parse as parseYaml } from 'yaml';
import type { LessonResult, RawFile, UdaResult, ValidationIssue } from './types.js';
import { validateLesson } from './validateLesson.js';

const UDA_FILENAME_RE = /^uda-\d{2}-.+\.md$/;

interface UdaFrontMatter {
  titolo?: unknown;
  competenze?: unknown;
  obiettivi?: unknown;
}

function extractFrontMatter(content: string): string | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
  return match ? match[1] : null;
}

function isNonEmptyStringArray(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => typeof item === 'string' && item.trim().length > 0)
  );
}

/**
 * Validates a single UDA file plus its associated lessons.
 *
 * @param udaFile     The uda-XX-titolo.md file
 * @param lessonFiles Lesson files already filtered to this UDA's directory
 * @param poolFiles   Map keyed by full path (e.g. "uda-01/lezione-001-x.pool.md")
 */
export function validateUda(
  udaFile: RawFile,
  lessonFiles: RawFile[],
  poolFiles: Map<string, RawFile>,
): UdaResult {
  const dir = udaFile.path.split('/').slice(0, -1).join('/');
  const filename = udaFile.path.split('/').pop() ?? udaFile.path;
  const udaIssues: ValidationIssue[] = [];

  if (!UDA_FILENAME_RE.test(filename)) {
    udaIssues.push({
      level: 'uda',
      path: udaFile.path,
      field: 'filename',
      code: 'INVALID_UDA_FILENAME',
      message: `UDA filename "${filename}" does not match uda-XX-titolo.md`,
    });
  }

  const fmRaw = extractFrontMatter(udaFile.content);
  if (!fmRaw) {
    udaIssues.push({
      level: 'uda',
      path: udaFile.path,
      field: 'front_matter',
      code: 'MISSING_FRONT_MATTER',
      message: 'UDA file is missing YAML front matter (expected --- ... --- block)',
    });
  } else {
    let fm: UdaFrontMatter = {};
    try {
      fm = (parseYaml(fmRaw) as UdaFrontMatter) ?? {};
    } catch (e) {
      udaIssues.push({
        level: 'uda',
        path: udaFile.path,
        field: 'front_matter',
        code: 'YAML_PARSE_ERROR',
        message: `YAML parse error: ${e instanceof Error ? e.message : String(e)}`,
      });
    }

    if (typeof fm.titolo !== 'string' || fm.titolo.trim().length === 0) {
      udaIssues.push({
        level: 'uda',
        path: udaFile.path,
        field: 'titolo',
        code: 'MISSING_FIELD',
        message: 'Required field "titolo" is missing or empty',
      });
    }

    if (!isNonEmptyStringArray(fm.competenze)) {
      udaIssues.push({
        level: 'uda',
        path: udaFile.path,
        field: 'competenze',
        code: 'INVALID_FIELD_TYPE',
        message: '"competenze" must be a non-empty list of non-empty strings',
      });
    }

    if (!isNonEmptyStringArray(fm.obiettivi)) {
      udaIssues.push({
        level: 'uda',
        path: udaFile.path,
        field: 'obiettivi',
        code: 'INVALID_FIELD_TYPE',
        message: '"obiettivi" must be a non-empty list of non-empty strings',
      });
    }
  }

  if (lessonFiles.length === 0) {
    udaIssues.push({
      level: 'uda',
      path: udaFile.path,
      field: 'lessons',
      code: 'NO_LESSONS',
      message: 'UDA has no lesson files',
    });
  }

  const lessons: LessonResult[] = lessonFiles.map((lf) => {
    const poolKey = lf.path.replace(/\.md$/, '.pool.md');
    return validateLesson(lf, poolFiles.get(poolKey));
  });

  return {
    dir,
    filename,
    valid: udaIssues.every((i) => i.level !== 'uda'),
    lessons,
    issues: udaIssues,
  };
}
