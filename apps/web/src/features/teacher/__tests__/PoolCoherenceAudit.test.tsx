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
            difficolta: 5,
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
    fireEvent.click(screen.getByText('Controlla coerenza'));
    fireEvent.click(screen.getByText('Calcola stima'));
    await screen.findByText('Conferma ed esegui controllo');
    expect(mocks.review).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Conferma ed esegui controllo'));
    await screen.findByText('Tracing non preparato');
    expect(apply).not.toHaveBeenCalled();
    expect(mocks.review.mock.calls[0]![0]).toMatchObject({
      approvedPractice: 'Pratica approvata',
      candidateQuestions: [{ order: 0, testo: 'Prevedi output.' }],
    });
    fireEvent.click(screen.getByText('Applica proposta al pool'));
    await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
    expect(apply.mock.calls[0]![0]).toMatchObject({
      questions: [
        {
          id: 'original-id',
          testo: 'Spiega la condizione del ciclo.',
          difficolta: 2,
          maxPoints: 2,
          maxCharacters: 800,
        },
      ],
    });
  });
});

it('preserves closed-question scoring and identity despite a different proposed difficulty', async () => {
  mocks.preview.mockResolvedValue({ reservationCostMicroUsd: 100 });
  mocks.review.mockResolvedValue({
    output: {
      reviewOutcome: 'improved',
      issueCodes: ['unsupported_content'],
      questions: [
        {
          order: 0,
          tipo: 'chiusa_singola',
          testo: 'Quale condizione è vera?',
          difficolta: 1,
          opzioni: ['Vera', 'Falsa'],
          soluzioneIndici: [0],
        },
      ],
    },
  });
  const pool: ParsedPool = {
    schema: 'schoolforge-pool/v2',
    questions: [
      {
        id: 'closed-id',
        tipo: 'chiusa_singola',
        testo: 'Richiesta precedente.',
        difficolta: 4,
        maxPoints: 4,
        opzioni: [
          { id: 'a', testo: 'Prima' },
          { id: 'b', testo: 'Seconda' },
        ],
        soluzione: ['b'],
      },
    ],
  };
  const apply = vi.fn(async (_pool: ParsedPool) => undefined);
  render(
    <PoolCoherenceAudit
      pool={pool}
      lessonSource="Una condizione è una proposizione che può essere vera o falsa."
      onApply={apply}
    />,
  );
  fireEvent.click(screen.getByText('Controlla coerenza'));
  fireEvent.click(screen.getByText('Calcola stima'));
  await screen.findByText('Conferma ed esegui controllo');
  fireEvent.click(screen.getByText('Conferma ed esegui controllo'));
  await screen.findByText('Applica proposta al pool');
  fireEvent.click(screen.getByText('Applica proposta al pool'));
  await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
  const saved = apply.mock.calls[0]![0];
  expect(saved.questions[0]).toEqual({
    id: 'closed-id',
    tipo: 'chiusa_singola',
    testo: 'Quale condizione è vera?',
    difficolta: 4,
    maxPoints: 4,
    opzioni: [
      { id: 'a', testo: 'Vera' },
      { id: 'b', testo: 'Falsa' },
    ],
    soluzione: ['a'],
  });
  expect(saved.questions[0]).not.toHaveProperty('maxCharacters');
});

function makePool(count: number): ParsedPool {
  return {
    schema: 'schoolforge-pool/v2',
    questions: Array.from({ length: count }, (_, i) => ({
      id: `id-${i}`,
      tipo: 'aperta' as const,
      testo: `Domanda originale ${i}`,
      soluzione: `Soluzione ${i}`,
      difficolta: 2,
      maxPoints: 2,
      maxCharacters: 500,
    })),
  };
}
function reviewResult(
  request: { candidateQuestions: { order: number; testo: string }[] },
  discarded: number[] = [],
) {
  return {
    actualCostMicroUsd: 100,
    output: {
      reviewOutcome: 'improved',
      issueCodes: [],
      discardedQuestions: discarded.map((questionOrder) => ({
        questionOrder,
        reason: 'Non preparata',
      })),
      questions: request.candidateQuestions
        .filter((q) => !discarded.includes(q.order))
        .map((q, order) => ({ ...q, order, testo: `Corretta: ${q.testo}` })),
    },
  };
}
async function startAudit() {
  fireEvent.click(screen.getByText('Controlla coerenza'));
  expect(mocks.preview).not.toHaveBeenCalled();
  expect(mocks.review).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('Calcola stima'));
  await screen.findByText('Conferma ed esegui controllo');
  fireEvent.click(screen.getByText('Conferma ed esegui controllo'));
}

