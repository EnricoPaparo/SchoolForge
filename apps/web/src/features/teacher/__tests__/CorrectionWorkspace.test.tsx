import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(cleanup);

vi.mock('../../../lib/firebase.js', () => ({ db: {}, storage: {} }));

const mockLoadCorrectionWorkspace = vi.fn();
vi.mock('../../repository/corrections/correctionWorkspaceLoader.js', () => ({
  loadCorrectionWorkspace: (...args: unknown[]) => mockLoadCorrectionWorkspace(...args),
}));

const mockSaveCorrection = vi.fn();
const mockCompleteCorrection = vi.fn();
const mockReturnCorrection = vi.fn();
const mockReopenCorrection = vi.fn();
const mockSetReturnVisibleToStudent = vi.fn();
const mockSetSolutionsVisible = vi.fn();
vi.mock('../../repository/corrections/correctionsService.js', () => ({
  saveCorrection: (...args: unknown[]) => mockSaveCorrection(...args),
  completeCorrection: (...args: unknown[]) => mockCompleteCorrection(...args),
  returnCorrection: (...args: unknown[]) => mockReturnCorrection(...args),
  reopenCorrection: (...args: unknown[]) => mockReopenCorrection(...args),
  setReturnVisibleToStudent: (...args: unknown[]) => mockSetReturnVisibleToStudent(...args),
  setSolutionsVisible: (...args: unknown[]) => mockSetSolutionsVisible(...args),
}));

import { CorrectionWorkspace } from '../CorrectionWorkspace.js';

const OWNER_UID = 'owner-uid';
const SUBMISSION_ID = 'ver-1_student-1';

const teacherQuestions = [
  {
    order: 0,
    tipo: 'aperta' as const,
    maxPoints: 10,
    testo: 'Spiega il TCP.',
    soluzione: 'Risposta modello',
  },
  {
    order: 1,
    tipo: 'chiusa_singola' as const,
    maxPoints: 5,
    testo: 'Quale livello OSI?',
    opzioni: [
      { id: 'a', testo: 'Trasporto' },
      { id: 'b', testo: 'Rete' },
    ],
    soluzione: 'a',
  },
];

function makeSubmission(overrides: Record<string, unknown> = {}) {
  return {
    submissionId: SUBMISSION_ID,
    verificationId: 'ver-1',
    studentUid: 'student-1',
    ownerUid: OWNER_UID,
    status: 'submitted' as const,
    answers: {
      '0': { tipo: 'aperta', testo: 'Il TCP è un protocollo di trasporto affidabile.' },
      '1': { tipo: 'chiusa_singola', selectedId: 'a' },
    },
    flagged: {},
    attentionEvents: [],
    deliveryCode: 'SF-2026-AAAA',
    verificationTitle: 'Verifica reti',
    className: 'Classe 3A',
    startedAt: { seconds: 1, nanoseconds: 0 },
    lastSavedAt: { seconds: 2, nanoseconds: 0 },
    submittedAt: { seconds: 3, nanoseconds: 0 },
    ...overrides,
  };
}

function makeVerification(overrides: Record<string, unknown> = {}) {
  return {
    ownerUid: OWNER_UID,
    status: 'active' as const,
    config: {
      title: 'Verifica reti',
      classId: 'cls-1',
      programId: 'p1',
      importId: 'i1',
      questionRefs: [],
    },
    teacherSnapshot: {
      title: 'Verifica reti',
      classId: 'cls-1',
      className: 'Classe 3A',
      programId: 'p1',
      importId: 'i1',
      questionRefs: [],
      questions: teacherQuestions,
      activatedAt: { seconds: 1, nanoseconds: 0 },
    },
    activatedAt: { seconds: 1, nanoseconds: 0 },
    closedAt: null,
    ...overrides,
  };
}

function makeCorrection(overrides: Record<string, unknown> = {}) {
  return {
    submissionId: SUBMISSION_ID,
    verificationId: 'ver-1',
    studentUid: 'student-1',
    ownerUid: OWNER_UID,
    status: 'in_progress' as const,
    evaluations: {
      '0': { order: 0, points: null, maxPoints: 10 },
      '1': { order: 1, points: null, maxPoints: 5 },
    },
    generalFeedback: null,
    totalPoints: 0,
    maxPoints: 15,
    percentage: 0,
    createdAt: { seconds: 1, nanoseconds: 0 },
    updatedAt: { seconds: 1, nanoseconds: 0 },
    completedAt: null,
    returnedAt: null,
    reopenCount: 0,
    ...overrides,
  };
}

