import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OnlineExamView } from '../OnlineExamView.js';
import type { SubmissionDoc } from '../../../types/firestore.js';
import type * as ExamDeterrenceModule from '../examDeterrence.js';

vi.mock('../../../lib/firebase.js', () => ({ db: {} }));

const mockSaveDraft = vi.fn();
const mockSubmitSubmission = vi.fn();
const mockLoadReceipt = vi.fn();
vi.mock('../submissionsService.js', () => ({
  saveDraft: (...args: unknown[]) => mockSaveDraft(...args),
  submitSubmission: (...args: unknown[]) => mockSubmitSubmission(...args),
  loadReceipt: (...args: unknown[]) => mockLoadReceipt(...args),
}));

const mockAttachDeterrenceListeners = vi.fn();
vi.mock('../examDeterrence.js', async () => {
  const actual = await vi.importActual<typeof ExamDeterrenceModule>('../examDeterrence.js');
  return {
    ...actual,
    attachDeterrenceListeners: (onEvent: unknown) => mockAttachDeterrenceListeners(onEvent),
  };
});

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  mockAttachDeterrenceListeners.mockReturnValue(vi.fn());
  mockSaveDraft.mockResolvedValue(undefined);
});

const QUESTIONS = [
  { order: 0, tipo: 'aperta' as const, maxPoints: 2, testo: 'Descrivi il modello OSI.' },
  {
    order: 1,
    tipo: 'chiusa_singola' as const,
    maxPoints: 1,
    testo: 'Livello di routing?',
    opzioni: [
      { id: 'a', testo: 'Rete' },
      { id: 'b', testo: 'Trasporto' },
    ],
  },
  {
    order: 2,
    tipo: 'chiusa_multipla' as const,
    maxPoints: 1,
    testo: 'Protocolli di trasporto?',
    opzioni: [
      { id: 'a', testo: 'TCP' },
      { id: 'b', testo: 'UDP' },
      { id: 'c', testo: 'HTTP' },
    ],
  },
];

function emptySubmission(overrides: Partial<SubmissionDoc> = {}): SubmissionDoc {
  return {
    submissionId: 'v1_student-uid',
    verificationId: 'v1',
    studentUid: 'student-uid',
    ownerUid: 'owner-uid',
    status: 'draft',
    answers: {},
    flagged: {},
    attentionEvents: [],
    deliveryCode: null,
    verificationTitle: 'Verifica Reti',
    className: 'Classe 3A',
    startedAt: { seconds: 100 } as never,
    lastSavedAt: { seconds: 100 } as never,
    submittedAt: null,
    ...overrides,
  };
}

function renderView(overrides: Partial<Parameters<typeof OnlineExamView>[0]> = {}) {
  const onExit = vi.fn();
  const onSubmitted = vi.fn();
  const props = {
    verificationId: 'v1',
    title: 'Verifica Reti',
    className: 'Classe 3A',
    ownerUid: 'owner-uid',
    studentUid: 'student-uid',
    questions: QUESTIONS,
    submission: emptySubmission(),
    onExit,
    onSubmitted,
    ...overrides,
  };
  render(<OnlineExamView {...props} />);
  return { onExit, onSubmitted };
}

