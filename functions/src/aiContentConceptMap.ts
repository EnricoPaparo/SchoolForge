/**
 * CONCEPT-MAP-01 — contratto completo dell'artefatto «mappa concettuale»:
 * validazione dei tre campi del provider, composizione **deterministica** del
 * Markdown canonico e **validazione del documento persistito** riusata dal
 * parser del run.
 *
 * Le tre cose stanno nello stesso modulo perché sono un contratto solo. I campi
 * del modello non sono un documento e lo diventano unicamente attraverso
 * `composeConceptMapMarkdown`; il documento persistito, a sua volta, è valido
 * solo se è **esattamente** ciò che quella composizione avrebbe prodotto.
 * Separarli inviterebbe a comporre senza validare, o ad accettare in replay un
 * documento che nessuna composizione avrebbe mai generato.
 *
 * **Perché la struttura non è affidata al prompt.** Un prompt può chiedere
 * quattro sezioni nell'ordine giusto; non può garantirle. Qui il modello
 * fornisce solo i contenuti e il server decide intestazioni, ordine, fence del
 * diagramma e avvertenza: presenza e sequenza delle quattro parti diventano
 * proprietà del codice, non esiti probabili di una generazione.
 *
 * **Nessun aggiustamento silenzioso.** Non si tronca, non si normalizza, non si
 * corregge: un output non conforme è rifiutato per intero. Una mappa aggiustata
 * dal server non sarebbe più né ciò che il modello ha prodotto né ciò che il
 * docente rileggerà.
 *
 * Puro: nessuna rete, nessun I/O, nessuna dipendenza Firestore.
 */

import { AiContentError, AI_CONTENT_LIMITS, utf8ByteLength } from './aiContentCore.js';

/**
 * Larghezza massima di una riga del diagramma, in **code point**. Vive qui e non
 * nel prompt perché è un vincolo di contratto: il prompt la dichiara al modello,
 * il validator la fa rispettare. Se vivesse nel prompt, il contratto dipenderebbe
 * dal testo con cui lo si chiede.
 */
export const CONCEPT_MAP_DIAGRAM_MAX_LINE_CHARS = 80;

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

/** Marcatore del callout dell'avvertenza. */
export const CONCEPT_MAP_CALLOUT_MARKER = '> [!IMPORTANT]';

/** Apertura della fence del diagramma. */
export const CONCEPT_MAP_DIAGRAM_FENCE = '```text';

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

const ALLOWED_PROPOSAL_KEYS = ['outlineMarkdown', 'summaryMarkdown', 'diagram'] as const;

// ─── Vincoli comuni ai tre campi ──────────────────────────────────────────────

const FRONT_MATTER_RE = /^\uFEFF?\s*---\s*\n/;
/**
 * Tre backtick ovunque nel campo. Il diagramma viene inserito dal server dentro
 * un blocco ```text: una fence prodotta dal modello lo chiuderebbe a metà e il
 * resto del documento verrebbe interpretato come Markdown normale — un output
 * che *sembra* valido e non lo è. Vale per tutti e tre i campi, perché tutti
 * finiscono nello stesso documento composto.
 */
const FENCE_RE = /```/;
/** Heading ATX (`#` … `######`), con l'indentazione tollerata da CommonMark. */
const ATX_HEADING_RE = /^ {0,3}#{1,6}(\s|$)/;
/** Riga di sottolineatura di un heading Setext (`===` o `---`). */
const SETEXT_UNDERLINE_RE = /^ {0,3}(=+|-+)\s*$/;
/**
 * Tag HTML **reale**: `<` seguito immediatamente da una lettera (o da `/`), un
 * nome di tag e una chiusura `>`. Volutamente non generico su `<`, altrimenti un
 * confronto matematico come «a < b» o «x <= y» diventerebbe HTML: il vincolo
 * serve a fermare markup, non aritmetica.
 */
const HTML_TAG_RE = /<\/?[A-Za-z][A-Za-z0-9-]*(?:\s[^<>]*)?\/?>/;
/** Commenti, doctype e sezioni CDATA: non sono tag ma sono comunque markup. */
const HTML_META_RE = /<!--|<!\[CDATA\[|<!\s*doctype/i;
/** Voce di elenco puntato: marker `-`, `*` o `+`, con indentazione libera. */
const LIST_ITEM_RE = /^\s*[-*+]\s+\S/;

function invalidOutput(message: string): never {
  throw new AiContentError('provider_invalid_output', message);
}

function asObject(value: unknown, message: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    invalidOutput(message);
  }
  return value as Record<string, unknown>;
}

/**
 * Legge un campo obbligatorio **senza modificarlo**. `trim()` è usato solo come
 * predicato di vuotezza; il valore restituito è l'originale. Gli spazi esterni
 * sono **rifiutati esplicitamente** invece di essere normalizzati: il documento
 * composto deve essere riconoscibile byte per byte dal validator del replay, e
 * un ritorno a capo in coda a una sezione renderebbe ambiguo il confine con la
 * riga vuota che il compositore inserisce.
 */
function requiredField(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    invalidOutput('La mappa generata è incompleta.');
  }
  if (value !== value.trim()) {
    invalidOutput('La mappa generata contiene spazi iniziali o finali non ammessi.');
  }
  return value;
}

