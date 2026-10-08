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
  AiLessonReviewGenerateResult,
  AiLessonReviewPreviewResult,
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
function reviewPreviewResult(): AiLessonReviewPreviewResult {
  return { ...previewResult(), kind: 'lesson_review' };
}
function reviewGenerateResult(): AiLessonReviewGenerateResult {
  return {
    ...generateResult(),
    kind: 'lesson_review',
    output: {
      body: '## Reti\n\nContenuto revisionato.',
      reviewOutcome: 'improved',
      issueCodes: ['structure'],
    },
  };
}

function makeCallables(overrides: Partial<AiLessonCallables> = {}) {
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
    previewReview: vi.fn(async () => reviewPreviewResult()),
    generateReview: vi.fn(async () => reviewGenerateResult()),
    ...overrides,
  };
  return { callables, previewRequests, generateRequests };
}

function renderDialog(
  callables: AiLessonCallables,
  onCompleteDraft: ComponentProps<typeof AiCompleteLessonGenerationDialog>['onCompleteDraft'],
  onClose: () => void = vi.fn(),
  onBeforeGenerate: () => Promise<void> = async () => undefined,
) {
  render(
    <AiCompleteLessonGenerationDialog
      context={CONTEXT}
      callables={callables}
      onBeforeGenerate={onBeforeGenerate}
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
  fireEvent.click(screen.getByRole('button', { name: 'Sostituisci e genera tutto' }));
  await Promise.resolve();
  await Promise.resolve();
}

describe('AiCompleteLessonGenerationDialog', () => {
  it('keeps completed stage reports across an image failure and retry without extra review calls', async () => {
    const { callables } = makeCallables();
    let attempts = 0;
    renderDialog(callables, async (_body, progress) => {
      attempts += 1;
      if (attempts === 1) {
        progress({
          stage: 'map',
          review: { status: 'improved', feedback: { changes: ['Precisato il collegamento.'] } },
        });
        progress({ stage: 'pool', review: { status: 'unchanged' } });
        throw new Error('Immagini interrotte');
      }
      return { imagesApplied: 0, imagesSkipped: 0, imagesFailed: 0 };
    });
    fireEvent.click(screen.getByRole('button', { name: 'Sostituisci e genera tutto' }));
    await screen.findByRole('button', { name: 'Riprova completamento' });
    fireEvent.click(screen.getAllByRole('button', { name: 'Resoconto del revisore' })[1]!);
    expect(screen.getByText('Precisato il collegamento.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Chiudi resoconto' }));
    fireEvent.click(screen.getByRole('button', { name: 'Riprova completamento' }));
    await screen.findByText('Lezione completata');
    fireEvent.click(screen.getAllByRole('button', { name: 'Resoconto del revisore' })[1]!);
    expect(screen.getByText('Precisato il collegamento.')).toBeTruthy();
    expect(callables.generateReview).toHaveBeenCalledOnce();
  });
  it.each(['improved', 'disabled'] as const)(
    'riprende un completamento con revisione %s senza nuove chiamate',
    async (reviewStatus) => {
      const { callables } = makeCallables();
      const onCompleteDraft = vi.fn(async () => ({
        imagesApplied: 0,
        imagesSkipped: 0,
        imagesFailed: 0,
      }));
      render(
        <AiCompleteLessonGenerationDialog
          context={{ ...CONTEXT, currentBody: '## Corpo salvato' }}
          callables={callables}
          resumeDraft={{
            body: '## Corpo salvato',
            message: 'Riprendi dalla mappa.',
            options: {
              level: 'balanced',
              counts: { aperta: 5, chiusa_singola: 3, chiusa_multipla: 2 },
              modelProfile: 'quality',
              reviewStatus,
            },
          }}
          onCompleteDraft={onCompleteDraft}
          onClose={vi.fn()}
        />,
      );

      expect(screen.getByText('Riprendi dalla mappa.')).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Riprova completamento' }));
      await screen.findByText('Il modello non ha individuato immagini didatticamente necessarie.');
      expect(
        screen.getByText('Contenuto già salvato: resoconto della revisione non disponibile.'),
      ).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Resoconto del revisore' })).toBeNull();
      expect(callables.preview).not.toHaveBeenCalled();
      expect(callables.generate).not.toHaveBeenCalled();
      expect(callables.previewReview).not.toHaveBeenCalled();
      expect(callables.generateReview).not.toHaveBeenCalled();
      expect(onCompleteDraft).toHaveBeenCalledWith(
        '## Corpo salvato',
        expect.any(Function),
        expect.objectContaining({ modelProfile: 'quality' }),
      );
    },
  );

  it('mostra uno switch grafico attivo per default e OFF salta davvero il revisore', async () => {
    const { callables } = makeCallables();
    const onCompleteDraft = vi.fn(async () => ({
      imagesApplied: 0,
      imagesSkipped: 0,
      imagesFailed: 0,
    }));
    renderDialog(callables, onCompleteDraft);

    const toggle = screen.getByRole('switch', { name: 'Revisione avanzata' });
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    expect(screen.getByText('Attiva')).toBeTruthy();
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(screen.getByText('Disattivata')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Sostituisci e genera tutto' }));

    await screen.findByText('Revisione non richiesta');
    expect(callables.previewReview).not.toHaveBeenCalled();
    expect(callables.generateReview).not.toHaveBeenCalled();
    expect(onCompleteDraft).toHaveBeenCalledWith(
      generateResult().output.body,
      expect.any(Function),
      expect.any(Object),
    );
  });

  it('mostra revisione in corso e conferma l’esito reale nel riepilogo', async () => {
    let resolveReview!: (result: AiLessonReviewGenerateResult) => void;
    const pendingReview = new Promise<AiLessonReviewGenerateResult>((resolve) => {
      resolveReview = resolve;
    });
    const { callables } = makeCallables({
      generateReview: vi.fn(async () => pendingReview),
    });
    renderDialog(callables, async () => ({
      imagesApplied: 0,
      imagesSkipped: 0,
      imagesFailed: 0,
    }));
    fireEvent.click(screen.getByRole('button', { name: 'Sostituisci e genera tutto' }));

    expect(await screen.findByText('Revisione avanzata del contenuto…')).toBeTruthy();
    resolveReview(reviewGenerateResult());
    expect(await screen.findByText('✓ Revisione didattica completata')).toBeTruthy();
    expect(screen.getByText('Il revisore ha controllato e migliorato il contenuto.')).toBeTruthy();
    expect(callables.previewReview).toHaveBeenCalledTimes(1);
    expect(callables.generateReview).toHaveBeenCalledTimes(1);
  });

  it('con esito unchanged conserva byte per byte la bozza base', async () => {
    const misleadingBody = '## Reti\n\nRiscrittura che non deve essere applicata.';
    const { callables } = makeCallables({
      generateReview: vi.fn(
        async (): Promise<AiLessonReviewGenerateResult> => ({
          ...reviewGenerateResult(),
          output: { body: misleadingBody, reviewOutcome: 'unchanged', issueCodes: [] },
        }),
      ),
    });
    const onCompleteDraft = vi.fn(async () => ({
      imagesApplied: 0,
      imagesSkipped: 0,
      imagesFailed: 0,
    }));
    renderDialog(callables, onCompleteDraft);
    fireEvent.click(screen.getByRole('button', { name: 'Sostituisci e genera tutto' }));

    await screen.findByText('✓ Revisione didattica completata');
    expect(onCompleteDraft).toHaveBeenCalledWith(
      generateResult().output.body,
      expect.any(Function),
      expect.any(Object),
    );
    expect(onCompleteDraft).not.toHaveBeenCalledWith(
      misleadingBody,
      expect.any(Function),
      expect.any(Object),
    );
  });

  it('dopo un errore ritenta solo il revisore e completa con il corpo revisionato', async () => {
    let reviewCalls = 0;
    const { callables } = makeCallables({
      generateReview: vi.fn(async () => {
        reviewCalls += 1;
        if (reviewCalls === 1) throw new Error('review failed');
        return reviewGenerateResult();
      }),
    });
    const onBeforeGenerate = vi.fn(async () => undefined);
    const onCompleteDraft = vi.fn(async () => ({
      imagesApplied: 0,
      imagesSkipped: 0,
      imagesFailed: 0,
    }));
    renderDialog(callables, onCompleteDraft, vi.fn(), onBeforeGenerate);
    fireEvent.click(screen.getByRole('button', { name: 'Sostituisci e genera tutto' }));
    await screen.findByRole('button', { name: 'Riprova solo revisione' });

    expect(screen.getByText('Revisione didattica non completata')).toBeTruthy();
    expect(callables.generate).toHaveBeenCalledTimes(1);
    expect(onBeforeGenerate).not.toHaveBeenCalled();
    expect(onCompleteDraft).not.toHaveBeenCalled();
    expect(screen.queryByText('✓ Revisione didattica completata')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Riprova solo revisione' }));
    await screen.findByText('✓ Revisione didattica completata');
    expect(screen.queryByText('Revisione didattica non completata')).toBeNull();
    expect(callables.generate).toHaveBeenCalledTimes(1);
    expect(callables.previewReview).toHaveBeenCalledTimes(2);
    expect(callables.generateReview).toHaveBeenCalledTimes(2);
    expect(onBeforeGenerate).toHaveBeenCalledTimes(1);
    expect(onCompleteDraft).toHaveBeenCalledWith(
      reviewGenerateResult().output.body,
      expect.any(Function),
      expect.any(Object),
    );
  });

  it('non etichetta come errore del revisore un errore della generazione iniziale', async () => {
    const { callables } = makeCallables({
      generate: vi.fn(async () => {
        throw new Error('generation failed');
      }),
    });
    renderDialog(callables, async () => ({
      imagesApplied: 0,
      imagesSkipped: 0,
      imagesFailed: 0,
    }));
    fireEvent.click(screen.getByRole('button', { name: 'Sostituisci e genera tutto' }));

    await screen.findByRole('button', { name: 'Riprova' });
    expect(screen.queryByText('Revisione didattica non completata')).toBeNull();
  });

  it('usa Economy selezionabile e propone 5/3/2 domande equilibrate', async () => {
    const { callables, previewRequests, generateRequests } = makeCallables();
    renderDialog(callables, async () => ({
      imagesApplied: 0,
      imagesSkipped: 0,
      imagesFailed: 0,
    }));

    expect(screen.getByRole('combobox', { name: 'Profilo modello' })).toHaveProperty(
      'value',
      'economy',
    );
    expect(screen.getByRole('option', { name: 'Economy — gpt-5.6-luna' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Quality — gpt-6.1-sol' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Aperte' })).toHaveProperty('value', '5');
    expect(screen.getByRole('textbox', { name: 'Risposta singola' })).toHaveProperty('value', '3');
    expect(screen.getByRole('textbox', { name: 'Risposta multipla' })).toHaveProperty('value', '2');
    expect(screen.queryByText(/Totale:/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Diminuisci domande aperte' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Aumenta domande aperte' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: /Equilibrato/ }).getAttribute('aria-checked')).toBe(
      'true',
    );
    expect(screen.getByRole('radio', { name: /Completa/ }).getAttribute('aria-checked')).toBe(
      'true',
    );
    expect(screen.queryByLabelText('Quantità')).toBeNull();
    expect(screen.queryByText(/Auto \(1/)).toBeNull();

    fireEvent.change(screen.getByRole('combobox', { name: 'Profilo modello' }), {
      target: { value: 'quality' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Sostituisci e genera tutto' }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(previewRequests).toHaveLength(1);
    expect(generateRequests).toHaveLength(1);
    expect(generateRequests[0]).toEqual(previewRequests[0]);
    expect(generateRequests[0]?.modelProfile).toBe('quality');
  });

  it('pulisce solo dopo che generazione e revisione hanno prodotto il corpo finale', async () => {
    const { callables } = makeCallables();
    const onBeforeGenerate = vi.fn(async () => undefined);
    renderDialog(
      callables,
      async () => ({ imagesApplied: 0, imagesSkipped: 0, imagesFailed: 0 }),
      vi.fn(),
      onBeforeGenerate,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Sostituisci e genera tutto' }));
    await screen.findByText('Il modello non ha individuato immagini didatticamente necessarie.');
    expect(onBeforeGenerate).toHaveBeenCalledTimes(1);
    expect(vi.mocked(callables.preview).mock.invocationCallOrder[0]).toBeLessThan(
      onBeforeGenerate.mock.invocationCallOrder[0]!,
    );
    expect(vi.mocked(callables.generate).mock.invocationCallOrder[0]).toBeLessThan(
      onBeforeGenerate.mock.invocationCallOrder[0]!,
    );
    expect(vi.mocked(callables.generateReview!).mock.invocationCallOrder[0]).toBeLessThan(
      onBeforeGenerate.mock.invocationCallOrder[0]!,
    );
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
    expect(
      screen.getAllByRole('status').some((status) => status.getAttribute('aria-busy') === 'true'),
    ).toBe(true);
    expect(onCompleteDraft).toHaveBeenCalledWith(
      '## Reti\n\nContenuto revisionato.',
      expect.any(Function),
      {
        level: 'balanced',
        modelProfile: 'economy',
        counts: { aperta: 5, chiusa_singola: 3, chiusa_multipla: 2 },
        reviewStatus: 'improved',
      },
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

  it('non descrive un piano visuale fallito come nessuna immagine necessaria', async () => {
    const { callables } = makeCallables();
    await goToReview(callables, async () => {
      throw { details: { code: 'provider_invalid_output' } };
    });

    expect(await screen.findByText('La risposta generata non è valida. Riprova.')).toBeTruthy();
    expect(
      screen.queryByText('Il modello non ha individuato immagini didatticamente necessarie.'),
    ).toBeNull();
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
  fireEvent.click(screen.getByRole('button', { name: 'Sostituisci e genera tutto' }));
  await Promise.resolve();
  await Promise.resolve();
}
