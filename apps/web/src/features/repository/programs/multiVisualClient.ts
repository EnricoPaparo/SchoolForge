import { httpsCallable } from 'firebase/functions';
import type { Functions } from 'firebase/functions';
export type MultiVisualIdentity = { programId: string; importId: string; lessonId: string };
export type MultiVisualQuantity = { mode: 'auto' | 'exact'; ceiling: 1 | 2 | 3 };
export interface MultiVisualPlanRequest extends MultiVisualIdentity {
  requestId: string;
  quantity: MultiVisualQuantity;
  replacementAssetId: string | null;
  titolo: unknown;
  sottotitolo: unknown;
  difficolta: unknown;
  concettiChiave: unknown;
  obiettivi: unknown;
  udaTitle: unknown;
  udaContext: unknown;
}
export interface MultiVisualSlot {
  slotIndex: number;
  state: string;
  decision: string;
  subject: string | null;
  rationale: string | null;
  anchor: { headingIndex: number; headingText: string; headingSlug: string } | null;
  caption: string | null;
  altText: string | null;
  attempts: number;
  lastError: string | null;
  staged: {
    storageRef: string;
    width: number;
    height: number;
    byteLength: number;
    sha256: string;
  } | null;
  promotedAssetId: string | null;
}
export interface MultiVisualPlan {
  planHash: string;
  requestId: string;
  status: string;
  slots: MultiVisualSlot[];
  budgetCeiling: Record<string, unknown>;
  settlement: Record<string, unknown>;
}

type PlanEnvelope = { replayed: boolean; plan: MultiVisualPlan };
type PromotionEnvelope = PlanEnvelope & { assetId: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parsePlan(value: unknown): MultiVisualPlan {
  if (
    !isRecord(value) ||
    typeof value.requestId !== 'string' ||
    typeof value.planHash !== 'string' ||
    typeof value.status !== 'string' ||
    !Array.isArray(value.slots) ||
    !isRecord(value.budgetCeiling) ||
    !isRecord(value.settlement)
  ) {
    throw new Error('multi_visual_invalid_response');
  }
  return value as unknown as MultiVisualPlan;
}

function parsePlanEnvelope(value: unknown): MultiVisualPlan {
  if (!isRecord(value) || typeof value.replayed !== 'boolean') {
    throw new Error('multi_visual_invalid_response');
  }
  return parsePlan(value.plan);
}

function activePlanRequestId(error: unknown): string | null {
  const details = (error as { details?: unknown })?.details;
  if (!isRecord(details) || details.code !== 'visual_plan_already_active') return null;
  const requestId = details.requestId;
  return typeof requestId === 'string' ? requestId : null;
}
export function describeMultiVisualError(error: unknown): string {
  const code = (error as { details?: { code?: unknown } })?.details?.code;
  if (code === 'budget_unavailable' || code === 'operation_budget_exceeded')
    return 'Budget non disponibile: nessuna nuova spesa è stata autorizzata.';
  if (code === 'uncertain_state')
    return 'Esito incerto: non ripetere ora il tentativo; verifica il piano.';
  if (code === 'visual_plan_slot_attempts_exhausted') return 'Tentativi esauriti per questo slot.';
  if (code === 'visual_plan_external_mutation')
    return 'La lezione è cambiata: ricarica il piano prima di continuare.';
  if (code === 'visual_plan_expired') return 'Il piano è scaduto: avvia una nuova proposta.';
  return 'Operazione non riuscita. Nessuna modifica parziale è stata applicata.';
}
export function createMultiVisualClient(functions: Functions) {
  const authorize = httpsCallable<MultiVisualPlanRequest, MultiVisualPlan>(
    functions,
    'aiVisualPlanAuthorize',
  );
  const generate = httpsCallable<
    MultiVisualIdentity & { requestId: string; slotIndex: number },
    PlanEnvelope
  >(functions, 'aiVisualPlanGenerateSlot');
  const promote = httpsCallable<
    MultiVisualIdentity & {
      requestId: string;
      slotIndex: number;
      promotionRequestId: string;
      mode: { mode: 'add' } | { mode: 'replace'; replaceAssetId: string };
    },
    PromotionEnvelope
  >(functions, 'aiVisualPlanPromoteSlot');
  const reorder = httpsCallable<
    MultiVisualIdentity & { expectedAssetIds: string[]; nextAssetIds: string[] },
    { status: string }
  >(functions, 'aiVisualMultiReorder');
  const remove = httpsCallable<MultiVisualIdentity & { assetId: string }, { status: string }>(
    functions,
    'aiVisualMultiRemove',
  );
  const edit = httpsCallable<
    MultiVisualIdentity & {
      requestId: string;
      editRequestId: string;
      slotIndex: number;
      abandon: boolean;
      subject?: string;
      caption?: string;
      altText?: string;
      anchorHeadingIndex?: number;
      anchorHeadingText?: string;
    },
    PlanEnvelope
  >(functions, 'aiVisualPlanEditSlot');
  return {
    authorize: async (input: MultiVisualPlanRequest) => {
      try {
        return parsePlan((await authorize(input)).data);
      } catch (error) {
        const requestId = activePlanRequestId(error);
        if (requestId === null || requestId === input.requestId) throw error;
        // Una chiusura/ricarica del dialog non deve rendere irraggiungibile il
        // piano già autorizzato. Il server comunica l'identità opaca solo al
        // proprietario autenticato: la stessa callable ne esegue il replay,
        // senza nuova prenotazione né nuova chiamata provider.
        return parsePlan((await authorize({ ...input, requestId })).data);
      }
    },
    generateSlot: (input: MultiVisualIdentity & { requestId: string; slotIndex: number }) =>
      generate(input).then((r) => parsePlanEnvelope(r.data)),
    promoteSlot: (
      input: MultiVisualIdentity & {
        requestId: string;
        slotIndex: number;
        promotionRequestId: string;
        mode: { mode: 'add' } | { mode: 'replace'; replaceAssetId: string };
      },
    ) => promote(input).then((r) => parsePlanEnvelope(r.data)),
    reorder: (
      input: MultiVisualIdentity & { expectedAssetIds: string[]; nextAssetIds: string[] },
    ) => reorder(input).then((r) => r.data),
    remove: (input: MultiVisualIdentity & { assetId: string }) => remove(input).then((r) => r.data),
    editSlot: (
      input:
        | (MultiVisualIdentity & {
            requestId: string;
            editRequestId: string;
            slotIndex: number;
            abandon: true;
          })
        | (MultiVisualIdentity & {
            requestId: string;
            editRequestId: string;
            slotIndex: number;
            abandon: false;
            subject: string;
            caption: string;
            altText: string;
            anchorHeadingIndex: number;
            anchorHeadingText: string;
          }),
    ) => edit(input).then((r) => parsePlanEnvelope(r.data)),
  };
}
