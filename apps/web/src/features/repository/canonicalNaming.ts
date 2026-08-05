/**
 * Canonical naming, numbering and front-matter helpers for repository content.
 *
 * These functions were **extracted verbatim** from the services that already
 * owned them (`import/buildImportPayload.ts` and `editor/repositoryEditorService.ts`)
 * so that a second producer of canonical UDA/lesson artefacts — the structural
 * metadata import (STRUCTURE-IMPORT) — can reuse them instead of re-deriving
 * slugs, document ids, numbering or front-matter keys informally. Behaviour is
 * unchanged: every regex, fallback and edge case is preserved exactly, and the
 * original call sites keep importing the same symbols.
 *
 * Pure module: no Firebase, no React, no browser API, no network. Its only
 * dependency is the front-matter composer, itself pure.
 */
import type { EditableFrontMatter } from './validation/frontMatter.js';
import type { LessonMetadata, UdaMetadata } from './validation/types.js';

/**
 * Firestore document id from an arbitrary logical name: anything outside
 * `[A-Za-z0-9_-]` becomes `_`. Deliberately lossy and deterministic — two
 * different names *can* collapse to the same id, which is why every producer
 * must preflight collisions rather than assume uniqueness.
 */
export function toDocId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_');
}

/**
 * Deterministic, filesystem-safe slug for a title: lowercase, diacritics
 * stripped, anything outside [a-z0-9] collapsed to a single hyphen,
 * leading/trailing hyphens trimmed. Never empty — falls back to "lezione" so a
 * title made entirely of symbols still yields a valid filename.
 */
const COMBINING_DIACRITICS_RE = /[̀-ͯ]/g;

export function slugify(input: string): string {
  const slug = input
    .normalize('NFD')
    .replace(COMBINING_DIACRITICS_RE, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'lezione';
}

/**
 * Legacy order fallback for a UDA that never received an explicit `order`:
 * the `uda-XX` prefix of its directory, zero-based. `null` when the directory
 * does not follow the canonical shape.
 */
export function udaOrderFromDir(dir: string | undefined): number | null {
  const match = /^uda-(\d+)(?:-|$)/.exec(dir ?? '');
  return match ? Number(match[1]) - 1 : null;
}

/** Same reasoning as `udaOrderFromDir`, for a lesson's `lezione-XXX` filename prefix. */
export function lessonOrderFromFilename(filename: string | undefined): number | null {
  const match = /^lezione-(\d+)(?:-|\.md$)/.exec(filename ?? '');
  return match ? Number(match[1]) - 1 : null;
}

/**
 * Highest `uda-XX` number already used. `0` when there is none, so the next
 * UDA is `uda-01`. Gaps are never filled: numbering only ever moves forward.
 */
export function maxUdaNumber(existing: ReadonlyArray<{ dir?: string | undefined }>): number {
  return existing.reduce((max, uda) => {
    const match = /^uda-(\d+)-/.exec(uda.dir ?? '');
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
}

/**
 * Highest UDA `order` already used, falling back to the `uda-XX` prefix for
 * legacy documents that never stored one. `-1` when the import is empty, so the
 * first UDA gets `order: 0`.
 */
export function maxUdaOrder(
  existing: ReadonlyArray<{ dir?: string | undefined; order?: number | undefined }>,
): number {
  return existing.reduce(
    (max, uda) => Math.max(max, uda.order ?? udaOrderFromDir(uda.dir) ?? -1),
    -1,
  );
}

/** Highest `lezione-XXX` number already used inside one UDA. `0` when there is none. */
export function maxLessonNumber(
  existing: ReadonlyArray<{ filename?: string | undefined }>,
): number {
  return existing.reduce((max, lesson) => {
    const match = /^lezione-(\d+)-/.exec(lesson.filename ?? '');
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
}

/**
 * Highest lesson `order` already used inside one UDA.
 *
 * `legacyFilenameFallback` selects between the two behaviours that already
 * exist in the codebase, rather than silently unifying them:
 *
 * - `false` (default) reproduces `createLesson` exactly: a lesson without an
 *   explicit `order` counts as `-1`;
 * - `true` additionally falls back to the `lezione-XXX` prefix, the same legacy
 *   source `reorderLesson` already trusts. Bulk planners use this so a UDA
 *   imported before `order` was persisted cannot make every appended lesson
 *   land on `order: 0`.
 */
export function maxLessonOrder(
  existing: ReadonlyArray<{ filename?: string | undefined; order?: number | undefined }>,
  options: { legacyFilenameFallback?: boolean } = {},
): number {
  const fallback = options.legacyFilenameFallback ?? false;
  return existing.reduce(
    (max, lesson) =>
      Math.max(
        max,
        lesson.order ?? (fallback ? (lessonOrderFromFilename(lesson.filename) ?? -1) : -1),
      ),
    -1,
  );
}

/** Canonical `uda-XX-slug` directory name. */
export function udaDirName(number: number, titolo: string): string {
  return `uda-${String(number).padStart(2, '0')}-${slugify(titolo)}`;
}

/** Canonical `lezione-XXX-slug.md` filename. */
export function lessonFileName(number: number, titolo: string): string {
  return `lezione-${String(number).padStart(3, '0')}-${slugify(titolo)}.md`;
}

/** Canonical Storage base path of one UDA directory. */
export function udaStorageBasePath(ownerUid: string, importId: string, dir: string): string {
  return `repository/${ownerUid}/imports/${importId}/${dir}`;
}

/** Canonical Storage path of a file addressed by its import-relative path. */
export function importStoragePath(ownerUid: string, importId: string, path: string): string {
  return `repository/${ownerUid}/imports/${importId}/${path}`;
}

/** Maps parsed lesson metadata to the YAML front matter keys used on disk. */
export function lessonFrontMatterFields(metadata: LessonMetadata): EditableFrontMatter {
  return {
    titolo: metadata.titolo,
    sottotitolo: metadata.sottotitolo,
    difficolta: metadata.difficolta,
    concetti_chiave: metadata.concettiChiave,
    obiettivi: metadata.obiettivi,
  };
}

/**
 * Maps a UDA's `titolo` plus its metadata to the YAML front matter keys used
 * on disk. `titolo` is passed explicitly (the canonical value at create time)
 * and takes precedence over any `metadata.titolo`.
 */
export function udaFrontMatterFields(titolo: string, metadata: UdaMetadata): EditableFrontMatter {
  return {
    titolo,
    descrizione: metadata.descrizione,
    competenze: metadata.competenze,
    obiettivi: metadata.obiettivi,
  };
}
