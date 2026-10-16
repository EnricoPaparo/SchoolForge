import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AiStudyPracticeGenerationDialog } from '../AiStudyPracticeGenerationDialog.js';
import { STUDY_BODY, studyFixture } from '../../repository/programs/__tests__/studyFixture.js';
import type { AiContentCallables } from '../../repository/pools/aiContentClient.js';

vi.mock('../../../lib/firebase.js', () => ({ db: {}, functions: {}, storage: {} }));
afterEach(cleanup);
function setup() {
  const preview = vi
    .fn()
    .mockResolvedValue({ estimatedCostMicroUsd: 100, reservationCostMicroUsd: 200 });
  const generate = vi.fn().mockResolvedValue({
    actualCostMicroUsd: 80,
    output: { questions: studyFixture().questions, studyPlan: studyFixture().plan },
  });
  const apply = vi.fn(),
    close = vi.fn();
  const view = render(
    <AiStudyPracticeGenerationDialog
      body={STUDY_BODY}
      objectives={['Prevedere output']}
      callables={{ preview, generate } as unknown as AiContentCallables}
      replacesDraft
      onApply={apply}
      onClose={close}
    />,
  );
  return { ...view, preview, generate, apply, close };
}
describe('practice generation modal', () => {
  it('uses selected Quality and settings for the same estimate/generate request, with no application before Usa bozza', async () => {
    const m = setup();
    fireEvent.change(screen.getByLabelText('Profilo modello'), { target: { value: 'quality' } });
    fireEvent.click(screen.getByRole('radio', { name: /Breve/ }));
    fireEvent.change(screen.getByLabelText('Indicazioni aggiuntive (facoltative)'), {
      target: { value: 'Esercita il metodo' },
    });
    fireEvent.click(screen.getByText('Calcola stima'));
    await screen.findByText('Genera esercitazioni');
    expect(m.generate).not.toHaveBeenCalled();
    expect(m.apply).not.toHaveBeenCalled();
    expect(m.preview.mock.calls[0]![0]).toMatchObject({
      purpose: 'practice',
      modelProfile: 'quality',
      teacherGuidance: 'Esercita il metodo',
      counts: { aperta: 2, chiusa_singola: 1, chiusa_multipla: 0 },
      plannedObjectives: ['Prevedere output'],
    });
    fireEvent.click(screen.getByText('Genera esercitazioni'));
    await screen.findByText('Usa bozza');
    expect(m.generate.mock.calls[0]![0]).toEqual(m.preview.mock.calls[0]![0]);
    expect(m.apply).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Usa bozza'));
    fireEvent.click(screen.getByText('Usa bozza'));
    expect(m.apply).toHaveBeenCalledTimes(1);
    expect(m.apply.mock.calls[0]![0]).toMatchObject({ sourceBody: STUDY_BODY });
  });
  it('re-estimates configuration with a new identity and keeps the model selection', async () => {
    const m = setup();
    fireEvent.change(screen.getByLabelText('Profilo modello'), { target: { value: 'quality' } });
    fireEvent.click(screen.getByText('Calcola stima'));
    await screen.findByText('Genera esercitazioni');
    fireEvent.click(screen.getByText('Modifica configurazione'));
    fireEvent.click(screen.getByRole('radio', { name: /Estesa/ }));
    fireEvent.click(screen.getByText('Calcola stima'));
    await screen.findByText('Genera esercitazioni');
    expect(m.preview.mock.calls[1]![0]).toMatchObject({
      modelProfile: 'quality',
      counts: { aperta: 8, chiusa_singola: 1, chiusa_multipla: 0 },
    });
    expect(m.preview.mock.calls[1]![0].requestId).not.toBe(m.preview.mock.calls[0]![0].requestId);
  });
  it('guards double submission and busy dismissal, then restores the proposal on canceled abandon', async () => {
    const m = setup();
    let resolve!: (v: unknown) => void;
    m.preview.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    fireEvent.click(screen.getByText('Calcola stima'));
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(m.preview).toHaveBeenCalledTimes(1);
    expect(m.close).not.toHaveBeenCalled();
    await act(async () => resolve({ estimatedCostMicroUsd: 100, reservationCostMicroUsd: 200 }));
    fireEvent.click(screen.getByText('Genera esercitazioni'));
    await screen.findByText('Usa bozza');
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    const confirm = screen.getByRole('alertdialog', { name: 'Abbandonare la proposta?' });
    fireEvent.click(within(confirm).getByRole('button', { name: /Continua/ }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(m.apply).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Annulla proposta'));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByText('Abbandona e chiudi'));
    expect(m.close).toHaveBeenCalledTimes(1);
  });
  it('shows an estimate failure without calling generate and supports retry', async () => {
    const m = setup();
    m.preview.mockRejectedValueOnce({ code: 'functions/unavailable' });
    fireEvent.click(screen.getByText('Calcola stima'));
    await screen.findByRole('alert');
    expect(m.generate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Calcola stima'));
    await screen.findByText('Genera esercitazioni');
    expect(m.preview).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });
});
