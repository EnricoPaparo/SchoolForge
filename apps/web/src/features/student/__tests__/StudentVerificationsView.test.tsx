import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StudentVerificationsView } from '../StudentVerificationsView.js';

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('../../../lib/firebase.js', () => ({ db: {}, storage: {}, functions: {} }));
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

const mockLoadReceipt = vi.fn();
const mockLoadSubmission = vi.fn();
const mockStartSubmission = vi.fn();
vi.mock('../submissionsService.js', () => ({
  loadReceipt: (...args: unknown[]) => mockLoadReceipt(...args),
  loadSubmission: (...args: unknown[]) => mockLoadSubmission(...args),
  startSubmission: (...args: unknown[]) => mockStartSubmission(...args),
}));

const mockRequestFullscreenBestEffort = vi.fn();
vi.mock('../examDeterrence.js', () => ({
  requestFullscreenBestEffort: () => mockRequestFullscreenBestEffort(),
}));

const mockLoadStudentCorrectionReturns = vi.fn();
vi.mock('../studentCorrectionReturnsService.js', () => ({
  loadStudentCorrectionReturns: (...args: unknown[]) => mockLoadStudentCorrectionReturns(...args),
}));

vi.mock('../StudentCorrectionView.js', () => ({
  StudentCorrectionView: (props: {
    submissionId: string;
    initialData: { verificationTitle: string };
    onBack: () => void;
  }) => (
    <div data-testid="student-correction-view">
      <span>{props.submissionId}</span>
      <span>{props.initialData.verificationTitle}</span>
      <button type="button" onClick={props.onBack}>
        stub-correction-back
      </button>
    </div>
  ),
}));

// OnlineExamView/ConfirmationView get their own dedicated test files for
// internal behavior — here they're stubbed so these tests stay focused on
// StudentVerificationsView's own routing (which view is shown, with what
// props) rather than re-testing the child views' internals.
vi.mock('../OnlineExamView.js', () => ({
  OnlineExamView: (props: { title: string; onSubmitted: (receipt: unknown) => void }) => (
    <div data-testid="online-exam-view">
      <span>{props.title}</span>
      <button
        type="button"
        onClick={() =>
          props.onSubmitted({
            submissionId: 'ver-online_student-uid',
            verificationId: 'ver-online',
            studentUid: 'student-uid',
            ownerUid: 'owner-uid',
            verificationTitle: props.title,
            className: 'Classe 3A',
            deliveryCode: 'SF-2026-STUB',
            submittedAt: { seconds: 200 },
          })
        }
      >
        stub-submit
      </button>
    </div>
  ),
}));
vi.mock('../ConfirmationView.js', () => ({
  ConfirmationView: (props: { receipt: { deliveryCode: string }; onBackToList: () => void }) => (
    <div data-testid="confirmation-view">
      <span>{props.receipt.deliveryCode}</span>
      <button type="button" onClick={props.onBackToList}>
        stub-back
      </button>
    </div>
  ),
}));

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  mockLoadStudentCorrectionReturns.mockResolvedValue([]);
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
  studentPdfEnabled: true,
};

const VERIFICATION_ONLINE = {
  id: 'ver-online',
  title: 'Verifica Online',
  className: 'Classe 3A',
  activatedAt: { seconds: 150 },
  questionCount: 1,
  questions: [{ order: 0, tipo: 'aperta' as const, maxPoints: 2, testo: 'Domanda?' }],
  onlineEnabled: true,
  studentPdfEnabled: true,
  ownerUid: 'owner-uid',
  status: 'active' as const,
};

const DRAFT_SUBMISSION = {
  submissionId: 'ver-online_student-uid',
  verificationId: 'ver-online',
  studentUid: 'student-uid',
  ownerUid: 'owner-uid',
  status: 'draft' as const,
  answers: {},
  flagged: {},
  attentionEvents: [],
  deliveryCode: null,
  verificationTitle: 'Verifica Online',
  className: 'Classe 3A',
  startedAt: { seconds: 140 },
  lastSavedAt: { seconds: 140 },
  submittedAt: null,
};

