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

import {
  DEFAULT_PRICE_LIST_VERSION,
  OPENAI_PRODUCTION_MODEL,
  lookupModelPrice,
} from './aiCorrectionCost.js';

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

/** Hard ceiling approvati HG-M5-2/3, non aumentabili via Firestore. */
export const MAX_OPERATION_COST_MICRO_USD = 250_000;
export const MAX_DAILY_BUDGET_MICRO_USD = 1_000_000;
export const MAX_MONTHLY_BUDGET_MICRO_USD = 5_000_000;

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
  /** Limite per singola operazione, positivo e ≤ 0,25 USD. */
  maxOperationCostMicroUsd: number;
  /** Budget giornaliero UTC, positivo e ≤ 1 USD. */
  dailyBudgetMicroUsd: number;
  /** Budget mensile UTC, positivo e ≤ 5 USD. */
  monthlyBudgetMicroUsd: number;
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

function parseLimits(raw: unknown): AiRuntimeLimits | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const maxSubmissionsPerOperation = posInt(r.maxSubmissionsPerOperation, 30);
  const maxOpenQuestionsPerSubmission = posInt(r.maxOpenQuestionsPerSubmission, 20);
  const maxEstimatedTokensPerSubmission = posInt(r.maxEstimatedTokensPerSubmission, 10_000);
  const maxEstimatedTokensPerOperation = posInt(r.maxEstimatedTokensPerOperation, 300_000);
  const maxProviderConcurrency = posInt(r.maxProviderConcurrency, 3);
  const attemptTimeoutMs = posInt(r.attemptTimeoutMs, 60_000);
  // 0 retry è ammesso; 1 è l'hard ceiling DEV.
  const maxApplicationRetries =
    typeof r.maxApplicationRetries === 'number' &&
    Number.isInteger(r.maxApplicationRetries) &&
    r.maxApplicationRetries >= 0 &&
    r.maxApplicationRetries <= 1
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
  // Modello e listino sono una coppia unica e autoritativa. Un alias mobile,
  // un modello non verificato o una versione sconosciuta disabilitano il
  // provider prima di leggere il secret o costruire il transport.
  if (
    r.model !== OPENAI_PRODUCTION_MODEL ||
    r.priceListVersion !== DEFAULT_PRICE_LIST_VERSION ||
    lookupModelPrice(r.priceListVersion, r.model) === null
  ) {
    return null;
  }

  const limits = parseLimits(r.limits);
  if (limits === null) return null;

  const maxOperationCostMicroUsd = posInt(r.maxOperationCostMicroUsd, MAX_OPERATION_COST_MICRO_USD);
  const dailyBudgetMicroUsd = posInt(r.dailyBudgetMicroUsd, MAX_DAILY_BUDGET_MICRO_USD);
  const monthlyBudgetMicroUsd = posInt(r.monthlyBudgetMicroUsd, MAX_MONTHLY_BUDGET_MICRO_USD);
  if (
    maxOperationCostMicroUsd === null ||
    dailyBudgetMicroUsd === null ||
    monthlyBudgetMicroUsd === null
  ) {
    return null;
  }

  return {
    enabled: r.enabled,
    provider: 'openai',
    model: r.model,
    environment: 'dev',
    limits,
    maxOperationCostMicroUsd,
    dailyBudgetMicroUsd,
    monthlyBudgetMicroUsd,
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
