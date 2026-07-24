import { httpsCallable } from 'firebase/functions';
import type { Functions } from 'firebase/functions';

/**
 * AIGEN-02 — client tipizzato delle callable di generazione contenuti IA
 * (`aiContentPreview`/`aiContentGenerate`, motore AIGEN-01). Il client invia un
 * **payload chiuso** e mai model ID, listino, prezzi, budget, API key, system
 * prompt, `ownerUid` o l'intero pool esistente: la risoluzione profilo →
 * modello/listino è esclusivamente server-side. Il testo della lezione e le
 * indicazioni sono materiale **non attendibile**: nessun prompt è costruito nel
 * client. Nessuna lettura diretta di `aiContentRuns`: il risultato è restituito
 * dalla Function.
 *
 * AIGEN-02 copre solo la generazione dei **pool** (`kind: 'pool'`). Le lezioni
 * (`kind: 'lesson'`) sono AIGEN-03.
 */

/** Profilo modello **chiuso**: il client sceglie solo economy/quality. */
export type PoolModelProfile = 'economy' | 'quality';

export const DEFAULT_POOL_MODEL_PROFILE: PoolModelProfile = 'quality';

/**
 * Opzioni del profilo. `modelId` è il nome tecnico del modello server-side,
 * mostrato in piccolo a scopo informativo secondo il contratto approvato: non è
 * un prezzo e **non** viene mai inviato nel payload.
 */
export const POOL_MODEL_PROFILE_OPTIONS: readonly {
  value: PoolModelProfile;
  label: string;
  modelId: string;
  description: string;
}[] = [
  {
    value: 'economy',
    label: 'Economy',
    modelId: 'gpt-5.4-nano-2026-03-17',
    description: 'Più economico e rapido.',
  },
  {
    value: 'quality',
    label: 'Quality',
    modelId: 'gpt-5.6-luna',
    description: 'Qualità superiore, costo maggiore.',
  },
];

/** Stile del pool (mappa 1:1 sul `level` del payload; range difficoltà server). */
export type PoolLevel = 'base' | 'balanced' | 'advanced';

export const DEFAULT_POOL_LEVEL: PoolLevel = 'balanced';

export const POOL_LEVEL_OPTIONS: readonly {
  value: PoolLevel;
  label: string;
  difficultyLabel: string;
  description: string;
}[] = [
  {
    value: 'base',
    label: 'Comprensivo',
    difficultyLabel: '1–3',
    description: 'Domande più accessibili (difficoltà 1–3).',
  },
  {
    value: 'balanced',
    label: 'Equilibrato',
    difficultyLabel: '1–5',
    description: 'Copertura completa (difficoltà 1–5).',
  },
  {
    value: 'advanced',
    label: 'Rigoroso',
    difficultyLabel: '3–5',
    description: 'Domande più impegnative (difficoltà 3–5).',
  },
];

/** Conteggi per tipo (interi ≥ 0). */
export interface PoolCounts {
  aperta: number;
  chiusa_singola: number;
  chiusa_multipla: number;
}

export const MAX_POOL_TOTAL_QUESTIONS = 30;
export const MAX_TEACHER_GUIDANCE_CHARS = 500;

/** Payload chiuso inviato a entrambe le callable (preview e generate). */
export interface AiPoolContentRequest {
  kind: 'pool';
  requestId: string;
  modelProfile: PoolModelProfile;
  teacherGuidance?: string;
  level: PoolLevel;
  counts: PoolCounts;
  lessonSource: string;
  existingPoolQuestionCount: number;
}

export interface AiPoolPreviewResult {
  kind: 'pool';
  modelProfile: string;
  estimatedInputTokens: number;
  maxOutputTokens: number;
  /** Costo stimato (micro-USD interi): stima informativa mostrata all'utente. */
  estimatedCostMicroUsd: number;
  /** Tetto massimo prenotabile (micro-USD interi), distinto dalla stima. */
  reservationCostMicroUsd: number;
  requestedTotal: number | null;
}

/** Domanda proposta dal modello, **senza** ID persistiti (contratto AIGEN-01). */
export type AiProposalQuestion =
  | { order: number; tipo: 'aperta'; testo: string; difficolta: number; soluzione: string }
  | {
      order: number;
      tipo: 'chiusa_singola' | 'chiusa_multipla';
      testo: string;
      difficolta: number;
      opzioni: string[];
      /** Indici (0-based) delle opzioni corrette. */
      soluzioneIndici: number[];
    };

export interface AiPoolProposalOutput {
  questions: AiProposalQuestion[];
}

export interface AiPoolGenerateResult {
  status: 'completed';
  kind: 'pool';
  modelProfile: string;
  output: AiPoolProposalOutput;
  /** `null` ⇒ consumo esatto non disponibile (settlement conservativo). */
  actualCostMicroUsd: number | null;
  replayed: boolean;
}

