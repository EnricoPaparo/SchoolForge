import { parse as parseYaml } from 'yaml';
import { parsePool } from '@schoolforge/lesson-contract';
import type { RawFile } from '../validation/types.js';
import { validateUda } from '../validation/validateUda.js';
import { splitFrontMatter } from '../validation/frontMatter.js';
import { UDA_ARCHIVE_LIMITS, utf8ByteLength } from './limits.js';
import type { UdaArchiveError, UdaArchiveErrorCode, ValidateUdaArchiveResult } from './types.js';

const UDA_DIR_RE = /^uda-\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const LESSON_FILE_RE = /^lezione-(\d{3})-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/;
const POOL_FILE_RE = /^lezione-(\d{3})-[a-z0-9]+(?:-[a-z0-9]+)*\.pool\.md$/;

function fail(code: UdaArchiveErrorCode, message: string, path?: string): ValidateUdaArchiveResult {
  const error: UdaArchiveError = path ? { code, message, path } : { code, message };
  return { ok: false, error };
}

function basename(path: string): string {
  return path.split('/').pop() ?? path;
}

/**
 * Strict lesson front-matter check for Importa UDA (uda-import-contract §6.3):
 * unlike the program importer, malformed lesson YAML is NOT silently degraded
 * to empty metadata — it blocks. When a YAML block is present it must parse and
 * every known field must carry the expected type.
 */
function lessonMetadataIssue(content: string): string | null {
  const { frontMatterRaw } = splitFrontMatter(content);
  if (!frontMatterRaw) return null;
  let fm: Record<string, unknown>;
  try {
    fm = (parseYaml(frontMatterRaw) as Record<string, unknown>) ?? {};
  } catch (e) {
    return `YAML non valido: ${e instanceof Error ? e.message : String(e)}`;
  }
  if (fm === null || typeof fm !== 'object') return 'Front matter non valido.';
  for (const key of ['titolo', 'sottotitolo', 'difficolta'] as const) {
    if (key in fm && fm[key] != null && typeof fm[key] !== 'string') {
      return `Il campo "${key}" deve essere una stringa.`;
    }
  }
  for (const key of ['concetti_chiave', 'obiettivi'] as const) {
    if (key in fm && fm[key] != null) {
      const value = fm[key];
      if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) {
        return `Il campo "${key}" deve essere una lista di stringhe.`;
      }
    }
  }
  return null;
}

/**
 * Validates that a safe, already-read `RawFile[]` archive is exactly one UDA
 * with its lessons and (optional) pools, per uda-import-contract §6. Every
 * blocking condition is reported once with a stable code; there is NO silent
 * normalization or rename. Pool errors are blocking here (unlike the program
 * importer, which tolerates them).
 */
