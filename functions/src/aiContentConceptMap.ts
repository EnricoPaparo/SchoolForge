/**
 * CONCEPT-MAP-01 — validazione dell'output del provider e **composizione
 * deterministica** del Markdown canonico della mappa concettuale.
 *
 * Le due cose stanno nello stesso modulo perché sono un contratto solo: i tre
 * campi restituiti dal modello non sono un documento, e diventano documento
 * unicamente attraverso `composeConceptMapMarkdown`. Separarle inviterebbe a
 * comporre senza validare.
 *
 * **Perché la struttura non è affidata al prompt.** Un prompt può chiedere
 * quattro sezioni nell'ordine giusto; non può garantirle. Qui il modello
 * fornisce solo i contenuti e il server decide intestazioni, ordine, fence del
 * diagramma e avvertenza: presenza e sequenza delle quattro parti diventano
 * proprietà del codice, non esiti probabili di una generazione.
 *
 * Puro: nessuna rete, nessun I/O, nessuna dipendenza Firestore.
 */

import { AiContentError, AI_CONTENT_LIMITS, utf8ByteLength } from './aiContentCore.js';
import { CONCEPT_MAP_DIAGRAM_MAX_LINE_CHARS } from './aiContentPrompt.js';

/**
 * Avvertenza finale: **costante SchoolForge**, mai testo generato. Il modello
 * non deve poterla riformulare, ammorbidire o dimenticare — è la riga che
 * impedisce alla mappa di essere scambiata per la lezione.
 */
export const CONCEPT_MAP_DISCLAIMER =
  'Questa mappa è un supporto al ripasso e non sostituisce lo studio della lezione.';

/** Intestazioni canoniche delle tre sezioni generate. */
export const CONCEPT_MAP_HEADINGS = {
  outline: '## Ossatura della lezione',
  summary: '## Sintesi',
  diagram: '## Diagramma',
} as const;

/** I tre campi dello Structured Output, validati. */
export interface ValidatedConceptMapProposal {
  outlineMarkdown: string;
  summaryMarkdown: string;
  diagram: string;
}

/** Esito completo: i campi validati e il Markdown canonico già composto. */
export interface ComposedConceptMap extends ValidatedConceptMapProposal {
  conceptMapMarkdown: string;
}

const ALLOWED_KEYS = ['outlineMarkdown', 'summaryMarkdown', 'diagram'] as const;

const FRONT_MATTER_RE = /^\uFEFF?\s*---\s*\n/;
const DANGEROUS_HTML_RE = /<\s*(script|style|iframe|object|embed)\b/i;
/**
 * Tre backtick ovunque nel campo. Il diagramma viene inserito dal server dentro
 * un blocco ```text: una fence prodotta dal modello lo chiuderebbe a metà e il
 * resto del documento verrebbe interpretato come Markdown normale — un output
 * che *sembra* valido e non lo è. Vale per tutti e tre i campi, perché anche
 * ossatura e sintesi vengono inserite in un documento composto.
 */
const FENCE_RE = /```/;

function asObject(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new AiContentError('provider_invalid_output', 'Struttura della mappa non valida.');
  }
  return value as Record<string, unknown>;
}

function requiredField(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new AiContentError('provider_invalid_output', 'La mappa generata è incompleta.');
  }
  return value.trim();
}

/**
 * Valida i tre campi. Fail-closed e **senza aggiustamenti**: nessun troncamento
 * di righe lunghe, nessuna rimozione di fence, nessun riempimento di un campo
 * mancante. Un output non conforme viene rifiutato per intero, perché una mappa
 * corretta a metà dal server non è più ciò che il modello ha prodotto né ciò
 * che il docente rileggerà.
 */
export function validateConceptMapProposal(output: unknown): ValidatedConceptMapProposal {
  const root = asObject(output);
  for (const key of Object.keys(root)) {
    if (!ALLOWED_KEYS.includes(key as (typeof ALLOWED_KEYS)[number])) {
      throw new AiContentError(
        'provider_invalid_output',
        'La mappa generata contiene campi non ammessi.',
      );
    }
  }

  const outlineMarkdown = requiredField(root, 'outlineMarkdown');
  const summaryMarkdown = requiredField(root, 'summaryMarkdown');
  const diagram = requiredField(root, 'diagram');

  for (const value of [outlineMarkdown, summaryMarkdown, diagram]) {
    if (FENCE_RE.test(value)) {
      throw new AiContentError(
        'provider_invalid_output',
        'La mappa generata non deve contenere blocchi di codice.',
      );
    }
    if (FRONT_MATTER_RE.test(value)) {
      throw new AiContentError(
        'provider_invalid_output',
        'La mappa generata non deve contenere front matter.',
      );
    }
    if (DANGEROUS_HTML_RE.test(value)) {
      throw new AiContentError(
        'provider_invalid_output',
        'La mappa generata contiene HTML non ammesso.',
      );
    }
  }

  // Larghezza del diagramma: misurata in **code point**, non in unità UTF-16,
  // perché i caratteri di disegno e le frecce non devono contare doppio.
  for (const line of diagram.split('\n')) {
    if ([...line].length > CONCEPT_MAP_DIAGRAM_MAX_LINE_CHARS) {
      throw new AiContentError(
        'provider_invalid_output',
        `Il diagramma supera ${CONCEPT_MAP_DIAGRAM_MAX_LINE_CHARS} caratteri per riga.`,
      );
    }
  }

  return { outlineMarkdown, summaryMarkdown, diagram };
}

/**
 * Compone il Markdown canonico. Ordine e intestazioni sono fissi; l'avvertenza
 * è una costante. È l'unico punto in cui la mappa diventa un documento.
 */
export function composeConceptMapMarkdown(parts: ValidatedConceptMapProposal): string {
  return [
    CONCEPT_MAP_HEADINGS.outline,
    '',
    parts.outlineMarkdown,
    '',
    CONCEPT_MAP_HEADINGS.summary,
    '',
    parts.summaryMarkdown,
    '',
    CONCEPT_MAP_HEADINGS.diagram,
    '',
    '```text',
    parts.diagram,
    '```',
    '',
    '> [!IMPORTANT]',
    `> ${CONCEPT_MAP_DISCLAIMER}`,
    '',
  ].join('\n');
}

/**
 * Valida e compone in un passaggio solo, applicando il cap dimensionale
 * **sul documento composto** e non sui campi grezzi: è il documento che verrà
 * persistito e proiettato, quindi è quello che deve stare nel limite.
 */
export function validateAndComposeConceptMap(output: unknown): ComposedConceptMap {
  const parts = validateConceptMapProposal(output);
  const conceptMapMarkdown = composeConceptMapMarkdown(parts);
  if (utf8ByteLength(conceptMapMarkdown) > AI_CONTENT_LIMITS.MAX_CONCEPT_MAP_OUTPUT_BYTES) {
    throw new AiContentError('output_too_large', 'La mappa generata supera il limite.');
  }
  return { ...parts, conceptMapMarkdown };
}
