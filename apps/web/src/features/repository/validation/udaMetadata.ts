import { parse as parseYaml } from 'yaml';
import type { UdaMetadata } from './types.js';
import { extractDescription, splitFrontMatter } from './frontMatter.js';

export const EMPTY_UDA_METADATA: UdaMetadata = {
  titolo: null,
  descrizione: null,
  competenze: [],
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
 * Splits a UDA Markdown file into its metadata and body. `descrizione` comes
 * from the front matter key when present (RE-01+); UDA files imported before
 * that key existed fall back to the body's first non-heading paragraph,
 * exactly like `validateUda` does at import time. Missing or malformed front
 * matter never throws: it just yields empty competenze/obiettivi.
 */
export function parseUdaMetadata(content: string): { metadata: UdaMetadata; body: string } {
  const { frontMatterRaw, body } = splitFrontMatter(content);

  let fm: Record<string, unknown> = {};
  if (frontMatterRaw) {
    try {
      fm = (parseYaml(frontMatterRaw) as Record<string, unknown>) ?? {};
    } catch {
      fm = {};
    }
  }

  const metadata: UdaMetadata = {
    titolo: toStringOrNull(fm.titolo),
    descrizione: toStringOrNull(fm.descrizione) ?? extractDescription(body),
    competenze: toStringArray(fm.competenze),
    obiettivi: toStringArray(fm.obiettivi),
  };

  return { metadata, body };
}
