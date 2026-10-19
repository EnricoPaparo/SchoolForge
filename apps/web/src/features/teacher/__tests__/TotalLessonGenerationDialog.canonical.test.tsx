import { beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type * as ContentClient from '../../repository/pools/aiContentClient.js';
import type * as MapClient from '../../repository/pools/aiConceptMapClient.js';
import type {
  CompleteLessonCompletionSummary,
  CompleteLessonOptions,
  CompleteLessonProgress,
} from '../AiCompleteLessonGenerationDialog.js';
import { STUDY_BODY, studyFixture } from '../../repository/programs/__tests__/studyFixture.js';
const state = vi.hoisted(() => ({
  generate: vi.fn(),
  map: vi.fn(),
  mapPreview: vi.fn(),
  mapReviewPreview: vi.fn(),
  reviewEnabled: false,
  raw: '',
  summary: null as CompleteLessonCompletionSummary | null,
  error: null as unknown,
}));
vi.mock('../../../lib/firebase.js', () => ({ functions: {} }));
vi.mock('../../repository/pools/aiContentClient.js', async (original) => ({
  ...(await original<typeof ContentClient>()),
  createAiLessonCallables: () => ({}),
  createAiContentCallables: () => ({
    preview: vi.fn(async () => ({ estimatedCostMicroUsd: 1, reservationCostMicroUsd: 2 })),
    generate: state.generate,
    previewReview: vi.fn(),
    generateReview: vi.fn(async (request: ContentClient.AiPoolReviewRequest) => ({
      status: 'completed',
      kind: 'pool_review',
      modelProfile: 'economy',
      actualCostMicroUsd: 1,
      replayed: false,
      output: {
        questions: request.candidateQuestions,
        studyPlan: request.candidateStudyPlan,
        reviewOutcome: 'unchanged',
        issueCodes: [],
      },
    })),
  }),
}));
vi.mock('../../repository/pools/aiConceptMapClient.js', async (original) => ({
  ...(await original<typeof MapClient>()),
  createAiConceptMapCallables: () => ({
    preview: state.mapPreview,
    generate: state.map,
    previewReview: state.mapReviewPreview,
    generateReview: vi.fn(async (request: MapClient.AiConceptMapReviewRequest) => ({
      status: 'completed',
      kind: 'concept_map_review',
      modelProfile: 'economy',
      actualCostMicroUsd: 1,
      replayed: false,
      output: {
        conceptMapMarkdown: request.candidateMarkdown,
        reviewOutcome: 'unchanged',
        issueCodes: [],
        sourceIssue: false,
      },
    })),
  }),
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
    onBeforeGenerate,
  }: {
    onBeforeGenerate: () => Promise<void>;
    onCompleteDraft: (
      body: string,
      progress: (p: CompleteLessonProgress) => void,
      options: CompleteLessonOptions,
    ) => Promise<CompleteLessonCompletionSummary>;
  }) => (
    <button
      onClick={async () => {
        try {
          await onBeforeGenerate();
          state.summary = await onCompleteDraft(state.raw, () => {}, {
            modelProfile: 'economy',
            level: 'balanced',
            counts: { aperta: 1, chiusa_singola: 0, chiusa_multipla: 0 },
            reviewStatus: state.reviewEnabled ? 'improved' : 'disabled',
            practiceEnabled: true,
            practiceCount: 3,
          });
        } catch (e) {
          state.error = e;
        }
      }}
    >
      Complete
    </button>
  ),
}));
import { TotalLessonGenerationDialog } from '../TotalLessonGenerationDialog.js';
beforeEach(() => {
  cleanup();
  window.sessionStorage.clear();
  vi.clearAllMocks();
  state.summary = null;
  state.error = null;
  state.reviewEnabled = false;
});
it.each(['\n', '\r\n', '   '])(
  'uses authoritative persisted source through private practice save and pool, with %j raw boundary',
  async (edge) => {
    state.raw = edge + '# Cicli\r\n\r\n' + STUDY_BODY + edge;
    const f = studyFixture();
    state.map.mockResolvedValue({
      kind: 'concept_map',
      status: 'completed',
      modelProfile: 'economy',
      actualCostMicroUsd: 1,
      replayed: false,
      output: { conceptMapMarkdown: '## Sintesi\n\nIl ciclo ripete il corpo.' },
    });
    state.generate.mockImplementation(async (request: ContentClient.AiPoolContentRequest) => ({
      kind: 'pool',
      status: 'completed',
      modelProfile: 'economy',
      actualCostMicroUsd: 1,
      replayed: false,
      output:
        request.purpose === 'practice'
          ? { questions: f.questions, studyPlan: f.plan }
          : { questions: [f.questions[0]] },
    }));
    const persist = vi.fn(async (_raw: string) => STUDY_BODY);
    const save = vi.fn(async (practice: typeof f) => {
      expect(practice.sourceBody).toBe(STUDY_BODY);
    });
    const verify = vi.fn(async () => {});
    const savePool = vi.fn();
    render(
      <TotalLessonGenerationDialog
        identity={{ programId: 'p', importId: 'i', lessonId: 'l' }}
        context={{
          titolo: 'Cicli',
          sottotitolo: null,
          difficolta: 'Base',
          concettiChiave: [],
          obiettivi: ['Prevedere output'],
          udaTitle: 'UDA',
          currentBody: '',
        }}
        onClear={vi.fn()}
        onPersistBody={persist}
        onSaveConceptMap={vi.fn()}
        onSavePractice={save}
        onVerifyPractice={verify}
        onSavePool={savePool}
        onRefreshVisuals={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Complete' }));
    await waitFor(() => {
      expect(state.error).toBeNull();
      expect(state.summary).not.toBeNull();
    });
    expect(persist).toHaveBeenCalledWith(state.raw);
    expect(state.map).toHaveBeenCalledWith(expect.objectContaining({ lessonBody: STUDY_BODY }));
    expect(save).toHaveBeenCalledOnce();
    expect(verify).toHaveBeenCalledOnce();
    expect(savePool).toHaveBeenCalledOnce();
    expect(state.generate).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ lessonSource: STUDY_BODY, draftPractice: expect.any(String) }),
    );
    expect(save.mock.invocationCallOrder[0]).toBeLessThan(
      state.generate.mock.invocationCallOrder[1]!,
    );
  },
);

