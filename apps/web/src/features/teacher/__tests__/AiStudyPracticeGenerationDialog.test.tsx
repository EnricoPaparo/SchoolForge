import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AiStudyPracticeGenerationDialog } from '../AiStudyPracticeGenerationDialog.js';
import { STUDY_BODY, studyFixture } from '../../repository/programs/__tests__/studyFixture.js';
import type { AiContentCallables } from '../../repository/pools/aiContentClient.js';

vi.mock('../../../lib/firebase.js', () => ({ db: {}, functions: {}, storage: {} }));
afterEach(cleanup);
function setup(reviewEnabled = false) {
  const preview = vi
    .fn()
    .mockResolvedValue({ estimatedCostMicroUsd: 100, reservationCostMicroUsd: 200 });
  const generate = vi.fn().mockResolvedValue({
    actualCostMicroUsd: 80,
    output: { questions: studyFixture().questions, studyPlan: studyFixture().plan },
  });
  const previewReview = vi.fn().mockResolvedValue({
    kind: 'pool_review',
    estimatedCostMicroUsd: 300,
    reservationCostMicroUsd: 600,
  });
  const generateReview = vi.fn().mockResolvedValue({
    kind: 'pool_review',
    actualCostMicroUsd: 150,
    replayed: false,
    reviewFeedback: { changes: ['Corretto un aiuto.'] },
    output: {
      questions: studyFixture().questions,
      studyPlan: studyFixture().plan,
      reviewOutcome: 'improved',
      issueCodes: ['irrelevant_hint'],
    },
  });
  const callables = {
    preview,
    generate,
    previewReview,
    generateReview,
  } as unknown as AiContentCallables;
  const apply = vi.fn(),
    close = vi.fn();
  const view = render(
    <AiStudyPracticeGenerationDialog
      body={STUDY_BODY}
      objectives={['Prevedere output']}
      callables={callables}
      replacesDraft
      onApply={apply}
      onClose={close}
    />,
  );
  if (!reviewEnabled) fireEvent.click(screen.getByRole('switch', { name: 'Revisione avanzata' }));
  return { ...view, preview, generate, previewReview, generateReview, callables, apply, close };
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

async function generateBase() {
  fireEvent.click(screen.getByText('Calcola stima'));
  await screen.findByText('Genera esercitazioni');
  fireEvent.click(screen.getByText('Genera esercitazioni'));
  await screen.findByText('Conferma e revisiona');
}
describe('full practice reviewer flow', () => {
  it('defaults ON, shows a separate review estimate before calling Sol, and applies only the reviewed full proposal', async () => {
    const m = setup(true);
    expect(
      screen.getByRole('switch', { name: 'Revisione avanzata' }).getAttribute('aria-checked'),
    ).toBe('true');
    fireEvent.click(screen.getByRole('radio', { name: /Breve/ }));
    await generateBase();
    expect(m.generate).toHaveBeenCalledTimes(1);
    expect(m.generateReview).not.toHaveBeenCalled();
    expect(m.apply).not.toHaveBeenCalled();
    expect(screen.queryByText('Usa bozza')).toBeNull();
    expect(screen.getByText(/Revisione stimata:/)).toBeTruthy();
    expect(screen.getByText(/Tetto revisione prenotabile:/)).toBeTruthy();
    expect(m.previewReview.mock.calls[0]![0]).toMatchObject({
      kind: 'pool_review',
      purpose: 'practice',
      candidateStudyPlan: studyFixture().plan,
      candidateQuestions: studyFixture().questions,
    });
    fireEvent.click(screen.getByText('Conferma e revisiona'));
    await screen.findByText('Usa bozza');
    expect(m.generateReview.mock.calls[0]![0]).toEqual(m.previewReview.mock.calls[0]![0]);
    expect(screen.getByLabelText('Stato revisione didattica').textContent).toContain('completata');
    fireEvent.click(screen.getByText('Usa bozza'));
    expect(m.apply).toHaveBeenCalledTimes(1);
  });
  it('keeps the paid base and stable review identity on failure; retry never regenerates or applies unsafe base', async () => {
    const m = setup(true);
    m.generateReview.mockRejectedValueOnce({ details: { code: 'provider_invalid_output' } });
    await generateBase();
    fireEvent.click(screen.getByText('Conferma e revisiona'));
    await screen.findByText('Riprova solo la revisione');
    expect(screen.queryByText('Usa bozza')).toBeNull();
    expect(m.apply).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Riprova solo la revisione'));
    await screen.findByText('Usa bozza');
    expect(m.generate).toHaveBeenCalledTimes(1);
    expect(m.previewReview).toHaveBeenCalledTimes(1);
    expect(m.generateReview).toHaveBeenCalledTimes(2);
    expect(m.generateReview.mock.calls[0]![0]).toEqual(m.generateReview.mock.calls[1]![0]);
  });
  it('retries only the review estimate after an estimate error without another base invocation', async () => {
    const m = setup(true);
    m.previewReview.mockRejectedValueOnce({ code: 'functions/unavailable' });
    fireEvent.click(screen.getByText('Calcola stima'));
    await screen.findByText('Genera esercitazioni');
    fireEvent.click(screen.getByText('Genera esercitazioni'));
    await screen.findByText('Ricalcola stima revisione');
    expect(m.generateReview).not.toHaveBeenCalled();
    expect(screen.queryByText('Usa bozza')).toBeNull();
    fireEvent.click(screen.getByText('Ricalcola stima revisione'));
    await screen.findByText('Conferma e revisiona');
    expect(m.previewReview.mock.calls[0]![0]).toEqual(m.previewReview.mock.calls[1]![0]);
    expect(m.generate).toHaveBeenCalledTimes(1);
  });
  it('guards duplicate review, busy dismissal and late review responses after the source changes', async () => {
    const m = setup(true);
    let resolve!: (v: unknown) => void;
    m.generateReview.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    await generateBase();
    fireEvent.click(screen.getByText('Conferma e revisiona'));
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(m.close).not.toHaveBeenCalled();
    expect(m.generateReview).toHaveBeenCalledTimes(1);
    m.rerender(
      <AiStudyPracticeGenerationDialog
        body={STUDY_BODY + ' Nuova versione.'}
        objectives={['Prevedere output']}
        callables={m.callables}
        replacesDraft
        onApply={m.apply}
        onClose={m.close}
      />,
    );
    await act(async () =>
      resolve({
        kind: 'pool_review',
        actualCostMicroUsd: 150,
        output: {
          questions: studyFixture().questions,
          studyPlan: studyFixture().plan,
          reviewOutcome: 'unchanged',
          issueCodes: [],
        },
      }),
    );
    expect(screen.queryByText('Usa bozza')).toBeNull();
    expect(screen.getByText('Calcola stima')).toBeTruthy();
    expect(m.apply).not.toHaveBeenCalled();
  });
});
