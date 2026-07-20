/**
 * M5-05D1 — listino prezzi **server-side versionato** e calcolo costi della
 * correzione IA. Nessun valore di prezzo proviene mai dal client.
 *
 * Il denaro è rappresentato in **micro-USD interi** (`1 USD = 1 000 000 µUSD`)
 * per evitare la deriva in virgola mobile su confronti di budget e riconciliazioni.
 * Il costo di un token = `token × prezzoPerMilioneUsd` in µUSD (esatto quando il
 * prezzo è per 1M token). Arrotondamento **documentato**: `ceil` per stime e
 * prenotazioni (prudente, mai sotto-riservare), `nearest` (half-up) per il costo
 * effettivo. Le domande chiuse e la modalità mock non passano di qui: **0 token,
 * 0 costo**.
 */

/** 1 USD in micro-USD. */
export const USD_MICRO = 1_000_000;

export interface ModelPrice {
  /** micro-USD interi per 1M token di input. */
  inputMicroUsdPerMillion: number;
  /** micro-USD interi per 1M token di output. */
  outputMicroUsdPerMillion: number;
}

/** Snapshot storico D1, mantenuto soltanto per compatibilità tecnica dei run. */
export const OPENAI_LEGACY_MODEL = 'gpt-5-nano-2025-08-07';

/** Unico snapshot approvato da HG-M5-1 per la futura configurazione reale. */
export const OPENAI_PRODUCTION_MODEL = 'gpt-5.4-nano-2026-03-17';

/**
 * M5-QUALITY-05 — modello candidato usato **esclusivamente** dalla CLI locale di
 * benchmark per un confronto controllato con il modello di produzione. Non è mai
 * il modello runtime delle Functions, di DEV o di Firestore: non compare in
 * `OPENAI_PRODUCTION_MODEL`, non è persistito e non introduce fallback.
 */
export const OPENAI_BENCHMARK_CANDIDATE_MODEL = 'gpt-5.4-mini-2026-03-17';

/**
 * Fonte ufficiale: https://developers.openai.com/api/docs/models/gpt-5.4-nano
 * Verificata il 2026-07-17. La pagina documenta lo snapshot immutabile,
 * Responses API, Structured Outputs e prezzi standard $0.20/M input,
 * $1.25/M output.
 */
export const OPENAI_PRICE_SOURCE = 'https://developers.openai.com/api/docs/models/gpt-5.4-nano';
export const OPENAI_PRICE_VERIFIED_ON = '2026-07-17';

/**
 * Fonte ufficiale del candidato benchmark:
 * https://developers.openai.com/api/docs/models/gpt-5.4-mini
 * Prezzi standard $0.75/M input, $4.50/M output. Il listino `cached input` non
 * è incluso: il benchmark non lo usa né lo misura, quindi non viene inventato.
 */
export const OPENAI_BENCHMARK_CANDIDATE_PRICE_SOURCE =
  'https://developers.openai.com/api/docs/models/gpt-5.4-mini';
export const OPENAI_BENCHMARK_CANDIDATE_PRICE_VERIFIED_ON = '2026-07-20';

/**
 * Listini production **immutabili** e versionati. Contengono solo coppie
 * OpenAI modello-snapshot/prezzo verificate dalla fonte ufficiale indicata
 * sopra. Un nuovo modello o prezzo richiede una nuova versione: una versione
 * pubblicata non viene mai modificata in loco.
 */
export const PRICE_LISTS: Readonly<Record<string, Readonly<Record<string, ModelPrice>>>> = {
  'v1-2026-07-16': {
    [OPENAI_LEGACY_MODEL]: {
      inputMicroUsdPerMillion: 50_000,
      outputMicroUsdPerMillion: 400_000,
    },
  },
  'v2-2026-07-17-hg-m5': {
    [OPENAI_PRODUCTION_MODEL]: {
      inputMicroUsdPerMillion: 200_000,
      outputMicroUsdPerMillion: 1_250_000,
    },
  },
  // M5-QUALITY-05 — nuova versione dedicata al solo prezzo del candidato
  // benchmark `gpt-5.4-mini`. Una versione pubblicata non viene mai modificata
  // in loco: il candidato riceve la propria versione invece di essere aggiunto a
  // `v2`. $0.75/M input → 750 000 µUSD, $4.50/M output → 4 500 000 µUSD.
  'v3-2026-07-20-mini-benchmark': {
    [OPENAI_BENCHMARK_CANDIDATE_MODEL]: {
      inputMicroUsdPerMillion: 750_000,
      outputMicroUsdPerMillion: 4_500_000,
    },
  },
};

/** Versione di listino di default per DEV (deve esistere in `PRICE_LISTS`). */
export const DEFAULT_PRICE_LIST_VERSION = 'v2-2026-07-17-hg-m5';

