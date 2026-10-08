import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AiReviewFeedbackInfo } from '../AiReviewFeedbackInfo.js';
import { DialogShell } from '../../../components/DialogShell.js';

afterEach(cleanup);
describe('transient reviewer information', () => {
  it('opens read-only plaintext, closes and disappears on unmount', () => {
    const view = render(
      <AiReviewFeedbackInfo
        status="improved"
        feedback={{ changes: ['Corretto <script> il risultato.'] }}
      />,
    );
    expect(screen.queryByRole('note')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Resoconto del revisore' }));
    expect(screen.getByText('Corretto <script> il risultato.')).toBeTruthy();
    expect(view.container.querySelector('script')).toBeNull();
    const trigger = screen.getByRole('button', { name: 'Resoconto del revisore' });
    const panel = screen.getByRole('note');
    panel.focus();
    expect(document.activeElement).toBe(panel);
    fireEvent.keyDown(panel, {
      key: 'Escape',
    });
    expect(screen.queryByRole('note')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    fireEvent.click(screen.getByRole('button', { name: 'Resoconto del revisore' }));
    fireEvent.click(trigger);
    expect(screen.queryByRole('note')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    view.unmount();
    render(<AiReviewFeedbackInfo status="improved" />);
    fireEvent.click(screen.getByRole('button', { name: 'Resoconto del revisore' }));
    expect(screen.queryByText('Corretto <script> il risultato.')).toBeNull();
    expect(
      screen.getByText('Il dettaglio degli interventi non è disponibile per questa operazione.'),
    ).toBeTruthy();
  });
  it('uses a body portal, consumes outside clicks and Escape without closing the parent', () => {
    const cancel = vi.fn();
    const action = vi.fn();
    render(
      <DialogShell title="Generazione" onCancel={cancel}>
        <AiReviewFeedbackInfo
          status="improved"
          feedback={{ changes: ['Corretto il risultato.'] }}
        />
        <button onClick={action}>Azione sottostante</button>
      </DialogShell>,
    );
    const trigger = screen.getByRole('button', { name: 'Resoconto del revisore' });
    fireEvent.click(trigger);
    const panel = screen.getByRole('note');
    expect(screen.getByRole('dialog').contains(panel)).toBe(false);
    expect(screen.queryByText('Chiudi resoconto')).toBeNull();
    expect(screen.queryByText('Disponibile finché questa finestra resta aperta.')).toBeNull();
    fireEvent.click(panel);
    expect(screen.getByRole('note')).toBeTruthy();
    const overlay = panel.parentElement!;
    const pointer = new Event('pointerdown', { bubbles: true, cancelable: true });
    expect(overlay.dispatchEvent(pointer)).toBe(false);
    fireEvent.click(overlay);
    expect(screen.queryByRole('note')).toBeNull();
    expect(cancel).not.toHaveBeenCalled();
    expect(action).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(trigger);
    fireEvent.click(trigger);
    screen.getByRole('button', { name: 'Azione sottostante' }).focus();
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(screen.queryByRole('note')).toBeNull();
    expect(cancel).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(trigger);
    fireEvent.keyDown(trigger, { key: 'Escape' });
    expect(cancel).toHaveBeenCalledOnce();
  });
  it('clamps the anchor at viewport edges and repositions on scroll and resize', () => {
    render(<AiReviewFeedbackInfo status="unchanged" />);
    const trigger = screen.getByRole('button', { name: 'Resoconto del revisore' });
    vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue({
      left: 990,
      right: 1018,
      top: 750,
      bottom: 778,
    } as DOMRect);
    fireEvent.click(trigger);
    const panel = screen.getByRole('note');
    vi.spyOn(panel, 'getBoundingClientRect').mockReturnValue({ height: 150 } as DOMRect);
    fireEvent.resize(window);
    expect(Number.parseFloat(panel.style.left)).toBeLessThanOrEqual(window.innerWidth - 352 - 12);
    expect(Number.parseFloat(panel.style.top)).toBeLessThanOrEqual(window.innerHeight - 150 - 12);
    vi.mocked(trigger.getBoundingClientRect).mockReturnValue({
      left: 0,
      right: 28,
      top: 0,
      bottom: 28,
    } as DOMRect);
    fireEvent.scroll(window);
    expect(panel.style.left).toBe('12px');
    expect(panel.style.top).toBe('36px');
  });
  it('unchanged ignores claimed changes', () => {
    render(<AiReviewFeedbackInfo status="unchanged" feedback={{ changes: ['Inventato'] }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Resoconto del revisore' }));
    expect(screen.getByText('Nessuna modifica necessaria rilevata.')).toBeTruthy();
    expect(screen.queryByText('Inventato')).toBeNull();
  });
  it('replay reports unavailable detail without inventing changes', () => {
    render(<AiReviewFeedbackInfo status="improved" replayed />);
    fireEvent.click(screen.getByRole('button', { name: 'Resoconto del revisore' }));
    expect(
      screen.getByText('Il dettaglio non è disponibile per questa operazione ripristinata.'),
    ).toBeTruthy();
  });
});
