import { createHash } from 'node:crypto';
import {
  AiGatewayError,
  authorizeOwnerCall,
  validateAiCorrectionRequest,
  type AiCorrectionRequest,
  type AiGatewayErrorCode,
} from './aiCorrectionGatewayCore.js';
import {
  runPreview,
  runExecution,
  type EngineReadPorts,
  type RunDeps,
  type AiCorrectionPreviewResponse,
  type AiCorrectionRunResponse,
} from './aiCorrectionEngine.js';
import type { AiRuntimeConfig } from './aiCorrectionRuntimeConfig.js';
import {
  availableMicroUsd,
  availableDailyMicroUsd,
  dayKeyFromMs,
  type BudgetLedgerState,
} from './aiCorrectionBudget.js';
import { OPENAI_GRADING_CONTRACT_VERSION } from './openAiGrader.js';

export const MAX_PLAN_SUBMISSIONS = 350;
export const PLAN_LIFETIME_MS = 24 * 60 * 60 * 1000;
type PlanSettings = Pick<
  AiCorrectionRequest,
  'modelProfile' | 'gradingMode' | 'teacherGuidance' | 'advancedReview'
>;
export function planHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
export interface CorrectionPlanGroup {
  request: AiCorrectionRequest;
  sourceHash: string;
  maximumCostMicroUsd: number;
  tokensEstimated: number;
  state: 'pending' | 'running' | 'completed' | 'blocked';
  errorCode?: AiGatewayErrorCode;
  result?: AiCorrectionRunResponse;
}
export interface CorrectionPlan {
  version: 1;
  ownerUid: string;
  planId: string;
  verificationId: string;
  expiresAtMs: number;
  configHash: string;
  selectionHash: string;
  preview: AiCorrectionPreviewResponse;
  groups: CorrectionPlanGroup[];
  consented: boolean;
  settings: PlanSettings;
  budget?: {
    reason: 'daily_budget_exceeded' | 'budget_exceeded';
    availableMicroUsd: number;
    compatibleSubmissionIds: string[];
  };
}
export interface PlanView {
  planId: string;
  verificationId: string;
  expiresAtMs: number;
  preview: AiCorrectionPreviewResponse;
  consented: boolean;
  settings: PlanSettings;
  budget?: CorrectionPlan['budget'];
  groups: {
    requestId: string;
    submissionIds: string[];
    maximumCostMicroUsd: number;
    state: CorrectionPlanGroup['state'];
    errorCode?: AiGatewayErrorCode;
    result?: AiCorrectionRunResponse;
  }[];
}
export function planView(plan: CorrectionPlan): PlanView {
  return {
    planId: plan.planId,
    verificationId: plan.verificationId,
    expiresAtMs: plan.expiresAtMs,
    preview: plan.preview,
    settings: plan.settings,
    consented: plan.consented,
    ...(plan.budget ? { budget: plan.budget } : {}),
    groups: plan.groups.map((g) => ({
      requestId: g.request.requestId,
      submissionIds: g.request.submissionIds,
      maximumCostMicroUsd: g.maximumCostMicroUsd,
      state: g.state,
      ...(g.errorCode ? { errorCode: g.errorCode } : {}),
      ...(g.result ? { result: g.result } : {}),
    })),
  };
}
export interface PlanPorts {
  save: (plan: CorrectionPlan) => Promise<CorrectionPlan>;
  load: (
    ownerUid: string,
    verificationId: string,
    planId?: string,
  ) => Promise<CorrectionPlan | null>;
  update: (
    planId: string,
    mutate: (plan: CorrectionPlan) => CorrectionPlan,
  ) => Promise<CorrectionPlan>;
  ledger: (config: AiRuntimeConfig, nowMs: number) => Promise<BudgetLedgerState>;
  terminalResult: (request: AiCorrectionRequest) => Promise<AiCorrectionRunResponse | null>;
}
export interface PlanDeps extends RunDeps {
  plans: PlanPorts;
}

