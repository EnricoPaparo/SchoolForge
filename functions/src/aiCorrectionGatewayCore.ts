/**
 * M5-01 — logica pura del gateway della correzione assistita da IA, senza
 * dipendenze `firebase-admin`/`firebase-functions`: feature flag, validazione
 * input, interfaccia provider-agnostic `AiGrader` con l'unica implementazione
 * `MockAiGrader` deterministica, autorizzazione owner e handler `preview`/`run`.
 *
 * Ambito M5-01 (vedi `documentazione/m5-ai-assisted-roadmap.md`): il gateway è
 * solo **predisposto**. `aiCorrectionPreview` restituisce un risultato **mock**
 * chiaramente identificato; `aiCorrectionRun` verifica autenticazione, flag,
 * input e `requestId` ma **non scrive alcuna valutazione** e **non tocca
 * Firestore**. Eleggibilità, scoring delle chiuse, valutazione delle aperte,
 * idempotenza persistita e il documento `aiCorrectionRuns/{requestId}`
 * appartengono a M5-02. Costo IA in M5-01: **zero token, nessun provider
 * reale, nessuna chiamata di rete**.
 *
 * Il wiring runtime (`onCall`, Admin SDK) è in `aiCorrectionGateway.ts`.
 */

// ── Errori ────────────────────────────────────────────────────────────────

/**
 * Codici stabili e leggibili. Deliberatamente **non** contengono contenuti
 * sensibili (né domande, risposte, soluzioni, nomi o email). Sono mappati a
 * `HttpsError` nel wiring.
 */
export type AiGatewayErrorCode =
  | 'unauthenticated'
  | 'not_owner'
  | 'feature_disabled'
  | 'invalid_input'
  | 'batch_limit_exceeded';

export class AiGatewayError extends Error {
  readonly code: AiGatewayErrorCode;
  constructor(code: AiGatewayErrorCode, message: string) {
    super(message);
    this.name = 'AiGatewayError';
    this.code = code;
  }
}

// ── Feature flag ────────────────────────────────────────────────────────────

/**
 * Modalità del modulo IA, **esplicita**. Non esiste alcun valore che attivi un
 * provider reale in M5-01: l'unico valore operativo è `'mock'`. Il default è
 * `'disabled'` (sicuro) e **non** esiste un fallback implicito verso un
 * provider reale — quel provider non è nemmeno presente nel codice (arriva in
 * M5-05). La modalità è risolta **solo** da configurazione server-side, mai da
 * input del client.
 */
export type AiFeatureMode = 'disabled' | 'mock';

/**
 * Risolve la modalità dalla configurazione server (variabili d'ambiente della
 * Function). Solo il valore **esatto** `'mock'` abilita la modalità mock;
 * `'disabled'`, l'assenza di valore e **qualsiasi altro valore non
 * riconosciuto** danno `'disabled'` (default sicuro, nessun fallback implicito
 * verso un provider reale). Non c'è alcun valore che selezioni un provider
 * reale: è impossibile, in M5-01, confondere `mock` con un provider reale.
 */
export function resolveAiFeatureMode(env: {
  AI_CORRECTION_MODE?: string | undefined;
}): AiFeatureMode {
  return env.AI_CORRECTION_MODE === 'mock' ? 'mock' : 'disabled';
}

// ── Contratto request/response ──────────────────────────────────────────────

/**
 * Unico payload accettato dal client: **solo ID**. Mai testi di domande,
 * risposte, soluzioni, nomi o email. Il server rilegge tutto il resto
 * server-side (in M5-02).
 */
export interface AiCorrectionRequest {
  verificationId: string;
  submissionIds: string[];
  requestId: string;
}

// Le response di preview/run (contratto pieno M5-02) sono definite in
// `aiCorrectionEngine.ts`, che orchestra eleggibilità, scoring e scritture.

// ── Limiti prudenti (guardie tecniche, non budget definitivi) ────────────────

/**
 * Tetto **prudente** al numero di consegne per singola operazione batch: è una
 * guardia tecnica anti-abuso, **non** il budget definitivo per operazione, che
 * resta un Human Gate (HG-M5-2, vedi la roadmap). Configurabile in futuro.
 */
export const MAX_SUBMISSIONS_PER_OPERATION = 200;

/** Lunghezza massima prudente di un identificatore (Firestore doc id tipici). */
const MAX_ID_LENGTH = 200;

/** ID tecnici: alfanumerici, `_`, `-` (nessun punto, nessuno slash, nessuno spazio). */
const SAFE_ID_RE = /^[A-Za-z0-9_-]+$/;

