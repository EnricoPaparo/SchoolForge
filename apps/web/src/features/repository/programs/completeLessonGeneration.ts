import type {
  MultiVisualIdentity,
  MultiVisualPlan,
  MultiVisualPlanRequest,
} from './multiVisualClient.js';

export const COMPLETE_LESSON_GENERATION_VERSION = 1 as const;

export type CompleteLessonProgress =
  | { phase: 'saving_body'; message: string }
  | { phase: 'planning_images'; message: string }
  | { phase: 'generating_image'; current: number; total: number; message: string }
  | { phase: 'promoting_image'; current: number; total: number; message: string }
  | { phase: 'completed'; applied: number; total: number; message: string }
  | { phase: 'partial_failure'; applied: number; total: number; message: string };

export interface CompleteLessonVisualContext {
  titolo: unknown;
  sottotitolo: unknown;
  difficolta: unknown;
  concettiChiave: unknown;
  obiettivi: unknown;
  udaTitle: unknown;
  udaContext: unknown;
}

export interface CompleteLessonGenerationState {
  version: typeof COMPLETE_LESSON_GENERATION_VERSION;
  identity: MultiVisualIdentity;
  body: string;
  visualContext: CompleteLessonVisualContext;
  /** Identita del run testuale gia concluso. Non viene riusata per il ledger visuale. */
  contentRequestId: string;
  /** Identita stabile del piano visuale, distinta dal run testuale. */
  planRequestId: string;
  bodyPersisted: boolean;
  plan: MultiVisualPlan | null;
  /** Allocate e checkpointate prima della promozione, quindi riusabili dopo risposta persa. */
  promotionRequestIds: Record<string, string>;
  completed: boolean;
}

export interface CompleteLessonGenerationPorts {
  persistBody(input: {
    identity: MultiVisualIdentity;
    body: string;
    contentRequestId: string;
  }): Promise<void>;
  authorizeVisualPlan(input: MultiVisualPlanRequest): Promise<MultiVisualPlan>;
  generateVisualSlot(
    input: MultiVisualIdentity & { requestId: string; slotIndex: number },
  ): Promise<MultiVisualPlan>;
  promoteVisualSlot(
    input: MultiVisualIdentity & {
      requestId: string;
      slotIndex: number;
      promotionRequestId: string;
      mode: { mode: 'add' };
    },
  ): Promise<MultiVisualPlan>;
}

export interface CompleteLessonGenerationCallbacks {
  onProgress?: (progress: CompleteLessonProgress) => void;
  /** Consente alla UI di conservare gli ID/stati dopo ogni confine remoto. */
  onStateChange?: (state: CompleteLessonGenerationState) => void;
}

export interface CompleteLessonGenerationFailure {
  stage: 'persist_body' | 'authorize_plan' | 'generate_slot' | 'promote_slot';
  slotIndex: number | null;
  code: string | null;
  /** Impedisce qualunque ulteriore slot/spesa nel run corrente. */
  stopWorkflow: boolean;
  /** Il medesimo stato puo essere ripassato all'orchestratore in seguito. */
  retryable: boolean;
  /** Compatibilita semantica: stop definitivo sul medesimo stato. */
  terminal: boolean;
  cause: unknown;
}

export interface CompleteLessonGenerationSummary {
  applied: number;
  skipped: number;
  failed: number;
  actualKnownMicroUsd: number;
  actualCostUnknown: boolean;
}

export type CompleteLessonGenerationResult =
  | { ok: true; state: CompleteLessonGenerationState; failures: [] }
  | {
      ok: false;
      state: CompleteLessonGenerationState;
      failures: CompleteLessonGenerationFailure[];
    };

function copyState(state: CompleteLessonGenerationState): CompleteLessonGenerationState {
  return {
    ...state,
    promotionRequestIds: { ...state.promotionRequestIds },
  };
}

