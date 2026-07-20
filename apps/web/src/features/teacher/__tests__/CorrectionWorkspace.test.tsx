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

import { CorrectionWorkspace, resizeTextareaToContent } from '../CorrectionWorkspace.js';

const OWNER_UID = 'owner-uid';
const SUBMISSION_ID = 'ver-1_student-1';

describe('CorrectionWorkspace — expanding content', () => {
  it('auto-resizes feedback textareas without an internal vertical scrollbar', () => {
    const textarea = document.createElement('textarea');
    Object.defineProperty(textarea, 'scrollHeight', { value: 240, configurable: true });
    resizeTextareaToContent(textarea);
    expect(textarea.style.height).toBe('240px');
    expect(textarea.style.overflowY).toBe('hidden');
  });
});

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

/** Canonical questions the loader would build from a verification's snapshot. */
function questionsFromVerification(verification: {
  teacherSnapshot?: { questions?: Record<string, unknown>[] };
}) {
  const snapshotQuestions = verification.teacherSnapshot?.questions ?? [];
  return [...snapshotQuestions]
    .sort((a, b) => (a.order as number) - (b.order as number))
    .map((q) => ({ ...q, solutionUnavailable: false }));
}

function makeWorkspaceData(
  overrides: {
    submission?: Record<string, unknown>;
    verification?: Record<string, unknown>;
    correction?: Record<string, unknown>;
    correctionReturn?: Record<string, unknown> | null;
    questions?: Record<string, unknown>[];
  } = {},
) {
  const verification = makeVerification(overrides.verification);
  return {
    submission: makeSubmission(overrides.submission),
    verification,
    correction: makeCorrection(overrides.correction),
    questions: overrides.questions ?? questionsFromVerification(verification),
    correctionReturn: overrides.correctionReturn ?? null,
  };
}

/**
 * Echoes the persisted, normalized result `saveCorrection` now returns, built
 * from the save input (default question maxPoints: order 0 → 10, order 1 → 5).
 */
function saveResultFromInput(input: {
  evaluations: Record<string, { points: number | null; feedback?: string }>;
  generalFeedback: string | null;
}) {
  const maxByKey: Record<string, number> = { '0': 10, '1': 5 };
  const evaluations: Record<string, unknown> = {};
  let totalPoints = 0;
  let maxPoints = 0;
  for (const [key, v] of Object.entries(input.evaluations)) {
    const mp = maxByKey[key] ?? 0;
    evaluations[key] = {
      order: Number(key),
      points: v.points,
      maxPoints: mp,
      ...(v.feedback !== undefined ? { feedback: v.feedback } : {}),
    };
    if (v.points !== null) totalPoints += v.points;
    maxPoints += mp;
  }
  return {
    evaluations,
    generalFeedback: input.generalFeedback,
    totalPoints,
    maxPoints,
    percentage: maxPoints > 0 ? Math.round((totalPoints / maxPoints) * 100) : null,
  };
}

