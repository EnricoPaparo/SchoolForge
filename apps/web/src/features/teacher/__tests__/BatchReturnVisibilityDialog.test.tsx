import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockLoadEligibility = vi.fn();
const mockRunAction = vi.fn();

vi.mock('../../../lib/firebase.js', () => ({ db: {}, storage: {}, functions: {} }));

vi.mock('../../repository/corrections/batchReturnVisibility.js', () => ({
  loadBatchReturnVisibilityEligibility: (...args: unknown[]) => mockLoadEligibility(...args),
  runBatchReturnVisibilityAction: (...args: unknown[]) => mockRunAction(...args),
  describeBatchReturnVisibilityExclusion: (reason: string) =>
    reason === 'no_correction' ? 'Nessuna correzione presente.' : 'Correzione non restituita.',
}));

import type { Firestore } from 'firebase/firestore';
import { BatchReturnVisibilityDialog } from '../BatchReturnVisibilityDialog.js';
import type { BatchSelectedRow } from '../../repository/corrections/batchCorrectionActions.js';

const db = {} as Firestore;
const verification = { teacherSnapshot: { distributionMode: 'same_questions' } } as never;
const rows: BatchSelectedRow[] = [
  {
    studentUid: 'a',
    studentName: 'Anna',
    submissionId: 'v1_a',
    progress: {
      status: 'returned',
      evaluated: 1,
      total: 1,
      totalPoints: 2,
      maxPoints: 2,
      percentage: 100,
      hasContent: true,
    },
  },
  {
    studentUid: 'b',
    studentName: 'Bruno',
    submissionId: 'v1_b',
    progress: undefined,
  },
];

function renderDialog(
  action: 'show_return' | 'hide_return' | 'show_solutions' | 'hide_solutions' = 'show_return',
) {
  return render(
    <BatchReturnVisibilityDialog
      action={action}
      rows={rows}
      ownerUid="owner"
      verificationId="v1"
      verification={verification}
      db={db}
      onClose={vi.fn()}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockLoadEligibility.mockResolvedValue({
    eligible: [{ studentUid: 'a', studentName: 'Anna', submissionId: 'v1_a' }],
    excluded: [{ studentUid: 'b', studentName: 'Bruno', reason: 'no_correction' }],
  });
  mockRunAction.mockResolvedValue([
    { studentUid: 'a', submissionId: 'v1_a', outcome: 'succeeded' },
  ]);
});

afterEach(cleanup);

describe('BatchReturnVisibilityDialog', () => {
  it('shows compact confirmation and eligibility counts', async () => {
    renderDialog('hide_return');
    expect(
      await screen.findByText('Nascondere le restituzioni selezionate agli studenti?'),
    ).toBeTruthy();
    expect(screen.getByText('Consegne selezionate: 2')).toBeTruthy();
    expect(screen.getByText('Elaborabili: 1')).toBeTruthy();
    expect(screen.getByText('Escluse: 1')).toBeTruthy();
    expect(screen.getByText(/Bruno — Nessuna correzione presente/)).toBeTruthy();
  });

  it('zero eligible disables confirmation and performs no action', async () => {
    mockLoadEligibility.mockResolvedValueOnce({
      eligible: [],
      excluded: rows.map((row) => ({
        studentUid: row.studentUid,
        studentName: row.studentName,
        reason: 'not_returned',
      })),
    });
    renderDialog('show_solutions');
    const confirm = await screen.findByRole('button', { name: 'Mostra soluzioni' });
    expect(confirm).toHaveProperty('disabled', true);
    fireEvent.click(confirm);
    expect(mockRunAction).not.toHaveBeenCalled();
  });

  it.each([
    ['show_return', 'Rendi visibili'],
    ['hide_return', 'Nascondi allo studente'],
    ['show_solutions', 'Mostra soluzioni'],
    ['hide_solutions', 'Nascondi soluzioni'],
  ] as const)('confirms %s exactly once', async (action, label) => {
    renderDialog(action);
    const confirm = await screen.findByRole('button', { name: label });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    await waitFor(() => expect(mockRunAction).toHaveBeenCalledTimes(1));
    expect(mockRunAction.mock.calls[0]?.[0]).toMatchObject({ action, verificationId: 'v1' });
  });

  it('reports successes, no-ops, exclusions and failures separately', async () => {
    mockRunAction.mockResolvedValueOnce([
      { studentUid: 'a', submissionId: 'v1_a', outcome: 'noop' },
      {
        studentUid: 'c',
        submissionId: 'v1_c',
        outcome: 'failed',
        error: 'Operazione non riuscita per questa consegna. Riprova.',
      },
    ]);
    mockLoadEligibility.mockResolvedValueOnce({
      eligible: [
        { studentUid: 'a', studentName: 'Anna', submissionId: 'v1_a' },
        { studentUid: 'c', studentName: 'Carla', submissionId: 'v1_c' },
      ],
      excluded: [{ studentUid: 'b', studentName: 'Bruno', reason: 'no_correction' }],
    });
    renderDialog();
    fireEvent.click(await screen.findByRole('button', { name: 'Rendi visibili' }));

    expect(await screen.findByText('Riuscite: 0')).toBeTruthy();
    expect(screen.getByText('Già nello stato richiesto: 1')).toBeTruthy();
    expect(screen.getByText('Escluse: 1')).toBeTruthy();
    expect(screen.getByText('Fallite: 1')).toBeTruthy();
    expect(screen.getByText(/Consegna selezionata — Operazione non riuscita/)).toBeTruthy();
  });

  it('does not update state after unmount while a batch is pending', async () => {
    let resolve!: (value: unknown[]) => void;
    mockRunAction.mockReturnValueOnce(new Promise((done) => (resolve = done)));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const view = renderDialog();
    fireEvent.click(await screen.findByRole('button', { name: 'Rendi visibili' }));
    view.unmount();
    resolve([{ studentUid: 'a', submissionId: 'v1_a', outcome: 'succeeded' }]);
    await Promise.resolve();
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
