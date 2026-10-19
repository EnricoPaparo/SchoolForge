import { httpsCallable } from 'firebase/functions';
import type { Functions } from 'firebase/functions';

/**
 * M5-03 — client tipizzato delle callable del gateway IA
 * (`aiCorrectionPreview`/`aiCorrectionRun`, motore M5-02, modalità mock o
 * provider OpenAI reale selezionato esclusivamente lato server).
 *
 * Il client invia ID tecnici e l'eventuale breve indicazione pedagogica di
 * batch: mai testi di domande, risposte, soluzioni, nomi o email. Le
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
  | 'invalid_variant'
  // M5-05D2B-2 — esiti tecnici del provider reale (retry/deadline).
  | 'deadline_exceeded'
  | 'rate_limited'
  | 'provider_timeout'
  | 'provider_unavailable'
  | 'retry_after_exceeded'
  | 'submission_questions_exceeded'
  | 'submission_tokens_exceeded'
  | 'operation_tokens_exceeded'
  | 'operation_budget_exceeded';

export type AiRunStatus = 'running' | 'completed' | 'partial' | 'failed';

/**
 * M5-QUALITY-01 — stile di valutazione. Sposta il punteggio solo entro la fascia
 * già giustificata dalle evidenze; `balanced` è il default a ogni operazione.
 */
export type GradingMode = 'compassionate' | 'balanced' | 'rigorous';

export const DEFAULT_GRADING_MODE: GradingMode = 'balanced';

/** Etichette + descrizioni dinamiche mostrate nel dialog (ordine di presentazione). */
export const GRADING_MODE_OPTIONS: readonly {
  value: GradingMode;
  label: string;
  description: string;
}[] = [
  {
    value: 'compassionate',
    label: 'Comprensivo',
    description:
      'Valorizza la comprensione sostanziale e tollera imprecisioni non determinanti, collocando il punteggio nella parte alta ancora giustificata dalle evidenze. Non assegna punti non sostenuti dalla risposta.',
  },
  {
    value: 'balanced',
    label: 'Equilibrato',
    description:
      'Valutazione ordinaria: bilancia correttezza, completezza e chiarezza. È il comportamento predefinito.',
  },
  {
    value: 'rigorous',
    label: 'Rigoroso',
    description:
      'Richiede più nettamente gli elementi domandati e penalizza più chiaramente omissioni e imprecisioni, nella parte bassa ancora giustificata dalle evidenze. Non diventa arbitrariamente punitivo.',
  },
];

/** Descrizione dinamica dello stile selezionato. */
export function gradingModeDescription(mode: GradingMode): string {
  return GRADING_MODE_OPTIONS.find((option) => option.value === mode)!.description;
}

/**
 * TWU-02 — profilo modello **chiuso**. Il client sceglie solo `economy`/`quality`
 * e **mai** un model ID o un listino: la risoluzione profilo → modello/listino è
 * esclusivamente server-side. `economy` (GPT-6 Luna) è il default; Quality seleziona GPT-6 Sol.
 */
export type ModelProfile = 'economy' | 'quality';

export const DEFAULT_MODEL_PROFILE: ModelProfile = 'economy';

/**
 * Opzioni mostrate nel dialog. `modelId` è il **nome tecnico** del modello
 * server-side, mostrato in piccolo sotto l'etichetta a puro scopo informativo:
 * non è un prezzo e non viene mai inviato nel payload.
 */
export const MODEL_PROFILE_OPTIONS: readonly {
  value: ModelProfile;
  label: string;
  modelId: string;
  description: string;
}[] = [
  {
    value: 'economy',
    label: 'Economico',
    modelId: 'gpt-6-luna',
    description: 'Costo inferiore.',
  },
  {
    value: 'quality',
    label: 'Qualità',
    modelId: 'gpt-6.1-sol',
    description: 'Feedback più approfonditi, costo maggiore.',
  },
];

/** Descrizione dinamica del profilo selezionato. */
export function modelProfileDescription(profile: ModelProfile): string {
  return MODEL_PROFILE_OPTIONS.find((option) => option.value === profile)!.description;
}

export interface AiCorrectionRequest {
  verificationId: string;
  submissionIds: string[];
  requestId: string;
  gradingMode: GradingMode;
  teacherGuidance?: string;
  /** TWU-02 — profilo modello chiuso; il server risolve modello/listino. */
  modelProfile?: ModelProfile;
  advancedReview?: boolean;
}

export const MAX_TEACHER_GUIDANCE_CHARS = 500;

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
  mode: 'mock' | 'openai';
  phase: 'preview';
  maximumCostMicroUsd?: number;
  advancedReview?: boolean;
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
  retry?: { unknownBillingAttempts: number };
  mode: 'mock' | 'openai';
  phase: 'run';
  requestId: string;
  verificationId: string;
  status: AiRunStatus;
  idempotentReplay: boolean;
  counts: AiPreviewCounts & { succeeded: number; partial: number; failed: number };
  tokensEstimated: number;
  tokensActual: number;
  costActual: number;
  costReservationMicroUsd?: number;
  costSettledMicroUsd?: number;
  results: AiRunSubmissionResult[];
}

export interface AiCorrectionCallables {
  preview: (req: AiCorrectionRequest) => Promise<AiPreviewResult>;
  run: (req: AiCorrectionRequest) => Promise<AiRunResult>;
  planPreview?: (req: AiCorrectionRequest) => Promise<AiCorrectionPlanView>;
  planStatus?: (req: {
    verificationId: string;
    planId?: string;
  }) => Promise<AiCorrectionPlanView | null>;
  planRunGroup?: (req: AiPlanGroupAction) => Promise<AiCorrectionPlanView>;
}

