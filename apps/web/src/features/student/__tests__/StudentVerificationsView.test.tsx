import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StudentVerificationsView } from '../StudentVerificationsView.js';

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('../../../lib/firebase.js', () => ({ db: {}, storage: {} }));
vi.mock('../../../lib/auth.js', () => ({
  useAuth: () => ({ user: { uid: 'student-uid', email: 's@test.com', displayName: null } }),
}));

const mockLoadStudentVerifications = vi.fn();
vi.mock('../../repository/verifications/studentVerificationsService.js', () => ({
  loadStudentVerifications: (...args: unknown[]) => mockLoadStudentVerifications(...args),
}));

const mockDownloadStudentPdfFromProjection = vi.fn();
vi.mock('../../repository/verifications/verificationPdf.js', () => ({
  downloadStudentPdfFromProjection: (...args: unknown[]) =>
    mockDownloadStudentPdfFromProjection(...args),
}));

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
});

// ─── Fixtures ────────────────────────────────────────────────────────────────

const VERIFICATION_A = {
  id: 'ver-a',
  title: 'Verifica Reti',
  className: 'Classe 3A',
  activatedAt: { seconds: 100 },
  questionCount: 2,
  questions: [
    { order: 0, tipo: 'aperta' as const, maxPoints: 2, testo: 'Descrivi il modello OSI.' },
    { order: 1, tipo: 'chiusa_singola' as const, maxPoints: 1, testo: 'Livello di routing?' },
  ],
};

const VERIFICATION_B = {
  id: 'ver-b',
  title: 'Verifica Basi di dati',
  className: null,
  activatedAt: null,
  questionCount: 0,
  questions: [],
};

describe('StudentVerificationsView', () => {
  it('shows a loading state while fetching', () => {
    mockLoadStudentVerifications.mockReturnValue(new Promise(() => {}));
    render(<StudentVerificationsView />);
    expect(screen.getByText('Caricamento…')).toBeTruthy();
  });

  it('shows "nessuna classe assegnata" when the student has no class', async () => {
    mockLoadStudentVerifications.mockResolvedValue({ status: 'no-class' });
    render(<StudentVerificationsView />);
    await waitFor(() => expect(screen.getByText(/Nessuna classe assegnata/)).toBeTruthy());
  });

  it('shows "nessuna verifica pubblicata" when the list is empty', async () => {
    mockLoadStudentVerifications.mockResolvedValue({ status: 'ok', verifications: [] });
    render(<StudentVerificationsView />);
    await waitFor(() =>
      expect(screen.getByText(/Nessuna verifica pubblicata per la tua classe/)).toBeTruthy(),
    );
  });

  it('shows a readable error when loading fails', async () => {
    mockLoadStudentVerifications.mockRejectedValue(new Error('boom'));
    render(<StudentVerificationsView />);
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByText('Impossibile caricare le verifiche.')).toBeTruthy();
  });

  it('lists title, class, activation date and question count for each verification', async () => {
    mockLoadStudentVerifications.mockResolvedValue({
      status: 'ok',
      verifications: [VERIFICATION_A],
    });
    render(<StudentVerificationsView />);

    await waitFor(() => expect(screen.getByText('Verifica Reti')).toBeTruthy());
    expect(screen.getByText('Classe 3A')).toBeTruthy();
    expect(screen.getByText('2')).toBeTruthy();
  });

  it('handles a verification with no class and no activation date', async () => {
    mockLoadStudentVerifications.mockResolvedValue({
      status: 'ok',
      verifications: [VERIFICATION_B],
    });
    render(<StudentVerificationsView />);

    await waitFor(() => expect(screen.getByText('Verifica Basi di dati')).toBeTruthy());
    expect(screen.queryByText('null')).toBeNull();
  });

  it('clicking "Scarica PDF" calls downloadStudentPdfFromProjection with the verification data, no solutions', async () => {
    mockLoadStudentVerifications.mockResolvedValue({
      status: 'ok',
      verifications: [VERIFICATION_A],
    });
    mockDownloadStudentPdfFromProjection.mockResolvedValue(undefined);
    render(<StudentVerificationsView />);

    await waitFor(() => screen.getByText('Verifica Reti'));
    fireEvent.click(screen.getByRole('button', { name: /Scarica PDF — Verifica Reti/ }));

    await waitFor(() => expect(mockDownloadStudentPdfFromProjection).toHaveBeenCalledOnce());
    const [arg] = mockDownloadStudentPdfFromProjection.mock.calls[0] as [Record<string, unknown>];
    expect(arg).not.toHaveProperty('soluzione');
    expect(JSON.stringify(arg)).not.toContain('poolStorageRef');
  });

  it('shows a readable error when PDF generation fails', async () => {
    mockLoadStudentVerifications.mockResolvedValue({
      status: 'ok',
      verifications: [VERIFICATION_A],
    });
    mockDownloadStudentPdfFromProjection.mockRejectedValue(new Error('pdf failed'));
    render(<StudentVerificationsView />);

    await waitFor(() => screen.getByText('Verifica Reti'));
    fireEvent.click(screen.getByRole('button', { name: /Scarica PDF — Verifica Reti/ }));

    await waitFor(() =>
      expect(screen.getByText('Impossibile generare il PDF della verifica.')).toBeTruthy(),
    );
  });

  it('never renders docente-only actions (no scoring, no consegna, no correzione)', async () => {
    mockLoadStudentVerifications.mockResolvedValue({
      status: 'ok',
      verifications: [VERIFICATION_A],
    });
    render(<StudentVerificationsView />);

    await waitFor(() => screen.getByText('Verifica Reti'));
    expect(screen.queryByRole('button', { name: /Attiva/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Elimina/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Correggi/i })).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
  });
});
