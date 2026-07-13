import { parse as parseYaml } from 'yaml';
import type { ProgrammaMeta } from '../../../types/firestore.js';
import { extractDescription, splitFrontMatter } from './frontMatter.js';

export const EMPTY_PROGRAM_METADATA: ProgrammaMeta = {
  annoScolastico: null,
  docente: null,
  materia: null,
  classe: null,
  descrizione: null,
};

function toStringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * Parses the optional root `programma.md`. DUX-07B formalizes `descrizione`
 * as editable front matter; legacy files keep using the first descriptive
 * body line when that key is absent.
 */
export function parseProgramMetadata(content: string): ProgrammaMeta {
  const { frontMatterRaw, body } = splitFrontMatter(content);
  let fields: Record<string, unknown> = {};
  if (frontMatterRaw) {
    try {
      fields = (parseYaml(frontMatterRaw) as Record<string, unknown>) ?? {};
    } catch {
      fields = {};
    }
  }

  return {
    annoScolastico: toStringOrNull(fields.anno_scolastico),
    docente: toStringOrNull(fields.docente),
    materia: toStringOrNull(fields.materia),
    classe: toStringOrNull(fields.classe),
    descrizione: toStringOrNull(fields.descrizione) ?? extractDescription(body),
  };
}