export interface AiContentCallables {
  preview: (req: AiPoolContentRequest) => Promise<AiPoolPreviewResult>;
  generate: (req: AiPoolContentRequest) => Promise<AiPoolGenerateResult>;
}

/** Nuovo `requestId` (idempotenza server-side su `aiContentRuns`). */
export function newRequestId(): string {
  return crypto.randomUUID();
}

/**
 * Costruisce il payload chiuso **normalizzato**. La guidance è trimmata e omessa
 * se vuota; i conteggi sono passati così come sono (mai troncati silenziosamente:
 * i vincoli sono verificati dalla UI e, in modo autorevole, dal server).
 */
export function buildPoolContentRequest(params: {
  requestId: string;
  modelProfile: PoolModelProfile;
  level: PoolLevel;
  counts: PoolCounts;
  lessonSource: string;
  existingPoolQuestionCount: number;
  teacherGuidance?: string;
}): AiPoolContentRequest {
  const guidance = params.teacherGuidance?.trim();
  return {
    kind: 'pool',
    requestId: params.requestId,
    modelProfile: params.modelProfile,
    level: params.level,
    counts: {
      aperta: params.counts.aperta,
      chiusa_singola: params.counts.chiusa_singola,
      chiusa_multipla: params.counts.chiusa_multipla,
    },
    lessonSource: params.lessonSource,
    existingPoolQuestionCount: params.existingPoolQuestionCount,
    ...(guidance ? { teacherGuidance: guidance } : {}),
  };
}

/** Crea i wrapper delle callable su una `Functions` iniettata (testabile). */
export function createAiContentCallables(functions: Functions): AiContentCallables {
  const previewFn = httpsCallable<AiPoolContentRequest, AiPoolPreviewResult>(
    functions,
    'aiContentPreview',
  );
  const generateFn = httpsCallable<AiPoolContentRequest, AiPoolGenerateResult>(
    functions,
    'aiContentGenerate',
  );
  return {
    preview: async (req) => (await previewFn(req)).data,
    generate: async (req) => (await generateFn(req)).data,
  };
}

/**
 * Messaggio d'errore leggibile per un errore della callable, **senza** esporre
 * dettagli sensibili (prompt, modello tecnico, ledger, raw error). Riconosce i
 * codici stabili del gateway AIGEN-01 (`err.details.code`).
 */
export function describeAiContentError(err: unknown): string {
  const code = (err as { details?: { code?: string } })?.details?.code;
  const httpsCode = (err as { code?: string })?.code;
  switch (code) {
    case 'feature_disabled':
      return 'La generazione IA è disattivata.';
    case 'not_owner':
      return 'Operazione riservata al docente proprietario.';
    case 'unauthenticated':
      return 'Sessione scaduta: accedi di nuovo.';
    case 'budget_unavailable':
      return 'Budget non disponibile al momento. Riprova più tardi.';
    case 'budget_exceeded':
      return 'Budget mensile insufficiente per questa generazione.';
    case 'daily_budget_exceeded':
      return 'Budget giornaliero esaurito. Riprova domani.';
    case 'operation_budget_exceeded':
      return 'Il costo prenotato supera il limite per una singola operazione.';
    case 'limit_exceeded':
      return 'La richiesta supera i limiti consentiti. Riduci le domande.';
    case 'content_too_large':
      return 'Il materiale della lezione è troppo grande.';
    case 'provider_config_invalid':
      return 'Configurazione del servizio IA non disponibile.';
    case 'provider_unavailable':
      return 'Il servizio di generazione non è disponibile ora. Riprova.';
    case 'provider_invalid_output':
      return 'La risposta generata non è valida. Riprova.';
    case 'output_too_large':
      return 'Il risultato generato supera il limite di dimensione.';
    case 'running':
      return 'Una generazione per questa richiesta è già in corso.';
    case 'run_conflict':
      return 'Richiesta già usata con contenuti diversi. Ricalcola la stima.';
    case 'invalid_input':
      return 'Configurazione non valida. Controlla i campi e riprova.';
    default:
      break;
  }
  if (httpsCode === 'functions/unauthenticated') return 'Sessione scaduta: accedi di nuovo.';
  if (httpsCode === 'functions/permission-denied')
    return 'Operazione riservata al docente proprietario.';
  if (httpsCode === 'functions/failed-precondition') return 'La generazione IA è disattivata.';
  return 'Impossibile completare la generazione IA. Riprova.';
}

/** Converte micro-USD interi in una stringa USD leggibile (6 decimali). */
export function formatMicroUsd(microUsd: number): string {
  return `${(microUsd / 1_000_000).toFixed(6)} USD`;
}