/** `requestId` client-generato (tipicamente UUID v4); token sicuro, non vuoto. */
const REQUEST_ID_RE = /^[A-Za-z0-9_-]{8,128}$/;

function isSafeId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_ID_LENGTH &&
    SAFE_ID_RE.test(value)
  );
}

/**
 * Validazione rigorosa e **solo di forma** dell'input (nessuna lettura
 * Firestore, nessuna eleggibilità — quella è M5-02). Verifica:
 * - il payload contiene **esclusivamente** `verificationId`, `submissionIds`,
 *   `requestId`: qualunque proprietà aggiuntiva è rifiutata, così il contratto
 *   «il client passa solo ID» è effettivo (nessun testo di domanda, risposta,
 *   soluzione, nome o email può transitare);
 * - `verificationId` e `requestId` ben formati;
 * - `submissionIds` array non vuoto, entro il limite, senza duplicati, ogni id
 *   ben formato e **appartenente** alla verifica (`{verificationId}_{...}`),
 *   così il client non può iniettare id di un'altra verifica.
 * Rifiuta tipi errati, id malformati, duplicati e superamento limite con codici
 * stabili e messaggi non sensibili.
 */
const ALLOWED_REQUEST_KEYS = ['verificationId', 'submissionIds', 'requestId'] as const;

export function validateAiCorrectionRequest(input: unknown): AiCorrectionRequest {
  if (typeof input !== 'object' || input === null) {
    throw new AiGatewayError('invalid_input', 'Payload mancante o non valido.');
  }
  // Payload realmente chiuso: nessuna proprietà oltre ai tre ID ammessi.
  const allowed = new Set<string>(ALLOWED_REQUEST_KEYS);
  for (const key of Object.keys(input as Record<string, unknown>)) {
    if (!allowed.has(key)) {
      throw new AiGatewayError('invalid_input', 'Il payload contiene proprietà non ammesse.');
    }
  }
  const { verificationId, submissionIds, requestId } = input as Record<string, unknown>;

  if (!isSafeId(verificationId)) {
    throw new AiGatewayError('invalid_input', 'verificationId mancante o malformato.');
  }
  if (!isSafeId(requestId) || !REQUEST_ID_RE.test(requestId)) {
    throw new AiGatewayError('invalid_input', 'requestId mancante o malformato.');
  }
  if (!Array.isArray(submissionIds)) {
    throw new AiGatewayError('invalid_input', 'submissionIds deve essere un array.');
  }
  if (submissionIds.length === 0) {
    throw new AiGatewayError('invalid_input', 'submissionIds non può essere vuoto.');
  }
  if (submissionIds.length > MAX_SUBMISSIONS_PER_OPERATION) {
    throw new AiGatewayError(
      'batch_limit_exceeded',
      `Troppe consegne in una sola operazione (max ${MAX_SUBMISSIONS_PER_OPERATION}).`,
    );
  }
  const prefix = `${verificationId}_`;
  const seen = new Set<string>();
  for (const id of submissionIds) {
    if (!isSafeId(id)) {
      throw new AiGatewayError('invalid_input', 'submissionIds contiene un id malformato.');
    }
    if (!id.startsWith(prefix) || id.length <= prefix.length) {
      throw new AiGatewayError(
        'invalid_input',
        'submissionIds contiene un id non appartenente alla verifica indicata.',
      );
    }
    if (seen.has(id)) {
      throw new AiGatewayError('invalid_input', 'submissionIds contiene duplicati.');
    }
    seen.add(id);
  }

  return { verificationId, submissionIds: [...submissionIds], requestId };
}

// ── Autorizzazione owner (per onCall) ────────────────────────────────────────

export interface OwnerAuthDeps {
  /** uid del chiamante autenticato (da `request.auth?.uid`), o `null`. */
  callerUid: string | null;
  /** uid del docente proprietario, letto da `settings/owner` server-side. */
  getOwnerUid: () => Promise<string | null>;
}

/**
 * Autorizza **solo** il docente proprietario. Nessuna fiducia nei dati del
 * client: l'uid arriva dal token verificato da Firebase Auth (`request.auth`),
 * l'owner da `settings/owner` (fonte autoritativa). Stesso principio di
 * `authorizeOwner` del Repository Gateway.
 */
