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

  it('calls onBackToList when the back button is clicked', () => {
    const onBackToList = vi.fn();
    render(<ConfirmationView receipt={RECEIPT} onBackToList={onBackToList} />);

    fireEvent.click(screen.getByRole('button', { name: 'Torna alle verifiche' }));

    expect(onBackToList).toHaveBeenCalledOnce();
  });
});
