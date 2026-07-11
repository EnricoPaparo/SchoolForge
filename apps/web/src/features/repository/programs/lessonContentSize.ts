/**
 * Conservative ceiling for `publicLessons/{id}.content` (M3F-08), well under
 * Firestore's 1 MiB (1,048,576 byte) per-document limit: `content` shares
 * the document with `titolo`/`sottotitolo`/`concettiChiave`/`obiettivi` and
 * every other `PublicLessonDoc` field, plus Firestore's own per-field/per-doc
 * overhead. 700,000 bytes leaves comfortable headroom for all of that
 * without requiring this constant to track the exact overhead byte-for-byte.
 */
export const MAX_LESSON_CONTENT_BYTES = 700_000;

/** Exact UTF-8 byte length — JS string `.length` counts UTF-16 code units, not bytes. */
export function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

export function isLessonContentSizeValid(content: string): boolean {
  return utf8ByteLength(content) <= MAX_LESSON_CONTENT_BYTES;
}

/**
 * Throws a clear, user-facing error when `content` exceeds the limit.
 * `label` identifies the offending lesson (filename or title) in the
 * message; every write path (import, create, body edit, backfill) must call
 * this before persisting `content`, never after.
 */
export function assertLessonContentSize(content: string, label: string): void {
  if (!isLessonContentSizeValid(content)) {
    const bytes = utf8ByteLength(content);
    throw new Error(
      `Il contenuto della lezione "${label}" (${bytes} byte) supera il limite di ${MAX_LESSON_CONTENT_BYTES} byte consentito per la proiezione studente.`,
    );
  }
}

/**
 * Normalizes a raw `publicLessons.content` field read from Firestore: a
 * legacy document written before M3F-08 has no `content` at all (or a
 * non-string value from a corrupt write) — both cases must be treated as
 * "projection missing", never as an empty-but-valid lesson body, so the
 * student UI can show "Contenuto temporaneamente non disponibile" instead
 * of silently rendering nothing.
 */
export function normalizeLessonContent(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}
