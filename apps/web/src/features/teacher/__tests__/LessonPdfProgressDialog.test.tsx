import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LessonPdfProgressDialog } from '../LessonPdfProgressDialog.js';

afterEach(cleanup);
describe('PDF progress modal', () => {
  it('blocks dismissal during work and enables it only after the download starts', () => {
    const close = vi.fn();
    const view = render(
      <LessonPdfProgressDialog
        progress={{ phase: 'running', message: 'Preparazione lezione 2 di 4: Reti' }}
        onClose={close}
      />,
    );
    const dialog = screen.getByRole('dialog', { name: 'Scarica PDF' });
    fireEvent.keyDown(dialog, { key: 'Escape' });
    fireEvent.click(dialog.parentElement!);
    expect(close).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Chiudi' })).toBeNull();
    expect(screen.getByRole('status').textContent).toContain('2 di 4');
    view.rerender(
      <LessonPdfProgressDialog
        progress={{ phase: 'complete', message: 'Archivio pronto: download avviato.' }}
        onClose={close}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Chiudi' }));
    expect(close).toHaveBeenCalledOnce();
  });
  it('shows errors inside the modal and allows closing', () => {
    render(
      <LessonPdfProgressDialog
        progress={{ phase: 'error', message: 'Immagine non disponibile.' }}
        onClose={() => {}}
      />,
    );
    expect(screen.getByRole('alert').textContent).toContain('Immagine non disponibile');
    expect(screen.getByRole('button', { name: 'Chiudi' })).toBeTruthy();
  });
});
