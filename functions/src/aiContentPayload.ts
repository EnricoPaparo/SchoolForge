/**
 * AIGEN-01 — costruzione **pura** dell'esatto payload Responses API (Structured
 * Output) per pool e lezione. È l'**unica** fonte del payload: la stima costi, il
 * bound di prenotazione e il provider reale usano tutti questo builder, così il
 * `max_output_tokens` prenotato è esattamente quello trasmesso e il bound di input
 * si basa sui byte UTF-8 dell'**identico** payload serializzato.
 *
 * Gli schema sono **strict** e compatibili con la Responses API. Per il pool è una
 * struttura **discriminata** (aperta / chiusa_singola / chiusa_multipla), senza
 * `soluzione` non vincolata: nessun campo tecnico/ID è ammesso dallo schema. Il
 * validator runtime (`aiContentValidation`) resta comunque autorevole.
 */

import {
  buildConceptMapPrompt,
  buildLessonPrompt,
  buildPoolPrompt,
  buildVisualProposalPrompt,
} from './aiContentPrompt.js';
import { type AiContentRequest, type LessonDepth } from './aiContentCore.js';
import {
  MAX_VISUAL_ALT_TEXT_CHARS,
  MAX_VISUAL_ANCHOR_HEADING_CHARS,
  MAX_VISUAL_CAPTION_CHARS,
  MAX_VISUAL_RATIONALE_CHARS,
  MAX_VISUAL_REASON_CHARS,
  MAX_VISUAL_SUBJECT_CHARS,
} from './aiContentVisualProposal.js';
import type { OpenAiStructuredRequest } from './openAiGrader.js';

/** Nome schema (distinto da `schoolforge_ai_grading` della correzione). */
export const AI_CONTENT_SCHEMA_NAME = 'schoolforge_ai_content';

/** ~4 caratteri per token; overhead fisso di prompt/schema. Euristica prudente. */
export const CHARS_PER_TOKEN = 4;
export const PROMPT_OVERHEAD_TOKENS = 900;
/**
 * Budget tecnico di output del pool. Le domande aperte richiedono soluzioni
 * formative e potenzialmente svolte passo-passo: il vecchio tetto uniforme di
 * 220 token per domanda poteva troncare il JSON Structured Output prima della
 * chiusura. Il budget resta proporzionato al tipo e quindi prudente sui costi.
 */
export const POOL_OUTPUT_BASE_TOKENS = 800;
export const OPEN_QUESTION_OUTPUT_TOKENS = 550;
export const CLOSED_QUESTION_OUTPUT_TOKENS = 300;
/**
 * Hard cap **tecnico** dei token di output per profondità lezione (Responses API,
 * prenotazione, budget, memoria, dimensione documentale). NON è un obiettivo di
 * lunghezza: il prompt non chiede mai di raggiungere questi valori. Alzati in
 * AIGEN-PROMPT-01 per non troncare lezioni didatticamente complete.
 */
/**
 * LESSON-DEPTH-01 — tetti rialzati.
 *
 * Non erano il collo di bottiglia: misurato, il modello si fermava intorno alla
 * metà del budget concesso. Ma una volta che il prompt gli chiede davvero di
 * approfondire — e soprattutto di approfondire *di più* quando i concetti chiave
 * sono pochi — il tetto può diventare vincolante sul serio, e un troncamento a
 * metà lezione è il peggior esito possibile.
 *
 * Il tetto non può sparire: `max_output_tokens` è ciò su cui si regge la
 * prenotazione di budget prima della chiamata.
 *
 * E non può nemmeno crescere a piacere. Il limite reale non è tecnico ma
 * economico: `MAX_OPERATION_COST_MICRO_USD` (0,25 USD) vale sulla prenotazione,
 * che copre **due** tentativi. Con il listino `quality` questo colloca il
 * massimo teorico di `in_depth` poco sotto i 19.000 token; 18.000 lascia il
 * margine che serve a input più ricchi senza far rifiutare la generazione dal
 * controllo di budget — un rifiuto sarebbe peggio di una lezione corta.
 */
export const LESSON_OUTPUT_TOKENS: Readonly<Record<LessonDepth, number>> = {
  synthetic: 8_000,
  complete: 14_000,
  in_depth: 18_000,
};

