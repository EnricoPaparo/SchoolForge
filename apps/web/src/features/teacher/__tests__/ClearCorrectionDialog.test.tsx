import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../lib/firebase.js', () => ({ db: {}, storage: {}, functions: {} }));

const mockClear = vi.fn();
vi.mock('../../repository/corrections/correctionsService.js', () => ({
  clearCorrection: (...args: unknown[]) => mockClear(...args),
}));

import type { Firestore } from 'firebase/firestore';
import { ClearCorrectionDialog } from '../ClearCorrectionDialog.js';

const fakeDb = {} as Firestore;

function renderDialog(overrides: Partial<Parameters<typeof ClearCorrectionDialog>[0]> = {}) {
  const onClose = vi.fn();
  const onCleared = vi.fn();
  render(
    <ClearCorrectionDialog
      submissionId="v1_s1"
      studentName="Anna"
      db={fakeDb}
      onClose={onClose}
      onCleared={onCleared}
      {...overrides}
    />,
  );
  return { onClose, onCleared };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ClearCorrectionDialog (M5-04C)', () => {
  it('has a destructive confirm and a neutral cancel in a shared .dialog-actions row', () => {
    renderDialog();
    const cancel = screen.getByRole('button', { name: 'Annulla' });
    const confirm = screen.getByRole('button', { name: 'Azzera correzione' });
    expect(confirm.className).toContain('btn-danger');
    const actions = cancel.closest('.dialog-actions');
    expect(actions).not.toBeNull();
    expect(actions).toBe(confirm.closest('.dialog-actions'));
  });

  it('cancels without calling the service', () => {
    const { onClose } = renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Annulla' }));
    expect(mockClear).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('clears on confirm, shows persistent success, and notifies onCleared', async () => {
    mockClear.mockResolvedValue({ cleared: true, status: 'in_progress', summary: {} });
    const { onCleared } = renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Azzera correzione' }));
    await screen.findByText(/Correzione azzerata/);
    expect(mockClear).toHaveBeenCalledWith('v1_s1', fakeDb);
    expect(onCleared).toHaveBeenCalledTimes(1);
  });

  it('protects against a double click (single service call)', async () => {
    let resolve!: () => void;
    mockClear.mockReturnValue(new Promise<void>((r) => (resolve = r)));
    renderDialog();
    const confirm = screen.getByRole('button', { name: /Azzera correzione|Azzeramento/ });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    resolve();
    await screen.findByText(/Correzione azzerata/);
    expect(mockClear).toHaveBeenCalledTimes(1);
  });

  it('shows a readable error and allows a retry', async () => {
    mockClear.mockRejectedValueOnce(new Error('Impossibile azzerare: riapri prima la correzione.'));
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Azzera correzione' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/riapri prima/i);
    // Retry is offered.
    expect(screen.getByRole('button', { name: 'Riprova' })).toBeTruthy();
  });
});
