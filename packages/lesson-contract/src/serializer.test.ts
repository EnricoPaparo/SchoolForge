import { describe, expect, it } from 'vitest';
import { parsePool } from './parser.js';
import { serializePool } from './serializer.js';
import type { ParsedPool } from './types.js';

const source = `---
schema: schoolforge-pool/v2
questions:
  - id: q-open
    tipo: aperta
    difficolta: 4
    testo: Spiega il modello client-server.
    soluzione: Il client invia richieste e il server risponde.
  - id: q-single
    tipo: chiusa_singola
    difficolta: 2
    testo: Quale protocollo risolve i nomi di dominio?
    opzioni:
      - id: a
        testo: DNS
      - id: b
        testo: DHCP
    soluzione: [a]
  - id: q-multi
    tipo: chiusa_multipla
    difficolta: 5
    testo: Quali protocolli sono applicativi?
    opzioni:
      - id: a
        testo: HTTP
      - id: b
        testo: FTP
      - id: c
        testo: IP
    soluzione: [a, b]
---`;

function parse(sourceText: string): ParsedPool {
  const result = parsePool(sourceText);
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.pool;
}

describe('serializePool V2', () => {
  it('round-trips all question types deterministically', () => {
    const pool = parse(source);
    const first = serializePool(pool);
    const second = serializePool(pool);
    expect(first).toBe(second);
    expect(parse(first)).toEqual(pool);
  });

  it('writes V2 and never writes derived or removed fields', () => {
    const serialized = serializePool(parse(source));
    expect(serialized).toContain('schema: schoolforge-pool/v2');
    expect(serialized).not.toContain('peso:');
    expect(serialized).not.toContain('maxPoints:');
  });

  it('omits the effective maxCharacters default', () => {
    const serialized = serializePool(parse(source));
    expect(serialized).not.toContain('maxCharacters:');
    expect(parse(serialized).questions[0]).toMatchObject({ maxCharacters: 2000 });
  });

  it('preserves a custom maxCharacters value', () => {
    const custom = source.replace(
      '    soluzione: Il client invia richieste e il server risponde.',
      '    soluzione: Il client invia richieste e il server risponde.\n    maxCharacters: 1200',
    );
    const serialized = serializePool(parse(custom));
    expect(serialized).toContain('maxCharacters: 1200');
    expect(parse(serialized).questions[0]).toMatchObject({ maxCharacters: 1200 });
  });

  it('serializes a programmatically constructed canonical pool', () => {
    const pool: ParsedPool = {
      schema: 'schoolforge-pool/v2',
      questions: [
        {
          id: 'q-programmatic',
          tipo: 'aperta',
          difficolta: 3,
          maxPoints: 3,
          maxCharacters: 2000,
          testo: 'Spiega il DNS.',
          soluzione: 'Il DNS associa nomi di dominio e indirizzi IP.',
        },
      ],
    };
    expect(parse(serializePool(pool))).toEqual(pool);
  });
});
