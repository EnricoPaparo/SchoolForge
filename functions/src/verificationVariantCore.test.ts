import { describe, expect, it } from 'vitest';
import {
  assignVariant,
  isValidAssignment,
  parseVexSnapshot,
  sanitizeAssignedQuestions,
  secureRandomIntBelow,
  validateVexSnapshot,
  VexAssignmentError,
  type RandomIntBelow,
  type VexSnapshot,
  type VexSnapshotQuestion,
} from './verificationVariantCore.js';

function q(order: number, over: Partial<VexSnapshotQuestion> = {}): VexSnapshotQuestion {
  return { order, tipo: 'aperta', maxPoints: 3, difficolta: 3, testo: `t${order}`, ...over };
}

/** common [0], g1 [1,2], g2 [3,4]. */
function snapshot(): VexSnapshot {
  return {
    distributionMode: 'equivalent_variants',
    questions: [q(0), q(1), q(2), q(3), q(4)],
    commonQuestionOrders: [0],
    equivalentGroups: [
      { id: 'g1', alternativeOrders: [1, 2] },
      { id: 'g2', alternativeOrders: [3, 4] },
    ],
  };
}

/** Deterministic RNG returning a fixed index for each call in sequence. */
function rngSeq(...values: number[]): RandomIntBelow {
  let i = 0;
  return () => values[i++ % values.length]!;
}

describe('parseVexSnapshot', () => {
  it('parses a valid snapshot', () => {
    const parsed = parseVexSnapshot(snapshot() as unknown);
    expect(parsed.questions).toHaveLength(5);
    expect(parsed.equivalentGroups).toHaveLength(2);
  });

  it('rejects a non-equivalent mode as wrong_mode', () => {
    expect(() => parseVexSnapshot({ ...snapshot(), distributionMode: 'same_questions' })).toThrow(
      /varianti equivalenti/,
    );
    try {
      parseVexSnapshot({ distributionMode: 'same_questions' });
    } catch (e) {
      expect((e as VexAssignmentError).code).toBe('wrong_mode');
    }
  });

  it('rejects null / non-object', () => {
    expect(() => parseVexSnapshot(null)).toThrow(VexAssignmentError);
    expect(() => parseVexSnapshot(42)).toThrow(VexAssignmentError);
  });

  it('rejects empty questions', () => {
    expect(() => parseVexSnapshot({ ...snapshot(), questions: [] })).toThrow(/senza domande/);
  });
});

describe('validateVexSnapshot (fail-closed)', () => {
  it('accepts a coherent snapshot', () => {
    expect(() => validateVexSnapshot(snapshot())).not.toThrow();
  });

  it('rejects an empty group', () => {
    const s = snapshot();
    s.equivalentGroups[0]!.alternativeOrders = [];
    expect(() => validateVexSnapshot(s)).toThrow(/vuoto/);
  });

  it('rejects a duplicate group id', () => {
    const s = snapshot();
    s.equivalentGroups[1]!.id = 'g1';
    expect(() => validateVexSnapshot(s)).toThrow(/id duplicato/);
  });

  it('rejects an order used twice (across groups/common)', () => {
    const s = snapshot();
    s.equivalentGroups[1]!.alternativeOrders = [2, 4]; // 2 already in g1
    expect(() => validateVexSnapshot(s)).toThrow(/più di una volta/);
  });

  it('rejects incompatible alternatives (different difficoltà/maxPoints)', () => {
    const s = snapshot();
    s.questions[2] = q(2, { difficolta: 5, maxPoints: 5 });
    expect(() => validateVexSnapshot(s)).toThrow(/incompatibili/);
  });

  it('rejects incomplete coverage', () => {
    const s = snapshot();
    s.commonQuestionOrders = []; // 0 now uncovered
    expect(() => validateVexSnapshot(s)).toThrow(/[Cc]opertura/);
  });

  it('rejects an unknown order reference', () => {
    const s = snapshot();
    s.equivalentGroups[0]!.alternativeOrders = [1, 99];
    expect(() => validateVexSnapshot(s)).toThrow(/sconosciuto/);
  });
});

