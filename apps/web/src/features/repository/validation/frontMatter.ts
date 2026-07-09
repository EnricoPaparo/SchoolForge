import { stringify as stringifyYaml } from 'yaml';

const FRONT_MATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---/;

export type EditableFrontMatterValue = string | string[] | null | undefined;
export type EditableFrontMatter = Record<string, EditableFrontMatterValue>;

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

function compactFrontMatter(fields: EditableFrontMatter): Record<string, string | string[]> {
  const result: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed) result[key] = trimmed;
      continue;
    }
    if (Array.isArray(value)) {
      const compacted = value
        .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        .map((item) => item.trim());
      if (compacted.length > 0) result[key] = compacted;
    }
  }
  return result;
}

/** Serializes editable front matter, omitting null/empty fields. */
export function serializeFrontMatter(fields: EditableFrontMatter): string {
  const compacted = compactFrontMatter(fields);
  if (Object.keys(compacted).length === 0) return '';
  return stringifyYaml(compacted).trimEnd();
}

/**
 * Rebuilds a Markdown document from editable front matter and body.
 * Empty/null fields are omitted. If every field is empty, the output is just
 * the trimmed body, with no empty YAML block.
 */
export function composeMarkdownWithFrontMatter(fields: EditableFrontMatter, body: string): string {
  const serialized = serializeFrontMatter(fields);
  const cleanBody = body.trim();
  if (!serialized) return cleanBody;
  return `---\n${serialized}\n---\n\n${cleanBody}`.trimEnd();
}

/**
 * Replaces any existing front matter block with `fields`, preserving the
 * current body. Used by the Repository Editor so UI code does not manipulate
 * raw YAML delimiters directly.
 */
export function replaceFrontMatter(content: string, fields: EditableFrontMatter): string {
  return composeMarkdownWithFrontMatter(fields, splitFrontMatter(content).body);
}
