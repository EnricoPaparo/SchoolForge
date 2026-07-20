import { describe, expect, it } from 'vitest';
import type {
  EquivalentGroupConfig,
  VerificationQuestionRef,
} from '../../../../types/firestore.js';
import {
  commonEntryIds,
  computeVariantsPossible,
  deriveVexSummary,
  reconcileEquivalentGroups,
  validateEquivalentGroups,
  VARIANTS_CAP,
} from '../vexGroups.js';

function ref(
  id: string,
  overrides: Partial<VerificationQuestionRef> = {},
): VerificationQuestionRef {
  return {
    questionIndexEntryId: id,
    questionLocalId: id,
    udaDir: 'uda-1',
    lessonFilename: 'l.md',
    poolStorageRef: 'r',
    tipo: 'aperta',
    difficolta: 3,
    maxPoints: 3,
    ...overrides,
  };
}
const group = (id: string, ids: string[]): EquivalentGroupConfig => ({
  id,
  questionIndexEntryIds: ids,
});

describe('reconcileEquivalentGroups', () => {
  it('drops deselected entries and removes empty groups; dedupes', () => {
    const selected = new Set(['a', 'b', 'd']);
    const groups = [group('g1', ['a', 'b', 'c']), group('g2', ['x', 'y']), group('g3', ['d', 'd'])];
    expect(reconcileEquivalentGroups(groups, selected)).toEqual([
      group('g1', ['a', 'b']),
      group('g3', ['d']),
    ]);
  });

  it('does not mutate the input', () => {
    const groups = [group('g1', ['a', 'b'])];
    reconcileEquivalentGroups(groups, new Set(['a']));
    expect(groups[0]!.questionIndexEntryIds).toEqual(['a', 'b']);
  });
});

describe('deriveVexSummary', () => {
  it('computes common, per-student, variants and maxPoints', () => {
    const refs = [ref('a'), ref('b'), ref('c'), ref('d'), ref('e')];
    const groups = [group('g1', ['b', 'c']), group('g2', ['d', 'e'])];
    const s = deriveVexSummary(refs, groups);
    expect(s.commonCount).toBe(1); // only 'a'
    expect(s.groupsCount).toBe(2);
    expect(s.questionsPerStudent).toBe(3); // 1 common + 2 groups
    expect(s.variantsPossible).toEqual({ value: 4, capped: false }); // 2 * 2
    // maxPoints: a(3) + one of g1(3) + one of g2(3) = 9
    expect(s.maxPoints).toBe(9);
  });

  it('common = selected not in groups', () => {
    expect(commonEntryIds(['a', 'b', 'c'], [group('g', ['b'])])).toEqual(['a', 'c']);
  });
});

describe('computeVariantsPossible (safe product)', () => {
  it('caps huge products without NaN/Infinity', () => {
    const many = Array.from({ length: 40 }, (_, i) => group(`g${i}`, ['x', 'y']));
    const v = computeVariantsPossible(many);
    expect(v.capped).toBe(true);
    expect(v.value).toBe(VARIANTS_CAP);
    expect(Number.isFinite(v.value)).toBe(true);
  });
});

describe('validateEquivalentGroups — blocking', () => {
  const refs = [ref('a'), ref('b'), ref('c')];

  it('accepts same UDA/tipo/difficoltà alternatives', () => {
    const res = validateEquivalentGroups(refs, [group('g', ['a', 'b'])]);
    expect(res.blocking).toEqual([]);
  });

  it('accepts alternatives with different maxCharacters (not compared)', () => {
    // maxCharacters is not part of VerificationQuestionRef and is never compared;
    // same udaDir/tipo/difficoltà is enough.
    const res = validateEquivalentGroups([ref('a'), ref('b')], [group('g', ['a', 'b'])]);
    expect(res.blocking).toEqual([]);
  });

  it('rejects incompatible alternatives (different difficoltà)', () => {
    const res = validateEquivalentGroups(
      [ref('a'), ref('b', { difficolta: 4, maxPoints: 4 })],
      [group('g', ['a', 'b'])],
    );
    expect(res.blocking.join(' ')).toMatch(/stessa UDA/);
  });

  it('rejects incompatible alternatives (different tipo / udaDir)', () => {
    expect(
      validateEquivalentGroups(
        [ref('a'), ref('b', { tipo: 'chiusa_singola' })],
        [group('g', ['a', 'b'])],
      ).blocking.length,
    ).toBeGreaterThan(0);
    expect(
      validateEquivalentGroups([ref('a'), ref('b', { udaDir: 'uda-2' })], [group('g', ['a', 'b'])])
        .blocking.length,
    ).toBeGreaterThan(0);
  });

  it('rejects the same question in more than one group', () => {
    const res = validateEquivalentGroups(refs, [group('g1', ['a', 'b']), group('g2', ['a', 'c'])]);
    expect(res.blocking.join(' ')).toMatch(/più di un gruppo/);
  });

  it('rejects a reference not among selected refs', () => {
    const res = validateEquivalentGroups(refs, [group('g', ['a', 'zzz'])]);
    expect(res.blocking.join(' ')).toMatch(/non più selezionata/);
  });

  it('rejects no overall question', () => {
    const res = validateEquivalentGroups([], []);
    expect(res.blocking.join(' ')).toMatch(/Nessuna domanda/);
  });
});

describe('validateEquivalentGroups — warnings', () => {
  it('single-alternative group warns non-blocking', () => {
    const res = validateEquivalentGroups([ref('a'), ref('b')], [group('g', ['a'])]);
    expect(res.blocking).toEqual([]);
    expect(res.warnings.some((w) => w.code === 'single_alternative')).toBe(true);
  });

  it('single overall combination warns', () => {
    // one group of one alternative → variantsPossible === 1
    const res = validateEquivalentGroups([ref('a'), ref('b')], [group('g', ['a'])]);
    expect(res.warnings.some((w) => w.code === 'single_variant')).toBe(true);
  });

  it('omits student-count warnings when studentCount is not provided (no reads)', () => {
    const res = validateEquivalentGroups([ref('a'), ref('b')], [group('g', ['a', 'b'])]);
    expect(res.warnings.some((w) => w.code === 'fewer_variants_than_students')).toBe(false);
  });

  it('warns fewer-variants-than-students when studentCount is provided', () => {
    const res = validateEquivalentGroups([ref('a'), ref('b')], [group('g', ['a', 'b'])], 10);
    expect(res.warnings.some((w) => w.code === 'fewer_variants_than_students')).toBe(true);
    expect(res.warnings.some((w) => w.code === 'variant_repetition_possible')).toBe(true);
  });
});
