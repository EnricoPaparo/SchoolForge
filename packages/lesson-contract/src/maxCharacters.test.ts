import { describe, expect, it } from 'vitest';
import { parsePool } from './parser.js';
import { serializePool } from './serializer.js';
import {
  DEFAULT_MAX_CHARACTERS,
  effectiveMaxCharacters,
  normalizeMaxCharacters,
} from './maxCharacters.js';

function openSource(maxCharacters?: number): string {
  const limit = maxCharacters === undefined ? '' : `\n    maxCharacters: ${maxCharacters}`;
  return `---
schema: schoolforge-pool/v2
questions:
  - id: q-open
    tipo: aperta
    difficolta: 2
    testo: Spiega la differenza tra HTTP e HTTPS.
    soluzione: HTTPS cifra il canale con TLS.${limit}
---`;
}

describe('maxCharacters', () => {
  it('normalizes only integers in the supported range', () => {
    expect(normalizeMaxCharacters(1)).toBe(1);
    expect(normalizeMaxCharacters('734')).toBe(734);
    expect(normalizeMaxCharacters(10000)).toBe(10000);
    for (const value of [0, -1, 2.5, '2.5', 10001, 'abc', '', null, undefined, NaN]) {
      expect(normalizeMaxCharacters(value)).toBeUndefined();
    }
  });

  it('uses 2000 as the effective runtime default', () => {
    expect(effectiveMaxCharacters(undefined)).toBe(DEFAULT_MAX_CHARACTERS);
    expect(effectiveMaxCharacters(1500)).toBe(1500);
  });

  it('parses an omitted limit as effective 2000 and omits it when serialized', () => {
    const result = parsePool(openSource());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pool.questions[0]).toMatchObject({ maxCharacters: 2000 });
    expect(serializePool(result.pool)).not.toContain('maxCharacters:');
  });

  it('round-trips a custom limit', () => {
    const result = parsePool(openSource(1234));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const reparsed = parsePool(serializePool(result.pool));
    expect(reparsed.ok).toBe(true);
    if (!reparsed.ok) return;
    expect(reparsed.pool.questions[0]).toMatchObject({ maxCharacters: 1234 });
  });

  it.each([0, -5, 2.5, 10001])('rejects invalid Markdown value %s', (value) => {
    expect(parsePool(openSource(value)).ok).toBe(false);
  });
});
