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

/** Profilo astratto condiviso dalle UI di lezione e mappa concettuale. */
export type PoolModelProfile = 'economy' | 'quality';

export const DEFAULT_POOL_MODEL_PROFILE: PoolModelProfile = 'quality';

/**
 * POOL-ROLLOUT-01 — unico profilo qualificato per la generazione dei pool.
 * La costante è distinta dall'enum condiviso: lezioni e mappe concettuali
 * continuano a poter rappresentare entrambi i profili.
 */
export const AI_POOL_GENERATION_PROFILE = 'quality' as const;

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
  modelProfile: typeof AI_POOL_GENERATION_PROFILE;
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
    modelProfile: AI_POOL_GENERATION_PROFILE,
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
    case 'output_incomplete':
      return 'La generazione si è interrotta prima di completare il risultato. Riprova.';
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

// ─── AIGEN-03 — generazione bozza **lezione** (kind: 'lesson') ────────────────

/** Profondità della bozza (mappa 1:1 sul `depth` del payload backend AIGEN-01). */
export type LessonDepth = 'synthetic' | 'complete' | 'in_depth';

export const DEFAULT_LESSON_DEPTH: LessonDepth = 'complete';

export const LESSON_DEPTH_OPTIONS: readonly {
  value: LessonDepth;
  label: string;
  description: string;
}[] = [
  { value: 'synthetic', label: 'Sintetica', description: 'Bozza concisa, essenziale.' },
  { value: 'complete', label: 'Completa', description: 'Copertura equilibrata dell’argomento.' },
  { value: 'in_depth', label: 'Approfondita', description: 'Trattazione estesa e dettagliata.' },
];

/** Payload chiuso `kind: 'lesson'` (stesso contratto congelato lato backend). */
/**
 * AIGEN-CONTEXT-01 — voce dell'indice compatto dell'UDA inviata al server.
 * **Solo** posizione e titolazione: nessun `lessonId`/`udaId`/`filename`/
 * `storageRef`/`publicLessonId`, nessun corpo, pool, concetto o obiettivo delle
 * altre lezioni, nessun dato studente.
 */
export interface LessonUdaOutlineItem {
  /** Posizione deterministica 1-based nell'ordine canonico dell'UDA. */
  position: number;
  titolo: string;
  sottotitolo: string | null;
}

export interface LessonUdaContext {
  title: string;
  /**
   * STRUCTURE-IMPORT-03 — contesto generale dell'UDA, con i nomi canonici
   * italiani di `UdaDoc`. `null` quando l'UDA non ha descrizione; liste vuote
   * per le UDA legacy prive di competenze o obiettivi. Il server rivalida in
   * modo autorevole.
   */
  descrizione: string | null;
  competenze: string[];
  obiettivi: string[];
  /** Posizione (1-based) della lezione corrente dentro `lessons`. */
  currentLessonPosition: number;
  lessons: LessonUdaOutlineItem[];
}

export interface AiLessonContentRequest {
  kind: 'lesson';
  requestId: string;
  modelProfile: PoolModelProfile;
  teacherGuidance?: string;
  depth: LessonDepth;
  /** Metadati obbligatori (il server li rivalida in modo autorevole). */
  titolo: string;
  /** Facoltativo: la sua assenza non blocca la generazione. */
  sottotitolo?: string;
  difficolta: string;
  udaTitle: string;
  concettiChiave: string[];
  obiettivi: string[];
  udaContext: LessonUdaContext;
  currentBody?: string;
  hasCurrentContent: boolean;
}

export interface AiLessonPreviewResult {
  kind: 'lesson';
  modelProfile: string;
  estimatedInputTokens: number;
  maxOutputTokens: number;
  estimatedCostMicroUsd: number;
  reservationCostMicroUsd: number;
  requestedTotal: number | null;
}

export interface AiLessonProposalOutput {
  body: string;
}

export interface AiLessonGenerateResult {
  status: 'completed';
  kind: 'lesson';
  modelProfile: string;
  output: AiLessonProposalOutput;
  actualCostMicroUsd: number | null;
  replayed: boolean;
}

export interface AiLessonCallables {
  preview: (req: AiLessonContentRequest) => Promise<AiLessonPreviewResult>;
  generate: (req: AiLessonContentRequest) => Promise<AiLessonGenerateResult>;
}

/**
 * Contesto della lezione **già disponibile in memoria** (nessuna nuova query
 * Firestore/Storage). Testo e indicazioni sono materiale non attendibile: nessun
 * prompt è costruito nel client.
 */
export interface LessonAiContext {
  titolo?: string | null;
  sottotitolo?: string | null;
  difficolta?: string | null;
  udaTitle?: string | null;
  concettiChiave?: string[];
  obiettivi?: string[];
  /** Indice compatto dell'UDA, costruito dall'albero già in memoria. */
  udaContext?: LessonUdaContext | null;
  currentBody: string;
}

/**
 * AIGEN-CONTEXT-01 — campi obbligatori per poter generare una lezione. Il
 * sottotitolo resta facoltativo; il corpo attuale non è mai un requisito.
 */
export const LESSON_REQUIRED_FIELD_LABELS = {
  titolo: 'titolo',
  difficolta: 'difficoltà',
  concettiChiave: 'concetti chiave',
  obiettivi: 'obiettivi',
  udaTitle: 'titolo UDA',
  udaContext: 'indice della UDA',
} as const;