describe('OnlineExamView — question rendering', () => {
  it('renders aperta as a textarea, chiusa_singola as radios, chiusa_multipla as checkboxes', () => {
    renderView();

    expect(screen.getByLabelText('Risposta alla domanda 1')).toBeTruthy();
    expect((screen.getByLabelText('Risposta alla domanda 1') as HTMLTextAreaElement).tagName).toBe(
      'TEXTAREA',
    );
    expect(screen.getAllByRole('radio')).toHaveLength(2);
    expect(screen.getAllByRole('checkbox')).toHaveLength(3);
  });

  it('shows "Non compilata" for every question initially and "Compilata" once answered', () => {
    renderView();
    expect(screen.getAllByText('○ Non compilata')).toHaveLength(3);

    fireEvent.change(screen.getByLabelText('Risposta alla domanda 1'), {
      target: { value: 'Il modello OSI ha 7 livelli.' },
    });

    expect(screen.getAllByText('○ Non compilata')).toHaveLength(2);
    expect(screen.getByText('● Compilata')).toBeTruthy();
  });

  it('pre-fills existing draft answers on resume', () => {
    renderView({
      submission: emptySubmission({
        answers: { '0': { tipo: 'aperta', testo: 'Risposta salvata.' } },
      }),
    });

    expect((screen.getByLabelText('Risposta alla domanda 1') as HTMLTextAreaElement).value).toBe(
      'Risposta salvata.',
    );
    expect(screen.getByText('● Compilata')).toBeTruthy();
  });

  it('toggles the "da rivedere" marker', () => {
    renderView();
    const flagBtn = screen.getByRole('button', {
      name: 'Segna la domanda 1 come "da rivedere"',
    });

    fireEvent.click(flagBtn);

    expect(screen.getByText('⚑ Da rivedere')).toBeTruthy();
  });

  it('shows the compiled/total progress indicator', () => {
    renderView();
    expect(screen.getByText('0/3 compilate')).toBeTruthy();

    fireEvent.click(screen.getAllByRole('radio')[0]!);

    expect(screen.getByText('1/3 compilate')).toBeTruthy();
  });
});

