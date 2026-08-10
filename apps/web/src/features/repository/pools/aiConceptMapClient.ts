import { httpsCallable } from 'firebase/functions';
import type { Functions } from 'firebase/functions';

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
 * Il payload è deliberatamente **povero**: solo il corpo della lezione. Nessun
 * profilo scelto dall'utente, nessuna profondità, nessuna indicazione docente,
 * nessun model ID o listino. Il profilo è fisso a `economy` come costante del
 * modulo: non è un default sostituibile ma parte del contratto, e il server
 * rifiuta qualunque altro valore.
 */

/** Profilo **fisso**: non è un parametro, è una proprietà del kind. */
export const CONCEPT_MAP_MODEL_PROFILE = 'economy' as const;

/** Payload chiuso, identico per preview e generate. */
export interface AiConceptMapRequest {
  kind: 'concept_map';
  requestId: string;
  modelProfile: typeof CONCEPT_MAP_MODEL_PROFILE;
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
  lessonBody: string;
}): AiConceptMapRequest {
  return {
    kind: 'concept_map',
    requestId: params.requestId,
    modelProfile: CONCEPT_MAP_MODEL_PROFILE,
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
 * Valida la forma del risultato prima di mostrarlo. Il server ha già verificato
 * la struttura canonica (CONCEPT-MAP-01); qui si difende soltanto dal risultato
 * malformato o vuoto, che non deve mai sostituire il testo corrente.
 */
export function validateConceptMapResult(
  result: AiConceptMapGenerateResult,
): { ok: true; conceptMapMarkdown: string } | { ok: false; error: string } {
  const markdown = result.output?.conceptMapMarkdown;
  if (typeof markdown !== 'string' || markdown.trim().length === 0) {
    return { ok: false, error: 'La mappa generata non è valida. Riprova.' };
  }
  return { ok: true, conceptMapMarkdown: markdown };
}