/** Shared settings and ordinal outcomes avoid repeating guidance, verification
 * IDs and submission IDs in every child/result of a durable checkpoint. */
type StoredPlan = Omit<CorrectionPlan, 'groups'> & {
  storageVersion: 1;
  groups: (Omit<CorrectionPlanGroup, 'request' | 'result'> & {
    request: Pick<AiCorrectionRequest, 'requestId' | 'submissionIds'>;
    result?: Omit<AiCorrectionRunResponse, 'requestId' | 'verificationId' | 'results'> & {
      results: (Omit<AiCorrectionRunResponse['results'][number], 'submissionId'> & {
        ordinal: number;
      })[];
    };
  })[];
};
function omitKeys<T, K extends keyof T>(value: T, keys: readonly K[]): Omit<T, K> {
  const result = { ...value };
  for (const key of keys) delete result[key];
  return result;
}
export function encodeCorrectionPlan(plan: CorrectionPlan): StoredPlan {
  return {
    ...plan,
    storageVersion: 1,
    groups: plan.groups.map((group) => {
      const { result, request, ...rest } = group;
      const encoded: StoredPlan['groups'][number] = {
        ...rest,
        request: { requestId: request.requestId, submissionIds: request.submissionIds },
      };
      if (result) {
        const metadata = omitKeys(result, ['requestId', 'verificationId', 'results']);
        encoded.result = {
          ...metadata,
          results: result.results.map(({ submissionId, ...outcome }) => {
            const ordinal = request.submissionIds.indexOf(submissionId);
            if (ordinal < 0)
              throw new AiGatewayError('invalid_input', 'Esito non appartenente al piano.');
            return { ...outcome, ordinal };
          }),
        };
      }
      return encoded;
    }),
  };
}
export function decodeCorrectionPlan(stored: StoredPlan | CorrectionPlan): CorrectionPlan {
  // Read the expanded v1 checkpoint written before the compact codec, preserving
  // original child IDs and invocation fences. Future writes use the codec.
  if (!('storageVersion' in stored)) {
    if (
      stored.version !== 1 ||
      !stored.settings ||
      !Array.isArray(stored.groups) ||
      stored.groups.some((g) => !g.request || !Array.isArray(g.request.submissionIds))
    )
      throw new AiGatewayError('invalid_input', 'Checkpoint del piano non riconosciuto.');
    return stored;
  }
  if (stored.storageVersion !== 1)
    throw new AiGatewayError('invalid_input', 'Checkpoint del piano non riconosciuto.');
  const plan = omitKeys(stored, ['storageVersion']);
  return {
    ...plan,
    groups: stored.groups.map((group) => {
      const { request, result, ...rest } = group;
      const decoded: CorrectionPlanGroup = {
        ...rest,
        request: { ...request, ...stored.settings, verificationId: stored.verificationId },
      };
      if (result)
        decoded.result = {
          ...result,
          requestId: request.requestId,
          verificationId: stored.verificationId,
          results: result.results.map(({ ordinal, ...outcome }) => {
            const submissionId = request.submissionIds[ordinal];
            if (!submissionId)
              throw new AiGatewayError('invalid_input', 'Esito ordinale del piano non valido.');
            return { ...outcome, submissionId };
          }),
        };
      return decoded;
    }),
  };
}

/** Firestore field/value sizes plus deliberately generous map/array overhead;
 * also consider JSON escaping, then retain >140KB below the 1MiB document cap. */