/** Versione di listino del candidato benchmark (solo CLI di benchmark). */
export const OPENAI_BENCHMARK_CANDIDATE_PRICE_LIST_VERSION = 'v3-2026-07-20-mini-benchmark';

/** Prezzo del modello per una versione di listino, o `null` se assente. */
export function lookupModelPrice(priceListVersion: string, model: string): ModelPrice | null {
  return PRICE_LISTS[priceListVersion]?.[model] ?? null;
}

/**
 * Costo in **micro-USD interi** di `inputTokens`+`outputTokens` al prezzo dato.
 * `rounding: 'ceil'` per stime/prenotazioni (prudente), `'nearest'` per l'effettivo.
 */
export function tokenCostMicroUsd(
  inputTokens: number,
  outputTokens: number,
  price: ModelPrice,
  rounding: 'ceil' | 'nearest',
): number {
  const numerator =
    inputTokens * price.inputMicroUsdPerMillion + outputTokens * price.outputMicroUsdPerMillion;
  const raw = numerator / 1_000_000;
  return rounding === 'ceil' ? Math.ceil(raw) : Math.round(raw);
}

/** Converte µUSD interi in USD a 6 decimali (per persistenza/visualizzazione). */
export function microUsdToUsd(microUsd: number): number {
  return Math.round(microUsd) / USD_MICRO;
}

// ── M5-05D2B-1 — ripartizione token e costo effettivo/stimato ────────────────

/** Ripartizione token input/output/total. Interi non negativi. */
export interface TokenBreakdown {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

/** Ripartizione token + costo intero in micro-USD. */
export interface CostBreakdown extends TokenBreakdown {
  costMicroUsd: number;
}

/** Costo/token nullo (mock, sole-chiuse, usage assente): mai un costo inventato. */
export const ZERO_COST: Readonly<CostBreakdown> = Object.freeze({
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  costMicroUsd: 0,
});

/** Intero finito e non negativo. */
export function isNonNegativeInteger(value: unknown): value is number {
  return (
    typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value >= 0
  );
}

/**
 * Stima **conservativa** (arrotondamento `ceil`, mai sotto-riservare) del costo
 * in micro-USD per una ripartizione input/output **stimata**, dati `model` e
 * `priceListVersion` validati dalla config runtime. Ritorna `null` se la coppia
 * versione/modello non è nel listino versionato (**fail-closed**: nessun costo
 * inventato). Valori token non validi sono trattati come 0.
 */
export function estimateCostBreakdown(
  inputTokens: number,
  outputTokens: number,
  priceListVersion: string,
  model: string,
): CostBreakdown | null {
  const price = lookupModelPrice(priceListVersion, model);
  if (!price) return null;
  const input = isNonNegativeInteger(inputTokens) ? inputTokens : 0;
  const output = isNonNegativeInteger(outputTokens) ? outputTokens : 0;
  return {
    inputTokens: input,
    outputTokens: output,
    totalTokens: input + output,
    costMicroUsd: tokenCostMicroUsd(input, output, price, 'ceil'),
  };
}

/**
 * Normalizza l'usage **effettivo** riportato dal provider in una ripartizione
 * coerente, o `null` se non è chiaramente esposto/coerente — **nessuna
 * invenzione**. Richiede `inputTokens` e `outputTokens` interi non negativi e,
 * se `tokens` (totale) è presente, che sia **esattamente** la loro somma
 * (coerenza del totale). Usage assente (mock/sole-chiuse) ⇒ `null`.
 */
export function normalizeUsageActual(
  usage: { tokens?: number; inputTokens?: number; outputTokens?: number } | undefined | null,
): TokenBreakdown | null {
  if (!usage) return null;
  const { inputTokens, outputTokens, tokens } = usage;
  if (!isNonNegativeInteger(inputTokens) || !isNonNegativeInteger(outputTokens)) return null;
  const totalTokens = inputTokens + outputTokens;
  if (tokens !== undefined && (!isNonNegativeInteger(tokens) || tokens !== totalTokens))
    return null;
  return { inputTokens, outputTokens, totalTokens };
}

/**
 * Costo **effettivo** (arrotondamento `nearest`) in micro-USD per una
 * ripartizione input/output **aggregata e già validata**, dati `model` e
 * `priceListVersion`. Ritorna `null` se il listino non conosce versione/modello.
 */
export function actualCostMicroUsd(
  inputTokens: number,
  outputTokens: number,
  priceListVersion: string,
  model: string,
): number | null {
  const price = lookupModelPrice(priceListVersion, model);
  if (!price) return null;
  const input = isNonNegativeInteger(inputTokens) ? inputTokens : 0;
  const output = isNonNegativeInteger(outputTokens) ? outputTokens : 0;
  return tokenCostMicroUsd(input, output, price, 'nearest');
}