/** Vincoli che valgono per tutti e tre i campi. */
function assertCommonFieldRules(value: string, label: string): void {
  if (FENCE_RE.test(value)) {
    invalidOutput(`${label}: i blocchi di codice non sono ammessi.`);
  }
  if (FRONT_MATTER_RE.test(value)) {
    invalidOutput(`${label}: il front matter non è ammesso.`);
  }
  if (HTML_TAG_RE.test(value) || HTML_META_RE.test(value)) {
    invalidOutput(`${label}: l'HTML non è ammesso.`);
  }
  const lines = value.split('\n');
  lines.forEach((line, index) => {
    if (ATX_HEADING_RE.test(line)) {
      // Le intestazioni le decide il server: una prodotta dal modello
      // spezzerebbe la struttura canonica di quattro sezioni.
      invalidOutput(`${label}: le intestazioni non sono ammesse.`);
    }
    if (index > 0 && SETEXT_UNDERLINE_RE.test(line)) {
      const previous = lines[index - 1] ?? '';
      if (previous.trim().length > 0 && !SETEXT_UNDERLINE_RE.test(previous)) {
        invalidOutput(`${label}: le intestazioni non sono ammesse.`);
      }
    }
  });
}

/** L'ossatura deve essere davvero un elenco, non prosa travestita. */
function assertOutlineShape(value: string): void {
  const nonEmpty = value.split('\n').filter((line) => line.trim().length > 0);
  if (nonEmpty.length === 0) {
    invalidOutput('Ossatura: serve almeno una voce di elenco.');
  }
  for (const line of nonEmpty) {
    if (!LIST_ITEM_RE.test(line)) {
      invalidOutput('Ossatura: ogni riga deve essere una voce di elenco.');
    }
  }
}

/**
 * La sintesi deve essere prosa. Un elenco qui duplicherebbe l'ossatura che sta
 * due righe sopra, e la mappa perderebbe l'unica parte che lega i concetti in un
 * discorso: il rifiuto è su qualunque riga puntata, non solo su un elenco
 * integrale, perché una sintesi «mezza a punti» è già quel fallimento a metà.
 */
function assertSummaryShape(value: string): void {
  const nonEmpty = value.split('\n').filter((line) => line.trim().length > 0);
  if (nonEmpty.length === 0) {
    invalidOutput('Sintesi: il testo non può essere vuoto.');
  }
  for (const line of nonEmpty) {
    if (LIST_ITEM_RE.test(line)) {
      invalidOutput('Sintesi: deve essere prosa, non un elenco.');
    }
  }
}

/** Larghezza in **code point**: i caratteri di disegno non contano doppio. */
function assertDiagramShape(value: string): void {
  for (const line of value.split('\n')) {
    if ([...line].length > CONCEPT_MAP_DIAGRAM_MAX_LINE_CHARS) {
      invalidOutput(`Diagramma: una riga supera ${CONCEPT_MAP_DIAGRAM_MAX_LINE_CHARS} caratteri.`);
    }
  }
}

/**
 * Valida i tre campi restituiti dal provider. Fail-closed e **senza
 * aggiustamenti**: i valori tornano indietro identici a come sono arrivati.
 */