describe('assignVariant', () => {
  it('assigns all common + exactly one per group, sorted ascending', () => {
    const s = snapshot();
    const assigned = assignVariant(s, rngSeq(0, 0)); // g1→1, g2→3
    expect(assigned).toEqual([0, 1, 3]);
  });

  it('honours the injected RNG at both bounds', () => {
    const s = snapshot();
    expect(assignVariant(s, rngSeq(0, 0))).toEqual([0, 1, 3]);
    expect(assignVariant(s, rngSeq(1, 1))).toEqual([0, 2, 4]);
  });

  it('handles zero groups: all questions common', () => {
    const s: VexSnapshot = {
      distributionMode: 'equivalent_variants',
      questions: [q(0), q(1)],
      commonQuestionOrders: [0, 1],
      equivalentGroups: [],
    };
    validateVexSnapshot(s);
    expect(assignVariant(s, rngSeq(0))).toEqual([0, 1]);
  });

  it('does not mutate the snapshot', () => {
    const s = snapshot();
    const before = JSON.stringify(s);
    assignVariant(s, rngSeq(1, 0));
    expect(JSON.stringify(s)).toBe(before);
  });
});

describe('isValidAssignment', () => {
  const s = snapshot();
  it('accepts a well-formed assignment', () => {
    expect(isValidAssignment(s, [0, 1, 3])).toBe(true);
    expect(isValidAssignment(s, [0, 2, 4])).toBe(true);
  });
  it('rejects a missing common question', () => {
    expect(isValidAssignment(s, [1, 3])).toBe(false);
  });
  it('rejects two alternatives from the same group', () => {
    expect(isValidAssignment(s, [0, 1, 2, 3])).toBe(false);
  });
  it('rejects a missing group', () => {
    expect(isValidAssignment(s, [0, 1])).toBe(false);
  });
  it('rejects an extraneous order', () => {
    expect(isValidAssignment(s, [0, 1, 3, 99])).toBe(false);
  });
  it('rejects duplicates', () => {
    expect(isValidAssignment(s, [0, 0, 1, 3])).toBe(false);
  });
});

describe('sanitizeAssignedQuestions', () => {
  it('returns only assigned orders, sorted, without any solution field', () => {
    const s = snapshot();
    s.questions[1] = q(1, { tipo: 'chiusa_singola', opzioni: [{ id: 'a', testo: 'A' }] });
    const out = sanitizeAssignedQuestions(s, [3, 0, 1]);
    expect(out.map((o) => o.order)).toEqual([0, 1, 3]);
    for (const o of out) {
      expect(Object.keys(o).some((k) => k.toLowerCase().includes('soluz'))).toBe(false);
      expect('soluzione' in o).toBe(false);
    }
  });

  it('preserves each assigned question own maxCharacters (not a criterion, kept)', () => {
    const s = snapshot();
    // alternatives with DIFFERENT maxCharacters are allowed; the assigned one keeps its own.
    s.questions[1] = q(1, { maxCharacters: 500 });
    s.questions[2] = q(2, { maxCharacters: 1200 });
    const assignedFirst = sanitizeAssignedQuestions(s, [0, 1, 3]);
    expect(assignedFirst.find((o) => o.order === 1)?.maxCharacters).toBe(500);
    const assignedSecond = sanitizeAssignedQuestions(s, [0, 2, 3]);
    expect(assignedSecond.find((o) => o.order === 2)?.maxCharacters).toBe(1200);
  });
});

describe('secureRandomIntBelow', () => {
  it('returns values within [0, n) and rejects bad ranges', () => {
    for (let i = 0; i < 50; i++) {
      const v = secureRandomIntBelow(3);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(3);
    }
    expect(() => secureRandomIntBelow(0)).toThrow(VexAssignmentError);
  });
});
