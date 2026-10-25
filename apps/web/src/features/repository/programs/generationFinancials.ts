import { httpsCallable, type Functions } from 'firebase/functions';
import type { MultiVisualPlan } from './multiVisualClient.js';

type CostVersion = { executions: number; updatedAtMs: number; terminal: boolean };
export interface GenerationCostEntry {
  id: string;
  phase: string;
  knownActualMicroUsd: number;
  unknown: boolean;
  settledMicroUsd: number | null;
  reservedUnknownMicroUsd?: number;
  version?: CostVersion;
  pendingInvocation?: string;
  pendingCompleted?: boolean;
  pendingBaseline?: CostVersion;
  pendingImageAttempt?: number;
}
export type GenerationCostLedger = GenerationCostEntry[];
const snapshots = new Map<string, GenerationCostLedger>();
const listeners = new Set<() => void>();
const activeContentInvocations = new Set<string>();
export const generationCostKey = (identity: {
  programId: string;
  importId: string;
  lessonId: string;
}) =>
  `schoolforge:generation-costs:v1:${identity.programId}:${identity.importId}:${identity.lessonId}`;
export function readGenerationCosts(key: string): GenerationCostLedger {
  if (snapshots.has(key)) return snapshots.get(key)!;
  let entries: GenerationCostLedger = [];
  try {
    const raw: unknown = JSON.parse(sessionStorage.getItem(key) ?? '[]');
    if (
      Array.isArray(raw) &&
      raw.length <= 250 &&
      raw.every(
        (e) =>
          e &&
          typeof e.id === 'string' &&
          e.id.length <= 200 &&
          typeof e.phase === 'string' &&
          e.phase.length <= 100 &&
          Number.isSafeInteger(e.knownActualMicroUsd) &&
          e.knownActualMicroUsd >= 0 &&
          typeof e.unknown === 'boolean' &&
          (e.settledMicroUsd === null ||
            (Number.isSafeInteger(e.settledMicroUsd) && e.settledMicroUsd >= 0)),
      )
    )
      entries = raw;
  } catch {
    /* Storage unavailable: keep the in-memory ledger. */
  }
  snapshots.set(key, entries);
  return entries;
}
export function subscribeGenerationCosts(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function writeGenerationCost(key: string, entry: GenerationCostEntry) {
  const entries = [...readGenerationCosts(key).filter((e) => e.id !== entry.id), entry];
  snapshots.set(key, entries);
  try {
    sessionStorage.setItem(key, JSON.stringify(entries));
  } catch {
    /* Keep in memory. */
  }
  listeners.forEach((listener) => listener());
}
export function clearGenerationCosts(key: string) {
  snapshots.set(key, []);
  try {
    sessionStorage.removeItem(key);
  } catch {
    /* Keep in memory. */
  }
  listeners.forEach((listener) => listener());
}
const labels: Record<string, string> = {
  lesson: 'Contenuto',
  lesson_review: 'Revisione contenuto',
  concept_map: 'Mappa',
  concept_map_review: 'Revisione mappa',
  pool: 'Domande',
  pool_review: 'Revisione domande',
};
interface ContentCostStatus {
  status: 'not_found' | 'running' | 'completed' | 'failed';
  knownActualMicroUsd: number;
  unknownExecutions: number;
  settledMicroUsd: number;
  historyComplete: boolean;
  reservedUnknownMicroUsd: number;
  executions: number;
  updatedAtMs: number;
}
export async function recoverContentCost(
  functions: Functions,
  key: string,
  requestId: string,
  allowCompletedReplay = false,
) {
  const observedInvocation = readGenerationCosts(key).find(
    (e) => e.id === requestId,
  )?.pendingInvocation;
  const observedActiveInvocation =
    observedInvocation !== undefined && activeContentInvocations.has(observedInvocation);
  const status = (
    await httpsCallable<{ requestId: string }, ContentCostStatus>(
      functions,
      'aiContentStatus',
    )({ requestId })
  ).data;
  const previous = readGenerationCosts(key).find((e) => e.id === requestId);
  if (
    !previous ||
    status.status === 'not_found' ||
    previous.pendingInvocation !== observedInvocation
  )
    return;
  if (
    ![
      status.knownActualMicroUsd,
      status.unknownExecutions,
      status.settledMicroUsd,
      status.executions,
      status.updatedAtMs,
      status.reservedUnknownMicroUsd ?? 0,
    ].every((n) => Number.isSafeInteger(n) && n >= 0) ||
    typeof status.historyComplete !== 'boolean' ||
    !['running', 'completed', 'failed'].includes(status.status)
  )
    return;
  if (
    previous.version &&
    (previous.version.executions > status.executions ||
      (previous.version.executions === status.executions &&
        (previous.version.updatedAtMs > status.updatedAtMs ||
          (previous.version.updatedAtMs === status.updatedAtMs &&
            previous.version.terminal &&
            status.status === 'running'))))
  )
    return;
  const completedReplay =
    status.status === 'completed' && (allowCompletedReplay || previous.pendingCompleted === true);
  if (
    previous.pendingInvocation &&
    (observedActiveInvocation ||
      activeContentInvocations.has(previous.pendingInvocation) ||
      (!previous.pendingBaseline && !completedReplay))
  ) {
    // Without a prior baseline or a successful callable, a terminal snapshot
    // may still belong to an earlier attempt. It cannot settle this invocation.
    const version: CostVersion = {
      executions: status.executions,
      updatedAtMs: status.updatedAtMs,
      terminal: status.status !== 'running',
    };
    writeGenerationCost(key, {
      ...previous,
      knownActualMicroUsd: Math.max(previous.knownActualMicroUsd, status.knownActualMicroUsd),
      unknown: true,
      settledMicroUsd: status.settledMicroUsd,
      reservedUnknownMicroUsd: status.reservedUnknownMicroUsd,
      version,
      pendingBaseline: previous.pendingBaseline ?? version,
    });
    return;
  }
  const baseline = previous.pendingBaseline;
  if (
    previous.pendingInvocation &&
    baseline &&
    status.executions <= baseline.executions &&
    status.updatedAtMs <= baseline.updatedAtMs &&
    (baseline.terminal || status.status === 'running') &&
    !completedReplay
  )
    return;
  const unresolved = status.status === 'running';
  writeGenerationCost(key, {
    ...previous,
    pendingInvocation: unresolved ? previous.pendingInvocation : undefined,
    pendingCompleted: unresolved ? previous.pendingCompleted : undefined,
    pendingBaseline: unresolved ? previous.pendingBaseline : undefined,
    knownActualMicroUsd: status.knownActualMicroUsd,
    unknown: unresolved || status.unknownExecutions > 0 || !status.historyComplete,
    settledMicroUsd: status.settledMicroUsd,
    reservedUnknownMicroUsd: status.reservedUnknownMicroUsd,
    version: {
      executions: status.executions,
      updatedAtMs: status.updatedAtMs,
      terminal: status.status !== 'running',
    },
  });
}
/** Replace costs by stable request identity; replays and retries never add the same run twice. */
export function instrumentContentCallables<T extends object>(
  callables: T,
  functions: Functions,
  key: string,
): T {
  return Object.fromEntries(
    Object.entries(callables).map(([name, method]) => {
      if (!name.startsWith('generate') || typeof method !== 'function') return [name, method];
      return [
        name,
        async (request: { requestId: string; kind: string; purpose?: string }) => {
          const previous = readGenerationCosts(key).find((e) => e.id === request.requestId);
          const phase =
            request.purpose === 'practice'
              ? request.kind === 'pool_review'
                ? 'Revisione esercitazioni'
                : 'Esercitazioni'
              : (labels[request.kind] ?? request.kind);
          const invocation = crypto.randomUUID();
          activeContentInvocations.add(invocation);
          writeGenerationCost(key, {
            ...previous,
            id: request.requestId,
            phase,
            knownActualMicroUsd: previous?.knownActualMicroUsd ?? 0,
            unknown: true,
            settledMicroUsd: previous?.settledMicroUsd ?? null,
            pendingInvocation: invocation,
            pendingCompleted: undefined,
            pendingBaseline: previous?.version,
          });
          let completed = false;
          try {
            const result = (await method(request)) as { actualCostMicroUsd: number | null };
            completed = true;
            const current = readGenerationCosts(key).find((e) => e.id === request.requestId);
            // A completed metadata read may already have settled this invocation.
            if (current?.pendingInvocation === invocation)
              writeGenerationCost(key, {
                ...current,
                pendingCompleted: true,
                knownActualMicroUsd: Math.max(
                  current.knownActualMicroUsd,
                  result.actualCostMicroUsd ?? 0,
                ),
                unknown: true,
              });
            return result;
          } finally {
            activeContentInvocations.delete(invocation);
            await recoverContentCost(functions, key, request.requestId, completed).catch(
              () => undefined,
            );
          }
        },
      ];
    }),
  ) as T;
}
/** Record risk before invoking an image provider; old plan snapshots cannot settle this attempt. */
export function markVisualSlotInvocation(
  key: string,
  requestId: string,
  slotIndex: number,
  expectedAttempt: number,
) {
  const id = `${requestId}:image:${slotIndex}`;
  const previous = readGenerationCosts(key).find((e) => e.id === id);
  writeGenerationCost(key, {
    ...previous,
    id,
    phase: `Immagine ${slotIndex + 1}`,
    knownActualMicroUsd: previous?.knownActualMicroUsd ?? 0,
    unknown: true,
    settledMicroUsd: previous?.settledMicroUsd ?? null,
    pendingImageAttempt: Math.max(expectedAttempt, previous?.pendingImageAttempt ?? 0),
  });
}
export function recordVisualPlanCosts(key: string, plan: MultiVisualPlan) {
  const proposalId = `${plan.requestId}:proposal`;
  const previousProposal = readGenerationCosts(key).find((e) => e.id === proposalId);
  const pending = plan.status === 'authorized' || plan.status === 'proposing';
  // A late proposing snapshot cannot erase already settled proposal billing.
  if (
    !(
      previousProposal &&
      !previousProposal.unknown &&
      (pending || plan.settlement.proposalActualCost === null)
    )
  )
    writeGenerationCost(key, {
      id: proposalId,
      phase: 'Proposta immagini',
      knownActualMicroUsd: Math.max(
        previousProposal?.knownActualMicroUsd ?? 0,
        plan.settlement.proposalActualCost ?? 0,
      ),
      unknown: plan.settlement.proposalActualCost === null || pending,
      settledMicroUsd: null,
    });
  for (const slot of plan.settlement.slots) {
    if (!slot.attempts) continue;
    const id = `${plan.requestId}:image:${slot.slotIndex}`;
    const previous = readGenerationCosts(key).find((e) => e.id === id);
    const terminal =
      plan.slots?.find((s) => s.slotIndex === slot.slotIndex)?.state !== 'generating';
    if (
      (previous?.pendingImageAttempt !== undefined &&
        previous.pendingImageAttempt > slot.attempts) ||
      (previous?.version &&
        (previous.version.executions > slot.attempts ||
          (previous.version.executions === slot.attempts &&
            previous.version.terminal &&
            !terminal)))
    )
      continue;
    writeGenerationCost(key, {
      id: `${plan.requestId}:image:${slot.slotIndex}`,
      phase: `Immagine ${slot.slotIndex + 1} (${slot.attempts} tentativi)`,
      knownActualMicroUsd: Math.max(
        previous?.knownActualMicroUsd ?? 0,
        slot.knownActualCost ?? slot.actualCost ?? 0,
      ),
      pendingImageAttempt: terminal ? undefined : previous?.pendingImageAttempt,
      unknown: slot.actualCost === null || !terminal,
      settledMicroUsd: null,
      version: { executions: slot.attempts, updatedAtMs: 0, terminal },
    });
  }
}
