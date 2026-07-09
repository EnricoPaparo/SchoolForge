export interface LessonTitleInfo {
  /** Zero-padded lesson number extracted from the filename (e.g. "001"), or null if not found. */
  number: string | null;
  /** Readable title: the front matter titolo when present, otherwise a cleaned-up filename. */
  title: string;
}

const LESSON_NUMBER_RE = /^lezione-(\d{3})-/;

function cleanFilename(filename: string): string {
  const withoutExt = filename.replace(/\.md$/, '');
  const withoutPrefix = withoutExt.replace(LESSON_NUMBER_RE, '');
  const spaced = withoutPrefix.replace(/[-_]+/g, ' ').trim();
  if (!spaced) return filename;
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * Resolves what to display for a lesson: the filename stays the sort/order
 * key everywhere (never changed by this), but the *label* prefers the
 * front matter `titolo` when present and falls back to a cleaned-up
 * filename otherwise — never a raw "lezione-001-....md" string.
 */
export function resolveLessonTitle(filename: string, titolo?: string | null): LessonTitleInfo {
  const numberMatch = LESSON_NUMBER_RE.exec(filename);
  const number = numberMatch ? numberMatch[1] : null;
  const title = titolo && titolo.trim() ? titolo.trim() : cleanFilename(filename);
  return { number, title };
}