const RECEIPT = {
  submissionId: 'ver-online_student-uid',
  verificationId: 'ver-online',
  studentUid: 'student-uid',
  ownerUid: 'owner-uid',
  verificationTitle: 'Verifica Online',
  className: 'Classe 3A',
  deliveryCode: 'SF-2026-AAAA',
  submittedAt: { seconds: 200 },
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
    const [arg, student] = mockDownloadStudentPdfFromProjection.mock.calls[0] as [
      Record<string, unknown>,
      { displayName: string | null; email: string | null },
    ];
    expect(arg).not.toHaveProperty('soluzione');
    expect(JSON.stringify(arg)).not.toContain('poolStorageRef');
    // The signed-in Google identity is passed through for the PDF's
    // Nome e Cognome/Data prefill and filename — never persisted anywhere.
    expect(student).toEqual({ displayName: null, email: 's@test.com' });
  });

  it('renders the PDF action icon-only with a contextual accessible name and stable busy shell', async () => {
    mockLoadStudentVerifications.mockResolvedValue({
      status: 'ok',
      verifications: [VERIFICATION_A],
    });
    mockDownloadStudentPdfFromProjection.mockReturnValue(new Promise(() => {}));
    render(<StudentVerificationsView />);

    const button = await screen.findByRole('button', {
      name: 'Scarica PDF — Verifica Reti',
    });
    expect(button.getAttribute('title')).toBe('Scarica PDF — Verifica Reti');
    expect(button.textContent).toBe('');
    expect(button.querySelector('svg')).toBeTruthy();
    expect(screen.queryByText('Scarica PDF')).toBeNull();

    const className = button.className;
    fireEvent.click(button);

    await waitFor(() => expect(button.getAttribute('aria-busy')).toBe('true'));
    expect(button.className).toBe(className);
    expect(button.querySelector('.spinner')).toBeTruthy();
    expect(button.textContent).toBe('');
    expect(screen.queryByText('Generazione…')).toBeNull();
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

  it('does not show "Scarica PDF" when studentPdfEnabled is false or absent (legacy)', async () => {
    mockLoadStudentVerifications.mockResolvedValue({
      status: 'ok',
      verifications: [VERIFICATION_B],
    });
    render(<StudentVerificationsView />);

    await waitFor(() => screen.getByText('Verifica Basi di dati'));
    expect(screen.queryByRole('button', { name: /Scarica PDF/ })).toBeNull();
  });

  it('shows "Scarica PDF" only when studentPdfEnabled is true, independent of onlineEnabled', async () => {
    mockLoadStudentVerifications.mockResolvedValue({
      status: 'ok',
      verifications: [
        { ...VERIFICATION_A, id: 'ver-both', title: 'Entrambe', onlineEnabled: true },
        { ...VERIFICATION_B, id: 'ver-neither', title: 'Nessuna', studentPdfEnabled: false },
      ],
    });
    render(<StudentVerificationsView />);

    await waitFor(() => screen.getByText('Entrambe'));
    expect(screen.getByRole('button', { name: /Scarica PDF — Entrambe/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Scarica PDF — Nessuna/ })).toBeNull();
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

  describe('M3F-04 — online exam flow', () => {
    it('a paper-only verification (onlineEnabled false/absent) never shows an online button', async () => {
      mockLoadStudentVerifications.mockResolvedValue({
        status: 'ok',
        verifications: [VERIFICATION_A],
      });
      render(<StudentVerificationsView />);

      await waitFor(() => screen.getByText('Verifica Reti'));
      expect(screen.queryByRole('button', { name: /Svolgi online/ })).toBeNull();
      expect(screen.queryByRole('button', { name: /Riprendi bozza/ })).toBeNull();
    });

    it('shows "Svolgi online" once the receipt/submission check finds nothing', async () => {
      mockLoadStudentVerifications.mockResolvedValue({
        status: 'ok',
        verifications: [VERIFICATION_ONLINE],
      });
      mockLoadReceipt.mockResolvedValue(null);
      mockLoadSubmission.mockResolvedValue(null);
      render(<StudentVerificationsView />);

      const button = await screen.findByRole('button', {
        name: 'Svolgi online — Verifica Online',
      });
      expect(button.getAttribute('title')).toBe('Svolgi online — Verifica Online');
      expect(button.textContent).toBe('');
      expect(button.querySelector('svg')).toBeTruthy();
      expect(screen.queryByText('Svolgi online')).toBeNull();
      expect(mockLoadReceipt).toHaveBeenCalledWith('ver-online', 'student-uid', {});
    });

    it('renders "Riprendi bozza" as an icon-only action while preserving its handler contract', async () => {
      mockLoadStudentVerifications.mockResolvedValue({
        status: 'ok',
        verifications: [VERIFICATION_ONLINE],
      });
      mockLoadReceipt.mockResolvedValue(null);
      mockLoadSubmission
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(DRAFT_SUBMISSION)
        .mockResolvedValueOnce(DRAFT_SUBMISSION);
      render(<StudentVerificationsView />);

      const button = await screen.findByRole('button', {
        name: 'Riprendi bozza — Verifica Online',
      });
      expect(button.getAttribute('title')).toBe('Riprendi bozza — Verifica Online');
      expect(button.textContent).toBe('');
      expect(button.querySelector('svg')).toBeTruthy();
      expect(screen.queryByText('Riprendi bozza')).toBeNull();

      fireEvent.click(button);

      expect(mockRequestFullscreenBestEffort).toHaveBeenCalledOnce();
      await waitFor(() => expect(screen.getByTestId('online-exam-view')).toBeTruthy());
    });

    it('keeps a closed public verification downloadable but never startable or resumable', async () => {
      mockLoadStudentVerifications.mockResolvedValue({
        status: 'ok',
        verifications: [{ ...VERIFICATION_ONLINE, status: 'closed' }],
      });
      mockLoadReceipt.mockResolvedValue(null);
      render(<StudentVerificationsView />);

      await waitFor(() => expect(screen.getByText('Chiusa')).toBeTruthy());
      expect(screen.getByRole('button', { name: /Scarica PDF/ })).toBeTruthy();
      expect(screen.queryByRole('button', { name: /Svolgi online/ })).toBeNull();
      expect(screen.queryByRole('button', { name: /Riprendi bozza/ })).toBeNull();
      expect(mockLoadSubmission).not.toHaveBeenCalled();
    });

    it('checks the receipt before the submission when building the per-item list status, and skips the per-item submission check once a receipt is found', async () => {
      mockLoadStudentVerifications.mockResolvedValue({
        status: 'ok',
        verifications: [VERIFICATION_ONLINE],
      });
      mockLoadReceipt.mockResolvedValue(RECEIPT);
      render(<StudentVerificationsView />);

      await waitFor(() =>
        expect(
          screen.getByRole('button', { name: /Consegnata — Codice: SF-2026-AAAA/ }),
        ).toBeTruthy(),
      );
      const receiptButton = screen.getByRole('button', { name: /SF-2026-AAAA/ });
      expect(receiptButton.getAttribute('title')).toContain('SF-2026-AAAA');
      expect(receiptButton.textContent).toContain('Consegnata — Codice:');
      expect(receiptButton.textContent).toContain('SF-2026-AAAA');
      expect(receiptButton.parentElement?.className).toContain('statusControl');
      const code = receiptButton.querySelector('[title="SF-2026-AAAA"]');
      expect(code?.className).toContain('receiptCode');
      // The mandatory-session scan (findActiveDraftSession) still calls
      // loadSubmission once up front to rule out a draft — Security Rules
      // deny that get() once the submission is already `submitted`, which
      // resolves here (mocked) to `undefined`/no draft and the scan moves
      // on. The per-item list status check (checkOnlineStatus) is the one
      // that must skip its own submission check once the receipt is found.
      expect(mockLoadSubmission).toHaveBeenCalledTimes(1);
    });

    it('a draft submission auto-resumes directly into OnlineExamView — no manual click, no list flash (D-M3F-14)', async () => {
      mockLoadStudentVerifications.mockResolvedValue({
        status: 'ok',
        verifications: [VERIFICATION_ONLINE],
      });
      mockLoadReceipt.mockResolvedValue(null);
      mockLoadSubmission.mockResolvedValue(DRAFT_SUBMISSION);
      render(<StudentVerificationsView />);

      await waitFor(() => expect(screen.getByTestId('online-exam-view')).toBeTruthy());
      expect(screen.getByText('Verifica Online')).toBeTruthy();
      expect(screen.queryByRole('button', { name: /Riprendi bozza/ })).toBeNull();
      expect(screen.queryByRole('button', { name: /Svolgi online/ })).toBeNull();
    });

    it('reports the session as active via onSessionActiveChange while auto-resumed, and inactive again after submission', async () => {
      mockLoadStudentVerifications.mockResolvedValue({
        status: 'ok',
        verifications: [VERIFICATION_ONLINE],
      });
      mockLoadReceipt.mockResolvedValue(null);
      mockLoadSubmission.mockResolvedValue(DRAFT_SUBMISSION);
      const onSessionActiveChange = vi.fn();
      render(<StudentVerificationsView onSessionActiveChange={onSessionActiveChange} />);

      await waitFor(() => expect(onSessionActiveChange).toHaveBeenCalledWith(true));

      fireEvent.click(screen.getByText('stub-submit'));
      await waitFor(() => expect(onSessionActiveChange).toHaveBeenCalledWith(false));
    });

    it('clicking "Svolgi online" requests fullscreen, starts the submission and opens OnlineExamView', async () => {
      mockLoadStudentVerifications.mockResolvedValue({
        status: 'ok',
        verifications: [VERIFICATION_ONLINE],
      });
      mockLoadReceipt.mockResolvedValue(null);
      // 1st call: findActiveDraftSession (mandatory-session scan) — no draft yet.
      // 2nd call: checkOnlineStatus (per-item list status) — still no draft.
      // 3rd call: handleStartOrResume, right after startSubmission creates one.
      mockLoadSubmission
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(DRAFT_SUBMISSION);
      mockStartSubmission.mockResolvedValue(undefined);
      render(<StudentVerificationsView />);

      await waitFor(() =>
        expect(
          screen.getByRole('button', { name: 'Svolgi online — Verifica Online' }),
        ).toBeTruthy(),
      );
      fireEvent.click(screen.getByRole('button', { name: 'Svolgi online — Verifica Online' }));

      expect(mockRequestFullscreenBestEffort).toHaveBeenCalledOnce();
      await waitFor(() => expect(mockStartSubmission).toHaveBeenCalledOnce());
      await waitFor(() => expect(screen.getByTestId('online-exam-view')).toBeTruthy());
      expect(screen.getByText('Verifica Online')).toBeTruthy();
    });

    it('OnlineExamView onSubmitted shows ConfirmationView with the receipt', async () => {
      mockLoadStudentVerifications.mockResolvedValue({
        status: 'ok',
        verifications: [VERIFICATION_ONLINE],
      });
      mockLoadReceipt.mockResolvedValue(null);
      mockLoadSubmission.mockResolvedValue(DRAFT_SUBMISSION);
      mockStartSubmission.mockResolvedValue(undefined);
      render(<StudentVerificationsView />);

      await waitFor(() => expect(screen.getByTestId('online-exam-view')).toBeTruthy());

      fireEvent.click(screen.getByText('stub-submit'));
      await waitFor(() => expect(screen.getByTestId('confirmation-view')).toBeTruthy());
      expect(screen.getByText('SF-2026-STUB')).toBeTruthy();
    });

    it('clicking the delivered receipt button reopens ConfirmationView directly, without ever showing the exam form', async () => {
      mockLoadStudentVerifications.mockResolvedValue({
        status: 'ok',
        verifications: [VERIFICATION_ONLINE],
      });
      mockLoadReceipt.mockResolvedValue(RECEIPT);
      mockLoadSubmission.mockResolvedValue(null);
      render(<StudentVerificationsView />);

      await waitFor(() =>
        expect(
          screen.getByRole('button', { name: /Consegnata — Codice: SF-2026-AAAA/ }),
        ).toBeTruthy(),
      );
      fireEvent.click(screen.getByRole('button', { name: /Consegnata — Codice: SF-2026-AAAA/ }));

      await waitFor(() => expect(screen.getByTestId('confirmation-view')).toBeTruthy());
      expect(screen.queryByTestId('online-exam-view')).toBeNull();
    });

    it('ConfirmationView onBackToList returns to the verification list', async () => {
      mockLoadStudentVerifications.mockResolvedValue({
        status: 'ok',
        verifications: [VERIFICATION_ONLINE],
      });
      mockLoadReceipt.mockResolvedValue(RECEIPT);
      mockLoadSubmission.mockResolvedValue(null);
      render(<StudentVerificationsView />);

      await waitFor(() => expect(screen.getByRole('button', { name: /Consegnata/ })).toBeTruthy());
      fireEvent.click(screen.getByRole('button', { name: /Consegnata/ }));
      await waitFor(() => expect(screen.getByTestId('confirmation-view')).toBeTruthy());

      fireEvent.click(screen.getByText('stub-back'));
      await waitFor(() => expect(screen.queryByTestId('confirmation-view')).toBeNull());
      expect(screen.getByText('Verifica Online')).toBeTruthy();
    });

    it('shows a clear error when starting the online exam fails (closed/disabled verification)', async () => {
      mockLoadStudentVerifications.mockResolvedValue({
        status: 'ok',
        verifications: [VERIFICATION_ONLINE],
      });
      mockLoadReceipt.mockResolvedValue(null);
      mockLoadSubmission.mockResolvedValue(null);
      mockStartSubmission.mockRejectedValue(new Error('permission-denied'));
      render(<StudentVerificationsView />);

      await waitFor(() =>
        expect(
          screen.getByRole('button', { name: 'Svolgi online — Verifica Online' }),
        ).toBeTruthy(),
      );
      fireEvent.click(screen.getByRole('button', { name: 'Svolgi online — Verifica Online' }));

      await waitFor(() =>
        expect(
          screen.getByText(
            /Impossibile avviare la verifica online: verifica chiusa o disabilitata/,
          ),
        ).toBeTruthy(),
      );
    });

    it('a page refresh with a pending sessionStorage id and an existing receipt lands directly on ConfirmationView', async () => {
      sessionStorage.setItem('schoolforge:lastSubmittedVerificationId', 'ver-online');
      mockLoadStudentVerifications.mockResolvedValue({
        status: 'ok',
        verifications: [VERIFICATION_ONLINE],
      });
      mockLoadReceipt.mockResolvedValue(RECEIPT);

      render(<StudentVerificationsView />);

      await waitFor(() => expect(screen.getByTestId('confirmation-view')).toBeTruthy());
      expect(mockLoadReceipt).toHaveBeenCalledWith('ver-online', 'student-uid', {});
      expect(screen.queryByTestId('online-exam-view')).toBeNull();

      // "Torna alle verifiche" clears the pending id so a subsequent refresh
      // does not land back on the confirmation.
      fireEvent.click(screen.getByText('stub-back'));
      await waitFor(() =>
        expect(sessionStorage.getItem('schoolforge:lastSubmittedVerificationId')).toBeNull(),
      );
    });
  });
});

describe('StudentVerificationsView — Modalità verifica banner (M3F-07)', () => {
  it('shows the discreet notice when examModeActive is true', async () => {
    mockLoadStudentVerifications.mockResolvedValue({ status: 'ok', verifications: [] });
    render(<StudentVerificationsView examModeActive={true} />);

    await waitFor(() => expect(screen.getByRole('status')).toBeTruthy());
    expect(
      screen.getByText(/Modalità verifica attiva: le lezioni sono temporaneamente/),
    ).toBeTruthy();
  });

  it('does not show the notice by default', async () => {
    mockLoadStudentVerifications.mockResolvedValue({ status: 'ok', verifications: [] });
    render(<StudentVerificationsView />);

    await waitFor(() => screen.getByText(/Nessuna verifica pubblicata/));
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('still shows the online exam form on top of the banner condition — an in-progress session is never hidden', async () => {
    mockLoadStudentVerifications.mockResolvedValue({
      status: 'ok',
      verifications: [VERIFICATION_ONLINE],
    });
    mockLoadReceipt.mockResolvedValue(null);
    mockLoadSubmission.mockResolvedValue(DRAFT_SUBMISSION);
    render(<StudentVerificationsView examModeActive={true} />);

    await waitFor(() => expect(screen.getByTestId('online-exam-view')).toBeTruthy());
  });
});

describe('StudentVerificationsView — correction returns (M4-02B)', () => {
  const RETURN_A = {
    submissionId: 'ver-a_student-uid',
    correctionId: 'ver-a_student-uid',
    verificationId: 'ver-a',
    studentUid: 'student-uid',
    ownerUid: 'owner-uid',
    verificationTitle: 'Verifica Reti',
    className: 'Classe 3A',
    submittedAt: { seconds: 90 },
    returnedAt: { seconds: 300 },
    questions: [
      {
        order: 0,
        tipo: 'aperta' as const,
        testo: 'Descrivi il modello OSI.',
        studentAnswer: { tipo: 'aperta' as const, testo: 'risposta' },
        points: 2,
        maxPoints: 2,
      },
    ],
    generalFeedback: null,
    totalPoints: 2,
    maxPoints: 2,
    percentage: 100,
    visibleToStudent: true,
    solutionsVisible: false,
    updatedAt: { seconds: 300 },
  };

  it('shows "Vedi correzione" only for a verification with a loaded, visible return', async () => {
    mockLoadStudentVerifications.mockResolvedValue({
      status: 'ok',
      verifications: [VERIFICATION_A, VERIFICATION_B],
    });
    mockLoadStudentCorrectionReturns.mockResolvedValue([RETURN_A]);

    render(<StudentVerificationsView />);

    const button = await screen.findByRole('button', {
      name: 'Vedi correzione — Verifica Reti',
    });
    expect(button.getAttribute('title')).toBe('Vedi correzione — Verifica Reti');
    expect(button.textContent).toBe('');
    expect(button.querySelector('svg')).toBeTruthy();
    expect(screen.queryByText('Vedi correzione')).toBeNull();
    expect(
      screen.queryByRole('button', { name: /Vedi correzione — Verifica Basi di dati/ }),
    ).toBeNull();
  });

  it('does not show "Vedi correzione" when no return has been loaded', async () => {
    mockLoadStudentVerifications.mockResolvedValue({
      status: 'ok',
      verifications: [VERIFICATION_A],
    });
    mockLoadStudentCorrectionReturns.mockResolvedValue([]);

    render(<StudentVerificationsView />);

    await waitFor(() => expect(screen.getByText('Verifica Reti')).toBeTruthy());
    expect(screen.queryByRole('button', { name: /Vedi correzione/ })).toBeNull();
  });

  it('groups verifications into distinct sections: restituite, consegnate, disponibili', async () => {
    mockLoadStudentVerifications.mockResolvedValue({
      status: 'ok',
      verifications: [VERIFICATION_A, VERIFICATION_B],
    });
    mockLoadStudentCorrectionReturns.mockResolvedValue([RETURN_A]);

    render(<StudentVerificationsView />);

    await waitFor(() => expect(screen.getByText('Correzioni restituite')).toBeTruthy());
    expect(screen.getByText('Verifiche disponibili')).toBeTruthy();
  });

  it('clicking "Vedi correzione" opens the read-only StudentCorrectionView with the loaded projection', async () => {
    mockLoadStudentVerifications.mockResolvedValue({
      status: 'ok',
      verifications: [VERIFICATION_A],
    });
    mockLoadStudentCorrectionReturns.mockResolvedValue([RETURN_A]);

    render(<StudentVerificationsView />);

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Vedi correzione — Verifica Reti/ })).toBeTruthy(),
    );
    fireEvent.click(screen.getByRole('button', { name: /Vedi correzione — Verifica Reti/ }));

    await waitFor(() => expect(screen.getByTestId('student-correction-view')).toBeTruthy());
    expect(screen.getByText('ver-a_student-uid')).toBeTruthy();
  });

  it('returns to the list from the correction view', async () => {
    mockLoadStudentVerifications.mockResolvedValue({
      status: 'ok',
      verifications: [VERIFICATION_A],
    });
    mockLoadStudentCorrectionReturns.mockResolvedValue([RETURN_A]);

    render(<StudentVerificationsView />);

    await waitFor(() =>
      fireEvent.click(screen.getByRole('button', { name: /Vedi correzione — Verifica Reti/ })),
    );
    await waitFor(() => expect(screen.getByTestId('student-correction-view')).toBeTruthy());

    fireEvent.click(screen.getByText('stub-correction-back'));
    await waitFor(() => expect(screen.getByText('Verifica Reti')).toBeTruthy());
    expect(screen.queryByTestId('student-correction-view')).toBeNull();
  });

  it('a failure loading correction returns does not break the rest of the list', async () => {
    mockLoadStudentVerifications.mockResolvedValue({
      status: 'ok',
      verifications: [VERIFICATION_A],
    });
    mockLoadStudentCorrectionReturns.mockRejectedValue(new Error('boom'));

    render(<StudentVerificationsView />);

    await waitFor(() => expect(screen.getByText('Verifica Reti')).toBeTruthy());
    expect(screen.queryByRole('button', { name: /Vedi correzione/ })).toBeNull();
  });

  it('shows a returned correction even when its verification is no longer in the public list (closed/hidden)', async () => {
    mockLoadStudentVerifications.mockResolvedValue({
      status: 'ok',
      verifications: [VERIFICATION_B],
    });
    mockLoadStudentCorrectionReturns.mockResolvedValue([RETURN_A]);

    render(<StudentVerificationsView />);

    await waitFor(() => expect(screen.getByText('Correzioni restituite')).toBeTruthy());
    expect(screen.getByRole('button', { name: /Vedi correzione — Verifica Reti/ })).toBeTruthy();
    // Its own self-sufficient data still renders, independent of the (absent) verification item.
    expect(screen.getByText('Classe 3A')).toBeTruthy();
  });

  it('renders exactly one card when the returned correction still has a matching verification in the list', async () => {
    mockLoadStudentVerifications.mockResolvedValue({
      status: 'ok',
      verifications: [VERIFICATION_A],
    });
    mockLoadStudentCorrectionReturns.mockResolvedValue([RETURN_A]);

    render(<StudentVerificationsView />);

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Vedi correzione — Verifica Reti/ })).toBeTruthy(),
    );
    // Only one "Verifica Reti" heading — not duplicated into another section.
    expect(screen.getAllByText('Verifica Reti')).toHaveLength(1);
    expect(screen.queryByText('Consegne effettuate')).toBeNull();
  });

  it('does not also list a returned verification under "Consegne effettuate" or "Verifiche disponibili"', async () => {
    mockLoadStudentVerifications.mockResolvedValue({
      status: 'ok',
      verifications: [VERIFICATION_A, VERIFICATION_B],
    });
    mockLoadStudentCorrectionReturns.mockResolvedValue([RETURN_A]);

    render(<StudentVerificationsView />);

    await waitFor(() => expect(screen.getByText('Correzioni restituite')).toBeTruthy());
    // VERIFICATION_A (returned) shows once, in the "restituite" section only.
    expect(screen.getAllByText('Verifica Reti')).toHaveLength(1);
    // VERIFICATION_B (no return) still shows in "Verifiche disponibili".
    expect(screen.getByText('Verifica Basi di dati')).toBeTruthy();
  });
});
