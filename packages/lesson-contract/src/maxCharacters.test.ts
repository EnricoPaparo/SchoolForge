import { describe, expect, it } from 'vitest';
import { parsePool } from './parser.js';
import { serializePool } from './serializer.js';
import {
  DEFAULT_MAX_CHARACTERS,
  effectiveMaxCharacters,
  normalizeMaxCharacters,
} from './maxCharacters.js';
import type { PoolQuestionAperta } from './types.js';

const apertaSrc = (extra = '') => `---
schema: schoolforge-pool/v1
questions:
  - id: q-open
    tipo: aperta
    difficolta: 2
    peso: 3
    testo: Spiega la differenza tra HTTP e HTTPS.
    soluzione: HTTPS cifra il canale con TLS.${extra}
---`;

function parseFirstAperta(src: string) {
  const r = parsePool(src, 'test.pool.md');
  if (!r.ok) throw new Error(`parse failed: ${JSON.stringify(r.errors)}`);
  return r.pool.questions[0] as PoolQuestionAperta;
}

describe('normalizeMaxCharacters / effectiveMaxCharacters', () => {
  it('accepts an integer within [1, 10000]', () => {
    expect(normalizeMaxCharacters(500)).toBe(500);
    expect(normalizeMaxCharacters('734')).toBe(734);
    expect(normalizeMaxCharacters(1)).toBe(1);
    expect(normalizeMaxCharacters(10000)).toBe(10000);
  });
  it('rejects 0, negatives, decimals and > 10000 → undefined', () => {
    for (const v of [0, -1, -500, 3.5, '2.5', 10001, 99999, 'abc', '', null, undefined, NaN]) {
      expect(normalizeMaxCharacters(v)).toBeUndefined();
    }
  });
  it('effectiveMaxCharacters falls back to the 2000 default when invalid/absent', () => {
    expect(effectiveMaxCharacters(undefined)).toBe(DEFAULT_MAX_CHARACTERS);
    expect(effectiveMaxCharacters(0)).toBe(2000);
    expect(effectiveMaxCharacters(10001)).toBe(2000);
    expect(effectiveMaxCharacters(1500)).toBe(1500);
  });
});

describe('pool parse/serialize with maxCharacters (EXAM-UX-03)', () => {
  it('parses a valid custom maxCharacters on an aperta question', () => {
    const q = parseFirstAperta(apertaSrc('\n    maxCharacters: 500'));
    expect(q.maxCharacters).toBe(500);
  });

  it('legacy aperta without maxCharacters parses fine (field absent)', () => {
    const q = parseFirstAperta(apertaSrc());
    expect(q.maxCharacters).toBeUndefined();
  });

  it('round-trips a custom maxCharacters through serialize → parse', () => {
    const first = parseFirstAperta(apertaSrc('\n    maxCharacters: 1234'));
    const r = parsePool(serializePool({ schema: 'schoolforge-pool/v1', questions: [first] }), 'x');
    if (!r.ok) throw new Error('reparse failed');
    expect((r.pool.questions[0] as PoolQuestionAperta).maxCharacters).toBe(1234);
  });

  it('does not emit maxCharacters when absent (legacy stays clean)', () => {
    const first = parseFirstAperta(apertaSrc());
    const serialized = serializePool({ schema: 'schoolforge-pool/v1', questions: [first] });
    expect(serialized).not.toContain('maxCharacters');
  });

  it.each([
    ['zero', 0],
    ['negative', -5],
    ['decimal', 2.5],
    ['too large', 10001],
  ])('rejects an invalid maxCharacters (%s)', (_name, value) => {
    const r = parsePool(apertaSrc(`\n    maxCharacters: ${value}`), 'test.pool.md');
    expect(r.ok).toBe(false);
  });
});
