import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RecordActionsMenu } from '../RecordActionsMenu.js';

afterEach(cleanup);

describe('RecordActionsMenu', () => {
  it('runs the React handler before closing the portal', () => {
    const action = vi.fn();
    render(
      <RecordActionsMenu ariaLabel="Azioni record">
        <button type="button" role="menuitem" onClick={action}>
          Esegui
        </button>
      </RecordActionsMenu>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Azioni record' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Esegui' }));

    expect(action).toHaveBeenCalledOnce();
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('keeps disabled actions visible without closing the menu', () => {
    render(
      <RecordActionsMenu ariaLabel="Azioni record">
        <button type="button" role="menuitem" disabled>
          Non disponibile
        </button>
      </RecordActionsMenu>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Azioni record' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Non disponibile' }));
    expect(screen.getByRole('menu')).toBeTruthy();
  });
});