it('maps partial results within each chunk without deleting discarded originals or shifting the next block', async () => {
  mocks.preview.mockResolvedValue({ estimatedCostMicroUsd: 50, reservationCostMicroUsd: 100 });
  mocks.review.mockImplementation(async (request) =>
    reviewResult(request, request.candidateQuestions.length === 30 ? [0, 14, 29] : []),
  );
  const pool = makePool(31);
  const apply = vi.fn(async (_pool: ParsedPool) => undefined);
  render(<PoolCoherenceAudit pool={pool} lessonSource="Lezione" onApply={apply} />);
  await startAudit();
  await screen.findByText('Applica proposta al pool');
  expect(screen.getByText(/3 domande non convalidate restano nel pool/)).toBeTruthy();
  expect(screen.getByText('Domanda 31: proposta')).toBeTruthy();
  fireEvent.click(screen.getByText('Applica proposta al pool'));
  await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
  const saved = apply.mock.calls[0]![0];
  expect(saved.questions).toHaveLength(31);
  [0, 14, 29].forEach((i) => expect(saved.questions[i]).toEqual(pool.questions[i]));
  [1, 15, 30].forEach((i) =>
    expect(saved.questions[i]).toEqual({
      ...pool.questions[i],
      testo: `Corretta: Domanda originale ${i}`,
    }),
  );
});

it('refuses ambiguous mappings while retaining repairs from other blocks', async () => {
  mocks.preview.mockResolvedValue({ estimatedCostMicroUsd: 50, reservationCostMicroUsd: 100 });
  mocks.review.mockImplementation(async (request) => {
    const result = reviewResult(request);
    if (request.candidateQuestions.length === 30) result.output.questions.pop();
    return result;
  });
  const pool = makePool(31);
  const apply = vi.fn(async (_pool: ParsedPool) => undefined);
  render(<PoolCoherenceAudit pool={pool} lessonSource="Lezione" onApply={apply} />);
  await startAudit();
  await screen.findByText('Applica proposta al pool');
  expect(screen.getByText(/30 domande non convalidate/)).toBeTruthy();
  fireEvent.click(screen.getByText('Applica proposta al pool'));
  await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
  expect(apply.mock.calls[0]![0].questions.slice(0, 30)).toEqual(pool.questions.slice(0, 30));
  expect(apply.mock.calls[0]![0].questions[30]!.testo).toBe('Corretta: Domanda originale 30');
});

it('retries the same failed request without repeating successful blocks and keeps unknown total costs explicit', async () => {
  mocks.preview.mockResolvedValue({ estimatedCostMicroUsd: 50, reservationCostMicroUsd: 100 });
  mocks.review
    .mockImplementationOnce(async (request) => reviewResult(request))
    .mockRejectedValueOnce(new Error('Rete interrotta'))
    .mockImplementationOnce(async (request) => reviewResult(request));
  render(<PoolCoherenceAudit pool={makePool(31)} lessonSource="Lezione" onApply={vi.fn()} />);
  await startAudit();
  await screen.findByText('Rete interrotta');
  expect(screen.getByText(/Risultati parziali conservati/)).toBeTruthy();
  const failedRequest = mocks.review.mock.calls[1]![0];
  fireEvent.click(screen.getByText('Riprova blocchi rimanenti'));
  await screen.findByText('Applica proposta al pool');
  expect(mocks.review).toHaveBeenCalledTimes(3);
  expect(mocks.review.mock.calls[2]![0]).toBe(failedRequest);
  expect(mocks.preview).toHaveBeenCalledTimes(2);
  expect(screen.getByText(/Il costo totale complessivo/)).toBeTruthy();
});

it('keeps request identity and completed estimates when preview fails on a later chunk', async () => {
  mocks.preview
    .mockResolvedValueOnce({ estimatedCostMicroUsd: 50, reservationCostMicroUsd: 100 })
    .mockRejectedValueOnce(new Error('Stima interrotta'))
    .mockResolvedValueOnce({ estimatedCostMicroUsd: 50, reservationCostMicroUsd: 100 });
  render(<PoolCoherenceAudit pool={makePool(31)} lessonSource="Lezione" onApply={vi.fn()} />);
  fireEvent.click(screen.getByText('Controlla coerenza'));
  fireEvent.click(screen.getByText('Calcola stima'));
  await screen.findByText('Stima interrotta');
  fireEvent.click(screen.getByText('Riprova stima'));
  await screen.findByText('Conferma ed esegui controllo');
  expect(mocks.preview).toHaveBeenCalledTimes(3);
  expect(mocks.preview.mock.calls[2]![0]).toBe(mocks.preview.mock.calls[1]![0]);
});

it('runs serially, blocks dismissal while busy and confirms abandoning unapplied results', async () => {
  mocks.preview.mockResolvedValue({ estimatedCostMicroUsd: 50, reservationCostMicroUsd: 100 });
  let release!: (value: unknown) => void;
  mocks.review
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    )
    .mockImplementation(async (request) => reviewResult(request));
  render(<PoolCoherenceAudit pool={makePool(31)} lessonSource="Lezione" onApply={vi.fn()} />);
  await startAudit();
  expect(mocks.review).toHaveBeenCalledTimes(1);
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
  expect(screen.getByRole('dialog')).toBeTruthy();
  release(reviewResult(mocks.review.mock.calls[0]![0]));
  await screen.findByText('Applica proposta al pool');
  expect(mocks.review).toHaveBeenCalledTimes(2);
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
  expect(screen.getByRole('alertdialog')).toBeTruthy();
  fireEvent.click(screen.getByText('Continua'));
  expect(screen.queryByRole('alertdialog')).toBeNull();
  expect(screen.getByText('Applica proposta al pool')).toBeTruthy();
});

