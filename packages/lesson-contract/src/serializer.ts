import { stringify as yamlStringify } from 'yaml';
import type { ParsedPool, PoolQuestion } from './types.js';

/**
 * Serializes a parsed pool back to the `.pool.md` Markdown format with YAML
 * front matter. The output is guaranteed to be parseable by `parsePool`.
 *
 * Rules:
 * - `maxPoints` is derived (difficolta × peso) and is never written to YAML.
 * - Field order per question is canonical: id, tipo, difficolta, peso, testo,
 *   then type-specific fields (soluzione for aperta; opzioni + soluzione for chiuse).
 * - Output is deterministic for the same input.
 * - No Firebase dependency; no filesystem access.
 */
export function serializePool(pool: ParsedPool): string {
  const payload: unknown = {
    schema: pool.schema,
    questions: pool.questions.map(serializeQuestion),
  };

  const yaml = yamlStringify(payload, {
    // Prevent yaml from emitting a leading `---` itself; we wrap manually.
    directives: false,
  });

  return `---\n${yaml}---\n`;
}

function serializeQuestion(q: PoolQuestion): Record<string, unknown> {
  // Base fields in canonical order (maxPoints intentionally omitted).
  const base = {
    id: q.id,
    tipo: q.tipo,
    difficolta: q.difficolta,
    peso: q.peso,
    testo: q.testo,
  };

  if (q.tipo === 'aperta') {
    // maxCharacters is written only when explicitly set (keeps legacy pools and
    // default-limit questions byte-identical on round-trip).
    return q.maxCharacters === undefined
      ? { ...base, soluzione: q.soluzione }
      : { ...base, soluzione: q.soluzione, maxCharacters: q.maxCharacters };
  }

  // chiusa_singola and chiusa_multipla
  return {
    ...base,
    opzioni: q.opzioni.map((o) => ({ id: o.id, testo: o.testo })),
    soluzione: q.soluzione,
  };
}