export function validateUdaArchive(files: RawFile[]): ValidateUdaArchiveResult {
  // No root files (programma.md included) and no nested subfolders inside the UDA.
  for (const f of files) {
    const segments = f.path.split('/');
    if (segments.length < 2) {
      return fail(
        'unexpected_file',
        `Nessun file è ammesso alla radice dello ZIP: "${f.path}".`,
        f.path,
      );
    }
    if (segments.length > 2) {
      return fail(
        'unexpected_file',
        `Sottocartelle non ammesse dentro la UDA: "${f.path}".`,
        f.path,
      );
    }
  }

  const dirs = new Set(files.map((f) => f.path.split('/')[0]));
  if (dirs.size === 0) return fail('no_uda', 'Lo ZIP deve contenere esattamente una UDA.');
  if (dirs.size > 1) {
    return fail(
      'multiple_udas',
      'Lo ZIP deve contenere esattamente una UDA. Sono state trovate più cartelle UDA.',
    );
  }

  const udaDir = [...dirs][0]!;
  if (!UDA_DIR_RE.test(udaDir)) {
    return fail('no_uda', 'La cartella UDA non ha un nome valido (atteso uda-NN-slug).', udaDir);
  }

  const udaFilename = `${udaDir}.md`;
  const udaFile = files.find((f) => f.path === `${udaDir}/${udaFilename}`);
  if (!udaFile) {
    return fail('no_uda', `Manca il file UDA "${udaFilename}".`, udaDir);
  }

  const lessonFiles: RawFile[] = [];
  const poolFiles = new Map<string, RawFile>();
  const lessonNumbers = new Map<string, string>();

  for (const f of files) {
    if (f.path === udaFile.path) continue;
    const b = basename(f.path);
    if (POOL_FILE_RE.test(b)) {
      poolFiles.set(f.path, f);
      continue;
    }
    const lessonMatch = LESSON_FILE_RE.exec(b);
    if (lessonMatch) {
      const number = lessonMatch[1]!;
      if (lessonNumbers.has(number)) {
        return fail(
          'duplicate_lesson_number',
          `Numero lezione duplicato "${number}" — l'ordine sarebbe ambiguo.`,
          f.path,
        );
      }
      lessonNumbers.set(number, f.path);
      lessonFiles.push(f);
      continue;
    }
    return fail('unexpected_file', `Il file "${f.path}" non è ammesso in uno ZIP UDA.`, f.path);
  }

  if (lessonFiles.length < UDA_ARCHIVE_LIMITS.MIN_LESSONS) {
    return fail('no_lessons', 'Lo ZIP deve contenere una UDA con almeno una lezione.');
  }
  if (lessonFiles.length > UDA_ARCHIVE_LIMITS.MAX_LESSONS) {
    return fail(
      'too_many_lessons',
      `La UDA supera il limite di ${UDA_ARCHIVE_LIMITS.MAX_LESSONS} lezioni.`,
    );
  }
  if (poolFiles.size > UDA_ARCHIVE_LIMITS.MAX_POOLS) {
    return fail(
      'too_many_pools',
      `La UDA supera il limite di ${UDA_ARCHIVE_LIMITS.MAX_POOLS} pool.`,
    );
  }

  // Orphan pools: every pool must be a companion of an existing lesson.
  const lessonPaths = new Set(lessonFiles.map((l) => l.path));
  for (const poolPath of poolFiles.keys()) {
    const companionLesson = poolPath.replace(/\.pool\.md$/, '.md');
    if (!lessonPaths.has(companionLesson)) {
      return fail('orphan_pool', `Il pool "${poolPath}" non ha una lezione associata.`, poolPath);
    }
  }

  // UDA metadata (reuse the canonical validator; UDA-level issues are blocking).
  const udaResult = validateUda(udaFile, lessonFiles, poolFiles);
  const udaLevelIssue = udaResult.issues.find((i) => i.level === 'uda');
  if (udaLevelIssue) {
    return fail(
      'invalid_uda_metadata',
      `Metadata UDA non valido: ${udaLevelIssue.message}.`,
      udaFile.path,
    );
  }

  // Strict lesson front-matter (blocking) + valid v2 pools (blocking) + counts.
  let questionCount = 0;
  for (const lesson of lessonFiles) {
    const metaIssue = lessonMetadataIssue(lesson.content);
    if (metaIssue) {
      return fail(
        'invalid_lesson_metadata',
        `Metadata lezione non valido in "${lesson.path}": ${metaIssue}`,
        lesson.path,
      );
    }
  }
  for (const [poolPath, poolFile] of poolFiles) {
    const parsed = parsePool(poolFile.content, poolPath);
    if (!parsed.ok) {
      const first = parsed.errors[0];
      return fail(
        'invalid_pool',
        `Il pool "${poolPath}" non rispetta schoolforge-pool/v2: ${first?.message ?? 'formato non valido'}.`,
        poolPath,
      );
    }
    questionCount += parsed.pool.questions.length;
  }

  if (questionCount > UDA_ARCHIVE_LIMITS.MAX_TOTAL_QUESTIONS) {
    return fail(
      'too_many_questions',
      `La UDA supera il limite di ${UDA_ARCHIVE_LIMITS.MAX_TOTAL_QUESTIONS} domande complessive.`,
    );
  }

  const totalDecompressedBytes = files.reduce((sum, f) => sum + utf8ByteLength(f.content), 0);

  return {
    ok: true,
    archive: {
      udaDir,
      udaFilename,
      udaTitle: udaResult.metadata.titolo ?? null,
      udaMetadata: udaResult.metadata,
      lessonCount: lessonFiles.length,
      poolCount: poolFiles.size,
      questionCount,
      totalDecompressedBytes,
    },
  };
}