function makeWorkspaceData(
  overrides: {
    submission?: Record<string, unknown>;
    verification?: Record<string, unknown>;
    correction?: Record<string, unknown>;
    correctionReturn?: Record<string, unknown> | null;
  } = {},
) {
  return {
    submission: makeSubmission(overrides.submission),
    verification: makeVerification(overrides.verification),
    correction: makeCorrection(overrides.correction),
    correctionReturn: overrides.correctionReturn ?? null,
  };
}

function setupDefaults() {
  vi.clearAllMocks();
  mockLoadCorrectionWorkspace.mockResolvedValue(makeWorkspaceData());
  mockSaveCorrection.mockResolvedValue(undefined);
  mockCompleteCorrection.mockResolvedValue(undefined);
  mockReturnCorrection.mockResolvedValue(undefined);
  mockReopenCorrection.mockResolvedValue(undefined);
  mockSetReturnVisibleToStudent.mockResolvedValue(undefined);
  mockSetSolutionsVisible.mockResolvedValue(undefined);
}

function renderWorkspace(onClose = vi.fn()) {
  render(
    <CorrectionWorkspace
      submissionId={SUBMISSION_ID}
      ownerUid={OWNER_UID}
      studentName="Mario Rossi"
      onClose={onClose}
    />,
  );
  return { onClose };
}

describe('CorrectionWorkspace — loading and data', () => {
  it('shows a loading state, then question text/answer/solution once loaded', async () => {
    setupDefaults();
    renderWorkspace();

    expect(screen.getByText(/caricamento/i)).toBeTruthy();
    await waitFor(() => expect(screen.getByText('Spiega il TCP.')).toBeTruthy());
    expect(screen.getByText('Il TCP è un protocollo di trasporto affidabile.')).toBeTruthy();
    expect(screen.getByText('Risposta modello')).toBeTruthy();
    expect(mockLoadCorrectionWorkspace).toHaveBeenCalledTimes(1);
    expect(mockLoadCorrectionWorkspace).toHaveBeenCalledWith(SUBMISSION_ID, OWNER_UID, {});
  });

  it('shows a readable error when loading fails, without crashing', async () => {
    setupDefaults();
    mockLoadCorrectionWorkspace.mockRejectedValue(new Error('Consegna non trovata.'));
    renderWorkspace();

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByText(/consegna non trovata/i)).toBeTruthy();
  });

  it('does not call the loader more than once for a single mount (no polling/realtime)', async () => {
    setupDefaults();
    renderWorkspace();
    await waitFor(() => expect(screen.getByText('Spiega il TCP.')).toBeTruthy());

    await new Promise((r) => setTimeout(r, 50));
    expect(mockLoadCorrectionWorkspace).toHaveBeenCalledTimes(1);
  });
});

