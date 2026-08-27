import { httpsCallable } from 'firebase/functions';
import type { Functions } from 'firebase/functions';
export type MultiVisualIdentity = { programId: string; importId: string; lessonId: string };
export type MultiVisualQuantity = { mode: 'auto' | 'exact'; ceiling: 1 | 2 | 3 };
export interface MultiVisualPlanRequest extends MultiVisualIdentity {
  requestId: string;
  quantity: MultiVisualQuantity;
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
    MultiVisualPlan
  >(functions, 'aiVisualPlanGenerateSlot');
  const promote = httpsCallable<
    MultiVisualIdentity & {
      requestId: string;
      slotIndex: number;
      promotionRequestId: string;
      mode: { mode: 'add' } | { mode: 'replace'; replaceAssetId: string };
    },
    MultiVisualPlan
  >(functions, 'aiVisualPlanPromoteSlot');
  const reorder = httpsCallable<
    MultiVisualIdentity & { expectedAssetIds: string[]; nextAssetIds: string[] },
    { status: string }
  >(functions, 'aiVisualMultiReorder');
  const remove = httpsCallable<MultiVisualIdentity & { assetId: string }, { status: string }>(
    functions,
    'aiVisualMultiRemove',
  );
  return {
    authorize: (input: MultiVisualPlanRequest) => authorize(input).then((r) => r.data),
    generateSlot: (input: MultiVisualIdentity & { requestId: string; slotIndex: number }) =>
      generate(input).then((r) => r.data),
    promoteSlot: (
      input: MultiVisualIdentity & {
        requestId: string;
        slotIndex: number;
        promotionRequestId: string;
        mode: { mode: 'add' } | { mode: 'replace'; replaceAssetId: string };
      },
    ) => promote(input).then((r) => r.data),
    reorder: (
      input: MultiVisualIdentity & { expectedAssetIds: string[]; nextAssetIds: string[] },
    ) => reorder(input).then((r) => r.data),
    remove: (input: MultiVisualIdentity & { assetId: string }) => remove(input).then((r) => r.data),
  };
}