export interface AiPlanGroupAction {
  verificationId: string;
  planId: string;
  groupIndex: number;
  maximumCostMicroUsd: number;
  groupMaximumCostMicroUsd: number;
}
export interface AiCorrectionPlanView {
  settings: Pick<
    AiCorrectionRequest,
    'modelProfile' | 'gradingMode' | 'teacherGuidance' | 'advancedReview'
  >;
  planId: string;
  verificationId: string;
  expiresAtMs: number;
  preview: AiPreviewResult;
  consented: boolean;
  budget?: {
    reason: 'daily_budget_exceeded' | 'budget_exceeded';
    availableMicroUsd: number;
    compatibleSubmissionIds: string[];
  };
  groups: {
    requestId: string;
    submissionIds: string[];
    maximumCostMicroUsd: number;
    state: 'pending' | 'running' | 'completed' | 'blocked';
    errorCode?: string;
    result?: AiRunResult;
  }[];
}

/** Nuovo `requestId` client-side (idempotenza server-side su `aiCorrectionRuns`). */
export function newRequestId(): string {
  return crypto.randomUUID();
}

/** Costruisce il payload chiuso con ID, stile di valutazione e indicazione facoltativa. */
export function buildRequest(
  verificationId: string,
  submissionIds: string[],
  requestId: string,
  gradingMode: GradingMode,
  teacherGuidance?: string,
  modelProfile?: ModelProfile,
  advancedReview = true,
): AiCorrectionRequest {
  const normalizedGuidance = teacherGuidance?.trim();
  return {
    verificationId,
    submissionIds: [...submissionIds],
    requestId,
    gradingMode,
    advancedReview,
    ...(normalizedGuidance ? { teacherGuidance: normalizedGuidance } : {}),
    ...(modelProfile ? { modelProfile } : {}),
  };
}

/** Crea i wrapper delle callable su una `Functions` iniettata (testabile). */
export function createAiCorrectionCallables(functions: Functions): AiCorrectionCallables {
  const previewFn = httpsCallable<AiCorrectionRequest, AiPreviewResult>(
    functions,
    'aiCorrectionPreview',
  );
  const runFn = httpsCallable<AiCorrectionRequest, AiRunResult>(functions, 'aiCorrectionRun');
  const planPreview = httpsCallable<AiCorrectionRequest, AiCorrectionPlanView>(
    functions,
    'aiCorrectionPlanPreview',
    { timeout: 540000 },
  );
  const planStatus = httpsCallable<
    { verificationId: string; planId?: string },
    AiCorrectionPlanView | null
  >(functions, 'aiCorrectionPlanStatus');
  const planRunGroup = httpsCallable<AiPlanGroupAction, AiCorrectionPlanView>(
    functions,
    'aiCorrectionPlanRunGroup',
    { timeout: 540000 },
  );
  return {
    preview: async (req) => (await previewFn(req)).data,
    run: async (req) => (await runFn(req)).data,
    planPreview: async (req) => (await planPreview(req)).data,
    planStatus: async (req) => (await planStatus(req)).data,
    planRunGroup: async (req) => (await planRunGroup(req)).data,
  };
}

/** Etichetta leggibile per un codice di esclusione (nessun dato sensibile). */
export function describeExclusion(reason: AiExclusionReason): string {
  switch (reason) {
    case 'submission_questions_exceeded':
      return 'La singola consegna supera il limite di domande aperte';
    case 'submission_tokens_exceeded':
      return 'La singola consegna supera il limite di token stimati';
    case 'operation_tokens_exceeded':
      return 'La singola consegna supera il limite di token per gruppo';
    case 'operation_budget_exceeded':
      return 'La singola consegna supera il costo massimo per operazione';
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
    case 'invalid_variant':
      return 'Variante assegnata non valida';
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
  if (code === 'plan_changed')
    return 'Dati o limiti cambiati: calcola una nuova anteprima e conferma le consegne rimanenti.';
  if (code === 'plan_ambiguous')
    return 'Un gruppo ha un esito ancora incerto. Nessuna nuova correzione è stata avviata: riprendi più tardi per recuperare l’esito.';
  if (code === 'submission_count_exceeded')
    return 'Il gruppo supera il numero massimo di consegne consentito.';
  if (code === 'submission_questions_exceeded')
    return 'Una consegna supera il limite di domande aperte: riduci le domande della singola consegna.';
  if (code === 'submission_tokens_exceeded')
    return 'Una consegna supera il limite di token stimati: il testo della singola consegna è troppo lungo.';
  if (code === 'operation_tokens_exceeded')
    return 'Il gruppo supera il limite di token stimati per operazione.';
  if (code === 'limit_exceeded')
    return 'La selezione supera un limite operativo della correzione IA.';
  if (code === 'provider_config_invalid') return 'Configurazione del servizio IA non disponibile.';
  if (code === 'feature_disabled' || (!code && httpsCode === 'functions/failed-precondition')) {
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
  if (code === 'batch_limit_exceeded') {
    return 'Troppe consegne selezionate: riduci la selezione.';
  }
  if (httpsCode === 'functions/resource-exhausted')
    return 'Un limite operativo o di budget impedisce la correzione IA. Ricalcola l’anteprima.';
  if (code === 'invalid_input' || httpsCode === 'functions/invalid-argument') {
    return 'Selezione non valida. Riprova.';
  }
  return 'Impossibile completare l’operazione di correzione IA. Riprova.';
}
