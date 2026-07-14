import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StudentCorrectionView } from '../StudentCorrectionView.js';
import type { StudentCorrectionReturnItem } from '../studentCorrectionReturnsService.js';

const mockLoadStudentCorrectionReturn = vi.fn();
vi.mock('../studentCorrectionReturnsService.js', () => ({
  loadStudentCorrectionReturn: (...args: unknown[]) => mockLoadStudentCorrectionReturn(...args),
}));

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
});

const fakeDb = {} as never;

const BASE_ITEM: StudentCorrectionReturnItem = {
  submissionId: 'v1_student-uid',
  correctionId: 'v1_student-uid',
  verificationId: 'v1',
  studentUid: 'student-uid',
  ownerUid: 'owner-uid',
  verificationTitle: 'Verifica Reti',
  className: 'Classe 3A',
  submittedAt: { seconds: 100, nanoseconds: 0 } as never,
  returnedAt: { seconds: 300, nanoseconds: 0 } as never,
  questions: [
    {
      order: 0,
      tipo: 'aperta',
      testo: 'Descrivi il modello OSI.',
      studentAnswer: { tipo: 'aperta', testo: 'La mia risposta.' },
      points: 8,
      maxPoints: 10,
      feedback: 'Buon lavoro.',
    },
    {
      order: 1,
      tipo: 'chiusa_singola',
      testo: 'Livello di routing?',
      opzioni: [
        { id: 'a', testo: 'Rete' },
        { id: 'b', testo: 'Trasporto' },
      ],
      studentAnswer: { tipo: 'chiusa_singola', selectedId: 'a' },
      points: 2,
      maxPoints: 2,
    },
  ],
  generalFeedback: 'Ottimo lavoro complessivo.',
  totalPoints: 10,
  maxPoints: 12,
  percentage: 83,
  visibleToStudent: true,
  solutionsVisible: false,
  updatedAt: { seconds: 300, nanoseconds: 0 } as never,
};

describe('StudentCorrectionView — header and summary', () => {
  it('shows title, class, dates, totals and general feedback', async () => {
    render(
      <StudentCorrectionView
        submissionId="v1_student-uid"
        initialData={BASE_ITEM}
        db={fakeDb}
        onBack={vi.fn()}
      />,
    );

    expect(screen.getByText('Verifica Reti')).toBeTruthy();
    expect(screen.getByText('Classe 3A')).toBeTruthy();
    expect(screen.getByText('10/12')).toBeTruthy();
    expect(screen.getByText('83%')).toBeTruthy();
    expect(screen.getByText('Ottimo lavoro complessivo.')).toBeTruthy();
  });

  it('omits the general feedback block when absent', async () => {
    render(
      <StudentCorrectionView
        submissionId="v1_student-uid"
        initialData={{ ...BASE_ITEM, generalFeedback: null }}
        db={fakeDb}
        onBack={vi.fn()}
      />,
    );

    expect(screen.queryByText('Ottimo lavoro complessivo.')).toBeNull();
  });

  it('calls onBack when "Torna alle verifiche" is clicked', () => {
    const onBack = vi.fn();
    render(
      <StudentCorrectionView
        submissionId="v1_student-uid"
        initialData={BASE_ITEM}
        db={fakeDb}
        onBack={onBack}
      />,
    );

    fireEvent.click(screen.getByText('← Torna alle verifiche'));
    expect(onBack).toHaveBeenCalledOnce();
  });
});