export function validateConceptMapProposal(output: unknown): ValidatedConceptMapProposal {
  const root = asObject(output, 'Struttura della mappa non valida.');
  for (const key of Object.keys(root)) {
    if (!ALLOWED_PROPOSAL_KEYS.includes(key as (typeof ALLOWED_PROPOSAL_KEYS)[number])) {
      invalidOutput('La mappa generata contiene campi non ammessi.');
    }
  }

  const outlineMarkdown = requiredField(root, 'outlineMarkdown');
  const summaryMarkdown = requiredField(root, 'summaryMarkdown');
  const diagram = requiredField(root, 'diagram');

  assertCommonFieldRules(outlineMarkdown, 'Ossatura');
  assertCommonFieldRules(summaryMarkdown, 'Sintesi');
  assertCommonFieldRules(diagram, 'Diagramma');

  assertOutlineShape(outlineMarkdown);
  assertSummaryShape(summaryMarkdown);
  assertDiagramShape(diagram);

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
    CONCEPT_MAP_DIAGRAM_FENCE,
    parts.diagram,
    '```',
    '',
    CONCEPT_MAP_CALLOUT_MARKER,
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

// ─── Validazione del documento persistito (replay) ────────────────────────────

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Scheletro canonico, ancorato all'inizio e alla fine del documento. I gruppi
 * non-greedy catturano le tre sezioni; la chiusura `\n$` garantisce che dopo
 * l'avvertenza non ci sia altro se non la newline finale canonica.
 */
const CANONICAL_MARKDOWN_RE = new RegExp(
  [
    '^',
    escapeForRegExp(CONCEPT_MAP_HEADINGS.outline),
    '\\n\\n([\\s\\S]*?)\\n\\n',
    escapeForRegExp(CONCEPT_MAP_HEADINGS.summary),
    '\\n\\n([\\s\\S]*?)\\n\\n',
    escapeForRegExp(CONCEPT_MAP_HEADINGS.diagram),
    '\\n\\n',
    escapeForRegExp(CONCEPT_MAP_DIAGRAM_FENCE),
    '\\n([\\s\\S]*?)\\n```\\n\\n',
    escapeForRegExp(CONCEPT_MAP_CALLOUT_MARKER),
    '\\n> ',
    escapeForRegExp(CONCEPT_MAP_DISCLAIMER),
    '\\n$',
  ].join(''),
);

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

/**
 * Valida il Markdown **persistito** e lo restituisce **identico**.
 *
 * Il replay non ricompone nulla: la ricomposizione è usata soltanto come oracolo
 * di uguaglianza — se il documento non è byte per byte ciò che il compositore
 * avrebbe prodotto dalle sue stesse sezioni, non è canonico e viene rifiutato.
 * È il controllo più stretto possibile e il più semplice da leggere: rende
 * impossibile che un documento accettato in lettura differisca da uno prodotto
 * in scrittura.
 */
export function parseCanonicalConceptMapMarkdown(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    invalidOutput('La mappa persistita è mancante o vuota.');
  }
  if (utf8ByteLength(value) > AI_CONTENT_LIMITS.MAX_CONCEPT_MAP_OUTPUT_BYTES) {
    throw new AiContentError('output_too_large', 'La mappa persistita supera il limite.');
  }

  // Unicità delle ancore: lo scheletro impone l'ordine, il conteggio impone che
  // non ce ne siano altre altrove (una seconda fence, un secondo disclaimer).
  for (const [needle, label] of [
    [CONCEPT_MAP_HEADINGS.outline, "l'intestazione dell'ossatura"],
    [CONCEPT_MAP_HEADINGS.summary, "l'intestazione della sintesi"],
    [CONCEPT_MAP_HEADINGS.diagram, "l'intestazione del diagramma"],
    [CONCEPT_MAP_CALLOUT_MARKER, "il marcatore dell'avvertenza"],
    [CONCEPT_MAP_DISCLAIMER, "l'avvertenza"],
  ] as const) {
    if (countOccurrences(value, needle) !== 1) {
      invalidOutput(`La mappa persistita deve contenere ${label} esattamente una volta.`);
    }
  }
  // Esattamente una fence aperta e una chiusa: nessuna, doppia o non chiusa.
  if (countOccurrences(value, '```') !== 2) {
    invalidOutput('La mappa persistita deve contenere un solo blocco di diagramma.');
  }

  const match = CANONICAL_MARKDOWN_RE.exec(value);
  if (!match) {
    invalidOutput('La mappa persistita non rispetta la struttura canonica.');
  }
  const parts: ValidatedConceptMapProposal = {
    outlineMarkdown: match[1] ?? '',
    summaryMarkdown: match[2] ?? '',
    diagram: match[3] ?? '',
  };

  // Le sezioni estratte devono soddisfare gli **stessi** contratti dei campi
  // generati: nessun heading interno, nessun HTML, ossatura a elenco, sintesi in
  // prosa, diagramma entro la larghezza massima.
  validateConceptMapProposal(parts);

  if (composeConceptMapMarkdown(parts) !== value) {
    invalidOutput('La mappa persistita non rispetta la struttura canonica.');
  }
  // Identico all'input: nessuna ricomposizione restituita al chiamante.
  return value;
}

/**
 * Forma dell'`output` di un run `concept_map` completato: **esattamente** una
 * chiave, il cui valore è un Markdown canonico. Usato dal parser del documento
 * run, che non deve conoscere la struttura dell'artefatto.
 */
export function validateStoredConceptMapOutput(output: unknown): { conceptMapMarkdown: string } {
  const root = asObject(output, 'Output della mappa non valido.');
  const keys = Object.keys(root);
  if (keys.length !== 1 || keys[0] !== 'conceptMapMarkdown') {
    invalidOutput('Output della mappa non valido.');
  }
  return { conceptMapMarkdown: parseCanonicalConceptMapMarkdown(root.conceptMapMarkdown) };
}

/** Predicato senza eccezioni, per i parser fail-closed che restituiscono `null`. */
export function isValidStoredConceptMapOutput(output: unknown): boolean {
  try {
    validateStoredConceptMapOutput(output);
    return true;
  } catch {
    return false;
  }
}
