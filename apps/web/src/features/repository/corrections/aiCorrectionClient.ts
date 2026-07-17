import { httpsCallable } from 'firebase/functions';
import type { Functions } from 'firebase/functions';

/**
 * M5-03 — client tipizzato delle callable del gateway IA
 * (`aiCorrectionPreview`/`aiCorrectionRun`, motore M5-02, modalità mock).
 *
 * Il client invia **esclusivamente** `verificationId`, `submissionIds` e
 * `requestId`: mai testi di domande, risposte, soluzioni, nomi o email. Le
 * response rispecchiano il contratto del motore (`functions/src/
 * aiCorrectionEngine.ts`). Nessuna lettura diretta di `aiCorrectionRuns`: il
 * risultato è restituito dalla Function.
 */

export type AiExclusionReason =
  | 'not_found'
  | 'wrong_owner'
  | 'wrong_verification'
  | 'not_submitted'
  | 'snapshot_unavailable'
  | 'correction_not_in_progress'
  | 'nothing_to_grade'
  | 'too_large'
  | 'changed_since_preview'
  | 'write_error'
  // M5-05D2B-2 — esiti tecnici del provider reale (retry/deadline).
  | 'deadline_exceeded'
  | 'rate_limited'
  | 'provider_timeout'
  | 'provider_unavailable'
  | 'retry_after_exceeded';

export type AiRunStatus = 'running' | 'completed' | 'partial' | 'failed';

export interface AiCorrectionRequest {
  verificationId: string;
  submissionIds: string[];
  requestId: string;
}

export interface AiPreviewCounts {
  selected: number;
  eligible: number;
  excluded: number;
  closedToGrade: number;
  openToGrade: number;
  closedOnlySubmissions: number;
  alreadyGradedIgnored: number;
}

export interface AiPreviewResult {
  mode: 'mock';
  phase: 'preview';
  requestId: string;
  verificationId: string;
  counts: AiPreviewCounts;
  tokensEstimated: number;
  costEstimated: number;
  excluded: { submissionId: string; reason: AiExclusionReason }[];
}

export interface AiRunSubmissionResult {
  submissionId: string;
  outcome: 'succeeded' | 'partial' | 'excluded' | 'failed';
  closedGraded: number;
  openGraded: number;
  openSkipped: number;
  /** Chiuse non valutate perché soluzione/opzioni malformate (M5-04C). */
  closedSkipped?: number;
  alreadyIgnored: number;
  reason?: AiExclusionReason;
}

export interface AiRunResult {
  mode: 'mock';
  phase: 'run';
  requestId: string;
  verificationId: string;
  status: AiRunStatus;
  idempotentReplay: boolean;
  counts: AiPreviewCounts & { succeeded: number; partial: number; failed: number };
  tokensEstimated: number;
  tokensActual: number;
  costActual: number;
  results: AiRunSubmissionResult[];
}

export interface AiCorrectionCallables {
  preview: (req: AiCorrectionRequest) => Promise<AiPreviewResult>;
  run: (req: AiCorrectionRequest) => Promise<AiRunResult>;
}

/** Nuovo `requestId` client-side (idempotenza server-side su `aiCorrectionRuns`). */
export function newRequestId(): string {
  return crypto.randomUUID();
}

/** Costruisce il payload **chiuso**: solo i tre ID ammessi, mai altri campi. */
export function buildRequest(
  verificationId: string,
  submissionIds: string[],
  requestId: string,
): AiCorrectionRequest {
  return { verificationId, submissionIds: [...submissionIds], requestId };
}

/** Crea i wrapper delle callable su una `Functions` iniettata (testabile). */
export function createAiCorrectionCallables(functions: Functions): AiCorrectionCallables {
  const previewFn = httpsCallable<AiCorrectionRequest, AiPreviewResult>(
    functions,
    'aiCorrectionPreview',
  );
  const runFn = httpsCallable<AiCorrectionRequest, AiRunResult>(functions, 'aiCorrectionRun');
  return {
    preview: async (req) => (await previewFn(req)).data,
    run: async (req) => (await runFn(req)).data,
  };
}

/** Etichetta leggibile per un codice di esclusione (nessun dato sensibile). */
export function describeExclusion(reason: AiExclusionReason): string {
  switch (reason) {
    case 'not_found':
      return 'Consegna non trovata';
    case 'wrong_owner':
      return 'Non autorizzata';
    case 'wrong_verification':
      return 'Appartiene a un’altra verifica';
    case 'not_submitted':
      return 'Non ancora consegnata';
    case 'snapshot_unavailable':
      return 'Snapshot della verifica non disponibile';
    case 'correction_not_in_progress':
      return 'Correzione già completata o restituita';
    case 'nothing_to_grade':
      return 'Nessuna domanda ancora da valutare';
    case 'too_large':
      return 'Consegna oltre i limiti prudenti';
    case 'changed_since_preview':
      return 'Dati cambiati dopo l’anteprima';
    case 'write_error':
      return 'Errore di scrittura';
    case 'deadline_exceeded':
      return 'Tempo massimo dell’operazione superato';
    case 'rate_limited':
      return 'Servizio IA momentaneamente occupato';
    case 'provider_timeout':
      return 'Timeout del servizio IA';
    case 'provider_unavailable':
      return 'Servizio IA non disponibile';
    case 'retry_after_exceeded':
      return 'Servizio IA occupato: riprova più tardi';
    default:
      return 'Esclusa';
  }
}

/**
 * Messaggio d'errore leggibile per un errore della callable, **senza** esporre
 * dettagli sensibili. Riconosce i codici stabili del gateway.
 */
export function describeAiError(err: unknown): string {
  const code = (err as { code?: string; details?: { code?: string } })?.details?.code;
  const httpsCode = (err as { code?: string })?.code;
  if (code === 'feature_disabled' || httpsCode === 'functions/failed-precondition') {
    return 'La correzione assistita da IA è disattivata.';
  }
  if (code === 'not_owner' || httpsCode === 'functions/permission-denied') {
    return 'Operazione riservata al docente proprietario.';
  }
  if (httpsCode === 'functions/unauthenticated') {
    return 'Sessione scaduta: accedi di nuovo.';
  }
  if (code === 'operation_budget_exceeded') {
    return 'Il costo prudenziale supera il limite consentito per una singola operazione.';
  }
  if (code === 'daily_budget_exceeded') {
    return 'Il budget giornaliero per la correzione IA è esaurito. Riprova domani.';
  }
  if (code === 'budget_exceeded') {
    return 'Il budget mensile per la correzione IA è esaurito.';
  }
  if (code === 'batch_limit_exceeded' || httpsCode === 'functions/resource-exhausted') {
    return 'Troppe consegne selezionate: riduci la selezione.';
  }
  if (code === 'invalid_input' || httpsCode === 'functions/invalid-argument') {
    return 'Selezione non valida. Riprova.';
  }
  return 'Impossibile completare l’operazione di correzione IA. Riprova.';
}