describe('CorrectionWorkspace — scoring input', () => {
  it('accepts 0 as a valid, distinct-from-unevaluated score', async () => {
    setupDefaults();
    renderWorkspace();
    await waitFor(() => expect(screen.getByText('Spiega il TCP.')).toBeTruthy());

    const pointsInput = screen.getByLabelText('Punteggio per la domanda 1');
    fireEvent.change(pointsInput, { target: { value: '0' } });

    expect(screen.queryByText(/deve essere un numero tra/i)).toBeNull();
    expect(screen.getByText('Salva correzione').closest('button')).toHaveProperty(
      'disabled',
      false,
    );
  });

  it('shows an immediate error for an out-of-range score and disables save', async () => {
    setupDefaults();
    renderWorkspace();
    await waitFor(() => expect(screen.getByText('Spiega il TCP.')).toBeTruthy());

    const pointsInput = screen.getByLabelText('Punteggio per la domanda 1');
    fireEvent.change(pointsInput, { target: { value: '999' } });

    expect(await screen.findByText(/deve essere un numero tra 0 e 10/i)).toBeTruthy();
    expect(screen.getByText('Salva correzione').closest('button')).toHaveProperty('disabled', true);
  });

  it('updates the summary panel live as scores are edited, before saving', async () => {
    setupDefaults();
    renderWorkspace();
    await waitFor(() => expect(screen.getByText('Spiega il TCP.')).toBeTruthy());

    // Nothing evaluated yet: live totals start at 0/15.
    expect(screen.getByText('0/15')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Punteggio per la domanda 1'), {
      target: { value: '8' },
    });
    fireEvent.click(screen.getByText('Successiva →'));
    fireEvent.change(screen.getByLabelText('Punteggio per la domanda 2'), {
      target: { value: '5' },
    });

    // Live summary reflects the unsaved edits immediately — no save call yet.
    expect(screen.getByText('13/15')).toBeTruthy();
    expect(screen.getByText('87%')).toBeTruthy();
    expect(mockSaveCorrection).not.toHaveBeenCalled();
  });

  it('shows an invalid-state banner and excludes the invalid score from the live total', async () => {
    setupDefaults();
    renderWorkspace();
    await waitFor(() => expect(screen.getByText('Spiega il TCP.')).toBeTruthy());

    fireEvent.change(screen.getByLabelText('Punteggio per la domanda 1'), {
      target: { value: '999' },
    });

    expect(await screen.findByText(/uno o più punteggi non sono validi/i)).toBeTruthy();
    // The invalid entry contributes nothing to the live total (treated as unevaluated).
    expect(screen.getByText('0/15')).toBeTruthy();
  });
});

describe('CorrectionWorkspace — question selection on load', () => {
  it('selects the first question in the frozen order set, not a hardcoded order 0', async () => {
    setupDefaults();
    mockLoadCorrectionWorkspace.mockResolvedValue(
      makeWorkspaceData({
        verification: {
          teacherSnapshot: {
            title: 'Verifica reti',
            classId: 'cls-1',
            className: 'Classe 3A',
            programId: 'p1',
            importId: 'i1',
            questionRefs: [],
            questions: [
              {
                order: 3,
                tipo: 'aperta',
                maxPoints: 10,
                testo: 'Domanda con order 3.',
                soluzione: 'x',
              },
              {
                order: 5,
                tipo: 'aperta',
                maxPoints: 5,
                testo: 'Domanda con order 5.',
                soluzione: 'y',
              },
            ],
            activatedAt: { seconds: 1, nanoseconds: 0 },
          },
        },
        correction: {
          evaluations: {
            '3': { order: 3, points: null, maxPoints: 10 },
            '5': { order: 5, points: null, maxPoints: 5 },
          },
          totalPoints: 0,
          maxPoints: 15,
          percentage: 0,
        },
      }),
    );

    renderWorkspace();

    expect(await screen.findByText('Domanda con order 3.')).toBeTruthy();
    expect(screen.getByText('Domanda 4')).toBeTruthy();
    expect(screen.queryByText('Domanda con order 5.')).toBeNull();
  });
});

