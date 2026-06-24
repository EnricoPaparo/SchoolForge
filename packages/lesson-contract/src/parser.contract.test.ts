import { describe, expect, it } from 'vitest';
import { parsePool } from './parser.js';

// Fixture from test-strategy.md §5b
const VALID_POOL = `---
schema: schoolforge-pool/v1
questions:
  - id: q-001
    tipo: chiusa_singola
    difficolta: 1
    peso: 1
    testo: Quale protocollo risolve i nomi di dominio?
    opzioni:
      - id: a
        testo: DNS
      - id: b
        testo: DHCP
    soluzione: [a]
  - id: q-002
    tipo: aperta
    difficolta: 2
    peso: 2
    testo: |
      Spiega la differenza tra HTTP e HTTPS.
    soluzione: |
      HTTPS aggiunge un canale cifrato con autenticazione del server.
  - id: q-003
    tipo: chiusa_multipla
    difficolta: 3
    peso: 3
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

// Fixture from test-strategy.md §5b — missing required fields
const INVALID_MISSING_FIELDS = `---
schema: schoolforge-pool/v1
questions:
  - id: q-001
    tipo: aperta
    testo: Domanda senza difficoltà né peso.
---`;

describe('parsePool — valid pool', () => {
  it('parses the canonical fixture and computes maxPoints', () => {
    const result = parsePool(VALID_POOL, 'valid.pool.md');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pool.schema).toBe('schoolforge-pool/v1');
    expect(result.pool.questions).toHaveLength(3);
    expect(result.pool.questions[0].maxPoints).toBe(1 * 1);
    expect(result.pool.questions[1].maxPoints).toBe(2 * 2);
    expect(result.pool.questions[2].maxPoints).toBe(3 * 3);
  });
});

describe('parsePool — duplicate question id', () => {
  it('returns error with field questions[index].id and fileName', () => {
    const pool = `---
schema: schoolforge-pool/v1
questions:
  - id: dup-id
    tipo: aperta
    difficolta: 1
    peso: 1
    testo: Prima domanda.
    soluzione: Risposta.
  - id: dup-id
    tipo: aperta
    difficolta: 1
    peso: 1
    testo: Seconda domanda.
    soluzione: Risposta.
---`;
    const result = parsePool(pool, 'dup.pool.md');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const err = result.errors.find((e) => e.message.includes('Duplicate'));
    expect(err).toBeDefined();
    expect(err!.questionId).toBe('dup-id');
    expect(err!.field).toBe('questions[1].id');
    expect(err!.fileName).toBe('dup.pool.md');
  });
});

describe('parsePool — invalid tipo', () => {
  it('returns error when tipo is not a known value', () => {
    const pool = `---
schema: schoolforge-pool/v1
questions:
  - id: q1
    tipo: vero_falso
    difficolta: 1
    peso: 1
    testo: Una domanda.
    soluzione: vero
---`;
    const result = parsePool(pool);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.length).toBeGreaterThan(0);
  });
});

describe('parsePool — difficolta/peso out of range', () => {
  it('returns error when difficolta is 0', () => {
    const pool = `---
schema: schoolforge-pool/v1
questions:
  - id: q1
    tipo: aperta
    difficolta: 0
    peso: 1
    testo: Una domanda.
    soluzione: Risposta.
---`;
    const result = parsePool(pool);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const err = result.errors.find((e) => e.field.includes('difficolta'));
    expect(err).toBeDefined();
  });

  it('returns error when peso is 4', () => {
    const pool = `---
schema: schoolforge-pool/v1
questions:
  - id: q1
    tipo: aperta
    difficolta: 1
    peso: 4
    testo: Una domanda.
    soluzione: Risposta.
---`;
    const result = parsePool(pool);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const err = result.errors.find((e) => e.field.includes('peso'));
    expect(err).toBeDefined();
  });
});

describe('parsePool — missing/incoherent opzioni for closed questions', () => {
  it('returns error when chiusa_singola has fewer than 2 opzioni', () => {
    const pool = `---