function errorCode(cause: unknown): string | null {
  const details = (cause as { details?: unknown })?.details;
  if (typeof details === 'object' && details !== null && 'code' in details) {
    const code = (details as { code?: unknown }).code;
    if (typeof code === 'string') return code;
  }
  const direct = (cause as { code?: unknown })?.code;
  return typeof direct === 'string' ? direct.replace(/^functions\//, '') : null;
}

const STOP_WORKFLOW_CODES = new Set([
  'budget_unavailable',
  'operation_budget_exceeded',
  'feature_disabled',
  'uncertain_state',
  'visual_plan_external_mutation',
  'visual_plan_proposal_body_changed',
  'visual_plan_expired',
  'corrupted_state',
]);

const RETRYABLE_STOP_CODES = new Set([
  'budget_unavailable',
  'operation_budget_exceeded',
  'feature_disabled',
]);

export function classifyCompleteLessonError(cause: unknown): {
  code: string | null;
  stopWorkflow: boolean;
  retryable: boolean;
  terminal: boolean;
} {
  const code = errorCode(cause);
  const stopWorkflow = code !== null && STOP_WORKFLOW_CODES.has(code);
  const retryable = !stopWorkflow || (code !== null && RETRYABLE_STOP_CODES.has(code));
  return { code, stopWorkflow, retryable, terminal: stopWorkflow && !retryable };
}

export function isTerminalCompleteLessonError(cause: unknown): boolean {
  return classifyCompleteLessonError(cause).terminal;
}

export function summarizeCompleteLessonGeneration(
  state: Pick<CompleteLessonGenerationState, 'plan'>,
): CompleteLessonGenerationSummary {
  const plan = state.plan;
  if (!plan) {
    return {
      applied: 0,
      skipped: 0,
      failed: 0,
      actualKnownMicroUsd: 0,
      actualCostUnknown: false,
    };
  }
  const imageSlots = plan.slots.filter((slot) => slot.decision === 'image');
  const actualKnownMicroUsd =
    (plan.settlement.proposalActualCost ?? 0) +
    plan.settlement.slots.reduce((total, slot) => total + (slot.actualCost ?? 0), 0);
  return {
    applied: imageSlots.filter((slot) => Boolean(slot.promotedAssetId)).length,
    skipped: plan.slots.filter((slot) => slot.decision !== 'image' || slot.state === 'abandoned')
      .length,
    failed: imageSlots.filter((slot) => slot.state === 'failed').length,
    actualKnownMicroUsd,
    actualCostUnknown:
      plan.settlement.proposalActualCost === null ||
      plan.settlement.slots.some((slot) => slot.actualCost === null),
  };
}

function canGenerateOrPromote(slot: MultiVisualPlan['slots'][number]): boolean {
  if (slot.decision !== 'image' || slot.promotedAssetId || slot.state === 'abandoned') return false;
  if (slot.state === 'pending') return true;
  if (slot.state === 'ready') return Boolean(slot.staged);
  return (
    slot.state === 'failed' &&
    slot.attempts < 2 &&
    slot.lastError !== 'uncertain_outcome' &&
    slot.lastError !== 'staging_conflict'
  );
}

function distinctId(createId: () => string, used: ReadonlySet<string>): string {
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const candidate = createId();
    if (candidate.length > 0 && !used.has(candidate)) return candidate;
  }
  throw new Error('complete_lesson_id_collision');
}

export function createCompleteLessonGenerationState(input: {
  identity: MultiVisualIdentity;
  body: string;
  visualContext: CompleteLessonVisualContext;
  contentRequestId: string;
  createId?: () => string;
}): CompleteLessonGenerationState {
  const createId = input.createId ?? (() => crypto.randomUUID());
  const planRequestId = distinctId(createId, new Set([input.contentRequestId]));
  return {
    version: COMPLETE_LESSON_GENERATION_VERSION,
    identity: { ...input.identity },
    body: input.body,
    visualContext: { ...input.visualContext },
    contentRequestId: input.contentRequestId,
    planRequestId,
    bodyPersisted: false,
    plan: null,
    promotionRequestIds: {},
    completed: false,
  };
}

/**
 * Orchestra soltanto i passi successivi alla generazione testuale. Il chiamante
 * conserva lo stesso state per ogni retry: i passi conclusi vengono saltati e
 * gli ID gia allocati vengono riutilizzati.
 */