it.each([
  'canonical',
  'external-before-commit',
  'external-after-commit',
  'external-empty-after-commit',
] as const)(
  'recognizes only its own clear while the canonical React commit is delayed: %s',
  async (mode) => {
    state.raw = '# Cicli\n\n' + STUDY_BODY + '\n';
    const f = studyFixture();
    let resolveMap!: (result: unknown) => void;
    state.map.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveMap = resolve;
        }),
    );
    state.generate.mockImplementation(async (request: ContentClient.AiPoolContentRequest) => ({
      kind: 'pool',
      status: 'completed',
      modelProfile: 'economy',
      actualCostMicroUsd: 1,
      replayed: false,
      output:
        request.purpose === 'practice'
          ? { questions: f.questions, studyPlan: f.plan }
          : { questions: [f.questions[0]] },
    }));
    const save = vi.fn(async (practice: typeof f) => {
      expect(practice.sourceBody).toBe(STUDY_BODY);
    });
    const verify = vi.fn(async () => {});
    const savePool = vi.fn();
    const persist = vi.fn(async () => STUDY_BODY);
    const clear = vi.fn(async () => {
      view.rerender(element(''));
    });
    const element = (currentBody: string) => (
      <TotalLessonGenerationDialog
        identity={{ programId: 'p', importId: 'i', lessonId: 'l' }}
        context={{
          titolo: 'Cicli',
          sottotitolo: null,
          difficolta: 'Base',
          concettiChiave: [],
          obiettivi: ['Prevedere output'],
          udaTitle: 'UDA',
          currentBody,
        }}
        onClear={clear}
        onPersistBody={persist}
        onSaveConceptMap={vi.fn()}
        onSavePractice={save}
        onVerifyPractice={verify}
        onSavePool={savePool}
        onRefreshVisuals={vi.fn()}
        onClose={vi.fn()}
      />
    );
    const view = render(element('Corpo precedente non vuoto.'));
    fireEvent.click(screen.getByRole('button', { name: 'Complete' }));
    await waitFor(() => expect(state.map).toHaveBeenCalledOnce());
    expect(clear).toHaveBeenCalledOnce();
    expect(persist).toHaveBeenCalledOnce();
    expect(state.error).toBeNull();
    if (mode === 'external-before-commit')
      view.rerender(element('Modifica esterna durante il salvataggio.'));
    view.rerender(element(STUDY_BODY));
    if (mode === 'external-after-commit' || mode === 'external-empty-after-commit') {
      view.rerender(
        element(mode === 'external-empty-after-commit' ? '' : 'Modifica esterna dopo il commit.'),
      );
      view.rerender(element(STUDY_BODY));
    }
    await act(async () => {
      resolveMap({
        kind: 'concept_map',
        status: 'completed',
        modelProfile: 'economy',
        actualCostMicroUsd: 1,
        replayed: false,
        output: { conceptMapMarkdown: '## Sintesi\n\nIl ciclo ripete il corpo.' },
      });
    });
    await waitFor(() => expect(state.summary !== null || state.error !== null).toBe(true));
    if (mode === 'canonical') {
      expect(state.error).toBeNull();
      expect(save).toHaveBeenCalledOnce();
      expect(verify).toHaveBeenCalledOnce();
      expect(savePool).toHaveBeenCalledOnce();
      expect(state.generate).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ lessonSource: STUDY_BODY, draftPractice: expect.any(String) }),
      );
    } else {
      expect(state.error).not.toBeNull();
      expect(state.generate).not.toHaveBeenCalled();
      expect(save).not.toHaveBeenCalled();
      expect(savePool).not.toHaveBeenCalled();
    }
  },
);

