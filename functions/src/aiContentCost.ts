/**
 * AIGEN-01 — stima **conservativa** di token e costo per la generazione di
 * contenuti, riusando il listino versionato e la formula di `aiCorrectionCost`.
 * Puro: nessuna rete, nessun costo reale. La preview usa esattamente questa
 * stima; il run la usa come tetto di prenotazione (arrotondamento `ceil`).
 */

import { estimateCostBreakdown, type CostBreakdown } from './aiCorrectionCost.js';
import { AiContentError, type AiContentRequest, type LessonDepth } from './aiContentCore.js';

/** Euristica prudente: ~4 caratteri per token, con overhead di prompt fisso. */
const CHARS_PER_TOKEN = 4;
const PROMPT_OVERHEAD_TOKENS = 900;
/** Token di output massimi attesi per singola domanda (testo+opzioni+soluzione). */
const OUTPUT_TOKENS_PER_QUESTION = 220;
/** Token di output massimi per profondità lezione. */
const LESSON_OUTPUT_TOKENS: Readonly<Record<LessonDepth, number>> = {
  synthetic: 1_200,
  complete: 3_500,
  in_depth: 6_000,
};

function estimateInputTokens(chars: number): number {
  return Math.ceil(chars / CHARS_PER_TOKEN) + PROMPT_OVERHEAD_TOKENS;
}

export interface ContentCostEstimate {
  estimatedInputTokens: number;
  maxOutputTokens: number;
  breakdown: CostBreakdown;
}

/**
 * Stima input/output/costo per una richiesta validata, dati modello e listino
 * risolti server-side. Fail-closed (`provider_config_invalid`) se la coppia
 * modello/listino non è nel listino versionato — nessun costo inventato.
 */
export function estimateContentCost(
  request: AiContentRequest,
  model: string,
  priceListVersion: string,
): ContentCostEstimate {
  let inputChars: number;
  let maxOutputTokens: number;
  if (request.kind === 'pool') {
    const total =
      request.counts.aperta + request.counts.chiusa_singola + request.counts.chiusa_multipla;
    inputChars = request.lessonSource.length + (request.teacherGuidance?.length ?? 0);
    maxOutputTokens = total * OUTPUT_TOKENS_PER_QUESTION;
  } else {
    inputChars =
      request.currentBody.length +
      (request.teacherGuidance?.length ?? 0) +
      request.concettiChiave.join('').length +
      request.obiettivi.join('').length;
    maxOutputTokens = LESSON_OUTPUT_TOKENS[request.depth];
  }
  const estimatedInputTokens = estimateInputTokens(inputChars);
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
  return { estimatedInputTokens, maxOutputTokens, breakdown };
}
