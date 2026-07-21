import { StrictMode, useRef, useState } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { assignOnSelect, type AutogroupRef } from '../../repository/verifications/vexAutogroup.js';
import { reconcileEquivalentGroups } from '../../repository/verifications/vexGroups.js';
import type { EquivalentGroupConfig } from '../../../types/firestore.js';

afterEach(cleanup);

/**
 * VEX-02C — Strict Mode purity guard for the progressive assignment.
 *
 * React re-invokes functional state updaters (and renders) twice under Strict
 * Mode. The `handleQuestionSelectionChange` handler therefore computes groups,
 * session candidates and any UUID **once, outside** the updater and lets
 * `setEquivalentGroups` only apply the already-computed value. This harness
 * replicates that exact discipline so a double-invocation cannot produce a
 * duplicate group/UUID nor lose a session candidate.
 */

const refs: AutogroupRef[] = [
  { questionIndexEntryId: 'a', udaDir: 'uda-1', tipo: 'aperta', difficolta: 3 },
  { questionIndexEntryId: 'b', udaDir: 'uda-1', tipo: 'aperta', difficolta: 3 },
];

function Harness({
  makeId,
  onGroups,
}: {
  makeId: () => string;
  onGroups: (g: EquivalentGroupConfig[]) => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [groups, setGroups] = useState<EquivalentGroupConfig[]>([]);
  const sessionRef = useRef<string[]>([]);

  // Mirrors handleQuestionSelectionChange: all computation & side effects are
  // performed here (outside any React updater), then applied via plain setters.
  function select(next: Set<string>) {
    const added = [...next].filter((id) => !selected.has(id));
    let nextGroups = reconcileEquivalentGroups(groups, next);
    let session = sessionRef.current.filter(
      (id) => next.has(id) && !nextGroups.some((g) => g.questionIndexEntryIds.includes(id)),
    );
    for (const id of added) {
      const res = assignOnSelect(
        { newEntryId: id, refs, groups: nextGroups, sessionUnassigned: session },
        makeId,
      );
      nextGroups = res.groups;
      session = res.sessionUnassigned;
    }
    setSelected(next);
    setGroups(nextGroups);
    sessionRef.current = session;
    onGroups(nextGroups);
  }

  return (
    <button
      type="button"
      onClick={() => select(new Set([...selected, selected.size === 0 ? 'a' : 'b']))}
    >
      next
    </button>
  );
}

describe('VEX-02C progressive assignment under Strict Mode', () => {
  it('creates exactly one group, calls the id generator once, no duplicate questions, stable result', () => {
    let idCalls = 0;
    const makeId = () => `g${++idCalls}`;
    let last: EquivalentGroupConfig[] = [];

    const { container } = render(
      <StrictMode>
        <Harness makeId={makeId} onGroups={(g) => (last = g)} />
      </StrictMode>,
    );
    const btn = container.querySelector('button')!;

    // First selection: 'a' seeds a session candidate, no group yet.
    act(() => btn.click());
    expect(last).toHaveLength(0);
    expect(idCalls).toBe(0);

    // Second selection: 'b' pairs with the pending 'a' → exactly one group.
    act(() => btn.click());
    expect(last).toHaveLength(1);
    expect(last[0]!.questionIndexEntryIds).toEqual(['a', 'b']);

    // The id generator ran exactly once despite Strict Mode double-invocation.
    expect(idCalls).toBe(1);

    // No question appears twice across groups.
    const all = last.flatMap((g) => g.questionIndexEntryIds);
    expect(new Set(all).size).toBe(all.length);

    // Result is stable: no extra render mutates it.
    expect(last[0]!.id).toBe('g1');
  });
});
