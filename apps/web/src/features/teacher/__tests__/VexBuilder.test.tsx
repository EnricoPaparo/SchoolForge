import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VexBuilder } from '../VexBuilder.js';
import type {
  EquivalentGroupConfig,
  VerificationDistributionMode,
  VerificationQuestionRef,
} from '../../../types/firestore.js';

afterEach(cleanup);

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

const g = (id: string, ids: string[]): EquivalentGroupConfig => ({
  id,
  questionIndexEntryIds: ids,
});

/** Renders a controlled builder and returns a handle exposing the last props. */
function setup(opts: {
  mode?: VerificationDistributionMode;
  refs: VerificationQuestionRef[];
  groups?: EquivalentGroupConfig[];
  studentCount?: number;
}) {
  const onModeChange = vi.fn();
  const onGroupsChange = vi.fn();
  render(
    <VexBuilder
      distributionMode={opts.mode ?? 'equivalent_variants'}
      onModeChange={onModeChange}
      selectedRefs={opts.refs}
      groups={opts.groups ?? []}
      onGroupsChange={onGroupsChange}
      studentCount={opts.studentCount}
    />,
  );
  return { onModeChange, onGroupsChange };
}

describe('VexBuilder (VEX-01A)', () => {
  it('hides the equivalent-variants config when mode is same_questions', () => {
    setup({ mode: 'same_questions', refs: [ref('a'), ref('b')] });
    expect(screen.queryByText('Gruppi equivalenti')).toBeNull();
    expect(screen.getByText('Stesse domande, ordine casuale')).toBeTruthy();
  });

  it('switches mode via the radios without clearing groups', () => {
    const { onModeChange } = setup({
      mode: 'same_questions',
      refs: [ref('a')],
      groups: [g('x', ['a'])],
    });
    fireEvent.click(screen.getByRole('radio', { name: /Varianti equivalenti/i }));
    expect(onModeChange).toHaveBeenCalledWith('equivalent_variants');
  });

  it('creates a new empty group and guards against a double click', () => {
    const { onGroupsChange } = setup({ refs: [ref('a'), ref('b')], groups: [] });
    const btn = screen.getByRole('button', { name: /Crea gruppo/i });
    fireEvent.click(btn);
    fireEvent.click(btn); // second click in the same tick must be ignored
    expect(onGroupsChange).toHaveBeenCalledTimes(1);
    expect(onGroupsChange.mock.calls[0][0]).toHaveLength(1);
    expect(onGroupsChange.mock.calls[0][0][0].questionIndexEntryIds).toEqual([]);
  });

  it('removing the last alternative auto-deletes the group', () => {
    const { onGroupsChange } = setup({
      refs: [ref('a'), ref('b')],
      groups: [g('x', ['a'])],
    });
    fireEvent.click(screen.getByRole('button', { name: /Rimuovi/i }));
    expect(onGroupsChange).toHaveBeenCalledWith([]);
  });

  it('deleting a group returns its alternatives to common', () => {
    const { onGroupsChange } = setup({
      refs: [ref('a'), ref('b')],
      groups: [g('x', ['a', 'b'])],
    });
    fireEvent.click(screen.getByRole('button', { name: /Elimina gruppo/i }));
    expect(onGroupsChange).toHaveBeenCalledWith([]);
  });

  it('shows the single-alternative warning for a one-question group', () => {
    setup({ refs: [ref('a'), ref('b')], groups: [g('x', ['a'])] });
    expect(screen.getByText(/assegnata a tutti gli studenti/i)).toBeTruthy();
  });

  it('renders the derived summary (common, groups, per-student, variants, points)', () => {
    // a,b common; group of {c,d} -> per-student = 2 common + 1 group = 3
    setup({
      refs: [ref('a'), ref('b'), ref('c'), ref('d')],
      groups: [g('x', ['c', 'd'])],
    });
    const stat = screen.getByText('Domande per studente').parentElement!;
    expect(within(stat).getByText('3')).toBeTruthy();
    expect(screen.getByText('Varianti possibili')).toBeTruthy();
  });

  it('flags an incompatible group (different difficulty)', () => {
    setup({
      refs: [ref('a'), ref('b', { difficolta: 5, maxPoints: 5 })],
      groups: [g('x', ['a', 'b'])],
    });
    expect(screen.getAllByText(/stessa difficoltà/i).length).toBeGreaterThan(0);
  });
});