it.each(['map', 'pool'] as const)(
  'retries failed %s save without repeating generation',
  async (failedStage) => {
    state.raw = STUDY_BODY;
    const fixture = studyFixture();
    state.map.mockResolvedValue({
      status: 'completed',
      kind: 'concept_map',
      modelProfile: 'economy',
      actualCostMicroUsd: 1,
      replayed: false,
      output: { conceptMapMarkdown: '## Sintesi\n\nIl ciclo ripete il corpo.' },
    });
    state.generate.mockImplementation(async (request: ContentClient.AiPoolContentRequest) => ({
      status: 'completed',
      kind: 'pool',
      modelProfile: 'economy',
      actualCostMicroUsd: 1,
      replayed: false,
      output:
        request.purpose === 'practice'
          ? { questions: fixture.questions, studyPlan: fixture.plan }
          : { questions: [fixture.questions[0]] },
    }));
    const saveMap = vi.fn(async () => {});
    const savePool = vi.fn(async () => {});
    (failedStage === 'map' ? saveMap : savePool).mockRejectedValueOnce(
      new Error('save unavailable'),
    );
    render(
      <TotalLessonGenerationDialog
        identity={{ programId: 'p', importId: 'i', lessonId: 'l' }}
        context={{
          titolo: 'Cicli',
          sottotitolo: null,
          difficolta: 'Base',
          concettiChiave: [],
          obiettivi: ['Prevedere output'],
          udaTitle: 'UDA',
          currentBody: STUDY_BODY,
        }}
        onClear={vi.fn()}
        onPersistBody={vi.fn(async () => STUDY_BODY)}
        onSaveConceptMap={saveMap}
        onSavePool={savePool}
        onSavePractice={vi.fn()}
        onVerifyPractice={vi.fn()}
        onRefreshVisuals={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Complete' }));
    await waitFor(() => expect(state.error).not.toBeNull());
    state.error = null;
    fireEvent.click(screen.getByRole('button', { name: 'Complete' }));
    await waitFor(() => expect(state.summary).not.toBeNull());
    expect(state.error).toBeNull();
    expect(state.map).toHaveBeenCalledOnce();
    expect(state.generate).toHaveBeenCalledTimes(2);
    expect(failedStage === 'map' ? saveMap : savePool).toHaveBeenCalledTimes(2);
  },
);

it.each(['unmount', 'source_changed'] as const)(
  'stops map generation when %s occurs during preview',
  async (change) => {
    state.raw = STUDY_BODY;
    let release!: () => void;
    state.mapPreview.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const saveMap = vi.fn();
    const element = (body: string) => (
      <TotalLessonGenerationDialog
        identity={{ programId: 'p', importId: 'i', lessonId: 'l' }}
        context={{
          titolo: 'Cicli',
          sottotitolo: null,
          difficolta: 'Base',
          udaTitle: 'UDA',
          currentBody: body,
        }}
        onClear={vi.fn()}
        onPersistBody={vi.fn(async () => STUDY_BODY)}
        onSaveConceptMap={saveMap}
        onSavePool={vi.fn()}
        onRefreshVisuals={vi.fn()}
        onClose={vi.fn()}
      />
    );
    const view = render(element(STUDY_BODY));
    fireEvent.click(screen.getByRole('button', { name: 'Complete' }));
    await waitFor(() => expect(state.mapPreview).toHaveBeenCalledOnce());
    if (change === 'unmount') view.unmount();
    else view.rerender(element('Changed body'));
    await act(async () => release());
    await waitFor(() => expect(state.error).not.toBeNull());
    expect(state.map).not.toHaveBeenCalled();
    expect(saveMap).not.toHaveBeenCalled();
    expect(state.generate).not.toHaveBeenCalled();
  },
);

it('keeps known cost and candidate when map review preview alone fails', async () => {
  state.raw = STUDY_BODY;
  state.reviewEnabled = true;
  state.mapReviewPreview.mockRejectedValueOnce(new Error('preview only'));
  const fixture = studyFixture();
  state.map.mockResolvedValue({
    status: 'completed',
    kind: 'concept_map',
    modelProfile: 'economy',
    actualCostMicroUsd: 1,
    replayed: false,
    output: { conceptMapMarkdown: '## Sintesi\n\nIl ciclo ripete il corpo.' },
  });
  state.generate.mockImplementation(async (request: ContentClient.AiPoolContentRequest) => ({
    status: 'completed',
    kind: 'pool',
    modelProfile: 'economy',
    actualCostMicroUsd: 1,
    replayed: false,
    output:
      request.purpose === 'practice'
        ? { questions: fixture.questions, studyPlan: fixture.plan }
        : { questions: [fixture.questions[0]] },
  }));
  render(
    <TotalLessonGenerationDialog
      identity={{ programId: 'p', importId: 'i', lessonId: 'l' }}
      context={{
        titolo: 'Cicli',
        sottotitolo: null,
        difficolta: 'Base',
        obiettivi: ['Prevedere output'],
        udaTitle: 'UDA',
        currentBody: STUDY_BODY,
      }}
      onClear={vi.fn()}
      onPersistBody={vi.fn(async () => STUDY_BODY)}
      onSaveConceptMap={vi.fn()}
      onSavePool={vi.fn()}
      onSavePractice={vi.fn()}
      onVerifyPractice={vi.fn()}
      onRefreshVisuals={vi.fn()}
      onClose={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Complete' }));
  await waitFor(() => expect(state.error).not.toBeNull());
  state.error = null;
  fireEvent.click(screen.getByRole('button', { name: 'Complete' }));
  await waitFor(() => expect(state.summary).not.toBeNull());
  expect(state.error).toBeNull();
  expect(state.summary?.actualCostMicroUsd).not.toBeNull();
  expect(state.map).toHaveBeenCalledOnce();
  expect(state.mapReviewPreview).toHaveBeenCalledTimes(2);
  expect(state.generate).toHaveBeenCalledTimes(2);
});
