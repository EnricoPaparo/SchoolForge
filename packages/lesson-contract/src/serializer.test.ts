import { describe, expect, it } from 'vitest';
import { parsePool } from './parser.js';
import { serializePool } from './serializer.js';
import type { ParsedPool } from './types.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Round-trip: parse → serialize → parse and assert second parse succeeds. */
function roundTrip(src: string): { first: ParsedPool; second: ParsedPool; serialized: string } {
  const r1 = parsePool(src, 'test.pool.md');
  if (!r1.ok) throw new Error(`First parse failed: ${JSON.stringify(r1.errors)}`);

  const serialized = serializePool(r1.pool);

  const r2 = parsePool(serialized, 'test.pool.md');
  if (!r2.ok) throw new Error(`Second parse failed: ${JSON.stringify(r2.errors)}`);

  return { first: r1.pool, second: r2.pool, serialized };
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const APERTA = `---
schema: schoolforge-pool/v1
questions:
  - id: q-open
    tipo: aperta
    difficolta: 2
    peso: 3
    testo: Spiega la differenza tra HTTP e HTTPS.
    soluzione: HTTPS cifra il canale con TLS.
---`;

const CHIUSA_SINGOLA = `---
schema: schoolforge-pool/v1
questions:
  - id: q-single
    tipo: chiusa_singola
    difficolta: 1
    peso: 1
    testo: Quale porta usa HTTP di default?
    opzioni:
      - id: a
        testo: "80"
      - id: b
        testo: "443"
    soluzione: [a]
---`;

const CHIUSA_MULTIPLA = `---
schema: schoolforge-pool/v1
questions:
  - id: q-multi
    tipo: chiusa_multipla
    difficolta: 3
    peso: 2
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

const MIXED = `---
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

// ── Round-trip tests ──────────────────────────────────────────────────────────

describe('serializePool — round-trip', () => {
  it('round-trips a single aperta question', () => {
    const { first, second } = roundTrip(APERTA);
    expect(second.questions).toHaveLength(1);
    expect(second.questions[0]).toMatchObject({
      id: first.questions[0].id,
      tipo: 'aperta',
      difficolta: first.questions[0].difficolta,
      peso: first.questions[0].peso,
      testo: first.questions[0].testo,
    });
    if (second.questions[0].tipo === 'aperta' && first.questions[0].tipo === 'aperta') {
      expect(second.questions[0].soluzione).toBe(first.questions[0].soluzione);
    }
  });

  it('round-trips a chiusa_singola question preserving opzioni ids', () => {
    const { first, second } = roundTrip(CHIUSA_SINGOLA);
    const q1 = first.questions[0];
    const q2 = second.questions[0];
    expect(q2.tipo).toBe('chiusa_singola');
    if (q1.tipo === 'chiusa_singola' && q2.tipo === 'chiusa_singola') {
      expect(q2.opzioni.map((o) => o.id)).toEqual(q1.opzioni.map((o) => o.id));
      expect(q2.soluzione).toEqual(q1.soluzione);
    }
  });

  it('round-trips a chiusa_multipla question preserving all opzioni and soluzione', () => {
    const { first, second } = roundTrip(CHIUSA_MULTIPLA);
    const q1 = first.questions[0];
    const q2 = second.questions[0];
    expect(q2.tipo).toBe('chiusa_multipla');
    if (q1.tipo === 'chiusa_multipla' && q2.tipo === 'chiusa_multipla') {
      expect(q2.opzioni).toEqual(q1.opzioni);
      expect(q2.soluzione).toEqual(q1.soluzione);
    }
  });

  it('round-trips a mixed pool of three questions', () => {
    const { first, second } = roundTrip(MIXED);
    expect(second.schema).toBe('schoolforge-pool/v1');
    expect(second.questions).toHaveLength(3);
    for (let i = 0; i < 3; i++) {
      expect(second.questions[i].id).toBe(first.questions[i].id);
      expect(second.questions[i].tipo).toBe(first.questions[i].tipo);
      expect(second.questions[i].difficolta).toBe(first.questions[i].difficolta);
      expect(second.questions[i].peso).toBe(first.questions[i].peso);
    }
  });

  it('round-trips multiline testo and soluzione (block scalar)', () => {
    const { second } = roundTrip(MIXED);
    const aperta = second.questions[1];
    expect(aperta.tipo).toBe('aperta');
    expect(aperta.testo).toContain('HTTP');
    expect(aperta.testo).toContain('HTTPS');
    if (aperta.tipo === 'aperta') {
      expect(aperta.soluzione).toContain('cifrat');
    }
  });
});

// ── Schema preservation ───────────────────────────────────────────────────────

describe('serializePool — schema', () => {
  it('always emits schema: schoolforge-pool/v1', () => {
    const { serialized } = roundTrip(APERTA);
    expect(serialized).toContain('schema: schoolforge-pool/v1');
  });

  it('wraps output in YAML front matter delimiters', () => {
    const { serialized } = roundTrip(APERTA);
    expect(serialized.startsWith('---\n')).toBe(true);
    expect(serialized.trimEnd().endsWith('---')).toBe(true);
  });
});

// ── maxPoints must NOT appear in YAML ────────────────────────────────────────

describe('serializePool — maxPoints exclusion', () => {
  it('does not write maxPoints to the YAML output for aperta', () => {
    const { serialized } = roundTrip(APERTA);
    expect(serialized).not.toContain('maxPoints');
  });

  it('does not write maxPoints to the YAML output for chiusa_singola', () => {
    const { serialized } = roundTrip(CHIUSA_SINGOLA);
    expect(serialized).not.toContain('maxPoints');
  });

  it('does not write maxPoints to the YAML output for chiusa_multipla', () => {
    const { serialized } = roundTrip(CHIUSA_MULTIPLA);
    expect(serialized).not.toContain('maxPoints');
  });

  it('recomputes maxPoints correctly after round-trip', () => {
    const { second } = roundTrip(APERTA);
    const q = second.questions[0];
    expect(q.maxPoints).toBe(q.difficolta * q.peso);
  });
});

// ── Determinism ───────────────────────────────────────────────────────────────

describe('serializePool — determinism', () => {
  it('produces identical output on repeated calls with the same input', () => {
    const r = parsePool(MIXED, 'test.pool.md');
    if (!r.ok) throw new Error('parse failed');
    const out1 = serializePool(r.pool);
    const out2 = serializePool(r.pool);
    expect(out1).toBe(out2);
  });
});

// ── Per-field preservation ────────────────────────────────────────────────────

describe('serializePool — field preservation', () => {
  it('preserves question id through round-trip', () => {
    const { first, second } = roundTrip(CHIUSA_SINGOLA);
    expect(second.questions[0].id).toBe(first.questions[0].id);
  });

  it('preserves opzioni testo through round-trip', () => {
    const { first, second } = roundTrip(CHIUSA_SINGOLA);
    const q1 = first.questions[0];
    const q2 = second.questions[0];
    if (q1.tipo === 'chiusa_singola' && q2.tipo === 'chiusa_singola') {
      expect(q2.opzioni.map((o) => o.testo)).toEqual(q1.opzioni.map((o) => o.testo));
    }
  });

  it('preserves chiusa_singola soluzione as single-element array', () => {
    const { second } = roundTrip(CHIUSA_SINGOLA);
    const q = second.questions[0];
    expect(q.tipo).toBe('chiusa_singola');
    if (q.tipo === 'chiusa_singola') {
      expect(Array.isArray(q.soluzione)).toBe(true);
      expect(q.soluzione).toHaveLength(1);
      expect(q.soluzione[0]).toBe('a');
    }
  });

  it('preserves chiusa_multipla soluzione as multi-element array', () => {
    const { second } = roundTrip(CHIUSA_MULTIPLA);
    const q = second.questions[0];
    expect(q.tipo).toBe('chiusa_multipla');
    if (q.tipo === 'chiusa_multipla') {
      expect(q.soluzione).toEqual(['a', 'b']);
    }
  });
});

// ── Programmatic pool construction ────────────────────────────────────────────

describe('serializePool — programmatic construction', () => {
  it('serializes a pool built programmatically without a prior parse', () => {
    const pool: ParsedPool = {
      schema: 'schoolforge-pool/v1',
      questions: [
        {
          id: 'q-prog-1',
          tipo: 'aperta',
          difficolta: 1,
          peso: 2,
          maxPoints: 2,
          testo: "Cos'è un indirizzo IP?",
          soluzione: 'Un identificatore numerico assegnato a ogni dispositivo su una rete.',
        },
        {
          id: 'q-prog-2',
          tipo: 'chiusa_singola',
          difficolta: 2,
          peso: 1,
          maxPoints: 2,
          testo: 'Quanti bit ha un indirizzo IPv4?',
          opzioni: [
            { id: 'a', testo: '32' },
            { id: 'b', testo: '64' },
            { id: 'c', testo: '128' },
          ],
          soluzione: ['a'],
        },
        {
          id: 'q-prog-3',
          tipo: 'chiusa_multipla',
          difficolta: 3,
          peso: 3,
          maxPoints: 9,
          testo: 'Quali dei seguenti sono protocolli di livello applicazione?',
          opzioni: [
            { id: 'a', testo: 'HTTP' },
            { id: 'b', testo: 'FTP' },
            { id: 'c', testo: 'IP' },
          ],
          soluzione: ['a', 'b'],
        },
      ],
    };

    const serialized = serializePool(pool);
    const reparsed = parsePool(serialized, 'prog.pool.md');
    expect(reparsed.ok).toBe(true);
    if (!reparsed.ok) return;

    expect(reparsed.pool.questions).toHaveLength(3);
    expect(reparsed.pool.questions[0].id).toBe('q-prog-1');
    expect(reparsed.pool.questions[1].id).toBe('q-prog-2');
    expect(reparsed.pool.questions[2].id).toBe('q-prog-3');
    expect(serialized).not.toContain('maxPoints');
  });
});
