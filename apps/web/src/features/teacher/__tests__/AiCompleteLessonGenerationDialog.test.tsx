import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';

vi.mock('../../../lib/firebase.js', () => ({
  app: {},
  auth: {},
  db: {},
  storage: {},
  functions: {},
}));

import {
  AiCompleteLessonGenerationDialog,
  type CompleteLessonCompletionSummary,
} from '../AiCompleteLessonGenerationDialog.js';
import type {
  AiLessonCallables,
  AiLessonContentRequest,
  AiLessonGenerateResult,
  AiLessonPreviewResult,
  LessonAiContext,
} from '../../repository/pools/aiContentClient.js';

afterEach(cleanup);

const CONTEXT: LessonAiContext = {
  titolo: 'Le reti',
  sottotitolo: null,
  difficolta: 'intermedia',
  udaTitle: 'UDA 1',
  concettiChiave: ['TCP', 'IP'],
  obiettivi: ['Comprendere i livelli'],
  udaContext: {
    title: 'UDA 1',
    descrizione: 'Le reti locali.',
    competenze: ['Progettare una LAN'],
    obiettivi: ['Confrontare i protocolli'],
    currentLessonPosition: 1,
    lessons: [{ position: 1, titolo: 'Le reti', sottotitolo: null }],
  },
  currentBody: '',
};

function previewResult(): AiLessonPreviewResult {
  return {
    kind: 'lesson',
    modelProfile: 'gpt-5.6-luna',
    estimatedInputTokens: 900,
    maxOutputTokens: 3500,
    estimatedCostMicroUsd: 4_000,
    reservationCostMicroUsd: 9_000,
    requestedTotal: null,
  };
}

function generateResult(): AiLessonGenerateResult {
  return {
    status: 'completed',
    kind: 'lesson',
    modelProfile: 'gpt-5.6-luna',
    output: { body: '## Reti\n\nContenuto completo.' },
    actualCostMicroUsd: 3_800,
    replayed: false,
  };
}

function makeCallables() {
  const previewRequests: AiLessonContentRequest[] = [];
  const generateRequests: AiLessonContentRequest[] = [];
  const callables: AiLessonCallables = {
    preview: vi.fn(async (request) => {
      previewRequests.push(request);
      return previewResult();
    }),
    generate: vi.fn(async (request) => {
      generateRequests.push(request);
      return generateResult();
    }),
  };
  return { callables, previewRequests, generateRequests };
}

function renderDialog(
  callables: AiLessonCallables,
  onCompleteDraft: (
    body: string,
    onProgress: Parameters<
      ComponentProps<typeof AiCompleteLessonGenerationDialog>['onCompleteDraft']
    >[1],
  ) => Promise<CompleteLessonCompletionSummary>,
  onClose: () => void = vi.fn(),
) {
  render(
    <AiCompleteLessonGenerationDialog
      context={CONTEXT}
      callables={callables}
      onCompleteDraft={onCompleteDraft}
      onClose={onClose}
    />,
  );
}

async function goToReview(
  callables: AiLessonCallables,
  onCompleteDraft: ComponentProps<
    typeof AiCompleteLessonGenerationDialog
  >['onCompleteDraft'] = async () => ({
    imagesApplied: 0,
    imagesSkipped: 0,
    imagesFailed: 0,
  }),
) {
  renderDialog(callables, onCompleteDraft);
  fireEvent.click(screen.getByRole('button', { name: 'Genera tutto' }));
  await Promise.resolve();
  await Promise.resolve();
}

