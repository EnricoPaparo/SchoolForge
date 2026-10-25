import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type * as ContentClient from '../../repository/pools/aiContentClient.js';
import type * as MapClient from '../../repository/pools/aiConceptMapClient.js';
import {
  generationCostKey,
  readGenerationCosts,
  writeGenerationCost,
} from '../../repository/programs/generationFinancials.js';
const state = vi.hoisted(() => ({
  events: [] as string[],
  costs: new Map<string, { cost: number; executions: number; status: string }>(),
  failReviewOnce: false,
  uncertainImage: false,
}));
vi.mock('../../../lib/firebase.js', () => ({ functions: {} }));
vi.mock('firebase/functions', () => ({
  httpsCallable:
    () =>
    async ({ requestId }: { requestId: string }) => {
      const run = state.costs.get(requestId);
      return {
        data: run
          ? {
              status: run.status,
              knownActualMicroUsd: run.cost,
              executions: run.executions,
              unknownExecutions: 0,
              settledMicroUsd: run.cost,
              historyComplete: true,
              reservedUnknownMicroUsd: 0,
              updatedAtMs: run.executions * 1000,
            }
          : { status: 'not_found' },
      };
    },
}));
const body = '## Memoria\n\nLa RAM è volatile.';
function output(request: Record<string, unknown>) {
  const kind = request.kind as string;
  if (kind === 'lesson') return { body };
  if (kind === 'lesson_review') return { body, reviewOutcome: 'unchanged', issueCodes: [] };
  if (kind === 'concept_map') return { conceptMapMarkdown: '## Sintesi\n\nLa RAM è volatile.' };
  if (kind === 'concept_map_review')
    return {
      conceptMapMarkdown: request.candidateMarkdown,
      reviewOutcome: 'unchanged',
      issueCodes: [],
      sourceIssue: false,
    };
  const questions = [
    {
      order: 0,
      tipo: 'aperta',
      testo: 'Spiega la volatilità della RAM.',
      difficolta: 2,
      soluzione: 'I dati si perdono senza alimentazione.',
    },
  ];
  return kind === 'pool_review'
    ? { questions: request.candidateQuestions, reviewOutcome: 'unchanged', issueCodes: [] }
    : { questions };
}
async function generate(request: Record<string, unknown>) {
  const kind = request.kind as string;
  const requestId = request.requestId as string;
  state.events.push(kind);
  const cost = {
    lesson: 10,
    lesson_review: 20,
    pool: 30,
    pool_review: 40,
    concept_map: 50,
    concept_map_review: 60,
  }[kind]!;
  const previous = state.costs.get(requestId);
  const run = {
    cost: (previous?.cost ?? 0) + cost,
    executions: (previous?.executions ?? 0) + 1,
    status: 'completed',
  };
  state.costs.set(requestId, run);
  if (kind === 'lesson_review' && state.failReviewOnce) {
    state.failReviewOnce = false;
    run.status = 'failed';
    throw new Error('lost review response');
  }
  return {
    kind,
    status: 'completed',
    modelProfile: 'economy',
    actualCostMicroUsd: cost,
    replayed: false,
    output: output(request),
  };
}
const factory = () => ({
  preview: vi.fn(),
  previewReview: vi.fn(),
  generate,
  generateReview: generate,
});
vi.mock('../../repository/pools/aiContentClient.js', async (original) => ({
  ...(await original<typeof ContentClient>()),
  createAiLessonCallables: () => factory(),
  createAiContentCallables: () => factory(),
}));
vi.mock('../../repository/pools/aiConceptMapClient.js', async (original) => ({
  ...(await original<typeof MapClient>()),
  createAiConceptMapCallables: () => factory(),
}));
vi.mock('../../repository/programs/multiVisualClient.js', () => ({
  createMultiVisualClient: () => ({
    authorize: async (input: { requestId: string }) => ({
      requestId: input.requestId,
      status: 'proposed',
      slots: state.uncertainImage
        ? [
            {
              slotIndex: 0,
              state: 'failed',
              decision: 'image',
              attempts: 1,
              lastError: 'transient_error',
              staged: null,
              promotedAssetId: null,
            },
          ]
        : [],
      settlement: {
        proposalActualCost: 5,
        slots: state.uncertainImage
          ? [{ slotIndex: 0, attempts: 1, actualCost: 7, knownActualCost: 7 }]
          : [],
      },
    }),
    generateSlot: async () => {
      throw new Error('image response lost');
    },
    status: async () => {
      throw new Error('status unavailable');
    },
  }),
}));
import { TotalLessonGenerationDialog } from '../TotalLessonGenerationDialog.js';
const identity = { programId: 'cost-integrated', importId: 'import', lessonId: 'lesson' };
const key = generationCostKey(identity);
beforeEach(() => {
  state.events = [];
  state.costs.clear();
  state.failReviewOnce = false;
  state.uncertainImage = false;
  window.sessionStorage.clear();
});
afterEach(cleanup);
function renderGeneration() {
  writeGenerationCost(key, {
    id: 'old-generation',
    phase: 'Vecchia generazione',
    knownActualMicroUsd: 999,
    unknown: false,
    settledMicroUsd: 999,
  });
  const clear = vi.fn(async () => {
    state.events.push('clear');
    const entries = readGenerationCosts(key);
    expect(entries.some((e) => e.phase === 'Contenuto' && e.knownActualMicroUsd === 10)).toBe(true);
    expect(
      entries.some((e) => e.phase === 'Revisione contenuto' && e.knownActualMicroUsd >= 20),
    ).toBe(true);
  });
  render(
    <TotalLessonGenerationDialog
      identity={identity}
      context={{
        titolo: 'Memoria',
        difficolta: 'Base',
        concettiChiave: ['RAM'],
        obiettivi: ['Descrivere la RAM'],
        udaTitle: 'UDA',
        udaContext: {
          title: 'UDA',
          descrizione: 'Memorie.',
          competenze: ['Descrivere'],
          obiettivi: ['RAM'],
          currentLessonPosition: 1,
          lessons: [{ position: 1, titolo: 'Memoria', sottotitolo: null }],
        },
        currentBody: body,
      }}
      onClear={clear}
      onPersistBody={async (value) => value}
      onSaveConceptMap={vi.fn()}
      onSavePool={vi.fn()}
      onRefreshVisuals={vi.fn()}
      onClose={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole('checkbox', { name: 'Includi esercitazioni' }));
  for (const [name, value] of [
    ['Aperte', '1'],
    ['Risposta singola', '0'],
    ['Risposta multipla', '0'],
  ])
    fireEvent.change(screen.getByRole('textbox', { name }), { target: { value } });
  fireEvent.click(screen.getByRole('button', { name: 'Sostituisci e genera tutto' }));
  return clear;
}
it.each([false, true])(
  'retains content and review through late content clearing and completion (review retry %s)',
  async (retry) => {
    state.failReviewOnce = retry;
    const clear = renderGeneration();
    if (retry) {
      await screen.findByRole('button', { name: 'Riprova solo revisione' });
      expect(clear).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: 'Riprova solo revisione' }));
    }
    await screen.findByText('Lezione completata');
    const entries = readGenerationCosts(key);
    expect(entries.some((e) => e.id === 'old-generation')).toBe(false);
    expect(entries.reduce((sum, e) => sum + e.knownActualMicroUsd, 0)).toBe(retry ? 235 : 215);
    expect(entries.some((e) => e.unknown)).toBe(false);
    expect(clear).toHaveBeenCalledOnce();
    expect(state.events.indexOf('clear')).toBeGreaterThan(
      state.events.lastIndexOf('lesson_review'),
    );
    expect(
      screen.getByText(`Costo reale totale: ${retry ? '0.000235' : '0.000215'} USD.`),
    ).toBeTruthy();
  },
);
it('keeps an attempted image unknown when both invocation and status responses fail, despite old known plan costs', async () => {
  state.uncertainImage = true;
  renderGeneration();
  await screen.findByText('Lezione completata');
  const entry = readGenerationCosts(key).find((e) => e.id.includes(':image:'));
  expect(entry).toMatchObject({ knownActualMicroUsd: 7, unknown: true, pendingImageAttempt: 2 });
  expect(screen.getByText(/fasi con costo non ancora disponibile/)).toBeTruthy();
});
