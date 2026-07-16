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

/** Unico snapshot ammesso dal listino production M5-05D1. */
export const OPENAI_PRODUCTION_MODEL = 'gpt-5-nano-2025-08-07';

/**
 * Fonte ufficiale: https://developers.openai.com/api/docs/models/gpt-5-nano
 * Verificata il 2026-07-16. La pagina documenta sia lo snapshot immutabile sia
 * i prezzi standard di $0.05/M input e $0.40/M output.
 */
export const OPENAI_PRICE_SOURCE = 'https://developers.openai.com/api/docs/models/gpt-5-nano';
export const OPENAI_PRICE_VERIFIED_ON = '2026-07-16';

/**
 * Listini production **immutabili** e versionati. Contengono solo coppie
 * OpenAI modello-snapshot/prezzo verificate dalla fonte ufficiale indicata
 * sopra. Un nuovo modello o prezzo richiede una nuova versione: una versione
 * pubblicata non viene mai modificata in loco.
 */
export const PRICE_LISTS: Readonly<Record<string, Readonly<Record<string, ModelPrice>>>> = {
  'v1-2026-07-16': {
    [OPENAI_PRODUCTION_MODEL]: { inputPerMillionUsd: 0.05, outputPerMillionUsd: 0.4 },
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