export async function runCompleteLessonGeneration(
  initialState: CompleteLessonGenerationState,
  ports: CompleteLessonGenerationPorts,
  callbacks: CompleteLessonGenerationCallbacks = {},
  createId: () => string = () => crypto.randomUUID(),
): Promise<CompleteLessonGenerationResult> {
  let state = copyState(initialState);
  const failures: CompleteLessonGenerationFailure[] = [];
  const checkpoint = () => callbacks.onStateChange?.(copyState(state));

  if (state.completed) return { ok: true, state, failures: [] };

  if (!state.bodyPersisted) {
    callbacks.onProgress?.({ phase: 'saving_body', message: 'Salvataggio del contenuto…' });
    try {
      await ports.persistBody({
        identity: state.identity,
        body: state.body,
        contentRequestId: state.contentRequestId,
      });
      state = { ...state, bodyPersisted: true };
      checkpoint();
    } catch (cause) {
      failures.push({
        stage: 'persist_body',
        slotIndex: null,
        code: errorCode(cause),
        stopWorkflow: false,
        retryable: true,
        terminal: false,
        cause,
      });
      return { ok: false, state, failures };
    }
  }

  if (!state.plan) {
    callbacks.onProgress?.({ phase: 'planning_images', message: 'Preparazione delle immagini…' });
    try {
      const plan = await ports.authorizeVisualPlan({
        ...state.identity,
        requestId: state.planRequestId,
        quantity: { mode: 'auto', ceiling: 3 },
        replacementAssetId: null,
        ...state.visualContext,
      });
      if (plan.requestId === state.contentRequestId) {
        throw new Error('complete_lesson_content_plan_id_collision');
      }
      // Il client visuale puo recuperare un piano gia attivo con la sua
      // identita autorevole: da qui in poi si usa sempre quella restituita.
      state = { ...state, planRequestId: plan.requestId, plan };
      checkpoint();
    } catch (cause) {
      const classification = classifyCompleteLessonError(cause);
      failures.push({
        stage: 'authorize_plan',
        slotIndex: null,
        ...classification,
        cause,
      });
      return { ok: false, state, failures };
    }
  }

  const authorizedPlan = state.plan;
  if (!authorizedPlan) throw new Error('complete_lesson_missing_visual_plan');
  let plan: MultiVisualPlan = authorizedPlan;
  const imageSlots = plan.slots.filter((slot) => slot.decision === 'image');
  const total = imageSlots.length;

  for (let position = 0; position < imageSlots.length; position += 1) {
    const slotIndex = imageSlots[position]!.slotIndex;
    let slot = plan.slots.find((candidate) => candidate.slotIndex === slotIndex);
    if (!slot || slot.promotedAssetId || slot.state === 'abandoned') continue;
    if (!canGenerateOrPromote(slot)) {
      failures.push({
        stage: slot.staged ? 'promote_slot' : 'generate_slot',
        slotIndex,
        code: slot.lastError,
        stopWorkflow: false,
        retryable: false,
        terminal: false,
        cause: new Error(slot.lastError ?? 'visual_slot_not_generatable'),
      });
      continue;
    }

    if (!slot.staged) {
      callbacks.onProgress?.({
        phase: 'generating_image',
        current: position + 1,
        total,
        message: `Generazione immagine ${position + 1}/${total}…`,
      });
      try {
        plan = await ports.generateVisualSlot({
          ...state.identity,
          requestId: plan.requestId,
          slotIndex,
        });
        state = { ...state, plan };
        checkpoint();
        slot = plan.slots.find((candidate) => candidate.slotIndex === slotIndex);
      } catch (cause) {
        const classification = classifyCompleteLessonError(cause);
        failures.push({
          stage: 'generate_slot',
          slotIndex,
          ...classification,
          cause,
        });
        if (classification.stopWorkflow) break;
        continue;
      }
    }

    if (slot?.promotedAssetId) continue;
    if (!slot?.staged) {
      failures.push({
        stage: 'generate_slot',
        slotIndex,
        code: slot?.lastError ?? 'visual_slot_not_ready',
        stopWorkflow: false,
        retryable:
          slot?.lastError !== 'uncertain_outcome' && slot?.lastError !== 'staging_conflict',
        terminal: false,
        cause: new Error(slot?.lastError ?? 'visual_slot_not_ready'),
      });
      continue;
    }
    let promotionRequestId = state.promotionRequestIds[String(slotIndex)];
    if (!promotionRequestId) {
      const used = new Set([
        state.contentRequestId,
        state.planRequestId,
        ...Object.values(state.promotionRequestIds),
      ]);
      promotionRequestId = distinctId(createId, used);
      state = {
        ...state,
        promotionRequestIds: {
          ...state.promotionRequestIds,
          [String(slotIndex)]: promotionRequestId,
        },
      };
      // Prima della chiamata: essenziale per un retry dopo risposta persa.
      checkpoint();
    }
    callbacks.onProgress?.({
      phase: 'promoting_image',
      current: position + 1,
      total,
      message: `Applicazione immagine ${position + 1}/${total}…`,
    });
    try {
      plan = await ports.promoteVisualSlot({
        ...state.identity,
        requestId: plan.requestId,
        slotIndex,
        promotionRequestId,
        mode: { mode: 'add' },
      });
      state = { ...state, plan };
      checkpoint();
      const promotedSlot = plan.slots.find((candidate) => candidate.slotIndex === slotIndex);
      if (!promotedSlot?.promotedAssetId) {
        failures.push({
          stage: 'promote_slot',
          slotIndex,
          code: 'visual_slot_not_promoted',
          stopWorkflow: false,
          retryable: true,
          terminal: false,
          cause: new Error('visual_slot_not_promoted'),
        });
      }
    } catch (cause) {
      const classification = classifyCompleteLessonError(cause);
      failures.push({
        stage: 'promote_slot',
        slotIndex,
        ...classification,
        cause,
      });
      if (classification.stopWorkflow) break;
    }
  }

  const applied = plan.slots.filter((slot) => Boolean(slot.promotedAssetId)).length;
  if (failures.length > 0) {
    callbacks.onProgress?.({
      phase: 'partial_failure',
      applied,
      total,
      message: 'Lezione salvata; alcune immagini non sono state applicate.',
    });
    return { ok: false, state, failures };
  }

  state = { ...state, completed: true };
  checkpoint();
  callbacks.onProgress?.({
    phase: 'completed',
    applied,
    total,
    message:
      total === 0
        ? 'Contenuto generato; nessuna immagine necessaria.'
        : 'Lezione completa generata.',
  });
  return { ok: true, state, failures: [] };
}
