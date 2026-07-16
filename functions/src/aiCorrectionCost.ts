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
  /** USD per 1M token di input. */
  inputPerMillionUsd: number;
  /** USD per 1M token di output. */
  outputPerMillionUsd: number;
}

/**
 * Listini **immutabili** e versionati. Fonte: `documentazione/m5-provider-decision.md`
 * (prezzi di listino rilevati il 16/07/2026, USD). Un nuovo prezzo = nuova
 * versione; una versione non è mai modificata in loco.
 */
export const PRICE_LISTS: Readonly<Record<string, Readonly<Record<string, ModelPrice>>>> = {
  'v1-2026-07-16': {
    'gpt-5-nano': { inputPerMillionUsd: 0.05, outputPerMillionUsd: 0.4 },
    'gpt-5.6-luna': { inputPerMillionUsd: 1.0, outputPerMillionUsd: 6.0 },
    'claude-haiku-4-5-20251001': { inputPerMillionUsd: 1.0, outputPerMillionUsd: 5.0 },
  },
};

/** Versione di listino di default per DEV (deve esistere in `PRICE_LISTS`). */
export const DEFAULT_PRICE_LIST_VERSION = 'v1-2026-07-16';

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
  const raw = inputTokens * price.inputPerMillionUsd + outputTokens * price.outputPerMillionUsd;
  return rounding === 'ceil' ? Math.ceil(raw) : Math.round(raw);
}

/** Converte µUSD interi in USD a 6 decimali (per persistenza/visualizzazione). */
export function microUsdToUsd(microUsd: number): number {
  return Math.round(microUsd) / USD_MICRO;
}
