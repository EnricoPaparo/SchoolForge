/**
 * AIGEN-01 — stima **informativa** e prenotazione **conservativa** di token e
 * costo, riusando il listino versionato e la formula di `aiCorrectionCost`.
 * Puro: nessuna rete, nessun costo reale.
 *
 * Due valori **distinti** (AIGEN-01-REVIEW-FIX §4):
 * - la **stima** (`estimatedInputTokens`/`estimatedCostMicroUsd`) è quella
 *   mostrata dalla UI: euristica realistica caratteri/token;
 * - la **prenotazione** (`reservation*`) è il tetto prudente prenotato dal ledger:
 *   input = byte UTF-8 dell'**esatto** payload serializzato, output = hard
 *   `max_output_tokens` realmente trasmesso, moltiplicato per il **massimo numero
 *   di tentativi** consentiti (retry inclusi). Vale sempre
 *   `actual ≤ settled ≤ reservation`.
 */

import {
  estimateCostBreakdown,
  tokenCostMicroUsd,
  lookupModelPrice,
  type CostBreakdown,
} from './aiCorrectionCost.js';
import { AiContentError, type AiContentRequest } from './aiContentCore.js';
import {
  estimateInputTokens,
  resolveMaxOutputTokens,
  reservationInputTokenUpperBound,
} from './aiContentPayload.js';

export interface ContentCostEstimate {
  /** Stima informativa (UI). */
  estimatedInputTokens: number;
  estimatedCostMicroUsd: number;
  /** Hard `max_output_tokens` realmente trasmesso al provider. */
  maxOutputTokens: number;
  /** Tetto prudente dei token di input (byte UTF-8 dell'esatto payload). */
  reservationInputTokenUpperBound: number;
  /** Token di output prenotati = hard `max_output_tokens`. */
  reservationOutputTokens: number;
  /** Costo prenotato: ceil(input_ub + output) × maxAttempts. */
  reservationCostMicroUsd: number;
  /** Ripartizione della sola stima informativa. */
  breakdown: CostBreakdown;
}

/**
 * Calcola stima informativa e prenotazione conservativa per una richiesta
 * validata, dati modello, listino e numero **massimo di tentativi** risolti
 * server-side. Fail-closed (`provider_config_invalid`) se la coppia
 * modello/listino non è nel listino versionato — nessun costo inventato.
 */
export function estimateContentCost(
  request: AiContentRequest,
  model: string,
  priceListVersion: string,
  maxAttempts: number,
): ContentCostEstimate {
  const price = lookupModelPrice(priceListVersion, model);
  if (!price) {
    throw new AiContentError(
      'provider_config_invalid',
      'Configurazione modello/listino non disponibile.',
    );
  }
  const maxOutputTokens = resolveMaxOutputTokens(request);

  // Stima informativa (UI): euristica caratteri/token, mai sotto-riservare (ceil).
  const estimatedInputTokens = estimateInputTokens(request);
  const breakdown = estimateCostBreakdown(
    estimatedInputTokens,
    maxOutputTokens,
    priceListVersion,
    model,
  );
  if (!breakdown) {
    throw new AiContentError(
      'provider_config_invalid',
      'Configurazione modello/listino non disponibile.',
    );
  }

  // Prenotazione conservativa: input = byte UTF-8 dell'esatto payload, output =
  // hard cap, × numero massimo di tentativi (il provider può essere invocato più
  // volte in caso di retry). ceil → mai sotto-riservare.
  const inputUpperBound = reservationInputTokenUpperBound(request, model);
  const attempts = Math.max(1, Math.floor(maxAttempts));
  const perAttemptMicroUsd = tokenCostMicroUsd(inputUpperBound, maxOutputTokens, price, 'ceil');
  const reservationCostMicroUsd = perAttemptMicroUsd * attempts;

  return {
    estimatedInputTokens,
    estimatedCostMicroUsd: breakdown.costMicroUsd,
    maxOutputTokens,
    reservationInputTokenUpperBound: inputUpperBound,
    reservationOutputTokens: maxOutputTokens,
    reservationCostMicroUsd,
    breakdown,
  };
}
