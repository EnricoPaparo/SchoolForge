import { useMemo, useRef } from 'react';
import { functions } from '../../lib/firebase.js';
import {
  buildPoolContentRequest,
  createAiContentCallables,
  createAiLessonCallables,
  newRequestId,
  type LessonAiContext,
} from '../repository/pools/aiContentClient.js';
import {
  buildConceptMapRequest,
  createAiConceptMapCallables,
  validateConceptMapResult,
} from '../repository/pools/aiConceptMapClient.js';
import {
  buildPoolFromProposal,
  proposalToLocalQuestions,
} from '../repository/pools/aiPoolMapper.js';
import { createMultiVisualClient } from '../repository/programs/multiVisualClient.js';
import {
  createCompleteLessonGenerationState,
  runCompleteLessonGeneration,
  type CompleteLessonGenerationState,
  type CompleteLessonProgress as CoreProgress,
} from '../repository/programs/completeLessonGeneration.js';
import {
  AiCompleteLessonGenerationDialog,
  type CompleteLessonCompletionSummary,
  type CompleteLessonOptions,
  type CompleteLessonProgress,
} from './AiCompleteLessonGenerationDialog.js';
import type { ParsedPool } from '@schoolforge/lesson-contract';

export function TotalLessonGenerationDialog({
  context,
  identity,
  onClear,
  onPersistBody,
  onSaveConceptMap,
  onSavePool,
  onRefreshVisuals,
  onClose,
}: {
  context: LessonAiContext;
  identity: { programId: string; importId: string; lessonId: string };
  onClear: () => Promise<void>;
  onPersistBody: (body: string) => Promise<void>;
  onSaveConceptMap: (markdown: string) => Promise<void>;
  onSavePool: (pool: ParsedPool) => Promise<void>;
  onRefreshVisuals: () => Promise<void>;
  onClose: () => void;
}) {
  const lessonCallables = useMemo(() => createAiLessonCallables(functions), []);
  const mapCallables = useMemo(() => createAiConceptMapCallables(functions), []);
  const poolCallables = useMemo(() => createAiContentCallables(functions), []);
  const visualClient = useMemo(() => createMultiVisualClient(functions), []);

  const clearedRef = useRef(false);
  const bodyPersistedRef = useRef(false);
  const mapCompletedRef = useRef(false);
  const poolCompletedRef = useRef(false);
  const mapRequestIdRef = useRef(newRequestId());
  const poolRequestIdRef = useRef(newRequestId());
  const mapCostRef = useRef<number | null>(0);
  const poolCostRef = useRef<number | null>(0);
  const visualStateRef = useRef<CompleteLessonGenerationState | null>(null);

  async function clearOnce() {
    if (clearedRef.current) return;
    await onClear();
    clearedRef.current = true;
  }

  function adaptVisualProgress(
    progress: CoreProgress,
    onProgress: (progress: CompleteLessonProgress) => void,
  ) {
    if (progress.phase === 'planning_images') {
      onProgress({ stage: 'analysis', label: progress.message });
    } else if (progress.phase === 'generating_image' || progress.phase === 'promoting_image') {
      onProgress({
        stage: 'images',
        current: progress.current,
        total: progress.total,
        label: progress.message,
      });
    } else if (progress.phase === 'completed' || progress.phase === 'partial_failure') {
      onProgress({ stage: 'finalizing', label: progress.message });
    }
  }

  async function completeDraft(
    body: string,
    onProgress: (progress: CompleteLessonProgress) => void,
    options: CompleteLessonOptions,
  ): Promise<CompleteLessonCompletionSummary> {
    if (!bodyPersistedRef.current) {
      onProgress({ stage: 'content', label: 'Salvataggio della nuova lezione…' });
      await onPersistBody(body);
      bodyPersistedRef.current = true;
    }

    if (!mapCompletedRef.current) {
      onProgress({ stage: 'map' });
      const request = buildConceptMapRequest({
        requestId: mapRequestIdRef.current,
        modelProfile: 'quality',
        lessonBody: body,
      });
      await mapCallables.preview(request);
      const generated = await mapCallables.generate(request);
      const validated = validateConceptMapResult(generated);
      if (!validated.ok) throw new Error(validated.error);
      await onSaveConceptMap(validated.conceptMapMarkdown);
      mapCostRef.current = generated.actualCostMicroUsd;
      mapCompletedRef.current = true;
    }

    if (!poolCompletedRef.current) {
      const total =
        options.counts.aperta + options.counts.chiusa_singola + options.counts.chiusa_multipla;
      onProgress({ stage: 'pool', label: `Generazione di ${total} domande…` });
      const request = buildPoolContentRequest({
        requestId: poolRequestIdRef.current,
        level: options.level,
        counts: options.counts,
        lessonSource: body,
        existingPoolQuestionCount: 0,
      });
      await poolCallables.preview(request);
      const generated = await poolCallables.generate(request);
      const mapped = buildPoolFromProposal(null, proposalToLocalQuestions(generated.output));
      if (!mapped.ok) throw new Error(mapped.errors.join(' '));
      await onSavePool(mapped.pool);
      poolCostRef.current = generated.actualCostMicroUsd;
      poolCompletedRef.current = true;
    }

    if (!visualStateRef.current) {
      visualStateRef.current = {
        ...createCompleteLessonGenerationState({
          identity,
          body,
          visualContext: {
            titolo: context.titolo,
            sottotitolo: context.sottotitolo,
            difficolta: context.difficolta,
            concettiChiave: context.concettiChiave ?? [],
            obiettivi: context.obiettivi ?? [],
            udaTitle: context.udaTitle,
            udaContext: context.udaContext,
          },
          contentRequestId: newRequestId(),
        }),
        bodyPersisted: true,
      };
    }

    const visualResult = await runCompleteLessonGeneration(
      visualStateRef.current,
      {
        persistBody: async () => undefined,
        authorizeVisualPlan: (input) => visualClient.authorize(input),
        generateVisualSlot: (input) => visualClient.generateSlot(input),
        promoteVisualSlot: (input) => visualClient.promoteSlot(input),
      },
      {
        onProgress: (progress) => adaptVisualProgress(progress, onProgress),
        onStateChange: (state) => {
          visualStateRef.current = state;
        },
      },
    );
    visualStateRef.current = visualResult.state;
    const plan = visualResult.state.plan;
    if (!plan) throw new Error('Piano immagini non disponibile.');
    const imagesApplied = plan.slots.filter((slot) => Boolean(slot.promotedAssetId)).length;
    const imagesSkipped = plan.slots.filter(
      (slot) => slot.decision !== 'image' || slot.state === 'abandoned',
    ).length;
    const imagesFailed = plan.slots.filter(
      (slot) => slot.decision === 'image' && !slot.promotedAssetId && slot.state !== 'abandoned',
    ).length;
    if (imagesApplied > 0) await onRefreshVisuals();
    const visualCosts = [
      plan.settlement.proposalActualCost,
      ...plan.settlement.slots.map((slot) => slot.actualCost),
    ];
    const allCosts = [mapCostRef.current, poolCostRef.current, ...visualCosts];
    const actualCostMicroUsd = allCosts.some((cost) => cost === null)
      ? null
      : allCosts.reduce<number>((sum, cost) => sum + (cost ?? 0), 0);
    const canRetry =
      !visualResult.ok &&
      imagesFailed > 0 &&
      visualResult.failures.some((failure) => failure.retryable) &&
      !visualResult.failures.some((failure) => failure.terminal);

    return {
      mapGenerated: mapCompletedRef.current,
      questionsGenerated:
        options.counts.aperta + options.counts.chiusa_singola + options.counts.chiusa_multipla,
      imagesApplied,
      imagesSkipped,
      imagesFailed,
      actualCostMicroUsd,
      message: visualResult.ok
        ? undefined
        : canRetry
          ? 'Puoi ritentare soltanto le immagini mancanti.'
          : 'Le immagini non completate non possono essere ripetute in sicurezza in questo piano.',
      ...(canRetry ? { retry: (nextProgress) => completeDraft(body, nextProgress, options) } : {}),
    };
  }

  return (
    <AiCompleteLessonGenerationDialog
      context={context}
      callables={lessonCallables}
      onBeforeGenerate={clearOnce}
      onCompleteDraft={completeDraft}
      onClose={onClose}
    />
  );
}
