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
  anchorHeadingIndex: number | null;
  anchorHeadingText: string | null;
  caption: string | null;
  altText: string | null;
  staged?: { assetId: string; dataUri: string; width: number; height: number } | null;
  promotedAssetId?: string | null;
}
export interface MultiVisualPlan {
  planHash: string;
  requestId: string;
  status: string;
  slots: MultiVisualSlot[];
  budgetCeiling: Record<string, unknown>;
  settlement: Record<string, unknown>;
}

export function createMultiVisualClient(functions: Functions) {
  const authorize = httpsCallable<
    MultiVisualPlanRequest,
    { replayed: boolean; plan: MultiVisualPlan }
  >(functions, 'aiVisualPlanAuthorize');
  const generate = httpsCallable<
    { requestId: string; slotIndex: number },
    { replayed: boolean; plan: MultiVisualPlan }
  >(functions, 'aiVisualPlanGenerateSlot');
  const promote = httpsCallable<
    {
      requestId: string;
      slotIndex: number;
      anchorHeadingIndex: number;
      anchorHeadingText: string;
      caption: string;
      altText: string;
    },
    { replayed: boolean; plan: MultiVisualPlan }
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
    authorize: async (input: MultiVisualPlanRequest) => (await authorize(input)).data,
    generateSlot: async (input: { requestId: string; slotIndex: number }) =>
      (await generate(input)).data,
    promoteSlot: async (input: {
      requestId: string;
      slotIndex: number;
      anchorHeadingIndex: number;
      anchorHeadingText: string;
      caption: string;
      altText: string;
    }) => (await promote(input)).data,
    reorder: async (
      input: MultiVisualIdentity & { expectedAssetIds: string[]; nextAssetIds: string[] },
    ) => (await reorder(input)).data,
    remove: async (input: MultiVisualIdentity & { assetId: string }) => (await remove(input)).data,
  };
}
