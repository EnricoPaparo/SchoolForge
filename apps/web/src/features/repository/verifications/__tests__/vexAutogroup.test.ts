import { describe, expect, it } from 'vitest';
import type { EquivalentGroupConfig } from '../../../../types/firestore.js';
import {
  assignOnSelect,
  autoGroupByKey,
  equivalenceKey,
  groupEquivalenceKey,
  ungroupedEntryIds,
  type AutogroupRef,
} from '../vexAutogroup.js';

function ref(id: string, over: Partial<AutogroupRef> = {}): AutogroupRef {
  return { questionIndexEntryId: id, udaDir: 'uda-1', tipo: 'aperta', difficolta: 3, ...over };
}

// Deterministic id generator for tests.
function seqIds(): () => string {
  let n = 0;
  return () => `g${++n}`;
}

describe('equivalenceKey (fail-closed)', () => {
  it('builds a key from UDA + tipo + difficoltà', () => {
    expect(equivalenceKey(ref('a'))).toBe(equivalenceKey(ref('b')));
    expect(equivalenceKey(ref('a', { udaDir: 'x' }))).not.toBe(equivalenceKey(ref('b')));
    expect(equivalenceKey(ref('a', { tipo: 'chiusa_singola' }))).not.toBe(equivalenceKey(ref('b')));
    expect(equivalenceKey(ref('a', { difficolta: 4 }))).not.toBe(equivalenceKey(ref('b')));
  });
  it('returns null for malformed metadata', () => {
    expect(equivalenceKey(ref('a', { udaDir: '' }))).toBeNull();
    expect(equivalenceKey(ref('a', { tipo: 'bogus' as never }))).toBeNull();
    expect(equivalenceKey(ref('a', { difficolta: 0 as never }))).toBeNull();
    expect(equivalenceKey(ref('a', { difficolta: 6 as never }))).toBeNull();
    expect(equivalenceKey(ref('a', { difficolta: 2.5 as never }))).toBeNull();
    expect(equivalenceKey(null)).toBeNull();
  });
});

describe('autoGroupByKey (first initialization)', () => {
  it('creates a group only for buckets with ≥2 questions; singletons stay common', () => {
    const refs = [
      ref('a'), // uda-1/aperta/3
      ref('b'), // uda-1/aperta/3  → group with a
      ref('c', { difficolta: 4 }), // singleton
      ref('d', { udaDir: 'uda-2' }), // singleton
    ];
    const groups = autoGroupByKey(refs, seqIds());
    expect(groups).toHaveLength(1);
    expect(groups[0]!.questionIndexEntryIds).toEqual(['a', 'b']);
    expect(ungroupedEntryIds(refs, groups)).toEqual(['c', 'd']);
  });

  it('separates by UDA, tipo and difficoltà', () => {
    const refs = [
      ref('a'),
      ref('b'),
      ref('c', { tipo: 'chiusa_singola' }),
      ref('d', { tipo: 'chiusa_singola' }),
      ref('e', { udaDir: 'uda-2' }),
      ref('f', { udaDir: 'uda-2' }),
    ];
    const groups = autoGroupByKey(refs, seqIds());
    expect(groups.map((g) => g.questionIndexEntryIds)).toEqual([
      ['a', 'b'],
      ['c', 'd'],
      ['e', 'f'],
    ]);
  });

  it('groups despite different maxCharacters (not a criterion) and skips malformed', () => {
    // maxCharacters is not part of AutogroupRef and never consulted → a and b group.
    const refs = [ref('a'), ref('b'), ref('bad', { udaDir: '' })];
    const groups = autoGroupByKey(refs, seqIds());
    expect(groups).toHaveLength(1);
    expect(groups[0]!.questionIndexEntryIds).toEqual(['a', 'b']);
    expect(ungroupedEntryIds(refs, groups)).toContain('bad'); // fail-closed → common
  });

  it('is deterministic and does not mutate input', () => {
    const refs = [ref('a'), ref('b')];
    const snapshot = JSON.stringify(refs);
    autoGroupByKey(refs, seqIds());
    expect(JSON.stringify(refs)).toBe(snapshot);
  });
});

describe('groupEquivalenceKey', () => {
  it('is the shared key, or null for empty/mixed groups', () => {
    const byId = new Map([
      ['a', ref('a')],
      ['b', ref('b')],
      ['c', ref('c', { difficolta: 5 })],
    ]);
    expect(groupEquivalenceKey({ id: 'g', questionIndexEntryIds: ['a', 'b'] }, byId)).toBe(
      equivalenceKey(ref('a')),
    );
    expect(groupEquivalenceKey({ id: 'g', questionIndexEntryIds: ['a', 'c'] }, byId)).toBeNull();
    expect(groupEquivalenceKey({ id: 'g', questionIndexEntryIds: [] }, byId)).toBeNull();
  });
});

describe('assignOnSelect (progressive)', () => {
  const refs = [ref('a'), ref('b'), ref('c')]; // all same key by default

  it('adds to the unique compatible group', () => {
    const groups: EquivalentGroupConfig[] = [{ id: 'g1', questionIndexEntryIds: ['a', 'b'] }];
    const res = assignOnSelect({ newEntryId: 'c', refs, groups, sessionUnassigned: [] }, seqIds());
    expect(res.groups).toHaveLength(1);
    expect(res.groups[0]!.questionIndexEntryIds).toEqual(['a', 'b', 'c']);
  });

  it('pairs with a compatible pending question to form a new group', () => {
    const res = assignOnSelect(
      { newEntryId: 'b', refs, groups: [], sessionUnassigned: ['a'] },
      seqIds(),
    );
    expect(res.groups).toHaveLength(1);
    expect(res.groups[0]!.questionIndexEntryIds).toEqual(['a', 'b']);
    expect(res.sessionUnassigned).toEqual([]);
  });

  it('leaves common (and seeds) when there is no partner yet', () => {
    const res = assignOnSelect({ newEntryId: 'a', refs, groups: [], sessionUnassigned: [] });
    expect(res.groups).toEqual([]);
    expect(res.sessionUnassigned).toEqual(['a']);
  });

  it('leaves common when multiple compatible groups exist (no arbitrary choice)', () => {
    const groups: EquivalentGroupConfig[] = [
      { id: 'g1', questionIndexEntryIds: ['a'] },
      { id: 'g2', questionIndexEntryIds: ['b'] },
    ];
    const res = assignOnSelect({ newEntryId: 'c', refs, groups, sessionUnassigned: [] });
    expect(res.groups).toHaveLength(2); // unchanged
    expect(res.groups.every((g) => !g.questionIndexEntryIds.includes('c'))).toBe(true);
  });

  it('never places a question in two groups', () => {
    const groups: EquivalentGroupConfig[] = [{ id: 'g1', questionIndexEntryIds: ['a', 'c'] }];
    const res = assignOnSelect({ newEntryId: 'c', refs, groups, sessionUnassigned: ['a'] });
    // c already grouped → no change
    expect(res.groups[0]!.questionIndexEntryIds).toEqual(['a', 'c']);
    expect(res.groups).toHaveLength(1);
  });

  it('fail-closed: malformed new question stays common', () => {
    const bad = [ref('x', { udaDir: '' }), ref('a')];
    const res = assignOnSelect({
      newEntryId: 'x',
      refs: bad,
      groups: [],
      sessionUnassigned: ['a'],
    });
    expect(res.groups).toEqual([]);
  });
});
