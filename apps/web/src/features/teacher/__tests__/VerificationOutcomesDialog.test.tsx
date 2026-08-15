import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { VerificationOutcomesDialog } from '../VerificationOutcomesDialog.js';
import type { VerificationLessonOutcomesReport } from '../../repository/outcomes/verificationLessonOutcomes.js';
import type { loadVerificationLessonOutcomes } from '../../repository/outcomes/verificationLessonOutcomesService.js';

afterEach(cleanup);

const REPORT: VerificationLessonOutcomesReport = {
  finalizedCorrections: 2,
  submittedCount: 3,
  udas: [
    {
      udaDir: 'uda-01',
      udaTitle: 'Reti',
      masteryPercentage: 58,
      questionCount: 3,
      evaluationCount: 5,
      lessons: [
        {
          udaDir: 'uda-01',
          lessonFilename: 'lezione-001.md',
          lessonTitle: 'Indirizzi IP',
          masteryPercentage: 42,
          questionCount: 1,
          evaluationCount: 2,
        },
        {
          udaDir: 'uda-01',
          lessonFilename: 'lezione-002.md',
          lessonTitle: 'Trasporto',
          masteryPercentage: 75,
          questionCount: 2,
          evaluationCount: 3,
        },
      ],
    },
  ],
};

function renderDialog(
  loadReport: typeof loadVerificationLessonOutcomes = vi.fn(async () => REPORT),
) {
  const onClose = vi.fn();
  render(
    <VerificationOutcomesDialog
      verificationId="ver-1"
      verificationTitle="Verifica reti"
      ownerUid="owner-1"
      db={{} as never}
      onClose={onClose}
      loadReport={loadReport}
    />,
  );
  return { loadReport, onClose };
}

describe('VerificationOutcomesDialog (ESITI-01)', () => {
  it('carica una sola volta e mostra copertura, UDA, lezioni e basi del dato', async () => {
    const { loadReport } = renderDialog();
    expect(screen.getByRole('status').textContent).toContain('Calcolo');

    await waitFor(() => expect(screen.getByText('Indirizzi IP')).toBeTruthy());
    expect(loadReport).toHaveBeenCalledTimes(1);
    expect(loadReport).toHaveBeenCalledWith({
      verificationId: 'ver-1',
      ownerUid: 'owner-1',
      db: {},
    });
    expect(screen.getByLabelText('Copertura delle correzioni').textContent).toContain('2/3');
    expect(screen.getByLabelText('Copertura delle correzioni').textContent).toContain(
      'cambieranno',
    );
    const outcomes = screen.getByLabelText('Esiti per UDA e lezione');
    expect(within(outcomes).getByText('Reti')).toBeTruthy();
    expect(within(outcomes).getByText('42%')).toBeTruthy();
    expect(within(outcomes).getByText('Trasporto')).toBeTruthy();
    expect(document.body.textContent).not.toContain('studentUid');
    expect(document.body.textContent).not.toContain('labelId');
  });

  it('dichiara la copertura completa', async () => {
    renderDialog(vi.fn(async () => ({ ...REPORT, finalizedCorrections: 3, submittedCount: 3 })));
    await waitFor(() => expect(screen.getByText(/copertura completa/)).toBeTruthy());
  });

  it('mostra uno stato vuoto senza inventare percentuali', async () => {
    renderDialog(vi.fn(async () => ({ finalizedCorrections: 0, submittedCount: 4, udas: [] })));
    await waitFor(() => expect(screen.getByText(/Non ci sono ancora/)).toBeTruthy());
    expect(document.body.textContent).not.toContain('%');
  });

  it('mostra un errore leggibile senza risultati parziali', async () => {
    renderDialog(vi.fn(async () => Promise.reject(new Error('Dati non coerenti.'))));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('non coerenti'));
    expect(screen.queryByLabelText('Esiti per UDA e lezione')).toBeNull();
  });

  it('si chiude con pulsante, Escape e backdrop', async () => {
    const { onClose } = renderDialog();
    await waitFor(() => expect(screen.getByText('Indirizzi IP')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Chiudi' }));
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    fireEvent.click(screen.getByRole('dialog').parentElement!);
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it('non aggiorna lo stato dopo lo smontaggio', async () => {
    let resolveReport!: (value: VerificationLessonOutcomesReport) => void;
    const loadReport = vi.fn(
      () =>
        new Promise<VerificationLessonOutcomesReport>((resolve) => {
          resolveReport = resolve;
        }),
    );
    const { unmount } = render(
      <VerificationOutcomesDialog
        verificationId="ver-1"
        verificationTitle="V"
        ownerUid="owner-1"
        db={{} as never}
        onClose={() => {}}
        loadReport={loadReport}
      />,
    );
    unmount();
    resolveReport(REPORT);
    await Promise.resolve();
    expect(screen.queryByText('Indirizzi IP')).toBeNull();
  });

  it('fissa il contratto responsive senza tabella e con target touch', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/features/teacher/VerificationOutcomesDialog.tsx'),
      'utf8',
    );
    const css = readFileSync(
      resolve(process.cwd(), 'src/features/teacher/VerificationOutcomesDialog.module.css'),
      'utf8',
    );
    expect(source).not.toMatch(/<table|<thead|<tbody/);
    expect(css).toMatch(/@media \(max-width: 640px\)/);
    expect(css).toMatch(/grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
    expect(css).toMatch(/@media \(pointer: coarse\)/);
    expect(css).toMatch(/min-height: 2\.75rem/);
    expect(css).toMatch(/overflow-x: hidden/);
  });
});