export async function authorizeOwnerCall(deps: OwnerAuthDeps): Promise<string> {
  const uid = deps.callerUid;
  if (!uid) {
    throw new AiGatewayError('unauthenticated', 'Autenticazione richiesta.');
  }
  const ownerUid = await deps.getOwnerUid();
  if (!ownerUid || ownerUid !== uid) {
    throw new AiGatewayError('not_owner', 'Accesso riservato al docente proprietario.');
  }
  return uid;
}

// ── Interfaccia provider-agnostic AiGrader + MockAiGrader ─────────────────────

/** Input chiuso e tipizzato per la valutazione di una domanda aperta. */
export interface AiGraderQuestion {
  order: number;
  maxPoints: number;
  questionText: string;
  referenceSolution: string;
  studentAnswer: string;
}

/**
 * Contesto della consegna per il **feedback generale** (M5-04B): punti già
 * fissati prima della valutazione delle aperte (chiuse deterministiche + domande
 * già valutate) e punteggio massimo totale della consegna. Consente al grader di
 * calcolare il **totale finale** (`priorPoints` + somma dei punti delle aperte)
 * nella **stessa** chiamata, senza una seconda invocazione. Facoltativo: se
 * assente il grader usa `priorPoints = 0` e il massimo delle sole domande
 * ricevute.
 */
export interface AiGraderSubmissionContext {
  priorPoints: number;
  totalMaxPoints: number;
}

export interface AiGraderInput {
  requestId: string;
  questions: AiGraderQuestion[];
  submissionContext?: AiGraderSubmissionContext;
}

/** Output strutturato e tipizzato per una singola domanda. */
export interface AiGraderQuestionResult {
  order: number;
  points: number;
  feedback?: string;
}

export interface AiGraderOutput {
  requestId: string;
  results: AiGraderQuestionResult[];
  /**
   * Feedback **generale** della consegna (M5-04B): motivazione sintetica del
   * punteggio + consiglio concreto (o complimento se il risultato è massimo).
   * Prodotto nella **stessa** chiamata delle aperte, mai in una seconda. Tono
   * professionale, nessun dato personale, ≤ 700 caratteri. Il chiamante lo
   * applica al campo `generalFeedback` della correzione **solo** se la consegna
   * risulta interamente valutata e il docente non ne ha già scritto uno.
   */
  generalFeedback?: string;
  /**
   * Consumo **reale** di token riportato dal provider, se disponibile. Prepara
   * il contratto per un provider reale (M5-05): il chiamante somma questo valore
   * in `tokensActual`. `MockAiGrader` **non** lo popola → in modalità mock
   * `tokensActual` resta **0** (nessun token reale consumato).
   */
  usage?: { tokens: number };
}

/** Lunghezza massima del feedback generale della consegna (M5-04B). */
export const MAX_GENERAL_FEEDBACK_CHARS = 700;

function formatPoints(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, '');
}

/**
 * Costruisce il **feedback generale deterministico** (M5-04B) a partire dai
 * **totali finali** della consegna. Usato sia dal `MockAiGrader` (consegne con
 * aperte) sia dal motore per le consegne con **sole chiuse** (nessuna chiamata
 * al grader): stessa funzione pura → stesso testo a parità di numeri. È marcato
 * `[mock]`, non contiene alcun dato personale (solo numeri), tono professionale
 * e non giudicante, sempre ≤ 700 caratteri. Se il risultato è massimo formula un
 * complimento con un suggerimento di approfondimento; altrimenti motiva il
 * punteggio e propone un passo concreto per colmare le lacune.
 */
export function buildMockGeneralFeedback(totalPoints: number, maxPoints: number): string {
  const pct = maxPoints > 0 ? Math.round((totalPoints / maxPoints) * 100) : 0;
  const score = `${formatPoints(totalPoints)}/${formatPoints(maxPoints)} (${pct}%)`;
  if (maxPoints > 0 && totalPoints >= maxPoints) {
    return `[mock] Risultato pieno: ${score}. La prova mostra piena padronanza degli argomenti richiesti. Per continuare a crescere, puoi approfondire gli stessi temi affrontando esempi più articolati o qualche caso limite.`;
  }
  return `[mock] Punteggio complessivo ${score}. Il risultato riflette una preparazione ancora parziale sugli argomenti della prova. Per colmare le lacune, rivedi i concetti collegati alle domande con punteggio più basso e prova a rifare esercizi analoghi, un passo alla volta.`;
}

