import { describe, expect, it } from 'vitest';
import { parsePool } from '@schoolforge/lesson-contract';
import type { PoolQuestion } from '@schoolforge/lesson-contract';
import {
  buildPoolFromProposal,
  maxCharactersForDifficulty,
  optionIdFromIndex,
  proposalToLocalQuestions,
  type LocalProposalQuestion,
} from '../aiPoolMapper.js';
import type { AiPoolProposalOutput } from '../aiContentClient.js';

const PROPOSAL: AiPoolProposalOutput = {
  questions: [
    { order: 0, tipo: 'aperta', testo: 'Spiega TCP', difficolta: 3, soluzione: 'Affidabile.' },
    {
      order: 1,
      tipo: 'chiusa_singola',
      testo: 'Quale è affidabile?',
      difficolta: 2,
      opzioni: ['TCP', 'UDP'],
      soluzioneIndici: [0],
    },
    {
      order: 2,
      tipo: 'chiusa_multipla',
      testo: 'Quali sono protocolli?',
      difficolta: 4,
      opzioni: ['TCP', 'UDP', 'RAM'],
      soluzioneIndici: [0, 1],
    },
  ],
};

function locals(): LocalProposalQuestion[] {
  return proposalToLocalQuestions(PROPOSAL);
}

describe('proposalToLocalQuestions', () => {
  it('derives maxCharacters from difficulty for open questions (difficolta 3 → 1200)', () => {
    const l = locals();
    expect(l[0].tipo).toBe('aperta');
    expect(l[0].difficolta).toBe(3);
    expect(l[0].maxCharacters).toBe(1200);
    expect(l[1].opzioni).toEqual(['TCP', 'UDP']);
    expect(l[2].soluzioneIndici).toEqual([0, 1]);
  });
});

describe('maxCharactersForDifficulty (deterministic, fail-closed)', () => {
  it('maps 1→500, 2→800, 3→1200, 4→1800, 5→2500', () => {
    expect([1, 2, 3, 4, 5].map(maxCharactersForDifficulty)).toEqual([500, 800, 1200, 1800, 2500]);
  });
  it('throws fail-closed for out-of-range or non-integer difficulty', () => {
    expect(() => maxCharactersForDifficulty(0)).toThrow(RangeError);
    expect(() => maxCharactersForDifficulty(6)).toThrow(RangeError);
    expect(() => maxCharactersForDifficulty(2.5)).toThrow(RangeError);
  });
});

describe('optionIdFromIndex', () => {
  it('follows the canonical a/b/c convention', () => {
    expect([0, 1, 2].map(optionIdFromIndex)).toEqual(['a', 'b', 'c']);
  });
});

describe('buildPoolFromProposal — new pool', () => {
  it('builds a valid schoolforge-pool/v2, parsePool passes, derived maxPoints, no peso', () => {
    const res = buildPoolFromProposal(null, locals());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.addedCount).toBe(3);
    expect(res.pool.schema).toBe('schoolforge-pool/v2');
    for (const q of res.pool.questions) {
      expect(q.id).toMatch(/^[a-z0-9-]+$/);
      expect(q.maxPoints).toBe(q.difficolta); // maxPoints === difficolta
      expect('peso' in q).toBe(false);
    }
    const aperta = res.pool.questions.find((q) => q.tipo === 'aperta');
    // difficolta 3 → derived maxCharacters 1200 (the teacher can still edit it).
    expect(aperta && 'maxCharacters' in aperta ? aperta.maxCharacters : null).toBe(1200);
    // Deterministic ids for a fresh pool.
    expect(res.pool.questions.map((q) => q.id)).toEqual(['ia-1', 'ia-2', 'ia-3']);
    // Option ids distinct + solutions coherent.
    const singola = res.pool.questions.find((q) => q.tipo === 'chiusa_singola');
    expect(singola?.tipo === 'chiusa_singola' && singola.soluzione).toEqual(['a']);
  });

  it('is deterministic and idempotent across calls', () => {
    const a = buildPoolFromProposal(null, locals());
    const b = buildPoolFromProposal(null, locals());
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(a.pool.questions.map((q) => q.id)).toEqual(b.pool.questions.map((q) => q.id));
    }
  });
});

describe('buildPoolFromProposal — existing pool', () => {
  const existingPool = parsePool(
    [
      '---',
      'schema: schoolforge-pool/v2',
      'questions:',
      '  - id: ia-1',
      '    tipo: aperta',
      '    difficolta: 2',
      '    testo: Domanda esistente',
      '    soluzione: Risposta',
      '---',
    ].join('\n'),
  );

  it('appends without colliding with existing ids and preserves existing questions', () => {
    if (!existingPool.ok) throw new Error('fixture');
    const existing: PoolQuestion[] = existingPool.pool.questions;
    const res = buildPoolFromProposal(existing, locals());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const ids = res.pool.questions.map((q) => q.id);
    // Existing ia-1 preserved first and untouched; new ids skip it.
    expect(ids[0]).toBe('ia-1');
    expect(res.pool.questions[0]).toEqual(existing[0]);
    expect(ids.slice(1)).toEqual(['ia-2', 'ia-3', 'ia-4']);
    expect(new Set(ids).size).toBe(ids.length); // no collisions
    expect(res.addedCount).toBe(3);
  });

  it('does not mutate the existing pool array', () => {
    if (!existingPool.ok) throw new Error('fixture');
    const existing = existingPool.pool.questions;
    const before = existing.length;
    buildPoolFromProposal(existing, locals());
    expect(existing.length).toBe(before);
  });
});

describe('buildPoolFromProposal — malformed local proposals', () => {
  it('rejects empty text / bad difficulty / empty solution', () => {
    const bad = locals();
    bad[0] = { ...bad[0], testo: '  ', difficolta: 9, soluzione: '' };
    const res = buildPoolFromProposal(null, bad);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.length).toBeGreaterThan(0);
  });
  it('rejects duplicate options and a single-answer with 2 solutions', () => {
    const bad = locals();
    bad[1] = { ...bad[1], opzioni: ['TCP', 'TCP'], soluzioneIndici: [0, 1] };
    const res = buildPoolFromProposal(null, bad);
    expect(res.ok).toBe(false);
  });
  it('rejects chiusa_multipla with all options correct', () => {
    const bad = locals();
    bad[2] = { ...bad[2], soluzioneIndici: [0, 1, 2] };
    const res = buildPoolFromProposal(null, bad);
    expect(res.ok).toBe(false);
  });
  it('rejects an empty proposal', () => {
    expect(buildPoolFromProposal(null, []).ok).toBe(false);
  });
});
