import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as AiContentClientModule from '../../repository/pools/aiContentClient.js';

vi.mock('../../../lib/firebase.js', () => ({
  app: {},
  auth: {},
  db: {},
  storage: {},
  functions: {},
}));

// Inject fake lesson callables so the dialog resolves without network.
vi.mock('../../repository/pools/aiContentClient.js', async () => {
  const actual = await vi.importActual<typeof AiContentClientModule>(
    '../../repository/pools/aiContentClient.js',
  );
  return {
    ...actual,
    createAiLessonCallables: () => ({
      preview: async () => ({
        kind: 'lesson',
        modelProfile: 'gpt-5.6-luna',
        estimatedInputTokens: 900,
        maxOutputTokens: 3500,
        estimatedCostMicroUsd: 4000,
        reservationCostMicroUsd: 9000,
        requestedTotal: null,
      }),
      generate: async () => ({
        status: 'completed',
        kind: 'lesson',
        modelProfile: 'gpt-5.6-luna',
        output: { body: '## Nuova bozza\n\nGenerata.' },
        actualCostMicroUsd: 3800,
        replayed: false,
      }),
    }),
  };
});

import { MarkdownBodyEditor } from '../lessonEditors.js';

afterEach(cleanup);

const STATUS = { busy: false, error: null, saved: false };

/** Contesto completo richiesto da AIGEN-CONTEXT-01 per arrivare alla stima. */
const FULL_LESSON_AI = {
  titolo: 'Le reti',
  difficolta: 'intermedia',
  udaTitle: 'UDA 1',
  concettiChiave: ['TCP'],
  obiettivi: ['capire i livelli'],
  udaContext: {
    title: 'UDA 1',
    descrizione: 'Le reti locali e il loro funzionamento.',
    competenze: ['Progettare una LAN'],
    obiettivi: ['Riconoscere i livelli'],
    currentLessonPosition: 1,
    lessons: [{ position: 1, titolo: 'Le reti', sottotitolo: null }],
  },
};

describe('MarkdownBodyEditor — AIGEN-03 «Genera con IA»', () => {
  it('shows the button only when lessonAi context is provided (edit mode)', () => {
    const { rerender } = render(
      <MarkdownBodyEditor
        initial="Testo iniziale"
        status={STATUS}
        onSave={() => {}}
        onCancel={() => {}}
        onDirtyChange={() => {}}
      />,
    );
    expect(screen.queryByRole('button', { name: /Genera contenuto IA/ })).toBeNull();
    rerender(
      <MarkdownBodyEditor
        initial="Testo iniziale"
        status={STATUS}
        onSave={() => {}}
        onCancel={() => {}}
        onDirtyChange={() => {}}
        lessonAi={{ titolo: 'Le reti' }}
      />,
    );
    expect(screen.getByRole('button', { name: /Genera contenuto IA/ })).toBeTruthy();
  });

  it('«Usa questa bozza» replaces the local draft and marks dirty, without calling onSave', async () => {
    const onSave = vi.fn();
    const onDirtyChange = vi.fn();
    render(
      <MarkdownBodyEditor
        initial="Testo iniziale"
        status={STATUS}
        onSave={onSave}
        onCancel={() => {}}
        onDirtyChange={onDirtyChange}
        lessonAi={FULL_LESSON_AI}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Genera contenuto IA/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Calcola stima' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Genera bozza' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Usa questa bozza' }));

    const textarea = screen.getByLabelText('Corpo Markdown') as HTMLTextAreaElement;
    expect(textarea.value).toBe('## Nuova bozza\n\nGenerata.');
    // Dirty was reported (draft !== initial); no save service invoked.
    expect(onDirtyChange).toHaveBeenCalledWith(true);
    expect(onSave).not.toHaveBeenCalled();
  });

  it('cancelling the dialog leaves the original text untouched', async () => {
    render(
      <MarkdownBodyEditor
        initial="Testo iniziale"
        status={STATUS}
        onSave={() => {}}
        onCancel={() => {}}
        onDirtyChange={() => {}}
        lessonAi={FULL_LESSON_AI}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Genera contenuto IA/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Calcola stima' }));
    // Close from the estimate step.
    fireEvent.click(await screen.findByRole('button', { name: 'Modifica configurazione' }));
    const textarea = screen.getByLabelText('Corpo Markdown') as HTMLTextAreaElement;
    expect(textarea.value).toBe('Testo iniziale');
  });
});