export type LessonRequiredField = keyof typeof LESSON_REQUIRED_FIELD_LABELS;

/**
 * Preflight **puro** del contratto didattico: elenca i campi mancanti senza
 * inventare valori né applicare fallback. È solo UX — il server rivalida in modo
 * autorevole — ma evita callable, prenotazione budget, provider, run e costo
 * quando i metadati non sono completi.
 */
export function missingLessonRequirements(context: LessonAiContext): LessonRequiredField[] {
  const missing: LessonRequiredField[] = [];
  if (!context.titolo?.trim()) missing.push('titolo');
  if (!context.difficolta?.trim()) missing.push('difficolta');
  if (!(context.concettiChiave ?? []).some((c) => c.trim().length > 0)) {
    missing.push('concettiChiave');
  }
  if (!(context.obiettivi ?? []).some((o) => o.trim().length > 0)) missing.push('obiettivi');
  if (!context.udaTitle?.trim()) missing.push('udaTitle');
  if (!isCoherentUdaContext(context.udaContext)) missing.push('udaContext');
  return missing;
}

/**
 * Coerenza dell'indice UDA: non vuoto, posizioni 1-based consecutive, titoli non
 * vuoti e `currentLessonPosition` dentro l'intervallo. Stesse regole che il
 * server applica fail-closed.
 */
function isCoherentUdaContext(uda: LessonUdaContext | null | undefined): boolean {
  if (!uda || !uda.title.trim() || !Array.isArray(uda.lessons) || uda.lessons.length === 0) {
    return false;
  }
  const positionsOk = uda.lessons.every(
    (l, i) => l.position === i + 1 && l.titolo.trim().length > 0,
  );
  return (
    positionsOk &&
    Number.isInteger(uda.currentLessonPosition) &&
    uda.currentLessonPosition >= 1 &&
    uda.currentLessonPosition <= uda.lessons.length
  );
}

/**
 * Costruisce il payload chiuso `kind: 'lesson'` **normalizzato**. Guidance e
 * sottotitolo vuoti sono omessi (trim); `hasCurrentContent` è derivato dal corpo
 * attuale. Non invia mai model ID/listino/budget/API key/prompt/ownerUid, né ID
 * tecnici delle lezioni dell'indice.
 *
 * I metadati obbligatori sono richiesti dal tipo: chiama prima
 * `missingLessonRequirements` (il dialog lo fa nel preflight).
 */
export function buildLessonContentRequest(params: {
  requestId: string;
  modelProfile: PoolModelProfile;
  depth: LessonDepth;
  context: LessonAiContext;
  teacherGuidance?: string;
}): AiLessonContentRequest {
  const { context } = params;
  const missing = missingLessonRequirements(context);
  if (missing.length > 0) {
    // Fail-closed anche nel client: nessun payload parziale può partire.
    throw new Error(
      `Metadati della lezione incompleti: ${missing
        .map((f) => LESSON_REQUIRED_FIELD_LABELS[f])
        .join(', ')}.`,
    );
  }
  const guidance = params.teacherGuidance?.trim();
  const sottotitolo = context.sottotitolo?.trim();
  const concettiChiave = (context.concettiChiave ?? [])
    .map((c) => c.trim())
    .filter((c) => c.length > 0);
  const obiettivi = (context.obiettivi ?? []).map((o) => o.trim()).filter((o) => o.length > 0);
  const uda = context.udaContext!;
  const currentBody = context.currentBody;
  const hasCurrentContent = currentBody.trim().length > 0;
  return {
    kind: 'lesson',
    requestId: params.requestId,
    modelProfile: params.modelProfile,
    depth: params.depth,
    hasCurrentContent,
    titolo: context.titolo!.trim(),
    difficolta: context.difficolta!.trim(),
    udaTitle: context.udaTitle!.trim(),
    concettiChiave,
    obiettivi,
    udaContext: {
      title: uda.title.trim(),
      // STRUCTURE-IMPORT-03 — contesto generale dell'UDA: già normalizzato al
      // confine di mapping (`buildLessonUdaContext`), qui solo trasportato.
      descrizione: uda.descrizione,
      competenze: uda.competenze,
      obiettivi: uda.obiettivi,
      currentLessonPosition: uda.currentLessonPosition,
      // Solo posizione/titolo/sottotitolo: nessun campo tecnico trasferito.
      lessons: uda.lessons.map((l) => ({
        position: l.position,
        titolo: l.titolo.trim(),
        sottotitolo: l.sottotitolo?.trim() ? l.sottotitolo.trim() : null,
      })),
    },
    ...(guidance ? { teacherGuidance: guidance } : {}),
    ...(sottotitolo ? { sottotitolo } : {}),
    ...(hasCurrentContent ? { currentBody } : {}),
  };
}

/** Crea i wrapper delle callable lezione su una `Functions` iniettata (testabile). */
export function createAiLessonCallables(functions: Functions): AiLessonCallables {
  const previewFn = httpsCallable<AiLessonContentRequest, AiLessonPreviewResult>(
    functions,
    'aiContentPreview',
  );
  const generateFn = httpsCallable<AiLessonContentRequest, AiLessonGenerateResult>(
    functions,
    'aiContentGenerate',
  );
  return {
    preview: async (req) => (await previewFn(req)).data,
    generate: async (req) => (await generateFn(req)).data,
  };
}
