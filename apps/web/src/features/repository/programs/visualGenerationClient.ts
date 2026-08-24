import { doc, getDoc } from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import type { Functions } from 'firebase/functions';
import type { LessonUdaContext } from '../pools/aiContentClient.js';
import type { LessonVisualPrivateManifest } from '../../../types/firestore.js';
import { createVisualLifecycleClient } from './visualLifecycleClient.js';

export interface VisualProposalRequest {
  kind: 'visual_proposal';
  requestId: string;
  modelProfile: 'quality';
  titolo: string;
  sottotitolo: string | null;
  difficolta: string;
  concettiChiave: string[];
  obiettivi: string[];
  udaTitle: string;
  udaContext: LessonUdaContext;
  lessonBody: string;
}

export type VisualProposal =
  | { decision: 'none'; reason: string }
  | {
      decision: 'image';
      subject: string;
      rationale: string;
      anchorHeadingText: string;
      caption: string;
      altText: string;
    };

export interface VisualProposalPreview {
  kind: 'visual_proposal';
  modelProfile: string;
  estimatedInputTokens: number;
  maxOutputTokens: number;
  estimatedCostMicroUsd: number;
  reservationCostMicroUsd: number;
  requestedTotal: null;
}

export interface VisualProposalGenerate {
  status: 'completed';
  kind: 'visual_proposal';
  modelProfile: string;
  output: VisualProposal;
  actualCostMicroUsd: number | null;
  replayed: boolean;
}

export interface VisualIdentity {
  programId: string;
  importId: string;
  lessonId: string;
}

export interface VisualImagePreview {
  requestId: string;
  styleVersion: string;
  preset: Record<string, unknown>;
  estimatedInputTokens: number;
  expectedOutputTokens: number;
  estimatedCostMicroUsd: number;
  reservationCostMicroUsd: number;
}

export interface VisualImageGenerate {
  requestId: string;
  replayed: boolean;
  dataUri: string;
  width: number;
  height: number;
  byteLength: number;
  sha256: string;
  mimeType: 'image/webp';
  styleVersion: string;
  estimatedCostMicroUsd: number;
  actualCostMicroUsd: number | null;
  settledCostMicroUsd: number;
}

export interface VisualWorkflowPorts {
  previewProposal: (request: VisualProposalRequest) => Promise<VisualProposalPreview>;
  generateProposal: (request: VisualProposalRequest) => Promise<VisualProposalGenerate>;
  bind: (request: VisualIdentity & { requestId: string }) => Promise<unknown>;
  previewImage: (request: { requestId: string; subject: string }) => Promise<VisualImagePreview>;
  generateImage: (request: { requestId: string; subject: string }) => Promise<VisualImageGenerate>;
  promote: (
    request: VisualIdentity & {
      requestId: string;
      anchorHeadingText: string;
      caption: string;
      altText: string;
    },
  ) => Promise<{ requestId: string; replayed: boolean; assetId: string }>;
  abandon: (requestId: string) => Promise<void>;
  remove: (identity: VisualIdentity) => Promise<void>;
}

export function createVisualWorkflowPorts(functions: Functions): VisualWorkflowPorts {
  const lifecycle = createVisualLifecycleClient(functions);
  const proposalPreview = httpsCallable<VisualProposalRequest, VisualProposalPreview>(
    functions,
    'aiContentPreview',
  );
  const proposalGenerate = httpsCallable<VisualProposalRequest, VisualProposalGenerate>(
    functions,
    'aiContentGenerate',
  );
  const bind = httpsCallable<VisualIdentity & { requestId: string }, unknown>(
    functions,
    'aiVisualBindCandidate',
  );
  const imagePreview = httpsCallable<{ requestId: string; subject: string }, VisualImagePreview>(
    functions,
    'aiVisualPreview',
  );
  const imageGenerate = httpsCallable<{ requestId: string; subject: string }, VisualImageGenerate>(
    functions,
    'aiVisualGenerate',
  );
  const promote = httpsCallable<
    Parameters<VisualWorkflowPorts['promote']>[0],
    Awaited<ReturnType<VisualWorkflowPorts['promote']>>
  >(functions, 'aiVisualPromote');
  return {
    previewProposal: async (request) => (await proposalPreview(request)).data,
    generateProposal: async (request) => (await proposalGenerate(request)).data,
    bind: async (request) => (await bind(request)).data,
    previewImage: async (request) => (await imagePreview(request)).data,
    generateImage: async (request) => (await imageGenerate(request)).data,
    promote: async (request) => (await promote(request)).data,
    abandon: lifecycle.abandonVisual,
    remove: lifecycle.removeLessonVisual,
  };
}

export async function readAuthoritativePrivateVisual(
  params: VisualIdentity & { db: Firestore },
): Promise<LessonVisualPrivateManifest | null> {
  const snap = await getDoc(
    doc(
      params.db,
      'programs',
      params.programId,
      'imports',
      params.importId,
      'lessons',
      params.lessonId,
    ),
  );
  if (!snap.exists()) throw new Error('La lezione non esiste più.');
  return (snap.data().visual ?? null) as LessonVisualPrivateManifest | null;
}

export function describeVisualWorkflowError(error: unknown): string {
  const code = (error as { details?: { code?: string } })?.details?.code;
  const messages: Record<string, string> = {
    feature_disabled: 'La generazione visuale è disattivata.',
    unauthenticated: 'Sessione scaduta: accedi di nuovo.',
    not_owner: 'Operazione riservata al docente proprietario.',
    budget_unavailable: 'Budget non disponibile. Riprova più tardi.',
    budget_exceeded: 'Budget mensile insufficiente.',
    daily_budget_exceeded: 'Budget giornaliero esaurito.',
    operation_budget_exceeded: 'Il costo supera il limite per operazione.',
    provider_unavailable: 'Il servizio immagini non è disponibile. Riprova.',
    billed_unusable:
      'La generazione è stata fatturata ma non ha prodotto un’immagine utilizzabile.',
    running: 'Questa operazione è già in corso.',
    uncertain_state: 'Lo stato non è certo: aggiorna la lezione prima di riprovare.',
    run_conflict: 'La richiesta è già associata a dati diversi.',
    corrupted_state: 'Lo stato visuale non è leggibile in sicurezza.',
    invalid_input: 'La lezione o il candidato sono cambiati, scaduti o non più validi.',
  };
  return (code && messages[code]) || 'Impossibile completare l’operazione visuale. Riprova.';
}