/**
 * Valida **server-side** il feedback generale prodotto dal grader senza mai
 * fidarsene: ritorna la stringa valida (non vuota, ≤ {@link
 * MAX_GENERAL_FEEDBACK_CHARS} caratteri) oppure `null`. Quando la consegna ha
 * domande aperte il feedback è **richiesto**: un `null` qui rende invalido
 * l'**intero** output del grader per quella consegna (validazione **atomica**),
 * quindi nessun punteggio e nessun feedback vengono scritti — vedi il motore.
 */
export function validateGeneralFeedback(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  if (value.trim().length === 0) return null;
  if (value.length > MAX_GENERAL_FEEDBACK_CHARS) return null;
  return value;
}

/**
 * Interfaccia **provider-agnostic**: il dominio non conosce il provider. In
 * M5-01 esiste **solo** `MockAiGrader`; gli adapter reali (OpenAI/Anthropic/
 * Gemini) **non** sono introdotti (arrivano in M5-05 dietro Human Gate).
 */
export interface AiGrader {
  /** Identificatore inequivocabile dell'implementazione, es. `'mock'`. */
  readonly id: string;
  grade(input: AiGraderInput): Promise<AiGraderOutput>;
}

/** FNV-1a a 32 bit — hash deterministico e puro, nessuna dipendenza esterna. */
function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    // moltiplicazione FNV in aritmetica a 32 bit senza segno
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/**
 * Implementazione **deterministica** dell'`AiGrader`: nessun accesso a rete,
 * web, retrieval, tool o servizi esterni; nessuna casualità, nessun orologio.
 * A parità di input produce **sempre** lo stesso output. È marcata `id: 'mock'`
 * e non è confondibile con un provider reale.
 *
 * Il punteggio è un multiplo di 0,25 in `[0, maxPoints]` derivato in modo puro
 * dai campi della domanda; il feedback è un marcatore fisso che **non** riporta
 * alcun contenuto dello studente. Questa è la valutazione **simulata** usata
 * per sviluppare e testare l'infrastruttura: lo scoring reale delle chiuse e la
 * valutazione delle aperte sono definiti in M5-02.
 */
export class MockAiGrader implements AiGrader {
  readonly id = 'mock';

  grade(input: AiGraderInput): Promise<AiGraderOutput> {
    const results: AiGraderQuestionResult[] = input.questions.map((q) => {
      const maxQuarters = Math.max(0, Math.round(q.maxPoints * 4));
      const seed = fnv1a(`${q.order}|${q.maxPoints}|${q.questionText}|${q.studentAnswer}`);
      const quarters = maxQuarters === 0 ? 0 : seed % (maxQuarters + 1);
      return {
        order: q.order,
        points: quarters / 4,
        feedback: '[mock] valutazione simulata deterministica (M5)',
      };
    });
    // Feedback generale (M5-04B): totale finale = punti già fissati (chiuse +
    // già valutate, via submissionContext) + punti delle aperte appena valutate.
    // Nessuna seconda chiamata, nessuna rete, nessuna casualità: puro.
    const openPoints = results.reduce((sum, r) => sum + r.points, 0);
    const priorPoints = input.submissionContext?.priorPoints ?? 0;
    const totalMaxPoints =
      input.submissionContext?.totalMaxPoints ??
      input.questions.reduce((sum, q) => sum + q.maxPoints, 0);
    const generalFeedback = buildMockGeneralFeedback(priorPoints + openPoints, totalMaxPoints);
    return Promise.resolve({ requestId: input.requestId, results, generalFeedback });
  }
}

// ── Gate condiviso preview / run ─────────────────────────────────────────────

export interface AiCorrectionAuthDeps extends OwnerAuthDeps {
  featureMode: AiFeatureMode;
}

/**
 * Gate condiviso da `aiCorrectionPreview` e `aiCorrectionRun`. Ordine dei
 * controlli: **autenticazione → owner → feature flag → forma dell'input**.
 * Così un chiamante non autenticato o non owner non apprende nemmeno lo stato
 * del feature flag. Restituisce la request validata (payload realmente chiuso).
 * L'orchestrazione reale (eleggibilità, scoring, scritture, idempotenza) è in
 * `aiCorrectionEngine.ts`.
 */
export async function authorizeAndValidate(
  rawInput: unknown,
  deps: AiCorrectionAuthDeps,
): Promise<AiCorrectionRequest> {
  await authorizeOwnerCall(deps);
  if (deps.featureMode === 'disabled') {
    throw new AiGatewayError('feature_disabled', 'Il modulo di correzione IA è disattivato.');
  }
  return validateAiCorrectionRequest(rawInput);
}
