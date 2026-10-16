import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { StudyPracticePlayer } from '../StudyPracticePlayer.js';
import { studyFixture } from '../../repository/programs/__tests__/studyFixture.js';
afterEach(cleanup);
describe('student practice', () => {
  it('shows a worked example and progressively reveals specific hints', () => {
    render(<StudyPracticePlayer practice={studyFixture()} />);
    expect(screen.getByText('Svolgimento ragionato')).toBeTruthy();
    expect(screen.queryByText('Prima controlla la condizione.')).toBeNull();
    fireEvent.click(screen.getAllByText('Mostra aiuto successivo')[0]!);
    expect(screen.getByText('Prima controlla la condizione.')).toBeTruthy();
    expect(screen.queryByText('Poi aggiorna la variabile.')).toBeNull();
    fireEvent.click(screen.getAllByText('Mostra aiuto successivo')[0]!);
    expect(screen.getByText('Poi aggiorna la variabile.')).toBeTruthy();
  });
  it('compares open responses without grading and checks closed choices locally', () => {
    render(<StudyPracticePlayer practice={studyFixture()} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'La mia risposta' } });
    fireEvent.click(screen.getByText('Confronta con la soluzione'));
    expect(screen.getByText('Soluzione per il confronto')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Aggiornamento'));
    fireEvent.click(screen.getByText('Controlla risposta'));
    expect(screen.getByText(/Da rivedere/)).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Condizione'));
    fireEvent.click(screen.getByText('Controlla risposta'));
    expect(screen.getByText('Corretto.')).toBeTruthy();
  });
  it('forgets all answers when closed and reopened', () => {
    const view = render(<StudyPracticePlayer practice={studyFixture()} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Personale' } });
    view.unmount();
    render(<StudyPracticePlayer practice={studyFixture()} />);
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('');
  });
});