export const MAX_PLAN_DOCUMENT_BYTES = 900_000;
export function planStorageUpperBound(plan: CorrectionPlan): number {
  const encoded = encodeCorrectionPlan(plan);
  function size(value: unknown): number {
    if (value === null || typeof value === 'boolean') return 1;
    if (typeof value === 'number') return 8;
    if (typeof value === 'string') return Buffer.byteLength(value, 'utf8') + 1;
    if (Array.isArray(value)) return 32 + value.reduce((sum, item) => sum + size(item), 0);
    if (value && typeof value === 'object')
      return (
        32 +
        Object.entries(value).reduce(
          (sum, [key, item]) => sum + Buffer.byteLength(key, 'utf8') + 1 + size(item),
          0,
        )
      );
    throw new AiGatewayError('invalid_input', 'Checkpoint non serializzabile.');
  }
  return Math.max(size(encoded), Buffer.byteLength(JSON.stringify(encoded), 'utf8')) + 4096;
}
export function terminalPlanSizeForecast(plan: CorrectionPlan): CorrectionPlan {
  const maximum = Number.MAX_SAFE_INTEGER;
  return {
    ...plan,
    consented: true,
    groups: plan.groups.map((group) => {
      const counts: AiCorrectionRunResponse['counts'] = {
        selected: maximum,
        eligible: maximum,
        excluded: maximum,
        closedToGrade: maximum,
        openToGrade: maximum,
        closedOnlySubmissions: maximum,
        alreadyGradedIgnored: maximum,
        succeeded: maximum,
        partial: maximum,
        failed: maximum,
      };
      const result: AiCorrectionRunResponse = {
        mode: 'openai',
        phase: 'run',
        requestId: group.request.requestId,
        verificationId: plan.verificationId,
        status: 'completed',
        idempotentReplay: true,
        counts,
        inputTokensEstimated: maximum,
        outputTokensEstimated: maximum,
        totalTokensEstimated: maximum,
        costEstimatedMicroUsd: maximum,
        costEstimated: maximum,
        tokensEstimated: maximum,
        inputTokensActual: maximum,
        outputTokensActual: maximum,
        totalTokensActual: maximum,
        costActualMicroUsd: maximum,
        costActual: maximum,
        tokensActual: maximum,
        costReservationMicroUsd: maximum,
        costSettledMicroUsd: maximum,
        retry: {
          attemptsTotal: maximum,
          retriesTotal: maximum,
          retryReasonCodes: Array.from({ length: 16 }, () => 'provider_unavailable'),
          retryDelayTotalMs: maximum,
          unknownBillingAttempts: maximum,
        },
        results: group.request.submissionIds.map((submissionId) => ({
          submissionId,
          outcome: 'succeeded',
          closedGraded: maximum,
          openGraded: maximum,
          openSkipped: maximum,
          closedSkipped: maximum,
          alreadyIgnored: maximum,
          reason: 'correction_not_in_progress',
        })),
      };
      return { ...group, state: 'completed', result };
    }),
  };
}
export function assertPlanStorageCapacity(plan: CorrectionPlan): void {
  if (planStorageUpperBound(terminalPlanSizeForecast(plan)) > MAX_PLAN_DOCUMENT_BYTES)
    throw new AiGatewayError(
      'plan_size_exceeded',
      'La selezione richiede un checkpoint troppo grande per essere ripreso in sicurezza. Riduci la selezione prima di confermare.',
    );
}
function configHash(config: AiRuntimeConfig | null, mode: string) {
  return planHash({ config, mode, contract: OPENAI_GRADING_CONTRACT_VERSION });
}
async function configFor(deps: PlanDeps) {
  const config = deps.featureMode === 'openai' ? await deps.loadRuntimeConfig?.() : null;
  if (deps.featureMode === 'disabled' || (deps.featureMode === 'openai' && !config?.enabled))
    throw new AiGatewayError('feature_disabled', 'Correzione IA disattivata.');
  return config ?? null;
}
/** Snapshot is ephemeral: only its hash is persisted. Engine uses the same reads
 * after consent validation, while its commit still checks current corrections. */
