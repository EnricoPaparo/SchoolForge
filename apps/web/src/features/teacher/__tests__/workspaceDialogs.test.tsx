import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// workspaceDialogs imports lib/firebase (side-effectful initializeApp) and a few
// services at module load; only ProgramInfoDialog/ClassesDialog use them, never
// ConfirmDialog. Mock firebase so importing the module is inert in jsdom.
vi.mock('../../../lib/firebase.js', () => ({ db: {}, storage: {} }));

afterEach(cleanup);

import { ConfirmDialog, DialogShell } from '../workspaceDialogs.js';

function renderConfirm(overrides: Partial<Parameters<typeof ConfirmDialog>[0]> = {}) {
  const onCancel = vi.fn();
  const onConfirm = vi.fn();
  render(
    <ConfirmDialog
      title="Elimina corso"
      message="Sicuro?"
      confirmLabel="Elimina"
      danger
      busy={false}
      error={null}
      onCancel={onCancel}
      onConfirm={onConfirm}
      {...overrides}
    />,
  );
  return { onCancel, onConfirm, dialog: screen.getByRole('dialog') };
}

describe('DialogShell accessibility (HARD-02A-FIX / P2-01)', () => {
  it('exposes role=dialog, aria-modal and an aria-labelledby pointing at the title', () => {
    const { dialog } = renderConfirm();
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    const labelledby = dialog.getAttribute('aria-labelledby');
    expect(labelledby).toBeTruthy();
    expect(document.getElementById(labelledby!)?.textContent).toBe('Elimina corso');
  });

  it('moves initial focus into the dialog (first focusable)', () => {
    renderConfirm();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Annulla' }));
  });

  it('Escape closes a closable dialog', () => {
    const { onCancel, dialog } = renderConfirm();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('Escape does NOT close while busy (non-interruptible operation)', () => {
    const { onCancel, dialog } = renderConfirm({ busy: true });
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('a backdrop click does NOT close while busy', () => {
    const { onCancel } = renderConfirm({ busy: true });
    // The backdrop is the dialog's parent element.
    fireEvent.click(screen.getByRole('dialog').parentElement!);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('Tab from the last focusable wraps to the first', () => {
    const { dialog } = renderConfirm();
    const annulla = screen.getByRole('button', { name: 'Annulla' });
    const elimina = screen.getByRole('button', { name: 'Elimina' });
    elimina.focus();
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(document.activeElement).toBe(annulla);
  });

  it('Shift+Tab from the first focusable wraps to the last', () => {
    const { dialog } = renderConfirm();
    const annulla = screen.getByRole('button', { name: 'Annulla' });
    const elimina = screen.getByRole('button', { name: 'Elimina' });
    annulla.focus();
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(elimina);
  });

  it('restores focus to the trigger on close, and cleans up on unmount', () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" data-testid="trigger" onClick={() => setOpen(true)}>
            Apri
          </button>
          {open && (
            <ConfirmDialog
              title="Elimina corso"
              message="Sicuro?"
              confirmLabel="Elimina"
              busy={false}
              error={null}
              onCancel={() => setOpen(false)}
              onConfirm={() => {}}
            />
          )}
        </>
      );
    }
    render(<Harness />);
    const trigger = screen.getByTestId('trigger');
    trigger.focus();
    fireEvent.click(trigger); // opens the dialog; focus was on the trigger
    expect(screen.queryByRole('dialog')).not.toBeNull();

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    // Dialog unmounted and focus returned to the opener.
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('still runs the confirm action of a real dialog', () => {
    const { onConfirm } = renderConfirm();
    fireEvent.click(screen.getByRole('button', { name: 'Elimina' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});

describe('DialogShell wide-scroll variant (AIGEN-UI-01)', () => {
  it('applies a specific verifiable class only for the wide-scroll variant', () => {
    render(
      <DialogShell title="AIGEN" onCancel={() => {}} variant="wide-scroll">
        <button type="button">Ok</button>
      </DialogShell>,
    );
    expect(screen.getByRole('dialog').className).toMatch(/dialogWideScroll/);
  });

  it('keeps the default variant unchanged (no wide-scroll class)', () => {
    render(
      <DialogShell title="Default" onCancel={() => {}}>
        <button type="button">Ok</button>
      </DialogShell>,
    );
    expect(screen.getByRole('dialog').className).not.toMatch(/dialogWideScroll/);
  });

  it('does not regress focus trap, Escape and focus restore in the variant', () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" data-testid="trigger" onClick={() => setOpen(true)}>
            Apri
          </button>
          {open && (
            <DialogShell title="AIGEN" onCancel={() => setOpen(false)} variant="wide-scroll">
              <button type="button">Azione</button>
            </DialogShell>
          )}
        </>
      );
    }
    render(<Harness />);
    const trigger = screen.getByTestId('trigger');
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = screen.getByRole('dialog');
    // Initial focus moved inside the dialog.
    expect(dialog.contains(document.activeElement)).toBe(true);
    // Escape closes and restores focus to the opener.
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});
