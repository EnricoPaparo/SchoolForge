import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfirmationView } from '../ConfirmationView.js';
import type { SubmissionReceiptDoc } from '../../../types/firestore.js';

afterEach(cleanup);

const RECEIPT: SubmissionReceiptDoc = {
  submissionId: 'v1_student-uid',
  verificationId: 'v1',
  studentUid: 'student-uid',
  ownerUid: 'owner-uid',
  verificationTitle: 'Verifica Reti',
  className: 'Classe 3A',
  deliveryCode: 'SF-2026-A3B7',
  submittedAt: { seconds: 1_800_000_000 } as never,
};

describe('ConfirmationView', () => {
  it('shows title, delivery timestamp, code and the immutability notice without the class', () => {
    render(<ConfirmationView receipt={RECEIPT} onBackToList={vi.fn()} />);

    expect(screen.getByText('Verifica Reti')).toBeTruthy();
    expect(screen.queryByText('Classe 3A')).toBeNull();
    expect(screen.getByText('SF-2026-A3B7')).toBeTruthy();
    expect(screen.getByText('Consegna effettuata', { exact: false })).toBeTruthy();
    expect(
      screen.getByText('La tua consegna è stata registrata. Non è possibile modificarla.'),
    ).toBeTruthy();
  });

  it('never renders any question or answer content', () => {
    render(<ConfirmationView receipt={RECEIPT} onBackToList={vi.fn()} />);

    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('radio')).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('keeps the class hidden also for legacy receipts that still carry it', () => {
    render(<ConfirmationView receipt={{ ...RECEIPT, className: null }} onBackToList={vi.fn()} />);
    expect(screen.queryByText('Classe 3A')).toBeNull();
  });

  // FORCE-SUBMIT-01 — la consegna acquisita dal docente non deve essere
  // indistinguibile da quella premuta dallo studente.
  it('distingue la consegna acquisita dal docente', () => {
    render(
      <ConfirmationView receipt={{ ...RECEIPT, forcedByTeacher: true }} onBackToList={vi.fn()} />,
    );

    expect(screen.getByRole('region', { name: 'Consegna acquisita dal docente' })).toBeTruthy();
    expect(screen.getByText('✓ Consegna acquisita dal docente')).toBeTruthy();
    expect(
      screen.getByText(
        'Il docente ha acquisito l’ultima versione salvata. Non è possibile modificarla.',
      ),
    ).toBeTruthy();
    // Stesso codice consegna canonico della consegna ordinaria.
    expect(screen.getByText('SF-2026-A3B7')).toBeTruthy();
    // Nessun contenuto di risposta, come per la consegna normale.
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('la consegna normale non menziona mai il docente', () => {
    render(<ConfirmationView receipt={RECEIPT} onBackToList={vi.fn()} />);
    expect(screen.queryByText(/acquisita dal docente/)).toBeNull();
    expect(screen.getByRole('region', { name: 'Consegna effettuata' })).toBeTruthy();
  });

  it('calls onBackToList when the back button is clicked', () => {
    const onBackToList = vi.fn();
    render(<ConfirmationView receipt={RECEIPT} onBackToList={onBackToList} />);

    fireEvent.click(screen.getByRole('button', { name: 'Torna alle verifiche' }));

    expect(onBackToList).toHaveBeenCalledOnce();
  });
});