async function sourceSnapshot(request: AiCorrectionRequest, ports: EngineReadPorts) {
  const verification = await ports.loadVerification(request.verificationId);
  const rows = [];
  for (const id of request.submissionIds)
    rows.push({
      id,
      submission: await ports.loadSubmission(id),
      correction: await ports.loadCorrection(id),
    });
  const byId = new Map(rows.map((r) => [r.id, r]));
  return {
    hash: planHash({ verification, rows }),
    ports: {
      loadVerification: async () => verification,
      loadSubmission: async (id: string) => byId.get(id)?.submission ?? null,
      loadCorrection: async (id: string) => byId.get(id)?.correction ?? null,
    },
  };
}
function memoizedReads(ports: EngineReadPorts): EngineReadPorts {
  function memo<T>(read: (id: string) => Promise<T>) {
    const values = new Map<string, Promise<T>>();
    return (id: string) => {
      let value = values.get(id);
      if (!value) {
        value = read(id);
        values.set(id, value);
      }
      return value;
    };
  }
  return {
    loadVerification: memo(ports.loadVerification),
    loadSubmission: memo(ports.loadSubmission),
    loadCorrection: memo(ports.loadCorrection),
  };
}
const perItemErrors = new Set([
  'submission_questions_exceeded',
  'submission_tokens_exceeded',
  'operation_tokens_exceeded',
  'operation_budget_exceeded',
]);
export async function previewCorrectionPlan(raw: unknown, deps: PlanDeps): Promise<PlanView> {
  const ownerUid = await authorizeOwnerCall(deps);
  const config = await configFor(deps);
  const validated = validateAiCorrectionRequest(raw, MAX_PLAN_SUBMISSIONS);
  const request = { ...validated, submissionIds: [...validated.submissionIds].sort() };
  const selectionHash = planHash(request);
  const existing = await deps.plans.load(ownerUid, request.verificationId, request.requestId);
  if (existing) {
    if (existing.selectionHash !== selectionHash)
      throw new AiGatewayError('invalid_input', 'Identificatore del piano già usato.');
    return planView(existing);
  }
  const previous = await deps.plans.load(ownerUid, request.verificationId);
  if (
    previous?.groups.some(
      (g) => g.state === 'running' || (g.result?.retry.unknownBillingAttempts ?? 0) > 0,
    )
  ) {
    throw new AiGatewayError(
      'plan_ambiguous',
      'Il piano precedente contiene consegne con esito o costo incerto: recuperare il risultato prima di creare un nuovo piano.',
    );
  }
  const reads = memoizedReads(deps.ports);
  const candidates: (
    | { id: string; preview: AiCorrectionPreviewResponse }
    | { excluded: AiCorrectionPreviewResponse['excluded'][number] }
  )[] = new Array(request.submissionIds.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(6, request.submissionIds.length) }, async () => {
      for (;;) {
        const position = next++;
        const id = request.submissionIds[position];
        if (!id) return;
        try {
          const item = await runPreview(
            {
              ...request,
              requestId: planHash([request.requestId, 'estimate']).slice(0, 32),
              submissionIds: [id],
            },
            { ...deps, ports: reads, loadRuntimeConfig: async () => config },
          );
          candidates[position] = item.counts.eligible
            ? { id, preview: item }
            : { excluded: item.excluded[0]! };
        } catch (error) {
          if (!(error instanceof AiGatewayError) || !perItemErrors.has(error.code)) throw error;
          // Technical reason is exposed separately from ordinary eligibility.
          candidates[position] = {
            excluded: {
              submissionId: id,
              reason: error.code as
                | 'submission_questions_exceeded'
                | 'submission_tokens_exceeded'
                | 'operation_tokens_exceeded'
                | 'operation_budget_exceeded',
            },
          };
        }
      }
    }),
  );
  const items = candidates.filter(
    (c): c is { id: string; preview: AiCorrectionPreviewResponse } => 'id' in c,
  );
  const excluded = candidates.flatMap((c) => ('excluded' in c ? [c.excluded] : []));
  const groups: CorrectionPlanGroup[] = [];
  const countCap = config
    ? Math.min(config.limits.maxSubmissionsPerOperation, config.limits.maxProviderConcurrency)
    : 3;
  const tokenCap = config?.limits.maxEstimatedTokensPerOperation ?? Number.MAX_SAFE_INTEGER;
  const costCap = config?.maxOperationCostMicroUsd ?? Number.MAX_SAFE_INTEGER;
  for (const item of items) {
    let last = groups.at(-1);
    if (
      !last ||
      last.request.submissionIds.length >= countCap ||
      last.tokensEstimated + item.preview.tokensEstimated > tokenCap ||
      last.maximumCostMicroUsd + item.preview.maximumCostMicroUsd > costCap
    ) {
      last = {
        request: {
          ...request,
          requestId: planHash([request.requestId, groups.length]).slice(0, 32),
          submissionIds: [],
        },
        sourceHash: '',
        maximumCostMicroUsd: 0,
        tokensEstimated: 0,
        state: 'pending',
      };
      groups.push(last);
    }
    last.request.submissionIds.push(item.id);
    last.maximumCostMicroUsd += item.preview.maximumCostMicroUsd;
    last.tokensEstimated += item.preview.tokensEstimated;
  }
  for (const group of groups) {
    // Authoritative group preflight catches any combined boundary; the sum of
    // item ceilings is conservative with respect to aggregate rounding.
    await runPreview(group.request, {
      ...deps,
      ports: reads,
      loadRuntimeConfig: async () => config,
    });
    group.sourceHash = (await sourceSnapshot(group.request, reads)).hash;
  }
  const nowMs = (deps.now ?? Date.now)();
  const maximumCostMicroUsd = groups.reduce((sum, g) => sum + g.maximumCostMicroUsd, 0);
  let budget: CorrectionPlan['budget'];
  if (config) {
    const ledger = await deps.plans.ledger(config, nowMs);
    const daily = availableDailyMicroUsd(ledger, dayKeyFromMs(nowMs), nowMs);
    const monthly = availableMicroUsd(ledger, nowMs);
    const available = Math.min(daily, monthly);
    if (maximumCostMicroUsd > available) {
      let used = 0;
      const compatibleSubmissionIds: string[] = [];
      for (const item of items)
        if (used + item.preview.maximumCostMicroUsd <= available) {
          compatibleSubmissionIds.push(item.id);
          used += item.preview.maximumCostMicroUsd;
        }
      budget = {
        reason: maximumCostMicroUsd > daily ? 'daily_budget_exceeded' : 'budget_exceeded',
        availableMicroUsd: available,
        compatibleSubmissionIds,
      };
    }
  }
  const counts = {
    selected: request.submissionIds.length,
    eligible: items.length,
    excluded: excluded.length,
    closedToGrade: 0,
    openToGrade: 0,
    closedOnlySubmissions: 0,
    alreadyGradedIgnored: 0,
  };
  for (const item of items)
    for (const key of [
      'closedToGrade',
      'openToGrade',
      'closedOnlySubmissions',
      'alreadyGradedIgnored',
    ] as const)
      counts[key] += item.preview.counts[key];
  const preview: AiCorrectionPreviewResponse = {
    mode: deps.featureMode === 'openai' ? 'openai' : 'mock',
    phase: 'preview',
    requestId: request.requestId,
    verificationId: request.verificationId,
    counts,
    excluded,
    maximumCostMicroUsd,
    advancedReview: request.advancedReview !== false,
    tokensEstimated: items.reduce((sum, i) => sum + i.preview.tokensEstimated, 0),
    costEstimated: items.reduce((sum, i) => sum + i.preview.costEstimated, 0),
    inputTokensEstimated: items.reduce((sum, i) => sum + i.preview.inputTokensEstimated, 0),
    outputTokensEstimated: items.reduce((sum, i) => sum + i.preview.outputTokensEstimated, 0),
    totalTokensEstimated: items.reduce((sum, i) => sum + i.preview.totalTokensEstimated, 0),
    costEstimatedMicroUsd: items.reduce((sum, i) => sum + i.preview.costEstimatedMicroUsd, 0),
  };
  const settings: PlanSettings = {
    modelProfile: request.modelProfile ?? 'economy',
    gradingMode: request.gradingMode,
    advancedReview: request.advancedReview !== false,
    ...(request.teacherGuidance ? { teacherGuidance: request.teacherGuidance } : {}),
  };
  const plan: CorrectionPlan = {
    version: 1,
    ownerUid,
    planId: request.requestId,
    verificationId: request.verificationId,
    expiresAtMs: nowMs + PLAN_LIFETIME_MS,
    configHash: configHash(config, deps.featureMode),
    selectionHash,
    preview,
    groups,
    settings,
    consented: false,
    ...(budget ? { budget } : {}),
  };
  assertPlanStorageCapacity(plan);
  return planView(await deps.plans.save(plan));
}
export async function loadCorrectionPlan(raw: unknown, deps: PlanDeps): Promise<PlanView | null> {
  const ownerUid = await authorizeOwnerCall(deps);
  const request = parsePlanAction(raw);
  const plan = await deps.plans.load(ownerUid, request.verificationId, request.planId);
  if (!plan || plan.ownerUid !== ownerUid || plan.verificationId !== request.verificationId)
    return null;
  return planView(plan);
}
export function parsePlanAction(raw: unknown): {
  verificationId: string;
  planId?: string;
  groupIndex?: number;
  maximumCostMicroUsd?: number;
  groupMaximumCostMicroUsd?: number;
} {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new AiGatewayError('invalid_input', 'Piano non valido.');
  const data = raw as Record<string, unknown>;
  if (
    Object.keys(data).some(
      (k) =>
        ![
          'verificationId',
          'planId',
          'groupIndex',
          'maximumCostMicroUsd',
          'groupMaximumCostMicroUsd',
        ].includes(k),
    )
  )
    throw new AiGatewayError('invalid_input', 'Piano non valido.');
  if (
    typeof data.verificationId !== 'string' ||
    !/^[A-Za-z0-9_-]{1,200}$/.test(data.verificationId) ||
    (data.planId !== undefined &&
      (typeof data.planId !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(data.planId)))
  )
    throw new AiGatewayError('invalid_input', 'Piano non valido.');
  return data as ReturnType<typeof parsePlanAction>;
}
export async function executeCorrectionPlanGroup(raw: unknown, deps: PlanDeps): Promise<PlanView> {
  const ownerUid = await authorizeOwnerCall(deps);
  const action = parsePlanAction(raw);
  const plan = await deps.plans.load(ownerUid, action.verificationId, action.planId);
  if (!plan || plan.ownerUid !== ownerUid || plan.verificationId !== action.verificationId)
    throw new AiGatewayError('not_owner', 'Piano non disponibile.');
  const index = action.groupIndex;
  if (!Number.isInteger(index) || index! < 0 || !plan.groups[index!])
    throw new AiGatewayError('invalid_input', 'Gruppo non valido.');
  const group = plan.groups[index!]!;
  if (
    action.maximumCostMicroUsd !== plan.preview.maximumCostMicroUsd ||
    action.groupMaximumCostMicroUsd !== group.maximumCostMicroUsd
  )
    throw new AiGatewayError('invalid_input', 'Conferma del costo non valida.');
  if (group.state === 'completed') return planView(plan);
  if (group.state === 'blocked')
    throw new AiGatewayError(
      group.errorCode ?? 'plan_changed',
      'Gruppo non avviato: preparare una nuova anteprima delle consegne rimanenti.',
    );
  if (group.state === 'running') {
    const terminal = await deps.plans.terminalResult(group.request);
    if (!terminal)
      throw new AiGatewayError(
        'plan_ambiguous',
        'Il gruppo avviato non ha ancora un esito verificabile.',
      );
    return planView(
      await deps.plans.update(plan.planId, (current) => {
        current.groups[index!] = {
          ...current.groups[index!]!,
          state: 'completed',
          result: terminal,
        };
        return current;
      }),
    );
  }
  if (plan.budget)
    throw new AiGatewayError(
      plan.budget.reason,
      'Preparare un piano compatibile con il budget disponibile.',
    );
  const config = await configFor(deps);
  assertPlanStorageCapacity(plan);
  if (
    plan.expiresAtMs <= (deps.now ?? Date.now)() ||
    plan.configHash !== configHash(config, deps.featureMode)
  )
    throw new AiGatewayError('plan_changed', 'Configurazione cambiata o conferma scaduta.');
  const snapshot = await sourceSnapshot(group.request, deps.ports);
  if (snapshot.hash !== group.sourceHash)
    throw new AiGatewayError('plan_changed', 'Consegne cambiate dopo la stima.');
  const fresh = await runPreview(group.request, {
    ...deps,
    ports: snapshot.ports,
    loadRuntimeConfig: async () => config,
  });
  if (fresh.maximumCostMicroUsd > group.maximumCostMicroUsd)
    throw new AiGatewayError('plan_changed', 'Costo cambiato dopo la stima.');
  await deps.plans.update(plan.planId, (current) => {
    if (current.groups[index!]!.state !== 'pending')
      throw new AiGatewayError('plan_ambiguous', 'Gruppo già avviato.');
    if (current.groups.slice(0, index).some((g) => g.state !== 'completed'))
      throw new AiGatewayError('invalid_input', 'Completare il gruppo precedente.');
    if (
      current.groups.reduce((sum, g) => sum + g.maximumCostMicroUsd, 0) >
      current.preview.maximumCostMicroUsd
    )
      throw new AiGatewayError('invalid_input', 'Tetto complessivo non valido.');
    current.consented = true;
    current.groups[index!]!.state = 'running';
    return current;
  });
  let providerMayHaveStarted = false;
  let result: AiCorrectionRunResponse;
  try {
    result = await runExecution(group.request, {
      ...deps,
      loadRuntimeConfig: async () => config,
      ports: {
        ...deps.ports,
        ...snapshot.ports,
        markBudgetInvoked: async (input) => {
          // Set before awaiting: a lost response to this fence is ambiguous.
          providerMayHaveStarted = true;
          if (!deps.ports.markBudgetInvoked)
            throw new AiGatewayError('budget_unavailable', 'Budget non disponibile.');
          return deps.ports.markBudgetInvoked(input);
        },
        reserveBudget: async (input) => {
          if (input.amountMicroUsd > group.maximumCostMicroUsd)
            throw new AiGatewayError('plan_changed', 'Prenotazione superiore alla conferma.');
          if (!deps.ports.reserveBudget)
            throw new AiGatewayError('budget_unavailable', 'Budget non disponibile.');
          const reservation = await deps.ports.reserveBudget(input);
          return reservation;
        },
      },
    });
  } catch (error) {
    // A proven reservation rejection happened before markInvoked/provider. The
    // child run lease may remain, so replan with fresh consent rather than retry
    // that lease. Every unknown failure remains fenced as running.
    if (!providerMayHaveStarted && deps.featureMode === 'openai')
      await deps.plans.update(plan.planId, (current) => {
        current.groups[index!]!.state = 'blocked';
        current.groups[index!]!.errorCode =
          error instanceof AiGatewayError ? error.code : 'plan_changed';
        return current;
      });
    throw error;
  }
  if (result.status === 'running')
    throw new AiGatewayError('plan_ambiguous', 'Gruppo già in corso.');
  return planView(
    await deps.plans.update(plan.planId, (current) => {
      current.groups[index!] = { ...current.groups[index!]!, state: 'completed', result };
      return current;
    }),
  );
}
