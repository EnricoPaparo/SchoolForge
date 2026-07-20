import { describe, expect, it } from 'vitest';
import type {
  EquivalentGroupConfig,
  VerificationQuestionRef,
} from '../../../../types/firestore.js';
import { buildEquivalentSnapshotParts, VexSnapshotError } from '../vexSnapshot.js';

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

describe('buildEquivalentSnapshotParts (VEX-01A)', () => {
  it('converts entryIds to orders, computes common orders, deterministic', () => {
    // order = index in questionRefs: a=0 b=1 c=2 d=3 e=4
    const refs = [ref('a'), ref('b'), ref('c'), ref('d'), ref('e')];
    const groups = [group('g1', ['c', 'b']), group('g2', ['e', 'd'])];
    const parts = buildEquivalentSnapshotParts(refs, groups);
    expect(parts.commonQuestionOrders).toEqual([0]); // only 'a'
    expect(parts.equivalentGroups).toEqual([
      { id: 'g1', alternativeOrders: [1, 2] }, // sorted
      { id: 'g2', alternativeOrders: [3, 4] },
    ]);
  });

  it('covers every order exactly once (disjoint + complete)', () => {
    const refs = [ref('a'), ref('b'), ref('c')];
    const parts = buildEquivalentSnapshotParts(refs, [group('g', ['a', 'b'])]);
    const all = [
      ...parts.commonQuestionOrders,
      ...parts.equivalentGroups.flatMap((g) => g.alternativeOrders),
    ].sort();
    expect(all).toEqual([0, 1, 2]);
  });

  it('fails on a missing reference', () => {
    const refs = [ref('a'), ref('b')];
    expect(() => buildEquivalentSnapshotParts(refs, [group('g', ['a', 'zzz'])])).toThrow(
      VexSnapshotError,
    );
  });

  it('fails on a duplicate across groups', () => {
    const refs = [ref('a'), ref('b'), ref('c')];
    expect(() =>
      buildEquivalentSnapshotParts(refs, [group('g1', ['a', 'b']), group('g2', ['b', 'c'])]),
    ).toThrow(/più di un gruppo/);
  });

  it('fails on incompatible alternatives', () => {
    const refs = [ref('a'), ref('b', { difficolta: 5, maxPoints: 5 })];
    expect(() => buildEquivalentSnapshotParts(refs, [group('g', ['a', 'b'])])).toThrow(
      /stessa UDA/,
    );
  });

  it('fails on an empty group (should have been reconciled away)', () => {
    const refs = [ref('a')];
    expect(() => buildEquivalentSnapshotParts(refs, [group('g', [])])).toThrow(/vuoto/);
  });

  it('fails on duplicate group ids (fail-closed)', () => {
    const refs = [ref('a'), ref('b')];
    expect(() =>
      buildEquivalentSnapshotParts(refs, [group('dup', ['a']), group('dup', ['b'])]),
    ).toThrow(/stesso identificativo/);
  });
});
