import { describe, expect, it } from 'vitest';
import { parsePool } from './parser.js';

function yaml(strings: TemplateStringsArray): string {
  return strings.raw[0];
}

const VALID_POOL = yaml`
schema: schoolforge-pool/v1
domande:
  - id: q-open-1
    tipo: aperta
    difficolta: 2
    peso: 3
    testo: Descrivi il ciclo dell'acqua.
    soluzione: Evaporazione, condensazione, precipitazione.
  - id: q-single-1
    tipo: chiusa_singola
    difficolta: 1
    peso: 1
    testo: Qual è la capitale d'Italia?
    opzioni:
      - id: a
        testo: Roma
      - id: b
        testo: Milano
    soluzione: [a]
  - id: q-multi-1
    tipo: chiusa_multipla
    difficolta: 3
    peso: 2
    testo: Quali sono pianeti del sistema solare?
    opzioni:
      - id: a
        testo: Marte
      - id: b
        testo: Plutone
      - id: c
        testo: Giove
    soluzione: [a, c]
`;

describe('parsePool — valid pool', () => {
  it('parses a valid pool and computes maxPoints', () => {
    const result = parsePool(VALID_POOL, 'valid.pool.md');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pool.schema).toBe('schoolforge-pool/v1');
    expect(result.pool.domande).toHaveLength(3);
    const open = result.pool.domande[0];
    expect(open.maxPoints).toBe(2 * 3); // difficolta × peso
    const single = result.pool.domande[1];
    expect(single.maxPoints).toBe(1 * 1);
    const multi = result.pool.domande[2];
    expect(multi.maxPoints).toBe(3 * 2);
  });
});

describe('parsePool — duplicate question id', () => {
  it('returns error when two questions share the same id', () => {
    const pool = yaml`
schema: schoolforge-pool/v1
domande:
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
`;
    const result = parsePool(pool, 'dup.pool.md');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const dup = result.errors.find((e) => e.message.includes('Duplicate'));
    expect(dup).toBeDefined();
    expect(dup!.questionId).toBe('dup-id');
    expect(dup!.fileName).toBe('dup.pool.md');
  });
});

describe('parsePool — invalid tipo', () => {
  it('returns error when tipo is not a valid value', () => {
    const pool = yaml`
schema: schoolforge-pool/v1
domande:
  - id: q1
    tipo: vero_falso
    difficolta: 1
    peso: 1
    testo: Una domanda.
    soluzione: vero
`;
    const result = parsePool(pool);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const err = result.errors.find((e) => e.field.includes('tipo') || e.field.includes('domande'));
    expect(err).toBeDefined();
  });
});

describe('parsePool — difficolta/peso out of range', () => {
  it('returns error when difficolta is 0', () => {
    const pool = yaml`
schema: schoolforge-pool/v1
domande:
  - id: q1
    tipo: aperta
    difficolta: 0
    peso: 1
    testo: Una domanda.
    soluzione: Risposta.
`;
    const result = parsePool(pool);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const err = result.errors.find((e) => e.field.includes('difficolta'));
    expect(err).toBeDefined();
  });

  it('returns error when peso is 4', () => {
    const pool = yaml`
schema: schoolforge-pool/v1
domande:
  - id: q1
    tipo: aperta
    difficolta: 1
    peso: 4
    testo: Una domanda.
    soluzione: Risposta.
`;
    const result = parsePool(pool);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const err = result.errors.find((e) => e.field.includes('peso'));
    expect(err).toBeDefined();
  });
});

describe('parsePool — missing/incoherent opzioni for closed questions', () => {
  it('returns error when chiusa_singola has fewer than 2 opzioni', () => {
    const pool = yaml`
schema: schoolforge-pool/v1
domande:
  - id: q1
    tipo: chiusa_singola
    difficolta: 1
    peso: 1
    testo: Una domanda.
    opzioni:
      - id: a
        testo: Sola opzione
    soluzione: [a]
`;
    const result = parsePool(pool);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const err = result.errors.find((e) => e.field.includes('opzioni'));
    expect(err).toBeDefined();
  });

  it('returns error when chiusa_multipla has no opzioni field', () => {
    const pool = yaml`
schema: schoolforge-pool/v1
domande:
  - id: q1
    tipo: chiusa_multipla
    difficolta: 1
    peso: 1
    testo: Una domanda.
    soluzione: [a]
`;
    const result = parsePool(pool);
    expect(result.ok).toBe(false);
  });
});

describe('parsePool — missing/incoherent soluzione', () => {
  it('returns error when chiusa_singola soluzione references unknown option', () => {
    const pool = yaml`
schema: schoolforge-pool/v1
domande:
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
`;
    const result = parsePool(pool);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const err = result.errors.find((e) => e.message.includes('unknown option'));
    expect(err).toBeDefined();
    expect(err!.questionId).toBe('q1');
  });

  it('returns error when chiusa_multipla soluzione covers all options', () => {
    const pool = yaml`
schema: schoolforge-pool/v1
domande:
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
`;
    const result = parsePool(pool);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const err = result.errors.find((e) => e.message.includes('fewer'));
    expect(err).toBeDefined();
  });

  it('returns error when aperta soluzione is empty', () => {
    const pool = yaml`
schema: schoolforge-pool/v1
domande:
  - id: q1
    tipo: aperta
    difficolta: 1
    peso: 1
    testo: Una domanda.
    soluzione: ""
`;
    const result = parsePool(pool);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const err = result.errors.find((e) => e.field.includes('soluzione'));
    expect(err).toBeDefined();
  });
});

describe('parsePool — missing required fields', () => {
  it('returns error when testo is missing', () => {
    const pool = yaml`
schema: schoolforge-pool/v1
domande:
  - id: q1
    tipo: aperta
    difficolta: 1
    peso: 1
    soluzione: Risposta.
`;
    const result = parsePool(pool);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const err = result.errors.find((e) => e.field.includes('testo'));
    expect(err).toBeDefined();
  });

  it('returns error when schema field is missing', () => {
    const pool = yaml`
domande:
  - id: q1
    tipo: aperta
    difficolta: 1
    peso: 1
    testo: Una domanda.
    soluzione: Risposta.
`;
    const result = parsePool(pool);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const err = result.errors.find((e) => e.field.includes('schema'));
    expect(err).toBeDefined();
  });
});