describe('StudentCorrectionView — question navigation and content', () => {
  it('shows the first question by default, with answer and per-question score', () => {
    render(
      <StudentCorrectionView
        submissionId="v1_student-uid"
        initialData={BASE_ITEM}
        db={fakeDb}
        onBack={vi.fn()}
      />,
    );

    expect(screen.getByText('Domanda 1')).toBeTruthy();
    expect(screen.getByText('Descrivi il modello OSI.')).toBeTruthy();
    expect(screen.getByText('La mia risposta.')).toBeTruthy();
    expect(screen.getByText('8/10 punti')).toBeTruthy();
    expect(screen.getByText('Buon lavoro.')).toBeTruthy();
  });

  it('switches question via the navigator', () => {
    render(
      <StudentCorrectionView
        submissionId="v1_student-uid"
        initialData={BASE_ITEM}
        db={fakeDb}
        onBack={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByLabelText('Vai alla domanda 2'));
    expect(screen.getByText('Livello di routing?')).toBeTruthy();
    expect(screen.getByText('Rete')).toBeTruthy();
  });

  it('shows "Nessuna risposta" for an unanswered question', () => {
    const item: StudentCorrectionReturnItem = {
      ...BASE_ITEM,
      questions: [{ ...BASE_ITEM.questions[0]!, studentAnswer: null }],
    };
    render(
      <StudentCorrectionView
        submissionId="v1_student-uid"
        initialData={item}
        db={fakeDb}
        onBack={vi.fn()}
      />,
    );

    expect(screen.getByText('Nessuna risposta.')).toBeTruthy();
  });

  it('does not show a solution block when correctAnswer is absent', () => {
    render(
      <StudentCorrectionView
        submissionId="v1_student-uid"
        initialData={BASE_ITEM}
        db={fakeDb}
        onBack={vi.fn()}
      />,
    );

    expect(screen.queryByText('Soluzione')).toBeNull();
  });

  it('shows the solution only when solutionsVisible and correctAnswer is present on the question', () => {
    const item: StudentCorrectionReturnItem = {
      ...BASE_ITEM,
      solutionsVisible: true,
      questions: [{ ...BASE_ITEM.questions[0]!, correctAnswer: 'Risposta corretta attesa.' }],
    };
    render(
      <StudentCorrectionView
        submissionId="v1_student-uid"
        initialData={item}
        db={fakeDb}
        onBack={vi.fn()}
      />,
    );

    expect(screen.getByText('Soluzione')).toBeTruthy();
    expect(screen.getByText('Risposta corretta attesa.')).toBeTruthy();
  });

  it('shows every correct answer of a returned multiple-choice question', () => {
    const item: StudentCorrectionReturnItem = {
      ...BASE_ITEM,
      solutionsVisible: true,
      questions: [
        {
          order: 0,
          tipo: 'chiusa_multipla',
          testo: 'Seleziona i protocolli applicativi.',
          opzioni: [
            { id: 'a', testo: 'HTTP' },
            { id: 'b', testo: 'TCP' },
            { id: 'c', testo: 'DNS' },
          ],
          studentAnswer: { tipo: 'chiusa_multipla', selectedIds: ['a'] },
          points: 1,
          maxPoints: 2,
          correctAnswer: ['a', 'c'],
        },
      ],
    };

    render(
      <StudentCorrectionView
        submissionId="v1_student-uid"
        initialData={item}
        db={fakeDb}
        onBack={vi.fn()}
      />,
    );

    expect(screen.getByText('HTTP, DNS')).toBeTruthy();
  });

  it('renders multiple-choice options without a correct/incorrect colour hint', () => {
    render(
      <StudentCorrectionView
        submissionId="v1_student-uid"
        initialData={BASE_ITEM}
        db={fakeDb}
        onBack={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByLabelText('Vai alla domanda 2'));
    const selectedOption = screen.getByText('Rete').closest('div');
    // Only a "selected" marker exists on this read-only view — never a
    // correct/wrong one absent an explicitly-revealed solution.
    expect(selectedOption?.className).not.toMatch(/optionCorrect|optionSelectedWrong/i);
  });
});

describe('StudentCorrectionView — manual reload', () => {
  it('reloads via loadStudentCorrectionReturn and updates the view', async () => {
    const updated: StudentCorrectionReturnItem = {
      ...BASE_ITEM,
      totalPoints: 12,
      percentage: 100,
    };
    mockLoadStudentCorrectionReturn.mockResolvedValue(updated);

    render(
      <StudentCorrectionView
        submissionId="v1_student-uid"
        initialData={BASE_ITEM}
        db={fakeDb}
        onBack={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByText('Ricarica'));
    await waitFor(() => expect(screen.getByText('12/12')).toBeTruthy());
    expect(mockLoadStudentCorrectionReturn).toHaveBeenCalledWith('v1_student-uid', fakeDb);
  });

  it('shows a clean unavailable state when the docente has just hidden the correction', async () => {
    mockLoadStudentCorrectionReturn.mockResolvedValue(null);

    render(
      <StudentCorrectionView
        submissionId="v1_student-uid"
        initialData={BASE_ITEM}
        db={fakeDb}
        onBack={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByText('Ricarica'));
    await waitFor(() => expect(screen.getByText(/non è più disponibile/i)).toBeTruthy());
    expect(screen.queryByText('Verifica Reti')).toBeNull();
  });

  it('shows a readable error when the reload itself fails, and keeps showing the previously loaded data', async () => {
    mockLoadStudentCorrectionReturn.mockRejectedValue(new Error('boom'));

    render(
      <StudentCorrectionView
        submissionId="v1_student-uid"
        initialData={BASE_ITEM}
        db={fakeDb}
        onBack={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByText('Ricarica'));
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());

    // A transient/network failure must never be mistaken for "the docente
    // hid the correction" — the previously loaded data stays on screen.
    expect(screen.getByText('Verifica Reti')).toBeTruthy();
    expect(screen.getByText('10/12')).toBeTruthy();
    expect(screen.queryByText(/non è più disponibile/i)).toBeNull();
  });

  it('still offers a working "Torna alle verifiche" from the unavailable state', async () => {
    mockLoadStudentCorrectionReturn.mockResolvedValue(null);
    const onBack = vi.fn();

    render(
      <StudentCorrectionView
        submissionId="v1_student-uid"
        initialData={BASE_ITEM}
        db={fakeDb}
        onBack={onBack}
      />,
    );

    fireEvent.click(screen.getByText('Ricarica'));
    await waitFor(() => expect(screen.getByText(/non è più disponibile/i)).toBeTruthy());

    fireEvent.click(screen.getByText('← Torna alle verifiche'));
    expect(onBack).toHaveBeenCalledOnce();
  });
});