function setupDefaults() {
  vi.clearAllMocks();
  mockLoadCorrectionWorkspace.mockResolvedValue(makeWorkspaceData());
  mockSaveCorrection.mockImplementation(async (input: Parameters<typeof saveResultFromInput>[0]) =>
    saveResultFromInput(input),
  );
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

async function renderSingleChoice(solution: string | string[] | null, selectedId: string) {
  setupDefaults();
  mockLoadCorrectionWorkspace.mockResolvedValue(
    makeWorkspaceData({
      questions: [
        {
          order: 0,
          tipo: 'chiusa_singola',
          maxPoints: 3,
          testo: 'Quale opzione è corretta?',
          opzioni: [
            { id: 'a', testo: 'Alpha' },
            { id: 'b', testo: 'Beta' },
          ],
          soluzione: solution,
          solutionUnavailable: false,
        },
      ],
      submission: {
        answers: { '0': { tipo: 'chiusa_singola', selectedId } },
      },
      correction: {
        evaluations: { '0': { order: 0, points: null, maxPoints: 3 } },
      },
    }),
  );
  renderWorkspace();
  await waitFor(() => expect(screen.getByText('Quale opzione è corretta?')).toBeTruthy());

  const answerLabel = screen.getByText('Risposta consegnata');
  const answerBlock = answerLabel.parentElement as HTMLElement;
  const alphaRow = within(answerBlock).getByText('Alpha').closest('li') as HTMLElement;
  const betaRow = within(answerBlock).getByText('Beta').closest('li') as HTMLElement;
  const solutionLabel = screen.getByText('Soluzione (visibile solo al docente)');
  const solutionBlock = solutionLabel.parentElement as HTMLElement;
  return { alphaRow, betaRow, solutionBlock };
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

  it('legacy verification: shows question text but declares the solution unavailable', async () => {
    setupDefaults();
    mockLoadCorrectionWorkspace.mockResolvedValue(
      makeWorkspaceData({
        questions: [
          {
            order: 0,
            tipo: 'aperta',
            maxPoints: 10,
            testo: 'Domanda storica.',
            soluzione: null,
            solutionUnavailable: true,
          },
          {
            order: 1,
            tipo: 'aperta',
            maxPoints: 5,
            testo: 'Seconda domanda storica.',
            soluzione: null,
            solutionUnavailable: true,
          },
        ],
      }),
    );
    renderWorkspace();

    // Question text from the projection is visible.
    await waitFor(() => expect(screen.getByText('Domanda storica.')).toBeTruthy());
    // The solution is explicitly declared unavailable, never reconstructed.
    expect(
      screen.getByText(/soluzione non disponibile per questa verifica precedente/i),
    ).toBeTruthy();
  });
});

describe('CorrectionWorkspace — question metadata (difficoltà/max)', () => {
  it('shows frozen difficulty and max points when present (no peso)', async () => {
    setupDefaults();
    mockLoadCorrectionWorkspace.mockResolvedValue(
      makeWorkspaceData({
        questions: [
          {
            order: 0,
            tipo: 'aperta',
            maxPoints: 6,
            difficolta: 2,
            testo: 'Spiega il TCP.',
            soluzione: 'x',
            solutionUnavailable: false,
          },
          {
            order: 1,
            tipo: 'aperta',
            maxPoints: 5,
            difficolta: 1,
            testo: 'Seconda.',
            soluzione: 'y',
            solutionUnavailable: false,
          },
        ],
        correction: {
          evaluations: {
            '0': { order: 0, points: null, maxPoints: 6 },
            '1': { order: 1, points: null, maxPoints: 5 },
          },
        },
      }),
    );
    renderWorkspace();
    await waitFor(() => expect(screen.getByText('Spiega il TCP.')).toBeTruthy());

    expect(document.body.textContent).toMatch(/Difficoltà\s*2\s*·\s*Max\s*6\s*punti/);
    expect(document.body.textContent).not.toMatch(/Peso/);
  });

  it('shows an em dash for difficulty on a projection-only question, keeping max points', async () => {
    setupDefaults();
    mockLoadCorrectionWorkspace.mockResolvedValue(
      makeWorkspaceData({
        questions: [
          {
            order: 0,
            tipo: 'aperta',
            maxPoints: 10,
            testo: 'Domanda legacy.',
            soluzione: null,
            solutionUnavailable: true,
          },
        ],
        correction: {
          evaluations: { '0': { order: 0, points: null, maxPoints: 10 } },
        },
      }),
    );
    renderWorkspace();
    await waitFor(() => expect(screen.getByText('Domanda legacy.')).toBeTruthy());

    expect(document.body.textContent).toMatch(/Difficoltà\s*—\s*·\s*Max\s*10\s*punti/);
    expect(document.body.textContent).not.toMatch(/Peso/);
  });
});

