import { httpsCallable } from 'firebase/functions';
import type { Functions } from 'firebase/functions';

export const MAX_VISUAL_UPLOAD_BYTES = 2_000_000;
export const VISUAL_UPLOAD_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;

export interface VisualUploadIdentity {
  programId: string;
  importId: string;
  lessonId: string;
}

export interface VisualUploadAnchor {
  anchorHeadingIndex: number;
  anchorHeadingText: string;
}

export interface VisualUploadAcceptRequest extends VisualUploadIdentity {
  requestId: string;
  base64: string;
  anchor: VisualUploadAnchor;
  caption: string;
  altText: string;
}

export interface VisualUploadAcceptResult {
  requestId: string;
  status: 'accepted' | 'ready' | 'promoted' | 'abandoned' | 'expired' | 'failed';
  replayed: boolean;
  lastError:
    | 'visual_upload_too_large'
    | 'visual_upload_unsupported_format'
    | 'visual_upload_conflict'
    | null;
}

export type VisualUploadPromotionMode =
  | { mode: 'add' }
  | { mode: 'replace'; replaceAssetId: string };

export interface VisualUploadPromoteRequest {
  requestId: string;
  promotionRequestId: string;
  mode: VisualUploadPromotionMode;
}

export interface VisualUploadPromoteResult {
  replayed: boolean;
  assetId: string;
}

export interface VisualUploadAbandonResult {
  status: 'abandoned' | 'already_abandoned';
}

export interface VisualUploadClient {
  accept: (request: VisualUploadAcceptRequest) => Promise<VisualUploadAcceptResult>;
  promote: (request: VisualUploadPromoteRequest) => Promise<VisualUploadPromoteResult>;
  abandon: (requestId: string) => Promise<VisualUploadAbandonResult>;
}

export function createVisualUploadClient(functions: Functions): VisualUploadClient {
  const accept = httpsCallable<VisualUploadAcceptRequest, VisualUploadAcceptResult>(
    functions,
    'aiVisualUploadAccept',
  );
  const promote = httpsCallable<VisualUploadPromoteRequest, VisualUploadPromoteResult>(
    functions,
    'aiVisualUploadPromote',
  );
  const abandon = httpsCallable<{ requestId: string }, VisualUploadAbandonResult>(
    functions,
    'aiVisualUploadAbandon',
  );
  return {
    accept: async (request) => (await accept(request)).data,
    promote: async (request) => (await promote(request)).data,
    abandon: async (requestId) => (await abandon({ requestId })).data,
  };
}

const ERROR_MESSAGES: Record<string, string> = {
  unauthenticated: 'Sessione scaduta: accedi di nuovo.',
  not_owner: 'Operazione riservata al docente proprietario.',
  invalid_input: 'I dati dell’upload non sono più validi.',
  corrupted_state: 'Lo stato dell’upload non è leggibile in sicurezza.',
  visual_upload_too_large: 'Il file supera il limite di 2 MB.',
  visual_upload_unsupported_format: 'Formato non ammesso: usa PNG, JPEG o WebP.',
  visual_upload_conflict: 'Questo tentativo è associato a dati diversi.',
  visual_promotion_anchor_stale: 'La posizione scelta non esiste più nella lezione aggiornata.',
  visual_slot_full: 'La lezione contiene già tre immagini.',
  visual_replace_target_missing: 'L’immagine da sostituire non esiste più.',
  running: 'L’upload è già in corso. Riprova sullo stesso tentativo.',
  run_conflict: 'Questo tentativo è associato a dati diversi.',
};

export function visualUploadErrorCode(error: unknown): string | null {
  const code = (error as { details?: { code?: unknown } })?.details?.code;
  return typeof code === 'string' ? code : null;
}

export function describeVisualUploadError(error: unknown): string {
  const code = visualUploadErrorCode(error);
  return code && ERROR_MESSAGES[code]
    ? ERROR_MESSAGES[code]
    : 'Upload non completato: riprova mantenendo lo stesso tentativo.';
}
