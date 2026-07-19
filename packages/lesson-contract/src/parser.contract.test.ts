import { describe, expect, it } from 'vitest';
import { parsePool } from './parser.js';

const validPool = `---
schema: schoolforge-pool/v2
questions:
  - id: q-open
    tipo: aperta
    difficolta: 4
    testo: Spiega la differenza tra HTTP e HTTPS.
    soluzione: HTTPS protegge il canale con TLS.
  - id: q-single
    tipo: chiusa_singola
    difficolta: 1
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
    testo: Quali sono livelli del modello TCP/IP?
    opzioni:
      - id: a
        testo: Applicazione
      - id: b
        testo: Trasporto
      - id: c
        testo: Sessione
    soluzione: [a, b]
---`;

function openQuestion(overrides: string): string {
  return `---
schema: schoolforge-pool/v2
questions:
  - id: q-open
    tipo: aperta
    difficolta: 3
    testo: Spiega il modello client-server.
    soluzione: Il client invia richieste e il server risponde.
${overrides}
---`;
}

describe('parsePool V2', () => {
  it('parses every question type and derives maxPoints from difficolta', () => {
    const result = parsePool(validPool, 'valid.pool.md');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.pool.schema).toBe('schoolforge-pool/v2');
    expect(result.pool.questions.map((question) => question.maxPoints)).toEqual([4, 1, 5]);
    expect(result.pool.questions[0]).toMatchObject({ maxCharacters: 2000 });
  });

  it.each([1, 2, 3, 4, 5])('accepts integer difficolta %i', (difficolta) => {
    const source = openQuestion('').replace('difficolta: 3', `difficolta: ${difficolta}`);
    expect(parsePool(source).ok).toBe(true);
  });

  it.each([0, 6, 2.5])('rejects invalid difficolta %s', (difficolta) => {
    const source = openQuestion('').replace('difficolta: 3', `difficolta: ${difficolta}`);
    const result = parsePool(source);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((error) => error.field.includes('difficolta'))).toBe(true);
  });

  it('rejects missing difficolta and soluzione', () => {
    const result = parsePool(`---
schema: schoolforge-pool/v2
questions:
  - id: q-open
    tipo: aperta
    testo: Domanda incompleta.
---`);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((error) => error.field.includes('difficolta'))).toBe(true);
    expect(result.errors.some((error) => error.field.includes('soluzione'))).toBe(true);
  });

  it('rejects the legacy schema with a readable deterministic error', () => {
    const result = parsePool(validPool.replace('schoolforge-pool/v2', 'schoolforge-pool/v1'));
    expect(result).toEqual({
      ok: false,
      errors: [
        expect.objectContaining({
          field: 'schema',
          message: 'Schema pool non supportato: atteso schoolforge-pool/v2.',
        }),
      ],
    });
  });

  it.each([
    ['peso', '    peso: 2', 'peso'],
    ['maxPoints', '    maxPoints: 3', 'maxPoints'],
  ])('rejects forbidden field %s explicitly', (_name, line, field) => {
    const result = parsePool(openQuestion(line));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toContainEqual(
      expect.objectContaining({ field: `questions[0].${field}` }),
    );
  });

  it('rejects maxCharacters on closed questions', () => {
    const result = parsePool(
      validPool.replace(
        '    opzioni:\n      - id: a',
        '    maxCharacters: 500\n    opzioni:\n      - id: a',
      ),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        field: 'questions[1].maxCharacters',
        message: 'maxCharacters è ammesso soltanto per le domande aperte.',
      }),
    );
  });

  it('rejects duplicate question ids', () => {
    const result = parsePool(validPool.replace('id: q-single', 'id: q-open'));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toContainEqual(
      expect.objectContaining({ field: 'questions[1].id', questionId: 'q-open' }),
    );
  });

  it('rejects a closed solution that references an unknown option', () => {
    const result = parsePool(
      validPool.replace('soluzione: [a]\n  - id: q-multi', 'soluzione: [z]\n  - id: q-multi'),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((error) => error.message.includes('unknown option'))).toBe(true);
  });
});