describe('OnlineExamView — saving', () => {
  it('clicking "Salva bozza" calls saveDraft with the current answers/flagged', async () => {
    renderView();
    fireEvent.change(screen.getByLabelText('Risposta alla domanda 1'), {
      target: { value: 'Risposta.' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Salva bozza' }));

    await waitFor(() => expect(mockSaveDraft).toHaveBeenCalledOnce());
    const [arg] = mockSaveDraft.mock.calls[0] as [
      { verificationId: string; studentUid: string; answers: Record<string, unknown> },
    ];
    expect(arg.verificationId).toBe('v1');
    expect(arg.studentUid).toBe('student-uid');
    expect(arg.answers['0']).toEqual({ tipo: 'aperta', testo: 'Risposta.' });
    await waitFor(() => expect(screen.getByText(/Bozza salvata alle/)).toBeTruthy());
  });

  it('shows a clear error when saveDraft fails (closed/disabled verification)', async () => {
    mockSaveDraft.mockRejectedValue({ code: 'permission-denied' });
    renderView();

    fireEvent.click(screen.getByRole('button', { name: 'Salva bozza' }));

    await waitFor(() =>
      expect(
        screen.getByText(/la verifica potrebbe essere stata chiusa o disabilitata/),
      ).toBeTruthy(),
    );
  });

  it('autosaves only when dirty, at most once per 30s tick', async () => {
    vi.useFakeTimers();
    try {
      renderView();

      await vi.advanceTimersByTimeAsync(30_000);
      expect(mockSaveDraft).not.toHaveBeenCalled();

      fireEvent.change(screen.getByLabelText('Risposta alla domanda 1'), {
        target: { value: 'Risposta.' },
      });
      await vi.advanceTimersByTimeAsync(30_000);
      expect(mockSaveDraft).toHaveBeenCalledOnce();

      // No further changes: the next tick must not save again.
      await vi.advanceTimersByTimeAsync(30_000);
      expect(mockSaveDraft).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it('respects the 200-event budget: sends no more than the remaining room', async () => {
    const nearCapSubmission = emptySubmission({
      attentionEvents: Array.from({ length: 199 }, (_, i) => ({
        type: 'window_blur' as const,
        ts: i,
      })),
    });
    let capturedOnEvent: ((type: string) => void) | undefined;
    mockAttachDeterrenceListeners.mockImplementation((onEvent: (type: string) => void) => {
      capturedOnEvent = onEvent;
      return vi.fn();
    });
    renderView({ submission: nearCapSubmission });

    // Fire 5 events — only 1 has room under the 200 cap.
    for (let i = 0; i < 5; i++) capturedOnEvent?.('window_blur');

    fireEvent.click(screen.getByRole('button', { name: 'Salva bozza' }));

    await waitFor(() => expect(mockSaveDraft).toHaveBeenCalledOnce());
    const [arg] = mockSaveDraft.mock.calls[0] as [{ newAttentionEvents: unknown[] }];
    expect(arg.newAttentionEvents).toHaveLength(1);
  });
});

describe('OnlineExamView — delivery', () => {
  it('opens the confirm dialog with the compiled/empty counts and does not submit on "Annulla"', () => {
    renderView();
    fireEvent.change(screen.getByLabelText('Risposta alla domanda 1'), {
      target: { value: 'Risposta.' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Consegna' }));

    expect(screen.getByText('Hai compilato 1/3 domande. 2 sono vuote.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Annulla' }));
    expect(screen.queryByText(/Hai compilato/)).toBeNull();
    expect(mockSubmitSubmission).not.toHaveBeenCalled();
  });

  it('"Conferma consegna" submits, loads the receipt and calls onSubmitted', async () => {
    mockSubmitSubmission.mockResolvedValue('SF-2026-AAAA');
    const receipt = {
      submissionId: 'v1_student-uid',
      verificationId: 'v1',
      studentUid: 'student-uid',
      ownerUid: 'owner-uid',
      verificationTitle: 'Verifica Reti',
      className: 'Classe 3A',
      deliveryCode: 'SF-2026-AAAA',
      submittedAt: { seconds: 200 },
    };
    mockLoadReceipt.mockResolvedValue(receipt);
    const { onSubmitted } = renderView();

    fireEvent.click(screen.getByRole('button', { name: 'Consegna' }));
    fireEvent.click(screen.getByRole('button', { name: 'Conferma consegna' }));

    await waitFor(() => expect(mockSubmitSubmission).toHaveBeenCalledOnce());
    await waitFor(() => expect(onSubmitted).toHaveBeenCalledWith(receipt));
  });

  it('disables the confirm button while submitting to prevent a double delivery', async () => {
    let resolveSubmit: (() => void) | undefined;
    mockSubmitSubmission.mockReturnValue(
      new Promise<string>((resolve) => {
        resolveSubmit = () => resolve('SF-2026-AAAA');
      }),
    );
    mockLoadReceipt.mockResolvedValue({ deliveryCode: 'SF-2026-AAAA' });
    renderView();

    fireEvent.click(screen.getByRole('button', { name: 'Consegna' }));
    const confirmBtn = screen.getByRole('button', { name: 'Conferma consegna' });
    fireEvent.click(confirmBtn);
    fireEvent.click(confirmBtn);

    expect(mockSubmitSubmission).toHaveBeenCalledOnce();
    resolveSubmit?.();
    await waitFor(() => expect(mockLoadReceipt).toHaveBeenCalledOnce());
  });
});

describe('OnlineExamView — exit and cleanup', () => {
  it('exits immediately when there are no unsaved changes', () => {
    const confirmSpy = vi.spyOn(window, 'confirm');
    const { onExit } = renderView();

    fireEvent.click(screen.getByRole('button', { name: 'Torna alla lista' }));

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(onExit).toHaveBeenCalledOnce();
  });

  it('asks for confirmation before exiting with unsaved changes, and respects Annulla', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { onExit } = renderView();
    fireEvent.change(screen.getByLabelText('Risposta alla domanda 1'), {
      target: { value: 'Risposta.' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Torna alla lista' }));

    expect(confirmSpy).toHaveBeenCalledOnce();
    expect(onExit).not.toHaveBeenCalled();
  });

  it('exits when the unsaved-changes confirmation is accepted', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { onExit } = renderView();
    fireEvent.change(screen.getByLabelText('Risposta alla domanda 1'), {
      target: { value: 'Risposta.' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Torna alla lista' }));

    expect(onExit).toHaveBeenCalledOnce();
  });

  it('removes the deterrence listeners on unmount', () => {
    const cleanupSpy = vi.fn();
    mockAttachDeterrenceListeners.mockReturnValue(cleanupSpy);
    renderView();

    expect(cleanupSpy).not.toHaveBeenCalled();
    cleanup();
    expect(cleanupSpy).toHaveBeenCalledOnce();
  });
});
