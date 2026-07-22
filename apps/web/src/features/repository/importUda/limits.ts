/**
 * TWU-04B — binding "Importa UDA" archive limits (uda-import-contract §6.1).
 *
 * These are not a pricing tariff: they keep the archive within reasonable
 * browser use, keep every file compatible with the same-origin Storage Gateway
 * and `publicLessons`, keep the final publish transaction under the 400-mutation
 * chunk margin, and force the "large but allowed" case (40 lessons + 500
 * questions > 400) across more than one technical staging chunk.
 *
 * Single source of truth: every layer (reader, validator, payload builder,
 * service, UI) imports these constants — never a local literal.
 */
export const UDA_ARCHIVE_LIMITS = {
  /** Compressed `.zip` byte size (browser `File.size`). */
  MAX_COMPRESSED_BYTES: 10_000_000,
  /** Total decompressed UTF-8 content across all logical files. */
  MAX_TOTAL_DECOMPRESSED_BYTES: 8_000_000,
  /** Any single logical file's decompressed UTF-8 byte size. */
  MAX_SINGLE_FILE_BYTES: 700_000,
  /** Exactly one UDA folder is allowed. */
  EXACT_UDAS: 1,
  /** Lessons per UDA (inclusive). */
  MIN_LESSONS: 1,
  MAX_LESSONS: 40,
  /** Pool companions (0..MAX, at most one per lesson). */
  MAX_POOLS: 40,
  /** Questions across every pool in the archive. */
  MAX_TOTAL_QUESTIONS: 500,
  /** Logical files: 1 UDA + 40 lessons + 40 pools. */
  MAX_LOGICAL_FILES: 81,
} as const;

/** UTF-8 byte length of a string, without allocating a Buffer per call site. */
export function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}
