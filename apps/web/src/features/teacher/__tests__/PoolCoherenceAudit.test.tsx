import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ preview: vi.fn(), review: vi.fn() }));
vi.mock('../../../lib/firebase.js', () => ({ functions: {} }));
vi.mock('../../repository/pools/aiContentClient.js', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  createAiContentCallables: () => ({ previewReview: mocks.preview, generateReview: mocks.review }),
}));
import { PoolCoherenceAudit } from '../PoolCoherenceAudit.js';
import type { ParsedPool } from '@schoolforge/lesson-contract';
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
describe('explicit existing pool audit', () => {
  it('shows proposal and coverage before applying, preserving question identity', async () => {
    mocks.preview.mockResolvedValue({ reservationCostMicroUsd: 100 });
    mocks.review.mockResolvedValue({
      output: {
        reviewOutcome: 'improved',
        issueCodes: ['unsupported_content'],
        questions: [
          {
            order: 0,
            tipo: 'aperta',
            testo: 'Spiega la condizione del ciclo.',
            difficolta: 2,
            soluzione: 'La condizione determina se eseguire il corpo.',
          },
        ],
        coverageSummary: {
          coveredCapabilities: ['Spiegare la condizione'],
          gaps: ['Tracing non preparato'],
          advancedOrdinals: [],
        },
      },
    });
    const apply = vi.fn(async (_pool: ParsedPool) => undefined);
    const pool: ParsedPool = {
      schema: 'schoolforge-pool/v2',
      questions: [
        {
          id: 'original-id',
          tipo: 'aperta',
          testo: 'Prevedi output.',
          difficolta: 2,
          maxPoints: 2,
          maxCharacters: 800,
          soluzione: 'Output atteso.',
        },
      ],
    };
    render(
      <PoolCoherenceAudit
        pool={pool}
        lessonSource="Un ciclo ripete un blocco quando la condizione è vera."
        approvedPractice="Pratica approvata"
        onApply={apply}
      />,
    );
    fireEvent.click(screen.getByText('Controlla coerenza con la lezione — stima'));
    await screen.findByText('Esegui controllo');
    expect(mocks.review).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Esegui controllo'));
    await screen.findByText('Tracing non preparato');
    expect(apply).not.toHaveBeenCalled();
    expect(mocks.review.mock.calls[0]![0]).toMatchObject({
      approvedPractice: 'Pratica approvata',
      candidateQuestions: [{ order: 0, testo: 'Prevedi output.' }],
    });
    fireEvent.click(screen.getByText('Applica proposta al pool'));
    await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
    expect(apply.mock.calls[0]![0]).toMatchObject({
      questions: [{ id: 'original-id', testo: 'Spiega la condizione del ciclo.', maxPoints: 2 }],
    });
  });
});
