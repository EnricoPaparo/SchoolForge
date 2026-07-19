import { stringify as yamlStringify } from 'yaml';
import { DEFAULT_MAX_CHARACTERS } from './maxCharacters.js';
import type { ParsedPool, PoolQuestion } from './types.js';

/**
 * Serializes a parsed pool to the canonical `.pool.md` V2 format.
 *
 * `maxPoints` is derived from `difficolta` and is never written. The effective
 * default for `maxCharacters` is omitted, while a custom open-answer limit is
 * preserved. Output is deterministic and parseable by `parsePool`.
 */
export function serializePool(pool: ParsedPool): string {
  const payload: unknown = {
    schema: pool.schema,
    questions: pool.questions.map(serializeQuestion),
  };

  const yaml = yamlStringify(payload, { directives: false });
  return `---\n${yaml}---\n`;
}

function serializeQuestion(q: PoolQuestion): Record<string, unknown> {
  const base = {
    id: q.id,
    tipo: q.tipo,
    difficolta: q.difficolta,
    testo: q.testo,
  };

  if (q.tipo === 'aperta') {
    return q.maxCharacters === DEFAULT_MAX_CHARACTERS
      ? { ...base, soluzione: q.soluzione }
      : { ...base, soluzione: q.soluzione, maxCharacters: q.maxCharacters };
  }

  return {
    ...base,
    opzioni: q.opzioni.map((option) => ({ id: option.id, testo: option.testo })),
    soluzione: q.soluzione,
  };
}
