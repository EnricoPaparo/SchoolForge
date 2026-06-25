import type { ImportValidationResult, RawFile, ValidationIssue } from './types.js';
import { validateUda } from './validateUda.js';

const LESSON_FILENAME_RE = /^lezione-\d{3}-.+\.md$/;
const POOL_FILENAME_RE = /^lezione-\d{3}-.+\.pool\.md$/;
const UDA_FILENAME_RE = /^uda-\d{2}-.+\.md$/;

function basename(path: string): string {
  return path.split('/').pop() ?? path;
}

/**
 * Validates a full import manifest: groups files by top-level directory,
 * finds UDA/lesson/pool files in each, and runs structural validation.
 *
 * Pool errors do not affect the overall `valid` flag — a lesson with an
 * invalid pool is still considered structurally valid (FR-REP-02).
 *
 * @param programmaTitle Title provided by the teacher in the UI
 * @param files          All files in the import, with paths relative to the import root
 */
export function validateImport(programmaTitle: string, files: RawFile[]): ImportValidationResult {
  const topLevelIssues: ValidationIssue[] = [];

  if (!programmaTitle.trim()) {
    topLevelIssues.push({
      level: 'programma',
      path: '',
      field: 'title',
      code: 'MISSING_FIELD',
      message: 'Programma title is required',
    });
  }

  // Group files by top-level directory (files at root level are ignored)
  const byDir = new Map<string, RawFile[]>();
  for (const file of files) {
    const parts = file.path.split('/');
    if (parts.length < 2) continue;
    const dir = parts[0];
    const existing = byDir.get(dir);
    if (existing) {
      existing.push(file);
    } else {
      byDir.set(dir, [file]);
    }
  }

  const udaResults = [];

  for (const [dir, dirFiles] of byDir) {
    const udaFile = dirFiles.find((f) => UDA_FILENAME_RE.test(basename(f.path)));

    if (!udaFile) {
      topLevelIssues.push({
        level: 'programma',
        path: dir,
        field: 'uda_file',
        code: 'MISSING_UDA_FILE',
        message: `Directory "${dir}" has no uda-XX-titolo.md file`,
      });
      continue;
    }

    const lessonFiles = dirFiles.filter((f) => {
      const b = basename(f.path);
      return LESSON_FILENAME_RE.test(b) && !POOL_FILENAME_RE.test(b);
    });

    const poolFiles = new Map<string, RawFile>();
    for (const f of dirFiles) {
      if (POOL_FILENAME_RE.test(basename(f.path))) {
        poolFiles.set(f.path, f);
      }
    }

    udaResults.push(validateUda(udaFile, lessonFiles, poolFiles));
  }

  if (udaResults.length === 0) {
    topLevelIssues.push({
      level: 'programma',
      path: '',
      field: 'udas',
      code: 'NO_UDAS',
      message: 'Import must contain at least one UDA',
    });
  }

  const udaIssues = udaResults.flatMap((u) => u.issues);
  const lessonIssues = udaResults.flatMap((u) => u.lessons.flatMap((l) => l.issues));
  const allIssues = [...topLevelIssues, ...udaIssues, ...lessonIssues];

  const structuralIssues = allIssues.filter((i) => i.level !== 'pool' && i.level !== 'question');

  return {
    valid: structuralIssues.length === 0,
    issues: allIssues,
    udas: udaResults,
  };
}