schema: schoolforge-pool/v1
questions:
  - id: q1
    tipo: chiusa_singola
    difficolta: 1
    peso: 1
    testo: Una domanda.
    opzioni:
      - id: a
        testo: Sola opzione
    soluzione: [a]
---`;
    const result = parsePool(pool);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const err = result.errors.find((e) => e.field.includes('opzioni'));
    expect(err).toBeDefined();
  });

  it('returns error when chiusa_multipla has no opzioni field', () => {
    const pool = `---
schema: schoolforge-pool/v1
questions:
  - id: q1
    tipo: chiusa_multipla
    difficolta: 1
    peso: 1
    testo: Una domanda.
    soluzione: [a]
---`;
    const result = parsePool(pool);
    expect(result.ok).toBe(false);
  });

  it('returns error when opzioni has duplicate ids', () => {
    const pool = `---
schema: schoolforge-pool/v1
questions:
  - id: q1
    tipo: chiusa_singola
    difficolta: 1
    peso: 1
    testo: Una domanda.
    opzioni:
      - id: a
        testo: Opzione A
      - id: a
        testo: Opzione A bis
    soluzione: [a]
---`;
    const result = parsePool(pool);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const err = result.errors.find((e) => e.message.includes('unique'));
    expect(err).toBeDefined();
  });
});

describe('parsePool — missing/incoherent soluzione', () => {
  it('returns error when chiusa_singola soluzione references unknown option', () => {
    const pool = `---
schema: schoolforge-pool/v1
questions:
  - id: q1
    tipo: chiusa_singola
    difficolta: 1
    peso: 1
    testo: Una domanda.
    opzioni:
      - id: a
        testo: Opzione A
      - id: b
        testo: Opzione B
    soluzione: [z]
---`;
    const result = parsePool(pool);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const err = result.errors.find((e) => e.message.includes('unknown option'));
    expect(err).toBeDefined();
    expect(err!.questionId).toBe('q1');
    expect(err!.field).toBe('questions[0].soluzione');
  });

  it('returns error when chiusa_multipla soluzione covers all options', () => {
    const pool = `---
schema: schoolforge-pool/v1
questions:
  - id: q1
    tipo: chiusa_multipla
    difficolta: 1
    peso: 1
    testo: Una domanda.
    opzioni:
      - id: a
        testo: Opzione A
      - id: b
        testo: Opzione B
    soluzione: [a, b]
---`;
    const result = parsePool(pool);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const err = result.errors.find((e) => e.message.includes('fewer'));
    expect(err).toBeDefined();
  });

  it('returns error when aperta soluzione is empty', () => {
    const pool = `---
schema: schoolforge-pool/v1
questions:
  - id: q1
    tipo: aperta
    difficolta: 1
    peso: 1
    testo: Una domanda.
    soluzione: ""
---`;
    const result = parsePool(pool);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const err = result.errors.find((e) => e.field.includes('soluzione'));
    expect(err).toBeDefined();
  });
});

describe('parsePool — missing required fields (fixture test-strategy.md)', () => {
  it('rejects pool with missing difficolta, peso, soluzione for q-001', () => {
    const result = parsePool(INVALID_MISSING_FIELDS);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const fields = result.errors.map((e) => e.field);
    expect(fields.some((f) => f.includes('difficolta'))).toBe(true);
    expect(fields.some((f) => f.includes('peso'))).toBe(true);
    expect(fields.some((f) => f.includes('soluzione'))).toBe(true);
    expect(result.errors.every((e) => e.questionId === 'q-001')).toBe(true);
  });

  it('returns error when schema field is missing', () => {
    const pool = `---
questions:
  - id: q1
    tipo: aperta
    difficolta: 1
    peso: 1
    testo: Una domanda.
    soluzione: Risposta.
---`;
    const result = parsePool(pool);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const err = result.errors.find((e) => e.field.includes('schema'));
    expect(err).toBeDefined();
  });
});