describe('CorrectionWorkspace — dirty state and leave confirmation', () => {
  it('warns before leaving with unsaved changes, and stays open on cancel', async () => {
    setupDefaults();
    const { onClose } = renderWorkspace();
    await waitFor(() => expect(screen.getByText('Spiega il TCP.')).toBeTruthy());

    fireEvent.change(screen.getByLabelText('Punteggio per la domanda 1'), {
      target: { value: '7' },
    });
    expect(screen.getByText('Modifiche non salvate')).toBeTruthy();

    fireEvent.click(screen.getByText('← Torna alle consegne'));
    expect(await screen.findByText(/hai modifiche non salvate/i)).toBeTruthy();

    fireEvent.click(screen.getByText('Annulla'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes without saving when the user confirms leaving', async () => {
    setupDefaults();
    const { onClose } = renderWorkspace();
    await waitFor(() => expect(screen.getByText('Spiega il TCP.')).toBeTruthy());

    fireEvent.change(screen.getByLabelText('Punteggio per la domanda 1'), {
      target: { value: '7' },
    });
    fireEvent.click(screen.getByText('← Torna alle consegne'));
    fireEvent.click(await screen.findByText('Esci senza salvare'));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mockSaveCorrection).not.toHaveBeenCalled();
  });

  it('leaves immediately with no confirmation when there are no unsaved changes', async () => {
    setupDefaults();
    const { onClose } = renderWorkspace();
    await waitFor(() => expect(screen.getByText('Spiega il TCP.')).toBeTruthy());

    fireEvent.click(screen.getByText('← Torna alle consegne'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('CorrectionWorkspace — explicit save', () => {
  it('never calls saveCorrection without an explicit click', async () => {
    setupDefaults();
    renderWorkspace();
    await waitFor(() => expect(screen.getByText('Spiega il TCP.')).toBeTruthy());

    fireEvent.change(screen.getByLabelText('Punteggio per la domanda 1'), {
      target: { value: '7' },
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(mockSaveCorrection).not.toHaveBeenCalled();
  });

  it('saves exactly the edited evaluations and general feedback, then reloads', async () => {
    setupDefaults();
    renderWorkspace();
    await waitFor(() => expect(screen.getByText('Spiega il TCP.')).toBeTruthy());

    fireEvent.change(screen.getByLabelText('Punteggio per la domanda 1'), {
      target: { value: '8' },
    });
    fireEvent.change(screen.getByLabelText('Feedback generale'), {
      target: { value: 'Buon lavoro' },
    });

    mockLoadCorrectionWorkspace.mockResolvedValueOnce(
      makeWorkspaceData({
        correction: {
          evaluations: {
            '0': { order: 0, points: 8, maxPoints: 10 },
            '1': { order: 1, points: null, maxPoints: 5 },
          },
          totalPoints: 8,
          maxPoints: 15,
          percentage: 53,
          generalFeedback: 'Buon lavoro',
        },
      }),
    );

    fireEvent.click(screen.getByText('Salva correzione'));

    await waitFor(() => expect(mockSaveCorrection).toHaveBeenCalledTimes(1));
    const [input] = mockSaveCorrection.mock.calls[0]!;
    expect(input.submissionId).toBe(SUBMISSION_ID);
    expect(input.evaluations['0']).toEqual({ points: 8 });
    expect(input.evaluations['1']).toEqual({ points: null });
    expect(input.generalFeedback).toBe('Buon lavoro');

    await waitFor(() => expect(mockLoadCorrectionWorkspace).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByText('Modifiche non salvate')).toBeNull());
  });
});

describe('CorrectionWorkspace — completion gate', () => {
  it('disables "Completa correzione" while a question is unevaluated', async () => {
    setupDefaults();
    renderWorkspace();
    await waitFor(() => expect(screen.getByText('Spiega il TCP.')).toBeTruthy());

    expect(screen.getByText('Completa correzione').closest('button')).toHaveProperty(
      'disabled',
      true,
    );
  });

  it('enables completion once every question has a persisted score and nothing is dirty', async () => {
    setupDefaults();
    mockLoadCorrectionWorkspace.mockResolvedValue(
      makeWorkspaceData({
        correction: {
          evaluations: {
            '0': { order: 0, points: 8, maxPoints: 10 },
            '1': { order: 1, points: 5, maxPoints: 5 },
          },
          totalPoints: 13,
          maxPoints: 15,
          percentage: 87,
        },
      }),
    );
    renderWorkspace();
    await waitFor(() => expect(screen.getByText('Spiega il TCP.')).toBeTruthy());

    expect(screen.getByText('Completa correzione').closest('button')).toHaveProperty(
      'disabled',
      false,
    );
  });

  it('completes only after explicit confirmation', async () => {
    setupDefaults();
    mockLoadCorrectionWorkspace.mockResolvedValue(
      makeWorkspaceData({
        correction: {
          evaluations: {
            '0': { order: 0, points: 8, maxPoints: 10 },
            '1': { order: 1, points: 5, maxPoints: 5 },
          },
        },
      }),
    );
    renderWorkspace();
    await waitFor(() => expect(screen.getByText('Spiega il TCP.')).toBeTruthy());

    fireEvent.click(screen.getByText('Completa correzione'));
    expect(mockCompleteCorrection).not.toHaveBeenCalled();

    const dialog = await screen.findByRole('alertdialog', { name: /conferma completamento/i });
    mockLoadCorrectionWorkspace.mockResolvedValueOnce(
      makeWorkspaceData({ correction: { status: 'completed' } }),
    );
    fireEvent.click(within(dialog).getByText('Conferma'));

    await waitFor(() => expect(mockCompleteCorrection).toHaveBeenCalledWith(SUBMISSION_ID, {}));
    await waitFor(() => expect(screen.getByText('Corretta')).toBeTruthy());
  });
});

describe('CorrectionWorkspace — completed state actions', () => {
  it('offers Riapri and Restituisci, and returns on click', async () => {
    setupDefaults();
    mockLoadCorrectionWorkspace.mockResolvedValue(
      makeWorkspaceData({ correction: { status: 'completed' } }),
    );
    renderWorkspace();
    await waitFor(() => expect(screen.getByText('Spiega il TCP.')).toBeTruthy());

    expect(screen.getByText('Riapri')).toBeTruthy();
    mockLoadCorrectionWorkspace.mockResolvedValueOnce(
      makeWorkspaceData({
        correction: { status: 'returned' },
        correctionReturn: { visibleToStudent: true, solutionsVisible: false },
      }),
    );
    fireEvent.click(screen.getByText('Restituisci allo studente'));

    await waitFor(() => expect(mockReturnCorrection).toHaveBeenCalledWith(SUBMISSION_ID, {}));
    await waitFor(() => expect(screen.getByText('Restituita')).toBeTruthy());
  });

  it('reopening requires confirmation', async () => {
    setupDefaults();
    mockLoadCorrectionWorkspace.mockResolvedValue(
      makeWorkspaceData({ correction: { status: 'completed' } }),
    );
    renderWorkspace();
    await waitFor(() => expect(screen.getByText('Spiega il TCP.')).toBeTruthy());

    fireEvent.click(screen.getByText('Riapri'));
    expect(mockReopenCorrection).not.toHaveBeenCalled();

    const dialog = await screen.findByRole('alertdialog', { name: /conferma riapertura/i });
    mockLoadCorrectionWorkspace.mockResolvedValueOnce(
      makeWorkspaceData({ correction: { status: 'in_progress', reopenCount: 1 } }),
    );
    fireEvent.click(within(dialog).getByText('Conferma'));

    await waitFor(() => expect(mockReopenCorrection).toHaveBeenCalledWith(SUBMISSION_ID, {}));
  });
});

describe('CorrectionWorkspace — returned state toggles', () => {
  it('toggles visibleToStudent and solutionsVisible via the dedicated service calls', async () => {
    setupDefaults();
    mockLoadCorrectionWorkspace.mockResolvedValue(
      makeWorkspaceData({
        correction: { status: 'returned' },
        correctionReturn: { visibleToStudent: true, solutionsVisible: false },
      }),
    );
    renderWorkspace();
    await waitFor(() => expect(screen.getByText('Spiega il TCP.')).toBeTruthy());

    mockLoadCorrectionWorkspace.mockResolvedValueOnce(
      makeWorkspaceData({
        correction: { status: 'returned' },
        correctionReturn: { visibleToStudent: false, solutionsVisible: false },
      }),
    );
    fireEvent.click(screen.getByLabelText('Visibile allo studente'));
    await waitFor(() =>
      expect(mockSetReturnVisibleToStudent).toHaveBeenCalledWith(SUBMISSION_ID, false, {}),
    );

    mockLoadCorrectionWorkspace.mockResolvedValueOnce(
      makeWorkspaceData({
        correction: { status: 'returned' },
        correctionReturn: { visibleToStudent: false, solutionsVisible: true },
      }),
    );
    fireEvent.click(screen.getByLabelText('Mostra soluzioni'));
    await waitFor(() =>
      expect(mockSetSolutionsVisible).toHaveBeenCalledWith(SUBMISSION_ID, true, {}),
    );
  });

  it('warns that reopening hides the current return immediately', async () => {
    setupDefaults();
    mockLoadCorrectionWorkspace.mockResolvedValue(
      makeWorkspaceData({
        correction: { status: 'returned' },
        correctionReturn: { visibleToStudent: true, solutionsVisible: false },
      }),
    );
    renderWorkspace();
    await waitFor(() => expect(screen.getByText('Spiega il TCP.')).toBeTruthy());

    expect(screen.getByText(/riaprire nasconderà subito la restituzione/i)).toBeTruthy();
  });
});
