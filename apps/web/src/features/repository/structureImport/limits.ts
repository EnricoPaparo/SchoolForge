/**
 * STRUCTURE-IMPORT-01 — limits of the structural metadata import
 * (structure-metadata-import-roadmap.md §5).
 *
 * These are not a pricing tariff: they keep a hand-written YAML file within
 * reasonable browser use, keep every batch under the limits the canonical
 * services already respect, and keep each metadata string short enough to be
 * displayed and sent to the existing AI payload without truncation.
 *
 * Single source of truth: parser, validators, templates, planners and the
 * future UI import these constants — never a local literal.
 */
export const STRUCTURE_IMPORT_LIMITS = {
  /** UTF-8 byte size of the whole `.yaml`/`.yml` file. */
  MAX_FILE_BYTES: 256_000,
  /** UDAs per import (inclusive). */
  MIN_UDAS: 1,
  MAX_UDAS: 40,
  /** Lessons per import (inclusive) — aligned with `UDA_ARCHIVE_LIMITS.MAX_LESSONS`. */
  MIN_LESSONS: 1,
  MAX_LESSONS: 40,
  /** Items of any list field (`competenze`, `obiettivi`, `concettiChiave`). */
  MIN_LIST_ITEMS: 1,
  MAX_LIST_ITEMS: 40,
  /** Characters of any free-text field, and of any list item. */
  MAX_TEXT_LENGTH: 300,
  /** Characters of `difficolta`, aligned with the existing AI payload bound. */
  MAX_DIFFICULTY_LENGTH: 120,
} as const;

/** Accepted file extensions. Nothing else is read, whatever the MIME type says. */
export const STRUCTURE_IMPORT_EXTENSIONS = ['.yaml', '.yml'] as const;

/** Exact schema identifiers. A file without the exact match is rejected. */
export const UDA_METADATA_SCHEMA = 'schoolforge-uda-metadata/v1';
export const LESSON_METADATA_SCHEMA = 'schoolforge-lesson-metadata/v1';

/** UTF-8 byte length of a string, without allocating a Buffer per call site. */
export function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}
