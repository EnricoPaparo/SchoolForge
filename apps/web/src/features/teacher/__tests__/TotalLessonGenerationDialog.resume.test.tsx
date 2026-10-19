import { createHash } from 'node:crypto';
import { STUDY_BODY } from '../../repository/programs/__tests__/studyFixture.js';
import { createCompletePracticeState } from '../../repository/programs/completePracticeGeneration.js';
import { legacyPracticePoolContext } from '../../repository/programs/studyPractice.js';
import { fingerprintCompleteLessonBody } from '../../repository/programs/completeLessonFingerprint.js';
import { buildPoolContentRequest } from '../../repository/pools/aiContentClient.js';
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
  readCompleteLessonCheckpoint,
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
import {
  TotalLessonGenerationDialog,
  describeCompleteWorkflowError,
} from '../TotalLessonGenerationDialog.js';

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
    expect((state.summary as CompleteLessonCompletionSummary | null)?.actualCostMicroUsd).toBe(
      stage === 'reviewed' ? 11 : 8,
    );
  },
);

it('replays a lost-response legacy pool request with identical JSON/hash and no additional provider spend', async () => {
  cleanup();
  window.sessionStorage.clear();
  state.summary = null;
  state.error = null;
  state.generate.mockReset();
  const identity = { programId: 'p', importId: 'i', lessonId: 'l' };
  const fixture = studyFixture();
  const originalContext = JSON.stringify({
    objectives: fixture.plan.objectives,
    activities: fixture.plan.steps.map((s) => ({
      capability: fixture.plan.objectives[s.objectiveIndex]?.capability,
      stage: s.stage,
      question: fixture.questions[s.questionOrder]?.testo,
    })),
  });
  expect(legacyPracticePoolContext(fixture)).toBe(originalContext);
  const originalRequest = {
    ...buildPoolContentRequest({
      modelProfile: 'quality',
      requestId: 'legacy-lost-pool',
      level: 'balanced',
      counts: { aperta: 1, chiusa_singola: 0, chiusa_multipla: 0 },
      lessonSource: STUDY_BODY,
      existingPoolQuestionCount: 0,
    }),
    draftPractice: originalContext,
  };
  const originalJSON = JSON.stringify(originalRequest);
  const originalHash = createHash('sha256').update(originalJSON).digest('hex');
  const providerSpend = vi.fn();
  providerSpend(); // The server completed the original call; its response was lost.
  const practice = {
    ...createCompletePracticeState(['Prevedere output']),
    sourceFingerprint: fingerprintCompleteLessonBody(STUDY_BODY),
    base: {
      status: 'completed' as const,
      kind: 'pool' as const,
      modelProfile: 'quality',
      actualCostMicroUsd: 3,
      replayed: false,
      output: { questions: fixture.questions, studyPlan: fixture.plan },
    },
    saved: true,
  };
  writeCompleteLessonCheckpoint(
    createCompleteLessonCheckpoint({
      identity,
      body: STUDY_BODY,
      options: {
        practiceEnabled: true,
        practiceCount: 3,
        modelProfile: 'quality',
        level: 'balanced',
        counts: { aperta: 1, chiusa_singola: 0, chiusa_multipla: 0 },
        reviewStatus: 'disabled',
      },
      bodyPersisted: true,
      practice,
      mapCompleted: true,
      poolCompleted: false,
      mapRequestId: 'legacy-map',
      poolRequestId: 'legacy-lost-pool',
      mapCostMicroUsd: 1,
      poolCostMicroUsd: null,
      visual: null,
    }),
  );
  state.generate.mockImplementation(async (request) => {
    expect(JSON.stringify(request)).toBe(originalJSON);
    expect(createHash('sha256').update(JSON.stringify(request)).digest('hex')).toBe(originalHash);
    const saved = readCompleteLessonCheckpoint(identity, STUDY_BODY)!;
    expect(saved.poolContext).toEqual({ format: 'legacy', draftPractice: originalContext });
    return {
      status: 'completed',
      kind: 'pool',
      modelProfile: 'quality',
      actualCostMicroUsd: null,
      replayed: true,
      output: { questions: [fixture.questions[0]] },
    };
  });
  render(
    <TotalLessonGenerationDialog
      identity={identity}
      context={{
        titolo: 'Cicli',
        sottotitolo: null,
        difficolta: 'Base',
        udaTitle: 'Cicli',
        currentBody: STUDY_BODY,
      }}
      onClear={vi.fn()}
      onPersistBody={vi.fn()}
      onSaveConceptMap={vi.fn()}
      onSavePool={vi.fn()}
      onSavePractice={vi.fn()}
      onVerifyPractice={vi.fn()}
      onRefreshVisuals={vi.fn()}
      onClose={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
  await waitFor(() => expect(state.summary).not.toBeNull());
  expect(state.error).toBeNull();
  expect(state.generate).toHaveBeenCalledOnce();
  expect(providerSpend).toHaveBeenCalledOnce();
});

it.each([false, true])(
  'handles legacy context overflow safely with poolCompleted=%s',
  async (poolCompleted) => {
    cleanup();
    window.sessionStorage.clear();
    state.summary = null;
    state.error = null;
    state.generate.mockReset();
    const identity = { programId: 'p', importId: 'i', lessonId: 'l' };
    const fixture = studyFixture();
    fixture.questions.forEach((q) => {
      q.testo = '界'.repeat(9000);
    });
    expect(() => legacyPracticePoolContext(fixture)).toThrow();
    const practice = {
      ...createCompletePracticeState(['Prevedere output']),
      sourceFingerprint: fingerprintCompleteLessonBody(STUDY_BODY),
      base: {
        status: 'completed' as const,
        kind: 'pool' as const,
        modelProfile: 'quality',
        actualCostMicroUsd: 3,
        replayed: false,
        output: { questions: fixture.questions, studyPlan: fixture.plan },
      },
      saved: true,
    };
    writeCompleteLessonCheckpoint(
      createCompleteLessonCheckpoint({
        identity,
        body: STUDY_BODY,
        options: {
          practiceEnabled: true,
          practiceCount: 3,
          modelProfile: 'quality',
          level: 'balanced',
          counts: { aperta: 1, chiusa_singola: 0, chiusa_multipla: 0 },
          reviewStatus: 'disabled',
        },
        bodyPersisted: true,
        practice,
        mapCompleted: true,
        poolCompleted,
        mapRequestId: 'legacy-map',
        poolRequestId: 'legacy-pool',
        mapCostMicroUsd: 1,
        poolCostMicroUsd: 2,
        visual: null,
      }),
    );
    const verify = vi.fn();
    render(
      <TotalLessonGenerationDialog
        identity={identity}
        context={{
          titolo: 'Cicli',
          sottotitolo: null,
          difficolta: 'Base',
          udaTitle: 'Cicli',
          currentBody: STUDY_BODY,
        }}
        onClear={vi.fn()}
        onPersistBody={vi.fn()}
        onSaveConceptMap={vi.fn()}
        onSavePool={vi.fn()}
        onSavePractice={vi.fn()}
        onVerifyPractice={verify}
        onRefreshVisuals={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
    await waitFor(() => expect(state.summary !== null || state.error !== null).toBe(true));
    if (poolCompleted) {
      expect(state.summary).not.toBeNull();
      expect(state.error).toBeNull();
    } else {
      expect(state.summary).toBeNull();
      expect(describeCompleteWorkflowError(state.error)).toContain('scarta');
    }
    expect(state.generate).not.toHaveBeenCalled();
    expect(verify).toHaveBeenCalledOnce();
  },
);