/**
 * CONCEPT-MAP-01 — tetto di output della mappa concettuale. Qui, a differenza
 * della lezione, il tetto **è** anche un messaggio: una mappa lunga è una mappa
 * fallita, e il cap è il modo più diretto di dirlo anche al modello. Volutamente
 * un ordine di grandezza sotto la lezione più breve.
 */
/**
 * Margine tecnico per ragionamento + Structured Output. Non è una richiesta di
 * produrre mappe più lunghe: il documento canonico resta limitato a 32 KB.
 */
export const CONCEPT_MAP_OUTPUT_TOKENS = 6_000;

/**
 * VISUAL-ENRICHMENT-01 — la proposta visuale produce pochi campi brevi, ma deve
 * poter *ragionare* prima di rispondere «nessuna immagine utile»: il tetto
 * copre il ragionamento, non la lunghezza dell'esito, che resta vincolata
 * campo per campo dai limiti in code point.
 */
export const VISUAL_PROPOSAL_OUTPUT_TOKENS = 3_000;

/**
 * Hard `max_output_tokens` realmente trasmesso al provider per la richiesta: è il
 * **tetto** dell'output fatturabile e la base della componente output della
 * prenotazione.
 */
export function resolveMaxOutputTokens(request: AiContentRequest): number {
  if (request.kind === 'pool') {
    return (
      POOL_OUTPUT_BASE_TOKENS +
      request.counts.aperta * OPEN_QUESTION_OUTPUT_TOKENS +
      (request.counts.chiusa_singola + request.counts.chiusa_multipla) *
        CLOSED_QUESTION_OUTPUT_TOKENS
    );
  }
  if (request.kind === 'concept_map') return CONCEPT_MAP_OUTPUT_TOKENS;
  if (request.kind === 'visual_proposal') return VISUAL_PROPOSAL_OUTPUT_TOKENS;
  return LESSON_OUTPUT_TOKENS[request.depth];
}

/** Stima **informativa** dei token di input (euristica caratteri/token). */
export function estimateInputTokens(request: AiContentRequest): number {
  if (request.kind === 'concept_map') {
    return Math.ceil(request.lessonBody.length / CHARS_PER_TOKEN) + PROMPT_OVERHEAD_TOKENS;
  }
  if (request.kind === 'visual_proposal') {
    // Stessa regola degli altri kind: entra nella stima tutto ciò che entra nel
    // prompt effettivo, altrimenti una UDA con descrizione lunga costerebbe più
    // di quanto la stima lascia prevedere.
    const chars =
      request.lessonBody.length +
      request.titolo.length +
      (request.sottotitolo?.length ?? 0) +
      request.difficolta.length +
      request.concettiChiave.join('').length +
      request.obiettivi.join('').length +
      request.udaTitle.length +
      (request.udaContext.descrizione?.length ?? 0) +
      request.udaContext.competenze.join('').length +
      request.udaContext.obiettivi.join('').length +
      request.udaContext.lessons
        .map((l) => l.titolo.length + (l.sottotitolo?.length ?? 0))
        .reduce((a, b) => a + b, 0);
    return Math.ceil(chars / CHARS_PER_TOKEN) + PROMPT_OVERHEAD_TOKENS;
  }
  const chars =
    request.kind === 'pool'
      ? request.lessonSource.length + (request.teacherGuidance?.length ?? 0)
      : request.currentBody.length +
        (request.teacherGuidance?.length ?? 0) +
        request.concettiChiave.join('').length +
        request.obiettivi.join('').length +
        // STRUCTURE-IMPORT-03 — il contesto generale dell'UDA finisce nel prompt
        // effettivo, quindi entra anche nella stima: senza, una UDA con
        // descrizione lunga costerebbe più di quanto la stima lascia prevedere.
        (request.udaContext.descrizione?.length ?? 0) +
        request.udaContext.competenze.join('').length +
        request.udaContext.obiettivi.join('').length;
  return Math.ceil(chars / CHARS_PER_TOKEN) + PROMPT_OVERHEAD_TOKENS;
}

// ─── Schema strict (Structured Output) ────────────────────────────────────────

const POOL_QUESTION_APERTA = {
  type: 'object',
  additionalProperties: false,
  required: ['tipo', 'testo', 'difficolta', 'soluzione'],
  properties: {
    tipo: { type: 'string', enum: ['aperta'] },
    testo: { type: 'string' },
    difficolta: { type: 'integer', minimum: 1, maximum: 5 },
    soluzione: { type: 'string' },
  },
};

