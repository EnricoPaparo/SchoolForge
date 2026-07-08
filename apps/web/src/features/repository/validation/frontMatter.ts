const FRONT_MATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---/;

export type FrontMatterSplit = {
  /** Raw YAML block content (between the --- markers), or null if absent. */
  frontMatterRaw: string | null;
  /** Everything after the front matter block, trimmed. */
  body: string;
};

/** Splits a Markdown file into its raw YAML front matter block (if any) and the body text. */
export function splitFrontMatter(content: string): FrontMatterSplit {
  const match = FRONT_MATTER_RE.exec(content);
  if (!match) return { frontMatterRaw: null, body: content.trim() };
  return { frontMatterRaw: match[1], body: content.slice(match.index + match[0].length).trim() };
}

/**
 * First non-empty, non-heading line of a Markdown body — used as a short,
 * teacher-facing description without needing a full Markdown renderer.
 */
export function extractDescription(body: string): string | null {
  const line = body
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0 && !l.startsWith('#'));
  return line ?? null;
}
