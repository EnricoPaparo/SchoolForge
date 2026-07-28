import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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

  it('renders a compact icon-only mobile trigger without changing desktop', () => {
    const css = readFileSync(
      resolve(process.cwd(), 'src/features/teacher/RecordActionsMenu.module.css'),
      'utf8',
    );
    expect(css).toMatch(/@media\s*\(max-width:\s*44rem\)[\s\S]*?\.wrapper\s*\{[^}]*width:\s*auto/s);
    expect(css).toMatch(
      /@media\s*\(max-width:\s*44rem\)[\s\S]*?\.trigger\s*\{[^}]*width:\s*2\.75rem/s,
    );
    expect(css).toMatch(
      /@media\s*\(max-width:\s*44rem\)[\s\S]*?\.label\s*\{[^}]*clip:\s*rect\(0,\s*0,\s*0,\s*0\)/s,
    );
    expect(css.slice(0, css.indexOf('@media'))).not.toMatch(
      /\.trigger\s*\{[^}]*width:\s*2\.75rem/s,
    );
  });
});