function closedVariant(
  tipo: 'chiusa_singola' | 'chiusa_multipla',
  difficulty: { min: number; max: number } = { min: 1, max: 5 },
) {
  const isSingle = tipo === 'chiusa_singola';
  return {
    type: 'object',
    additionalProperties: false,
    required: ['tipo', 'testo', 'difficolta', 'opzioni', 'soluzione'],
    properties: {
      tipo: { type: 'string', enum: [tipo] },
      testo: { type: 'string' },
      difficolta: {
        type: 'integer',
        minimum: difficulty.min,
        maximum: difficulty.max,
      },
      opzioni: {
        type: 'array',
        items: { type: 'string' },
        minItems: isSingle ? 2 : 3,
        maxItems: 8,
      },
      // Indici (0-based) delle opzioni corrette: nessun ID, nessun oggetto libero.
      soluzione: {
        type: 'array',
        items: { type: 'integer', minimum: 0 },
        minItems: isSingle ? 1 : 2,
        ...(isSingle ? { maxItems: 1 } : {}),
      },
    },
  };
}

/** Schema pool **discriminato** e strict: nessun campo tecnico/ID ammesso. */
export const POOL_OUTPUT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['questions'],
  properties: {
    questions: {
      type: 'array',
      items: {
        anyOf: [
          POOL_QUESTION_APERTA,
          closedVariant('chiusa_singola'),
          closedVariant('chiusa_multipla'),
        ],
      },
    },
  },
};

/**
 * Variante request-specific dello schema pool: Structured Outputs impone già
 * quantità totale, range di difficoltà e cardinalità minima delle soluzioni.
 * Il validator runtime resta autorevole per i vincoli relazionali (indici
 * validi, almeno un distrattore nelle multiple, conteggi esatti per tipo).
 */
export function buildPoolOutputSchema(request: Extract<AiContentRequest, { kind: 'pool' }>) {
  const range =
    request.level === 'base'
      ? { min: 1, max: 3 }
      : request.level === 'advanced'
        ? { min: 3, max: 5 }
        : { min: 1, max: 5 };
  const total =
    request.counts.aperta + request.counts.chiusa_singola + request.counts.chiusa_multipla;
  return {
    type: 'object',
    additionalProperties: false,
    required: ['questions'],
    properties: {
      questions: {
        type: 'array',
        minItems: total,
        maxItems: total,
        items: {
          anyOf: [
            {
              ...POOL_QUESTION_APERTA,
              properties: {
                ...POOL_QUESTION_APERTA.properties,
                difficolta: { type: 'integer', minimum: range.min, maximum: range.max },
              },
            },
            closedVariant('chiusa_singola', range),
            closedVariant('chiusa_multipla', range),
          ],
        },
      },
    },
  };
}

/** Schema lezione strict: solo corpo Markdown. */
export const LESSON_OUTPUT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['body'],
  properties: { body: { type: 'string' } },
};

/**
 * CONCEPT-MAP-01 — schema strict a **tre campi**. Il modello non produce il
 * documento: intestazioni, ordine, fence del diagramma e avvertenza li aggiunge
 * il server (`aiContentConceptMap`). Nessun campo per l'avvertenza, che è una
 * costante e non un contenuto negoziabile.
 */
/**
 * VISUAL-ENRICHMENT-01 — schema **strict** dei due esiti della proposta.
 *
 * **Perché un envelope `proposal` e non l'unione alla radice.** Lo Structured
 * Output strict di OpenAI richiede che la radice sia un `object` con
 * `additionalProperties: false` e proprietà dichiarate: un `oneOf` alla radice
 * non è accettato. L'unione vive quindi **annidata** dentro una proprietà
 * obbligatoria, ed è espressa con `anyOf` — `oneOf` non compare in alcun punto
 * dello schema trasmesso.
 *
 * I due rami restano chiusi e disgiunti, con **tutte** le proprietà dichiarate
 * anche `required`: strict non ammette proprietà facoltative, e un ramo con un
 * campo opzionale sarebbe di nuovo la porta da cui rientra un «nessuna immagine»
 * con la didascalia già scritta.
 *
 * **L'envelope è provider-specifico e si ferma al confine.** Viene validato ed
 * estratto prima di qualunque persistenza: il valore canonico salvato nel run e
 * restituito dal replay è l'unione **senza** envelope. Un envelope che filtrasse
 * fino al documento persistito renderebbe il contratto pubblico ostaggio della
 * forma richiesta oggi da un provider.
 */
