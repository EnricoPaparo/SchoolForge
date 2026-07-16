/**
 * M5-05D1 — configurazione runtime **server-side** della correzione IA
 * (`settings/aiConfig`), letta dall'Admin SDK e **mai** esposta al client.
 *
 * È il **kill switch senza deploy** e la fonte dei limiti/budget approvati per il
 * provider **reale**: `enabled=false`, documento assente, incompleto o invalido
 * ⇒ provider reale **disabilitato** (fail-closed). Non riguarda `mock`: la
 * modalità mock resta selezionata dall'ambiente ed è a costo zero. Questa PR non
 * attiva alcun provider reale: la configurazione è la porta che, in futuro, un
 * responsabile potrà usare per abilitarlo/disabilitarlo a runtime.
 *
 * Modulo **puro**: nessuna dipendenza Firestore. La lettura del documento è una
 * porta iniettata (una `get` puntuale per operazione, nessun listener/polling).
 */

/** Limiti prudenziali DEV applicati server-side nel preflight (M5-05D1 §2). */
export interface AiRuntimeLimits {
  maxSubmissionsPerOperation: number;
  maxOpenQuestionsPerSubmission: number;
  maxEstimatedTokensPerSubmission: number;
  maxEstimatedTokensPerOperation: number;
  maxProviderConcurrency: number;
  attemptTimeoutMs: number;
  maxApplicationRetries: number;
}

export interface AiRuntimeBudget {
  /** Budget mensile in USD (DEV: 5). */
  monthlyUsd: number;
}

/**
 * Documento `settings/aiConfig` validato. `provider` e `environment` sono
 * volutamente ristretti: in M5-05D1 l'unico provider reale previsto è OpenAI su
 * ambiente `dev`. Ogni scostamento è trattato come configurazione **invalida**.
 */
export interface AiRuntimeConfig {
  enabled: boolean;
  provider: 'openai';
  model: string;
  environment: 'dev';
  limits: AiRuntimeLimits;
  budget: AiRuntimeBudget;
  /** Versione della configurazione (governance/audit). */
  configVersion: string;
  /** Versione del listino prezzi usato per la stima costi (deve esistere). */
  priceListVersion: string;
}

const MODEL_ID_RE = /^[A-Za-z0-9._:-]{1,128}$/;
const VERSION_RE = /^[A-Za-z0-9._-]{1,64}$/;

/** Intero finito e strettamente positivo entro un tetto prudente. */
function posInt(value: unknown, max: number): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0 || value > max) {
    return null;
  }
  return value;
}

function positiveFinite(value: unknown, max: number): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > max) {
    return null;
  }
  return value;
}

function parseLimits(raw: unknown): AiRuntimeLimits | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const maxSubmissionsPerOperation = posInt(r.maxSubmissionsPerOperation, 1_000);
  const maxOpenQuestionsPerSubmission = posInt(r.maxOpenQuestionsPerSubmission, 200);
  const maxEstimatedTokensPerSubmission = posInt(r.maxEstimatedTokensPerSubmission, 1_000_000);
  const maxEstimatedTokensPerOperation = posInt(r.maxEstimatedTokensPerOperation, 50_000_000);
  const maxProviderConcurrency = posInt(r.maxProviderConcurrency, 20);
  const attemptTimeoutMs = posInt(r.attemptTimeoutMs, 120_000);
  // 0 retry è ammesso; il tetto è basso per sicurezza costi.
  const maxApplicationRetries =
    typeof r.maxApplicationRetries === 'number' &&
    Number.isInteger(r.maxApplicationRetries) &&
    r.maxApplicationRetries >= 0 &&
    r.maxApplicationRetries <= 3
      ? r.maxApplicationRetries
      : null;
  if (
    maxSubmissionsPerOperation === null ||
    maxOpenQuestionsPerSubmission === null ||
    maxEstimatedTokensPerSubmission === null ||
    maxEstimatedTokensPerOperation === null ||
    maxProviderConcurrency === null ||
    attemptTimeoutMs === null ||
    maxApplicationRetries === null
  ) {
    return null;
  }
  return {
    maxSubmissionsPerOperation,
    maxOpenQuestionsPerSubmission,
    maxEstimatedTokensPerSubmission,
    maxEstimatedTokensPerOperation,
    maxProviderConcurrency,
    attemptTimeoutMs,
    maxApplicationRetries,
  };
}

/**
 * Parsing **fail-closed** del documento `settings/aiConfig`. Ritorna la
 * configurazione validata **solo** se ogni campo è presente e coerente;
 * altrimenti `null` (⇒ provider reale disabilitato). Non lancia mai: l'assenza o
 * la malformazione non deve poter attivare accidentalmente il provider.
 */
export function parseAiRuntimeConfig(raw: unknown): AiRuntimeConfig | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;

  if (typeof r.enabled !== 'boolean') return null;
  if (r.provider !== 'openai') return null;
  if (r.environment !== 'dev') return null;
  if (typeof r.model !== 'string' || !MODEL_ID_RE.test(r.model)) return null;
  if (typeof r.configVersion !== 'string' || !VERSION_RE.test(r.configVersion)) return null;
  if (typeof r.priceListVersion !== 'string' || !VERSION_RE.test(r.priceListVersion)) return null;

  const limits = parseLimits(r.limits);
  if (limits === null) return null;

  if (typeof r.budget !== 'object' || r.budget === null) return null;
  const monthlyUsd = positiveFinite((r.budget as Record<string, unknown>).monthlyUsd, 10_000);
  if (monthlyUsd === null) return null;

  return {
    enabled: r.enabled,
    provider: 'openai',
    model: r.model,
    environment: 'dev',
    limits,
    budget: { monthlyUsd },
    configVersion: r.configVersion,
    priceListVersion: r.priceListVersion,
  };
}

/**
 * `true` **solo** se il provider reale è attivabile ora: config valida **e**
 * `enabled=true`. Qualsiasi altro caso (assente/invalida/`enabled=false`) è
 * fail-closed. Kill switch immediato: basta `enabled=false` per bloccare
 * preview/run del provider reale, senza deploy.
 */
export function isRealProviderEnabled(config: AiRuntimeConfig | null): config is AiRuntimeConfig {
  return config !== null && config.enabled === true;
}
