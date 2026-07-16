import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as BatchModule from '../../repository/corrections/batchCorrectionActions.js';

vi.mock('../../../lib/firebase.js', () => ({ db: {}, storage: {}, functions: {} }));

const mockRun = vi.fn();
vi.mock('../../repository/corrections/batchCorrectionActions.js', async (importOriginal) => {
  const actual = await importOriginal<typeof BatchModule>();
  return { ...actual, runBatchCorrectionAction: (...args: unknown[]) => mockRun(...args) };
});

import type { Firestore } from 'firebase/firestore';
import { BatchCorrectionActionsDialog } from '../BatchCorrectionActionsDialog.js';
import type {
  BatchSelectedRow,
  BatchRowResult,
} from '../../repository/corrections/batchCorrectionActions.js';
import type { CorrectionProgress } from '../../repository/corrections/correctionProgressService.js';

const fakeDb = {} as Firestore;

function prog(over: Partial<CorrectionProgress>): CorrectionProgress {
  return {
    status: 'in_progress',
    evaluated: 3,
    total: 3,
    totalPoints: 8,
    maxPoints: 10,
    percentage: 80,
    hasContent: true,
    ...over,
  };
}

function row(uid: string, p: CorrectionProgress | undefined): BatchSelectedRow {
  return { studentUid: uid, studentName: `Studente ${uid}`, submissionId: `v_${uid}`, progress: p };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('BatchCorrectionActionsDialog (M5-04)', () => {
  it('shows the preliminary eligible/excluded summary and consequence', async () => {
    const rows = [
      row('a', prog({ status: 'completed' })),
      row('b', prog({ status: 'in_progress' })),
    ];
    render(
      <BatchCorrectionActionsDialog
        action="return"
        rows={rows}
        db={fakeDb}
        onClose={() => {}}
        onApplied={() => {}}
      />,
    );
    expect(screen.getByText('Consegne selezionate: 2')).toBeTruthy();
    expect(screen.getByText('Eleggibili: 1')).toBeTruthy();
    expect(screen.getByText('Escluse: 1')).toBeTruthy();
    expect(screen.getByText(/diventeranno immediatamente visibili allo studente/)).toBeTruthy();
    fireEvent.click(screen.getByText('Consegne escluse (1)'));
    expect(screen.getByText(/Studente b — Non ancora completata/)).toBeTruthy();
  });

  it('runs the service on confirm and reports partial success', async () => {
    const results: BatchRowResult[] = [
      { studentUid: 'a', submissionId: 'v_a', outcome: 'succeeded' },
      { studentUid: 'b', submissionId: 'v_b', outcome: 'failed', error: 'non valutata' },
    ];
    mockRun.mockResolvedValue(results);
    const onApplied = vi.fn();
    const rows = [
      row('a', prog({ status: 'in_progress' })),
      row('b', prog({ status: 'in_progress' })),
    ];
    render(
      <BatchCorrectionActionsDialog
        action="complete"
        rows={rows}
        db={fakeDb}
        onClose={() => {}}
        onApplied={onApplied}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Completa 2 correzioni' }));
    await screen.findByText('Operazione completata.');
    expect(screen.getByText('Riuscite: 1')).toBeTruthy();
    expect(screen.getByText('Fallite: 1')).toBeTruthy();
    expect(screen.getByText(/Studente b — non valutata/)).toBeTruthy();
    // M5-04A: onApplied notifica soltanto (nessun uid): la selezione è
    // persistente e non viene toccata dal dialog.
    expect(onApplied).toHaveBeenCalledTimes(1);
    expect(onApplied).toHaveBeenCalledWith();
  });

  it('keeps the initial exclusion count after a successful row changes status', async () => {
    mockRun.mockResolvedValue([
      { studentUid: 'a', submissionId: 'v_a', outcome: 'succeeded' } satisfies BatchRowResult,
    ]);
    const initialRows = [row('a', prog({ status: 'in_progress' }))];
    const { rerender } = render(
      <BatchCorrectionActionsDialog
        action="complete"
        rows={initialRows}
        db={fakeDb}
        onClose={() => {}}
        onApplied={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Completa 1 correzioni' }));
    await screen.findByText('Operazione completata.');

    // Simula la rilettura del parent: la riga completata non è più eleggibile
    // per "Completa", ma non deve essere conteggiata anche come esclusa.
    rerender(
      <BatchCorrectionActionsDialog
        action="complete"
        rows={[row('a', prog({ status: 'completed' }))]}
        db={fakeDb}
        onClose={() => {}}
        onApplied={() => {}}
      />,
    );

    expect(screen.getByText('Riuscite: 1')).toBeTruthy();
    expect(screen.getByText('Escluse: 0')).toBeTruthy();
    expect(screen.getByText('Fallite: 0')).toBeTruthy();
  });

  it('cancels without ever calling the service', async () => {
    const onClose = vi.fn();
    render(
      <BatchCorrectionActionsDialog
        action="complete"
        rows={[row('a', prog({ status: 'in_progress' }))]}
        db={fakeDb}
        onClose={onClose}
        onApplied={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Annulla' }));
    expect(mockRun).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('protects against a double click', async () => {
    let resolveRun!: (r: BatchRowResult[]) => void;
    mockRun.mockReturnValue(new Promise<BatchRowResult[]>((r) => (resolveRun = r)));
    render(
      <BatchCorrectionActionsDialog
        action="reopen"
        rows={[row('a', prog({ status: 'completed' }))]}
        db={fakeDb}
        onClose={() => {}}
        onApplied={() => {}}
      />,
    );
    const confirm = screen.getByRole('button', { name: 'Riapri 1 correzioni' });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    resolveRun([{ studentUid: 'a', submissionId: 'v_a', outcome: 'succeeded' }]);
    await screen.findByText('Operazione completata.');
    expect(mockRun).toHaveBeenCalledTimes(1);
  });

  it('never calls the service when there are zero eligible rows', () => {
    render(
      <BatchCorrectionActionsDialog
        action="complete"
        rows={[row('a', prog({ status: 'completed' }))]}
        db={fakeDb}
        onClose={() => {}}
        onApplied={() => {}}
      />,
    );
    expect(
      screen.getByText('Nessuna consegna selezionata è eleggibile per questa azione.'),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Completa \d+ correzioni/ })).toBeNull();
    expect(mockRun).not.toHaveBeenCalled();
  });

  it('renders Annulla and the primary action inside a shared .dialog-actions row', () => {
    render(
      <BatchCorrectionActionsDialog
        action="return"
        rows={[row('a', prog({ status: 'completed' }))]}
        db={fakeDb}
        onClose={() => {}}
        onApplied={() => {}}
      />,
    );
    const cancel = screen.getByRole('button', { name: 'Annulla' });
    const primary = screen.getByRole('button', { name: 'Restituisci 1 correzioni' });
    const actions = cancel.closest('.dialog-actions');
    // Both buttons share the same action row (spacing handled by the shared class).
    expect(actions).not.toBeNull();
    expect(actions).toBe(primary.closest('.dialog-actions'));
  });
});