/**
 * I limiti testuali compaiono nelle `description` perché lo Structured Output
 * strict del provider accetta solo un sottoinsieme di JSON Schema: il
 * validatore runtime resta l'autorità fail-closed e non viene sostituito da un
 * `maxLength` potenzialmente non supportato. Prompt, descrizioni e validator
 * leggono però le stesse costanti, quindi non possono divergere in silenzio.
 */
const VISUAL_PROPOSAL_NONE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['decision', 'reason'],
  properties: {
    decision: { type: 'string', enum: ['none'] },
    reason: {
      type: 'string',
      description: `Motivazione specifica in italiano, massimo ${MAX_VISUAL_REASON_CHARS} caratteri Unicode.`,
    },
  },
};

const VISUAL_PROPOSAL_IMAGE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['decision', 'subject', 'rationale', 'anchorHeadingText', 'caption', 'altText'],
  properties: {
    decision: { type: 'string', enum: ['image'] },
    subject: {
      type: 'string',
      description: `Descrizione visiva autosufficiente di una o due frasi: massimo assoluto ${MAX_VISUAL_SUBJECT_CHARS} caratteri Unicode, obiettivo 240-320.`,
    },
    rationale: {
      type: 'string',
      description: `Utilità didattica specifica, massimo ${MAX_VISUAL_RATIONALE_CHARS} caratteri Unicode.`,
    },
    anchorHeadingText: {
      type: 'string',
      description: `Testo esatto di un heading della lezione, massimo ${MAX_VISUAL_ANCHOR_HEADING_CHARS} caratteri Unicode.`,
    },
    caption: {
      type: 'string',
      description: `Didascalia informativa, massimo ${MAX_VISUAL_CAPTION_CHARS} caratteri Unicode.`,
    },
    altText: {
      type: 'string',
      description: `Descrizione accessibile equivalente, massimo ${MAX_VISUAL_ALT_TEXT_CHARS} caratteri Unicode.`,
    },
  },
};

export const VISUAL_PROPOSAL_OUTPUT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['proposal'],
  properties: {
    proposal: {
      anyOf: [VISUAL_PROPOSAL_NONE_SCHEMA, VISUAL_PROPOSAL_IMAGE_SCHEMA],
    },
  },
};

export const CONCEPT_MAP_OUTPUT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['summaryMarkdown', 'diagram'],
  properties: {
    summaryMarkdown: { type: 'string' },
    diagram: { type: 'string' },
  },
};

/**
 * Costruisce l'**esatta** `OpenAiStructuredRequest` (system+user+schema strict+
 * `max_output_tokens` reale, `store: false`). Pura: nessun trasporto, nessun
 * dato identificativo. Usata identica da stima, prenotazione e provider reale.
 */
export function buildContentStructuredRequest(
  request: AiContentRequest,
  model: string,
): OpenAiStructuredRequest {
  const prompt =
    request.kind === 'pool'
      ? buildPoolPrompt(request)
      : request.kind === 'concept_map'
        ? buildConceptMapPrompt(request)
        : request.kind === 'visual_proposal'
          ? buildVisualProposalPrompt(request)
          : buildLessonPrompt(request);
  const schema =
    request.kind === 'pool'
      ? buildPoolOutputSchema(request)
      : request.kind === 'concept_map'
        ? CONCEPT_MAP_OUTPUT_SCHEMA
        : request.kind === 'visual_proposal'
          ? VISUAL_PROPOSAL_OUTPUT_SCHEMA
          : LESSON_OUTPUT_SCHEMA;
  return {
    model,
    input: [
      { role: 'system', content: prompt.system },
      { role: 'user', content: prompt.user },
    ],
    text: {
      format: {
        type: 'json_schema',
        name: AI_CONTENT_SCHEMA_NAME,
        strict: true,
        schema,
      },
    },
    max_output_tokens: resolveMaxOutputTokens(request),
    store: false,
  };
}

/**
 * Upper bound **provabile** dei token di input fatturabili: byte UTF-8 dell'esatta
 * richiesta serializzata. Il tokenizer BPE è byte-level ⇒ token input ≤ byte UTF-8
 * (mai inferiore all'input realmente fatturato; prudente su emoji/CJK/combinati).
 */
export function reservationInputTokenUpperBound(request: AiContentRequest, model: string): number {
  return Buffer.byteLength(JSON.stringify(buildContentStructuredRequest(request, model)), 'utf8');
}
