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
  clearCompleteLessonCheckpoint,
  createCompleteLessonCheckpoint,
  readCompleteLessonCheckpoint,
  writeCompleteLessonCheckpoint,
} from '../repository/programs/completeLessonCheckpoint.js';
import {
  AiCompleteLessonGenerationDialog,
  type CompleteLessonCompletionSummary,
  type CompleteLessonOptions,
  type CompleteLessonProgress,
} from './AiCompleteLessonGenerationDialog.js';
import type { ParsedPool } from '@schoolforge/lesson-contract';

type CompleteWorkflowStage = 'persist_body' | 'concept_map' | 'question_pool' | 'visual_plan';

export class CompleteWorkflowError extends Error {
  constructor(
    readonly stage: CompleteWorkflowStage,
    readonly cause: unknown,
  ) {
    super(`complete_workflow_${stage}`);
    this.name = 'CompleteWorkflowError';
  }
}

function completionErrorCode(cause: unknown): string | null {
  const details = (cause as { details?: unknown })?.details;
  if (typeof details === 'object' && details !== null) {
    const code = (details as { code?: unknown }).code;
    if (typeof code === 'string') return code.replace(/^functions\//, '');
  }
  const direct = (cause as { code?: unknown })?.code;
  return typeof direct === 'string' ? direct.replace(/^functions\//, '') : null;
}

export function describeCompleteWorkflowError(cause: unknown): string {
  if (!(cause instanceof CompleteWorkflowError)) {
    return 'Il completamento si è interrotto. Riprova.';
  }
  const code = completionErrorCode(cause.cause);
  if (cause.stage === 'persist_body') {
    return 'Non è stato possibile salvare la lezione. Nessuna fase successiva è stata avviata.';
  }
  if (cause.stage === 'concept_map') {
    if (code === 'provider_invalid_output' || code === 'output_incomplete') {
      return 'La mappa prodotta non era valida. La lezione è salva: riprova dalla mappa.';
    }
    return 'La generazione della mappa si è interrotta. La lezione è salva: riprova dalla mappa.';
  }
  if (cause.stage === 'question_pool') {
    if (code === 'provider_invalid_output' || code === 'output_incomplete') {
      return 'Le domande prodotte non erano valide. Lezione e mappa sono salve: riprova dalle domande.';
    }
    return 'La generazione delle domande si è interrotta. Lezione e mappa sono salve: riprova dalle domande.';
  }
  if (code === 'invalid_input' || code === 'visual_plan_proposal_body_changed') {
    return 'Il piano immagini non è più allineato alla lezione salvata. Lezione, mappa e domande sono salve: ricarica e riprova le immagini.';
  }
  return 'La preparazione delle immagini si è interrotta. Lezione, mappa e domande sono salve: riprova le immagini.';
}

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

  const restoredCheckpoint = useMemo(
    () => readCompleteLessonCheckpoint(identity, context.currentBody),
    [context.currentBody, identity.importId, identity.lessonId, identity.programId],
  );

  const clearedRef = useRef(Boolean(restoredCheckpoint));
  const bodyPersistedRef = useRef(Boolean(restoredCheckpoint));
  const mapCompletedRef = useRef(restoredCheckpoint?.mapCompleted ?? false);
  const poolCompletedRef = useRef(restoredCheckpoint?.poolCompleted ?? false);
  const mapRequestIdRef = useRef(restoredCheckpoint?.mapRequestId ?? newRequestId());
  const poolRequestIdRef = useRef(restoredCheckpoint?.poolRequestId ?? newRequestId());
  const mapCostRef = useRef<number | null>(restoredCheckpoint?.mapCostMicroUsd ?? 0);
  const poolCostRef = useRef<number | null>(restoredCheckpoint?.poolCostMicroUsd ?? 0);
  const visualStateRef = useRef<CompleteLessonGenerationState | null>(
    restoredCheckpoint?.visual
      ? {
          ...createCompleteLessonGenerationState({
            identity,
            body: context.currentBody,
            visualContext: {
              titolo: context.titolo,
              sottotitolo: context.sottotitolo,
              difficolta: context.difficolta,
              concettiChiave: context.concettiChiave ?? [],
              obiettivi: context.obiettivi ?? [],
              udaTitle: context.udaTitle,
              udaContext: context.udaContext,
            },
            contentRequestId: restoredCheckpoint.visual.contentRequestId,
          }),
          planRequestId: restoredCheckpoint.visual.planRequestId,
          promotionRequestIds: restoredCheckpoint.visual.promotionRequestIds,
          bodyPersisted: true,
        }
      : null,
  );

  function persistCheckpoint(body: string, options: CompleteLessonOptions) {
    if (!bodyPersistedRef.current) return;
    const visual = visualStateRef.current;
    writeCompleteLessonCheckpoint(
      createCompleteLessonCheckpoint({
        identity,
        body,
        options,
        bodyPersisted: true,
        mapCompleted: mapCompletedRef.current,
        poolCompleted: poolCompletedRef.current,
        mapRequestId: mapRequestIdRef.current,
        poolRequestId: poolRequestIdRef.current,
        mapCostMicroUsd: mapCostRef.current,
        poolCostMicroUsd: poolCostRef.current,
        visual: visual
          ? {
              contentRequestId: visual.contentRequestId,
              planRequestId: visual.planRequestId,
              promotionRequestIds: visual.promotionRequestIds,
            }
          : null,
      }),
    );
  }

  function discardCheckpoint() {
    clearCompleteLessonCheckpoint(identity);
    clearedRef.current = false;
    bodyPersistedRef.current = false;
    mapCompletedRef.current = false;
    poolCompletedRef.current = false;
    mapRequestIdRef.current = newRequestId();
    poolRequestIdRef.current = newRequestId();
    mapCostRef.current = 0;
    poolCostRef.current = 0;
    visualStateRef.current = null;
  }

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
      try {
        await onPersistBody(body);
      } catch (cause) {
        throw new CompleteWorkflowError('persist_body', cause);
      }
      bodyPersistedRef.current = true;
      persistCheckpoint(body, options);
    }

    if (!mapCompletedRef.current) {
      onProgress({ stage: 'map' });
      const request = buildConceptMapRequest({
        requestId: mapRequestIdRef.current,
        modelProfile: options.modelProfile,
        lessonBody: body,
      });
      try {
        await mapCallables.preview(request);
        const generated = await mapCallables.generate(request);
        const validated = validateConceptMapResult(generated);
        if (!validated.ok) throw new Error(validated.error);
        await onSaveConceptMap(validated.conceptMapMarkdown);
        mapCostRef.current = generated.actualCostMicroUsd;
        mapCompletedRef.current = true;
        persistCheckpoint(body, options);
      } catch (cause) {
        throw new CompleteWorkflowError('concept_map', cause);
      }
    }

    if (!poolCompletedRef.current) {
      const total =
        options.counts.aperta + options.counts.chiusa_singola + options.counts.chiusa_multipla;
      onProgress({ stage: 'pool', label: `Generazione di ${total} domande…` });
      const request = buildPoolContentRequest({
        modelProfile: options.modelProfile,
        requestId: poolRequestIdRef.current,
        level: options.level,
        counts: options.counts,
        lessonSource: body,
        existingPoolQuestionCount: 0,
      });
      try {
        await poolCallables.preview(request);
        const generated = await poolCallables.generate(request);
        const mapped = buildPoolFromProposal(null, proposalToLocalQuestions(generated.output));
        if (!mapped.ok) throw new Error(mapped.errors.join(' '));
        await onSavePool(mapped.pool);
        poolCostRef.current = generated.actualCostMicroUsd;
        poolCompletedRef.current = true;
        persistCheckpoint(body, options);
      } catch (cause) {
        throw new CompleteWorkflowError('question_pool', cause);
      }
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
      persistCheckpoint(body, options);
    }

    const visualResult = await runCompleteLessonGeneration(
      visualStateRef.current,
      {
        persistBody: async () => undefined,
        authorizeVisualPlan: (input) =>
          visualClient.authorize({ ...input, modelProfile: options.modelProfile }),
        generateVisualSlot: (input) => visualClient.generateSlot(input),
        promoteVisualSlot: (input) => visualClient.promoteSlot(input),
      },
      {
        onProgress: (progress) => adaptVisualProgress(progress, onProgress),
        onStateChange: (state) => {
          visualStateRef.current = state;
          persistCheckpoint(body, options);
        },
      },
    );
    visualStateRef.current = visualResult.state;
    const plan = visualResult.state.plan;
    if (!plan) {
      const proposalFailure = visualResult.failures.find(
        (failure) => failure.stage === 'authorize_plan',
      );
      if (
        proposalFailure?.code === 'provider_invalid_output' ||
        proposalFailure?.code === 'provider_unavailable'
      ) {
        // Il piano server ha liquidato il tentativo fatturabile e non può
        // essere riusato. Un retry esplicito dell'utente deve quindi creare una
        // nuova identità visuale, conservando corpo, mappa e pool già conclusi.
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
        persistCheckpoint(body, options);
      }
      throw new CompleteWorkflowError(
        'visual_plan',
        proposalFailure?.cause ?? new Error('Piano immagini non disponibile.'),
      );
    }
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

    if (visualResult.ok) clearCompleteLessonCheckpoint(identity);

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
      describeCompletionError={describeCompleteWorkflowError}
      resumeDraft={
        restoredCheckpoint
          ? {
              body: context.currentBody,
              options: restoredCheckpoint.options,
              message: restoredCheckpoint.poolCompleted
                ? 'È disponibile una generazione interrotta. Lezione, mappa e domande sono già salve: riprendi dalle immagini.'
                : restoredCheckpoint.mapCompleted
                  ? 'È disponibile una generazione interrotta. Lezione e mappa sono già salve: riprendi dalle domande.'
                  : 'È disponibile una generazione interrotta. La lezione è già salva: riprendi dalla mappa.',
            }
          : undefined
      }
      onDiscardResume={discardCheckpoint}
      onClose={onClose}
    />
  );
}
