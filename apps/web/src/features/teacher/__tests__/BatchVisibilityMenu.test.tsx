import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BatchVisibilityMenu } from '../BatchVisibilityMenu.js';

afterEach(cleanup);

describe('BatchVisibilityMenu', () => {
  it('is disabled without a selection and exposes the four independent actions when enabled', () => {
    const onSelect = vi.fn();
    const { rerender } = render(
      <BatchVisibilityMenu disabled contextKey="v1" onSelect={onSelect} />,
    );
    expect(screen.getByRole('button', { name: 'Visibilità' })).toHaveProperty('disabled', true);

    rerender(<BatchVisibilityMenu disabled={false} contextKey="v1" onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button', { name: 'Visibilità' }));
    expect(screen.getByRole('menu', { name: 'Azioni visibilità restituzioni' })).toBeTruthy();
    for (const label of [
      'Rendi visibili',
      'Nascondi allo studente',
      'Mostra soluzioni',
      'Nascondi soluzioni',
    ]) {
      expect(screen.getByRole('menuitem', { name: label })).toBeTruthy();
    }
  });

  it('supports keyboard opening, Escape and focus restoration', async () => {
    render(<BatchVisibilityMenu disabled={false} contextKey="v1" onSelect={vi.fn()} />);
    const trigger = screen.getByRole('button', { name: 'Visibilità' });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Rendi visibili' })),
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('closes on selection and maps each item to the correct action', async () => {
    const onSelect = vi.fn();
    render(<BatchVisibilityMenu disabled={false} contextKey="v1" onSelect={onSelect} />);
    for (const [label, action] of [
      ['Rendi visibili', 'show_return'],
      ['Nascondi allo studente', 'hide_return'],
      ['Mostra soluzioni', 'show_solutions'],
      ['Nascondi soluzioni', 'hide_solutions'],
    ] as const) {
      fireEvent.click(screen.getByRole('button', { name: 'Visibilità' }));
      fireEvent.click(screen.getByRole('menuitem', { name: label }));
      expect(onSelect).toHaveBeenLastCalledWith(action);
      expect(screen.queryByRole('menu')).toBeNull();
      await waitFor(() =>
        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Visibilità' })),
      );
    }
  });

  it('closes when the verification context changes', () => {
    const { rerender } = render(
      <BatchVisibilityMenu disabled={false} contextKey="v1" onSelect={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Visibilità' }));
    expect(screen.getByRole('menu')).toBeTruthy();
    rerender(<BatchVisibilityMenu disabled={false} contextKey="v2" onSelect={vi.fn()} />);
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