describe('AiCompleteLessonGenerationDialog', () => {
  it('riusa configurazione e payload contenuto, senza chiedere la quantità immagini', async () => {
    const { callables, previewRequests, generateRequests } = makeCallables();
    renderDialog(callables, async () => ({
      imagesApplied: 0,
      imagesSkipped: 0,
      imagesFailed: 0,
    }));

    expect(screen.getByRole('radio', { name: /Quality/ }).getAttribute('aria-checked')).toBe(
      'true',
    );
    expect(screen.getByRole('radio', { name: /Completa/ }).getAttribute('aria-checked')).toBe(
      'true',
    );
    expect(screen.queryByLabelText('Quantità')).toBeNull();
    expect(screen.queryByText(/Auto \(1/)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Genera tutto' }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(previewRequests).toHaveLength(1);
    expect(generateRequests).toHaveLength(1);
    expect(generateRequests[0]).toEqual(previewRequests[0]);
  });

  it('delega il draft validato e mostra il progresso immagini accessibile', async () => {
    const { callables } = makeCallables();
    let resolveCompletion!: (summary: CompleteLessonCompletionSummary) => void;
    const pending = new Promise<CompleteLessonCompletionSummary>((resolve) => {
      resolveCompletion = resolve;
    });
    const onCompleteDraft = vi.fn(async (body, onProgress) => {
      onProgress({ stage: 'analysis' });
      onProgress({ stage: 'images', current: 2, total: 3 });
      return pending;
    });
    await goToReview(callables, onCompleteDraft);

    await screen.findByText('Generazione immagine 2 di 3…');
    expect(screen.getByRole('status').getAttribute('aria-busy')).toBe('true');
    expect(onCompleteDraft).toHaveBeenCalledWith(
      '## Reti\n\nContenuto completo.',
      expect.any(Function),
    );

    resolveCompletion({ imagesApplied: 3, imagesSkipped: 0, imagesFailed: 0 });
    await screen.findByText('Sono state applicate 3 immagini.');
  });

  it('gestisce zero immagini come esito completo senza un altro passaggio', async () => {
    const { callables } = makeCallables();
    await goToReview(
      callables,
      vi.fn(async () => ({ imagesApplied: 0, imagesSkipped: 0, imagesFailed: 0 })),
    );
    expect(
      await screen.findByText('Il modello non ha individuato immagini didatticamente necessarie.'),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Riprova elementi mancanti' })).toBeNull();
  });

  it('ritenta solo il residuo fornito dal riepilogo senza rigenerare il contenuto', async () => {
    const { callables } = makeCallables();
    const retry = vi.fn(async (onProgress) => {
      onProgress({ stage: 'images', current: 1, total: 1 });
      return { imagesApplied: 2, imagesSkipped: 0, imagesFailed: 0 };
    });
    const onCompleteDraft = vi.fn(async () => ({
      imagesApplied: 1,
      imagesSkipped: 0,
      imagesFailed: 1,
      retry,
    }));
    await goToReview(callables, onCompleteDraft);
    fireEvent.click(await screen.findByRole('button', { name: 'Riprova elementi mancanti' }));

    await screen.findByText('Sono state applicate 2 immagini.');
    expect(retry).toHaveBeenCalledTimes(1);
    expect(onCompleteDraft).toHaveBeenCalledTimes(1);
    expect(callables.generate).toHaveBeenCalledTimes(1);
  });

  it('ignora Escape e backdrop durante il completamento', async () => {
    const { callables } = makeCallables();
    const onClose = vi.fn();
    const never = new Promise<CompleteLessonCompletionSummary>(() => {});
    await goToReview(callables, async () => never);
    // goToReview rendered with its own onClose; rerender explicitly for this assertion.
    cleanup();
    await goToReviewWithClose(callables, async () => never, onClose);

    const dialog = await screen.findByRole('dialog');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    fireEvent.click(dialog.parentElement!);
    expect(onClose).not.toHaveBeenCalled();
  });
});

async function goToReviewWithClose(
  callables: AiLessonCallables,
  onCompleteDraft: ComponentProps<typeof AiCompleteLessonGenerationDialog>['onCompleteDraft'],
  onClose: () => void,
) {
  renderDialog(callables, onCompleteDraft, onClose);
  fireEvent.click(screen.getByRole('button', { name: 'Genera tutto' }));
  await Promise.resolve();
  await Promise.resolve();
}