describe('CorrectionWorkspace — single-choice solution rendering', () => {
  it('renders a canonical one-item array as selected and correct, without a false red cross', async () => {
    const { alphaRow, solutionBlock } = await renderSingleChoice(['a'], 'a');

    expect(within(alphaRow).getByText(/selezionata, corretta/i)).toBeTruthy();
    expect(alphaRow.className).toMatch(/optionSelected/);
    expect(within(alphaRow).getByText('✓').className).toMatch(/optionIconCorrect/);
    expect(document.body.textContent).not.toContain('✕');
    expect(within(solutionBlock).getByText('Alpha')).toBeTruthy();
    expect(within(solutionBlock).queryByText(/^a$/)).toBeNull();
  });

  it('distinguishes the canonical correct option from the selected wrong option', async () => {
    const { alphaRow, betaRow } = await renderSingleChoice(['a'], 'b');

    expect(within(alphaRow).getByText(/corretta, non selezionata/i)).toBeTruthy();
    expect(within(alphaRow).getByText('✓').className).toMatch(/optionIconCorrect/);
    expect(within(betaRow).getByText(/selezionata, errata/i)).toBeTruthy();
    expect(betaRow.className).toMatch(/optionSelectedWrong/);
    expect(within(betaRow).getByText('✕').className).toMatch(/optionIconWrong/);
  });

  it('renders a legacy string solution exactly like the canonical format', async () => {
    const { alphaRow, solutionBlock } = await renderSingleChoice('a', 'a');

    expect(within(alphaRow).getByText(/selezionata, corretta/i)).toBeTruthy();
    expect(alphaRow.className).toMatch(/optionSelected/);
    expect(within(alphaRow).getByText('✓').className).toMatch(/optionIconCorrect/);
    expect(document.body.textContent).not.toContain('✕');
    expect(within(solutionBlock).getByText('Alpha')).toBeTruthy();
    expect(within(solutionBlock).queryByText(/^a$/)).toBeNull();
  });

  it('renders malformed single-choice solutions as neutral and unavailable', async () => {
    const { alphaRow, betaRow, solutionBlock } = await renderSingleChoice(['a', 'b'], 'b');

    expect(within(betaRow).getByText(/selezionata, correttezza non disponibile/i)).toBeTruthy();
    expect(betaRow.className).not.toMatch(/optionSelectedWrong/);
    expect(within(betaRow).getByText('?').className).toMatch(/optionIconUnavailable/);
    expect(document.body.textContent).not.toContain('✕');
    expect(within(alphaRow).queryByText(/corretta, non selezionata/i)).toBeNull();
    expect(within(solutionBlock).getByText('Soluzione non disponibile.')).toBeTruthy();
  });
});

