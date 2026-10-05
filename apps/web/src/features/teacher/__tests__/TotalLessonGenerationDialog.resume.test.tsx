import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ContentClient from '../../repository/pools/aiContentClient.js';
import type * as MapClient from '../../repository/pools/aiConceptMapClient.js';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type {
  CompleteLessonCompletionSummary,
  CompleteLessonOptions,
} from '../AiCompleteLessonGenerationDialog.js';
import {
  createCompleteLessonCheckpoint,
  writeCompleteLessonCheckpoint,
} from '../../repository/programs/completeLessonCheckpoint.js';

const state = vi.hoisted(() => ({
  summary: null as CompleteLessonCompletionSummary | null,
  generate: vi.fn(),
}));
vi.mock('../../../lib/firebase.js', () => ({ functions: {} }));
vi.mock('../../repository/pools/aiContentClient.js', async (original) => ({
  ...(await original<typeof ContentClient>()),
  createAiLessonCallables: () => ({}),
  createAiContentCallables: () => ({ preview: vi.fn(), generate: state.generate }),
}));
vi.mock('../../repository/pools/aiConceptMapClient.js', async (original) => ({
  ...(await original<typeof MapClient>()),
  createAiConceptMapCallables: () => ({ preview: vi.fn(), generate: state.generate }),
}));
vi.mock('../../repository/programs/multiVisualClient.js', () => ({
  createMultiVisualClient: () => ({
    authorize: vi.fn(async () => ({
      requestId: 'plan',
      slots: [],
      settlement: { proposalActualCost: 5, slots: [] },
    })),
  }),
}));
vi.mock('../AiCompleteLessonGenerationDialog.js', () => ({
  AiCompleteLessonGenerationDialog: ({
    onCompleteDraft,
    resumeDraft,
  }: {
    onCompleteDraft: (
      body: string,
      progress: () => void,
      options: CompleteLessonOptions,
    ) => Promise<CompleteLessonCompletionSummary>;
    resumeDraft: { body: string; options: CompleteLessonOptions };
  }) => (
    <button
      onClick={async () => {
        state.summary = await onCompleteDraft(resumeDraft.body, () => {}, resumeDraft.options);
      }}
    >
      Resume
    </button>
  ),
}));
import { TotalLessonGenerationDialog } from '../TotalLessonGenerationDialog.js';

describe('completed artifact costs after reload', () => {
  beforeEach(() => {
    cleanup();
    window.sessionStorage.clear();
    state.summary = null;
    state.generate.mockClear();
  });
  it.each(['map', 'pool'] as const)(
    'preserves unknown %s cost while skipping completed generators',
    async (unknown) => {
      const identity = { programId: 'p', importId: 'i', lessonId: 'l' };
      const body = '## RAM\n\nLa RAM è volatile.';
      writeCompleteLessonCheckpoint(
        createCompleteLessonCheckpoint({
          identity,
          body,
          options: {
            modelProfile: 'quality',
            level: 'balanced',
            counts: { aperta: 1, chiusa_singola: 0, chiusa_multipla: 0 },
            reviewStatus: 'improved',
          },
          bodyPersisted: true,
          mapCompleted: true,
          poolCompleted: true,
          mapRequestId: crypto.randomUUID(),
          poolRequestId: crypto.randomUUID(),
          mapCostMicroUsd: unknown === 'map' ? null : 20,
          poolCostMicroUsd: unknown === 'pool' ? null : 30,
          visual: null,
        }),
      );
      render(
        <TotalLessonGenerationDialog
          identity={identity}
          context={{
            titolo: 'RAM',
            sottotitolo: 'Volatilità',
            difficolta: 'Base',
            concettiChiave: ['RAM'],
            obiettivi: ['Spiegare la volatilità'],
            udaTitle: 'Memorie',
            currentBody: body,
          }}
          onClear={vi.fn()}
          onPersistBody={vi.fn()}
          onSaveConceptMap={vi.fn()}
          onSavePool={vi.fn()}
          onRefreshVisuals={vi.fn()}
          onClose={vi.fn()}
        />,
      );
      fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
      await waitFor(() => expect(state.summary).not.toBeNull());
      expect(state.summary?.actualCostMicroUsd).toBeNull();
      expect(state.generate).not.toHaveBeenCalled();
    },
  );
});
