import { describe, expect, it, vi } from 'vitest';
import type { MultiVisualPlan, MultiVisualSlot } from '../multiVisualClient.js';
import {
  classifyCompleteLessonError,
  createCompleteLessonGenerationState,
  runCompleteLessonGeneration,
  summarizeCompleteLessonGeneration,
  type CompleteLessonGenerationPorts,
  type CompleteLessonGenerationState,
  type CompleteLessonProgress,
} from '../completeLessonGeneration.js';

const identity = { programId: 'program-1', importId: 'import-1', lessonId: 'lesson-1' };
const visualContext = {
  titolo: 'Le reti',
  sottotitolo: null,
  difficolta: 'base',
  concettiChiave: ['TCP'],
  obiettivi: ['Comprendere le reti'],
  udaTitle: 'UDA reti',
  udaContext: null,
};

function slot(index: number, over: Partial<MultiVisualSlot> = {}): MultiVisualSlot {
  return {
    slotIndex: index,
    state: 'pending',
    decision: 'image',
    subject: `Soggetto ${index}`,
    rationale: 'Utile',
    anchor: { headingIndex: index, headingText: `Titolo ${index}`, headingSlug: `titolo-${index}` },
    caption: `Didascalia ${index}`,
    altText: `Alt ${index}`,
    attempts: 0,
    lastError: null,
    staged: null,
    promotedAssetId: null,
    ...over,
  };
}

function plan(slots: MultiVisualSlot[], over: Partial<MultiVisualPlan> = {}): MultiVisualPlan {
  return {
    planHash: 'a'.repeat(64),
    requestId: 'plan-id',
    status: 'proposed',
    slots,
    budgetCeiling: {
      reservationKey: 'b'.repeat(64),
      proposalCap: 10,
      generationCap: 20,
      maxAttemptsPerSlot: 2,
      totalReserved: 130,
    },
    settlement: { proposalActualCost: 5, slots: [] },
    ...over,
  };
}

function ready(value: MultiVisualPlan, slotIndex: number): MultiVisualPlan {
  return plan(
    value.slots.map((item) =>
      item.slotIndex === slotIndex
        ? {
            ...item,
            state: 'ready',
            attempts: item.attempts + 1,
            staged: {
              storageRef: `staging/${slotIndex}.webp`,
              width: 800,
              height: 600,
              byteLength: 100,
              sha256: 'c'.repeat(64),
            },
          }
        : item,
    ),
  );
}

function promoted(value: MultiVisualPlan, slotIndex: number): MultiVisualPlan {
  return plan(
    value.slots.map((item) =>
      item.slotIndex === slotIndex
        ? {
            ...item,
            state: 'promoted',
            staged: null,
            promotedAssetId: `asset-${slotIndex}`,
          }
        : item,
    ),
    { status: 'completed' },
  );
}

function state(ids: string[] = ['plan-id']): CompleteLessonGenerationState {
  return createCompleteLessonGenerationState({
    identity,
    body: '## Le reti\n\nContenuto generato.',
    visualContext,
    contentRequestId: 'content-id',
    createId: () => ids.shift() ?? 'fallback-id',
  });
}

function ports(initialPlan: MultiVisualPlan): CompleteLessonGenerationPorts & {
  persistBody: ReturnType<typeof vi.fn>;
  authorizeVisualPlan: ReturnType<typeof vi.fn>;
  generateVisualSlot: ReturnType<typeof vi.fn>;
  promoteVisualSlot: ReturnType<typeof vi.fn>;
} {
  let live = initialPlan;
  return {
    persistBody: vi.fn().mockResolvedValue(undefined),
    authorizeVisualPlan: vi.fn().mockImplementation(async () => live),
    generateVisualSlot: vi.fn().mockImplementation(async ({ slotIndex }) => {
      live = ready(live, slotIndex);
      return live;
    }),
    promoteVisualSlot: vi.fn().mockImplementation(async ({ slotIndex }) => {
      live = promoted(live, slotIndex);
      return live;
    }),
  };
}

