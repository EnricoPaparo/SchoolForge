import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PdfModuleLoadError } from '../../../lib/pdfModuleLoader.js';
import { CorrectionArchiveExportDialog } from '../CorrectionArchiveExportDialog.js';

vi.mock('../../../lib/firebase.js', () => ({ db: {}, storage: {}, functions: {} }));

afterEach(cleanup);

const eligible = [
  { submissionId: 'sub-1', studentUid: 'student-1', studentName: 'Anna' },
  { submissionId: 'sub-2', studentUid: 'student-2', studentName: 'Bruno' },
];

describe('CorrectionArchiveExportDialog', () => {
  it('shows compact counts/exclusions and blocks generation with zero eligible rows', () => {
    const run = vi.fn();
    render(
      <CorrectionArchiveExportDialog
        selectedCount={1}
        eligibility={{
          eligible: [],
          excluded: [{ studentName: 'Anna', reason: 'not_completed' }],
        }}
        run={run}
        onClose={vi.fn()}
        onReload={vi.fn()}
      />,
    );
    expect(screen.getByText('Consegne selezionate: 1')).toBeTruthy();
    expect(screen.getByText('Esportabili: 0')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Genera' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(run).not.toHaveBeenCalled();
  });

  it('guards double clicks, exposes an accessible busy state and reports ZIP success', async () => {
    let resolve!: (value: { ok: true; kind: 'zip'; filenames: string[] }) => void;
    const run = vi.fn(
      () =>
        new Promise<{ ok: true; kind: 'zip'; filenames: string[] }>((done) => {
          resolve = done;
        }),
    );
    render(
      <CorrectionArchiveExportDialog
        selectedCount={2}
        eligibility={{ eligible, excluded: [] }}
        run={run}
        onClose={vi.fn()}
        onReload={vi.fn()}
      />,
    );
    const generate = screen.getByRole('button', { name: 'Genera' });
    fireEvent.click(generate);
    fireEvent.click(generate);
    expect(run).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status').textContent).toContain('Preparazione PDF…');
    expect(screen.queryByText(/\d+%/)).toBeNull();
    resolve({ ok: true, kind: 'zip', filenames: ['a.pdf', 'b.pdf'] });
    await waitFor(() => expect(screen.getByText('ZIP preparato con 2 PDF.')).toBeTruthy());
  });

  it('requires an explicit reload for stale chunks and keeps generic errors distinct', async () => {
    const reload = vi.fn();
    const { unmount } = render(
      <CorrectionArchiveExportDialog
        selectedCount={1}
        eligibility={{ eligible: eligible.slice(0, 1), excluded: [] }}
        run={async () => {
          throw new PdfModuleLoadError('stale_chunk');
        }}
        onClose={vi.fn()}
        onReload={reload}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Genera' }));
    await screen.findByText('SchoolForge è stato aggiornato. Ricarica la pagina e riprova.');
    expect(reload).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Ricarica pagina' }));
    expect(reload).toHaveBeenCalledTimes(1);
    unmount();

    render(
      <CorrectionArchiveExportDialog
        selectedCount={1}
        eligibility={{ eligible: eligible.slice(0, 1), excluded: [] }}
        run={async () => {
          throw new Error('generic');
        }}
        onClose={vi.fn()}
        onReload={reload}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Genera' }));
    await screen.findByText('Impossibile generare i PDF. Riprova.');
    expect(screen.queryByRole('button', { name: 'Ricarica pagina' })).toBeNull();
  });
});
