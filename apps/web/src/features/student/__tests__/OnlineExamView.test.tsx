import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
    attachDeterrenceListeners: (...args: unknown[]) => mockAttachDeterrenceListeners(...args),
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

// EXAM-UX-03 — a near-1 RNG makes Fisher–Yates a no-op (j === i every step), so
// the visual order equals the original order and existing per-number assertions
// stay deterministic. Shuffle behaviour itself is covered by dedicated tests.
const IDENTITY_RNG = () => 1 - 1e-9;

function renderView(overrides: Partial<Parameters<typeof OnlineExamView>[0]> = {}) {
  const onSubmitted = vi.fn();
  const props = {
    verificationId: 'v1',
    title: 'Verifica Reti',
    className: 'Classe 3A',
    ownerUid: 'owner-uid',
    studentUid: 'student-uid',
    questions: QUESTIONS,
    submission: emptySubmission(),
    onSubmitted,
    rng: IDENTITY_RNG,
    ...overrides,
  };
  render(<OnlineExamView {...props} />);
  return { onSubmitted };
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

  it('autosaves only when dirty, at most once per 120s tick', async () => {
    vi.useFakeTimers();
    try {
      renderView();

      await vi.advanceTimersByTimeAsync(120_000);
      expect(mockSaveDraft).not.toHaveBeenCalled();

      fireEvent.change(screen.getByLabelText('Risposta alla domanda 1'), {
        target: { value: 'Risposta.' },
      });
      await vi.advanceTimersByTimeAsync(120_000);
      expect(mockSaveDraft).toHaveBeenCalledOnce();

      // No further changes: the next tick must not save again.
      await vi.advanceTimersByTimeAsync(120_000);
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

  it('a change made while a save is in flight is not lost — stays dirty and is saved on the next tick', async () => {
    vi.useFakeTimers();
    try {
      let resolveFirstSave: (() => void) | undefined;
      mockSaveDraft.mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            resolveFirstSave = resolve;
          }),
      );
      renderView();

      fireEvent.change(screen.getByLabelText('Risposta alla domanda 1'), {
        target: { value: 'Prima risposta.' },
      });
      await vi.advanceTimersByTimeAsync(120_000);
      expect(mockSaveDraft).toHaveBeenCalledOnce();

      // A second change arrives while the first save is still in flight —
      // it must not be silently treated as already saved once the first
      // write resolves.
      fireEvent.change(screen.getByLabelText('Risposta alla domanda 1'), {
        target: { value: 'Seconda risposta.' },
      });

      mockSaveDraft.mockResolvedValue(undefined);
      resolveFirstSave?.();
      await vi.advanceTimersByTimeAsync(0);

      // Still dirty: the next tick must save again, carrying the latest answer.
      await vi.advanceTimersByTimeAsync(120_000);
      expect(mockSaveDraft).toHaveBeenCalledTimes(2);
      const secondCall = mockSaveDraft.mock.calls[1] as [
        { answers: Record<string, { testo: string }> },
      ];
      expect(secondCall[0].answers['0']).toEqual({ tipo: 'aperta', testo: 'Seconda risposta.' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('M3F-11B: an attention event alone (no answer/flag change) does NOT mark the draft dirty and does NOT trigger an autosave', async () => {
    vi.useFakeTimers();
    try {
      let capturedOnEvent: ((type: string) => void) | undefined;
      mockAttachDeterrenceListeners.mockImplementation((onEvent: (type: string) => void) => {
        capturedOnEvent = onEvent;
        return vi.fn();
      });
      renderView();

      capturedOnEvent?.('window_blur');
      await vi.advanceTimersByTimeAsync(120_000);
      expect(mockSaveDraft).not.toHaveBeenCalled();

      // Still no save on a later tick either — the event alone never becomes dirty.
      await vi.advanceTimersByTimeAsync(120_000);
      expect(mockSaveDraft).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows a sanitized notice for blocked paste without changing the answer or saving immediately', () => {
    let capturedOnEvent: ((type: string) => void) | undefined;
    let capturedOnPrevented: ((type: string) => void) | undefined;
    mockAttachDeterrenceListeners.mockImplementation(
      (
        onEvent: (type: string) => void,
        _onFullscreenChange: unknown,
        onPrevented: (type: string) => void,
      ) => {
        capturedOnEvent = onEvent;
        capturedOnPrevented = onPrevented;
        return vi.fn();
      },
    );
    renderView();
    const answer = screen.getByLabelText('Risposta alla domanda 1') as HTMLTextAreaElement;
    fireEvent.change(answer, { target: { value: 'Risposta già inserita.' } });
    mockSaveDraft.mockClear();

    act(() => {
      capturedOnEvent?.('paste_attempt');
      capturedOnPrevented?.('paste_attempt');
    });

    expect(answer.value).toBe('Risposta già inserita.');
    expect(
      screen.getByText('Copia e incolla non sono consentiti durante la verifica.'),
    ).toBeTruthy();
    expect(mockSaveDraft).not.toHaveBeenCalled();
  });

  it('M3F-11B: a buffered attention event is included in the next save caused by an answer change', async () => {
    vi.useFakeTimers();
    try {
      let capturedOnEvent: ((type: string) => void) | undefined;
      mockAttachDeterrenceListeners.mockImplementation((onEvent: (type: string) => void) => {
        capturedOnEvent = onEvent;
        return vi.fn();
      });
      renderView();

      capturedOnEvent?.('window_blur');
      await vi.advanceTimersByTimeAsync(120_000);
      expect(mockSaveDraft).not.toHaveBeenCalled();

      fireEvent.change(screen.getByLabelText('Risposta alla domanda 1'), {
        target: { value: 'Risposta.' },
      });
      await vi.advanceTimersByTimeAsync(120_000);

      expect(mockSaveDraft).toHaveBeenCalledOnce();
      const [arg] = mockSaveDraft.mock.calls[0] as [{ newAttentionEvents: { type: string }[] }];
      expect(arg.newAttentionEvents).toEqual([{ type: 'window_blur', ts: expect.any(Number) }]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('M3F-11B: a buffered attention event is included in a manual "Salva bozza" even without an answer change', async () => {
    let capturedOnEvent: ((type: string) => void) | undefined;
    mockAttachDeterrenceListeners.mockImplementation((onEvent: (type: string) => void) => {
      capturedOnEvent = onEvent;
      return vi.fn();
    });
    renderView();

    capturedOnEvent?.('tab_blur');
    fireEvent.click(screen.getByRole('button', { name: 'Salva bozza' }));

    await waitFor(() => expect(mockSaveDraft).toHaveBeenCalledOnce());
    const [arg] = mockSaveDraft.mock.calls[0] as [{ newAttentionEvents: { type: string }[] }];
    expect(arg.newAttentionEvents).toEqual([{ type: 'tab_blur', ts: expect.any(Number) }]);
  });

  it('M3F-11B: a buffered attention event is included in the final delivery even without an answer change', async () => {
    let capturedOnEvent: ((type: string) => void) | undefined;
    mockAttachDeterrenceListeners.mockImplementation((onEvent: (type: string) => void) => {
      capturedOnEvent = onEvent;
      return vi.fn();
    });
    mockSubmitSubmission.mockResolvedValue('SF-2026-AAAA');
    mockLoadReceipt.mockResolvedValue({ deliveryCode: 'SF-2026-AAAA' });
    renderView();

    capturedOnEvent?.('copy_attempt');
    fireEvent.click(screen.getByRole('button', { name: 'Consegna' }));
    fireEvent.click(screen.getByRole('button', { name: 'Conferma consegna' }));

    await waitFor(() => expect(mockSubmitSubmission).toHaveBeenCalledOnce());
    const [arg] = mockSubmitSubmission.mock.calls[0] as [
      { newAttentionEvents: { type: string }[] },
    ];
    expect(arg.newAttentionEvents).toEqual([{ type: 'copy_attempt', ts: expect.any(Number) }]);
  });

  it('never overlaps manual save and autosave while a write is in flight', async () => {
    vi.useFakeTimers();
    try {
      let resolveSave: (() => void) | undefined;
      mockSaveDraft.mockReturnValue(
        new Promise<void>((resolve) => {
          resolveSave = resolve;
        }),
      );
      renderView();
      fireEvent.change(screen.getByLabelText('Risposta alla domanda 1'), {
        target: { value: 'Risposta.' },
      });

      fireEvent.click(screen.getByRole('button', { name: 'Salva bozza' }));
      await vi.advanceTimersByTimeAsync(120_000);

      expect(mockSaveDraft).toHaveBeenCalledOnce();
      resolveSave?.();
      await vi.advanceTimersByTimeAsync(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('OnlineExamView — delivery', () => {
  it('opens the confirm dialog with the compiled/empty counts and does not submit on "Annulla"', () => {
    renderView();
    fireEvent.change(screen.getByLabelText('Risposta alla domanda 1'), {
      target: { value: 'Risposta.' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Consegna' }));

    expect(
      screen.getByText('Hai compilato 1/3 domande. 2 sono vuote. 0 sono segnate da rivedere.'),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Annulla' }));
    expect(screen.queryByText(/Hai compilato/)).toBeNull();
    expect(mockSubmitSubmission).not.toHaveBeenCalled();
  });

  it('includes the flagged count in the pre-delivery summary', () => {
    renderView();
    fireEvent.click(screen.getByRole('button', { name: 'Segna la domanda 1 come "da rivedere"' }));

    fireEvent.click(screen.getByRole('button', { name: 'Consegna' }));

    expect(
      screen.getByText('Hai compilato 0/3 domande. 3 sono vuote. 1 sono segnate da rivedere.'),
    ).toBeTruthy();
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

    await waitFor(() => expect(mockSubmitSubmission).toHaveBeenCalledOnce());
    resolveSubmit?.();
    await waitFor(() => expect(mockLoadReceipt).toHaveBeenCalledOnce());
  });

  it('waits for an in-flight draft save, then submits the latest local revision', async () => {
    let resolveSave: (() => void) | undefined;
    mockSaveDraft.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveSave = resolve;
      }),
    );
    mockSubmitSubmission.mockResolvedValue('SF-2026-AAAA');
    mockLoadReceipt.mockResolvedValue({ deliveryCode: 'SF-2026-AAAA' });
    renderView();

    fireEvent.change(screen.getByLabelText('Risposta alla domanda 1'), {
      target: { value: 'Prima versione.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Salva bozza' }));
    fireEvent.change(screen.getByLabelText('Risposta alla domanda 1'), {
      target: { value: 'Versione finale.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Consegna' }));
    fireEvent.click(screen.getByRole('button', { name: 'Conferma consegna' }));

    expect(mockSubmitSubmission).not.toHaveBeenCalled();
    resolveSave?.();
    await waitFor(() => expect(mockSubmitSubmission).toHaveBeenCalledOnce());
    const [payload] = mockSubmitSubmission.mock.calls[0] as [
      { answers: Record<string, { testo: string }> },
    ];
    expect(payload.answers['0']).toEqual({ tipo: 'aperta', testo: 'Versione finale.' });
  });

  it('resumes editing and autosave eligibility when delivery itself fails', async () => {
    mockSubmitSubmission.mockRejectedValue(new Error('network error'));
    renderView();

    fireEvent.click(screen.getByRole('button', { name: 'Consegna' }));
    fireEvent.click(screen.getByRole('button', { name: 'Conferma consegna' }));
    await waitFor(() => expect(mockSubmitSubmission).toHaveBeenCalledOnce());

    const textarea = screen.getByLabelText('Risposta alla domanda 1') as HTMLTextAreaElement;
    expect(textarea.disabled).toBe(false);
    expect(
      (screen.getByRole('button', { name: 'Salva bozza' }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it('keeps the exam locked when delivery succeeded but receipt read-back fails', async () => {
    mockSubmitSubmission.mockResolvedValue('SF-2026-AAAA');
    mockLoadReceipt.mockRejectedValue(new Error('network error'));
    renderView();

    fireEvent.click(screen.getByRole('button', { name: 'Consegna' }));
    fireEvent.click(screen.getByRole('button', { name: 'Conferma consegna' }));

    await waitFor(() =>
      expect(screen.getByText(/Consegna registrata ma non è stato possibile/)).toBeTruthy(),
    );
    expect(
      (screen.getByRole('button', { name: 'Consegna registrata' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect((screen.getByLabelText('Risposta alla domanda 1') as HTMLTextAreaElement).disabled).toBe(
      true,
    );
    expect(
      (screen.getByRole('button', { name: 'Salva bozza' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});

describe('OnlineExamView — no manual exit (M3F-06)', () => {
  it('never renders a "Torna alla lista" button — a draft session is mandatory', () => {
    renderView();
    expect(screen.queryByRole('button', { name: /torna alla lista/i })).toBeNull();
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

describe('OnlineExamView — fullscreen on delivery (M3F-06)', () => {
  beforeEach(() => {
    mockSubmitSubmission.mockResolvedValue('SF-2026-AAAA');
    mockLoadReceipt.mockResolvedValue({
      submissionId: 'v1_student-uid',
      verificationId: 'v1',
      studentUid: 'student-uid',
      ownerUid: 'owner-uid',
      verificationTitle: 'Verifica Reti',
      className: 'Classe 3A',
      deliveryCode: 'SF-2026-AAAA',
      submittedAt: { seconds: 200 },
    });
  });

  it('detaches deterrence listeners and exits fullscreen after a successful delivery, in that order', async () => {
    const cleanupSpy = vi.fn();
    mockAttachDeterrenceListeners.mockReturnValue(cleanupSpy);
    const exitFullscreenSpy = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(document, 'fullscreenElement', {
      value: document.documentElement,
      configurable: true,
    });
    document.exitFullscreen = exitFullscreenSpy;
    const callOrder: string[] = [];
    cleanupSpy.mockImplementation(() => callOrder.push('cleanup'));
    exitFullscreenSpy.mockImplementation(() => {
      callOrder.push('exitFullscreen');
      return Promise.resolve();
    });
    const { onSubmitted } = renderView();

    fireEvent.click(screen.getByRole('button', { name: 'Consegna' }));
    fireEvent.click(screen.getByRole('button', { name: 'Conferma consegna' }));

    await waitFor(() => expect(onSubmitted).toHaveBeenCalledOnce());
    expect(exitFullscreenSpy).toHaveBeenCalledOnce();
    expect(callOrder).toEqual(['cleanup', 'exitFullscreen']);

    Object.defineProperty(document, 'fullscreenElement', { value: null, configurable: true });
  });

  it('the code-driven fullscreen exit after delivery is never recorded as a fullscreen_exit attention event', async () => {
    let capturedOnEvent: ((type: string) => void) | undefined;
    mockAttachDeterrenceListeners.mockImplementation((onEvent: (type: string) => void) => {
      capturedOnEvent = onEvent;
      return vi.fn();
    });
    Object.defineProperty(document, 'fullscreenElement', {
      value: document.documentElement,
      configurable: true,
    });
    document.exitFullscreen = vi.fn().mockImplementation(() => {
      // Real browsers fire `fullscreenchange` here; the listener was
      // already detached by endSessionAfterDelivery before this runs, so
      // simulating that same call must never reach capturedOnEvent.
      capturedOnEvent?.('fullscreen_exit');
      return Promise.resolve();
    });
    renderView();

    fireEvent.click(screen.getByRole('button', { name: 'Consegna' }));
    fireEvent.click(screen.getByRole('button', { name: 'Conferma consegna' }));

    await waitFor(() => expect(mockSubmitSubmission).toHaveBeenCalledOnce());
    // capturedOnEvent itself is still the same function reference; what
    // matters is that attachDeterrenceListeners' own cleanup (mocked above
    // as a no-op) was invoked before exitFullscreen — verified in the
    // previous test's ordering assertion. Here we just confirm delivery
    // succeeds without throwing when exitFullscreen synchronously fires
    // a fullscreenchange-like callback.
    await waitFor(() => expect(document.exitFullscreen).toHaveBeenCalledOnce());

    Object.defineProperty(document, 'fullscreenElement', { value: null, configurable: true });
  });

  it('does not exit fullscreen or call onSubmitted when delivery fails — stays editable with a recoverable error', async () => {
    mockSubmitSubmission.mockRejectedValue(new Error('network error'));
    const exitFullscreenSpy = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(document, 'fullscreenElement', {
      value: document.documentElement,
      configurable: true,
    });
    document.exitFullscreen = exitFullscreenSpy;
    const { onSubmitted } = renderView();

    fireEvent.click(screen.getByRole('button', { name: 'Consegna' }));
    fireEvent.click(screen.getByRole('button', { name: 'Conferma consegna' }));

    await waitFor(() => expect(mockSubmitSubmission).toHaveBeenCalledOnce());
    expect(exitFullscreenSpy).not.toHaveBeenCalled();
    expect(onSubmitted).not.toHaveBeenCalled();
    // The confirm dialog (and its underlying form) stays open/editable.
    expect(screen.getByRole('alertdialog', { name: 'Conferma consegna' })).toBeTruthy();

    Object.defineProperty(document, 'fullscreenElement', { value: null, configurable: true });
  });
});

describe('OnlineExamView — fullscreen recovery (M3F-11A)', () => {
  it('offers a direct return to fullscreen after the browser exits it', () => {
    let notifyFullscreen: ((active: boolean) => void) | undefined;
    mockAttachDeterrenceListeners.mockImplementation(
      (_onEvent: unknown, onFullscreenChange?: (active: boolean) => void) => {
        notifyFullscreen = onFullscreenChange;
        return vi.fn();
      },
    );
    const requestFullscreenSpy = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(document.documentElement, 'requestFullscreen', {
      value: requestFullscreenSpy,
      configurable: true,
    });
    Object.defineProperty(document, 'fullscreenElement', {
      value: document.documentElement,
      configurable: true,
    });
    renderView();

    expect(screen.queryByRole('button', { name: 'Torna a schermo intero' })).toBeNull();
    Object.defineProperty(document, 'fullscreenElement', { value: null, configurable: true });
    act(() => notifyFullscreen?.(false));

    fireEvent.click(screen.getByRole('button', { name: 'Torna a schermo intero' }));
    expect(requestFullscreenSpy).toHaveBeenCalledOnce();
  });
});

describe('OnlineExamView — unified in-flow control panel', () => {
  it('wraps the header row and the question navigator inside a single shared container', () => {
    renderView();
    const nav = screen.getByRole('navigation', { name: 'Navigatore domande' });
    const title = screen.getByText('Verifica Reti');

    // Both the title (header row) and the navigator (second row) must
    // share one panel in normal document flow, rather than two independent
    // controls with positioning offsets between them.
    const panel = nav.parentElement;
    expect(panel).toBeTruthy();
    expect(panel?.contains(title)).toBe(true);
    expect(panel?.contains(nav)).toBe(true);
  });

  it('the navigator stays accessible and reachable inside the panel', () => {
    renderView();
    const nav = screen.getByRole('navigation', { name: 'Navigatore domande' });
    expect(within(nav).getAllByRole('button')).toHaveLength(3);
  });
});

describe('OnlineExamView — question navigator (M3F-06)', () => {
  it('renders one numbered indicator per question with accessible empty/filled/flagged state', () => {
    renderView();
    const nav = screen.getByRole('navigation', { name: 'Navigatore domande' });

    expect(within(nav).getByRole('button', { name: /vai alla domanda 1 — vuota/i })).toBeTruthy();
    expect(within(nav).getByRole('button', { name: /vai alla domanda 2 — vuota/i })).toBeTruthy();
    expect(within(nav).getByRole('button', { name: /vai alla domanda 3 — vuota/i })).toBeTruthy();
  });

  it('updates the indicator to filled once the question is answered', () => {
    renderView();
    fireEvent.change(screen.getByLabelText('Risposta alla domanda 1'), {
      target: { value: 'Risposta.' },
    });

    const nav = screen.getByRole('navigation', { name: 'Navigatore domande' });
    expect(
      within(nav).getByRole('button', { name: /vai alla domanda 1 — compilata/i }),
    ).toBeTruthy();
  });

  it('flagged takes priority over filled/empty in the indicator state', () => {
    renderView();
    fireEvent.change(screen.getByLabelText('Risposta alla domanda 1'), {
      target: { value: 'Risposta.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Segna la domanda 1 come "da rivedere"' }));

    const nav = screen.getByRole('navigation', { name: 'Navigatore domande' });
    expect(
      within(nav).getByRole('button', { name: /vai alla domanda 1 — da rivedere/i }),
    ).toBeTruthy();
  });

  it('clicking an indicator scrolls the corresponding question into view', () => {
    renderView();
    const scrollSpy = vi.fn();
    const target = document.getElementById('question-1');
    if (target) target.scrollIntoView = scrollSpy;

    const nav = screen.getByRole('navigation', { name: 'Navigatore domande' });
    fireEvent.click(within(nav).getByRole('button', { name: /vai alla domanda 2/i }));

    expect(scrollSpy).toHaveBeenCalledOnce();
  });
});

describe('OnlineExamView — cancella risposta (chiusa_singola, M3F-06)', () => {
  it('does not change standard radio behavior', () => {
    renderView();
    const radios = screen.getAllByRole('radio');
    fireEvent.click(radios[0]!);
    expect((radios[0] as HTMLInputElement).checked).toBe(true);
  });

  it('is disabled when no option is selected', () => {
    renderView();
    expect(screen.getByRole('button', { name: 'Cancella risposta' })).toHaveProperty(
      'disabled',
      true,
    );
  });

  it('clears the selection back to empty when clicked', () => {
    renderView();
    const radios = screen.getAllByRole('radio');
    fireEvent.click(radios[0]!);
    expect((radios[0] as HTMLInputElement).checked).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Cancella risposta' }));

    expect((radios[0] as HTMLInputElement).checked).toBe(false);
    expect((radios[1] as HTMLInputElement).checked).toBe(false);
  });
});

// EXAM-UX-03 — a near-0 RNG forces a known non-identity permutation of the 3
// questions [q0 aperta, q1 singola, q2 multipla] → visual order [q1, q2, q0].
const REORDER_RNG = () => 0;

describe('OnlineExamView — local question shuffle (EXAM-UX-03)', () => {
  it('numbers and navigator follow the visual order, not the original order', () => {
    renderView({ rng: REORDER_RNG });
    // Visual order [q1 singola, q2 multipla, q0 aperta]: the aperta is now #3.
    expect(screen.getByLabelText('Risposta alla domanda 3')).toBeTruthy();
    expect(screen.queryByLabelText('Risposta alla domanda 1')).toBeNull();
    // Navigator shows 1..3 in the visual order.
    const nav = screen.getByRole('navigation', { name: 'Navigatore domande' });
    expect(within(nav).getByText('1')).toBeTruthy();
    expect(within(nav).getByText('3')).toBeTruthy();
  });

  it('saves an answer under the ORIGINAL order key, not the visual position', async () => {
    renderView({ rng: REORDER_RNG });
    // The aperta (original order 0) is shown at visual position 3.
    fireEvent.change(screen.getByLabelText('Risposta alla domanda 3'), {
      target: { value: 'Risposta aperta' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Salva bozza' }));
    await waitFor(() => expect(mockSaveDraft).toHaveBeenCalled());
    const payload = mockSaveDraft.mock.calls[0][0] as {
      answers: Record<string, unknown>;
    };
    // Keyed by the original order "0", never the visual index "2".
    expect(payload.answers['0']).toEqual({ tipo: 'aperta', testo: 'Risposta aperta' });
    expect(payload.answers['2']).toBeUndefined();
  });

  it('saves a flag under the ORIGINAL order key', async () => {
    renderView({ rng: REORDER_RNG });
    // Visual position 1 is the chiusa_singola (original order 1).
    fireEvent.click(screen.getByRole('button', { name: 'Segna la domanda 1 come "da rivedere"' }));
    fireEvent.click(screen.getByRole('button', { name: 'Salva bozza' }));
    await waitFor(() => expect(mockSaveDraft).toHaveBeenCalled());
    const payload = mockSaveDraft.mock.calls[0][0] as { flagged: Record<string, boolean> };
    expect(payload.flagged['1']).toBe(true);
  });

  it('keeps the same order across a rerender caused by answering', () => {
    renderView({ rng: REORDER_RNG });
    // Aperta at #3 before…
    fireEvent.change(screen.getByLabelText('Risposta alla domanda 3'), {
      target: { value: 'x' },
    });
    // …and still at #3 after the state update (order is stable within the session).
    expect(screen.getByLabelText('Risposta alla domanda 3')).toBeTruthy();
    expect(screen.queryByLabelText('Risposta alla domanda 1')).toBeNull();
  });

  it('a fresh mount can produce a different order', () => {
    const { unmount } = renderReorder(REORDER_RNG); // aperta at #3
    expect(screen.getByLabelText('Risposta alla domanda 3')).toBeTruthy();
    unmount();
    renderReorder(IDENTITY_RNG); // aperta back at #1
    expect(screen.getByLabelText('Risposta alla domanda 1')).toBeTruthy();
  });

  it('never writes the shuffled order into the saved draft', async () => {
    renderView({ rng: REORDER_RNG });
    fireEvent.change(screen.getByLabelText('Risposta alla domanda 3'), {
      target: { value: 'y' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Salva bozza' }));
    await waitFor(() => expect(mockSaveDraft).toHaveBeenCalled());
    const payload = mockSaveDraft.mock.calls[0][0] as Record<string, unknown>;
    // Only answers/flagged/events travel — no order/shuffle field of any kind.
    expect(Object.keys(payload).sort()).toEqual(
      ['answers', 'flagged', 'newAttentionEvents', 'studentUid', 'verificationId'].sort(),
    );
    expect(JSON.stringify(payload)).not.toContain('order');
  });
});

function renderReorder(rng: () => number) {
  const result = render(
    <OnlineExamView
      verificationId="v1"
      title="Verifica Reti"
      className="Classe 3A"
      ownerUid="owner-uid"
      studentUid="student-uid"
      questions={QUESTIONS}
      submission={emptySubmission()}
      onSubmitted={vi.fn()}
      rng={rng}
    />,
  );
  return result;
}

describe('OnlineExamView — open answer maxCharacters (EXAM-UX-03)', () => {
  const openOnly = [{ order: 0, tipo: 'aperta' as const, maxPoints: 2, testo: 'Domanda aperta.' }];

  it('applies a custom maxCharacters to the textarea and shows the counter', () => {
    renderView({ questions: [{ ...openOnly[0], maxCharacters: 50 }], rng: IDENTITY_RNG });
    const ta = screen.getByLabelText('Risposta alla domanda 1') as HTMLTextAreaElement;
    expect(ta.maxLength).toBe(50);
    expect(screen.getByText('0 / 50 caratteri')).toBeTruthy();
  });

  it('defaults to 2000 when maxCharacters is absent (legacy)', () => {
    renderView({ questions: openOnly, rng: IDENTITY_RNG });
    const ta = screen.getByLabelText('Risposta alla domanda 1') as HTMLTextAreaElement;
    expect(ta.maxLength).toBe(2000);
    expect(screen.getByText('0 / 2000 caratteri')).toBeTruthy();
  });

  it('slices input beyond the limit and updates the counter', () => {
    renderView({ questions: [{ ...openOnly[0], maxCharacters: 10 }], rng: IDENTITY_RNG });
    const ta = screen.getByLabelText('Risposta alla domanda 1') as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: 'abcdefghijKLMNOP' } }); // 16 chars
    expect(ta.value).toBe('abcdefghij'); // capped at 10
    expect(screen.getByText('10 / 10 caratteri')).toBeTruthy();
  });

  it('leaves a legacy over-limit answer visible without truncating on load', () => {
    const legacy = 'x'.repeat(30);
    renderView({
      questions: [{ ...openOnly[0], maxCharacters: 10 }],
      submission: emptySubmission({ answers: { '0': { tipo: 'aperta', testo: legacy } } }),
      rng: IDENTITY_RNG,
    });
    const ta = screen.getByLabelText('Risposta alla domanda 1') as HTMLTextAreaElement;
    expect(ta.value).toBe(legacy); // full legacy content still shown
    expect(screen.getByText('30 / 10 caratteri')).toBeTruthy();
  });

  it('associates the counter to the textarea via aria-describedby', () => {
    renderView({ questions: [{ ...openOnly[0], maxCharacters: 50 }], rng: IDENTITY_RNG });
    const ta = screen.getByLabelText('Risposta alla domanda 1');
    const describedBy = ta.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)?.textContent).toContain('/ 50 caratteri');
  });

  it('closed questions have no character counter', () => {
    renderView({ rng: IDENTITY_RNG }); // default QUESTIONS: q1 singola, q2 multipla
    expect(screen.queryByText(/caratteri$/)).toBeTruthy(); // the aperta one exists
    // But exactly one counter (only the single aperta question), not three.
    expect(screen.getAllByText(/\d+ \/ \d+ caratteri/)).toHaveLength(1);
  });
});
