import { httpsCallable } from 'firebase/functions';
import type { Functions } from 'firebase/functions';
import { isValidConceptMap } from '../programs/conceptMapContract.js';
import type { PoolModelProfile } from './aiContentClient.js';

/**
 * CONCEPT-MAP-03 — client tipizzato delle **stesse** callable
 * `aiContentPreview`/`aiContentGenerate` per il terzo kind `concept_map`.
 *
 * Non è un secondo sistema: error mapping (`describeAiContentError`), formato
 * dei costi (`formatMicroUsd`) e generazione della `requestId` (`newRequestId`)
 * restano quelli di `aiContentClient`. Qui vivono soltanto il payload chiuso e i
 * tipi del risultato, perché il contratto di questo kind è diverso dagli altri
 * due — ed è diverso in meno, non in più.
 *
 * Il payload è deliberatamente **povero**: profilo e corpo della lezione.
 * Nessuna profondità, indicazione docente, model ID o listino.
 *
 * Il profilo è una scelta esplicita della singola generazione, esattamente come
 * per pool e lezione. Il dialog parte da Quality ma non conserva scelte
 * invisibili fra un'apertura e l'altra.
 */

/** Payload chiuso, identico per preview e generate. */
export interface AiConceptMapRequest {
  kind: 'concept_map';
  requestId: string;
  modelProfile: PoolModelProfile;
  lessonBody: string;
}

export interface AiConceptMapPreviewResult {
  kind: 'concept_map';
  modelProfile: string;
  estimatedInputTokens: number;
  maxOutputTokens: number;
  estimatedCostMicroUsd: number;
  reservationCostMicroUsd: number;
  requestedTotal: number | null;
}

/**
 * Output del run: il **Markdown canonico già composto dal server**, non i tre
 * campi grezzi (CONCEPT-MAP-01). Il client non compone e non ricompone nulla.
 */
export interface AiConceptMapOutput {
  conceptMapMarkdown: string;
}

export interface AiConceptMapGenerateResult {
  status: 'completed';
  kind: 'concept_map';
  modelProfile: string;
  output: AiConceptMapOutput;
  actualCostMicroUsd: number | null;
  replayed: boolean;
}

export interface AiConceptMapCallables {
  preview: (req: AiConceptMapRequest) => Promise<AiConceptMapPreviewResult>;
  generate: (req: AiConceptMapRequest) => Promise<AiConceptMapGenerateResult>;
}

/**
 * Costruisce il payload chiuso. Il corpo **non viene normalizzato**: al server
 * arriva esattamente il testo salvato, e l'`inputHash` copre quel testo — un
 * `trim()` qui renderebbe la richiesta diversa dal contenuto reale.
 */
export function buildConceptMapRequest(params: {
  requestId: string;
  modelProfile: PoolModelProfile;
  lessonBody: string;
}): AiConceptMapRequest {
  return {
    kind: 'concept_map',
    requestId: params.requestId,
    modelProfile: params.modelProfile,
    lessonBody: params.lessonBody,
  };
}

export function createAiConceptMapCallables(functions: Functions): AiConceptMapCallables {
  const previewFn = httpsCallable<AiConceptMapRequest, AiConceptMapPreviewResult>(
    functions,
    'aiContentPreview',
  );
  const generateFn = httpsCallable<AiConceptMapRequest, AiConceptMapGenerateResult>(
    functions,
    'aiContentGenerate',
  );
  return {
    preview: async (req) => (await previewFn(req)).data,
    generate: async (req) => (await generateFn(req)).data,
  };
}

/**
 * Valida il risultato prima di mostrarlo, con il **contratto autorevole** già
 * usato dalla persistenza (`isValidConceptMap`): tipo, non-vuotezza e cap di
 * 32.000 **byte UTF-8**.
 *
 * Il cap non è riscritto qui. Duplicarlo avrebbe creato due limiti destinati a
 * divergere, e soprattutto un limite in caratteri: una mappa ricca di accenti o
 * di caratteri di disegno del diagramma pesa in byte molto più di quanto sia
 * lunga, quindi una proposta accettata dal client sarebbe stata poi rifiutata
 * dal salvataggio — con il testo precedente ormai sostituito. Rifiutare qui, con
 * lo stesso metro, è ciò che rende impossibile quello stato.
 *
 * Il server ha già verificato la struttura canonica (CONCEPT-MAP-01); questa è
 * difesa in profondità, non un secondo validatore strutturale. Un risultato
 * invalido non sostituisce mai il testo corrente.
 */
export function validateConceptMapResult(
  result: AiConceptMapGenerateResult,
): { ok: true; conceptMapMarkdown: string } | { ok: false; error: string } {
  const markdown = result.output?.conceptMapMarkdown;
  if (!isValidConceptMap(markdown)) {
    return { ok: false, error: 'La mappa generata non è valida. Riprova.' };
  }
  return { ok: true, conceptMapMarkdown: markdown };
}
