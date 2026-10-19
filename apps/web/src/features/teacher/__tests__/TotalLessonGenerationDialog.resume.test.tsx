import { studyFixture } from '../../repository/programs/__tests__/studyFixture.js';
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
  error: null as unknown,
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
        try {
          state.summary = await onCompleteDraft(resumeDraft.body, () => {}, resumeDraft.options);
        } catch (error) {
          state.error = error;
        }
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
    state.error = null;
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

it.each(['generated', 'reviewed'] as const)(
  'reloads %s snapshots after failed save without calling any generator or reviewer',
  async (stage) => {
    cleanup();
    window.sessionStorage.clear();
    state.summary = null;
    state.error = null;
    state.generate.mockClear();
    const identity = { programId: 'p', importId: 'i', lessonId: 'l' };
    const body = '## RAM\n\nLa RAM è volatile.';
    const map = {
      status: 'completed' as const,
      kind: 'concept_map' as const,
      modelProfile: 'quality',
      actualCostMicroUsd: 1,
      replayed: false,
      output: { conceptMapMarkdown: '## Sintesi\n\nLa RAM è volatile.' },
    };
    const pool = {
      ...map,
      kind: 'pool' as const,
      actualCostMicroUsd: 2,
      output: { questions: [studyFixture().questions[0]!] },
    };
    writeCompleteLessonCheckpoint(
      createCompleteLessonCheckpoint({
        identity,
        body,
        options: {
          modelProfile: 'quality',
          level: 'balanced',
          counts: { aperta: 1, chiusa_singola: 0, chiusa_multipla: 0 },
          reviewStatus: stage === 'reviewed' ? 'improved' : 'disabled',
        },
        bodyPersisted: true,
        mapCompleted: false,
        poolCompleted: false,
        mapRequestId: 'stable-map',
        poolRequestId: 'stable-pool',
        mapReviewRequestId: 'stable-map-review',
        poolReviewRequestId: 'stable-pool-review',
        mapCostMicroUsd: 0,
        poolCostMicroUsd: 0,
        visual: null,
        mapState: {
          base: map,
          reviewed:
            stage === 'reviewed'
              ? {
                  ...map,
                  kind: 'concept_map_review',
                  output: {
                    ...map.output,
                    reviewOutcome: 'unchanged',
                    issueCodes: [],
                    sourceIssue: false,
                  },
                }
              : null,
          costUnknown: false,
        },
        poolState: {
          base: pool,
          reviewed:
            stage === 'reviewed'
              ? {
                  ...pool,
                  kind: 'pool_review',
                  output: { ...pool.output, reviewOutcome: 'unchanged', issueCodes: [] },
                }
              : null,
          costUnknown: false,
        },
      }),
    );
    const saveMap = vi
      .fn(async () => {})
      .mockRejectedValueOnce(new Error('temporary save failure'));
    const savePool = vi.fn(async () => {});
    const element = (
      <TotalLessonGenerationDialog
        identity={identity}
        context={{
          titolo: 'RAM',
          sottotitolo: null,
          difficolta: 'Base',
          udaTitle: 'Memorie',
          currentBody: body,
        }}
        onClear={vi.fn()}
        onPersistBody={vi.fn()}
        onSaveConceptMap={saveMap}
        onSavePool={savePool}
        onRefreshVisuals={vi.fn()}
        onClose={vi.fn()}
      />
    );
    const view = render(element);
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
    await waitFor(() => expect(state.error).not.toBeNull());
    expect(state.summary).toBeNull();
    view.unmount();
    state.error = null;
    render(element);
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
    await waitFor(() => expect(state.summary).not.toBeNull());
    expect(state.error).toBeNull();
    expect(state.generate).not.toHaveBeenCalled();
    expect(saveMap).toHaveBeenCalledTimes(2);
    expect(savePool).toHaveBeenCalledOnce();
    expect(state.summary?.actualCostMicroUsd).toBe(stage === 'reviewed' ? 11 : 8);
  },
);
