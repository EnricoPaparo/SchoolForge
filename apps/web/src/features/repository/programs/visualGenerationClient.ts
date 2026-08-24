import { doc, getDoc } from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import type { Functions } from 'firebase/functions';
import type { LessonUdaContext } from '../pools/aiContentClient.js';
import type { LessonVisualPrivateManifest } from '../../../types/firestore.js';
import { createVisualLifecycleClient } from './visualLifecycleClient.js';
import { parsePrivateVisualManifest } from './lessonVisualContract.js';

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
      anchorHeadingIndex: number;
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
  const data = snap.data();
  const parsed = parsePrivateVisualManifest({
    value: data.visual,
    ownerUid: data.ownerUid,
    importId: params.importId,
    udaDir: data.udaDir,
  });
  if (parsed.kind === 'absent') return null;
  if (parsed.kind === 'malformed') {
    throw new Error('Il manifest visuale salvato non è leggibile in sicurezza.');
  }
  return parsed.manifest;
}

export type WebAiVisualErrorCode =
  | 'unauthenticated'
  | 'not_owner'
  | 'feature_disabled'
  | 'invalid_input'
  | 'running'
  | 'run_conflict'
  | 'corrupted_state'
  | 'uncertain_state'
  | 'operation_budget_exceeded'
  | 'budget_exceeded'
  | 'daily_budget_exceeded'
  | 'budget_unavailable'
  | 'provider_config_invalid'
  | 'provider_unavailable'
  | 'provider_invalid_response'
  | 'provider_billed_unusable'
  | 'visual_invalid_format'
  | 'visual_corrupted'
  | 'visual_too_large'
  | 'staging_failed'
  | 'internal';

export function visualWorkflowErrorCode(error: unknown): WebAiVisualErrorCode | null {
  const code = (error as { details?: { code?: unknown } })?.details?.code;
  return typeof code === 'string' && code in VISUAL_ERROR_MESSAGES
    ? (code as WebAiVisualErrorCode)
    : null;
}

export type VisualErrorDisposition = 'retry_same' | 'terminal' | 'uncertain' | 'blocked';

export function visualErrorDisposition(error: unknown): VisualErrorDisposition {
  const code = visualWorkflowErrorCode(error);
  if (code === null || code === 'running') return 'retry_same';
  if (code === 'uncertain_state') return 'uncertain';
  if (
    code === 'unauthenticated' ||
    code === 'not_owner' ||
    code === 'feature_disabled' ||
    code === 'operation_budget_exceeded' ||
    code === 'budget_exceeded' ||
    code === 'daily_budget_exceeded' ||
    code === 'budget_unavailable'
  ) {
    return 'blocked';
  }
  return 'terminal';
}

const VISUAL_ERROR_MESSAGES: Record<WebAiVisualErrorCode, string> = {
  unauthenticated: 'Sessione scaduta: accedi di nuovo.',
  not_owner: 'Operazione riservata al docente proprietario.',
  feature_disabled: 'La generazione visuale è disattivata.',
  invalid_input: 'La lezione o il candidato sono cambiati, scaduti o non più validi.',
  running: 'Questa operazione è già in corso. Attendi e riprova sullo stesso tentativo.',
  run_conflict: 'La richiesta è già associata a dati diversi.',
  corrupted_state: 'Lo stato visuale non è leggibile in sicurezza.',
  uncertain_state: 'Lo stato non è certo: aggiorna la lezione prima di qualsiasi nuovo tentativo.',
  operation_budget_exceeded: 'Il costo supera il limite per operazione.',
  budget_exceeded: 'Budget mensile insufficiente.',
  daily_budget_exceeded: 'Budget giornaliero esaurito.',
  budget_unavailable: 'Budget non disponibile. Riprova più tardi.',
  provider_config_invalid: 'Il provider immagini non è configurato correttamente.',
  provider_unavailable: 'Il provider immagini non ha completato il tentativo.',
  provider_invalid_response: 'Il provider ha restituito una risposta non valida.',
  provider_billed_unusable:
    'La generazione è stata fatturata ma non ha prodotto un’immagine utilizzabile.',
  visual_invalid_format: 'L’immagine ricevuta ha un formato non ammesso.',
  visual_corrupted: 'L’immagine ricevuta è corrotta o non verificabile.',
  visual_too_large: 'L’immagine supera i limiti di dimensione consentiti.',
  staging_failed: 'L’immagine è stata generata ma non è stato possibile salvarla in staging.',
  internal: 'Il servizio visuale ha restituito un errore interno.',
};

export function describeVisualWorkflowError(error: unknown): string {
  const code = visualWorkflowErrorCode(error);
  return code
    ? VISUAL_ERROR_MESSAGES[code]
    : 'Risposta non ricevuta: verifica o riprova sullo stesso tentativo.';
}
