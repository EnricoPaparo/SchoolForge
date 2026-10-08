import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { AiReviewFeedbackInfo } from '../AiReviewFeedbackInfo.js';

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
    fireEvent.keyDown(screen.getByRole('button', { name: 'Resoconto del revisore' }), {
      key: 'Escape',
    });
    expect(screen.queryByRole('note')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Resoconto del revisore' }));
    fireEvent.click(screen.getByRole('button', { name: 'Chiudi resoconto' }));
    expect(screen.queryByRole('note')).toBeNull();
    view.unmount();
    render(<AiReviewFeedbackInfo status="improved" />);
    fireEvent.click(screen.getByRole('button', { name: 'Resoconto del revisore' }));
    expect(screen.queryByText('Corretto <script> il risultato.')).toBeNull();
    expect(
      screen.getByText('Il dettaglio degli interventi non è disponibile per questa operazione.'),
    ).toBeTruthy();
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