describe('CorrectionWorkspace — multiple correct answers', () => {
  it('marks every correct option and lists all correct answers in the solution', async () => {
    setupDefaults();
    mockLoadCorrectionWorkspace.mockResolvedValue(
      makeWorkspaceData({
        questions: [
          {
            order: 0,
            tipo: 'chiusa_multipla',
            maxPoints: 4,
            testo: 'Quali sono corretti?',
            opzioni: [
              { id: 'a', testo: 'Alpha' },
              { id: 'b', testo: 'Beta' },
              { id: 'c', testo: 'Gamma' },
              { id: 'd', testo: 'Delta' },
            ],
            soluzione: ['a', 'c'],
            solutionUnavailable: false,
          },
        ],
        submission: {
          answers: { '0': { tipo: 'chiusa_multipla', selectedIds: ['a', 'b'] } },
        },
        correction: {
          evaluations: { '0': { order: 0, points: null, maxPoints: 4 } },
        },
      }),
    );
    renderWorkspace();
    await waitFor(() => expect(screen.getByText('Quali sono corretti?')).toBeTruthy());

    // Selected+correct (a), selected+wrong (b), correct-not-selected (c).
    expect(screen.getByText(/selezionata, corretta/i)).toBeTruthy();
    expect(screen.getByText(/selezionata, errata/i)).toBeTruthy();
    expect(screen.getByText(/corretta, non selezionata/i)).toBeTruthy();

    // The Soluzione block lists BOTH correct answers, not just the first.
    const solutionLabel = screen.getByText('Soluzione (visibile solo al docente)');
    const solutionBlock = solutionLabel.parentElement as HTMLElement;
    const solutionList = within(solutionBlock).getByRole('list');
    expect(within(solutionList).getAllByRole('listitem')).toHaveLength(2);
    expect(within(solutionList).getByText('Alpha')).toBeTruthy();
    expect(within(solutionList).getByText('Gamma')).toBeTruthy();
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

    expect(await screen.findByText(/deve essere un multiplo di 0\.25 tra 0 e 10/i)).toBeTruthy();
    expect(screen.getByText('Salva correzione').closest('button')).toHaveProperty('disabled', true);
  });

  it('accepts a comma decimal separator so a normally-typed Italian score is savable', async () => {
    setupDefaults();
    renderWorkspace();
    await waitFor(() => expect(screen.getByText('Spiega il TCP.')).toBeTruthy());

    const pointsInput = screen.getByLabelText('Punteggio per la domanda 1');
    fireEvent.change(pointsInput, { target: { value: '7,5' } });

    // No validation error, and Salva is enabled — the old Number("7,5")=NaN
    // path would have flagged this and blocked saving.
    expect(screen.queryByText(/deve essere un multiplo/i)).toBeNull();
    expect(screen.getByText('Salva correzione').closest('button')).toHaveProperty(
      'disabled',
      false,
    );
  });

  it('rejects a non-quarter score (0,1) and disables save', async () => {
    setupDefaults();
    renderWorkspace();
    await waitFor(() => expect(screen.getByText('Spiega il TCP.')).toBeTruthy());

    const pointsInput = screen.getByLabelText('Punteggio per la domanda 1');
    fireEvent.change(pointsInput, { target: { value: '0,1' } });

    expect(await screen.findByText(/deve essere un multiplo di 0\.25/i)).toBeTruthy();
    expect(screen.getByText('Salva correzione').closest('button')).toHaveProperty('disabled', true);
  });

  it('the + stepper increments the score by a quarter point', async () => {
    setupDefaults();
    renderWorkspace();
    await waitFor(() => expect(screen.getByText('Spiega il TCP.')).toBeTruthy());

    const inc = screen.getByLabelText(/Aumenta di 0\.25 il punteggio della domanda 1/i);
    fireEvent.click(inc);
    fireEvent.click(inc);

    const pointsInput = screen.getByLabelText('Punteggio per la domanda 1') as HTMLInputElement;
    expect(pointsInput.value).toBe('0.5');
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

    // Not counted as "Valutate" either.
    expect(screen.getByText('0/2')).toBeTruthy();

    // The nav button for the invalid question is not marked evaluated, but
    // is flagged invalid with an accessible "punteggio non valido" hint.
    const navButton = screen.getByLabelText(/vai alla domanda 1/i);
    expect(navButton.getAttribute('aria-label')).toMatch(/punteggio non valido/i);
    expect(navButton.getAttribute('title')).toMatch(/punteggio non valido/i);

    // "Completa correzione" stays disabled.
    expect(screen.getByText('Completa correzione').closest('button')).toHaveProperty(
      'disabled',
      true,
    );
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

  it('saves exactly the edited evaluations and general feedback, confirms, and does NOT re-read Firestore', async () => {
    setupDefaults();
    renderWorkspace();
    await waitFor(() => expect(screen.getByText('Spiega il TCP.')).toBeTruthy());

    fireEvent.change(screen.getByLabelText('Punteggio per la domanda 1'), {
      target: { value: '8' },
    });
    fireEvent.change(screen.getByLabelText('Feedback generale'), {
      target: { value: 'Buon lavoro' },
    });

    fireEvent.click(screen.getByText('Salva correzione'));

    await waitFor(() => expect(mockSaveCorrection).toHaveBeenCalledTimes(1));
    const [input] = mockSaveCorrection.mock.calls[0]!;
    expect(input.submissionId).toBe(SUBMISSION_ID);
    expect(input.evaluations['0']).toEqual({ points: 8 });
    expect(input.evaluations['1']).toEqual({ points: null });
    expect(input.generalFeedback).toBe('Buon lavoro');

    // Persistent, discreet confirmation and cleared dirty state.
    await waitFor(() => expect(screen.getByText(/correzione salvata/i)).toBeTruthy());
    expect(screen.queryByText('Modifiche non salvate')).toBeNull();
    // No post-save Firestore re-read: the loader ran only for the initial mount.
    expect(mockLoadCorrectionWorkspace).toHaveBeenCalledTimes(1);
  });

  it('releases the busy state after a successful save so the button is usable again', async () => {
    setupDefaults();
    renderWorkspace();
    await waitFor(() => expect(screen.getByText('Spiega il TCP.')).toBeTruthy());

    fireEvent.change(screen.getByLabelText('Punteggio per la domanda 1'), {
      target: { value: '8' },
    });
    fireEvent.click(screen.getByText('Salva correzione'));

    // After the save resolves the label is back to "Salva correzione" (not stuck
    // on "Salvataggio…"), and editing again re-enables it.
    await waitFor(() => expect(screen.getByText('Salva correzione')).toBeTruthy());
    fireEvent.change(screen.getByLabelText('Punteggio per la domanda 1'), {
      target: { value: '9' },
    });
    await waitFor(() =>
      expect(screen.getByText('Salva correzione').closest('button')).toHaveProperty(
        'disabled',
        false,
      ),
    );
  });

  it('persists and reports comma + quarter scores normalized (7,5 → 7.5)', async () => {
    setupDefaults();
    renderWorkspace();
    await waitFor(() => expect(screen.getByText('Spiega il TCP.')).toBeTruthy());

    fireEvent.change(screen.getByLabelText('Punteggio per la domanda 1'), {
      target: { value: '7,5' },
    });
    fireEvent.click(screen.getByText('Salva correzione'));

    await waitFor(() => expect(mockSaveCorrection).toHaveBeenCalledTimes(1));
    expect(mockSaveCorrection.mock.calls[0]![0].evaluations['0']).toEqual({ points: 7.5 });
    // The field reflects the normalized persisted value.
    const input = screen.getByLabelText('Punteggio per la domanda 1') as HTMLInputElement;
    await waitFor(() => expect(input.value).toBe('7.5'));
  });

  it('on a failed save, releases busy and keeps local edits', async () => {
    setupDefaults();
    mockSaveCorrection.mockRejectedValue(new Error('Rete non disponibile'));
    renderWorkspace();
    await waitFor(() => expect(screen.getByText('Spiega il TCP.')).toBeTruthy());

    const scoreInput = screen.getByLabelText('Punteggio per la domanda 1') as HTMLInputElement;
    fireEvent.change(scoreInput, { target: { value: '8' } });
    fireEvent.click(screen.getByText('Salva correzione'));

    await waitFor(() => expect(screen.getByText(/rete non disponibile/i)).toBeTruthy());
    // Busy released (label back), local edit preserved, still dirty.
    expect(screen.getByText('Salva correzione')).toBeTruthy();
    expect(scoreInput.value).toBe('8');
    expect(screen.getByText('Modifiche non salvate')).toBeTruthy();
  });

  it('a double click triggers exactly one write', async () => {
    setupDefaults();
    let resolveSave: (v: unknown) => void = () => {};
    mockSaveCorrection.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSave = resolve;
        }),
    );
    renderWorkspace();
    await waitFor(() => expect(screen.getByText('Spiega il TCP.')).toBeTruthy());

    fireEvent.change(screen.getByLabelText('Punteggio per la domanda 1'), {
      target: { value: '8' },
    });
    const saveBtn = screen.getByText('Salva correzione');
    fireEvent.click(saveBtn);
    fireEvent.click(saveBtn);

    resolveSave(
      saveResultFromInput({
        evaluations: { '0': { points: 8 }, '1': { points: null } },
        generalFeedback: null,
      }),
    );
    await waitFor(() => expect(mockSaveCorrection).toHaveBeenCalledTimes(1));
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
    fireEvent.click(within(dialog).getByText('Conferma'));

    await waitFor(() => expect(mockCompleteCorrection).toHaveBeenCalledWith(SUBMISSION_ID, {}));
    await waitFor(() => expect(screen.getByText('Corretta')).toBeTruthy());
    expect(mockLoadCorrectionWorkspace).toHaveBeenCalledTimes(1);
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