it('blocks applying results to a changed pool and retains the current pool', async () => {
  mocks.preview.mockResolvedValue({ estimatedCostMicroUsd: 50, reservationCostMicroUsd: 100 });
  mocks.review.mockImplementation(async (request) => reviewResult(request));
  const apply = vi.fn();
  const pool = makePool(1);
  const view = render(<PoolCoherenceAudit pool={pool} lessonSource="Lezione" onApply={apply} />);
  await startAudit();
  await screen.findByText('Applica proposta al pool');
  view.rerender(
    <PoolCoherenceAudit
      pool={{ ...pool, questions: [{ ...pool.questions[0]!, testo: 'Modifica esterna' }] }}
      lessonSource="Lezione"
      onApply={apply}
    />,
  );
  expect((screen.getByText('Applica proposta al pool') as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByText('Applica proposta al pool'));
  expect(apply).not.toHaveBeenCalled();
});

it('retains proposals after save failure and prevents duplicate apply while saving', async () => {
  mocks.preview.mockResolvedValue({ estimatedCostMicroUsd: 50, reservationCostMicroUsd: 100 });
  mocks.review.mockImplementation(async (request) => reviewResult(request));
  let reject!: (error: Error) => void;
  const apply = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise((_resolve, fail) => {
          reject = fail;
        }),
    )
    .mockResolvedValue(undefined);
  render(<PoolCoherenceAudit pool={makePool(1)} lessonSource="Lezione" onApply={apply} />);
  await startAudit();
  await screen.findByText('Applica proposta al pool');
  fireEvent.click(screen.getByText('Applica proposta al pool'));
  fireEvent.click(screen.getByText('Applica proposta al pool'));
  expect(apply).toHaveBeenCalledTimes(1);
  reject(new Error('Salvataggio interrotto'));
  await screen.findByText('Salvataggio interrotto');
  fireEvent.click(screen.getByText('Applica proposta al pool'));
  await screen.findByText('Proposta applicata.');
  expect(apply).toHaveBeenCalledTimes(2);
  expect(mocks.review).toHaveBeenCalledTimes(1);
});

it('retains every original when all proposals are discarded and shows unknown consumption', async () => {
  mocks.preview.mockResolvedValue({ estimatedCostMicroUsd: 50, reservationCostMicroUsd: 100 });
  mocks.review.mockImplementation(async (request) => ({
    ...reviewResult(request, [0, 1]),
    actualCostMicroUsd: null,
  }));
  const apply = vi.fn();
  render(<PoolCoherenceAudit pool={makePool(2)} lessonSource="Lezione" onApply={apply} />);
  await startAudit();
  await screen.findByText(/2 domande non convalidate/);
  expect(screen.getByText(/Consumo esatto non disponibile/)).toBeTruthy();
  expect(screen.queryByText('Applica proposta al pool')).toBeNull();
  expect(apply).not.toHaveBeenCalled();
});

it('preserves multiple-choice identity and scoring while replacing options and solutions coherently', async () => {
  mocks.preview.mockResolvedValue({ estimatedCostMicroUsd: 50, reservationCostMicroUsd: 100 });
  mocks.review.mockResolvedValue({
    actualCostMicroUsd: 100,
    output: {
      reviewOutcome: 'improved',
      issueCodes: [],
      questions: [
        {
          order: 0,
          tipo: 'chiusa_multipla',
          testo: 'Quali sono vere?',
          difficolta: 5,
          opzioni: ['Vera A', 'Falsa', 'Vera B'],
          soluzioneIndici: [0, 2],
        },
      ],
    },
  });
  const pool: ParsedPool = {
    schema: 'schoolforge-pool/v2',
    questions: [
      {
        id: 'multi-id',
        tipo: 'chiusa_multipla',
        testo: 'Prima?',
        difficolta: 3,
        maxPoints: 3,
        opzioni: [
          { id: 'x', testo: 'Prima' },
          { id: 'y', testo: 'Seconda' },
        ],
        soluzione: ['x', 'y'],
      },
    ],
  };
  const apply = vi.fn(async (_pool: ParsedPool) => undefined);
  render(<PoolCoherenceAudit pool={pool} lessonSource="Lezione" onApply={apply} />);
  await startAudit();
  await screen.findByText('Applica proposta al pool');
  fireEvent.click(screen.getByText('Applica proposta al pool'));
  await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
  expect(apply.mock.calls[0]![0].questions[0]).toEqual({
    ...pool.questions[0],
    testo: 'Quali sono vere?',
    opzioni: [
      { id: 'a', testo: 'Vera A' },
      { id: 'b', testo: 'Falsa' },
      { id: 'c', testo: 'Vera B' },
    ],
    soluzione: ['a', 'c'],
  });
});
