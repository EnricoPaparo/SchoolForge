import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VexQuestionSelect } from '../VexQuestionSelect.js';
import type { VexBuilderQuestion } from '../VexBuilder.js';

afterEach(cleanup);

function q(id: string, over: Partial<VexBuilderQuestion> = {}): VexBuilderQuestion {
  return {
    questionIndexEntryId: id,
    questionLocalId: id,
    questionPreview: `Anteprima di ${id}`,
    udaDir: 'Il Web',
    tipo: 'chiusa_multipla',
    difficolta: 3,
    maxPoints: 3,
    ...over,
  };
}

function open(label = 'Aggiungi alternativa al gruppo 1') {
  fireEvent.click(screen.getByRole('button', { name: label }));
}

describe('VexQuestionSelect (VEX-02C readable selector)', () => {
  it('shows number, tipo, difficoltà, UDA and the real preview per option', () => {
    render(
      <VexQuestionSelect
        label="Aggiungi alternativa al gruppo 1"
        options={[q('12')]}
        onSelect={vi.fn()}
      />,
    );
    open();
    const option = screen.getByRole('option');
    expect(within(option).getByText('#12 · Scelta multipla · Diff. 3 · UDA Il Web')).toBeTruthy();
    expect(within(option).getByText('Anteprima di 12')).toBeTruthy();
  });

  it('falls back to the id when the preview is missing', () => {
    render(
      <VexQuestionSelect
        label="Aggiungi alternativa al gruppo 1"
        options={[q('q9', { questionLocalId: 'q9', questionPreview: '   ' })]}
        onSelect={vi.fn()}
      />,
    );
    open();
    // preview span falls back to the localId
    expect(screen.getByRole('option').textContent).toContain('q9');
  });

  it('is disabled and shows a readable label when there are no options', () => {
    render(
      <VexQuestionSelect
        label="Aggiungi alternativa al gruppo 1"
        options={[]}
        onSelect={vi.fn()}
      />,
    );
    const trigger = screen.getByRole('button', {
      name: /Aggiungi alternativa al gruppo 1/,
    }) as HTMLButtonElement;
    expect(trigger.disabled).toBe(true);
    expect(trigger.textContent).toMatch(/Nessuna domanda disponibile/);
  });

  it('selects with the keyboard (ArrowDown + Enter) and closes', () => {
    const onSelect = vi.fn();
    render(
      <VexQuestionSelect
        label="Aggiungi alternativa al gruppo 1"
        options={[q('a'), q('b'), q('c')]}
        onSelect={onSelect}
      />,
    );
    open();
    const list = screen.getByRole('listbox');
    fireEvent.keyDown(list, { key: 'ArrowDown' }); // active → b
    fireEvent.keyDown(list, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith('b');
    expect(screen.queryByRole('listbox')).toBeNull(); // closed
  });

  it('closes on Escape without selecting', () => {
    const onSelect = vi.fn();
    render(
      <VexQuestionSelect
        label="Aggiungi alternativa al gruppo 1"
        options={[q('a')]}
        onSelect={onSelect}
      />,
    );
    open();
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('selects on click and exposes an accessible listbox name per group', () => {
    const onSelect = vi.fn();
    render(
      <VexQuestionSelect
        label="Aggiungi alternativa al gruppo 2"
        options={[q('x')]}
        onSelect={onSelect}
      />,
    );
    open('Aggiungi alternativa al gruppo 2');
    expect(screen.getByRole('listbox', { name: /gruppo 2/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('option'));
    expect(onSelect).toHaveBeenCalledWith('x');
  });
});