describe('completeLessonGeneration', () => {
  it('crea ID distinti per contenuto e piano anche in presenza di una collisione', () => {
    const created = state(['content-id', 'plan-id']);
    expect(created.contentRequestId).toBe('content-id');
    expect(created.planRequestId).toBe('plan-id');
  });

  it('salva il body canonico prima di autorizzare auto/3 e genera/promuove in sequenza', async () => {
    const calls: string[] = [];
    const p = ports(plan([slot(0), slot(1), slot(2)]));
    p.persistBody.mockImplementation(async () => void calls.push('persist'));
    p.authorizeVisualPlan.mockImplementation(async (input) => {
      calls.push('authorize');
      expect(input.quantity).toEqual({ mode: 'auto', ceiling: 3 });
      expect(input.requestId).toBe('plan-id');
      return plan([slot(0), slot(1), slot(2)]);
    });
    p.generateVisualSlot.mockImplementation(async ({ slotIndex }) => {
      calls.push(`generate-${slotIndex}`);
      return ready(plan([slot(0), slot(1), slot(2)]), slotIndex);
    });
    let live = plan([slot(0), slot(1), slot(2)]);
    p.generateVisualSlot.mockImplementation(async ({ slotIndex }) => {
      calls.push(`generate-${slotIndex}`);
      live = ready(live, slotIndex);
      return live;
    });
    p.promoteVisualSlot.mockImplementation(async ({ slotIndex }) => {
      calls.push(`promote-${slotIndex}`);
      live = promoted(live, slotIndex);
      return live;
    });

    const progress: CompleteLessonProgress[] = [];
    const result = await runCompleteLessonGeneration(
      state(),
      p,
      { onProgress: (value) => progress.push(value) },
      (() => {
        let n = 0;
        return () => `promotion-${n++}`;
      })(),
    );

    expect(result.ok).toBe(true);
    expect(calls).toEqual([
      'persist',
      'authorize',
      'generate-0',
      'promote-0',
      'generate-1',
      'promote-1',
      'generate-2',
      'promote-2',
    ]);
    expect(new Set(Object.values(result.state.promotionRequestIds)).size).toBe(3);
    expect(Object.values(result.state.promotionRequestIds)).not.toContain('content-id');
    expect(Object.values(result.state.promotionRequestIds)).not.toContain('plan-id');
    expect(progress.map((item) => item.phase)).toEqual([
      'saving_body',
      'planning_images',
      'generating_image',
      'promoting_image',
      'generating_image',
      'promoting_image',
      'generating_image',
      'promoting_image',
      'completed',
    ]);
  });

  it('con zero immagini termina dopo la proposta senza chiamare generate/promote', async () => {
    const p = ports(plan([], { status: 'abandoned' }));
    const progress: CompleteLessonProgress[] = [];
    const result = await runCompleteLessonGeneration(state(), p, {
      onProgress: (value) => progress.push(value),
    });
    expect(result.ok).toBe(true);
    expect(p.generateVisualSlot).not.toHaveBeenCalled();
    expect(p.promoteVisualSlot).not.toHaveBeenCalled();
    expect(progress.at(-1)).toMatchObject({ phase: 'completed', applied: 0, total: 0 });
  });

  it('adotta il requestId autorevole di un piano attivo recuperato', async () => {
    let live = plan([slot(0)], { requestId: 'recovered-plan-id' });
    const p = ports(live);
    p.authorizeVisualPlan.mockResolvedValue(live);
    p.generateVisualSlot.mockImplementation(async (input) => {
      expect(input.requestId).toBe('recovered-plan-id');
      live = ready(live, input.slotIndex);
      return { ...live, requestId: 'recovered-plan-id' };
    });
    p.promoteVisualSlot.mockImplementation(async (input) => {
      expect(input.requestId).toBe('recovered-plan-id');
      live = promoted(live, input.slotIndex);
      return { ...live, requestId: 'recovered-plan-id' };
    });
    const result = await runCompleteLessonGeneration(state(), p, {}, () => 'promotion-id');
    expect(result.ok).toBe(true);
    expect(result.state.planRequestId).toBe('recovered-plan-id');
  });

  it('un errore di persistenza impedisce ogni chiamata visuale e il retry non ripete un body riuscito', async () => {
    const p = ports(plan([]));
    p.persistBody.mockRejectedValueOnce(new Error('storage down')).mockResolvedValueOnce(undefined);
    const first = await runCompleteLessonGeneration(state(), p);
    expect(first.ok).toBe(false);
    expect(p.authorizeVisualPlan).not.toHaveBeenCalled();

    const second = await runCompleteLessonGeneration(first.state, p);
    expect(second.ok).toBe(true);
    expect(p.persistBody).toHaveBeenCalledTimes(2);
    const third = await runCompleteLessonGeneration(second.state, p);
    expect(third.ok).toBe(true);
    expect(p.persistBody).toHaveBeenCalledTimes(2);
  });

  it('continua dopo un errore parziale e al retry salta body e slot gia promosso', async () => {
    let live = plan([slot(0), slot(1)]);
    const p = ports(live);
    p.generateVisualSlot.mockImplementation(async ({ slotIndex }) => {
      if (slotIndex === 0) throw { details: { code: 'provider_unavailable' } };
      live = ready(live, slotIndex);
      return live;
    });
    p.promoteVisualSlot.mockImplementation(async ({ slotIndex }) => {
      live = promoted(live, slotIndex);
      return live;
    });
    const first = await runCompleteLessonGeneration(state(), p, {}, () => 'promotion-1');
    expect(first.ok).toBe(false);
    expect(first.failures).toMatchObject([
      {
        stage: 'generate_slot',
        slotIndex: 0,
        code: 'provider_unavailable',
        stopWorkflow: false,
        retryable: true,
        terminal: false,
      },
    ]);
    expect(p.promoteVisualSlot).toHaveBeenCalledWith(expect.objectContaining({ slotIndex: 1 }));

    p.generateVisualSlot.mockImplementation(async ({ slotIndex }) => {
      live = ready(live, slotIndex);
      return live;
    });
    const second = await runCompleteLessonGeneration(first.state, p, {}, () => 'promotion-0');
    expect(second.ok).toBe(true);
    expect(p.persistBody).toHaveBeenCalledTimes(1);
    expect(p.authorizeVisualPlan).toHaveBeenCalledTimes(1);
    expect(p.promoteVisualSlot.mock.calls.filter(([input]) => input.slotIndex === 1)).toHaveLength(
      1,
    );
  });

  it('considera parziale uno slot che il server restituisce failed senza lanciare', async () => {
    const proposed = plan([slot(0)]);
    const p = ports(proposed);
    p.generateVisualSlot.mockResolvedValue(
      plan([
        slot(0, {
          state: 'failed',
          attempts: 1,
          lastError: 'transient_error',
        }),
      ]),
    );
    const result = await runCompleteLessonGeneration(state(), p);
    expect(result.ok).toBe(false);
    expect(result.failures).toMatchObject([
      {
        stage: 'generate_slot',
        slotIndex: 0,
        code: 'transient_error',
        terminal: false,
      },
    ]);
    expect(p.promoteVisualSlot).not.toHaveBeenCalled();
  });

  it('riusa il promotionRequestId dopo risposta persa e non rigenera uno slot staged', async () => {
    const staged = ready(plan([slot(0)]), 0);
    const p = ports(staged);
    p.promoteVisualSlot.mockRejectedValueOnce(new Error('response lost'));
    const checkpoints: CompleteLessonGenerationState[] = [];
    const first = await runCompleteLessonGeneration(
      { ...state(), bodyPersisted: true, plan: staged },
      p,
      { onStateChange: (value) => checkpoints.push(value) },
      () => 'promotion-stable',
    );
    expect(first.ok).toBe(false);
    expect(checkpoints.some((value) => value.promotionRequestIds['0'] === 'promotion-stable')).toBe(
      true,
    );
    p.promoteVisualSlot.mockImplementationOnce(async () => promoted(staged, 0));
    const second = await runCompleteLessonGeneration(first.state, p, {}, () => 'must-not-be-used');
    expect(second.ok).toBe(true);
    expect(p.generateVisualSlot).not.toHaveBeenCalled();
    expect(p.promoteVisualSlot.mock.calls[0]![0].promotionRequestId).toBe('promotion-stable');
    expect(p.promoteVisualSlot.mock.calls[1]![0].promotionRequestId).toBe('promotion-stable');
  });

  it.each([
    ['budget_unavailable', true],
    ['operation_budget_exceeded', true],
    ['feature_disabled', true],
    ['uncertain_state', false],
    ['visual_plan_external_mutation', false],
    ['visual_plan_proposal_body_changed', false],
    ['visual_plan_expired', false],
    ['corrupted_state', false],
  ] as const)('%s ferma subito gli slot successivi (retryable=%s)', async (code, retryable) => {
    const staged = plan([ready(plan([slot(0)]), 0).slots[0]!, ready(plan([slot(1)]), 1).slots[0]!]);
    const p = ports(staged);
    p.promoteVisualSlot.mockRejectedValue({
      details: { code },
    });
    const result = await runCompleteLessonGeneration(
      { ...state(), bodyPersisted: true, plan: staged },
      p,
      {},
      () => 'promotion-id',
    );
    expect(result.ok).toBe(false);
    expect(result.failures[0]).toMatchObject({
      code,
      stopWorkflow: true,
      retryable,
      terminal: !retryable,
      slotIndex: 0,
    });
    expect(p.promoteVisualSlot).toHaveBeenCalledTimes(1);
  });

  it('espone una classificazione retryable anche fuori dall’orchestratore', () => {
    expect(classifyCompleteLessonError({ details: { code: 'operation_budget_exceeded' } })).toEqual(
      {
        code: 'operation_budget_exceeded',
        stopWorkflow: true,
        retryable: true,
        terminal: false,
      },
    );
    expect(classifyCompleteLessonError({ details: { code: 'uncertain_state' } })).toEqual({
      code: 'uncertain_state',
      stopWorkflow: true,
      retryable: false,
      terminal: true,
    });
  });

  it('riassume slot e settlement senza trasformare costi ignoti in zero effettivo', () => {
    const visualPlan = plan(
      [
        slot(0, { state: 'promoted', promotedAssetId: 'asset-0' }),
        slot(1, { decision: 'none', state: 'abandoned' }),
        slot(2, { state: 'failed', attempts: 2, lastError: 'transient_error' }),
      ],
      {
        settlement: {
          proposalActualCost: 5,
          slots: [
            { slotIndex: 0, attempts: 1, actualCost: 7 },
            { slotIndex: 2, attempts: 2, actualCost: null },
          ],
        },
      },
    );
    expect(summarizeCompleteLessonGeneration({ plan: visualPlan })).toEqual({
      applied: 1,
      skipped: 1,
      failed: 1,
      actualKnownMicroUsd: 12,
      actualCostUnknown: true,
    });
  });
});
