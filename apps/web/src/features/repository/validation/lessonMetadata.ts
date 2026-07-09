import { parse as parseYaml } from 'yaml';
import type { LessonMetadata } from './types.js';
import { splitFrontMatter } from './frontMatter.js';

export const EMPTY_LESSON_METADATA: LessonMetadata = {
  titolo: null,
  sottotitolo: null,
  difficolta: null,
  concettiChiave: [],
  obiettivi: [],
};

function toStringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((item) => item.trim());
}

/**
 * Removes a leading "# <titolo>" line from the body when it exactly matches
 * the front matter titolo (case-insensitive) — avoids showing the same
 * title twice (once in the header, once as the body's first heading).
 * Anything less than an exact match is left untouched: this is not a
 * general H1-stripping pass, just the one safe, unambiguous duplicate case.
 */
function stripDuplicateHeading(body: string, titolo: string | null): string {
  if (!titolo) return body;
  const lines = body.split('\n');
  const firstIdx = lines.findIndex((l) => l.trim().length > 0);
  if (firstIdx === -1) return body;
  const match = /^#\s+(.+?)\s*$/.exec(lines[firstIdx].trim());
  if (!match || match[1].trim().toLowerCase() !== titolo.trim().toLowerCase()) return body;
  return lines
    .slice(firstIdx + 1)
    .join('\n')
    .trim();
}

/**
 * Splits a lesson Markdown file into its optional YAML front matter
 * (titolo/sottotitolo/difficolta/concetti_chiave/obiettivi — all optional)
 * and the body to render/print. Missing or malformed front matter never
 * throws: it falls back to empty metadata and the original content as the
 * body, exactly like a lesson with no front matter at all.
 */
export function parseLessonMetadata(content: string): {
  metadata: LessonMetadata;
  body: string;
} {
  const { frontMatterRaw, body } = splitFrontMatter(content);
  if (!frontMatterRaw) return { metadata: EMPTY_LESSON_METADATA, body };

  let fm: Record<string, unknown>;
  try {
    fm = (parseYaml(frontMatterRaw) as Record<string, unknown>) ?? {};
  } catch {
    return { metadata: EMPTY_LESSON_METADATA, body };
  }

  const metadata: LessonMetadata = {
    titolo: toStringOrNull(fm.titolo),
    sottotitolo: toStringOrNull(fm.sottotitolo),
    difficolta: toStringOrNull(fm.difficolta),
    concettiChiave: toStringArray(fm.concetti_chiave),
    obiettivi: toStringArray(fm.obiettivi),
  };

  return { metadata, body: stripDuplicateHeading(body, metadata.titolo) };
}
